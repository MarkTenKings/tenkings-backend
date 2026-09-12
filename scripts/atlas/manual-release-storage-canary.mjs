// Exact-plan operator canary. Importing is offline; CLI requires both gates.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export const PLAN_SHA = '008366069923b18feb75140c697ad192b9fd55bba5a8bd1f0b99f1b193efe35b';
export const PLAN_PATH = '/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/canary/plan.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { canaryCode: code }); };
const need = (truth, code) => { if (!truth) fail(code); };
const good = result => result.status >= 200 && result.status < 300;
const safeCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.canaryCode ?? '') ? error.canaryCode : 'REQUEST_FAILED';
const version = result => result.headers['x-amz-version-id'] ?? null;

export function loadSealedInputs() {
  const planBytes = readFileSync(PLAN_PATH), plan = JSON.parse(planBytes);
  return { planBytes, payload: readFileSync(resolve(dirname(PLAN_PATH), 'payload.bin')),
    collision: readFileSync(resolve(dirname(PLAN_PATH), 'collision-payload.bin')), plan };
}
export function validateApproval({ execute, approvedPlanSha, inputs }) {
  need(execute === true && approvedPlanSha === PLAN_SHA, 'EXACT_APPROVAL_REQUIRED');
  need(sha(inputs.planBytes) === PLAN_SHA, 'SEALED_PLAN_CHANGED');
  const plan = JSON.parse(inputs.planBytes);
  need(sha(inputs.payload) === plan.payload.sha256 && inputs.payload.length === 65
    && sha(inputs.collision) === plan.collisionPayload.sha256 && inputs.collision.length === 65, 'SEALED_PAYLOAD_CHANGED');
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
    let timer, dispatched = false;
    const timeout = new Promise((_, reject) => {
      timer = timers.set(() => { controller.abort(); reject(Object.assign(new Error('REQUEST_TIMEOUT'), { canaryCode: 'REQUEST_TIMEOUT' })); }, timeoutMs);
      controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('REQUEST_ABORTED'), { canaryCode: 'REQUEST_ABORTED' })), { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        dispatched = true;
        if (operation === 'put') { putAttempted = true; attemptedPayloads.add(sha(options.body)); }
        return transport.send({ operation, label,
        ...options, body: options.body ? Buffer.from(options.body) : undefined, target: structuredClone(plan.target),
        requiredHeaders: { ...plan.requiredHeaders }, signal: controller.signal, maximumBodyBytes: bounds.maxGetBodyBytesPerResponse });
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
    need(result.status === 200 && h['content-length'] === '65' && h['content-type'] === 'application/octet-stream'
      && h['x-amz-meta-atlas-kind'] === 'original'
      && h['x-amz-meta-atlas-binding-sha256'] === plan.requiredHeaders['x-amz-meta-atlas-binding-sha256']
      && !h['content-encoding'] && !h['content-range'] && h['x-amz-delete-marker'] !== 'true'
      && typeof h.etag === 'string' && h.etag.length > 0 && h.etag.length <= 512, 'OBJECT_METADATA_CONFLICT');
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
    for (const method of ['PUT', 'GET', 'HEAD']) {
      const headers = method === 'PUT' ? Object.keys(plan.requiredHeaders) : ['content-type'];
      cors(await request('options', `cors-${method}`, { method, corsHeaders: headers }), method, headers);
    }
    const bad = await request('put', 'checksum-refusal', { body: payload, checksum: plan.collisionPayload.checksumBase64 });
    need(bad.status === 400 && bad.errorCode === 'BadDigest', 'CHECKSUM_REFUSAL_NOT_PROVEN');
    need((await request('head', 'after-checksum-refusal')).status === 404, 'CHECKSUM_PUT_CREATED_OBJECT');
    const put = await request('put', 'create-once', { body: payload, checksum: plan.payload.checksumBase64 });
    need(good(put), 'CREATE_NOT_CONFIRMED'); if (version(put)) { observedVersion = version(put); fail('UNEXPECTED_OBJECT_VERSION'); }
    const original = await verifiedRead('created-object');
    const browserRead = await request('get', 'browser-signed-get', { browser: true, ...(observedVersion ? { versionId: observedVersion } : {}) });
    metadata(browserRead); need(browserRead.bytes?.length === 65 && sha(browserRead.bytes) === plan.payload.sha256, 'BROWSER_BYTES_CONFLICT');
    need(browserRead.headers['access-control-allow-origin'] === plan.target.staffOrigin, 'BROWSER_CORS_REFUSED');
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
    ? 'FAILED_CLEANUP_REQUIRED' : 'FAILED_SAFE', planSha256: PLAN_SHA, key: plan.target.key,
    failureCode, cleanup, counts, elapsedMs: Math.max(0, now() - started), observations };
  event({ state: 'TERMINAL', status: result.status, cleanup, failureCode });
  return result;
}

/** Presigning uses the candidate's exact PUT options; one bounded fetch per call. */
export function createHttpTransport({ sdk, getSignedUrl, credentials, cleanupCredentials = credentials, fetchImpl = fetch }) {
  for (const pair of [credentials, cleanupCredentials]) need(pair && typeof pair.accessKeyId === 'string'
    && pair.accessKeyId.length >= 8 && typeof pair.secretAccessKey === 'string' && pair.secretAccessKey.length >= 16, 'EXPLICIT_CREDENTIALS_REQUIRED');
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
            ChecksumSHA256: req.checksum, Metadata: { 'atlas-kind': 'original', 'atlas-binding-sha256': headers['x-amz-meta-atlas-binding-sha256'] } });
          body = req.body;
        }
        if (!req.anonymous) {
          const client = new sdk.S3Client({ endpoint: target.endpoint, region: target.region, maxAttempts: 1,
            credentials: operation === 'delete' ? cleanupCredentials : credentials });
          try {
            url = await getSignedUrl(client, new sdk[commandName](input), { expiresIn: 300,
              ...(operation === 'put' ? { unhoistableHeaders: new Set(Object.keys(headers).map(k => k.toLowerCase())),
                signableHeaders: new Set(['content-type', 'if-none-match']) } : {}) });
          } finally { client.destroy(); }
        }
        if (operation === 'put' || req.browser) headers.Origin = target.staffOrigin;
      }
      const parsed = new URL(url);
      need(parsed.origin === target.uploadOrigin && [operation === 'headBucket' || operation === 'versioning' ? '/' : `/${target.key}`].includes(parsed.pathname), 'SIGNED_TARGET_CHANGED');
      need(!req.signal.aborted, 'REQUEST_ABORTED');
      const response = await fetchImpl(url, { method, headers, ...(body ? { body } : {}), redirect: 'error', signal: req.signal });
      const allowed = ['content-length','content-type','content-encoding','content-range','etag','x-amz-version-id','x-amz-delete-marker',
        'x-amz-checksum-sha256','x-amz-meta-atlas-kind','x-amz-meta-atlas-binding-sha256','access-control-allow-origin','access-control-allow-headers','access-control-allow-methods'];
      const normalized = Object.fromEntries(allowed.filter(k => response.headers.has(k)).map(k => [k, response.headers.get(k)]));
      const result = { status: response.status, headers: normalized };
      if (req.anonymous || operation === 'options' || method === 'HEAD') { await response.body?.cancel(); return result; }
      const reader = response.body?.getReader(), chunks = []; let length = 0;
      try {
        if (reader) while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.length; need(length <= req.maximumBodyBytes, 'RESPONSE_BODY_LIMIT'); chunks.push(Buffer.from(next.value));
        }
      } finally { try { await reader?.cancel(); } catch { /* Abort already closes the transport. */ } }
      const bytes = Buffer.concat(chunks, length);
      if (operation === 'get' && response.status === 200) result.bytes = bytes;
      if (response.status >= 400) {
        const code = bytes.toString('utf8').match(/<Code>([A-Za-z0-9]{1,80})<\/Code>/)?.[1];
        if (code) result.errorCode = code;
      }
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

async function main() {
  const args = process.argv.slice(2);
  need(args.length === 3 && args[0] === '--execute-live-canary' && args[1] === `--approved-plan-sha256=${PLAN_SHA}`
    && args[2].startsWith('--evidence-dir=/'), 'EXACT_EXECUTION_ARGUMENTS_REQUIRED');
  const evidence = resolve(args[2].slice('--evidence-dir='.length)), inputs = loadSealedInputs();
  validateApproval({ execute: true, approvedPlanSha: PLAN_SHA, inputs });
  const credentials = { accessKeyId: process.env.ATLAS_CANARY_ACCESS_KEY_ID, secretAccessKey: process.env.ATLAS_CANARY_SECRET_ACCESS_KEY };
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  need(require('@aws-sdk/client-s3/package.json').version === '3.914.0'
    && require('@aws-sdk/s3-request-presigner/package.json').version === '3.982.0', 'SDK_VERSION_CHANGED');
  const transport = createHttpTransport({ sdk: require('@aws-sdk/client-s3'), getSignedUrl: require('@aws-sdk/s3-request-presigner').getSignedUrl, credentials });
  mkdirSync(evidence, { recursive: false, mode: 0o700 });
  const intent = { planSha256: PLAN_SHA, evidence, at: new Date().toISOString(), key: inputs.plan.target.key };
  // Fixed create-new lock prevents rerunning this exact canary after a lost process.
  writeFileSync(resolve(dirname(PLAN_PATH), 'execution.intent.json'), JSON.stringify(intent)+'\n', { mode: 0o600, flag: 'wx' });
  const journal = resolve(evidence, 'requests.ndjson'); writeFileSync(journal, '', { mode: 0o600, flag: 'wx' });
  const abort = new AbortController(), cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await runCanary({ execute: true, approvedPlanSha: PLAN_SHA, inputs, transport, signal: abort.signal,
      onEvent: event => appendFileSync(journal, JSON.stringify(event)+'\n') });
    writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(result,null,2)+'\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, failureCode: result.failureCode, cleanup: result.cleanup, counts: result.counts, evidence }));
    if (result.status !== 'PASS_CLEANED') process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(JSON.stringify({ status: 'REFUSED_OR_INTERRUPTED', code: safeCode(error),
    action: 'Preserve execution intent and request journal. Reconcile only the sealed key; never rerun the canary.' })); process.exitCode = 1;
});
