import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLocal, uninstallLocal, planInstall, planUninstall, parseArgs, validatePackage } from '../../scripts/lib/install.mjs';

const sandbox = fileURLToPath(new URL('../.sandbox/install/', import.meta.url));
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function put(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
const text = (version) => `---\nname: example\ndescription: A synthetic fixture\n---\n${version}\n`;
async function fixture() {
  await fs.mkdir(sandbox, { recursive: true });
  const base = await fs.mkdtemp(path.join(sandbox, 'case-'));
  const repoRoot = path.join(base, 'source');
  const dataDir = path.join(base, 'data');
  const plugin = path.join(repoRoot, 'plugins/pstack');
  const manifest = { schemaVersion: 1, name: 'pstack', version: '0.15.36-minimax.1', description: 'Fixture', author: 'Fixture', icon: 'icon.png', category: 'Code', exampleQueries: [], apps: [], mcpServers: [], skills: ['skills/example/SKILL.md'] };
  await put(path.join(plugin, '.minimax-plugin/plugin.json'), JSON.stringify(manifest));
  await put(path.join(plugin, 'skills/example/SKILL.md'), text('version 1'));
  await put(path.join(plugin, 'icon.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=', 'base64'));
  for (const name of ['poteto-agent', 'comment-sicko']) await put(path.join(repoRoot, 'agent-configs', name, 'agent.md'), `---\nname: ${name}\ndescription: Fixture\n---\nDelegate.\n`);
  return { base, repoRoot, dataDir, plugin };
}
async function updateSource(f) { await put(path.join(f.plugin, 'skills/example/SKILL.md'), text('version 2')); }

test('install: explicit data directory and apply selection are mandatory', () => {
  assert.throws(() => parseArgs([]), /required/);
  assert.throws(() => parseArgs(['--data-dir', 'relative']), /absolute/);
  assert.throws(() => parseArgs(['--data-dir', sandbox, '--apply', '--dry-run']), /exactly one/);
  assert.equal(parseArgs(['--data-dir', sandbox]).apply, false);
  assert.deepEqual(parseArgs(['--data-dir', sandbox, '--agents', 'none']).agents, []);
});
test('install: preview is completely read-only, fresh install has two separate agents', async () => {
  const f = await fixture();
  const preview = await planInstall(f);
  assert.deepEqual(preview.targets.map((target) => target.action), ['install', 'install', 'install']);
  assert.equal(preview.localPluginInitiallyEnabled, true);
  assert.equal(await exists(f.dataDir), false);
  await installLocal({ ...f, apply: false });
  assert.equal(await exists(f.dataDir), false);
  const installed = await installLocal({ ...f, apply: true });
  assert.ok(installed.transaction);
  assert.equal(await exists(path.join(f.dataDir, 'plugins/pstack/.minimax-plugin/plugin.json')), true);
  assert.equal(await exists(path.join(f.dataDir, 'agents/poteto-agent/agent.md')), true);
  assert.equal(await exists(path.join(f.dataDir, 'agents/comment-sicko/agent.md')), true);
  assert.equal(await exists(path.join(f.dataDir, 'config.yaml')), false);
  const second = await installLocal({ ...f, apply: true });
  assert.equal(second.transaction, null);
  assert.ok(second.targets.every((target) => target.action === 'unchanged'));
});
test('install: unmanaged and user-edited targets are never overwritten', async () => {
  const f = await fixture();
  await put(path.join(f.dataDir, 'agents/poteto-agent/agent.md'), 'User agent');
  await assert.rejects(installLocal({ ...f, apply: true }), /Unmanaged/);
  assert.equal(await exists(path.join(f.dataDir, 'plugins')), false);
  const g = await fixture();
  await installLocal({ ...g, apply: true });
  await fs.appendFile(path.join(g.dataDir, 'agents/comment-sicko/agent.md'), '\nUser changes');
  await updateSource(g);
  await assert.rejects(installLocal({ ...g, apply: true }), /user-edited/);
  assert.equal(await fs.readFile(path.join(g.dataDir, 'plugins/pstack/skills/example/SKILL.md'), 'utf8'), text('version 1'));
});
test('install: source/ancestor symlinks, path escape and overlapping directories fail closed', async () => {
  const f = await fixture();
  await fs.symlink(f.plugin, path.join(f.base, 'linked'), 'dir');
  await assert.rejects(installLocal({ ...f, dataDir: path.join(f.base, 'linked/data'), apply: true }), /Symlink/);
  await assert.rejects(installLocal({ ...f, dataDir: path.join(f.plugin, 'data'), apply: true }), /overlap/);
  await assert.rejects(installLocal({ ...f, dataDir: `${f.dataDir}/../escape`, apply: true }), /traversal/);
  await fs.symlink(path.join(f.plugin, 'icon.png'), path.join(f.plugin, 'alias.png'));
  await assert.rejects(validatePackage(f.plugin), /Symlink/);
});
test('install: root manifest cannot shadow the native package', async () => {
  const f = await fixture();
  await put(path.join(f.plugin, 'plugin.json'), '{}');
  await assert.rejects(installLocal({ ...f, apply: true }), /Root plugin.json/);
  assert.equal(await exists(f.dataDir), false);
});
test('install: managed update is reversible through a hash-checked backup', async () => {
  const f = await fixture();
  await installLocal({ ...f, apply: true });
  await updateSource(f);
  await installLocal({ ...f, apply: true });
  const live = path.join(f.dataDir, 'plugins/pstack/skills/example/SKILL.md');
  assert.equal(await fs.readFile(live, 'utf8'), text('version 2'));
  const preview = await planUninstall(f);
  assert.equal(preview.targets.find((target) => target.key === 'plugin').action, 'restore');
  await uninstallLocal({ ...f, apply: true });
  assert.equal(await fs.readFile(live, 'utf8'), text('version 1'));
  assert.equal(await exists(path.join(f.dataDir, 'agents/poteto-agent/agent.md')), false);
  const record = JSON.parse(await fs.readFile(path.join(f.dataDir, 'pstack/install-record.json'), 'utf8'));
  assert.deepEqual(record.targets, {});
  assert.equal((await planUninstall(f)).targets[0].action, 'not-managed');
});
test('install: uninstall preserves edited agents, user-added files, project config and evidence', async () => {
  const f = await fixture();
  await installLocal({ ...f, apply: true });
  const agent = path.join(f.dataDir, 'agents/comment-sicko/agent.md');
  await fs.appendFile(agent, '\nUser customization');
  await put(path.join(f.dataDir, 'agents/poteto-agent/notes.md'), 'User note');
  await put(path.join(f.dataDir, 'config.yaml'), 'preserve');
  await put(path.join(f.base, 'project/.pstack/runs/one/evidence.txt'), 'evidence');
  const result = await uninstallLocal({ ...f, apply: true });
  assert.equal(result.targets.find((target) => target.key === 'comment-sicko').action, 'skip');
  assert.match(await fs.readFile(agent, 'utf8'), /User customization/);
  assert.equal(await fs.readFile(path.join(f.dataDir, 'agents/poteto-agent/notes.md'), 'utf8'), 'User note');
  assert.equal(await fs.readFile(path.join(f.dataDir, 'config.yaml'), 'utf8'), 'preserve');
  assert.equal(await fs.readFile(path.join(f.base, 'project/.pstack/runs/one/evidence.txt'), 'utf8'), 'evidence');
});
test('install: stale/unknown locks are not stolen based on PID', async () => {
  const f = await fixture();
  await put(path.join(f.dataDir, 'pstack/install.lock/owner.json'), JSON.stringify({ pid: 99999999, transaction: 'unknown' }));
  await assert.rejects(installLocal({ ...f, apply: true }), /lock exists/);
  assert.equal(await exists(path.join(f.dataDir, 'plugins')), false);
});
for (const phase of ['locked', 'repreflight', 'backup', 'backed-up', 'staged', 'displaced:plugin', 'replaced:plugin', 'replaced:poteto-agent', 'replaced', 'checked', 'record', 'recorded']) {
  test(`install: failure injection ${phase} rolls back only managed changes`, async () => {
    const f = await fixture();
    await installLocal({ ...f, apply: true });
    const original = await fs.readFile(path.join(f.dataDir, 'pstack/install-record.json'), 'utf8');
    await updateSource(f);
    await put(path.join(f.repoRoot, 'agent-configs/poteto-agent/agent.md'), '---\nname: poteto-agent\ndescription: Updated\n---\nUpdate\n');
    await assert.rejects(installLocal({ ...f, apply: true, failAt: phase }), /Injected failure/);
    assert.equal(await fs.readFile(path.join(f.dataDir, 'plugins/pstack/skills/example/SKILL.md'), 'utf8'), text('version 1'));
    assert.equal(await fs.readFile(path.join(f.dataDir, 'pstack/install-record.json'), 'utf8'), original);
    assert.equal(await exists(path.join(f.dataDir, 'pstack/install.lock')), false);
  });
}
test('install: uninstall failure rolls back displaced package and ownership record', async () => {
  const f = await fixture();
  await installLocal({ ...f, apply: true });
  const original = await fs.readFile(path.join(f.dataDir, 'pstack/install-record.json'), 'utf8');
  await assert.rejects(uninstallLocal({ ...f, apply: true, failAt: 'replaced:plugin' }), /Injected failure/);
  assert.equal(await fs.readFile(path.join(f.dataDir, 'plugins/pstack/skills/example/SKILL.md'), 'utf8'), text('version 1'));
  assert.equal(await fs.readFile(path.join(f.dataDir, 'pstack/install-record.json'), 'utf8'), original);
});
