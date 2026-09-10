import { randomUUID } from 'node:crypto';
import { canonicalizeNewSpeedsterSessionIdentity } from '@atlas/grading-core/identity';
import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { measureSpeedsterCenteringBorders, calculateCenteringBalance, calculateCenteringScore } from '@atlas/grading-core/scoring';
import { canonical } from '../review-contract.mjs';
import { deny, hash, isBoundaryError } from '../policy.mjs';
import { staffApiPath } from '../../routes.mjs';
import { WORKSPACE_ACTIONS, WORKSPACE_MAP_ACTIONS, WORKSPACE_MAP_STATES, workspaceMapReady } from '../../workspace-contract.mjs';
import { workspaceObject, workspaceOperationId, workspaceCardId, WORKSPACE_SHA, WORKSPACE_UUID } from './workspace-intake-validation.mjs';

const localActions = new Set(['SAVE_IDENTITY', 'SAVE_BOUNDARY', 'SAVE_CENTERING']);
const sides = ['FRONT', 'BACK'];
const fixedFrame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const copy = value => JSON.parse(JSON.stringify(value));
const requireValue = (ok, code = 'WORKSPACE_REQUEST_INVALID', status = 400) => { if (!ok) deny(status, code); };
const revision = value => Number.isSafeInteger(value) && value > 0 && value < 2147483647;
const resultKey = operationId => `result_${hash(`atlas-workspace-manual:${operationId}`)}`;
const sourceScope = context => ({ actorId: context.identity.id, sessionHash: context.session.tokenHash,
    controlRevision: context.control.revision });
const binding = card => ({ captureRevision: card.captureRevision, captureHash: card.captureHash,
    claimFence: card.claimFence, workflowRevision: card.revision });
const sameCapture = (card, expected) => card.captureRevision === expected.captureRevision && card.captureHash === expected.captureHash
    && card.claimFence === expected.claimFence;
const prepared = value => value?.status === 'PREPARED' && WORKSPACE_SHA.test(value.manifestHash ?? '');
const measuredPair = workspace => sides.every(side => prepared(workspace.preparation?.[side])
    && workspace.centering?.[side]?.preparationHash === workspace.preparation[side].manifestHash);
function mapProjection(value) {
    workspaceObject(value, ['status', 'name', 'scope', 'version', 'registration', 'bindingReady', 'canRegister']);
    requireValue(WORKSPACE_MAP_STATES.includes(value.status) && (value.name === null || typeof value.name === 'string' && value.name.length <= 240)
        && [null, 'EXACT', 'FAMILY'].includes(value.scope) && (value.version === null || revision(value.version))
        && typeof value.bindingReady === 'boolean' && typeof value.canRegister === 'boolean', 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
    workspaceObject(value.registration, sides);
    requireValue(sides.every(side => ['MISSING', 'REGISTERED', 'FAILED', 'UNKNOWN'].includes(value.registration[side]))
        && (!value.bindingReady || ['LOADED', 'APPLIED'].includes(value.status) && sides.every(side => value.registration[side] === 'REGISTERED'))
        && (!value.canRegister || ['LOADED', 'REGISTRATION_BLOCKED'].includes(value.status)
            && !sides.some(side => value.registration[side] === 'UNKNOWN')), 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
    return copy(value);
}
function fullIdentity(value) {
    workspaceObject(value, ['category'], ['playerName', 'cardName', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber', 'layoutType']);
    const { category, ...fields } = value;
    requireValue(['SPORTS', 'POKEMON'].includes(category));
    try { return { category, ...canonicalizeNewSpeedsterSessionIdentity(category, fields) }; }
    catch { deny(400, 'WORKSPACE_IDENTITY_REQUIRED'); }
}
function parseAction(input) {
    workspaceObject(input, ['operationId', 'expectedRevision', 'action', 'payload']);
    workspaceOperationId(input.operationId);
    requireValue(revision(input.expectedRevision) && WORKSPACE_ACTIONS.includes(input.action));
    requireValue(input.payload && Object.getPrototypeOf(input.payload) === Object.prototype);
    let payload = copy(input.payload);
    if (input.action === 'SAVE_IDENTITY') {
        workspaceObject(payload, ['identity'], ['cornerShape']); payload.identity = fullIdentity(payload.identity);
        payload.cornerShape ??= 'ROUNDED_3_18_MM';
        requireValue(['ROUNDED_3_18_MM', 'SQUARE'].includes(payload.cornerShape));
    } else if (input.action === 'SAVE_BOUNDARY') {
        workspaceObject(payload, ['side', 'corners', 'matColor']);
        const corners = sanitizeSpeedsterUnitQuad(payload.corners);
        requireValue(sides.includes(payload.side) && corners && ['BLACK', 'WHITE', 'MAGENTA'].includes(payload.matColor));
        payload.corners = corners;
    } else if (input.action === 'SAVE_CENTERING') {
        workspaceObject(payload, ['side', 'outer', 'inner', 'confirmed']);
        const inner = sanitizeSpeedsterUnitQuad(payload.inner);
        requireValue(sides.includes(payload.side) && inner && payload.confirmed === true && canonical(payload.outer) === canonical(fixedFrame));
        payload.inner = inner;
        try { measureSpeedsterCenteringBorders(inner); } catch { deny(400, 'WORKSPACE_CENTERING_INVALID'); }
    } else if (input.action === 'PREPARE_SIDE') {
        workspaceObject(payload, ['side']); requireValue(sides.includes(payload.side));
    } else if (input.action === 'CONTINUE_WITHOUT_MAP') {
        workspaceObject(payload, ['confirmed']); requireValue(payload.confirmed === true);
    } else workspaceObject(payload, []);
    return { ...input, payload };
}

/** Human edits and private preparation use one saved physical-card aggregate.
 * The original shared functions own identity/geometry/measurements. External
 * actions first retain their exact request and hold the card. A lost reply is
 * recovered by status; it never creates a second preparation or grading job. */
export class StaffWorkspaceManual {
    constructor({ intake, source = null, sourceReady = () => false }) {
        this.intake = intake; this.store = intake.store; this.source = source; this.sourceReady = sourceReady;
        this.projectIntake = intake.project.bind(intake);
    }
    editable(context, card) {
        this.intake.authority(context, true);
        requireValue(['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(card.state)
            && card.claim?.kind === 'HUMAN' && card.claim.actorId === context.identity.id
            && card.claim.fence === card.claimFence && card.claim.captureHash === card.captureHash
            && card.claim.captureRevision === card.captureRevision, 'WORKSPACE_CLAIM_CONFLICT', 409);
    }
    capabilities(context, card) {
        const owns = context.identity.role === 'REVIEWER' && card.claim?.kind === 'HUMAN'
            && card.claim.actorId === context.identity.id && ['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(card.state);
        const actions = [], workspace = card.workspace ?? {};
        if (owns && !workspace.pending && !card.specimenId) {
            if (!sides.some(side => prepared(workspace.preparation?.[side]))) actions.push('SAVE_IDENTITY');
            if (workspace.identity) actions.push('SAVE_BOUNDARY');
            if (sides.some(side => prepared(workspace.preparation?.[side]))) actions.push('SAVE_CENTERING');
            if (this.sourceReady(context) && context.policy.claimsEnabled && +new Date(context.policy.expiresAt) > +context.now) {
                if (sides.some(side => workspace.preparation?.[side]?.corners)) actions.push('PREPARE_SIDE');
                if (measuredPair(workspace)) {
                    if (typeof this.source.resolveMap === 'function' && workspace.map?.status !== 'HUMAN_REVIEW_WITHOUT_MAP') actions.push('RESOLVE_MAP');
                    if (typeof this.source.registerMap === 'function' && workspace.map?.canRegister) actions.push('REGISTER_MAP');
                    if (typeof this.source.continueWithoutMap === 'function' && ['LOOKUP_FAILED', 'REGISTRATION_BLOCKED'].includes(workspace.map?.status)
                        && !sides.some(side => workspace.map.registration?.[side] === 'UNKNOWN')) actions.push('CONTINUE_WITHOUT_MAP');
                    if (workspaceMapReady(workspace.map)) actions.push('INITIALIZE_REPORT');
                }
            }
        }
        return { actions, controls: card.claim?.kind === 'ASTRA' ? ['PAUSE', 'RESUME', 'STEP', 'TAKE_OVER'] : [] };
    }
    project(context, card) {
        const workspace = copy(card.workspace ?? {});
        for (const side of sides) if (prepared(workspace.preparation?.[side])) {
            workspace.preparation[side].imageUrl = staffApiPath(`workspace/cards/${card.id}/prepared/${side}`);
        }
        return this.projectIntake(context, { ...card, workspace, capabilities: this.capabilities(context, card) });
    }
    preflight(context, card, input) {
        this.editable(context, card);
        requireValue(card.revision === input.expectedRevision, 'WORKSPACE_REVISION_CHANGED', 409);
        requireValue(!card.workspace?.pending, 'WORKSPACE_ACTION_PENDING', 409);
        requireValue(this.capabilities(context, card).actions.includes(input.action), 'WORKSPACE_CAPABILITY_UNAVAILABLE', 409);
        if (input.action === 'SAVE_CENTERING') requireValue(prepared(card.workspace?.preparation?.[input.payload.side]),
            'WORKSPACE_PREPARATION_REQUIRED', 409);
        if (input.action === 'PREPARE_SIDE') requireValue(card.workspace?.identity
            && sanitizeSpeedsterUnitQuad(card.workspace?.preparation?.[input.payload.side]?.corners),
        'WORKSPACE_BOUNDARY_REQUIRED', 409);
    }
    applyLocal(card, input, now) {
        const workspace = copy(card.workspace ?? {}), next = { ...card, workspace,
            revision: card.revision + 1, updatedAt: now.toISOString(), attention: null };
        delete workspace.map;
        if (input.action === 'SAVE_IDENTITY') {
            next.identity = input.payload.identity; workspace.identity = input.payload.identity;
            workspace.cornerShape = input.payload.cornerShape;
            next.title = next.identity.playerName ?? next.identity.cardName;
            workspace.preparation = {}; workspace.centering = {}; next.stage = 'PREPARATION';
        } else if (input.action === 'SAVE_BOUNDARY') {
            const { side, corners, matColor } = input.payload;
            workspace.preparation = { ...workspace.preparation, [side]: { status: 'BOUNDARY_SAVED', corners, matColor } };
            workspace.centering = { ...workspace.centering }; delete workspace.centering[side]; next.stage = 'PREPARATION';
        } else {
            const { side, inner } = input.payload, bordersMm = measureSpeedsterCenteringBorders(inner);
            const ratio = pair => pair.map(number => Number(number.toFixed(2))).join(' / ');
            workspace.centering = { ...workspace.centering, [side]: { outer: fixedFrame, inner, confirmed: true,
                preparationHash: workspace.preparation[side].manifestHash, bordersMm,
                ratios: { leftRight: ratio(calculateCenteringBalance(bordersMm.leftMm, bordersMm.rightMm)),
                    topBottom: ratio(calculateCenteringBalance(bordersMm.topMm, bordersMm.bottomMm)) },
                score: calculateCenteringScore(bordersMm), confirmedAt: now.toISOString() } };
            next.stage = sides.every(value => workspace.centering[value]?.preparationHash === workspace.preparation[value]?.manifestHash
                && prepared(workspace.preparation[value])) ? 'INSPECTION' : 'CENTERING';
        }
        return next;
    }
    async action(staff, id, value) {
        workspaceCardId(id); const input = parseAction(value);
        const saved = await this.store.transaction(staff, async context => {
            this.intake.authority(context, true);
            const card = await this.intake.card(context, id);
            const { prior, inputHash } = await this.intake.prior(context, 'MANUAL_ACTION', id, input);
            if (prior) {
                const outcome = await context.tx.getOperation(context.identity.id, resultKey(input.operationId));
                if (localActions.has(input.action) || outcome) return { result: { card: await this.project(context, card), operationId: input.operationId } };
                this.editable(context, card);
                requireValue(card.workspace?.pending?.requestId === prior.id && sameCapture(card, prior.result.binding), 'WORKSPACE_REVISION_CHANGED', 409);
                return { request: { requestId: prior.id, cardId: id, scope: sourceScope(context), binding: prior.result.binding }, dispatch: false };
            }
            try { this.preflight(context, card, input); }
            catch (error) {
                // The operation lookup proved absence and no write/external
                // call has occurred. Only this narrow rollback is conclusive.
                if (isBoundaryError(error)) error.outcome = 'NOT_DISPATCHED';
                throw error;
            }
            if (localActions.has(input.action)) {
                const next = this.applyLocal(card, input, context.now);
                await context.tx.updateCard(next, card.revision);
                await this.intake.record(context, 'MANUAL_ACTION', id, input, inputHash,
                    { action: input.action, payload: input.payload, phase: 'SUCCEEDED', revision: next.revision });
                return { result: { card: await this.project(context, next), operationId: input.operationId } };
            }
            requireValue(this.source, 'WORKSPACE_SOURCE_UNAVAILABLE', 503);
            const requestId = randomUUID(), next = { ...card, workspace: copy(card.workspace ?? {}),
                revision: card.revision + 1, updatedAt: context.now.toISOString() };
            const bound = binding(next);
            next.workspace.pending = { requestId, operationId: input.operationId, action: input.action,
                ...(input.payload.side ? { side: input.payload.side } : {}), binding: bound };
            await context.tx.updateCard(next, card.revision);
            await this.intake.record(context, 'MANUAL_ACTION', id, input, inputHash,
                { action: input.action, payload: input.payload, phase: 'REQUESTED', requestId, binding: bound,
                    revision: next.revision, actorId: context.identity.id, accessVersion: context.identity.accessVersion }, requestId);
            return { request: { requestId, cardId: id, scope: sourceScope(context), binding: bound }, dispatch: true };
        });
        if (saved.result) return saved.result;
        let result;
        try { result = saved.dispatch ? await this.source[WORKSPACE_MAP_ACTIONS[input.action] ?? (input.action === 'PREPARE_SIDE' ? 'prepare' : 'finalize')](saved.request)
            : await this.source.status(saved.request); }
        catch { return this.pending(staff, id, input.operationId); }
        return this.finish(staff, id, input, saved.request, result);
    }
    pending(staff, id, operationId) {
        return this.store.transaction(staff, async context => ({ card: await this.project(context, await this.intake.card(context, id)), operationId }));
    }
    async recover(staff, id, input) {
        workspaceObject(input, ['requestId']); requireValue(WORKSPACE_UUID.test(input.requestId ?? ''));
        const saved = await this.store.transaction(staff, async context => {
            const card = await this.intake.card(context, id);
            this.editable(context, card);
            const original = await context.tx.getOperationById(input.requestId);
            requireValue(original?.action === 'MANUAL_ACTION' && original.actorId === context.identity.id
                && original.cardId === id && original.result.phase === 'REQUESTED', 'WORKSPACE_REQUEST_CONFLICT', 409);
            return { operationId: original.operationId, expectedRevision: original.result.binding.workflowRevision - 1,
                action: original.result.action, payload: original.result.payload };
        });
        return this.action(staff, id, saved);
    }
    async finish(staff, id, input, request, result) {
        requireValue(result && result.requestId === request.requestId && result.cardId === id
            && result.captureHash === request.binding.captureHash && result.claimFence === request.binding.claimFence
            && result.action === input.action && ['SUCCEEDED', 'PENDING', 'UNKNOWN', 'FAILED'].includes(result.state),
        'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
        return this.store.transaction(staff, async context => {
            this.editable(context, await this.intake.card(context, id));
            const card = await this.intake.card(context, id), key = resultKey(input.operationId);
            const prior = await context.tx.getOperation(context.identity.id, key);
            if (prior) return { card: await this.project(context, card), operationId: input.operationId };
            requireValue(card.workspace?.pending?.requestId === request.requestId && sameCapture(card, request.binding)
                && canonical(card.workspace.pending.binding) === canonical(request.binding)
                && card.revision >= request.binding.workflowRevision, 'WORKSPACE_REVISION_CHANGED', 409);
            if (card.revision !== request.binding.workflowRevision) {
                requireValue(input.action === 'INITIALIZE_REPORT' && card.revision === request.binding.workflowRevision + 1
                    && card.specimenId === id, 'WORKSPACE_REVISION_CHANGED', 409);
                const [proof] = await context.databaseTx.$queryRaw`SELECT atlas_staff.workspace_source_admitted(
                    ${request.requestId}::uuid,${id}::uuid) AS valid`;
                requireValue(proof?.valid === true, 'WORKSPACE_REVISION_CHANGED', 409);
            }
            if (['PENDING', 'UNKNOWN'].includes(result.state)) return { card: await this.project(context, card), operationId: input.operationId };
            const workspace = copy(card.workspace), next = { ...card, workspace, revision: card.revision + 1,
                updatedAt: context.now.toISOString() };
            delete workspace.pending;
            if (Object.hasOwn(WORKSPACE_MAP_ACTIONS, input.action)) {
                requireValue(result.state === 'SUCCEEDED', 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
                workspace.map = mapProjection(result.map);
                if (input.action === 'CONTINUE_WITHOUT_MAP') requireValue(workspace.map.status === 'HUMAN_REVIEW_WITHOUT_MAP', 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
                next.stage = 'INSPECTION'; next.state = ['LOOKUP_FAILED', 'REGISTRATION_BLOCKED', 'INTEGRITY_ERROR'].includes(workspace.map.status) ? 'NEEDS_ATTENTION' : 'IN_PROGRESS';
                next.attention = next.state === 'NEEDS_ATTENTION' ? 'The card map needs review before grading can continue.' : null;
            } else if (result.state === 'FAILED') {
                requireValue(typeof result.failureCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(result.failureCode), 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
                next.state = 'NEEDS_ATTENTION';
                if (input.action === 'INITIALIZE_REPORT' && result.failureCode.startsWith('WORKSPACE_MAP_')) {
                    delete workspace.map; next.attention = 'The card map must be checked again before grading can continue.';
                } else next.attention = input.action === 'PREPARE_SIDE' ? 'The saved preparation needs attention. Its original request and evidence are retained.'
                    : 'Report initialization needs attention. Its original request and evidence are retained.';
                workspace.lastFailure = { requestId: request.requestId, action: input.action, code: result.failureCode };
            } else if (input.action === 'PREPARE_SIDE') {
                const p = result.preparation, side = input.payload.side, previous = workspace.preparation?.[side];
                requireValue(result.side === side && p && WORKSPACE_SHA.test(p.manifestHash ?? '')
                    && p.width === 1270 && p.height === 1778 && canonical(p.sourceCorners) === canonical(previous.corners)
                    && p.matColor === previous.matColor, 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
                workspace.preparation[side] = { ...previous, status: 'PREPARED', manifestHash: p.manifestHash,
                    width: p.width, height: p.height, sourceCorners: p.sourceCorners,
                    centeringProposal: sanitizeSpeedsterUnitQuad(p.centeringProposal) };
                next.stage = sides.every(value => prepared(workspace.preparation[value])) ? 'CENTERING' : 'PREPARATION';
                next.state = 'IN_PROGRESS'; next.attention = null;
            } else {
                requireValue(WORKSPACE_UUID.test(result.specimenId ?? '') && (!card.specimenId || card.specimenId === result.specimenId),
                    'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED', 503);
                next.specimenId = result.specimenId; next.stage = 'INSPECTION'; next.state = 'IN_PROGRESS'; next.attention = null;
            }
            await context.tx.updateCard(next, card.revision);
            await context.tx.insertOperation({ id: randomUUID(), actorId: context.identity.id, operationId: key,
                cardId: id, action: 'MANUAL_ACTION_RESULT', inputHash: hash(canonical({ requestId: request.requestId })),
                result: { requestId: request.requestId, action: input.action, state: result.state, revision: next.revision,
                    ...(Object.hasOwn(WORKSPACE_MAP_ACTIONS, input.action) ? { map: workspace.map } : {}),
                    ...(input.payload.side ? { side: input.payload.side, preparation: workspace.preparation?.[input.payload.side] } : {}),
                    ...(result.failureCode ? { failureCode: result.failureCode } : {}), specimenId: next.specimenId },
                createdAt: context.now.toISOString() });
            return { card: await this.project(context, next), operationId: input.operationId };
        });
    }
    async preparedImage(staff, id, side) {
        workspaceCardId(id); requireValue(sides.includes(side), 'WORKSPACE_EVIDENCE_NOT_FOUND', 404);
        const saved = await this.store.transaction(staff, async context => {
            const card = await this.intake.card(context, id), preparation = card.workspace?.preparation?.[side];
            requireValue(prepared(preparation), 'WORKSPACE_EVIDENCE_NOT_FOUND', 404);
            return { request: { cardId: id, side, manifestHash: preparation.manifestHash, scope: sourceScope(context), binding: binding(card) } };
        });
        requireValue(typeof this.source?.readPrepared === 'function', 'WORKSPACE_SOURCE_UNAVAILABLE', 503);
        const asset = await this.source.readPrepared(saved.request), bytes = Buffer.from(asset.bytes);
        requireValue(['image/png', 'image/jpeg', 'image/webp'].includes(asset.contentType) && WORKSPACE_SHA.test(asset.sha256 ?? '')
            && bytes.length > 0 && bytes.length <= 50 * 1024 * 1024 && bytes.length === asset.byteCount
            && hash(bytes) === asset.sha256, 'WORKSPACE_EVIDENCE_UNAVAILABLE', 503);
        await this.store.transaction(staff, async context => {
            const card = await this.intake.card(context, id);
            requireValue(sameCapture(card, saved.request.binding) && card.revision === saved.request.binding.workflowRevision
                && card.workspace?.preparation?.[side]?.manifestHash === saved.request.manifestHash, 'WORKSPACE_REVISION_CHANGED', 409);
        });
        return { bytes, contentType: asset.contentType };
    }
}

export { parseAction as parseWorkspaceManualAction };
