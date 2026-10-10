import React, { useEffect, useRef, useState } from 'react';
import { geometryImage } from '@atlas/manual-workspace';
import { useVerifiedImage } from '@atlas/manual-workspace/report-review';
import { manualRequest } from '../lib/manual-client.mjs';
import { staffApiPath } from '../lib/routes.mjs';
import { createVariantReviewClient, variantBindingKey, variantApprovalReady, variantConfirmationCurrent, variantError, variantRecheckMessage } from '../lib/variant-review-client.mjs';
import styles from './VariantIdentityReview.module.css';

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const groups = [{ key: 'same', label: 'This card’s printings' }, { key: 'language', label: 'Other languages' }, { key: 'other', label: 'Other card matches' }];
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
  const expected = { name: identity?.cardName ?? identity?.playerName ?? identity?.name, setName: identity?.productSet ?? identity?.setName };
  if (Object.entries(expected).some(([field, value]) => value && normalize(value) !== normalize(candidate.identity[field]))) return 'other';
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
  return typeof listing?.id === 'string' && listing.id.trim() && typeof listing.title === 'string' && listing.title.trim()
    && url?.startsWith('https://') ? { title: listing.title, url } : null;
}
export function variantReference(candidate, cardId, { artwork = true } = {}) {
  const images = (candidate?.images ?? []).map(image => {
    // Listing photographs always use saved, hash-verified bytes. The enclosing
    // candidate may retain Scrydex's label and provider, so use image provenance.
    const listing = image.relationship === 'listing_photo';
    const retained = image.publication || (listing || candidate.authority === 'provider_candidate') && image.provenance?.usage === 'provider_reference';
    if (listing && (!listingSource(image) || image.provenance?.usage !== 'provider_reference' || !cardId || !retained || !/^[a-f0-9]{64}$/.test(image.sha256 ?? ''))) return null;
    return cardId && retained && /^[a-f0-9]{64}$/.test(image.sha256 ?? '')
      ? { ...image, url: staffApiPath(`manual-connected/cards/${cardId}/variants/images/${image.sha256}`) } : image;
  }).filter(Boolean);
  const image = ['exact','listing_photo','representative',...(artwork ? ['card_art_only'] : [])].flatMap(kind => images.filter(item => item.relationship === kind))
    .find(item => safeUrl(item.url) && ['reviewed_catalog','provider_reference'].includes(item.provenance?.usage));
  return image ? { ...image, url: safeUrl(image.url) } : null;
}
function referenceLabel(image) {
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
  return <span className={styles.referenceViewport} ref={frame}>{url && !failed ? <img src={url} alt={label} loading={enlarged ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)}/>
    : <span className={styles.missing}>{image && !failed && !verified.error ? 'Loading reference…' : 'Reference photo unavailable'}</span>}</span>;
}
function Comparison({ photo, reference, candidate, side, onClose }) {
  const dialog = useRef(null), [zoom, setZoom] = useState(false);
  useEffect(() => { const value = dialog.current; value?.showModal(); return () => value?.close(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog className={styles.dialog} ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-label="Compare card details">
    <div className={styles.dialogHeading}><div><h3>Compare the visible details</h3><p>{candidate?.label ?? 'Your uploaded card'} · {side === 'FRONT' ? 'Front' : 'Back'}</p></div><button type="button" onClick={close} autoFocus>Close comparison</button></div>
    <p>Check the printed number, language, stamp and foil pattern against your physical card. Artwork alone does not confirm a finish.</p>
    <button type="button" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? 'Fit both photos' : 'Enlarge both photos'}</button>
    <div className={styles.compare} data-zoom={zoom}><figure><figcaption>Your saved photograph</figcaption><div>{photo ? <img src={photo} alt="Your unchanged uploaded photograph"/> : <span>Photograph unavailable</span>}</div></figure>
      <figure><figcaption>{referenceLabel(reference)}</figcaption><div><ReferencePhoto image={reference} label={candidate?.label ?? 'Reference'} enlarged/></div>{referenceSource(reference, candidate, styles.comparisonSource)}</figure></div>
    {candidate?.diagnostics?.length > 0 && <ul>{candidate.diagnostics.map(cue => <li key={cue.id}>{cue.description}</li>)}</ul>}
  </dialog>;
}

/** All page-open and polling work reads saved status. Only explicit confirmation
 * writes; a suggested image never stands in for the reviewer’s decision. */
export default function VariantIdentityReview({ cardId, staffId, csrf, enabled, sourceHash, identityRevision, revision, identity,
  geometry, images, disabled = false, onGateChange, onSaved, onActivityChange, onReloadImages,
  createClient = createVariantReviewClient, pollIntervalMs = 3000 }) {
  const [status, setStatus] = useState(null), [choice, setChoice] = useState(null), [unresolved, setUnresolved] = useState(null);
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [side, setSide] = useState('FRONT'), [comparison, setComparison] = useState(null), [reloadNeeded, setReloadNeeded] = useState(false);
  const [manual, setManual] = useState(null), [referencePermission, setReferencePermission] = useState(null);
  const [drafted, setDrafted] = useState(false);
  const comparisonOpener = useRef(null);
  const compare = (candidate, event) => { comparisonOpener.current = event.currentTarget; setComparison(candidate); };
  const client = useRef(null), generation = useRef(0), lock = useRef(false), callbacks = useRef({});
  callbacks.current = { onGateChange, onSaved, onActivityChange };
  const front = useVerifiedImage(geometry?.sides?.FRONT ? geometryImage(geometry, 'FRONT', 'PHYSICAL', images) : null);
  const back = useVerifiedImage(geometry?.sides?.BACK ? geometryImage(geometry, 'BACK', 'PHYSICAL', images) : null);
  const photograph = side === 'FRONT' ? front : back;
  const matchesWorkspace = value => value?.sourceHash === sourceHash && value?.identityRevision === identityRevision
    && (revision === undefined || value.revision === revision);
  const current = matchesWorkspace(status);
  async function refreshWorkspace() {
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
    setStatus(null); setManual(null); setReferencePermission(null); setDrafted(false); setChoice(null); setUnresolved(null); setPending(null); setBusy(false); setError(''); setNotice(''); setReloadNeeded(false); setComparison(null);
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
  const gate = !enabled || Boolean(confirmed && !pending && !busy && !reloadNeeded);
  useEffect(() => { callbacks.current.onGateChange?.(gate); }, [gate]);
  useEffect(() => { callbacks.current.onActivityChange?.(Boolean(busy || pending)); return () => callbacks.current.onActivityChange?.(false); }, [busy, pending]);
  async function check() {
    const owner = client.current, version = generation.current; if (!owner || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = pending ? await owner.resume() : await owner.read();
      if (version === generation.current) {
        accept(owner, result);
        if (pending) setNotice(pending.operation === 'REFRESH' ? 'Reference preparation request confirmed.' : 'Saved decision confirmed.');
        if ((pending?.operation !== 'REFRESH' && pending) || reloadNeeded || !matchesWorkspace(result)) await refreshWorkspace();
      } }
    catch (failure) { if (version === generation.current) { setPending(retainedPending(owner)); setError(variantError(failure)); } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  function choose(candidateId, outcome = null, manualValue = null, permission = referencePermission) {
    if (disabled || busy || pending || !current) return;
    try { client.current.choose(candidateId, outcome, manualValue, outcome ? null : permission); setDrafted(true); setManual(manualValue); setReferencePermission(outcome ? null : permission); setChoice(candidateId); setUnresolved(outcome); setNotice('Choice retained on this device · not yet confirmed'); setError(''); }
    catch (failure) { setError(variantError(failure)); }
  }
  async function refresh() {
    const owner = client.current, version = generation.current;
    if (!owner || lock.current || disabled || pending || !current || status?.refreshable !== true) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await owner.refresh(); if (version !== generation.current) return;
      accept(owner, result); setNotice('Reference preparation requested. Your grading work stays saved.');
    } catch (failure) { if (version === generation.current) { setPending(retainedPending(owner)); setError(variantError(failure)); } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function save(retryConfirmed = false) {
    const owner = client.current, version = generation.current;
    const retry = retryConfirmed && status?.confirmation?.recheckRetryable === true;
    const chosenManual = retry && status.confirmation.decision === 'MANUAL'
      ? { parallel: identity?.parallel ?? '', features: status.confirmation.observedFeatures ?? '' } : manual;
    if (!owner || lock.current || disabled || !current || (!unresolved && (!choice && !chosenManual || !front.url || !back.url))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await owner.confirm({ candidateId: choice, unresolved: Boolean(unresolved), manual: chosenManual, referencePermission });
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
  const artwork = ordered.filter(candidate => variantCandidateGroup(candidate, groupingIdentity) === 'same')
    .map(candidate => ({ candidate, image: variantReference({ ...candidate, images: (candidate.images ?? []).filter(image => image.relationship === 'card_art_only') }, cardId) }))
    .find(reference => reference.image);
  const manualComplete = manual?.parallel.trim() && manual?.features.trim();
  const permissionComplete = !referencePermission || ['owned_original','licensed','permission'].includes(referencePermission.basis)
    && referencePermission.detail?.trim().length > 0 && referencePermission.detail.trim().length <= 1000;
  const savedName = identity?.playerName || identity?.cardName || identity?.name;
  const savedDetails = [['Year',identity?.year],['Manufacturer',identity?.manufacturer],['Set',identity?.productSet ?? identity?.setName],['Card number',identity?.cardNumber],['Saved variant',identity?.parallel]];
  return <section className={styles.panel} aria-label="Final card identity review">
    <header className={styles.heading}><div><p className={styles.eyebrow}>FINAL REVIEW · CARD VARIANT</p><h2>Confirm the card variant</h2><p>Your saved card details are shown below. Compare the variant with your physical card before final approval.</p></div><span className={identitySaved ? styles.confirmed : styles.badge}>{identitySaved ? 'Human confirmed' : 'Variant still needs confirmation'}</span></header>
    <div className={styles.actions} aria-label="Variant confirmation"><div><strong>{confirmed ? 'Identity confirmed for this saved card' : selected ? selected.label : manual ? 'Confirm observed physical details' : unresolved ? 'Keep for variant review' : 'Confirm the variant or keep it unresolved'}</strong><p role="status">{busy ? 'Checking the saved decision…' : notice || 'A suggested match is never approved automatically.'}</p></div>
      {pending ? <button type="button" className={styles.primary} disabled={busy || disabled} onClick={() => void check()}>{pending.operation === 'REFRESH' ? 'Check retained reference request' : 'Check retained decision'}</button>
        : identitySaved && status?.confirmation?.reprocessRequired && !status?.approvalReady ? <button type="button" className={styles.primary} disabled={unavailable || status.confirmation.recheckRetryable !== true || !front.url || !back.url} onClick={() => void save(true)}>{status.confirmation.recheckRetryable ? 'Retry confirmed variant check' : 'Identity saved · grading check pending'}</button>
        : <button type="button" className={styles.primary} disabled={unavailable || !unresolved && (!permissionComplete || (manual ? !manualComplete : !selected?.parallel?.trim() || status?.state !== 'READY') || !front.url || !back.url) || Boolean(confirmed)} onClick={() => void save()}>{unresolved ? 'Save for identity review' : confirmed ? 'Identity confirmed' : 'Confirm selected identity'}</button>}
    </div>
    <section className={styles.savedIdentity} aria-label="Saved card identification"><p>{savedName ? 'Card identified' : 'Saved card details'}</p><h3>{savedName || 'Card name not recorded'}</h3><dl>{savedDetails.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value == null || value === '' ? 'Not recorded' : value}</dd></div>)}</dl><p>{identitySaved ? 'The saved variant has been confirmed for this card.' : 'These are the saved identification details. The variant still requires your explicit confirmation.'}</p></section>
    <div className={styles.layout}><div className={styles.original}>
      <div className={styles.sideButtons} aria-label="Uploaded photograph side">{['FRONT','BACK'].map(value => <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div>
      <figure><div className={styles.originalPhoto}>{photograph.url ? <button type="button" className={styles.photoButton} onClick={event => compare(selected ?? {}, event)} aria-label="Enlarge your uploaded photograph"><img src={photograph.url} alt={`Your saved ${side.toLowerCase()} photograph`}/></button> : <span role="status">{photograph.error ? 'Saved photograph unavailable' : 'Verifying your saved photograph…'}</span>}</div><figcaption>Your uploaded card · unchanged pixels</figcaption></figure>
      {(!front.url || !back.url) && onReloadImages && <button type="button" onClick={onReloadImages} disabled={busy}>Reload photographs</button>}
      <p className={styles.photoHelp}>Tap the photo to inspect the printed number, language, stamp or foil pattern.</p>
    </div><div className={styles.choices}>
      {!status && <p role="status">Checking saved photo matches…</p>}{stateText && <p role="status" className={styles.notice}>{stateText}</p>}
      {status && !current && <p role="status">The saved choices belong to an earlier identity. Reload the current review.</p>}
      {variantRecheckMessage(status) && <p role="status" className={styles.notice}>{variantRecheckMessage(status)}</p>}
      {suggested?.candidateId && candidates.some(candidate => candidate.candidateId === suggested.candidateId) && <p className={styles.suggestion}><strong>AI suggestion · not a confirmation</strong>{suggested.reason && <span>{suggested.reason}</span>}</p>}
      {status?.state === 'READY' && !candidates.length && <p>The reference library has no usable variant matches for this card. Your saved identification and grading work are retained. Verify the variant from the physical card if you can, or keep it unresolved.</p>}
      {candidates.length > 0 && <p className={styles.coverage}>These reference photos may not show every variant. Compare the visible details with your card; listing titles are unconfirmed seller descriptions.</p>}
      {artwork && <figure className={styles.cardArtwork}><div><ReferencePhoto image={artwork.image} label={referenceLabel(artwork.image)}/></div><figcaption><strong>{referenceLabel(artwork.image)}</strong><span>Shared artwork for this card.</span>{referenceSource(artwork.image, artwork.candidate)}</figcaption></figure>}
      {groups.map(group => {
        const entries = ordered.filter(candidate => variantCandidateGroup(candidate, groupingIdentity) === group.key); if (!entries.length) return null;
        const contents = <div className={styles.tiles}>{entries.map(candidate => {
          const ref = variantReference(candidate, cardId, { artwork: false }), chosen = choice === candidate.candidateId && !unresolved;
          return <article className={styles.tile} data-selected={chosen} data-has-photo={Boolean(ref)} key={candidate.candidateId}>
            <label className={styles.tileChoice}><input type="radio" name={`variant-${cardId}`} checked={chosen} disabled={unavailable || status.state !== 'READY' || !candidate.parallel?.trim()} onChange={() => choose(candidate.candidateId)}/>
              {ref && <div className={styles.referencePhoto}><ReferencePhoto image={ref} label={`${candidate.label} · ${referenceLabel(ref)}`}/></div>}
              <div className={styles.tileText}>{candidate.candidateId === suggested?.candidateId && <span className={styles.suggestedBadge}>Suggested</span>}<strong>{candidate.label}</strong><span>{[candidate.identity.setName, candidate.identity.cardNumber && `#${candidate.identity.cardNumber}`, candidate.identity.year].filter(Boolean).join(' · ')}</span><span>{candidate.identity.language || 'Language unconfirmed'}{candidate.parallel ? ` · ${candidate.parallel}` : ' · Printing unconfirmed'}</span>{variantCardNumberComparison(identity?.cardNumber, candidate.identity.cardNumber) === 'unknown' && <small>Full collector number unconfirmed · check the number and set total on your card</small>}<small>{referenceLabel(ref)}</small>{candidate.authority === 'reviewed_catalog' && <small>Reviewed catalog</small>}</div>
            </label>
            {referenceSource(ref, candidate)}
            {candidate.diagnostics.length > 0 && <ul className={styles.cues}>{candidate.diagnostics.map(cue => <li key={cue.id}>{cue.description}</li>)}</ul>}
            {ref && <button type="button" className={styles.compareButton} onClick={event => compare(candidate, event)} disabled={!photograph.url}>Compare details<span className={styles.srOnly}>: {candidate.label}</span></button>}
          </article>;
        })}</div>;
        return group.key === 'same' ? <fieldset className={styles.group} key={group.key}><legend>{group.label} <span>{entries.length}</span></legend>{contents}</fieldset>
          : <details className={styles.more} key={group.key}><summary>{group.label} · {entries.length}</summary>{contents}</details>;
      })}
      {status && <div className={styles.unknown}><p>{candidates.length ? 'None of these is a clear variant match?' : 'Keep the variant unresolved if you cannot verify it.'}</p><div><button type="button" aria-pressed={unresolved === 'NOT_SHOWN'} disabled={unavailable} onClick={() => choose(null, 'NOT_SHOWN')}>My card is not shown</button><button type="button" aria-pressed={unresolved === 'CANNOT_TELL'} disabled={unavailable} onClick={() => choose(null, 'CANNOT_TELL')}>I cannot tell</button></div>{unresolved && <p>Your card identification and grading work stay saved. Final approval waits for variant confirmation. Do not guess from artwork or reflections.</p>}{(unresolved || status.state === 'READY' && !candidates.length && !manual) && <button type="button" disabled={unavailable} onClick={() => choose(null, null, {parallel:'',features:''})}>I can verify the variant on the physical card</button>}</div>}
      {manual && <fieldset className={styles.manual} disabled={unavailable}><legend>Record the details you can verify</legend><p>Use what you see on the physical card. This is your confirmation, without a catalog match.</p><label>Language, printing and variant<input maxLength={120} value={manual.parallel} onChange={event => choose(null, null, {...manual,parallel:event.target.value})} placeholder="For example: English, reverse holo"/></label><label>What visible details confirm it?<textarea rows={3} maxLength={1000} value={manual.features} onChange={event => choose(null, null, {...manual,features:event.target.value})}/></label><button type="button" onClick={() => choose(null, 'CANNOT_TELL')}>Keep unresolved instead</button></fieldset>}
    </div></div>
    {status && !unresolved && <fieldset aria-label="Optional reference photo contribution" className={styles.contribution} disabled={unavailable}>
      <label className={styles.contributionChoice}><input type="checkbox" aria-label="Add these photos to the shared reference library" checked={Boolean(referencePermission)} onChange={event => choose(choice, null, manual, event.target.checked ? {basis:'',detail:'',consumers:['inventory','atlas']} : null)}/><span>Add these photos to the shared reference library <small>Optional</small></span></label>
      <p>For internal ATLAS and Ten Kings reference review. This submits your original photos for review; it does not publish them automatically.</p>
      {referencePermission && <div className={styles.contributionFields}><label>Photo rights basis<select aria-label="Photo rights basis" value={referencePermission.basis} onChange={event => choose(choice, null, manual, {...referencePermission,basis:event.target.value})}><option value="">Choose the rights basis</option><option value="owned_original">I own these original photos</option><option value="permission">I have permission to share them</option><option value="licensed">A license allows this use</option></select></label><label>Brief rights note<textarea aria-label="Brief rights note" rows={2} maxLength={1000} value={referencePermission.detail} onChange={event => choose(choice, null, manual, {...referencePermission,detail:event.target.value})} placeholder="Who owns the photos and what permits this internal use?"/></label></div>}
    </fieldset>}
    {status?.refreshable === true && <div><p><button type="button" disabled={unavailable} onClick={() => void refresh()}>{drafted ? 'Discard unsaved choice and refresh reference library' : 'Refresh reference library'}</button></p>{drafted && <p className={styles.photoHelp}>This discards only your unsaved variant choice. Your saved variant and grading work stay unchanged.</p>}</div>}
    {error && <p className={styles.error} role="alert">{error}</p>}{(!status || stateText || error || reloadNeeded || status.confirmation?.reprocessRequired && !status.approvalReady) && <button type="button" disabled={busy} onClick={() => void check()}>Check saved matches</button>}
    {comparison && <Comparison photo={photograph.url} reference={variantReference(comparison, cardId, { artwork: false })} candidate={comparison} side={side} onClose={() => { setComparison(null); comparisonOpener.current?.focus(); }}/>}
  </section>;
}
