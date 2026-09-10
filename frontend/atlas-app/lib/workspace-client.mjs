import { staffClientRequest } from './client-request.mjs';
import { staffApiPath } from './routes.mjs';

export const stateNames = { DRAFT: 'Photo drafts', WAITING: 'Waiting to grade', IN_PROGRESS: 'In progress', NEEDS_ATTENTION: 'Needs attention', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved' };
export const stageNames = { PHOTOS: 'Photos', IDENTITY: 'Identity', PREPARATION: 'Prepare images', CENTERING: 'Centering', INSPECTION: 'Inspection', REPORT: 'Report', REVIEW: 'Human review', FINISHING: 'Finishing' };
export const stageOrder = Object.keys(stageNames);
const denialCodes = new Set(['INVALID_REQUEST', 'WORKSPACE_REQUEST_INVALID', 'WORKSPACE_REVISION_CHANGED', 'WORKSPACE_CLAIM_CONFLICT', 'WORKSPACE_CAPABILITY_UNAVAILABLE', 'WORKSPACE_PAIR_REQUIRED', 'WORKSPACE_PHOTOS_REQUIRED', 'WORKSPACE_PILOT_FULL']);
const messages = {
    WORKSPACE_REVISION_CHANGED: 'This card changed. Load its current state before continuing. Your local edits are kept.',
    WORKSPACE_CLAIM_CONFLICT: 'Another operator has this card. Open it to watch the recorded work.',
    WORKSPACE_CAPABILITY_UNAVAILABLE: 'This stage is not available yet. Your saved card and photos are kept.',
    WORKSPACE_PAIR_REQUIRED: 'Confirm that the Front and Back show the same physical card.',
    WORKSPACE_PHOTOS_REQUIRED: 'Both original photographs must finish verification before this card can join the queue.',
    WORKSPACE_PILOT_FULL: 'The ten-card pilot is full. Existing drafts are kept.',
    WORKSPACE_REQUEST_INVALID: 'Check the highlighted card details and try again.',
    SIGN_IN_REQUIRED: 'Your session ended. Sign in again, then recover the saved request.',
    CSRF_REQUIRED: 'Refresh your staff access before continuing.',
    PREPARATION_RELEASE_NOT_ADMITTED: 'Image preparation is awaiting its approved service release. Your saved photos and boundary edits are kept.',
    GRADING_WORK_UNRESOLVED: 'Recorded work still needs to settle before this card can change operators.'
};
export const workspaceMessage = error => messages[error?.code] ?? error?.message ?? 'This request could not be confirmed. Recover the saved request before continuing.';
export const isNotDispatched = error => error?.outcome === 'NOT_DISPATCHED' && denialCodes.has(error?.code);
export const operationId = () => globalThis.crypto.randomUUID();
export const workspaceCardPath = id => `workspace/cards/${id}`;
export const originalImagePath = (id, side) => staffApiPath(`${workspaceCardPath(id)}/evidence/${side}`);
export function cardSide(card, side) { return Array.isArray(card?.sides) ? card.sides.find(value => value.side === side) : card?.sides?.[side]; }
export function verifiedSide(card, side) { const saved = cardSide(card, side); return saved?.verified === true || saved?.status === 'VERIFIED'; }
export function canQueue(card) { return card?.state === 'DRAFT' && ['FRONT', 'BACK'].every(side => verifiedSide(card, side)); }
export function allowedAction(card, action) { return card?.capabilities?.canEdit === true && card.capabilities.actions?.includes(action) === true; }
export function queueCards(cards, state, query = '') {
    const terms = query.trim().toLocaleLowerCase();
    return cards.filter(card => (!state || state === 'ALL' || card.state === state) && `${card.title ?? ''} ${card.subtitle ?? ''}`.toLocaleLowerCase().includes(terms));
}
export async function workspaceRequest(path, options = {}) {
    const result = await staffClientRequest(path, options);
    if (!result.ok) {
        const error = Object.assign(new Error(messages[result.data.error] ?? 'The request could not be completed. Your saved work is kept.'), {
            code: result.data.error, status: result.status, outcome: result.data.outcome
        });
        throw error;
    }
    return result.data;
}
export function checkedCardResult(result, pending) {
    const card = result?.card;
    if (!card || typeof card.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(card.id) || !Number.isSafeInteger(card.revision) || card.revision < 1
        || !Object.hasOwn(stateNames, card.state) || !Object.hasOwn(stageNames, card.stage)
        || result.operationId !== pending.body.operationId
        || (pending.cardId && card.id !== pending.cardId)
        || (pending.body.expectedRevision != null && card.revision < pending.body.expectedRevision)) {
        throw Object.assign(new Error('The saved result could not be matched to this request. Recover the same request before continuing.'), { code: 'REQUEST_OUTCOME_UNCONFIRMED' });
    }
    return card;
}
export function makePending(path, body, cardId) {
    return { path, body: structuredClone({ ...body, operationId: body.operationId ?? operationId() }), ...(cardId ? { cardId } : {}) };
}
export async function freshWorkspaceAccess(request = workspaceRequest) {
    const session = await request('session');
    if (!session?.staff || typeof session.csrf !== 'string' || !/^[a-f0-9]{64}$/i.test(session.csrf)) throw Object.assign(new Error(messages.SIGN_IN_REQUIRED), { code: 'SIGN_IN_REQUIRED' });
    return session;
}

export const PHOTO_MAX_BYTES = 50 * 1024 * 1024;
const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const heicTypes = new Set(['image/heic', 'image/heif']);
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
export const isHeicPhoto = file => Boolean(file && (heicTypes.has(file.type?.toLowerCase())
    || !photoTypes.has(file.type) && /\.hei[cf]$/i.test(file.name ?? '')));
export function validatePhoto(file) {
    if (!file || !photoTypes.has(file.type)) throw new Error('Choose a JPEG, PNG or WebP photograph, or import an HEIC/HEIF photo first.');
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PHOTO_MAX_BYTES) throw new Error('Each photograph must be between 1 byte and 50 MB.');
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240) throw new Error('Choose a photograph with a shorter file name.');
    return file;
}
/** HEIC is an explicit import to a PNG grading source. The exact selected
 * HEIC and local provenance are retained separately, never mislabeled as the
 * cloud upload. Existing JPEG/PNG/WebP files remain byte-for-byte unchanged. */
export async function prepareIntakePhoto(file, { convert, signal, onProgress = () => {} } = {}) {
    if (!isHeicPhoto(file)) return { file: validatePhoto(file), original: null, conversion: null };
    validatePhoto({ name: file.name, size: file.size, type: 'image/png' });
    onProgress('Converting HEIC to PNG');
    const { convertHeicPhoto, HEIC_IMPORT_VERSION } = await import('./heic-import.mjs');
    const result = await (convert ?? convertHeicPhoto)(file, { signal });
    if (signal?.aborted) throw new Error('HEIC conversion was cancelled. Your saved photographs are kept.');
    const imported = new File([result.blob], `${file.name.slice(0, 236)}.png`, { type: 'image/png', lastModified: file.lastModified });
    validatePhoto(imported);
    const originalHash = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return { file: imported, original: file, conversion: {
        version: HEIC_IMPORT_VERSION, originalName: file.name, originalByteCount: file.size,
        originalSha256: Array.from(new Uint8Array(originalHash), n => n.toString(16).padStart(2, '0')).join(''),
        width: result.width, height: result.height, colorSpace: result.colorSpace,
        imported: await describePhoto(imported)
    } };
}
export function uploadRejectionMessage(reason) {
    return reason === 'BYTES_MISMATCH'
        ? 'The saved upload did not match the selected photograph. Choose the photograph again. Your card and other side are kept.'
        : 'The saved photograph could not be decoded as a supported image. Choose a valid JPEG, PNG or WebP. Your card and other side are kept.';
}
/** Explicit file selection is the only way to replace a rejected upload. The
 * new plan uses the same card; immutable upload and rejection history stays on
 * the server. An uncertain request must first recover its recorded outcome. */
export function replaceIntakePhoto(entry, side, file, { original = null, conversion = null } = {}) {
    validatePhoto(file);
    if (!['FRONT', 'BACK'].includes(side) || entry.pending
        || entry.card && !['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state)) throw new Error('Recover the saved request before replacing a photograph.');
    return { ...entry, files: { ...entry.files, [side]: file }, uploads: { ...entry.uploads, [side]: null },
        sourceFiles: { ...entry.sourceFiles, [side]: original }, photoImports: { ...entry.photoImports, [side]: conversion }, pairConfirmed: false };
}
export function checkedUploadRejection(result, pending, entry, side) {
    if (!Object.hasOwn(result, 'uploadResult')) return null;
    const value = result.uploadResult, card = checkedCardResult(result, pending), current = cardSide(card, side);
    if (!value || Object.keys(value).sort().join(',') !== 'cardId,reason,revision,side,state,uploadId'
        || value.state !== 'REJECTED' || !['BYTES_MISMATCH', 'INVALID_IMAGE'].includes(value.reason)
        || value.cardId !== entry.card.id || value.side !== side || value.uploadId !== entry.uploads[side].uploadId
        || value.uploadId !== pending.body.uploadId || !pending.path.endsWith('/upload-complete')
        || !['DRAFT', 'NEEDS_ATTENTION'].includes(card.state) || current?.status !== 'REJECTED'
        || current.uploadId !== value.uploadId || current.rejection?.reason !== value.reason
        || current.rejection?.operationId !== pending.body.operationId || current.rejection?.revision !== value.revision
        || value.revision !== pending.body.expectedRevision + 1 || value.revision > card.revision) {
        throw Object.assign(new Error('The rejected upload could not be matched to this request. Recover the same request before continuing.'), { code: 'REQUEST_OUTCOME_UNCONFIRMED' });
    }
    return { ...value, operationId: pending.body.operationId };
}
export async function describePhoto(file, cryptoImpl = globalThis.crypto) {
    validatePhoto(file);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size) throw new Error('The photograph changed while reading. Select it again.');
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return { name: file.name, contentType: file.type, byteCount: file.size, sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') };
}
/** Only the transient, server-issued PUT grant reaches this transport. The
 * grant is never placed in browser persistence or used as evidence identity. */
export function uploadPhoto(grant, file, { onProgress = () => {}, xhrFactory = () => new XMLHttpRequest(), now = Date.now } = {}) {
    if (!grant || grant.method !== 'PUT' || typeof grant.id !== 'string' || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now()) throw new Error('This upload window expired. Recover the same upload to obtain a fresh window.');
    const url = new URL(grant.url, globalThis.location?.origin ?? 'https://atlasgrading.com');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('The upload destination is not available.');
    if (url.username || url.password || (grant.headers && (typeof grant.headers !== 'object' || Array.isArray(grant.headers)))) throw new Error('The upload destination is not available.');
    return new Promise((resolve, reject) => {
        const xhr = xhrFactory(); let settled = false;
        const finish = error => { if (settled) return; settled = true; if (error) reject(error); else { onProgress(100); resolve(); } };
        xhr.open('PUT', url.href); xhr.withCredentials = false; xhr.timeout = 180_000;
        for (const [key, value] of Object.entries(grant.headers ?? {})) {
            if (/^(cookie|authorization|proxy-authorization|x-atlas-csrf)$/i.test(key) || typeof value !== 'string') { finish(new Error('The upload grant contains unsupported transport headers.')); return; }
            xhr.setRequestHeader(key, value);
        }
        xhr.upload.onprogress = event => { if (!settled && event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
        // A create-only replay can find its object already present. Only the
        // subsequent exact server byte verification may mark it verified.
        xhr.onload = () => finish((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412 ? null : new Error('The photograph upload did not finish. Recover this upload to continue.'));
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => finish(new Error('The upload reply was interrupted. Your photograph and saved upload are kept.'));
        xhr.send(file);
    });
}

/** One resumable physical-card entry. Persist each exact request before it
 * crosses the network. Re-entry resumes the saved phase; it never creates a
 * replacement card or silently repeats an uncertain completion. */
export async function uploadIntakeEntry(initial, { request, persist, put = uploadPhoto, describe = describePhoto, onProgress = () => {} }) {
    let entry = structuredClone(initial);
    const save = async next => { entry = next; await persist(structuredClone(entry)); };
    const post = async (path, body, cardId) => {
        const pending = entry.pending ?? makePending(path, body, cardId);
        if (pending.path !== path) throw new Error('Recover the saved card action before uploading another photo.');
        await save({ ...entry, pending });
        try {
            const result = await request(pending.path, { body: pending.body });
            const card = checkedCardResult(result, pending);
            return { result, card, pending };
        } catch (error) { if (isNotDispatched(error)) await save({ ...entry, pending: null }); throw error; }
    };
    if (!entry.card) {
        const { card } = await post('workspace/cards', { title: entry.title.trim(), identity: entry.identity });
        await save({ ...entry, card, pending: null });
    }
    for (const side of ['FRONT', 'BACK']) {
        const file = entry.files?.[side]; if (!file) continue;
        if (entry.uploads?.[side]?.phase === 'VERIFIED') continue;
        let phase = entry.uploads?.[side];
        if (phase?.phase === 'REJECTED') throw new Error(uploadRejectionMessage(phase.rejection.reason));
        if (!phase) {
            onProgress(side, 'Checking photograph', 0);
            const descriptor = await describe(file);
            phase = { phase: 'PLAN', descriptor };
            await save({ ...entry, uploads: { ...entry.uploads, [side]: phase } });
        }
        if (phase.phase !== 'COMPLETE') {
            const planBody = phase.planBody ?? { operationId: operationId(), expectedRevision: entry.card.revision, side, file: phase.descriptor };
            const path = `${workspaceCardPath(entry.card.id)}/upload-plan`;
            const { card, result, pending } = await post(path, planBody, entry.card.id);
            if (!result.upload?.id) throw new Error('The upload plan could not be confirmed. Recover the same request.');
            phase = { ...phase, phase: 'UPLOAD', uploadId: result.upload.id, planBody: pending.body };
            await save({ ...entry, card, pending: null, uploads: { ...entry.uploads, [side]: phase } });
            onProgress(side, 'Uploading', 0);
            await put(result.upload, file, { onProgress: percent => onProgress(side, 'Uploading', percent) });
            phase = { ...phase, phase: 'COMPLETE' };
            await save({ ...entry, uploads: { ...entry.uploads, [side]: phase } });
        }
        onProgress(side, 'Verifying original', 100);
        const { card, result, pending } = await post(`${workspaceCardPath(entry.card.id)}/upload-complete`, { expectedRevision: entry.card.revision, uploadId: phase.uploadId }, entry.card.id);
        const rejection = checkedUploadRejection(result, pending, entry, side);
        if (rejection) {
            await save({ ...entry, card, pending: null, pairConfirmed: false,
                uploads: { ...entry.uploads, [side]: { ...phase, phase: 'REJECTED', rejection } } });
            throw new Error(uploadRejectionMessage(rejection.reason));
        }
        if (!verifiedSide(card, side)) throw new Error('The saved upload is awaiting verification. Recover its recorded result.');
        await save({ ...entry, card, pending: null, uploads: { ...entry.uploads, [side]: { ...phase, phase: 'VERIFIED' } } });
        onProgress(side, 'Verified', 100);
    }
    return entry;
}
