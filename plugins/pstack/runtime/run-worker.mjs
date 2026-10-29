import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { acquireRun, isStoppedTask } from './run-state.mjs';
import { parseModelKey, validateRole } from './config.mjs';
import { cliInput, identifier, inside, isMain, record, safePath } from './safety.mjs';

const own = (o, k) => Object.hasOwn(o, k);
function bounded(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be bounded (${min}..${max})`);
  return value;
}

/** Metadata must be supplied by an approved, current catalog/session snapshot.
 * No general config, provider-name inference, or implicit CLI default lookup. */
export function resolveWorkerSelection({ selection = { model: 'inherit-parent' }, parent, catalog }) {
  selection = validateRole(selection);
  const inherited = !selection.model || selection.model === 'inherit-parent';
  if (inherited && (!record(parent) || !own(parent, 'model') || !own(parent, 'effort'))) throw new Error('inherit-parent requires effective parent model AND effort metadata');
  const model = inherited ? parent.model : selection.model;
  const identity = parseModelKey(model);
  if (!Array.isArray(catalog)) throw new Error('explicit model catalog metadata required');
  const matches = catalog.filter(entry => entry.key === model);
  if (matches.length !== 1) throw new Error('exact model missing or ambiguous in approved catalog');
  const meta = matches[0];
  if (!Array.isArray(meta.effortOptions) || meta.effortOptions.some(e => typeof e !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(e)) || !own(meta, 'defaultEffort') || !own(meta, 'variant') || !(meta.variant === null || typeof meta.variant === 'string')) throw new Error('incomplete model/effort/variant metadata');
  if (meta.defaultEffort !== null && !meta.effortOptions.includes(meta.defaultEffort)) throw new Error('invalid catalog default effort');
  const effort = own(selection, 'effort') ? selection.effort : inherited ? parent.effort : meta.defaultEffort;
  const effortSource = own(selection, 'effort') ? 'explicit' : inherited ? 'parent-effective' : 'model-default';
  if (effort !== null && !meta.effortOptions.includes(effort)) throw new Error('effort is not supported by selected model');
  if (effort === null && (meta.effortOptions.length || meta.defaultEffort !== null)) throw new Error('null effort only supported for explicitly effort-inapplicable models');
  if (identity.variant !== undefined && meta.variant !== identity.variant) throw new Error('catalog variant conflicts with exact model key');
  const variant = identity.variant ?? meta.variant;
  if (effort !== null && ['', 'none-thinking'].includes(variant)) throw new Error('effort incompatible with thinking-off variant');
  return { model, identity: { ...identity, ...(variant === null ? {} : { variant }) }, effort, effortSource, modelSource: inherited ? 'parent-effective' : 'explicit', ...(selection.family ? { family: selection.family } : {}), args: ['--model', model, ...(effort !== null && effortSource !== 'model-default' ? ['--effort', effort] : [])] };
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: false }).trim();
}
export function verifyWorktree({ workspace, cwd, approvedWorktrees, baseSHA }) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('absolute workspace/cwd required');
  workspace = safePath(workspace, workspace);
  cwd = safePath(workspace, cwd);
  if (cwd === workspace || !Array.isArray(approvedWorktrees) || !approvedWorktrees.includes(cwd)) throw new Error('explicit approved candidate worktree required');
  const runsRoot = path.join(workspace, '.pstack', 'runs');
  if (inside(path.join(workspace, '.git'), cwd) || inside(runsRoot, cwd) || inside(cwd, runsRoot)) throw new Error('candidate overlaps repository metadata or run-state paths');
  if (typeof baseSHA !== 'string' || !/^[a-f0-9]{40,64}$/.test(baseSHA)) throw new Error('exact base git SHA required');
  if (git(cwd, ['rev-parse', '--show-toplevel']) !== cwd) throw new Error('cwd is not a worktree root');
  const common = dir => path.resolve(dir, git(dir, ['rev-parse', '--git-common-dir']));
  if (common(cwd) !== common(workspace)) throw new Error('worktree belongs to another repository');
  const worktrees = git(workspace, ['worktree', 'list', '--porcelain', '-z']).split('\0').filter(part => part.startsWith('worktree ')).map(part => part.slice(9));
  if (!worktrees.includes(cwd)) throw new Error('cwd is not a registered git worktree');
  if (git(cwd, ['rev-parse', 'HEAD']) !== baseSHA) throw new Error('candidate HEAD does not match approved base SHA');
  return { workspace, cwd, baseSHA };
}

export function validateExecResult(value, expected) {
  if (!record(value) || value.schemaVersion !== 1 || value.type !== 'exec.result' || !['succeeded', 'failed', 'timeout', 'cancelled', 'limit_exceeded'].includes(value.status) || !['runId', 'sessionId', 'turnId'].every(k => typeof value[k] === 'string' && value[k]) || !Number.isFinite(value.durationMs) || value.durationMs < 0) throw new Error('invalid exec.result schemaVersion 1');
  const actual = value.model;
  if (!record(actual) || actual.providerId !== expected.identity.providerId || actual.modelId !== expected.identity.modelId || (actual.variant ?? null) !== (expected.identity.variant ?? null)) throw new Error('actual model/variant does not match approved selection');
  return value;
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true; // Unknown liveness is never stopped.
    throw error;
  }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch (error) {
    // macOS can return EPERM while a process group is exiting. The independent
    // liveness check must still confirm ESRCH before the writer lock is released.
    if (error.code === 'ESRCH' || error.code === 'EPERM') return false;
    throw error;
  }
}
async function waitGroupStopped(pid, durationMs) {
  const end = Date.now() + durationMs;
  while (groupAlive(pid)) {
    if (Date.now() >= end) return false;
    await sleep(20);
  }
  return true;
}

function checkArtifacts(cwd, artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 64) throw new Error('explicit expectedArtifacts array required (empty is allowed)');
  return artifacts.map(relative => {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || !relative || relative.split(/[\\/]/).includes('..')) throw new Error('unsafe artifact path');
    const file = safePath(cwd, path.resolve(cwd, relative));
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('artifact is not a regular file');
    return { path: relative, sizeBytes: stat.size };
  });
}

/** Executes only after opt-in and all metadata/path/permission checks. Inject an
 * executable + executableArgs for an offline fake. No shell, no permission
 * escalation. Shared leases allow bounded candidates; never reuse a task/cwd. */
export async function runWorker(options) {
  const { optIn, permission, permissionConfirmed, timeoutMs, maxSteps, input, workspace, runId, ownerId, taskId, candidateId, cwd, baseSHA, approvedWorktrees, expectedArtifacts, executable = 'mcode', executableArgs = [], signal } = options;
  if (optIn !== true) throw new Error('subprocess execution requires explicit opt-in');
  // permission-core.ts permissionModeToProfile('off') sets enforcement:'off'
  // and bypass:'allowed': off disables enforcement; it is NOT read-only mode.
  if (permission !== 'smart' || permissionConfirmed !== true) throw new Error('explicit confirmed smart required; off/full forbidden and ask unavailable non-interactively');
  bounded(timeoutMs, 1, 3_600_000, 'timeoutMs');
  bounded(maxSteps, 1, 10_000, 'maxSteps');
  const maxOutputBytes = bounded(options.maxOutputBytes ?? 262144, 128, 4 * 1024 * 1024, 'maxOutputBytes');
  const stopGraceMs = bounded(options.stopGraceMs ?? 500, 20, 10000, 'stopGraceMs');
  if (typeof input !== 'string' || Buffer.byteLength(input) > 1024 * 1024) throw new Error('bounded text input required');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('signal must be an AbortSignal');
  if (typeof executable !== 'string' || !executable || executable.includes('\0') || !Array.isArray(executableArgs) || executableArgs.length > 64 || executableArgs.some(a => typeof a !== 'string' || a.includes('\0') || a.length > 4096)) throw new Error('invalid executable');
  identifier(taskId, 'taskId'); identifier(candidateId, 'candidateId');
  const selected = resolveWorkerSelection(options);
  verifyWorktree({ workspace, cwd, approvedWorktrees, baseSHA });
  // Validate paths syntactically before spawn; existence is checked after exit.
  if (!Array.isArray(expectedArtifacts) || expectedArtifacts.length > 64 || expectedArtifacts.some(v => typeof v !== 'string' || !v || path.isAbsolute(v) || v.split(/[\\/]/).includes('..'))) throw new Error('explicit safe expectedArtifacts array required');
  if (signal?.aborted) return { status: 'cancelled', processStopped: true, spawned: false };
  if (process.platform === 'win32') throw new Error('process-group stop confirmation unsupported on Windows');
  const owned = !options.lease;
  const lease = options.lease ?? acquireRun({ workspace, runId, ownerId, maxWorkers: options.maxWorkers ?? 2, provenance: options.provenance });
  if (lease.workspace !== workspace || lease.runId !== runId || lease.ownerId !== ownerId) throw new Error('lease scope/owner mismatch');
  lease.assertOwned();
  if (options.provenance !== undefined) lease.assertProvenance(options.provenance);
  const state = lease.state;
  if (state.outcome.status !== 'PENDING') { if (owned) lease.release(); throw new Error('finalized run outcome; explicitly reopen before starting a writer'); }
  if (state.tasks[taskId] || state.candidates[candidateId]) { if (owned) lease.release(); throw new Error('task/candidate id already used'); }
  if (Object.values(state.tasks).filter(task => !isStoppedTask(task)).length >= state.maxWorkers || Object.values(state.candidates).some(candidate => candidate.cwd === cwd)) { if (owned) lease.release(); throw new Error('worker limit or candidate cwd already reserved'); }
  state.candidates[candidateId] = { cwd, baseSHA, taskId };
  state.tasks[taskId] = { status: 'starting', processStopped: false, candidateId, selection: selected };
  lease.save(state);
  lease.trackProcess(taskId);
  let child;
  let timer;
  let killTimer;
  let reason;
  let closeSeen = false;
  let pid;
  const stdoutChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let spawnError;
  let controlError;
  let stopDeadline;
  let stopDeadlineTimer;
  const requestStop = why => {
    if (reason) return; // A burst of stdout must not repeatedly signal a dying PID.
    reason = why;
    if (!pid) return;
    try { lease.updateTask(taskId, { status: 'stopping', stopReason: reason }); }
    catch (error) { controlError = error; } // Still stop the process on state I/O failure.
    signalGroup(pid, 'SIGTERM');
    killTimer = setTimeout(() => signalGroup(pid, 'SIGKILL'), stopGraceMs);
    // A child holding inherited pipe handles must not make cancellation hang.
    stopDeadlineTimer = setTimeout(() => stopDeadline({ code: null, exitSignal: null }), stopGraceMs + 1500);
  };
  const onCancel = () => requestStop('cancelled');
  const onTerm = () => requestStop('cancelled');
  try {
    child = spawn(executable, [...executableArgs, 'exec', '--cwd', cwd, '--input', '-', '--output-format', 'json', ...selected.args, '--permission', permission, '--timeout', `${timeoutMs}ms`, '--max-steps', String(maxSteps)], { cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    pid = child.pid;
    if (pid) lease.updateTask(taskId, { status: 'running', pid });
    child.stdin.on('error', () => {}); // EPIPE is reflected by exit/result checks.
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) requestStop('limit_exceeded');
      else stdoutChunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > maxOutputBytes) requestStop('limit_exceeded'); });
    const closed = new Promise(resolve => {
      child.on('error', error => { spawnError = error; });
      child.on('close', (code, exitSignal) => { closeSeen = true; resolve({ code, exitSignal }); });
    });
    const stopExpired = new Promise(resolve => { stopDeadline = resolve; });
    timer = setTimeout(() => requestStop('timeout'), timeoutMs);
    signal?.addEventListener('abort', onCancel, { once: true });
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onTerm);
    if (signal?.aborted) onCancel();
    child.stdin.end(input);
    const exit = await Promise.race([closed, stopExpired]);
    clearTimeout(timer);
    // Parent exit is insufficient: descendants can still be running. Stop the
    // entire detached group even on normal completion before releasing the lock.
    if (pid && groupAlive(pid)) requestStop(reason ?? 'failed');
    let stopped = !pid || await waitGroupStopped(pid, stopGraceMs);
    if (!stopped) { signalGroup(pid, 'SIGKILL'); stopped = await waitGroupStopped(pid, Math.max(1000, stopGraceMs)); }
    if (!stopped || !closeSeen) {
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
      lease.updateTask(taskId, { status: 'stop_unknown', processStopped: false });
      throw new Error('process-group stop unconfirmed; lock retained, replacement forbidden');
    }
    if (controlError) throw new Error(`writer state update failed; lock retained: ${controlError.message}`);
    let status = reason ?? 'failed';
    let result;
    let artifacts = [];
    let diagnostic;
    if (!reason && !spawnError) {
      try {
        result = validateExecResult(JSON.parse(Buffer.concat(stdoutChunks).toString('utf8')), selected);
        // HEAD must remain at the approved base. Candidate edits are allowed;
        // candidate commits and a stale/moved base require a new approved run.
        verifyWorktree({ workspace, cwd, approvedWorktrees, baseSHA });
        status = result.status === 'succeeded' && exit.code !== 0 ? 'failed' : result.status;
        if (status === 'succeeded') artifacts = checkArtifacts(cwd, expectedArtifacts);
        if (exit.code !== 0) diagnostic = 'nonzero_exit';
      } catch (error) { status = 'failed'; diagnostic = error.message; }
    } else if (spawnError) diagnostic = `spawn_error:${spawnError.code ?? 'unknown'}`;
    lease.updateTask(taskId, { status, processStopped: true, exitCode: exit.code, exitSignal: exit.exitSignal, artifacts, ...(diagnostic ? { diagnostic } : {}) });
    lease.confirmProcessStopped(taskId);
    if (owned) lease.release();
    return { status, processStopped: true, spawned: Boolean(pid), selection: selected, artifacts, ...(diagnostic ? { diagnostic } : {}), ...(result ? { result } : {}) };
  } catch (error) {
    // Any unexpected exception retains the lease, but must still attempt bounded
    // group termination. Only the normal path writes a confirmed terminal task.
    if (pid && groupAlive(pid)) {
      signalGroup(pid, 'SIGTERM');
      if (!await waitGroupStopped(pid, stopGraceMs)) {
        signalGroup(pid, 'SIGKILL');
        await waitGroupStopped(pid, Math.max(1000, stopGraceMs));
      }
    }
    throw error;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); clearTimeout(stopDeadlineTimer);
    signal?.removeEventListener('abort', onCancel);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onTerm);
  }
}

export const HELP = 'Usage: node run-worker.mjs --help | --request <workspace-relative JSON>\nExecution is OPT-IN. Request requires {optIn:true,workspace:absolute,runId,ownerId,taskId,candidateId,cwd:absolute,approvedWorktrees:[absolute],baseSHA,input,permission:"smart",permissionConfirmed:true,timeoutMs,maxSteps,expectedArtifacts:[],selection:{model:"inherit-parent"|"provider/model",effort?},parent?:{model,effort},catalog:[{key,effortOptions,defaultEffort,variant}]}. Optional provenance:{schemaVersion:1,upstreamCommit,upstreamVersion,adapterVersion,adapterSha256,configSnapshot} is forwarded to acquireRun; otherwise adjacent build-info.json is queried, with missing facts recorded unknown. Task success never sets outcome PASS. No metadata guessing or permission expansion; off/full/ask are rejected before spawn.';
if (isMain(import.meta.url)) cliInput(HELP, runWorker);
