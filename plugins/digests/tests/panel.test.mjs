import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Exercise the real embedded script against a host that delivers both RPC replies
// and tool lifecycle notifications, without a browser or network dependency.
test('panel refreshes through data tools and honors host selection without reopening itself', async () => {
  const html = await readFile(new URL('../templates/backend/ui/index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), calls = [];
  const element = () => ({
    value: '', hidden: false, dataset: {}, children: [], classList: { toggle() {} },
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
      if (message.method === 'ui/initialize') return emit({ id: message.id, result: { hostContext: { theme: 'dark' } } });
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
