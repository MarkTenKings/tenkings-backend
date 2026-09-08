import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { bridgeOrigin, canonical, digest, keyBytes, keys, requireBridge as check, SHA, UUID } from './protocol.mjs';

export const MACHINE_INITIALIZATION_ADMISSION_PATH = '/api/internal/atlas/machine-initialize/admit';
export const MACHINE_INITIALIZATION_EXECUTION_PATH = '/api/internal/atlas/machine-initialize/execute';
export const MACHINE_INITIALIZATION_ADMISSION_PURPOSE = 'atlas-machine-initialize-admission-v1';
export const MACHINE_INITIALIZATION_EXECUTION_PURPOSE = 'atlas-machine-initialize-execution-v1';
export const MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER = 'x-atlas-machine-admission-signature';
export const MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER = 'x-atlas-machine-execution-signature';
const REQUEST_LIMIT = 8192, RESPONSE_LIMIT = 4096;
const sha = value => typeof value === 'string' && SHA.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** No ambient keys or destination. The private service separately pins these
 * key hashes in its approved grading-bridge config; this cannot enable it.
 */
export function makeMachineInitializationTransportConfig({ mode, origin, runtimeHash, admissionKey, executionKey, otherKeyHashes = [] }) {
    bridgeOrigin(origin);
    const admission = Buffer.isBuffer(admissionKey) ? Buffer.from(admissionKey) : keyBytes(admissionKey);
    const execution = Buffer.isBuffer(executionKey) ? Buffer.from(executionKey) : keyBytes(executionKey);
    const admissionKeyHash = digest(admission), executionKeyHash = digest(execution);
    check(['PRODUCTION', 'LOCAL_FIXTURE'].includes(mode) && sha(runtimeHash) && admission.length === 32 && execution.length === 32
        && admissionKeyHash !== executionKeyHash && Array.isArray(otherKeyHashes) && otherKeyHashes.length <= 32
        && otherKeyHashes.every(sha) && !otherKeyHashes.includes(admissionKeyHash) && !otherKeyHashes.includes(executionKeyHash),
    'MACHINE_INITIALIZATION_CONFIGURATION_INVALID');
    return Object.freeze({ mode, origin, runtimeHash, admissionKey: admission, executionKey: execution, admissionKeyHash, executionKeyHash });
}
function purposeConfig({ mode, origin, runtimeHash, key, peerKeyHash, otherKeyHashes = [] }, admission) {
    bridgeOrigin(origin);
    const bytes = Buffer.isBuffer(key) ? Buffer.from(key) : keyBytes(key), ownHash = digest(bytes);
    check(['PRODUCTION', 'LOCAL_FIXTURE'].includes(mode) && sha(runtimeHash) && bytes.length === 32
        && sha(peerKeyHash) && ownHash !== peerKeyHash && Array.isArray(otherKeyHashes) && otherKeyHashes.length <= 32
        && otherKeyHashes.every(sha) && !otherKeyHashes.includes(ownHash), 'MACHINE_INITIALIZATION_CONFIGURATION_INVALID');
    return Object.freeze({ mode, origin, runtimeHash, [admission ? 'admissionKey' : 'executionKey']: bytes,
        admissionKeyHash: admission ? ownHash : peerKeyHash, executionKeyHash: admission ? peerKeyHash : ownHash });
}
// Each caller receives one purpose key and only the peer's public hash. The
// staff app cannot dispatch; the runner cannot admit a new human-authorized job.
export function makeMachineInitializationAdmissionConfig(input) { return purposeConfig(input, true); }
export function makeMachineInitializationExecutionConfig(input) { return purposeConfig(input, false); }
function configBinding(config, admission = null) {
    if (admission !== null && !(Buffer.isBuffer(config?.admissionKey) && Buffer.isBuffer(config?.executionKey))) {
        const keyName = admission ? 'admissionKey' : 'executionKey', peer = admission ? 'executionKeyHash' : 'admissionKeyHash';
        check(config && Buffer.isBuffer(config[keyName]) && digest(config[keyName]) === config[`${keyName}Hash`]
            && !Object.hasOwn(config, admission ? 'executionKey' : 'admissionKey'), 'MACHINE_INITIALIZATION_CONFIGURATION_INVALID');
        return purposeConfig({ ...config, key: config[keyName], peerKeyHash: config[peer] }, admission);
    }
    check(config && Buffer.isBuffer(config.admissionKey) && Buffer.isBuffer(config.executionKey)
        && digest(config.admissionKey) === config.admissionKeyHash && digest(config.executionKey) === config.executionKeyHash,
    'MACHINE_INITIALIZATION_CONFIGURATION_INVALID');
    return makeMachineInitializationTransportConfig(config);
}
function scopeBinding(scope, mode) {
    keys(scope, ['actorId', 'sessionHash', 'browserHash', 'accessVersion', 'controlRevision', 'staffOrigin',
        'deploymentId', 'releaseSha', 'staffConfigHash', 'operationsGrantId']);
    check(uuid(scope.actorId) && uuid(scope.operationsGrantId) && [scope.sessionHash, scope.browserHash, scope.staffConfigHash].every(sha)
        && positive(scope.accessVersion) && positive(scope.controlRevision) && text(scope.deploymentId, 120)
        && typeof scope.releaseSha === 'string' && /^[a-f0-9]{40}$/.test(scope.releaseSha), 'MACHINE_INITIALIZATION_SCOPE_INVALID');
    if (mode !== 'LOCAL_FIXTURE' || scope.staffOrigin !== 'http://127.0.0.1:4318') bridgeOrigin(scope.staffOrigin);
}
function inputBinding(config, input, admission) {
    keys(input, admission ? ['jobId', 'specimenId', 'reason', 'authorizationEvidenceHash', 'runtimeHash'] : ['jobId', 'runtimeHash']);
    check(uuid(input.jobId) && sha(input.runtimeHash) && input.runtimeHash === config.runtimeHash
        && (!admission || uuid(input.specimenId) && text(input.reason, 500) && sha(input.authorizationEvidenceHash)),
    'MACHINE_INITIALIZATION_INPUT_INVALID');
}
const route = admission => admission
    ? { purpose: MACHINE_INITIALIZATION_ADMISSION_PURPOSE, path: MACHINE_INITIALIZATION_ADMISSION_PATH,
        key: 'admissionKey', header: MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER, deadline: 20_000 }
    : { purpose: MACHINE_INITIALIZATION_EXECUTION_PURPOSE, path: MACHINE_INITIALIZATION_EXECUTION_PATH,
        key: 'executionKey', header: MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER, deadline: 220_000 };
function sign(config, scope, input, admission, now, nonce) {
    const bound = configBinding(config, admission), target = route(admission); inputBinding(bound, input, admission);
    if (admission) scopeBinding(scope, bound.mode);
    check(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + 30_000) && uuid(nonce), 'MACHINE_INITIALIZATION_REQUEST_INVALID');
    const packet = { purpose: target.purpose, audience: bound.origin, path: target.path,
        ...(admission ? { scope } : {}), input, nonce, issuedAt: now, expiresAt: now + 30_000 };
    const body = canonical(packet); check(Buffer.byteLength(body) <= REQUEST_LIMIT, 'MACHINE_INITIALIZATION_REQUEST_INVALID');
    return { body, signature: createHmac('sha256', bound[target.key]).update(body).digest('hex') };
}
function verify(config, body, signature, admission, now) {
    const bound = configBinding(config, admission), target = route(admission);
    check(typeof body === 'string' && Buffer.byteLength(body) <= REQUEST_LIMIT && sha(signature), 'MACHINE_INITIALIZATION_REQUEST_INVALID');
    check(timingSafeEqual(createHmac('sha256', bound[target.key]).update(body).digest(), Buffer.from(signature, 'hex')),
        'MACHINE_INITIALIZATION_AUTHENTICATION_REQUIRED');
    let packet; try { packet = JSON.parse(body); } catch { check(false, 'MACHINE_INITIALIZATION_REQUEST_INVALID'); }
    keys(packet, ['purpose', 'audience', 'path', ...(admission ? ['scope'] : []), 'input', 'nonce', 'issuedAt', 'expiresAt']);
    check(canonical(packet) === body && packet.purpose === target.purpose && packet.audience === bound.origin && packet.path === target.path
        && uuid(packet.nonce) && Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(packet.issuedAt)
        && packet.issuedAt >= 0 && Number.isSafeInteger(packet.expiresAt) && packet.issuedAt <= now && packet.expiresAt > now
        && packet.expiresAt > packet.issuedAt && packet.expiresAt - packet.issuedAt <= 30_000, 'MACHINE_INITIALIZATION_REQUEST_EXPIRED');
    inputBinding(bound, packet.input, admission); if (admission) scopeBinding(packet.scope, bound.mode); return packet;
}
export function signMachineInitializationAdmission(config, scope, input, now = Date.now(), nonce = randomUUID()) {
    return sign(config, scope, input, true, now, nonce);
}
export function verifyMachineInitializationAdmission(config, body, signature, now = Date.now()) {
    return verify(config, body, signature, true, now);
}
export function signMachineInitializationExecution(config, input, now = Date.now(), nonce = randomUUID()) {
    return sign(config, null, input, false, now, nonce);
}
export function verifyMachineInitializationExecution(config, body, signature, now = Date.now()) {
    return verify(config, body, signature, false, now);
}

async function responseBody(response, signal) {
    check(response.status === 200 && response.redirected !== true && response.body
        && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json'
        && (!response.headers.has('content-length') || /^\d+$/.test(response.headers.get('content-length'))
            && Number(response.headers.get('content-length')) <= RESPONSE_LIMIT));
    const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        signal.throwIfAborted();
        while (true) {
            const { done, value } = await reader.read(); signal.throwIfAborted();
            if (done) { complete = true; break; }
            size += value.byteLength; check(size <= RESPONSE_LIMIT); chunks.push(Buffer.from(value));
        }
        const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
        const parsed = JSON.parse(body); check(canonical(parsed) === body); return parsed;
    } finally {
        signal.removeEventListener('abort', cancel); if (!complete) cancel(); reader.releaseLock();
    }
}
function responseBinding(value, input, admission) {
    if (admission) {
        keys(value, ['jobId', 'specimenId', 'pilotId', 'gradingOperationId', 'runtimeHash', 'state', 'deadlineAt']);
        check(value.specimenId === input.specimenId && uuid(value.pilotId) && uuid(value.gradingOperationId)
            && ['QUEUED', 'DISPATCHED', 'SUCCEEDED', 'UNKNOWN', 'FAILED'].includes(value.state) && iso(value.deadlineAt));
    } else {
        keys(value, ['jobId', 'runtimeHash', 'state', ...(value.state === 'SUCCEEDED' ? ['analysisRevision'] : []),
            ...(Object.hasOwn(value, 'operatorRunId') ? ['operatorRunId'] : [])]);
        check(['SUCCEEDED', 'UNKNOWN', 'FAILED'].includes(value.state)
            && (value.state !== 'SUCCEEDED' || value.analysisRevision === 1)
            && (!Object.hasOwn(value, 'operatorRunId') || value.state === 'SUCCEEDED' && uuid(value.operatorRunId)));
    }
    check(value.jobId === input.jobId && value.runtimeHash === input.runtimeHash); return value;
}

/** A single fixed HTTPS request; both fetch and body reading are bounded even
 * for an uncooperative injected transport. Failures remain generic uncertainty.
 * A verified execution response may omit operatorRunId; no run is inferred.
 */
function clientForPurpose(config, fetchImpl, { timers = { setTimeout, clearTimeout } } = {}, purpose = null) {
    const bound = configBinding(config, purpose); check(typeof fetchImpl === 'function', 'MACHINE_INITIALIZATION_CONFIGURATION_INVALID');
    const call = async (signed, input, admission, parentSignal) => {
        const target = route(admission), controller = new AbortController();
        const abort = () => controller.abort(); let timer;
        parentSignal?.addEventListener('abort', abort, { once: true }); if (parentSignal?.aborted) abort();
        let stop;
        const stopped = new Promise((_, reject) => { stop = () => reject(new Error('MACHINE_INITIALIZATION_OUTCOME_UNCONFIRMED'));
            controller.signal.addEventListener('abort', stop, { once: true }); });
        stopped.catch(() => {});
        try {
            controller.signal.throwIfAborted(); timer = timers.setTimeout(abort, target.deadline);
            return await Promise.race([stopped, (async () => {
                const response = await fetchImpl(`${bound.origin}${target.path}`, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
                    headers: { 'content-type': 'application/json', [target.header]: signed.signature }, body: signed.body, signal: controller.signal });
                controller.signal.throwIfAborted(); return responseBinding(await responseBody(response, controller.signal), input, admission);
            })()]);
        } catch { check(false, 'MACHINE_INITIALIZATION_OUTCOME_UNCONFIRMED'); }
        finally {
            if (timer !== undefined) timers.clearTimeout(timer); parentSignal?.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', stop); controller.abort();
        }
    };
    return Object.freeze({ binding: Object.freeze({ origin: bound.origin, runtimeHash: bound.runtimeHash,
        admissionKeyHash: bound.admissionKeyHash, executionKeyHash: bound.executionKeyHash }),
        ...(purpose !== false ? { admit(scope, input, { signal } = {}) {
            const signed = signMachineInitializationAdmission(bound, scope, input); return call(signed, JSON.parse(signed.body).input, true, signal);
        } } : {}),
        ...(purpose !== true ? { execute(input, { signal } = {}) {
            const signed = signMachineInitializationExecution(bound, input); return call(signed, JSON.parse(signed.body).input, false, signal);
        } } : {}) });
}
export function machineInitializationClient(config, fetchImpl = fetch, options) { return clientForPurpose(config, fetchImpl, options); }
export function machineInitializationAdmissionClient(config, fetchImpl = fetch, options) { return clientForPurpose(config, fetchImpl, options, true); }
export function machineInitializationExecutionClient(config, fetchImpl = fetch, options) { return clientForPurpose(config, fetchImpl, options, false); }
