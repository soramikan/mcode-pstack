import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FAKE = fileURLToPath(new URL('./fake-mcode.mjs', import.meta.url));
export function sandbox(t, label) {
  const dir = path.join(ROOT, 'tests', '.sandbox', 'runtime', `${label}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  // Cleanup is registered with the standard node:test lifecycle, scoped to a
  // unique synthetic directory; never touches home or system temp.
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function json(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Synthetic Test', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid', GIT_COMMITTER_NAME: 'Synthetic Test', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function repository(t, label, count = 1) {
  const workspace = sandbox(t, label);
  git(workspace, 'init', '-q');
  git(workspace, 'commit', '--allow-empty', '-qm', 'synthetic base');
  const baseSHA = git(workspace, 'rev-parse', 'HEAD');
  const worktrees = Array.from({ length: count }, (_, i) => path.join(workspace, `candidate-${i}`));
  for (const cwd of worktrees) git(workspace, 'worktree', 'add', '--detach', cwd, baseSHA);
  return { workspace, baseSHA, worktrees };
}
export function workerOptions(repo, extra = {}) {
  return { optIn: true, workspace: repo.workspace, cwd: repo.worktrees[0], approvedWorktrees: repo.worktrees, baseSHA: repo.baseSHA, runId: 'run', ownerId: 'owner', taskId: 'task', candidateId: 'candidate', input: 'Synthetic bounded task', permission: 'smart', permissionConfirmed: true, timeoutMs: 2500, maxSteps: 3, expectedArtifacts: ['artifact.txt'], selection: { model: 'inherit-parent' }, parent: { model: 'custom_provider:test/model', effort: 'high' }, catalog: [{ key: 'custom_provider:test/model', effortOptions: ['low', 'high'], defaultEffort: 'low', variant: null }], executable: process.execPath, executableArgs: [FAKE], ...extra };
}
export async function waitFor(file, timeout = 2500) {
  const end = Date.now() + timeout;
  while (!fs.existsSync(file)) {
    if (Date.now() >= end) throw new Error(`fixture not started: ${file}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
