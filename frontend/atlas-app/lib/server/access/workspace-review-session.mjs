import { randomUUID } from 'node:crypto';
import { BoundaryError, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
const check = (ok, code, status = 409) => { if (!ok) throw Object.assign(new BoundaryError(status, code), { outcome: 'NOT_DISPATCHED' }); };
/** Explicit reviewer pickup/pause events drive timing. Observing or opening a
 * report cannot claim work, start a timer, approve or publish a report. */
export function workspaceReviewSession({ store, intake, projectCard }) {
    return async (staff, cardId, input) => {
        strictObject(input, ['operationId', 'expectedRevision', 'action']); identifier(input.operationId);
        check(['START', 'PAUSE'].includes(input.action) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0,
            'INVALID_REQUEST', 400);
        const inputHash = hash(canonical({ cardId, input }));
        return store.transaction(staff, async context => {
            const { tx, identity, now } = context, card = await intake.card(context, cardId);
            check(identity.role === 'REVIEWER', 'WORKSPACE_CONTROL_ACCESS_REQUIRED', 403);
            const prior = await tx.getOperation(identity.id, input.operationId);
            if (prior) {
                check(prior.action === 'REVIEW_SESSION' && prior.cardId === cardId && prior.inputHash === inputHash, 'WORKSPACE_REQUEST_CONFLICT');
                return { card: await projectCard(context, card), operationId: input.operationId };
            }
            check(card.revision === input.expectedRevision, 'WORKSPACE_REVISION_CHANGED');
            const visible = await projectCard(context, card);
            check(visible.state === 'HUMAN_REVIEW' && visible.workspace?.reportAccess === true && !!card.specimenId,
                'WORKSPACE_REVIEW_NOT_READY');
            const current = card.workspace?.reviewSession;
            check(current?.state !== 'ACTIVE' || current.reviewerId === identity.id, 'WORKSPACE_REVIEW_CLAIMED');
            if (input.action === 'PAUSE') check(current?.state === 'ACTIVE' && current.reviewerId === identity.id, 'WORKSPACE_REVIEW_NOT_ACTIVE');
            const reviewSession = { state: input.action === 'START' ? 'ACTIVE' : 'PAUSED', reviewerId: identity.id,
                reviewerName: identity.name || 'Staff reviewer', startedAt: current?.startedAt ?? now.toISOString(), updatedAt: now.toISOString() };
            const next = { ...card, revision: card.revision + 1, state: 'HUMAN_REVIEW', stage: 'REVIEW',
                workspace: { ...card.workspace, reviewSession }, updatedAt: now.toISOString() };
            await tx.updateCard(next, card.revision);
            await tx.insertOperation({ id: randomUUID(), actorId: identity.id, operationId: input.operationId, cardId,
                action: 'REVIEW_SESSION', inputHash, result: { action: input.action, revision: next.revision, reviewSession }, createdAt: now.toISOString() });
            return { card: await projectCard(context, next), operationId: input.operationId };
        });
    };
}
