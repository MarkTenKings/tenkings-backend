// NEW qualification only. Original failed canary and execution intent are never read or modified.
// Importing is offline; CLI requires approval of the exact source-bound manifest.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { descriptorSha256 } from '../../packages/atlas-photo-core/src/index.mjs';

export const QUALIFICATION_ROOT = '/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/qualification-20260917';
export const PLAN_PATH = `${QUALIFICATION_ROOT}/photo/plan.json`;
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { canaryCode: code }); };
const need = (truth, code) => { if (!truth) fail(code); };
const good = result => result.status >= 200 && result.status < 300;
const safeCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.canaryCode ?? '') ? error.canaryCode : 'REQUEST_FAILED';
const version = result => result.headers['x-amz-version-id'] ?? null;
const STATUS = 'PREPARED_NOT_AUTHORIZED_NOT_EXECUTED';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);
export const QUALIFICATION_TARGET = Object.freeze({ bucket: 'atlas-grading-private-20260910', region: 'nyc3',
  endpoint: 'https://nyc3.digitaloceanspaces.com', uploadOrigin: 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com', staffOrigin: 'https://atlasgrading.com' });
export const QUALIFICATION_BOUNDS = Object.freeze({ uniqueKeys: 1, maxPutAttempts: 3, maxDeleteAttempts: 2, maxHttpRequests: 30,
  maxPutBodyBytes: 195, maxGetBodyBytesPerResponse: 4096, requestTimeoutMs: 10000, totalDeadlineMs: 300000, presignExpiresSeconds: 300, sdkMaxAttempts: 1 });
// Exact local import/source closure plus the lockfile that pins SDK transitive dependencies.
export const QUALIFICATION_SOURCES = Object.freeze([
  'scripts/atlas/manual-release-storage-qualification.mjs',
  'packages/atlas-photo-storage/package.json', 'packages/atlas-photo-storage/src/index.mjs',
  'packages/atlas-photo-core/package.json', 'packages/atlas-photo-core/src/index.mjs',
  'packages/atlas-photo-runtime/package.json', 'packages/atlas-photo-runtime/src/index.mjs', 'packages/atlas-photo-runtime/src/process.mjs',
  'packages/atlas-manual-service/package.json', 'packages/atlas-manual-service/src/artifacts.mjs', 'packages/atlas-manual-service/src/contract.mjs',
  'pnpm-lock.yaml',
]);

/** Pure preparation only: writes no file and cannot dispatch. Seal the returned bytes before requesting approval. */
export function buildSealedInputs({ profile, id, createdAt, payload, collision }) {
  need(['photo', 'artifact'].includes(profile) && uuid(id) && typeof createdAt === 'string'
    && Number.isFinite(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt, 'PLAN_IDENTITY_INVALID');
  need(Buffer.isBuffer(payload) && Buffer.isBuffer(collision) && payload.length === 65 && collision.length === 65
    && sha(payload) !== sha(collision), 'SEALED_PAYLOAD_CHANGED');
  if (profile === 'artifact') {
    try { JSON.parse(payload.toString('utf8')); JSON.parse(collision.toString('utf8')); } catch { fail('ARTIFACT_JSON_REQUIRED'); }
  }
  const describe = (bytes, path) => ({ path, bytes: bytes.length, sha256: sha(bytes), checksumBase64: createHash('sha256').update(bytes).digest('base64') });
  const keyPrefix = `atlas-connected-manual-v1/release-qualification-20260917/${id}`;
  const target = { ...QUALIFICATION_TARGET, key: `${keyPrefix}/${profile === 'photo' ? 'originals/probe.bin' : 'artifacts/probe.json'}` };
  const uploadPlan = { schemaVersion: 1, uploadId: `qualification-${id}`, binding: { cardId: `qualification-${id}`,
    pairId: `qualification-${id}`, side: 'FRONT', version: 1 }, object: { key: target.key, versionId: null }, expected: { byteCount: 65, sha256: sha(payload) } };
  const artifactLineageSha256 = sha(canonical({ purpose: 'ATLAS_STORAGE_QUALIFICATION_ONLY', profile, id }));
  const plan = { schemaVersion: 1, status: STATUS, profile, id, createdAt, keyPrefix, target,
    payload: describe(payload, 'payload.bin'), collisionPayload: describe(collision, 'collision-payload.bin'),
    requiredHeaders: { 'Content-Type': profile === 'photo' ? 'application/octet-stream' : 'application/json', 'If-None-Match': '*',
      'x-amz-checksum-sha256': createHash('sha256').update(payload).digest('base64'),
      ...(profile === 'photo' ? { 'x-amz-meta-atlas-kind': 'original', 'x-amz-meta-atlas-binding-sha256': descriptorSha256(uploadPlan) }
        : { 'x-amz-meta-atlas-manual-lineage-sha256': artifactLineageSha256 }) }, bounds: { ...QUALIFICATION_BOUNDS },
    ...(profile === 'photo' ? { uploadPlan } : { artifactLineageSha256 }) };
  return { plan, planBytes: Buffer.from(JSON.stringify(plan, null, 2) + '\n'), payload: Buffer.from(payload), collision: Buffer.from(collision) };
}

export function loadSealedInputs(profile = 'photo') {
  need(['photo', 'artifact'].includes(profile), 'PROFILE_REFUSED');
  const path = `${QUALIFICATION_ROOT}/${profile}/plan.json`;
  const planBytes = readFileSync(path), plan = JSON.parse(planBytes);
  return { planBytes, payload: readFileSync(resolve(dirname(path), 'payload.bin')),
    collision: readFileSync(resolve(dirname(path), 'collision-payload.bin')), plan };
}
export function validateApproval({ execute, approvedPlanSha, inputs }) {
  need(execute === true && /^[a-f0-9]{64}$/.test(approvedPlanSha), 'EXACT_APPROVAL_REQUIRED');
  need(sha(inputs.planBytes) === approvedPlanSha, 'SEALED_PLAN_CHANGED');
  const plan = JSON.parse(inputs.planBytes);
  const expected = buildSealedInputs({ profile: plan.profile, id: plan.id, createdAt: plan.createdAt, payload: inputs.payload, collision: inputs.collision });
  need(equal(plan, expected.plan), 'SEALED_PLAN_CONTRACT_CHANGED');
  return plan;
}

/** No retries, arbitrary keys, inference, SQL or policy operations are exposed. */
export async function runCanary({ execute, approvedPlanSha, inputs, transport, onEvent = () => {},
  now = () => performance.now(), timers = { set: setTimeout, clear: clearTimeout }, signal }) {
  const plan = validateApproval({ execute, approvedPlanSha, inputs });
  const payload = Buffer.from(inputs.payload), collision = Buffer.from(inputs.collision), bounds = plan.bounds;
  const started = now(), deadline = started + bounds.totalDeadlineMs;
  const counts = { requests: 0, putAttempts: 0, deleteAttempts: 0, putBytes: 0 };
  let phase = 'qualification', putAttempted = false, initiallyAbsent = false, passed = false, failureCode = null;
  let cleanup = 'NOT_NEEDED', observedVersion = null, unknownPutSha = null, versionConflict = false;
  const attemptedPayloads = new Set();
  const observations = [];
  function event(value) { const saved = structuredClone(value); observations.push(saved); onEvent(saved); }
  async function request(operation, label, options = {}) {
    const end = phase === 'cleanup' ? deadline : deadline - 90000;
    need(now() < end, phase === 'cleanup' ? 'CLEANUP_DEADLINE' : 'QUALIFICATION_DEADLINE');
    need(counts.requests < (phase === 'cleanup' ? bounds.maxHttpRequests : bounds.maxHttpRequests - 10), 'REQUEST_LIMIT');
    if (phase !== 'cleanup') need(!signal?.aborted, 'CANCELLED');
    if (operation === 'put') {
      need(counts.putAttempts < bounds.maxPutAttempts && options.body instanceof Uint8Array
        && options.body.length === 65 && counts.putBytes + options.body.length <= bounds.maxPutBodyBytes, 'PUT_BOUND');
      need([plan.payload.sha256, plan.collisionPayload.sha256].includes(sha(options.body)), 'PUT_PAYLOAD_REFUSED');
      counts.putAttempts++; counts.putBytes += options.body.length;
    }
    if (operation === 'delete') { need(phase === 'cleanup' && counts.deleteAttempts < bounds.maxDeleteAttempts, 'DELETE_BOUND'); counts.deleteAttempts++; }
    counts.requests++;
    const timeoutMs = Math.min(bounds.requestTimeoutMs, end - now()), controller = new AbortController();
    const entry = { sequence: counts.requests, phase, operation, label, bodyBytes: options.body?.length ?? 0 };
    event({ ...entry, state: 'DISPATCHING' });
    const cancel = () => controller.abort();
    if (phase !== 'cleanup') signal?.addEventListener('abort', cancel, { once: true });
    if (phase !== 'cleanup' && signal?.aborted) cancel();
    let timer, dispatched = false;
    const timeout = new Promise((_, reject) => {
      timer = timers.set(() => { controller.abort(); reject(Object.assign(new Error('REQUEST_TIMEOUT'), { canaryCode: 'REQUEST_TIMEOUT' })); }, timeoutMs);
      controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('REQUEST_ABORTED'), { canaryCode: 'REQUEST_ABORTED' })), { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        need(!controller.signal.aborted, 'REQUEST_ABORTED');
        dispatched = true;
        if (operation === 'put') { putAttempted = true; attemptedPayloads.add(sha(options.body)); }
        return transport.send({ operation, label,
        ...options, body: options.body ? Buffer.from(options.body) : undefined, target: structuredClone(plan.target),
        requiredHeaders: { ...plan.requiredHeaders }, profile: plan.profile, uploadPlan: structuredClone(plan.uploadPlan), keyPrefix: plan.keyPrefix, signal: controller.signal, maximumBodyBytes: bounds.maxGetBodyBytesPerResponse });
      }), timeout]);
      need(Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 && result.headers, 'RESPONSE_INVALID');
      need(!result.bytes || result.bytes.length <= bounds.maxGetBodyBytesPerResponse, 'RESPONSE_BODY_LIMIT');
      if (operation === 'put' && !good(result)
        && !(label === 'checksum-refusal' && result.status === 400 && result.errorCode === 'BadDigest')
        && !(label === 'collision-refusal' && result.status === 412)) unknownPutSha = sha(options.body);
      if (version(result) !== null) {
        if (!(typeof version(result) === 'string' && version(result).length > 0 && version(result).length <= 1024
          && !/[\x00-\x1f\x7f]/.test(version(result)))) { versionConflict = true; fail('VERSION_INVALID'); }
        if (observedVersion && observedVersion !== version(result)) { versionConflict = true; fail('OBJECT_VERSION_CHANGED'); }
        observedVersion = version(result);
      }
      event({ ...entry, state: 'OBSERVED', status: result.status,
        ...(result.bytes ? { responseBytes: result.bytes.length, responseSha256: sha(result.bytes) } : {}),
        ...(version(result) ? { versionId: version(result) } : {}),
        ...(result.headers.etag ? { etagSha256: sha(result.headers.etag) } : {}) });
      return result;
    } catch (error) {
      if (operation === 'put' && dispatched) unknownPutSha = sha(options.body);
      event({ ...entry, state: 'UNKNOWN_OR_FAILED', code: safeCode(error) }); throw error;
    }
    finally { timers.clear(timer); signal?.removeEventListener('abort', cancel); }
  }
  function metadata(result, strict = true) {
    const h = result.headers;
    need(result.status === 200 && h['content-length'] === '65' && h['content-type'] === plan.requiredHeaders['Content-Type']
      && Object.entries(plan.requiredHeaders).filter(([name]) => name.startsWith('x-amz-meta-')).every(([name, value]) => h[name] === value)
      && h['content-encoding'] === undefined && h['content-range'] === undefined && h['x-amz-delete-marker'] !== 'true'
      && typeof h.etag === 'string' && h.etag.length > 0 && h.etag.length <= 512 && !/[\x00-\x1f\x7f]/.test(h.etag), 'OBJECT_METADATA_CONFLICT');
    if (strict && h['x-amz-checksum-sha256'] !== undefined)
      need(h['x-amz-checksum-sha256'] === plan.payload.checksumBase64, 'NATIVE_CHECKSUM_CONFLICT');
    if (version(result)) {
      need(version(result).length <= 1024 && (!observedVersion || observedVersion === version(result)), 'VERSION_INVALID');
      observedVersion = version(result);
    }
  }
  async function verifiedRead(label, { cleanupRead = false, browser = false } = {}) {
    const head = await request('head', `${label}-head`, { ...(observedVersion ? { versionId: observedVersion } : {}) });
    if (cleanupRead && head.status === 404) { need(!unknownPutSha, 'UNKNOWN_PUT_ABSENCE_UNPROVEN'); return null; }
    metadata(head, !cleanupRead);
    if (!cleanupRead) need(!version(head), 'UNEXPECTED_OBJECT_VERSION');
    const read = await request('get', `${label}-get`, { ...(version(head) ? { versionId: version(head) } : browser ? {} : { ifMatch: head.headers.etag }), browser });
    metadata(read, !cleanupRead);
    need(read.headers.etag === head.headers.etag && version(read) === version(head), 'READ_PIN_CONFLICT');
    need(read.bytes?.length === 65 && (cleanupRead ? attemptedPayloads.has(sha(read.bytes)) : sha(read.bytes) === plan.payload.sha256), 'OBJECT_BYTES_CONFLICT');
    if (cleanupRead && unknownPutSha) {
      need(sha(read.bytes) === unknownPutSha, 'UNKNOWN_PUT_STILL_UNRESOLVED'); unknownPutSha = null;
    }
    return head;
  }
  function cors(result, method, expectedHeaders) {
    need(good(result) && result.headers['access-control-allow-origin'] === plan.target.staffOrigin, 'CORS_ORIGIN_REFUSED');
    const methods = (result.headers['access-control-allow-methods'] ?? '').split(',').map(v => v.trim());
    const headers = (result.headers['access-control-allow-headers'] ?? '').toLowerCase().split(',').map(v => v.trim());
    need(methods.includes(method) && expectedHeaders.every(h => headers.includes(h.toLowerCase()) || headers.includes('*')), 'CORS_HEADERS_REFUSED');
  }
  try {
    need((await request('head', 'initial-absence')).status === 404, 'INITIAL_OBJECT_EXISTS_OR_UNVERIFIABLE'); initiallyAbsent = true;
    need(good(await request('headBucket', 'bucket-status')), 'BUCKET_UNAVAILABLE');
    const currentVersioning = await request('versioning', 'bucket-versioning');
    need(good(currentVersioning) && currentVersioning.versioning === null, 'BUCKET_VERSIONING_CHANGED');
    for (const method of plan.profile === 'photo' ? ['PUT', 'GET', 'HEAD'] : []) {
      const headers = method === 'PUT' ? Object.keys(plan.requiredHeaders) : ['content-type'];
      cors(await request('options', `cors-${method}`, { method, corsHeaders: headers }), method, headers);
    }
    const bad = await request('put', 'checksum-refusal', { body: payload, checksum: plan.collisionPayload.checksumBase64 });
    need(bad.status === 400 && bad.errorCode === 'BadDigest', 'CHECKSUM_REFUSAL_NOT_PROVEN');
    need((await request('head', 'after-checksum-refusal')).status === 404, 'CHECKSUM_PUT_CREATED_OBJECT');
    const put = await request('put', 'create-once', { body: payload, checksum: plan.payload.checksumBase64 });
    need(good(put), 'CREATE_NOT_CONFIRMED'); if (version(put)) { observedVersion = version(put); fail('UNEXPECTED_OBJECT_VERSION'); }
    const original = await verifiedRead('created-object');
    if (plan.profile === 'photo') {
      const browserRead = await request('get', 'browser-signed-get', { browser: true, ...(observedVersion ? { versionId: observedVersion } : {}) });
      metadata(browserRead); need(browserRead.bytes?.length === 65 && sha(browserRead.bytes) === plan.payload.sha256, 'BROWSER_BYTES_CONFLICT');
      need(browserRead.headers['access-control-allow-origin'] === plan.target.staffOrigin, 'BROWSER_CORS_REFUSED');
    }
    for (const operation of ['get', 'head']) need([401, 403].includes((await request(operation, `anonymous-${operation}`, { anonymous: true })).status), 'OBJECT_PUBLIC');
    need((await request('put', 'collision-refusal', { body: collision, checksum: plan.collisionPayload.checksumBase64 })).status === 412, 'CONDITIONAL_CREATE_NOT_PROVEN');
    const after = await verifiedRead('after-collision');
    need(after.headers.etag === original.headers.etag && version(after) === version(original), 'COLLISION_CHANGED_OBJECT');
    need((await request('get', 'if-match-refusal', { ifMatch: '"atlas-release-never-match"' })).status === 412, 'READ_PRECONDITION_NOT_PROVEN');
    passed = true;
  } catch (error) { failureCode = safeCode(error); }
  finally {
    phase = 'cleanup';
    if (initiallyAbsent && putAttempted) {
      cleanup = 'REQUIRED';
      try {
        need(!versionConflict, 'MULTIPLE_VERSIONS_REQUIRE_RECONCILIATION');
        for (let attempt = 0; attempt < bounds.maxDeleteAttempts; attempt++) {
          const own = await verifiedRead(`cleanup-${attempt + 1}`, { cleanupRead: true });
          if (own) {
            try { await request('delete', `cleanup-delete-${attempt + 1}`, { ...(version(own) ? { versionId: version(own) } : {}) }); }
            catch { /* Unknown reply: inspect this same key before any retry. */ }
          }
          const head = await request('head', `cleanup-confirm-head-${attempt + 1}`, { ...(observedVersion ? { versionId: observedVersion } : {}) });
          const get = await request('get', `cleanup-confirm-get-${attempt + 1}`, { ...(observedVersion ? { versionId: observedVersion } : {}) });
          if (head.status === 404 && get.status === 404) {
            if (observedVersion) {
              need((await request('head', 'cleanup-current-key-head')).status === 404
                && (await request('get', 'cleanup-current-key-get')).status === 404, 'CLEANUP_CURRENT_KEY_REMAINS');
            }
            cleanup = 'VERIFIED_ABSENT'; break;
          }
          need(head.status === 200 && get.status === 200, 'CLEANUP_ABSENCE_UNPROVEN');
        }
        need(cleanup === 'VERIFIED_ABSENT', 'CLEANUP_FAILED');
      } catch (error) { cleanup = 'REQUIRES_OPERATOR_RECONCILIATION'; failureCode ??= safeCode(error); }
    }
  }
  const result = { status: passed && cleanup === 'VERIFIED_ABSENT' ? 'PASS_CLEANED' : cleanup === 'REQUIRES_OPERATOR_RECONCILIATION'
    ? 'FAILED_CLEANUP_REQUIRED' : 'FAILED_SAFE', planSha256: approvedPlanSha, key: plan.target.key,
    failureCode, cleanup, counts, elapsedMs: Math.max(0, now() - started), observations };
  event({ state: 'TERMINAL', status: result.status, cleanup, failureCode });
  return result;
}

/** Presigning uses the candidate's exact PUT options; one bounded fetch per call. */
export function createHttpTransport({ sdk, getSignedUrl, createPhotoStorage, createS3ManualArtifactTransport,
  credentials, cleanupCredentials = credentials, fetchImpl = fetch }) {
  for (const pair of [credentials, cleanupCredentials]) need(pair && typeof pair.accessKeyId === 'string'
    && pair.accessKeyId.length >= 8 && typeof pair.secretAccessKey === 'string' && pair.secretAccessKey.length >= 16, 'EXPLICIT_CREDENTIALS_REQUIRED');
  const allowedHeaders = ['content-length','content-type','content-encoding','content-range','etag','x-amz-version-id','x-amz-delete-marker',
    'x-amz-checksum-sha256','x-amz-meta-atlas-kind','x-amz-meta-atlas-binding-sha256','x-amz-meta-atlas-manual-lineage-sha256','access-control-allow-origin','access-control-allow-headers','access-control-allow-methods'];
  async function receive(response, req, method) {
    const normalized = Object.fromEntries(allowedHeaders.filter(k => response.headers.has(k)).map(k => [k, response.headers.get(k)]));
    const result = { status: response.status, headers: normalized };
    if (req.anonymous || req.operation === 'options' || method === 'HEAD') { await response.body?.cancel(); return { result, bytes: Buffer.alloc(0) }; }
    const reader = response.body?.getReader(), chunks = []; let length = 0;
    try {
      if (reader) while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length; need(length <= req.maximumBodyBytes, 'RESPONSE_BODY_LIMIT'); chunks.push(Buffer.from(next.value));
      }
    } finally { try { await reader?.cancel(); } catch { /* Abort already closes the transport. */ } }
    const bytes = Buffer.concat(chunks, length);
    if (req.operation === 'get' && response.status === 200) result.bytes = bytes;
    if (response.status >= 400) {
      const code = bytes.toString('utf8').match(/<Code>([A-Za-z0-9]{1,80})<\/Code>/)?.[1];
      if (code) result.errorCode = code;
    }
    return { result, bytes };
  }
  return {
    async send(req) {
      const { target, operation } = req;
      let url = `${target.uploadOrigin}/${target.key}`, method, headers = {}, body;
      const input = { Bucket: target.bucket, ...(operation === 'headBucket' || operation === 'versioning' ? {} : { Key: target.key }),
        ...(req.versionId ? { VersionId: req.versionId } : {}), ...(req.ifMatch ? { IfMatch: req.ifMatch } : {}) };
      if (['head', 'get'].includes(operation) && !req.browser && !req.anonymous) input.ChecksumMode = 'ENABLED';
      const types = { headBucket: ['HeadBucketCommand', 'HEAD'], versioning: ['GetBucketVersioningCommand', 'GET'],
        head: ['HeadObjectCommand', 'HEAD'], get: ['GetObjectCommand', 'GET'], put: ['PutObjectCommand', 'PUT'], delete: ['DeleteObjectCommand', 'DELETE'] };
      if (operation === 'options') { method = 'OPTIONS'; headers = { Origin: target.staffOrigin,
        'Access-Control-Request-Method': req.method, 'Access-Control-Request-Headers': req.corsHeaders.join(',') }; }
      else {
        need(Object.hasOwn(types, operation), 'OPERATION_REFUSED');
        const [commandName, verb] = types[operation]; method = verb;
        if (req.ifMatch) headers['If-Match'] = req.ifMatch;
        if (operation === 'put') {
          headers = { ...req.requiredHeaders, 'x-amz-checksum-sha256': req.checksum };
          Object.assign(input, { ContentLength: req.body.length, ContentType: headers['Content-Type'], IfNoneMatch: '*',
            ChecksumAlgorithm: 'SHA256', ChecksumSHA256: req.checksum, Metadata: Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith('x-amz-meta-')).map(([name, value]) => [name.slice('x-amz-meta-'.length), value])) });
          body = req.body;
        }
        // Exercise the real artifact client.send path, including the SDK's HTTP
        // serializer/checksum middleware. Its single HTTP handler is constrained
        // to this one already-journaled request; no hidden retry can escape caps.
        if (req.profile === 'artifact' && (operation === 'put'
          || operation === 'get' && ['created-object-get', 'after-collision-get'].includes(req.label))) {
          need(typeof createS3ManualArtifactTransport === 'function', 'ACTUAL_ARTIFACT_ADAPTER_REQUIRED');
          let captured, wireCount = 0;
          const client = new sdk.S3Client({ endpoint: target.endpoint, region: target.region, maxAttempts: 1, credentials,
            requestHandler: { async handle(wire, options) {
              need(++wireCount === 1, 'SDK_RETRY_REFUSED');
              const url = new URL(`${wire.protocol}//${wire.hostname}${wire.port ? `:${wire.port}` : ''}${wire.path}`);
              for (const [key, value] of Object.entries(wire.query ?? {})) {
                for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item ?? '');
              }
              need(url.origin === target.uploadOrigin && url.pathname === `/${target.key}` && wire.method === method, 'SDK_TARGET_CHANGED');
              need(!options?.abortSignal?.aborted && !req.signal?.aborted, 'REQUEST_ABORTED');
              if (operation === 'put') need(wire.body instanceof Uint8Array && Buffer.from(wire.body).equals(req.body)
                && wire.headers['if-none-match'] === '*' && wire.headers['x-amz-checksum-sha256'] === req.checksum
                && wire.headers['x-amz-sdk-checksum-algorithm'] === 'SHA256' && wire.headers['content-length'] === '65'
                && Object.entries(headers).every(([name, value]) => wire.headers[name.toLowerCase()] === value), 'SDK_PUT_CONTRACT_CHANGED');
              const response = await fetchImpl(url.href, { method, headers: wire.headers,
                ...(operation === 'put' ? { body: wire.body } : {}), redirect: 'error', signal: req.signal });
              const received = await receive(response, req, method); captured = received.result;
              return { response: { statusCode: response.status, headers: Object.fromEntries(response.headers), body: Readable.from([received.bytes]) } };
            }, destroy() {} } });
          try {
            const actual = createS3ManualArtifactTransport({ client, bucket: target.bucket, PutObjectCommand: sdk.PutObjectCommand, GetObjectCommand: sdk.GetObjectCommand });
            if (operation === 'get') {
              const read = await actual.read({ key: target.key, maxBytes: 65, signal: req.signal });
              need(read.lineageSha256 === req.requiredHeaders['x-amz-meta-atlas-manual-lineage-sha256'], 'ARTIFACT_LINEAGE_CHANGED');
              need(read.bytes.equals(captured.bytes), 'ARTIFACT_READ_CHANGED');
            } else if (req.label === 'checksum-refusal') await client.send(new sdk.PutObjectCommand({ ...input, Body: req.body }), { abortSignal: req.signal });
            else await actual.putIfAbsent({ key: target.key, bytes: req.body, sha256: sha(req.body),
              lineageSha256: req.requiredHeaders['x-amz-meta-atlas-manual-lineage-sha256'], signal: req.signal });
          } catch (error) {
            if (!captured || captured.status < 400) throw error;
          } finally { client.destroy(); }
          need(captured && wireCount === 1, 'SDK_RESPONSE_MISSING');
          return captured;
        }
        if (!req.anonymous) {
          const client = new sdk.S3Client({ endpoint: target.endpoint, region: target.region, maxAttempts: 1,
            credentials: operation === 'delete' ? cleanupCredentials : credentials });
          try {
            if (operation === 'put' && req.profile === 'photo' && req.label === 'create-once') {
              need(typeof createPhotoStorage === 'function', 'ACTUAL_PHOTO_ADAPTER_REQUIRED');
              const grant = await createPhotoStorage({ client, bucket: target.bucket, keyPrefix: req.keyPrefix,
                limits: { maxObjectBytes: 65, timeoutMs: 10000 } }).createOriginalUpload({ uploadPlan: req.uploadPlan, expiresIn: 300, signal: req.signal });
              need(JSON.stringify(grant.headers) === JSON.stringify(req.requiredHeaders) && grant.byteCount === 65 && grant.object.key === target.key, 'GRANT_CONTRACT_CHANGED');
              url = grant.url;
            } else url = await getSignedUrl(client, new sdk[commandName](input), { expiresIn: 300,
              ...(operation === 'put' ? { unhoistableHeaders: new Set(Object.keys(headers).map(k => k.toLowerCase())),
                signableHeaders: new Set(['content-type', 'if-none-match']) } : {}) });
          } finally { client.destroy(); }
        }
        if ((operation === 'put' && req.profile === 'photo') || req.browser) headers.Origin = target.staffOrigin;
      }
      const parsed = new URL(url);
      need(parsed.origin === target.uploadOrigin && [operation === 'headBucket' || operation === 'versioning' ? '/' : `/${target.key}`].includes(parsed.pathname), 'SIGNED_TARGET_CHANGED');
      need(!req.signal?.aborted, 'REQUEST_ABORTED');
      const response = await fetchImpl(url, { method, headers, ...(body ? { body } : {}), redirect: 'error', signal: req.signal });
      const { result, bytes } = await receive(response, req, method);
      if (operation === 'versioning' && response.status === 200) {
        // Only a complete empty document or recognized complete Status is usable.
        // Truncation, additional elements, entities and declarations fail closed.
        const xml = bytes.toString('utf8').trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i, '');
        const root = 'VersioningConfiguration(?:\\s+xmlns=["\']http://s3.amazonaws.com/doc/2006-03-01/["\'])?\\s*';
        const empty = new RegExp(`^<${root}/>\\s*$`).test(xml);
        const document = xml.match(new RegExp(`^<${root}>\\s*(?:<Status>(Enabled|Suspended)</Status>\\s*)?</VersioningConfiguration>$`));
        need(empty || document, 'VERSIONING_RESPONSE_INVALID'); result.versioning = document?.[1] ?? null;
      }
      return result;
    },
  };
}

export function validateManifest(approvedManifestSha, manifestBytes, {
  readSource = relative => readFileSync(resolve(SOURCE_ROOT, relative)), readInputs = loadSealedInputs,
} = {}) {
  need(/^[a-f0-9]{64}$/.test(approvedManifestSha) && sha(manifestBytes) === approvedManifestSha, 'EXACT_MANIFEST_APPROVAL_REQUIRED');
  const manifest = JSON.parse(manifestBytes);
  need(manifest.schemaVersion === 1 && manifest.status === STATUS
    && manifest.root === QUALIFICATION_ROOT && equal(manifest.profiles, ['photo', 'artifact'])
    && equal(Object.keys(manifest.sources ?? {}).sort(), [...QUALIFICATION_SOURCES].sort())
    && equal(Object.keys(manifest.plans ?? {}).sort(), ['artifact', 'photo'])
    && equal(Object.keys(manifest.keys ?? {}).sort(), ['artifact', 'photo']), 'MANIFEST_INVALID');
  for (const [relative, expected] of Object.entries(manifest.sources)) {
    need(/^[a-f0-9]{64}$/.test(expected) && sha(readSource(relative)) === expected, 'QUALIFIED_SOURCE_CHANGED');
  }
  let id;
  for (const profile of manifest.profiles) {
    const inputs = readInputs(profile);
    const plan = validateApproval({ execute: true, approvedPlanSha: manifest.plans[profile], inputs });
    need(plan.profile === profile && plan.target.key === manifest.keys[profile] && (!id || id === plan.id), 'MANIFEST_PLAN_BINDING_CHANGED');
    id = plan.id;
  }
  need(manifest.keys.photo !== manifest.keys.artifact, 'MANIFEST_PLAN_BINDING_CHANGED');
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  need(args.length === 3 && args[0] === '--execute-live-qualification' && /^--approved-manifest-sha256=[a-f0-9]{64}$/.test(args[1])
    && args[2].startsWith('--evidence-dir=/'), 'EXACT_EXECUTION_ARGUMENTS_REQUIRED');
  const approvedManifestSha = args[1].slice('--approved-manifest-sha256='.length);
  const manifest = validateManifest(approvedManifestSha, readFileSync(`${QUALIFICATION_ROOT}/manifest.json`));
  const evidence = resolve(args[2].slice('--evidence-dir='.length));
  need(evidence === `${QUALIFICATION_ROOT}/evidence` && realpathSync(QUALIFICATION_ROOT) === QUALIFICATION_ROOT, 'EVIDENCE_DESTINATION_REFUSED');
  const credentials = { accessKeyId: process.env.ATLAS_QUALIFICATION_ACCESS_KEY_ID, secretAccessKey: process.env.ATLAS_QUALIFICATION_SECRET_ACCESS_KEY };
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  need(require('@aws-sdk/client-s3/package.json').version === '3.914.0'
    && require('@aws-sdk/s3-request-presigner/package.json').version === '3.982.0', 'SDK_VERSION_CHANGED');
  for (const [name, relative] of [['@atlas/photo-core', 'packages/atlas-photo-core/src/index.mjs'], ['@atlas/photo-runtime', 'packages/atlas-photo-runtime/src/index.mjs']])
    need(realpathSync(require.resolve(name)) === realpathSync(resolve(SOURCE_ROOT, relative)), 'WORKSPACE_MODULE_CHANGED');
  const { createPhotoStorage } = await import('../../packages/atlas-photo-storage/src/index.mjs');
  const { createS3ManualArtifactTransport } = await import('../../packages/atlas-manual-service/src/artifacts.mjs');
  const transport = createHttpTransport({ sdk: require('@aws-sdk/client-s3'), getSignedUrl: require('@aws-sdk/s3-request-presigner').getSignedUrl,
    createPhotoStorage, createS3ManualArtifactTransport, credentials });
  mkdirSync(evidence, { recursive: false, mode: 0o700 });
  const intent = { manifestSha256: approvedManifestSha, evidence, at: new Date().toISOString(), keys: manifest.keys };
  // A fixed exclusive intent survives process loss and permanently consumes this one-shot action.
  writeFileSync(`${QUALIFICATION_ROOT}/execution.intent.json`, JSON.stringify(intent)+'\n', { mode: 0o600, flag: 'wx' });
  const journal = resolve(evidence, 'requests.ndjson'); writeFileSync(journal, '', { mode: 0o600, flag: 'wx' });
  const abort = new AbortController(), cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const results = [];
  try {
    for (const profile of manifest.profiles) {
      const result = await runCanary({ execute: true, approvedPlanSha: manifest.plans[profile], inputs: loadSealedInputs(profile), transport, signal: abort.signal,
        onEvent: event => appendFileSync(journal, JSON.stringify({ profile, ...event })+'\n') });
      results.push({ profile, ...result });
      writeFileSync(resolve(evidence, `${profile}-result.json`), JSON.stringify(result,null,2)+'\n', { mode: 0o600, flag: 'wx' });
      if (result.status !== 'PASS_CLEANED') break;
    }
    const status = results.length === 2 && results.every(result => result.status === 'PASS_CLEANED') ? 'PASS_CLEANED' : 'FAILED_STOPPED';
    writeFileSync(resolve(evidence, 'result.json'), JSON.stringify({ status, manifestSha256: approvedManifestSha, results,
      notRun: manifest.profiles.filter(profile => !results.some(result => result.profile === profile)) },null,2)+'\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status, evidence, profiles: results.map(({ profile, status, failureCode, cleanup, counts }) => ({ profile, status, failureCode, cleanup, counts })) }));
    if (status !== 'PASS_CLEANED') process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(JSON.stringify({ status: 'REFUSED_OR_INTERRUPTED', code: safeCode(error),
    action: 'Preserve execution intent and request journal. Reconcile only the new sealed keys; never rerun this qualification or the old canary.' })); process.exitCode = 1;
});
