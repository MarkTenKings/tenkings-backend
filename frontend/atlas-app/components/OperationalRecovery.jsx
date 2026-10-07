import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { useEffect, useState } from 'react';
import { useRetainedOperation } from './MachinePreparation';
import styles from './OperationalRecovery.module.css';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const names = { INITIALIZATION: 'Queued preparation', ASTRA: 'Uncertain Astra run', WORKER: 'Uncertain grading worker' };
const fail = () => { throw Object.assign(new Error('OUTCOME_UNCONFIRMED'), { code: 'OUTCOME_UNCONFIRMED', status: 0 }); };
export function recoveryTargets(initializations, runs, costs) {
    return [...initializations.filter(row => row.state === 'QUEUED').map(row => ({ kind: 'INITIALIZATION', recordId: row.id, specimenId: row.specimenId })),
        ...runs.filter(row => row.state === 'UNKNOWN').map(row => ({ kind: 'ASTRA', recordId: row.id, specimenId: row.specimenId })),
        ...costs.filter(row => row.kind === 'WORKER' && row.state === 'UNKNOWN').map(row => ({ kind: 'WORKER', recordId: row.recordId, specimenId: row.specimenId }))]
        .filter(row => UUID.test(row.recordId) && UUID.test(row.specimenId));
}
function validHolds(holds) {
    return holds?.scope === 'TARGET' && holds.accountingChanged === false && Number.isSafeInteger(holds.records) && holds.records >= 0
        && ['reservedMicroUsd', 'unsettledMicroUsd', 'actualMicroUsd'].every(key => typeof holds[key] === 'string' && /^(0|[1-9]\d{0,30})$/.test(holds[key]));
}
function usd(value) { const amount = BigInt(value); return `$${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')} USD`; }
function Holds({ value }) { return <dl className={styles.holds}><div><dt>Reserved</dt><dd>{usd(value.reservedMicroUsd)}</dd></div>
    <div><dt>Unsettled · still held</dt><dd>{usd(value.unsettledMicroUsd)}</dd></div><div><dt>Recorded actual cost</dt><dd>{usd(value.actualMicroUsd)}</dd></div></dl>; }

export default function OperationalRecovery({ csrf, pilotId, specimens = [], initializations = [], runs = [], costs = [], disabled = false, onChanged }) {
    const request = useRetainedOperation({ csrf, disabled, onChanged });
    const [key, setKey] = useState(''), [preview, setPreview] = useState(null), [reason, setReason] = useState(''), [evidence, setEvidence] = useState('');
    const [confirmed, setConfirmed] = useState(false), [receipt, setReceipt] = useState(null), [resolved, setResolved] = useState([]);
    const targets = recoveryTargets(initializations, runs, costs).filter(row => !resolved.includes(`${pilotId}:${row.kind}:${row.recordId}`));
    const target = targets.find(row => `${row.kind}:${row.recordId}` === key);
    const inspected = preview && target && preview.pilotId === pilotId && preview.kind === target.kind && preview.recordId === target.recordId ? preview : null;
    const ready = inspected && (inspected.kind === 'INITIALIZATION' ? inspected.state === 'QUEUED' : inspected.state === 'UNKNOWN');
    useEffect(() => { setPreview(null); setConfirmed(false); setReceipt(null); setReason(''); setEvidence(''); }, [pilotId, key]);
    function inspect() {
        if (!target || !UUID.test(pilotId) || request.locked) return;
        setPreview(null); setConfirmed(false);
        const expected = { kind: target.kind, recordId: target.recordId, pilotId };
        void request.read('operations/resolution/inspect', expected, data => {
            const record = data?.record;
            if (!record || Object.keys(expected).some(k => record[k] !== expected[k]) || record.specimenId !== target.specimenId
                || !SHA.test(record.bindingHash) || !validHolds(record.holds) || typeof record.state !== 'string') fail();
            setPreview(record);
        });
    }
    function resolve() {
        if (!ready || !confirmed || !reason.trim() || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason) || !SHA.test(evidence)) return;
        const body = { operationId: crypto.randomUUID(), recordId: inspected.recordId, pilotId: inspected.pilotId,
            expectedBindingHash: inspected.bindingHash, evidenceHash: evidence, reason,
            ...(inspected.kind === 'INITIALIZATION' ? {} : { kind: inspected.kind }) };
        request.run({ label: names[inspected.kind], path: inspected.kind === 'INITIALIZATION'
            ? 'operations/resolution/cancel-initialization' : 'operations/resolution/abandon', body,
            accept: data => {
                const result = data?.receipt;
                if (!result || result.recordId !== inspected.recordId || result.pilotId !== inspected.pilotId || result.kind !== inspected.kind
                    || result.specimenId !== inspected.specimenId || result.state !== 'FAILED' || !validHolds(result.holds)
                    || result.nextAction !== 'HUMAN_INSPECTION_OR_RECAPTURE') fail();
                setReceipt(result); setPreview(null); setConfirmed(false);
                setResolved(rows => [...rows, `${inspected.pilotId}:${inspected.kind}:${inspected.recordId}`]);
            } });
    }
    return <section className={styles.panel} aria-label="Human operational recovery"><h3>Human operational recovery</h3>
        <p>Inspect the exact queued preparation or uncertain operation before recording a decision. Recovery preserves history and cost evidence. Unsettled reserves stay held.</p>
        {request.error && <p className={styles.error} role="alert">{request.error}</p>}
        {request.pending && <div className={styles.notice}><strong>Recovery outcome unconfirmed</strong><p>The exact decision, evidence and operation reference remain in this tab. Resolve this save before changing targets.</p>
            <p>Pilot {request.pending.pilotId} · Operation {request.pending.id}</p>
            <p><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in in another tab</a>, then retry this same recovery decision here.</p>
            <button type="button" disabled={request.busy} onClick={request.retry}>Retry exact recovery decision</button></div>}
        <fieldset className={styles.form} disabled={request.locked}><label>Record to inspect<select value={target ? key : ''} onChange={e => { setKey(e.target.value); request.clearError(); }}>
            <option value="">Choose a queued or uncertain record…</option>{targets.map(row => <option key={`${row.kind}:${row.recordId}`} value={`${row.kind}:${row.recordId}`}>
                {names[row.kind]} · {specimens.find(card => card.specimenId === row.specimenId)?.title ?? row.specimenId} · {row.recordId}</option>)}</select></label>
            <button type="button" disabled={!target || !UUID.test(pilotId)} onClick={inspect}>Inspect exact recovery record</button>
            {!targets.length && <p>No queued preparations or uncertain Astra/worker records are shown. Refresh the pilot summary for current state.</p>}
        </fieldset>
        {inspected && <div className={styles.preview}><h4>{names[inspected.kind]}</h4><p>{specimens.find(card => card.specimenId === inspected.specimenId)?.title ?? 'Pilot specimen'} · {inspected.specimenId}</p>
            <p>Inspected state: {inspected.state.toLowerCase().replaceAll('_', ' ')} · Record {inspected.recordId}</p><Holds value={inspected.holds}/>
            {!ready ? <p>This state is no longer eligible. Refresh the pilot summary and inspect the current record.</p> : <fieldset className={styles.form} disabled={request.locked}>
                <label>Reason for this recovery<textarea value={reason} rows={3} maxLength={500} onChange={e => { setReason(e.target.value); setConfirmed(false); }}/></label>
                <label>Incident or outcome evidence checksum<input value={evidence} maxLength={64} spellCheck={false} autoComplete="off" onChange={e => { setEvidence(e.target.value.trim()); setConfirmed(false); }}/>
                    <small>SHA-256 of the retained external incident or outcome evidence, after your inspection.</small></label>
                <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{inspected.kind === 'INITIALIZATION'
                    ? 'I inspected this exact preparation and confirm cancellation before dispatch. I understand that new automation requires human inspection or recapture.'
                    : 'I inspected the external outcome for this exact uncertain operation and confirm abandonment of its unapplied work. I understand that cost reserves remain held and this schedules no retry.'}</label>
                <button type="button" disabled={!confirmed || !reason.trim() || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason) || !SHA.test(evidence)} onClick={resolve}>
                    {inspected.kind === 'INITIALIZATION' ? 'Record cancellation before dispatch' : 'Record human abandonment'}</button>
            </fieldset>}</div>}
        {receipt && <div className={styles.notice} role="status"><strong>{receipt.kind === 'INITIALIZATION' ? 'Cancellation recorded' : 'Human abandonment recorded'}</strong>
            <p>Record {receipt.recordId} · Pilot {receipt.pilotId} · State: failed.</p><Holds value={receipt.holds}/>
            <p>History, receipts and cost evidence remain retained. Unsettled reserves stay held; no retry or new work was scheduled.</p>
            <p>Next step: human inspection or recapture before any new automation.</p></div>}
    </section>;
}
