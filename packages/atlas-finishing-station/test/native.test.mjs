import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, writeFile, chmod, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createNativeCompanion, readProtectedStationFile, verifyNativeExecutable } from '../src/native.mjs';
function fixture() {
  const calls = [], processes = [], f = { calls, processes, corrupt: false };
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', 0)); }; processes.push(child); calls.push({ executable, args, options });
    child.stdin = new Writable({ write(chunk, encoding, done) { const value = JSON.parse(chunk.toString()); queueMicrotask(() => child.stdout.write(JSON.stringify({ id: f.corrupt ? 'wrong-id' : value.id, ok: true, result: { op: value.op } }) + '\n')); done(); } });
    if (args[0] !== 'serve') queueMicrotask(() => { child.stdout.write(JSON.stringify(args[0] === 'full-sync' ? { synced: true } : { qualifiedProfileAvailable: false })); child.emit('close', 0); });
    return child;
  };
  f.native = createNativeCompanion({ executable: '/protected/companion', configurationPath: '/protected/station.json', spawnImpl }); return f;
}
test('native binding is cold, pins argv, strips inherited environment, and full-sync uses fd3', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  assert.equal((await f.native.capabilities()).qualifiedProfileAvailable, false);
  assert.equal((await f.native.fullSync(29)).synced, true);
  assert.deepEqual(f.calls[1].args, ['full-sync','--fd','3']); assert.deepEqual(f.calls[1].options.stdio, ['ignore','pipe','pipe',29]);
  const replies = await Promise.all([f.native.request('presence'), f.native.request('observe-empty')]);
  assert.deepEqual(replies.map(value => value.op), ['presence','observe-empty']);
  assert.deepEqual(f.calls[2].args, ['serve','--configuration','/protected/station.json']);
  assert.deepEqual(Object.keys(f.calls[2].options.env).sort(), ['LANG','LC_ALL','PATH']); assert.equal(f.calls[2].options.shell, false);
  assert.throws(() => f.native.request('apdu', { hex: 'FF00' }), /NATIVE_INVALID/); f.native.shutdown();
});
test('unexpected native response terminates that session, never auto-restarts, and only explicit completed custody permits fresh process', async () => {
  const f = fixture(); f.corrupt = true; await assert.rejects(f.native.request('presence'), /RESPONSE_INVALID/);
  await assert.rejects(f.native.request('presence'), /SESSION_CLOSED/); assert.equal(f.processes.length, 1); assert.equal(f.processes[0].killed, true);
  f.corrupt = false; f.native.resetAfterCompletion(); assert.equal((await f.native.request('presence')).op, 'presence'); assert.equal(f.processes.length, 2); f.native.shutdown();
});
test('configuration check has one fixed native command and does not start a persistent session or key lookup', async () => {
  const f = fixture(); await f.native.validateConfiguration();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, ['validate-configuration', '--configuration', '/protected/station.json']);
  assert.deepEqual(f.calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});
test('protected configuration and executable verification reject public permissions, symlinks and build changes', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'atlas-station-file-test-'))); try {
    const config = join(dir, 'config.json'), binary = join(dir, 'native'), link = join(dir, 'link');
    await writeFile(config, '{}', { mode: 0o600 }); assert.equal((await readProtectedStationFile(config)).toString(), '{}');
    await chmod(config, 0o644); await assert.rejects(readProtectedStationFile(config), /NOT_PROTECTED/);
    await writeFile(binary, 'synthetic executable bytes', { mode: 0o700 }); const hash = createHash('sha256').update('synthetic executable bytes').digest('hex');
    await verifyNativeExecutable(binary, hash); await assert.rejects(verifyNativeExecutable(binary, 'a'.repeat(64)), /BUILD_MISMATCH/);
    await symlink(binary, link); await assert.rejects(verifyNativeExecutable(link, hash), /symbolic links|ELOOP/);
    await chmod(dir, 0o777); await assert.rejects(readProtectedStationFile(config), /PARENT_NOT_PROTECTED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
