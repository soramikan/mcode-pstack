import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateConfig } from './config.mjs';
import { atomicJson, cliInput, ensureDirectory, identifier, isMain, readJson, readText, record, safePath } from './safety.mjs';

// Canonical upstream decision-log-template.tsv columns. JSON state retains only
// a row-count/checksum index; decisions and superseding decisions live in TSV.
export const DECISION_COLUMNS = Object.freeze(['ts', 'phase', 'decision', 'why', 'evidence', 'result']);
export const DECISION_HEADER = `${DECISION_COLUMNS.join('\t')}\n`;
const MAX_DECISION_BYTES = 4 * 1024 * 1024;
const digest = text => createHash('sha256').update(text).digest('hex');
function decisionCell(value) {
  const text = value.replace(/[\t\r\n\u2028\u2029]+/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
}
function readDecisionIndex(workspace, dir) {
  const legacy = safePath(workspace, path.join(dir, 'decisions.jsonl'), { missing: true });
  try { fs.lstatSync(legacy); throw new Error('legacy JSON decision log present; manual inspection required'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const text = readText(workspace, path.join(dir, 'decisions.tsv'), MAX_DECISION_BYTES);
  if (!text.startsWith(DECISION_HEADER) || !text.endsWith('\n') || /[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u.test(text)) throw new Error('corrupt decisions.tsv header or line boundary; manual inspection required');
  const body = text.slice(DECISION_HEADER.length);
  const lines = body ? body.slice(0, -1).split('\n') : [];
  for (const line of lines) {
    const cells = line.split('\t');
    if (cells.length !== DECISION_COLUMNS.length || cells.slice(0, 3).some(cell => !cell.trim()) || cells.some(cell => /^\s*[=+\-@]/u.test(cell))) throw new Error('corrupt decisions.tsv row; manual inspection required');
  }
  return { count: lines.length, hash: digest(text), bytes: Buffer.byteLength(text) };
}
function assertDecisionIndex(workspace, dir, state) {
  const index = readDecisionIndex(workspace, dir);
  if (index.count !== state.decisionCount || index.hash !== state.decisionHash) throw new Error('decisions TSV index/checksum mismatch; manual inspection required');
  return index;
}
const PROVENANCE_KEYS = ['upstreamCommit', 'upstreamVersion', 'adapterVersion', 'adapterSha256', 'configSnapshot'];
function provenanceFields(input) {
  if (!record(input) || input.schemaVersion !== 1) throw new Error('invalid provenance schemaVersion');
  const value = { schemaVersion: 1 };
  for (const key of PROVENANCE_KEYS.slice(0, 4)) {
    value[key] = input[key] ?? null;
    if (value[key] === null) continue;
    const valid = key === 'upstreamCommit' ? /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value[key]) : key === 'adapterSha256' ? /^[a-f0-9]{64}$/.test(value[key]) : typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value[key]);
    if (typeof value[key] !== 'string' || !valid) throw new Error(`invalid provenance ${key}`);
  }
  value.configSnapshot = input.configSnapshot == null ? null : validateConfig(input.configSnapshot);
  return value;
}
/** No discovery/general config reads. Missing source build-info remains unknown;
 * even complete revision metadata is NOT evidence of live verification. */
export function resolveRunProvenance(provenance) {
  let source = 'explicit';
  const diagnostics = [];
  if (provenance === undefined) {
    const file = fileURLToPath(new URL('./build-info.json', import.meta.url));
    try { provenance = readJson(path.dirname(file), file, 128 * 1024); source = 'build-info'; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      provenance = { schemaVersion: 1 }; source = 'unknown'; diagnostics.push('build_info_missing');
    }
  }
  if (!record(provenance) || Object.keys(provenance).some(key => !['schemaVersion', ...PROVENANCE_KEYS].includes(key))) throw new Error('invalid provenance fields');
  const fields = provenanceFields(provenance);
  for (const key of PROVENANCE_KEYS) if (fields[key] === null) diagnostics.push(`${key}_unknown`);
  return { ...fields, source, diagnostics, metadataComplete: PROVENANCE_KEYS.every(key => fields[key] !== null), liveVerified: false };
}
function validateStoredProvenance(value) {
  const fields = provenanceFields(value);
  if (!['explicit', 'build-info', 'unknown'].includes(value.source) || !Array.isArray(value.diagnostics) || value.diagnostics.some(d => typeof d !== 'string') || value.liveVerified !== false || value.metadataComplete !== PROVENANCE_KEYS.every(key => fields[key] !== null) || !isDeepStrictEqual(value.configSnapshot, fields.configSnapshot) || Object.keys(value).some(key => !['schemaVersion', ...PROVENANCE_KEYS, 'source', 'diagnostics', 'metadataComplete', 'liveVerified'].includes(key))) throw new Error('invalid stored provenance; manual inspection required');
}
const provenanceIdentity = value => Object.fromEntries(PROVENANCE_KEYS.map(key => [key, value[key]]));
const OUTCOMES = new Set(['PENDING', 'PASS', 'ISSUES', 'BLOCKED', 'NOT_RUN']);
const TERMINAL = new Set(['succeeded', 'failed', 'timeout', 'cancelled', 'limit_exceeded', 'rejected']);
export const isStoppedTask = task => TERMINAL.has(task.status) && task.processStopped === true;
export function runDirectory(workspace, runId) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('absolute workspace required');
  identifier(runId, 'runId');
  return safePath(workspace, path.join(workspace, '.pstack', 'runs', runId), { missing: true });
}
function validateState(value, runId) {
  if (!record(value) || value.schemaVersion !== 1 || value.runId !== runId || !record(value.tasks) || !record(value.candidates) || !Array.isArray(value.evidence) || !Number.isSafeInteger(value.decisionCount) || value.decisionCount < 0) throw new Error('invalid run state; manual inspection required');
  identifier(value.ownerId, 'owner session');
  validateStoredProvenance(value.provenance);
  if (!record(value.outcome) || !OUTCOMES.has(value.outcome.status) || !Array.isArray(value.outcome.evidence) || new Set(value.outcome.evidence).size !== value.outcome.evidence.length || value.outcome.evidence.some(id => typeof id !== 'string' || !value.evidence.some(item => record(item) && item.id === id))) throw new Error('invalid outcome or evidence IDs');
  if (!/^[a-f0-9]{64}$/.test(value.decisionHash ?? '')) throw new Error('invalid decisions TSV checksum index; manual inspection required');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('invalid state revision');
  if (!Number.isSafeInteger(value.maxWorkers) || value.maxWorkers < 1 || value.maxWorkers > 32) throw new Error('invalid maxWorkers');
  for (const [id, task] of Object.entries(value.tasks)) {
    identifier(id, 'taskId');
    if (!record(task) || typeof task.status !== 'string') throw new Error('invalid task state');
  }
  for (const [id, candidate] of Object.entries(value.candidates)) {
    identifier(id, 'candidateId');
    if (!record(candidate) || !/^[a-f0-9]{40,64}$/.test(candidate.baseSHA) || typeof candidate.cwd !== 'string') throw new Error('invalid candidate state');
  }
  if (!['PENDING', 'PASS', 'FAIL'].includes(value.gate?.status)) throw new Error('invalid gate state');
  if (value.gate.status === 'PASS' && (!Array.isArray(value.gate.evidence) || !value.gate.evidence.length || value.gate.evidence.some(id => !value.evidence.some(item => record(item) && item.id === id)))) throw new Error('PASS requires independent gate evidence');
  if ((value.outcome.status === 'PASS') !== (value.gate.status === 'PASS') || (value.outcome.status === 'PASS' && !isDeepStrictEqual([...value.outcome.evidence].sort(), [...value.gate.evidence].sort()))) throw new Error('outcome PASS and gate must agree');
  if (value.outcome.status === 'PASS' && (!value.outcome.evidence.length || Object.values(value.tasks).some(task => !isStoppedTask(task)))) throw new Error('PASS requires all writers stopped and independent evidence');
  return value;
}

/** Exclusive writer lease. Existing locks are NEVER stolen, even with the same
 * ownerId or a dead PID. Unknown old task/process liveness fails closed. */
export function acquireRun({ workspace, runId, ownerId, maxWorkers = 2, provenance }) {
  identifier(ownerId, 'ownerId');
  const requestedProvenance = resolveRunProvenance(provenance);
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 32) throw new Error('invalid maxWorkers');
  const dir = runDirectory(workspace, runId);
  ensureDirectory(workspace, dir);
  const lockFile = path.join(dir, 'writer.lock');
  const token = randomUUID();
  let fd;
  try { fd = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('run locked; prior writer stop is unconfirmed (no automatic stale takeover)'); throw error; }
  const lock = { schemaVersion: 1, ownerId, token, pid: process.pid, createdAtMs: Date.now() };
  fs.writeFileSync(fd, JSON.stringify(lock));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  const stateFile = path.join(dir, 'state.json');
  const decisionsFile = path.join(dir, 'decisions.tsv');
  let state;
  try {
    try { state = validateState(readJson(workspace, stateFile), runId); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schemaVersion: 1, runId, ownerId, provenance: requestedProvenance, outcome: { status: 'PENDING', evidence: [] }, maxWorkers, revision: 0, tasks: {}, candidates: {}, evidence: [], decisionCount: 0, decisionHash: digest(DECISION_HEADER), gate: { status: 'PENDING', evidence: [] } };
    }
    if (!isDeepStrictEqual(provenanceIdentity(state.provenance), provenanceIdentity(requestedProvenance))) throw new Error('run provenance versions/config mismatch; explicit review/new run required');
    if (Object.values(state.tasks).some(task => !isStoppedTask(task))) throw new Error('old task/process liveness unknown; restart refused');
    try { assertDecisionIndex(workspace, dir, state); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (state.decisionCount !== 0 || state.decisionHash !== digest(DECISION_HEADER)) throw new Error('decisions.tsv missing; manual inspection required');
      safePath(workspace, decisionsFile, { missing: true });
      const log = fs.openSync(decisionsFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(log, DECISION_HEADER); fs.fsyncSync(log); } finally { fs.closeSync(log); }
      assertDecisionIndex(workspace, dir, state);
    }
    atomicJson(workspace, stateFile, state);
  } catch (error) {
    // Keep the fail-closed lock on uncertain/corrupt prior state.
    throw new Error(`run initialization stopped: ${error.message}`);
  }
  let released = false;
  const processes = new Set();
  function assertOwned() {
    if (released) throw new Error('writer lease released');
    const current = readJson(workspace, lockFile, 8192);
    if (current.token !== token || current.ownerId !== ownerId || current.pid !== process.pid) throw new Error('writer ownership lost');
  }
  function persist(next) {
    assertOwned();
    validateState(next, runId);
    if (next.ownerId !== state.ownerId || !isDeepStrictEqual(next.provenance, state.provenance)) throw new Error('owner session/provenance are immutable run records');
    if (next.outcome.status === 'PASS' && processes.size) throw new Error('PASS requires all tracked writers stopped');
    if (next.revision !== state.revision) throw new Error('stale state revision; reload before writing');
    assertDecisionIndex(workspace, dir, next);
    const value = structuredClone({ ...next, revision: state.revision + 1, updatedAtMs: Date.now() });
    atomicJson(workspace, stateFile, value);
    state = value;
    return structuredClone(state);
  }
  function save(next) {
    if (next.decisionCount !== state.decisionCount || next.decisionHash !== state.decisionHash) throw new Error('decisionCount/checksum are read-only TSV indexes');
    return persist(next);
  }
  return {
    workspace, runId, ownerId, dir,
    get state() { assertOwned(); return structuredClone(state); },
    assertOwned,
    assertProvenance(provenance) {
      assertOwned();
      if (!isDeepStrictEqual(provenanceIdentity(state.provenance), provenanceIdentity(resolveRunProvenance(provenance)))) throw new Error('run provenance versions/config mismatch; explicit review/new run required');
    },
    save,
    setOutcome({ status, evidence = [] }) {
      if (!OUTCOMES.has(status) || !Array.isArray(evidence)) throw new Error('invalid outcome');
      const gateStatus = status === 'PASS' ? 'PASS' : status === 'ISSUES' ? 'FAIL' : 'PENDING';
      return save({ ...state, outcome: { status, evidence: structuredClone(evidence) }, gate: { status: gateStatus, evidence: structuredClone(evidence) } });
    },
    updateTask(taskId, patch) {
      identifier(taskId, 'taskId');
      const next = structuredClone(state);
      next.tasks[taskId] = { ...next.tasks[taskId], ...structuredClone(patch) };
      return save(next);
    },
    trackProcess(taskId) {
      assertOwned();
      if (processes.has(taskId)) throw new Error('process already tracked');
      processes.add(taskId);
    },
    confirmProcessStopped(taskId) { assertOwned(); processes.delete(taskId); },
    appendDecision(decision) {
      assertOwned();
      const index = assertDecisionIndex(workspace, dir, state);
      if (!record(decision) || Object.keys(decision).some(key => ![...DECISION_COLUMNS, 'seq'].includes(key))) throw new Error('invalid decision fields; use canonical TSV columns');
      const seq = state.decisionCount + 1; // Returned index only, never a TSV column.
      if (Object.hasOwn(decision, 'seq') && decision.seq !== seq) throw new Error('decision seq mismatch; append refused');
      const input = { ...decision, ts: decision.ts ?? new Date().toISOString() };
      if (DECISION_COLUMNS.some(key => typeof input[key] !== 'string') || ['ts', 'phase', 'decision'].some(key => !input[key].trim()) || Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) throw new Error('invalid canonical decision row');
      const entry = Object.fromEntries(DECISION_COLUMNS.map(key => [key, decisionCell(input[key])]));
      if (['ts', 'phase', 'decision'].some(key => !entry[key].trim())) throw new Error('empty canonical decision field after sanitization');
      const line = `${DECISION_COLUMNS.map(key => entry[key]).join('\t')}\n`;
      if (index.bytes + Buffer.byteLength(line) > MAX_DECISION_BYTES) throw new Error('decisions.tsv size limit; append refused');
      safePath(workspace, decisionsFile);
      const log = fs.openSync(decisionsFile, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
      try { fs.writeFileSync(log, line); fs.fsyncSync(log); } finally { fs.closeSync(log); }
      const updated = readDecisionIndex(workspace, dir);
      if (updated.count !== seq) throw new Error('decision seq/index mismatch after append; manual inspection required');
      persist({ ...state, decisionCount: updated.count, decisionHash: updated.hash });
      return { ...entry, seq };
    },
    release() {
      assertOwned();
      if (processes.size || Object.values(state.tasks).some(task => !isStoppedTask(task))) throw new Error('stop not confirmed; writer lock retained');
      assertDecisionIndex(workspace, dir, state);
      fs.unlinkSync(lockFile);
      released = true;
    },
  };
}

export function inspectRun({ workspace, runId }) {
  const dir = runDirectory(workspace, runId);
  const state = validateState(readJson(workspace, path.join(dir, 'state.json')), runId);
  assertDecisionIndex(workspace, dir, state);
  return state;
}
export const HELP = 'Usage: node run-state.mjs --help | --request <workspace-relative JSON>\nRequest: {workspace:absolute,runId}. Query only. Mutations use acquireRun({workspace,runId,ownerId,maxWorkers?,provenance?:{schemaVersion:1,upstreamCommit,upstreamVersion,adapterVersion,adapterSha256,configSnapshot?}}); omitted provenance reads adjacent build-info.json only. Missing metadata stays null/unknown and never means live verification. Original owner/provenance are immutable; revision/config drift stops resume. lease.setOutcome({status:PENDING|PASS|ISSUES|BLOCKED|NOT_RUN,evidence:[existingIDs]}) stores the final outcome; PASS requires independent evidence and every writer stopped, and synchronizes gate PASS. Other methods: save/updateTask/appendDecision/release. appendDecision({ts?:ISO,phase,decision,why,evidence,result,seq?:expectedNextRow}) appends canonical decisions.tsv (ts,phase,decision,why,evidence,result). Tabs/newlines are flattened and formula prefixes escaped. Supersede by appending a new row; never rewrite history. state.decisionCount/checksum are indexes only. Legacy JSON logs, malformed TSV, or index mismatch require manual inspection. Locks are not auto-reclaimed.';
if (isMain(import.meta.url)) cliInput(HELP, inspectRun);
