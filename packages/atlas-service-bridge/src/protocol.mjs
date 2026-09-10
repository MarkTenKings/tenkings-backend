import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const BRIDGE_PATH = '/api/internal/atlas/bridge';
export const BRIDGE_PURPOSE = 'atlas-staff-grading-bridge-v1';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export function requireBridge(condition, code = 'BRIDGE_REQUEST_INVALID') {
    if (!condition) { const error = new Error(code); error.code = code; throw error; }
}
export function canonical(value) {
    return JSON.stringify(value, (_key, entry) => {
        requireBridge(typeof entry !== 'number' || Number.isFinite(entry));
        return entry && typeof entry === 'object' && !Array.isArray(entry)
            ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry;
    });
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export function keys(value, names) {
    requireBridge(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}
export function keyBytes(encoded) {
    requireBridge(typeof encoded === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(encoded), 'BRIDGE_CONFIGURATION_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    requireBridge(bytes.length === 32 && bytes.toString('base64') === encoded, 'BRIDGE_CONFIGURATION_INVALID');
    return bytes;
}
export function bridgeOrigin(value) {
    let url; try { url = new URL(value); } catch { requireBridge(false, 'BRIDGE_CONFIGURATION_INVALID'); }
    requireBridge(url.protocol === 'https:' && url.origin === value && !url.username && !url.password
        && /^[a-z0-9][a-z0-9.-]+$/.test(url.hostname), 'BRIDGE_CONFIGURATION_INVALID');
    return url.origin;
}
export function validatePayload(value) {
    if (value?.action === 'RUN_REVIEW') {
        keys(value, ['action', 'operationId']); requireBridge(UUID.test(value.operationId));
    } else if (value?.action === 'READ_EVIDENCE') {
        keys(value, ['action', 'side']); requireBridge(['FRONT', 'BACK'].includes(value.side));
    } else if (value?.action === 'READ_TRACE') {
        keys(value, ['action', 'findingId', 'analysisRevision']);
        requireBridge(typeof value.findingId === 'string' && value.findingId.length > 0 && value.findingId.length <= 180
            && Number.isSafeInteger(value.analysisRevision) && value.analysisRevision > 0);
    } else requireBridge(false);
    return value;
}
export function signRequest(config, scope, payload, now = Date.now()) {
    validatePayload(payload);
    const claims = { purpose: BRIDGE_PURPOSE, audience: config.origin, issuer: 'atlas-staff',
        deploymentId: config.deploymentId, releaseSha: config.releaseSha, controlRevision: scope.controlRevision,
        specimenId: scope.specimenId, actorId: scope.actorId, sessionHash: scope.sessionHash,
        assignmentFence: scope.assignmentFence, evidenceHash: scope.evidenceHash,
        issuedAt: now, expiresAt: now + 30_000, nonce: randomUUID(), payloadHash: digest(canonical(payload)) };
    const body = canonical({ claims, payload });
    return { body, signature: createHmac('sha256', config.key).update(body).digest('hex') };
}
export function verifyRequest(config, body, signature, now = Date.now()) {
    requireBridge(typeof body === 'string' && Buffer.byteLength(body) <= 16_384 && SHA.test(signature ?? ''));
    const expected = createHmac('sha256', config.key).update(body).digest();
    requireBridge(timingSafeEqual(expected, Buffer.from(signature, 'hex')), 'BRIDGE_AUTHENTICATION_REQUIRED');
    let packet; try { packet = JSON.parse(body); } catch { requireBridge(false); }
    keys(packet, ['claims', 'payload']); requireBridge(canonical(packet) === body);
    const c = packet.claims;
    keys(c, ['purpose', 'audience', 'issuer', 'deploymentId', 'releaseSha', 'controlRevision', 'specimenId', 'actorId',
        'sessionHash', 'assignmentFence', 'evidenceHash', 'issuedAt', 'expiresAt', 'nonce', 'payloadHash']);
    requireBridge(c.purpose === BRIDGE_PURPOSE && c.issuer === 'atlas-staff' && c.audience === config.origin
        && typeof c.deploymentId === 'string' && c.deploymentId.length <= 120 && /^[a-f0-9]{40}$/.test(c.releaseSha)
        && [c.controlRevision, c.assignmentFence].every(n => Number.isSafeInteger(n) && n > 0)
        && [c.specimenId, c.actorId, c.nonce].every(v => UUID.test(v))
        && [c.sessionHash, c.evidenceHash, c.payloadHash].every(v => SHA.test(v))
        && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt)
        && c.issuedAt <= now && c.expiresAt > now && c.expiresAt - c.issuedAt <= 30_000);
    validatePayload(packet.payload); requireBridge(digest(canonical(packet.payload)) === c.payloadHash);
    return packet;
}

export function parsePilotPolicy(value) {
    const workspace = value?.version === 'atlas-workspace-bridge-policy-v1';
    const cohortKey = workspace ? 'workspaceCardIds' : 'specimenIds', ids = value?.[cohortKey];
    keys(value, ['version', 'pilotId', cohortKey, 'expiresAt', 'maxOperationsPerCard', 'maxTotalMicroUsd',
        'maxCardMicroUsd', 'reservationPerOperationMicroUsd', 'maxWorkerCalls', 'deadlineMs']);
    requireBridge((workspace || value.version === 'atlas-grading-bridge-policy-v1') && UUID.test(value.pilotId)
        && Array.isArray(ids) && ids.length === 10
        && ids.every(id => UUID.test(id)) && new Set(ids).size === 10
        && typeof value.expiresAt === 'string' && new Date(value.expiresAt).toISOString() === value.expiresAt
        && Number.isSafeInteger(value.maxOperationsPerCard) && value.maxOperationsPerCard > 0 && value.maxOperationsPerCard <= 100
        && ['maxTotalMicroUsd', 'maxCardMicroUsd', 'reservationPerOperationMicroUsd'].every(k => Number.isSafeInteger(value[k]) && value[k] > 0 && value[k] <= 1e12)
        && value.reservationPerOperationMicroUsd <= value.maxCardMicroUsd && value.maxCardMicroUsd <= value.maxTotalMicroUsd
        && Number.isSafeInteger(value.maxWorkerCalls) && value.maxWorkerCalls >= 1 && value.maxWorkerCalls <= 4
        && Number.isSafeInteger(value.deadlineMs) && value.deadlineMs >= 1000 && value.deadlineMs <= 200_000,
    'BRIDGE_PILOT_POLICY_INVALID');
    return value;
}
