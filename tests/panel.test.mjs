import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

for (const standardBridge of [true, false]) test(`ChatGPT safe areas survive initialization and update without reloading (${standardBridge ? 'both bridges' : 'legacy only'})`, async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const listeners = new Map(), elements = new Map(), calls = [];
  const element = () => ({ value: '', dataset: {}, style: { setProperty(k, v) { this[k] = v; } },
    classList: { toggle() {} }, append() {}, replaceChildren() {}, setAttribute() {} });
  const document = { documentElement: element(), addEventListener() {}, createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  const tool = name => { calls.push(name); return { structuredContent: name === 'list_digests' ? { digests: [] } : { values: {} } }; };
  const parent = { postMessage(message) {
    if (!message.id) return;
    queueMicrotask(() => listeners.get('message')({ source: parent, data: { jsonrpc: '2.0', id: message.id,
      ...(message.method === 'ui/initialize' ? standardBridge
        ? { result: { hostContext: { safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } } } }
        : { error: { message: 'Standard bridge unavailable' } }
        : { result: tool(message.params.name) }) } }));
  } };
  const window = { parent, openai: { theme: 'dark', safeArea: { insets: { top: 108, bottom: 84, left: 0, right: 0 } }, callTool: async name => tool(name) },
    addEventListener(name, fn) { listeners.set(name, fn); } };
  runInNewContext(html.split('<script>')[1].split('</script>')[0], { window, document, setTimeout, clearTimeout, URL });
  const style = document.documentElement.style;
  assert.equal(style['--safe-top'], '108px', 'initial globals apply before asynchronous bridge initialization');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(style['--safe-top'], '108px', 'standard zero defaults cannot erase ChatGPT overlays');
  assert.equal(style['--safe-bottom'], '84px');
  const reads = calls.length;
  const globals = value => listeners.get('openai:set_globals')({ detail: { globals: value } });
  globals({ theme: 'light' });
  assert.equal(style['--safe-top'], '108px');
  globals({ safeArea: { insets: { bottom: 300 } } });
  assert.equal(style['--safe-bottom'], '300px', 'composer/keyboard changes apply');
  globals({ safeArea: { insets: { top: 64, bottom: 60, left: 44, right: 44 } } });
  assert.equal(style['--safe-left'], '44px', 'rotation updates every edge');
  globals({ safeArea: { insets: { top: -1, bottom: 'invalid' } } });
  assert.equal(style['--safe-top'], '64px');
  assert.equal(style['--safe-bottom'], '60px');
  globals({ safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } } });
  assert.equal(style['--safe-top'], '0px');
  assert.equal(style['--safe-bottom'], '0px', 'leaving fullscreen clears the overlays');
  assert.equal(calls.length, reads, 'layout updates do not reload data or send messages');
});

// Exercise the real embedded script against a host that delivers both RPC replies
// and tool lifecycle notifications, without a browser or network dependency.
test('panel refreshes through data tools and honors host selection without reopening itself', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), documentListeners = new Map(), calls = [];
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
    createElement: element, addEventListener(name, fn) { documentListeners.set(name, fn); }
  };
  const window = { parent, addEventListener(name, callback) { listeners.set(name, callback); } };
  runInNewContext(html.split('<script>')[1].split('</script>')[0], { window, document, setTimeout, clearTimeout, URL });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('digest-select').value, 'first');
  assert.equal(elements.get('digest-select').children.at(-1).textContent, '+ New digest');
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
  const readsBeforeFocus = calls.length;
  for (let cycle = 0; cycle < 3; cycle++) {
    document.hidden = true; documentListeners.get('visibilitychange')?.(); listeners.get('blur')?.();
    document.hidden = false; documentListeners.get('visibilitychange')?.(); listeners.get('focus')?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(calls.length, readsBeforeFocus, 'switching away and back does not reload the library');
  assert.equal(elements.get('digest-select').value, 'second');
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
  assert.equal(field('library').hidden, false, 'an empty library still exposes the create dropdown');
  assert.equal(field('edit').disabled, true);
  field('digest-select').value = '__new_digest__'; field('digest-select').onchange();
  assert.equal(field('editor').open, true);
  assert.equal(field('digest-select').value, '');
  field('name').value = 'Art'; field('prompt').value = 'New drawing techniques'; field('domains').value = 'example.com';
  await submit();
  assert.equal(writes[0].name, 'create_digest');
  assert.equal(field('editor').open, false);
  assert.match(field('status').textContent, /Digest created/);
  assert.equal(field('edit').disabled, false);
  field('digest-select').value = '__new_digest__'; field('digest-select').onchange();
  field('cancel').onclick();
  assert.equal(field('digest-select').value, 'created', 'cancel keeps the previous digest selected');
  assert.equal(writes.length, 1, 'opening and cancelling creation does not save or send a message');

  field('edit').onclick();
  field('frequency').value = 'weekly'; field('weekday').value = '2'; field('hour').value = '10'; field('utc-offset').value = '2';
  await submit();
  assert.equal(writes[1].name, 'update_digest');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1].args.schedule)), {
    frequency: 'weekly', hour: 10, utc_offset_minutes: 120, weekday: 2
  });
  assert.equal(writes[1].args.expected_revision, 1);
  assert.match(field('status').textContent, /Settings saved/);

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

test('domain shortcut preserves fresh settings, deduplicates sources and recovers from conflicts', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), messages = [], writes = [];
  const element = () => ({ value: '', dataset: {}, children: [], style: { setProperty() {} }, classList: { toggle() {} },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; } });
  const document = { documentElement: element(), addEventListener() {}, createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  let current = { id: 'art', name: 'Art', prompt: 'Techniques', domains: ['github.com/artist'], revision: 1,
    items_per_edition: 8, schedule: { frequency: 'weekly', weekday: 2, hour: 10, utc_offset_minutes: 120 } };
  let rejectWrite = false;
  const parent = { postMessage(message) {
    messages.push(message); if (!message.id) return;
    queueMicrotask(() => {
      let result = {};
      if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        let data;
        if (name === 'list_digests') data = { digests: [{ ...current }] };
        else if (name === 'settings_read') data = { values: {} };
        else if (name === 'list_editions') data = { editions: [{ id: 'edition', title: 'Edition' }], next_offset: null };
        else if (name === 'get_edition') data = { items: ['example.com', 'example.com', 'github.com', 'saved.com'].map((domain, i) => ({
          url: `https://${domain}/article`, title: `Item ${i}`, kind: 'article', tags: [], summary: 'Summary'
        })) };
        else if (name === 'get_digest') data = { digest: { ...current } };
        else if (name === 'update_digest') {
          writes.push(args);
          if (rejectWrite) result = { isError: true, content: [{ type: 'text', text: 'Revision conflict' }] };
          else { current = { ...current, ...args, revision: current.revision + 1 }; data = { digest: current }; }
        } else assert.fail(`Unexpected call ${name}`);
        if (data) result = { structuredContent: data };
      }
      listeners.get('message')({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } });
    });
  } };
  const window = { parent, addEventListener(name, fn) { listeners.set(name, fn); } };
  runInNewContext(html.split('<script>')[1].split('</script>')[0], { window, document, setTimeout, clearTimeout, URL, crypto: { randomUUID: () => 'key' } });
  await new Promise(resolve => setImmediate(resolve));
  const descendants = el => [el, ...el.children.flatMap(descendants)];
  const buttons = descendants(elements.get('cards')).filter(el => el.className === 'add-source');
  assert.equal(buttons.length, 4);
  assert.equal(buttons[2].disabled, false, 'a creator URL does not mark the whole domain as preferred');
  current = { ...current, name: 'Renamed elsewhere', prompt: 'Updated elsewhere', revision: 7, domains: [...current.domains, 'https://www.saved.com/'] };
  const saving = buttons[0].onclick();
  assert.ok(buttons.every(b => b.disabled), 'serialize additions within a digest');
  await buttons[1].onclick(); await saving;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expected_revision, 7);
  assert.equal(writes[0].name, 'Renamed elsewhere');
  assert.equal(writes[0].prompt, 'Updated elsewhere');
  assert.equal(writes[0].schedule, undefined, 'leave schedule and item count to the backend');
  assert.deepEqual(Array.from(current.domains), ['github.com/artist', 'https://www.saved.com/', 'example.com']);
  assert.equal(current.items_per_edition, 8);
  assert.ok(buttons[0].disabled && buttons[1].disabled && buttons[3].disabled);
  assert.equal(buttons[0].textContent, '✓');
  await buttons[0].onclick();
  assert.equal(writes.length, 1, 'already preferred sources are not saved twice');
  elements.get('edit').onclick();
  assert.match(elements.get('domains').value, /example.com/);
  assert.equal(elements.get('name').value, 'Renamed elsewhere');
  rejectWrite = true; await buttons[2].onclick();
  assert.equal(buttons[2].disabled, false);
  assert.equal(buttons[2].textContent, '+');
  assert.equal(elements.get('status').textContent, 'Revision conflict');
  rejectWrite = false; await buttons[2].onclick();
  assert.equal(buttons[2].textContent, '✓');
  assert.equal(messages.filter(m => m.method === 'ui/message').length, 0);
});

test('header fallback is limited to mobile fullscreen and yields to reported insets', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  for (const embedded of [true, false]) {
    const elements = new Map(), listeners = new Map();
    const element = () => ({ value: '', dataset: {}, style: { setProperty(k, v) { this[k] = v; } },
      classList: { toggle() {} }, append() {}, replaceChildren() {}, setAttribute() {} });
    const document = { documentElement: element(), addEventListener() {}, createElement: element,
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
    let mediaChange;
    const media = { matches: true, addEventListener(name, fn) { mediaChange = fn; } };
    const window = { matchMedia: () => media, addEventListener(name, fn) { listeners.set(name, fn); } };
    const data = name => name === 'list_digests' ? { digests: [] } : { values: {} };
    window.parent = embedded ? { postMessage(message) {
      if (!message.id) return;
      if (message.method === 'ui/initialize') assert.deepEqual(Array.from(message.params.appCapabilities.availableDisplayModes), ['fullscreen']);
      queueMicrotask(() => listeners.get('message')({ source: window.parent, data: { jsonrpc: '2.0', id: message.id,
        result: message.method === 'ui/initialize' ? { hostContext: { safeAreaInsets: { top: 0 } } } : { structuredContent: data(message.params.name) } } }));
    } } : window;
    runInNewContext(html.split('<script>')[1].split('</script>')[0], { window, document, setTimeout, clearTimeout, URL,
      fetch: async (url, options) => ({ ok: true, json: async () => data(JSON.parse(options.body).name) }) });
    await new Promise(resolve => setImmediate(resolve));
    const fallback = () => document.documentElement.dataset.headerFallback;
    assert.equal(fallback(), String(embedded), 'zero/absent insets get a fallback only in an embedded phone view');
    const globals = value => listeners.get('openai:set_globals')({ detail: { globals: value } });
    globals({ safeArea: { insets: { top: 132 } } });
    assert.equal(fallback(), 'false', 'reported spacing replaces, rather than adds to, the fallback');
    globals({ safeArea: { insets: { top: 0 } }, displayMode: 'inline' });
    assert.equal(fallback(), 'false');
    globals({ displayMode: 'fullscreen', userAgent: { device: { type: 'desktop' } } });
    assert.equal(fallback(), 'false', 'narrow desktop panels do not get mobile padding');
    globals({ platform: 'mobile' });
    assert.equal(fallback(), String(embedded));
    globals({ platform: 'web' }); media.matches = false; mediaChange();
    assert.equal(fallback(), 'false', 'viewport changes clear inferred mobile state');
  }
});
