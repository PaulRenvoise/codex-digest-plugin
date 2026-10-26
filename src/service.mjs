import { VERSION, DigestError, validateTool, normalizeDomains, normalizeSchedule, canonicalUrl, safeUrl, stableId, RESEARCH_GUIDELINES } from './contract.mjs';
import { nextOccurrence } from './schedule.mjs';

export function editionTitle(digest, createdAt, headline, itemCount) {
  const localDate = new Date(new Date(createdAt).getTime() + digest.schedule.utc_offset_minutes * 60000).toISOString().slice(0, 10);
  const cleanHeadline = headline.trim().replace(/^\d{4}-\d{2}-\d{2}\s+[-—–]\s+/, '').replace(/(?:^|\s+)[-—–]\s+\d+\s+items?$/i, '').trim();
  if (!cleanHeadline) throw new DigestError('Provide a short headline describing the edition’s content.');
  return `${localDate} - ${cleanHeadline} - ${itemCount} items`;
}

export class DigestService {
  constructor(db, owner, clock = () => new Date()) { this.db = db; this.owner = owner; this.clock = clock; }
  stmt(sql, ...args) { return this.db.prepare(sql).bind(...args); }
  async rows(sql, ...args) { return (await this.stmt(sql, ...args).all()).results; }
  async digest(id) {
    const row = await this.stmt('SELECT * FROM digests WHERE id = ? AND owner_id = ?', id, this.owner).first();
    if (!row) throw new DigestError('Digest not found.', 404);
    const { owner_id, domains, schedule, ...data } = row;
    return { ...data, domains: JSON.parse(domains), schedule: JSON.parse(schedule) };
  }
  async listDigests() {
    const rows = await this.rows('SELECT id, name, prompt, domains, items_per_edition, schedule, next_run_at, revision, created_at, updated_at FROM digests WHERE owner_id = ? ORDER BY created_at DESC, id', this.owner);
    return rows.map(row => ({ ...row, domains: JSON.parse(row.domains), schedule: JSON.parse(row.schedule) }));
  }
  async edition(digestId, editionId) {
    await this.digest(digestId);
    const edition = await this.stmt('SELECT * FROM editions WHERE id = ? AND digest_id = ?', editionId, digestId).first();
    if (!edition) throw new DigestError('Edition not found.', 404);
    const items = await this.rows(`SELECT e.*, i.canonical_url,
      COALESCE(f.vote, 0) AS vote, COALESCE(f.revision, 0) AS feedback_revision
      FROM entries e JOIN items i ON i.id = e.item_id LEFT JOIN feedback f ON f.item_id = i.id
      WHERE e.edition_id = ? ORDER BY e.position`, editionId);
    return { edition, items: items.map(row => ({ ...row, tags: JSON.parse(row.tags) })) };
  }
  async scheduledRun(id, token) {
    const run = await this.stmt(`SELECT r.* FROM digest_runs r JOIN digests d ON d.id = r.digest_id
      WHERE r.id = ? AND r.claim_token = ? AND d.owner_id = ?`, id, token, this.owner).first();
    if (!run) throw new DigestError('Scheduled run not found or claimed by another worker.', 409);
    return run;
  }
  finishRun(run, digest, token, now, editionId) {
    // The database trigger guards the claim inside the same transaction as the edition.
    return [
      this.stmt('UPDATE digest_runs SET status = ?, claim_token = ?, edition_id = ?, finished_at = ? WHERE id = ?',
        editionId ? 'completed' : 'skipped', token, editionId, now, run.id),
      this.stmt('UPDATE digests SET next_run_at = ? WHERE id = ? AND owner_id = ?',
        nextOccurrence(digest.schedule, now), digest.id, this.owner)
    ];
  }
  async call(name, args = {}) {
    validateTool(name, args);
    const now = this.clock().toISOString();
    const leaseUntil = new Date(new Date(now).getTime() + 3600000).toISOString();
    if (name === 'backend_info') return { product: 'digest', version: VERSION, schema_version: 1, authenticated: true };
    if (name === 'list_digests') return { digests: await this.listDigests() };
    if (name === 'get_digest') return { digest: await this.digest(args.digest_id) };
    if (name === 'list_due_digests') {
      // Existing installations start at their next occurrence, with no historical backlog.
      for (const digest of await this.listDigests()) {
        if (!digest.next_run_at) await this.stmt('UPDATE digests SET next_run_at = ? WHERE id = ? AND owner_id = ? AND revision = ? AND next_run_at IS NULL',
          nextOccurrence(digest.schedule, now), digest.id, this.owner, digest.revision).run();
      }
      return { digests: (await this.listDigests()).filter(d => d.next_run_at && d.next_run_at <= now) };
    }
    if (name === 'claim_digest_run') {
      const digest = await this.digest(args.digest_id);
      const token = await stableId(this.owner, digest.id, 'claim', args.request_key);
      const prior = await this.stmt('SELECT * FROM digest_runs WHERE digest_id = ? AND claim_token = ?', digest.id, token).first();
      if (prior) return { run: prior };
      if (!digest.next_run_at || digest.next_run_at > now) return { run: null };
      const id = await stableId(digest.id, 'scheduled', digest.next_run_at);
      const run = await this.stmt(`INSERT INTO digest_runs (id, digest_id, scheduled_for, digest_revision, claim_token, lease_until, status)
        SELECT ?, id, next_run_at, revision, ?, ?, 'running' FROM digests
        WHERE id = ? AND owner_id = ? AND revision = ? AND next_run_at = ? AND next_run_at <= ?
        ON CONFLICT(digest_id, scheduled_for) DO UPDATE SET claim_token = excluded.claim_token,
          lease_until = excluded.lease_until, digest_revision = excluded.digest_revision
        WHERE digest_runs.status = 'running' AND (digest_runs.lease_until <= ? OR digest_runs.digest_revision != excluded.digest_revision)
        RETURNING *`, id, token, leaseUntil, digest.id, this.owner, digest.revision, digest.next_run_at, now, now).first();
      return { run: run ?? null };
    }
    if (name === 'renew_digest_run' || name === 'skip_digest_run') {
      const run = await this.scheduledRun(args.run_id, args.claim_token);
      if (name === 'skip_digest_run' && run.status === 'skipped') return { run };
      if (name === 'renew_digest_run') {
        const renewed = await this.stmt(`UPDATE digest_runs SET lease_until = ? WHERE id = ? AND claim_token = ?
          AND status = 'running' AND lease_until > ? AND EXISTS (
            SELECT 1 FROM digests WHERE id = digest_runs.digest_id AND revision = digest_runs.digest_revision AND next_run_at = digest_runs.scheduled_for) RETURNING *`,
        leaseUntil, run.id, args.claim_token, now).first();
        if (!renewed) throw new DigestError('Scheduled run expired or settings changed. Claim again with a new request key.', 409);
        return { run: renewed };
      }
      const digest = await this.digest(run.digest_id);
      try { await this.db.batch(this.finishRun(run, digest, args.claim_token, now, null)); }
      catch (error) { if (/Scheduled run/.test(error.message)) throw new DigestError(error.message, 409); throw error; }
      return { run: await this.scheduledRun(run.id, args.claim_token) };
    }
    if (name === 'open_digest') {
      const digests = await this.listDigests();
      const prefs = await this.stmt('SELECT default_digest_id FROM preferences WHERE owner_id = ?', this.owner).first();
      const selected = args.digest_id ?? prefs?.default_digest_id ?? digests[0]?.id ?? null;
      if (selected) await this.digest(selected);
      return { digests, selected_digest_id: selected, version: VERSION };
    }
    if (name === 'create_digest') {
      const id = await stableId(this.owner, 'digest', args.request_key);
      const domains = normalizeDomains(args.domains);
      const schedule = normalizeSchedule(args.schedule);
      await this.stmt(`INSERT INTO digests (id, owner_id, name, prompt, domains, items_per_edition, schedule, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, id, this.owner, args.name.trim(), args.prompt.trim(), JSON.stringify(domains), args.items_per_edition ?? 12, JSON.stringify(schedule), nextOccurrence(schedule, now), now, now).run();
      return { digest: await this.digest(id) };
    }
    if (name === 'update_digest') {
      const current = await this.digest(args.digest_id);
      const domains = normalizeDomains(args.domains);
      const schedule = normalizeSchedule(args.schedule ?? current.schedule);
      const nextRun = JSON.stringify(schedule) === JSON.stringify(current.schedule) && current.next_run_at ? current.next_run_at : nextOccurrence(schedule, now);
      const result = await this.stmt(`UPDATE digests SET name = ?, prompt = ?, domains = ?, items_per_edition = ?, schedule = ?, next_run_at = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND owner_id = ? AND revision = ? RETURNING id`, args.name.trim(), args.prompt.trim(), JSON.stringify(domains), args.items_per_edition ?? current.items_per_edition, JSON.stringify(schedule), nextRun, now,
        args.digest_id, this.owner, args.expected_revision).first();
      if (!result) throw new DigestError('This digest changed on another device. Reload before saving your changes.', 409);
      return { digest: await this.digest(args.digest_id) };
    }
    if (name === 'list_editions') {
      await this.digest(args.digest_id);
      const offset = args.offset ?? 0;
      const rows = await this.rows(`SELECT e.*, (SELECT COUNT(*) FROM entries WHERE edition_id = e.id) AS item_count
        FROM editions e WHERE digest_id = ? ORDER BY created_at DESC, id DESC LIMIT 31 OFFSET ?`, args.digest_id, offset);
      return { editions: rows.slice(0, 30), next_offset: rows.length > 30 ? offset + 30 : null };
    }
    if (name === 'get_edition') return this.edition(args.digest_id, args.edition_id);
    if (name === 'save_edition') {
      const digest = await this.digest(args.digest_id);
      if (Boolean(args.run_id) !== Boolean(args.claim_token)) throw new DigestError('Scheduled saves require both run_id and claim_token.');
      const run = args.run_id ? await this.scheduledRun(args.run_id, args.claim_token) : null;
      if (run && (run.digest_id !== digest.id || args.request_key !== run.id)) throw new DigestError('Use the claimed digest and run_id as request_key.');
      const editionId = await stableId(args.digest_id, 'edition', args.request_key);
      const prior = await this.stmt('SELECT id FROM editions WHERE id = ? AND digest_id = ?', editionId, args.digest_id).first();
      if (prior) return this.edition(args.digest_id, prior.id);
      const statements = [this.stmt('INSERT INTO editions (id, digest_id, request_key, title, created_at) VALUES (?, ?, ?, ?, ?)',
        editionId, args.digest_id, args.request_key, editionTitle(digest, now, args.title, args.items.length), now)];
      const urls = new Set();
      for (const [position, item] of args.items.entries()) {
        const canonical = canonicalUrl(item.url);
        if (urls.has(canonical)) throw new DigestError('This edition contains duplicate links.');
        urls.add(canonical);
        if (item.date_kind && !item.published_at) throw new DigestError('A date kind requires a verified date.');
        if (item.published_at && item.kind === 'repository' && !['created', 'released', 'updated'].includes(item.date_kind))
          throw new DigestError('Repository dates must identify creation, release or update.');
        if (item.published_at) {
          const date = new Date(item.published_at);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(item.published_at) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.published_at)
            throw new DigestError('Publication dates must be valid YYYY-MM-DD dates, or omitted when unknown.');
        }
        const itemId = await stableId(args.digest_id, canonical);
        const existing = await this.stmt('SELECT id FROM items WHERE digest_id = ? AND canonical_url = ?', args.digest_id, canonical).first();
        if (existing) throw new DigestError('This link was already shown in this digest. Choose a different item.', 409);
        statements.push(this.stmt('INSERT INTO items (id, digest_id, canonical_url, created_at) VALUES (?, ?, ?, ?)', itemId, args.digest_id, canonical, now));
        statements.push(this.stmt(`INSERT INTO entries (edition_id, item_id, position, title, url, summary, kind, published_at, tags, update_note, date_kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, editionId, itemId, position, item.title.trim(), safeUrl(item.url).href,
          item.summary.trim(), item.kind, item.published_at || null, JSON.stringify(item.tags ?? []), item.update_note?.trim() ?? '', item.date_kind ?? ''));
      }
      if (run) statements.push(...this.finishRun(run, digest, args.claim_token, now, editionId));
      try { await this.db.batch(statements); } catch (error) {
        // An identical retry can race with the first commit. Return its result, never append twice.
        const completed = await this.stmt('SELECT id FROM editions WHERE id = ? AND digest_id = ?', editionId, args.digest_id).first();
        if (completed) return this.edition(args.digest_id, completed.id);
        if (/Scheduled run/.test(error.message)) throw new DigestError(error.message, 409);
        if (/UNIQUE constraint/i.test(error.message)) throw new DigestError('Another generation saved one of these links. Refresh the research context and retry with a new selection.', 409);
        throw error;
      }
      return this.edition(args.digest_id, editionId);
    }
    if (name === 'save_feedback') {
      await this.digest(args.digest_id);
      const item = await this.stmt('SELECT id FROM items WHERE id = ? AND digest_id = ?', args.item_id, args.digest_id).first();
      if (!item) throw new DigestError('Item not found.', 404);
      const result = await this.stmt(`INSERT INTO feedback (item_id, vote, revision, updated_at)
        SELECT ?, ?, 1, ? WHERE ? = 0 OR EXISTS(SELECT 1 FROM feedback WHERE item_id = ?)
        ON CONFLICT(item_id) DO UPDATE SET vote = excluded.vote, revision = feedback.revision + 1, updated_at = excluded.updated_at
        WHERE feedback.revision = ? RETURNING *`, args.item_id, args.vote, now,
        args.expected_revision, args.item_id, args.expected_revision).first();
      if (!result) throw new DigestError('Feedback changed on another device. Refresh before voting again.', 409);
      return { feedback: result };
    }
    if (name === 'get_research_context') {
      const digest = await this.digest(args.digest_id);
      const historyOffset = args.history_offset ?? 0, feedbackOffset = args.feedback_offset ?? 0;
      const history = await this.rows(`SELECT i.canonical_url, i.created_at, e.title, e.summary FROM items i
        JOIN entries e ON e.item_id = i.id AND e.edition_id = (
          SELECT en.edition_id FROM entries en JOIN editions ed ON ed.id = en.edition_id
          WHERE en.item_id = i.id ORDER BY ed.created_at DESC, ed.id DESC LIMIT 1)
        WHERE i.digest_id = ? ORDER BY i.created_at, i.id LIMIT 101 OFFSET ?`, args.digest_id, historyOffset);
      const feedback = await this.rows(`SELECT i.id AS item_id, i.canonical_url, f.vote, f.updated_at,
        e.title, e.summary, e.kind, e.tags FROM items i JOIN feedback f ON f.item_id = i.id
        JOIN entries e ON e.item_id = i.id AND e.edition_id = (
          SELECT en.edition_id FROM entries en JOIN editions ed ON ed.id = en.edition_id
          WHERE en.item_id = i.id ORDER BY ed.created_at DESC, ed.id DESC LIMIT 1)
        WHERE i.digest_id = ? AND f.vote != 0 ORDER BY f.updated_at, i.id LIMIT 51 OFFSET ?`, args.digest_id, feedbackOffset);
      return { digest, history: history.slice(0, 100), next_history_offset: history.length > 100 ? historyOffset + 100 : null,
        feedback: feedback.slice(0, 50).map(row => ({ ...row, tags: JSON.parse(row.tags) })),
        next_feedback_offset: feedback.length > 50 ? feedbackOffset + 50 : null,
        guidance: RESEARCH_GUIDELINES };
    }
    if (name === 'settings_read') {
      const digests = await this.listDigests();
      const prefs = await this.stmt('SELECT default_digest_id FROM preferences WHERE owner_id = ?', this.owner).first();
      return { schema: { type: 'object', properties: { default_digest_id: { type: 'string', title: 'Default digest',
        description: 'Open this digest by default. Manage prompts and preferred sources inside the Digests panel.',
        oneOf: [{ const: '', title: 'Most recently created' }, ...digests.map(d => ({ const: d.id, title: d.name }))] } } },
        values: { default_digest_id: prefs?.default_digest_id ?? '' },
        layout: [{ kind: 'group', title: 'Digests', items: [{ kind: 'property', property: 'default_digest_id' }] }] };
    }
    if (name === 'settings_update') {
      if ('default_digest_id' in args.set) {
        if (args.set.default_digest_id) await this.digest(args.set.default_digest_id);
        await this.stmt(`INSERT INTO preferences (owner_id, default_digest_id) VALUES (?, ?)
          ON CONFLICT(owner_id) DO UPDATE SET default_digest_id = excluded.default_digest_id`, this.owner, args.set.default_digest_id || null).run();
      }
      return { values: (await this.call('settings_read')).values };
    }
    throw new DigestError('Unknown tool.', 404);
  }
}
