import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const scenario = args.includes('--scenario') ? value('--scenario') : 'succeeded';
if (args.includes('--version')) { console.log('fake-mcode 1.0.0'); process.exit(0); }
if (args.includes('--help')) {
  console.log('mcode exec --cwd <path> --input <source> --output-format <format> --model <key> --effort <level> --permission <policy> --timeout <duration> --max-steps <count>');
  process.exit(0);
}
if (!args.includes('exec') || value('--input') !== '-' || value('--output-format') !== 'json' || value('--cwd') !== process.cwd()) process.exit(8);
let input = '';
for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(path.join(process.cwd(), 'invocation.json'), JSON.stringify({ args, cwd: process.cwd(), input }));
fs.writeFileSync(path.join(process.cwd(), 'started.json'), JSON.stringify({ pid: process.pid }));
if (scenario === 'slow' || scenario === 'ignore-term') {
  if (scenario === 'ignore-term') process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (scenario === 'too-much') {
  process.stdout.write('x'.repeat(300000));
  setInterval(() => {}, 1000);
} else if (scenario === 'broken') {
  console.log('{broken');
} else {
  const raw = value('--model');
  const slash = raw.indexOf('/');
  const hash = raw.indexOf('#');
  const model = { providerId: raw.slice(0, slash), modelId: raw.slice(slash + 1, hash < 0 ? undefined : hash), ...(hash < 0 ? {} : { variant: raw.slice(hash + 1) }) };
  if (scenario === 'mismodel') model.modelId = 'wrong-model';
  if (scenario === 'misvariant') model.variant = 'wrong-variant';
  if (scenario !== 'no-artifact') fs.writeFileSync(path.join(process.cwd(), 'artifact.txt'), 'synthetic result\n');
  if (scenario === 'descendant') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(process.cwd(), 'descendant.json'), JSON.stringify({ pid: child.pid }));
    // Keep the parent available to reap its child after a group SIGTERM.
    process.on('SIGTERM', () => child.once('exit', () => process.exit(0)));
  }
  const result = { schemaVersion: scenario === 'schema2' ? 2 : 1, type: 'exec.result', runId: 'fake-run', sessionId: 'fake-session', turnId: 'fake-turn', status: ['failed', 'timeout', 'cancelled', 'limit_exceeded'].includes(scenario) ? scenario : 'succeeded', durationMs: 1, model, output: 'PASS is output text, not independent gate evidence.' };
  console.log(JSON.stringify(result));
  if (scenario === 'nonzero' || ['timeout', 'cancelled', 'limit_exceeded'].includes(scenario)) process.exitCode = 9;
}
