#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TLC_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
export const TLC_URL = 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar';

// No JRE/mise/pele acquisition. This command is the only network bootstrap.
export async function bootstrapTools(args) {
  const at = args.indexOf('--workspace');
  if (at < 0 || !args[at + 1] || !args.includes('--approve-download'))
    throw new Error('BLOCKED: explicit approval required. Usage: node bootstrap-tools.mjs --workspace <repo> --approve-download');
  if (args.length !== 3) throw new Error('Unknown arguments');
  const workspace = await fs.realpath(path.resolve(args[at + 1]));
  const packageRoot = await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url)));
  if (workspace === packageRoot || workspace.startsWith(packageRoot + path.sep))
    throw new Error('BLOCKED: workspace must be outside the installed package');
  let cache = workspace;
  for (const part of ['.pstack', 'cache']) {
    cache = path.join(cache, part);
    await fs.mkdir(cache, { recursive: true });
    if ((await fs.lstat(cache)).isSymbolicLink()) throw new Error('BLOCKED: cache symlinks are not allowed');
  }
  const destination = path.join(cache, 'tla2tools-1.7.4.jar');
  const valid = (bytes) => createHash('sha256').update(bytes).digest('hex') === TLC_SHA256;
  try {
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('BLOCKED: cached JAR symlinks are not allowed');
    const bytes = await fs.readFile(destination);
    if (valid(bytes)) return destination;
    throw new Error('BLOCKED: existing cache JAR checksum mismatch; inspect it manually');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(TLC_URL);
  if (!response.ok) throw new Error(`TLC download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('BLOCKED: TLC 1.7.4 checksum mismatch; nothing written');
  await fs.writeFile(destination, bytes, { flag: 'wx' });
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`TLA2TOOLS=${await bootstrapTools(process.argv.slice(2))}`); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
