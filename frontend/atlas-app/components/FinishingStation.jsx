import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import { manualRequest } from '../lib/manual-client.mjs';
import { stationClient } from '../lib/station-client.mjs';
import { takeStationPairingCode, stationMessage } from '@atlas/finishing-station/browser';
import styles from './FinishingStation.module.css';

export default function FinishingStation({ staff }) {
  const initial = useRef(null), client = useRef(null);
  const [station, setStation] = useState(null), [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [operation, setOperation] = useState(null);
  useEffect(() => {
    let active = true, unsubscribe;
    if (!initial.current) {
      const code = takeStationPairingCode(window.location, window.history);
      initial.current = (async () => {
        const session = await manualRequest('/api/staff/session');
        if (session.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
        const value = stationClient(session.csrf); client.current = value;
        const hosted = await manualRequest('/api/staff/manual-connected/stations');
        if (code) await value.pair(code); else if (value.snapshot().paired) await value.read();
        return { value, enabled: hosted.enabled === true };
      })();
    }
    initial.current.then(({ value, enabled: available }) => {
      if (!active) return; setEnabled(available); setStation(value.snapshot()); unsubscribe = value.subscribe(setStation);
    }).catch(failure => { if (active) setError(stationMessage(failure)); });
    return () => { active = false; unsubscribe?.(); };
  }, [staff.id]);
  async function action(task) {
    if (busy) return; setBusy(true); setError('');
    try { await task(); } catch (failure) { setError(stationMessage(failure)); } finally { setBusy(false); }
  }
  const status = station?.local;
  return <Shell staff={staff} manual title="Finishing station"><main className={styles.main}>
    <div className={styles.intro}><p>ATLAS FINISHING STATION</p><h1>Approve. Print. Tap.</h1><span>The selected station receives the exact approved report and label.</span></div>
    <section className={styles.panel} aria-label="Finishing station setup">
      <div className={styles.heading}><div><span className={styles.eyebrow}>THIS MAC</span><h2>{status?.state === 'READY' ? 'Ready to finish.' : status?.state === 'BUSY' ? 'Card in progress.' : 'Setup pending.'}</h2></div><span className={styles.badge}>{station?.paired ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
      <div className={styles.checks} aria-live="polite">
        <div><span>Hosted authorization</span><b>{enabled ? 'Enabled' : 'Pending activation'}</b></div>
        <div><span>Protected station identity</span><b>{status?.protectedKey ? 'Available' : 'Setup required'}</b></div>
        <div><span>Printer & label profile</span><b>{status?.printerQualified ? 'Qualified' : 'Setup required'}</b></div>
        <div><span>NFC tag profile</span><b>{status?.qualifiedProfile ? 'Qualified' : 'Qualification pending'}</b></div>
        <div><span>Hosted enrollment</span><b>{status?.enrollment === 'ACTIVE' ? 'Active' : status?.enrollment === 'PENDING_ACTIVATION' ? 'Activation pending' : 'Not enrolled'}</b></div>
      </div>
      {!station?.paired && <p className={styles.help}>Open the one-use link from the local ATLAS station launcher. Reconnect after reloading this browser.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {station?.paired && status?.protectedKey && <button disabled={busy || !enabled || Boolean(status?.activePlanHash)} onClick={() => void action(() => client.current.enroll())}>Enroll / check activation</button>}
        {station?.paired && <button disabled={busy} onClick={() => void action(() => client.current.read())}>Check station</button>}
        <button className={styles.primary} disabled={busy || !status?.ready || status?.state !== 'READY' || station?.selected} onClick={() => void action(() => client.current.select(true))}>{station?.selected ? 'Station selected' : 'Use for approvals'}</button>
        {station?.selected && <button disabled={busy || Boolean(status?.activePlanHash) || Boolean(station.pending)} onClick={() => void action(() => client.current.select(false))}>Use browser print dialog</button>}
      </div>
      {station?.selected && <p className={styles.help}>After approval, the station prints the label and waits for a new NFC chip. Lift the verified chip before the next card.</p>}
    </section>
    {(station?.pending || status?.activePlanHash) && <section className={styles.panel} aria-label="Recover finishing operation"><h2>Finish the saved card.</h2><p>Check its saved result before starting another card. Recovery does not reprint or rewrite an uncertain operation.</p>
      <div className={styles.actions}><button disabled={busy || !station.paired} onClick={() => void action(async () => setOperation(await client.current.resume(staff.id)))}>Resume saved request</button><button disabled={busy || !station.paired} onClick={() => void action(async () => setOperation(await client.current.operation(station.pending?.planHash ?? status.activePlanHash)))}>Check saved operation</button></div>
      {operation && <p role="status">Print: {operation.print.state.replaceAll('_', ' ').toLowerCase()} · NFC: {operation.nfc.state.replaceAll('_', ' ').toLowerCase()}</p>}
    </section>}
    <p className={styles.footer}>Physical printer fit and the NFC lock profile need station qualification. Assembly and welding remain separate.</p><Link href="/batch">← Back to batch grading</Link>
  </main></Shell>;
}
