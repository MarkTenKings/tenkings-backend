import { useEffect, useRef, useState } from 'react';
import { operationsRequest } from './MachinePreparation';
import styles from './TrustedLearning.module.css';
import { usePendingNavigation } from '../lib/usePendingNavigation';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const provenance = {
    DETECTOR_REMOVED: 'Detector finding removed during review',
    DETECTOR_RELABELED_NEGATIVE: 'Original detector label corrected during review',
    DETECTOR_RELABELED_POSITIVE: 'Replacement label from a reviewed detector finding',
    HUMAN_TRACE_CORRECTION_POSITIVE: 'Finding with a human trace correction',
    SMART_MARK_POSITIVE: 'Finding added through a human mark',
    UNTOUCHED_ACCEPTED_POSITIVE: 'Accepted detector finding with no correction',
};
const sourceViews = { ORIGINAL: 'Original image', NORMALIZED: 'Normalized image', MICRO_DEFECT: 'Micro-defect image', DIRECTIONAL: 'Directional image' };
const messages = {
    SIGN_IN_REQUIRED: 'Your session ended. Sign in again before retrying this exact decision.',
    CSRF_REQUIRED: 'Your session changed. Refresh your sign-in before retrying the same decision.',
    FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED: 'This needs a sign-in within five minutes and a current, separate trusted-learning reviewer authorization for this assigned card.',
    LEARNING_NOT_CONFIGURED: 'New trusted-learning candidates are not enabled for this workspace.',
    LEARNING_APPROVAL_CHANGED: 'The approved report changed. Reload candidates from the current approval before making a new decision.',
    LEARNING_ASSIGNMENT_CHANGED: 'Your card assignment changed. Refresh access before making a new decision.',
    LEARNING_CANDIDATES_EXPIRED: 'This candidate preview expired. Reload candidates before a new decision.',
    LEARNING_PREFLIGHT_REQUIRED: 'Load a fresh candidate preview in your current session before deciding.',
    LEARNING_CANDIDATES_CHANGED: 'The candidate bundle changed. Reload it and select the exact findings again.',
    LEARNING_REQUEST_CONFLICT: 'This operation reference has different saved content. Retain the exact request for resolution.',
    CARD_NOT_FOUND: 'This card is not currently available to your assigned staff account.',
};
const failure = (code = 'LEARNING_OUTCOME_UNCONFIRMED', status = 0) => Object.assign(new Error(code), { code, status });
const message = e => messages[e?.code] ?? (e?.status >= 400 && e?.status < 500
    ? 'The server rejected this decision. Check the current approval, candidates and separate trusted-learning access.'
    : 'The reply could not be confirmed. Keep this tab open and retry the exact pending decision, or reload a read-only preview.');
const plain = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const exact = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

// History may contain 50 decisions with 256 candidate IDs each. Its response
// bound is intentionally larger than the small operations-panel receipts.
export async function learningRequest(specimenId, action = '', { body, csrf, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (!UUID.test(specimenId) || !['', 'preview', 'decisions'].includes(action)) throw failure('LEARNING_REQUEST_INVALID', 400);
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > 32768) throw failure('LEARNING_REQUEST_INVALID', 400);
    const controller = new AbortController(); let reader, closed = false, complete = false, timer;
    const cancel = target => { try { Promise.resolve(target?.cancel()).catch(() => {}); } catch { /* Do not wait on failed cancellation. */ } };
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure()); }, timeoutMs); });
    try {
        return await Promise.race([deadline, (async () => {
            const response = await fetchImpl(`/api/staff/cards/${specimenId}/learning${action ? `/${action}` : ''}`, {
                method: encoded === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: encoded === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' },
                ...(encoded === undefined ? {} : { body: encoded }) });
            if (closed) { cancel(response.body); throw failure(); }
            const length = response.headers?.get('content-length');
            if (length != null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 2 * 1024 * 1024)) { cancel(response.body); throw failure(); }
            if (!response.body?.getReader) throw failure();
            reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
            while (!closed) {
                const chunk = await reader.read(); if (closed) throw failure(); if (chunk.done) break;
                if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > 2 * 1024 * 1024) throw failure();
                raw += decoder.decode(chunk.value, { stream: true });
            }
            const data = JSON.parse(raw + decoder.decode()); complete = true;
            if (!response.ok) throw failure(typeof data?.error === 'string' && /^[A-Z0-9_]{1,100}$/.test(data.error) ? data.error : 'LEARNING_REQUEST_REJECTED', response.status);
            return data;
        })()]);
    } catch (e) { throw e?.code && Number.isInteger(e.status) ? e : failure(); }
    finally { closed = true; clearTimeout(timer); if (!complete) { controller.abort(); cancel(reader); } try { reader?.releaseLock(); } catch { /* Deadline still wins. */ } }
}

export function checkedLearningPreview(data, specimenId, approvalId) {
    const p = data?.preview;
    if (!exact(p, ['specimenId', 'approvalId', 'candidatesId', 'bundleHash', 'candidates', 'selectedCandidateIds', 'expiresAt', 'applicationAvailable'])
        || p.specimenId !== specimenId || p.approvalId !== approvalId || !UUID.test(p.candidatesId) || !SHA.test(p.bundleHash)
        || p.applicationAvailable !== false || !Array.isArray(p.selectedCandidateIds) || p.selectedCandidateIds.length !== 0
        || !Number.isFinite(Date.parse(p.expiresAt)) || !Array.isArray(p.candidates) || p.candidates.length > 256) throw failure();
    const seen = new Set();
    for (const c of p.candidates) {
        if (!exact(c, ['candidateId', 'findingId', 'proposalOrder', 'lessonOrder', 'defectType', 'polarity', 'provenance', 'sourceViewId'])
            || !SHA.test(c.candidateId) || seen.has(c.candidateId) || !plain(c.findingId, 180) || !plain(c.defectType, 80)
            || !['POSITIVE', 'NEGATIVE'].includes(c.polarity) || !Object.hasOwn(provenance, c.provenance) || !Object.hasOwn(sourceViews, c.sourceViewId)
            || !Number.isSafeInteger(c.proposalOrder) || c.proposalOrder < 0 || !Number.isSafeInteger(c.lessonOrder) || c.lessonOrder < 0) throw failure();
        seen.add(c.candidateId);
    }
    return p;
}
function checkedReceipt(r, specimenId, input = null) {
    if (!exact(r, ['decisionId', 'specimenId', 'approvalId', 'bundleHash', 'status', 'candidateIds', 'reason', 'createdAt', 'applicationAvailable'])
        || !UUID.test(r.decisionId) || r.specimenId !== specimenId || !UUID.test(r.approvalId) || !SHA.test(r.bundleHash)
        || !['APPROVED_PENDING_APPLICATION', 'REJECTED'].includes(r.status) || r.applicationAvailable !== false
        || !Array.isArray(r.candidateIds) || !r.candidateIds.length || r.candidateIds.length > 256
        || !r.candidateIds.every(id => SHA.test(id)) || new Set(r.candidateIds).size !== r.candidateIds.length
        || !plain(r.reason, 1000) || !Number.isFinite(Date.parse(r.createdAt))) throw failure();
    if (input && (r.approvalId !== input.approvalId || r.bundleHash !== input.bundleHash || r.reason !== input.reason
        || r.status !== (input.decision === 'APPROVE' ? 'APPROVED_PENDING_APPLICATION' : 'REJECTED')
        || JSON.stringify(r.candidateIds) !== JSON.stringify(input.candidateIds))) throw failure();
    return r;
}

export default function TrustedLearning({ csrf, specimenId, approvalId, disabled = false }) {
    const pendingRef = useRef(null), busyRef = useRef(false), currentTarget = useRef(specimenId); currentTarget.current = specimenId;
    const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    usePendingNavigation(()=>Boolean(pendingRef.current),setError);
    const [preview, setPreview] = useState(null), [selected, setSelected] = useState([]), [decision, setDecision] = useState(''), [reason, setReason] = useState('');
    const [history, setHistory] = useState(null), [receipt, setReceipt] = useState(null), [now, setNow] = useState(Date.now());
    const locked = disabled || busy || Boolean(pending), exactPreview = preview?.specimenId === specimenId && preview?.approvalId === approvalId ? preview : null;
    const expired = Boolean(exactPreview && Date.parse(exactPreview.expiresAt) <= now);
    async function loadHistory(target = specimenId) {
        const data = await learningRequest(target, '', { csrf });
        if (!data?.learning || data.learning.applicationAvailable !== false || !Array.isArray(data.learning.decisions)
            || data.learning.decisions.length > 50 || typeof data.learning.olderDecisionsAvailable !== 'boolean') throw failure();
        const value = { ...data.learning, specimenId: target, decisions: data.learning.decisions.map(row => checkedReceipt(row, target)) };
        if (currentTarget.current === target) setHistory(value);
    }
    async function read(action) {
        if (busyRef.current || pendingRef.current) return; busyRef.current = true; setBusy(true); setError('');
        try { await action(); } catch (e) { setError(message(e)); } finally { busyRef.current = false; setBusy(false); }
    }
    useEffect(() => {
        setPreview(null); setSelected([]); setDecision(''); setReason(''); setReceipt(null);
        if (UUID.test(specimenId) && !pendingRef.current) void read(() => loadHistory(specimenId));
    }, [specimenId, approvalId]);
    useEffect(() => {
        const leaving = e => { if (pendingRef.current) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', leaving); return () => window.removeEventListener('beforeunload', leaving);
    }, []);
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    async function loadPreview() {
        if (disabled || !UUID.test(approvalId)) return;
        setPreview(null); setSelected([]); setDecision(''); setReason(''); setReceipt(null);
        await read(async () => { const data = await learningRequest(specimenId, 'preview', { body: { approvalId }, csrf });
            setPreview(checkedLearningPreview(data, specimenId, approvalId)); setNow(Date.now()); });
    }
    async function send(request, refreshSession = false) {
        if (busyRef.current || !request || request !== pendingRef.current || (disabled && !refreshSession)) return;
        busyRef.current = true; setBusy(true); setError('');
        let dispatched = false;
        try {
            let currentCsrf = csrf;
            if (refreshSession) {
                const session = await operationsRequest('session');
                if (!session?.staff || typeof session.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrf)) throw failure('SIGN_IN_REQUIRED', 401);
                currentCsrf = session.csrf;
            }
            dispatched = true;
            const data = await learningRequest(request.specimenId, 'decisions', { body: request.body, csrf: currentCsrf });
            const saved = checkedReceipt(data?.receipt, request.specimenId, request.body);
            setReceipt(saved); pendingRef.current = null; setPending(null); setPreview(null); setSelected([]); setDecision(''); setReason('');
            try { await loadHistory(request.specimenId); } catch { setError('Your decision is saved. History could not reload; use Reload decision history to check it.'); }
        } catch (e) {
            if (dispatched) request.uncertain ||= !e.status || e.status >= 500 || e.status === 408 || /UNKNOWN|UNCONFIRMED|UNRESOLVED/.test(e.code ?? '');
            if (dispatched && !request.uncertain && e.status >= 400 && e.status < 500) { pendingRef.current = null; setPending(null); }
            else { pendingRef.current = request; setPending({ specimenId: request.specimenId, ...request.body }); }
            setError(message(e));
        } finally { busyRef.current = false; setBusy(false); }
    }
    function decide() {
        if (locked || busyRef.current || pendingRef.current || !exactPreview || Date.parse(exactPreview.expiresAt) <= Date.now() || !selected.length
            || !['APPROVE', 'REJECT'].includes(decision) || !plain(reason, 1000) || !reason.trim()) return;
        const body = { operationId: crypto.randomUUID(), approvalId, candidatesId: exactPreview.candidatesId, bundleHash: exactPreview.bundleHash,
            candidateIds: [...selected], decision, reason };
        const request = { specimenId, body, uncertain: false }; pendingRef.current = request; setPending({ specimenId, ...body }); void send(request);
    }
    function toggle(id, checked) { setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)); }
    const historyRows = history?.specimenId === specimenId ? history.decisions : [];
    return <section className={styles.panel} aria-label="Separate trusted-learning decision"><h3>Trusted-learning decision</h3>
        <p>This is a separate learning decision for an approved report. It requires current trusted-learning authorization and a sign-in within five minutes. Grading certification alone does not grant this access.</p>
        <p>Approvals remain <strong>pending bank application</strong>. This panel cannot apply them to the learning bank.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pending && <div className={styles.notice}><strong>Exact decision retained</strong><p>Keep this tab open until the save is resolved. Candidate selection, reason and operation reference are locked.</p>
            <p>Specimen {pending.specimenId} · Approval {pending.approvalId} · Operation {pending.operationId}</p>
            <p>{pending.decision === 'APPROVE' ? 'Approve for later application' : 'Reject'} · {pending.candidateIds.length} selected candidates</p>
            <p>If your session ended, <a href="/?reauthenticate=1" target="_blank" rel="noreferrer">sign in in another tab</a>, then retry here. The exact decision stays retained.</p>
            <button type="button" disabled={busy} onClick={() => send(pendingRef.current, true)}>Retry exact trusted-learning decision</button></div>}
        <div className={styles.actions}><button type="button" disabled={locked || !UUID.test(specimenId) || !UUID.test(approvalId)} onClick={loadPreview}>Load candidates from approved report</button>
            <button type="button" disabled={busy || Boolean(pending) || !UUID.test(specimenId)} onClick={() => read(() => loadHistory())}>Reload decision history</button></div>
        {busy && <p role="status">Checking the hosted learning record…</p>}
        {!UUID.test(approvalId) && <p>A current approved report is required before choosing learning candidates.</p>}
        {exactPreview && <div className={styles.preview}><h4>Review individual candidates</h4><p>No candidates are selected automatically. Choose only the exact subset covered by your reason.</p>
            <p>Preview expires {new Date(exactPreview.expiresAt).toLocaleString()}.{expired && ' This preview has expired; load a fresh one before deciding.'}</p>
            {!exactPreview.candidates.length && <p>No eligible learning candidates were returned for this approved report.</p>}
            <fieldset disabled={locked || expired} className={styles.form}><ul className={styles.candidates}>{exactPreview.candidates.map(c => <li key={c.candidateId}><label>
                <input type="checkbox" checked={selected.includes(c.candidateId)} onChange={e => toggle(c.candidateId, e.target.checked)}/><span><strong>{c.defectType.replaceAll('_', ' ')}</strong>
                    <span>{c.polarity === 'POSITIVE' ? 'Positive example of this finding' : 'Negative example of this finding'}</span>
                    <span>{provenance[c.provenance]} · {sourceViews[c.sourceViewId]}</span><small>Finding {c.findingId}</small></span></label></li>)}</ul>
                <p>{selected.length} of {exactPreview.candidates.length} candidates selected.</p>
                <fieldset className={styles.choice}><legend>Decision for this exact subset</legend><label><input type="radio" name={`learning-decision-${specimenId}`} checked={decision === 'APPROVE'} onChange={() => setDecision('APPROVE')}/>Approve · pending bank application</label>
                    <label><input type="radio" name={`learning-decision-${specimenId}`} checked={decision === 'REJECT'} onChange={() => setDecision('REJECT')}/>Reject this subset</label></fieldset>
                <label className={styles.reason}>Reason for the selected candidates<textarea rows={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label>
                <button type="button" disabled={!selected.length || !decision || !plain(reason, 1000) || !reason.trim()} onClick={decide}>Record separate trusted-learning decision</button>
            </fieldset></div>}
        {receipt && <div className={styles.notice} role="status"><strong>{receipt.status === 'APPROVED_PENDING_APPLICATION' ? 'Approved · pending bank application' : 'Rejected'}</strong>
            <p>{receipt.candidateIds.length} selected candidates · Specimen {receipt.specimenId} · Approval {receipt.approvalId}</p><p>{receipt.reason}</p>
            <p>{receipt.status === 'APPROVED_PENDING_APPLICATION' ? 'The decision is recorded. No learning-bank application has occurred.' : 'The rejection is recorded. No learning-bank application has occurred.'}</p></div>}
        <div className={styles.history}><h4>Saved learning decisions</h4>{history?.specimenId === specimenId && !historyRows.length && <p>No saved learning decisions for this specimen.</p>}
            <ul>{historyRows.map(row => <li key={row.decisionId}><strong>{row.status === 'APPROVED_PENDING_APPLICATION' ? 'Approved · pending bank application' : 'Rejected'}</strong>
                <p>{row.candidateIds.length} selected candidates · {new Date(row.createdAt).toLocaleString()}</p><p>{row.reason}</p><small>Approval {row.approvalId} · Decision {row.decisionId}</small></li>)}</ul>
            {history?.specimenId === specimenId && history.olderDecisionsAvailable && <p>The latest 50 decisions are shown. Older immutable decisions remain retained.</p>}</div>
    </section>;
}
