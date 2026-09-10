import { randomUUID } from 'node:crypto';
import { hash } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { WORKSPACE_ACTIONS } from '../../workspace-contract.mjs';
import { staffApiPath } from '../../routes.mjs';
import { MAX_WORKSPACE_REVISION, PHOTO_SIDES, WORKSPACE_SHA, WORKSPACE_UUID,
    parseWorkspaceIntakeRequest, rejectedWorkspaceUpload, requireWorkspace, verifiedWorkspaceUpload, workspaceCardId,
    workspaceTimestamp, workspaceUploadGrant } from './workspace-intake-validation.mjs';
import { readWorkspacePhotoBytes } from './workspace-intake-storage.mjs';

const STAGES = new Set(['PHOTOS', 'IDENTITY', 'PREPARATION', 'CENTERING', 'INSPECTION', 'REPORT', 'REVIEW', 'FINISHING']);
const STATES = new Set(['DRAFT', 'WAITING', 'IN_PROGRESS', 'NEEDS_ATTENTION', 'HUMAN_REVIEW', 'APPROVED']);
const activeStates = new Set(['IN_PROGRESS', 'NEEDS_ATTENTION']);
const json = value => JSON.parse(JSON.stringify(value));
const safe = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const changed = condition => requireWorkspace(condition, 409, 'WORKSPACE_REVISION_CHANGED');
const available = condition => requireWorkspace(condition, 409, 'WORKSPACE_CAPABILITY_UNAVAILABLE');

/** Only short local database work may run in store.transaction. Its adapter
 * authenticates the current staff/browser/control, locks the cohort and rows,
 * provides the named tx methods below, and commits the card CAS together with
 * its immutable operation. No provider/image request belongs in that callback.
 *
 * tx: getCard(id), listCards(cohortId), insertCard(row), updateCard(row,revision),
 * getOperation(actorId,operationId), getOperationById(id), insertOperation(row).
 * Source reserve is synchronous. Other optional source hooks are DB-only and
 * use context.databaseTx. Current sides point to retained operations containing
 * original object identity; authoritative grading sessions are never copied.
 */
export class StaffWorkspaceIntake {
    constructor({ store, source, storage = null, readiness = null }) {
        requireWorkspace(typeof store?.transaction === 'function' && typeof source?.reserve === 'function',
            503, 'WORKSPACE_NOT_CONFIGURED');
        this.store = store; this.source = source; this.storage = storage; this.readiness = readiness;
    }

    authority(context, write = false) {
        const { identity, policy, now } = context;
        requireWorkspace(WORKSPACE_UUID.test(identity?.id ?? '') && safe(identity?.name, 120)
            && ['REVIEWER', 'OBSERVER'].includes(identity?.role) && now instanceof Date && Number.isFinite(+now)
            && policy && (policy.cohortId === null || (safe(policy.cohortId, 128) && policy.cohortId.length > 0)) && policy.maxCards === 10,
        503, 'WORKSPACE_NOT_CONFIGURED');
        if (write) requireWorkspace(identity.role === 'REVIEWER', 403, 'WORKSPACE_REVIEW_PERMISSION_REQUIRED');
        return context;
    }

    intakeEnabled(context) {
        available(context.policy.intakeEnabled === true && Boolean(context.policy.cohortId)
            && +new Date(context.policy.expiresAt) > +context.now);
    }

    async card(context, id) {
        workspaceCardId(id);
        const card = await context.tx.getCard(id);
        requireWorkspace(card && card.cohortId === context.policy.cohortId, 404, 'WORKSPACE_CARD_NOT_FOUND');
        requireWorkspace(WORKSPACE_UUID.test(card.creatorId ?? '') && Number.isSafeInteger(card.revision)
            && card.revision > 0 && card.revision <= MAX_WORKSPACE_REVISION && STATES.has(card.state)
            && STAGES.has(card.stage) && card.sides && Object.keys(card.sides).length === 2
            && PHOTO_SIDES.every(side => Object.hasOwn(card.sides, side)), 503, 'WORKSPACE_DATA_UNAVAILABLE');
        return card;
    }

    async prior(context, action, cardId, input) {
        const inputHash = hash(canonical({ action, cardId, input }));
        const prior = await context.tx.getOperation(context.identity.id, input.operationId);
        if (prior) requireWorkspace(prior.actorId === context.identity.id && prior.operationId === input.operationId
            && prior.action === action && (action === 'create' ? prior.cardId === prior.result?.cardId : prior.cardId === cardId)
            && prior.inputHash === inputHash,
        409, 'WORKSPACE_REQUEST_CONFLICT');
        return { prior, inputHash };
    }

    async record(context, action, cardId, input, inputHash, result, id = randomUUID()) {
        const row = { id, actorId: context.identity.id, operationId: input.operationId, action, cardId,
            inputHash, result: json(result), createdAt: context.now.toISOString() };
        await context.tx.insertOperation(row);
        return row;
    }

    async retainedUpload(context, card, id) {
        const row = await context.tx.getOperationById(id);
        const upload = row?.result?.upload;
        requireWorkspace(row?.action === 'upload-plan' && row.cardId === card.id && upload?.id === id
            && upload.cardId === card.id && PHOTO_SIDES.includes(upload.side)
            && upload.sourceId === card.source.sourceId && upload.sourceOwnerId === card.source.sourceOwnerId
            && safe(upload.objectRef, 1024) && !upload.objectRef.includes('://') && WORKSPACE_SHA.test(upload.sha256 ?? ''),
        503, 'WORKSPACE_DATA_UNAVAILABLE');
        return upload;
    }

    async retainedSide(context, card, side) {
        const pointer = card.sides[side];
        if (pointer === null) return { upload: null, verification: null };
        requireWorkspace(WORKSPACE_UUID.test(pointer?.uploadId ?? '') && (pointer.verificationId === null
            || WORKSPACE_UUID.test(pointer.verificationId ?? '')), 503, 'WORKSPACE_DATA_UNAVAILABLE');
        const upload = await this.retainedUpload(context, card, pointer.uploadId);
        requireWorkspace(upload.side === side, 503, 'WORKSPACE_DATA_UNAVAILABLE');
        if (pointer.rejectionId !== undefined) {
            requireWorkspace(WORKSPACE_UUID.test(pointer.rejectionId) && pointer.verificationId === null, 503, 'WORKSPACE_DATA_UNAVAILABLE');
            const operation = await context.tx.getOperationById(pointer.rejectionId);
            const rejection = this.uploadRejection(operation, upload);
            requireWorkspace(rejection.revision <= card.revision, 503, 'WORKSPACE_DATA_UNAVAILABLE');
            return { upload, verification: null, rejection: { reason: rejection.reason,
                operationId: operation.operationId, revision: rejection.revision } };
        }
        if (!pointer.verificationId) return { upload, verification: null };
        const completed = await context.tx.getOperationById(pointer.verificationId);
        requireWorkspace(completed?.action === 'upload-complete' && completed.cardId === card.id
            && completed.result?.uploadId === upload.id, 503, 'WORKSPACE_DATA_UNAVAILABLE');
        const verification = verifiedWorkspaceUpload(completed.result.verification, upload);
        return { upload, verification };
    }

    uploadRejection(operation, upload) {
        const result = operation?.result;
        requireWorkspace(operation?.action === 'upload-complete' && operation.cardId === upload.cardId
            && result?.outcome === 'REJECTED' && Number.isSafeInteger(result.revision) && result.revision > 1,
        503, 'WORKSPACE_DATA_UNAVAILABLE');
        return { ...rejectedWorkspaceUpload({ state: 'REJECTED', cardId: operation.cardId,
            uploadId: result.uploadId, reason: result.reason }, upload), side: upload.side, revision: result.revision };
    }

    async completionReply(context, card, operation) {
        const reply = { card: await this.project(context, card), operationId: operation.operationId };
        if (operation.result.outcome !== undefined) reply.uploadResult = this.uploadRejection(operation,
            await this.retainedUpload(context, card, operation.result.uploadId));
        return reply;
    }

    async project(context, card) {
        const sides = await Promise.all(PHOTO_SIDES.map(async side => {
            const { upload, verification, rejection } = await this.retainedSide(context, card, side);
            return { side, status: !upload ? 'MISSING' : verification ? 'VERIFIED' : rejection ? 'REJECTED' : 'PLANNED', uploadId: upload?.id ?? null,
                name: upload?.name ?? null, contentType: upload?.contentType ?? null, byteCount: upload?.byteCount ?? null,
                sha256: upload?.sha256 ?? null, width: verification?.width ?? null, height: verification?.height ?? null,
                imageUrl: verification ? staffApiPath(`workspace/cards/${card.id}/evidence/${side}`) : null,
                ...(rejection ? { rejection } : {}) };
        }));
        const claim = card.claim;
        const identity = card.identity ?? {};
        const reviewer = context.identity.role === 'REVIEWER';
        const currentPolicy = +new Date(context.policy.expiresAt) > +context.now;
        const candidate = reviewer && card.state === 'WAITING' && !claim && context.policy.claimsEnabled === true && currentPolicy;
        const cohort = candidate ? await context.tx.listCards(context.policy.cohortId) : [];
        const processingLimit = context.policy.processingLimit;
        const waiting = candidate && Number.isSafeInteger(processingLimit) && processingLimit >= 1 && processingLimit <= 10
            && (Boolean(card.startedAt) || cohort.filter(row => row.startedAt).length < processingLimit);
        const astraClaim = waiting && context.policy.astraEnabled === true
            && !cohort.some(row => row.id !== card.id && row.claim?.kind === 'ASTRA' && activeStates.has(row.state));
        const canEdit = reviewer && ((card.state === 'DRAFT' && !claim && context.policy.intakeEnabled === true && currentPolicy)
            || (activeStates.has(card.state) && claim?.kind === 'HUMAN' && claim.actorId === context.identity.id));
        const supplied = card.capabilities ?? {};
        const actions = canEdit && Array.isArray(supplied.actions) ? supplied.actions.filter(action =>
            WORKSPACE_ACTIONS.includes(action)) : [];
        const controls = reviewer && claim?.kind === 'ASTRA' && Array.isArray(supplied.controls) ? supplied.controls.filter(action =>
            ['PAUSE', 'RESUME', 'STEP', 'TAKE_OVER'].includes(action)) : [];
        const subtitle = [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.cardNumber].filter(Boolean).join(' · ');
        const value = { id: card.id, title: card.title || identity.cardName || identity.playerName || 'New card',
            subtitle, revision: card.revision, state: card.state, stage: card.stage, sides,
            operator: claim ? { kind: claim.kind, name: claim.kind === 'ASTRA' ? 'Astra' : claim.actorName, mode: claim.mode } : null,
            specimenId: card.specimenId ?? null, updatedAt: workspaceTimestamp(card.updatedAt), identity: json(identity),
            pairConfirmed: card.pairConfirmedAt !== null && Boolean(card.captureHash),
            canClaim: waiting, capabilities: { humanClaim: waiting, astraClaim,
                canEdit, actions, controls } };
        // These are pre-reviewed product projections supplied by the manual
        // adapter, not raw source documents, provider payloads or grading state.
        if (card.workspace !== undefined) value.workspace = json(card.workspace);
        if (card.attention != null) {
            requireWorkspace(safe(card.attention, 500), 503, 'WORKSPACE_DATA_UNAVAILABLE');
            value.attention = card.attention;
        }
        return value;
    }

    async list(staff) {
        return this.store.transaction(staff, async context => {
            this.authority(context);
            const rows = await context.tx.listCards(context.policy.cohortId);
            requireWorkspace(Array.isArray(rows) && rows.length <= context.policy.maxCards, 503, 'WORKSPACE_DATA_UNAVAILABLE');
            const cards = await Promise.all(rows.map(row => this.project(context, row)));
            const readiness = this.readiness ? await this.readiness(context) : {
                photoStorage: { ready: Boolean(this.storage), message: this.storage ? 'Photo storage is connected.' : 'Photo storage is not connected yet.' },
                preparation: { ready: false, message: 'Image preparation has not been admitted.' },
                manualGrading: { ready: context.policy.claimsEnabled === true, message: context.policy.claimsEnabled ? 'Manual grading is available.' : 'Manual grading is not ready yet.' },
                astra: { ready: context.policy.astraEnabled === true, message: context.policy.astraEnabled ? 'Astra is available.' : 'Astra is not running.' },
            };
            return { cards, readiness };
        });
    }

    async read(staff, id) {
        return this.store.transaction(staff, async context => {
            this.authority(context);
            return { card: await this.project(context, await this.card(context, id)) };
        });
    }

    async evidence(staff, id, side) {
        workspaceCardId(id);
        requireWorkspace(PHOTO_SIDES.includes(side), 404, 'WORKSPACE_EVIDENCE_NOT_FOUND');
        const bound = await this.store.transaction(staff, async context => {
            this.authority(context);
            const card = await this.card(context, id), evidence = await this.retainedSide(context, card, side);
            requireWorkspace(evidence.verification, 404, 'WORKSPACE_EVIDENCE_NOT_FOUND');
            return { ...evidence, source: card.source, pointer: card.sides[side], revision: card.revision,
                captureRevision: card.captureRevision, captureHash: card.captureHash, claimFence: card.claimFence };
        });
        available(typeof this.storage?.read === 'function');
        const bytes = await readWorkspacePhotoBytes({ upload: bound.upload,
            read: signal => this.storage.read({ upload: json(bound.upload), source: json(bound.source),
                verification: json(bound.verification), signal }) });
        await this.store.transaction(staff, async context => {
            this.authority(context);
            const card = await this.card(context, id);
            changed(canonical(card.sides[side]) === canonical(bound.pointer) && card.revision === bound.revision
                && card.captureRevision === bound.captureRevision && card.captureHash === bound.captureHash && card.claimFence === bound.claimFence);
        });
        return { bytes, contentType: bound.verification.contentType };
    }

    async create(staff, value) {
        const input = parseWorkspaceIntakeRequest('create', value);
        return this.store.transaction(staff, async context => {
            this.authority(context, true);
            // create has no caller-selected card/source identity. The retained
            // operation owns the one server-generated physical-card draft.
            const { prior, inputHash } = await this.prior(context, 'create', null, input);
            if (prior) return { card: await this.project(context, await this.card(context, prior.result.cardId)), operationId: prior.operationId };
            this.intakeEnabled(context);
            const cards = await context.tx.listCards(context.policy.cohortId);
            requireWorkspace(cards.length < context.policy.maxCards, 409, 'WORKSPACE_PILOT_FULL');
            const id = randomUUID(), source = this.source.reserve({ cardId: id, creatorId: context.identity.id, cohortId: context.policy.cohortId });
            requireWorkspace(source && Object.getPrototypeOf(source) === Object.prototype && Object.keys(source).length === 3
                && source.sourceType === 'SPEEDSTER' && source.sourceId === `atlas-${id}`
                && source.sourceOwnerId === `atlas-staff-${context.identity.id}`, 503, 'WORKSPACE_SOURCE_UNAVAILABLE');
            const now = context.now.toISOString();
            const card = { id, creatorId: context.identity.id, cohortId: context.policy.cohortId, title: input.title,
                identity: input.identity, revision: 1, state: 'DRAFT', stage: 'PHOTOS', source, specimenId: null,
                captureRevision: 0, captureHash: null, sides: { FRONT: null, BACK: null }, pairConfirmedAt: null,
                admittedAt: null, startedAt: null, claimFence: 0, claim: null, createdAt: now, updatedAt: now };
            await context.tx.insertCard(card);
            const operation = await this.record(context, 'create', card.id, input, inputHash, { cardId: card.id, revision: card.revision });
            return { card: await this.project(context, card), operationId: operation.operationId };
        });
    }

    editablePhotos(card) {
        requireWorkspace(['DRAFT', 'NEEDS_ATTENTION'].includes(card.state) && card.claim === null
            && card.specimenId === null, 409, 'WORKSPACE_CLAIM_CONFLICT');
    }

    async planUpload(staff, id, value) {
        workspaceCardId(id);
        const input = parseWorkspaceIntakeRequest('upload-plan', value);
        available(typeof this.storage?.grant === 'function' && typeof this.storage?.verify === 'function');
        const binding = await this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), { prior, inputHash } = await this.prior(context, 'upload-plan', id, input);
            if (prior) {
                const upload = await this.retainedUpload(context, card, prior.id);
                requireWorkspace(card.sides[upload.side]?.uploadId === upload.id, 409, 'WORKSPACE_UPLOAD_SUPERSEDED');
                requireWorkspace(card.sides[upload.side].verificationId === null, 409, 'WORKSPACE_UPLOAD_ALREADY_VERIFIED');
                this.intakeEnabled(context); this.editablePhotos(card);
                return { upload, source: card.source, operationId: prior.operationId };
            }
            this.intakeEnabled(context); this.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const uploadId = randomUUID(), extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[input.file.contentType];
            const upload = { id: uploadId, cardId: id, side: input.side, sourceId: card.source.sourceId,
                sourceOwnerId: card.source.sourceOwnerId,
                objectRef: `ai-grader-v2/${card.source.sourceOwnerId}/${card.source.sourceId}/original/recapture-${uploadId}/${input.side.toLowerCase()}.${extension}`,
                ...input.file, plannedAt: context.now.toISOString() };
            const next = { ...card, sides: { ...card.sides, [input.side]: { uploadId, verificationId: null } },
                revision: card.revision + 1, state: 'DRAFT', stage: 'PHOTOS', pairConfirmedAt: null, captureHash: null,
                updatedAt: context.now.toISOString() };
            await this.record(context, 'upload-plan', id, input, inputHash, { upload, revision: next.revision }, uploadId);
            await context.tx.updateCard(next, card.revision);
            return { upload, source: card.source, operationId: input.operationId };
        });
        const grant = await this.storage.grant({ upload: json(binding.upload), source: json(binding.source) });
        return this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), current = card.sides[binding.upload.side];
            requireWorkspace(current?.uploadId === binding.upload.id, 409, 'WORKSPACE_UPLOAD_SUPERSEDED');
            requireWorkspace(current.verificationId === null, 409, 'WORKSPACE_UPLOAD_ALREADY_VERIFIED');
            this.intakeEnabled(context); this.editablePhotos(card);
            return { card: await this.project(context, card), operationId: binding.operationId,
                upload: workspaceUploadGrant(grant, binding.upload, context.now) };
        });
    }

    async completeUpload(staff, id, value) {
        workspaceCardId(id);
        const input = parseWorkspaceIntakeRequest('upload-complete', value);
        const retained = await this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), { prior } = await this.prior(context, 'upload-complete', id, input);
            if (prior) return { result: await this.completionReply(context, card, prior) };
            this.intakeEnabled(context); this.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const upload = await this.retainedUpload(context, card, input.uploadId);
            requireWorkspace(card.sides[upload.side]?.uploadId === upload.id, 409, 'WORKSPACE_UPLOAD_SUPERSEDED');
            return { upload, source: card.source };
        });
        if (retained.result) return retained.result;
        available(typeof this.storage?.verify === 'function');
        const outcome = await this.storage.verify({ upload: json(retained.upload), source: json(retained.source) });
        const rejection = outcome?.state === 'REJECTED' ? rejectedWorkspaceUpload(outcome, retained.upload) : null;
        const verification = rejection ? null : verifiedWorkspaceUpload(outcome, retained.upload);
        return this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), { prior, inputHash } = await this.prior(context, 'upload-complete', id, input);
            if (prior) return this.completionReply(context, card, prior);
            this.intakeEnabled(context); this.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const upload = await this.retainedUpload(context, card, input.uploadId);
            requireWorkspace(card.sides[upload.side]?.uploadId === upload.id, 409, 'WORKSPACE_UPLOAD_SUPERSEDED');
            if (rejection) {
                requireWorkspace(card.sides[upload.side].verificationId === null, 409, 'WORKSPACE_UPLOAD_ALREADY_VERIFIED');
                // The signed verifier resolved this exact request. Retain its
                // failure as immutably as success so a lost reply can recover
                // without rereading or replacing the rejected object.
                const operation = await this.record(context, 'upload-complete', id, input, inputHash,
                    { uploadId: upload.id, outcome: 'REJECTED', reason: rejection.reason, revision: card.revision + 1 });
                const next = { ...card, revision: card.revision + 1,
                    sides: { ...card.sides, [upload.side]: { uploadId: upload.id, verificationId: null, rejectionId: operation.id } },
                    updatedAt: context.now.toISOString() };
                await context.tx.updateCard(next, card.revision);
                return this.completionReply(context, next, operation);
            }
            if (card.sides[upload.side].verificationId) {
                // A different request may recover a side already verified; it
                // records its own receipt but cannot revise original evidence.
                const current = await this.retainedSide(context, card, upload.side);
                requireWorkspace(canonical(current.verification) === canonical(verification), 409, 'WORKSPACE_UPLOAD_UNVERIFIED');
            }
            if (this.source.recordVerifiedUpload) await this.source.recordVerifiedUpload(context, { card, upload, verification });
            const operationId = randomUUID(), next = { ...card,
                sides: { ...card.sides, [upload.side]: { uploadId: upload.id, verificationId: operationId } },
                revision: card.revision + 1, updatedAt: context.now.toISOString() };
            await this.record(context, 'upload-complete', id, input, inputHash,
                { uploadId: upload.id, verification, revision: next.revision }, operationId);
            await context.tx.updateCard(next, card.revision);
            return { card: await this.project(context, next), operationId: input.operationId };
        });
    }

    async confirmedPhotos(context, card) {
        const front = await this.retainedSide(context, card, 'FRONT'), back = await this.retainedSide(context, card, 'BACK');
        requireWorkspace(front.verification && back.verification, 409, 'WORKSPACE_PHOTOS_REQUIRED');
        requireWorkspace(front.upload.id !== back.upload.id && front.upload.objectRef !== back.upload.objectRef
            && front.verification.sha256 !== back.verification.sha256, 409, 'WORKSPACE_PAIR_REQUIRED');
        return { front, back };
    }

    pairHash(card, front, back, captureRevision) {
        return hash(canonical({ source: card.source, captureRevision,
            sides: Object.fromEntries([['FRONT', front], ['BACK', back]].map(([side, value]) => [side,
                { uploadId: value.upload.id, ...value.verification }])) }));
    }

    async queue(staff, id, value) {
        workspaceCardId(id);
        const input = parseWorkspaceIntakeRequest('queue', value);
        return this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), { prior, inputHash } = await this.prior(context, 'queue', id, input);
            if (prior) return { card: await this.project(context, card), operationId: prior.operationId };
            this.intakeEnabled(context); this.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const { front, back } = await this.confirmedPhotos(context, card);
            const captureRevision = card.captureRevision + 1, captureHash = this.pairHash(card, front, back, captureRevision);
            const all = await context.tx.listCards(context.policy.cohortId);
            for (const other of all) {
                if (other.id === card.id) continue;
                for (const side of PHOTO_SIDES) {
                    const existing = await this.retainedSide(context, other, side);
                    requireWorkspace(!existing.verification || ![front.verification.sha256, back.verification.sha256].includes(existing.verification.sha256),
                        409, 'WORKSPACE_PHOTO_ALREADY_USED');
                }
            }
            if (this.source.confirmPair) await this.source.confirmPair(context, { card, front, back, captureRevision, captureHash });
            const next = { ...card, revision: card.revision + 1, captureRevision, captureHash,
                pairConfirmedAt: context.now.toISOString(), admittedAt: card.admittedAt ?? context.now.toISOString(),
                state: 'WAITING', stage: 'PHOTOS', attention: null, updatedAt: context.now.toISOString() };
            await context.tx.updateCard(next, card.revision);
            await this.record(context, 'queue', id, input, inputHash, { cardId: id, revision: next.revision, captureRevision, captureHash });
            return { card: await this.project(context, next), operationId: input.operationId };
        });
    }

    async claim(staff, id, value) {
        workspaceCardId(id);
        const input = parseWorkspaceIntakeRequest('claim', value);
        return this.store.transaction(staff, async context => {
            this.authority(context, true);
            const card = await this.card(context, id), { prior, inputHash } = await this.prior(context, 'claim', id, input);
            if (prior) return { card: await this.project(context, card), operationId: prior.operationId };
            available(context.policy.claimsEnabled === true && +new Date(context.policy.expiresAt) > +context.now);
            requireWorkspace(card.state === 'WAITING' && card.claim === null, 409, 'WORKSPACE_CLAIM_CONFLICT');
            changed(card.revision === input.expectedRevision);
            const { front, back } = await this.confirmedPhotos(context, card);
            requireWorkspace(card.pairConfirmedAt && card.admittedAt && card.captureRevision > 0
                && card.captureHash === this.pairHash(card, front, back, card.captureRevision), 409, 'WORKSPACE_PAIR_REQUIRED');
            const rows = await context.tx.listCards(context.policy.cohortId), limit = context.policy.processingLimit;
            available(Number.isSafeInteger(limit) && limit >= 1 && limit <= context.policy.maxCards
                && (card.startedAt || rows.filter(row => row.startedAt).length < limit));
            if (input.operator === 'ASTRA') {
                available(context.policy.astraEnabled === true);
                requireWorkspace(!rows.some(row => row.id !== id && row.claim?.kind === 'ASTRA' && activeStates.has(row.state)),
                    409, 'WORKSPACE_CLAIM_CONFLICT');
            }
            const mode = input.operator === 'HUMAN' ? 'MANUAL' : input.mode ?? 'CONTINUOUS';
            const revision = card.revision + 1, fence = card.claimFence + 1;
            requireWorkspace(Number.isSafeInteger(fence) && fence > 0 && fence <= MAX_WORKSPACE_REVISION,
                503, 'WORKSPACE_DATA_UNAVAILABLE');
            const claim = { id: randomUUID(), kind: input.operator, actorId: context.identity.id, actorName: context.identity.name,
                accessVersion: context.identity.accessVersion, controlRevision: context.control.revision,
                mode, fence, workflowRevision: revision, captureRevision: card.captureRevision, captureHash: card.captureHash,
                runId: null, claimedAt: context.now.toISOString() };
            // This optional DB-only hook rechecks/binds existing assignments and
            // run admission. It must never dispatch a model or perform image I/O.
            const linked = this.source.assertClaimable ? await this.source.assertClaimable(context,
                { card, operator: input.operator, mode, claim }) : null;
            if (linked?.runId) { requireWorkspace(WORKSPACE_UUID.test(linked.runId), 503, 'WORKSPACE_DATA_UNAVAILABLE'); claim.runId = linked.runId; }
            const specimenId = linked?.specimenId ?? card.specimenId;
            requireWorkspace(specimenId === null || WORKSPACE_UUID.test(specimenId), 503, 'WORKSPACE_DATA_UNAVAILABLE');
            const next = { ...card, revision, state: 'IN_PROGRESS', stage: 'IDENTITY', specimenId,
                claimFence: fence, claim, startedAt: card.startedAt ?? context.now.toISOString(), updatedAt: context.now.toISOString() };
            await context.tx.updateCard(next, card.revision);
            await this.record(context, 'claim', id, input, inputHash, { cardId: id, revision, claim });
            return { card: await this.project(context, next), operationId: input.operationId };
        });
    }
}
