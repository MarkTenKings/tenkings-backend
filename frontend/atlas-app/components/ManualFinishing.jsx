import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { renderManualLabel, validateManualLabel } from '@atlas/finishing/label';
import styles from './ManualFinishing.module.css';

// Call from the explicit approval click before awaiting its response. The parent
// closes this window if approval/publication fails; no print happens before an
// exact saved finishing plan is supplied below.
export function openManualLabelPrintWindow() {
  const owned = window.open('about:blank', '_blank', 'popup,width=760,height=620');
  if (owned) { owned.opener = null; owned.document.title = 'Preparing ATLAS label'; owned.document.body.textContent = 'Preparing approved label…'; }
  return owned;
}
function printLabel(owned, rendered, label) {
  if (!owned || owned.closed) throw new Error('Allow the label print window, then select Print label.');
  const doc = owned.document; doc.body.replaceChildren(); doc.head.replaceChildren();
  doc.title = `${label.reportNumber} · v${label.approvalVersion}`;
  const style = doc.createElement('style');
  style.textContent = '@page{size:letter;margin:1in}body{margin:0;background:white}.face{width:2.73in;height:.83in;margin-bottom:.25in;break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}svg{display:block;width:2.73in;height:.83in}';
  doc.head.append(style);
  for (const source of [rendered.front, rendered.reverse]) {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('The label preview could not be printed.');
    const face = doc.createElement('div'); face.className = 'face'; face.append(doc.importNode(parsed.documentElement, true)); doc.body.append(face);
  }
  owned.focus(); owned.print();
}

/** The plan comes only from the authenticated approved-report endpoint. This
 * browser view does not call native device endpoints or report physical success.
 */
export default function ManualFinishing({ plan, autoPrintWindow = null, onPrintDialog = null, printDisabled = false }) {
  const [rendered, setRendered] = useState(null), [error, setError] = useState(''), [dialogOpened, setDialogOpened] = useState(false);
  const [palette, setPalette] = useState('NOIR_GOLD'); const autoAttempt = useRef(null);
  useEffect(() => {
    setRendered(null); setError(''); setDialogOpened(false);
    try {
      if (plan?.version !== 'atlas-manual-finishing-plan-v1' || plan.print?.intentId !== `afprint_${plan.planHash}`) throw new Error('The approved label could not be verified.');
      validateManualLabel(plan.label);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Label measurement is unavailable.');
      const code = QRCode.create(plan.label.url, { errorCorrectionLevel: 'M' });
      setRendered({ ...renderManualLabel({ label: plan.label, palette, qr: code.modules,
        measureText: (value, size, weight) => { context.font = `${weight} ${size}px Arial`; return context.measureText(value).width; } }), planId: plan.id });
    } catch (failure) {
      setError(failure.message === 'MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT' ? 'This identity needs a reviewed label layout to fit in full.' : 'The approved label could not be prepared.');
    }
  }, [plan, palette]);
  useEffect(() => {
    if (autoPrintWindow && error && !rendered) { autoPrintWindow.close(); return; }
    if (!rendered || rendered.planId !== plan.id || !autoPrintWindow || printDisabled || autoAttempt.current === plan.id) return;
    autoAttempt.current = plan.id;
    try { printLabel(autoPrintWindow, rendered, plan.label); setDialogOpened(true); onPrintDialog?.({ intentId: plan.print.intentId, planHash: plan.planHash, state: 'DIALOG_OPENED' }); }
    catch (failure) { setError(failure.message); }
  }, [rendered, error, autoPrintWindow, printDisabled, plan, onPrintDialog]);
  const print = () => {
    if (!rendered || rendered.planId !== plan?.id || printDisabled) return;
    setError('');
    try { printLabel(openManualLabelPrintWindow(), rendered, plan.label); setDialogOpened(true); onPrintDialog?.({ intentId: plan.print.intentId, planHash: plan.planHash, state: 'DIALOG_OPENED' }); }
    catch (failure) { setError(failure.message); }
  };
  return <section className={styles.station} aria-label="Label and NFC finishing">
    <div className={styles.header}><div><span className={styles.eyebrow}>ATLAS FINISHING</span><h2>Ready for the slab.</h2></div><span className={styles.version}>v{plan?.label?.approvalVersion}</span></div>
    <div className={styles.statuses} aria-live="polite"><span className={styles.ready}>✓ Report approved</span><span>{dialogOpened ? 'Print dialog opened' : error ? 'Label needs attention' : rendered?.planId === plan?.id ? 'Label ready' : 'Preparing label'}</span><span>NFC setup pending</span></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {rendered && rendered.planId === plan?.id && <div className={styles.faces}>
      <figure><figcaption>FRONT</figcaption><div className={styles.face} dangerouslySetInnerHTML={{ __html: rendered.front }} /></figure>
      <figure><figcaption>REVERSE</figcaption><div className={styles.face} dangerouslySetInnerHTML={{ __html: rendered.reverse }} /></figure>
    </div>}
    <div className={styles.controls}><button type="button" className={styles.print} onClick={print} disabled={!rendered || rendered.planId !== plan?.id || printDisabled}>Print label <span aria-hidden="true">↗</span></button>
      <label>Ink<select aria-label="Label ink" value={palette} onChange={event => setPalette(event.target.value)}><option value="NOIR_GOLD">Black + gold</option><option value="MONOCHROME">Monochrome</option></select></label>
      {plan?.label && <a href={plan.label.url} target="_blank" rel="noreferrer">Open approved report ↗</a>}
    </div>
    <details className={styles.details}><summary>Print and NFC setup</summary><p>Each face is 2.73 × 0.83 in. Print at actual size with headers and footers off. The front reserves 11 mm for NFC with a 9 mm guide. Verify physical fit and QR scanning once for the selected printer and material.</p><p>Automatic printing requires the configured Mac print bridge. NFC tap-to-write requires the qualified Mac bridge for ACS ACR1552U / F8215. The report reference is unchanged; printing does not record tag verification, assembly or welding.</p></details>
  </section>;
}
