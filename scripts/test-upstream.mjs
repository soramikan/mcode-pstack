import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = path.join(root, 'tests/.sandbox');
await fs.mkdir(sandbox, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(sandbox, 'upstream-'));
const source = path.join(runRoot, 'source');
await fs.cp(path.join(root, 'vendor/pstack/skills'), path.join(source, 'skills'), { recursive: true });
const poteto = path.join(source, 'skills/poteto-mode/scripts');
const statechart = path.join(source, 'skills/statechart/scripts');
// Keep baseline upstream assertions and implementation intact. Adapted resolver
// behavior (including changed BLOCKED diagnostics) is tested by helpers tests.
for (const executable of ['statechart', 'test/java.ts']) await fs.chmod(path.join(statechart, executable), 0o755);
const temporary = path.join(runRoot, 'tmp');
await fs.mkdir(temporary);
// Upstream replay tests pass this relative placeholder to their fake Java.
// It is never used by real TLC, whose suites require an explicit TLA2TOOLS.
await fs.writeFile(path.join(runRoot, 'tla2tools.jar'), 'offline replay fixture, not a TLC binary\n');
const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
  PSTACK_RUN_DIR: temporary, XDG_CACHE_HOME: path.join(runRoot, 'cache') };
if (env.TLA2TOOLS) env.TLA2TOOLS = path.resolve(root, env.TLA2TOOLS);
if (env.JAVA) env.JAVA = path.resolve(root, env.JAVA);
const run = (command, args) => new Promise((resolve) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { cwd: runRoot, env, stdio: 'inherit' });
  child.on('error', (error) => { console.error(`BLOCKED: ${error.message}`); resolve(false); });
  child.on('close', (code) => resolve(code === 0));
});
const nodeTests = (await fs.readdir(path.join(statechart, 'test'))).filter((name) => name.endsWith('.test.ts'));
const watchTests = (await fs.readdir(path.join(poteto, 'watch-pr'))).filter((name) => name.endsWith('.test.ts'));
const count = nodeTests.length + watchTests.length + 1;
if (count !== 14) throw new Error(`Expected 14 retained upstream test files, found ${count}`);
const renderSkip = path.join(runRoot, 'render-offline.test.mjs');
await fs.writeFile(renderSkip, `import { test } from 'node:test';\ntest('upstream render.test.ts (Pele/Mermaid)', { skip: 'Offline: upstream before hook performs npm install of pele, mermaid and jsdom; no acquisition approved' }, () => {});\n`);
console.log(`Retained all ${count} upstream test files; sandbox: ${runRoot}`);
console.log(env.TLA2TOOLS ? `TLC comparison enabled: ${env.TLA2TOOLS}` : 'SKIP TLC comparison: TLA2TOOLS is unset; upstream TLC tests report explicit skips.');
let ok = true;
ok = await run('bun', ['test', path.join(poteto, 'watch-pr'), path.join(poteto, 'check-plan.test.ts')]) && ok;
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
ok = await run(process.execPath, [compiler, '--project', path.join(poteto, 'watch-pr/tsconfig.json'), '--noEmit', '--strict']) && ok;
// Node native TypeScript preserves node:test signal/child-process semantics;
// Bun is used only for the upstream bun:test suites, not as a Node-test shim.
ok = await run(process.execPath, ['--disable-warning=ExperimentalWarning', '--test',
  ...nodeTests.filter((name) => name !== 'render.test.ts').map((name) => path.join(statechart, 'test', name)), renderSkip]) && ok;
console.log(`\nUpstream validation ${ok ? 'passed (with explicit skips)' : 'FAILED/BLOCKED'}. Scratch retained: ${runRoot}`);
process.exitCode = ok ? 0 : 1;
