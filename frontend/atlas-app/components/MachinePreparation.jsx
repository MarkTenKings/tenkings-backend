import { useEffect, useRef, useState } from 'react';
import styles from './MachinePreparation.module.css';
import { usePendingNavigation } from '../lib/usePendingNavigation';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const messages = {
    SIGN_IN_REQUIRED: 'Your session ended. Sign in in another tab, then retry the same request here.',
    FRESH_HUMAN_OPERATIONS_REQUIRED: 'A fresh sign-in and current human operations grant are required.',
    CSRF_REQUIRED: 'Your session changed. Refresh your sign-in before retrying the same request.',
    STAFF_ACCESS_NOT_ENABLED: 'This staff deployment is not currently enabled.',
    MACHINE_NOT_CONFIGURED: 'Supervised preparation is not enabled for this workspace.',
    MACHINE_ADMISSION_NOT_CONFIGURED: 'Supervised preparation admission is not enabled for this workspace.',
    MACHINE_CONFIGURATION_REQUIRED: 'Supervised preparation needs its current deployment configuration.',
    PILOT_NOT_ACTIVE: 'This specimen is outside the active pilot or its allowed time window.',
    PILOT_BUDGET_EXHAUSTED: 'The pilot cost limit has been reached. Review its held costs.',
    RESOLUTION_BINDING_CHANGED: 'The inspected record changed. Inspect its current state before recording a decision.',
    RESOLUTION_STATE_CHANGED: 'This record no longer has the inspected state. Inspect it again.',
    RESOLUTION_NOT_ALLOWED: 'This record is not eligible for the selected recovery action.',
    RESOLUTION_REQUEST_CONFLICT: 'This operation reference has different saved content. Keep the exact request for resolution.',
};
const problem = (code = 'OUTCOME_UNCONFIRMED', status = 0) => Object.assign(new Error(code), { code, status });
export const operationMessage = error => messages[error?.code] ?? (error?.status >= 400 && error?.status < 500
    ? 'The server rejected this request. Refresh the current pilot state before trying new work.'
    : 'The result could not be confirmed. Retain this tab and retry the exact request.');

// Shared only by these two new panels. No browser provider/worker/device port.
export async function operationsRequest(path, { body, csrf, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    const controller = new AbortController(); let reader, closed = false, done = false, timer;
    const cancel = target => { try { Promise.resolve(target?.cancel()).catch(() => {}); } catch { /* Do not await broken cancellation. */ } };
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(problem()); }, timeoutMs); });
    try {
        return await Promise.race([deadline, (async () => {
            const response = await fetchImpl(`/api/staff/${path}`, { method: body === undefined ? 'GET' : 'POST',
                credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            if (closed) { cancel(response.body); throw problem(); }
            const length = response.headers?.get('content-length');
            if (length != null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 131072)) { cancel(response.body); throw problem(); }
            if (!response.body?.getReader) throw problem();
            reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
            while (!closed) {
                const chunk = await reader.read(); if (closed) throw problem(); if (chunk.done) break;
                if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > 131072) throw problem();
                raw += decoder.decode(chunk.value, { stream: true });
            }
            const data = JSON.parse(raw + decoder.decode()); done = true;
            if (!response.ok) throw problem(typeof data?.error === 'string' && /^[A-Z0-9_]{1,100}$/.test(data.error) ? data.error : 'REQUEST_REJECTED', response.status);
            return data;
        })()]);
    } catch (error) { throw error?.code && Number.isInteger(error.status) ? error : problem(); }
    finally { closed = true; clearTimeout(timer); if (!done) { controller.abort(); cancel(reader); } try { reader?.releaseLock(); } catch { /* Deadline still wins. */ } }
}

export function useRetainedOperation({ csrf, disabled, onChanged }) {
    const saved = useRef(null), running = useRef(false);
    const currentCsrf = useRef(csrf);
    useEffect(() => { currentCsrf.current = csrf; }, [csrf]);
    const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    usePendingNavigation(()=>Boolean(saved.current),setError);
    useEffect(() => {
        const leaving = event => { if (saved.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leaving); return () => window.removeEventListener('beforeunload', leaving);
    }, []);
    async function send(request, refreshSession = false) {
        // Only the retained object may bypass a disabled new-work panel, and
        // only through explicit recovery with current human session CSRF.
        if (running.current || !request || request !== saved.current || (disabled && !refreshSession)) return;
        running.current = true; setBusy(true); setError('');
        let dispatched = false;
        try {
            if (refreshSession) {
                const session = await operationsRequest('session');
                if (!session.staff || !SHA.test(session.csrf)) throw problem('SIGN_IN_REQUIRED', 401);
                currentCsrf.current = session.csrf;
            }
            dispatched = true;
            const data = await operationsRequest(request.path, { body: request.body, csrf: currentCsrf.current }); request.accept(data);
            saved.current = null; setPending(null);
            if (onChanged) { try { await onChanged(); } catch { setError('The action is saved, but the pilot summary could not refresh. Refresh it before new work.'); } }
        } catch (e) {
            const knownAdmissionRefusal = request.preserveDispatchedUncertainty === true
                && (e.code === 'MACHINE_ADMISSION_REQUIRED' && e.status === 400
                    || e.code === 'MACHINE_ADMISSION_NOT_CONFIGURED' && e.status === 503);
            if (dispatched && !knownAdmissionRefusal) request.uncertain ||= request.preserveDispatchedUncertainty === true
                || !e.status || e.status >= 500 || e.status === 408 || /UNKNOWN|UNCONFIRMED|UNRESOLVED/.test(e.code ?? '');
            // A later definitive rejection cannot erase an earlier lost reply.
            if (dispatched && !request.uncertain && (knownAdmissionRefusal || e.status >= 400 && e.status < 500)) { saved.current = null; setPending(null); }
            else { saved.current = request; setPending({ label: request.label, pilotId: request.pilotId ?? request.body.pilotId, id: request.body.operationId ?? request.body.jobId }); }
            setError(operationMessage(e));
        } finally { running.current = false; setBusy(false); }
    }
    return { pending, busy, error, locked: disabled || busy || Boolean(pending),
        run(request) {
            if (disabled || running.current || saved.current) return;
            const retained = { ...request, body: structuredClone(request.body), uncertain: false };
            saved.current = retained; setPending({ label: retained.label, pilotId: retained.pilotId ?? retained.body.pilotId, id: retained.body.operationId ?? retained.body.jobId });
            void send(retained);
        }, retry: () => send(saved.current, true),
        async read(path, body, accept) {
            if (running.current) return; running.current = true; setBusy(true); setError('');
            try { accept(await operationsRequest(path, { body, csrf: currentCsrf.current })); } catch (e) { setError(operationMessage(e)); }
            finally { running.current = false; setBusy(false); }
        }, clearError: () => setError('') };
}

export function preparationCandidates(specimens, initializations, runs, costs) {
    const used = new Set([...initializations, ...runs, ...costs.filter(row => row.kind === 'WORKER')].map(row => row.specimenId));
    return specimens.filter(row => UUID.test(row.specimenId) && row.present === true && row.evidenceMatches === true && row.analysisRevision === 0 && !used.has(row.specimenId));
}
function checkedReceipt(data, expected) {
    const r = data?.receipt;
    if (!r || r.jobId !== expected.jobId || r.specimenId !== expected.specimenId || r.pilotId !== expected.pilotId
        || !UUID.test(r.gradingOperationId) || !SHA.test(r.runtimeHash) || !['QUEUED', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(r.state)
        || !Number.isFinite(Date.parse(r.deadlineAt)) || r.operatorRun !== null && (!UUID.test(r.operatorRun?.id) || typeof r.operatorRun?.state !== 'string')) throw problem();
    return r;
}

export default function MachinePreparation({ csrf, pilotId, specimens = [], initializations = [], runs = [], costs = [],
    reason = '', authorizationEvidenceHash = '', disabled = false, onChanged }) {
    const request = useRetainedOperation({ csrf, disabled, onChanged });
    const [selected, setSelected] = useState(''), [records, setRecords] = useState([]), [receipt, setReceipt] = useState(null), [confirmed, setConfirmed] = useState(false);
    const own = records.filter(row => row.pilotId === pilotId);
    const candidates = preparationCandidates(specimens, [...initializations, ...own], runs, costs);
    const candidate = candidates.find(row => row.specimenId === selected);
    const jobs = [...own, ...initializations.map(row => ({ ...row, jobId: row.id, pilotId }))]
        .filter((row, index, list) => UUID.test(row.jobId) && UUID.test(row.specimenId) && list.findIndex(other => other.jobId === row.jobId) === index);
    useEffect(() => { setSelected(''); setConfirmed(false); setReceipt(null); }, [pilotId]);
    const remember = value => { setRecords(rows => [...rows.filter(row => row.jobId !== value.jobId), value]); setReceipt(value); setConfirmed(false); };
    function admit() {
        if (!candidate || !UUID.test(pilotId) || !reason.trim() || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason) || !SHA.test(authorizationEvidenceHash) || !confirmed) return;
        const body = { jobId: crypto.randomUUID(), specimenId: candidate.specimenId, reason, authorizationEvidenceHash };
        request.run({ label: 'Supervised preparation admission', path: 'operations/machine/admit', body, pilotId, preserveDispatchedUncertainty: true,
            accept: data => remember(checkedReceipt(data, { ...body, pilotId })) });
    }
    return <section className={styles.panel} aria-label="Supervised machine preparation">
        <h3>Supervised machine preparation</h3><p>Admit one exact uninitialized pilot specimen for supervised preparation. This records permission and a job; it does not complete grading.</p>
        {request.error && <p role="alert" className={styles.error}>{request.error}</p>}
        {request.pending && <div className={styles.notice}><strong>Admission outcome unconfirmed</strong><p>This tab retains the exact job reference and request. Retry it before choosing another specimen.</p>
            <p>Pilot {request.pending.pilotId} · Job {request.pending.id}</p>
            <p><a href="/?reauthenticate=1" target="_blank" rel="noreferrer">Sign in in another tab</a>, then retry the exact retained admission here.</p>
            <button type="button" disabled={request.busy} onClick={request.retry}>Retry exact admission</button></div>}
        <fieldset disabled={request.locked} className={styles.form}>
            <label>Uninitialized pilot specimen<select value={selected} onChange={e => { setSelected(e.target.value); setConfirmed(false); request.clearError(); }}>
                <option value="">Choose a specimen…</option>{candidates.map(row => <option key={row.specimenId} value={row.specimenId}>{row.title ?? 'Pilot specimen'} · {row.specimenId}</option>)}</select></label>
            {!candidates.length && <p>No eligible uninitialized specimens are shown. Refresh the pilot summary to check current evidence and preparation history.</p>}
            <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I checked this specimen and the recorded authorization for supervised preparation.</label>
            {(!reason.trim() || !SHA.test(authorizationEvidenceHash)) && <p>Complete the parent panel’s reason and authorization record checksum first.</p>}
            <button type="button" disabled={!candidate || !confirmed || !UUID.test(pilotId) || !reason.trim() || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason) || !SHA.test(authorizationEvidenceHash)} onClick={admit}>Admit for supervised preparation</button>
        </fieldset>
        {receipt && <div className={styles.notice} role="status"><strong>{receipt.state === 'QUEUED' ? 'Ready for supervised preparation' : 'Saved preparation status'}</strong>
            <p>{specimens.find(row => row.specimenId === receipt.specimenId)?.title ?? 'Specimen'} · {receipt.specimenId}</p>
            <p>Preparation state: {receipt.state.toLowerCase().replaceAll('_', ' ')}. Deadline: {new Date(receipt.deadlineAt).toLocaleString()}.</p>
            <p>Pilot {receipt.pilotId} · Job {receipt.jobId}{receipt.operatorRun && ` · Operator state: ${receipt.operatorRun.state.toLowerCase().replaceAll('_', ' ')}`}</p>
            <p>Completed preparation is not report approval. Continue through the staff review and approval workflow.</p></div>}
        {jobs.length > 0 && <ul className={styles.jobs}>{jobs.map(job => <li key={job.jobId}><div><strong>{specimens.find(row => row.specimenId === job.specimenId)?.title ?? 'Pilot specimen'}</strong>
            <span>{job.jobId} · {String(job.state).toLowerCase().replaceAll('_', ' ')}</span></div>
            <button type="button" disabled={request.busy || Boolean(request.pending)} onClick={() => request.read(`operations/machine/${job.jobId}`, undefined,
                data => remember(checkedReceipt(data, job)))}>Check saved preparation</button></li>)}</ul>}
    </section>;
}
