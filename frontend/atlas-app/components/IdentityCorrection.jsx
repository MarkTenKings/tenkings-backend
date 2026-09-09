import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { useEffect, useRef, useState } from 'react';
import { operationsRequest } from './MachinePreparation';
import { usePendingNavigation } from '../lib/usePendingNavigation';
import { correctionAvailable, correctionRequest, correctionResult, correctionReloadResult, identityFields, retainCorrectionAfterError } from '../lib/identity-correction-client.mjs';
import styles from './IdentityCorrection.module.css';

const messages = {
    IDENTITY_NOT_CONFIGURED: 'Identity correction is not enabled for this workspace.',
    FRESH_IDENTITY_REVIEWER_REQUIRED: 'Sign in again with current review access, then retry the same request here.',
    SIGN_IN_REQUIRED: 'Your session ended. Sign in in another tab, then retry here.',
    CSRF_REQUIRED: 'Your sign-in changed. Refresh access or retry the retained request.',
    IDENTITY_HEAD_CHANGED: 'The card changed. Reload the saved card before preparing a new correction.',
    IDENTITY_REQUEST_CONFLICT: 'This operation reference has different saved content. Keep this tab open for resolution.',
};
const explain = error => messages[error?.code] ?? (error?.status >= 400 && error.status < 500
    ? 'The correction was rejected. Check your access and the current saved card.'
    : 'The correction outcome is unconfirmed. Keep this tab open and retry the exact request.');
const reasonText = { CATEGORY_CHANGED: 'Card category changed', LAYOUT_CHANGED: 'Pokémon layout changed',
    EXACT_MAP_KEY_CHANGED: 'The change needs a different card map', FAMILY_MAP_KEY_CHANGED: 'The change needs a different family map' };

export default function IdentityCorrection({ card, csrf, disabled = false, onCorrected, onPendingChange, refreshAccess }) {
    const original = card?.grading?.report;
    const [profile, setProfile] = useState(original?.cardProfile ?? 'SPORTS'), [values, setValues] = useState(original?.identity ?? {});
    const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
    const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [result, setResult] = useState(null), [needsReload, setNeedsReload] = useState(false);
    const saved = useRef(null), running = useRef(false), currentCsrf = useRef(csrf), edited = useRef(false);
    const reloadTarget = useRef(null), current = useRef(null);
    current.current = { specimenId: card.id, onCorrected, onPendingChange, refreshAccess };
    useEffect(() => { currentCsrf.current = csrf; }, [csrf]);
    useEffect(() => {
        if (!saved.current && !edited.current) { setProfile(original?.cardProfile ?? 'SPORTS'); setValues(original?.identity ?? {}); }
    }, [card.id, card.grading?.analysisRevision, original]);
    usePendingNavigation(() => Boolean(saved.current || reloadTarget.current), setError);
    const locked = disabled || busy || Boolean(pending) || needsReload || !card.canEdit || !correctionAvailable(card) || card.grading?.pendingOperations > 0;
    function retain(request) { saved.current = request; setPending(request); current.current.onPendingChange?.(Boolean(request || reloadTarget.current)); }
    async function freshAccess() {
        let token;
        if (current.current.refreshAccess) token = await current.current.refreshAccess();
        else {
            const session = await operationsRequest('session');
            if (session?.staff) token = session.csrf;
        }
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Object.assign(Error(), { code: 'SIGN_IN_REQUIRED', status: 401 });
        currentCsrf.current = token;
    }
    async function reloadSaved() {
        const target = reloadTarget.current;
        if (!target || current.current.specimenId !== target.specimenId) throw Error('Return to the corrected specimen.');
        const data = await operationsRequest(`cards/${target.specimenId}`), corrected = correctionReloadResult(data, target);
        if (current.current.specimenId !== target.specimenId) throw Error('Return to the corrected specimen.');
        await current.current.onCorrected?.(corrected);
        reloadTarget.current = null; setNeedsReload(false); edited.current = false;
        setProfile(corrected.grading.report.cardProfile); setValues(corrected.grading.report.identity);
        current.current.onPendingChange?.(Boolean(saved.current));
    }
    async function retryReload() {
        if (running.current || !reloadTarget.current) return;
        running.current = true; setBusy(true); setError('');
        try { await freshAccess(); await reloadSaved(); }
        catch { setError('The saved correction remains confirmed. Return to its specimen and reload after checking your access.'); }
        finally { running.current = false; setBusy(false); }
    }
    async function send(request, refresh = false) {
        if (!request || running.current) return;
        running.current = true; setBusy(true); setError('');
        let dispatched = false;
        try {
            if (refresh) await freshAccess();
            dispatched = true;
            const data = await operationsRequest(`cards/${request.specimenId}/identity-correction`, { body: request.body, csrf: currentCsrf.current });
            const receipt = correctionResult(data, request.body); setResult(receipt);
            if (receipt.status === 'CORRECTED') {
                reloadTarget.current = { specimenId: request.specimenId, receipt: structuredClone(receipt) };
                setNeedsReload(true);
                try { await reloadSaved(); } catch { setError('The correction is saved. Reload the saved card to continue its review.'); }
                setReason(''); setConfirmed(false);
            }
            retain(null);
        } catch (caught) {
            if (!retainCorrectionAfterError(request, caught, { dispatched })) retain(null);
            else retain(request);
            setError(explain(caught));
        } finally { running.current = false; setBusy(false); }
    }
    function submit(event) {
        event.preventDefault(); if (locked || !confirmed || saved.current || running.current) return;
        try {
            const request = { specimenId: card.id, body: correctionRequest(card, profile, values, reason, crypto.randomUUID()), uncertain: false };
            setResult(null); retain(request); return send(request);
        } catch { setError('Complete the required identity fields and a reason of up to 1,000 characters.'); }
    }
    function edit(key, value) { edited.current = true; setValues(previous => ({ ...previous, [key]: value })); setConfirmed(false); setResult(null); }
    return <section className={styles.panel} aria-label="Correct card identity"><h3>Correct card identity</h3>
        <p>Correct the saved identity before approving the report. A compatible correction keeps the existing findings and calculations, preserves review notes, and clears the review checklist for a fresh human review.</p>
        <p>If the change requires different processing, you’ll receive an explanation. Previously approved report versions remain unchanged.</p>
        {!correctionAvailable(card) && <p>Identity correction is available after captured evidence has been prepared.</p>}
        {card.grading?.pendingOperations > 0 && <p>Resolve the pending grading work before correcting this identity.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pending && <div className={styles.notice}><strong>Exact correction retained</strong><p>Keep this tab open until the save is resolved. The identity, reason and operation reference stay locked.</p>
            <p>Specimen {pending.specimenId} · Operation {pending.body.operationId}</p><p><a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in in another tab</a>, then retry here.</p>
            <button type="button" disabled={busy} onClick={() => send(saved.current, true)}>Retry exact identity correction</button></div>}
        <form onSubmit={submit}><fieldset disabled={locked} className={styles.form}>
            <label>Card category<select value={profile} onChange={event => { edited.current = true; setProfile(event.target.value); setConfirmed(false); setResult(null); }}>
                <option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
            <div className={styles.fields}>{identityFields[profile].map(([key, label, required]) => <label key={key}>{label}{required ? ' *' : ''}
                <input type="text" required={Boolean(required)} maxLength={key === 'year' ? 24 : 120} value={values[key] ?? ''} onChange={event => edit(key, event.target.value)}/></label>)}
                {profile === 'POKEMON' && <label>Pokémon layout<select value={values.layoutType ?? ''} onChange={event => edit('layoutType', event.target.value)}>
                    <option value="">Unspecified in existing record</option><option value="POKEMON">Pokémon</option><option value="TRAINER">Trainer</option><option value="ENERGY">Energy</option></select></label>}</div>
            <label>Reason for this correction<textarea required rows={3} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }}/></label>
            <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I checked this identity against the card and will review the checklist again if the correction is saved.</label>
            <button type="submit" disabled={!confirmed || !reason.trim()}>Check and save identity correction</button>
        </fieldset></form>
        <p>A sign-in within five minutes and current review access are required. <a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Complete a fresh sign-in</a>.</p>
        {busy && <p role="status">Checking the saved correction…</p>}
        {result && <div className={styles.notice} role="status"><strong>{result.status === 'CORRECTED' ? 'Identity correction saved' : result.status === 'NO_CHANGE' ? 'No identity change' : 'Fresh processing required'}</strong>
            {result.status === 'CORRECTED' ? <p>Review the identity and both card sides again before approving a new report. Correction {result.receiptId}.</p>
                : result.status === 'NO_CHANGE' ? <p>The identity already matches. The saved card is unchanged.</p>
                    : <><ul>{result.reasons.map(value => <li key={value}>{reasonText[value]}</li>)}</ul><p>The correction was not saved and no processing job was started. Arrange fresh preparation through the supervised workflow.</p></>}
        </div>}
        {needsReload && <><p>Confirmed correction for specimen {reloadTarget.current?.specimenId}. Review remains paused until its saved state reloads.</p>
            <button type="button" disabled={busy} onClick={retryReload}>Reload corrected card</button></>}
    </section>;
}
