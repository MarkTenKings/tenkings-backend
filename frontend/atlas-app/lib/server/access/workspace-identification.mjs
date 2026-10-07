import { randomUUID } from 'node:crypto';
import { hash, deny } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { workspaceObject, workspaceOperationId, requireWorkspace, parseWorkspaceDraftIdentity, MAX_WORKSPACE_REVISION } from './workspace-intake-validation.mjs';
import { readWorkspacePhotoBytes } from './workspace-intake-storage.mjs';
import { deriveIdentificationPhoto, workspaceIdentificationProvider, identificationBounded, IDENTIFICATION_TRANSFORM } from './workspace-identification-provider.mjs';
import { IDENTITY_FIELDS, adoptWorkspaceIdentitySuggestions, parseWorkspaceIdentificationPhotos,
    parseWorkspaceIdentificationResult, workspaceIdentificationPairKey, sameWorkspaceIdentificationPhotos } from '../../workspace-identification.mjs';

const clone = value => structuredClone(value);
const changed = condition => requireWorkspace(condition, 409, 'WORKSPACE_REVISION_CHANGED');
const configured = condition => requireWorkspace(condition, 503, 'WORKSPACE_IDENTIFICATION_UNAVAILABLE');
const REQUEST = 'IDENTIFICATION_REQUEST', RESULT = 'IDENTIFICATION_RESULT';
const phases = [REQUEST, RESULT];
const admissionFailure = error => error?.code === 'WORKSPACE_IDENTIFICATION_UNAVAILABLE'
    || error?.meta?.code === 'P0001' && ['ATLAS identification admission denied', 'ATLAS identification shared pilot budget denied']
        .some(message => error.meta.message === message || error.meta.message === `ERROR: ${message}`)
    || error?.name === 'PrismaClientUnknownRequestError' && /code: "P0001", message: "ATLAS identification (?:admission|shared pilot budget) denied"/.test(error.message);
export function workspaceIdentificationSettings(env, staffConfig) {
    if (env.ATLAS_IDENTIFICATION_ENABLED !== 'true') return { enabled: false };
    try {
        const policy = JSON.parse(env.ATLAS_IDENTIFICATION_POLICY_JSON);
        workspaceObject(policy, ['version', 'pilotId', 'expiresAt', 'ocrReserveMicroUsd', 'modelReserveMicroUsd', 'costEvidenceHash']);
        configured(policy.version === 'atlas-intake-identification-policy-v1'
            && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(policy.pilotId)
            && Number.isFinite(+new Date(policy.expiresAt)) && new Date(policy.expiresAt).toISOString() === policy.expiresAt
            && /^[a-f0-9]{64}$/.test(policy.costEvidenceHash)
            && [policy.ocrReserveMicroUsd, policy.modelReserveMicroUsd].every(value => Number.isSafeInteger(value) && value > 0)
            && policy.modelReserveMicroUsd >= 589600
            && Number.isSafeInteger(policy.ocrReserveMicroUsd + policy.modelReserveMicroUsd));
        const openaiKey = env.ATLAS_IDENTIFICATION_OPENAI_API_KEY?.trim(), googleKey = env.ATLAS_IDENTIFICATION_GOOGLE_VISION_API_KEY?.trim();
        configured(openaiKey?.length >= 16 && googleKey?.length >= 16 && !/[\s\x00-\x1f]/.test(openaiKey + googleKey));
        const policyCanonical = canonical(policy), policyHash = hash(policyCanonical);
        const configHash = hash(canonical({ version: 'atlas-intake-identification-runtime-v1', staffConfigHash: staffConfig.configHash,
            policyHash, model: 'gpt-6-astra', reasoningEffort: 'low', serviceTier: 'default', maxOutputTokens: 2400, maxInputTokens: 16384,
            transform: IDENTIFICATION_TRANSFORM, openaiKeyHash: hash(openaiKey), googleKeyHash: hash(googleKey) }));
        return { enabled: true, policy, policyCanonical, policyHash, configHash, openaiKey, googleKey };
    } catch { return { enabled: false, invalid: true }; }
}

export const workspaceIdentificationSqlControl = async context => {
    const [row] = await context.databaseTx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_identification_control()`;
    return row ?? null;
};

export class StaffWorkspaceIdentification {
    constructor({ intake, settings = { enabled: false }, provider, derive = deriveIdentificationPhoto, control = workspaceIdentificationSqlControl }) {
        this.intake = intake; this.store = intake.store; this.settings = settings; this.control = control; this.derive = derive;
        this.provider = provider ?? (settings.enabled ? workspaceIdentificationProvider(settings) : null);
    }
    async enabled(context) {
        configured(this.settings.enabled && typeof this.provider === 'function');
        const row = await this.control(context);
        configured(row?.enabled === true && row.mode === context.control.mode && row.releaseSha === context.control.releaseSha
            && row.cohortId === context.policy.cohortId && row.configHash === this.settings.configHash
            && row.policyHash === this.settings.policyHash && row.policyCanonical === this.settings.policyCanonical
            && +new Date(row.expiresAt) > +context.now && +new Date(this.settings.policy.expiresAt) > +context.now);
        return row;
    }
    photos(front, back) { return { FRONT: { uploadId: front.upload.id, sha256: front.verification.sha256 }, BACK: { uploadId: back.upload.id, sha256: back.verification.sha256 } }; }
    async currentPair(context, card) {
        const { front, back } = await this.intake.confirmedPhotos(context, card), photos = this.photos(front, back);
        return { front, back, photos, pairHash: hash(workspaceIdentificationPairKey(photos)) };
    }
    async reply(context, card, input, request, result) {
        const identification = result?.result?.identification ?? { status: +new Date(request.createdAt) + 60000 > +context.now ? 'PENDING' : 'UNKNOWN',
            photos: request.result.photos, pairHash: request.result.pairHash };
        parseWorkspaceIdentificationResult(identification, request.result.photos);
        return { card: await this.intake.project(context, card), operationId: input.operationId, identification: clone(identification) };
    }
    async retained(context, card, input) {
        const records = await context.tx.listOperations(card.id, phases);
        const explicit = await context.tx.getOperation(context.identity.id, input.operationId);
        if (explicit) requireWorkspace(explicit.action === REQUEST && explicit.cardId === card.id
            && explicit.inputHash === hash(canonical({ action: REQUEST, cardId: card.id, input })), 409, 'WORKSPACE_REQUEST_CONFLICT');
        const pairHash = hash(workspaceIdentificationPairKey(input.photos));
        const request = explicit ?? records.find(row => row.action === REQUEST && row.result.pairHash === pairHash);
        if (!request) return null;
        const result = records.find(row => row.action === RESULT && row.result.requestId === request.id);
        return { request, result };
    }
    parse(value) {
        workspaceObject(value, ['operationId', 'expectedRevision', 'photos']); workspaceOperationId(value.operationId);
        requireWorkspace(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision > 0 && value.expectedRevision <= MAX_WORKSPACE_REVISION);
        let photos; try { photos = parseWorkspaceIdentificationPhotos(value.photos); } catch { deny(400, 'WORKSPACE_IDENTIFICATION_INVALID'); }
        return { ...value, photos };
    }
    async identify(staff, id, value) {
        const input = this.parse(value);
        const bound = await this.store.transaction(staff, async context => {
            this.intake.authority(context, true);
            const card = await this.intake.card(context, id), retained = await this.retained(context, card, input);
            if (retained) return { reply: await this.reply(context, card, input, retained.request, retained.result) };
            this.intake.intakeEnabled(context); this.intake.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const pair = await this.currentPair(context, card);
            changed(sameWorkspaceIdentificationPhotos(pair.photos, input.photos));
            // Reusing an already saved pair must not consume another helper
            // request. The normal queue boundary resolves the physical card.
            for (const other of await context.tx.listCards(context.policy.cohortId)) {
                if (other.id === id || !other.pairConfirmedAt || !other.captureHash) continue;
                const front = await this.intake.retainedSide(context, other, 'FRONT'), back = await this.intake.retainedSide(context, other, 'BACK');
                if (front.verification?.sha256 === pair.photos.FRONT.sha256 && back.verification?.sha256 === pair.photos.BACK.sha256)
                    return { reply: { card: await this.intake.project(context, card), operationId: input.operationId,
                        identification: { status: 'EXISTING_CARD', existingCardId: other.id, photos: pair.photos, pairHash: pair.pairHash } } };
            }
            try { await this.enabled(context); }
            catch (error) {
                if (error?.code !== 'WORKSPACE_IDENTIFICATION_UNAVAILABLE') throw error;
                return { reply: { card: await this.intake.project(context, card), operationId: input.operationId,
                    identification: { status: 'UNAVAILABLE', photos: pair.photos, pairHash: pair.pairHash } } };
            }
            return { card, ...pair };
        });
        if (bound.reply) return bound.reply;
        configured(typeof this.intake.storage?.read === 'function');
        // No payment is reserved until both exact sources decode successfully.
        const images = Object.fromEntries(await identificationBounded(signal => Promise.all([['FRONT', bound.front], ['BACK', bound.back]].map(async ([side, photo]) => {
            const bytes = await readWorkspacePhotoBytes({ upload: photo.upload,
                read: readSignal => this.intake.storage.read({ ...photo, source: bound.card.source, signal: AbortSignal.any([signal, readSignal]) }) });
            return [side, await this.derive({ ...photo, bytes })];
        })), 15000));
        const reservation = await this.store.transaction(staff, async context => {
            this.intake.authority(context, true);
            const card = await this.intake.card(context, id), retained = await this.retained(context, card, input);
            if (retained) return { reply: await this.reply(context, card, input, retained.request, retained.result) };
            this.intake.intakeEnabled(context); this.intake.editablePhotos(card); changed(card.revision === input.expectedRevision);
            const pair = await this.currentPair(context, card); changed(pair.pairHash === bound.pairHash);
            const control = await this.enabled(context), policy = this.settings.policy;
            const request = await this.intake.record(context, REQUEST, id, input,
                hash(canonical({ action: REQUEST, cardId: id, input })), { phase: 'INTAKE_IDENTIFICATION', photos: pair.photos, pairHash: pair.pairHash,
                    identity: card.identity ?? {}, identityAuthority: card.identityAuthority ?? {}, configHash: this.settings.configHash,
                    policyHash: this.settings.policyHash, controlRevision: control.revision, pilotId: policy.pilotId,
                    reservedMicroUsd: policy.ocrReserveMicroUsd + policy.modelReserveMicroUsd,
                    sessionHash: context.session.tokenHash, accessVersion: context.identity.accessVersion, staffControlRevision: context.control.revision,
                    ocrReserveMicroUsd: policy.ocrReserveMicroUsd, modelReserveMicroUsd: policy.modelReserveMicroUsd,
                    costEvidenceHash: policy.costEvidenceHash, model: 'gpt-6-astra', reasoningEffort: 'low', serviceTier: 'default', maxOutputTokens: 2400,
                    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, images[side].lineage])) });
            return { request };
        }).catch(async error => {
            // These exact admission failures roll the request transaction
            // back before any provider dispatch. Photo intake can still queue
            // while its unresolved category remains an explicit identity hold.
            if (!admissionFailure(error)) throw error;
            return this.store.transaction(staff, async context => {
                this.intake.authority(context, true);
                const card = await this.intake.card(context, id), retained = await this.retained(context, card, input);
                if (retained) return { reply: await this.reply(context, card, input, retained.request, retained.result) };
                const pair = await this.currentPair(context, card); changed(pair.pairHash === bound.pairHash);
                return { reply: { card: await this.intake.project(context, card), operationId: input.operationId,
                    identification: { status: 'UNAVAILABLE', photos: pair.photos, pairHash: pair.pairHash } } };
            });
        });
        if (reservation.reply) return reservation.reply;
        let response, failureCode = null, usageCeilingMicroUsd = null;
        try { response = await this.provider(images); }
        catch (error) {
            failureCode = error?.code === 'WORKSPACE_IDENTIFICATION_ENVELOPE_EXCEEDED' ? error.code : 'WORKSPACE_IDENTIFICATION_UNCONFIRMED';
            if (Number.isSafeInteger(error?.usageCeilingMicroUsd) && error.usageCeilingMicroUsd >= 0) usageCeilingMicroUsd = error.usageCeilingMicroUsd + this.settings.policy.ocrReserveMicroUsd;
        }
        // This exact pending operation is never resent, including after an
        // uncertain provider outcome, interrupted HTTP request or app restart.
        return this.store.transaction(staff, async context => {
            this.intake.authority(context, true);
            let card = await this.intake.card(context, id);
            const retained = await this.retained(context, card, input);
            configured(retained?.request.id === reservation.request.id);
            if (retained.result) return this.reply(context, card, input, retained.request, retained.result);
            const identification = { status: response ? 'SUCCEEDED' : 'UNKNOWN', photos: bound.photos, pairHash: bound.pairHash,
                ...(response ?? { failureCode }) };
            parseWorkspaceIdentificationResult(identification, bound.photos);
            const result = await this.intake.record(context, RESULT, id, { operationId: `identity_result_${reservation.request.id}` },
                hash(canonical({ requestId: reservation.request.id, identification })), { requestId: reservation.request.id, identification,
                    usageEnvelopeExceeded: failureCode === 'WORKSPACE_IDENTIFICATION_ENVELOPE_EXCEEDED',
                    usageCeilingMicroUsd: usageCeilingMicroUsd ?? (response ? response.provenance.usageCeilingMicroUsd + this.settings.policy.ocrReserveMicroUsd : null) });
            // A late result is retained even after a retake or human action. It
            // cannot update a different pair or any claimed/prepared card.
            const editable = ['DRAFT', 'WAITING', 'NEEDS_ATTENTION'].includes(card.state) && card.claim === null && card.specimenId === null;
            if (editable) {
                const sides = await Promise.all(['FRONT', 'BACK'].map(side => this.intake.retainedSide(context, card, side)));
                const pair = sides.every(side => side.verification) ? { photos: this.photos(...sides),
                    pairHash: hash(workspaceIdentificationPairKey(this.photos(...sides))) } : null;
                if (pair?.pairHash === bound.pairHash) {
                    const authority = card.identityAuthority ?? {}, humanFields = Object.keys(authority).filter(field => authority[field]?.actor === 'HUMAN');
                    const adopted = response ? adoptWorkspaceIdentitySuggestions({ identity: card.identity ?? {}, suggestions: response.suggestions,
                        editedFields: humanFields, requestIdentity: reservation.request.result.identity, currentPair: pair.photos, requestPair: bound.photos })
                        : { identity: card.identity ?? {}, adoptedFields: [], status: ['SPORTS', 'POKEMON'].includes(card.identity?.category) ? 'READY' : 'UNKNOWN' };
                    const nextAuthority = { ...authority };
                    for (const field of adopted.adoptedFields) nextAuthority[field] = { actor: 'MACHINE', requestId: reservation.request.id, pairHash: bound.pairHash };
                    const next = { ...card, revision: card.revision + 1, identity: parseWorkspaceDraftIdentity(adopted.identity), identityAuthority: nextAuthority,
                        identityReview: { status: adopted.status, pairHash: bound.pairHash, photos: bound.photos, requestId: reservation.request.id }, updatedAt: context.now.toISOString() };
                    await context.tx.updateCard(next, card.revision); card = next;
                }
            }
            return this.reply(context, card, input, reservation.request, result);
        });
    }

    async saveIdentity(staff, id, value) {
        workspaceObject(value, ['operationId', 'expectedRevision', 'identity', 'editedFields']); workspaceOperationId(value.operationId);
        requireWorkspace(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision > 0 && value.expectedRevision <= MAX_WORKSPACE_REVISION
            && Array.isArray(value.editedFields) && value.editedFields.length > 0 && value.editedFields.length <= IDENTITY_FIELDS.length
            && new Set(value.editedFields).size === value.editedFields.length && value.editedFields.every(field => IDENTITY_FIELDS.includes(field)));
        const input = { ...value, identity: parseWorkspaceDraftIdentity(value.identity) };
        return this.store.transaction(staff, async context => {
            this.intake.authority(context, true);
            const card = await this.intake.card(context, id), { prior, inputHash } = await this.intake.prior(context, 'IDENTITY_EDIT', id, input);
            if (prior) return { card: await this.intake.project(context, card), operationId: input.operationId };
            this.intake.intakeEnabled(context);
            requireWorkspace(['DRAFT', 'WAITING', 'NEEDS_ATTENTION'].includes(card.state) && card.claim === null && card.specimenId === null,
                409, 'WORKSPACE_CLAIM_CONFLICT');
            changed(card.revision === input.expectedRevision);
            for (const field of IDENTITY_FIELDS) if (!input.editedFields.includes(field)) changed((input.identity[field] ?? '') === (card.identity?.[field] ?? ''));
            const authority = { ...card.identityAuthority };
            for (const field of input.editedFields) authority[field] = { actor: 'HUMAN', operationId: input.operationId };
            let identityReview = card.identityReview;
            // Explicit category correction resolves the current conflict; an
            // unrelated text edit cannot clear a category hold.
            if (input.editedFields.includes('category')) {
                const pair = await this.currentPair(context, card);
                identityReview = { status: ['SPORTS', 'POKEMON'].includes(input.identity.category) ? 'READY' : 'UNKNOWN', pairHash: pair.pairHash, photos: pair.photos,
                    humanOperationId: input.operationId };
            }
            const next = { ...card, identity: input.identity, identityAuthority: authority, ...(identityReview ? { identityReview } : {}),
                revision: card.revision + 1, updatedAt: context.now.toISOString() };
            await context.tx.updateCard(next, card.revision);
            await this.intake.record(context, 'IDENTITY_EDIT', id, input, inputHash, { revision: next.revision, identity: next.identity, editedFields: input.editedFields });
            return { card: await this.intake.project(context, next), operationId: input.operationId };
        });
    }
}
