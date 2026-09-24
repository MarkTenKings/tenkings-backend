// One known diagnostic artifact only: no PUT, no retries, no prior-intent changes.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ROOT as PARENT_ROOT, validateManifest as validateParent } from './manual-storage-compatibility-diagnostic.mjs';
import { createHttpTransport } from './manual-release-storage-qualification.mjs';
export const ROOT = `${PARENT_ROOT}/artifact-reconciliation-1`;
export const PARENT_SHA = '22aa4b49790f12add6b5b9cc48d29669bfe002dfb7e3e376842cd4474cad6dd5';
export const BOUNDS = Object.freeze({ requests: 5, putAttempts: 0, deleteAttempts: 1, responseBytes: 4096, requestMs: 10000, totalMs: 60000 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { reconcileCode: code }); };
const safeCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.reconcileCode ?? '') ? error.reconcileCode : 'REQUEST_FAILED';
export function parentProfile() {
  const manifest = validateParent(PARENT_SHA, readFileSync(`${PARENT_ROOT}/manifest.json`));
  const result = JSON.parse(readFileSync(`${PARENT_ROOT}/evidence/result.json`));
  need(result.manifestSha256 === PARENT_SHA && result.status === 'DIAGNOSTIC_STOPPED', 'PARENT_RESULT_CHANGED');
  const artifact = result.results.find(r => r.profile === 'artifact');
  need(artifact?.cleanup === 'REQUIRES_OPERATOR_RECONCILIATION' && artifact.counts.putAttempts === 1
    && artifact.counts.putBytes === 65 && artifact.counts.deleteAttempts === 0
    && artifact.events.filter(e => e.operation === 'put' && e.state === 'DISPATCHING').length === 1
    && artifact.events.find(e => e.operation === 'put' && e.state === 'DISPATCHING').label === 'checksum-refusal', 'PARENT_SCOPE_CHANGED');
  const profile = manifest.profiles.find(p => p.profile === 'artifact');
  need(artifact.key === profile.target.key, 'PARENT_KEY_CHANGED');
  return profile;
}
export async function reconcile({ profile, transport, onEvent = () => {}, now = () => performance.now(), signal,
  timers = { set: setTimeout, clear: clearTimeout } }) {
  const started = now(), events = [], counts = { requests: 0, putAttempts: 0, deleteAttempts: 0 };
  const emit = event => { events.push(event); onEvent(event); };
  let verified = false;
  async function send(operation, label, options = {}) {
    need(['head', 'get', 'delete'].includes(operation) && counts.requests < 5 && now() - started < 60000 && !signal?.aborted, 'REQUEST_BOUND');
    if (operation === 'delete') { need(verified && counts.deleteAttempts === 0, 'DELETE_NOT_VERIFIED'); counts.deleteAttempts++; }
    const sequence = ++counts.requests; emit({ sequence, operation, label, state: 'DISPATCHING' });
    const controller = new AbortController(), cancel = () => controller.abort(); let timer;
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const timeout = new Promise((_, reject) => {
        timer = timers.set(() => { controller.abort(); reject(Object.assign(new Error('TIMEOUT'), { reconcileCode: 'TIMEOUT' })); }, Math.min(10000, started + 60000 - now()));
        controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('ABORTED'), { reconcileCode: 'ABORTED' })), { once: true });
      });
      const response = await Promise.race([Promise.resolve().then(() => {
        need(!controller.signal.aborted && !signal?.aborted, 'CANCELLED');
        return transport.send({ ...options, operation, label, target: profile.target, requiredHeaders: profile.requiredHeaders,
          profile: 'artifact', keyPrefix: profile.keyPrefix, signal: controller.signal, maximumBodyBytes: 4096 });
      }), timeout]);
      need(Number.isInteger(response.status) && response.headers && response.headers['x-amz-version-id'] === undefined, 'RESPONSE_OR_VERSION_INVALID');
      need(!response.bytes || response.bytes.length <= 4096, 'RESPONSE_TOO_LARGE');
      emit({ sequence, operation, label, state: 'OBSERVED', status: response.status,
        ...(response.bytes ? { bytes: response.bytes.length, sha256: sha(response.bytes) } : {}),
        nativeChecksum: response.headers['x-amz-checksum-sha256'] === undefined ? 'ABSENT'
          : response.headers['x-amz-checksum-sha256'] === Buffer.from(profile.payloadSha256, 'hex').toString('base64') ? 'MATCHES_EXPECTED' : 'DIFFERS_FROM_EXPECTED' });
      return response;
    } catch (error) { emit({ sequence, operation, label, state: 'STOPPED', code: safeCode(error) }); throw error; }
    finally { timers.clear(timer); signal?.removeEventListener('abort', cancel); }
  }
  function metadata(response) {
    const h = response.headers;
    need(response.status === 200 && h['content-length'] === '65' && h['content-type'] === 'application/json'
      && h['content-encoding'] === undefined && h['content-range'] === undefined && h['x-amz-delete-marker'] !== 'true'
      && h['x-amz-meta-atlas-manual-lineage-sha256'] === profile.requiredHeaders['x-amz-meta-atlas-manual-lineage-sha256']
      && typeof h.etag === 'string' && h.etag.length > 0 && h.etag.length <= 512 && !/[\x00-\x1f\x7f]/.test(h.etag), 'OWNERSHIP_METADATA_CONFLICT');
  }
  let status = 'RECONCILIATION_REQUIRED', failureCode = null;
  try {
    const head = await send('head', 'reconcile-head');
    if (head.status === 404) {
      need((await send('get', 'reconcile-absent-get')).status === 404, 'ABSENCE_UNPROVEN'); status = 'VERIFIED_ABSENT';
    } else {
      metadata(head);
      const get = await send('get', 'reconcile-get', { ifMatch: head.headers.etag }); metadata(get);
      need(get.headers.etag === head.headers.etag && get.bytes?.length === 65 && sha(get.bytes) === profile.payloadSha256, 'OWNED_BYTES_CONFLICT');
      verified = true;
      const deleted = await send('delete', 'reconcile-delete'); need(deleted.status >= 200 && deleted.status < 300, 'DELETE_NOT_CONFIRMED');
      const afterHead = await send('head', 'reconcile-after-head'), afterGet = await send('get', 'reconcile-after-get');
      need(afterHead.status === 404 && afterGet.status === 404, 'CLEANUP_ABSENCE_UNPROVEN'); status = 'VERIFIED_ABSENT';
    }
  } catch (error) { failureCode = safeCode(error); }
  return { status, failureCode, key: profile.target.key, releaseQualified: false, counts, elapsedMs: Math.max(0, now() - started), events };
}
async function main() {
  const args = process.argv.slice(2);
  need(args.length === 2 && args[0] === '--execute' && /^--manifest-sha256=[a-f0-9]{64}$/.test(args[1]), 'EXACT_EXECUTION_REQUIRED');
  const bytes = readFileSync(`${ROOT}/manifest.json`), expectedSha = args[1].slice('--manifest-sha256='.length);
  need(sha(bytes) === expectedSha, 'MANIFEST_HASH_CHANGED'); const manifest = JSON.parse(bytes), profile = parentProfile();
  need(manifest.root === ROOT && manifest.parentSha256 === PARENT_SHA && manifest.key === profile.target.key
    && manifest.payloadSha256 === profile.payloadSha256 && manifest.parentResultSha256 === sha(readFileSync(`${PARENT_ROOT}/evidence/result.json`))
    && JSON.stringify(manifest.bounds) === JSON.stringify(BOUNDS) && realpathSync(ROOT) === ROOT, 'MANIFEST_SCOPE_CHANGED');
  const source = new URL('./manual-storage-artifact-reconcile.mjs', import.meta.url);
  need(manifest.sourceSha256 === sha(readFileSync(source)), 'SOURCE_CHANGED');
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  need(require('@aws-sdk/client-s3/package.json').version === '3.914.0' && require('@aws-sdk/s3-request-presigner/package.json').version === '3.982.0', 'SDK_CHANGED');
  const transport = createHttpTransport({ sdk: require('@aws-sdk/client-s3'), getSignedUrl: require('@aws-sdk/s3-request-presigner').getSignedUrl,
    credentials: { accessKeyId: process.env.ATLAS_DIAGNOSTIC_ACCESS_KEY_ID, secretAccessKey: process.env.ATLAS_DIAGNOSTIC_SECRET_ACCESS_KEY } });
  writeFileSync(`${ROOT}/execution.intent.json`, JSON.stringify({ manifestSha256: expectedSha, at: new Date().toISOString(), key: profile.target.key })+'\n', { flag: 'wx', mode: 0o600 });
  mkdirSync(`${ROOT}/evidence`, { mode: 0o700 }); const journal = `${ROOT}/evidence/requests.ndjson`;
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const abort = new AbortController(), cancel = () => abort.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await reconcile({ profile, transport, signal: abort.signal, onEvent: e => appendFileSync(journal, JSON.stringify(e)+'\n') });
    writeFileSync(`${ROOT}/evidence/result.json`, JSON.stringify({ manifestSha256: expectedSha, ...result }, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, failureCode: result.failureCode, counts: result.counts, releaseQualified: false }));
    if (result.status !== 'VERIFIED_ABSENT') process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(JSON.stringify({ status: 'RECONCILIATION_REFUSED_OR_INTERRUPTED', code: safeCode(error), releaseQualified: false })); process.exitCode = 1;
});
