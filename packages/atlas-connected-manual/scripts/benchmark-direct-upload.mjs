// Explicit network benchmark; never imports production database or staff auth.
// Credentials arrive through stdin. Signed grants and secrets are never logged.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { createPhotoStorage } from '@atlas/photo-storage';

const [ack, output, frontPath, backPath] = process.argv.slice(2);
assert.equal(ack, '--ack-live-original-upload-benchmark');
assert(output && resolve(output) === output && frontPath && backPath);
await mkdir(output, { mode: 0o700 });
let input = ''; for await (const chunk of process.stdin) input += chunk;
const env = JSON.parse(input); input = '';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = await Promise.all([frontPath, backPath].map(async path => {
  const bytes = await readFile(path); assert(bytes.length <= 64 * 1024 * 1024);
  return { bytes, sha256: hash(bytes) };
}));
const runId = randomUUID(), prefix = `${env.ATLAS_MANUAL_STORAGE_PREFIX}/benchmark/${runId}`;
const client = new S3Client({ region: env.ATLAS_MANUAL_STORAGE_REGION, endpoint: env.ATLAS_MANUAL_STORAGE_ENDPOINT, maxAttempts: 1,
  credentials: { accessKeyId: env.ATLAS_MANUAL_STORAGE_ACCESS_KEY, secretAccessKey: env.ATLAS_MANUAL_STORAGE_SECRET_KEY } });
const storage = createPhotoStorage({ client, bucket: env.ATLAS_MANUAL_STORAGE_BUCKET, keyPrefix: prefix,
  limits: { maxObjectBytes: 64 * 1024 * 1024, timeoutMs: 90000 } });
const count = 50, intervalMs = 2400, concurrency = 4, plans = Array.from({ length: count }, (_, index) => {
  const file = files[index % 2], uploadId = randomUUID();
  return { schemaVersion: 1, uploadId, binding: { cardId: `benchmark-${Math.floor(index / 2)}`, pairId: `benchmark-${Math.floor(index / 2)}`,
    side: index % 2 ? 'BACK' : 'FRONT', version: 1 }, object: { key: `${prefix}/originals/${uploadId}`, versionId: null },
  expected: { sha256: file.sha256, byteCount: file.bytes.length } };
});
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
await save('intent.json', { runId, prefix, count, intervalMs, concurrency, plans, networkPath: 'capture workstation to configured object store',
  scope: 'repeated retained full-resolution originals; not matched grading pairs', productionDatabaseWrites: 0, providerCalls: 0 });
const started = performance.now(), queue = [], active = new Set(), observations = [], failures = [];
let peakQueue = 0;
async function upload(index, admittedAt) {
  const plan = plans[index], file = files[index % 2], begin = performance.now();
  const grant = await storage.createOriginalUpload({ uploadPlan: plan, expiresIn: 300 });
  assert.equal(new URL(grant.url).origin, env.ATLAS_MANUAL_UPLOAD_ORIGIN);
  const response = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: file.bytes,
    redirect: 'error', signal: AbortSignal.timeout(90000) });
  await response.body?.cancel(); assert(response.ok, `UPLOAD_HTTP_${response.status}`);
  const uploadedAt = performance.now();
  // New storage instance recovers exact remote bytes without the PUT response.
  const fresh = createPhotoStorage({ client, bucket: env.ATLAS_MANUAL_STORAGE_BUCKET, keyPrefix: prefix,
    limits: { maxObjectBytes: 64 * 1024 * 1024, timeoutMs: 90000 } });
  const verified = await fresh.readOriginal({ uploadPlan: plan });
  assert.equal(verified.sha256, file.sha256); assert.equal(verified.byteCount, file.bytes.length);
  const result = { index, originalBytes: file.bytes.length, sha256: file.sha256, httpStatus: response.status,
    waitMs: begin - admittedAt, uploadMs: uploadedAt - begin, verifiedMs: performance.now() - begin,
    completedAtMs: performance.now() - started, exactRemoteBytes: true };
  observations.push(result); await save(`image-${index}.json`, result);
}
function drain() { while (queue.length && active.size < concurrency) {
  const item = queue.shift(), task = upload(item.index, item.at).catch(error => failures.push({ index: item.index,
    code: /^[A-Z0-9_]{1,100}$/.test(error.code ?? '') ? error.code : 'UPLOAD_BENCHMARK_FAILED' }))
    .finally(() => { active.delete(task); drain(); }); active.add(task);
} }
try {
  for (let index = 0; index < count; index++) {
    const remaining = started + index * intervalMs - performance.now();
    if (remaining > 0) await new Promise(done => setTimeout(done, remaining));
    queue.push({ index, at: performance.now() }); peakQueue = Math.max(peakQueue, queue.length); drain();
  }
  while (active.size || queue.length) await Promise.allSettled([...active]);
  const elapsedMs = performance.now() - started;
  const percentile = (values, q) => values.sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*q))] ?? null;
  const result = { status: failures.length ? 'UPLOAD_BENCHMARK_FAILED' : 'UPLOAD_BENCHMARK_COMPLETE', runId, count,
    completed: observations.length, failures, arrivalImagesPerMinute: 25, elapsedMs, peakQueue,
    p95UploadMs: percentile(observations.map(x => x.uploadMs), .95), p95VerifiedMs: percentile(observations.map(x => x.verifiedMs), .95),
    p95WaitMs: percentile(observations.map(x => x.waitMs), .95), fullOriginalsPreserved: failures.length === 0,
    productionDatabaseWrites: 0, providerCalls: 0, observations };
  await save('result.json', result); console.log(JSON.stringify({ ...result, observations: undefined }));
  if (failures.length) process.exitCode = 1;
} finally { client.destroy(); }
