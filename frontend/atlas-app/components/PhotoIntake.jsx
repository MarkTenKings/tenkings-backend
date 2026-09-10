import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { PhotoPreview, Readiness, StateBadge } from './WorkspaceShared';
import { createPhotoDraftStore } from '../lib/workspace-drafts.mjs';
import { canQueue, checkedCardResult, freshWorkspaceAccess, isNotDispatched, makePending, operationId, uploadIntakeEntry, validatePhoto, verifiedSide, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './WorkspaceUi.module.css';

const blankEntry = number => ({ id: operationId(), title: `Card ${number}`, identity: { category: '' }, files: { FRONT: null, BACK: null }, uploads: {}, card: null, pending: null, pairConfirmed: false });
export default function PhotoIntake({ staff, readiness, savedCards = [], focusCard = null, onCardUpdated }) {
    const entriesRef = useRef([]), store = useRef(null), writeChain = useRef(Promise.resolve()), working = useRef(false);
    const focusedCardRef = useRef(focusCard), focusId = focusCard?.id; focusedCardRef.current = focusCard;
    const [entries, setEntries] = useState([]), [storageReady, setStorageReady] = useState(false), [busyId, setBusyId] = useState(''), [error, setError] = useState(''), [entryError, setEntryError] = useState({}), [progress, setProgress] = useState({}), [saving, setSaving] = useState(false);
    useEffect(() => {
        let active = true; store.current = createPhotoDraftStore(staff.id);
        store.current.read().then(async values => {
            if (!active) return;
            const focused = focusedCardRef.current;
            const next = focused ? values.some(entry => entry.card?.id === focused.id) ? values.map(entry => entry.card?.id === focused.id && !entry.pending && focused.revision > entry.card.revision ? { ...entry, card: focused } : entry) : [...values, { ...blankEntry(values.length + 1), title: focused.title, identity: focused.identity ?? { category: '' }, card: focused }] : values.length ? values : [blankEntry(1)];
            await store.current.write(next);
            if (active) { entriesRef.current = next; setEntries(next); setStorageReady(true); }
        }).catch(cause => { if (active) setError(cause.message); });
        return () => { active = false; };
    }, [staff.id, focusId]);
    usePendingNavigation(() => working.current || saving, setError);
    async function saveEntries(next) {
        entriesRef.current = next; setEntries(next); setSaving(true);
        const snapshot = structuredClone(next);
        const write = writeChain.current.then(() => store.current.write(snapshot), () => store.current.write(snapshot));
        writeChain.current = write;
        try { await write; } finally { if (writeChain.current === write) setSaving(false); }
    }
    async function saveEntry(entry) { await saveEntries(entriesRef.current.map(value => value.id === entry.id ? entry : value)); if (entry.card) onCardUpdated?.(entry.card); }
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
        try {
            validatePhoto(file);
            const entry = entriesRef.current.find(value => value.id === id);
            if (entry.pending || entry.card && !['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state)) return;
            await edit(id, { files: { ...entry.files, [side]: file }, uploads: { ...entry.uploads, [side]: null }, pairConfirmed: false });
        } catch (cause) { setEntryError(previous => ({ ...previous, [id]: cause.message })); }
    }
    async function uploadOne(id, access) {
        const entry = entriesRef.current.find(value => value.id === id);
        if (!entry || (entry.card && !['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state))) return;
        if (!entry.identity.category || !entry.title.trim()) throw new Error('Choose a card type and enter a short name for this physical card.');
        setBusyId(id); setEntryError(previous => ({ ...previous, [id]: '' }));
        if (entry.pending?.path.endsWith('/queue')) return queueOne(id, access);
        await uploadIntakeEntry(entry, {
            request: (path, options) => workspaceRequest(path, { ...options, csrf: access.csrf }),
            persist: saveEntry,
            onProgress: (side, status, percent) => setProgress(previous => ({ ...previous, [`${id}:${side}`]: { status, percent } }))
        });
    }
    async function queueOne(id, access) {
        let entry = entriesRef.current.find(value => value.id === id);
        if (!entry?.card || (!entry.pending && (!canQueue(entry.card) || !entry.pairConfirmed))) return;
        const pending = entry.pending ?? makePending(`${workspaceCardPath(entry.card.id)}/queue`, { expectedRevision: entry.card.revision, pairConfirmed: true }, entry.card.id);
        if (!pending.path.endsWith('/queue')) throw new Error('Recover the saved upload before adding this card to the queue.');
        entry = { ...entry, pending }; await saveEntry(entry);
        try {
            const result = await workspaceRequest(pending.path, { body: pending.body, csrf: access.csrf });
            const card = checkedCardResult(result, pending);
            await saveEntry({ ...entry, card, pending: null, files: { FRONT: null, BACK: null } });
        } catch (cause) { if (isNotDispatched(cause)) await saveEntry({ ...entry, pending: null }); throw cause; }
    }
    async function run(ids, mode = 'upload') {
        if (working.current || !storageReady || staff.role === 'OBSERVER') return;
        working.current = true; setError('');
        try {
            await writeChain.current;
            const access = await freshWorkspaceAccess();
            for (const id of ids) {
                setBusyId(id);
                try { if (mode === 'queue') await queueOne(id, access); else await uploadOne(id, access); }
                catch (cause) { setEntryError(previous => ({ ...previous, [id]: workspaceMessage(cause) })); break; }
            }
        } catch (cause) { setError(workspaceMessage(cause)); }
        finally { working.current = false; setBusyId(''); }
    }
    const busy = Boolean(busyId), localCardIds = new Set(entries.map(entry => entry.card?.id)), otherDrafts = savedCards.filter(card => card.state === 'DRAFT' && !localCardIds.has(card.id));
    const visibleEntries = focusCard ? entries.filter(entry => entry.card?.id === focusCard.id) : entries;
    if (staff.role === 'OBSERVER') return <Notice>This staff account has read-only access. A grader adds and confirms physical-card photographs.</Notice>;
    return <>
        {!focusCard && <><div className={styles.intakeIntro}><div><p className="eyebrow">PHOTO INTAKE</p><h1>Add cards</h1><p className="muted">One physical card, one Front and Back pair. Add all ten fresh-photo cards before grading begins.</p></div><Link href="/grading">View grading queues ↗</Link></div>
        <div className={styles.intakeExplanation}><span>1 <strong>Choose the photos</strong></span><span>2 <strong>Upload and verify</strong></span><span>3 <strong>Confirm the pair and queue</strong></span><p>Uploading photos saves originals. Grading begins only when a human or Astra claims a ready card.</p></div></>}
        {error && <Notice error>{error}</Notice>}
        {!storageReady ? <div className="empty-state" role="status">{error ? 'Photo drafts could not be opened.' : 'Opening saved photo drafts…'}</div> : <>
            {!focusCard && <div className={styles.intakeToolbar}><p>{entries.length} of 10 card slots <span>· {saving ? 'Saving on this browser…' : 'Local photo drafts saved on this browser'}</span></p><div className={styles.actions}><button type="button" disabled={busy || entries.length >= 10} onClick={addCard}>+ Add another card</button><button className="primary" type="button" disabled={busy || !entries.some(entry => entry.files.FRONT || entry.files.BACK)} onClick={() => run(entries.filter(entry => !entry.card || ['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state)).map(entry => entry.id))}>{busy ? 'Saving photos…' : 'Upload all selected photos'}</button></div></div>}
            <div className={focusCard ? styles.focusIntake : styles.intakeCards}>{visibleEntries.map((entry, index) => {
                const queued = entry.card && !['DRAFT', 'NEEDS_ATTENTION'].includes(entry.card.state), locked = busy || Boolean(entry.pending) || queued;
                const photosVerified = ['FRONT', 'BACK'].every(side => verifiedSide(entry.card, side) && (!entry.files[side] || entry.uploads[side]?.phase === 'VERIFIED'));
                return <section key={entry.id} className={styles.intakeCard} aria-labelledby={`intake-${entry.id}`}><div className={styles.panelHeading}><div><p className="eyebrow">CARD {String(index + 1).padStart(2, '0')}</p><h2 id={`intake-${entry.id}`}>{entry.card?.title ?? entry.title}</h2></div>{entry.card && <StateBadge state={entry.card.state} />}</div>
                    <fieldset disabled={locked || Boolean(entry.card)} className={styles.intakeDetails}><label>Short name<input value={entry.title} maxLength={120} onChange={event => edit(entry.id, { title: event.target.value })} /></label><label>Card type<select value={entry.identity.category} onChange={event => edit(entry.id, { identity: { category: event.target.value } })}><option value="">Choose type</option><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label></fieldset>
                    <div className={styles.photoPair}>{['FRONT', 'BACK'].map(side => {
                        const selected = entry.files[side], status = progress[`${entry.id}:${side}`], verified = verifiedSide(entry.card, side) && (!selected || entry.uploads[side]?.phase === 'VERIFIED');
                        return <div key={side} className={styles.photoSlot}><div className={styles.photoSlotHeading}><strong>{side === 'FRONT' ? 'Front' : 'Back'}</strong><span>{verified ? '✓ Verified' : selected ? 'Selected' : 'Missing'}</span></div><PhotoPreview file={selected} card={entry.card} side={side} className={styles.photoThumb} /><label className={styles.filePicker}>{selected ? 'Replace photograph' : verified ? 'Replace original' : 'Choose photograph'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event => { selectFile(entry.id, side, event.target.files?.[0]); event.target.value = ''; }} /></label><small className={styles.filename}>{selected?.name ?? (verified ? 'Original saved securely' : 'JPEG, PNG or WebP · up to 50 MB')}</small>{busyId === entry.id && status && <div className={styles.uploadProgress} role="status"><progress max="100" value={status.percent} aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} upload progress`} /><span>{status.status}{status.status === 'Uploading' ? ` · ${status.percent}%` : ''}</span></div>}</div>;
                    })}</div>
                    {entryError[entry.id] && <Notice error>{entryError[entry.id]}</Notice>}
                    {entry.pending && <div className={styles.recovery}><strong>Saved request awaiting confirmation</strong><p>The same upload or queue request will be recovered.</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => run([entry.id])}>Recover saved request</button><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in in another tab ↗</a></div></div>}
                    {queued ? <div className={styles.panelFooter}><p>Saved in {entry.card.state === 'WAITING' ? 'Waiting to grade' : 'the grading workspace'}.</p><Link href={`/workspace/${entry.card.id}`}>Open card ↗</Link></div> : <div className={styles.intakeCardFooter}><button type="button" disabled={locked || !entry.identity.category || !entry.title.trim() || (!entry.files.FRONT && !entry.files.BACK)} onClick={() => run([entry.id])}>{busyId === entry.id ? 'Saving and verifying…' : entry.card ? 'Save selected photos' : 'Save card and upload photos'}</button><label className={styles.check}><input type="checkbox" checked={entry.pairConfirmed} disabled={locked || !photosVerified} onChange={event => edit(entry.id, { pairConfirmed: event.target.checked })} /><span>I checked that these Front and Back photographs show the same physical card.</span></label><button className="primary" type="button" disabled={locked || !photosVerified || !canQueue(entry.card) || !entry.pairConfirmed} onClick={() => run([entry.id], 'queue')}>Add to Waiting to grade <span>→</span></button>{entry.card && <Link href={`/workspace/${entry.card.id}`}>Open saved card details ↗</Link>}</div>}
                </section>;
            })}</div>
        </>}
        {otherDrafts.length > 0 && <section className={styles.panel}><h2>Other saved photo drafts</h2><p className={styles.help}>These cards are saved to the shared workspace.</p>{otherDrafts.map(card => <Link className={styles.savedDraft} key={card.id} href={`/workspace/${card.id}`}><span>{card.title}</span><span>Resume draft ↗</span></Link>)}</section>}
        <Readiness readiness={readiness} />
    </>;
}
