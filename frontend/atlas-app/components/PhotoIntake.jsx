import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { OriginalHeicDownload, PhotoPreview, Readiness, StateBadge } from './WorkspaceShared';
import RapidCardCamera from './RapidCardCamera';
import { createPhotoDraftStore } from '../lib/workspace-drafts.mjs';
import { cardSide, checkedCardResult, freshWorkspaceAccess, isNotDispatched, makePending, operationId, PHOTO_ACCEPT, prepareIntakePhoto, replaceIntakePhoto, stateNames, stageNames, uploadRejectionMessage, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import { PHOTO_SIDES, intakeDuration, intakeHasPair, intakePairVerified, intakePhotoEditable, intakePhotoVerified, intakeSelectionPending, sameIntakePhotos, uploadRapidIntakeEntry } from '../lib/rapid-intake.mjs';
import { IDENTITY_FIELDS, parseWorkspaceIdentificationResult, workspaceIdentificationPhotos } from '../lib/workspace-identification.mjs';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './WorkspaceUi.module.css';
import intake from './PhotoIntake.module.css';

const blankEntry = number => ({ id: operationId(), title: `Card ${number}`, titleIsPlaceholder: true, identity: {}, editedFields: [], files: { FRONT: null, BACK: null }, uploads: {}, card: null, pending: null, pairConfirmed: false, autoQueue: true });
const selectedPair = entry => PHOTO_SIDES.every(side => entry.selections?.[side] || entry.files?.[side] || intakePhotoVerified(entry, side));
const normalizedIdentity = identity => {
    const next = { ...identity };
    if (!next.category) delete next.category;
    if (next.category !== 'SPORTS') for (const field of ['playerName', 'manufacturer', 'insert']) delete next[field];
    if (next.category !== 'POKEMON') for (const field of ['cardName', 'layoutType']) delete next[field];
    return next;
};
const humanFields = entry => entry.editedFields ?? Object.keys(entry.identity ?? {});
const retainedHumanIdentity = entry => {
    const edited = humanFields(entry), identity = Object.fromEntries(edited.map(field => [field, entry.identity?.[field] ?? '']));
    const category = entry.identity?.category, dependent = category === 'SPORTS' ? ['playerName', 'manufacturer', 'insert'] : category === 'POKEMON' ? ['cardName', 'layoutType'] : [];
    // A retained name (even an explicit blank) still needs its category to be
    // interpreted. Keep that context without manufacturing a human category edit.
    if (!Object.hasOwn(identity, 'category') && dependent.some(field => edited.includes(field) && Object.hasOwn(entry.identity, field))) identity.category = category;
    return normalizedIdentity(identity);
};
const mergeIdentity = (entry, card) => normalizedIdentity({ ...card.identity,
    ...Object.fromEntries(humanFields(entry).map(field => [field, entry.identity?.[field] ?? ''])) });
const identityEqual = (left, right) => IDENTITY_FIELDS.every(field => (left?.[field] ?? '') === (right?.[field] ?? ''));
const identityReviewMessage = status => ({ UNKNOWN: 'Choose the card category below so Astra can continue.', UNSUPPORTED: 'This pair appears to be outside Sports or Pokémon. Review its category before grading.', CONFLICT: 'The photographed category and staff details differ. Review the category below.' }[status]);
function identityFields(entry, disabled, edit) {
    return <fieldset disabled={disabled}>
        <label>Category<select value={entry.identity.category ?? ''} onChange={event => edit(entry.id, 'category', event.target.value)}><option value="">Identify from photographs</option><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
        {entry.identity.category && <label>{entry.identity.category === 'SPORTS' ? 'Player name' : 'Card name'}<input maxLength={160} value={entry.identity[entry.identity.category === 'SPORTS' ? 'playerName' : 'cardName'] ?? ''} onChange={event => edit(entry.id, entry.identity.category === 'SPORTS' ? 'playerName' : 'cardName', event.target.value)} /></label>}
        {[['year', 'Year'], ['productSet', 'Set / product'], ['cardNumber', 'Card number'], ...(entry.identity.category === 'SPORTS' ? [['manufacturer', 'Manufacturer'], ['insert', 'Insert']] : []), ['parallel', 'Parallel / variant']].map(([field, label]) => <label key={field}>{label}<input maxLength={['year', 'cardNumber'].includes(field) ? 40 : 160} value={entry.identity[field] ?? ''} onChange={event => edit(entry.id, field, event.target.value)} /></label>)}
    </fieldset>;
}

export default function PhotoIntake({ staff, readiness, savedCards = [], focusCard = null, onCardUpdated }) {
    const entriesRef = useRef([]), store = useRef(null), writeChain = useRef(Promise.resolve()), running = useRef(new Set()), preparations = useRef(new Map()), retries = useRef(new Map()), alive = useRef(true), timers = useRef(new Set()), identityLocks = useRef(new Set());
    const props = useRef({ focusCard, savedCards, onCardUpdated }); props.current = { focusCard, savedCards, onCardUpdated };
    const [entries, setEntries] = useState([]), [storageReady, setStorageReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [errors, setErrors] = useState({}), [progress, setProgress] = useState({}), [activity, setActivity] = useState({}), [wake, setWake] = useState(0), [clock, setClock] = useState(0), [lockedIdentity, setLockedIdentity] = useState({});
    const current = id => entriesRef.current.find(entry => entry.id === id);
    usePendingNavigation(() => saving || running.current.size > 0, setError);
    // Compute each update at the head of the write chain. Front and Back may
    // finish preparation in either order without replacing one another or a
    // staff edit. Publish a selected photo only after IndexedDB commits it.
    async function persist(update) {
        setSaving(true);
        const write = writeChain.current.then(async () => {
            const next = update(entriesRef.current);
            await store.current.write(next);
            entriesRef.current = next;
            if (alive.current) setEntries(next);
            return next;
        });
        writeChain.current = write.catch(() => {});
        try { return await write; } finally { if (alive.current) setSaving(false); }
    }
    const patch = (id, update) => persist(values => values.map(entry => entry.id === id ? update(entry) : entry));
    async function saveWorkerEntry(next) {
        await patch(next.id, entry => ({ ...next, title: entry.title, identity: entry.identity, editedFields: humanFields(entry), editVersion: entry.editVersion }));
        if (next.card) props.current.onCardUpdated?.(next.card);
    }
    useEffect(() => {
        let active = true; alive.current = true; store.current = createPhotoDraftStore(staff.id);
        store.current.read().then(async values => {
            if (!active) return;
            const focused = props.current.focusCard;
            let next = values.map(entry => {
                const remote = focused?.id === entry.card?.id ? focused : props.current.savedCards.find(card => card.id === entry.card?.id);
                const refreshed = remote && !entry.pending && remote.revision > entry.card.revision;
                return { ...entry, identity: normalizedIdentity(entry.identity ?? {}), autoQueue: entry.autoQueue ?? Boolean(entry.pairConfirmed || entry.pending),
                    ...(refreshed ? { card: remote, pairConfirmed: entry.pairConfirmed && sameIntakePhotos(entry.card, remote) } : {}) };
            });
            if (focused && !next.some(entry => entry.card?.id === focused.id)) next.push({ ...blankEntry(next.length + 1), title: focused.title, identity: focused.identity ?? {}, card: focused, pairConfirmed: focused.pairConfirmed === true });
            if (!next.length) next = [blankEntry(1)];
            await store.current.write(next);
            if (active) { entriesRef.current = next; setEntries(next); setStorageReady(true); }
        }).catch(cause => { if (active) setError(cause.message); });
        const resume = () => { retries.current.clear(); if (active) { setErrors({}); setWake(value => value + 1); } };
        window.addEventListener('online', resume); window.addEventListener('focus', resume);
        return () => { active = false; alive.current = false; preparations.current.forEach(controller => controller.abort()); timers.current.forEach(timer => clearTimeout(timer)); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); };
    }, [staff.id, focusCard?.id]);
    useEffect(() => {
        if (!Object.keys(activity).length && !Object.keys(progress).length) return;
        const timer = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [Object.keys(activity).length, Object.keys(progress).length]);
    function showProgress(id, side, status, percent = null) {
        if (alive.current) setProgress(previous => ({ ...previous, [`${id}:${side}`]: { status, percent } }));
    }
    async function selectFile(id, side, file, acquisition = { source: 'library' }) {
        const entry = current(id);
        if (!file || !entry || !intakePhotoEditable(entry) || entry.pending || running.current.has(id) || entry.resolvedCard) return;
        const key = `${id}:${side}`, token = operationId();
        preparations.current.get(key)?.abort();
        setErrors(previous => ({ ...previous, [id]: null })); retries.current.delete(id);
        try {
            await persist(values => {
                const next = values.map(value => value.id !== id ? value : { ...value, pairConfirmed: false, autoQueue: true,
                    intakeStartedAt: value.intakeStartedAt ?? Date.now(), identification: null,
                    identity: retainedHumanIdentity(value),
                    selections: { ...value.selections, [side]: { token, file, status: 'PENDING', selectedAt: Date.now(), ...acquisition } } });
                // The next physical card can be photographed while this pair
                // prepares/uploads. Its independent saved entry owns its files.
                if (!props.current.focusCard && next.length < 10 && selectedPair(next.find(value => value.id === id))
                    && !next.some(value => !value.card && !PHOTO_SIDES.some(side => value.files?.[side] || value.selections?.[side]))) next.push(blankEntry(next.length + 1));
                return next;
            });
        } catch (cause) {
            if (cause.code === 'PHOTO_DRAFT_CHANGED') throw cause;
            throw new Error('This photograph could not be saved in this browser. Your previous photo is kept. Check available browser storage, then choose it again.');
        }
    }
    async function prepareSelection(id, side) {
        const key = `${id}:${side}`, selection = current(id)?.selections?.[side];
        if (!selection?.file || selection.status === 'FAILED' || preparations.current.has(key) || preparations.current.size >= 2) return;
        const controller = new AbortController(); preparations.current.set(key, controller); const started = Date.now();
        try {
            showProgress(id, side, 'Preparing photograph');
            const prepared = await prepareIntakePhoto(selection.file, { signal: controller.signal, onProgress: status => showProgress(id, side, status) });
            if (controller.signal.aborted || current(id)?.selections?.[side]?.token !== selection.token) return;
            await patch(id, entry => {
                if (entry.selections?.[side]?.token !== selection.token) return entry;
                const next = replaceIntakePhoto(entry, side, prepared.file, prepared);
                next.selections = { ...next.selections, [side]: { ...selection, file: null, status: 'PREPARED' } };
                next.photoMeta = { ...next.photoMeta, [side]: { ...selection.capture, prepareMs: Date.now() - started,
                    ...(prepared.conversion ? { width: prepared.conversion.width, height: prepared.conversion.height, source: 'HEIC_IMPORT' } : {}) } };
                next.pairConfirmed = intakeHasPair(next) && !intakeSelectionPending(next);
                return next;
            });
        } catch (cause) {
            if (!controller.signal.aborted && current(id)?.selections?.[side]?.token === selection.token) {
                await patch(id, entry => ({ ...entry, selections: { ...entry.selections, [side]: { ...entry.selections[side], status: 'FAILED' } } })).catch(() => {});
                if (alive.current) setErrors(previous => ({ ...previous, [id]: { message: cause.message } }));
            }
        } finally {
            if (preparations.current.get(key) === controller) preparations.current.delete(key);
            if (alive.current) { setProgress(previous => { const next = { ...previous }; delete next[key]; return next; }); setWake(value => value + 1); }
        }
    }
    async function editIdentity(id, field, value) {
        if (!IDENTITY_FIELDS.includes(field) || identityLocks.current.has(id)) return;
        try { await patch(id, entry => {
            const identity = normalizedIdentity({ ...entry.identity, [field]: value });
            // Picking the first category leaves untouched fields available to
            // identification. Only a real transition clears existing values
            // belonging to the previous category; explicit staff blanks remain
            // protected by their own recorded edit.
            const removed = field === 'category' && entry.identity.category && entry.identity.category !== value
                ? Object.keys(entry.identity).filter(name => entry.identity[name]?.trim() && !Object.hasOwn(identity, name)) : [];
            return { ...entry, identity, editedFields: [...new Set([...humanFields(entry), field, ...removed])], editVersion: (entry.editVersion ?? 0) + 1 };
        }); }
        catch (cause) { setError(cause.message); }
    }
    async function requestCard(id, path, body, access) {
        const entry = current(id), pending = entry.pending ?? makePending(path, body, entry.card.id);
        if (pending.path !== path) throw new Error('Your saved work is still being confirmed.');
        await patch(id, value => ({ ...value, pending }));
        try {
            const result = await workspaceRequest(pending.path, { body: pending.body, csrf: access.csrf });
            return { result, pending, card: checkedCardResult(result, pending) };
        } catch (cause) { if (isNotDispatched(cause)) await patch(id, value => ({ ...value, pending: null })); throw cause; }
    }
    async function syncIdentity(id, access) {
        for (let attempt = 0; attempt < 4; attempt++) {
            const entry = current(id);
            if (!entry.pending && identityEqual(entry.identity, entry.card.identity) && (entry.syncedEditVersion ?? 0) >= (entry.editVersion ?? 0)) return;
            const version = entry.pendingEditVersion ?? entry.editVersion ?? 0;
            if (!entry.pending) await patch(id, value => ({ ...value, pendingEditVersion: version }));
            const { card } = await requestCard(id, `${workspaceCardPath(entry.card.id)}/identity`, {
                expectedRevision: entry.card.revision, identity: normalizedIdentity(entry.identity), editedFields: humanFields(entry)
            }, access);
            await patch(id, value => ({ ...value, card, pending: null, identity: mergeIdentity(value, card), syncedEditVersion: version, pendingEditVersion: null })); props.current.onCardUpdated?.(card);
        }
        throw new Error('Your latest details are saved here. Tap Continue saving when you finish editing.');
    }
    async function identify(id, access) {
        let entry = current(id);
        if (entry.identification && !entry.pending) return;
        const photos = entry.pending?.body.photos ?? workspaceIdentificationPhotos(entry.card);
        const { result, pending, card } = await requestCard(id, `${workspaceCardPath(entry.card.id)}/identify`, { expectedRevision: entry.card.revision, photos }, access);
        const identification = parseWorkspaceIdentificationResult(result.identification, photos);
        await patch(id, value => ({ ...value, card, pending: null, identity: mergeIdentity(value, card), identification,
            ...(['UNKNOWN', 'PENDING'].includes(identification.status) ? { identityRequest: pending } : { identityRequest: null }) }));
        props.current.onCardUpdated?.(card);
    }
    async function queue(id, access) {
        // Close editing synchronously before awaiting anything: an event
        // accepted earlier is already on writeChain and must reach the server
        // before queue admission. The ref also fences a stale rendered handler.
        identityLocks.current.add(id); setLockedIdentity(previous => ({ ...previous, [id]: true }));
        try {
            await writeChain.current;
            if (!current(id).pending) await syncIdentity(id, access);
            await admitQueue(id, access);
        } finally {
            identityLocks.current.delete(id);
            if (alive.current) setLockedIdentity(previous => { const next = { ...previous }; delete next[id]; return next; });
        }
    }
    async function admitQueue(id, access) {
        const entry = current(id);
        if (!entry.pending && (!intakePairVerified(entry) || !entry.pairConfirmed)) throw new Error('Both sides must finish verification before this pair can queue.');
        const started = Date.now();
        const { result, card } = await requestCard(id, `${workspaceCardPath(entry.card.id)}/queue`, { expectedRevision: entry.card.revision, pairConfirmed: true }, access);
        const resolved = result.queueResult;
        if (resolved && (Object.keys(resolved).sort().join(',') !== 'cardId,cardState,stage,state,title' || resolved.state !== 'EXISTING_CARD'
            || !/^[a-f0-9-]{36}$/.test(resolved.cardId) || resolved.cardId === card.id || typeof resolved.title !== 'string' || resolved.title.length > 200
            || !Object.hasOwn(stateNames, resolved.cardState) || !Object.hasOwn(stageNames, resolved.stage))) throw new Error('The existing card could not be verified. Your saved pair is kept.');
        if (!resolved && ['DRAFT', 'NEEDS_ATTENTION'].includes(card.state)) throw new Error('This pair has not joined the queue yet. Your photos are kept.');
        await patch(id, value => ({ ...value, card, pending: null, files: { FRONT: null, BACK: null }, autoQueue: false,
            ...(resolved ? { resolvedCard: resolved } : {}), timings: { ...value.timings, queueMs: Date.now() - started, totalMs: value.intakeStartedAt ? Date.now() - value.intakeStartedAt : null } }));
        props.current.onCardUpdated?.(card);
    }
    async function run(id) {
        if (!storageReady || running.current.size || staff.role === 'OBSERVER') return;
        running.current.add(id); setErrors(previous => ({ ...previous, [id]: null }));
        const phase = value => setActivity(previous => ({ ...previous, [id]: { phase: value, startedAt: Date.now() } }));
        try {
            await writeChain.current; phase('Refreshing access'); const access = await freshWorkspaceAccess();
            // A saved queue command may now resolve to an advanced/existing
            // card. Settle it before upload, identity, editability or capacity.
            if (current(id)?.pending?.path.endsWith('/queue')) { phase('Confirming saved pair'); await queue(id, access); return; }
            if (current(id)?.pending?.path.endsWith('/identify')) { phase('Reading card details'); await identify(id, access); }
            if (current(id)?.pending?.path.endsWith('/identity')) await syncIdentity(id, access);
            if (!intakePhotoEditable(current(id)) || current(id).resolvedCard) return;
            phase('Saving original photographs'); const started = Date.now();
            await uploadRapidIntakeEntry(current(id), { request: (path, options) => workspaceRequest(path, { ...options, csrf: access.csrf }),
                persist: saveWorkerEntry, onProgress: (side, status, percent) => showProgress(id, side, status, percent) });
            await patch(id, value => ({ ...value, timings: { ...value.timings, uploadMs: (value.timings?.uploadMs ?? 0) + Date.now() - started } }));
            if (!intakePairVerified(current(id))) return;
            await syncIdentity(id, access);
            phase('Reading Front + Back with OCR and Astra'); await identify(id, access);
            phase('Adding to the grading queue'); await queue(id, access);
        } catch (cause) {
            if (!alive.current) return;
            const count = (retries.current.get(id) ?? 0) + 1; retries.current.set(id, count);
            setErrors(previous => ({ ...previous, [id]: { message: workspaceMessage(cause), code: cause.code } }));
            const resumable = current(id)?.pending || PHOTO_SIDES.some(side => ['UPLOAD', 'COMPLETE'].includes(current(id)?.uploads?.[side]?.phase));
            if (resumable && count < 2 && !['SIGN_IN_REQUIRED', 'CSRF_REQUIRED'].includes(cause.code)) {
                const timer = setTimeout(() => { timers.current.delete(timer); if (alive.current) { setErrors(previous => ({ ...previous, [id]: null })); setWake(value => value + 1); } }, 1500);
                timers.current.add(timer);
            }
        } finally {
            running.current.delete(id);
            if (alive.current) { setActivity(previous => { const next = { ...previous }; delete next[id]; return next; });
                setProgress(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${id}:`)))); setWake(value => value + 1); }
        }
    }
    useEffect(() => {
        if (!storageReady || staff.role === 'OBSERVER') return;
        entries.forEach(entry => PHOTO_SIDES.forEach(side => { if (entry.selections?.[side]?.file && entry.selections[side].status !== 'FAILED') void prepareSelection(entry.id, side); }));
        const next = entries.find(entry => !entry.resolvedCard && !errors[entry.id] && !running.current.has(entry.id)
            && (entry.pending || entry.autoQueue && intakePhotoEditable(entry) && entry.pairConfirmed && intakeHasPair(entry) && !intakeSelectionPending(entry)));
        if (next && !running.current.size) void run(next.id);
    }, [entries, storageReady, wake]);
    const visible = focusCard ? entries.filter(entry => entry.card?.id === focusCard.id) : entries;
    const captureTarget = visible.find(entry => !entry.resolvedCard && intakePhotoEditable(entry) && !entry.pending && !selectedPair(entry));
    const otherCards = savedCards.filter(card => card.state === 'DRAFT' && !entries.some(entry => entry.card?.id === card.id));
    async function retry(id) {
        retries.current.delete(id); setErrors(previous => ({ ...previous, [id]: null }));
        await patch(id, entry => ({ ...entry, autoQueue: true, pairConfirmed: entry.pairConfirmed || intakeHasPair(entry),
            selections: Object.fromEntries(Object.entries(entry.selections ?? {}).map(([side, selection]) => [side, { ...selection, status: selection.file ? 'PENDING' : selection.status }])) }));
    }
    async function saveCorrections(id) {
        if (running.current.size) return;
        running.current.add(id); setActivity(previous => ({ ...previous, [id]: { phase: 'Saving corrected details', startedAt: Date.now() } })); setErrors(previous => ({ ...previous, [id]: null }));
        try { await syncIdentity(id, await freshWorkspaceAccess()); }
        catch (cause) { setErrors(previous => ({ ...previous, [id]: { message: workspaceMessage(cause), code: cause.code } })); }
        finally { running.current.delete(id); setActivity(previous => { const next = { ...previous }; delete next[id]; return next; }); setWake(value => value + 1); }
    }
    if (staff.role === 'OBSERVER') return <Notice>This staff account has read-only access. A grader adds physical-card photographs.</Notice>;
    return <>
        {!focusCard && <div className={styles.intakeIntro}><div><p className="eyebrow">PHOTO INTAKE</p><h1>Add cards</h1><p className="muted">Front. Back. Your next card. ATLAS handles the rest.</p></div><Link href="/grading">Watch grading ↗</Link></div>}
        {error && <Notice error>{error}</Notice>}
        {!storageReady ? <div className="empty-state" role="status">{error ? 'Saved photos could not be opened.' : 'Opening your saved photographs…'}</div> : <>
            <RapidCardCamera entry={captureTarget} disabled={!storageReady} onCapture={selectFile} />
            <div className={intake.explanation}><strong>Take or choose both sides of one physical card.</strong><p>The pair is saved, verified and identified automatically. Astra picks up eligible cards as capacity becomes available and stops for human review.</p></div>
            <div className={styles.intakeToolbar}><p>{entries.filter(entry => entry.card || PHOTO_SIDES.some(side => entry.files?.[side] || entry.selections?.[side])).length} of 10 card slots <span>{saving ? 'Saving photographs and progress…' : 'Photos and progress are kept on this browser'}</span></p>{!focusCard && !captureTarget && entries.length < 10 && <button type="button" onClick={() => persist(values => [...values, blankEntry(values.length + 1)]).catch(cause => setError(cause.message))}>+ Add another card</button>}</div>
            <div className={focusCard ? styles.focusIntake : styles.intakeCards}>{visible.map((entry, index) => {
                const queued = !intakePhotoEditable(entry) || Boolean(entry.resolvedCard), active = activity[entry.id], failure = errors[entry.id], photosLocked = queued || Boolean(entry.pending) || running.current.has(entry.id);
                const review = identityReviewMessage(entry.card?.identityReview?.status ?? (entry.identification && !entry.identity.category ? 'UNKNOWN' : null));
                const title = !entry.titleIsPlaceholder && entry.title ? entry.title : entry.identity.cardName || entry.identity.playerName || entry.card?.title || entry.title;
                return <section className={styles.intakeCard} key={entry.id} aria-labelledby={`intake-${entry.id}`}>
                    <div className={styles.panelHeading}><div><p className="eyebrow">CARD {String(index + 1).padStart(2, '0')}</p><h2 id={`intake-${entry.id}`}>{title}</h2></div>{entry.card && <StateBadge state={entry.resolvedCard?.cardState ?? entry.card.state} />}</div>
                    <div className={styles.photoPair}>{PHOTO_SIDES.map(side => {
                        const file = entry.files?.[side], selected = entry.selections?.[side], status = progress[`${entry.id}:${side}`], verified = intakePhotoVerified(entry, side), metadata = { ...cardSide(entry.card, side), ...entry.photoMeta?.[side] };
                        const rejection = entry.uploads?.[side]?.rejection ?? (!file ? cardSide(entry.card, side)?.rejection : null);
                        return <div className={styles.photoSlot} key={side}><div className={styles.photoSlotHeading}><strong>{side === 'FRONT' ? 'Front' : 'Back'}</strong><span>{verified ? '✓ Verified' : rejection ? 'Needs replacement' : selected?.file ? 'Saved · preparing' : file ? 'Ready' : 'Choose this side'}</span></div>
                            <PhotoPreview file={file} card={entry.card} side={side} className={styles.photoThumb} />
                            {!queued && <label className={styles.filePicker}>{file || verified ? `Replace ${side === 'FRONT' ? 'Front' : 'Back'}` : `Choose ${side === 'FRONT' ? 'Front' : 'Back'} photo`}<input type="file" accept={PHOTO_ACCEPT} disabled={photosLocked} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; void selectFile(entry.id, side, chosen).catch(cause => setErrors(previous => ({ ...previous, [entry.id]: { message: cause.message } }))); }} /></label>}
                            <small className={styles.filename}>{selected?.file?.name ?? file?.name ?? (verified ? 'Original saved securely' : 'HEIC, HEIF, JPEG, PNG or WebP · up to 50 MB')}</small>
                            {metadata?.width && metadata?.height && <small className={intake.dimensions}>{metadata.width.toLocaleString()} × {metadata.height.toLocaleString()} {metadata.source === 'LOSSLESS_VIDEO_FRAME' ? 'camera frame · lossless PNG' : metadata.source === 'NATIVE_STILL' ? 'native still' : 'original pixels'}</small>}
                            {entry.photoImports?.[side] && <div className={styles.heicImport}><small>Full-size PNG · original HEIC kept in this browser.</small>{entry.sourceFiles?.[side] && <OriginalHeicDownload file={entry.sourceFiles[side]} />}</div>}
                            {status && <div className={styles.uploadProgress} role="status"><progress max="100" value={status.percent ?? undefined} aria-label={`${side} photo progress`} /><span>{status.status}{status.status === 'Uploading' ? ` · ${status.percent}%` : ''}</span></div>}
                            {rejection && <Notice error>{uploadRejectionMessage(rejection.reason)}</Notice>}
                        </div>;
                    })}</div>
                    {active && <p className={intake.liveStatus} role="status"><span aria-hidden="true" />{active.phase}<small>{intakeDuration(Math.max(0, (clock || Date.now()) - active.startedAt))}</small></p>}
                    {failure && <Notice error>{failure.message}</Notice>}
                    {entry.resolvedCard ? <div className={styles.panelFooter}><p>This pair is already saved as {entry.resolvedCard.title}.</p><Link href={`/workspace/${entry.resolvedCard.cardId}`}>Open existing card ↗</Link></div>
                        : queued ? <div className={styles.panelFooter}><p>{entry.card.state === 'WAITING' ? 'In the grading queue. Astra will pick it up when eligible capacity is available.' : 'Saved in the grading workspace.'}</p><Link href={`/workspace/${entry.card.id}`}>Watch card ↗</Link></div> : <>
                            {review && <Notice>{review}</Notice>}
                            {entry.identification?.status === 'UNKNOWN' && <Notice>Photos are saved. Identification needs attention; no uncertain request is sent again.</Notice>}
                            {entry.identification?.warnings?.map(warning => <Notice key={warning}>{warning}</Notice>)}
                            <details className={intake.details} open={Boolean(review)}><summary>{entry.identification ? 'Card details · review or correct' : 'Card details · optional while photos save'}</summary>{identityFields(entry, Boolean(lockedIdentity[entry.id] || entry.pending?.path.endsWith('/queue')), editIdentity)}<p>Only supported printed details fill automatically. Your corrections, including cleared fields, are kept.</p>
                            {entry.identification?.suggestions?.variant?.value && <p>Printed variant suggestion: {entry.identification.suggestions.variant.value}</p>}
                            {entry.identification?.suggestions?.cardType?.value && <p>Printed card type: {entry.identification.suggestions.cardType.value}</p>}
                            </details>
                            <div className={styles.intakeCardFooter}>
                                {failure || entry.pending && !active ? <div className={styles.actions}>{['SIGN_IN_REQUIRED', 'CSRF_REQUIRED'].includes(failure?.code) ? <a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in to continue ↗</a> : <button type="button" disabled={Boolean(active)} onClick={() => retry(entry.id)}>Continue saving</button>}</div> : !entry.pairConfirmed && intakeHasPair(entry) && !intakeSelectionPending(entry) ? <button type="button" onClick={() => retry(entry.id)}>Use this Front + Back pair</button> : <p className={intake.nextStep} role="status">{selectedPair(entry) ? 'Both sides are saved here. This card will join the queue automatically.' : 'Choose both sides of this physical card. Back completes the pair.'}</p>}
                                {entry.card && <Link href={`/workspace/${entry.card.id}`}>Open saved card ↗</Link>}
                            </div>
                        </>}
                    {queued && !entry.resolvedCard && entry.card.state === 'WAITING' && !entry.card.operator && <details className={intake.details} open={Boolean(review)}><summary>Card details · review or correct</summary>{review && <Notice>{review}</Notice>}{identityFields(entry, Boolean(active || lockedIdentity[entry.id]), editIdentity)}<div className={styles.actions}><button type="button" disabled={Boolean(active) || identityEqual(entry.identity, entry.card.identity) && (entry.syncedEditVersion ?? 0) >= (entry.editVersion ?? 0)} onClick={() => saveCorrections(entry.id)}>Save corrected details</button></div>{entry.identityRequest && <p>Its original identification request is retained. Corrections do not send another model request.</p>}</details>}
                    {(entry.timings || entry.identification?.provenance || entry.photoMeta) && <details className={intake.timings}><summary>Capture and processing times</summary><dl>{PHOTO_SIDES.map(side => <div key={side}><dt>{side === 'FRONT' ? 'Front' : 'Back'} preparation</dt><dd>{intakeDuration(entry.photoMeta?.[side]?.prepareMs)}</dd></div>)}<div><dt>Upload + verification</dt><dd>{intakeDuration(entry.timings?.uploadMs)}</dd></div><div><dt>OCR + identification</dt><dd>{intakeDuration(entry.identification?.provenance?.elapsedMs)}</dd></div><div><dt>Queue confirmation</dt><dd>{intakeDuration(entry.timings?.queueMs)}</dd></div><div><dt>First photo to queue</dt><dd>{intakeDuration(entry.timings?.totalMs)}</dd></div></dl><p>Measured for this pair. Total includes time between photographs and interruptions.</p></details>}
                </section>;
            })}</div>
        </>}
        {otherCards.length > 0 && <section className={styles.panel}><h2>Continue a saved card</h2>{otherCards.map(card => <Link className={styles.savedDraft} key={card.id} href={`/workspace/${card.id}`}><span>{card.title}</span><span>Open card ↗</span></Link>)}</section>}
        <Readiness readiness={readiness} />
    </>;
}
