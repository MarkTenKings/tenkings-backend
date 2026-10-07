import { canonical } from '@atlas/service-bridge/protocol';
import { CAPTURE_TOOL_SCHEMAS, parseCaptureManifest, selectedCapturePreparation } from '@atlas/operator/capture-protocol';
import { preparationHash, preparationRequire } from './speedsterPreparationIntegrity';
import type { AtlasAuthorizedWorkspaceSource, AtlasWorkspaceSourceRequest } from './atlasWorkspaceSource';
import type { SpeedsterQuad } from '../ai-grader-v2/contracts';

type RecordValue = Record<string, unknown>;
type MachineSelection = Readonly<{ identity: RecordValue; cornerShape: 'SQUARE' | 'ROUNDED_3_18_MM';
    cornerShapeBasis?: 'PREPARATION_DEFAULT';
    boundaries: readonly Readonly<{ side: 'FRONT' | 'BACK'; corners: SpeedsterQuad; matColor: 'BLACK' | 'WHITE' | 'MAGENTA' }>[] }>;
export type AtlasWorkspaceMachineStep = Readonly<{ id: string; runId: string; revision: number; toolName: string;
    requestCanonical: string; requestHash: string; resultCanonical: string; resultHash: string; createdAt: Date | string }>;
export type AtlasWorkspaceMachineProof = Readonly<{
    run: Readonly<{ id: string; phase: string; state: string; workspaceCardId: string; specimenId: string | null;
        initializationId: string | null; evidenceHash: string; manifestCanonical: string; manifestHash: string;
        revision: number; leaseFence: number; controlRevision: number; controlState: string; executionMode: string }>;
    selectionStep: AtlasWorkspaceMachineStep; proposalSteps: readonly AtlasWorkspaceMachineStep[];
    deliveredAssets: readonly Readonly<{ assetId: string; side: string; sha256: string }>[];
    unresolvedAttempts: number;
    sourcePermit?: Readonly<{ requestId: string; cardId: string; runId: string; runRevision: number; runControlRevision: number;
        claimFence: number; captureHash: string; selectionStepId: string; selectionResultHash: string; mode: string; state: string }>;
    permitOperation?: Readonly<{ id: string; cardId: string; actorId: string; action: string; createdAt: Date | string;
        result: Readonly<{ action: string; claimFence: number; runId: string; runControlRevision: number;
            control: Readonly<{ mode: string; state: string }> }> }>;
}>;

function checked(value: string, hash: string): RecordValue {
    preparationRequire(typeof value === 'string' && Buffer.byteLength(value) <= 262144, 'WORKSPACE_MACHINE_PROOF_INVALID');
    let parsed: RecordValue;
    try { parsed = JSON.parse(value); } catch { throw new Error('WORKSPACE_MACHINE_PROOF_INVALID'); }
    preparationRequire(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && canonical(parsed) === value
        && preparationHash(parsed) === hash, 'WORKSPACE_MACHINE_PROOF_INVALID');
    return parsed;
}

/** Reuse the operator's closed proposal schemas and immutable selection logic.
 * The returned selection has MACHINE provenance and never writes a human
 * confirmation flag, identity override or invented worker outcome. */
export async function validateAtlasWorkspaceMachineSource(request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource) {
    const proof = authorized.machine;
    preparationRequire(proof && authorized.operation.action === 'MACHINE_SOURCE_ACTION', 'WORKSPACE_MACHINE_PROOF_REQUIRED');
    const { run, selectionStep, proposalSteps, deliveredAssets } = proof;
    const card = authorized.card, claim = card.claim;
    const intent = authorized.operation.result.payload.machine as RecordValue | undefined;
    const scope = request.scope;
    preparationRequire('actorKind' in scope && scope.actorKind === 'MACHINE' && scope.accessVersion === authorized.operation.result.accessVersion
        && scope.accessVersion === authorized.card.claim.accessVersion && scope.controlRevision === authorized.card.claim.controlRevision
        && intent && scope.runId === intent.runId && scope.runRevision === intent.runRevision
        && scope.leaseFence === intent.leaseFence && scope.runControlRevision === intent.runControlRevision, 'WORKSPACE_MACHINE_SCOPE_CHANGED');
    const permit = proof.sourcePermit;
    if (permit) preparationRequire(permit.requestId === request.requestId && permit.cardId === card.id && permit.runId === run.id
        && permit.runRevision === run.revision && permit.runControlRevision === intent?.runControlRevision
        && permit.claimFence === card.claimFence && permit.captureHash === card.captureHash
        && permit.selectionStepId === selectionStep.id && permit.selectionResultHash === selectionStep.resultHash
        && permit.mode === run.executionMode && ['ACTIVE', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(permit.state), 'WORKSPACE_MACHINE_PERMIT_CHANGED');
    preparationRequire(intent && Object.keys(intent).every(key => ['runId', 'runRevision', 'leaseFence', 'runControlRevision',
        'selectionStepId', 'selectionResultHash', 'permitOperationId'].includes(key))
        && run?.id === intent.runId && run.id === claim.runId && run.workspaceCardId === card.id
        && run.phase === 'CAPTURE_REVIEW' && run.state === 'PREPARATION_READY' && run.specimenId === null && run.initializationId === null
        && run.evidenceHash === card.captureHash && run.revision === intent.runRevision && run.leaseFence === intent.leaseFence
        && (permit ? run.controlRevision >= permit.runControlRevision
            && (['ACTIVE', 'UNKNOWN'].includes(permit.state) ? ['RUNNING', 'PAUSE_REQUESTED'].includes(run.controlState)
                : ['RUNNING', 'PAUSE_REQUESTED', 'PAUSED'].includes(run.controlState))
            : run.controlRevision === intent.runControlRevision && run.controlState === 'RUNNING')
        && ['CONTINUOUS', 'STEP'].includes(run.executionMode) && proof.unresolvedAttempts === 0
        && selectionStep.id === intent.selectionStepId && selectionStep.resultHash === intent.selectionResultHash
        && selectionStep.runId === run.id && selectionStep.revision === run.revision && selectionStep.toolName === 'submit_capture_preparation',
    'WORKSPACE_MACHINE_RUN_CHANGED');
    const manifest = parseCaptureManifest(checked(run.manifestCanonical, run.manifestHash));
    preparationRequire(manifest.runId === run.id && manifest.workspaceCardId === card.id
        && manifest.claimId === claim.id && manifest.claimFence === card.claimFence && manifest.captureRevision === card.captureRevision
        && manifest.evidenceHash === card.captureHash && manifest.workflowRevision === claim.workflowRevision,
    'WORKSPACE_MACHINE_CAPTURE_CHANGED');
    for (const side of ['FRONT', 'BACK'] as const) {
        const asset = manifest.assets.find(value => value.side === side), verified = authorized.originals[side].verification;
        preparationRequire(asset && ['sha256', 'byteCount', 'width', 'height', 'contentType'].every(key =>
            (asset as unknown as RecordValue)[key] === (verified as unknown as RecordValue)[key])
            && deliveredAssets.some(value => value.assetId === asset.assetId && value.sha256 === asset.sha256 && value.side === side),
        'WORKSPACE_MACHINE_EVIDENCE_UNDELIVERED');
    }
    if (run.executionMode === 'STEP') {
        const human = proof.permitOperation;
        preparationRequire(human && human.id === intent.permitOperationId && human.action === 'OPERATOR_CONTROL'
            && human.cardId === card.id && human.actorId === request.scope.actorId && human.result.action === 'STEP'
            && human.result.claimFence === card.claimFence && human.result.runId === run.id
            && human.result.runControlRevision === (permit?.runControlRevision ?? run.controlRevision) && human.result.control.mode === 'STEP'
            && human.result.control.state === 'RUNNING' && Number.isFinite(+new Date(human.createdAt))
            && +new Date(human.createdAt) >= +new Date(selectionStep.createdAt), 'WORKSPACE_MACHINE_STEP_PERMIT_REQUIRED');
    }
    const submitted = CAPTURE_TOOL_SCHEMAS.submit_capture_preparation.parse(checked(selectionStep.requestCanonical, selectionStep.requestHash));
    const output = checked(selectionStep.resultCanonical, selectionStep.resultHash), outputBinding = output.binding as RecordValue;
    preparationRequire(submitted.runId === run.id && submitted.evidenceHash === run.evidenceHash && submitted.manifestHash === run.manifestHash
        && submitted.expectedRevision + 1 === selectionStep.revision && outputBinding?.expectedRevision === selectionStep.revision
        && ['runId', 'evidenceHash', 'manifestHash'].every(key => outputBinding?.[key] === (submitted as RecordValue)[key])
        && proposalSteps.length <= 3 && new Set(proposalSteps.map(row => row.id)).size === proposalSteps.length,
    'WORKSPACE_MACHINE_SELECTION_CHANGED');
    const selection = await selectedCapturePreparation({ call: { name: 'submit_capture_preparation', args: submitted },
        run: { ...run, revision: selectionStep.revision - 1 }, manifest, card,
        tx: { staffOperatorStep: { findUnique: async ({ where }: { where: { id: string } }) => proposalSteps.find(row => row.id === where.id) ?? null } } },
    async (_data, refs) => {
        preparationRequire(refs.every((ref: Readonly<{ assetId: string; side: string; sha256: string }>) => manifest.assets.some(asset =>
            ref.assetId === asset.assetId && ref.side === asset.side && ref.sha256 === asset.sha256)
            && deliveredAssets.some(asset => ref.assetId === asset.assetId && ref.side === asset.side && ref.sha256 === asset.sha256)),
        'WORKSPACE_MACHINE_EVIDENCE_UNDELIVERED');
    }) as MachineSelection;
    preparationRequire(canonical(selection) === canonical(output.result), 'WORKSPACE_MACHINE_SELECTION_CHANGED');
    return { selection, provenance: { version: 'atlas-workspace-machine-source-v1', actor: 'MACHINE', runId: run.id,
        runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: permit?.runControlRevision ?? run.controlRevision,
        selectionStepId: selectionStep.id, selectionResultHash: selectionStep.resultHash,
        selectionHash: preparationHash(selection), manifestHash: run.manifestHash,
        ...(selection.cornerShapeBasis ? { cornerShapeBasis: selection.cornerShapeBasis } : {}),
        ...(run.executionMode === 'STEP' ? { permitOperationId: intent.permitOperationId } : {}) } };
}

export type AtlasWorkspaceValidatedMachine = Awaited<ReturnType<typeof validateAtlasWorkspaceMachineSource>>;
