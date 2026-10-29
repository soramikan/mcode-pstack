import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { syncUpstream } from '../../scripts/sync-upstream.mjs';
import { gitBlobHash, treeHash, treeRecords } from '../../scripts/lib/tree.mjs';
const sandbox = fileURLToPath(new URL('../.sandbox/sync/', import.meta.url));
const oldCommit = 'a'.repeat(40), newCommit = 'b'.repeat(40);
async function fixture() { await mkdir(sandbox, { recursive: true }); return mkdtemp(path.join(sandbox, 'case-')); }
function fakeNetwork(t) {
  const prior = globalThis.fetch;
  const make = (version) => new Map([
    ['pstack/plugin.json', Buffer.from(JSON.stringify({ name: 'pstack', version, license: 'MIT' }))],
    ['pstack/LICENSE', Buffer.from('MIT Fixture\n')],
    ['pstack/skills/example/SKILL.md', Buffer.from(`---\nname: example\ndescription: Fixture\n---\n${version}\n`)],
    ['scripts/generate-pstack-harness-trees.mjs', Buffer.from(`// generator ${version}\n`)],
  ]);
  const sources = new Map([[oldCommit, make('0.0.1')], [newCommit, make('0.0.2')]]);
  globalThis.fetch = async (url) => {
    const u = String(url);
    const treeCommit = u.match(/\/git\/trees\/([a-f0-9]{40})\?recursive=1/)?.[1];
    if (treeCommit) return new Response(JSON.stringify({ truncated: false, tree: [...sources.get(treeCommit)].map(([name, bytes]) => ({ path: name, type: 'blob', mode: '100644', sha: gitBlobHash(bytes) })) }));
    const raw = u.match(/raw\.githubusercontent\.com\/cursor\/plugins\/([a-f0-9]{40})\/(.+)$/);
    if (raw && sources.get(raw[1])?.has(raw[2])) return new Response(sources.get(raw[1]).get(raw[2]));
    throw new Error(`Unexpected network request in fixture: ${u}`);
  };
  t.after(() => { globalThis.fetch = prior; });
}
test('sync: remote preview does not create directories or change files', async (t) => {
  fakeNetwork(t);
  const root = await fixture();
  const preview = await syncUpstream({ root, commit: oldCommit });
  assert.equal(preview.mode, 'preview');
  assert.equal(preview.sourceFiles, 3);
  assert.deepEqual(await readdir(root), []);
});
test('sync: three source outputs roll back together after generator publication failure', async (t) => {
  fakeNetwork(t);
  const root = await fixture();
  await syncUpstream({ root, commit: oldCommit, write: true });
  const before = {
    source: treeHash(await treeRecords(path.join(root, 'vendor/pstack'))),
    generator: await readFile(path.join(root, 'vendor/upstream-generator.mjs'), 'utf8'),
    lock: await readFile(path.join(root, 'upstream.lock.json'), 'utf8'),
  };
  await assert.rejects(syncUpstream({ root, commit: newCommit, write: true, onPhase(phase) { if (phase === 'published:generator') throw Object.assign(new Error('Injected EACCES lock publication failure'), { code: 'EACCES' }); } }), /Injected EACCES/);
  assert.equal(treeHash(await treeRecords(path.join(root, 'vendor/pstack'))), before.source);
  assert.equal(await readFile(path.join(root, 'vendor/upstream-generator.mjs'), 'utf8'), before.generator);
  assert.equal(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'), before.lock);
  await syncUpstream({ root, commit: newCommit, write: true });
  assert.match(await readFile(path.join(root, 'vendor/upstream-generator.mjs'), 'utf8'), /0\.0\.2/);
});
test('sync: staging symlink is rejected before any directory is created through it', async (t) => {
  fakeNetwork(t);
  const root = await fixture();
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await mkdir(path.join(root, '.pstack'));
  await symlink(outside, path.join(root, '.pstack/sync'), 'dir');
  await assert.rejects(syncUpstream({ root, commit: oldCommit, write: true }), /Symlink/);
  assert.deepEqual(await readdir(outside), []);
});
