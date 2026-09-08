import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, digest, keys, keyBytes, bridgeOrigin, requireBridge as check, UUID, SHA } from './protocol.mjs';
import { boundedBytes } from './transport.mjs';

export const INTAKE_PATH = '/api/internal/atlas/intake';
export const INTAKE_PURPOSE = 'atlas-intake-v1';
const date = value => value instanceof Date && Number.isFinite(+value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function exactIntakeSource(source) {
    keys(source, ['sourceType', 'sourceId', 'sourceOwnerId']);
    check(['SPEEDSTER', 'LOCAL_FIXTURE'].includes(source.sourceType)
        && [source.sourceId, source.sourceOwnerId].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)), 'INTAKE_SOURCE_INVALID');
    return { ...source };
}
export function makeIntakeConfig({ mode, origin, deploymentId, releaseSha, key, gradingPolicyHash, otherKeyHashes, phoneAllowlistHash }) {
    bridgeOrigin(origin);
    const bytes = Buffer.isBuffer(key) ? Buffer.from(key) : keyBytes(key), clientKeyHash = digest(bytes);
    check(bytes.length === 32 && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(mode) && text(deploymentId, 120)
        && /^[a-f0-9]{40}$/.test(releaseSha) && sha(gradingPolicyHash)
        && Array.isArray(otherKeyHashes) && otherKeyHashes.length <= 16 && otherKeyHashes.every(sha)
        && (phoneAllowlistHash === undefined || sha(phoneAllowlistHash))
        && !otherKeyHashes.includes(clientKeyHash)
        && (mode === 'PRODUCTION' ? releaseSha !== '0'.repeat(40) : releaseSha === '0'.repeat(40)), 'INTAKE_CONFIGURATION_INVALID');
    const publicConfig = { purpose: INTAKE_PURPOSE, mode, origin, deploymentId, releaseSha, clientKeyHash, gradingPolicyHash,
        ...(phoneAllowlistHash === undefined ? {} : { phoneAllowlistHash }) };
    return Object.freeze({ ...publicConfig, key: bytes, configHash: digest(canonical(publicConfig)) });
}
function assertScope(scope, mode) {
    keys(scope, ['actorId', 'sessionHash', 'browserHash', 'accessVersion', 'controlRevision', 'staffOrigin',
        'deploymentId', 'releaseSha', 'staffConfigHash', 'operationsGrantId']);
    check([scope.actorId, scope.operationsGrantId].every(value => typeof value === 'string' && UUID.test(value))
        && [scope.sessionHash, scope.browserHash, scope.staffConfigHash].every(sha)
        && positive(scope.accessVersion) && positive(scope.controlRevision) && text(scope.deploymentId, 120)
        && /^[a-f0-9]{40}$/.test(scope.releaseSha), 'INTAKE_SCOPE_INVALID');
    if (mode !== 'LOCAL_FIXTURE' || scope.staffOrigin !== 'http://127.0.0.1:4318') bridgeOrigin(scope.staffOrigin);
}
export function signIntakeRequest(config, scope, source, now = Date.now(), nonce = randomUUID()) {
    assertScope(scope, config.mode); exactIntakeSource(source);
    const packet = { purpose: INTAKE_PURPOSE, audience: config.origin, bridgeConfigHash: config.configHash,
        scope, source, nonce, issuedAt: now, expiresAt: now + 30_000 };
    const body = canonical(packet);
    return { body, signature: createHmac('sha256', config.key).update(body).digest('hex') };
}
export function verifyIntakeRequest(config, body, signature, now = Date.now()) {
    check(typeof body === 'string' && Buffer.byteLength(body) <= 8192 && sha(signature), 'INTAKE_REQUEST_INVALID');
    check(timingSafeEqual(createHmac('sha256', config.key).update(body).digest(), Buffer.from(signature, 'hex')), 'INTAKE_AUTHENTICATION_REQUIRED');
    let packet; try { packet = JSON.parse(body); } catch { check(false, 'INTAKE_REQUEST_INVALID'); }
    keys(packet, ['purpose', 'audience', 'bridgeConfigHash', 'scope', 'source', 'nonce', 'issuedAt', 'expiresAt']);
    check(canonical(packet) === body && packet.purpose === INTAKE_PURPOSE && packet.audience === config.origin
        && packet.bridgeConfigHash === config.configHash && UUID.test(packet.nonce ?? '')
        && Number.isSafeInteger(packet.issuedAt) && Number.isSafeInteger(packet.expiresAt)
        && packet.issuedAt <= now && packet.expiresAt > now && packet.expiresAt > packet.issuedAt
        && packet.expiresAt - packet.issuedAt <= 30_000, 'INTAKE_REQUEST_EXPIRED');
    assertScope(packet.scope, config.mode); exactIntakeSource(packet.source);
    check(packet.source.sourceType === (config.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE'), 'INTAKE_SOURCE_INVALID');
    return packet;
}
function parseCanonical(body, expectedHash, limit) {
    check(typeof body === 'string' && Buffer.byteLength(body) <= limit && sha(expectedHash) && digest(body) === expectedHash, 'INTAKE_RECEIPT_INVALID');
    let value; try { value = JSON.parse(body); } catch { check(false, 'INTAKE_RECEIPT_INVALID'); }
    check(canonical(value) === body, 'INTAKE_RECEIPT_INVALID'); return value;
}
/** Stable source authority only: no timestamps or actor claims in this hash. */
export function validateIntakeReceipt(row, { source, gradingPolicyHash, bridgeConfigHash }) {
    exactIntakeSource(source);
    check(row && Object.keys(source).every(key => row[key] === source[key]) && text(row.sourceRevision, 80)
        && text(row.title, 200) && text(row.subtitle, 300) && row.gradingPolicyHash === gradingPolicyHash
        && row.bridgeConfigHash === bridgeConfigHash, 'INTAKE_RECEIPT_INVALID');
    const evidence = parseCanonical(row.evidenceCanonical, row.evidenceHash, 131_072);
    const admission = parseCanonical(row.admissionCanonical, row.admissionHash, 8192);
    check(evidence?.sourceId === source.sourceId && evidence.sourceOwnerId === source.sourceOwnerId
        && evidence.sourceRevision === row.sourceRevision, 'INTAKE_RECEIPT_INVALID');
    for (const view of ['sides', 'originals']) for (const side of ['FRONT', 'BACK']) {
        const d = evidence[view]?.[side];
        check(d && sha(d.sha256) && positive(d.byteCount) && d.byteCount <= 50 * 1024 * 1024
            && positive(d.width) && positive(d.height) && d.width <= 20_000 && d.height <= 20_000
            && text(d.sourceRef, 2048) && !/^(?:[a-z]+:)?\/\//i.test(d.sourceRef)
            && ['image/jpeg', 'image/png', 'image/webp', ...(source.sourceType === 'LOCAL_FIXTURE' ? ['image/svg+xml'] : [])].includes(d.contentType), 'INTAKE_EVIDENCE_REQUIRED');
    }
    keys(admission, ['version', 'source', 'sourceRevision', 'evidenceHash', 'gradingPolicyHash', 'bridgeConfigHash', 'preparation']);
    const p = admission.preparation;
    keys(p, ['preparationRelease', 'frontAuthorityHash', 'backAuthorityHash']);
    check(admission.version === 'atlas-source-admission-v1' && canonical(admission.source) === canonical(source)
        && admission.sourceRevision === row.sourceRevision && admission.evidenceHash === row.evidenceHash
        && admission.gradingPolicyHash === gradingPolicyHash && admission.bridgeConfigHash === bridgeConfigHash
        && p.preparationRelease && typeof p.preparationRelease === 'object' && !Array.isArray(p.preparationRelease)
        && Object.keys(p.preparationRelease).length > 0 && sha(p.frontAuthorityHash) && sha(p.backAuthorityHash), 'INTAKE_ADMISSION_REQUIRED');
    return row;
}
const summary = row => ({ receiptId: row.id, source: { sourceType: row.sourceType, sourceId: row.sourceId, sourceOwnerId: row.sourceOwnerId },
    title: row.title, subtitle: row.subtitle, sourceRevision: row.sourceRevision, expiresAt: row.expiresAt.toISOString() });

/** Private original-source adapter only. All ports are local metadata projections;
 * loadSource holds the actual exact owner/session row FOR SHARE through commit.
 * No worker, image decoder, provider, remote storage or public grading mutation. */
export class ScopedSourceIntake {
    constructor({ client, config, ports }) {
        const verified = makeIntakeConfig({ ...config, otherKeyHashes: [] });
        check(verified.configHash === config.configHash, 'INTAKE_CONFIGURATION_INVALID');
        check(typeof client?.$transaction === 'function' && ['loadSource', 'sourceEvidence', 'assertSourceAdmission',
            'sourceAdmission', 'sourceTitle', 'isStaffPhoneAllowed'].every(name => typeof ports?.[name] === 'function')
            && config?.purpose === INTAKE_PURPOSE && sha(config.configHash) && digest(config.key) === config.clientKeyHash, 'INTAKE_CONFIGURATION_INVALID');
        this.client = client; this.config = config; this.ports = ports;
    }
    async authorize(tx, packet, now) {
        const s = packet.scope, config = this.config;
        const [intake] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIntakeControl" WHERE id='active' FOR SHARE`;
        const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
        check(intake?.enabled === true && positive(intake.revision)
            && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'clientKeyHash', 'gradingPolicyHash'].every(key => intake[key] === config[key])
            && control?.enabled === true && control.mode === config.mode && control.gradingPolicyHash === config.gradingPolicyHash
            && control.revision === s.controlRevision && control.origin === s.staffOrigin && control.deploymentId === s.deploymentId
            && control.releaseSha === s.releaseSha && control.configHash === s.staffConfigHash, 'INTAKE_NOT_ENABLED');
        const [identity] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity" WHERE id=${s.actorId}::uuid FOR SHARE`;
        const [session] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSession" WHERE "tokenHash"=${s.sessionHash} FOR SHARE`;
        const [browser] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=${s.browserHash} FOR SHARE`;
        const grants = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperationsGrant" WHERE "identityId"=${s.actorId}::uuid FOR SHARE`;
        check(identity && identity.id === s.actorId && !identity.revokedAt && ['REVIEWER', 'OBSERVER'].includes(identity.role)
            && identity.accessVersion === s.accessVersion && this.ports.isStaffPhoneAllowed(identity.phoneHash) === true
            && session?.tokenHash === s.sessionHash && session.identityId === s.actorId && !session.revokedAt
            && session.accessVersion === s.accessVersion && session.browserHash === s.browserHash && session.controlRevision === control.revision
            && date(session.createdAt) && session.createdAt <= now && +now - +session.createdAt <= 300_000
            && date(session.expiresAt) && session.expiresAt > now && browser?.tokenHash === s.browserHash
            && browser.controlRevision === control.revision && date(browser.createdAt) && browser.createdAt <= session.createdAt
            && date(browser.expiresAt) && browser.expiresAt > now, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        const matches = grants.filter(g => g.identityId === identity.id && !g.revokedAt && g.accessVersion === identity.accessVersion
            && g.controlRevision === control.revision && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].every(key => g[key] === control[key])
            && sha(g.authorizationEvidenceHash) && date(g.createdAt) && g.createdAt <= now && date(g.expiresAt) && g.expiresAt > now);
        check(matches.length === 1 && matches[0].id === s.operationsGrantId, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        return { identity, control, session, browser, grant: matches[0] };
    }
    async receive(body, signature) {
        // Authenticate before opening a transaction, then recheck against DB time.
        verifyIntakeRequest(this.config, body, signature);
        return this.client.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const packet = verifyIntakeRequest(this.config, body, signature, +now);
            const authority = await this.authorize(tx, packet, now), exact = packet.source;
            const source = await this.ports.loadSource(tx, exact);
            check(source?.id === exact.sourceId && source.createdByUserId === exact.sourceOwnerId
                && source.workflowState === 'CAPTURED' && date(source.updatedAt), 'INTAKE_SOURCE_CHANGED');
            const sourceRevision = source.updatedAt.toISOString();
            await this.ports.assertSourceAdmission(source);
            const preparation = await this.ports.sourceAdmission(source);
            const title = await this.ports.sourceTitle(source);
            keys(title, ['title', 'subtitle']);
            const evidenceCanonical = canonical(await this.ports.sourceEvidence(source, sourceRevision)), evidenceHash = digest(evidenceCanonical);
            const admissionCanonical = canonical({ version: 'atlas-source-admission-v1', source: exact, sourceRevision, evidenceHash,
                gradingPolicyHash: this.config.gradingPolicyHash, bridgeConfigHash: this.config.configHash, preparation });
            const row = { id: packet.nonce, actorId: packet.scope.actorId, sessionHash: packet.scope.sessionHash,
                operationsGrantId: packet.scope.operationsGrantId, controlRevision: packet.scope.controlRevision,
                ...exact, sourceRevision, ...title, evidenceCanonical, evidenceHash, admissionCanonical, admissionHash: digest(admissionCanonical),
                gradingPolicyHash: this.config.gradingPolicyHash, bridgeConfigHash: this.config.configHash, createdAt: now,
                expiresAt: new Date(Math.min(+now + 300_000, +authority.session.createdAt + 300_000,
                    +authority.session.expiresAt, +authority.browser.expiresAt, +authority.grant.expiresAt)) };
            validateIntakeReceipt(row, { source: exact, gradingPolicyHash: this.config.gradingPolicyHash, bridgeConfigHash: this.config.configHash });
            check(row.expiresAt > now, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
            const [prior] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSourceAdmission" WHERE id=${row.id}::uuid FOR SHARE`;
            if (prior) check(['actorId', 'sessionHash', 'operationsGrantId', 'controlRevision', 'sourceType', 'sourceId', 'sourceOwnerId',
                'sourceRevision', 'title', 'subtitle', 'evidenceCanonical', 'evidenceHash', 'admissionCanonical', 'admissionHash', 'gradingPolicyHash', 'bridgeConfigHash']
                .every(key => prior[key] === row[key]) && date(prior.expiresAt) && prior.expiresAt > now, 'INTAKE_NONCE_CONFLICT');
            else await tx.$executeRaw`INSERT INTO atlas_staff."StaffSourceAdmission"
                (id,"actorId","sessionHash","operationsGrantId","controlRevision","sourceType","sourceId","sourceOwnerId",
                "sourceRevision",title,subtitle,"evidenceCanonical","evidenceHash","admissionCanonical","admissionHash",
                "gradingPolicyHash","bridgeConfigHash","createdAt","expiresAt") VALUES
                (${row.id}::uuid,${row.actorId}::uuid,${row.sessionHash},${row.operationsGrantId}::uuid,${row.controlRevision},
                ${row.sourceType},${row.sourceId},${row.sourceOwnerId},${row.sourceRevision},${row.title},${row.subtitle},
                ${row.evidenceCanonical},${row.evidenceHash},${row.admissionCanonical},${row.admissionHash},
                ${row.gradingPolicyHash},${row.bridgeConfigHash},(${row.createdAt}::timestamptz AT TIME ZONE 'UTC'),
                (${row.expiresAt}::timestamptz AT TIME ZONE 'UTC'))`;
            const [{ now: finishedAt }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            verifyIntakeRequest(this.config, body, signature, +finishedAt);
            await this.authorize(tx, packet, finishedAt);
            check((prior ?? row).expiresAt > finishedAt, 'INTAKE_RECEIPT_EXPIRED');
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            return summary(prior ?? row);
        }, { maxWait: 5000, timeout: 10_000 });
    }
}
export function intakeClient(config, fetchImpl = fetch) {
    bridgeOrigin(config.origin);
    return Object.freeze({ binding: Object.freeze({ bridgeConfigHash: config.configHash, gradingPolicyHash: config.gradingPolicyHash }),
        async call(scope, source) {
            const request = signIntakeRequest(config, scope, source);
            const response = await fetchImpl(`${config.origin}${INTAKE_PATH}`, { method: 'POST', redirect: 'error',
                headers: { 'content-type': 'application/json', 'x-atlas-intake-signature': request.signature }, body: request.body,
                signal: AbortSignal.timeout(15_000) });
            check(response.status === 200, 'INTAKE_OUTCOME_UNCONFIRMED');
            let result; try { result = JSON.parse((await boundedBytes(response, 4096)).toString('utf8')); }
            catch { check(false, 'INTAKE_RESPONSE_INVALID'); }
            keys(result, ['receiptId', 'source', 'title', 'subtitle', 'sourceRevision', 'expiresAt']);
            check(UUID.test(result.receiptId ?? '') && canonical(result.source) === canonical(source)
                && text(result.title, 200) && text(result.subtitle, 300) && text(result.sourceRevision, 80)
                && typeof result.expiresAt === 'string' && Number.isFinite(Date.parse(result.expiresAt)), 'INTAKE_RESPONSE_INVALID');
            return result;
        } });
}
