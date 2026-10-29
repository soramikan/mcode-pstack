import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assertNoSymlinks, exists, json, sha256, treeHash, treeRecords, walk, writeTreeFile } from './lib/tree.mjs';
import { withRepositoryLock } from './lib/lock.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function includeSource(relative) {
  if (relative === 'README.md' || relative === 'LICENSE') return true;
  if (relative.startsWith('docs/guide/')) return true;
  if (!relative.startsWith('skills/')) return false;
  if (relative.includes('/test/') || /\.(test|test-helper|compile)\.(ts|mjs)$/.test(relative)) return false;
  if (/\/(bun\.lock|tsconfig\.json)$/.test(relative)) return false;
  return true;
}
export async function verifySource(root = ROOT) {
  const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(lock.commit)) throw new Error('Invalid upstream lock');
  const records = await treeRecords(path.join(root, 'vendor/pstack'));
  if (treeHash(records) !== lock.treeSha256) throw new Error('Vendored source differs from upstream.lock.json');
  if (Object.keys(records).length !== lock.counts.files) throw new Error('Vendored source count mismatch');
  for (const [name, record] of Object.entries(records)) {
    if (lock.files[name]?.sha256 !== record.sha256 || lock.files[name]?.bytes !== record.bytes) throw new Error(`Source integrity mismatch: ${name}`);
  }
  const generator = await readFile(path.join(root, 'vendor/upstream-generator.mjs'));
  if (sha256(generator) !== lock.generator.sha256) throw new Error('Vendored upstream generator was modified');
  return lock;
}
async function copyTree(source, destination, transform) {
  for (const name of await walk(source)) {
    const bytes = await readFile(path.join(source, name));
    await writeTreeFile(destination, name, transform ? await transform(name, bytes) : bytes);
  }
}
export async function buildPackage({ root = ROOT, stage } = {}) {
  await assertNoSymlinks(root);
  const lock = await verifySource(root);
  if (!stage) throw new Error('An explicit staging directory is required');
  await assertNoSymlinks(stage);
  const allowed = path.join(root, '.pstack/generation');
  if (!path.resolve(stage).startsWith(`${path.resolve(allowed)}${path.sep}`)) throw new Error('Generation staging must remain in .pstack/generation');
  const sourceRoot = path.join(root, 'vendor/pstack');
  const packageRoot = path.join(stage, 'pstack');
  const agentRoot = path.join(stage, 'agent-configs');
  if (await exists(packageRoot) || await exists(agentRoot)) throw new Error('Staging output already exists');
  await mkdir(packageRoot, { recursive: true });
  const adapterHash = treeHash(await treeRecords(path.join(root, 'adapters/minimax-code')));
  const { transformMarkdown } = await import(`${pathToFileURL(path.join(root, 'adapters/minimax-code/transform.mjs')).href}?adapter=${adapterHash}`);
  const files = await walk(sourceRoot);
  const skillPaths = files.filter((name) => /^skills\/[^/]+\/SKILL\.md$/.test(name));
  const playbooks = files.filter((name) => /^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(name));
  const context = { upstreamCommit: lock.commit, skillNames: skillPaths.map((name) => name.split('/')[1]) };
  if (skillPaths.length !== lock.counts.skills || playbooks.length !== lock.counts.playbooks) throw new Error('Upstream inventory mismatch');
  for (const name of files.filter(includeSource)) {
    let bytes = await readFile(path.join(sourceRoot, name));
    if (name.endsWith('.md')) bytes = Buffer.from(transformMarkdown(name, bytes.toString('utf8'), context));
    // Production tools never depend on source-side install metadata.
    if (name.endsWith('/scripts/package.json')) bytes = Buffer.from(json({ private: true, type: 'module' }));
    await writeTreeFile(packageRoot, name, bytes);
  }
  const scriptOverrides = path.join(root, 'adapters/minimax-code/script-overrides');
  if (await exists(scriptOverrides)) {
    for (const name of await walk(scriptOverrides)) {
      if (name === 'README.md') continue;
      await writeTreeFile(packageRoot, name, await readFile(path.join(scriptOverrides, name)));
    }
  }
  const runtimeRoot = path.join(root, 'adapters/minimax-code/runtime');
  for (const required of ['config.mjs', 'session-reader.mjs', 'run-state.mjs', 'run-worker.mjs', 'doctor.mjs']) {
    if (!await exists(path.join(runtimeRoot, required))) throw new Error(`Missing runtime source: ${required}`);
  }
  await copyTree(runtimeRoot, path.join(packageRoot, 'runtime'));
  const adapterManifest = JSON.parse(await readFile(path.join(root, 'adapters/minimax-code/manifest.json'), 'utf8'));
  await writeTreeFile(packageRoot, 'runtime/build-info.json', json({ schemaVersion: 1, upstreamCommit: lock.commit, upstreamVersion: lock.version, adapterVersion: adapterManifest.version, adapterSha256: adapterHash }));
  const harness = await readFile(path.join(root, 'adapters/minimax-code/harness.md'));
  await writeTreeFile(packageRoot, 'docs/harness/minimax-code.md', harness);
  const policyRoot = path.join(root, 'adapters/minimax-code/policies');
  if (await exists(policyRoot)) await copyTree(policyRoot, path.join(packageRoot, 'docs/policies'));
  const compatibility = JSON.parse(await readFile(path.join(root, 'adapters/minimax-code/compatibility.json'), 'utf8'));
  if (compatibility.upstreamCommit !== lock.commit) throw new Error('Adapter inventory needs explicit rebase to this upstream commit');
  await writeTreeFile(packageRoot, 'compatibility.json', json(compatibility));
  const manifest = JSON.parse(await readFile(path.join(root, 'adapters/minimax-code/manifest.json'), 'utf8'));
  manifest.skills = skillPaths.sort();
  await writeTreeFile(packageRoot, '.minimax-plugin/plugin.json', json(manifest));
  await writeTreeFile(packageRoot, 'icon.png', await readFile(path.join(sourceRoot, 'assets/logo.png')));
  await writeTreeFile(packageRoot, 'UPSTREAM.md', `# Provenance\n\nUpstream pstack ${lock.version} by Lauren Tan, MIT.\n\nSource: https://github.com/cursor/plugins/tree/${lock.commit}/pstack\n\nPort: ${manifest.version}. Independent MiniMax Code adaptation, not an official MiniMax or Cursor release.\n\nSource SHA-256 tree: ${lock.treeSha256}\n\nRuntime reference: MiniMax Code ${lock.referenceHost.version}, ${lock.referenceHost.revision}, modified working tree.\n\nGenerated files are immutable. Put learning patches in the source adapter overrides, regenerate, check, and explicitly reinstall.\n`);
  const { buildTools } = await import(pathToFileURL(path.join(root, 'scripts/build-tools.mjs')).href);
  await buildTools({ root, packageRoot });
  for (const name of ['poteto-agent', 'comment-sicko']) {
    const source = path.join(root, 'adapters/minimax-code/agent-overrides', name, 'agent.md');
    await writeTreeFile(agentRoot, `${name}/agent.md`, await readFile(source));
  }
  if (adapterHash !== treeHash(await treeRecords(path.join(root, 'adapters/minimax-code')))) throw new Error('Adapter sources changed during generation; retry after writers stop');
  return { packageRoot, agentRoot, lock, manifest };
}
export async function compareTrees(expectedRoot, actualRoot) {
  const expected = await treeRecords(expectedRoot);
  const actual = await exists(actualRoot) ? await treeRecords(actualRoot) : {};
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().filter((name) => expected[name]?.sha256 !== actual[name]?.sha256);
}
export async function generate(options = {}) {
  return withRepositoryLock(options.root ?? ROOT, 'generate', () => performGenerate(options));
}
async function performGenerate({ root = ROOT, check = false } = {}) {
  await assertNoSymlinks(path.join(root, '.pstack'));
  const stage = path.join(root, '.pstack/generation', randomUUID());
  const built = await buildPackage({ root, stage });
  const { validateDistribution } = await import('./validate.mjs');
  await validateDistribution({ root, packageRoot: built.packageRoot, agentRoot: built.agentRoot });
  const targets = [
    { staged: built.packageRoot, target: path.join(root, 'plugins/pstack'), backup: path.join(stage, 'previous-pstack') },
    { staged: built.agentRoot, target: path.join(root, 'agent-configs'), backup: path.join(stage, 'previous-agents') },
  ];
  if (check) {
    const differences = [];
    for (const target of targets) {
      for (const name of await compareTrees(target.staged, target.target)) differences.push(`${path.relative(root, target.target)}/${name}`);
    }
    if (differences.length) throw new Error(`Generated output is stale (${differences.length} files):\n${differences.join('\n')}`);
    return { checked: true, skills: built.manifest.skills.length, source: built.lock.commit };
  }
  const changed = [];
  try {
    for (const target of targets) {
      await assertNoSymlinks(target.target);
      await mkdir(path.dirname(target.target), { recursive: true });
      const previous = await exists(target.target);
      if (previous) await rename(target.target, target.backup);
      const step = { ...target, previous, published: false };
      changed.push(step);
      await rename(target.staged, target.target);
      step.published = true;
    }
  } catch (error) {
    for (const step of changed.reverse()) {
      if (step.published) await rename(step.target, `${step.backup}-failed`);
      if (step.previous) await rename(step.backup, step.target);
    }
    throw error;
  }
  return { generated: true, skills: built.manifest.skills.length, playbooks: built.lock.counts.playbooks, agents: 2, source: built.lock.commit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log('node scripts/generate.mjs [--check]\nBuilds a checked staging tree. --check compares without changing managed outputs. Staging/backups remain recoverable in .pstack/generation.');
    else {
      if (args.some((arg) => arg !== '--check')) throw new Error('Unknown generator argument');
      console.log(json(await generate({ check: args.includes('--check') })));
    }
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
