/* eslint-disable @next/next/no-img-element -- Only authenticated private previews are displayed. */
import { useEffect, useRef, useState } from 'react';
import type { StaffInventoryResearchResult } from '../../lib/staffInventoryResearch';
import { StaffInventoryResearchReviewCommandSchema, StaffInventoryResearchReviewResponseSchema, projectStaffInventoryResearchReview,
  type StaffInventoryResearchReviewCommand, type StaffInventoryResearchReviewSnapshot } from '../../lib/staffInventoryMarketValue';
import styles from './StaffInventoryResearchPanel.module.css';

type Binding = { jobId: string; unitId: string; descriptionEventId: string; inputHash: string; resultHash: string };
type Pending = { command: StaffInventoryResearchReviewCommand; state: 'pending' | 'conflict' };
export type InventoryReviewPhotos = { front: string | null; back: string | null };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
const exactBinding = (command: StaffInventoryResearchReviewCommand, binding: Binding) => Object.entries(binding).every(([key, value]) => command[key as keyof Binding] === value);

export default function StaffInventoryCompReview({ actorId, token, binding, result, review, previews, photos, onSaved, onConflict }: {
  actorId: string; token: string; binding: Binding; result: StaffInventoryResearchResult; review: StaffInventoryResearchReviewSnapshot;
  previews: Record<string, string>; photos: InventoryReviewPhotos; onSaved(review: StaffInventoryResearchReviewSnapshot): void; onConflict(): void;
}) {
  const storageKey = `tenkings:inventory:comp-review:${JSON.stringify([actorId, binding.unitId, binding.descriptionEventId, binding.jobId, binding.inputHash, binding.resultHash])}`;
  const scope = JSON.stringify([storageKey, token]), current = useRef(scope); current.current = scope;
  const [index, setIndex] = useState(0), [side, setSide] = useState<'front' | 'back'>('front');
  const [zoom, setZoom] = useState<{ url: string; label: string } | null>(null), [failedImages, setFailedImages] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [freshConflictSnapshot, setFreshConflictSnapshot] = useState(true), suppressPhotoClickUntil = useRef(0);
  const pendingRef = useRef<Pending | null>(null), busyRef = useRef(false), request = useRef<AbortController | null>(null), active = useRef(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; candidateId: string; revision: number } | null>(null), zoomClose = useRef<HTMLButtonElement>(null);
  const candidates = result.selected_candidate_ids.flatMap(id => { const candidate = result.candidates.find(value => value.id === id); return candidate ? [candidate] : []; });
  const candidate = candidates[Math.min(index, Math.max(0, candidates.length - 1))];
  const decisions = new Map(review.decisions.map(decision => [decision.candidate_id, decision]));
  const confirmed = candidates.filter(candidate => decisions.get(candidate.id)?.decision === 'confirmed').length;
  const excluded = candidates.filter(candidate => decisions.get(candidate.id)?.decision === 'excluded').length;
  useEffect(() => {
    active.current = true; setReady(false); setPending(null); pendingRef.current = null; setError(''); setNotice(''); setIndex(0); setZoom(null); setFailedImages([]);
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved), command = StaffInventoryResearchReviewCommandSchema.parse(value.command);
        if (!exactBinding(command, binding) || !['pending', 'conflict'].includes(value.state)) throw new Error();
        const restored: Pending = { command, state: value.state }; pendingRef.current = restored; setPending(restored);
      }
      setReady(true);
    } catch { setError('Your saved comp decision could not be read. Keep this tab open and contact your administrator.'); }
    return () => { active.current = false; request.current?.abort(); gesture.current = null; };
    // The enclosing panel remounts this view for each exact result/session binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => { if (zoom) zoomClose.current?.focus(); }, [zoom]);
  const live = () => active.current && current.current === scope;
  const persist = (value: Pending) => { const bytes = JSON.stringify(value); sessionStorage.setItem(storageKey, bytes); if (sessionStorage.getItem(storageKey) !== bytes) throw new Error(); pendingRef.current = value; setPending(value); };
  async function submit(command: StaffInventoryResearchReviewCommand, recovering = false) {
    if (busyRef.current || !live()) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const controller = new AbortController(); request.current = controller; const timer = setTimeout(() => controller.abort(), 20000);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    try {
      const response = await fetch('/api/v2/admin/inventory/research-review', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), cache: 'no-store', signal: controller.signal });
      if (!live()) return;
      if (controller.signal.aborted) throw new Error();
      if (response.status === 409) {
        persist({ command, state: 'conflict' }); setFreshConflictSnapshot(false); onConflict(); return;
      }
      const parsed = StaffInventoryResearchReviewResponseSchema.safeParse(await response.json());
      if (!live()) return;
      if (controller.signal.aborted || !response.ok || !parsed.success) throw new Error();
      const receipt = parsed.data, next = receipt.review;
      if (receipt.request_id !== command.requestId || receipt.recorded_revision !== command.expectedRevision + 1 || next.job_id !== binding.jobId || next.unit_id !== binding.unitId
        || next.description_event_id !== binding.descriptionEventId || next.input_hash !== binding.inputHash || next.result_hash !== binding.resultHash
        || next.revision <= command.expectedRevision || !projectStaffInventoryResearchReview(result, next, binding.resultHash)) throw new Error();
      if (receipt.outcome === 'RECORDED' && !next.decisions.some(decision => decision.candidate_id === command.candidateId && decision.decision === command.decision
        && decision.request_id === command.requestId && decision.actor_id === actorId && decision.revision === receipt.recorded_revision)) throw new Error();
      // A replay can return newer decisions; its exact acknowledgement still confirms this command.
      onSaved(next);
      sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
      setNotice(receipt.outcome === 'REPLAY' ? 'Saved decision recovered. The latest review is shown.' : command.decision === 'confirmed' ? 'Comp confirmed. The saved value is updated.' : 'Comp excluded. The saved value is updated.');
      if (!recovering && receipt.outcome === 'RECORDED') { setIndex(value => Math.min(value + 1, candidates.length - 1)); setZoom(null); }
    } catch { if (live()) setError('This decision could not be confirmed. Retry the saved decision; do not submit a different one.'); }
    finally { clearTimeout(timer); if (request.current === controller) request.current = null; if (live()) { busyRef.current = false; setBusy(false); } }
  }
  function decide(decision: 'confirmed' | 'excluded') {
    if (!candidate || !ready || zoom || busyRef.current || pendingRef.current) return;
    try {
      const command = StaffInventoryResearchReviewCommandSchema.parse({ ...binding, requestId: crypto.randomUUID(), expectedRevision: review.revision, candidateId: candidate.id, decision });
      persist({ command, state: 'pending' }); void submit(command);
    } catch { setError('This browser could not safely retain the decision. Nothing was submitted.'); }
  }
  function useLatest() {
    if (pendingRef.current?.state !== 'conflict' || !freshConflictSnapshot || busyRef.current) return;
    try {
      const previous = JSON.stringify(pendingRef.current), archiveKey = `${storageKey}:rejected:${pendingRef.current.command.requestId}`;
      sessionStorage.setItem(archiveKey, previous); if (sessionStorage.getItem(archiveKey) !== previous) throw new Error();
      sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null); setError(''); setNotice('Latest review loaded. Choose the decision again if it is still appropriate.');
    } catch { setError('The conflicting decision could not be retained safely. Keep this tab open.'); }
  }
  function image(url: string | null | undefined, label: string) {
    return url && !failedImages.includes(url) ? <button type="button" data-review-photo="true" className={styles.reviewImage} aria-label={`Enlarge ${label}`} onClick={() => { if (Date.now() >= suppressPhotoClickUntil.current) setZoom({ url, label }); }}>
      <img src={url} alt={label} referrerPolicy="no-referrer" onError={() => setFailedImages(values => [...values, url])} /><span>Enlarge photo</span>
    </button> : <div className={styles.reviewPhotoUnavailable}>{label} unavailable</div>;
  }
  if (!candidate) return null;
  const savedDecision = decisions.get(candidate.id), decision = savedDecision?.decision, controlsDisabled = !ready || busy || !!pending || !!zoom;
  const compPhoto = candidate.image?.storage_key ? previews[candidate.image.storage_key] : null;
  return <section className={styles.compReview} aria-label="Review selected sold comps">
    <header><div><h4>Review this comp</h4><p>Compare the card, printing and condition. Confirm a match or exclude it from the value.</p></div></header>
    <p className={styles.reviewProgress} aria-live="polite">Comp {index + 1} of {candidates.length} · {confirmed} confirmed · {excluded} excluded · {candidates.length - confirmed - excluded} awaiting review</p>
    <div className={styles.reviewPair} role="group" aria-label="Card and sold comp comparison" onPointerDown={event => {
      const interactive = (event.target as HTMLElement).closest('button,a,input,select,textarea');
      if (controlsDisabled || !event.isPrimary || event.button !== 0 || interactive && !interactive.hasAttribute('data-review-photo')) return;
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, candidateId: candidate.id, revision: review.revision };
    }} onPointerMove={event => { if (gesture.current?.pointerId === event.pointerId && Math.abs(event.clientY - gesture.current.y) > 35) gesture.current = null; }}
    onPointerCancel={() => { gesture.current = null; }} onPointerLeave={() => { gesture.current = null; }} onPointerUp={event => {
      const start = gesture.current; gesture.current = null; if (!start || start.pointerId !== event.pointerId || start.candidateId !== candidate.id || start.revision !== review.revision || controlsDisabled || zoom) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) >= 80 && Math.abs(dy) <= 35 && Math.abs(dx) > Math.abs(dy) * 2) { event.preventDefault(); suppressPhotoClickUntil.current = Date.now() + 400; decide(dx > 0 ? 'confirmed' : 'excluded'); }
    }}>
      <div className={styles.reviewOriginal}><h5>Your card</h5><div className={styles.reviewSides}><button type="button" aria-pressed={side === 'front'} onClick={() => setSide('front')}>Front</button><button type="button" aria-pressed={side === 'back'} onClick={() => setSide('back')}>Back</button></div>{image(photos[side], `${side} of your inventory card`)}</div>
      <div className={styles.reviewCandidate}><h5>eBay sold comp</h5><div className={styles.reviewCondition}>{candidate.raw ? 'Raw / ungraded' : `${candidate.grader} ${candidate.numeric_grade}`}</div>{image(compPhoto, `saved comp photo: ${candidate.title}`)}<strong>{candidate.sold_price_cents === null ? 'Verified price unavailable' : money(candidate.sold_price_cents)}</strong><span>{candidate.sold_date ? `Sold ${candidate.sold_date}` : 'Sale date unavailable'}</span><a href={candidate.listing_url} target="_blank" rel="noreferrer">{candidate.title} ↗</a><span className={styles.matchBadge}>{decision === 'confirmed' ? 'Staff confirmed' : decision === 'excluded' ? 'Staff excluded · Not used' : 'AI-selected · Awaiting review'}</span>{savedDecision && <span>Staff decision saved <time dateTime={savedDecision.reviewed_at}>{new Date(savedDecision.reviewed_at).toLocaleString()}</time></span>}</div>
    </div>
    {zoom && <div className={styles.reviewZoom} role="region" aria-label={`Enlarged ${zoom.label}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setZoom(null); } }}><button ref={zoomClose} type="button" onClick={() => setZoom(null)}>Close enlarged photo</button><img src={zoom.url} alt={zoom.label} referrerPolicy="no-referrer" /></div>}
    <div className={styles.reviewDecisions}><button type="button" disabled={controlsDisabled} onClick={() => decide('excluded')}>Exclude comp <span aria-hidden="true">←</span></button><button type="button" disabled={controlsDisabled} onClick={() => decide('confirmed')}>{decision === 'excluded' ? 'Restore and confirm comp' : 'Confirm comp'} <span aria-hidden="true">→</span></button></div>
    <p className={styles.reviewHint}>You can also swipe left to exclude or right to confirm. Excluded comps can be restored. At least two eligible comps are needed for a value.</p>
    <div className={styles.reviewNavigation}><button type="button" disabled={index === 0 || busy} onClick={() => { setIndex(value => value - 1); setZoom(null); }}>Previous comp</button><button type="button" disabled={index >= candidates.length - 1 || busy} onClick={() => { setIndex(value => value + 1); setZoom(null); }}>Next comp</button></div>
    {busy && <p role="status">Saving comp decision…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {pending?.state === 'pending' && !busy && <div className={styles.reviewPending}><p>This saved decision still needs confirmation. Its original request will be reused.</p><button type="button" onClick={() => void submit(pending.command, true)}>Retry saved decision</button></div>}
    {pending?.state === 'conflict' && <div className={styles.reviewPending}><p role="alert">The research or review changed. Your conflicting decision was not reapplied. Inspect the latest review before choosing again.</p><button type="button" disabled={!freshConflictSnapshot} onClick={useLatest}>Use latest review</button></div>}
  </section>;
}
