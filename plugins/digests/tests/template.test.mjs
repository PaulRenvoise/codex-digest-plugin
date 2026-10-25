import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../scripts/materialize-backend.mjs', import.meta.url));
test('new deployments have no personal identity; upgrades preserve identity and data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'digest-template-')); t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'backend');
  execFileSync(process.execPath, [script, destination]);
  const manifestPath = path.join(destination, '.openai/hosting.json');
  let manifest = JSON.parse(await readFile(manifestPath)); assert.equal(manifest.project_id, undefined); assert.equal(manifest.d1, 'DB');
  assert.throws(() => execFileSync(process.execPath, [script, destination], { stdio: 'pipe' }), /Destination already exists/);
  manifest.project_id = 'test-site-identity'; await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path.join(destination, 'private.sqlite'), 'do not touch');
  execFileSync(process.execPath, [script, destination, '--upgrade']);
  assert.equal(JSON.parse(await readFile(manifestPath)).project_id, 'test-site-identity');
  assert.equal(await readFile(path.join(destination, 'private.sqlite'), 'utf8'), 'do not touch');
  await writeFile(path.join(destination, 'src/worker.mjs'), '// user customization');
  assert.throws(() => execFileSync(process.execPath, [script, destination, '--upgrade'], { stdio: 'pipe' }), /Local modifications/);
  assert.equal(await readFile(path.join(destination, 'src/worker.mjs'), 'utf8'), '// user customization');
});

test('marketplace plugin works when installed without the repository root', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'digest-installed-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  const installed = path.join(root, 'installed'), destination = path.join(root, 'backend');
  await cp(pluginRoot, installed, { recursive: true, filter: source => !['dist', 'node_modules'].includes(path.basename(source)) });
  execFileSync(process.execPath, [path.join(installed, 'scripts/check-package.mjs')], { cwd: root });
  execFileSync(process.execPath, [path.join(installed, 'scripts/materialize-backend.mjs'), destination], { cwd: root });
  execFileSync(process.execPath, [path.join(destination, 'scripts/build.mjs')], { cwd: destination });
  const built = await readFile(path.join(destination, 'dist/server/index.js'), 'utf8');
  assert.match(built, /export default createWorker/);
  const hosting = JSON.parse(await readFile(path.join(destination, 'dist/.openai/hosting.json'), 'utf8'));
  assert.equal(hosting.project_id, undefined); assert.equal(hosting.d1, 'DB');
});
