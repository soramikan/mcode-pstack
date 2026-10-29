import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const AGENT_NAMES = Object.freeze(['poteto-agent', 'comment-sicko']);
export const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_FILES = 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const MANIFEST = '.minimax-plugin/plugin.json';
const PORTABLE = /^[A-Za-z0-9._-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = new Set(['$schema', 'schemaVersion', 'name', 'displayName', 'version', 'description', 'author', 'icon', 'darkIcon', 'category', 'exampleQueries', 'apps', 'mcpServers', 'skills', 'hooks', 'hostBindings']);
const CATEGORIES = new Set(['Office', 'Studio', 'Design & Sites', 'Code', 'Business', 'Sales', 'Productivity', 'Science & Healthcare', 'Education', 'Other', 'Tools']);
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) { throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function inside(parent, child) { return child === parent || child.startsWith(`${parent}${path.sep}`); }
function portable(relative) {
  return typeof relative === 'string' && relative.length <= 512 && relative.split('/').every((part) => PORTABLE.test(part) && part !== '.' && part !== '..' && !part.endsWith('.'));
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }

// Reject symlinks at EVERY existing component, including ancestors of missing paths.
export async function assertSafePath(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0') || input.split(/[\\/]/).includes('..')) fail(`An explicit absolute path without traversal is required: ${input}`);
  const absolute = path.resolve(input);
  const root = path.parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await statOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail(`Symlink path is not allowed: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory()) fail(`Ancestor is not a directory: ${current}`);
    // realpath also guards canonical aliases not represented by a lexical symlink.
    if (await fs.realpath(current) !== current) fail(`Noncanonical ancestor is not allowed: ${current}`);
  }
  return absolute;
}

async function snapshot(root, kind) {
  await assertSafePath(root);
  const stat = await statOrNull(root);
  if (!stat) return null;
  let bytes = 0;
  const files = [];
  const directories = [];
  const casePaths = new Set();
  async function walk(file, relative) {
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) fail(`Symlink is not allowed: ${file}`);
    if (info.isDirectory() && kind === 'tree') {
      if (relative) directories.push(relative);
      for (const name of (await fs.readdir(file)).sort()) {
        const next = relative ? `${relative}/${name}` : name;
        if (!portable(next)) fail(`Nonportable package path: ${next}`);
        const folded = next.toLowerCase();
        if (casePaths.has(folded)) fail(`Case-colliding package path: ${next}`);
        casePaths.add(folded);
        await walk(path.join(file, name), next);
      }
    } else if (info.isFile() && (relative || kind === 'file')) {
      bytes += info.size;
      if (files.length >= MAX_FILES || bytes > MAX_BYTES) fail('Package exceeds 1024 files or 64 MiB');
      const content = await fs.readFile(file);
      bytes += content.length - info.size;
      if (bytes > MAX_BYTES) fail('Package exceeds 64 MiB');
      files.push({ path: relative, hash: digest(content), bytes: content.length });
    } else fail(`Expected ordinary ${kind === 'file' ? 'file' : 'package tree'}: ${file}`);
  }
  if (kind === 'tree' && !stat.isDirectory()) fail(`Expected package directory: ${root}`);
  await walk(root, '');
  return { hash: digest(JSON.stringify({ directories, files })), files, directories, bytes };
}

/** Basic native manifest/path validation only; the real MiniMax reader is a separate gate. */
export async function validatePackage(root) {
  const inventory = await snapshot(root, 'tree');
  if (!inventory) fail(`Package not found: ${root}`);
  const paths = new Set(inventory.files.map((file) => file.path));
  if (paths.has('plugin.json')) fail('Root plugin.json is forbidden; use .minimax-plugin/plugin.json');
  if (!paths.has(MANIFEST)) fail(`Missing native manifest: ${MANIFEST}`);
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8'));
  if (!object(manifest) || manifest.schemaVersion !== 1 || Object.keys(manifest).some((key) => !FIELDS.has(key)) || (manifest.$schema !== undefined && typeof manifest.$schema !== 'string')) fail('Invalid native manifest envelope');
  for (const key of ['name', 'version', 'description', 'author', 'icon']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) fail(`Invalid manifest ${key}`);
  }
  if (manifest.name !== 'pstack' || !SEMVER.test(manifest.version) || manifest.version.length > 128) fail('Expected pstack with a semver version');
  if (manifest.displayName !== undefined && (typeof manifest.displayName !== 'string' || !manifest.displayName.trim())) fail('Invalid displayName');
  if (!CATEGORIES.has(manifest.category)) fail('Invalid manifest category');
  if (!Array.isArray(manifest.exampleQueries) || manifest.exampleQueries.some((item) => typeof item !== 'string' || !item.trim())) fail('Invalid exampleQueries');
  const iconPattern = /\.(?:png|jpe?g|webp)$/;
  for (const key of ['icon', 'darkIcon']) {
    if (key === 'darkIcon' && manifest[key] === undefined) continue;
    if (!portable(manifest[key]) || !iconPattern.test(manifest[key]) || !paths.has(manifest[key])) fail(`Invalid or missing ${key}`);
  }
  const references = {
    apps: /\.app\.json$/,
    mcpServers: /\.mcp\.json$/,
    skills: /^skills\/[A-Za-z0-9._-]+\/SKILL\.md$/,
    hooks: /\.json$/,
    hostBindings: /^bindings\/[A-Za-z0-9._-]+\.binding\.json$/,
  };
  let capabilities = 0;
  for (const [key, pattern] of Object.entries(references)) {
    const items = manifest[key] ?? (['hooks', 'hostBindings'].includes(key) ? [] : undefined);
    if (!Array.isArray(items) || new Set(items).size !== items.length) fail(`Invalid manifest ${key}`);
    for (const item of items) {
      if (!portable(item) || !pattern.test(item) || !paths.has(item)) fail(`Invalid or missing ${key} path: ${item}`);
    }
    capabilities += items.length;
  }
  // Native miniapps can declare their capability in package.json instead.
  if (!capabilities && !paths.has('package.json')) fail('Plugin has no declared capability');
  return { manifest, ...inventory };
}

function agentSelection(agents = AGENT_NAMES) {
  if (!Array.isArray(agents) || new Set(agents).size !== agents.length || agents.some((name) => !AGENT_NAMES.includes(name))) fail('Agents must be selected from poteto-agent, comment-sicko');
  return [...agents];
}
function relativeTarget(key) {
  if (key === 'plugin') return 'plugins/pstack';
  if (AGENT_NAMES.includes(key)) return `agents/${key}/agent.md`;
  fail(`Unknown managed target: ${key}`);
}
function targetKind(key) { return key === 'plugin' ? 'tree' : 'file'; }
function statePaths(dataDir) {
  const state = path.join(dataDir, 'pstack');
  return { state, record: path.join(state, 'install-record.json'), lock: path.join(state, 'install.lock') };
}
async function context(options, lockOwner) {
  const dataDir = await assertSafePath(options.dataDir);
  if (dataDir === path.parse(dataDir).root) fail('Filesystem root is not a data directory');
  const repoRoot = await assertSafePath(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const packageRoot = path.join(repoRoot, 'plugins/pstack');
  if (inside(packageRoot, dataDir) || inside(dataDir, packageRoot)) fail('Source package and data directory must not overlap');
  const selected = agentSelection(options.agents);
  for (const name of selected) {
    const source = path.join(repoRoot, 'agent-configs', name);
    if (inside(source, dataDir) || inside(dataDir, source)) fail('Agent source and data directory must not overlap');
  }
  const paths = statePaths(dataDir);
  for (const file of [dataDir, paths.state, paths.record, paths.lock, path.join(paths.state, 'staging'), path.join(paths.state, 'transactions'), path.join(paths.state, 'quarantine'), path.join(paths.state, 'locks')]) await assertSafePath(file);
  const dataStat = await statOrNull(dataDir);
  if (dataStat && !dataStat.isDirectory()) fail('dataDir must be a directory');
  if (await statOrNull(paths.lock)) {
    if (!lockOwner || lockOwner.lock !== paths.lock) fail(`Installer lock exists: ${paths.lock}. Do not discard based on PID; inspect the transaction and resolve manually.`);
    const ownerPath = path.join(paths.lock, 'owner.json');
    await assertSafePath(ownerPath);
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    if (owner.transaction !== lockOwner.txid || owner.pid !== process.pid) fail('Installer lock ownership changed; stop for manual inspection');
  } else if (lockOwner) fail('Installer lock disappeared during transaction');
  const record = await readRecord(dataDir);
  return { dataDir, repoRoot, packageRoot, selected, paths, record };
}
async function readRecord(dataDir) {
  const file = statePaths(dataDir).record;
  if (!await statOrNull(file)) return { schemaVersion: 1, targets: {}, history: [] };
  if (!(await fs.lstat(file)).isFile()) fail('Ownership record is not a regular file');
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!object(record) || record.schemaVersion !== 1 || !object(record.targets) || !Array.isArray(record.history)) fail('Invalid ownership record; resolve manually');
  for (const [key, entry] of Object.entries(record.targets)) {
    relativeTarget(key);
    if (!object(entry) || !HASH.test(entry.hash) || typeof entry.transaction !== 'string' || !/^[A-Za-z0-9-]+$/.test(entry.transaction)) fail('Invalid ownership target');
    if (entry.backup !== null) {
      if (!object(entry.backup) || !HASH.test(entry.backup.hash) || !portable(entry.backup.path) || !/^pstack\/transactions\/[A-Za-z0-9-]+\/backups\/(plugin|poteto-agent|comment-sicko)$/.test(entry.backup.path) || path.posix.basename(entry.backup.path) !== key) fail('Invalid backup record');
      await assertSafePath(path.join(dataDir, entry.backup.path));
    }
  }
  return record;
}
async function inspectTarget(ctx, key) {
  const destination = path.join(ctx.dataDir, relativeTarget(key));
  await assertSafePath(destination);
  return { key, destination, kind: targetKind(key), current: await snapshot(destination, targetKind(key)), owned: ctx.record.targets[key] ?? null };
}
function assertOwned(target) {
  if (target.current && !target.owned) fail(`Unmanaged target already exists: ${target.destination}. Resolve manually; nothing was overwritten.`);
  if (target.owned && (!target.current || target.current.hash !== target.owned.hash)) fail(`Managed target missing or user-edited: ${target.destination}. Resolve manually; nothing was overwritten.`);
}

export async function planInstall(options) { return makeInstallPlan(options); }
async function makeInstallPlan(options, lockOwner) {
  const ctx = await context(options, lockOwner);
  const source = await validatePackage(ctx.packageRoot);
  const targets = [];
  for (const key of ['plugin', ...ctx.selected]) {
    const target = await inspectTarget(ctx, key);
    assertOwned(target);
    const sourcePath = key === 'plugin' ? ctx.packageRoot : path.join(ctx.repoRoot, 'agent-configs', key, 'agent.md');
    const desired = key === 'plugin' ? source : await snapshot(sourcePath, 'file');
    if (!desired) fail(`Agent source not found: ${sourcePath}`);
    targets.push({ ...target, source: sourcePath, desired, action: !target.current ? 'install' : target.current.hash === desired.hash ? 'unchanged' : 'update' });
  }
  return { operation: 'install', dataDir: ctx.dataDir, apply: false, localPluginInitiallyEnabled: true, note: 'Local MiniMax plugins are initially enabled. No user configuration is changed.', targets, record: ctx.record };
}

export async function planUninstall(options) { return makeUninstallPlan(options); }
async function makeUninstallPlan(options, lockOwner) {
  const ctx = await context(options, lockOwner);
  const targets = [];
  for (const key of ['plugin', ...ctx.selected]) {
    const owned = ctx.record.targets[key] ?? null;
    const base = { key, destination: path.join(ctx.dataDir, relativeTarget(key)), kind: targetKind(key), current: null, owned };
    // Unmanaged or edited/unsafe paths are never traversed destructively by uninstall.
    if (!owned) { targets.push({ ...base, action: 'not-managed', reason: null }); continue; }
    let target;
    try { target = await inspectTarget(ctx, key); }
    catch (error) { targets.push({ ...base, action: 'skip', reason: `unsafe or user-edited target retained: ${error.message}` }); continue; }
    let action = 'not-managed';
    let reason = null;
    if (target.owned) {
      if (!target.current) { action = 'skip'; reason = 'managed target is missing; ownership retained for manual resolution'; }
      else if (target.current.hash !== target.owned.hash) { action = 'skip'; reason = 'user-edited target retained'; }
      else if (target.owned.backup) {
        const backupPath = path.join(ctx.dataDir, target.owned.backup.path);
        try {
          const backup = await snapshot(backupPath, target.kind);
          if (!backup || backup.hash !== target.owned.backup.hash) { action = 'skip'; reason = 'backup missing or edited; target retained'; }
          else action = 'restore';
        } catch (error) { action = 'skip'; reason = `unsafe or edited backup; target retained: ${error.message}`; }
      } else action = 'quarantine';
    }
    targets.push({ ...target, action, reason });
  }
  return { operation: 'uninstall', dataDir: ctx.dataDir, apply: false, targets, record: ctx.record };
}

async function copySnapshot(source, destination, kind, expectedHash) {
  // Inventory is verified both before and after a non-symlink-following copy.
  const before = await snapshot(source, kind);
  if (!before || before.hash !== expectedHash) fail(`Source changed before copy: ${source}`);
  await assertSafePath(destination);
  if (await statOrNull(destination)) fail(`Copy destination exists: ${destination}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (kind === 'tree') {
    await fs.mkdir(destination);
    for (const directory of before.directories) await fs.mkdir(path.join(destination, directory));
    for (const file of before.files) {
      const from = path.join(source, file.path);
      await assertSafePath(from);
      const handle = await fs.open(from, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile()) fail(`Source is not a regular file: ${from}`);
        const bytes = await handle.readFile();
        if (digest(bytes) !== file.hash) fail(`Source changed while copying: ${from}`);
        await fs.writeFile(path.join(destination, file.path), bytes, { flag: 'wx', mode: info.mode & 0o777 });
      } finally { await handle.close(); }
    }
  } else {
    const bytes = await fs.readFile(source);
    await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
  }
  const after = await snapshot(destination, kind);
  if (after.hash !== expectedHash) fail(`Copy verification failed: ${destination}`);
}

function planFingerprint(plan) {
  return JSON.stringify({ record: plan.record, targets: plan.targets.map((target) => [target.key, target.action, target.current?.hash, target.desired?.hash, target.reason]) });
}
async function phase(options, name, details) {
  if (options.onPhase) await options.onPhase(name, details);
  if (options.failAt === name) fail(`Injected failure at ${name}`);
}

async function execute(options, operation) {
  const planner = operation === 'install' ? planInstall : planUninstall;
  const initial = await planner(options);
  if (!options.apply) return initial;
  const changes = initial.targets.filter((target) => operation === 'install' ? target.action !== 'unchanged' : ['restore', 'quarantine'].includes(target.action));
  if (!changes.length) return { ...initial, apply: true, transaction: null };
  await phase(options, 'preflight', initial);
  const paths = statePaths(initial.dataDir);
  const txid = `${Date.now()}-${randomUUID()}`;
  const tx = path.join(paths.state, 'transactions', txid);
  const staging = path.join(paths.state, 'staging', txid);
  const quarantine = path.join(paths.state, 'quarantine', txid);
  const lockArchive = path.join(paths.state, 'locks', txid);
  // A lock is never stolen, even if its PID appears dead.
  await fs.mkdir(paths.state, { recursive: true });
  try { await fs.mkdir(paths.lock); } catch (error) { if (error.code === 'EEXIST') fail(`Installer lock exists: ${paths.lock}; resolve manually`); throw error; }
  let journal;
  const applied = [];
  let publishedRecord = false;
  let previousRecordMoved = false;
  let success = false;
  let rollbackError;
  try {
    await fs.writeFile(path.join(paths.lock, 'owner.json'), json({ pid: process.pid, transaction: txid, operation, startedAt: new Date().toISOString() }), { flag: 'wx' });
    await phase(options, 'locked', { txid });
    // The planner must ignore only OUR lock, without any public bypass option.
    const lockedPlan = await planUnderLock(options, operation, paths.lock, txid);
    if (planFingerprint(lockedPlan) !== planFingerprint(initial)) fail('Preflight changed while acquiring lock; retry after inspecting targets');
    await phase(options, 'repreflight', lockedPlan);
    await fs.mkdir(tx, { recursive: true });
    await fs.mkdir(staging, { recursive: true });
    await fs.mkdir(quarantine, { recursive: true });
    journal = { schemaVersion: 1, transaction: txid, operation, status: 'preparing', targets: changes.map((target) => ({ key: target.key, action: target.action, before: target.current?.hash ?? null, after: target.desired?.hash ?? null, backup: target.current ? `pstack/transactions/${txid}/backups/${target.key}` : null })), events: [] };
    await saveJournal(tx, journal);
    await phase(options, 'backup', journal);
    // Backups are copies, remain available after commit/rollback, and are outside scanners.
    for (const target of changes) {
      if (target.current) await copySnapshot(target.destination, path.join(tx, 'backups', target.key), target.kind, target.current.hash);
    }
    await phase(options, 'backed-up', journal);
    for (const target of changes) {
      if (operation === 'install') await copySnapshot(target.source, path.join(staging, target.key), target.kind, target.desired.hash);
      else if (target.action === 'restore') await copySnapshot(path.join(initial.dataDir, target.owned.backup.path), path.join(staging, target.key), target.kind, target.owned.backup.hash);
    }
    await phase(options, 'staged', journal);
    journal.status = 'replacing';
    await saveJournal(tx, journal);
    for (const target of changes) {
      await assertSafePath(target.destination);
      const current = await snapshot(target.destination, target.kind);
      if ((current?.hash ?? null) !== (target.current?.hash ?? null)) fail(`Target changed during transaction: ${target.destination}`);
      const entry = { target, displaced: false, installed: false };
      applied.push(entry);
      await fs.mkdir(path.dirname(target.destination), { recursive: true });
      if (target.current) {
        await fs.rename(target.destination, path.join(quarantine, target.key));
        entry.displaced = true;
      }
      await phase(options, `displaced:${target.key}`, journal);
      if (operation === 'install' || target.action === 'restore') {
        await fs.rename(path.join(staging, target.key), target.destination);
        entry.installed = true;
      }
      journal.events.push({ key: target.key, replaced: true });
      await saveJournal(tx, journal);
      await phase(options, `replaced:${target.key}`, journal);
    }
    await phase(options, 'replaced', journal);
    for (const target of changes) {
      const expected = operation === 'install' ? target.desired.hash : target.action === 'restore' ? target.owned.backup.hash : null;
      const current = await snapshot(target.destination, target.kind);
      if ((current?.hash ?? null) !== expected) fail(`Installed target failed check: ${target.destination}`);
      if (target.key === 'plugin' && current) await validatePackage(target.destination);
    }
    await phase(options, 'checked', journal);
    const record = structuredClone(initial.record);
    for (const target of changes) {
      if (operation === 'install') record.targets[target.key] = { hash: target.desired.hash, transaction: txid, backup: target.current ? { path: `pstack/transactions/${txid}/backups/${target.key}`, hash: target.current.hash } : null };
      else delete record.targets[target.key];
    }
    record.history.push({ transaction: txid, operation, targets: changes.map((target) => ({ key: target.key, action: target.action })), at: new Date().toISOString() });
    await fs.writeFile(path.join(tx, 'next-record.json'), json(record), { flag: 'wx' });
    await phase(options, 'record', journal);
    if (await statOrNull(paths.record)) {
      await fs.rename(paths.record, path.join(tx, 'previous-record.json'));
      previousRecordMoved = true;
    }
    await fs.rename(path.join(tx, 'next-record.json'), paths.record);
    publishedRecord = true;
    await phase(options, 'recorded', journal);
    journal.status = 'committed';
    await saveJournal(tx, journal);
    success = true;
    return { ...initial, apply: true, transaction: txid, journal: path.join(tx, 'journal.json') };
  } catch (error) {
    try {
      // Only move bytes still matching this transaction's output. Never overwrite a concurrent edit.
      for (const entry of [...applied].reverse()) {
        const { target } = entry;
        if (entry.installed) {
          const expected = operation === 'install' ? target.desired.hash : target.owned.backup.hash;
          const current = await snapshot(target.destination, target.kind);
          if (!current || current.hash !== expected) fail(`Rollback stopped: concurrently edited ${target.destination}; recovery data: ${tx}`);
          await fs.rename(target.destination, path.join(quarantine, `${target.key}-rolled-back`));
        }
        if (entry.displaced) {
          if (await statOrNull(target.destination)) fail(`Rollback destination occupied: ${target.destination}; recovery data: ${tx}`);
          await fs.rename(path.join(quarantine, target.key), target.destination);
        }
      }
      if (publishedRecord) await fs.rename(paths.record, path.join(tx, 'rolled-back-record.json'));
      if (previousRecordMoved) await fs.rename(path.join(tx, 'previous-record.json'), paths.record);
      if (journal) { journal.status = 'rolled-back'; journal.error = error.message; await saveJournal(tx, journal); }
    } catch (recoveryError) {
      rollbackError = recoveryError;
      if (journal) { journal.status = 'recovery-required'; journal.error = `${error.message}; ${recoveryError.message}`; await saveJournal(tx, journal).catch(() => {}); }
    }
    if (rollbackError) throw new Error(`${error.message}; ${rollbackError.message}. Lock retained; manual recovery required.`);
    throw error;
  } finally {
    if (!rollbackError) {
      await fs.mkdir(path.dirname(lockArchive), { recursive: true });
      await fs.rename(paths.lock, lockArchive);
    }
    // No rm/unlink: staging, backups, quarantine and lock evidence remain recoverable.
    void success;
  }
}

async function saveJournal(tx, journal) {
  // Journal is diagnostic; backups + previous-record are the recovery authority.
  await fs.writeFile(path.join(tx, 'journal.json'), json(journal));
}

// Context is parameterized internally so no caller can opt out of lock checking.
async function planUnderLock(options, operation, lock, txid) {
  return (operation === 'install' ? makeInstallPlan : makeUninstallPlan)(options, { lock, txid });
}

export async function installLocal(options) { return execute(options, 'install'); }
export async function uninstallLocal(options) { return execute(options, 'uninstall'); }

export function parseArgs(args) {
  const options = { apply: false };
  let mode;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--data-dir') {
      if (options.dataDir !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) fail('--data-dir requires one explicit absolute path');
      options.dataDir = args[++index];
    } else if (arg === '--agents') {
      if (options.agents !== undefined || !args[index + 1]) fail('--agents requires comma-separated names or none');
      const selection = args[++index];
      options.agents = selection === 'none' ? [] : selection.split(',');
      agentSelection(options.agents);
    } else if (arg === '--dry-run' || arg === '--apply') {
      if (mode !== undefined) fail('Choose exactly one of --dry-run or --apply');
      mode = arg;
      options.apply = arg === '--apply';
    } else fail(`Unknown option: ${arg}`);
  }
  if (!options.help && (!options.dataDir || !path.isAbsolute(options.dataDir))) fail('--data-dir <absolute path> is required; no home-directory inference');
  return options;
}

export async function runCli(operation, args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(`Usage: node scripts/${operation === 'install' ? 'install' : 'uninstall'}-local.mjs --data-dir <absolute> [--dry-run | --apply] [--agents poteto-agent,comment-sicko | none]\nDefault: read-only preview; both agents selected. Entirely offline.`);
      return 0;
    }
    const result = await (operation === 'install' ? installLocal : uninstallLocal)(options);
    console.log(json({ operation, dataDir: result.dataDir, apply: result.apply, transaction: result.transaction ?? null, ...(operation === 'install' ? { localPluginInitiallyEnabled: true, note: result.note } : {}), targets: result.targets.map(({ key, destination, action, reason }) => ({ key, destination, action, ...(reason ? { reason } : {}) })) }));
    return 0;
  } catch (error) { console.error(error.message); return 1; }
}
