import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonical, parsePilotPolicy, pilotDollarLimitsAllow } from '@atlas/service-bridge/protocol';
import { preparationHash, preparationRequire } from './speedsterPreparationIntegrity';
import type { AtlasAuthorizedWorkspaceSource, AtlasWorkspaceSourceAuthority, AtlasWorkspaceSourceRequest,
    AtlasWorkspaceGeometryLedger, AtlasWorkspaceGeometryResult } from './atlasWorkspaceSource';
import { validateAtlasWorkspaceMachineSource, type AtlasWorkspaceMachineProof, type AtlasWorkspaceMachineStep } from './atlasWorkspaceSourceMachine';

type Row = Record<string, any>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const instant = (value: unknown): value is Date => value instanceof Date && Number.isFinite(+value);
function check(condition: unknown, code = 'WORKSPACE_SOURCE_SCOPE_CHANGED'): asserts condition { preparationRequire(condition, code); }
export type AtlasWorkspaceSourceAuthorityConfig = Readonly<{
    mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; staffOrigin: string; staffDeploymentId: string; staffReleaseSha: string; staffConfigHash: string;
    configHash: string; sourceConfigHash: string; sourceDeploymentId: string; sourceReleaseSha: string; allowedPhoneHashes: readonly string[];
}>;

export function readAtlasWorkspaceCanonical(row: Row | null | undefined, fields: readonly string[], maximum = 524288): Row {
    check(row && typeof row.canonical === 'string' && Buffer.byteLength(row.canonical) <= maximum && sha.test(row.contentHash ?? ''), 'WORKSPACE_SOURCE_RECORD_INVALID');
    let value: Row; try { value = JSON.parse(row.canonical); } catch { throw new Error('WORKSPACE_SOURCE_RECORD_INVALID'); }
    check(value && typeof value === 'object' && !Array.isArray(value) && canonical(value) === row.canonical
        && preparationHash(value) === row.contentHash && fields.every(key => value[key] === row[key]), 'WORKSPACE_SOURCE_RECORD_INVALID');
    return value;
}
function checked(text: string, hash: string, maximum = 262144): Row {
    return readAtlasWorkspaceCanonical({ canonical: text, contentHash: hash }, [], maximum);
}
const cardFields = ['id', 'creatorId', 'cohortId', 'revision', 'state', 'stage', 'specimenId'];
const operationFields = ['id', 'actorId', 'operationId', 'cardId', 'action', 'inputHash'];
function semanticAuthority(value: AtlasAuthorizedWorkspaceSource) {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.card.revision; delete copy.card.updatedAt; delete copy.card.claim.mode;
    // A separately validated admission is the only allowed report-link change.
    // Its insertion and the specimen pointer are one original SQL transaction.
    if (copy.sourceAdmission) delete copy.card.specimenId;
    else if (copy.card.specimenId == null) delete copy.card.specimenId;
    delete copy.sourceAdmission;
    if (copy.machine) {
        delete copy.machine.sourcePermit;
        for (const key of ['controlRevision', 'controlState', 'executionMode', 'stepBudget', 'updatedAt', 'leaseOwner', 'leaseMode', 'leaseExpiresAt']) delete copy.machine.run[key];
    }
    return copy;
}

/** Only explicit private-host credentials are accepted. All source ownership
 * derives from the current workspace and immutable upload ledger. */
export function createAtlasWorkspaceSourceAuthority(client: PrismaClient, config: AtlasWorkspaceSourceAuthorityConfig) {
    check(config && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(config.mode) && [config.staffConfigHash, config.configHash, config.sourceConfigHash].every(hash => sha.test(hash))
        && [config.staffReleaseSha, config.sourceReleaseSha].every(hash => /^[a-f0-9]{40}$/.test(hash))
        && config.allowedPhoneHashes.length > 0 && config.allowedPhoneHashes.length <= 100
        && config.allowedPhoneHashes.every(hash => sha.test(hash)) && new Set(config.allowedPhoneHashes).size === config.allowedPhoneHashes.length,
    'WORKSPACE_SOURCE_CONFIGURATION_INVALID');
    const origin = new URL(config.staffOrigin);
    const localFixture = config.mode === 'LOCAL_FIXTURE';
    check((!localFixture || process.env.NODE_ENV !== 'production')
        && (origin.protocol === 'https:' || localFixture && config.staffOrigin === 'http://127.0.0.1:4318')
        && origin.origin === config.staffOrigin && !origin.username && !origin.password
        && [config.staffDeploymentId, config.sourceDeploymentId].every(value => /^[a-zA-Z0-9._-]{1,120}$/.test(value)),
    'WORKSPACE_SOURCE_CONFIGURATION_INVALID');
    const allowedPhones = new Set(config.allowedPhoneHashes);
    const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, tx?: Prisma.TransactionClient) => tx ? work(tx)
        : client.$transaction(work, { maxWait: 5000, timeout: 10000 });
    async function controls(tx: Prisma.TransactionClient) {
        await tx.$executeRaw`SELECT atlas_staff.lock_workspace_private_controls()`;
        const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const [staff] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffControl" WHERE id='active'`;
        const [workspace] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceControl" WHERE id='active'`;
        const [source] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active'`;
        check(instant(now) && staff?.enabled && staff.mode === config.mode && staff.origin === config.staffOrigin
            && staff.deploymentId === config.staffDeploymentId && staff.releaseSha === config.staffReleaseSha && staff.configHash === config.staffConfigHash
            && workspace?.enabled && workspace.mode === config.mode && workspace.releaseSha === config.staffReleaseSha
            && workspace.configHash === config.configHash && workspace.maxCards === 10 && instant(workspace.expiresAt) && workspace.expiresAt > now
            && source?.enabled && source.mode === config.mode && source.releaseSha === config.staffReleaseSha
            && source.configHash === config.configHash && source.sourceConfigHash === config.sourceConfigHash
            && source.sourceDeploymentId === config.sourceDeploymentId && source.sourceReleaseSha === config.sourceReleaseSha
            && source.cohortId === workspace.cohortId && uuid.test(source.pilotId ?? '') && instant(source.expiresAt) && source.expiresAt > now,
        'WORKSPACE_SOURCE_NOT_ENABLED');
        return { tx, now, staff, workspace, source };
    }
    async function card(tx: Prisma.TransactionClient, id: string, cohortId: string) {
        check(uuid.test(id ?? ''));
        const [row] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_card(${id}::uuid)`;
        const value = readAtlasWorkspaceCanonical(row, cardFields, 262144);
        check(value.cohortId === cohortId && uuid.test(value.creatorId ?? '') && value.source?.sourceType === 'SPEEDSTER'
            && value.source.sourceId === `atlas-${value.id}` && value.source.sourceOwnerId === `atlas-staff-${value.creatorId}`);
        return value;
    }
    async function original(tx: Prisma.TransactionClient, value: Row, side: 'FRONT' | 'BACK', plannedId?: string) {
        const pointer = value.sides?.[side], uploadId = plannedId ?? pointer?.uploadId;
        check(uuid.test(uploadId ?? ''), 'WORKSPACE_ORIGINAL_CHANGED');
        const [uploadRow] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${uploadId}::uuid`;
        const operation = readAtlasWorkspaceCanonical(uploadRow, operationFields), upload = operation.result?.upload;
        check(operation.action === 'upload-plan' && operation.cardId === value.id && upload?.id === uploadId && upload.cardId === value.id
            && upload.side === side && upload.sourceId === value.source.sourceId && upload.sourceOwnerId === value.source.sourceOwnerId,
        'WORKSPACE_ORIGINAL_CHANGED');
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[upload.contentType as string];
        check(extension && upload.objectRef === `ai-grader-v2/${value.source.sourceOwnerId}/${value.source.sourceId}/original/recapture-${upload.id}/${side.toLowerCase()}.${extension}`
            && sha.test(upload.sha256) && Number.isSafeInteger(upload.byteCount) && upload.byteCount > 0 && upload.byteCount <= 50 * 1024 * 1024,
        'WORKSPACE_ORIGINAL_CHANGED');
        if (plannedId || !pointer?.verificationId) return { upload, verification: null, operation };
        check(uuid.test(pointer.verificationId));
        const [verifiedRow] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${pointer.verificationId}::uuid`;
        const completion = readAtlasWorkspaceCanonical(verifiedRow, operationFields), verification = completion.result?.verification;
        check(completion.action === 'upload-complete' && completion.cardId === value.id && completion.result.uploadId === uploadId
            && ['objectRef', 'sha256', 'byteCount', 'contentType'].every(key => verification?.[key] === upload[key]), 'WORKSPACE_ORIGINAL_CHANGED');
        return { upload, verification, operation };
    }
    async function current(tx: Prisma.TransactionClient, request: Pick<AtlasWorkspaceSourceRequest, 'cardId' | 'scope' | 'binding'>,
        access: 'ACTION' | 'READ_PREPARED' = 'ACTION') {
        const context = await controls(tx), { now, staff, workspace } = context, scope = request.scope;
        check(scope && uuid.test(scope.actorId ?? '') && staff.revision === scope.controlRevision);
        const [identity] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_actor(${scope.actorId}::uuid,${'actorKind' in scope ? null : scope.sessionHash}::text)`;
        check(identity && !identity.revokedAt && (access === 'READ_PREPARED' ? ['REVIEWER', 'OBSERVER'].includes(identity.role) : identity.role === 'REVIEWER')
            && allowedPhones.has(identity.phoneHash) && (access !== 'READ_PREPARED' || !('actorKind' in scope)));
        let session: Row | undefined, browser: Row | undefined;
        if ('actorKind' in scope) check(scope.actorKind === 'MACHINE' && scope.accessVersion === identity.accessVersion && workspace.astraEnabled);
        else {
            check(sha.test(scope.sessionHash ?? ''));
            [session] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffSession" WHERE "tokenHash"=${scope.sessionHash}`;
            check(session?.identityId === scope.actorId && !session.revokedAt && session.accessVersion === identity.accessVersion
                && session.controlRevision === staff.revision && instant(session.createdAt) && session.createdAt <= now
                && instant(session.expiresAt) && session.expiresAt > now);
            [browser] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=${session.browserHash}`;
            check(browser?.controlRevision === staff.revision && instant(browser.createdAt) && browser.createdAt <= session.createdAt
                && instant(browser.expiresAt) && browser.expiresAt > now);
        }
        const value = await card(tx, request.cardId, workspace.cohortId), binding = request.binding;
        check(binding && value.captureRevision === binding.captureRevision && value.captureHash === binding.captureHash && value.claimFence === binding.claimFence);
        if (access === 'READ_PREPARED') check(value.revision === binding.workflowRevision);
        else check((value.revision === binding.workflowRevision || value.revision > binding.workflowRevision
            && canonical(value.workspace?.pending?.binding) === canonical(binding))
            && value.claim?.fence === value.claimFence && value.claim.captureHash === value.captureHash
            && value.claim.captureRevision === value.captureRevision && value.claim.actorId === identity.id
            && (value.claim.kind === 'ASTRA' ? 'actorKind' in scope : !('actorKind' in scope))
            && ['HUMAN', 'ASTRA'].includes(value.claim.kind) && ['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(value.state));
        if ('actorKind' in scope) check(value.claim.accessVersion === scope.accessVersion && value.claim.controlRevision === scope.controlRevision);
        const originals = {} as AtlasAuthorizedWorkspaceSource['originals'];
        for (const side of ['FRONT', 'BACK'] as const) {
            const entry = await original(tx, value, side); check(entry.verification, 'WORKSPACE_ORIGINAL_CHANGED');
            Object.assign(originals, { [side]: { upload: entry.upload, verification: entry.verification } });
        }
        check(preparationHash({ source: value.source, captureRevision: value.captureRevision,
            sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { uploadId: originals[side as 'FRONT'].upload.id,
                ...originals[side as 'FRONT'].verification }])) }) === value.captureHash, 'WORKSPACE_ORIGINAL_CHANGED');
        return { ...context, identity, session, browser, card: value, originals };
    }
    async function load(request: AtlasWorkspaceSourceRequest, tx?: Prisma.TransactionClient): Promise<AtlasAuthorizedWorkspaceSource> {
        return transaction(async database => {
            const context = await current(database, request), value = context.card;
            check(context.workspace.preparationEnabled && context.workspace.claimsEnabled
                && (value.claim.kind !== 'ASTRA' || context.workspace.astraEnabled), 'WORKSPACE_PREPARATION_NOT_ENABLED');
            check(uuid.test(request.requestId ?? '') && value.workspace?.pending?.requestId === request.requestId);
            const rows = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
                WHERE "cardId"=${request.cardId}::uuid AND "actorId"=${request.scope.actorId}::uuid
                AND action IN ('MANUAL_ACTION','MACHINE_SOURCE_ACTION')
                AND canonical::jsonb->'result'->>'requestId'=${request.requestId}`;
            check(rows.length === 1); const operation = readAtlasWorkspaceCanonical(rows[0], operationFields);
            check(operation.id === request.requestId && operation.actorId === request.scope.actorId && operation.cardId === value.id
                && operation.action === (value.claim.kind === 'ASTRA' ? 'MACHINE_SOURCE_ACTION' : 'MANUAL_ACTION')
                && operation.result?.requestId === request.requestId && operation.result.phase === 'REQUESTED'
                && ['PREPARE_SIDE', 'INITIALIZE_REPORT', 'RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(operation.result.action)
                && (value.claim.kind === 'HUMAN' || ['PREPARE_SIDE', 'INITIALIZE_REPORT'].includes(operation.result.action))
                && operation.result.action === value.workspace.pending.action
                && canonical(operation.result.binding) === canonical(request.binding)
                && canonical(value.workspace.pending.binding) === canonical(request.binding)
                && (operation.result.action !== 'PREPARE_SIDE' || ['FRONT', 'BACK'].includes(operation.result.payload?.side)
                    && operation.result.payload.side === value.workspace.pending.side), 'WORKSPACE_SOURCE_INTENT_CHANGED');
            let machine: AtlasWorkspaceMachineProof | undefined;
            if (value.claim.kind === 'ASTRA') {
                const intent = operation.result?.payload?.machine; check(intent && uuid.test(intent.runId ?? '') && uuid.test(intent.selectionStepId ?? ''));
                const [run] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_run(${intent.runId}::uuid)`;
                const [selected] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffOperatorStep" WHERE id=${intent.selectionStepId}::uuid`;
                check(run && selected); const selection = checked(selected.resultCanonical, selected.resultHash).result;
                const ids = [selection?.identityProposal?.stepId, ...((selection?.boundaries ?? []) as Row[]).map(value => value?.proposal?.stepId)].filter(Boolean);
                check(ids.length <= 3 && ids.every(id => uuid.test(id)));
                const proposalSteps = await database.$queryRaw<AtlasWorkspaceMachineStep[]>`SELECT * FROM atlas_staff."StaffOperatorStep"
                    WHERE id::text=ANY(${ids}::text[]) ORDER BY revision`;
                const images = await database.$queryRaw<Row[]>`SELECT i.canonical,i.hash FROM atlas_staff."StaffOperatorImage" i
                    JOIN atlas_staff."StaffOperatorImageDelivery" d ON d."imageId"=i."imageId"
                    WHERE i."runId"=${run.id}::uuid AND d."attemptId"=${selected.attemptId}::uuid ORDER BY i."imageId"`;
                const deliveredAssets = images.map(row => checked(row.canonical, row.hash).asset).map(asset => ({ assetId: asset.assetId, side: asset.side, sha256: asset.sha256 }));
                const [unresolved] = await database.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM atlas_staff."StaffOperatorAttempt"
                    WHERE "runId"=${run.id}::uuid AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')`;
                let permitOperation: AtlasWorkspaceMachineProof['permitOperation'];
                if (intent.permitOperationId !== undefined) {
                    check(uuid.test(intent.permitOperationId));
                    const [permit] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${intent.permitOperationId}::uuid`;
                    permitOperation = readAtlasWorkspaceCanonical(permit, operationFields) as AtlasWorkspaceMachineProof['permitOperation'];
                }
                const [sourcePermit] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_permit(${request.requestId}::uuid)`;
                machine = { run: run as AtlasWorkspaceMachineProof['run'], selectionStep: selected as AtlasWorkspaceMachineStep,
                    proposalSteps, deliveredAssets, unresolvedAttempts: Number(unresolved.count), ...(permitOperation ? { permitOperation } : {}),
                    ...(sourcePermit ? { sourcePermit: sourcePermit as AtlasWorkspaceMachineProof['sourcePermit'] } : {}) };
            }
            let sourceAdmission: AtlasAuthorizedWorkspaceSource['sourceAdmission'];
            if (value.specimenId != null) {
                check(operation.result.action === 'INITIALIZE_REPORT' && value.specimenId === value.id, 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
                const [admission] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission"
                    WHERE "requestId"=${request.requestId}::uuid`;
                check(admission && admission.requestId === request.requestId && admission.cardId === value.id && admission.specimenId === value.id
                    && admission.sourceType === value.source.sourceType && admission.sourceId === value.source.sourceId
                    && admission.sourceOwnerId === value.source.sourceOwnerId && admission.sourceConfigHash === config.sourceConfigHash
                    && admission.actorId === request.scope.actorId && admission.accessVersion === context.identity.accessVersion
                    && admission.actorKind === (value.claim.kind === 'ASTRA' ? 'MACHINE' : 'HUMAN')
                    && admission.sessionHash === ('actorKind' in request.scope ? null : request.scope.sessionHash), 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
                const proof = checked(admission.admissionCanonical, admission.admissionHash, 16384);
                check(proof.version === 'atlas-workspace-source-admission-v1' && proof.requestId === request.requestId
                    && proof.workspaceCardId === value.id && proof.actorKind === admission.actorKind
                    && proof.captureHash === request.binding.captureHash && proof.claimFence === request.binding.claimFence
                    && ['sourceRevision', 'sourceHash', 'evidenceHash', 'sourceConfigHash'].every(key => proof[key] === admission[key]),
                'WORKSPACE_SOURCE_ADMISSION_CHANGED');
                sourceAdmission = { requestId: admission.requestId, cardId: admission.cardId, specimenId: admission.specimenId,
                    sourceId: admission.sourceId, sourceOwnerId: admission.sourceOwnerId, actorKind: admission.actorKind,
                    actorId: admission.actorId, captureHash: proof.captureHash, claimFence: proof.claimFence };
            }
            return { card: value, originals: context.originals, operation, ...(machine ? { machine } : {}),
                ...(sourceAdmission ? { sourceAdmission } : {}) } as AtlasAuthorizedWorkspaceSource;
        }, tx);
    }
    const authority: AtlasWorkspaceSourceAuthority = { load,
        recheck: async (request, authorized, tx) => {
            const actual = await load(request, tx as Prisma.TransactionClient | undefined);
            if (actual.machine) await validateAtlasWorkspaceMachineSource(request, actual);
            check(preparationHash(semanticAuthority(actual)) === preparationHash(semanticAuthority(authorized)), 'WORKSPACE_SOURCE_SCOPE_CHANGED');
        } };
    return { ...authority, controls, current, loadInTransaction: load,
        async loadUpload(input: Readonly<{ cardId: string; uploadId: string }>) {
            check(input && Object.keys(input).sort().join(',') === 'cardId,uploadId' && uuid.test(input.uploadId ?? ''));
            return transaction(async tx => {
                const context = await controls(tx), value = await card(tx, input.cardId, context.workspace.cohortId);
                const [row] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${input.uploadId}::uuid`;
                const operation = readAtlasWorkspaceCanonical(row, operationFields), side = operation.result?.upload?.side;
                check(['FRONT', 'BACK'].includes(side)); const entry = await original(tx, value, side, input.uploadId);
                const [identity] = await tx.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_actor(${entry.operation.actorId}::uuid,NULL)`;
                check(identity && !identity.revokedAt && identity.role === 'REVIEWER' && allowedPhones.has(identity.phoneHash));
                const verification = value.sides?.[side]?.uploadId === input.uploadId && value.sides?.[side]?.verificationId
                    ? (await original(tx, value, side)).verification : null;
                return { ...context, card: value, upload: entry.upload, verification, operation: entry.operation };
            });
        },
        loadCard: (request: Pick<AtlasWorkspaceSourceRequest, 'cardId' | 'scope' | 'binding'>) => transaction(tx => current(tx, request)),
        loadPrepared: (request: Pick<AtlasWorkspaceSourceRequest, 'cardId' | 'scope' | 'binding'>) => transaction(tx => current(tx, request, 'READ_PREPARED')),
    };
}

export type SourcePurpose = 'PHYSICAL_GEOMETRY' | 'PREPARATION' | 'MAP_REGISTRATION' | 'INITIALIZE_REPORT';
type SourceLedgerBinding = Readonly<{ requestId: string; cardId: string; purpose: SourcePurpose; side: 'FRONT' | 'BACK' | 'PAIR';
    binding: Record<string, unknown>; request: Record<string, unknown>; gradingExecutionId?: string }>;
export type AtlasWorkspaceSourceLedger = ReturnType<typeof createAtlasWorkspaceSourceLedger>;

/** Immutable request/hold, one dispatch, retained unknown result. This ledger
 * never assigns zero actual cost or releases another service's reservation. */
export function createAtlasWorkspaceSourceLedger(client: PrismaClient, authority: ReturnType<typeof createAtlasWorkspaceSourceAuthority>, request: AtlasWorkspaceSourceRequest) {
    const tx = <T>(work: (database: Prisma.TransactionClient) => Promise<T>, existing?: Prisma.TransactionClient) =>
        existing ? work(existing) : client.$transaction(work, { maxWait: 5000, timeout: 10000 });
    const read = async (database: Prisma.TransactionClient, input: SourceLedgerBinding) => {
        const [row] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceSourceOperation"
            WHERE "requestId"=${input.requestId}::uuid AND purpose=${input.purpose} AND side=${input.side} FOR SHARE`;
        if (!row) return null;
        const bound = checked(row.bindingCanonical, row.bindingHash, 65536), body = { binding: input.binding, request: input.request };
        check(row.cardId === input.cardId && bound.captureHash === request.binding.captureHash
            && bound.captureRevision === request.binding.captureRevision && bound.claimFence === request.binding.claimFence
            && row.requestCanonical === canonical(body) && row.requestHash === preparationHash(body), 'WORKSPACE_SOURCE_REQUEST_CHANGED');
        const [intentRow] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${input.requestId}::uuid`;
        const intent = readAtlasWorkspaceCanonical(intentRow, operationFields);
        check(intent.cardId === input.cardId && canonical(intent.result.binding) === row.bindingCanonical, 'WORKSPACE_SOURCE_REQUEST_CHANGED');
        if (row.resultCanonical !== null) row.result = checked(row.resultCanonical, row.resultHash, 524288);
        return row;
    };
    return {
        read: (input: SourceLedgerBinding) => tx(async database => { await authority.loadInTransaction(request, database); return read(database, input); }),
        claim: (input: SourceLedgerBinding) => tx(async database => {
            const context = await authority.current(database, request), { source, workspace, now } = context;
            const authorized = await authority.loadInTransaction(request, database); await authority.recheck(request, authorized, database);
            check(input.requestId === request.requestId && input.cardId === request.cardId && ['FRONT', 'BACK', 'PAIR'].includes(input.side));
            const prior = await read(database, input); if (prior) return { claimed: false, row: prior };
            let permit: Row | undefined;
            if (authorized.machine) {
                [permit] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff.claim_workspace_source_permit(${request.requestId}::uuid)`;
                check(permit?.state === 'ACTIVE' && permit.runId === authorized.machine.run.id, 'WORKSPACE_MACHINE_PERMIT_CHANGED');
            }
            const [bridge] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active'`;
            const budget = parsePilotPolicy(checked(bridge?.policyCanonical, bridge?.policyHash));
            check(bridge?.enabled && bridge.mode === source.mode && bridge.releaseSha === source.releaseSha
                && budget.version === 'atlas-workspace-bridge-policy-v1' && budget.pilotId === source.pilotId
                && budget.workspaceCardIds.includes(request.cardId) && +new Date(budget.expiresAt) > +now
                && workspace.preparationEnabled, 'WORKSPACE_SOURCE_PILOT_NOT_ACTIVE');
            let reserve: bigint;
            if (input.purpose === 'INITIALIZE_REPORT') {
                check(input.side === 'PAIR', 'WORKSPACE_INITIALIZATION_RESERVATION_REQUIRED'); reserve = 0n;
            } else {
                check(['PHYSICAL_GEOMETRY', 'PREPARATION', 'MAP_REGISTRATION'].includes(input.purpose) && input.side !== 'PAIR');
                if (input.purpose === 'MAP_REGISTRATION') check(authorized.operation.result.action === 'REGISTER_MAP'
                    || authorized.card.claim.kind === 'ASTRA' && authorized.operation.result.action === 'INITIALIZE_REPORT', 'WORKSPACE_MAP_REGISTRATION_INTENT_REQUIRED');
                reserve = BigInt(input.purpose === 'PHYSICAL_GEOMETRY' ? source.physicalReserveMicroUsd
                    : input.purpose === 'MAP_REGISTRATION' ? source.registrationReserveMicroUsd : source.preparationReserveMicroUsd);
                check(reserve > 0n && (budget.budgetEnforcement === 'ACCOUNTING_ONLY'
                    || reserve <= BigInt(budget.maxCardMicroUsd)), 'WORKSPACE_SOURCE_RESERVATION_INVALID');
            }
            const [usage] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${budget.pilotId}::uuid,${input.cardId}::uuid)`;
            check(usage && pilotDollarLimitsAllow(budget, { total: usage.total, card: usage.card, overrun: usage.overrun }, reserve),
                'WORKSPACE_SOURCE_BUDGET_EXHAUSTED');
            const id = randomUUID(), bindingCanonical = canonical(request.binding), requestCanonical = canonical({ binding: input.binding, request: input.request });
            check(Buffer.byteLength(bindingCanonical) <= 262144 && Buffer.byteLength(requestCanonical) <= 262144);
            await database.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceSourceOperation"
                (id,"requestId","cardId","cohortId","pilotId",purpose,side,"sourceConfigHash","sourceControlRevision","bindingCanonical","bindingHash","requestCanonical","requestHash",
                "runId","runControlRevision",state,"reservedMicroUsd","createdAt") VALUES
                (${id}::uuid,${input.requestId}::uuid,${input.cardId}::uuid,${workspace.cohortId}::uuid,${budget.pilotId}::uuid,${input.purpose},${input.side},
                ${source.sourceConfigHash},${source.revision},${bindingCanonical},${preparationHash(request.binding)},${requestCanonical},${preparationHash({ binding: input.binding, request: input.request })},
                ${permit?.runId ?? null}::uuid,${permit?.runControlRevision ?? null},'RESERVED',${reserve},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
            return { claimed: true, row: (await read(database, input))! };
        }),
        dispatch: (input: SourceLedgerBinding, id: string, gradingExecutionId?: string, existingTx?: Prisma.TransactionClient) => tx(async database => {
            const authorized = await authority.loadInTransaction(request, database); await authority.recheck(request, authorized, database);
            const row = await read(database, input); check(row?.id === id && row.state === 'RESERVED', 'WORKSPACE_SOURCE_ALREADY_DISPATCHED');
            if (input.purpose === 'INITIALIZE_REPORT') check(uuid.test(gradingExecutionId ?? ''), 'WORKSPACE_INITIALIZATION_RESERVATION_REQUIRED');
            else check(gradingExecutionId === undefined);
            const changed = await database.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceOperation" SET state='DISPATCHED',"gradingExecutionId"=${gradingExecutionId ?? null}::uuid,
                "dispatchedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
                WHERE id=${id}::uuid AND state='RESERVED'`;
            check(changed === 1, 'WORKSPACE_SOURCE_ALREADY_DISPATCHED');
        }, existingTx),
        complete: (input: SourceLedgerBinding, id: string, result: Readonly<{ state: 'SUCCEEDED' | 'UNKNOWN' | 'FAILED'; [key: string]: unknown }>) => tx(async database => {
            // Late original worker results stay private and retained even after
            // revocation. Reauthorization is required before source adoption.
            await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const row = await read(database, input); check(row?.id === id, 'WORKSPACE_SOURCE_REQUEST_CHANGED');
            const text = canonical(result), hash = preparationHash(result); check(Buffer.byteLength(text) <= 524288);
            if (row.resultCanonical !== null) { check(row.resultCanonical === text && row.resultHash === hash, 'WORKSPACE_SOURCE_RESULT_CHANGED'); return row; }
            check(['RESERVED', 'DISPATCHED'].includes(row.state));
            check(result.state === 'FAILED' || row.state === 'DISPATCHED', 'WORKSPACE_SOURCE_DISPATCH_REQUIRED');
            const failureCode = result.state === 'SUCCEEDED' ? null : result.failureCode ?? 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED';
            check(failureCode === null || typeof failureCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(failureCode));
            const changed = await database.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceOperation"
                SET state=${result.state},"resultCanonical"=${text},"resultHash"=${hash},"failureCode"=${failureCode},"finishedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
                WHERE id=${id}::uuid AND "resultCanonical" IS NULL`;
            check(changed === 1); return (await read(database, input))!;
        }),
        finishPermit: (outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN') => tx(async database => {
            const [permit] = await database.$queryRaw<Row[]>`SELECT * FROM atlas_staff.lock_workspace_private_permit(${request.requestId}::uuid)`;
            if (permit) await database.$executeRaw`SELECT atlas_staff.finish_workspace_source_permit(${request.requestId}::uuid,${outcome})`;
        }),
    };
}

export function atlasWorkspacePhysicalLedger(ledger: AtlasWorkspaceSourceLedger): AtlasWorkspaceGeometryLedger {
    const input = (binding: Parameters<AtlasWorkspaceGeometryLedger['read']>[0]): SourceLedgerBinding => ({
        requestId: binding.requestId, cardId: binding.cardId, purpose: 'PHYSICAL_GEOMETRY', side: binding.side,
        binding: { ...binding }, request: { sourceHash: binding.sourceHash, matColor: binding.matColor } });
    const projection = (row: Row): AtlasWorkspaceGeometryResult => row.result ?? { state: row.state === 'RESERVED' ? 'PENDING' : 'UNKNOWN' };
    return { read: async binding => { const row = await ledger.read(input(binding)); return row ? projection(row) : null; },
        claim: async binding => { const value = input(binding), claim = await ledger.claim(value);
            if (claim.claimed) await ledger.dispatch(value, claim.row.id);
            return { claimed: claim.claimed, claimId: claim.row.id, result: projection(claim.row) }; },
        complete: async (binding, id, result) => {
            check(result.state !== 'PENDING'); return projection(await ledger.complete(input(binding), id, result as never));
        } };
}
