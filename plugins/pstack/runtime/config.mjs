import path from 'node:path';
import { atomicJson, cliInput, identifier, isMain, readJson, record, safePath } from './safety.mjs';

export const DEFAULT_CONFIG = Object.freeze({ schemaVersion: 1, roles: Object.freeze({}), panels: Object.freeze([]), maxWorkers: 2 });
const own = (o, k) => Object.hasOwn(o, k);
export function parseModelKey(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value) || !/^[A-Za-z0-9_.:-]+\/[^\s#]+(?:#[^\s#]+)?$/.test(value)) throw new Error('model requires an exact source-qualified provider/model[#variant] key');
  const slash = value.indexOf('/');
  const hash = value.indexOf('#', slash);
  return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1, hash < 0 ? undefined : hash), ...(hash < 0 ? {} : { variant: value.slice(hash + 1) }) };
}
export function validateRole(value) {
  if (!record(value) || Object.keys(value).some(k => !['model', 'effort', 'family'].includes(k))) throw new Error('invalid role selection');
  if (own(value, 'model') && value.model !== 'inherit-parent') parseModelKey(value.model);
  if (own(value, 'effort') && value.effort !== null && (typeof value.effort !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(value.effort))) throw new Error('invalid effort');
  if (own(value, 'family') && (typeof value.family !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(value.family))) throw new Error('invalid family metadata');
  return structuredClone(value);
}
export function validateConfig(value) {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('unsupported pstack config schemaVersion');
  if (Object.keys(value).some(k => !['schemaVersion', 'roles', 'panels', 'maxWorkers'].includes(k))) throw new Error('unknown pstack config field');
  const out = { schemaVersion: 1 };
  if (own(value, 'roles')) {
    if (!record(value.roles)) throw new Error('roles must be an object');
    out.roles = Object.fromEntries(Object.entries(value.roles).map(([role, selection]) => [identifier(role, 'role'), validateRole(selection)]));
  }
  if (own(value, 'panels')) {
    if (!Array.isArray(value.panels) || value.panels.length > 32 || value.panels.some(v => typeof v !== 'string')) throw new Error('panels must be an array of role names');
    out.panels = value.panels.map(v => identifier(v, 'panel'));
  }
  if (own(value, 'maxWorkers')) {
    if (!Number.isSafeInteger(value.maxWorkers) || value.maxWorkers < 1 || value.maxWorkers > 32) throw new Error('maxWorkers must be 1..32');
    out.maxWorkers = value.maxWorkers;
  }
  return out;
}

/** Only dedicated pstack files are read. No home discovery or general config. */
export function loadConfig({ workspace, dataDir, explicit } = {}) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('absolute workspace required');
  safePath(workspace, workspace);
  const sources = [{ source: 'defaults', value: DEFAULT_CONFIG }];
  for (const [root, source, rel] of [[dataDir, 'dataDir', 'pstack/config.json'], [workspace, 'project', '.pstack/config.json']]) {
    if (root === undefined) continue;
    if (!path.isAbsolute(root)) throw new Error('absolute dataDir required');
    const file = safePath(root, path.join(root, rel), { missing: true });
    try { sources.push({ source, value: validateConfig(readJson(root, file, 128 * 1024)) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (explicit !== undefined) sources.push({ source: 'explicit', value: validateConfig(explicit) });
  const config = structuredClone(DEFAULT_CONFIG);
  const provenance = { roles: {}, panels: 'defaults', maxWorkers: 'defaults' };
  for (const { source, value } of sources) {
    for (const key of ['panels', 'maxWorkers']) if (own(value, key)) { config[key] = structuredClone(value[key]); provenance[key] = source; }
    for (const [role, selection] of Object.entries(value.roles ?? {})) {
      let target = own(config.roles, role) ? config.roles[role] : { model: 'inherit-parent' };
      let origin = own(provenance.roles, role) ? provenance.roles[role] : { model: 'defaults' };
      // A new model selection is a new group; never carry another model's effort.
      if (own(selection, 'model')) { target = {}; origin = {}; }
      config.roles[role] = { ...target, ...selection };
      provenance.roles[role] = { ...origin, ...Object.fromEntries(Object.keys(selection).map(k => [k, source])) };
    }
  }
  return { config, provenance };
}

/** Native Task inherits by omission. Provenance is not sent to the native tool. */
export function nativeTaskOptions(resolved, role) {
  identifier(role, 'role');
  const selection = validateRole(own(resolved.config.roles, role) ? resolved.config.roles[role] : {});
  const provenance = own(resolved.provenance.roles, role) ? resolved.provenance.roles[role] : {};
  const options = {};
  if (selection.model && selection.model !== 'inherit-parent') {
    if (!provenance.model || provenance.model === 'defaults') throw new Error('unapproved native model');
    options.model = selection.model;
  }
  if (typeof selection.effort === 'string') {
    if (!provenance.effort || provenance.effort === 'defaults') throw new Error('unapproved native effort');
    options.effort = selection.effort;
  }
  return { options, provenance: structuredClone(provenance) };
}

/** Save one role only after explicit user confirmation, to a dedicated path. */
export function saveRoleSetup({ workspace, dataDir, scope = 'project', role, selection, confirmed }) {
  if (confirmed !== true) throw new Error('user confirmation required');
  identifier(role, 'role');
  selection = validateRole(selection);
  const root = scope === 'project' ? workspace : scope === 'dataDir' ? dataDir : undefined;
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('explicit setup root required');
  const file = safePath(root, path.join(root, scope === 'project' ? '.pstack/config.json' : 'pstack/config.json'), { missing: true });
  let value = { schemaVersion: 1, roles: {} };
  try { value = validateConfig(readJson(root, file, 128 * 1024)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  value.roles = { ...value.roles, [role]: selection };
  atomicJson(root, file, value);
  return { path: file, config: value };
}

export function configRequest(request) {
  if (request.operation === 'save-role') return saveRoleSetup(request);
  if (request.operation === undefined || request.operation === 'load') return loadConfig(request);
  throw new Error('unknown config operation');
}
export const HELP = 'Usage: node config.mjs --help | --request <workspace-relative JSON>\nLoad: {operation?:"load",workspace:absolute,dataDir?:absolute,explicit?:{schemaVersion:1,roles?,panels?,maxWorkers?}}. Save: {operation:"save-role",workspace:absolute,dataDir?:absolute,scope:"project"|"dataDir",role,selection:{model,effort?,family?},confirmed:true}. Only dedicated pstack config paths are read/written.';
if (isMain(import.meta.url)) cliInput(HELP, configRequest);
