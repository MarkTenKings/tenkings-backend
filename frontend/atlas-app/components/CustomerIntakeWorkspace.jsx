import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { operationsRequest } from './MachinePreparation';
import { staffClientRequest } from '../lib/client-request.mjs';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import { CUSTOMER_ACTION_REASONS, customerCardId, customerStageLabel, customerIntakeQueue,
    customerIntakeRequest, customerIntakeReceipt, retainCustomerIntakeRequest } from '../lib/customer-intake-contract.mjs';
import styles from './CustomerIntakeWorkspace.module.css';

const messages = {
    SIGN_IN_REQUIRED: 'Your session ended. Sign in in another tab, then refresh access here.',
    FRESH_HUMAN_OPERATIONS_REQUIRED: 'Sign in again with current operations access before recording customer progress.',
    CSRF_REQUIRED: 'Your sign-in changed. Refresh access before continuing.',
    CUSTOMER_INTAKE_NOT_CONFIGURED: 'Customer intake is not enabled for this workspace.',
    CUSTOMER_INTAKE_REQUEST_INVALID: 'Check the exact card reference and required confirmation before saving.',
    STAFF_ACCESS_NOT_ENABLED: 'This staff deployment is not currently enabled.',
    NOT_FOUND: 'This submitted card or page is unavailable. Load the latest submissions.',
    SPECIMEN_ALREADY_LINKED: 'This specimen already belongs to a submitted card. Refresh and inspect its saved association.',
    PHYSICAL_RECEIPT_REQUIRED: 'This card may already be linked. Refresh its state and verify the physical receipt.',
    ENCAPSULATION_REQUIRED: 'The current approved report, label, NFC and physical finishing records must agree before shipment.',
    CUSTOMER_ACTION_REQUIRED: 'Resolve the recorded customer action before dispatch.',
    PHYSICAL_DISPATCH_REQUIRED: 'Confirm the physical handoff and enter the carrier and tracking number.',
    INVALID_CUSTOMER_MESSAGE: 'Enter a short customer message and choose what the customer needs to do.',
    ALREADY_SHIPPED: 'Shipment is already recorded for this card. Refresh to see the saved tracking details.',
    REQUEST_CONFLICT: 'This operation reference has different saved content. Keep the exact request for resolution.',
    ASSIGNMENT_REQUIRED: 'Assign this specimen to your current reviewer identity before confirming receipt.',
};
const explain = error => messages[error?.code] ?? (error?.status >= 400 && error.status < 500
    ? 'The server rejected this action. Refresh the submission and check your operations access.'
    : 'The reply could not be confirmed. Keep this tab open and retry the exact saved request.');
const stamp = value => new Date(value).toLocaleString();
const actionLabel = { bind: 'Receipt and specimen association', action: 'Customer action update', ship: 'Physical shipment' };
const intakeLabel = method => method === 'DEALER_DROP_OFF' ? 'Dealer drop-off' : 'Mail-in';

async function readQueue(cursor) {
    const path = `operations/customers${cursor ? `?cursor=${cursor}` : ''}`;
    const response = await staffClientRequest(path);
    if (!response.ok) throw Object.assign(new Error(response.data.error), { code: response.data.error, status: response.status });
    return customerIntakeQueue(response.data);
}

export default function CustomerIntakeWorkspace({ csrf, disabled = false, onPendingChange, onAssignSpecimen }) {
    const [queue, setQueue] = useState(null), [selectedId, setSelectedId] = useState('');
    const [specimenId, setSpecimenId] = useState(''), [received, setReceived] = useState(false);
    const [reason, setReason] = useState('CONTACT_SUPPORT'), [message, setMessage] = useState(''), [messageConfirmed, setMessageConfirmed] = useState(false);
    const [carrier, setCarrier] = useState(''), [trackingNumber, setTrackingNumber] = useState(''), [dispatched, setDispatched] = useState(false);
    const [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [receipt, setReceipt] = useState(null);
    const [error, setError] = useState(''), [needsReload, setNeedsReload] = useState(false);
    const saved = useRef(null), running = useRef(false), currentCsrf = useRef(csrf), cursor = useRef(null), reloadRequired = useRef(false);
    const notify = useRef(onPendingChange); notify.current = onPendingChange;
    useEffect(() => { currentCsrf.current = csrf; }, [csrf]);
    usePendingNavigation(() => Boolean(saved.current || reloadRequired.current), setError);
    useEffect(() => {
        const leaving = event => { if (saved.current || reloadRequired.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leaving);
        return () => window.removeEventListener('beforeunload', leaving);
    }, []);
    const selectedSubmission = queue?.submissions.find(row => row.cards.some(card => card.id === selectedId));
    const selected = selectedSubmission?.cards.find(card => card.id === selectedId);
    const locked = disabled || busy || Boolean(pending) || needsReload;
    function retained(request) {
        saved.current = request; setPending(request);
        notify.current?.(Boolean(request || reloadRequired.current));
    }
    async function freshAccess() {
        const session = await operationsRequest('session');
        if (!session?.staff || typeof session.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrf))
            throw Object.assign(new Error('SIGN_IN_REQUIRED'), { code: 'SIGN_IN_REQUIRED', status: 401 });
        currentCsrf.current = session.csrf;
    }
    async function load(nextCursor = null, refresh = false) {
        if (running.current || saved.current || disabled && !refresh) return;
        running.current = true; setBusy(true); setError('');
        try {
            if (refresh) await freshAccess();
            const result = await readQueue(nextCursor);
            setQueue(result); cursor.current = nextCursor;
            reloadRequired.current = false; setNeedsReload(false); notify.current?.(false);
            setReceived(false); setDispatched(false); setMessageConfirmed(false);
        } catch (caught) { setError(explain(caught)); }
        finally { running.current = false; setBusy(false); }
    }
    async function send(request, refresh = false) {
        if (running.current || !request || request !== saved.current || disabled && !refresh) return;
        running.current = true; setBusy(true); setError('');
        let attempted = false;
        try {
            if (refresh) await freshAccess();
            attempted = true;
            const result = await operationsRequest(`operations/customers/${request.action}`, { body: request.body, csrf: currentCsrf.current });
            const confirmed = customerIntakeReceipt(result, request.action, request.body);
            setReceipt(confirmed);
            // A confirmed write is never sent again merely because its follow-up
            // list failed. The separate refresh keeps stale controls disabled.
            reloadRequired.current = true; setNeedsReload(true); retained(null);
            setReceived(false); setDispatched(false); setMessageConfirmed(false);
            try {
                setQueue(await readQueue(cursor.current));
                reloadRequired.current = false; setNeedsReload(false); notify.current?.(false);
            } catch { setError('The action is saved. Refresh the recorded submissions before continuing.'); }
        } catch (caught) {
            if (!retainCustomerIntakeRequest(request, caught, attempted)) retained(null);
            else retained(request);
            setError(explain(caught));
        } finally { running.current = false; setBusy(false); }
    }
    function save(action, data) {
        if (locked || running.current || saved.current || !selected) return;
        try {
            const body = customerIntakeRequest(action, { operationId: crypto.randomUUID(), cardId: selected.id, ...data });
            const request = { action, title: selected.title, body, uncertain: false };
            setReceipt(null); retained(request); return send(request);
        } catch { setError('Complete the required fields and explicit confirmation before saving.'); }
    }
    function choose(id) {
        if (locked) return;
        setSelectedId(id); setSpecimenId(''); setReceived(false); setDispatched(false); setMessageConfirmed(false);
        setReason('CONTACT_SUPPORT'); setMessage(''); setCarrier(''); setTrackingNumber(''); setError(''); setReceipt(null);
    }
    const submit = work => event => { event.preventDefault(); return work(); };

    return <section className={styles.workspace} aria-label="Customer submissions">
        <div className={styles.heading}><div><h2>Customer submissions</h2><p>Match each received card to its grading specimen and record customer updates or physical dispatch.</p></div>
            <button type="button" disabled={locked} onClick={() => load(null)}>Load latest submissions</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {pending && <div className={styles.notice}><strong>{actionLabel[pending.action]} outcome unconfirmed</strong>
            <p>{pending.title} · Card {pending.body.cardId}</p><p>Operation {pending.body.operationId}. The exact request is retained in this tab.</p>
            <p><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in in another tab</a>, then retry this same request.</p>
            <button type="button" disabled={busy} onClick={() => send(saved.current, true)}>Retry exact customer action</button></div>}
        {!pending && <p className={styles.access}><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in again</a>
            <button type="button" disabled={busy} onClick={() => load(cursor.current, true)}>Refresh access and submissions</button></p>}
        {receipt && <p className={styles.notice} role="status">{receipt.kind === 'RECEIVED' ? 'Physical receipt and association recorded'
            : receipt.kind === 'SHIPPED' ? 'Physical shipment recorded' : 'Customer action update recorded'} at {stamp(receipt.recordedAt)}. Receipt {receipt.id}.</p>}
        {needsReload && <p role="status">The saved action is confirmed. Refresh access and submissions to load its recorded state.</p>}
        {queue && <>
            {!queue.submissions.length ? <p>No customer submissions on this page.</p> : <>
                <ul className={styles.submissions}>{queue.submissions.map(submission => <li key={submission.id}>
                    <div><strong>{submission.reference}</strong><span>{submission.profileSnapshot.name} · {stamp(submission.createdAt)}</span><span>{intakeLabel(submission.intakeMethod)}</span>
                        <span>{submission.cards.filter(card => card.stage === 'SHIPPED').length} of {submission.cards.length} cards shipped</span></div>
                    <ul>{submission.cards.map(card => <li key={card.id}><button type="button" disabled={locked}
                        aria-pressed={card.id === selectedId} onClick={() => choose(card.id)}>{card.title}</button>
                        <span>{customerStageLabel(card.stage)}{card.actionNeeded ? ' · Customer action needed' : ''}</span></li>)}</ul>
                </li>)}</ul>
                <div className={styles.pagination}><button type="button" disabled={locked || !queue.nextCursor} onClick={() => load(queue.nextCursor)}>Older submissions</button></div>
            </>}
        </>}
        {selected && <article className={styles.card}>
            <p className={styles.reference}>{selectedSubmission.reference} · Card {selected.id}</p><h3>{selected.title}</h3>
            <p>{customerStageLabel(selected.stage)} · {selected.category === 'POKEMON' ? 'Pokémon' : 'Sports'} · {intakeLabel(selectedSubmission.intakeMethod)}</p>
            <ol className={styles.events}>{selected.events.map(event => <li key={event.kind}><span>{customerStageLabel(event.kind)}</span><time dateTime={event.recordedAt}>{stamp(event.recordedAt)}</time></li>)}</ol>
            <details><summary>Confirmed return address</summary><address>{selectedSubmission.profileSnapshot.name}<br />{selectedSubmission.profileSnapshot.address1}<br />
                {selectedSubmission.profileSnapshot.address2 && <>{selectedSubmission.profileSnapshot.address2}<br /></>}
                {selectedSubmission.profileSnapshot.city}, {selectedSubmission.profileSnapshot.region} {selectedSubmission.profileSnapshot.postalCode}<br />{selectedSubmission.profileSnapshot.country}</address></details>
            {selected.reportUrl && <p><a href={selected.reportUrl} target="_blank" rel="noreferrer">Open approved public report →</a></p>}
            {selected.specimenId ? <p>Bound specimen: <Link href={`/cards/${selected.specimenId}`}>{selected.specimenId}</Link></p>
                : <form onSubmit={submit(() => received && save('bind', { specimenId, physicalReceiptConfirmed: true }))}>
                    <fieldset disabled={locked}><legend>Receive and associate this card</legend><p>Inspect the physical card and the captured specimen before recording receipt. Each specimen can belong to one customer card.</p>
                        <label>Exact grading specimen reference<input required value={specimenId} autoComplete="off" spellCheck={false} maxLength={36}
                            onChange={event => { setSpecimenId(event.target.value.trim()); setReceived(false); }}/></label>
                        {customerCardId(specimenId) && <p><Link href={`/cards/${specimenId}`} target="_blank" rel="noreferrer">Inspect this grading specimen →</Link>
                            {onAssignSpecimen && <button type="button" onClick={() => onAssignSpecimen(specimenId)}>Open staff assignment</button>}</p>}
                        <label className={styles.check}><input type="checkbox" checked={received} onChange={event => setReceived(event.target.checked)}/>
                            I physically received this customer card and matched it to this exact grading specimen.</label>
                        <button type="submit" disabled={!received || !customerCardId(specimenId)}>Confirm receipt and bind specimen</button>
                    </fieldset></form>}
            {selected.actionNeeded && <div className={styles.notice}><strong>Customer action needed: {CUSTOMER_ACTION_REASONS[selected.actionNeeded.reason]}</strong>
                <p>{selected.actionNeeded.message}</p><p>{stamp(selected.actionNeeded.recordedAt)}</p>
                <button type="button" disabled={locked} onClick={() => save('action', { reason: selected.actionNeeded.reason, message: null, resolved: true })}>Mark customer action resolved</button></div>}
            {selected.stage !== 'SHIPPED' && <form onSubmit={submit(() => messageConfirmed && save('action', { reason, message: message.trim(), resolved: false }))}>
                <fieldset disabled={locked}><legend>Ask the customer to act</legend><label>What the customer needs to do<select value={reason} onChange={event => { setReason(event.target.value); setMessageConfirmed(false); }}>
                    {Object.entries(CUSTOMER_ACTION_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Message shown in the customer’s tracker<input type="text" required maxLength={500} value={message}
                        onChange={event => { setMessage(event.target.value); setMessageConfirmed(false); }}/></label>
                    <label className={styles.check}><input type="checkbox" checked={messageConfirmed} onChange={event => setMessageConfirmed(event.target.checked)}/>
                        I reviewed this customer-visible message.</label><button type="submit" disabled={!messageConfirmed || !message.trim()}>Record customer action needed</button>
                </fieldset></form>}
            {selected.shipment ? <div className={styles.notice}><strong>Shipment recorded</strong><p>{selected.shipment.carrier} · {selected.shipment.trackingNumber}</p>
                <p>Physically dispatched {stamp(selected.shipment.recordedAt)}</p></div>
                : <form onSubmit={submit(() => dispatched && selected.stage === 'ENCAPSULATED' && !selected.actionNeeded
                    && save('ship', { carrier: carrier.trim(), trackingNumber: trackingNumber.trim(), physicalDispatchConfirmed: true }))}>
                    <fieldset disabled={locked || selected.stage !== 'ENCAPSULATED' || Boolean(selected.actionNeeded)}><legend>Record physical shipment</legend>
                        <p>Shipment is available after the approved report and recorded assembly and sonic welding. Confirm dispatch only after physically handing this card to the carrier.</p>
                        {selected.actionNeeded && <p>Resolve the customer action before dispatch.</p>}
                        <div className={styles.fields}><label>Carrier<input required minLength={2} maxLength={60} value={carrier} onChange={event => { setCarrier(event.target.value); setDispatched(false); }}/></label>
                            <label>Tracking number<input required minLength={3} maxLength={100} value={trackingNumber} onChange={event => { setTrackingNumber(event.target.value); setDispatched(false); }}/></label></div>
                        <label className={styles.check}><input type="checkbox" checked={dispatched} onChange={event => setDispatched(event.target.checked)}/>
                            I physically handed this exact card to the carrier using this tracking number.</label>
                        <button type="submit" disabled={!dispatched}>Confirm physical shipment</button>
                    </fieldset></form>}
        </article>}
    </section>;
}
