import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createReportImageRetry, reportImageRejection, reportImageAttemptBase } from '../src/report-image-retry.mjs';
import { REPORT_IMAGE_RECIPE, reportImageRecipeHash } from '../src/report-image-provider.mjs';
import { createGradingPhotoReader } from '../src/grading-photo-reader.mjs';
import { createConnectedHandler } from '../src/http.mjs';

export function rejectedImageFixture() {
  const requestId = randomUUID(), sourceHash = digest('retained source photograph'), recipeHash = reportImageRecipeHash(REPORT_IMAGE_RECIPE);
  const receipt = { status: 400, clientRequestId: requestId, sourceSha256: sourceHash, recipeHash,
    execution: REPORT_IMAGE_RECIPE.execution, model: REPORT_IMAGE_RECIPE.model,
    promptVersion: REPORT_IMAGE_RECIPE.promptVersion, promptSha256: digest(REPORT_IMAGE_RECIPE.prompt) };
  return { key: digest(randomUUID()), state: 'FAILED', code: 'REPORT_IMAGE_REQUEST_REJECTED', attempts: 1,
    source_hash: sourceHash, recipe_hash: recipeHash, recipe: REPORT_IMAGE_RECIPE, result: null, claim_id: null, lease_until: null,
    audit: [{ event: 'REQUESTED', requestId }, { event: 'RESPONSE', requestId, receipt },
      { event: 'FAILED', requestId, receipt, code: 'REPORT_IMAGE_REQUEST_REJECTED' }] };
}

test('only exact definite400 Images rejection exposes explicit same-image recovery, including legacy receipt', async () => {
  const job = rejectedImageFixture(), failure = reportImageRejection(job);
  assert.deepEqual(failure, { code: 'REPORT_IMAGE_REQUEST_REJECTED', retryable: true, jobKey: job.key, failedRequestId: job.audit.at(-1).requestId });
  job.attempts = 30; assert.deepEqual(reportImageRejection(job), failure, 'explicit retry has no arbitrary lifetime cap');
  const reader = createGradingPhotoReader({ photo: async () => job, storage: { readDecodedFrame: () => assert.fail('status cannot read or generate pixels') } });
  assert.deepEqual(await reader.photoStatus({}), { state:'READY',code:null,source:'ORIGINAL',backgroundRemoval:{state:'FAILED',code:'REPORT_IMAGE_REQUEST_REJECTED'} });
});

test('accepted, uncertain, local-output failures, changed recipes and corrupt audit never authorize another paid edit', () => {
  const mutations = [
    j => { j.state = 'READY'; }, j => { j.state = 'UNKNOWN'; }, j => { j.state = 'REQUESTED'; },
    j => { j.code = 'REPORT_IMAGE_ALPHA_INVALID'; }, j => { j.claim_id = randomUUID(); }, j => { j.result = {}; },
    j => { j.recipe_hash = digest('old recipe'); }, j => { j.audit.pop(); }, j => { j.audit.push(j.audit[1]); },
    j => { j.audit.unshift(j.audit[0]); }, j => { j.audit[1].receipt.status = 200; },
    j => { j.audit[1].receipt.status = 500; }, j => { j.audit[1].receipt.status = 408; },
    j => { j.audit[1].receipt.sourceSha256 = digest('another upload'); },
    j => { j.audit[1].receipt.clientRequestId = randomUUID(); },
    j => { j.audit[2].receipt = { ...j.audit[2].receipt, status: 400, providerRequestId: 'different' }; },
    ...['outputSha256', 'byteCount', 'usage'].map(key => j => { j.audit[1].receipt[key] = null; }),
    j => { j.audit.splice(0, 0, { event: 'RETRY_REQUESTED', failedRequestId: j.audit[0].requestId }); },
  ];
  for (const mutate of mutations) { const job = rejectedImageFixture(); mutate(job); assert.equal(reportImageRejection(job), null); }
});

test('bounded worker attempts restart from explicit immutable retry base without resetting historical attempts', () => {
  const job = rejectedImageFixture(); assert.equal(reportImageAttemptBase(job), 0);
  job.attempts = 35; job.audit.push({ event: 'RETRY_REQUESTED', attemptBase: 30 }); assert.equal(reportImageAttemptBase(job), 30);
  for (const attemptBase of [-1, 1.2, '30', 36]) { job.audit.at(-1).attemptBase = attemptBase; assert.equal(reportImageAttemptBase(job), 0); }
});

test('retry service reconciles only existing intents; a new retry cannot replace fallback coordinates', async () => {
  const cardId = randomUUID(), principal = { id: randomUUID(), accessVersion: 7 }, side = 'BACK';
  const input = { requestId: randomUUID(), uploadId: randomUUID(), jobKey: digest('job'), failedRequestId: randomUUID() };
  let calls = 0, wakes = 0, acknowledged=true;
  const retry = createReportImageRetry({ recipe: REPORT_IMAGE_RECIPE, wake: () => { wakes++; throw Error('Temporary wake failure'); },
    intakeRepository: { authorizeInTransaction: async (_tx, p, card, options) => { assert.equal(p, principal); assert.equal(card, cardId); assert.deepEqual(options, { edit: true, lock: 'UPDATE' }); } },
    boundary: { transaction: async (_staff, work) => work({ principal, refresh: async () => ({ principal }), tx: { $queryRawUnsafe: async (_sql, ...args) => {
      if(_sql.startsWith('SELECT EXISTS')){assert.deepEqual(args,[input.jobKey,input.requestId]);return[{acknowledged}];}
      calls++; assert.deepEqual(args, [principal.id, 7, input.requestId, cardId, input.uploadId, side, input.jobKey, input.failedRequestId, reportImageRecipeHash(REPORT_IMAGE_RECIPE)]);
      return [{ receipt: { ...input, side } }];
    } } }) } });
  assert.deepEqual(await retry({}, cardId, side, input), { state: 'ACCEPTED', acknowledgedRequest: { ...input, side } });
  assert.equal(calls, 1); assert.equal(wakes, 1);
  acknowledged=false;await assert.rejects(retry({},cardId,side,input),{code:'REPORT_IMAGE_RETRY_UNAVAILABLE'});assert.equal(calls,1);assert.equal(wakes,1);
  await assert.rejects(retry({}, cardId, side, { ...input, changed: true })); assert.equal(calls, 1);
});

test('explicit retry HTTP endpoint requires staff CSRF, exact route and POST; never runs from GET', async () => {
  const cardId = randomUUID(), input = { requestId: randomUUID(), uploadId: randomUUID(), jobKey: digest('job'), failedRequestId: randomUUID() };
  const origin = 'https://atlas.example', path = `/api/staff/manual-connected/cards/${cardId}/grading-images/BACK/retry`;
  let calls = 0, authentications = 0;
  const handler = createConnectedHandler({ origin, assertRequest: async () => {}, connected: { intake: {}, workflow: {},
    retryGradingImage: async (_staff, card, side, body) => { calls++; assert.equal(card, cardId); assert.equal(side, 'BACK'); assert.deepEqual(body, input); return { state: 'ACCEPTED', acknowledgedRequest: { ...body, side } }; } },
    boundary: { authenticate: async (_cookie, csrf) => { authentications++; assert.equal(csrf, 'csrf'); return {}; } } });
  const run = async patch => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.value = value; } };
    await handler({ method: 'POST', url: path, headers: { origin, 'content-type': 'application/json', 'x-atlas-csrf': 'csrf' }, body: input, ...patch }, res); return res; };
  const ready = await run({}); assert.equal(ready.statusCode, 200); assert.equal(ready.value.acknowledgedRequest.requestId, input.requestId); assert.equal(ready.headers['Cache-Control'], 'private, no-store');
  assert.equal((await run({ method: 'GET' })).statusCode, 405);
  assert.equal((await run({ headers: { origin, 'content-type': 'application/json' } })).statusCode, 403);
  assert.equal((await run({ url: path + '?retry=1' })).statusCode, 405);
  assert.equal(calls, 1); assert.equal(authentications, 1);
});
