import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTools } from '../../scripts/build-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const overrides = path.join(root, 'adapters/minimax-code/script-overrides');
const sandbox = path.join(root, 'tests/.sandbox');
await fs.mkdir(sandbox, { recursive: true });
const scratch = await fs.mkdtemp(path.join(sandbox, 'helpers-'));
const env = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
const run = (file, args, extra = {}) => spawnSync(file, args, { cwd: scratch, encoding: 'utf8', env, ...extra });
const helper = (name) => path.join(overrides, 'skills/poteto-mode/scripts', name);

const rule = '単体・実動・性能の証拠を確認してから検証完了とする。';
const plan = `# 検証計画

## 読み方
一つのチェックは作業単位であり、証拠を明記する。証拠が存在するときだけチェックする。

## 実行チェックリスト
### 実行準備
### 担当と所有権
担当者 = helper-worker、対象 = helpers/**
### PR運用
### 判定とマージ
### 開始手順

## フェーズ1
**依存関係** なし。
**対象ファイル**
- [ ] helpers/**
**実装**
- [ ] 安全な実装を行う。
**期待する結果**
- [ ] 自動取得しない。
**単体検証** ${rule}
- [ ] 単体テストを実行する。
**実動検証** ${rule}
- [ ] 証拠を\`evidence/live.log\`に保存。合格条件は終了コード0。
**性能検証** ${rule}
- [ ] 指標。 起動時間。
- [ ] 計測。 起動プローブ。
- [ ] 基準値。 変更前。
- [ ] 判定基準。 基準値以下。
**レビューゲート** 承認が必要。
- [ ] 証拠 \`evidence/review.log\` を確認者が確認する。
**マージ**
- [ ] 承認後にマージする。

## 完了条件
証拠を確認する。

## 付録 試作の証拠
\`evidence/prototype.log\`
`;

async function checkPlan(text) {
  const file = path.join(await fs.mkdtemp(path.join(scratch, 'plan-')), 'explicit-plan.md');
  await fs.writeFile(file, text);
  const before = await fs.readFile(file);
  const result = run(process.execPath, [helper('check-plan.mjs'), file]);
  assert.deepEqual(await fs.readFile(file), before, 'checker must not modify the Plan');
  return result;
}

test('Japanese explicit Plan preserves verification/ownership/gates without ten lanes or /loop', async () => {
  const result = await checkPlan(plan);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 PR sections, 0 problems/);
});

test('Plan still rejects missing ownership, live evidence and review approval', async () => {
  for (const bad of [plan.replace('担当者 = helper-worker、対象 = helpers/**', ''),
    plan.replace('証拠を`evidence/live.log`に保存。合格条件は終了コード0。', '動作を確認する。'),
    plan.replace('証拠 `evidence/review.log` を確認者が確認する。', '後で確認する。')]) {
    const result = await checkPlan(bad);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

test('Plan requires an explicit path; no Plan Mode state is written', async () => {
  const result = run(process.execPath, [helper('check-plan.mjs')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage/);
});

test('bootstrap compatibility hook does not spawn/install/write/restart', async () => {
  const file = helper('bootstrap.ts');
  const code = `import { ensureDependenciesInstalled } from ${JSON.stringify(file)}; ensureDependenciesInstalled(); console.log('ready');`;
  const result = run('bun', ['--eval', code], { env: { ...env, BUN_BE_BUN: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ready');
  const source = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(source, /spawn|writeFile|process\.exit|bun install/);
});

test('TLC runtime reports BLOCKED without trying to obtain missing tools', async () => {
  const source = path.join(scratch, 'tlc-package/skills/statechart/scripts');
  await fs.cp(path.join(root, 'vendor/pstack/skills/statechart/scripts'), source, { recursive: true });
  await fs.copyFile(path.join(overrides, 'skills/statechart/scripts/run.ts'), path.join(source, 'run.ts'));
  await fs.copyFile(path.join(overrides, 'skills/statechart/scripts/statechart.ts'), path.join(source, 'statechart.ts'));
  const code = `import {findTlc} from ${JSON.stringify(path.join(source, 'run.ts'))}; try { await findTlc(process.cwd()); process.exitCode=1; } catch(e) { console.log(e.message); }`;
  for (const values of [{ TLA2TOOLS: '', JAVA: '' }, { TLA2TOOLS: path.join(scratch, 'missing.jar'), JAVA: '' }]) {
    const result = run(process.execPath, ['--input-type=module', '--eval', code], { env: { ...env, ...values } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BLOCKED:.*existing tla2tools.jar/);
    assert.match(result.stdout, /No automatic install or download/);
  }
  const text = await fs.readFile(path.join(source, 'run.ts'), 'utf8');
  assert.match(text, /936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88/);
  assert.doesNotMatch(text, /mise\("|fetch\(|https?\.get\(/);
  await fs.writeFile(path.join(source, 'tsconfig.runtime.json'), JSON.stringify({ extends: './tsconfig.json', exclude: ['test'] }));
  const types = run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', path.join(source, 'tsconfig.runtime.json')]);
  assert.equal(types.status, 0, types.stdout + types.stderr);
  await fs.chmod(path.join(source, 'test/java.ts'), 0o755);
  await fs.writeFile(path.join(scratch, 'tla2tools.jar'), 'offline replay placeholder');
  const replay = run(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^Login writes the committed chart', path.join(source, 'test/cli.test.ts')], { env: { ...env, NODE_TEST_CONTEXT: undefined, PSTACK_RUN_DIR: path.join(scratch, 'runtime-scratch') } });
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  assert.match(replay.stdout, /pass 1/);
});

test('statechart janitor retains scratch and usage requires confirmation for host recoverable cleanup', async () => {
  const source = await fs.readFile(path.join(overrides, 'skills/statechart/scripts/statechart.ts'), 'utf8');
  assert.doesNotMatch(source, /rm -rf/);
  assert.match(source, /request user confirmation\nbefore using the host's recoverable cleanup/);
  const command = source.match(/'([^'\n]*while read -r line[^'\n]*)'/)?.[1];
  assert.equal(command, 'while read -r line; do :; done; kill -s KILL -- "-$1"');
  const dirs = [path.join(scratch, 'janitor-stage'), path.join(scratch, 'janitor-tmp')];
  for (const dir of dirs) {
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'retain.txt'), 'user inspection required');
  }
  // Neutralize process signaling: exercise only EOF handling and scratch retention.
  const janitor = run('/bin/sh', ['-c', `kill() { :; }\n${command}`, 'sh', 'fixture-worker', ...dirs]);
  assert.equal(janitor.status, 0, janitor.stderr);
  for (const dir of dirs) assert.equal(await fs.readFile(path.join(dir, 'retain.txt'), 'utf8'), 'user inspection required');
  const scripts = path.join(scratch, 'cleanup-package/skills/statechart/scripts');
  await fs.cp(path.join(root, 'vendor/pstack/skills/statechart/scripts'), scripts, { recursive: true });
  for (const file of ['run.ts', 'statechart.ts']) await fs.copyFile(path.join(overrides, 'skills/statechart/scripts', file), path.join(scripts, file));
  const launcher = path.join(scripts, 'statechart.ts');
  const usage = run(process.execPath, [launcher]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /request user confirmation\nbefore using the host's recoverable cleanup/);
});

test('explicit TLC bootstrap refuses unapproved downloads before any acquisition', () => {
  const file = path.join(overrides, 'skills/statechart/scripts/bootstrap-tools.mjs');
  const result = run(process.execPath, [file, '--workspace', scratch]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCKED: explicit approval required/);
});

test('approved TLC acquisition verifies checksum before writing the JAR (offline fetch fixture)', async () => {
  const file = path.join(overrides, 'skills/statechart/scripts/bootstrap-tools.mjs');
  const workspace = await fs.mkdtemp(path.join(scratch, 'tlc-download-'));
  const code = `import {bootstrapTools} from ${JSON.stringify(file)}; globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}); try { await bootstrapTools(['--workspace',${JSON.stringify(workspace)},'--approve-download']); process.exitCode=1; } catch(e) { console.log(e.message); }`;
  const result = run(process.execPath, ['--input-type=module', '--eval', code]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checksum mismatch; nothing written/);
  assert.deepEqual(await fs.readdir(path.join(workspace, '.pstack/cache')), []);
});

async function auditFixture() {
  const dir = await fs.mkdtemp(path.join(scratch, 'audit-'));
  const bin = path.join(dir, 'bin');
  await fs.mkdir(bin);
  const log = path.join(dir, 'git.log');
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\ncase "$*" in\n  *'worktree list --porcelain'*) printf 'worktree %s\\n' ${JSON.stringify(dir)} ;;\n  *'rev-parse --show-toplevel'*) echo ${JSON.stringify(dir)} ;;\n  *'rev-parse --git-dir'*) echo .git ;;\n  *'symbolic-ref --short refs/remotes/origin/HEAD'*) echo origin/main ;;\nesac\nexit 0\n`, { mode: 0o755 });
  return { dir, log, env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}

test('audit defaults to cached/stale refs, workspace scratch, no transcript/home lookup', async () => {
  const f = await auditFixture();
  const result = run('bash', [helper('worktree-audit.sh'), '--run-dir', 'scratch', '-b', 'origin/main', f.dir], { cwd: f.dir, env: f.env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stale \(cached local refs; no fetch\)/);
  assert.doesNotMatch(await fs.readFile(f.log, 'utf8'), /fetch/);
  assert.match(result.stderr, /scratch retained:/);
  const source = await fs.readFile(helper('worktree-audit.sh'), 'utf8');
  assert.doesNotMatch(source, /\.cursor|\$HOME|rm -[rf]|mktemp\)/);
});

test('audit refresh requires explicit approval and permits only the requested fetch', async () => {
  const f = await auditFixture();
  const args = [helper('worktree-audit.sh'), '--run-dir', 'scratch', '-b', 'origin/main', '--refresh'];
  const blocked = run('bash', [...args, f.dir], { cwd: f.dir, env: f.env });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /BLOCKED/);
  assert.doesNotMatch(await fs.readFile(f.log, 'utf8'), /fetch/);
  const approved = run('bash', [...args, '--approve-network', f.dir], { cwd: f.dir, env: f.env });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(await fs.readFile(f.log, 'utf8'), /fetch origin/);
});

test('audit rejects scratch outside workspace', async () => {
  const f = await auditFixture();
  const result = run('bash', [helper('worktree-audit.sh'), '--run-dir', scratch, '-b', 'origin/main', f.dir], { cwd: f.dir, env: f.env });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inside the workspace/);
});

test('buildTools bundles watcher with commander license and works without runtime installation', async () => {
  const packageRoot = path.join(scratch, 'package');
  const relative = 'skills/poteto-mode/scripts';
  await fs.cp(path.join(root, 'vendor/pstack', relative), path.join(packageRoot, relative), { recursive: true });
  await fs.copyFile(helper('watch-pr/watch-pr'), path.join(packageRoot, relative, 'watch-pr/watch-pr'));
  await fs.copyFile(helper('bootstrap.ts'), path.join(packageRoot, relative, 'bootstrap.ts'));
  const result = await buildTools({ root, packageRoot });
  assert.equal(result.bundled.length, 1);
  const runtime = run('bun', ['--no-install', path.join(packageRoot, relative, 'watch-pr/watch-pr'), '--help']);
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.match(runtime.stdout, /Watch one pull request/);
  assert.match(await fs.readFile(path.join(packageRoot, 'licenses/commander-14.0.0.txt'), 'utf8'), /MIT/);
  const bundle = await fs.readFile(path.join(packageRoot, relative, 'watch-pr/cli.js'), 'utf8');
  assert.doesNotMatch(bundle, /from ["']commander["']/);
  assert.match(await fs.readFile(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /commander 14\.0\.0/);
  const other = path.join(scratch, 'deeper/other-package');
  await fs.cp(packageRoot, other, { recursive: true });
  await buildTools({ root, packageRoot: other });
  assert.equal(await fs.readFile(path.join(other, relative, 'watch-pr/cli.js'), 'utf8'), bundle, 'bundle must not depend on staging path/depth');
});
