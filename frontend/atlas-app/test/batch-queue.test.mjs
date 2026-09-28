import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchReadQueue, mergeProcessingCards, queueProblemMessage } from '../lib/batch-queue.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the nineteenth selected card overtakes waiting rail reads without duplicate work', async () => {
  const queue = createBatchReadQueue({ concurrency: 1 }), started = [], releases = [];
  const reads = Array.from({ length: 19 }, (_, index) => queue.read(String(index), () => {
    started.push(index); return new Promise(resolve => releases.push(() => resolve(index)));
  }));
  await tick(); const promoted = queue.read('18', () => assert.fail('must reuse queued work'), false, { priority: 100 });
  assert.equal(promoted, reads[18]); releases.shift()(); await tick(); assert.deepEqual(started, [0, 18]);
  while (releases.length) { releases.shift()(); await tick(); }
  assert.equal((await Promise.all(reads)).length, 19);
});

test('leaving a selected card cancels its unused queued read but preserves a shared subscriber', async () => {
  const queue = createBatchReadQueue({ concurrency: 1 }); let finish, orphanCalled = false;
  const active = queue.read('active', () => new Promise(resolve => { finish = resolve; })); await tick();
  const controller = new AbortController();
  const orphan = queue.read('orphan', () => { orphanCalled = true; }, false, { signal: controller.signal });
  const sharedGone = queue.read('shared', () => 'shared', false, { signal: controller.signal });
  const sharedKept = queue.read('shared', () => assert.fail('duplicate'));
  controller.abort(); await assert.rejects(orphan, { code: 'PREVIEW_READ_CANCELLED' });
  await assert.rejects(sharedGone, { code: 'PREVIEW_READ_CANCELLED' }); finish(); await active;
  assert.equal(await sharedKept, 'shared'); assert.equal(orphanCalled, false);
});

test('a selected read starts first when rail and selection are mounted together', async () => {
  const queue = createBatchReadQueue({ concurrency: 1 }), order = [];
  const thumbnail = queue.read('thumbnail', () => { order.push('thumbnail'); });
  const selected = queue.read('selected', () => { order.push('selected'); }, false, { priority: 100 });
  await Promise.all([thumbnail, selected]); assert.deepEqual(order, ['selected', 'thumbnail']);
});

test('30 cards share a two-request limit and the rail/front/back reuse each read', async () => {
  const queue = createBatchReadQueue(); let active = 0, maximum = 0, reads = 0;
  const release = [];
  const promises = Array.from({ length: 30 }, (_, card) => {
    const work = async () => {
      reads++; active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => release.push(resolve)); active--; return card;
    };
    const first = queue.read(String(card), work);
    assert.equal(queue.read(String(card), work), first);
    assert.equal(queue.read(String(card), work, true), first);
    return first;
  });
  await tick(); assert.equal(reads, 2);
  while (reads < 30 || release.length) { release.splice(0).forEach(resolve => resolve()); await tick(); }
  assert.deepEqual(await Promise.all(promises), Array.from({ length: 30 }, (_, n) => n));
  assert.equal(maximum, 2); assert.equal(reads, 30);
});

test('failed reads can recover and leaving the queue cancels waiting work', async () => {
  const queue = createBatchReadQueue({ concurrency: 1 });
  await assert.rejects(queue.read('failed', () => { throw Error('temporary'); }));
  assert.equal(await queue.read('failed', () => 'recovered'), 'recovered');
  let release, called = false;
  const running = queue.read('running', () => new Promise(resolve => { release = resolve; }));
  await tick();
  const waiting = queue.read('waiting', () => { called = true; });
  const rejected = assert.rejects(waiting, { code: 'PREVIEW_READ_CANCELLED' });
  queue.clear(); await rejected; release(); await running; assert.equal(called, false);
});

test('photo failures remain visible before grading admission and cannot resume a nonexistent job', () => {
  const jobs = [{ cardId: 'graded', key: 'real', state: 'REVIEW' }];
  const cards = [{ cardId: 'graded' }, { cardId: 'hdr', label: 'Card 11',
    sides: { FRONT: { verified: true, prepared: false }, BACK: { verified: true, prepared: true } },
    ingestion: { FRONT: { state: 'ATTENTION', code: 'PHOTO_HDR_UNSUPPORTED' }, BACK: { state: 'COMPLETE' } } },
  { cardId: 'uploading', ingestion: { FRONT: { state: 'RUNNING' } } }];
  const result = mergeProcessingCards(jobs, cards);
  assert.equal(result.length, 3); assert.equal(result[0], jobs[0]);
  assert.equal(result[1].state, 'NEEDS_ATTENTION'); assert.equal(result[1].canResumeProcessing, false);
  assert.match(queueProblemMessage(result[1]), /Front HDR photo/);
  assert.equal(result[2].state, 'RUNNING');
});
