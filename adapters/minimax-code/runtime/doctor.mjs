import { execFileSync } from 'node:child_process';
import { cliInput, isMain } from './safety.mjs';

export const REQUIRED_EXEC_FLAGS = Object.freeze(['--cwd', '--input', '--output-format', '--model', '--effort', '--permission', '--timeout', '--max-steps']);
/** Query-only: version and help, never a model call, install, or download.
 * A passing doctor confirms advertised flags, not backend/model availability. */
export function doctor({ executable = 'mcode', executableArgs = [], timeoutMs = 3000 } = {}) {
  if (typeof executable !== 'string' || !executable || executable.includes('\0') || !Array.isArray(executableArgs) || executableArgs.length > 64 || executableArgs.some(v => typeof v !== 'string' || v.includes('\0') || v.length > 4096) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('invalid explicit doctor input');
  const diagnostics = [];
  const query = args => {
    try {
      return execFileSync(executable, [...executableArgs, ...args], { encoding: 'utf8', shell: false, timeout: timeoutMs, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { diagnostics.push({ code: error.code ?? 'nonzero_exit', query: args }); return null; }
  };
  const version = query(['--version']);
  const help = query(['exec', '--help']);
  const flags = Object.fromEntries(REQUIRED_EXEC_FLAGS.map(flag => [flag, help !== null && new RegExp(`${flag}(?=[\\s=,<]|$)`).test(help)]));
  for (const [flag, supported] of Object.entries(flags)) if (!supported) diagnostics.push({ code: 'missing_cli_capability', flag });
  return { schemaVersion: 1, ok: version !== null && diagnostics.length === 0, queryOnly: true, executable, version: version?.trim() ?? null, flags, diagnostics, boundaries: ['Help is not proof of exec.result schema compatibility.', 'Effective parent model/effort and approved model catalog must be supplied explicitly.', 'No configuration, history, install, download, or model endpoint was queried.'] };
}
export const HELP = 'Usage: node doctor.mjs --help | --request <workspace-relative JSON>\nRequest: {executable?:"mcode",executableArgs?:[],timeoutMs?:3000}. Only --version and exec --help are run; no install/download or model call.';
if (isMain(import.meta.url)) cliInput(HELP, doctor);
