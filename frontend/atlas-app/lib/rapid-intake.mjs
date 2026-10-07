import { cardSide, checkedCardResult, checkedUploadRejection, describePhoto, isNotDispatched, makePending, operationId, uploadPhoto, uploadRejectionMessage, verifiedSide, workspaceCardPath } from './workspace-client.mjs';

export const PHOTO_SIDES = ['FRONT', 'BACK'];
export const intakePhotoEditable = entry => !entry.card || ['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state) && !entry.card.operator;
export const intakePhotoVerified = (entry, side) => verifiedSide(entry.card, side) && (!entry.files?.[side]
    || entry.uploads?.[side]?.phase === 'VERIFIED' && Boolean(entry.uploads[side].uploadId)
    && entry.uploads[side].uploadId === cardSide(entry.card, side)?.uploadId);
export const intakeHasPair = entry => PHOTO_SIDES.every(side => entry.files?.[side] && entry.uploads?.[side]?.phase !== 'REJECTED'
    || intakePhotoVerified(entry, side));
export const intakePairVerified = entry => PHOTO_SIDES.every(side => intakePhotoVerified(entry, side));
export const intakeSelectionPending = entry => PHOTO_SIDES.some(side => entry.selections?.[side]?.file);
export const sameIntakePhotos = (a, b) => PHOTO_SIDES.every(side => {
    const previous = cardSide(a, side), current = cardSide(b, side);
    return previous?.uploadId === current?.uploadId && previous?.sha256 === current?.sha256 && previous?.status === current?.status;
});
export function intakeDuration(ms) { return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)} s` : '—'; }

/** Network bodies remain one revision-bound operation at a time. The large
 * create-only object PUTs overlap; their outcomes are drained and persisted
 * before verification. A lost response always resumes its original operation.
 * This helper saves photographs only: the caller owns identity and queueing. */
export async function uploadRapidIntakeEntry(initial, { request, persist, put = uploadPhoto, describe = describePhoto,
    onProgress = () => {}, now = Date.now }) {
    // Files are immutable. Preserve their object references so the draft store
    // writes each large Blob once, rather than once per progress transition.
    let entry = { ...initial };
    const save = async next => { entry = next; await persist(next); };
    const currentCard = card => card.revision >= (entry.card?.revision ?? 0) ? card : entry.card;
    const post = async (path, body, cardId) => {
        const pending = entry.pending ?? makePending(path, body, cardId);
        if (pending.path !== path) throw new Error('Your saved photo is still being confirmed. Continue saving to resume it.');
        await save({ ...entry, pending });
        try {
            const result = await request(path, { body: pending.body });
            return { result, pending, card: currentCard(checkedCardResult(result, pending)) };
        } catch (error) { if (isNotDispatched(error)) await save({ ...entry, pending: null }); throw error; }
    };
    const complete = async side => {
        const phase = entry.uploads[side], started = now();
        onProgress(side, 'Verifying original', null);
        const { result, pending, card } = await post(`${workspaceCardPath(entry.card.id)}/upload-complete`,
            { expectedRevision: entry.card.revision, uploadId: phase.uploadId }, entry.card.id);
        const rejection = checkedUploadRejection(result, pending, entry, side);
        if (rejection) {
            await save({ ...entry, card, pending: null, pairConfirmed: false,
                uploads: { ...entry.uploads, [side]: { ...phase, phase: 'REJECTED', rejection } } });
            throw new Error(uploadRejectionMessage(rejection.reason));
        }
        if (!verifiedSide(card, side) || cardSide(card, side)?.uploadId !== phase.uploadId) throw new Error('The saved photograph is still being verified. Your original is kept.');
        await save({ ...entry, card, pending: null, uploads: { ...entry.uploads, [side]: { ...phase, phase: 'VERIFIED',
            timings: { ...phase.timings, verifyMs: now() - started } } } });
        onProgress(side, 'Verified', 100);
    };
    if (!entry.card) {
        const { card } = await post('workspace/cards', { title: entry.titleIsPlaceholder ? '' : entry.title.trim(), identity: entry.identity });
        await save({ ...entry, card, pending: null });
    }
    // An interrupted verification has already sent bytes. Settle it before
    // planning another side, even if that was Back in an older browser session.
    if (entry.pending?.path.endsWith('/upload-complete')) {
        const side = PHOTO_SIDES.find(side => entry.uploads?.[side]?.uploadId === entry.pending.body.uploadId);
        if (!side || entry.uploads[side].phase !== 'COMPLETE') throw new Error('This saved photograph needs attention before it can continue.');
        await complete(side);
    }
    const descriptions = await Promise.all(PHOTO_SIDES.map(async side => {
        const file = entry.files?.[side];
        if (!file || entry.uploads?.[side]) return null;
        onProgress(side, 'Checking photograph', null);
        const started = now(), descriptor = entry.photoImports?.[side]?.imported ?? await describe(file);
        return [side, { phase: 'PLAN', descriptor, timings: { hashMs: now() - started } }];
    }));
    if (descriptions.some(Boolean)) await save({ ...entry, uploads: { ...entry.uploads, ...Object.fromEntries(descriptions.filter(Boolean)) } });
    const jobs = [], errors = [];
    // A retained plan may be for Back. It must be settled first, without
    // replacing its body with Front's request or creating a second object.
    const first = entry.pending?.path.endsWith('/upload-plan') ? entry.pending.body.side : null;
    const order = first && PHOTO_SIDES.includes(first) ? [first, ...PHOTO_SIDES.filter(side => side !== first)] : PHOTO_SIDES;
    try {
        for (const side of order) {
            const file = entry.files?.[side]; let phase = entry.uploads?.[side];
            if (!file || phase?.phase === 'VERIFIED' || phase?.phase === 'COMPLETE') continue;
            if (phase?.phase === 'REJECTED') throw new Error(uploadRejectionMessage(phase.rejection.reason));
            const body = phase.planBody ?? { operationId: operationId(), expectedRevision: entry.card.revision, side, file: phase.descriptor };
            onProgress(side, 'Opening upload', null);
            const { card, result, pending } = await post(`${workspaceCardPath(entry.card.id)}/upload-plan`, body, entry.card.id);
            if (!result.upload?.id || cardSide(card, side)?.uploadId !== result.upload.id) throw new Error('The upload window could not be confirmed. Your photo is kept.');
            phase = { ...phase, phase: 'UPLOAD', uploadId: result.upload.id, planBody: pending.body };
            await save({ ...entry, card, pending: null, uploads: { ...entry.uploads, [side]: phase } });
            const started = now(); onProgress(side, 'Uploading', 0);
            // Attach both handlers immediately so a failed Front cannot become
            // an unhandled rejection while the Back plan is in flight.
            const work = Promise.resolve().then(() => put(result.upload, file, { onProgress: percent => onProgress(side, 'Uploading', percent) }))
                .then(() => ({ side, elapsed: now() - started }), error => ({ side, error }));
            jobs.push(work);
        }
    } catch (error) { errors.push(error); }
    for (const outcome of await Promise.all(jobs)) {
        if (outcome.error) { errors.push(outcome.error); continue; }
        const phase = entry.uploads[outcome.side];
        await save({ ...entry, uploads: { ...entry.uploads, [outcome.side]: { ...phase, phase: 'COMPLETE',
            timings: { ...phase.timings, uploadMs: outcome.elapsed } } } });
        onProgress(outcome.side, 'Uploaded · checking original', null);
    }
    if (errors.length) throw errors[0];
    for (const side of PHOTO_SIDES) if (entry.uploads?.[side]?.phase === 'COMPLETE') await complete(side);
    return entry;
}
