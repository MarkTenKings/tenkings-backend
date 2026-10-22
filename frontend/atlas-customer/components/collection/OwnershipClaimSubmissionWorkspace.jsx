import { useCallback, useEffect, useRef, useState } from 'react';
import { claimCertificateValid, claimIdValid, createClaimSubmissionClient } from '../../lib/ownership-claim-submission-client.mjs';
import { createClaimSubmissionState } from '../../lib/ownership-claim-submission-state.mjs';
import styles from './OwnershipClaimSubmissionWorkspace.module.css';

const errors = {
  CLAIM_CERTIFICATE_INVALID: 'Enter the exact ATLAS certificate number.', CLAIM_FILE_LIMIT: 'These files exceed the allowed file count or size.',
  CLAIM_FILE_TYPE: 'Choose an allowed original photograph format.', CLAIM_DUPLICATE_FILE: 'Choose each original only once.',
  CLAIM_FILE_CHANGED: 'Reselect the same original files used to prepare this upload.', CLAIM_RESELECT_ORIGINALS: 'Reselect the original files to continue uploading.',
  CLAIM_HASH_UNAVAILABLE: 'This browser cannot check the original files.', CLAIM_PROOF_KIND_REQUIRED: 'Choose a proof type.',
  CLAIM_BUNDLE_EXPIRED: 'This upload or evidence access window has ended. Check its status before preparing new evidence.',
  CLAIM_SOURCE_CHANGED: 'The saved card binding changed. Check the card or claim again.', CLAIM_CONFLICT: 'The card, claim, or upload changed. Check its current status.',
  CLAIM_SUBMISSION_UNAVAILABLE: 'A new claim cannot be submitted for this card right now.', CLAIM_REPLACEMENT_UNAVAILABLE: 'Evidence can only be replaced on an available pending claim.',
  CLAIM_WITHDRAW_UNAVAILABLE: 'Only a pending claim can be withdrawn.', CLAIM_EVIDENCE_NOT_RETAINED: 'The server has not confirmed all original files as retained.',
  CLAIM_RECOVERY_MISMATCH: 'This result does not match the pending request. Its outcome is still unconfirmed.',
  CLAIM_CONFIRMED_REFUSAL: 'This attempt was refused by the server. Check the current card or claim before making a new request. Any earlier unconfirmed request still needs recovery.',
};
const blocked = { EVIDENCE_UNAVAILABLE: 'Evidence is unavailable.', EVIDENCE_EXPIRED: 'The evidence access and review window has ended.',
  POLICY_CHANGED: 'The review policy changed.', POLICY_UNAVAILABLE: 'The review policy is unavailable.', CARD_UNAVAILABLE: 'Current card details are unavailable.',
  OWNERSHIP_CHANGED: 'The ownership record changed.' };
const states = { PENDING: 'Pending review', WITHDRAWN: 'Withdrawn', VERIFIED: 'Verified decision', REJECTED: 'Rejected decision' };
const date = value => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
const size = bytes => bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const emptyForm = scope => ({ scope, certificate: '', claimId: '', requestId: '', proofKind: '', confirmWithdraw: false });

/** Disabled local integration. Explicit trusted configuration and authenticated
 * transports are required; this component creates no endpoint or policy. */
export default function OwnershipClaimSubmissionWorkspace({ customer, accessState = 'READY', enabled = false, configuration = null, transport = null, onAccessLost }) {
  const accountId = customer?.id;
  const [view, setView] = useState(null), [form, setForm] = useState(null), [hidden, setHidden] = useState(false);
  const engine = useRef(null), denied = useRef(null), closed = useRef(false), latest = useRef(null);
  latest.current = { customer, accountId, accessState, enabled, configuration, transport, onAccessLost };
  const current = useCallback(scope => scope && !closed.current && latest.current.customer === scope.customer && latest.current.accountId === scope.accountId
    && latest.current.configuration === scope.configuration && latest.current.transport === scope.transport && latest.current.enabled === true
    && latest.current.accessState === 'READY' && !(denied.current?.customer === scope.customer && denied.current?.accountId === scope.accountId), []);
  useEffect(() => {
    setView(null); setForm(null);
    if (accessState !== 'READY') denied.current = { customer, accountId };
    if (closed.current || enabled !== true || accessState !== 'READY' || !claimIdValid(accountId) || !configuration || !transport
      || denied.current?.customer === customer && denied.current?.accountId === accountId) return undefined;
    const scope = { customer, accountId, configuration, transport };
    let coordinator, unsubscribe;
    const lost = () => { if (!current(scope)) return; denied.current = { customer, accountId }; setForm(null); setView({ scope, status: 'ENDED' }); latest.current.onAccessLost?.(); };
    try {
      const client = createClaimSubmissionClient({ accountId, configuration, transport });
      coordinator = createClaimSubmissionState({ client, accountId, onAccessLost: lost }); engine.current = { scope, coordinator, config: client.configuration };
      unsubscribe = coordinator.subscribe(snapshot => { if (current(scope)) setView({ scope, snapshot, status: snapshot.status }); });
      setView({ scope, snapshot: coordinator.snapshot(), status: 'READY' }); setForm(emptyForm(scope));
    } catch (error) {
      if (error.code === 'CLAIM_ACCESS_ENDED') lost(); else setView({ scope, status: 'UNAVAILABLE' });
    }
    return () => { unsubscribe?.(); coordinator?.dispose(); if (engine.current?.scope === scope) engine.current = null; };
  }, [customer, accountId, accessState, enabled, configuration, transport, current]);
  useEffect(() => {
    const hide = () => { closed.current = true; engine.current?.coordinator.dispose(); engine.current = null; setView(null); setForm(null); setHidden(true); };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); };
  }, []);
  const ended = hidden || accessState !== 'READY' || !claimIdValid(accountId) || denied.current?.customer === customer && denied.current?.accountId === accountId;
  const shown = !ended && current(view?.scope) ? view : null;
  const status = ended ? 'ENDED' : enabled !== true || !configuration || !transport ? 'DISABLED' : shown?.status ?? 'LOADING';
  const data = shown?.snapshot, config = shown && engine.current?.scope === shown.scope ? engine.current.config : null;
  const inputs = form?.scope === shown?.scope ? form : emptyForm(shown?.scope);
  const edit = patch => { if (current(shown?.scope) && engine.current?.scope === shown.scope) setForm(previous => ({ ...(previous?.scope === shown.scope ? previous : emptyForm(shown.scope)), ...patch })); };
  const perform = (method, ...args) => { if (current(shown?.scope) && engine.current?.scope === shown.scope) return engine.current.coordinator[method](...args); return undefined; };
  const busy = status === 'BUSY', locked = busy || status === 'UNKNOWN';
  const bound = data?.mode === 'REPLACE' ? data.claim?.card : data?.target?.card;
  const canPrepare = config?.canPrepareEvidence && bound && (data.mode === 'REPLACE' ? data.claim?.state === 'PENDING' : data.target?.canSubmit);
  return <section className={styles.workspace} aria-label="Ownership claim submission">
    <header className={styles.heading}><p className={styles.eyebrow}>YOUR ACCOUNT</p><h1>Claim a card</h1>
      <p>Submit original evidence for review. A submitted or verified claim does not by itself establish current ownership.</p></header>
    {['DISABLED', 'ENDED', 'LOADING', 'UNAVAILABLE'].includes(status) ? <div className={styles.notice}><p role="status">{status === 'DISABLED' ? 'Claim submission is not enabled.'
      : status === 'ENDED' ? 'Sign in again to manage ownership claims.' : status === 'LOADING' ? 'Preparing your claim workspace…' : 'Claim submission is unavailable.'}</p></div> : <>
      <div className={styles.notice}><p>{config.policyNotice}</p><p className={styles.muted}>Files are submitted to the configured private review process. Only a confirmed server receipt is shown as completed. An interrupted response can leave a request outcome unknown.</p></div>
      {!config.canPrepareEvidence && <p className={styles.muted}>New evidence submission is unavailable. You can still check requests and withdraw a pending claim.</p>}
      {busy && <p role="status" className={styles.progress}>{data.operation}…</p>}
      {data.error && <p role="alert" className={styles.alert}>{errors[data.error] ?? 'This action could not be confirmed. Check its status before trying again.'}</p>}
      {data.pendingRequestId && <section className={styles.panel} aria-label="Unconfirmed request"><h2>Check the request outcome</h2>
        <p>No automatic retry was sent. Keep this reference to check the result after signing in again.</p><p className={styles.reference}>Request reference: {data.pendingRequestId}</p>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => perform('recover')}>Check request outcome</button>
          {data.recoveryMissing && <button type="button" disabled={busy} onClick={() => perform('retrySameRequest')}>Retry the same request</button>}</div>
        {data.recoveryMissing && <p className={styles.muted}>No receipt was found. A retry uses the exact same request and inputs.</p>}</section>}
      {data.receipt && <section className={styles.panel} aria-label="Confirmed request"><h2>{data.receipt.action === 'submit_claim' ? 'Claim submitted' : data.receipt.action === 'withdraw_claim' ? 'Claim withdrawn' : 'Evidence replaced'}</h2>
        <p>This is the recorded request outcome. Current claim status and ownership are checked separately.</p><p className={styles.reference}>Claim reference: {data.receipt.claimId}</p>
        <p className={styles.reference}>Request reference: {data.receipt.requestId}</p>
        {!data.claim && <button type="button" disabled={locked} onClick={() => perform('loadClaim', data.receipt.claimId)}>Check current claim</button>}</section>}
      {data.claim && <section className={styles.panel} aria-label="Current claim"><div className={styles.row}><h2>{data.claim.card?.certificateNumber ?? 'Card details unavailable'}</h2><span className={styles.badge}>{states[data.claim.state]}</span></div>
        <p>{data.claim.currentlyOwnedByYou ? 'Current ownership is recorded to your account.' : 'No current ownership is recorded to your account.'}</p>
        {data.claim.blockedReasons.length > 0 && <div className={styles.alert}><p>Current limitations</p><ul>{data.claim.blockedReasons.map(reason => <li key={reason}>{blocked[reason]}</li>)}</ul></div>}
        <p className={styles.reference}>Claim reference: {data.claim.claimId} · Revision {data.claim.claimRevision}</p>
        <div className={styles.actions}><button type="button" disabled={locked} onClick={() => perform('loadClaim', data.claim.claimId)}>Refresh claim</button>
          {data.claim.state === 'PENDING' && <><button type="button" disabled={locked || !config.canPrepareEvidence || !data.claim.card} onClick={() => { edit({ confirmWithdraw: false }); perform('beginReplacement'); }}>Replace evidence</button>
            <button type="button" disabled={locked} onClick={() => edit({ confirmWithdraw: true })}>Withdraw claim</button></>}</div>
        {inputs.confirmWithdraw && data.claim.state === 'PENDING' && <div className={styles.confirm}><p>Withdraw this pending claim? It will remain in your history and cannot be reviewed or reopened.</p>
          <div className={styles.actions}><button type="button" disabled={locked} onClick={() => { edit({ confirmWithdraw: false }); perform('withdraw'); }}>Confirm withdrawal</button>
            <button type="button" disabled={locked} onClick={() => edit({ confirmWithdraw: false })}>Keep claim</button></div></div>}</section>}
      <section className={styles.panel} aria-label="Choose a card"><h2>{data.mode === 'REPLACE' ? 'New evidence for this claim' : '1. Check the card'}</h2>
        {data.mode === 'REPLACE' ? <p>The new files will replace the evidence on the pending claim above. Earlier evidence and request history are retained according to the review policy.</p>
          : <form onSubmit={event => { event.preventDefault(); perform('lookup', inputs.certificate.trim()); }} className={styles.form}>
            <label htmlFor="ownership-certificate">Certificate number</label><div className={styles.fieldAction}><input id="ownership-certificate" value={inputs.certificate} placeholder="ATLAS-123456ABCDEF"
              maxLength={18} autoComplete="off" spellCheck={false} disabled={locked} onChange={event => edit({ certificate: event.target.value })} />
              <button disabled={locked || !claimCertificateValid(inputs.certificate.trim())} type="submit">Check card</button></div></form>}
        {bound && <p className={styles.cardBinding}>{bound.certificateNumber} · Published report version {bound.report.version}</p>}
        {data.target && !data.target.canSubmit && <p className={styles.muted}>A new claim cannot be submitted for this card right now. You can check an existing claim below.</p>}
        {data.mode !== 'NEW' && <button type="button" disabled={locked} onClick={() => { edit({ certificate: '', confirmWithdraw: false }); perform('startNew'); }}>Start a different claim</button>}
      </section>
      {(canPrepare || data.bundle) && <section className={styles.panel} aria-label="Original evidence"><h2>2. Prepare original evidence</h2>
        <p>Choose up to {config.limits.maxObjects} unchanged original photographs, {size(config.limits.maxObjectBytes)} per file and {size(config.limits.maxBundleBytes)} total. Files are checked before upload; they are not resized or re-encoded.</p>
        {!data.bundle && <label className={styles.field}>Proof type<select value={inputs.proofKind} disabled={locked} onChange={event => edit({ proofKind: event.target.value })}>
          <option value="">Choose a proof type</option>{config.proofKinds.map(kind => <option key={kind.code} value={kind.code}>{kind.label}</option>)}</select></label>}
        {!bound && data.bundle && <div className={styles.notice}><p>Upload recovered. Check its exact certificate to continue a new claim, or check the pending claim reference below to replace its evidence.</p>
          <button type="button" disabled={locked} onClick={() => { edit({ certificate: data.bundle.card.certificateNumber }); perform('lookup', data.bundle.card.certificateNumber); }}>Check certificate for this upload</button></div>}
        <label className={styles.field}>{data.bundle ? 'Reselect the same originals if needed' : 'Original photographs'}<input type="file" multiple accept={config.formats.join(',')} disabled={locked || !canPrepare}
          onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; if (selected.length) perform('selectFiles', selected); }} /></label>
        {data.files.length > 0 && <ul className={styles.fileList}>{data.files.map(file => <li key={file.clientFileId}><strong>{file.name}</strong><span>{size(file.byteCount)} · Original bytes checked</span></li>)}</ul>}
        {!data.bundle && <button type="button" disabled={locked || !canPrepare || !inputs.proofKind || data.files.length === 0} onClick={() => perform('reserve', inputs.proofKind)}>Prepare upload</button>}
        {data.bundle && <><dl className={styles.facts}><div><dt>Upload access until</dt><dd><time dateTime={data.bundle.expiresAt}>{date(data.bundle.expiresAt)}</time></dd></div>
          <div><dt>Evidence usable until</dt><dd><time dateTime={data.bundle.usableUntil}>{date(data.bundle.usableUntil)}</time></dd></div>
          <div><dt>Deletion scheduled after</dt><dd><time dateTime={data.bundle.deleteAfter}>{date(data.bundle.deleteAfter)}</time></dd></div></dl>
          <p className={styles.muted}>The deletion date is a policy schedule. This workspace does not confirm that physical deletion has occurred.</p>
          <p role="status">{data.bundle.allRetained ? 'All original files are confirmed retained by the server.' : `${data.bundle.files.filter(file => file.state === 'RETAINED').length} of ${data.bundle.files.length} originals confirmed retained.`}</p>
          {data.bundle.consumed && <p>This upload has already been used by a claim. Check the claim or submission request reference for its recorded outcome.</p>}
          {data.fileProgress && <p role="status">{data.fileProgress.stage === 'UPLOADING' ? 'Uploading an original…' : data.fileProgress.stage === 'VERIFYING' ? 'Checking an uploaded original…' : 'Original retained; checking the complete upload…'}</p>}
          <p className={styles.reference}>Upload request reference: {data.bundle.requestId}</p>
          <div className={styles.actions}><button type="button" disabled={locked} onClick={() => perform('checkBundle')}>Check upload status</button>
            {!data.bundle.allRetained && <><button type="button" disabled={locked || !canPrepare || data.files.length === 0} onClick={() => perform('upload')}>Upload originals</button>
              <button type="button" disabled={locked || !canPrepare} onClick={() => perform('verifyUploads')}>Verify uploaded originals</button></>}</div></>}
      </section>}
      {data.bundle?.allRetained && !data.bundle.consumed && <section className={styles.panel} aria-label="Submit evidence"><h2>3. {data.mode === 'REPLACE' ? 'Replace claim evidence' : 'Submit for review'}</h2>
        <p>Retained files have not yet changed this claim. Submission remains subject to the current card, claim, and review policy.</p>
        <button type="button" disabled={locked || !canPrepare || data.bundle.consumed} onClick={() => perform('submit')}>{data.mode === 'REPLACE' ? 'Replace claim evidence' : 'Submit claim'}</button></section>}
      <section className={styles.panel} aria-label="Find a claim or request"><h2>Check an existing claim or request</h2>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); edit({ confirmWithdraw: false }); perform('loadClaim', inputs.claimId.trim()); }}>
          <label htmlFor="ownership-claim-reference">Claim reference</label><div className={styles.fieldAction}><input id="ownership-claim-reference" value={inputs.claimId} maxLength={36} autoComplete="off" spellCheck={false} disabled={locked} onChange={event => edit({ claimId: event.target.value })} />
            <button type="submit" disabled={locked || !claimIdValid(inputs.claimId.trim())}>Check claim</button></div></form>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); perform('recover', inputs.requestId.trim()); }}>
          <label htmlFor="ownership-request-reference">Request reference</label><div className={styles.fieldAction}><input id="ownership-request-reference" value={inputs.requestId} maxLength={36} autoComplete="off" spellCheck={false} disabled={locked} onChange={event => edit({ requestId: event.target.value })} />
            <button type="submit" disabled={locked || !claimIdValid(inputs.requestId.trim())}>Check request</button></div></form>
        <p className={styles.muted}>Checking a reference does not resubmit a claim or upload files.</p>
      </section>
    </>}
  </section>;
}
