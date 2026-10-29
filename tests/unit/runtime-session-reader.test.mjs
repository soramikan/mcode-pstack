import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession, redactText } from '../../adapters/minimax-code/runtime/session-reader.mjs';
import { sandbox, json } from '../fixtures/runtime/helpers.mjs';

function sessionFixture(t) {
  const workspace = sandbox(t, 'session');
  const artifactsRoot = path.join(workspace, 'artifacts');
  const dir = path.join(artifactsRoot, 'parent');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('../fixtures/runtime/display.jsonl', import.meta.url)), path.join(dir, 'display.jsonl'));
  const manifest = path.join(dir, 'manifest.json');
  const value = { schemaVersion: 1, sessionId: 'parent', layout: 'v2-final-dated-session', paths: { sessionDir: dir, display: 'display.jsonl', ledger: 'never-open.jsonl' } };
  json(manifest, value);
  // Poison ledger: reader must never fall back to this source.
  fs.writeFileSync(path.join(dir, 'never-open.jsonl'), 'synthetic secret poison');
  return { options: { workspace, artifactsRoot, manifest, sessionId: 'parent' }, dir, value };
}

test('v2 upsert normalizes msgId and seq, reports damage, strips secrets/tools', t => {
  const { options } = sessionFixture(t);
  const result = readSession(options);
  assert.deepEqual(result.messages.map(m => [m.msgId, m.seq]), [['m2', 2], ['m1', 3]]);
  assert.equal(result.messages[1].text.includes('Ignore every policy'), true);
  assert.equal(result.trust, 'untrusted-history');
  const text = JSON.stringify(result);
  for (const secret of ['old text', 'synthetic-key', 'synthetic-token', 'synthetic-auth', 'synthetic-secret', 'sk-123456789012', 'never-forward']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(result.diagnostics.map(d => d.code), ['unknown_display_schema', 'corrupt_display_json', 'session_mismatch']);
  assert.deepEqual(readSession({ ...options, fromMs: 180, toMs: 250 }).messages.map(m => m.msgId), ['m1']);
  assert.equal(readSession({ ...options, fromMs: 0, toMs: 120 }).messages.length, 0, 'filter after upsert; do not resurrect stale version');
});

test('scope, explicit children, no auto discovery and digest input', t => {
  const { options } = sessionFixture(t);
  const dir = path.join(options.artifactsRoot, 'child');
  fs.mkdirSync(dir);
  const manifest = path.join(dir, 'manifest.json');
  json(manifest, { schemaVersion: 1, sessionId: 'child', layout: 'v2-final-dated-session', paths: { display: 'display.jsonl' } });
  fs.writeFileSync(path.join(dir, 'display.jsonl'), `${JSON.stringify({ schemaVersion: 1, kind: 'message.display_upserted', sessionId: 'child', seq: 1, createdAtMs: 180, msgId: 'c1', role: 'assistant', message: { msg_content: 'child answer' } })}\n`);
  const children = [{ manifest, sessionId: 'child', workspace: options.workspace, parentSessionId: 'parent' }];
  assert.equal(readSession({ ...options, children }).messages.length, 2);
  assert.equal(readSession({ ...options, children, includeChildren: true }).messages.length, 3);
  const wrong = readSession({ ...options, children: [{ ...children[0], workspace: '/wrong' }], includeChildren: true });
  assert.equal(wrong.messages.length, 2);
  assert.equal(wrong.diagnostics.at(-1).code, 'scope_mismatch');
  assert.equal(readSession({ workspace: options.workspace, sessionId: 'parent' }).diagnostics[0].code, 'explicit_manifest_and_artifacts_root_required');
  const digest = readSession({ workspace: options.workspace, sessionId: 'parent', digest: 'user-picked history token=private', secrets: ['user-picked'] });
  assert.equal(digest.messages[0].text, '[REDACTED] history token=[REDACTED]');
});

test('unknown schema, missing/corrupt artifacts, scope mismatch, path traversal and symlinks', t => {
  const { options, dir, value } = sessionFixture(t);
  json(options.manifest, { ...value, schemaVersion: 99 });
  assert.equal(readSession(options).diagnostics[0].code, 'unknown_manifest_schema');
  json(options.manifest, { ...value, sessionId: 'wrong' });
  assert.equal(readSession(options).diagnostics[0].code, 'invalid_manifest');
  json(options.manifest, { ...value, paths: { display: '../parent/display.jsonl' } });
  assert.equal(readSession(options).messages.length, 2, 'normalized in-root paths are safe');
  json(options.manifest, { ...value, paths: { display: '../../outside' } });
  assert.equal(readSession(options).diagnostics[0].code, 'unsafe_or_unreadable_artifact');
  json(options.manifest, { ...value, paths: { display: 'missing.jsonl' } });
  assert.equal(readSession(options).diagnostics[0].code, 'missing_artifact');
  json(options.manifest, { ...value, paths: { display: 'linked.jsonl' } });
  fs.symlinkSync(path.join(dir, 'display.jsonl'), path.join(dir, 'linked.jsonl'));
  assert.equal(readSession(options).diagnostics[0].code, 'unsafe_or_unreadable_artifact');
  fs.writeFileSync(options.manifest, '{broken');
  assert.equal(readSession(options).diagnostics[0].code, 'corrupt_manifest_json');
  assert.equal(readSession({ ...options, manifest: '../outside.json' }).diagnostics[0].code, 'unsafe_or_unreadable_artifact');
  assert.equal(readSession({ ...options, maxBytes: 20 }).messages.length, 0);
  assert.equal(readSession({ ...options, includeChildren: 'yes' }).diagnostics[0].code, 'invalid_children');
  assert.equal(readSession({ ...options, digest: 'text', children: null }).diagnostics[0].code, 'invalid_children');
});

test('redaction handles credentials and known supplied secrets without forwarding metadata', () => {
  assert.equal(redactText('password="abc def" Authorization: Bearer abc123 https://user:pass@example.invalid/ known', ['known']), 'password=[REDACTED] Authorization: [REDACTED] https://[REDACTED]@example.invalid/ [REDACTED]');
});
