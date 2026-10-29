import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { installLocal } from './lib/install.mjs';
import { validateDistribution } from './validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some((arg, index) => arg !== '--source' && args[index - 1] !== '--source')) throw new Error('Usage: node scripts/test-host.mjs [--source <absolute MiniMax source directory>]');
const index = args.indexOf('--source');
const source = index >= 0 ? args[index + 1] : undefined;
if (index >= 0 && (!source || !path.isAbsolute(source))) throw new Error('--source requires an absolute directory');
const checks = [];
function run(executable, command, options = {}) {
  const result = spawnSync(executable, command, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${executable} ${command.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
}
try {
  checks.push({ gate: 'distribution', ...(await validateDistribution()) });
  const { resolveRunProvenance } = await import(pathToFileURL(path.join(root, 'plugins/pstack/runtime/run-state.mjs')).href);
  const provenance = resolveRunProvenance();
  assert.equal(provenance.source, 'build-info');
  assert.equal(provenance.upstreamCommit, '1ba91fc25c0977741dd0e267849e6234b037ed0a');
  assert.equal(provenance.liveVerified, false);
  checks.push({ gate: 'generated-runtime-provenance-reader', provenance });
  if (source) {
    const native = JSON.parse(await readFile(path.join(source, 'schemas/plugins/plugin-v1.schema.json'), 'utf8'));
    const local = JSON.parse(await readFile(path.join(root, 'adapters/minimax-code/plugin-v1.schema.json'), 'utf8'));
    assert.deepEqual(local, native, 'Local native schema copy drifted from the explicitly selected host');
    const output = run(process.execPath, [path.join(source, 'tools/plugins/validate-plugin.mjs'), path.join(root, 'plugins/pstack')], { cwd: root });
    checks.push({ gate: 'source-validator', source, output: output.trim(), changedHostSource: false });
  }
  const sandbox = path.join(root, 'tests/.sandbox/host', randomUUID());
  const dataDir = path.join(sandbox, 'data');
  const home = path.join(sandbox, 'home');
  const workspace = path.join(sandbox, 'workspace');
  const tmp = path.join(sandbox, 'tmp');
  for (const dir of [home, workspace, tmp]) await mkdir(dir, { recursive: true });
  await installLocal({ repoRoot: root, dataDir, apply: true });
  // Do not inherit provider keys, profile choices or user config overrides.
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    MINIMAX_DATA_DIR: dataDir, MAVIS_DATA_DIR: dataDir,
    TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    MCODE_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', TERM: 'dumb', LANG: 'en_US.UTF-8',
  };
  const version = run('mcode', ['--version'], { cwd: workspace, env }).trim();
  const catalog = JSON.parse(run('mcode', ['plugin', 'list', '--marketplace', 'local', '--json'], { cwd: workspace, env }));
  const plugin = catalog.installed?.find((item) => item.pluginId === 'pstack@local');
  assert.ok(plugin, 'Installed runtime did not discover pstack@local');
  assert.equal(plugin.enabled, true);
  assert.equal(plugin.capabilities.skillCount, 58);
  checks.push({ gate: 'installed-runtime-reader', version, dataDir, plugin });
  for (const name of ['poteto-agent', 'comment-sicko']) assert.match(await readFile(path.join(dataDir, 'agents', name, 'agent.md'), 'utf8'), new RegExp(`name: ${name}`));
  checks.push({ gate: 'separate-agent-placement', names: ['poteto-agent', 'comment-sicko'], liveTaskResolution: 'NOT_RUN: requires explicitly approved model invocation' });
  if (source) {
    const codec = JSON.parse(run('bun', [path.join(root, 'scripts/test-agent-codec.mjs'), '--source', source, '--data-dir', dataDir, '--out', path.join(sandbox, 'codec')], { cwd: root, env: { ...env, PSTACK_TEST_NODE: process.execPath } }));
    checks.push({ gate: 'selected-source-canonical-agent-codec', ...codec });
  }
  console.log(JSON.stringify({ passed: true, checks, notRun: ['Live skill/task invocation, model billing and permissions', 'Actual TLC comparison without an approved local JRE/TLA2TOOLS', 'GitHub writes'] }, null, 2));
  await mkdir(path.join(root, '.pstack/checks'), { recursive: true });
  await writeFile(path.join(root, '.pstack/checks/host.json'), `${JSON.stringify({ schemaVersion: 1, passed: true, checks, liveInvocation: 'NOT_RUN' }, null, 2)}\n`);
} catch (error) { console.error(error.stack); process.exitCode = 1; }
