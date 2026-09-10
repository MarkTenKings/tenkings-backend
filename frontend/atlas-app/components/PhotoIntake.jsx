import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { OriginalHeicDownload, PhotoPreview, Readiness, StateBadge } from './WorkspaceShared';
import { createPhotoDraftStore } from '../lib/workspace-drafts.mjs';
import { cardSide, checkedCardResult, freshWorkspaceAccess, isNotDispatched, makePending, operationId, PHOTO_ACCEPT, prepareIntakePhoto, replaceIntakePhoto, uploadIntakeEntry, uploadRejectionMessage, verifiedSide, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './WorkspaceUi.module.css';
import intake from './PhotoIntake.module.css';

const blankEntry = number => ({ id: operationId(), title: `Card ${number}`, identity: {}, files: { FRONT: null, BACK: null }, uploads: {}, card: null, pending: null, pairConfirmed: false });
const photoEditable = entry => !entry.card || ['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state);
const photoVerified = (entry, side) => verifiedSide(entry.card, side) && (!entry.files[side] || entry.uploads[side]?.phase === 'VERIFIED'
    && Boolean(entry.uploads[side].uploadId) && entry.uploads[side].uploadId === cardSide(entry.card, side)?.uploadId);
const hasPhotoPair = entry => ['FRONT', 'BACK'].every(side => entry.files[side] && !['VERIFIED', 'REJECTED'].includes(entry.uploads[side]?.phase) || photoVerified(entry, side));
const pairVerified = entry => ['FRONT', 'BACK'].every(side => photoVerified(entry, side));
const readyToAdd = entry => Boolean(entry && photoEditable(entry) && !entry.pending && hasPhotoPair(entry) && entry.pairConfirmed);
const sameSavedPhotos = (a, b) => ['FRONT', 'BACK'].every(side => {
    const previous = cardSide(a, side), current = cardSide(b, side);
    return previous?.uploadId === current?.uploadId && previous?.sha256 === current?.sha256 && previous?.status === current?.status;
});
export default function PhotoIntake({ staff, readiness, savedCards = [], focusCard = null, onCardUpdated }) {
    const entriesRef = useRef([]), store = useRef(null), writeChain = useRef(Promise.resolve()), working = useRef(false);
    const conversion = useRef(null);
    useEffect(() => () => conversion.current?.abort(), []);
    const focusedCardRef = useRef(focusCard), focusId = focusCard?.id; focusedCardRef.current = focusCard;
    const [entries, setEntries] = useState([]), [storageReady, setStorageReady] = useState(false), [busyId, setBusyId] = useState(''), [error, setError] = useState(''), [entryError, setEntryError] = useState({}), [progress, setProgress] = useState({}), [saving, setSaving] = useState(false);
    useEffect(() => {
        let active = true; store.current = createPhotoDraftStore(staff.id);
        store.current.read().then(async values => {
            if (!active) return;
            const focused = focusedCardRef.current;
            const next = focused ? values.some(entry => entry.card?.id === focused.id) ? values.map(entry => entry.card?.id === focused.id && !entry.pending && focused.revision > entry.card.revision ? { ...entry, card: focused, pairConfirmed: entry.pairConfirmed && sameSavedPhotos(entry.card, focused) } : entry) : [...values, { ...blankEntry(values.length + 1), title: focused.title, identity: focused.identity ?? {}, card: focused }] : values.length ? values : [blankEntry(1)];
            await store.current.write(next);
            if (active) { entriesRef.current = next; setEntries(next); setStorageReady(true); }
        }).catch(cause => { if (active) setError(cause.message); });
        return () => { active = false; };
    }, [staff.id, focusId]);
    usePendingNavigation(() => working.current || saving, setError);
    async function saveEntries(next, { publishAfterWrite = false } = {}) {
        if (!publishAfterWrite) { entriesRef.current = next; setEntries(next); }
        setSaving(true);
        const snapshot = structuredClone(next);
        const write = writeChain.current.then(() => store.current.write(snapshot), () => store.current.write(snapshot));
        writeChain.current = write;
        let failed = false;
        try {
            await write;
            if (publishAfterWrite) { entriesRef.current = next; setEntries(next); }
        } catch (cause) {
            failed = true;
            if (publishAfterWrite) throw new Error('This photograph could not be saved in this browser. Your previous photo is kept. Check available browser storage, then select it again.');
            throw cause;
        } finally {
            if (writeChain.current === write) {
                setSaving(false);
                // Failed selection never became the current draft; a later
                // selection may retry without inheriting a rejected write.
                if (failed && publishAfterWrite) writeChain.current = Promise.resolve();
            }
        }
    }
    async function saveEntry(entry, options) { await saveEntries(entriesRef.current.map(value => value.id === entry.id ? entry : value), options); if (entry.card) onCardUpdated?.(entry.card); }
    async function edit(id, values) {
        if (working.current) return;
        const entry = entriesRef.current.find(value => value.id === id);
        if (!entry || entry.pending) return;
        try { await saveEntry({ ...entry, ...values }); setEntryError(previous => ({ ...previous, [id]: '' })); }
        catch (cause) { setError(cause.message); }
    }
    async function addCard() {
        if (working.current || !storageReady || entriesRef.current.length >= 10) return;
        try { await saveEntries([...entriesRef.current, blankEntry(entriesRef.current.length + 1)]); } catch (cause) { setError(cause.message); }
    }
    async function selectFile(id, side, file) {
        if (!file || working.current) return;
        const entry = entriesRef.current.find(value => value.id === id);
        if (!entry || entry.pending || entry.card && !['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state)) return;
        working.current = true; setBusyId(id); setEntryError(previous => ({ ...previous, [id]: '' }));
        const controller = new AbortController(); conversion.current = controller;
        try {
            const prepared = await prepareIntakePhoto(file, { signal: controller.signal,
                onProgress: status => setProgress(previous => ({ ...previous, [`${id}:${side}`]: { status, percent: 0 } })) });
            if (controller.signal.aborted) return;
            await saveEntry(replaceIntakePhoto(entry, side, prepared.file, prepared), { publishAfterWrite: true });
        } catch (cause) { setEntryError(previous => ({ ...previous, [id]: cause.message })); }
        finally {
            if (conversion.current === controller) conversion.current = null;
            working.current = false; setBusyId('');
            setProgress(previous => { const next = { ...previous }; delete next[`${id}:${side}`]; return next; });
        }
    }
    async function uploadOne(id, access) {
        let entry = entriesRef.current.find(value => value.id === id);
        if (!entry || !photoEditable(entry)) return;
        setBusyId(id); setEntryError(previous => ({ ...previous, [id]: '' }));
        if (entry.pending?.path.endsWith('/queue')) return queueOne(id, access);
        // Older browser drafts used an empty category selector. The intake
        // contract accepts an unknown identity as {}, without guessing a type.
        // Never rewrite a retained request or an already-created card.
        if (!entry.card && !entry.pending && entry.identity?.category === '') {
            const identity = { ...entry.identity }; delete identity.category;
            entry = { ...entry, identity };
        }
        await uploadIntakeEntry(entry, {
            request: (path, options) => workspaceRequest(path, { ...options, csrf: access.csrf }),
            persist: saveEntry,
            onProgress: (side, status, percent) => setProgress(previous => ({ ...previous, [`${id}:${side}`]: { status, percent } }))
        });
    }
    async function queueOne(id, access) {
        let entry = entriesRef.current.find(value => value.id === id);
        if (!entry?.card || !photoEditable(entry)) return;
        if (!entry.pending && (!pairVerified(entry) || !entry.pairConfirmed)) throw new Error('Both photos must be verified and the physical pair confirmed before adding this card to the queue.');
        const pending = entry.pending ?? makePending(`${workspaceCardPath(entry.card.id)}/queue`, { expectedRevision: entry.card.revision, pairConfirmed: true }, entry.card.id);
        if (!pending.path.endsWith('/queue')) throw new Error('Recover the saved upload before adding this card to the queue.');
        entry = { ...entry, pending }; await saveEntry(entry);
        try {
            const result = await workspaceRequest(pending.path, { body: pending.body, csrf: access.csrf });
            const card = checkedCardResult(result, pending);
            // Release upload copies; retain camera HEIC files and import
            // provenance in this staff member's local draft after queuing.
            await saveEntry({ ...entry, card, pending: null, files: { FRONT: null, BACK: null } });
        } catch (cause) { if (isNotDispatched(cause)) await saveEntry({ ...entry, pending: null }); throw cause; }
    }
    async function run(ids, mode = 'upload') {
        if (working.current || !storageReady || staff.role === 'OBSERVER') return;
        working.current = true; setBusyId(ids[0] ?? ''); setError('');
        try {
            await writeChain.current;
            const access = await freshWorkspaceAccess();
            for (const id of ids) {
                setBusyId(id);
                try {
                    if (mode === 'queue' && !readyToAdd(entriesRef.current.find(entry => entry.id === id))) throw new Error('Choose both photographs and confirm that they show the same physical card.');
                    await uploadOne(id, access);
                    if (mode === 'queue') await queueOne(id, access);
                }
                catch (cause) { setEntryError(previous => ({ ...previous, [id]: workspaceMessage(cause) })); break; }
            }
        } catch (cause) { setError(workspaceMessage(cause)); }
        finally { working.current = false; setBusyId(''); }
    }
    const busy = Boolean(busyId), localCardIds = new Set(entries.map(entry => entry.card?.id)), otherDrafts = savedCards.filter(card => card.state === 'DRAFT' && !localCardIds.has(card.id));
    const visibleEntries = focusCard ? entries.filter(entry => entry.card?.id === focusCard.id) : entries;
    const confirmedEntries = visibleEntries.filter(readyToAdd), uploadEntries = visibleEntries.filter(entry => photoEditable(entry) && !entry.pending && ['FRONT', 'BACK'].some(side => entry.files[side] && !['VERIFIED', 'REJECTED'].includes(entry.uploads[side]?.phase)));
    if (staff.role === 'OBSERVER') return <Notice>This staff account has read-only access. A grader adds and confirms physical-card photographs.</Notice>;
    return <>
        {!focusCard && <><div className={styles.intakeIntro}><div><p className="eyebrow">PHOTO INTAKE</p><h1>Add cards</h1><p className="muted">Add Front and Back photos for each card. Card details can wait until grading.</p></div><Link href="/grading">View grading queues ↗</Link></div>
        <div className={styles.intakeExplanation}><span>1 <strong>Choose Front and Back</strong></span><span>2 <strong>Confirm the physical pair</strong></span><span>3 <strong>Add to the queue</strong></span><p>Adding to the queue uploads and verifies both photos. Astra can identify the card during grading; you review and approve the finished report.</p></div></>}
        {error && <Notice error>{error}</Notice>}
        {!storageReady ? <div className="empty-state" role="status">{error ? 'Photo drafts could not be opened.' : 'Opening saved photo drafts…'}</div> : <>
            {!focusCard && <div className={styles.intakeToolbar}><p>{entries.length} of 10 card slots <span>{saving ? 'Saving on this browser…' : 'Photo drafts kept on this browser'}</span></p><div className={styles.actions}><button type="button" disabled={busy || entries.length >= 10} onClick={addCard}>+ Add another card</button>{confirmedEntries.length > 1 && <button className="primary" type="button" disabled={busy} onClick={() => run(confirmedEntries.map(entry => entry.id), 'queue')}>Add {confirmedEntries.length} confirmed cards to queue</button>}</div></div>}
            <div className={focusCard ? styles.focusIntake : styles.intakeCards}>{visibleEntries.map((entry, index) => {
                const queued = !photoEditable(entry), locked = busy || Boolean(entry.pending) || queued;
                const photosVerified = pairVerified(entry), paired = hasPhotoPair(entry);
                return <section key={entry.id} className={styles.intakeCard} aria-labelledby={`intake-${entry.id}`}><div className={styles.panelHeading}><div><p className="eyebrow">CARD {String(index + 1).padStart(2, '0')}</p><h2 id={`intake-${entry.id}`}>{entry.card?.title || entry.title.trim() || `Card ${index + 1}`}</h2></div>{entry.card && <StateBadge state={entry.card.state} />}</div>
                    <div className={styles.photoPair}>{['FRONT', 'BACK'].map(side => {
                        const selected = entry.files[side], status = progress[`${entry.id}:${side}`], verified = photoVerified(entry, side);
                        const changedPhoto = selected && entry.uploads[side]?.phase === 'VERIFIED' && !verified;
                        const rejection = entry.uploads[side]?.phase === 'REJECTED' ? entry.uploads[side].rejection
                            : !selected ? cardSide(entry.card, side)?.rejection : null;
                        return <div key={side} className={styles.photoSlot}><div className={styles.photoSlotHeading}><strong>{side === 'FRONT' ? 'Front' : 'Back'}</strong><span>{verified ? '✓ Verified' : rejection ? 'Needs replacement' : changedPhoto ? 'Saved photo changed' : selected ? 'Selected' : 'Missing'}</span></div><PhotoPreview file={selected} card={entry.card} side={side} className={styles.photoThumb} /><label className={styles.filePicker}>{selected ? 'Replace photograph' : verified ? 'Replace original' : 'Choose photograph'}<input type="file" accept={PHOTO_ACCEPT} disabled={locked} onChange={event => { selectFile(entry.id, side, event.target.files?.[0]); event.target.value = ''; }} /></label><small className={styles.filename}>{selected?.name ?? (verified ? entry.photoImports?.[side] ? 'PNG saved securely' : 'Original saved securely' : 'HEIC, HEIF, JPEG, PNG or WebP · up to 50 MB')}</small>{changedPhoto && <Notice error>The saved photo changed. Select the photograph you want to use again, then confirm the pair.</Notice>}{entry.photoImports?.[side] && <div className={styles.heicImport}><small>{entry.photoImports[side].width.toLocaleString()} × {entry.photoImports[side].height.toLocaleString()} PNG · {verified ? 'saved securely' : 'ready to upload'}. Original HEIC kept in this browser.</small>{entry.sourceFiles?.[side] && <OriginalHeicDownload file={entry.sourceFiles[side]} />}</div>}{rejection && <Notice error>{uploadRejectionMessage(rejection.reason)}</Notice>}{busyId === entry.id && status && <div className={styles.uploadProgress} role="status"><progress max="100" value={status.percent} aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} upload progress`} /><span>{status.status}{status.status === 'Uploading' ? ` · ${status.percent}%` : ''}</span></div>}</div>;
                    })}</div>
                    {entryError[entry.id] && <Notice error>{entryError[entry.id]}</Notice>}
                    {entry.pending && <div className={styles.recovery}><strong>Saved request awaiting confirmation</strong><p>{entry.pending.path.endsWith('/queue') ? 'Recover the same queue request to check whether this card was added.' : 'Recover the same upload request, then add the verified pair to the queue.'}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => run([entry.id])}>Recover saved request</button><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in in another tab ↗</a></div></div>}
                    {queued ? <div className={styles.panelFooter}><p>Saved in {entry.card.state === 'WAITING' ? 'Waiting to grade' : 'the grading workspace'}.</p><Link href={`/workspace/${entry.card.id}`}>Open card ↗</Link></div> : <>
                        {!entry.card && <details className={intake.optionalLabel}><summary>Add a label (optional)</summary><fieldset disabled={locked}><label>Label<input value={entry.title} maxLength={120} onChange={event => edit(entry.id, { title: event.target.value })} /></label><p>Use a label to find this card later. No card name or type is required.</p></fieldset></details>}
                        <div className={styles.intakeCardFooter}><label className={styles.check}><input type="checkbox" checked={entry.pairConfirmed} disabled={locked || !paired} onChange={event => edit(entry.id, { pairConfirmed: event.target.checked })} /><span>I checked that these Front and Back photographs show the same physical card.</span></label><button className="primary" type="button" disabled={locked || !paired || !entry.pairConfirmed} onClick={() => run([entry.id], 'queue')}>{busyId === entry.id ? 'Saving and verifying…' : 'Add to Waiting to grade'} <span aria-hidden="true">→</span></button><p className={intake.nextStep} role="status">{!paired ? 'Choose both photos to continue.' : !entry.pairConfirmed ? 'Check the photos above and confirm the pair.' : photosVerified ? 'Both photos are verified and ready to queue.' : 'Both photos will be uploaded and verified before this card joins the queue.'}</p>{entry.card && <Link href={`/workspace/${entry.card.id}`}>Open saved card details ↗</Link>}</div>
                    </>}
                </section>;
            })}</div>
            <details className={intake.saveOnly}><summary>Save photos without queuing</summary><p>Upload any selected photos now and confirm each pair later. Partial pairs stay in Photo drafts.</p><div className={styles.actions}><button type="button" disabled={busy || !uploadEntries.length} onClick={() => run(uploadEntries.map(entry => entry.id))}>{focusCard ? 'Save selected photos' : 'Upload all selected photos'}</button></div></details>
        </>}
        {otherDrafts.length > 0 && <section className={styles.panel}><h2>Other saved photo drafts</h2><p className={styles.help}>These cards are saved to the shared workspace.</p>{otherDrafts.map(card => <Link className={styles.savedDraft} key={card.id} href={`/workspace/${card.id}`}><span>{card.title}</span><span>Resume draft ↗</span></Link>)}</section>}
        <Readiness readiness={readiness} />
    </>;
}
