import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rejectSymlink = async (file) => {
  try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error(`output symlink is not allowed: ${file}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
};

const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${output}`)));
});

// Generator applies the file replacements first. No writes outside packageRoot.
export async function buildTools({ root, packageRoot }) {
  root = await fs.realpath(root);
  packageRoot = await fs.realpath(packageRoot);
  if (root === packageRoot || !packageRoot.startsWith(root + path.sep) || packageRoot.startsWith(path.join(root, 'vendor') + path.sep))
    throw new Error('packageRoot must be a separate output directory inside root, outside vendor');
  const commander = path.join(root, 'node_modules/commander');
  const metadata = JSON.parse(await fs.readFile(path.join(commander, 'package.json'), 'utf8'));
  if (metadata.version !== '14.0.0') throw new Error('commander 14.0.0 is required; install root development dependencies explicitly');
  const relative = 'skills/poteto-mode/scripts/watch-pr';
  const entry = path.join(packageRoot, relative, 'cli.ts');
  const outdir = path.join(packageRoot, relative);
  if ((await fs.realpath(outdir)) !== outdir) throw new Error('package output symlinks are not allowed');
  await rejectSymlink(path.join(outdir, 'cli.js'));
  const driver = `
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}], outdir: ${JSON.stringify(outdir)},
      naming: 'cli.js', target: 'bun', format: 'esm', packages: 'bundle',
      // Omit location comments so output is independent of staging-directory depth.
      sourcemap: 'none', minify: { whitespace: true, identifiers: false, syntax: false },
      plugins: [{ name: 'root-commander', setup(build) {
        build.onResolve({ filter: /^commander$/ }, () => ({ path: ${JSON.stringify(path.join(commander, 'esm.mjs'))} }));
      }}],
    });
    if (!result.success) { console.error(...result.logs); process.exit(1); }
  `;
  await run('bun', ['--eval', driver], { cwd: packageRoot });
  const licenses = path.join(packageRoot, 'licenses');
  await fs.mkdir(licenses, { recursive: true });
  if ((await fs.realpath(licenses)) !== licenses) throw new Error('license output symlinks are not allowed');
  await rejectSymlink(path.join(licenses, 'commander-14.0.0.txt'));
  await fs.copyFile(path.join(commander, 'LICENSE'), path.join(licenses, 'commander-14.0.0.txt'));
  const noticePath = path.join(packageRoot, 'THIRD_PARTY_NOTICES.md');
  let notices = '';
  try {
    if ((await fs.lstat(noticePath)).isSymbolicLink()) throw new Error('notice output symlinks are not allowed');
    notices = await fs.readFile(noticePath, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!notices.includes('## commander 14.0.0'))
    await fs.writeFile(noticePath, `${notices}\n## commander 14.0.0\n\nMIT licensed; bundled into watch-pr/cli.js. Full license: [licenses/commander-14.0.0.txt](licenses/commander-14.0.0.txt).\n`);
  return { bundled: [`${relative}/cli.js`], licenses: ['licenses/commander-14.0.0.txt'] };
}
