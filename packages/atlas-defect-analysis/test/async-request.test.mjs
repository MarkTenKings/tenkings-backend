import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { buildAstraDefectRequest, buildAstraDefectRequestAsync,
  buildAstraBackgroundDefectRequest, buildAstraBackgroundDefectRequestAsync,
  buildAstraContextBackgroundDefectRequest, buildAstraContextBackgroundDefectRequestAsync,
  restorePreparedRequest, restorePreparedRequestAsync, validatePreparedRequest } from '../src/index.mjs';
import { digest, canonical } from '../src/contract.mjs';
import { inputFixture, contextInputFixture, withLessons, hash } from './fixtures.mjs';

const cases = [
  ['V1', inputFixture, buildAstraDefectRequest, buildAstraDefectRequestAsync],
  ['V2', inputFixture, buildAstraBackgroundDefectRequest, buildAstraBackgroundDefectRequestAsync],
  ['context V2', contextInputFixture, buildAstraContextBackgroundDefectRequest, buildAstraContextBackgroundDefectRequestAsync],
];
for (const [name, fixture, sync, asynchronous] of cases) for (const memory of [false, true]) {
  test(`async ${name} owns all input bytes/metadata before yielding (${memory ? 'reviewed' : 'empty'} memory)`, async () => {
    const input = structuredClone(memory ? withLessons(fixture()) : fixture()), expected = sync(input);
    const running = asynchronous(input);
    // Mutate later images and metadata, before the first continuation and again
    // after it. Neither the hash nor prompt may borrow those caller references.
    input.images.at(-1).crops.at(-1).bytes.fill(7);
    input.images.at(-1).whole.sourceSha256 = hash('changed source');
    input.cornerShapes.FRONT = 'ROUNDED_3_18_MM'; input.binding.manualRevision++;
    if (memory) {
      input.lessonImages[0].traceOverlay.bytes.fill(8);
      input.knowledge.lessons[0].design.productSet = 'changed knowledge';
    }
    await yieldTurn(); input.images[0].whole.bytes.fill(9); input.images.length = 0;
    const prepared = await running;
    assert.deepEqual(prepared, expected); assert.equal(validatePreparedRequest(prepared), prepared);
    assert.ok(Object.isFrozen(prepared.request.input[1].content));
    const saved = structuredClone(prepared), restoring = restorePreparedRequestAsync(saved);
    saved.evidence.binding.manualRevision++; saved.requestText = '{}'; saved.requestHash = hash('replacement');
    assert.deepEqual(await restoring, expected);
    assert.throws(() => validatePreparedRequest(structuredClone(prepared)), { code: 'DEFECT_ANALYSIS_PREPARED_REQUEST_REQUIRED' });
  });
}

test('large image/request digests retain exact SHA-256 and allow unrelated event-loop turns', async () => {
  const input = structuredClone(contextInputFixture()), image = input.images[0].whole;
  // Valid ancillary PNG chunk changes only encoded bytes, not pixels. PNG decode
  // remains the trusted image effect's responsibility, as for the sync builder.
  const text = Buffer.from(`Comment\0${'A'.repeat(2 * 1024 * 1024)}`), chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  image.bytes = Buffer.concat([image.bytes.subarray(0, -12), chunk, image.bytes.subarray(-12)]); image.sha256 = digest(image.bytes);
  const expected = buildAstraContextBackgroundDefectRequest(input);
  let turns = 0, finished = false;
  const heartbeat = (async () => { while (!finished) { await yieldTurn(); turns++; } })();
  try {
    const building = buildAstraContextBackgroundDefectRequestAsync(input);
    image.bytes.fill(0); image.sha256 = hash('mutated while the large digest is in flight');
    const prepared = await building;
    assert.deepEqual(prepared, expected); assert.equal(prepared.requestHash, digest(prepared.requestText));
    const afterBuild = turns;
    assert.ok(afterBuild >= 10, `unrelated turns during build: ${afterBuild}`);
    assert.deepEqual(await restorePreparedRequestAsync(prepared), expected);
    assert.ok(turns - afterBuild >= 20, `unrelated turns during restore: ${turns - afterBuild}`);
  } finally { finished = true; await heartbeat; }
});

test('async builders and restorers reject start, mid-stage and final-stage cancellation', async () => {
  const prepared = buildAstraDefectRequest(inputFixture()), reason = Error('test cancellation');
  for (const run of [signal => buildAstraDefectRequestAsync(inputFixture(), { signal }),
    signal => restorePreparedRequestAsync(prepared, { signal })]) {
    const before = new AbortController(); before.abort(reason);
    await assert.rejects(run(before.signal), error => error === reason);
    const during = new AbortController(), pending = run(during.signal);
    await yieldTurn(); during.abort(reason);
    await assert.rejects(pending, error => error === reason);
    // Native AbortSignal method interception observes the final cancellation
    // fence without adding a production hook or depending on wall-clock timing.
    const measured = new AbortController(); let checks = 0;
    const original = measured.signal.throwIfAborted.bind(measured.signal);
    measured.signal.throwIfAborted = () => { checks++; original(); };
    await run(measured.signal);
    const late = new AbortController(); let seen = 0;
    const check = late.signal.throwIfAborted.bind(late.signal);
    late.signal.throwIfAborted = () => { if (++seen === checks - 1) late.abort(reason); check(); };
    await assert.rejects(run(late.signal), error => error === reason);
  }
});

test('async stages preserve image/lesson refusal and exact reconstruction of corrupted artifacts', async () => {
  for (const modify of [input => { input.images[1].crops[3].bytes[40] ^= 1; },
    input => { input.images[0].crops[0].x++; }, input => { input.binding.sourceHash = hash('other source'); },
    input => { input.lessonImages[0].traceOverlay.traceSha256 = hash('other trace'); }]) {
    const input = structuredClone(withLessons(inputFixture())); modify(input);
    // A binding change alone is valid but must produce the same changed bytes.
    let expected; try { expected = buildAstraDefectRequest(input); } catch (error) {
      await assert.rejects(buildAstraDefectRequestAsync(input), { code: error.code }); continue;
    }
    assert.deepEqual(await buildAstraDefectRequestAsync(input), expected);
  }
  const prepared = buildAstraDefectRequest(inputFixture());
  for (const alter of [value => { value.requestHash = hash('wrong'); }, value => { value.evidence.binding.manualRevision++; },
    value => { value.request.input[1].content[2].detail = 'low'; value.requestText = JSON.stringify(value.request); value.requestHash = digest(value.requestText); },
    value => { value.evidence.images[0].sha256 = hash('wrong image'); value.evidenceHash = digest(canonical(value.evidence)); }]) {
    const bad = structuredClone(prepared); alter(bad);
    assert.throws(() => restorePreparedRequest(bad)); await assert.rejects(restorePreparedRequestAsync(bad));
  }
});
