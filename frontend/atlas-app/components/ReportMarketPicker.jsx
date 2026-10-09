import React, { useEffect, useRef, useState } from 'react';
import { manualMessage, manualRequest } from '../lib/manual-client.mjs';
import { createReportMarketClient } from '../lib/report-market-client.mjs';
import MarketReferencePicker from './MarketReferencePicker';
import styles from './MarketReferencePicker.module.css';

/** Approval starts durable server work. Mounting, polling and recovery read saved
 * status only. Refresh and public selection still require an explicit action. */
export default function ReportMarketPicker({ cardId, staffId, approvalActionId, csrf, available = false, disabled = false, onChange,
  automatic = true, automaticEnabled = false, createClient = createReportMarketClient, pickerOptions = {}, renderDetails = null, pollIntervalMs = 3000 }) {
  const client = useRef(null), generation = useRef(0), lock = useRef(false), changed = useRef(onChange);
  changed.current = onChange;
  const [ready, setReady] = useState(false), [recovery, setRecovery] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [preview, setPreview] = useState(null);
  function accept(value, result) {
    const saved = value.pending(); setReady(true);
    setRecovery(saved && (saved.selection || saved.search.approvalActionId !== approvalActionId) ? saved : null);
    if (automatic && result?.marketSearch) setPreview(result.marketSearch);
  }
  useEffect(() => {
    const owner = generation, version = ++owner.current; client.current = null; lock.current = false;
    setReady(false); setRecovery(null); setError(''); setBusy(false); setStatus(''); setPreview(null);
    if (!available) return;
    Promise.resolve().then(async () => {
      const value = createClient({ cardId, staffId, approvalActionId, storage: window.sessionStorage,
        request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
      if (generation.current !== version) return;
      client.current = value;
      const result = await value.read();
      if (generation.current === version) accept(value, result);
    }).catch(failure => { if (generation.current === version) setError(manualMessage(failure)); });
    return () => { if (owner.current === version) owner.current++; };
  }, [cardId, staffId, approvalActionId, csrf, available, createClient, automatic]);
  useEffect(() => {
    if (!automatic || !ready || recovery || !['QUEUED', 'SEARCHING'].includes(preview?.state)) return;
    const version = generation.current; let stopped = false, timer;
    const tick = async () => {
      if (stopped || generation.current !== version) return;
      if (lock.current) { timer = setTimeout(tick, pollIntervalMs); return; }
      try {
        const value = client.current, result = await value.read();
        if (!stopped && generation.current === version) { accept(value, result); setError(''); }
      } catch { if (!stopped && generation.current === version) setError('The saved result could not be checked. Retrying its status; no new search is started.'); }
      if (!stopped && generation.current === version) timer = setTimeout(tick, pollIntervalMs);
    };
    timer = setTimeout(tick, pollIntervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [automatic, ready, recovery, preview?.state, pollIntervalMs, cardId, approvalActionId]);
  async function recover(replace = false) {
    const value = client.current, version = generation.current;
    if (!value || lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const wasSelection = Boolean(recovery?.selection);
      const result = replace ? await value.reconcileSuperseded() : recovery ? await value.resumeSelection() : await value.read();
      if (version === generation.current) {
        accept(value, result); setStatus(wasSelection && !replace ? 'Sales references published.' : ''); changed.current?.(result);
        if (wasSelection && automatic) { const refreshed = await value.read(); if (version === generation.current) accept(value, refreshed); }
      }
    } catch (failure) { if (version === generation.current) {
      if (failure?.code === 'MARKET_SELECTION_REVIEW_REQUIRED') { setRecovery(null); setStatus('The report or sales search changed. Check the saved result to review current references.'); }
      else setError(manualMessage(failure));
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  if (!available) return null;
  if (!ready || recovery) return <section className={styles.panel} aria-label="Recover report market references">
    <p className={styles.eyebrow}>REPORT · MARKET REFERENCES</p><p>{recovery ? 'A saved market request needs its result checked.' : 'Checking saved sold comps…'}</p>
    {recovery && recovery.search.approvalActionId === approvalActionId && <button type="button" disabled={disabled || busy} onClick={() => void recover()}>Resume saved selection</button>}
    {recovery && recovery.search.approvalActionId !== approvalActionId && <button type="button" disabled={disabled || busy} onClick={() => void recover(true)}>Use current report</button>}
    {!ready && error && <button type="button" disabled={disabled || busy} onClick={() => void recover()}>Check report status</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
  return <>{status && <p role="status">{status}</p>}<MarketReferencePicker {...pickerOptions} scopeKey={`${staffId}:${cardId}:${approvalActionId}`} available={available} disabled={disabled || busy}
    automatic={automatic} automaticEnabled={automaticEnabled} savedSource={automatic ? preview : null} onCheck={() => recover()}
    onPreview={async () => { const value = client.current, version = generation.current, result = await value.preview();
      if (version === generation.current) { setPreview(result); setError(''); } return result; }} onSave={async input => {
      const value = client.current, version = generation.current, result = await value.select(input);
      if (version === generation.current) changed.current?.(result); return result;
    }}/>{error && <p role="alert" className={styles.error}>{error}</p>}{renderDetails?.(preview, client.current)}</>;
}
