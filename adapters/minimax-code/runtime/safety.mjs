import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// Check every ancestor, not merely realpath containment: even in-root symlinks
// are forbidden. Callers must control their workspace against hostile mutation.
export function safePath(root, target, { missing = false } = {}) {
  root = path.resolve(root);
  target = path.resolve(target);
  if (!inside(root, target)) throw new Error('path outside approved root');
  let current = path.parse(target).root;
  const segments = target.slice(current.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error('symlink path forbidden');
      if ((i < segments.length - 1 || current === root) && !stat.isDirectory()) throw new Error('non-directory root or ancestor');
    } catch (error) {
      if (missing && error.code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export function ensureDirectory(root, target) {
  safePath(root, target, { missing: true });
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  safePath(root, target);
}

export function readText(root, target, maxBytes = 4 * 1024 * 1024) {
  target = safePath(root, target);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('file type or size limit');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > maxBytes) throw new Error('file size limit');
    return buffer.subarray(0, size).toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function readJson(root, target, maxBytes) {
  return JSON.parse(readText(root, target, maxBytes));
}

export function atomicJson(root, target, value) {
  ensureDirectory(root, path.dirname(target));
  safePath(root, target, { missing: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, target);
  const dir = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export function identifier(value, name = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) throw new Error(`invalid ${name}`);
  return value;
}
export function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function isMain(url) { return Boolean(process.argv[1]) && url === pathToFileURL(path.resolve(process.argv[1])).href; }
export function cliInput(help, main) {
  if (process.argv.length === 3 && process.argv[2] === '--help') { console.log(help); return; }
  if (process.argv.length !== 4 || process.argv[2] !== '--request') { console.error(help); process.exitCode = 2; return; }
  Promise.resolve().then(() => main(readJson(process.cwd(), path.resolve(process.argv[3]))))
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
