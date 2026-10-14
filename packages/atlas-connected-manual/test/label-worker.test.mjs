import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelWorker } from '../src/label-worker.mjs';

test('label worker remains cold, coalesces wakes and waits for in-flight rendering on shutdown', async () => {
  let calls = 0, release, interval;
  const timers = { setInterval(fn) { interval = fn; return { unref() {} }; }, clearInterval() { interval = null; } };
  const worker = createLabelWorker({ timers, service: { runPending() { calls++; return new Promise(resolve => { release = resolve; }); } } });
  await worker.wake();
  assert.equal(calls, 0);
  worker.start(); worker.start();
  await Promise.resolve();
  assert.equal(calls, 1);
  const first = worker.wake(); interval();
  assert.equal(worker.wake(), first);
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.equal(interval, null);
  release(); await stop;
  await worker.wake();
  assert.equal(calls, 1);
});

test('a failed queue cycle emits only a bounded code and a later cycle resumes', async () => {
  let calls = 0;
  const events = [];
  const worker = createLabelWorker({ service: { async runPending() {
    if (++calls === 1) throw Object.assign(new Error('private URL and credential must not be logged'), { code: 'not a safe code' });
    return { processed: 1 };
  } }, onError: event => events.push(event) });
  await worker.drainOnce();
  await worker.drainOnce();
  assert.equal(calls, 2);
  assert.deepEqual(events, [{ code: 'LABEL_WORKER_INTERRUPTED' }]);
});
