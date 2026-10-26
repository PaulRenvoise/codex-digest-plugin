import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Exercise the real embedded script against a host that delivers both RPC replies
// and tool lifecycle notifications, without a browser or network dependency.
test('panel refreshes through data tools and honors host selection without reopening itself', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), calls = [];
  const element = () => ({
    value: '', hidden: false, dataset: {}, style: { setProperty(name, value) { this[name] = value; } }, children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }
  });
  const digests = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
  let parent;
  const emit = message => listeners.get('message')({ source: parent, data: { jsonrpc: '2.0', ...message } });
  parent = { postMessage(message) {
    if (!message.id) return;
    queueMicrotask(() => {
      if (message.method === 'ui/initialize') return emit({ id: message.id, result: { hostContext: { theme: 'dark', safeAreaInsets: { top: 64, right: 0, bottom: 34, left: 0 } } } });
      assert.equal(message.method, 'tools/call');
      const { name, arguments: args } = message.params; calls.push({ name, args });
      const data = name === 'list_digests' ? { digests }
        : name === 'settings_read' ? { values: { default_digest_id: 'first' } }
        : name === 'list_editions' ? { editions: [], next_offset: null }
        : assert.fail(`Unexpected panel call: ${name}`);
      emit({ id: message.id, result: { structuredContent: data } });
      emit({ method: 'ui/notifications/tool-result', params: { structuredContent: data } });
    });
  } };
  const document = {
    documentElement: element(), hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, addEventListener() {}
  };
  const window = { parent, addEventListener(name, callback) { listeners.set(name, callback); } };
  runInNewContext(html.split('<script>')[1].split('</script>')[0], { window, document, setTimeout, clearTimeout, URL });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('digest-select').value, 'first');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  const style = document.documentElement.style;
  assert.equal(style['--safe-top'], '64px');
  assert.equal(style['--safe-bottom'], '34px');
  emit({ method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(style['--safe-top'], '64px', 'unrelated context updates preserve the safe area');
  emit({ method: 'ui/notifications/host-context-changed', params: { safeAreaInsets: { top: 0, right: 44, bottom: 21, left: 44 } } });
  assert.equal(style['--safe-top'], '0px', 'returning to zero clears the previous header inset');
  assert.equal(style['--safe-right'], '44px');
  assert.equal(style['--safe-left'], '44px');
  assert.equal(style['--safe-bottom'], '21px');
  emit({ method: 'ui/notifications/host-context-changed', params: { safeAreaInsets: { top: -1, right: 'bad' } } });
  assert.equal(style['--safe-top'], '0px');
  assert.equal(style['--safe-right'], '44px');
  emit({ method: 'ui/notifications/tool-result', params: { structuredContent: { digests, selected_digest_id: 'second' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('digest-select').value, 'second');
  assert.equal(calls.at(-1).args.digest_id, 'second');
  await elements.get('refresh').onclick();
  assert.equal(elements.get('digest-select').value, 'second');
  assert.equal(calls.filter(c => c.name === 'list_digests').length, 2);
  assert.equal(calls.filter(c => c.name === 'list_editions').length, 3);
  assert.equal(calls.some(c => c.name === 'open_digest'), false);
});

test('creation and settings saves call the backend without sending conversation messages', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), messages = [], writes = [], digests = [];
  const element = () => ({
    value: '', dataset: {}, style: { setProperty() {} }, classList: { toggle() {} },
    append() {}, replaceChildren() {}, setAttribute() {},
    showModal() { this.open = true; }, close() { this.open = false; }
  });
  const document = {
    documentElement: element(), addEventListener() {}, createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
  };
  let rejectWrite = false;
  const parent = { postMessage(message) {
    messages.push(message);
    if (!message.id) return;
    queueMicrotask(() => {
      let result = {};
      if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        let data;
        if (name === 'list_digests') data = { digests };
        else if (name === 'settings_read') data = { values: {} };
        else if (name === 'list_editions') data = { editions: [], next_offset: null };
        else if (['create_digest', 'update_digest'].includes(name)) {
          writes.push({ name, args });
          if (rejectWrite) result = { isError: true, content: [{ type: 'text', text: 'Revision conflict' }] };
          else {
            const digest = { ...args, id: 'created', revision: (digests[0]?.revision ?? 0) + 1 };
            digests.splice(0, digests.length, digest); data = { digest };
          }
        } else assert.fail(`Unexpected tool: ${name}`);
        if (data) result = { structuredContent: data };
      }
      listeners.get('message')({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } });
    });
  } };
  let legacyMessages = 0;
  const window = { parent, openai: { sendFollowUpMessage() { legacyMessages++; } },
    addEventListener(name, callback) { listeners.set(name, callback); } };
  runInNewContext(html.split('<script>')[1].split('</script>')[0], {
    window, document, setTimeout, clearTimeout, URL, crypto: { randomUUID: () => 'create-key' }
  });
  await new Promise(resolve => setImmediate(resolve));
  const field = id => elements.get(id);
  const submit = () => field('digest-form').onsubmit({ preventDefault() {} });
  field('new').onclick();
  field('name').value = 'Art'; field('prompt').value = 'New drawing techniques'; field('domains').value = 'example.com';
  await submit();
  assert.equal(writes[0].name, 'create_digest');
  assert.equal(field('editor').open, false);
  assert.match(field('status').textContent, /No scheduled job was created/);

  field('edit').onclick();
  field('frequency').value = 'weekly'; field('weekday').value = '2'; field('hour').value = '10'; field('utc-offset').value = '2';
  await submit();
  assert.equal(writes[1].name, 'update_digest');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1].args.schedule)), {
    frequency: 'weekly', hour: 10, utc_offset_minutes: 120, weekday: 2
  });
  assert.equal(writes[1].args.expected_revision, 1);
  assert.match(field('status').textContent, /Scheduled jobs were not changed/);

  field('edit').onclick(); field('item-count').value = '5'; await submit();
  assert.equal(writes[2].args.items_per_edition, 5);
  rejectWrite = true;
  field('edit').onclick(); field('hour').value = '11'; await submit();
  assert.equal(field('editor').open, true);
  assert.equal(field('form-error').textContent, 'Revision conflict');
  assert.equal(field('save-digest').disabled, false);
  assert.equal(messages.filter(m => m.method === 'ui/message').length, 0);
  assert.equal(legacyMessages, 0);
  assert.equal(field('request-text')?.value ?? '', '');
});
