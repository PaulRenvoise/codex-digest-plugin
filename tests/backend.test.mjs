import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localDatabase } from '../scripts/sqlite-d1.mjs';
import { DigestService } from '../templates/backend/src/service.mjs';
import { canonicalUrl, normalizeDomains, TOOLS, UI_URI } from '../templates/backend/src/contract.mjs';
import { createWorker } from '../templates/backend/src/worker.mjs';
import { Script } from 'node:vm';

async function fixture(t) {
  const db = localDatabase(); t.after(() => db.close());
  const service = new DigestService(db, 'alice'), other = new DigestService(db, 'bob');
  const { digest } = await service.call('create_digest', { name: 'Game Dev', prompt: 'Find useful technical breakdowns.', domains: ['https://www.unity.com/blog', '80.lv'], request_key: 'create-1' });
  const makeEdition = (key = 'edition-1', items = [{ title: 'Rendering notes', url: 'https://example.org/rendering?utm_source=chat', summary: 'A rendering breakdown.', kind: 'article', tags: ['rendering'] }]) => service.call('save_edition', { digest_id: digest.id, request_key: key, title: 'First selection', items });
  return { db, service, other, digest, makeEdition };
}
test('normalizes domains and tracking without stripping meaningful URL parameters', () => {
  assert.deepEqual(normalizeDomains(['www.unity.com', 'https://unity.com/blog', '80.lv']), ['unity.com', '80.lv']);
  assert.equal(canonicalUrl('https://EXAMPLE.org/path/?b=2&utm_source=x&a=1#part'), 'https://example.org/path?a=1&b=2');
  assert.throws(() => canonicalUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizeDomains(['https://user:password@example.org']), /credentials/);
});
test('digest creation retries do not duplicate or overwrite configuration', async t => {
  const { service, digest } = await fixture(t);
  const retried = await service.call('create_digest', { name: 'Different', prompt: 'Different', domains: [], request_key: 'create-1' });
  assert.equal(retried.digest.id, digest.id); assert.equal(retried.digest.name, 'Game Dev');
  assert.equal((await service.call('list_digests')).digests.length, 1);
});
test('all item and configuration access is isolated by authenticated owner', async t => {
  const { service, other, digest, makeEdition } = await fixture(t);
  const data = await makeEdition();
  assert.deepEqual((await other.call('list_digests')).digests, []);
  for (const [name, args] of [
    ['get_digest', { digest_id: digest.id }], ['get_edition', { digest_id: digest.id, edition_id: data.edition.id }],
    ['get_research_context', { digest_id: digest.id }],
    ['settings_update', { set: { default_digest_id: digest.id } }],
    ['save_feedback', { digest_id: digest.id, item_id: data.items[0].item_id, vote: 1, expected_revision: 0 }]
  ]) await assert.rejects(() => other.call(name, args), /not found/);
  assert.equal((await service.call('get_digest', { digest_id: digest.id })).digest.name, 'Game Dev');
});
test('stale digest edits cannot overwrite another device', async t => {
  const { service, digest } = await fixture(t);
  const args = { digest_id: digest.id, expected_revision: 1, name: 'New name', prompt: 'Keep the prompt.', domains: [] };
  const updated = await service.call('update_digest', args); assert.equal(updated.digest.revision, 2);
  await assert.rejects(() => service.call('update_digest', { ...args, name: 'Stale name' }), /another device/);
});
test('edition retry is idempotent; tracked URL duplicates require meaningful update', async t => {
  const { service, digest, makeEdition } = await fixture(t);
  const first = await makeEdition(), retry = await makeEdition();
  assert.equal(first.edition.id, retry.edition.id);
  assert.equal((await service.call('list_editions', { digest_id: digest.id })).editions.length, 1);
  await assert.rejects(() => makeEdition('second'), /already shown/);
  const updated = await makeEdition('third', [{ title: 'Updated', url: 'https://example.org/rendering', summary: 'A new measured technique.', kind: 'article', update_note: 'New benchmark section.' }]);
  assert.equal(updated.items[0].item_id, first.items[0].item_id);
  assert.equal((await service.call('get_edition', { digest_id: digest.id, edition_id: first.edition.id })).items[0].title, 'Rendering notes');
});
test('invalid editions leave no partial records', async t => {
  const { service, digest, makeEdition } = await fixture(t);
  const item = { title: 'One', url: 'https://example.org/a', summary: 'One', kind: 'article' };
  await assert.rejects(() => makeEdition('bad', [item, { ...item, url: item.url + '?utm_source=duplicate' }]), /duplicate/);
  assert.equal((await service.call('list_editions', { digest_id: digest.id })).editions.length, 0);
  const context = await service.call('get_research_context', { digest_id: digest.id }); assert.deepEqual(context.history, []);
});
test('database batches roll back on a late write failure', async t => {
  const { db, service, digest } = await fixture(t);
  await assert.rejects(() => db.batch([
    db.prepare('INSERT INTO editions (id, digest_id, request_key, title, created_at) VALUES (?, ?, ?, ?, ?)').bind('test-edition', digest.id, 'key', 'Test', 'now'),
    db.prepare('INSERT INTO entries (edition_id, item_id, position, title, url, summary, kind) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('test-edition', 'missing-item', 0, 'Test', 'https://example.org', 'Test', 'article')
  ]));
  assert.equal((await service.call('list_editions', { digest_id: digest.id })).editions.length, 0);
});
test('votes persist, can be cleared and conflict safely across devices', async t => {
  const { db, service, digest, makeEdition } = await fixture(t), data = await makeEdition();
  const args = { digest_id: digest.id, item_id: data.items[0].item_id, vote: 1, expected_revision: 0 };
  await service.call('save_feedback', args);
  assert.equal((await service.call('get_research_context', { digest_id: digest.id })).feedback[0].vote, 1);
  await assert.rejects(() => service.call('save_feedback', { ...args, vote: -1 }), /another device/);
  const otherDevice = new DigestService(db, 'alice');
  await otherDevice.call('save_feedback', { ...args, expected_revision: 1, vote: -1 });
  assert.equal((await service.call('get_research_context', { digest_id: digest.id })).feedback[0].vote, -1);
  await service.call('save_feedback', { ...args, expected_revision: 2, vote: 0 });
  assert.equal((await service.call('get_research_context', { digest_id: digest.id })).feedback.length, 0);
});
test('same URL in another digest has independent feedback', async t => {
  const { service, digest, makeEdition } = await fixture(t), first = await makeEdition();
  const second = (await service.call('create_digest', { name: 'Art', prompt: 'Find art.', domains: [], request_key: 'art' })).digest;
  const artEdition = await service.call('save_edition', { digest_id: second.id, request_key: 'art-edition', title: 'Art', items: [{ title: 'Same link', url: first.items[0].url, summary: 'Art perspective.', kind: 'article' }] });
  await service.call('save_feedback', { digest_id: digest.id, item_id: first.items[0].item_id, expected_revision: 0, vote: 1 });
  assert.notEqual(first.items[0].item_id, artEdition.items[0].item_id);
  assert.equal((await service.call('get_research_context', { digest_id: second.id })).feedback.length, 0);
});
test('history pagination exposes every previously seen link', async t => {
  const { service, digest, makeEdition } = await fixture(t);
  for (let batch = 0; batch < 4; batch++) await makeEdition(`batch-${batch}`, Array.from({ length: 30 }, (_, n) => ({ title: `${batch}-${n}`, url: `https://example.org/${batch}/${n}`, summary: 'Summary', kind: 'article' })));
  const first = await service.call('get_research_context', { digest_id: digest.id });
  const second = await service.call('get_research_context', { digest_id: digest.id, history_offset: first.next_history_offset });
  assert.equal(first.history.length, 100); assert.equal(second.history.length, 20); assert.equal(second.next_history_offset, null);
  assert.equal(new Set([...first.history, ...second.history].map(i => i.canonical_url)).size, 120);
});
test('native default settings do not leak or alter another user’s preferences', async t => {
  const { service, other, digest } = await fixture(t);
  await service.call('settings_update', { set: { default_digest_id: digest.id } });
  assert.equal((await service.call('open_digest')).selected_digest_id, digest.id);
  assert.equal((await other.call('settings_read')).values.default_digest_id, '');
  await service.call('settings_update', { set: { default_digest_id: '' } });
  assert.equal((await service.call('settings_read')).values.default_digest_id, '');
});
test('HTTP authentication, CSRF rejection and MCP resource/tool discovery', async t => {
  const { db } = await fixture(t);
  const html = await readFile(new URL('../templates/backend/ui/index.html', import.meta.url), 'utf8');
  new Script(html.split('<script>')[1].split('</script>')[0]);
  const worker = createWorker(html);
  const send = (body, headers = {}, route = '/mcp') => worker.fetch(new Request('https://digest.example' + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), { DB: db });
  const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal((await send(rpc('tools/list'))).status, 401);
  const auth = { 'oai-authenticated-user-id': 'alice' };
  assert.equal((await send(rpc('tools/list'), { ...auth, origin: 'https://evil.example' })).status, 403);
  const discovered = await (await send(rpc('server/discover'), auth)).json();
  assert.ok(discovered.result.capabilities['openai/settings']);
  for (const [method, params] of [
    ['server/discover'], ['tools/list'], ['resources/list'], ['resources/templates/list'],
    ['resources/read', { uri: UI_URI }], ['resources/read', { uri: 'ui://digest/library.html' }]
  ]) {
    const result = (await (await send(rpc(method, params), auth)).json()).result;
    assert.equal(result.ttlMs, 0, `${method} must declare cache freshness for modern hosts`);
    assert.equal(result.cacheScope, 'private');
    if (method === 'resources/read') assert.equal(result.contents[0].uri, params.uri);
  }
  const tools = (await (await send(rpc('tools/list'), auth)).json()).result.tools;
  assert.deepEqual(tools.find(t => t.name === 'save_feedback')._meta.ui.visibility, ['app']);
  assert.deepEqual(tools.find(t => t.name === 'open_digest')._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
  const resource = (await (await send(rpc('resources/read', { uri: UI_URI }), auth)).json()).result.contents[0];
  assert.equal(resource.text, html); assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta['openai/ui'].availableDisplayModes, ['fullscreen']);
  const opened = (await (await send(rpc('tools/call', { name: 'open_digest' }), auth)).json()).result;
  assert.equal(opened._meta.ui.resourceUri, resource.uri);
  assert.equal(opened._meta['openai/outputTemplate'], resource.uri);
  assert.equal(opened.structuredContent.digests.length, 1);
  const listed = (await (await send(rpc('tools/call', { name: 'list_digests' }), auth)).json()).result;
  assert.equal(listed._meta, undefined, 'Refreshing data must not launch another panel.');
  for (const name of ['list_digests', 'settings_read', 'list_editions', 'get_edition', 'create_digest', 'update_digest']) {
    assert.equal(tools.find(t => t.name === name)._meta['openai/widgetAccessible'], true);
  }
  const unknown = await (await send(rpc('tools/call', { name: 'unknown' }), auth)).json(); assert.equal(unknown.result.isError, true);
  const valid = await (await send({ name: 'list_digests' }, auth, '/api/call')).json(); assert.equal(valid.digests.length, 1);
});
test('tool arguments reject unknown fields and unsafe data', async t => {
  const { service, digest, makeEdition } = await fixture(t);
  await assert.rejects(() => service.call('get_digest', { digest_id: digest.id, owner_id: 'bob' }), /Unknown field/);
  await assert.rejects(() => makeEdition('bad-url', [{ title: 'Bad', url: 'data:text/html,evil', summary: 'Bad', kind: 'article' }]), /HTTP/);
  await assert.rejects(() => makeEdition('bad-date', [{ title: 'Bad', url: 'https://example.org', summary: 'Bad', kind: 'article', published_at: '2026-02-31' }]), /dates/);
  await assert.rejects(() => makeEdition('invalid-month', [{ title: 'Bad', url: 'https://example.org', summary: 'Bad', kind: 'article', published_at: '2026-99-31' }]), /dates/);
});
