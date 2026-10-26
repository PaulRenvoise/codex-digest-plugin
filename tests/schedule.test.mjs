import test from 'node:test';
import assert from 'node:assert/strict';
import { localDatabase } from '../scripts/sqlite-d1.mjs';
import { DigestService } from '../src/service.mjs';
import { nextOccurrence } from '../src/schedule.mjs';

const fields = { name: 'Game Dev', prompt: 'Rendering techniques', domains: [] };
const daily = { frequency: 'daily', hour: 10, utc_offset_minutes: 120 };
function setup(t) {
  const db = localDatabase(); t.after(() => db.close());
  let time = '2026-10-26T07:00:00.000Z';
  const service = new DigestService(db, 'alice', () => new Date(time));
  return { db, service, at(value) { time = value; },
    async create() { return (await service.call('create_digest', { ...fields, schedule: daily, request_key: 'one' })).digest; } };
}
const selection = run => ({ digest_id: run.digest_id, request_key: run.id, run_id: run.id, claim_token: run.claim_token,
  title: 'Edition', items: [{ title: 'Technique', url: 'https://example.com/technique', summary: 'A rendering technique.', kind: 'article' }] });

test('fixed offsets, strict boundaries, weekly dates and short months', () => {
  assert.equal(nextOccurrence(daily, '2026-10-26T07:59:59Z'), '2026-10-26T08:00:00.000Z');
  assert.equal(nextOccurrence(daily, '2026-10-26T08:00:00Z'), '2026-10-27T08:00:00.000Z');
  assert.equal(nextOccurrence({ ...daily, frequency: 'weekly', weekday: 5 }, '2026-10-26T12:00:00Z'), '2026-10-30T08:00:00.000Z');
  const monthly = { ...daily, frequency: 'monthly', month_day: 31 };
  assert.equal(nextOccurrence(monthly, '2028-02-01T00:00:00Z'), '2028-02-29T08:00:00.000Z');
  assert.equal(nextOccurrence(monthly, '2027-02-28T08:00:00Z'), '2027-03-31T08:00:00.000Z');
  assert.equal(nextOccurrence({ ...daily, hour: 0, utc_offset_minutes: 840 }, '2026-12-31T10:00:00Z'), '2027-01-01T10:00:00.000Z');
  assert.equal(nextOccurrence({ ...daily, hour: 23, utc_offset_minutes: -720 }, '2026-12-31T10:00:00Z'), '2026-12-31T11:00:00.000Z');
});

test('due times follow saved settings; unrelated edits preserve them', async t => {
  const f = setup(t), digest = await f.create();
  assert.equal(digest.next_run_at, '2026-10-26T08:00:00.000Z');
  assert.equal((await f.service.call('list_due_digests')).digests.length, 0);
  f.at('2026-10-26T08:00:00.000Z');
  assert.equal((await f.service.call('list_due_digests')).digests.length, 1);
  const edited = (await f.service.call('update_digest', { ...fields, digest_id: digest.id, expected_revision: 1, items_per_edition: 5 })).digest;
  assert.equal(edited.next_run_at, digest.next_run_at);
  const changed = (await f.service.call('update_digest', { ...fields, digest_id: digest.id, expected_revision: 2,
    schedule: { ...daily, frequency: 'weekly', weekday: 5 } })).digest;
  assert.equal(changed.next_run_at, '2026-10-30T08:00:00.000Z');
  assert.equal((await f.service.call('list_due_digests')).digests.length, 0);
  assert.equal((await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'early' })).run, null);
});

test('claim exclusivity, owner isolation, atomic save and retry idempotency', async t => {
  const f = setup(t), digest = await f.create(); f.at('2026-10-26T08:00:00.000Z');
  const [a, b] = await Promise.all(['a', 'b'].map(request_key => f.service.call('claim_digest_run', { digest_id: digest.id, request_key })));
  assert.equal([a, b].filter(result => result.run).length, 1);
  const run = a.run ?? b.run;
  const bob = new DigestService(f.db, 'bob');
  assert.deepEqual((await bob.call('list_due_digests')).digests, []);
  await assert.rejects(() => bob.call('renew_digest_run', { run_id: run.id, claim_token: run.claim_token }), /not found/);
  await assert.rejects(() => bob.call('save_edition', selection(run)), /not found/);
  const saved = await f.service.call('save_edition', selection(run));
  const retry = await f.service.call('save_edition', selection(run));
  assert.equal(retry.edition.id, saved.edition.id);
  assert.equal((await f.service.call('list_editions', { digest_id: digest.id })).editions.length, 1);
  const after = (await f.service.call('get_digest', { digest_id: digest.id })).digest;
  assert.equal(after.next_run_at, '2026-10-27T08:00:00.000Z');
  assert.equal(after.revision, digest.revision);
  assert.equal((await f.db.prepare('SELECT status FROM digest_runs WHERE id = ?').bind(run.id).first()).status, 'completed');
});

test('expired leases retry the same occurrence and fence out the old worker', async t => {
  const f = setup(t), digest = await f.create(); f.at('2026-10-26T08:00:00.000Z');
  const old = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'old' })).run;
  f.at('2026-10-26T09:00:00.000Z');
  await assert.rejects(() => f.service.call('save_edition', selection(old)), /expired/);
  assert.equal((await f.service.call('list_editions', { digest_id: digest.id })).editions.length, 0);
  const fresh = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'fresh' })).run;
  assert.equal(fresh.id, old.id); assert.notEqual(fresh.claim_token, old.claim_token);
  await assert.rejects(() => f.service.call('save_edition', selection(old)), /claimed by another/);
  await f.service.call('save_edition', selection(fresh));
});

test('lease renewal and no-result completion advance without an empty edition or backlog', async t => {
  const f = setup(t), digest = await f.create(); f.at('2026-10-29T08:00:00.000Z');
  const run = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'delayed' })).run;
  f.at('2026-10-29T08:40:00.000Z');
  const args = { run_id: run.id, claim_token: run.claim_token };
  assert.equal((await f.service.call('renew_digest_run', args)).run.lease_until, '2026-10-29T09:40:00.000Z');
  assert.equal((await f.service.call('skip_digest_run', args)).run.status, 'skipped');
  assert.equal((await f.service.call('skip_digest_run', args)).run.status, 'skipped');
  assert.equal((await f.service.call('get_digest', { digest_id: digest.id })).digest.next_run_at, '2026-10-30T08:00:00.000Z');
  assert.equal((await f.service.call('list_editions', { digest_id: digest.id })).editions.length, 0);
});

test('settings edits invalidate in-flight work, including a race at commit', async t => {
  const f = setup(t), digest = await f.create(); f.at('2026-10-26T08:00:00.000Z');
  const run = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'old' })).run;
  const originalBatch = f.db.batch;
  f.db.batch = async statements => {
    f.db.batch = originalBatch;
    await f.service.call('update_digest', { ...fields, prompt: 'Changed topic', digest_id: digest.id, expected_revision: 1 });
    return originalBatch(statements);
  };
  await assert.rejects(() => f.service.call('save_edition', selection(run)), /settings changed/);
  assert.equal((await f.service.call('list_editions', { digest_id: digest.id })).editions.length, 0);
  const next = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'new' })).run;
  assert.equal(next.digest_revision, 2);
  await f.service.call('save_edition', selection(next));
});

test('failed edition validation leaves the run retryable and its due time unchanged', async t => {
  const f = setup(t), digest = await f.create(); f.at('2026-10-26T08:00:00.000Z');
  const run = (await f.service.call('claim_digest_run', { digest_id: digest.id, request_key: 'a' })).run;
  const payload = selection(run); payload.items.push(payload.items[0]);
  await assert.rejects(() => f.service.call('save_edition', payload), /duplicate/);
  assert.equal((await f.service.call('get_digest', { digest_id: digest.id })).digest.next_run_at, digest.next_run_at);
  assert.equal((await f.service.call('renew_digest_run', { run_id: run.id, claim_token: run.claim_token })).run.status, 'running');
});

test('existing digests initialize at the next occurrence without replaying history', async t => {
  const f = setup(t), digest = await f.create();
  await f.db.prepare('UPDATE digests SET next_run_at = NULL WHERE id = ?').bind(digest.id).run();
  f.at('2026-11-01T12:00:00.000Z');
  assert.equal((await f.service.call('list_due_digests')).digests.length, 0);
  assert.equal((await f.service.call('get_digest', { digest_id: digest.id })).digest.next_run_at, '2026-11-02T08:00:00.000Z');
});
