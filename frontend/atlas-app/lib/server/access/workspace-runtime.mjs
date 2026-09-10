import { keyBytes, bridgeOrigin } from '@atlas/service-bridge/protocol';
import { workspaceServiceClient } from '@atlas/service-bridge/workspace';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { canonical } from '../review-contract.mjs';
import { deny, hash, isBoundaryError } from '../policy.mjs';
import { StaffWorkspaceStore } from './workspace-store.mjs';
import { StaffWorkspaceIntake } from './workspace-intake.mjs';
import { StaffWorkspaceManual } from './workspace-manual.mjs';
import { StaffWorkspaceOperator, projectWorkspaceSourceActivity } from './workspace-operator.mjs';
import { attachWorkspaceDispatch } from './workspace-dispatch.mjs';

export function workspaceRuntimeSettings(env, staffConfig) {
    const disabled = { configHash: hash(canonical({ purpose: 'atlas-workspace-disabled-v1', staffConfigHash: staffConfig.configHash })), enabled: false };
    if (env.ATLAS_WORKSPACE_ENABLED !== 'true') return disabled;
    try {
        const origin = bridgeOrigin(env.ATLAS_WORKSPACE_SERVICE_ORIGIN), key = keyBytes(env.ATLAS_WORKSPACE_KEY);
        const uploadOrigin = bridgeOrigin(env.ATLAS_WORKSPACE_UPLOAD_ORIGIN);
        if (!/^[a-f0-9]{40}$/.test(env.ATLAS_WORKSPACE_SERVICE_RELEASE_SHA ?? '')
            || !/^[a-zA-Z0-9._-]{1,120}$/.test(env.ATLAS_WORKSPACE_SERVICE_DEPLOYMENT_ID ?? '')
            || [staffConfig.sessionKey, staffConfig.phoneKey, staffConfig.routerKey].filter(Boolean).some(value => key.equals(value)))
            deny(503, 'WORKSPACE_CONFIGURATION_INVALID');
        const admission = { purpose: 'atlas-workspace-service-v1', staffConfigHash: staffConfig.configHash,
            origin, uploadOrigin, serviceReleaseSha: env.ATLAS_WORKSPACE_SERVICE_RELEASE_SHA,
            serviceDeploymentId: env.ATLAS_WORKSPACE_SERVICE_DEPLOYMENT_ID, clientKeyHash: hash(key) };
        return { ...admission, key, enabled: true, configHash: hash(canonical(admission)) };
    } catch { deny(503, 'WORKSPACE_CONFIGURATION_INVALID'); }
}

function transportPorts(settings, staffConfig) {
    if (!settings.enabled) return {};
    const transport = workspaceServiceClient({ origin: settings.origin, key: settings.key, configHash: settings.configHash,
        releaseSha: staffConfig.releaseSha, deploymentId: staffConfig.deploymentId });
    const uploadRequest = ({ upload }) => ({ cardId: upload.cardId, uploadId: upload.id });
    return {
        dispatch: request => transport.call('EXECUTE_ASTRA', request),
        async claimSource(context, { card, claim }) {
            const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.enqueue_workspace_capture(
                ${card.id}::uuid,${context.identity.id}::uuid,${context.session.tokenHash},${canonical(claim)}) AS id`;
            if (!row?.id) deny(503, 'WORKSPACE_ASTRA_NOT_READY');
            return { runId: row.id };
        },
        storage: {
            async grant(value) {
                const grant = await transport.call('UPLOAD_GRANT', uploadRequest(value));
                if (new URL(grant.url).origin !== settings.uploadOrigin) deny(503, 'WORKSPACE_STORAGE_UNAVAILABLE');
                return grant;
            },
            verify: value => transport.call('VERIFY_UPLOAD', uploadRequest(value)),
            async read(value) { return (await transport.call('READ_ORIGINAL', uploadRequest(value))).bytes; },
        },
        source: { prepare: request => transport.call('PREPARE_SIDE', request),
            resolveMap: request => transport.call('RESOLVE_MAP', request), registerMap: request => transport.call('REGISTER_MAP', request),
            continueWithoutMap: request => transport.call('CONTINUE_WITHOUT_MAP', request),
            finalize: request => transport.call('INITIALIZE_REPORT', request),
            status: request => transport.call('READ_STATUS', request), readPrepared: request => transport.call('READ_PREPARED', request) },
    };
}
function retainedJson(row, textKey, hashKey) {
    const text = row?.[textKey];
    if (typeof text !== 'string' || hash(text) !== row[hashKey]) deny(503, 'WORKSPACE_REPORT_UNAVAILABLE');
    let value; try { value = JSON.parse(text); } catch { deny(503, 'WORKSPACE_REPORT_UNAVAILABLE'); }
    if (canonical(value) !== text) deny(503, 'WORKSPACE_REPORT_UNAVAILABLE'); return value;
}
function grade(row) {
    const source = retainedJson(row, 'sourceCanonical', 'sourceHash'), report = retainedJson(row, 'reportCanonical', 'reportHash');
    if (canonical(previewAtlasReport(source)) !== row.reportCanonical) deny(503, 'WORKSPACE_REPORT_UNAVAILABLE');
    return report.grade;
}
async function reportCard(context, card, review) {
    if (!card.specimenId) return card;
    const tx = context.databaseTx, reportContext = { ...context, tx };
    try { await review.assigned(reportContext, card.specimenId); }
    catch (error) {
        if (!isBoundaryError(error) || error.code !== 'CARD_NOT_FOUND') throw error;
        const workspace = { ...card.workspace, reportAccess: false }; delete workspace.comparison;
        return { ...card, workspace };
    }
    const specimen = await tx.staffSpecimen.findUnique({ where: { id: card.specimenId } });
    if (!specimen || specimen.sourceId !== card.source.sourceId || specimen.sourceOwnerId !== card.source.sourceOwnerId)
        deny(503, 'WORKSPACE_REPORT_UNAVAILABLE');
    const row = await tx.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: specimen.id, revision: specimen.draftRevision } } });
    const draft = review.revisionRecord(row);
    const publication = await tx.staffPublicReport.findUnique({ where: { specimenId: specimen.id } });
    const approval = publication ? await tx.staffReportApproval.findUnique({ where: { id: publication.currentApprovalId } }) : null;
    const approved = approval && approval.analysisRevision === specimen.analysisRevision && approval.reviewRevision === specimen.draftRevision
        && approval.evidenceHash === specimen.evidenceHash;
    const state = approved ? 'APPROVED' : draft.disposition === 'READY_FOR_HUMAN' ? 'HUMAN_REVIEW'
        : draft.disposition === 'NEEDS_EVIDENCE' ? 'NEEDS_ATTENTION' : 'IN_PROGRESS';
    const workspace = { ...card.workspace, reportAccess: true };
    if (specimen.analysisRevision > 0) {
        const [first] = await tx.staffAnalysisRevision.findMany({ where: { specimenId: specimen.id }, orderBy: { revision: 'asc' }, take: 1 });
        const last = await tx.staffAnalysisRevision.findUnique({ where: { specimenId_revision: { specimenId: specimen.id, revision: specimen.analysisRevision } } });
        const original = grade(first), current = grade(last);
        workspace.comparison = [['overall', 'Overall grade'], ...['centering', 'corners', 'edges', 'surface'].map(key => [key, key[0].toUpperCase() + key.slice(1)])]
            .map(([key, label]) => ({ id: key, label,
                machineValue: key === 'overall' ? original.overall : original.subgrades[key],
                humanValue: key === 'overall' ? current.overall : current.subgrades[key],
                recordedAt: last.createdAt.toISOString(), originalAnalysisRevision: first.revision, currentAnalysisRevision: last.revision }));
    }
    return { ...card, workspace, state, stage: approved ? 'FINISHING' : state === 'HUMAN_REVIEW' ? 'REVIEW' : card.stage };
}

/** Configuration is deliberately disabled until its exact private service and
 * independent controls are admitted. Missing preparation never hides saved
 * drafts or grants broad legacy database/storage access to this app. */
export function createWorkspaceRuntime({ auth, review, staffConfig, env, settings = workspaceRuntimeSettings(env, staffConfig), ports }) {
    const connected = ports ?? transportPorts(settings, staffConfig);
    const store = new StaffWorkspaceStore({ auth, configHash: settings.configHash });
    const sourceReady = context => Boolean(connected.source && context.policy.preparationEnabled);
    const readiness = context => ({
        photoStorage: { ready: Boolean(connected.storage && context.policy.intakeEnabled),
            message: connected.storage && context.policy.intakeEnabled ? 'New Front and Back photos can be saved.' : 'Photo intake is awaiting its private storage connection.' },
        preparation: { ready: sourceReady(context), message: sourceReady(context) ? 'Verified image preparation is available.' : 'Saved boundaries are retained while image preparation is unavailable.' },
        manualGrading: { ready: context.policy.claimsEnabled, message: context.policy.claimsEnabled ? 'A human grader can claim the first admitted card.' : 'New grading claims are not enabled.' },
        astra: { ready: Boolean(context.policy.astraEnabled && connected.claimSource),
            message: context.policy.astraEnabled && connected.claimSource ? 'Astra can claim the admitted queue.' : 'Astra is not running.' },
    });
    const intake = new StaffWorkspaceIntake({ store, storage: connected.storage, readiness,
        source: { reserve: ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }),
            async assertClaimable(context, claim) {
                if (claim.operator === 'ASTRA') {
                    if (!connected.claimSource) deny(503, 'WORKSPACE_ASTRA_NOT_READY');
                    return connected.claimSource(context, claim);
                }
                return null;
            } } });
    const manual = new StaffWorkspaceManual({ intake, source: connected.source, sourceReady });
    const baseProject = manual.project.bind(manual);
    manual.project = async (context, card) => {
        const result = await baseProject(context, await reportCard(context, card, review));
        if (!connected.claimSource) result.capabilities.astraClaim = false;
        return result;
    };
    intake.project = manual.project;
    const operator = new StaffWorkspaceOperator({ store, projectCard: manual.project });
    attachWorkspaceDispatch({ intake, operator, store, dispatch: connected.dispatch });
    const operatorActivity = operator.activity.bind(operator);
    operator.activity = async (staff, id) => {
        const machine = await operatorActivity(staff, id);
        const human = await store.transaction(staff, async context => {
            const [records, sourceRecords] = await Promise.all([context.tx.listOperations(id, ['MANUAL_ACTION', 'MANUAL_ACTION_RESULT']),
                context.tx.listOperations(id, ['MACHINE_SOURCE_ACTION', 'MACHINE_SOURCE_RESULT', 'MACHINE_REPORT_SUCCESSOR'])]);
            const summaries = { SAVE_IDENTITY: 'Saved card identity and corner shape.', SAVE_BOUNDARY: 'Saved the physical card boundary.',
                RESOLVE_MAP: 'Checked the original card map.', REGISTER_MAP: 'Requested card map registration.',
                CONTINUE_WITHOUT_MAP: 'Recorded the human decision to review without the failed card map.',
                SAVE_CENTERING: 'Confirmed the printed frame and calculated centering.', PREPARE_SIDE: 'Requested verified image preparation.',
                INITIALIZE_REPORT: 'Requested the original grading report.' };
            return [...projectWorkspaceSourceActivity(sourceRecords), ...records.map(row => ({ id: row.id, at: row.createdAt, actor: 'HUMAN', type: row.result.action,
                stage: row.result.action === 'SAVE_IDENTITY' ? 'IDENTITY' : row.result.action === 'SAVE_CENTERING' ? 'CENTERING'
                    : ['INITIALIZE_REPORT', 'RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(row.result.action) ? 'INSPECTION' : 'PREPARATION',
                summary: row.action === 'MANUAL_ACTION_RESULT' ? row.result.state === 'SUCCEEDED' ? 'The saved request completed.' : 'The saved request needs attention.' : summaries[row.result.action],
                status: row.result.phase === 'REQUESTED' ? 'REQUESTED' : row.result.state === 'FAILED' ? 'NEEDS_ATTENTION' : 'RECORDED', evidence: [] }))];
        });
        return { ...machine, activity: [...machine.activity, ...human].sort((a, b) => a.at.localeCompare(b.at)).slice(-100) };
    };
    return { intake, manual, operator, list: staff => intake.list(staff),
        async read(staff, id) {
            return store.transaction(staff, async context => ({ card: await manual.project(context, await intake.card(context, id)), readiness: readiness(context) }));
        } };
}
