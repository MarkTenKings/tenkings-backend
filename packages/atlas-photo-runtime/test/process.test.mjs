import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDecoderProcess } from '../src/process.mjs';
import { verifyAndDecodePhoto } from '../src/index.mjs';
import { code, request, rgb16Png } from './helpers.mjs';

const fixture = fileURLToPath(new URL('./fixtures/process-fixture.mjs', import.meta.url));
async function withPid(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-photo-test-'));
  try { await fn(join(directory, 'pid')); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function dead(pidPath) {
  const pid = Number(await readFile(pidPath, 'utf8'));
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
}

test('timeout kills a synchronous blocking child and resolves only after it is reaped', async () => {
  await withPid(async pidPath => {
    await assert.rejects(runDecoderProcess(fixture, { pidPath, action: 'block' }, { timeoutMs: 400 }), code('PHOTO_DECODE_TIMEOUT'));
    await dead(pidPath);
  });
});

test('AbortSignal also kills/reaps the active child without changing input', async () => {
  await withPid(async pidPath => {
    const controller = new AbortController();
    const running = runDecoderProcess(fixture, { pidPath, action: 'block' }, { timeoutMs: 5000, signal: controller.signal });
    const rejection = assert.rejects(running, code('PHOTO_DECODE_CANCELLED'));
    // Wait for real child readiness, then cancel work already executing.
    for (let attempts = 0; ; attempts++) {
      try { await readFile(pidPath); break; } catch {
        assert.ok(attempts < 200); await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    controller.abort(); await rejection; await dead(pidPath);
  });
});

test('stdout is bounded and noisy child is terminated', async () => {
  await withPid(async pidPath => {
    await assert.rejects(runDecoderProcess(fixture, { pidPath, action: 'stdout' }, { timeoutMs: 5000 }), code('PHOTO_DECODER_PROTOCOL'));
    await dead(pidPath);
  });
});

test('malformed protocol and crashed child are distinct failures with no success frame', async () => {
  for (const [action, expected] of [['bad-json', 'PHOTO_DECODER_PROTOCOL'], ['crash', 'PHOTO_DECODER_FAILED']]) {
    await withPid(async pidPath => {
      await assert.rejects(runDecoderProcess(fixture, { pidPath, action }, { timeoutMs: 5000 }), code(expected));
      await dead(pidPath);
    });
  }
});

test('actual decoder timeout and pre-dispatch cancellation preserve caller bytes', async () => {
  const bytes = rgb16Png(40, 20), before = Buffer.from(bytes), input = request(bytes);
  await assert.rejects(verifyAndDecodePhoto({ ...input, limits: { ...input.limits, timeoutMs: 1 } }), code('PHOTO_DECODE_TIMEOUT'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verifyAndDecodePhoto({ ...input, signal: controller.signal }), code('PHOTO_DECODE_CANCELLED'));
  assert.deepEqual(bytes, before);
});

test('invalid signals and unserializable requests fail before child creation', async () => {
  await withPid(async pidPath => {
    const requestValue = { pidPath, action: 'block' };
    assert.throws(() => runDecoderProcess(fixture, requestValue, { timeoutMs: 1000, signal: {} }), code('PHOTO_DECODE_INVALID'));
    const circular = { ...requestValue }; circular.self = circular;
    assert.throws(() => runDecoderProcess(fixture, circular, { timeoutMs: 1000 }), code('PHOTO_DECODER_PROTOCOL'));
    assert.throws(() => runDecoderProcess(fixture, { ...requestValue, extra: 'x'.repeat(40_000) }, { timeoutMs: 1000 }), code('PHOTO_DECODER_PROTOCOL'));
    await assert.rejects(readFile(pidPath), error => error.code === 'ENOENT');
    await assert.rejects(verifyAndDecodePhoto(request(rgb16Png(4, 4), { signal: {} })), code('PHOTO_DECODE_INVALID'));
  });
});

test('AbortSignal instance overrides cannot bypass termination or strand a spawned child', async () => {
  await withPid(async pidPath => {
    const controller = new AbortController();
    controller.signal.addEventListener = () => { throw Error('instance override must not be used'); };
    controller.signal.removeEventListener = () => { throw Error('instance override must not be used'); };
    Object.defineProperty(controller.signal, 'aborted', { get() { throw Error('instance override must not be used'); } });
    await assert.rejects(runDecoderProcess(fixture, { pidPath, action: 'block' },
      { timeoutMs: 300, signal: controller.signal }), code('PHOTO_DECODE_TIMEOUT'));
    await dead(pidPath);
  });
});
