import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configRequest, loadConfig, nativeTaskOptions, saveRoleSetup, validateConfig, parseModelKey } from '../../adapters/minimax-code/runtime/config.mjs';
import { sandbox, json } from '../fixtures/runtime/helpers.mjs';

test('dedicated config precedence, defaults and explicit provenance', t => {
  const workspace = sandbox(t, 'config');
  const dataDir = path.join(workspace, 'data');
  fs.mkdirSync(dataDir);
  json(path.join(dataDir, 'pstack/config.json'), { schemaVersion: 1, roles: { planner: { model: 'p/data', effort: 'high', family: 'explicit-family' } }, maxWorkers: 4 });
  json(path.join(workspace, '.pstack/config.json'), { schemaVersion: 1, roles: { planner: { model: 'p/project' } }, panels: ['planner'] });
  // A poisoned general config must not be opened.
  fs.writeFileSync(path.join(dataDir, 'config.json'), 'not JSON; synthetic secret');
  const resolved = loadConfig({ workspace, dataDir, explicit: { schemaVersion: 1, roles: { planner: { model: 'p/explicit', effort: 'low' } } } });
  assert.deepEqual(resolved.config.roles.planner, { model: 'p/explicit', effort: 'low' });
  assert.equal(resolved.config.maxWorkers, 4);
  assert.deepEqual(resolved.config.panels, ['planner']);
  assert.deepEqual(nativeTaskOptions(resolved, 'planner'), { options: { model: 'p/explicit', effort: 'low' }, provenance: { model: 'explicit', effort: 'explicit' } });
  assert.deepEqual(nativeTaskOptions(loadConfig({ workspace: dataDir }), 'worker').options, {});
  assert.equal(loadConfig({ workspace: dataDir }).config.maxWorkers, 2);
  const project = loadConfig({ workspace, dataDir });
  assert.deepEqual(project.config.roles.planner, { model: 'p/project' });
  assert.equal(project.provenance.roles.planner.model, 'project');
});

test('native inheritance omits unselected model and effort; explicit effort only stays explicit', t => {
  const workspace = sandbox(t, 'native');
  const inherited = loadConfig({ workspace, explicit: { schemaVersion: 1, roles: { worker: { model: 'inherit-parent' } } } });
  assert.deepEqual(nativeTaskOptions(inherited, 'worker').options, {});
  const effort = loadConfig({ workspace, explicit: { schemaVersion: 1, roles: { worker: { effort: 'high' } } } });
  assert.deepEqual(nativeTaskOptions(effort, 'worker').options, { effort: 'high' });
  assert.throws(() => nativeTaskOptions({ config: { roles: { worker: { model: 'p/m' } } }, provenance: { roles: {} } }, 'worker'), /unapproved/);
});

test('setup is confirmed, dedicated, atomic and validates selections', t => {
  const workspace = sandbox(t, 'setup');
  const request = { workspace, role: 'worker', selection: { model: 'custom_provider:acme/model#thinking', effort: 'high', family: 'review' } };
  assert.throws(() => saveRoleSetup(request), /confirmation/);
  const result = saveRoleSetup({ ...request, confirmed: true });
  assert.equal(result.path, path.join(workspace, '.pstack/config.json'));
  assert.deepEqual(loadConfig({ workspace }).config.roles.worker, request.selection);
  assert.equal(fs.readdirSync(path.dirname(result.path)).some(name => name.endsWith('.tmp')), false);
  const dataDir = path.join(workspace, 'dedicated-data'); fs.mkdirSync(dataDir);
  const dataSaved = configRequest({ operation: 'save-role', workspace, dataDir, scope: 'dataDir', role: 'planner', selection: { model: 'p/m' }, confirmed: true });
  assert.equal(dataSaved.path, path.join(dataDir, 'pstack/config.json'));
  assert.equal(configRequest({ operation: 'load', workspace, dataDir }).config.roles.planner.model, 'p/m');
  assert.throws(() => configRequest({ operation: 'save', workspace }), /unknown/);
  assert.throws(() => validateConfig({ schemaVersion: 2 }), /schema/);
  assert.throws(() => validateConfig({ schemaVersion: 1, apiKey: 'no' }), /unknown/);
  for (const effort of ['', 'high;command', 42, {}]) assert.throws(() => validateConfig({ schemaVersion: 1, roles: { worker: { effort } } }), /effort/);
  assert.throws(() => parseModelKey('shorthand'), /source-qualified/);
  assert.throws(() => saveRoleSetup({ ...request, role: '../outside', confirmed: true }), /role/);
  const other = path.join(workspace, 'other'); fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(workspace, '.linked'));
  assert.throws(() => loadConfig({ workspace: path.join(workspace, '.linked') }), /symlink/);
});
