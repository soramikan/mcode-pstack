import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, symlink, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { safeRelative, within, treeRecords, treeHash, assertNoSymlinks, writeTreeFile } from '../../scripts/lib/tree.mjs';
import { withRepositoryLock } from '../../scripts/lib/lock.mjs';
import { verifySource, includeSource, compareTrees } from '../../scripts/generate.mjs';
import { frontmatter, legacyViolations } from '../../scripts/validate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = path.join(root, 'tests/.sandbox/generation');
async function fixture() { await mkdir(sandbox, { recursive: true }); return mkdtemp(path.join(sandbox, 'case-')); }

test('generation: source snapshot verifies all 573 Git-pinned files', async () => {
  const lock = await verifySource(root);
  assert.equal(lock.commit, '1ba91fc25c0977741dd0e267849e6234b037ed0a');
  assert.deepEqual(lock.counts, { files: 573, skills: 58, playbooks: 23, agents: 2 });
  assert.equal(lock.version, '0.15.36');
});
test('generation: output file boundaries reject portable-path escapes', () => {
  for (const name of ['../escape', '/escape', 'a/../b', 'a\\b', 'a//b', 'a/./b', 'a\0b', '日本語.md']) assert.throws(() => safeRelative(name));
  assert.equal(safeRelative('.minimax-plugin/plugin.json'), '.minimax-plugin/plugin.json');
  assert.equal(within('/repo/package', '/repo/package-old'), false);
  assert.equal(within('/repo/package', '/repo/package/a'), true);
});
test('generation: no symlink ancestor can redirect generated content', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'actual'));
  await symlink(path.join(dir, 'actual'), path.join(dir, 'alias'), 'dir');
  await assert.rejects(assertNoSymlinks(path.join(dir, 'alias/absent/file')), /Symlink/);
  await assert.rejects(writeTreeFile(path.join(dir, 'alias'), 'file', 'unsafe'), /Symlink/);
});
test('generation: deterministic tree hashes and byte-level drift detection', async () => {
  const dir = await fixture();
  const a = path.join(dir, 'a'); const b = path.join(dir, 'b');
  await writeTreeFile(a, 'sub/z.txt', 'z'); await writeTreeFile(a, 'a.txt', 'a');
  await writeTreeFile(b, 'a.txt', 'a'); await writeTreeFile(b, 'sub/z.txt', 'z');
  assert.equal(treeHash(await treeRecords(a)), treeHash(await treeRecords(b)));
  assert.deepEqual(await compareTrees(a, b), []);
  await writeTreeFile(b, 'sub/z.txt', 'changed');
  assert.deepEqual(await compareTrees(a, b), ['sub/z.txt']);
});
test('generation: repository locks serialize publishers and preserve recovery evidence', async () => {
  const dir = await fixture();
  let entered = false;
  await withRepositoryLock(dir, 'generate', async () => {
    entered = true;
    await assert.rejects(withRepositoryLock(dir, 'generate', async () => {}), /lock exists/);
  });
  assert.equal(entered, true);
  await withRepositoryLock(dir, 'generate', async () => {});
});
test('generation: only runtime closure is copied, not tests or cloud automation', () => {
  assert.equal(includeSource('skills/poteto-mode/SKILL.md'), true);
  assert.equal(includeSource('skills/statechart/scripts/run.ts'), true);
  assert.equal(includeSource('skills/statechart/scripts/test/model.test.ts'), false);
  assert.equal(includeSource('skills/poteto-mode/scripts/check-plan.test.ts'), false);
  assert.equal(includeSource('agents/poteto-agent.md'), false);
  assert.equal(includeSource('plugin.json'), false);
  assert.equal(includeSource('automations/benny/README.md'), false);
  assert.equal(includeSource('docs/harness/claude-code.md'), false);
});
test('generation: valid frontmatter survives and unsafe legacy instructions fail detection', () => {
  assert.equal(frontmatter('---\nname: test\ndescription: Test\n---\nBody', 'fixture').name, 'test');
  assert.throws(() => frontmatter('---\nname: test\nname: duplicate\ndescription: Test\n---\n', 'fixture'), /Invalid YAML/);
  assert.throws(() => frontmatter('---\nname: test\n---\n', 'fixture'), /description/);
  const legacy = 'Task({ subagent_type: "x", cloud_base_branch: "a", readonly: false });\n/loop 1h\n~/.cursor/rules/a\nbun install\nrm -rf cache';
  assert.ok(legacyViolations(legacy).length >= 7);
  assert.deepEqual(legacyViolations('task({ agent_name: "explore", description: "調査", prompt: "Read only" })'), []);
});
