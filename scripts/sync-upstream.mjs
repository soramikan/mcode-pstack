import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename } from 'node:fs/promises';
import { assertNoSymlinks, atomicWrite, exists, gitBlobHash, json, safeRelative, sha256, treeHash, treeRecords, writeTreeFile } from './lib/tree.mjs';

export const PINNED_COMMIT = '1ba91fc25c0977741dd0e267849e6234b037ed0a';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'cursor/plugins';
async function request(url, binary = false) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'mcode-pstack-source-sync', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
    } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1))); }
  }
  throw last;
}
import { withRepositoryLock } from './lib/lock.mjs';

export async function syncUpstream(options = {}) {
  return options.write ? withRepositoryLock(options.root ?? ROOT, 'sync', () => performSync(options)) : performSync(options);
}
async function performSync({ commit = PINNED_COMMIT, write = false, root = ROOT, onPhase } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('A full immutable commit SHA is required');
  await assertNoSymlinks(root);
  const tree = await request(`https://api.github.com/repos/${REPOSITORY}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error('GitHub tree was truncated; refusing an incomplete source snapshot');
  const blobs = tree.tree.filter((item) => item.path.startsWith('pstack/') && item.type === 'blob');
  if (blobs.length === 0 || blobs.length > 1024) throw new Error(`Unexpected source file count: ${blobs.length}`);
  for (const blob of blobs) {
    safeRelative(blob.path.slice('pstack/'.length));
    if (!['100644', '100755'].includes(blob.mode)) throw new Error(`Unsupported source mode: ${blob.path} ${blob.mode}`);
  }
  let previous;
  const lockFile = path.join(root, 'upstream.lock.json');
  if (await exists(lockFile)) previous = JSON.parse(await readFile(lockFile, 'utf8'));
  const before = previous?.files ?? {};
  const names = blobs.map((blob) => blob.path.slice('pstack/'.length)).sort();
  const report = {
    commit, sourceFiles: names.length,
    added: names.filter((name) => !(name in before)),
    removed: Object.keys(before).filter((name) => !names.includes(name)),
    changed: blobs.filter((blob) => before[blob.path.slice(7)] && before[blob.path.slice(7)].gitBlob !== blob.sha).map((blob) => blob.path.slice(7)),
    mode: write ? 'write' : 'preview',
  };
  if (!write) return report;
  // Never silently rebase learned overrides against a different source revision.
  if (previous && previous.commit !== commit) {
    const compatibilityPath = path.join(root, 'adapters/minimax-code/compatibility.json');
    if (await exists(compatibilityPath)) {
      const compatibility = JSON.parse(await readFile(compatibilityPath, 'utf8'));
      if (compatibility.upstreamCommit && compatibility.upstreamCommit !== commit) {
        throw new Error('Upstream changed: review/rebase adapter override hashes and compatibility inventory before --write');
      }
    }
  }
  if (previous && await exists(path.join(root, 'vendor/pstack'))) {
    const actual = await treeRecords(path.join(root, 'vendor/pstack'));
    if (treeHash(actual) !== previous.treeSha256) throw new Error('Vendored source was modified; refusing to overwrite it');
  }
  const id = randomUUID();
  const stagingRoot = path.join(root, '.pstack/sync', id);
  const sourceRoot = path.join(stagingRoot, 'pstack');
  await assertNoSymlinks(sourceRoot);
  await mkdir(sourceRoot, { recursive: true });
  const files = {};
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < blobs.length) {
      const blob = blobs[next++];
      const name = blob.path.slice(7);
      const bytes = await request(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${blob.path}`, true);
      if (bytes.length > 16 * 1024 * 1024 || gitBlobHash(bytes) !== blob.sha) throw new Error(`Git blob verification failed: ${blob.path}`);
      await writeTreeFile(sourceRoot, name, bytes);
      files[name] = { sha256: sha256(bytes), bytes: bytes.length, gitBlob: blob.sha };
    }
  }));
  const generatorPath = 'scripts/generate-pstack-harness-trees.mjs';
  const generatorBlob = tree.tree.find((item) => item.path === generatorPath && item.type === 'blob');
  if (!generatorBlob) throw new Error('Upstream harness generator not found');
  const generator = await request(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${generatorPath}`, true);
  if (gitBlobHash(generator) !== generatorBlob.sha) throw new Error('Upstream generator blob mismatch');
  const metadata = JSON.parse(await readFile(path.join(sourceRoot, 'plugin.json'), 'utf8'));
  const skills = names.filter((name) => /^skills\/[^/]+\/SKILL\.md$/.test(name));
  const playbooks = names.filter((name) => /^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(name));
  const agents = names.filter((name) => /^agents\/[^/]+\.md$/.test(name));
  const records = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const lock = {
    schemaVersion: 1, repository: `https://github.com/${REPOSITORY}`, commit, version: metadata.version,
    license: metadata.license, treeSha256: treeHash(records), counts: { files: names.length, skills: skills.length, playbooks: playbooks.length, agents: agents.length },
    referenceHost: { version: '0.6.5', revision: 'ae75db3a770d945fee4505497daa970df7d09e73', workingTreeModified: true },
    generator: { path: generatorPath, gitBlob: generatorBlob.sha, sha256: sha256(generator) }, files: records,
  };
  await assertNoSymlinks(path.join(root, 'vendor'));
  await mkdir(path.join(root, 'vendor'), { recursive: true });
  await writeTreeFile(stagingRoot, 'upstream-generator.mjs', generator);
  await writeTreeFile(stagingRoot, 'upstream.lock.json', json(lock));
  const outputs = [
    { name: 'pstack', staged: sourceRoot, target: path.join(root, 'vendor/pstack'), expected: lock.treeSha256, directory: true },
    { name: 'generator', staged: path.join(stagingRoot, 'upstream-generator.mjs'), target: path.join(root, 'vendor/upstream-generator.mjs'), expected: sha256(generator) },
    { name: 'lock', staged: path.join(stagingRoot, 'upstream.lock.json'), target: lockFile, expected: sha256(json(lock)) },
  ];
  // Fetching can take time. Recheck source ownership immediately before commit.
  if (previous && treeHash(await treeRecords(outputs[0].target)) !== previous.treeSha256) throw new Error('Vendored source changed during sync; refusing publication');
  const applied = [];
  try {
    for (const output of outputs) {
      await assertNoSymlinks(output.target);
      const step = { ...output, backup: path.join(stagingRoot, `previous-${output.name}`), hadPrevious: await exists(output.target), published: false };
      if (step.hadPrevious) await rename(step.target, step.backup);
      applied.push(step);
      await rename(step.staged, step.target);
      step.published = true;
      if (onPhase) await onPhase(`published:${step.name}`);
    }
  } catch (error) {
    try {
      for (const step of applied.reverse()) {
        if (step.published) {
          const current = step.directory ? treeHash(await treeRecords(step.target)) : sha256(await readFile(step.target));
          if (current !== step.expected) throw new Error(`Concurrent edit prevents rollback of ${step.name}; inspect ${stagingRoot}`);
          await rename(step.target, path.join(stagingRoot, `failed-${step.name}`));
        }
        if (step.hadPrevious) await rename(step.backup, step.target);
      }
    } catch (recoveryError) {
      const stopped = new Error(`${error.message}; recovery required: ${recoveryError.message}`);
      stopped.retainRepositoryLock = true;
      throw stopped;
    }
    throw error;
  }
  return { ...report, counts: lock.counts, treeSha256: lock.treeSha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log('node scripts/sync-upstream.mjs [--commit <40-char SHA>] [--write]\nDefault is a read-only remote inventory preview. Only --write updates vendor and the lock.');
    else {
      if (args.some((arg, index) => arg !== '--write' && arg !== '--commit' && args[index - 1] !== '--commit')) throw new Error('Unknown argument');
      const commitIndex = args.indexOf('--commit');
      console.log(json(await syncUpstream({ commit: commitIndex < 0 ? PINNED_COMMIT : args[commitIndex + 1], write: args.includes('--write') })));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
