import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { stationApprovalTarget, isStationApprovalTarget, stationMessage } from '@atlas/finishing-station/browser';
import { stationClient } from '../lib/station-client.mjs';
import QRCode from 'qrcode';
import { renderManualLabel, validateManualLabel } from '@atlas/finishing/label';
import styles from './ManualFinishing.module.css';

// Call from the explicit approval click before awaiting its response. The parent
// closes this window if approval/publication fails; no print happens before an
// exact saved finishing plan is supplied below.
export function openManualLabelPrintWindow() {
  const station = stationApprovalTarget(); if (station) return station;
  const owned = window.open('about:blank', '_blank', 'popup,width=760,height=620');
  if (owned) { owned.opener = null; owned.document.title = 'Preparing ATLAS label'; owned.document.body.textContent = 'Preparing approved label…'; }
  return owned;
}
async function printLabel(owned, rendered, label, isCurrent) {
  if (!owned || owned.closed) throw new Error('Allow the label print window, then select Print label.');
  const doc = owned.document; doc.body.replaceChildren(); doc.head.replaceChildren();
  doc.title = `${label.reportNumber} · v${label.approvalVersion}`;
  const style = doc.createElement('style');
  style.textContent = '@page{size:letter;margin:1in}body{margin:0;background:white}.face{width:2.73in;height:.83in;margin-bottom:.25in;break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}.face > svg{display:block;width:2.73in;height:.83in}';
  doc.head.append(style);
  const resources = [];
  for (const source of [rendered.front, rendered.reverse]) {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('The label preview could not be printed.');
    const svg = doc.importNode(parsed.documentElement, true);
    // Register before attachment: the original embedded logo must finish loading
    // in this print document, not merely in the staff page's earlier preview.
    for (const image of svg.querySelectorAll('image')) resources.push(new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error('The label logo could not load. Please retry printing.')), { once: true });
    }));
    const face = doc.createElement('div'); face.className = 'face'; face.append(svg); doc.body.append(face);
  }
  let timer;
  try {
    await Promise.race([Promise.all([...resources, doc.fonts.ready]), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The label is still preparing. Please retry printing.')), 10000);
    })]);
  } finally { clearTimeout(timer); }
  if (owned.closed || !isCurrent()) { if (!owned.closed) owned.close(); return false; }
  owned.focus(); owned.print(); return true;
}

/** The plan comes only from the authenticated approved-report endpoint. This
 * browser relays signed hosted/native receipts; only verified station status
 * can report NFC completion. Selecting a station replaces the browser popup.
 */
export default function ManualFinishing({ plan, autoPrintWindow = null, onPrintDialog = null, printDisabled = false, csrf, staffId }) {
  const [rendered, setRendered] = useState(null), [error, setError] = useState(''), [dialogOpened, setDialogOpened] = useState(false);
  const [station, setStation] = useState(null), [operation, setOperation] = useState(null);
  const stationRef = useRef(null), currentPlan = useRef(plan?.planHash);
  useEffect(() => { currentPlan.current = plan?.planHash; return () => { currentPlan.current = null; }; }, [plan?.planHash]);
  useEffect(() => {
    const client = stationClient(csrf); stationRef.current = client; setStation(client.snapshot());
    return client.subscribe(setStation);
  }, [csrf]);
  useEffect(() => {
    if (!station?.selected || !station.paired || !plan?.planHash) return;
    let stopped = false;
    const read = async () => { try { const result = await stationRef.current.operation(plan.planHash); if (!stopped && result) setOperation(result); } catch { /* Existing reports never dispatch on mount. */ } };
    const timer = setInterval(read, 1200); return () => { stopped = true; clearInterval(timer); };
  }, [station?.selected, station?.paired, plan?.planHash]);
  async function finishAtStation(target) {
    if (target?.closed || printDisabled) return;
    const expected = plan.planHash;
    try { const result = await stationRef.current.finish(plan, staffId); if (currentPlan.current !== expected) return; setOperation(result); onPrintDialog?.({ intentId: plan.print.intentId, planHash: plan.planHash, state: 'STATION_DISPATCHED' }); }
    catch (failure) { if (currentPlan.current === expected) setError(stationMessage(failure)); }
  }
  const [palette, setPalette] = useState('NOIR_GOLD'); const autoAttempt = useRef(null), browserAttempt = useRef(null);
  const [printingPlan, setPrintingPlan] = useState(null);
  async function printInBrowser(target) {
    const expected = plan.planHash, attempt = Symbol('label-print');
    browserAttempt.current = attempt; setPrintingPlan(expected);
    const isCurrent = () => currentPlan.current === expected && browserAttempt.current === attempt;
    try {
      if (await printLabel(target, rendered, plan.label, isCurrent)) {
        setDialogOpened(true); onPrintDialog?.({ intentId: plan.print.intentId, planHash: expected, state: 'DIALOG_OPENED' });
      }
    } catch (failure) { if (isCurrent()) setError(failure.message); }
    finally { if (browserAttempt.current === attempt) setPrintingPlan(null); }
  }
  useEffect(() => {
    setRendered(null); setError(''); setDialogOpened(false); setOperation(null);
    try {
      if (plan?.version !== 'atlas-manual-finishing-plan-v1' || plan.print?.intentId !== `afprint_${plan.planHash}`) throw new Error('The approved label could not be verified.');
      validateManualLabel(plan.label);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Label measurement is unavailable.');
      const code = plan.label.layoutVersion === 'atlas-noir-gold-v1' ? QRCode.create(plan.label.url, { errorCorrectionLevel: 'M' }) : null;
      setRendered({ ...renderManualLabel({ label: plan.label, palette: plan.label.layoutVersion === 'atlas-signature-v2' ? 'NOIR_GOLD' : palette, qr: code?.modules,
        measureText: (value, size, weight, family = 'Arial') => { context.font = `${weight} ${size}px ${family}`; return context.measureText(value).width; } }), planId: plan.id });
    } catch (failure) {
      setError(failure.message === 'MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT' ? 'This identity needs a reviewed label layout to fit in full.' : 'The approved label could not be prepared.');
    }
  }, [plan, palette]);
  useEffect(() => {
    if (autoPrintWindow && error && !rendered) { autoPrintWindow.close(); return; }
    if (!rendered || rendered.planId !== plan.id || !autoPrintWindow || printDisabled || autoAttempt.current === plan.id) return;
    autoAttempt.current = plan.id;
    if (isStationApprovalTarget(autoPrintWindow)) { void finishAtStation(autoPrintWindow); return; }
    void printInBrowser(autoPrintWindow);
  }, [rendered, error, autoPrintWindow, printDisabled, plan, onPrintDialog]);
  const print = () => {
    if (!rendered || rendered.planId !== plan?.id || printDisabled || printingPlan === plan?.planHash) return;
    setError('');
    const target = openManualLabelPrintWindow();
    if (isStationApprovalTarget(target)) { void finishAtStation(target); return; }
    void printInBrowser(target);
  };
  const currentOperation = operation?.planHash === plan?.planHash ? operation : null;
  return <section className={styles.station} aria-label="Label and NFC finishing">
    <div className={styles.header}><div><span className={styles.eyebrow}>ATLAS FINISHING</span><h2>Ready for the slab.</h2></div><span className={styles.version}>v{plan?.label?.approvalVersion}</span></div>
    <div className={styles.statuses} aria-live="polite"><span className={styles.ready}>✓ Report approved</span><span>{dialogOpened ? 'Print dialog opened' : error ? 'Label needs attention' : rendered?.planId === plan?.id ? 'Label ready' : 'Preparing label'}</span><span>{currentOperation?.nfc?.state === 'COMPLETE' ? '✓ NFC verified · remove confirmed' : currentOperation?.nfc?.state === 'WAITING_FOR_TAG' ? 'Tap new NFC chip' : currentOperation?.nfc?.state === 'WAITING_FOR_REMOVAL' ? 'Lift NFC chip' : currentOperation?.nfc?.state === 'WAITING_FOR_HOST_ACK' ? 'Saving NFC verification' : currentOperation?.nfc?.state === 'UNKNOWN' ? 'NFC needs recovery' : station?.selected ? station.local?.ready ? 'Station selected' : 'Station needs setup' : 'NFC setup pending'}</span>{currentOperation?.print && <span>{currentOperation.print.state === 'SPOOL_COMPLETED' ? 'Print job completed' : currentOperation.print.state === 'SPOOL_ACCEPTED' ? 'Print job queued' : currentOperation.print.state === 'SPOOL_FAILED' ? 'Print job failed' : 'Print status needs review'}</span>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {rendered && rendered.planId === plan?.id && <div className={styles.faces}>
      <figure><figcaption>FRONT</figcaption><div className={styles.face} dangerouslySetInnerHTML={{ __html: rendered.front }} /></figure>
      <figure><figcaption>REVERSE</figcaption><div className={styles.face} dangerouslySetInnerHTML={{ __html: rendered.reverse }} /></figure>
    </div>}
    <div className={styles.controls}><button type="button" className={styles.print} onClick={print} disabled={!rendered || rendered.planId !== plan?.id || printDisabled || printingPlan === plan?.planHash || Boolean(station?.selected && currentOperation)}>
      {station?.selected ? 'Finish at station' : printingPlan === plan?.planHash ? 'Preparing print…' : 'Print label'} <span aria-hidden="true">↗</span></button>
      {plan?.label?.layoutVersion === 'atlas-noir-gold-v1' && <label>Ink<select disabled={station?.selected === true} aria-label="Label ink" value={palette} onChange={event => setPalette(event.target.value)}><option value="NOIR_GOLD">Black + gold</option><option value="MONOCHROME">Monochrome</option></select></label>}
      <Link href="/station">{station?.selected ? 'Station & recovery' : 'Set up station'}</Link>
      {plan?.label && <a href={plan.label.url} target="_blank" rel="noreferrer">Open approved report ↗</a>}
    </div>
    <details className={styles.details}><summary>Print and NFC setup</summary><p>Each face is 2.73 × 0.83 in. Print at actual size with headers and footers off. The front reserves 11 mm for NFC with a 9 mm guide. Verify physical fit for the selected printer and material. The current design has a plain black reverse.</p><p>Automatic printing requires the configured Mac print bridge. NFC tap-to-write requires the qualified Mac bridge for ACS ACR1552U / F8215. The report reference is unchanged; printing does not record tag verification, assembly or welding.</p></details>
  </section>;
}
