import { exactIntakeSource, validateIntakeReceipt } from '@atlas/service-bridge/intake';
import { keys, SHA, UUID, parsePilotPolicy } from '@atlas/service-bridge/protocol';
import { deny, hash, identifier } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
const check = (condition, code = 'INTAKE_SOURCE_CHANGED') => { if (!condition) deny(409, code); };
const date = value => value instanceof Date && Number.isFinite(+value);

/** This definer locks the fresh receipt AND the actual public source metadata.
 * The operations credential receives no public table access or receipt INSERT. */
export function receiptSourceValidation({ gradingPolicyHash, bridgeConfigHash }) {
    check(SHA.test(gradingPolicyHash ?? '') && SHA.test(bridgeConfigHash ?? ''), 'INTAKE_NOT_CONFIGURED');
    return Object.freeze({ async inspect(context, input) {
        const source = exactIntakeSource(input), { tx, identity, session, operationsGrantId, control } = context;
        check(context.actorKind === 'HUMAN' && context.capability === 'OPERATIONS' && UUID.test(identity?.id ?? '')
            && SHA.test(session?.tokenHash ?? '') && UUID.test(operationsGrantId ?? '') && control?.enabled === true
            && control.gradingPolicyHash === gradingPolicyHash
            && source.sourceType === (control.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE'), 'INTAKE_NOT_ENABLED');
        const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_source_admissions(${identity.id}::uuid,${session.tokenHash},
            ${operationsGrantId}::uuid,${source.sourceType},${source.sourceId},${source.sourceOwnerId})`;
        const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        check(rows.length === 1, 'INTAKE_PREFLIGHT_REQUIRED');
        const row = rows[0];
        check(row.actorId === identity.id && row.sessionHash === session.tokenHash && row.operationsGrantId === operationsGrantId
            && row.controlRevision === control.revision && date(now) && date(row.createdAt) && row.createdAt <= now
            && date(row.expiresAt) && row.expiresAt > now && +row.expiresAt - +row.createdAt <= 300_000, 'INTAKE_RECEIPT_EXPIRED');
        validateIntakeReceipt(row, { source, gradingPolicyHash, bridgeConfigHash });
        return { sourceType: row.sourceType, sourceId: row.sourceId, sourceOwnerId: row.sourceOwnerId,
            title: row.title, subtitle: row.subtitle, sourceRevision: row.sourceRevision,
            evidenceCanonical: row.evidenceCanonical, evidenceHash: row.evidenceHash,
            admissionCanonical: row.admissionCanonical, admissionHash: row.admissionHash };
    } });
}

/** Add preflight to the existing operations API. Authority transactions only read
 * staff metadata here; external intake calls begin after those transactions end.
 * The final operations transaction reauthenticates and validates locked receipts.
 * The HTTP response never trusts the bridge summary as admission authority. */
export function withSourceIntake({ operations, admin, intake }) {
    check(operations?.admin === admin && typeof admin?.transaction === 'function' && typeof intake?.call === 'function'
        && SHA.test(intake.binding?.gradingPolicyHash ?? '') && SHA.test(intake.binding?.bridgeConfigHash ?? ''), 'INTAKE_NOT_CONFIGURED');
    // Keep this tiny identity derivation in sync with StaffOperations.mutation.
    // Cross-interface tests write the audit through that method and recover here.
    // A lost reply must remain recoverable after source admission has changed.
    const replay = (staff, event, subjectId, input) => {
        identifier(input.operationId);
        const inputHash = hash(canonical(input));
        return admin.transaction(staff, async ({ tx, identity, actorKind, capability }) => {
            check(actorKind === 'HUMAN' && capability === 'OPERATIONS', 'FRESH_HUMAN_OPERATIONS_REQUIRED');
            const bytes = hash(canonical({ actorId: identity.id, operationId: input.operationId }));
            const id = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
            const prior = await tx.staffAudit.findUnique({ where: { id } });
            if (!prior) return { found: false };
            let details; try { details = JSON.parse(prior.details); } catch { check(false, 'OPERATIONS_REQUEST_CONFLICT'); }
            check(prior.actorId === identity.id && prior.event === event && prior.subjectId === subjectId
                && details?.inputHash === inputHash, 'OPERATIONS_REQUEST_CONFLICT');
            return { found: true, receipt: details.receipt };
        });
    };
    const preflight = async (staff, load) => {
        const request = await admin.transaction(staff, async context => {
            const { identity, session, control } = context;
            check(context.actorKind === 'HUMAN' && context.capability === 'OPERATIONS'
                && control.gradingPolicyHash === intake.binding.gradingPolicyHash, 'INTAKE_NOT_ENABLED');
            const sources = await load(context);
            check(sources.length > 0 && sources.length <= 10, 'INTAKE_SOURCE_INVALID');
            return { scope: { actorId: identity.id, sessionHash: session.tokenHash, browserHash: session.browserHash,
                accessVersion: identity.accessVersion, controlRevision: control.revision, staffOrigin: control.origin,
                deploymentId: control.deploymentId, releaseSha: control.releaseSha, staffConfigHash: control.configHash,
                operationsGrantId: context.operationsGrantId }, sources: sources.map(exactIntakeSource) };
        });
        for (const source of request.sources) await intake.call(request.scope, source);
    };
    const overrides = {
        async previewIntake(staff, source) {
            exactIntakeSource(source);
            await preflight(staff, async () => [source]);
            return operations.previewIntake(staff, source);
        },
        async admitIntake(staff, input) {
            keys(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'source', 'sourceBindingHash']);
            exactIntakeSource(input.source);
            const retained = await replay(staff, 'SPECIMEN_INTAKE_ADMITTED', hash(canonical(input.source)), input);
            if (retained.found) return retained.receipt;
            await preflight(staff, async () => [input.source]);
            return operations.admitIntake(staff, input);
        },
        async preparePilot(staff, input) {
            keys(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'policy', 'specimens']);
            const policy = parsePilotPolicy(input.policy);
            check(Array.isArray(input.specimens) && input.specimens.length === 10, 'INTAKE_SOURCE_INVALID');
            const retained = await replay(staff, 'TEN_CARD_PILOT_PREPARED', policy.pilotId, input);
            if (retained.found) return retained.receipt;
            await preflight(staff, async ({ tx }) => {
                const rows = await tx.staffSpecimen.findMany({ where: { id: { in: policy.specimenIds } },
                    select: { id: true, sourceType: true, sourceId: true, sourceOwnerId: true } });
                check(rows.length === 10 && new Set(rows.map(row => row.id)).size === 10
                    && rows.every(row => policy.specimenIds.includes(row.id)), 'INTAKE_SOURCE_CHANGED');
                return rows.map(({ sourceType, sourceId, sourceOwnerId }) => ({ sourceType, sourceId, sourceOwnerId }));
            });
            return operations.preparePilot(staff, input);
        },
    };
    // Bind untouched class methods to their original receiver, including methods
    // whose internal calls depend on the original authority/validation ports.
    return new Proxy(operations, { get(target, key) {
        if (Object.hasOwn(overrides, key)) return overrides[key];
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
}
