import { canonical } from '../review-contract.mjs';
import { deny, hash } from '../policy.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const check = (ok, code = 'WORKSPACE_RECORD_UNAVAILABLE') => { if (!ok) deny(503, code); };
const jsonValue = value => JSON.parse(JSON.stringify(value));
function encoded(value, limit) {
    const text = canonical(jsonValue(value));
    check(Buffer.byteLength(text) <= limit);
    return { canonical: text, contentHash: hash(text) };
}
function decoded(row, keys, limit) {
    if (!row) return null;
    check(typeof row.canonical === 'string' && Buffer.byteLength(row.canonical) <= limit && hash(row.canonical) === row.contentHash);
    let body;
    try { body = JSON.parse(row.canonical); } catch { check(false); }
    check(canonical(body) === row.canonical && keys.every(key => body[key] === row[key]));
    return body;
}
export const readWorkspaceRecord = row => decoded(row, ['id', 'creatorId', 'cohortId', 'revision', 'state', 'stage', 'specimenId'], 262144);
const readOperation = row => decoded(row, ['id', 'actorId', 'operationId', 'cardId', 'action', 'inputHash'], 524288);

/** Uses the existing short staff authority transaction. It never performs an
 * upload, worker request or model request while holding a database lock. */
export class StaffWorkspaceStore {
    constructor({ auth, configHash }) { this.auth = auth; this.configHash = configHash; }
    async transaction(staff, work) {
        return this.auth.withStaff(staff, async context => {
            const db = context.tx;
            const [control] = await db.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_control()`;
            const enabled = Boolean(control?.enabled && control.mode === context.control.mode
                && control.releaseSha === context.control.releaseSha && control.configHash === this.configHash);
            const policy = { cohortId: control?.cohortId ?? null, maxCards: 10,
                expiresAt: control?.expiresAt ?? new Date(0), intakeEnabled: enabled && control.intakeEnabled,
                claimsEnabled: enabled && control.claimsEnabled, astraEnabled: enabled && control.astraEnabled,
                preparationEnabled: enabled && control.preparationEnabled,
                processingLimit: control?.processingLimit ?? 1, enabled };
            const belongs = row => { if (row && row.cohortId !== policy.cohortId) deny(404, 'WORKSPACE_CARD_NOT_FOUND'); return row; };
            const tx = {
                async getCard(id) {
                    if (!UUID.test(id ?? '')) deny(404, 'WORKSPACE_CARD_NOT_FOUND');
                    return belongs(readWorkspaceRecord(await db.staffWorkspaceCard.findUnique({ where: { id } })));
                },
                async listCards(cohortId) {
                    if (!cohortId) return [];
                    check(cohortId === policy.cohortId);
                    return (await db.staffWorkspaceCard.findMany({ where: { cohortId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 11 })).map(readWorkspaceRecord);
                },
                async insertCard(row) {
                    belongs(row); check(row.creatorId === context.identity.id);
                    await db.staffWorkspaceCard.create({ data: { id: row.id, creatorId: row.creatorId, cohortId: row.cohortId,
                        revision: row.revision, state: row.state, stage: row.stage, specimenId: row.specimenId,
                        ...encoded(row, 262144), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) } });
                },
                async updateCard(row, expectedRevision) {
                    belongs(row); check(row.revision === expectedRevision + 1);
                    const changed = await db.staffWorkspaceCard.updateMany({ where: { id: row.id, cohortId: row.cohortId, revision: expectedRevision },
                        data: { revision: row.revision, state: row.state, stage: row.stage, specimenId: row.specimenId,
                            ...encoded(row, 262144), updatedAt: new Date(row.updatedAt) } });
                    if (changed.count !== 1) deny(409, 'WORKSPACE_REVISION_CHANGED');
                },
                async getOperation(actorId, operationId) {
                    check(actorId === context.identity.id);
                    return readOperation(await db.staffWorkspaceOperation.findUnique({ where: { actorId_operationId: { actorId, operationId } } }));
                },
                async getOperationById(id) {
                    if (!UUID.test(id ?? '')) return null;
                    const operation = readOperation(await db.staffWorkspaceOperation.findUnique({ where: { id } }));
                    if (operation && !await tx.getCard(operation.cardId)) deny(404, 'WORKSPACE_CARD_NOT_FOUND');
                    return operation;
                },
                async listOperations(cardId, actions) {
                    if (!await tx.getCard(cardId)) deny(404, 'WORKSPACE_CARD_NOT_FOUND');
                    check(Array.isArray(actions) && actions.length <= 10 && actions.every(value => typeof value === 'string'));
                    return (await db.staffWorkspaceOperation.findMany({ where: { cardId, action: { in: actions } },
                        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 })).map(readOperation).reverse();
                },
                async insertOperation(row) {
                    check(row.actorId === context.identity.id);
                    await db.staffWorkspaceOperation.create({ data: { id: row.id, actorId: row.actorId, operationId: row.operationId,
                        cardId: row.cardId, action: row.action, inputHash: row.inputHash, ...encoded(row, 524288), createdAt: new Date(row.createdAt) } });
                },
            };
            return work({ ...context, databaseTx: db, tx, policy });
        });
    }
}
