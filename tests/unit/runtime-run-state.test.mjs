import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireRun, DECISION_COLUMNS, DECISION_HEADER, inspectRun, resolveRunProvenance, runDirectory } from '../../adapters/minimax-code/runtime/run-state.mjs';
import { sandbox, json } from '../fixtures/runtime/helpers.mjs';

const request = workspace => ({ workspace, runId: 'run', ownerId: 'owner' });
const decision = (patch = {}) => ({ ts: '2026-10-29T07:00:00.000Z', phase: 'execute', decision: 'candidate-selected', why: 'synthetic evidence', evidence: 'artifact:c1', result: 'pending', ...patch });
test('exclusive owner lock, atomic state, append-only decisions and independent gate', t => {
  const workspace = sandbox(t, 'state');
  const lease = acquireRun(request(workspace));
  assert.throws(() => acquireRun(request(workspace)), /locked/);
  assert.throws(() => acquireRun({ ...request(workspace), ownerId: 'other' }), /locked/);
  lease.appendDecision(decision());
  const log = path.join(lease.dir, 'decisions.tsv');
  const first = fs.readFileSync(log, 'utf8');
  assert.equal(DECISION_HEADER, 'ts\tphase\tdecision\twhy\tevidence\tresult\n');
  assert.ok(first.startsWith(DECISION_HEADER));
  lease.appendDecision(decision({ decision: 'supersedes row 1: gate-reviewed', result: 'reviewed' }));
  assert.ok(fs.readFileSync(log, 'utf8').startsWith(first), 'superseding is a new row, not a rewrite');
  assert.equal(fs.existsSync(path.join(lease.dir, 'decisions.jsonl')), false, 'no second JSON decision log');
  assert.equal(Object.hasOwn(lease.state, 'decisions'), false, 'state contains only a decision index');
  assert.equal(lease.state.decisionCount, 2);
  const stale = lease.state;
  lease.updateTask('task', { status: 'succeeded', processStopped: true });
  assert.throws(() => lease.save(stale), /stale state revision/);
  assert.equal(lease.state.gate.status, 'PENDING', 'task success never implies PASS');
  assert.throws(() => lease.save({ ...lease.state, gate: { status: 'PASS', evidence: [] } }), /independent gate evidence/);
  lease.save({ ...lease.state, evidence: [{ id: 'e1', type: 'test', result: 'passed' }] });
  lease.setOutcome({ status: 'PASS', evidence: ['e1'] });
  assert.equal(inspectRun(request(workspace)).decisionCount, 2);
  assert.equal(fs.readdirSync(lease.dir).some(name => name.endsWith('.tmp')), false);
  lease.release();
  assert.throws(() => lease.save(lease.state), /released/);
  const resumed = acquireRun(request(workspace));
  assert.equal(resumed.state.gate.status, 'PASS');
  resumed.release();
});

const provenanceFixture = () => ({ schemaVersion: 1, upstreamCommit: 'a'.repeat(40), upstreamVersion: '1.0.0-test', adapterVersion: '0.1.0-test', adapterSha256: 'b'.repeat(64), configSnapshot: { schemaVersion: 1, roles: { worker: { model: 'inherit-parent' } }, panels: ['worker'], maxWorkers: 2 } });

test('owner session, validated config/revisions and final outcome survive lease release', t => {
  const workspace = sandbox(t, 'provenance');
  const provenance = provenanceFixture();
  const lease = acquireRun({ ...request(workspace), provenance });
  assert.equal(lease.state.ownerId, 'owner');
  assert.equal(lease.state.provenance.metadataComplete, true);
  assert.equal(lease.state.provenance.liveVerified, false, 'revision metadata is not live verification');
  assert.deepEqual(lease.state.provenance.configSnapshot, provenance.configSnapshot);
  assert.deepEqual(lease.state.outcome, { status: 'PENDING', evidence: [] });
  assert.throws(() => lease.save({ ...lease.state, ownerId: 'replacement' }), /immutable/);
  assert.throws(() => lease.save({ ...lease.state, provenance: { ...lease.state.provenance, adapterVersion: '2.0.0' } }), /immutable/);
  lease.setOutcome({ status: 'NOT_RUN' });
  lease.release();
  const resumed = acquireRun({ ...request(workspace), ownerId: 'replacement', provenance: { ...provenance } });
  assert.equal(resumed.state.ownerId, 'owner', 'original owner session is not silently overwritten by a resumed writer');
  assert.equal(resumed.ownerId, 'replacement');
  assert.equal(resumed.state.outcome.status, 'NOT_RUN');
  resumed.release();
});

test('missing build/config facts stay null with diagnostics, never fabricated or live-verified', t => {
  const resolved = resolveRunProvenance();
  assert.equal(resolved.configSnapshot, null);
  assert.equal(resolved.liveVerified, false);
  assert.ok(resolved.diagnostics.includes('configSnapshot_unknown'));
  if (resolved.source === 'unknown') {
    assert.ok(resolved.diagnostics.includes('build_info_missing'));
    for (const key of ['upstreamCommit', 'upstreamVersion', 'adapterVersion', 'adapterSha256']) assert.equal(resolved[key], null);
  }
  const workspace = sandbox(t, 'unknown-provenance');
  const lease = acquireRun({ ...request(workspace), provenance: { schemaVersion: 1 } });
  assert.equal(lease.state.provenance.metadataComplete, false);
  assert.equal(lease.state.provenance.upstreamCommit, null);
  assert.equal(lease.state.provenance.liveVerified, false);
  lease.release();
  assert.throws(() => resolveRunProvenance({ ...provenanceFixture(), configSnapshot: { schemaVersion: 1, apiKey: 'not-allowed' } }), /unknown pstack config field/);
  assert.throws(() => resolveRunProvenance({ ...provenanceFixture(), upstreamCommit: 'invented' }), /upstreamCommit/);
});

test('resume refuses changed upstream/adapter/config snapshots without updating recorded facts', t => {
  const patches = [{ upstreamCommit: 'c'.repeat(40) }, { upstreamVersion: '2.0.0' }, { adapterVersion: '2.0.0' }, { adapterSha256: 'c'.repeat(64) }, { configSnapshot: { schemaVersion: 1, maxWorkers: 3 } }];
  for (const [i, patch] of patches.entries()) {
    const workspace = sandbox(t, `provenance-drift-${i}`);
    const provenance = provenanceFixture();
    const lease = acquireRun({ ...request(workspace), provenance }); lease.release();
    const file = path.join(lease.dir, 'state.json');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => acquireRun({ ...request(workspace), provenance: { ...provenance, ...patch } }), /provenance versions\/config mismatch/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(lease.dir, 'writer.lock')), true);
  }
});

test('outcome PASS needs independent existing evidence, stopped tasks and stopped tracked writers', t => {
  const workspace = sandbox(t, 'outcome');
  const lease = acquireRun(request(workspace));
  lease.updateTask('task', { status: 'succeeded', processStopped: true });
  assert.equal(lease.state.outcome.status, 'PENDING');
  assert.throws(() => lease.setOutcome({ status: 'PASS' }), /independent gate evidence/);
  assert.throws(() => lease.setOutcome({ status: 'PASS', evidence: ['missing'] }), /invalid outcome or evidence/);
  lease.save({ ...lease.state, evidence: [{ id: 'review', type: 'test', result: 'passed independently' }] });
  lease.updateTask('task', { status: 'running', processStopped: false });
  assert.throws(() => lease.setOutcome({ status: 'PASS', evidence: ['review'] }), /all writers stopped/);
  lease.trackProcess('task');
  lease.updateTask('task', { status: 'succeeded', processStopped: true });
  assert.throws(() => lease.setOutcome({ status: 'PASS', evidence: ['review'] }), /tracked writers stopped/);
  lease.confirmProcessStopped('task');
  lease.setOutcome({ status: 'PASS', evidence: ['review'] });
  assert.deepEqual(lease.state.gate, { status: 'PASS', evidence: ['review'] });
  assert.throws(() => lease.save({ ...lease.state, gate: { status: 'PENDING', evidence: [] } }), /must agree/);
  lease.setOutcome({ status: 'ISSUES', evidence: ['review'] });
  assert.equal(lease.state.gate.status, 'FAIL');
  for (const status of ['BLOCKED', 'NOT_RUN', 'PENDING']) {
    lease.setOutcome({ status });
    assert.equal(lease.state.outcome.status, status);
    assert.equal(lease.state.gate.status, 'PENDING');
  }
  lease.release();
});

test('canonical TSV flattens fields, escapes formula prefixes and validates expected row seq', t => {
  const workspace = sandbox(t, 'canonical-tsv');
  const lease = acquireRun(request(workspace));
  const input = decision({ ts: '=NOW()', phase: '+phase\tlabel', decision: '-decision\r\nnext', why: '@why', evidence: '\t=artifact', result: ' \n+result', seq: 1 });
  const entry = lease.appendDecision(input);
  const file = path.join(lease.dir, 'decisions.tsv');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.split('\n').length, 3, 'exactly header, one data row and trailing LF');
  const cells = text.split('\n')[1].split('\t');
  assert.equal(cells.length, 6);
  assert.deepEqual(cells, DECISION_COLUMNS.map(key => entry[key]));
  for (const cell of cells) assert.ok(cell.startsWith("'"), `formula escaped: ${cell}`);
  assert.equal(entry.seq, 1);
  assert.equal(lease.state.decisionCount, 1);
  assert.throws(() => lease.appendDecision(decision({ seq: 1 })), /seq mismatch/);
  assert.throws(() => lease.appendDecision({ ...decision(), type: 'second-json-schema' }), /canonical TSV/);
  assert.throws(() => lease.save({ ...lease.state, decisionCount: 2 }), /read-only TSV indexes/);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'rejected appends do not touch canonical history');
  lease.release();
  const resumed = acquireRun(request(workspace));
  resumed.appendDecision(decision({ seq: 2, decision: 'supersedes row 1', result: 'corrected' }));
  assert.equal(resumed.state.decisionCount, 2);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith(text));
  resumed.release();
});

test('TSV corruption, unexpected rows and same-count edits fail closed without rewriting history', t => {
  const cases = [
    'wrong\theader\n',
    `${DECISION_HEADER}\n`,
    `${DECISION_HEADER}ts\tphase\tmissing-columns\n`,
    `${DECISION_HEADER}ts\tphase\tdecision\twhy\tevidence\tresult`,
    `${DECISION_HEADER}ts\tphase\t=unescaped-formula\twhy\tevidence\tresult\n`,
    `${DECISION_HEADER}ts\tphase\tdecision\twhy\tevidence\tresult\n`,
  ];
  for (const [i, text] of cases.entries()) {
    const workspace = sandbox(t, `corrupt-tsv-${i}`);
    const lease = acquireRun(request(workspace)); lease.release();
    const file = path.join(lease.dir, 'decisions.tsv');
    fs.writeFileSync(file, text);
    assert.throws(() => inspectRun(request(workspace)), /decisions/);
    assert.throws(() => acquireRun(request(workspace)), /initialization stopped/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.equal(fs.existsSync(path.join(lease.dir, 'writer.lock')), true);
  }
  const workspace = sandbox(t, 'tsv-checksum');
  const lease = acquireRun(request(workspace)); lease.appendDecision(decision()); lease.release();
  const file = path.join(lease.dir, 'decisions.tsv');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('synthetic evidence', 'modified evidence'));
  assert.throws(() => acquireRun(request(workspace)), /checksum mismatch/);
});

test('legacy JSON decisions and persisted row-count disagreement require manual inspection', t => {
  const workspace = sandbox(t, 'legacy-decision-json');
  const lease = acquireRun(request(workspace)); lease.release();
  const legacy = path.join(lease.dir, 'decisions.jsonl');
  fs.writeFileSync(legacy, '{"seq":1}\n');
  assert.throws(() => inspectRun(request(workspace)), /legacy JSON.*manual/);
  assert.throws(() => acquireRun(request(workspace)), /legacy JSON.*manual/);
  assert.equal(fs.readFileSync(legacy, 'utf8'), '{"seq":1}\n');
  const second = sandbox(t, 'tsv-count-index');
  const other = acquireRun(request(second)); other.appendDecision(decision()); other.release();
  const state = inspectRun(request(second));
  json(path.join(other.dir, 'state.json'), { ...state, decisionCount: state.decisionCount + 1 });
  assert.throws(() => acquireRun(request(second)), /index\/checksum mismatch/);
});

test('stop confirmation required; old unknown writer/task cannot be replaced', t => {
  const workspace = sandbox(t, 'stop-lock');
  const lease = acquireRun(request(workspace));
  lease.updateTask('task', { status: 'running', pid: 999999, processStopped: false });
  lease.trackProcess('task');
  assert.throws(() => lease.release(), /stop not confirmed/);
  assert.throws(() => acquireRun(request(workspace)), /locked/);
  lease.updateTask('task', { status: 'failed', processStopped: true });
  assert.throws(() => lease.release(), /stop not confirmed/, 'terminal state alone does not confirm tracked process stop');
  lease.confirmProcessStopped('task');
  lease.release();
  const state = inspectRun(request(workspace));
  state.tasks.task = { status: 'stop_unknown', processStopped: false };
  json(path.join(runDirectory(workspace, 'run'), 'state.json'), state);
  assert.throws(() => acquireRun(request(workspace)), /liveness unknown/);
  assert.throws(() => acquireRun(request(workspace)), /locked/, 'unknown state retains a fail-closed lock');
});

test('stale/corrupt locks and decision index fail closed; safe run path only', t => {
  const workspace = sandbox(t, 'stale');
  const dir = runDirectory(workspace, 'old');
  json(path.join(dir, 'writer.lock'), { ownerId: 'old', pid: 999999, createdAtMs: 0 });
  assert.throws(() => acquireRun({ workspace, runId: 'old', ownerId: 'new' }), /no automatic stale takeover/);
  assert.throws(() => runDirectory(workspace, '../escape'), /runId/);
  const lease = acquireRun(request(workspace));
  lease.release();
  fs.writeFileSync(path.join(lease.dir, 'decisions.tsv'), 'bad\theader\n');
  assert.throws(() => acquireRun(request(workspace)), /initialization stopped/);
  const linked = path.join(workspace, 'linked');
  fs.symlinkSync(workspace, linked);
  assert.throws(() => acquireRun({ workspace: linked, runId: 'run', ownerId: 'owner' }), /symlink/);
});
