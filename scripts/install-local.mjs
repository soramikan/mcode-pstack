import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/install.mjs';

export { installLocal, planInstall } from './lib/install.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli('install');
}
