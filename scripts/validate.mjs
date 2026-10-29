import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';
import { exists, safeRelative, treeRecords, walk, within } from './lib/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function frontmatter(text, location) {
  if (Buffer.byteLength(text) > 100 * 1024) throw new Error(`Skill/Agent exceeds 100 KiB: ${location}`);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${location}`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid YAML in ${location}: ${document.errors[0].message}`);
  const metadata = document.toJS({ maxAliasCount: 32 });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error(`Frontmatter is not an object: ${location}`);
  for (const key of ['name', 'description']) if (typeof metadata[key] !== 'string' || !metadata[key].trim()) throw new Error(`Missing ${key}: ${location}`);
  return metadata;
}
export function legacyViolations(text) {
  const rules = [
    ['legacy-runtime-path', /(?:~\/|\$HOME\/)?\.cursor\/(?:skills|rules|plans|projects|scratch|plugins)(?:\/|\b)/g],
    ['cursor-task-field', /\b(?:subagent_type|cloud_base_branch|readonly)\s*[:=]/g],
    ['cursor-cloud-argument', /\benvironment\s*[:=]\s*["'](?:cloud|local)["']/g],
    ['cursor-task-call', /\bTask\s*\(/g],
    ['generic-loop', /\/loop\s+(?:1h|\d+[mh])\b/g],
    ['unsafe-delete', /\brm\s+-(?:rf|fr)\b/g],
    ['runtime-bun-install', /\bbun\s+install\b/g],
  ];
  const output = [];
  for (const [rule, pattern] of rules) for (const match of text.matchAll(pattern)) {
    output.push({ rule, line: text.slice(0, match.index).split('\n').length, text: match[0] });
  }
  return output;
}
function markdownLinks(text) {
  const noFences = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  return [...noFences.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
}
export async function validateDistribution({ root = ROOT, packageRoot = path.join(root, 'plugins/pstack'), agentRoot = path.join(root, 'agent-configs'), links = true } = {}) {
  const errors = [];
  const files = await walk(packageRoot);
  const records = await treeRecords(packageRoot);
  const bytes = Object.values(records).reduce((total, record) => total + record.bytes, 0);
  if (files.length > 1024 || bytes > 64 * 1024 * 1024) errors.push(`Package limit exceeded: ${files.length} files, ${bytes} bytes`);
  if (files.some((name) => /(^|\/)(?:node_modules|\.git|\.cursor-plugin|\.claude-plugin)(\/|$)/.test(name))) errors.push('Forbidden source/dependency metadata in package');
  if (files.includes('plugin.json')) errors.push('Root plugin.json shadows native manifest');
  for (const name of files) safeRelative(name);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, '.minimax-plugin/plugin.json'), 'utf8'));
  const schema = JSON.parse(await readFile(path.join(root, 'adapters/minimax-code/plugin-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(manifest)) errors.push(`Native schema: ${JSON.stringify(validate.errors)}`);
  const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  const skills = files.filter((name) => /^skills\/[^/]+\/SKILL\.md$/.test(name)).sort();
  if (JSON.stringify(skills) !== JSON.stringify([...(manifest.skills ?? [])].sort())) errors.push('Manifest skill list does not exactly match package');
  if (skills.length !== lock.counts.skills) errors.push(`Skill count mismatch: ${skills.length}`);
  for (const name of skills) {
    try {
      const text = await readFile(path.join(packageRoot, name), 'utf8');
      const metadata = frontmatter(text, name);
      if (metadata.name !== name.split('/')[1]) errors.push(`Skill name mismatch: ${name}`);
      for (const invocation of text.matchAll(/(?:^|[\s`"'(])\/([a-z][a-z0-9-]*)(?=$|[\s`"')])/gm)) {
        if (skills.some((skill) => skill.split('/')[1] === invocation[1])) errors.push(`Unnamespaced internal invocation /${invocation[1]} in ${name}`);
      }
    } catch (error) { errors.push(error.message); }
  }
  const playbooks = files.filter((name) => /^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(name));
  if (playbooks.length !== lock.counts.playbooks) errors.push('Playbook inventory mismatch');
  const icon = await readFile(path.join(packageRoot, manifest.icon));
  if (manifest.icon.endsWith('.png') && !icon.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) errors.push('Invalid PNG icon signature');
  if (!files.includes('LICENSE') || !files.includes('UPSTREAM.md')) errors.push('Missing provenance/license');
  for (const name of files.filter((file) => /\.(?:md|mjs|ts|sh)$/.test(file))) {
    const text = await readFile(path.join(packageRoot, name), 'utf8');
    for (const issue of legacyViolations(text)) errors.push(`${name}:${issue.line}: ${issue.rule}: ${issue.text}`);
    if (links && name.endsWith('.md')) {
      for (const target of markdownLinks(text)) {
        if (/^(?:[a-z]+:|#|\/)/i.test(target) || target.includes('<') || target.includes('>')) continue;
        let local;
        try { local = decodeURIComponent(target.split('#')[0]); } catch { errors.push(`Invalid URL encoding: ${name} -> ${target}`); continue; }
        if (!local) continue;
        const resolved = path.resolve(packageRoot, path.dirname(name), local);
        if (!within(packageRoot, resolved) || !await exists(resolved)) errors.push(`Missing/escaping local link: ${name} -> ${target}`);
      }
    }
  }
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, 'runtime/build-info.json'), 'utf8'));
  if (buildInfo.schemaVersion !== 1 || buildInfo.upstreamCommit !== lock.commit || buildInfo.upstreamVersion !== lock.version || buildInfo.adapterVersion !== manifest.version || !/^[a-f0-9]{64}$/.test(buildInfo.adapterSha256)) errors.push('Invalid runtime build provenance');
  const compatibility = JSON.parse(await readFile(path.join(packageRoot, 'compatibility.json'), 'utf8'));
  if (compatibility.upstreamCommit !== lock.commit || !Array.isArray(compatibility.items)) errors.push('Invalid compatibility inventory');
  else {
    const ids = new Set();
    for (const item of compatibility.items) {
      if (!item.id || ids.has(item.id)) errors.push(`Duplicate/missing compatibility id: ${item.id}`);
      ids.add(item.id);
      if (!['supported', 'limited', 'unsupported'].includes(item.status)) errors.push(`Unknown status ${item.id}`);
      if (!Array.isArray(item.constraints) || !Array.isArray(item.tests) || item.tests.length === 0) errors.push(`Missing constraints/test IDs: ${item.id}`);
      if (item.source && !await exists(path.join(root, 'vendor/pstack', safeRelative(item.source)))) errors.push(`Unknown upstream source: ${item.id}`);
    }
    for (const [kind, count] of [['skill', 58], ['playbook', 23], ['agent', 2]]) {
      if (compatibility.items.filter((item) => item.kind === kind).length !== count) errors.push(`Compatibility ${kind} coverage mismatch`);
    }
  }
  const agentFiles = await walk(agentRoot);
  if (agentFiles.length !== 2) errors.push('Agent distribution must contain exactly two canonical definitions');
  const allowedAgent = new Set(['name', 'description', 'model', 'effort', 'tools', 'disallowedTools', 'mcpServers', 'skills', 'x-mavis']);
  for (const name of ['poteto-agent', 'comment-sicko']) {
    const relative = `${name}/agent.md`;
    try {
      const text = await readFile(path.join(agentRoot, relative), 'utf8');
      const metadata = frontmatter(text, relative);
      if (metadata.name !== name) errors.push(`Agent name mismatch: ${relative}`);
      for (const key of Object.keys(metadata)) if (!allowedAgent.has(key)) errors.push(`Unsupported Agent frontmatter ${key}: ${relative}`);
      if ('model' in metadata || 'effort' in metadata) errors.push(`Agent must inherit by default: ${relative}`);
      for (const issue of legacyViolations(text)) errors.push(`${relative}:${issue.line}: ${issue.rule}`);
    } catch (error) { errors.push(error.message); }
  }
  if (errors.length) throw new AggregateError(errors.map((message) => new Error(message)), `Distribution validation failed (${errors.length}):\n${errors.join('\n')}`);
  return { valid: true, files: files.length, bytes, skills: skills.length, playbooks: playbooks.length, agents: 2, source: lock.commit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await validateDistribution(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
