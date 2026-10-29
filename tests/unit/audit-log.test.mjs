import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { appendStandaloneLog } from '../../adapters/minimax-code/script-overrides/skills/show-me-your-work/scripts/log.mjs';
const base = fileURLToPath(new URL('../.sandbox/audit-log/', import.meta.url));
const shim = fileURLToPath(new URL('../../adapters/minimax-code/script-overrides/skills/show-me-your-work/scripts/log.sh', import.meta.url));
function fixture() { fs.mkdirSync(base, { recursive: true }); return fs.mkdtempSync(path.join(base, 'case-')); }
test('audit: standalone shim preserves one TSV, sanitizes hostile cells including whitespace formulas', () => {
  const workspace = fixture(), logfile = '.pstack/runs/a/decisions.tsv';
  const result = spawnSync('bash', [shim, logfile, 'review', '  =HYPERLINK("external")', 'why\tnewline\n\u0001', 'artifact.txt', '@bad'], { cwd: workspace, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  appendStandaloneLog({ workspace, logfile, cells: ['fix', 'supersedes row 1', 'reason', 'evidence', 'done'] });
  const lines = fs.readFileSync(path.join(workspace, logfile), 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'ts\tphase\tdecision\twhy\tevidence\tresult');
  assert.ok(lines.every(line => line.split('\t').length === 6));
  const cells = lines[1].split('\t');
  assert.match(cells[2], /^'  =/); assert.equal(cells[3], 'why newline '); assert.equal(cells[5], "'@bad");
});
test('audit: no shell appends to managed runs, malformed logs, package paths, escapes or symlinks', () => {
  const workspace = fixture(), cells = ['phase', 'decision', 'why', 'artifact', 'open'];
  const dir = path.join(workspace, '.pstack/runs/managed'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'state.json'), '{}');
  assert.throws(() => appendStandaloneLog({ workspace, logfile: path.join(dir, 'decisions.tsv'), cells }), /Managed run/);
  assert.equal(fs.existsSync(path.join(dir, 'decisions.tsv')), false);
  fs.writeFileSync(path.join(workspace, 'bad.tsv'), 'not a canonical log\n');
  assert.throws(() => appendStandaloneLog({ workspace, logfile: 'bad.tsv', cells }), /malformed/);
  assert.equal(fs.readFileSync(path.join(workspace, 'bad.tsv'), 'utf8'), 'not a canonical log\n');
  assert.throws(() => appendStandaloneLog({ workspace, logfile: '../outside.tsv', cells }), /workspace/);
  fs.symlinkSync(path.join(workspace, 'bad.tsv'), path.join(workspace, 'alias.tsv'));
  assert.throws(() => appendStandaloneLog({ workspace, logfile: 'alias.tsv', cells }), /symlinks/);
});
