import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, rename, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const gitBlobHash = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)
      || value.split('/').some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`Unsafe portable relative path: ${JSON.stringify(value)}`);
  }
  return value;
}
export async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function assertNoSymlinks(file) {
  let cursor = path.resolve(file);
  for (;;) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${cursor}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
export async function walk(root) {
  await assertNoSymlinks(root);
  const files = [];
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeRelative(relative);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in tree: ${relative}`);
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Non-regular file in tree: ${relative}`);
    }
  }
  await visit(root);
  return files;
}
export async function treeRecords(root) {
  const records = {};
  for (const file of await walk(root)) {
    const bytes = await readFile(path.join(root, file));
    records[file] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  return records;
}
export function treeHash(records) {
  return sha256(Object.keys(records).sort().map((name) => `${name}\0${records[name].sha256}\0${records[name].bytes}\n`).join(''));
}
export async function atomicWrite(file, content) {
  await assertNoSymlinks(file);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx' });
  await rename(temporary, file);
}
export async function writeTreeFile(root, relative, bytes) {
  safeRelative(relative);
  const target = path.join(root, relative);
  if (!within(root, target)) throw new Error('Tree path escaped output');
  await atomicWrite(target, bytes);
}
export async function assertCanonicalDirectory(dir) {
  await assertNoSymlinks(dir);
  if (path.resolve(await realpath(dir)) !== path.resolve(dir)) throw new Error(`Non-canonical directory: ${dir}`);
}
export function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
