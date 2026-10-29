import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some((arg, index) => !['--with-host', '--host-source'].includes(arg) && args[index - 1] !== '--host-source')) throw new Error('Usage: node scripts/verify.mjs [--with-host] [--host-source <source directory>]');
const sourceIndex = args.indexOf('--host-source');
const tests = (await readdir(path.join(root, 'tests/unit'))).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `tests/unit/${name}`);
const commands = [
  ['scripts/generate.mjs', '--check'],
  ['scripts/validate.mjs'],
  ['--test', ...tests],
  ['scripts/test-upstream.mjs'],
];
if (args.includes('--with-host')) commands.push(['scripts/test-host.mjs', ...(sourceIndex >= 0 ? ['--source', args[sourceIndex + 1]] : [])]);
const results = [];
for (const command of commands) {
  console.log(`\n$ node ${command.join(' ')}`);
  const result = spawnSync(process.execPath, command, { cwd: root, stdio: 'inherit', env: { ...process.env, DO_NOT_TRACK: '1', MCODE_DISABLE_TELEMETRY: '1' }, timeout: 600000 });
  results.push({ command, passed: result.status === 0 && !result.error, ...(result.error ? { error: result.error.message } : {}) });
  if (!results.at(-1).passed) break;
}
await mkdir(path.join(root, '.pstack/checks'), { recursive: true });
await writeFile(path.join(root, '.pstack/checks/verification.json'), `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), checks: results, notRun: ['Paid live model/task/skill invocation', 'Actual GitHub push/PR/merge', 'TLC/JRE unavailable unless explicitly configured', ...(args.includes('--with-host') ? [] : ['Installed MiniMax Code plugin reader'])] }, null, 2)}\n`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
