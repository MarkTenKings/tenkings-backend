import React, { useEffect, useRef, useState } from 'react';
import { geometryImage } from '@atlas/manual-workspace';
import { useVerifiedImage } from '@atlas/manual-workspace/report-review';
import { manualRequest } from '../lib/manual-client.mjs';
import { staffApiPath } from '../lib/routes.mjs';
import { createVariantReviewClient, variantBindingKey, variantApprovalReady, variantConfirmationCurrent, variantError } from '../lib/variant-review-client.mjs';
import { unmatchedVariantReferences } from '../lib/variant-reference-photos.mjs';
import styles from './VariantIdentityReview.module.css';

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const groups = [{ key: 'same', label: 'This card’s printings' }, { key: 'language', label: 'Other languages' }, { key: 'other', label: 'Other card matches' }, { key: 'reference', label: 'Other saved reference photos' }];
const retainedPending = owner => { const saved = owner.retained(); return saved?.pending ? { ...saved.pending, operation: saved.operation ?? 'CONFIRM' } : null; };
// Browser-safe equivalent of the catalog number comparison. Missing totals
// remain unknown, while numeric padding never makes a different card.
export function variantCardNumberComparison(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.trim() || !b.trim()) return 'unknown';
  const norm = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const parse = value => norm(value).replace(/^#/, '').split('/').map(part => part.replace(/^([a-z]*)(0+)(\d+)$/i, '$1$3'));
  const x = parse(a), y = parse(b);
  if (x[0] !== y[0]) return 'conflict';
  if (x.length > 2 || y.length > 2) return norm(a) === norm(b) ? 'match' : 'conflict';
  return x[1] && y[1] ? x[1] === y[1] ? 'match' : 'conflict' : x.length === y.length ? 'match' : 'unknown';
}
export function variantCandidateGroup(candidate, identity) {
  if (['ebay_sold_comps_v2', 'tcgdex'].includes(candidate.source?.provider)) return 'reference';
  const expected = { name: identity?.cardName ?? identity?.playerName ?? identity?.name, setName: identity?.productSet ?? identity?.setName };
  if (Object.entries(expected).some(([field, value]) => value && normalize(value) !== normalize(candidate.identity[field])
    && !(field === 'setName' && candidate.source?.provider === 'scrydex' && !candidate.warnings?.includes('SET_NAME_REQUIRES_REVIEW')))) return 'other';
  if (identity?.year && candidate.identity.year && String(identity.year) !== String(candidate.identity.year)) return 'other';
  if (variantCardNumberComparison(identity?.cardNumber, candidate.identity.cardNumber) === 'conflict') return 'other';
  return identity?.language && candidate.identity.language && normalize(identity.language) !== normalize(candidate.identity.language) ? 'language' : 'same';
}
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : null; } catch { return null; }
}
function listingSource(image) {
  if (image?.relationship !== 'listing_photo' || image.provenance?.provider !== 'ebay_sold_comps_v2') return null;
  const listing = image.listing, url = safeUrl(listing?.url);
  if (!listing || !Object.hasOwn(listing, 'url') || listing.url != null && !url?.startsWith('https://')) return null;
  return { title: typeof listing.title === 'string' && listing.title.trim() ? listing.title : 'Saved eBay reference photo', url };
}
export function variantReference(candidate, cardId, { artwork = true, result = null } = {}) {
  const labels = result?.referenceLabels;
  const associated = labels?.version === 'atlas-slab-label-associations/v1' && labels.catalogHash === result?.catalog?.snapshotHash
    ? (labels.readings ?? []).filter(reading => reading.candidateId === candidate?.candidateId && reading.labelText && reading.gradingCompany)
      .flatMap(reading => (result.catalog.referencePhotos ?? []).filter(image => image.imageId === reading.imageId && image.sha256 === reading.sha256)
        .map(image => ({ ...image, labelReading: { company: reading.gradingCompany, text: reading.labelText } }))) : [];
  const images = [...associated, ...(candidate?.images ?? [])].map(image => {
    // Listing photographs always use saved, hash-verified bytes. The enclosing
    // candidate may retain Scrydex's label and provider, so use image provenance.
    const listing = image.relationship === 'listing_photo';
    const retained = image.publication || (listing || candidate.authority === 'provider_candidate') && image.provenance?.usage === 'provider_reference';
    if (listing && (!listingSource(image) || image.provenance?.usage !== 'provider_reference' || !cardId || !retained || !/^[a-f0-9]{64}$/.test(image.sha256 ?? ''))) return null;
    return cardId && retained && /^[a-f0-9]{64}$/.test(image.sha256 ?? '')
      ? { ...image, url: staffApiPath(`manual-connected/cards/${cardId}/variants/images/${image.sha256}`) } : image;
  }).filter(Boolean);
  const image = ['listing_photo','exact','representative',...(artwork ? ['card_art_only'] : [])].flatMap(kind => images.filter(item => item.relationship === kind))
    .find(item => safeUrl(item.url) && ['reviewed_catalog','provider_reference'].includes(item.provenance?.usage));
  return image ? { ...image, url: safeUrl(image.url) } : null;
}
function referenceLabel(image) {
  if (image?.associationStatus === 'UNASSIGNED') return image.labelReading?.company ? `Saved ${image.labelReading.company} slab · printing unassigned` : 'Saved reference photo · printing unassigned';
  if (image?.labelReading?.company) return `${image.labelReading.company} slab · saved in ATLAS Codex`;
  return ({ exact: 'Exact printing reference', listing_photo: 'eBay listing photo', representative: 'Representative printing · different card may be pictured', card_art_only: 'Card artwork · finish is not shown' })[image?.relationship] ?? 'Reference photo unavailable';
}
function referenceSource(image, candidate, className = styles.source) {
  const listing = listingSource(image);
  const url = listing?.url ?? safeUrl(image?.provenance?.sourceUrl ?? candidate?.source?.url);
  return url ? <p className={className}><a href={url} target="_blank" rel="noopener noreferrer">{listing?.title ?? 'Reference source ↗'}</a></p> : null;
}
function ReferencePhoto({ image, label, enlarged = false }) {
  const frame = useRef(null), [visible, setVisible] = useState(enlarged);
  useEffect(() => {
    if (enlarged || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, [enlarged]);
  const verified = useVerifiedImage(visible && image?.sha256 ? { ...image, mime: image.mimeType } : null);
  const [failedUrl, setFailedUrl] = useState(null);
  const url = image?.sha256 ? verified.url : image?.url;
  const failed = Boolean(url && failedUrl === url);
  return <span className={styles.referenceViewport} ref={frame}>{url && !failed ? <img src={url} alt={label} draggable={false} loading={enlarged ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)}/>
    : <span className={styles.missing}>{image && !failed && !verified.error ? 'Loading reference…' : 'Reference photo unavailable'}</span>}</span>;
}
const fitCamera = () => ({scale:1,x:0,y:0});
const clampCamera = camera => { const bound=(camera.scale-1)/2; return {...camera,x:Math.max(-bound,Math.min(bound,camera.x)),y:Math.max(-bound,Math.min(bound,camera.y))}; };
export function zoomVariantPhoto(camera, {deltaY,deltaMode=0,clientX,clientY}, rect) {
  const delta=deltaY*(deltaMode===1?16:deltaMode===2?rect.height:1),scale=Math.max(1,Math.min(8,camera.scale*Math.exp(-delta*.002)));
  const anchor={x:(clientX-rect.left)/rect.width-.5,y:(clientY-rect.top)/rect.height-.5},ratio=scale/camera.scale;
  return clampCamera({scale,x:anchor.x-(anchor.x-camera.x)*ratio,y:anchor.y-(anchor.y-camera.y)*ratio});
}
export function VariantPhotoPane({camera,setCamera,children,label}) {
  const pane=useRef(null),drag=useRef(null),moved=useRef(false);
  useEffect(()=>{const element=pane.current;if(!element)return;const wheel=event=>{event.preventDefault();const rect=element.getBoundingClientRect();if(rect.width&&rect.height)setCamera(current=>zoomVariantPhoto(current,event,rect));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[setCamera]);
  return <div ref={pane} className={styles.zoomPane} aria-label={label} onPointerDown={event=>{if(event.button!==0||camera.scale===1)return;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,camera,rect:event.currentTarget.getBoundingClientRect()};moved.current=false;event.currentTarget.setPointerCapture?.(event.pointerId);}}
    onPointerMove={event=>{const start=drag.current;if(!start||event.pointerId!==start.id)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;moved.current ||= Math.abs(dx)+Math.abs(dy)>3;setCamera(clampCamera({...start.camera,x:start.camera.x+dx/start.rect.width,y:start.camera.y+dy/start.rect.height}));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onClickCapture={event=>{if(moved.current){event.preventDefault();event.stopPropagation();moved.current=false;}}}>
    <div className={styles.zoomContents} style={{transform:`translate(${camera.x*100}%, ${camera.y*100}%) scale(${camera.scale})`}}>{children}</div>
  </div>;
}
function Comparison({ photo, reference, candidate, side, onClose }) {
  const dialog = useRef(null), [camera, setCamera] = useState(fitCamera);
  useEffect(() => { const value = dialog.current; value?.showModal(); return () => value?.close(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog className={styles.dialog} ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-label="Compare card details">
    <div className={styles.dialogHeading}><div><h3>Compare the visible details</h3><p>{candidate?.label ?? 'Your uploaded card'} · {side === 'FRONT' ? 'Front' : 'Back'}</p></div><button type="button" onClick={close} autoFocus>Close comparison</button></div>
    <p>Check the printed number, language, stamp and foil pattern against your physical card. Artwork alone does not confirm a finish.</p>
    <button type="button" aria-pressed={camera.scale > 1} onClick={() => setCamera(camera.scale > 1 ? fitCamera() : {...fitCamera(),scale:2})}>{camera.scale > 1 ? 'Fit both photos' : 'Enlarge both photos'}</button>
    {reference?.associationStatus === 'UNASSIGNED' && <p>This saved photograph has not been matched to a catalog printing. Inspect its label and details; opening it makes no variant selection.</p>}
    <p>Scroll or pinch to zoom either photograph. Drag to inspect the same area in both.</p><div className={styles.compare}><figure><figcaption>Your saved photograph</figcaption><VariantPhotoPane camera={camera} setCamera={setCamera} label="Uploaded photograph zoom">{photo ? <img src={photo} alt="Your unchanged uploaded photograph" draggable={false}/> : <span>Photograph unavailable</span>}</VariantPhotoPane></figure>
      <figure><figcaption>{referenceLabel(reference)}</figcaption><VariantPhotoPane camera={camera} setCamera={setCamera} label="Reference photograph zoom"><ReferencePhoto image={reference} label={candidate?.label ?? 'Reference'} enlarged/></VariantPhotoPane>{reference?.labelReading && <p className={styles.labelReading}><strong>Slab label</strong> {reference.labelReading.text}</p>}{referenceSource(reference, candidate, styles.comparisonSource)}</figure></div>
    {candidate?.diagnostics?.length > 0 && <ul>{candidate.diagnostics.map(cue => <li key={cue.id}>{cue.description}</li>)}</ul>}
  </dialog>;
}

/** All page-open and polling work reads saved status. Only explicit confirmation
 * writes; a suggested image never stands in for the reviewer’s decision. */
export default function VariantIdentityReview({ cardId, staffId, csrf, enabled, sourceHash, identityRevision, revision, identity, savedIdentification,
  geometry, images, disabled = false, previewOnly = false, onGateChange, onSaved, onActivityChange, onReloadImages, renderReviewActions,
  createClient = createVariantReviewClient, pollIntervalMs = 3000 }) {
  const [status, setStatus] = useState(null), [choice, setChoice] = useState(null), [unresolved, setUnresolved] = useState(null);
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [camera, setCamera] = useState(fitCamera);
  const [side, setSide] = useState('FRONT'), [comparison, setComparison] = useState(null), [reloadNeeded, setReloadNeeded] = useState(false);
  const [manual, setManual] = useState(null), [referencePermission, setReferencePermission] = useState(null);
  const [drafted, setDrafted] = useState(false), [previewId, setPreviewId] = useState(null), [variantFilter, setVariantFilter] = useState('');
  const comparisonOpener = useRef(null), choiceControls = useRef(null);
  const compare = (candidate, event) => { comparisonOpener.current = event.currentTarget; setComparison(candidate); };
  const client = useRef(null), generation = useRef(0), lock = useRef(false), callbacks = useRef({});
  callbacks.current = { onGateChange, onSaved, onActivityChange, previewOnly };
  const front = useVerifiedImage(geometry?.sides?.FRONT ? geometryImage(geometry, 'FRONT', 'PHYSICAL', images) : null);
  const back = useVerifiedImage(geometry?.sides?.BACK ? geometryImage(geometry, 'BACK', 'PHYSICAL', images) : null);
  const photograph = side === 'FRONT' ? front : back;
  const matchesWorkspace = value => value?.sourceHash === sourceHash && value?.identityRevision === identityRevision
    && (revision === undefined || value.revision === revision);
  const current = matchesWorkspace(status);
  async function refreshWorkspace() {
    if (callbacks.current.previewOnly) return;
    const version = generation.current;
    try { await callbacks.current.onSaved?.(); if (version === generation.current) setReloadNeeded(false); }
    catch { if (version === generation.current) { setReloadNeeded(true); setError('The current review could not be reloaded. Your saved decision is retained; reload before final approval.'); } }
  }
  function accept(owner, value) {
    const saved = owner.retained(); setStatus(value); setPending(retainedPending(owner));
    const draft = saved?.draft?.binding === variantBindingKey(value) ? saved.draft : null;
    setDrafted(Boolean(draft));
    setChoice(draft ? draft.candidateId : value.confirmation?.selectedCandidateId ?? null);
    setManual(draft?.manual ?? null);
    const retainedPermission = saved?.pending?.sourceHash === value.sourceHash && saved.pending.identityRevision === value.identityRevision
      && saved.pending.identityHash === value.identityHash ? saved.pending.referencePermission : null;
    setReferencePermission(draft?.outcome ? null : draft?.referencePermission ?? retainedPermission ?? null);
    setUnresolved(draft ? draft.outcome : value.confirmation?.decision === 'UNRESOLVED' ? 'CANNOT_TELL' : null);
  }
  useEffect(() => {
    const version = ++generation.current; lock.current = false; client.current = null;
    setCamera(fitCamera()); setStatus(null); setManual(null); setReferencePermission(null); setDrafted(false); setChoice(null); setUnresolved(null); setPending(null); setBusy(false); setError(''); setNotice(''); setReloadNeeded(false); setComparison(null);
    if (!enabled) return;
    Promise.resolve().then(async () => {
      const owner = createClient({ cardId, staffId, storage: window.localStorage,
        request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
      if (generation.current !== version) return; client.current = owner;
      const result = await owner.read(); if (generation.current === version) {
        accept(owner, result);
        if (!matchesWorkspace(result)) await refreshWorkspace();
      }
    }).catch(failure => { if (generation.current === version) setError(variantError(failure)); });
    return () => { if (generation.current === version) generation.current++; };
  }, [cardId, staffId, csrf, enabled, sourceHash, identityRevision, revision, createClient]);
  useEffect(() => {
    if (!enabled || !status || pending || !['QUEUED','SEARCHING'].includes(status.state)) return;
    const version = generation.current; let stopped = false, timer;
    const tick = async () => {
      if (stopped || generation.current !== version) return;
      if (!lock.current) try { const owner = client.current, result = await owner.read(); if (!stopped && generation.current === version) { accept(owner, result); setError(''); } }
      catch { if (!stopped && generation.current === version) setError('Saved matches could not be checked. Your grading work is retained.'); }
      if (!stopped && generation.current === version) timer = setTimeout(tick, pollIntervalMs);
    };
    timer = setTimeout(tick, pollIntervalMs); return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, status?.state, pending, pollIntervalMs]);
  const identitySaved = current && variantConfirmationCurrent(status) && !drafted;
  const confirmed = current && variantApprovalReady(status) && !drafted && !unresolved && !manual && (status?.confirmation?.decision === 'MANUAL' || choice === status?.confirmation?.selectedCandidateId);
  const gate = !enabled || Boolean(!previewOnly && confirmed && !pending && !busy && !reloadNeeded);
  useEffect(() => { callbacks.current.onGateChange?.(gate); }, [gate]);
  useEffect(() => { callbacks.current.onActivityChange?.(Boolean(busy || pending && (!previewOnly || pending.operation === 'REFRESH'))); return () => callbacks.current.onActivityChange?.(false); }, [busy, pending, previewOnly]);
  async function check() {
    const owner = client.current, version = generation.current; if (!owner || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = pending && (!previewOnly || pending.operation === 'REFRESH') ? await owner.resume() : await owner.read();
      if (version === generation.current) {
        accept(owner, result);
        if (pending) setNotice(pending.operation === 'REFRESH' ? 'Reference preparation request confirmed.' : 'Saved decision confirmed.');
        if ((pending?.operation !== 'REFRESH' && pending) || reloadNeeded || !matchesWorkspace(result)) await refreshWorkspace();
      } }
    catch (failure) { if (version === generation.current) { setPending(retainedPending(owner)); setError(variantError(failure)); } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  function choose(candidateId, outcome = null, manualValue = null, permission = referencePermission) {
    if (previewOnly || disabled || busy || pending || !current) return;
    try { client.current.choose(candidateId, outcome, manualValue, outcome ? null : permission); setDrafted(true); setManual(manualValue); setReferencePermission(outcome ? null : permission); setChoice(candidateId); setUnresolved(outcome); setNotice('Choice retained on this device · not yet confirmed'); setError(''); }
    catch (failure) { setError(variantError(failure)); }
  }
  async function refresh() {
    const owner = client.current, version = generation.current;
    if (!owner || lock.current || disabled || pending || !current || status?.refreshable !== true || previewOnly && drafted) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await owner.refresh(); if (version !== generation.current) return;
      accept(owner, result); setNotice('Reference preparation requested. Your grading work stays saved.');
    } catch (failure) { if (version === generation.current) { setPending(retainedPending(owner)); setError(variantError(failure)); } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function save() {
    if (previewOnly) return;
    const owner = client.current, version = generation.current;
    if (!owner || lock.current || disabled || !current || (!unresolved && (!choice && !manual || !front.url || !back.url))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await owner.confirm({ candidateId: choice, unresolved: Boolean(unresolved), manual, referencePermission });
      if (version !== generation.current) return;
      accept(owner, result); setNotice(result.confirmation?.decision === 'UNRESOLVED' ? 'Variant held for review. Your card identification and grading work are saved.' : 'Your identity decision is saved.');
      await refreshWorkspace();
    } catch (failure) { if (version === generation.current) { setPending(retainedPending(owner)); setError(variantError(failure)); } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  if (!enabled) return null;
  const candidates = status?.result?.catalog?.candidates ?? [], suggested = status?.result?.suggestion;
  const selected = candidates.find(candidate => candidate.candidateId === choice);
  const ordered = [...candidates].sort((a, b) => Number(b.candidateId === suggested?.candidateId) - Number(a.candidateId === suggested?.candidateId));
  const stateText = ({ NOT_REQUESTED: 'Matches are not prepared yet. Your grading work can continue.', QUEUED: 'Photo matches are queued. Grading continues independently.', SEARCHING: 'Preparing photo matches in the background…', UNKNOWN: 'Match preparation needs attention. Check its saved status; opening this review does not start another request.', FAILED: 'Match preparation needs attention. You can retain this card for identity review.', STALE: 'The photographs or identity changed. Waiting for current matches.' })[status?.state];
  const unavailable = disabled || busy || Boolean(pending) || !current;
  const suggestedCandidate = candidates.find(candidate => candidate.candidateId === suggested?.candidateId);
  const groupingIdentity = { ...identity, language: identity?.language ?? suggestedCandidate?.identity.language };
  const primaryChoices = ordered.filter(candidate => variantCandidateGroup(candidate, groupingIdentity) === 'same');
  const preview = candidates.find(candidate => candidate.candidateId === previewId) ?? selected ?? primaryChoices.find(candidate => variantReference(candidate, cardId, { artwork: false, result: status?.result })) ?? primaryChoices[0] ?? null;
  const previewPhoto = preview ? variantReference(preview, cardId, { artwork: false, result: status?.result }) : null;
  const unassignedPhotos = unmatchedVariantReferences(status?.result);
  const manualComplete = manual?.parallel.trim();
  const permissionComplete = !referencePermission || ['owned_original','licensed','permission'].includes(referencePermission.basis);
  const needsChoice = !unresolved && (manual ? !manualComplete : !selected?.parallel?.trim());
  const focusChoices = () => {
    choiceControls.current?.scrollIntoView({ block: 'start' });
    choiceControls.current?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus({ preventScroll: true });
  };
  const confirmationDisabled = unavailable || !unresolved && (!permissionComplete || (manual ? !manualComplete : !selected?.parallel?.trim() || status?.state !== 'READY') || !front.url || !back.url) || Boolean(confirmed);
  const reviewAction = reloadNeeded || !status && error
    ? { approve: () => void check(), disabled: busy || disabled, approveLabel: 'Reload saved review', message: 'Your saved decision is retained. Reload the review to continue.' }
    : pending
    ? { approve: () => void check(), disabled: busy || disabled, approveLabel: pending.operation === 'REFRESH' ? 'Check reference request' : 'Check saved decision', message: 'Check the retained request before making another choice.' }
    : { approve: needsChoice ? focusChoices : () => void save(), disabled: needsChoice ? unavailable : confirmationDisabled,
      approveLabel: needsChoice ? 'Choose variant' : unresolved ? 'Save for identity review' : 'Confirm variant',
      message: needsChoice ? 'Choose Base or enter the printing you can verify on your physical card.' : !permissionComplete ? 'Choose the photo rights basis or turn off the optional contribution.' : !unresolved && (!front.url || !back.url) ? 'Verifying both saved photographs…' : unresolved ? 'Keep this card for identity review.' : `Confirm ${selected?.label ?? manual?.parallel ?? 'the variant'} from your physical card.` };
  const savedName = identity?.playerName || identity?.cardName || identity?.name;
  const savedDetails = [['Year',identity?.year],['Manufacturer',identity?.manufacturer ?? (savedIdentification?.sourceHash === sourceHash ? savedIdentification.fields?.manufacturer : null)],['Set',identity?.productSet ?? identity?.setName],['Card number',identity?.cardNumber],['Saved variant',identity?.parallel]];
  const renderGroup = group => {
        const entries = ordered.filter(candidate => variantCandidateGroup(candidate, groupingIdentity) === group.key); if (!entries.length) return null;
        const visibleEntries = group.key === 'same' ? entries.filter(candidate => candidate.label.toLowerCase().includes(variantFilter.toLowerCase().trim())) : entries;
        const contents = <div className={styles.tiles}>{visibleEntries.map(candidate => {
          const chosen = previewOnly ? previewId === candidate.candidateId : choice === candidate.candidateId && !unresolved;
          if (group.key === 'reference') return <button key={candidate.candidateId} type="button" onClick={() => setPreviewId(candidate.candidateId)}>{candidate.label}</button>;
          return <label className={styles.tileChoice} data-selected={chosen} key={candidate.candidateId}>
            <input type="radio" name={`variant-${cardId}`} checked={chosen} disabled={unavailable || status.state !== 'READY' || !candidate.parallel?.trim()}
              onChange={() => { setPreviewId(candidate.candidateId); if (!previewOnly) choose(candidate.candidateId); }}/>
            <span><strong>{candidate.label}</strong>{group.key === 'language' && <small>{candidate.identity.language}</small>}</span>
          </label>;
        })}</div>;
        return group.key === 'same' ? <fieldset className={styles.group} key={group.key}><legend>Variants for this card <span>{entries.length}</span></legend>{entries.length > 8 && <label className={styles.variantSearch}>Find a variant<input type="search" value={variantFilter} onChange={event=>setVariantFilter(event.target.value)} placeholder="Search variant names"/></label>}{contents}{!visibleEntries.length && <p>No variant names match this search.</p>}</fieldset>
          : <details className={styles.more} key={group.key}><summary>{group.label} · {entries.length}</summary>{contents}</details>;
  };
  return <section className={styles.panel} aria-label="Final card identity review">
    <header className={styles.heading}><div><p className={styles.eyebrow}>{previewOnly ? 'CARD VARIANT REFERENCES' : 'FINAL REVIEW · CARD VARIANT'}</p><h2>{previewOnly ? 'Compare variant references' : 'Confirm the card variant'}</h2></div><span className={identitySaved ? styles.confirmed : styles.badge}>{identitySaved ? 'Human confirmed' : 'Variant still needs confirmation'}</span></header>
    {previewOnly ? <p role="status">Reference preview · Your grading review stays saved. Confirm the variant during final review.</p> : renderReviewActions ? !gate && renderReviewActions({...reviewAction, busy, message: error || (busy ? 'Saving your variant decision…' : reviewAction.message)}) : <div className={styles.actions} aria-label="Variant confirmation"><div><strong>{confirmed ? 'Identity confirmed for this saved card' : selected ? selected.label : manual ? manual.parallel || 'Choose the physical printing' : unresolved ? 'Keep for variant review' : 'Confirm the variant or keep it unresolved'}</strong><p role="status">{busy ? 'Checking the saved decision…' : notice || 'A suggested match is never approved automatically.'}</p></div>
      {pending ? <button type="button" className={styles.primary} disabled={busy || disabled} onClick={() => void check()}>{pending.operation === 'REFRESH' ? 'Check retained reference request' : 'Check retained decision'}</button>
        : <button type="button" className={styles.primary} disabled={confirmationDisabled} onClick={() => void save()}>{unresolved ? 'Save for identity review' : confirmed ? 'Identity confirmed' : 'Confirm selected identity'}</button>}
    </div>}
    <section className={styles.savedIdentity} aria-label="Saved card identification"><p>{savedName ? 'Card identified' : 'Saved card details'}</p><h3>{savedName || 'Card name not recorded'}</h3><dl>{savedDetails.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value == null || value === '' ? 'Not recorded' : value}</dd></div>)}</dl></section>
      {!status && <p role="status">Checking saved photo matches…</p>}{stateText && <p role="status" className={styles.notice}>{stateText}</p>}
      {status && !current && <p role="status">The saved choices belong to an earlier identity. Reload the current review.</p>}
      {suggested?.candidateId && candidates.some(candidate => candidate.candidateId === suggested.candidateId) && <p className={styles.suggestion}><strong>AI suggestion · not a confirmation</strong></p>}
      {status?.state === 'READY' && !candidates.length && <p>The reference library has no usable variant matches for this card. Your saved identification and grading work are retained. Verify the variant from the physical card if you can, or keep it unresolved.</p>}

    <p className={styles.photoHelp}>Scroll or pinch on either photo to zoom. Drag to pan. <button type="button" onClick={() => setCamera(fitCamera())}>Fit both photos</button></p>
    <div className={styles.layout}><div className={styles.original}>
      <div className={styles.sideButtons} aria-label="Uploaded photograph side">{['FRONT','BACK'].map(value => <button key={value} type="button" aria-pressed={side === value} onClick={() => { setSide(value); setCamera(fitCamera()); }}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div>
      <figure><div className={styles.originalPhoto}><VariantPhotoPane camera={camera} setCamera={setCamera} label="Uploaded photograph zoom">{photograph.url ? <button type="button" className={styles.photoButton} onClick={event => compare(preview ?? {}, event)} aria-label="Enlarge your uploaded photograph"><img src={photograph.url} alt={`Your saved ${side.toLowerCase()} photograph`} draggable={false}/></button> : <span role="status">{photograph.error ? 'Saved photograph unavailable' : 'Verifying your saved photograph…'}</span>}</VariantPhotoPane></div><figcaption>Your uploaded card · unchanged pixels</figcaption></figure>
      {(!front.url || !back.url) && onReloadImages && <button type="button" onClick={onReloadImages} disabled={busy}>Reload photographs</button>}

    </div><div className={styles.choices}>
      <div ref={choiceControls} className={styles.choiceControls} aria-label="Choose the card variant">
        <div className={styles.variantPicker}>{groups.filter(group => group.key === 'same').map(renderGroup)}</div>
        {!previewOnly && status && <fieldset className={styles.manual} disabled={unavailable}><legend>Confirm from the physical card</legend><button type="button" aria-pressed={manual?.parallel === 'Base'} onClick={() => choose(null, null, {parallel:'Base'})}>Base</button><label>Language, printing and variant<input maxLength={120} value={manual?.parallel ?? ''} onChange={event => choose(null, null, {...manual,parallel:event.target.value})} placeholder="For example: English, reverse holo"/></label></fieldset>}
      </div>
      {preview && <article className={styles.referenceFocus} aria-label="Variant reference preview">
        <div className={styles.referenceHeading}><h3>{preview.label}</h3><span>{preview.identity.language || ''}</span></div>
        {previewPhoto ? <><VariantPhotoPane camera={camera} setCamera={setCamera} label="Reference photograph zoom"><button type="button" className={styles.focusPhoto} onClick={event => compare(preview, event)} disabled={!photograph.url} aria-label={`Enlarge ${preview.label} reference`}>
          <ReferencePhoto image={previewPhoto} label={`${preview.label} reference`} enlarged/>
        </button>
        </VariantPhotoPane><p className={styles.photoHelp}>{previewPhoto.labelReading ? referenceLabel(previewPhoto) : previewPhoto.relationship === 'listing_photo' ? 'eBay listing photo · compare the finish and markings' : referenceLabel(previewPhoto)}</p></> : <p className={styles.photoHelp}>{unassignedPhotos.length ? 'No photo is assigned to this printing yet. Compare the saved reference photos below.' : 'No matching reference photo yet.'}</p>}
        {previewPhoto?.labelReading && <p className={styles.labelReading}><strong>Slab label</strong> {previewPhoto.labelReading.text}</p>}
        <details className={styles.referenceDetails}><summary>Source and identifying details</summary>
          {variantCardNumberComparison(identity?.cardNumber, preview.identity.cardNumber) === 'unknown' && <p>Full collector number unconfirmed · check the number and set total on your card</p>}{referenceSource(previewPhoto, preview)}
          {preview.diagnostics.length > 0 && <ul className={styles.cues}>{preview.diagnostics.map(cue => <li key={cue.id}>{cue.description}</li>)}</ul>}
        </details>
      </article>}
    {unassignedPhotos.length > 0 && <section className={styles.unassigned} aria-label="Unassigned saved reference photos"><h3>Other saved reference photos · {unassignedPhotos.length}</h3><p>These photographs have not been matched to a catalog printing. Inspect the saved labels and compare their details with your physical card.</p><div className={styles.referenceGallery}>{unassignedPhotos.map(image => {
      const candidate = { authority: 'provider_candidate', label: image.labelReading.company ? `${image.labelReading.company} · unassigned reference` : 'Unassigned reference photo', images: [image], diagnostics: [] };
      const reference = variantReference(candidate, cardId, { artwork: false });
      return <article key={image.sha256}><button type="button" className={styles.galleryPhoto} disabled={!reference || !photograph.url} onClick={event => compare(candidate, event)} aria-label={`Compare ${candidate.label}`}><ReferencePhoto image={reference} label={candidate.label}/></button><p className={styles.labelReading}><strong>{referenceLabel(image)}</strong>{image.labelReading.text || 'No slab label was read from this photograph.'}</p><p>{image.labelReading.reason}</p>{referenceSource(image, candidate)}</article>;
    })}</div></section>}
      {!previewOnly && status && <div className={styles.unknown}><p>{candidates.length ? 'None of these is a clear variant match?' : 'Keep the variant unresolved if you cannot verify it.'}</p><div><button type="button" aria-pressed={unresolved === 'NOT_SHOWN'} disabled={unavailable} onClick={() => choose(null, 'NOT_SHOWN')}>My card is not shown</button><button type="button" aria-pressed={unresolved === 'CANNOT_TELL'} disabled={unavailable} onClick={() => choose(null, 'CANNOT_TELL')}>I cannot tell</button></div>{unresolved && <p>Your card identification and grading work stay saved. Final approval waits for variant confirmation. Do not guess from artwork or reflections.</p>}</div>}

    </div></div>
    {groups.filter(group => group.key !== 'same').map(renderGroup)}
    {!previewOnly && status && !unresolved && <fieldset aria-label="Optional reference photo contribution" className={styles.contribution} disabled={unavailable}>
      <label className={styles.contributionChoice}><input type="checkbox" aria-label="Add these photos to the shared reference library" checked={Boolean(referencePermission)} onChange={event => choose(choice, null, manual, event.target.checked ? {basis:'',consumers:['inventory','atlas']} : null)}/><span>Add these photos to the shared reference library <small>Optional</small></span></label>
      <p>For internal ATLAS and Ten Kings reference review. This submits your original photos for review; it does not publish them automatically.</p>
      {referencePermission && <div className={styles.contributionFields}><label>Photo rights basis<select aria-label="Photo rights basis" value={referencePermission.basis} onChange={event => choose(choice, null, manual, {...referencePermission,basis:event.target.value})}><option value="">Choose the rights basis</option><option value="owned_original">I own these original photos</option><option value="permission">I have permission to share them</option><option value="licensed">A license allows this use</option></select></label></div>}
    </fieldset>}
    {status?.refreshable === true && (!previewOnly || !drafted) && <div><p><button type="button" disabled={unavailable} onClick={() => void refresh()}>{drafted ? 'Discard unsaved choice and refresh reference library' : 'Refresh reference library'}</button></p>{drafted && <p className={styles.photoHelp}>This discards only your unsaved variant choice. Your saved variant and grading work stay unchanged.</p>}</div>}
    {error && <p className={styles.error} role="alert">{error}</p>}{(!status || stateText || error || reloadNeeded || pending) && <button type="button" disabled={busy} onClick={() => void check()}>Check saved matches</button>}
    {comparison && <Comparison photo={photograph.url} reference={variantReference(comparison, cardId, { artwork: false, result: status?.result })} candidate={comparison} side={side} onClose={() => { setComparison(null); comparisonOpener.current?.focus(); }}/>}
  </section>;
}
