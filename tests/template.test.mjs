import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const script = fileURLToPath(new URL('../scripts/prepare-site.mjs', import.meta.url));
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

test('exported Site source builds and prepares deployments without plugin packaging', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'digest-installed-')); t.after(() => rm(root, { recursive: true, force: true }));
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  const installed = path.join(root, 'source'), destination = path.join(root, 'backend');
  await mkdir(installed);
  for (const name of ['src', 'ui', 'drizzle', 'scripts', 'tests', 'docs', '.openai', 'package.json', '.gitignore', 'README.md']) {
    await cp(path.join(siteRoot, name), path.join(installed, name), { recursive: true });
  }
  await mkdir(path.join(installed, '.deployments'));
  await writeFile(path.join(installed, '.deployments/private.txt'), 'must not be copied');
  await writeFile(path.join(installed, 'private.sqlite'), 'must not be copied');
  await writeFile(path.join(installed, '.env'), 'must not be copied');
  execFileSync(process.execPath, [path.join(installed, 'scripts/check-site.mjs')], { cwd: root });
  execFileSync(process.execPath, [path.join(installed, 'scripts/prepare-site.mjs'), destination], { cwd: root });
  execFileSync(process.execPath, [path.join(destination, 'scripts/build.mjs')], { cwd: destination });
  for (const name of ['.deployments', 'private.sqlite', '.env', '.agents', '.codex-plugin', 'plugins']) {
    await assert.rejects(access(path.join(destination, name)), { code: 'ENOENT' });
  }
  const built = await readFile(path.join(destination, 'dist/server/index.js'), 'utf8');
  assert.match(built, /export default createWorker/);
  const hosting = JSON.parse(await readFile(path.join(destination, 'dist/.openai/hosting.json'), 'utf8'));
  assert.equal(hosting.project_id, undefined); assert.equal(hosting.d1, 'DB');
});

// Existing users have inventories written by the former plugin's backend template.
test('upgrades a legacy plugin deployment without replacing its identity or migrations', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'digest-legacy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'site');
  execFileSync(process.execPath, [script, destination]);
  const inventoryPath = path.join(destination, '.digest-template.json');
  const inventory = JSON.parse(await readFile(inventoryPath));
  const oldPackage = JSON.stringify({ name: 'digest-backend', version: '0.3.1', type: 'module', scripts: { build: 'node scripts/build.mjs' } });
  await writeFile(path.join(destination, 'package.json'), oldPackage);
  const legacyNames = name => /^(src|ui|drizzle)\//.test(name) || ['package.json', '.gitignore', 'scripts/build.mjs'].includes(name);
  for (const name of Object.keys(inventory.files)) if (!legacyNames(name)) {
    await rm(path.join(destination, name)); delete inventory.files[name];
  }
  inventory.files['package.json'] = createHash('sha256').update(oldPackage).digest('hex');
  await writeFile(inventoryPath, JSON.stringify(inventory));
  const hostingPath = path.join(destination, '.openai/hosting.json');
  const hosting = { ...JSON.parse(await readFile(hostingPath)), project_id: 'existing-private-site' };
  await writeFile(hostingPath, JSON.stringify(hosting));
  const migration = await readFile(path.join(destination, 'drizzle/0000_digest.sql'), 'utf8');
  execFileSync(process.execPath, [script, destination, '--upgrade']);
  assert.deepEqual(JSON.parse(await readFile(hostingPath)), hosting);
  assert.equal(JSON.parse(await readFile(path.join(destination, 'package.json'))).name, 'codex-digests-site');
  assert.equal(await readFile(path.join(destination, 'drizzle/0000_digest.sql'), 'utf8'), migration);
  execFileSync(process.execPath, [path.join(destination, 'scripts/build.mjs')]);
});
