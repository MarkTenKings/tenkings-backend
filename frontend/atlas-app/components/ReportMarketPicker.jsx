import React, { useEffect, useRef, useState } from 'react';
import { manualMessage, manualRequest } from '../lib/manual-client.mjs';
import { createReportMarketClient } from '../lib/report-market-client.mjs';
import MarketReferencePicker from './MarketReferencePicker';
import styles from './MarketReferencePicker.module.css';

/** Published approvals only. Reading status is free; provider search requires
 * the explicit picker button and a durably saved idempotent request. */
export default function ReportMarketPicker({ cardId, staffId, approvalActionId, csrf, available = false, disabled = false, onChange, createClient = createReportMarketClient, pickerOptions = {}, renderDetails = null }) {
  const client = useRef(null), generation = useRef(0), lock = useRef(false), changed = useRef(onChange);
  changed.current = onChange;
  const [ready, setReady] = useState(false), [recovery, setRecovery] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const owner = generation, version = ++owner.current; client.current = null; lock.current = false;
    setReady(false); setRecovery(null); setError(''); setBusy(false); setStatus(''); setPreview(null);
    if (!available) return;
    Promise.resolve().then(async () => {
      const value = createClient({ cardId, staffId, approvalActionId, storage: window.sessionStorage,
        request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
      if (generation.current !== version) return;
      client.current = value; const saved = value.pending();
      await value.read();
      if (generation.current === version) { setReady(true); setRecovery(saved && (saved.selection || saved.search.approvalActionId !== approvalActionId) ? saved : null); }
    }).catch(failure => { if (generation.current === version) setError(manualMessage(failure)); });
    return () => { if (owner.current === version) owner.current++; };
  }, [cardId, staffId, approvalActionId, csrf, available, createClient]);
  async function recover(replace = false) {
    const value = client.current, version = generation.current;
    if (!value || lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = replace ? await value.reconcileSuperseded() : recovery ? await value.resumeSelection() : await value.read();
      if (version === generation.current) {
        const saved = value.pending(); setReady(true); setRecovery(saved && (saved.selection || saved.search.approvalActionId !== approvalActionId) ? saved : null);
        setStatus(recovery && !replace ? 'Sales references published.' : ''); changed.current?.(result);
      }
    } catch (failure) { if (version === generation.current) {
      if (failure?.code === 'MARKET_SELECTION_REVIEW_REQUIRED') { setRecovery(null); setStatus('The report or sales search changed. Find sold cards again to review current references.'); }
      else setError(manualMessage(failure));
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  if (!available) return null;
  if (!ready || recovery) return <section className={styles.panel} aria-label="Recover report market references">
    <p className={styles.eyebrow}>REPORT · MARKET REFERENCES</p><p>{recovery ? 'A saved market request needs its result checked.' : 'Checking the published report…'}</p>
    {recovery && recovery.search.approvalActionId === approvalActionId && <button type="button" disabled={disabled || busy} onClick={() => void recover()}>Resume saved selection</button>}
    {recovery && recovery.search.approvalActionId !== approvalActionId && <button type="button" disabled={disabled || busy} onClick={() => void recover(true)}>Use current report</button>}
    {!ready && error && <button type="button" disabled={disabled || busy} onClick={() => void recover()}>Check report status</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
  return <>{status && <p role="status">{status}</p>}<MarketReferencePicker {...pickerOptions} scopeKey={`${staffId}:${cardId}:${approvalActionId}`} available={available} disabled={disabled}
    onPreview={async () => { const value = client.current, version = generation.current, result = await value.preview();
      if(version === generation.current) setPreview(result); return result; }} onSave={async input => {
      const value = client.current, version = generation.current, result = await value.select(input);
      if (version === generation.current) changed.current?.(result); return result;
    }}/>{renderDetails?.(preview, client.current)}</>;
}
