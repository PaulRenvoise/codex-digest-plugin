import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Local development and integration tests only. Hosted deployments use Sites D1.
export function localDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename); sqlite.exec('PRAGMA foreign_keys = ON');
  const legacy = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='digests'").get();
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (tag TEXT PRIMARY KEY)');
  if (legacy) sqlite.prepare('INSERT OR IGNORE INTO _local_migrations (tag) VALUES (?)').run('0000_digest');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const { tag } of journal.entries) {
    if (sqlite.prepare('SELECT tag FROM _local_migrations WHERE tag = ?').get(tag)) continue;
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
      sqlite.prepare('INSERT INTO _local_migrations (tag) VALUES (?)').run(tag); sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); sqlite.close(); throw error; }
  }
  function wrap(sql, args = []) {
    return { sql, args, bind(...values) { return wrap(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; } };
  }
  return { prepare: sql => wrap(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => ({ success: true, meta: sqlite.prepare(s.sql).run(...s.args) })); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }, close() { sqlite.close(); } };
}
