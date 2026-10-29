import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireRun, inspectRun } from '../../adapters/minimax-code/runtime/run-state.mjs';
import { runWorker, resolveWorkerSelection, verifyWorktree } from '../../adapters/minimax-code/runtime/run-worker.mjs';
import { FAKE, repository, workerOptions, waitFor, git } from '../fixtures/runtime/helpers.mjs';

const catalog = [
  { key: 'custom_provider:test/model', effortOptions: ['low', 'high'], defaultEffort: 'low', variant: null },
  { key: 'minimax/other', effortOptions: ['medium', 'max'], defaultEffort: 'medium', variant: null },
  { key: 'custom_provider:test/plain', effortOptions: [], defaultEffort: null, variant: null },
];

test('effective parent effort wins over CLI default; switching model does not inherit effort', () => {
  const parent = { model: 'custom_provider:test/model', effort: 'high' };
  const inherited = resolveWorkerSelection({ parent, catalog });
  assert.deepEqual(inherited.args, ['--model', parent.model, '--effort', 'high']);
  assert.equal(inherited.effortSource, 'parent-effective');
  const switched = resolveWorkerSelection({ selection: { model: 'minimax/other' }, parent, catalog });
  assert.deepEqual(switched.args, ['--model', 'minimax/other']);
  assert.equal(switched.effort, 'medium');
  assert.equal(switched.effortSource, 'model-default');
  const explicit = resolveWorkerSelection({ selection: { model: 'minimax/other', effort: 'max' }, parent, catalog });
  assert.deepEqual(explicit.args, ['--model', 'minimax/other', '--effort', 'max']);
  assert.deepEqual(resolveWorkerSelection({ parent: { model: 'custom_provider:test/plain', effort: null }, catalog }).args, ['--model', 'custom_provider:test/plain']);
  for (const input of [
    { parent: { model: parent.model }, catalog },
    { parent, catalog: undefined },
    { parent, catalog: [{ ...catalog[0], variant: undefined }] },
    { parent, catalog: [{ key: parent.model, effortOptions: ['high'] }] },
    { parent: { model: parent.model, effort: null }, catalog },
    { parent, catalog, selection: { effort: 'invalid' } },
    { parent, catalog, selection: { model: 'minimax/other', effort: 'high' } },
  ]) assert.throws(() => resolveWorkerSelection(input));
});

test('offline exec checks model, artifacts, SHA and distinct gate state', async t => {
  const repo = repository(t, 'worker-success');
  const options = workerOptions(repo);
  const result = await runWorker(options);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.processStopped, true);
  const invocation = JSON.parse(fs.readFileSync(path.join(options.cwd, 'invocation.json'), 'utf8'));
  assert.equal(invocation.cwd, options.cwd);
  assert.equal(invocation.args[invocation.args.indexOf('--effort') + 1], 'high');
  assert.equal(invocation.args[invocation.args.indexOf('--permission') + 1], 'smart');
  const state = inspectRun(options);
  assert.equal(state.candidates.candidate.baseSHA, repo.baseSHA);
  assert.equal(state.tasks.task.status, 'succeeded');
  assert.equal(state.gate.status, 'PENDING');
  assert.equal(fs.existsSync(path.join(repo.workspace, '.pstack/runs/run/writer.lock')), false);
});

test('worker forwards provenance/config snapshot but success leaves final outcome pending', async t => {
  const repo = repository(t, 'worker-provenance', 2);
  const provenance = { schemaVersion: 1, upstreamCommit: 'a'.repeat(40), upstreamVersion: '1.0.0-test', adapterVersion: '0.1.0-test', adapterSha256: 'b'.repeat(64), configSnapshot: { schemaVersion: 1, maxWorkers: 2 } };
  const options = workerOptions(repo, { provenance });
  assert.equal((await runWorker(options)).status, 'succeeded');
  const state = inspectRun(options);
  assert.equal(state.ownerId, options.ownerId);
  assert.equal(state.provenance.adapterSha256, provenance.adapterSha256);
  assert.deepEqual(state.provenance.configSnapshot, provenance.configSnapshot);
  assert.equal(state.outcome.status, 'PENDING');
  const lease = acquireRun(options);
  await assert.rejects(runWorker({ ...options, lease, provenance: { ...provenance, adapterVersion: '2.0.0' }, cwd: repo.worktrees[1], taskId: 'second', candidateId: 'second' }), /provenance versions\/config mismatch/);
  assert.equal(fs.existsSync(path.join(repo.worktrees[1], 'started.json')), false);
  lease.save({ ...lease.state, evidence: [{ id: 'independent-review', type: 'test', result: 'passed' }] });
  lease.setOutcome({ status: 'PASS', evidence: ['independent-review'] });
  lease.release();
  await assert.rejects(runWorker({ ...options, cwd: repo.worktrees[1], taskId: 'second', candidateId: 'second' }), /finalized run outcome/);
  assert.equal(fs.existsSync(path.join(repo.worktrees[1], 'started.json')), false);
  assert.equal(fs.existsSync(path.join(repo.workspace, '.pstack/runs/run/writer.lock')), false);
});

test('model switch omits parent effort and records model default', async t => {
  const repo = repository(t, 'switch');
  const result = await runWorker(workerOptions(repo, { catalog, selection: { model: 'minimax/other' } }));
  assert.equal(result.status, 'succeeded');
  assert.equal(result.selection.effort, 'medium');
  const invocation = JSON.parse(fs.readFileSync(path.join(repo.worktrees[0], 'invocation.json'), 'utf8'));
  assert.equal(invocation.args.includes('--effort'), false);
});

test('opt-in, permissions, bounds, missing metadata and unsafe cwd refuse BEFORE spawn', async t => {
  const repo = repository(t, 'preflight');
  const base = workerOptions(repo);
  for (const patch of [
    { optIn: false }, { permission: 'off' }, { permission: 'full' }, { permission: 'ask' }, { permissionConfirmed: false },
    { timeoutMs: undefined }, { maxSteps: undefined }, { maxOutputBytes: Infinity },
    { parent: { model: base.parent.model } }, { catalog: undefined },
    { selection: { effort: 'unavailable' } }, { approvedWorktrees: [] },
    { cwd: repo.workspace }, { baseSHA: '0'.repeat(40) }, { expectedArtifacts: ['../outside'] },
  ]) await assert.rejects(runWorker({ ...base, ...patch }));
  assert.equal(fs.existsSync(path.join(repo.worktrees[0], 'started.json')), false);
  const linked = path.join(repo.workspace, 'linked'); fs.symlinkSync(repo.worktrees[0], linked);
  assert.throws(() => verifyWorktree({ ...base, cwd: linked, approvedWorktrees: [linked] }), /symlink/);
  const other = repository(t, 'other-repo');
  assert.throws(() => verifyWorktree({ ...base, cwd: other.worktrees[0], approvedWorktrees: [other.worktrees[0]] }), /outside/);
});

test('off disables enforcement, so even confirmed off/full/ask are rejected before spawn', async t => {
  const repo = repository(t, 'permission-off-rejection');
  const options = workerOptions(repo);
  for (const permission of ['off', 'full', 'ask']) {
    await assert.rejects(runWorker({ ...options, permission, permissionConfirmed: true }), /confirmed smart required/);
  }
  assert.equal(fs.existsSync(path.join(options.cwd, 'started.json')), false);
  assert.equal(fs.existsSync(path.join(repo.workspace, '.pstack')), false, 'permission rejection precedes lock/state creation');
});

for (const scenario of ['failed', 'nonzero', 'broken', 'schema2', 'mismodel', 'misvariant', 'no-artifact', 'timeout', 'cancelled', 'limit_exceeded']) {
  test(`exec result/exit validation: ${scenario}`, async t => {
    const repo = repository(t, `failure-${scenario}`);
    const result = await runWorker(workerOptions(repo, { executableArgs: [FAKE, '--scenario', scenario] }));
    assert.equal(result.status, ['timeout', 'cancelled', 'limit_exceeded'].includes(scenario) ? scenario : 'failed');
    assert.equal(result.processStopped, true);
    const lease = acquireRun({ workspace: repo.workspace, runId: 'run', ownerId: 'replacement' });
    lease.release();
  });
}

test('timeout and SIGTERM-resistant process stop before unlock', async t => {
  const repo = repository(t, 'timeout');
  const options = workerOptions(repo, { timeoutMs: 400, stopGraceMs: 40, executableArgs: [FAKE, '--scenario', 'ignore-term'] });
  const running = runWorker(options);
  await waitFor(path.join(options.cwd, 'started.json'));
  assert.throws(() => acquireRun(options), /locked/);
  const result = await running;
  assert.equal(result.status, 'timeout');
  const pid = JSON.parse(fs.readFileSync(path.join(options.cwd, 'started.json'), 'utf8')).pid;
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  assert.equal(inspectRun(options).tasks.task.processStopped, true);
});

test('cancellation retains lock until process-group stop, replacement writer refused', async t => {
  const repo = repository(t, 'cancel');
  const abort = new AbortController();
  const options = workerOptions(repo, { signal: abort.signal, stopGraceMs: 100, executableArgs: [FAKE, '--scenario', 'ignore-term'] });
  const running = runWorker(options);
  await waitFor(path.join(options.cwd, 'started.json'));
  abort.abort();
  assert.throws(() => acquireRun(options), /locked/);
  const result = await running;
  assert.equal(result.status, 'cancelled');
  const replaced = acquireRun(options); replaced.release();
});

test('SIGTERM received by runner cancels child before unlocking', async t => {
  const repo = repository(t, 'runner-sigterm');
  const options = workerOptions(repo, { stopGraceMs: 40, executableArgs: [FAKE, '--scenario', 'ignore-term'] });
  const running = runWorker(options);
  await waitFor(path.join(options.cwd, 'started.json'));
  process.emit('SIGTERM'); // Exercise the registered host handler, not the test harness.
  assert.throws(() => acquireRun(options), /locked/);
  assert.equal((await running).status, 'cancelled');
});

test('timeout stops the whole group including a descendant', async t => {
  const repo = repository(t, 'group-stop');
  const options = workerOptions(repo, { timeoutMs: 500, stopGraceMs: 100, executableArgs: [FAKE, '--scenario', 'descendant'] });
  const running = runWorker(options);
  await waitFor(path.join(options.cwd, 'descendant.json'));
  const childPid = JSON.parse(fs.readFileSync(path.join(options.cwd, 'descendant.json'), 'utf8')).pid;
  const result = await running;
  assert.equal(result.status, 'timeout');
  assert.throws(() => process.kill(childPid, 0), error => error.code === 'ESRCH');
});

test('pre-aborted cancellation does not spawn or create a run lock', async t => {
  const repo = repository(t, 'preabort');
  const abort = new AbortController(); abort.abort();
  const result = await runWorker(workerOptions(repo, { signal: abort.signal }));
  assert.equal(result.spawned, false);
  assert.equal(result.status, 'cancelled');
  assert.equal(fs.existsSync(path.join(repo.worktrees[0], 'started.json')), false);
  assert.equal(fs.existsSync(path.join(repo.workspace, '.pstack/runs/run/writer.lock')), false);
});

test('stdout limit terminates child without parsing unbounded JSON', async t => {
  const repo = repository(t, 'stdout-limit');
  const result = await runWorker(workerOptions(repo, { maxOutputBytes: 1024, executableArgs: [FAKE, '--scenario', 'too-much'] }));
  assert.equal(result.status, 'limit_exceeded');
  assert.equal(result.processStopped, true);
});

test('two candidates use separate approved cwd with shared exclusive owner lease', async t => {
  const repo = repository(t, 'parallel', 2);
  const options = workerOptions(repo);
  const lease = acquireRun(options);
  const a = runWorker({ ...options, lease });
  const b = runWorker({ ...options, lease, cwd: repo.worktrees[1], taskId: 'task-b', candidateId: 'candidate-b' });
  assert.throws(() => acquireRun(options), /locked/, 'same owner cannot start a replacement writer');
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map(r => r.status), ['succeeded', 'succeeded']);
  const cwdA = JSON.parse(fs.readFileSync(path.join(repo.worktrees[0], 'invocation.json'), 'utf8')).cwd;
  const cwdB = JSON.parse(fs.readFileSync(path.join(repo.worktrees[1], 'invocation.json'), 'utf8')).cwd;
  assert.notEqual(cwdA, cwdB);
  assert.equal(Object.keys(lease.state.tasks).length, 2);
  lease.release();
});

test('worker limit and cwd reservation are enforced before a second spawn', async t => {
  const repo = repository(t, 'maxworkers', 2);
  const options = workerOptions(repo);
  const lease = acquireRun({ ...options, maxWorkers: 1 });
  const abort = new AbortController();
  const first = runWorker({ ...options, lease, signal: abort.signal, executableArgs: [FAKE, '--scenario', 'slow'] });
  await waitFor(path.join(options.cwd, 'started.json'));
  await assert.rejects(runWorker({ ...options, lease, cwd: repo.worktrees[1], taskId: 'second', candidateId: 'second' }), /worker limit/);
  assert.equal(fs.existsSync(path.join(repo.worktrees[1], 'started.json')), false);
  abort.abort();
  assert.equal((await first).status, 'cancelled');
  await assert.rejects(runWorker({ ...options, lease, taskId: 'third', candidateId: 'third' }), /cwd already reserved/);
  lease.release();
});

test('spawn failure is terminal and does not keep a phantom live process', async t => {
  const repo = repository(t, 'spawn-failure');
  const result = await runWorker(workerOptions(repo, { executable: path.join(repo.workspace, 'missing-mcode'), executableArgs: [] }));
  assert.equal(result.status, 'failed');
  assert.equal(result.processStopped, true);
  assert.match(result.diagnostic, /spawn_error:ENOENT/);
});

test('changed base and artifact symlink are rejected', async t => {
  const repo = repository(t, 'base-and-artifact');
  const options = workerOptions(repo);
  fs.symlinkSync(path.join(repo.workspace, 'synthetic-outside'), path.join(options.cwd, 'linked.txt'));
  const result = await runWorker({ ...options, expectedArtifacts: ['linked.txt'] });
  assert.equal(result.status, 'failed');
  git(options.cwd, 'commit', '--allow-empty', '-qm', 'different base');
  assert.throws(() => verifyWorktree(options), /base SHA/);
});
