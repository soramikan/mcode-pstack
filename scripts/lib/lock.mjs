import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { assertNoSymlinks, json } from './tree.mjs';

export async function withRepositoryLock(root, name, action) {
  if (!/^[a-z][a-z-]+$/.test(name)) throw new Error('Unsafe lock name');
  const state = path.join(root, '.pstack');
  await assertNoSymlinks(state);
  await mkdir(state, { recursive: true });
  const lock = path.join(state, `${name}.lock`);
  const id = randomUUID();
  try { await mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Repository ${name} lock exists. Inspect its owner and staging before manual recovery; locks are never stolen based on PID alone.`); throw error; }
  let retain = false;
  try {
    await writeFile(path.join(lock, 'owner.json'), json({ schemaVersion: 1, pid: process.pid, id, name, startedAt: new Date().toISOString() }), { flag: 'wx' });
    return await action();
  } catch (error) {
    retain = error.retainRepositoryLock === true;
    throw error;
  } finally {
    if (!retain) {
      const archive = path.join(state, 'locks');
      await assertNoSymlinks(archive);
      await mkdir(archive, { recursive: true });
      await rename(lock, path.join(archive, `${name}-${id}`));
    }
  }
}
