import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { useStaffResource } from '../lib/client';
import MachinePreparation, { operationsRequest } from './MachinePreparation';
import OperationalRecovery from './OperationalRecovery';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './OperationsWorkspace.module.css';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const messages = {
    FRESH_HUMAN_OPERATIONS_REQUIRED: 'A recent sign-in and current operations grant are required. Sign in again before continuing.',
    OPERATIONS_NOT_CONFIGURED: 'Operations is not enabled in this workspace.',
    INTAKE_SOURCE_VALIDATOR_REQUIRED: 'Source intake is not connected in this workspace.',
    INTAKE_SOURCE_CHANGED: 'The source changed after your preview. Preview the exact session again before admitting it.',
    INTAKE_EVIDENCE_REQUIRED: 'Both preserved card sides must be available before intake.',
    SOURCE_ALREADY_ADMITTED: 'This source already has a specimen. Preview it again to load its existing reference.',
    STAFF_ACCESS_CHANGED: 'This staff record changed. Refresh the roster before saving.',
    ASSIGNMENT_CHANGED: 'This assignment changed. Load the pilot summary and use its current assignment revision.',
    ASSIGNMENT_NOT_ALLOWED: 'Check the person’s current access, reviewer role and assignment expiry.',
    PILOT_EVIDENCE_CHANGED: 'A selected specimen changed. Preview that source again and replace its pilot selection.',
    PILOT_WINDOW_EXPIRED: 'Choose a future end time for this pilot.',
    INVOICE_BINDING_CHANGED: 'The selected cost record changed. Reload the pilot summary.',
    INVOICE_ALREADY_RECONCILED: 'An actual cost is already recorded for this attempt. Reload the summary to inspect it.',
    INVOICE_LINE_ALREADY_USED: 'That invoice document line has already been reconciled to another attempt.',
    INVOICE_WORK_NOT_TERMINAL: 'Wait for this attempt to finish or enter reconciliation before recording its invoice.',
    INVOICE_DISPATCH_REQUIRED: 'This attempt was never dispatched and cannot receive an invoice charge here.',
    OPERATIONS_REQUEST_CONFLICT: 'This request reference has different saved content. Reload the recorded result before continuing.',
};
const localDate = value => {
    if (!value) return '';
    const date = new Date(value);
    return new Date(+date - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const isoDate = value => { const d = new Date(value); if (!value || !Number.isFinite(+d)) throw new Error('Choose a valid date and time.'); return d.toISOString(); };
const requireId = value => { if (!UUID.test(value)) throw new Error('Enter the exact specimen, staff or pilot reference.'); return value; };
const integer = (value, min, max) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
        throw new Error(`Enter a whole number from ${min} to ${max}.`);
    return Number(value);
};
function microUsd(value) {
    if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('Enter a USD amount with up to six decimal places.');
    const [whole, fraction = ''] = value.split('.'), micro = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    if (micro > 1_000_000_000_000n) throw new Error('The USD amount exceeds the supported limit.');
    return micro.toString();
}
function usd(value) {
    const amount = BigInt(value ?? '0');
    return `$${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')} USD`;
}
function Field({ label, help, children }) { return <label className={styles.field}><span>{label}</span>{children}{help && <small>{help}</small>}</label>; }
function Panel({ title, children, description }) { return <section className={styles.panel}><h2>{title}</h2>{description && <p className={styles.description}>{description}</p>}{children}</section>; }

export default function OperationsWorkspace() {
    const resource = useStaffResource('operations/roster');
    if (resource.loading) return <div className="empty-state" role="status">Loading operations access…</div>;
    if (resource.error) return <div className="empty-state"><Notice error>{resource.error}</Notice>
        {resource.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button onClick={resource.reload}>Retry operations access</button>}</div>;
    return <Workspace initialRoster={resource.data.roster} csrf={resource.session.csrf} mode={resource.session.mode} />;
}

function Workspace({ initialRoster, csrf, mode }) {
    const [currentCsrf, setCurrentCsrf] = useState(csrf);
    const [tab, setTab] = useState('intake'), [roster, setRoster] = useState(initialRoster);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(''), [signedOut, setSignedOut] = useState(false);
    const pending = useRef(null), busyRef = useRef(false), [pendingLabel, setPendingLabel] = useState('');
    usePendingNavigation(()=>Boolean(pending.current),setError);
    const [reason, setReason] = useState(''), [authorizationHash, setAuthorizationHash] = useState('');
    const [sourceId, setSourceId] = useState(''), [sourceOwnerId, setSourceOwnerId] = useState(''), [preview, setPreview] = useState(null);
    const [pilotCards, setPilotCards] = useState([]), [pilotId, setPilotId] = useState(''), [summary, setSummary] = useState(null);
    const pilotIdRef = useRef(pilotId); pilotIdRef.current = pilotId;
    const [policy, setPolicy] = useState({ expiresAt: '', maxOperationsPerCard: '', maxTotalUsd: '', maxCardUsd: '', reservationUsd: '', maxWorkerCalls: '', deadlineSeconds: '' });
    const [selectedPerson, setSelectedPerson] = useState(''), [person, setPerson] = useState({ role: 'REVIEWER', revoked: false, certificationUntil: '', trustedLearningUntil: '' });
    const [assignment, setAssignment] = useState({ specimenId: '', identityId: '', existing: false, expectedFence: '', canReview: false, expiresAt: '', revoked: false });
    const [invoice, setInvoice] = useState({ recordKey: '', invoiceId: '', lineId: '', documentSha256: '', actualUsd: '' });
    const locked = busy || Boolean(pendingLabel) || signedOut;
    const selected = roster.find(row => row.id === selectedPerson);
    useEffect(() => {
        const leaving = event => { if (pending.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leaving);
        return () => window.removeEventListener('beforeunload', leaving);
    }, []);
    useEffect(() => {
        if (selected) setPerson({ role: selected.role, revoked: Boolean(selected.revokedAt),
            certificationUntil: localDate(selected.certificationUntil), trustedLearningUntil: localDate(selected.trustedLearningUntil) });
    }, [selected]);
    const onSubmit = fn => event => { event.preventDefault(); try { fn(); } catch (e) { setError(e.message); setSaved(''); } };
    const editSource = fn => event => { fn(event.target.value); setPreview(null); };
    const editPolicy = key => event => setPolicy(p => ({ ...p, [key]: event.target.value }));

    async function send(request) {
        if (busyRef.current || !request) return;
        busyRef.current = true;
        setBusy(true); setError(''); setSaved('');
        try {
            const data = await operationsRequest(request.path, { body: request.body, csrf: currentCsrf });
            request.onSuccess(data);
            pending.current = null; setPendingLabel('');
            setSaved(request.success);
        } catch (e) {
            setError(messages[e.code] ?? e.message);
            if (['SIGN_IN_REQUIRED', 'FRESH_HUMAN_OPERATIONS_REQUIRED'].includes(e.code)) setSignedOut(true);
            // A later rejection cannot erase an earlier unconfirmed save.
            request.uncertain ||= !e.status || e.status >= 500;
            if (!request.uncertain && e.status >= 400 && e.status < 500) { pending.current = null; setPendingLabel(''); }
        } finally { busyRef.current = false; setBusy(false); }
    }
    function request(label, path, body, onSuccess, success, mutation = true) {
        if (locked || busyRef.current || pending.current) return;
        let packet = body;
        if (mutation) {
            if (!reason.trim() || reason.length > 500 || !SHA.test(authorizationHash)) throw new Error('Enter the reason and authorization record checksum before saving a change.');
            packet = { ...body, reason, authorizationEvidenceHash: authorizationHash, operationId: crypto.randomUUID() };
        }
        const next = { label, path, body: structuredClone(packet), onSuccess, success, uncertain: false };
        if (mutation) { pending.current = next; setPendingLabel(label); }
        void send(next);
    }
    function addPilotCard(card) {
        setPilotCards(rows => [...rows.filter(row => row.specimenId !== card.specimenId), card]);
        setAssignment(value => ({ ...value, specimenId: card.specimenId }));
    }
    function previewSource() {
        request('Preview source', 'operations/intake/preview', { sourceType: mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE', sourceId, sourceOwnerId },
            data => setPreview(data.preview), 'Source preview loaded. Check the card and source before continuing.', false);
    }
    function admit() {
        if (!preview || preview.existingSpecimenId) return;
        request('Admit captured source', 'operations/intake/admit', {
            source: { sourceType: preview.sourceType, sourceId: preview.sourceId, sourceOwnerId: preview.sourceOwnerId }, sourceBindingHash: preview.sourceBindingHash,
        }, data => {
            setPreview(value => ({ ...value, existingSpecimenId: data.receipt.specimenId }));
            setAssignment(value => ({ ...value, specimenId: data.receipt.specimenId }));
        }, 'The captured source was admitted. It is ready for a staff assignment.');
    }
    function savePerson() {
        if (!selected) throw new Error('Choose an existing staff identity.');
        const update = { identityId: selected.id, expectedAccessVersion: selected.accessVersion, role: person.role, revoked: person.revoked,
            certificationUntil: person.certificationUntil ? isoDate(person.certificationUntil) : null,
            trustedLearningUntil: person.trustedLearningUntil ? isoDate(person.trustedLearningUntil) : null };
        request('Save staff access', 'operations/roster/update', update, data => setRoster(rows => rows.map(row => row.id === selected.id
            ? { ...row, ...update, accessVersion: data.receipt.accessVersion, revokedAt: person.revoked ? new Date().toISOString() : null } : row)),
        'Staff access was saved. Previous sessions must sign in again.');
    }
    function saveAssignment() {
        request('Save assignment', 'operations/assign', { specimenId: requireId(assignment.specimenId), identityId: requireId(assignment.identityId),
            expectedFence: assignment.existing ? integer(assignment.expectedFence, 1, 2147483646) : null,
            canReview: assignment.canReview, expiresAt: isoDate(assignment.expiresAt), revoked: assignment.revoked },
        data => setAssignment(value => ({ ...value, existing: true, expectedFence: String(data.receipt.fence) })), 'Assignment saved. Reload the pilot summary to see its current state.');
    }
    function preparePilot() {
        if (pilotCards.length !== 10) throw new Error('Select exactly ten previewed specimens for the first pilot.');
        const policyInput = { version: 'atlas-grading-bridge-policy-v1', pilotId: requireId(pilotId), specimenIds: pilotCards.map(row => row.specimenId),
            expiresAt: isoDate(policy.expiresAt), maxOperationsPerCard: integer(policy.maxOperationsPerCard, 1, 100),
            maxTotalMicroUsd: Number(microUsd(policy.maxTotalUsd)), maxCardMicroUsd: Number(microUsd(policy.maxCardUsd)),
            reservationPerOperationMicroUsd: Number(microUsd(policy.reservationUsd)), maxWorkerCalls: integer(policy.maxWorkerCalls, 1, 4),
            deadlineMs: integer(policy.deadlineSeconds, 1, 200) * 1000 };
        if (policyInput.reservationPerOperationMicroUsd < 1 || policyInput.reservationPerOperationMicroUsd > policyInput.maxCardMicroUsd
            || policyInput.maxCardMicroUsd > policyInput.maxTotalMicroUsd)
            throw new Error('Use positive limits with the worker reservation no greater than the card limit, and the card limit no greater than the pilot total.');
        request('Prepare ten-card pilot', 'operations/pilots/prepare', { policy: policyInput,
            specimens: pilotCards.map(({ specimenId, evidenceHash, sourceBindingHash }) => ({ specimenId, evidenceHash, sourceBindingHash })) },
        () => {}, 'The ten-card configuration is saved for review. Grading has not been started.');
    }
    function loadSummary() {
        request('Load pilot summary', `operations/pilots/${requireId(pilotId)}`, undefined, data => { setSummary(data.summary); setInvoice(value => ({ ...value, recordKey: '' })); }, 'Pilot summary updated.', false);
    }
    async function refreshPilotSummary() {
        const expected = requireId(pilotIdRef.current);
        const data = await operationsRequest(`operations/pilots/${expected}`);
        if (pilotIdRef.current === expected && data.summary?.pilotId === expected) setSummary(data.summary);
    }
    async function refreshAccess() {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try {
            const session = await operationsRequest('session');
            if (!session.staff || !SHA.test(session.csrf)) throw new Error('Sign in in another tab, then refresh access here.');
            const data = await operationsRequest('operations/roster');
            setCurrentCsrf(session.csrf); setRoster(data.roster); setSignedOut(false);
        } catch (e) { setError(messages[e.code] ?? e.message); }
        finally { busyRef.current = false; setBusy(false); }
    }
    function reconcile() {
        const cost = summary?.costs.find(row => `${row.kind}:${row.recordId}` === invoice.recordKey);
        if (!cost || cost.actualMicroUsd !== null) throw new Error('Choose an unsettled attempt from the loaded pilot summary.');
        if (!SHA.test(invoice.documentSha256)) throw new Error('Enter the exact invoice document checksum.');
        const actualMicroUsd = microUsd(invoice.actualUsd);
        request('Record actual invoice cost', 'operations/invoices/reconcile', { kind: cost.kind, recordId: cost.recordId,
            pilotId: summary.pilotId, expectedBindingHash: cost.bindingHash, invoice: { invoiceId: invoice.invoiceId, lineId: invoice.lineId,
                documentSha256: invoice.documentSha256, actualMicroUsd } },
        () => { setSummary(null); setInvoice({ recordKey: '', invoiceId: '', lineId: '', documentSha256: '', actualUsd: '' }); },
        'Invoice cost recorded. Reload the pilot summary to inspect the updated totals.');
    }

    return <div className={styles.workspace}>
        {error && <Notice error>{error}</Notice>}{saved && <Notice>{saved}</Notice>}
        {signedOut && <p><Link className="text-button" href="/?reauthenticate=1" target="_blank" rel="noopener noreferrer">Sign in in another tab →</Link>
            <button className="text-button" type="button" disabled={busy} onClick={refreshAccess}>Refresh access in this tab</button></p>}
        {pendingLabel && !busy && !signedOut && <Notice>The result of “{pendingLabel}” is unconfirmed. Your exact request is retained.
            <button className="text-button" type="button" onClick={() => void send(pending.current)}>Check the same request again</button></Notice>}
        <details className={styles.authorization} open><summary>Authorization for changes</summary><p>Use the recorded authorization for the intake, staff or cost changes you are making.</p>
            <fieldset disabled={locked} className={styles.grid}><Field label="Reason for this change"><textarea maxLength={500} rows={2} value={reason} onChange={e => setReason(e.target.value)} /></Field>
                <Field label="Authorization record checksum" help="SHA-256 of the retained authorization record."><input value={authorizationHash} maxLength={64} spellCheck={false} autoComplete="off" onChange={e => setAuthorizationHash(e.target.value.trim())} /></Field></fieldset></details>
        <nav className={styles.tabs} aria-label="Operations sections">{[['intake', 'Source intake'], ['staff', 'Staff & assignments'], ['pilot', `Ten-card pilot (${pilotCards.length}/10)`]].map(([key, label]) =>
            <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? styles.activeTab : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
        <p className={styles.timezone}>Dates and times use this computer’s local time zone.</p>

        <div hidden={tab !== 'intake'}><Panel title="Admit a captured card" description="Locate the exact preserved capture and verify its source before creating an ATLAS specimen.">
            <form onSubmit={onSubmit(previewSource)}><fieldset disabled={locked}><div className={styles.grid}>
                <Field label="Capture session reference"><input required maxLength={128} value={sourceId} spellCheck={false} autoComplete="off" onChange={editSource(setSourceId)} /></Field>
                <Field label="Source owner reference"><input required maxLength={128} value={sourceOwnerId} spellCheck={false} autoComplete="off" onChange={editSource(setSourceOwnerId)} /></Field>
            </div><button className="primary" type="submit">Preview exact source</button></fieldset></form>
            {preview && <article className={styles.preview}><p className="eyebrow">SOURCE PREVIEW</p><h3>{preview.title}</h3><p>{preview.subtitle}</p>
                <dl><dt>Capture session</dt><dd>{preview.sourceId}</dd><dt>Source owner</dt><dd>{preview.sourceOwnerId}</dd><dt>Captured revision</dt><dd>{preview.sourceRevision}</dd>
                    {preview.existingSpecimenId && <><dt>ATLAS specimen</dt><dd>{preview.existingSpecimenId}</dd></>}</dl>
                <p>Front and Back evidence have passed source admission checks.</p><div className={styles.actions}>
                    {!preview.existingSpecimenId && <button type="button" className="primary" disabled={locked} onClick={onSubmit(admit)}>Admit this captured card</button>}
                    {preview.existingSpecimenId && <button type="button" disabled={locked || (pilotCards.length >= 10 && !pilotCards.some(row => row.specimenId === preview.existingSpecimenId))}
                        onClick={() => addPilotCard({ specimenId: preview.existingSpecimenId, evidenceHash: preview.evidenceHash,
                            sourceBindingHash: preview.sourceBindingHash, title: preview.title })}>Add this specimen to pilot</button>}
                    {preview.existingSpecimenId && <button type="button" className="text-button" disabled={locked} onClick={() => { setAssignment(v => ({ ...v, specimenId: preview.existingSpecimenId })); setTab('staff'); }}>Assign staff →</button>}
                </div></article>}
        </Panel></div>

        <div hidden={tab !== 'staff'} className={styles.stack}><Panel title="Staff access" description="Choose an existing staff identity. Report certification and trusted-learning approval have separate expiry dates.">
            <form onSubmit={onSubmit(savePerson)}><fieldset disabled={locked}><div className={styles.grid}>
                <Field label="Staff identity"><select required value={selectedPerson} onChange={e => setSelectedPerson(e.target.value)}><option value="">Choose staff…</option>{roster.map(row => <option key={row.id} value={row.id}>{row.name} · {row.id.slice(0, 8)}{row.revokedAt ? ' · Revoked' : ''}</option>)}</select></Field>
                <Field label="Workspace access"><select value={person.role} onChange={e => setPerson(v => ({ ...v, role: e.target.value }))}><option value="REVIEWER">Reviewer</option><option value="OBSERVER">Observer</option></select></Field>
                <Field label="Report certification expires" help="Leave blank to remove report certification."><input type="datetime-local" value={person.certificationUntil} onChange={e => setPerson(v => ({ ...v, certificationUntil: e.target.value }))} /></Field>
                <Field label="Trusted-learning approval expires" help="Leave blank to remove trusted-learning approval."><input type="datetime-local" value={person.trustedLearningUntil} onChange={e => setPerson(v => ({ ...v, trustedLearningUntil: e.target.value }))} /></Field>
            </div><label className={styles.check}><input type="checkbox" checked={person.revoked} onChange={e => setPerson(v => ({ ...v, revoked: e.target.checked }))} />Revoke this person’s workspace access</label>
                <button className="primary" type="submit" disabled={!selected}>Save staff access</button>
                <button className="text-button" type="button" onClick={() => request('Refresh roster', 'operations/roster', undefined, data => setRoster(data.roster), 'Staff roster refreshed.', false)}>Refresh roster</button>
            </fieldset></form>
        </Panel><Panel title="Assign a specimen" description="Give an existing reviewer or observer access to one exact specimen. All times use this computer’s local time zone.">
            <form onSubmit={onSubmit(saveAssignment)}><fieldset disabled={locked}><div className={styles.grid}>
                <Field label="Specimen reference"><input required value={assignment.specimenId} maxLength={36} spellCheck={false} onChange={e => setAssignment(v => ({ ...v, specimenId: e.target.value }))} /></Field>
                <Field label="Staff identity"><select required value={assignment.identityId} onChange={e => setAssignment(v => ({ ...v, identityId: e.target.value }))}><option value="">Choose staff…</option>{roster.map(row => <option key={row.id} value={row.id}>{row.name} · {row.id.slice(0, 8)}</option>)}</select></Field>
                <Field label="Assignment expires"><input type="datetime-local" required value={assignment.expiresAt} onChange={e => setAssignment(v => ({ ...v, expiresAt: e.target.value }))} /></Field>
                <Field label="Assignment action"><select value={assignment.existing ? 'update' : 'create'} onChange={e => setAssignment(v => ({ ...v, existing: e.target.value === 'update' }))}><option value="create">Create assignment</option><option value="update">Update existing assignment</option></select></Field>
                {assignment.existing && <Field label="Current assignment revision" help="Use the revision shown in the loaded pilot summary."><input type="number" required min="1" max="2147483646" step="1" value={assignment.expectedFence} onChange={e => setAssignment(v => ({ ...v, expectedFence: e.target.value }))} /></Field>}
            </div><label className={styles.check}><input type="checkbox" checked={assignment.canReview} onChange={e => setAssignment(v => ({ ...v, canReview: e.target.checked }))} />Allow review edits for this specimen</label>
                <label className={styles.check}><input type="checkbox" checked={assignment.revoked} onChange={e => setAssignment(v => ({ ...v, revoked: e.target.checked }))} />Revoke this assignment</label>
                <button className="primary" type="submit">Save assignment</button></fieldset></form>
        </Panel></div>

        <div hidden={tab !== 'pilot'} className={styles.stack}><Panel title="First pilot · ten cards" description="Add each card from its verified source preview. Preparing this list saves a configuration for review; it does not start grading.">
            <ol className={styles.cards}>{pilotCards.map(card => <li key={card.specimenId}><div><strong>{card.title}</strong><small>{card.specimenId}</small></div><button type="button" className="text-button" disabled={locked} aria-label={`Remove ${card.title} from the pilot selection`} onClick={() => setPilotCards(rows => rows.filter(row => row.specimenId !== card.specimenId))}>Remove</button></li>)}</ol>
            {!pilotCards.length && <p className={styles.description}>No specimens selected. Preview an existing or new capture in Source intake to add its specimen.</p>}
            <form onSubmit={onSubmit(preparePilot)}><fieldset disabled={locked}><div className={styles.grid}>
                <Field label="Pilot reference"><input required maxLength={36} value={pilotId} spellCheck={false} onChange={e => { setPilotId(e.target.value); setSummary(null); }} /></Field>
                <div className={styles.field}><span>New pilot</span><button type="button" disabled={Boolean(pilotId)} onClick={() => setPilotId(crypto.randomUUID())}>Create a new pilot reference</button></div>
                <Field label="Pilot window ends"><input type="datetime-local" required value={policy.expiresAt} onChange={editPolicy('expiresAt')} /></Field>
                <Field label="Total spending limit · USD"><input required maxLength={24} inputMode="decimal" value={policy.maxTotalUsd} onChange={editPolicy('maxTotalUsd')} /></Field>
                <Field label="Spending limit per card · USD"><input required maxLength={24} inputMode="decimal" value={policy.maxCardUsd} onChange={editPolicy('maxCardUsd')} /></Field>
                <Field label="Reservation per worker operation · USD"><input required maxLength={24} inputMode="decimal" value={policy.reservationUsd} onChange={editPolicy('reservationUsd')} /></Field>
                <Field label="Maximum worker operations per card"><input required type="number" min="1" max="100" step="1" value={policy.maxOperationsPerCard} onChange={editPolicy('maxOperationsPerCard')} /></Field>
                <Field label="Maximum worker calls per operation"><input required type="number" min="1" max="4" step="1" value={policy.maxWorkerCalls} onChange={editPolicy('maxWorkerCalls')} /></Field>
                <Field label="Worker operation timeout · seconds"><input required type="number" min="1" max="200" step="1" value={policy.deadlineSeconds} onChange={editPolicy('deadlineSeconds')} /></Field>
            </div><button className="primary" type="submit" disabled={pilotCards.length !== 10}>Prepare exact ten-card configuration</button></fieldset></form>
        </Panel><Panel title="Pilot progress" description="Load a pilot reference to inspect its saved configuration, assignments and recorded costs.">
            <form onSubmit={onSubmit(loadSummary)}><fieldset disabled={locked}><Field label="Pilot reference"><input required maxLength={36} value={pilotId} spellCheck={false} onChange={e => { setPilotId(e.target.value); setSummary(null); }} /></Field><button type="submit">Load pilot summary</button></fieldset></form>
            {summary && <div className={styles.summary}><div className={styles.totals}>{[['Actual invoice costs', summary.actualMicroUsd], ['Unsettled reservations / usage', summary.unsettledMicroUsd], ['Total accounted', summary.accountedMicroUsd]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{usd(value)}</strong></div>)}</div>
                {summary.overrun && <Notice error>The pilot has a cost overrun. Review its reservations and invoice evidence before any further operational action.</Notice>}
                <p>{summary.preparedConfiguration ? `Prepared configuration · ${summary.preparedConfiguration.expired ? 'window expired' : 'window ends ' + new Date(summary.preparedConfiguration.policy.expiresAt).toLocaleString()}` : 'No prepared configuration is recorded for this pilot.'}</p>
                <ul className={styles.cards}>{summary.specimens.map(card => <li key={card.specimenId}><div><strong>{card.title ?? 'Unavailable specimen'}</strong><small>{card.specimenId}</small>
                    <p>{!card.evidenceMatches ? 'Evidence needs reconciliation' : card.analysisRevision ? `Analysis ${card.analysisRevision} · Review ${card.reviewRevision}` : 'Awaiting grading analysis'}</p>
                    {card.assignments.map(a => <small key={a.identityId}>{roster.find(row => row.id === a.identityId)?.name ?? a.identityId} · Assignment revision {a.fence} · {a.active ? 'Active' : 'Expired or revoked'}</small>)}</div>
                    <button className="text-button" type="button" disabled={locked} onClick={() => { setAssignment(v => ({ ...v, specimenId: card.specimenId })); setTab('staff'); }}>Assign staff</button></li>)}</ul>
                {summary.runs.length > 0 && <ul className={styles.runs}>{summary.runs.map(run => <li key={run.id}><span>{summary.specimens.find(card => card.specimenId === run.specimenId)?.title ?? run.specimenId}</span><strong>{run.state.replaceAll('_', ' ').toLowerCase()}</strong></li>)}</ul>}
                <details className={styles.invoice}><summary>Invoice reconciliation · {summary.costs.filter(cost => cost.actualMicroUsd === null).length} unsettled attempts</summary>
                    <p>Record the actual charge from one exact invoice line. Reservations and usage-based cost ceilings are separate from the invoice.</p>
                    <form onSubmit={onSubmit(reconcile)}><fieldset disabled={locked}><div className={styles.grid}>
                        <Field label="Attempt"><select required value={invoice.recordKey} onChange={e => setInvoice(v => ({ ...v, recordKey: e.target.value }))}><option value="">Choose an unsettled attempt…</option>{summary.costs.filter(cost => cost.actualMicroUsd === null).map(cost => <option key={`${cost.kind}:${cost.recordId}`} value={`${cost.kind}:${cost.recordId}`} disabled={!cost.dispatched || ['RUNNING', 'RESERVED', 'DISPATCHED'].includes(cost.state)}>{cost.kind === 'ASTRA' ? 'Astra' : 'Grading worker'} · {cost.recordId} · {cost.state.toLowerCase()}</option>)}</select></Field>
                        <Field label="Actual invoice charge · USD"><input required maxLength={24} inputMode="decimal" value={invoice.actualUsd} onChange={e => setInvoice(v => ({ ...v, actualUsd: e.target.value }))} /></Field>
                        <Field label="Invoice reference"><input required maxLength={128} value={invoice.invoiceId} onChange={e => setInvoice(v => ({ ...v, invoiceId: e.target.value }))} /></Field>
                        <Field label="Exact invoice line reference"><input required maxLength={128} value={invoice.lineId} onChange={e => setInvoice(v => ({ ...v, lineId: e.target.value }))} /></Field>
                        <Field label="Invoice document checksum" help="SHA-256 of the retained original invoice."><input required maxLength={64} minLength={64} spellCheck={false} value={invoice.documentSha256} onChange={e => setInvoice(v => ({ ...v, documentSha256: e.target.value.trim() }))} /></Field>
                    </div><button className="primary" type="submit">Record this actual invoice cost</button></fieldset></form>
                </details>
            </div>}
        </Panel>
        <MachinePreparation csrf={currentCsrf} pilotId={summary?.pilotId ?? ''} specimens={summary?.specimens ?? []}
            initializations={summary?.initializations ?? []} runs={summary?.runs ?? []} costs={summary?.costs ?? []}
            reason={reason} authorizationEvidenceHash={authorizationHash} disabled={locked || !summary} onChanged={refreshPilotSummary}/>
        <OperationalRecovery csrf={currentCsrf} pilotId={summary?.pilotId ?? ''} specimens={summary?.specimens ?? []}
            initializations={summary?.initializations ?? []} runs={summary?.runs ?? []} costs={summary?.costs ?? []}
            disabled={locked || !summary} onChanged={refreshPilotSummary}/>
        </div>
    </div>;
}
