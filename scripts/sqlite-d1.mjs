import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Local development and integration tests only. Hosted deployments use Sites D1.
export function localDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename); sqlite.exec('PRAGMA foreign_keys = ON');
  const schema = readFileSync(new URL('../templates/backend/drizzle/0000_digest.sql', import.meta.url), 'utf8');
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='digests'").get()) sqlite.exec(schema);
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
