import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = await readFile(path.join(root, 'ui/index.html'), 'utf8');
const modules = await Promise.all(['contract', 'schedule', 'service', 'worker'].map(name => readFile(path.join(root, `src/${name}.mjs`), 'utf8')));
// Fixed, dependency-free modules: concatenate in dependency order, keeping exports.
const source = modules.map(text => text.replace(/^import .*;\n/gm, '')).join('\n') + `\nexport default createWorker(${JSON.stringify(html)});\n`;
const loaded = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if (typeof loaded.default?.fetch !== 'function') throw new Error('Invalid Worker entrypoint.');
const manifest = JSON.parse(await readFile(path.join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.d1 !== 'DB' || !manifest.capabilities?.includes('mcp')) throw new Error('Digest requires the DB binding and MCP capability.');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });
await writeFile(path.join(dist, 'server/index.js'), source);
await writeFile(path.join(dist, '.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(path.join(root, 'drizzle'), path.join(dist, '.openai/drizzle'), { recursive: true });
console.log('Built and validated Digest Worker, UI and migrations.');
