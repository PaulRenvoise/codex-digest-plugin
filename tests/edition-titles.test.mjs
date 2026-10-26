import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localDatabase } from '../scripts/sqlite-d1.mjs';
import { DigestService, editionTitle } from '../src/service.mjs';

const fields = { name: 'Game Dev Digest', prompt: 'Rendering', domains: [],
  schedule: { frequency: 'daily', hour: 10, utc_offset_minutes: 120 } };
const items = [{ title: 'Original article title', url: 'https://example.org/rendering', summary: 'A useful technique.', kind: 'article' }];

test('edition titles combine the local creation date, generated headline and actual item count', async t => {
  const db = localDatabase(); t.after(() => db.close());
  let now = '2026-12-31T23:30:00.000Z';
  const service = new DigestService(db, 'alice', () => new Date(now));
  const { digest } = await service.call('create_digest', { ...fields, request_key: 'new' });
  assert.throws(() => editionTitle(digest, now, '2026-01-01 -  - 5 items', 1), /headline/);
  const args = { digest_id: digest.id, request_key: 'first', items, title: 'Rendering trade-offs' };
  const first = await service.call('save_edition', args);
  assert.equal(first.edition.title, '2027-01-01 - Rendering trade-offs - 1 items');
  assert.equal(first.items[0].title, items[0].title);
  now = '2027-01-02T12:00:00.000Z';
  await service.call('update_digest', { ...fields, name: 'Rendering', digest_id: digest.id, expected_revision: 1 });
  assert.deepEqual((await service.call('save_edition', args)).edition, first.edition, 'retries retain the stored name and date');
  const second = await service.call('save_edition', { digest_id: digest.id, request_key: 'second', title: '2020-01-01 - Better shaders - 99 items', items: [{ ...items[0], url: 'https://example.org/another' }] });
  assert.equal(second.edition.title, '2027-01-02 - Better shaders - 1 items', 'date/count wrappers are rebuilt from actual saved data');
  assert.equal(editionTitle({ ...fields, schedule: { ...fields.schedule, utc_offset_minutes: -720 } }, '2027-01-01T03:00:00Z', 'Rendering trade-offs', 5), '2026-12-31 - Rendering trade-offs - 5 items');
});

test('migration replaces a generic digest title with article topics and actual count', async t => {
  const db = localDatabase(); t.after(() => db.close());
  const service = new DigestService(db, 'alice', () => new Date('2026-10-26T20:00:00Z'));
  const { digest } = await service.call('create_digest', { ...fields, request_key: 'new' });
  const saved = await service.call('save_edition', { digest_id: digest.id, request_key: 'first', title: 'Rendering',
    items: [...items, { ...items[0], title: 'Growing trees', url: 'https://example.org/trees' }] });
  await db.prepare('UPDATE editions SET title = ? WHERE id = ?').bind('Game Dev Digest — 26 October 2026', saved.edition.id).run();
  await db.prepare(await readFile(new URL('../drizzle/0005_edition_titles.sql', import.meta.url), 'utf8')).run();
  const result = await service.call('get_edition', { digest_id: digest.id, edition_id: saved.edition.id });
  assert.equal(result.edition.title, '2026-10-26 - Original article title and Growing trees - 2 items');
  assert.deepEqual(result.items, saved.items);
});

test('title migration rewrites old editions without changing identity, articles or votes', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'digest-titles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'legacy.sqlite');
  let db = localDatabase(filename);
  const service = new DigestService(db, 'alice', () => new Date('2026-12-31T23:30:00.000Z'));
  const { digest } = await service.call('create_digest', { ...fields, request_key: 'new' });
  const saved = await service.call('save_edition', { digest_id: digest.id, request_key: 'first', title: 'Rendering trade-offs', items });
  await service.call('save_feedback', { digest_id: digest.id, item_id: saved.items[0].item_id, expected_revision: 0, vote: 1 });
  const before = await service.call('get_edition', { digest_id: digest.id, edition_id: saved.edition.id });
  await db.prepare('UPDATE editions SET title = ? WHERE id = ?').bind('31 December 2026 — Rendering trade-offs', saved.edition.id).run();
  await db.prepare('DELETE FROM _local_migrations WHERE tag = ?').bind('0005_edition_titles').run();
  db.close();
  for (let pass = 0; pass < 2; pass++) {
    db = localDatabase(filename);
    try {
      const after = await new DigestService(db, 'alice').call('get_edition', { digest_id: digest.id, edition_id: saved.edition.id });
      assert.deepEqual(after, before);
      assert.equal(after.edition.title, '2027-01-01 - Rendering trade-offs - 1 items');
    } finally { db.close(); }
  }
});
