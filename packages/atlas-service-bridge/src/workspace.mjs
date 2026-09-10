import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { bridgeOrigin, canonical, digest, keys, requireBridge, SHA, UUID } from './protocol.mjs';
import { boundedBytes } from './transport.mjs';

export const WORKSPACE_SERVICE_PATH = '/workspace/v1';
const purpose = 'atlas-private-workspace-v1';
const actions = new Set(['UPLOAD_GRANT', 'VERIFY_UPLOAD', 'READ_ORIGINAL', 'PREPARE_SIDE', 'INITIALIZE_REPORT', 'READ_STATUS', 'READ_PREPARED', 'RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP', 'EXECUTE_ASTRA']);
const integer = n => Number.isSafeInteger(n) && n > 0 && n < 2147483647;
function payload(action, input) {
    requireBridge(actions.has(action), 'WORKSPACE_SERVICE_REQUEST_INVALID');
    if (action === 'EXECUTE_ASTRA') {
        keys(input, ['runId', 'commandId']);
        requireBridge(UUID.test(input.runId) && UUID.test(input.commandId), 'WORKSPACE_SERVICE_REQUEST_INVALID'); return input;
    }
    if (['UPLOAD_GRANT', 'VERIFY_UPLOAD', 'READ_ORIGINAL'].includes(action)) {
        keys(input, ['cardId', 'uploadId']); requireBridge(UUID.test(input.cardId) && UUID.test(input.uploadId)); return input;
    }
    const image = action === 'READ_PREPARED';
    keys(input, image ? ['cardId', 'side', 'manifestHash', 'scope', 'binding'] : ['requestId', 'cardId', 'scope', 'binding']);
    requireBridge(UUID.test(input.cardId) && (image ? ['FRONT', 'BACK'].includes(input.side) && SHA.test(input.manifestHash) : UUID.test(input.requestId)));
    if (input.scope?.actorKind === 'MACHINE') {
        keys(input.scope, ['actorKind', 'actorId', 'accessVersion', 'controlRevision', 'runId', 'runRevision', 'leaseFence', 'runControlRevision']);
        requireBridge(!image && !['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(action) && UUID.test(input.scope.actorId) && UUID.test(input.scope.runId)
            && ['accessVersion', 'controlRevision', 'runRevision', 'leaseFence', 'runControlRevision'].every(key => integer(input.scope[key])));
    } else {
        keys(input.scope, ['actorId', 'sessionHash', 'controlRevision']);
        requireBridge(UUID.test(input.scope.actorId) && SHA.test(input.scope.sessionHash) && integer(input.scope.controlRevision));
    }
    keys(input.binding, ['captureRevision', 'captureHash', 'claimFence', 'workflowRevision']);
    requireBridge(SHA.test(input.binding.captureHash) && ['captureRevision', 'claimFence', 'workflowRevision'].every(key => integer(input.binding[key])));
    return input;
}
function configuration(config) {
    bridgeOrigin(config.origin);
    requireBridge(config.key instanceof Uint8Array && config.key.length === 32 && SHA.test(config.configHash)
        && /^[a-f0-9]{40}$/.test(config.releaseSha) && typeof config.deploymentId === 'string'
        && /^[a-zA-Z0-9._-]{1,120}$/.test(config.deploymentId), 'WORKSPACE_SERVICE_CONFIGURATION_INVALID');
}
const mac = (key, value) => createHmac('sha256', key).update(value).digest();
export function signWorkspaceRequest(config, action, input, now = Date.now()) {
    configuration(config); payload(action, input);
    const claims = { purpose, audience: config.origin, deploymentId: config.deploymentId, releaseSha: config.releaseSha,
        configHash: config.configHash, issuedAt: now, expiresAt: now + 30_000, nonce: randomUUID(), action, inputHash: digest(canonical(input)) };
    const body = canonical({ claims, input });
    return { body, claims, signature: mac(config.key, body).toString('hex') };
}
export function verifyWorkspaceRequest(config, body, signature, now = Date.now()) {
    configuration(config);
    requireBridge(typeof body === 'string' && Buffer.byteLength(body) <= 16384 && SHA.test(signature ?? ''), 'WORKSPACE_SERVICE_REQUEST_INVALID');
    requireBridge(timingSafeEqual(mac(config.key, body), Buffer.from(signature, 'hex')), 'WORKSPACE_SERVICE_AUTHENTICATION_REQUIRED');
    let packet; try { packet = JSON.parse(body); } catch { requireBridge(false); }
    keys(packet, ['claims', 'input']); requireBridge(canonical(packet) === body);
    const c = packet.claims;
    keys(c, ['purpose', 'audience', 'deploymentId', 'releaseSha', 'configHash', 'issuedAt', 'expiresAt', 'nonce', 'action', 'inputHash']);
    requireBridge(c.purpose === purpose && c.audience === config.origin && c.deploymentId === config.deploymentId
        && c.releaseSha === config.releaseSha && c.configHash === config.configHash && UUID.test(c.nonce)
        && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt)
        && c.issuedAt <= now && c.expiresAt > now && c.expiresAt - c.issuedAt <= 30000
        && c.inputHash === digest(canonical(packet.input)), 'WORKSPACE_SERVICE_SCOPE_CHANGED');
    payload(c.action, packet.input); return packet;
}
export function workspaceResponseSignature(config, claims, bytes, contentType) {
    return mac(config.key, canonical({ purpose: `${purpose}-response`, nonce: claims.nonce,
        inputHash: claims.inputHash, contentType, byteCount: bytes.length, sha256: digest(bytes) })).toString('hex');
}

/** One admitted service and exact destination, no arbitrary URLs/redirects or
 * automatic retries. Request and response proofs are purpose separated from
 * grading, authentication, worker and public-media credentials. */
export function workspaceServiceClient(config, fetchImpl = fetch) {
    configuration(config);
    return { async call(action, input) {
        const signed = signWorkspaceRequest(config, action, input);
        const image = ['READ_ORIGINAL', 'READ_PREPARED'].includes(action);
        const response = await fetchImpl(`${config.origin}${WORKSPACE_SERVICE_PATH}`, { method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', 'x-atlas-workspace-signature': signed.signature }, body: signed.body,
            signal: AbortSignal.timeout(['PREPARE_SIDE', 'INITIALIZE_REPORT', 'REGISTER_MAP'].includes(action) ? 210000 : 60000) });
        requireBridge(response.status === 200, 'WORKSPACE_SERVICE_OUTCOME_UNCONFIRMED');
        const type = response.headers.get('content-type')?.split(';')[0], bytes = await boundedBytes(response, image ? 50 * 1024 * 1024 : 524288);
        requireBridge(image ? ['image/jpeg', 'image/png', 'image/webp'].includes(type) : type === 'application/json', 'WORKSPACE_SERVICE_RESPONSE_INVALID');
        const signature = response.headers.get('x-atlas-workspace-response');
        requireBridge(SHA.test(signature ?? '') && timingSafeEqual(Buffer.from(signature, 'hex'),
            Buffer.from(workspaceResponseSignature(config, signed.claims, bytes, type), 'hex')), 'WORKSPACE_SERVICE_RESPONSE_INVALID');
        if (image) return { bytes, contentType: type, byteCount: bytes.length, sha256: digest(bytes) };
        let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { requireBridge(false, 'WORKSPACE_SERVICE_RESPONSE_INVALID'); }
        return value;
    } };
}
