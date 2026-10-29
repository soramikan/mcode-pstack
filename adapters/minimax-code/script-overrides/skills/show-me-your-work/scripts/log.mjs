import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult\n';
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
function noLinks(file) {
  let part = path.parse(file).root;
  for (const component of file.slice(part.length).split(path.sep)) {
    part = path.join(part, component);
    try { if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Audit log symlinks are forbidden'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
export function appendStandaloneLog({ workspace, logfile, cells }) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || typeof logfile !== 'string' || !logfile || !Array.isArray(cells) || cells.length !== 5 || cells.some(cell => typeof cell !== 'string')) throw new Error('Usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>');
  if (Buffer.byteLength(cells.join('')) > 64 * 1024) throw new Error('Audit row exceeds 64 KiB');
  const file = path.resolve(workspace, logfile), dir = path.dirname(file);
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  if (!inside(path.resolve(workspace), file) || inside(path.resolve(packageRoot), file)) throw new Error('Audit log must stay in the workspace and outside the immutable package');
  noLinks(file);
  if (fs.existsSync(path.join(dir, 'state.json')) || fs.existsSync(path.join(dir, 'writer.lock'))) throw new Error('Managed run: append through the parent lease.appendDecision API so its index stays synchronized');
  const clean = value => {
    const text = value.replace(/[\t\r\n\u2028\u2029]+/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    return /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
  };
  const values = cells.map(clean);
  if (!values[0].trim() || !values[1].trim()) throw new Error('phase and decision are required');
  fs.mkdirSync(dir, { recursive: true });
  const lock = `${file}.writer-lock`;
  const token = randomUUID();
  let lockfd;
  try { lockfd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Standalone audit writer lock exists; inspect it before manual recovery'); throw error; }
  try {
    fs.writeFileSync(lockfd, JSON.stringify({ pid: process.pid, token })); fs.fsyncSync(lockfd);
    noLinks(file);
    let prior = '';
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Audit log type/size limit');
      prior = fs.readFileSync(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior && (!prior.startsWith(HEADER) || !prior.endsWith('\n') || prior.slice(HEADER.length).split('\n').filter(Boolean).some(line => line.split('\t').length !== 6))) throw new Error('Existing audit log is malformed; never truncate history');
    const ts = new Date().toISOString();
    const row = `${ts}\t${values.join('\t')}\n`;
    if (Buffer.byteLength(prior) + Buffer.byteLength(row) > 4 * 1024 * 1024) throw new Error('Audit log exceeds 4 MiB');
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, `${prior ? '' : HEADER}${row}`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { path: file, ts };
  } finally {
    fs.closeSync(lockfd);
    // Only this invocation's control lock, never history or user files.
    noLinks(lock);
    if (JSON.parse(fs.readFileSync(lock, 'utf8')).token !== token) throw new Error('Audit lock ownership changed; lock retained');
    fs.unlinkSync(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(appendStandaloneLog({ workspace: process.cwd(), logfile: process.argv[2], cells: process.argv.slice(3) }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
