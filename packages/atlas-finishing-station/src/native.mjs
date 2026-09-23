import { spawn } from 'node:child_process';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'STATION_NATIVE_INVALID') => { if (!value) throw fail(code); };
const safeEnvironment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
async function protectedParents(path, privateParent) {
  check(isAbsolute(path) && resolve(path) === path, 'STATION_CONFIG_PATH_INVALID');
  let parent = dirname(path), first = true;
  while (true) {
    const stat = await lstat(parent), owned = stat.uid === process.getuid() || stat.uid === 0;
    // Root-owned sticky directories preserve ownership of their child entries.
    const sticky = stat.uid === 0 && (stat.mode & 0o1000);
    check(stat.isDirectory() && !stat.isSymbolicLink() && owned && (!(stat.mode & 0o022) || sticky)
      && (!first || !privateParent || stat.uid === process.getuid() && !(stat.mode & 0o077)), 'STATION_PARENT_NOT_PROTECTED');
    if (parent === '/') break;
    parent = dirname(parent); first = false;
  }
}
async function protectedRead(path, { maxBytes, executable = false }) {
  await protectedParents(path, !executable);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && (executable ? !(stat.mode & 0o022) && (stat.mode & 0o100) && (stat.uid === process.getuid() || stat.uid === 0)
      : !(stat.mode & 0o077) && stat.uid === process.getuid()) && stat.size > 0 && stat.size <= maxBytes,
    executable ? 'STATION_NATIVE_NOT_PROTECTED' : 'STATION_CONFIG_NOT_PROTECTED');
    const bytes = await handle.readFile(); check(bytes.length > 0 && bytes.length <= maxBytes, 'STATION_FILE_SIZE_INVALID'); return bytes;
  } finally { await handle.close(); }
}
export async function readProtectedStationFile(path, maxBytes = 131072) {
  check(typeof path === 'string' && isAbsolute(path), 'STATION_CONFIG_PATH_INVALID');
  return protectedRead(path, { maxBytes });
}
export async function verifyNativeExecutable(path, sha256) {
  check(isAbsolute(path) && /^[a-f0-9]{64}$/.test(sha256 ?? ''), 'STATION_NATIVE_PATH_INVALID');
  const bytes = await protectedRead(path, { maxBytes: 32 * 1024 * 1024, executable: true });
  check(createHash('sha256').update(bytes).digest('hex') === sha256, 'STATION_NATIVE_BUILD_MISMATCH');
}

function run(executable, args, { spawnImpl, fd, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { shell: false, env: safeEnvironment,
      stdio: ['ignore', 'pipe', 'pipe', ...(fd === undefined ? [] : [fd])] });
    let output = '', errorBytes = 0, failed = false;
    const stop = code => { if (failed) return; failed = true; clearTimeout(timer); child.kill('SIGKILL'); reject(fail(code)); };
    const timer = setTimeout(() => stop('STATION_NATIVE_TIMEOUT'), timeoutMs);
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (Buffer.byteLength(output) > 131072) stop('STATION_NATIVE_RESPONSE_TOO_LARGE'); });
    child.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 16384) stop('STATION_NATIVE_RESPONSE_TOO_LARGE'); });
    child.on('error', () => stop('STATION_NATIVE_UNAVAILABLE'));
    child.on('close', code => {
      clearTimeout(timer); if (failed) return;
      if (code !== 0) { reject(fail('STATION_NATIVE_REFUSED')); return; }
      try { const result = JSON.parse(output); check(result && typeof result === 'object'); resolve(result); }
      catch { reject(fail('STATION_NATIVE_RESPONSE_INVALID')); }
    });
  });
}

/** Concrete newline-JSON native binding. There is no shell, arbitrary command
 * route, APDU escape hatch or inherited private-key/provider environment.
 * Process loss is terminal for the current session; callers reconcile journals.
 */
export function createNativeCompanion({ executable, configurationPath, spawnImpl = spawn }) {
  check(typeof executable === 'string' && isAbsolute(executable) && typeof configurationPath === 'string' && isAbsolute(configurationPath));
  let child = null, pending = null, buffer = '', closed = false, sequence = Promise.resolve();
  function abort(code) {
    closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(fail(code)); pending = null; }
    child?.kill('SIGKILL');
  }
  function start() {
    check(!closed, 'STATION_NATIVE_SESSION_CLOSED'); if (child) return;
    child = spawnImpl(executable, ['serve', '--configuration', configurationPath], { shell: false, env: safeEnvironment, stdio: ['pipe','pipe','pipe'] });
    const owned = child;
    let errorBytes = 0;
    child.stderr.on('data', chunk => { if (child !== owned) return; errorBytes += chunk.length; if (errorBytes > 16384) abort('STATION_NATIVE_RESPONSE_TOO_LARGE'); });
    child.stdin.on('error', () => { if (child === owned) abort('STATION_NATIVE_UNAVAILABLE'); });
    child.stdout.on('data', chunk => {
      if (child !== owned) return;
      buffer += chunk.toString('utf8'); if (Buffer.byteLength(buffer) > 131072) { abort('STATION_NATIVE_RESPONSE_TOO_LARGE'); return; }
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let value; try { value = JSON.parse(line); } catch { abort('STATION_NATIVE_RESPONSE_INVALID'); return; }
        if (!pending || value.id !== pending.id || typeof value.ok !== 'boolean') { abort('STATION_NATIVE_RESPONSE_INVALID'); return; }
        const request = pending; pending = null; clearTimeout(request.timer);
        value.ok ? request.resolve(value.result) : request.reject(fail(typeof value.error === 'string' && /^[A-Z0-9_]{1,100}$/.test(value.error) ? value.error : 'STATION_NATIVE_REFUSED'));
      }
    });
    child.on('error', () => { if (child === owned) abort('STATION_NATIVE_UNAVAILABLE'); });
    child.on('close', () => { if (child !== owned) return; closed = true; if (pending) { clearTimeout(pending.timer); pending.reject(fail('STATION_NATIVE_SESSION_LOST')); pending = null; } });
  }
  const allowed = new Set(['arm','presence','open','read16','write4','same-tag','wait-removed','observe-empty','close',
    'identify-qualified','lock-qualified','verify-lock','sign-receipt','sign-removal','enrollment-proof','accept-ack','restore-receipt']);
  function request(op, fields = {}, { signal, timeoutMs = 15000 } = {}) {
    check(allowed.has(op) && fields && typeof fields === 'object' && !Object.hasOwn(fields, 'op') && !Object.hasOwn(fields, 'id'));
    const task = sequence.then(() => new Promise((resolve, reject) => {
      signal?.throwIfAborted(); start(); const id = randomUUID(), body = JSON.stringify({ id, op, ...fields });
      check(Buffer.byteLength(body) <= 32768, 'STATION_NATIVE_REQUEST_TOO_LARGE');
      const onAbort = () => abort('STATION_NATIVE_REQUEST_ABORTED');
      pending = { id, resolve: value => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        reject: error => { signal?.removeEventListener('abort', onAbort); reject(error); },
        timer: setTimeout(() => abort('STATION_NATIVE_TIMEOUT'), timeoutMs) };
      signal?.addEventListener('abort', onAbort, { once: true }); child.stdin.write(body + '\n');
    }));
    sequence = task.catch(() => {}); return task;
  }
  return Object.freeze({
    capabilities: () => run(executable, ['capabilities'], { spawnImpl }),
    keyInfo: () => run(executable, ['key-info', '--configuration', configurationPath], { spawnImpl }),
    fullSync: fd => { check(Number.isSafeInteger(fd) && fd >= 0); return run(executable, ['full-sync', '--fd', '3'], { spawnImpl, fd }); },
    request,
    resetAfterCompletion() { check(!pending, 'STATION_NATIVE_BUSY'); const previous = child; child = null; closed = false; buffer = ''; previous?.kill('SIGTERM'); },
    shutdown: () => abort('STATION_NATIVE_STOPPED'),
  });
}
