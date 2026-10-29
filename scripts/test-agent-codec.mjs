// Bun bundles only the selected host's canonical Agent codec. Logging is a
// deliberate no-op test seam; parsing and stable/path-safe file reads are real.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinks, within } from './lib/tree.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name) { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`); return path.resolve(args[index + 1]); }
if (!globalThis.Bun) throw new Error('Run this optional host codec check with Bun');
const source = arg('--source'), dataDir = arg('--data-dir'), output = arg('--out');
if (!within(path.join(root, 'tests/.sandbox/host'), output) || !within(path.join(root, 'tests/.sandbox/host'), dataDir)) throw new Error('Codec check output and data must stay inside the designated host sandbox');
await assertNoSymlinks(output); await assertNoSymlinks(dataDir);
const codec = path.join(source, 'packages/local-runtime-v2/src/service/agent/storage/canonical-agent-config.ts');
const avatar = path.join(source, 'packages/shared/src/agent-avatar.ts');
const require = createRequire(import.meta.url);
const entry = `import assert from 'node:assert/strict';
import path from 'node:path';
import {readCanonicalAgentConfig} from ${JSON.stringify(codec)};
const results = [];
for(const name of ['poteto-agent','comment-sicko']) {
 const config=await readCanonicalAgentConfig({agentDir:path.join(process.argv[2],'agents',name),routeName:name,trustedRoot:process.argv[2]});
 assert.equal(config.name,name); assert.equal(config.model,undefined); assert.equal(config.effort,undefined);
 assert.ok(config.description.length); assert.ok(config.systemPrompt.length); assert.deepEqual(config.diagnostics,[]);
 results.push({name,canonicalRead:true,model:'inherit-parent',diagnostics:[]});
}
console.log(JSON.stringify({codec:'selected-source canonical-agent-config',logging:'stubbed',agents:results}));`;
await mkdir(output, { recursive: true });
const result = await Bun.build({
  entrypoints: ['virtual:pstack-agent-codec'],
  target: 'node', format: 'esm', outdir: output, naming: 'agent-codec.mjs',
  alias: { yaml: require.resolve('yaml'), '@mavis/shared/agent-avatar': avatar },
  plugins: [{ name: 'agent-codec-test-entry', setup(build) {
    build.onResolve({ filter: /^@mavis\/shared\/agent-avatar$/ }, () => ({ path: avatar }));
    build.onResolve({ filter: /^yaml$/ }, () => ({ path: require.resolve('yaml') }));
    build.onResolve({ filter: /^virtual:pstack-agent-codec$/ }, () => ({ path: 'entry', namespace: 'pstack-entry' }));
    build.onLoad({ filter: /.*/, namespace: 'pstack-entry' }, () => ({ contents: entry, loader: 'js', resolveDir: root }));
    build.onResolve({ filter: /infra\/logging\/index\.js$/ }, () => ({ path: 'logging', namespace: 'pstack-test-log' }));
    build.onLoad({ filter: /.*/, namespace: 'pstack-test-log' }, () => ({ contents: 'export const logger = new Proxy({}, {get:()=>()=>{}});', loader: 'js' }));
  } }],
});
if (!result.success) throw new AggregateError(result.logs, 'Could not bundle the selected host codec');
const node = process.env.PSTACK_TEST_NODE ?? 'node';
const checked = spawnSync(node, [path.join(output, 'agent-codec.mjs'), dataDir], { encoding: 'utf8', shell: false, timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, MINIMAX_DATA_DIR: dataDir, MAVIS_DATA_DIR: dataDir } });
if (checked.status !== 0 || checked.error) throw new Error(checked.error?.message ?? checked.stderr);
console.log(checked.stdout.trim());
