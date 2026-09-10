import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { useEffect, useRef, useState } from 'react';
import { createAtlasNfcBrowser, createFinishingRequests } from '@atlas/finishing/browser';
import ApprovedLabel from './ApprovedLabel';
import { operationsRequest } from './MachinePreparation';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import styles from './FinishingWorkspace.module.css';

const messages = {
    APPROVED_REPORT_REQUIRED: 'Approve the completed report before issuing a physical label.',
    APPROVAL_CHANGED: 'The approved version changed. Refresh finishing and use the current approval for new physical work.',
    GRADING_WORK_UNRESOLVED: 'Grading work still needs to finish or be resolved before physical finishing.',
    TRAINED_REVIEWER_REQUIRED: 'An assigned reviewer with current training is required for finishing.',
    FRESH_SIGN_IN_REQUIRED: 'Sign in again to continue. Finishing requires a sign-in within the last 15 minutes.',
    SIGN_IN_REQUIRED: 'Your session ended. Sign in in another tab, then retry here.',
    CSRF_REQUIRED: 'Your session changed. Refresh your sign-in before retrying this exact save.',
    NFC_JOB_NOT_FOUND: 'This saved NFC job is not available for the assigned card.',
    NFC_RECOVERY_STATUS_ONLY: 'This recovered job is limited to checking its saved result and cleanup. It cannot prepare another encoding.',
    NFC_NOT_CONFIGURED: 'Integrated Mac NFC finishing is not ready. Production writing, permanent locking and signed receipts still require qualification.',
    ATLAS_CAPABILITY_REQUIRED: 'This helper must advertise the separate ATLAS signed-report capability.',
    ATLAS_WORKSTATION_TOKEN_REQUIRED: 'Enter the separate ATLAS workstation token provided during workstation setup.',
    ATLAS_JOB_TRUST_MISMATCH: 'This helper does not trust the ATLAS key that signed this exact job.',
    ATLAS_JOB_EXPIRED: 'This signed job expired. Check for any retained result before issuing a new job.',
    CONNECTION_UNCONFIRMED: 'The connection did not confirm its reply. Keep this tab open and retry the same request.',
    SAVE_UNCONFIRMED: 'The save could not be confirmed. Retry the exact pending save below.',
    RESPONSE_UNCONFIRMED: 'The reply could not be confirmed. Retry the same request.',
    HELPER_RESPONSE_INVALID: 'The helper reply does not match this exact ATLAS job. Keep the tag separate and check the workstation.',
    NFC_VERIFICATION_REJECTED: 'The hosted service could not verify this exact URL, tag lock and workstation result. Do not assemble this tag.',
    NFC_JOB_ALREADY_RECORDED: 'This NFC job already has a saved result. Refresh the recorded history; do not program another tag for it.',
    FINISHING_LINKAGE_CHANGED: 'The selected label, NFC result or approval no longer matches. Refresh before continuing.',
    PHYSICAL_FACT_ALREADY_RECORDED: 'This physical confirmation is already recorded. Refresh the finishing history.',
    atlas_nfc_job_not_found: 'The helper has no retained operation for this job. If encoding may have started, keep that tag separate for resolution.',
    atlas_nfc_job_mismatch: 'A different job owns the workstation. Resolve that job before continuing here.',
    atlas_nfc_job_expired: 'The helper job expired. Remove and quarantine the tag before resolving this attempt.',
    atlas_nfc_token_required: 'The helper did not accept this separate ATLAS workstation token.',
    atlas_nfc_not_available: 'ATLAS NFC support is disabled on this workstation.',
};
const message = error => messages[typeof error === 'string' ? error : error?.code] ?? 'This action could not be confirmed. Check the saved state before continuing.';
const stageText = { AWAITING_APPROVAL: 'Waiting for current approval', READY_FOR_LABEL: 'Ready to issue a label',
    LABEL_READY_FOR_PRINT_AND_NFC: 'Label issued · printing and NFC next', READY_FOR_ASSEMBLY: 'NFC verified · ready for human assembly',
    ASSEMBLY_CONFIRMED: 'Human assembly recorded · sonic weld next', SONIC_WELD_CONFIRMED: 'Human sonic weld recorded' };
const phaseText = { preparing: 'Preparing the exact approved URL', awaiting_manual_start: 'Ready for human Start Encoding in GoToTags',
    completed: 'Helper result ready for hosted verification', uncertain: 'Encoding outcome uncertain · quarantine this tag', failed: 'Encoding failed · remove and quarantine this tag',
    closing_success: 'Saved helper result retained while cleanup finishes', closing_discard_failed: 'Failed tag cleanup needs an exact retry',
    closing_discard_uncertain: 'Uncertain tag cleanup needs an exact retry', closing_discard_completed_unrecorded: 'Unrecorded tag cleanup needs an exact retry' };
function Check({ checked, onChange, disabled, children }) { return <label className={styles.check}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled}/><span>{children}</span></label>; }

export default function FinishingWorkspace(props) { return <Workspace key={props.cardId} {...props}/>; }
function Workspace({ cardId, csrf, approved = null, finishing = null, disabled = false, onChanged }) {
    const client = useRef(null), bridge = useRef(null), tokenInput = useRef(null), busyRef = useRef(false), pendingSuccess = useRef(null);
    if (!client.current) client.current = createFinishingRequests({ cardId, csrf });
    if (!bridge.current) bridge.current = createAtlasNfcBrowser();
    const [state, setState] = useState(finishing), [loading, setLoading] = useState(!finishing), [busy, setBusy] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(null);
    usePendingNavigation(()=>Boolean(client.current.pending()||bridge.current.summary().jobId),setError);
    const [selectedLabelId, selectLabel] = useState(''), [connected, setConnected] = useState(false);
    const [job, setJob] = useState(null), [operation, setOperation] = useState(null), [hosted, setHosted] = useState(null);
    const [savedJobId, selectSavedJob] = useState('');
    const [fresh, setFresh] = useState(false), [removed, setRemoved] = useState(false), [quarantined, setQuarantined] = useState(false);
    const [assembled, setAssembled] = useState(false), [welded, setWelded] = useState(false);
    const [ackPending, setAckPending] = useState(false), [localPending, setLocalPending] = useState(false), [discardPending, setDiscardPending] = useState(false);
    const approval = state?.approved ?? approved;
    const labels = state?.labels ?? [], selected = labels.find(row => row.id === selectedLabelId)
        ?? labels.find(row => row.approvalId === approval?.approvalId) ?? labels[0];
    const currentLabel = selected?.approvalId === approval?.approvalId && selected?.label?.publicHash === approval?.publicHash;
    const selectedJobs = (state?.jobs ?? []).filter(row => row.labelIssueId === selected?.id);
    const verified = (state?.verifications ?? []).find(row => selectedJobs.some(j => j.id === row.jobId));
    const assembly = (state?.physical ?? []).find(row => row.labelIssueId === selected?.id && row.verificationId === verified?.id && row.stage === 'ASSEMBLED');
    const weld = (state?.physical ?? []).find(row => row.assemblyId === assembly?.id && row.stage === 'SONIC_WELDED');
    const locked = busy || Boolean(pending), blocked = disabled || locked || !state || Boolean(state.mutationBlock);
    const expected = () => ({ approvalId: approval.approvalId, approvalVersion: approval.approvalVersion, publicHash: approval.publicHash });
    useEffect(() => { client.current.setCsrf(csrf); }, [csrf]);
    useEffect(() => { setFresh(false); setAssembled(false); setWelded(false); }, [selected?.id, approval?.approvalId]);
    useEffect(() => {
        let active = true;
        client.current.read().then(data => { if (active) { setState(data); setError(''); } })
            .catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; bridge.current.disconnect(); };
    }, []);
    useEffect(() => {
        const leaving = event => { if (client.current.pending() || bridge.current.summary().jobId) { event.preventDefault(); event.returnValue = ''; } };
        const hide = () => { bridge.current.disconnect(); setConnected(false); if (tokenInput.current) tokenInput.current.value = ''; };
        window.addEventListener('beforeunload', leaving); window.addEventListener('pagehide', hide);
        return () => { window.removeEventListener('beforeunload', leaving); window.removeEventListener('pagehide', hide); };
    }, []);
    async function refresh() {
        const data = await client.current.read(); setState(data); setLoading(false);
        if (onChanged) { try { await onChanged(data); } catch { /* A parent refresh cannot undo a saved finishing receipt. */ } }
    }
    async function local(fn) {
        if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
        try { await fn(); } catch (e) { setError(message(e)); }
        finally { busyRef.current = false; setBusy(false); }
    }
    async function save(kind, input, accept, success) {
        if (disabled || busyRef.current || client.current.pending()) return;
        pendingSuccess.current = { accept, success }; await send(() => client.current.mutate(kind, input));
    }
    async function send(fn) {
        if (disabled || busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
        try {
            const receipt = await fn(), saved = pendingSuccess.current;
            setPending(null); pendingSuccess.current = null; saved?.accept(receipt); setNotice(saved?.success ?? 'Saved.');
            try { await refresh(); } catch { setError('Your action was saved, but the history could not refresh. Refresh finishing before the next action.'); }
        } catch (e) { setPending(client.current.pending()); setError(message(e)); }
        finally { busyRef.current = false; setBusy(false); }
    }
    const retrySave = () => send(async () => {
        const session = await operationsRequest('session');
        if (!session.staff || typeof session.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrf))
            throw Object.assign(new Error('SIGN_IN_REQUIRED'), { code: 'SIGN_IN_REQUIRED', status: 401 });
        client.current.setCsrf(session.csrf);
        return client.current.retry();
    });
    async function connect() {
        const value = tokenInput.current?.value ?? '';
        if (value) { bridge.current.setToken(value); tokenInput.current.value = ''; }
        setConnected(false); await bridge.current.connect(); setConnected(true); setNotice('Separate ATLAS capability confirmed. The token is held only in this tab’s memory.');
    }
    async function prepare() {
        if (disabled || !state?.nfcConfigured) return;
        try {
            const result = await bridge.current.prepare(job, { freshTagConfirmed: fresh });
            setOperation(result); setLocalPending(false); setNotice('Use GoToTags to click Start Encoding, then place the fresh tag when prompted.');
        } catch (e) { setLocalPending(Boolean(bridge.current.summary().jobId)); throw e; }
    }
    async function checkStatus() {
        const result = await bridge.current.status(); setOperation(result); setLocalPending(false);
        const retained = bridge.current.hostedVerification(); if (retained) setHosted(retained);
        setNotice(job?.recoveryOnly && ['preparing', 'awaiting_manual_start'].includes(result.phase)
            ? 'Recovered preparation remains open. This view is status only; do not start encoding again.' : phaseText[result.phase] ?? 'Helper status checked.');
    }
    async function resume() {
        const selectedJob = savedJobId || state?.jobs?.[0]?.id;
        if (!selectedJob) return;
        const recovery = await client.current.retrieveNfcJob(selectedJob);
        setJob(recovery.receipt); selectLabel(recovery.receipt.labelIssueId); setFresh(false); setHosted(null); setOperation(null);
        setRemoved(false); setQuarantined(false); setLocalPending(true);
        const result = await bridge.current.resume(recovery);
        setOperation(result); setHosted(bridge.current.hostedVerification()); setLocalPending(false);
        setNotice('Recovered the exact saved operation for status and cleanup. No encoding preparation was sent.');
    }
    function closeRecoveryView() {
        if (bridge.current.summary().jobId) bridge.current.releaseRecovery(); setJob(null); setOperation(null); setHosted(null); setLocalPending(false);
        setFresh(false); setRemoved(false); setQuarantined(false);
        setNotice('Recovery view closed. The helper’s retained operation was not changed.');
    }
    async function acknowledge() {
        setAckPending(true);
        const result = await bridge.current.acknowledgeSuccess({ receipt: hosted, tagRemoved: removed });
        setAckPending(false); setJob(null); setOperation(null); setHosted(null); setFresh(false); setRemoved(false); setLocalPending(false);
        setNotice(result.state === 'ACKNOWLEDGED' ? 'Hosted verification is saved and the helper acknowledged cleanup.'
            : 'Hosted verification is saved. After the exact cleanup retry, the helper reports no active operation.');
    }
    const issue = () => save('label', expected(), receipt => { selectLabel(receipt.id); setAssembled(false); setWelded(false); }, 'An immutable label issue is saved. Printing is a separate action.');
    const createJob = () => save('nfc-job', { ...expected(), labelIssueId: selected.id }, receipt => { setJob(receipt); setOperation(null); setHosted(null); }, 'Signed job saved for this exact label and approved version.');
    const verify = () => save('nfc-verify', bridge.current.verificationInput(), receipt => setHosted(receipt), 'The hosted service verified and saved the exact URL readback and permanent tag lock.');
    const physical = stage => save('physical', { ...expected(), labelIssueId: selected.id, verificationId: verified.id, stage,
        assemblyId: stage === 'SONIC_WELDED' ? assembly.id : null, humanConfirmed: true }, () => { setAssembled(false); setWelded(false); },
    stage === 'ASSEMBLED' ? 'Your human assembly confirmation is saved.' : 'Your human sonic weld confirmation is saved.');

    return <section className={styles.workspace} aria-label="Approved report finishing">
      <header className={styles.heading}><div><p className={styles.eyebrow}>PHYSICAL FINISHING</p><h2>Label, NFC and slab</h2><p>Use the exact approved report throughout each finishing step.</p></div>
        <button type="button" onClick={() => local(refresh)} disabled={busy}>Refresh finishing</button></header>
      {loading && <p role="status">Loading finishing records…</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
      {disabled && <p className={styles.block}>Finishing changes are paused. Resolve the card edits or session state before issuing, encoding or recording new work. Saved helper status and cleanup remain available.</p>}
      {state?.mutationBlock && <div className={styles.block}>{message(state.mutationBlock)}{['FRESH_SIGN_IN_REQUIRED', 'TRAINED_REVIEWER_REQUIRED'].includes(state.mutationBlock) && <a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer"> Open sign-in in another tab</a>}</div>}
      {pending && <div className={styles.pending}><strong>{pending.uncertain ? 'Save outcome unconfirmed' : 'Save needs attention'}</strong><p>This tab retains the exact {pending.kind} request. Keep it open until the save is resolved.</p>
        <p>If your session ended, <a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">sign in in another tab</a>, then retry here.</p>
        <button type="button" disabled={disabled || busy} onClick={retrySave}>Retry exact save</button>
        {pending.rejected && <button type="button" disabled={busy} onClick={() => { client.current.clearRejected(); setPending(null); pendingSuccess.current = null; }}>Dismiss rejected request</button>}</div>}
      {state && <div className={styles.status}><strong>{stageText[state.stage] ?? 'Finishing state available'}</strong>{approval && <span>{approval.reportNumber} · approved v{approval.approvalVersion}</span>}</div>}
      <div className={styles.steps}>
        <section className={styles.step}><div className={styles.stepHeading}><span>1</span><h3>Issue and print label</h3></div>
          <p>Each issue is an immutable copy of the approved identity, grade and report link.</p>
          <button type="button" disabled={blocked || Boolean(job)} onClick={issue}>{labels.some(row => row.approvalId === approval?.approvalId) ? 'Issue another label copy' : 'Issue approved label'}</button>
          {labels.length > 0 && <><label className={styles.field}>Saved label issue<select value={selected?.id ?? ''} disabled={locked || Boolean(job)} onChange={e => { selectLabel(e.target.value); setAssembled(false); setWelded(false); }}>
            {labels.map((row, i) => <option value={row.id} key={row.id}>{row.label.reportNumber} · v{row.label.approvalVersion} · {new Date(row.createdAt).toLocaleString()} · copy {labels.length - i}</option>)}</select></label>
            {!currentLabel && <p className={styles.block}>Historical approved label. New NFC and physical work require the current approval.</p>}
            <ApprovedLabel receipt={selected} printDisabled={disabled || locked}/></>}
        </section>
        <section className={styles.step}><div className={styles.stepHeading}><span>2</span><h3>Encode and verify NFC</h3></div>
          <p>The Mac workflow will use the ACR1552U reader and F8215 tags after native finishing qualification.</p>
          {!state?.nfcConfigured && <p className={styles.block}>Integrated Mac NFC finishing is incomplete. Production writing, permanent locking and signed receipts are unavailable. Saved Windows helper records remain historical evidence.</p>}
          <div className={styles.connection}><label className={styles.field}>ATLAS workstation token<input ref={tokenInput} type="password" autoComplete="off" spellCheck={false} aria-label="Separate ATLAS workstation token" disabled={locked}/></label>
            <button type="button" disabled={locked || !state?.nfcConfigured} onClick={() => local(connect)}>{connected ? 'Check ATLAS connection' : 'Connect ATLAS helper'}</button>
            {connected && <button type="button" disabled={locked} onClick={() => { bridge.current.disconnect(); setConnected(false); }}>Forget workstation token</button>}</div>
          <p className={styles.help}>The token stays in memory for this tab. Workstation access requires the production staff origin and a locally configured helper.</p>
          {Boolean(state?.jobs?.length) && !job && <div className={styles.job}><strong>Resume a saved NFC operation</strong><p>After a browser restart, retrieve the exact saved job to check the helper result or finish cleanup. Recovery cannot prepare another encoding.</p>
            <label className={styles.field}>Saved NFC operation<select value={savedJobId || state.jobs[0].id} disabled={locked} onChange={e => selectSavedJob(e.target.value)}>{state.jobs.map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString()} · {row.expired ? 'expired · recovery only' : 'saved operation'}</option>)}</select></label>
            <button type="button" disabled={locked || !connected} onClick={() => local(resume)}>Resume saved NFC operation</button></div>}
          <Check checked={fresh} onChange={setFresh} disabled={blocked || Boolean(operation) || job?.recoveryOnly}>I have a fresh, unused F8215 tag for this exact label and approved report.</Check>
          {!job && <button type="button" disabled={blocked || !currentLabel || !connected || !fresh || !state?.nfcConfigured || Boolean(verified) || bridge.current.summary().recoveryOutstanding} onClick={createJob}>Create signed NFC job</button>}
          {job && <div className={styles.job}><strong>Approved v{job.job.approvalVersion} · exact signed job retained</strong><p>{job.recoveryOnly ? 'Status and cleanup only. Do not start encoding again.' : `Start before ${new Date(job.expiresAt).toLocaleTimeString()}.`} Keep this tab open until the result and cleanup are saved.</p>
            {job.recoveryOnly && <button type="button" disabled={locked || ackPending || discardPending} onClick={closeRecoveryView}>Return to saved operations</button>}
            {!job.recoveryOnly && !operation && !localPending && !bridge.current.summary().jobId && <button type="button" disabled={locked} onClick={() => { setJob(null); setFresh(false); setNotice('The unused signed job remains in history. No helper preparation was attempted for it.'); }}>Set aside unused signed job</button>}
            {!job.recoveryOnly && !operation && <button type="button" disabled={blocked || !state?.nfcConfigured || !connected || !fresh} onClick={() => local(prepare)}>{localPending ? 'Retry exact preparation' : 'Prepare NFC encoding'}</button>}
            {(operation || localPending) && <button type="button" disabled={locked || !connected} onClick={() => local(checkStatus)}>Check exact helper result</button>}
            {operation && <p role="status"><strong>{job.recoveryOnly && operation.phase === 'awaiting_manual_start' ? 'Recovered preparation · status only' : phaseText[operation.phase]}</strong></p>}
            {job.recoveryOnly && ['preparing', 'awaiting_manual_start'].includes(operation?.phase) && <p>Do not press Start Encoding from this recovery view. Check for an existing result. If none is retained, check again after {new Date(job.expiresAt).toLocaleTimeString()} to resolve the expired attempt through quarantine.</p>}
            {!job.recoveryOnly && operation?.phase === 'awaiting_manual_start' && (disabled || !state?.nfcConfigured
                ? <p>Do not start encoding while finishing is paused. Check this saved operation for its result or cleanup.</p>
                : <ol className={styles.instructions}><li>Confirm the matching ATLAS operation in GoToTags.</li><li>Click <strong>Start Encoding</strong> yourself.</li><li>Place this fresh tag on the reader when prompted, then check the helper result here.</li></ol>)}
            {['completed', 'closing_success'].includes(operation?.phase) && !hosted && <button type="button" disabled={disabled || locked || !state?.nfcConfigured} onClick={verify}>Verify and save NFC result</button>}
            {hosted && <><p className={styles.verified}>Exact URL and permanent tag lock are verified and saved by ATLAS.</p>
              <Check checked={removed} onChange={setRemoved} disabled={locked}>I removed this exact verified tag from the reader and kept it with its matching label and card.</Check>
              <button type="button" disabled={locked || !connected || !removed} onClick={() => local(acknowledge)}>{ackPending ? 'Retry exact helper cleanup' : 'Acknowledge tag removal and close helper job'}</button></>}
            {(['failed', 'uncertain', 'completed', 'closing_discard_failed', 'closing_discard_uncertain', 'closing_discard_completed_unrecorded'].includes(operation?.phase) || discardPending) && !hosted && !(state?.verifications ?? []).some(row => row.jobId === job.id) && <><Check checked={quarantined} onChange={setQuarantined} disabled={locked}>I removed and quarantined this exact tag without a saved ATLAS verification. It will not be assembled or reused.</Check>
              <button type="button" disabled={locked || !connected || !quarantined} onClick={() => local(async () => { setDiscardPending(true); const cleanup = await bridge.current.acknowledgeDiscard({ tagRemoved: true }); setDiscardPending(false); setJob(null); setOperation(null); setFresh(false); setQuarantined(false); setLocalPending(false); setNotice(cleanup.state === 'DISCARDED' ? 'The quarantined attempt was closed. Use a new tag for another job.' : 'After the exact quarantine cleanup retry, the helper reports no active operation. Keep the old tag quarantined.'); })}>{discardPending ? 'Retry exact quarantined tag cleanup' : 'Close quarantined tag attempt'}</button></>}
          </div>}
          {verified && !hosted && <p className={styles.verified}>A hosted URL and permanent-lock verification is saved for this label.</p>}
        </section>
        <section className={styles.step}><div className={styles.stepHeading}><span>3</span><h3>Confirm physical assembly</h3></div><p>Record only the work you personally completed with this card, printed label and verified tag.</p>
          {assembly ? <p className={styles.verified}>Human assembly recorded {new Date(assembly.physicalConfirmedAt).toLocaleString()}.</p> : <><Check checked={assembled} onChange={setAssembled} disabled={blocked || !currentLabel || !verified || Boolean(job)}>I matched the card, approved label and verified NFC tag, checked tag placement and label fit, and physically assembled them in the slab.</Check>
            <button type="button" disabled={blocked || !currentLabel || !verified || !assembled || Boolean(job)} onClick={() => physical('ASSEMBLED')}>Record my assembly confirmation</button></>}
        </section>
        <section className={styles.step}><div className={styles.stepHeading}><span>4</span><h3>Confirm sonic weld</h3></div><p>Welding is a separate human-confirmed step after this exact assembly.</p>
          {weld ? <p className={styles.verified}>Human sonic weld recorded {new Date(weld.physicalConfirmedAt).toLocaleString()}.</p> : <><Check checked={welded} onChange={setWelded} disabled={blocked || !currentLabel || !assembly || Boolean(job)}>I completed and inspected the sonic weld on this exact assembled slab.</Check>
            <button type="button" disabled={blocked || !currentLabel || !assembly || !welded || Boolean(job)} onClick={() => physical('SONIC_WELDED')}>Record my sonic weld confirmation</button></>}
        </section>
      </div>
      {state?.olderHistoryAvailable && <p className={styles.help}>The most recent 50 records of each kind are shown. Older immutable records remain retained.</p>}
    </section>;
}
