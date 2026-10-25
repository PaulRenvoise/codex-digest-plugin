import { readFile, writeFile, mkdir, readdir, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = fileURLToPath(new URL('../templates/backend/', import.meta.url));
const [targetArg, flag] = process.argv.slice(2);
if (!targetArg || (flag && flag !== '--upgrade')) throw new Error('Usage: node scripts/materialize-backend.mjs /absolute/new/directory [--upgrade]');
if (!path.isAbsolute(targetArg)) throw new Error('Use an absolute destination path.');
const target = path.resolve(targetArg);
if (target === source || target.startsWith(source + path.sep)) throw new Error('The deployment must be outside the backend template.');
const hash = text => createHash('sha256').update(text).digest('hex');
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.git', '.wrangler'].includes(entry.name)) continue;
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported template entry: ${name}`);
  }
  return result.sort();
}
const names = await files(source), contents = new Map();
for (const name of names) contents.set(name, await readFile(path.join(source, name), 'utf8'));
const hosting = JSON.parse(contents.get('.openai/hosting.json'));
if (hosting.project_id) throw new Error('The public template must not contain a Site identity.');
const version = JSON.parse(contents.get('package.json')).version;
const marker = path.join(target, '.digest-template.json');
if (flag === '--upgrade') {
  const previous = JSON.parse(await readFile(marker, 'utf8'));
  const actualHosting = JSON.parse(await readFile(path.join(target, '.openai/hosting.json'), 'utf8'));
  if (!actualHosting.project_id || actualHosting.d1 !== 'DB') throw new Error('Upgrade requires an existing Digest Site with its original DB binding.');
  for (const [name, expected] of Object.entries(previous.files)) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('Invalid template inventory.');
    const actual = await readFile(path.join(target, name), 'utf8');
    if (hash(actual) !== expected) throw new Error(`Local modifications in ${name}; merge them explicitly before upgrading.`);
    if (!contents.has(name)) throw new Error(`This upgrade removes ${name}; a manual migration is required.`);
    if (name.startsWith('drizzle/') && name !== 'drizzle/meta/_journal.json' && actual !== contents.get(name)) throw new Error(`Published migration changed: ${name}`);
  }
  const oldJournal = JSON.parse(await readFile(path.join(target, 'drizzle/meta/_journal.json'), 'utf8'));
  const newJournal = JSON.parse(contents.get('drizzle/meta/_journal.json'));
  if (JSON.stringify(oldJournal.entries) !== JSON.stringify(newJournal.entries.slice(0, oldJournal.entries.length))) throw new Error('Migration history must be append-only.');
  // Guard newly managed files as well: never overwrite an untracked user addition.
  for (const name of names) if (name !== '.openai/hosting.json' && !(name in previous.files)) {
    try { await access(path.join(target, name)); throw new Error(`Unmanaged file already exists: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  hosting.project_id = actualHosting.project_id;
  contents.set('.openai/hosting.json', JSON.stringify({ ...actualHosting, capabilities: [...new Set([...(actualHosting.capabilities ?? []), 'mcp'])] }, null, 2) + '\n');
} else {
  try { await stat(target); throw new Error('Destination already exists. Use a new directory; use --upgrade only for a managed deployment.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(target, { recursive: true });
}
const inventory = {};
for (const [name, text] of contents) {
  const destination = path.join(target, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, text);
  if (name !== '.openai/hosting.json') inventory[name] = hash(text);
}
await writeFile(marker, JSON.stringify({ product: 'digest', version, files: inventory }, null, 2) + '\n');
console.log(JSON.stringify({ directory: target, version, mode: flag ? 'upgrade' : 'create', needs_site_registration: !hosting.project_id }));
