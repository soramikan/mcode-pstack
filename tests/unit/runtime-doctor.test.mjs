import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { doctor } from '../../adapters/minimax-code/runtime/doctor.mjs';
import { FAKE, ROOT, sandbox } from '../fixtures/runtime/helpers.mjs';

test('doctor only queries explicit executable version/help, never runs a model', () => {
  const result = doctor({ executable: process.execPath, executableArgs: [FAKE] });
  assert.equal(result.ok, true);
  assert.equal(result.queryOnly, true);
  assert.equal(Object.values(result.flags).every(Boolean), true);
  assert.equal(result.version, 'fake-mcode 1.0.0');
});
test('doctor reports unavailable executable without installing', t => {
  const workspace = sandbox(t, 'doctor');
  const result = doctor({ executable: path.join(workspace, 'missing') });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'ENOENT');
});
test('all public runtime modules expose nonexecuting --help', () => {
  for (const name of ['config', 'session-reader', 'run-state', 'run-worker', 'doctor']) {
    const output = execFileSync(process.execPath, [path.join(ROOT, 'adapters/minimax-code/runtime', `${name}.mjs`), '--help'], { encoding: 'utf8', timeout: 3000 });
    assert.match(output, /Usage:/);
    assert.match(output, /--request/);
  }
});
