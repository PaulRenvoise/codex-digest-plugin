import { readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { VERSION, TOOLS, UI_URI } from '../src/contract.mjs';
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const pkg = JSON.parse(await read('package.json'));
assert.equal(pkg.name, 'codex-digests-site');
assert.equal(pkg.version, VERSION);
const hosting = JSON.parse(await read('.openai/hosting.json'));
assert.equal(hosting.project_id, undefined, 'Public source must not contain a personal Site identity.');
assert.equal(hosting.d1, 'DB');
assert.ok(hosting.capabilities.includes('mcp'));
for (const name of ['.agents/plugins/marketplace.json', '.codex-plugin/plugin.json']) {
  const exists = await access(new URL(`../${name}`, import.meta.url)).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  assert.equal(exists, false, 'Distribute the Site, not a companion plugin.');
}
const open = TOOLS.find(tool => tool.name === 'open_digest');
assert.equal(open._meta.ui.resourceUri, UI_URI);
assert.deepEqual(open._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
for (const name of ['README.md', 'docs/deployment.md', 'docs/research.md', 'docs/management.md']) {
  const content = await read(name);
  for (const match of content.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
    await access(new URL(match[1], new URL(`../${name}`, import.meta.url)));
  }
}
console.log('Site version, MCP entrypoints, documentation and deployment isolation validated.');
