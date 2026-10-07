import { deny } from '../policy.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Only an explicit, already-committed claim/resume/step can reach this port.
 * It rereads the exact current claim under staff authority, then sends only
 * its saved run and immutable command IDs outside the database transaction. An uncertain reply
 * leaves the original claim/control operation available for same-ID recovery.
 */
export function attachWorkspaceDispatch({ intake, operator, store, dispatch }) {
    if (typeof dispatch !== 'function') return;
    async function start(staff, cardId, input, result, action) {
        const command = await store.transaction(staff, async context => {
            const card = await intake.card(context, cardId);
            if (card.claim?.kind !== 'ASTRA') return null;
            if (context.identity.role !== 'REVIEWER' || card.claim.actorId !== context.identity.id
                || card.claim.accessVersion !== context.identity.accessVersion
                || card.claim.controlRevision !== context.control.revision
                || card.claim.fence !== card.claimFence || !uuid.test(card.claim.runId ?? '')
                || !context.policy.astraEnabled || +new Date(context.policy.expiresAt) <= +context.now)
                deny(503, 'WORKSPACE_ASTRA_NOT_READY');
            const saved = await context.tx.getOperation(context.identity.id, input.operationId);
            const claim = saved?.action === 'claim' ? saved.result?.claim : saved?.result?.priorClaim;
            const runId = saved?.action === 'claim' ? claim?.runId : saved?.result?.runId;
            if (result?.operationId !== input.operationId || saved?.operationId !== input.operationId
                || saved.cardId !== cardId || saved.actorId !== context.identity.id || saved.action !== action
                || action === 'OPERATOR_CONTROL' && saved.result?.action !== input.action
                || !uuid.test(saved.id ?? '') || !uuid.test(runId ?? '') || claim?.kind !== 'ASTRA'
                || !['id', 'actorId', 'accessVersion', 'controlRevision', 'fence', 'captureRevision', 'captureHash', 'workflowRevision']
                    .every(key => claim[key] === card.claim[key])) deny(503, 'WORKSPACE_ASTRA_NOT_READY');
            return { runId, commandId: saved.id };
        });
        if (command === null) return;
        try {
            const result = await dispatch(command);
            if (!['ACCEPTED', 'SETTLED'].includes(result?.state) || result.runId !== command.runId || result.commandId !== command.commandId
                || Object.keys(result).some(key => !['state', 'runId', 'commandId'].includes(key))) throw new Error('invalid acknowledgment');
        } catch { deny(503, 'WORKSPACE_ASTRA_DISPATCH_UNCONFIRMED'); }
    }
    const claim = intake.claim.bind(intake), control = operator.control.bind(operator);
    intake.claim = async (staff, cardId, input) => {
        const result = await claim(staff, cardId, input);
        if (input.operator === 'ASTRA') await start(staff, cardId, input, result, 'claim');
        return result;
    };
    operator.control = async (staff, cardId, input) => {
        const result = await control(staff, cardId, input);
        if (['RESUME', 'STEP', 'RECOVER', 'ABANDON_AND_STEP'].includes(input.action)) await start(staff, cardId, input, result, 'OPERATOR_CONTROL');
        return result;
    };
}
