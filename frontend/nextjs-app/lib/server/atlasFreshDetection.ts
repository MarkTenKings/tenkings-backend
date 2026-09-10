import type { Prisma } from '@prisma/client';
import { requireBridge } from '@atlas/service-bridge/protocol';
import type { SpeedsterDetectionCheckpointLookup, SpeedsterReviewActionDependencies, SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';
import { speedsterDetectionOperationId } from './speedsterDetectionSideCheckpoint';

export type AtlasFreshDetectionSource = Pick<SpeedsterReviewActionSession, 'id' | 'createdByUserId' | 'updatedAt'>;
export type AtlasFreshDetectionTransaction = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;
type CheckpointLoader = NonNullable<SpeedsterReviewActionDependencies['loadDetectionSideCheckpoints']>;
const SHA = /^[a-f0-9]{64}$/;
const sourceText = (value: unknown): value is string => typeof value === 'string'
    && value.length > 0 && value.length <= 128 && !/[\x00-\x20\x7f]/.test(value);

function exactSource(source: AtlasFreshDetectionSource) {
    requireBridge(source && sourceText(source.id) && sourceText(source.createdByUserId)
        && source.updatedAt instanceof Date && Number.isFinite(+source.updatedAt), 'SOURCE_REVISION_CHANGED');
    return Object.freeze({ sessionId: source.id, createdByUserId: source.createdByUserId, sessionRevision: source.updatedAt.toISOString() });
}

/** Call inside the original database transaction before inserting any paid
 * execution claim. Staff -> original-source lock ordering is retained until
 * that transaction commits. A root Prisma client would release these locks
 * after individual statements, so it is explicitly rejected.
 *
 * An existing checkpoint for either side blocks fresh INITIALIZE regardless
 * of receipt validity/completeness. No evidence is deleted or reclassified.
 */
export async function assertAtlasFreshDetection(tx: AtlasFreshDetectionTransaction, source: AtlasFreshDetectionSource): Promise<void> {
    const binding = exactSource(source);
    requireBridge(tx && typeof tx.$executeRaw === 'function' && typeof tx.$queryRaw === 'function'
        && !('$transaction' in tx), 'FRESH_DETECTION_TRANSACTION_REQUIRED');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
    const rows = await tx.$queryRaw<Array<{ id: string; createdByUserId: string; workflowState: string; updatedAt: Date }>>`
        SELECT id,"createdByUserId","workflowState","updatedAt" FROM public."AiGraderV2Session"
        WHERE id=${binding.sessionId} AND "createdByUserId"=${binding.createdByUserId} FOR SHARE`;
    const current = rows[0];
    requireBridge(rows.length === 1 && current.id === binding.sessionId && current.createdByUserId === binding.createdByUserId
        && current.workflowState === 'CAPTURED' && current.updatedAt instanceof Date && Number.isFinite(+current.updatedAt)
        && current.updatedAt.toISOString() === binding.sessionRevision, 'SOURCE_REVISION_CHANGED');
    const checkpoints = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public."AiGraderV2InstrumentationEvent"
        WHERE "sessionId"=${binding.sessionId} AND "createdByUserId"=${binding.createdByUserId}
        AND category='DETECTOR_CHECKPOINT' AND "eventType"='DETECTOR_SIDE_RESULT_PRESERVED'
        AND details->>'sessionRevision'=${binding.sessionRevision} LIMIT 1`;
    requireBridge(checkpoints.length === 0, 'FRESH_DETECTION_REQUIRED');
}

/** Wrap the original loader itself: returning an empty replacement without
 * consulting it could hide newly retained evidence after the preclaim check.
 * Capture binding and detector operation ID are derived by the original engine.
 */
export function createAtlasFreshDetectionCheckpointLoader(source: AtlasFreshDetectionSource, original: CheckpointLoader): CheckpointLoader {
    const binding = exactSource(source);
    requireBridge(typeof original === 'function', 'FRESH_DETECTION_COMPOSITION_REQUIRED');
    return async (lookup: SpeedsterDetectionCheckpointLookup) => {
        requireBridge(lookup && Reflect.ownKeys(lookup).length === 5
            && ['sessionId', 'createdByUserId', 'sessionRevision', 'captureBindingSha256', 'operationId'].every(key => Object.hasOwn(lookup, key))
            && lookup.sessionId === binding.sessionId && lookup.createdByUserId === binding.createdByUserId
            && lookup.sessionRevision === binding.sessionRevision && SHA.test(lookup.captureBindingSha256)
            && lookup.operationId === speedsterDetectionOperationId({ sessionId: binding.sessionId,
                sessionRevision: binding.sessionRevision, captureBindingSha256: lookup.captureBindingSha256 }), 'SOURCE_REVISION_CHANGED');
        const checkpoints = await original(lookup);
        requireBridge(checkpoints && typeof checkpoints === 'object' && !Array.isArray(checkpoints)
            && [Object.prototype, null].includes(Object.getPrototypeOf(checkpoints))
            && Reflect.ownKeys(checkpoints).length === 0, 'FRESH_DETECTION_REQUIRED');
        return checkpoints;
    };
}

/** Shared HUMAN and ASTRA INITIALIZE composition. The full original grading
 * action and worker ports stay intact. All recovery ports must exist so the
 * original engine cannot bypass this loader by disabling its recovery branch.
 * The caller separately runs assertAtlasFreshDetection before its paid claim.
 */
export function withAtlasFreshDetection(source: AtlasFreshDetectionSource, dependencies: SpeedsterReviewActionDependencies): SpeedsterReviewActionDependencies {
    requireBridge(dependencies && ['loadDetectionSideCheckpoints', 'hashDetectionEvidence', 'persistDetectionSideCheckpoint']
        .every(key => typeof dependencies[key as keyof SpeedsterReviewActionDependencies] === 'function'), 'FRESH_DETECTION_COMPOSITION_REQUIRED');
    return { ...dependencies,
        loadDetectionSideCheckpoints: createAtlasFreshDetectionCheckpointLoader(source, dependencies.loadDetectionSideCheckpoints!.bind(dependencies)) };
}
