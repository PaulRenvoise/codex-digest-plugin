import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const plugin = await json('.codex-plugin/plugin.json'), backend = await json('templates/backend/package.json');
assert.equal(plugin.version, backend.version);
const marketplacePath = path.resolve(root, '../../.agents/plugins/marketplace.json');
const marketplaceText = await readFile(marketplacePath, 'utf8').catch(error => {
  // Installed plugin copies do not include the marketplace repository.
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (marketplaceText !== null) {
  const marketplace = JSON.parse(marketplaceText);
  const entry = marketplace.plugins.find(entry => entry.name === plugin.name);
  assert.equal(entry?.source.source, 'local');
  assert.equal(path.resolve(root, '../..', entry.source.path), path.resolve(root));
  const pkg = JSON.parse(await readFile(path.resolve(root, '../../package.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version);
}
assert.equal(plugin.mcpServers, undefined, 'The distributed companion must not bind a personal backend.');
assert.equal((await json('templates/backend/.openai/hosting.json')).project_id, undefined);
for (const name of await readdir(path.join(root, 'skills'))) {
  const text = await readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
  assert.match(text, /^---\nname: [a-z-]+\ndescription: .+\n---/);
  for (const match of text.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) await readFile(path.resolve(root, 'skills', name, match[1]));
}
console.log('Plugin versions, skill references and deployment isolation validated.');
