import { useEffect, useRef, useState } from 'react';
import { useVerifiedImage } from '@atlas/manual-workspace/report-review';
import styles from './StaffCompCuration.module.css';

const labels = { STANDARD: 'Standard label', BLACK_LABEL: 'Black Label', PRISTINE: 'Pristine', PERFECT: 'Perfect' };
/** Only an explicit opening reads the exact retained photograph. Unknown is
 * the default; text/title recognition never selects a designation. */
export default function StaffCompDesignationReview({ row, cardId, previewId, onChoose, disabled = false, selectionGroup = null, selectionCurrency = null }) {
  const proof = row.designationReview;
  const [openedBinding, setOpenedBinding] = useState(null);
  const generation = useRef(0), mounted = useRef(true), live = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // This is an event-generation counter, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      live.current = null;
    };
  }, []);
  const binding = `${cardId}|${previewId}|${row.id}|${proof.proofHash}|${proof.photoSha256}`;
  const [expanded, setOpen] = useState(false), [choice, setChoice] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [decodedUrl, setDecodedUrl] = useState(null), [failedUrl, setFailedUrl] = useState(null);
  const open = expanded && openedBinding === binding;
  const url = `/admin/api/staff/manual-connected/cards/${cardId}/presentation/market/archive-image?preview=${previewId}&image=${proof.photoSha256}`;
  const photo = useVerifiedImage(open ? { url, sha256: proof.photoSha256 } : null);
  const ready = Boolean(open && photo.url && decodedUrl === photo.url && failedUrl !== photo.url && !photo.error);
  const id = `comp-label-${proof.proofHash}`;
  const currentGeneration = generation.current;
  const compatible = value => !selectionGroup || selectionGroup === `${row.grader} / ${row.grade} / ${value}` && selectionCurrency === row.currency;
  live.current = { binding, row, open, ready, choice, confirmed, disabled, onChoose, compatible };
  const current = () => mounted.current && generation.current === currentGeneration && live.current?.binding === binding && live.current.row === row;
  function invalidate() { generation.current++; live.current = null; }
  function close() { invalidate(); setOpen(false); setChoice(''); setConfirmed(false); setDecodedUrl(null); setFailedUrl(null); }
  function choose() {
    if (!current()) return;
    const now = live.current;
    if (!now.open || !now.ready || !now.confirmed || now.disabled || !proof.allowedDesignations.includes(now.choice) || !now.compatible(now.choice)) return;
    const review = { id: row.id, designation: now.choice, photoSha256: proof.photoSha256, proofHash: proof.proofHash };
    close(); now.onChoose(review);
  }
  return <div className={styles.designationReview}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { if (!current()) return; if (open) close(); else { invalidate(); setOpenedBinding(binding); setOpen(true); } }}>
      {open ? 'Close label review' : 'Review saved label'}
    </button>
    {open && <div id={id} className={styles.labelReview}>
      <p>Check the saved photograph before choosing its label designation. Leave it unknown if the label is unclear or shows a qualifier.</p>
      <div className={styles.labelPhoto}>
        {photo.url && failedUrl !== photo.url ? <img src={photo.url} alt={`Saved sold-listing photograph: ${row.title}`} draggable={false}
          onLoad={() => { if (current() && live.current.open) setDecodedUrl(photo.url); }} onError={() => { if (current()) { invalidate(); setFailedUrl(photo.url); setConfirmed(false); } }}/>
          : <p role="status">{photo.error || failedUrl ? 'Saved photograph unavailable. This sale cannot be reviewed yet.' : 'Loading saved photograph…'}</p>}
      </div>
      {photo.url && ready && <a href={photo.url} target="_blank" rel="noopener noreferrer">Open full photograph</a>}
      {(photo.error || failedUrl) && <button type="button" onClick={() => { if (!current()) return; invalidate(); setFailedUrl(null); setDecodedUrl(null); setConfirmed(false); photo.retry(); }}>Retry saved photograph</button>}
      <details><summary>Saved label reading</summary><p className={styles.labelText}>{proof.labelText}</p></details>
      <label className={styles.designationChoice} htmlFor={`${id}-choice`}>Label designation
        <select id={`${id}-choice`} value={choice} disabled={!ready || disabled} onChange={event => { if (!current()) return; invalidate(); setChoice(event.target.value); setConfirmed(false); }}>
          <option value="">Unknown — leave unselected</option>
          {proof.allowedDesignations.map(value => <option key={value} value={value} disabled={!compatible(value)}>{labels[value]}</option>)}
        </select>
      </label>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={!ready || !choice || disabled}
        onChange={event => { if (!current()) return; invalidate(); setConfirmed(event.target.checked); }}/>I checked the saved photograph and confirm this label designation.</label>
      <button type="button" disabled={!ready || !choice || !confirmed || disabled || !compatible(choice)} onClick={choose}>Use this reviewed sale</button>
      {selectionGroup && <p className={styles.small}>Choose the same grade group and currency as your existing selection: {selectionGroup} · {selectionCurrency}.</p>}
      <p className={styles.small}>Recorded with your private selection. The saved search and published report stay unchanged.</p>
    </div>}
  </div>;
}
