import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const load = name => JSON.parse(readFileSync(new URL(`./skill-overrides/${name}`, import.meta.url), 'utf8'));
const base = load('patches.json');
const reflection = load('reflection.json');
const inventory = load('source-inventory.json');
function checkedRecords(document, label) {
  if (document.schemaVersion !== 1 || !Array.isArray(document.files) || !/^[a-f0-9]{40}$/.test(document.upstreamCommit)) throw new Error(`Invalid ${label} metadata`);
  const records = new Map();
  for (const record of document.files) {
    if (typeof record.source !== 'string' || record.source.startsWith('/') || record.source.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(record.upstreamSha256) || !Array.isArray(record.patches) || records.has(record.source)) throw new Error(`Invalid or duplicate ${label} source`);
    records.set(record.source, record);
  }
  return records;
}
const patches = checkedRecords(base, 'base patch');
const reflectionPatches = checkedRecords(reflection, 'reflection');
const readPolicy = name => readFileSync(new URL(`./policies/${name}.md`, import.meta.url), 'utf8').trim();
const execution = readPolicy('execution');
const models = readPolicy('models');
const history = readPolicy('history');
const historySkills = new Set(['recall', 'reflect', 'automate-me', 'show-me-your-work']);
const modelSkills = new Set(['poteto-mode','setup-pstack','arena','swarm','architect','how','why','reflect','show-me-your-work']);
const sourceFiles = new Set(inventory.files);
const generatedFiles = new Set(inventory.included);
const sha = text => createHash('sha256').update(text).digest('hex');
const upstreamBase = `https://github.com/cursor/plugins/blob/${base.upstreamCommit}/pstack/`;

function exactPatches(input, record) {
  let result = input;
  for (const patch of record?.patches ?? []) {
    if (typeof patch.old !== 'string' || !patch.old || typeof patch.new !== 'string' || !patch.reason) throw new Error(`Invalid exact patch: ${record.source}`);
    const at = result.indexOf(patch.old);
    if (at < 0 || at !== result.lastIndexOf(patch.old)) throw new Error(`Exact patch drift: ${record.source}: ${patch.old.slice(0, 60)}`);
    result = result.slice(0, at) + patch.new + result.slice(at + patch.old.length);
  }
  return result;
}

function descriptionField(frontmatter) {
  return frontmatter.match(/^description:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/m)?.[0] ?? '';
}

function adaptFrontmatter(original, updated, names, relativePath) {
  const originalDescription = descriptionField(original);
  const updatedDescription = descriptionField(updated);
  if (original.replace(originalDescription, '') !== updated.replace(updatedDescription, '') || Boolean(originalDescription) !== Boolean(updatedDescription)) throw new Error(`Cannot change pinned name or other frontmatter keys: ${relativePath}`);
  return updatedDescription ? updated.replace(updatedDescription, namespaceCalls(updatedDescription, names)) : updated;
}

function namespaceCalls(body, names) {
  // Only command-shaped words in prose/code or descriptions, not URL/path components.
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`(^|[\\s\\x60"'(>\\[])\\/${escaped}(?=$|[\\s\\x60"')<\\],.!?:;])`, 'gm'), `$1/pstack:${name}`);
    body = body.replace(new RegExp(`skill\\(name=(['"])${escaped}\\1\\)`, 'g'), `skill(name="pstack:${name}")`);
  }
  return body;
}

function closeLinks(relativePath, text) {
  return text.replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g, (match, prefix, href, suffix) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return match;
    const [pathname, anchor = ''] = href.split('#');
    let resolved;
    try { resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), decodeURIComponent(pathname))); }
    catch { return match; }
    if (resolved === 'docs/harness/claude-code.md') return `${prefix}${path.posix.relative(path.posix.dirname(relativePath), 'docs/harness/minimax-code.md')}${anchor ? `#${anchor}` : ''}${suffix}`;
    if (resolved === 'docs/harness/minimax-code.md') return match;
    if (generatedFiles.has(resolved) || [...generatedFiles].some(p => p.startsWith(`${resolved.replace(/\/$/, '')}/`))) return match;
    if (sourceFiles.has(resolved) || [...sourceFiles].some(p => p.startsWith(`${resolved.replace(/\/$/, '')}/`))) {
      const baseURL = prefix.startsWith('!') ? `https://raw.githubusercontent.com/cursor/plugins/${base.upstreamCommit}/pstack/` : upstreamBase;
      return `${prefix}${baseURL}${resolved}${anchor ? `#${anchor}` : ''}${suffix}`;
    }
    // A relative reference not present in the pinned upstream is an actual source defect.
    throw new Error(`Unresolved relative link ${relativePath}: ${href}`);
  });
}

/** Pure, synchronous source transformation. Does not write generated destinations. */
export function transformMarkdown(relativePath, input, context = {}) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.split('/').includes('..') || typeof input !== 'string') throw new TypeError('Expected a vendor-relative path and Markdown string');
  if (context.upstreamCommit && context.upstreamCommit !== base.upstreamCommit) throw new Error('Adapter patches require an explicit upstream rebase');
  if (reflection.upstreamCommit !== base.upstreamCommit) throw new Error('Reflection patches require an explicit upstream rebase');
  const record = patches.get(relativePath);
  const expectedHash = record?.upstreamSha256 ?? inventory.hashes[relativePath];
  if (expectedHash && sha(input) !== expectedHash) throw new Error(`Pinned source hash mismatch: ${relativePath}`);
  const originalFrontmatter = input.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? '';
  let result = exactPatches(input, record);
  const learned = reflectionPatches.get(relativePath);
  if (learned && learned.upstreamSha256 !== expectedHash) throw new Error(`Reflection source hash mismatch: ${relativePath}`);
  result = exactPatches(result, learned);
  const modifiedFrontmatter = result.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? '';
  let body = result.slice(modifiedFrontmatter.length);
  const names = context.skillNames ?? inventory.skillNames;
  body = namespaceCalls(body, names);
  body = closeLinks(relativePath, body);
  if (/^skills\/[^/]+\/SKILL\.md$/.test(relativePath)) {
    const name = relativePath.split('/')[1];
    body += `\n\n${execution}\n`;
    if (modelSkills.has(name)) body += `\n${models}\n`;
    if (historySkills.has(name)) body += `\n${history}\n`;
  } else if (relativePath.startsWith('skills/poteto-mode/playbooks/')) {
    body += `\n\n${execution}\n`;
    if (relativePath.endsWith('/session-pickup.md') || relativePath.endsWith('/eval.md')) body += `\n${history}\n`;
  }
  // Preserve name and all other keys exactly; adapt only description's host wording/references.
  const output = adaptFrontmatter(originalFrontmatter, modifiedFrontmatter, names, relativePath) + body;
  if (/^skills\/[^/]+\/SKILL\.md$/.test(relativePath) && Buffer.byteLength(output, 'utf8') > 100 * 1024) throw new Error(`Skill exceeds 100KB: ${relativePath}`);
  return output;
}
