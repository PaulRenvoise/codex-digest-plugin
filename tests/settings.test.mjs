import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDatabase } from '../scripts/sqlite-d1.mjs';
import { DigestService } from '../templates/backend/src/service.mjs';
import { normalizeSchedule } from '../templates/backend/src/contract.mjs';

const fields = { name: 'Game Dev', prompt: 'Find practical breakdowns.', domains: ['unity.com'] };
test('count and all schedule modes persist and remain visible to research', async t => {
  const db = localDatabase(); t.after(() => db.close()); const service = new DigestService(db, 'alice');
  let { digest } = await service.call('create_digest', { ...fields, request_key: 'new' });
  assert.equal(digest.items_per_edition, 12); assert.deepEqual(digest.schedule, { frequency: 'daily', hour: 9, utc_offset_minutes: 0 });
  for (const schedule of [
    { frequency: 'daily', hour: 0, utc_offset_minutes: 840 },
    { frequency: 'weekly', hour: 23, utc_offset_minutes: -720, weekday: 0 },
    { frequency: 'monthly', hour: 9, utc_offset_minutes: 60, month_day: 31 }
  ]) {
    ({ digest } = await service.call('update_digest', { ...fields, digest_id: digest.id, expected_revision: digest.revision, items_per_edition: 7, schedule }));
    const reopened = (await new DigestService(db, 'alice').call('get_research_context', { digest_id: digest.id })).digest;
    assert.deepEqual(reopened.schedule, schedule); assert.equal(reopened.items_per_edition, 7);
    assert.deepEqual((await service.call('list_digests')).digests[0].schedule, schedule);
  }
});
test('older clients preserve new settings, retries do not change them, and stale edits fail', async t => {
  const db = localDatabase(); t.after(() => db.close()); const service = new DigestService(db, 'alice');
  const schedule = { frequency: 'weekly', hour: 8, utc_offset_minutes: 120, weekday: 1 };
  const { digest } = await service.call('create_digest', { ...fields, request_key: 'new', items_per_edition: 5, schedule });
  const retry = await service.call('create_digest', { ...fields, request_key: 'new', items_per_edition: 30 });
  assert.deepEqual(retry.digest, digest);
  const updated = await service.call('update_digest', { ...fields, name: 'Renamed', digest_id: digest.id, expected_revision: digest.revision });
  assert.deepEqual(updated.digest.schedule, schedule); assert.equal(updated.digest.items_per_edition, 5);
  await assert.rejects(() => service.call('update_digest', { ...fields, digest_id: digest.id, expected_revision: 1, items_per_edition: 20, schedule: { frequency: 'daily', hour: 9, utc_offset_minutes: 0 } }), /another device/);
  await assert.rejects(() => new DigestService(db, 'bob').call('update_digest', { ...fields, digest_id: digest.id, expected_revision: 2, items_per_edition: 20, schedule }), /not found/);
});
test('invalid counts and incomplete or out-of-range schedules are rejected without writes', async t => {
  const db = localDatabase(); t.after(() => db.close()); const service = new DigestService(db, 'alice');
  for (const items_per_edition of [0, 31, 1.5]) {
    await assert.rejects(() => service.call('create_digest', { ...fields, request_key: 'invalid', items_per_edition }), /integer/);
  }
  for (const schedule of [
    { frequency: 'manual', hour: 9, utc_offset_minutes: 0 }, { frequency: 'yearly' }, { frequency: 'daily' },
    { frequency: 'daily', hour: 24, utc_offset_minutes: 0 },
    { frequency: 'daily', hour: 8, utc_offset_minutes: 900 },
    { frequency: 'daily', hour: 8, utc_offset_minutes: 30 },
    { frequency: 'weekly', hour: 8, utc_offset_minutes: 0 },
    { frequency: 'weekly', hour: 8, utc_offset_minutes: 0, weekday: 7 },
    { frequency: 'monthly', hour: 8, utc_offset_minutes: 0, month_day: 0 },
    { frequency: 'monthly', hour: 8, utc_offset_minutes: 0, month_day: 32 }
  ]) await assert.rejects(() => service.call('create_digest', { ...fields, request_key: 'invalid', schedule }));
  assert.equal((await service.call('list_digests')).digests.length, 0);
  assert.deepEqual(normalizeSchedule({ frequency: 'daily', hour: 9, utc_offset_minutes: 0, weekday: 1, month_day: 31 }), { frequency: 'daily', hour: 9, utc_offset_minutes: 0 });
});
test('migration upgrades legacy databases without losing digests and is safe to reopen', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'digest-settings-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'legacy.sqlite'), old = new DatabaseSync(filename);
  old.exec(await readFile(new URL('../templates/backend/drizzle/0000_digest.sql', import.meta.url), 'utf8'));
  old.prepare('INSERT INTO digests (id,owner_id,name,prompt,domains,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy', 'alice', 'Existing', 'Keep this prompt.', '[]', 'today', 'today');
  old.close();
  for (let pass = 0; pass < 2; pass++) {
    const db = localDatabase(filename);
    try {
      const { digest } = await new DigestService(db, 'alice').call('get_digest', { digest_id: 'legacy' });
      assert.equal(digest.prompt, 'Keep this prompt.'); assert.equal(digest.items_per_edition, 12);
      assert.deepEqual(digest.schedule, { frequency: 'daily', hour: 9, utc_offset_minutes: 0 });
    } finally { db.close(); }
  }
});

test('schedule migration replaces retired defaults and preserves recurring settings and data', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'digest-recurring-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'prior.sqlite'), old = new DatabaseSync(filename);
  for (const tag of ['0000_digest', '0001_digest_settings']) old.exec(await readFile(new URL(`../templates/backend/drizzle/${tag}.sql`, import.meta.url), 'utf8'));
  old.exec("CREATE TABLE _local_migrations (tag TEXT PRIMARY KEY); INSERT INTO _local_migrations VALUES ('0000_digest'), ('0001_digest_settings')");
  old.prepare('INSERT INTO digests (id,owner_id,name,prompt,domains,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('retired', 'alice', 'Existing', 'Keep this prompt.', '[]', 'today', 'today');
  const weekly = { frequency: 'weekly', hour: 16, utc_offset_minutes: 120, weekday: 2 };
  old.prepare('INSERT INTO digests (id,owner_id,name,prompt,domains,schedule,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('weekly', 'alice', 'Weekly', 'Keep weekly.', '[]', JSON.stringify(weekly), 'today', 'today');
  old.close();
  const db = localDatabase(filename); t.after(() => db.close());
  const service = new DigestService(db, 'alice');
  const retired = (await service.call('get_digest', { digest_id: 'retired' })).digest;
  assert.deepEqual(retired.schedule, { frequency: 'daily', hour: 9, utc_offset_minutes: 0 });
  assert.equal(retired.revision, 2);
  const preserved = (await service.call('get_digest', { digest_id: 'weekly' })).digest;
  assert.deepEqual(preserved.schedule, weekly); assert.equal(preserved.revision, 1);
  await db.prepare('INSERT INTO digests (id,owner_id,name,prompt,domains,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('default', 'alice', 'Default', 'Default.', '[]', 'today', 'today').run();
  assert.deepEqual((await service.call('get_digest', { digest_id: 'default' })).digest.schedule, retired.schedule);
  await assert.rejects(() => service.call('update_digest', { ...fields, digest_id: 'weekly', expected_revision: 1, schedule: { frequency: 'manual', hour: 9, utc_offset_minutes: 0 } }));
  assert.deepEqual((await service.call('get_digest', { digest_id: 'weekly' })).digest.schedule, weekly);
});
