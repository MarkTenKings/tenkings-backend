import { staffApiPath, STAFF_REAUTHENTICATE_PATH } from '../../lib/routes.mjs';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Shell, { Notice, Unavailable } from '../../components/Shell';
import { api, approvalMessage, useStaffResource } from '../../lib/client';
import GradedReport from '../../components/GradedReport';
import GradingActions from '../../components/GradingActions';
import MachineProposals from '../../components/MachineProposals';
import FinishingWorkspace from '../../components/FinishingWorkspace';
import TrustedLearning from '../../components/TrustedLearning';
import IdentityCorrection from '../../components/IdentityCorrection';
import { usePendingNavigation } from '../../lib/usePendingNavigation';
import { retainCardRequest, afterCardRequestError, hasDraftChanges, mergeCardDraft } from '../../lib/card-request-retention.mjs';
import { pageAccess, runtime } from '../../lib/server/runtime.mjs';
export async function getServerSideProps(ctx) {
    const access = await pageAccess(ctx);
    if (!access.props?.staff)
        return access;
    try {
        const state = runtime(ctx.req);
        const staff = await state.auth.authenticate(ctx.req.headers.cookie);
        await state.review.read(staff, ctx.params.cardId);
    }
    catch {
        return { notFound: true };
    }
    return { props: { ...access.props, cardId: ctx.params.cardId } };
}
export default function CardPage({ unavailable, staff, cardId }) { return unavailable ? <Unavailable /> : <CardLoader key={cardId} staff={staff} cardId={cardId}/>; }
function CardLoader({ staff, cardId }) {
    const resource = useStaffResource(`cards/${cardId}`);
    return <Shell staff={staff} workspace title="Card review"><main className="workspace-content">{resource.loading ? <div className="empty-state" role="status">Loading card evidence…</div> : resource.error ? <div className="empty-state"><Notice error>{resource.error}</Notice>{resource.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button onClick={resource.reload}>Retry</button>}</div> : <Workspace initial={resource.data.card} csrf={resource.session.csrf} mode={resource.session.mode}/>}</main></Shell>;
}
function Workspace({ initial, csrf: initialCsrf, mode }) {
    const [csrf, setCsrf] = useState(initialCsrf);
    const [identityBusy, setIdentityBusy] = useState(false);
    const identityPending = useRef(false);
    const [card, setCard] = useState(initial);
    const [form, setForm] = useState(initial.draft);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');
    const [zoom, setZoom] = useState(null);
    const [loaded, setLoaded] = useState({});
    const [signedOut, setSignedOut] = useState(false);
    const pending = useRef(null);
    const pendingApproval = useRef(null);
    const pendingGrading = useRef(null);
    const pendingProposal = useRef(null);
    const synthetic = mode !== 'PRODUCTION';
    const dirty = hasDraftChanges(form, card.draft);
    const working = useRef(false);
    const hasPending = () => Boolean(pending.current || pendingApproval.current || pendingGrading.current || pendingProposal.current || identityPending.current);
    const retained = hasPending();
    usePendingNavigation(() => dirty || hasPending(), setError);
    // Keep newer local edits when a retained request returns an older snapshot.
    function applyCard(nextCard, baseline = card.draft) {
        const resetReview = nextCard.evidenceHash !== card.evidenceHash || nextCard.evidenceRevision !== card.evidenceRevision
            || nextCard.grading?.analysisRevision !== card.grading?.analysisRevision;
        setForm(current => mergeCardDraft(current, baseline, nextCard.draft, { resetReview }));
        setCard(nextCard);
    }
    function identityPendingChanged(value) { identityPending.current = Boolean(value); setIdentityBusy(Boolean(value)); }
    async function refreshAccess() {
        const session = await api('session');
        if (!session.staff || !session.csrf) throw Object.assign(new Error('Sign in again, then refresh access here.'), { code: 'SIGN_IN_REQUIRED', status: 401 });
        setCsrf(session.csrf); setSignedOut(false); return session.csrf;
    }
    function failed(error) {
        setError(error.message);
        if (['SIGN_IN_REQUIRED', 'CSRF_REQUIRED', 'FRESH_SIGN_IN_REQUIRED', 'FRESH_IDENTITY_REVIEWER_REQUIRED'].includes(error.code)) setSignedOut(true);
    }
    async function refreshOnly() {
        if (working.current) return;
        working.current = true; setBusy(true); setError('');
        try { await refreshAccess(); setSaved('Access refreshed. Your notes and retained requests are unchanged.'); }
        catch (e) { failed(e); }
        finally { working.current = false; setBusy(false); }
    }
    function discardEdits() {
        if (working.current || hasPending() || !window.confirm('Discard your unsaved review changes?')) return;
        setForm(card.draft); setSaved('Unsaved changes discarded.');
    }
    const dialog = useRef(null);
    useEffect(() => { if (zoom)
        dialog.current?.showModal(); }, [zoom]);
    function edit(change) { setForm(f => ({ ...f, ...change })); setSaved(''); }
    async function sendRetained(kind, request, refresh = false) {
        if (working.current || identityPending.current) return;
        const ref = kind === 'draft' ? pending : kind === 'approve' ? pendingApproval : pendingProposal;
        if (ref.current !== request) return;
        working.current = true; setBusy(true); setError(''); setSaved('');
        // Access failures before dispatch do not settle an existing request.
        let dispatched = false;
        try {
            const token = refresh ? await refreshAccess() : csrf;
            dispatched = true;
            const result = await api(`cards/${card.id}/${kind}`, { csrf: token, body: request.body });
            applyCard(result.card, kind === 'draft' ? request.body : card.draft);
            ref.current = null;
            setSaved(kind === 'draft' ? `Draft revision ${result.card.draft.revision} saved.` : kind === 'approve'
                ? `Report version ${result.approval.version} approved${synthetic ? ' in this demonstration' : ''}.` : 'Proposal decision saved for this analysis.');
        } catch (e) {
            if (dispatched) ref.current = afterCardRequestError(request, e);
            failed(e);
        } finally { working.current = false; setBusy(false); }
    }
    async function save(event) {
        event.preventDefault();
        if (working.current || hasPending() || signedOut || !card.canEdit) return;
        pending.current = retainCardRequest({ operationId: crypto.randomUUID(), expectedRevision: card.draft.revision,
            evidenceRevision: card.evidenceRevision, evidenceHash: card.evidenceHash,
            observations: form.observations, reviewedSides: form.reviewedSides, identityReviewed: form.identityReviewed, disposition: form.disposition });
        await sendRetained('draft', pending.current);
    }
    async function approve() {
        if (dirty || working.current || hasPending() || signedOut || !card.canEdit || card.grading?.approvalBlock) return;
        pendingApproval.current = retainCardRequest({ operationId: crypto.randomUUID(), expectedAnalysisRevision: card.grading.analysisRevision,
            analysisHash: card.grading.analysisHash, expectedReviewRevision: card.draft.revision,
            reviewHash: card.reviewHash, evidenceHash: card.evidenceHash });
        await sendRetained('approve', pendingApproval.current);
    }
    async function grade(action) {
        if (dirty || working.current || signedOut || pending.current || pendingApproval.current || pendingProposal.current || identityPending.current) return false;
        if (pendingGrading.current && JSON.stringify(pendingGrading.current.action) !== JSON.stringify(action)) {
            setError('Check the previous grading request before starting a different correction.'); return false;
        }
        pendingGrading.current ??= { operationId: crypto.randomUUID(), expectedAnalysisRevision: card.grading.analysisRevision,
            analysisHash: card.grading.analysisHash, expectedReviewRevision: card.draft.revision, reviewHash: card.reviewHash,
            evidenceHash: card.evidenceHash, action };
        working.current = true; setBusy(true); setError(''); setSaved('');
        try {
            const result = await api(`cards/${card.id}/grade`, { csrf, body: pendingGrading.current });
            applyCard(result.card);
            pendingGrading.current = null;
            if (result.operation.state === 'SUCCEEDED') { setSaved('Grading correction saved. Review the recalculated report and checklist before approving.'); return true; }
            setError(approvalMessage(result.operation.failureCode ?? 'GRADING_WORK_UNRESOLVED')); return false;
        } catch (e) { setError(e.message); if (e.code === 'SIGN_IN_REQUIRED') setSignedOut(true); return false; }
        finally { working.current = false; setBusy(false); }
    }
    async function refreshOperation(id) {
        if (working.current || dirty || signedOut || pending.current || pendingApproval.current || pendingProposal.current || identityPending.current) return;
        if (!id && pendingGrading.current) { await grade(pendingGrading.current.action); return; }
        working.current = true; setBusy(true); setError('');
        try {
            const result = await api(`cards/${card.id}/operations/${id}`);
            applyCard(result.card);
            setSaved(result.operation.state === 'SUCCEEDED' ? 'The grading result is saved.' : `Recorded status: ${result.operation.state.toLowerCase()}.`);
        } catch (e) { setError(e.message); if (e.code === 'SIGN_IN_REQUIRED') setSignedOut(true); }
        finally { working.current = false; setBusy(false); }
    }
    async function reload() {
        if (working.current || identityPending.current) return;
        working.current = true; setBusy(true); setError('');
        try {
            await refreshAccess();
            const result = await api(`cards/${card.id}`);
            applyCard(result.card);
            setSaved('Latest saved state loaded. Local edits and retained requests are kept.');
        } catch (e) { failed(e); }
        finally { working.current = false; setBusy(false); }
    }
    async function decideProposal(proposal, decision, reason) {
        if (working.current || hasPending() || dirty || signedOut || !card.canEdit) return;
        pendingProposal.current = retainCardRequest({ operationId: crypto.randomUUID(), stepId: proposal.stepId,
            analysisRevision: card.grading.analysisRevision, analysisHash: card.grading.analysisHash,
            evidenceHash: card.evidenceHash, decision, reason });
        await sendRetained('proposals', pendingProposal.current);
    }
    return <>
    <div className="workspace-heading"><div><Link href="/grading" className="back-link">← Back to queue</Link><h1>{card.title}</h1><p className="muted">{card.set}{card.number && <><span className="middot">·</span>{card.number}</>}<span className="middot">·</span><span className="mono">{card.id.toUpperCase()}</span></p></div><div className="revision-label"><span>{card.grading?.published?.matchesCurrent ? 'REPORT APPROVED' : 'DRAFT FOR REVIEW'}</span><strong>Revision {card.draft.revision}</strong></div></div>
    {card.grading?.report && <GradedReport report={card.grading.report} approved={card.grading.published?.matchesCurrent} synthetic={synthetic}>
      {card.grading.published && <div className="publication-note"><strong>{card.grading.published.reportNumber} · Approved version {card.grading.published.version}</strong><p>{card.grading.published.matchesCurrent ? 'The current analysis and saved review match this approval.' : 'The draft has changed. The prior approved report remains available; these changes need a new approval.'}</p><a className="text-button" href={card.grading.published.href} target="_blank" rel="noreferrer">Open approved report ↗</a></div>}
    </GradedReport>}
    {card.grading && <IdentityCorrection card={card} csrf={csrf} disabled={busy || dirty || signedOut || !card.canEdit || Boolean(pending.current || pendingApproval.current || pendingGrading.current || pendingProposal.current)}
        onCorrected={applyCard} onPendingChange={identityPendingChanged} refreshAccess={refreshAccess}/>}
    {card.grading?.published && <FinishingWorkspace cardId={card.id} csrf={csrf} disabled={busy || retained || dirty || signedOut || !card.canEdit || !card.grading.published.matchesCurrent}/>}
    {card.grading?.published && <TrustedLearning specimenId={card.id} approvalId={card.grading.published.approvalId} csrf={csrf}
        disabled={busy || retained || dirty || signedOut || !card.canEdit || !card.grading.published.matchesCurrent}/>}
    {card.grading && <GradingActions card={card} csrf={csrf} disabled={busy || signedOut || !card.canEdit || Boolean(pending.current || pendingApproval.current || pendingProposal.current || identityBusy)} dirty={dirty} onAction={grade} onRefresh={refreshOperation}/>}
    <MachineProposals proposals={card.grading?.proposals} disabled={busy||retained||dirty||signedOut||!card.canEdit||Boolean(card.grading?.pendingOperations)} onDecide={decideProposal}/>
    {[['draft', pending.current, 'review draft'], ['approve', pendingApproval.current, 'report approval'], ['proposals', pendingProposal.current, 'proposal decision']].filter(([, request]) => request).map(([kind, request, label]) =>
      <Notice key={kind}><strong>Exact {label} request retained</strong><p>Keep this tab open. Editing or loading saved state does not replace this request. Retry sends the original saved request.</p>
        <p>Operation <span className="mono">{request.body.operationId}</span></p>
        <button type="button" disabled={busy || identityBusy} onClick={() => sendRetained(kind, request, true)}>Refresh access and retry exact {label}</button></Notice>)}
    {pendingGrading.current && <button type="button" disabled={busy || signedOut} onClick={() => refreshOperation(null)}>Check previous grading request</button>}
    <div className="review-layout"><section className="evidence-panel"><div className="panel-heading"><div><h2>Card evidence</h2><p>Review each side at its available resolution.</p></div><span className="quiet-label">FRONT / BACK</span></div>
      <div className="evidence-grid">{card.sides.map(side => <div className="side-panel" key={side.side}><div className="side-heading"><h3>{side.side === 'FRONT' ? 'Front' : 'Back'}</h3><span>{side.available ? (synthetic ? 'Original fixture' : 'Preserved evidence') : 'Unavailable'}</span></div><div className="image-stage">{side.available && !signedOut ? <button className="evidence-button" aria-label={`Enlarge ${side.side.toLowerCase()} evidence`} onClick={() => setZoom(side.side)}><img src={staffApiPath(`evidence/${card.id}/${side.side}`)} width="360" height="504" alt={`${card.title}, ${side.side.toLowerCase()}`} onLoad={() => setLoaded(s => ({ ...s, [side.side]: true }))} onError={() => setLoaded(s => ({ ...s, [side.side]: false }))}/><span>↗ Inspect</span></button> : <div className="missing-evidence"><span>◇</span><h3>{signedOut ? 'Session ended' : 'Back evidence missing'}</h3><p>{signedOut ? 'Sign in to view this evidence.' : 'Keep this card in Needs evidence until the second side is available.'}</p></div>}</div><div className="source-note">{side.available ? <><span>{side.width} × {side.height}{synthetic ? ' · Synthetic SVG' : ''}</span><small title={side.sha256}>SHA-256 {side.sha256.slice(0, 12)}…</small>{loaded[side.side] === false && <Notice error>Evidence could not be loaded. Reload before reviewing.</Notice>}</> : <span>No substitute image is used.</span>}</div></div>)}</div>
      <div className="evidence-caption"><span>◇</span><p>{synthetic ? 'These illustrations are sample evidence. They establish no physical condition or physical grade.' : 'Inspect the preserved evidence before approving. Record any correction against this exact draft.'}</p></div>
    </section>
    <section className="draft-panel"><div className="panel-heading"><div><p className="eyebrow">HUMAN REVIEW</p><h2>Review draft</h2></div><span className={`save-dot ${dirty ? 'unsaved' : ''}`} title={dirty ? 'Unsaved changes' : 'Saved draft'}/></div><form onSubmit={save}>
      <fieldset disabled={!card.canEdit || busy || signedOut || identityBusy || Boolean(card.grading?.pendingOperations)}><legend className="sr-only">Draft observations and review status</legend>
      <div className="checklist"><label><input type="checkbox" checked={form.identityReviewed} onChange={e => edit({ identityReviewed: e.target.checked })}/><span>Card identity reviewed<small>{card.title}{card.number ? ` · ${card.number}` : ''}</small></span></label>{card.sides.map(side => <label key={side.side}><input type="checkbox" checked={form.reviewedSides.includes(side.side)} disabled={!side.available || !loaded[side.side]} onChange={e => edit({ reviewedSides: e.target.checked ? [...form.reviewedSides, side.side] : form.reviewedSides.filter(s => s !== side.side) })}/><span>{side.side === 'FRONT' ? 'Front' : 'Back'} evidence reviewed{!side.available && <small>Waiting for evidence</small>}</span></label>)}</div>
      <div className="draft-fields">{['FRONT', 'BACK'].map(side => <div key={side}><label htmlFor={`notes-${side}`}>{side === 'FRONT' ? 'Front' : 'Back'} observations</label><textarea id={`notes-${side}`} rows={3} maxLength={2000} value={form.observations[side]} onChange={e => edit({ observations: { ...form.observations, [side]: e.target.value } })} placeholder="Describe what you see, or what needs a closer look…"/></div>)}<div><label htmlFor="disposition">Draft status</label><select id="disposition" value={form.disposition} onChange={e => edit({ disposition: e.target.value })}><option value="IN_REVIEW">In review</option><option value="NEEDS_EVIDENCE">Needs evidence</option><option value="READY_FOR_HUMAN">Ready for human review</option></select></div></div>
      <div className="draft-action"><button className="primary full" type="submit" disabled={!dirty || retained}>{busy ? 'Saving…' : 'Save review draft'}<span>→</span></button><p>{dirty ? 'You have unsaved changes.' : card.draft.savedAt ? `Saved by ${card.draft.savedBy}` : 'No changes saved yet.'}</p></div>
      </fieldset>
      {!card.canEdit && <Notice>This account has read-only access.</Notice>}{error && <Notice error>{error}</Notice>}{saved && <Notice>{saved}</Notice>}
      <p><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in again in another tab</a> · <button type="button" className="text-button" onClick={refreshOnly} disabled={busy}>Refresh access</button></p>
      <button type="button" className="text-button reload" onClick={reload} disabled={busy || identityBusy}>Reload saved state, keeping edits</button>
      {dirty && !retained && <button type="button" className="text-button" onClick={discardEdits} disabled={busy}>Discard unsaved changes</button>}
    </form><div className="authority-note"><strong>Final human approval</strong><p>Approve the grade, findings and saved review shown here. This records a permanent report version{synthetic ? ' in the local demonstration' : ' and makes it public'}. Label, NFC and slab finishing follow separately.</p>
      {card.grading ? <><button type="button" className="primary full" disabled={dirty || busy || retained || signedOut || !card.canEdit || Boolean(card.grading.approvalBlock)} onClick={approve}>{busy ? 'Working…' : 'Approve exact report'}<span>→</span></button><p>{dirty ? 'Save your changes before approving.' : card.grading.approvalBlock ? approvalMessage(card.grading.approvalBlock) : 'Ready for your approval.'}</p></> : <p>This basic preview supports draft notes only.</p>}
    </div></section></div>
    <details className="history"><summary>Draft history <span>{card.history.length} previous {card.history.length === 1 ? 'revision' : 'revisions'}</span></summary>{card.history.length ? <ol>{card.history.map(h => <li key={h.revision}><strong>Revision {h.revision}</strong><span>{h.savedAt ? `${h.savedBy} · ${new Date(h.savedAt).toLocaleString()}` : 'Initial synthetic draft'}</span></li>)}</ol> : <p>Your first save will preserve the initial draft here.</p>}</details>
    {zoom && <dialog className="evidence-dialog" ref={dialog} onClose={() => setZoom(null)}><div><h2>{zoom === 'FRONT' ? 'Front' : 'Back'} · {card.title}</h2><button autoFocus onClick={() => dialog.current.close()} aria-label="Close evidence inspection">Close ×</button></div><img src={staffApiPath(`evidence/${card.id}/${zoom}`)} alt={`Enlarged ${zoom.toLowerCase()} evidence`} width="360" height="504"/><p>{synthetic ? '360 × 504 source pixels · Synthetic evidence' : 'Preserved evidence'}</p></dialog>}
  </>;
}
