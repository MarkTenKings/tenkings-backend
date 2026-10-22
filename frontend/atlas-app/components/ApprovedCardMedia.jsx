import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { gradedCardPath, gradedCardTitle } from '../lib/graded-cards-client.mjs';
import { APPROVED_LABEL_LAYOUT, APPROVED_MEDIA_ACCESS_ENDED, approvedMediaIdentity, approvedMediaSource, createApprovedMediaResource } from '../lib/approved-card-media.mjs';
import archive from './GradedCards.module.css';
import styles from './ApprovedCardMedia.module.css';

const empty = { loading: false, url: null, error: null };
const label = side => side === 'BACK' ? 'Back' : 'Front';
// The approved label uses the same physical bay. Only its recorded NFC cutout
// position changes; historical previews retain the existing CSS placement.
const approvedNfcStyle = { left: `${(5.961 + APPROVED_LABEL_LAYOUT.nfc.x - APPROVED_LABEL_LAYOUT.nfc.radius) / 80.264 * 100}%`,
  top: `${(6.602 + APPROVED_LABEL_LAYOUT.nfc.y - APPROVED_LABEL_LAYOUT.nfc.radius) / 135.382 * 100}%` };
// The 3D renderer and its dependencies are requested only on this optional tab.
const Slab3D = lazy(() => import('./Slab3D'));

/** A rejected optional chunk must not take down the saved card or its 2D views. */
export class OptionalSlabBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className={styles.pending3D}>{this.props.fallback}
      <p className={styles.pending3DNote} role="status">3D preview unavailable. Front and Back photographs remain available.</p>
    </div> : this.props.children;
  }
}

const mediaKey = (kind, delivery = 'preview') => ['FRONT', 'BACK'].includes(kind) ? `${kind}:${delivery}` : kind;

function useCardMedia(card, mode, enabled, requestFull = false) {
  const [images, setImages] = useState({}), [blocked, setBlocked] = useState(false);
  const resource = useRef(null), sources = useRef({});
  const identity = approvedMediaIdentity(card);
  const frontPreview = images[mediaKey('FRONT')], backPreview = images[mediaKey('BACK')];
  useEffect(() => {
    const revoke = () => { resource.current?.dispose(); resource.current = null; setImages({}); setBlocked(true); };
    window.addEventListener(APPROVED_MEDIA_ACCESS_ENDED, revoke);
    window.addEventListener('pagehide', revoke);
    return () => { window.removeEventListener(APPROVED_MEDIA_ACCESS_ENDED, revoke); window.removeEventListener('pagehide', revoke); };
  }, []);
  useEffect(() => {
    if (blocked || !enabled) return;
    // An effect owns its resource so StrictMode's rehearsal can safely create
    // a fresh instance after the previous one has been irrevocably disposed.
    const owned = createApprovedMediaResource(); resource.current = owned;
    sources.current = Object.fromEntries((mode === 'detail' ? ['FRONT', 'BACK', 'SLAB', 'LABEL', 'LABEL_BACK'] : ['FRONT', 'SLAB', 'LABEL'])
      .map(kind => [mediaKey(kind), approvedMediaSource(card, kind, { delivery: 'preview' })]));
    setImages({});
    for (const [key, source] of Object.entries(sources.current)) if (source)
      void owned.read(source, value => setImages(previous => ({ ...previous, [key]: value })));
    return () => { owned.dispose(); if (resource.current === owned) resource.current = null; };
  }, [card, identity, mode, enabled, blocked]);
  useEffect(() => {
    if (!requestFull) for (const kind of ['FRONT', 'BACK']) resource.current?.cancel(kind, 'full');
  }, [requestFull]);
  useEffect(() => {
    if (blocked || !enabled || !requestFull || mode !== 'detail' || !resource.current) return;
    // Full photographs are optional detail: keep the ready small previews
    // visible while their independently verified replacements arrive.
    for (const kind of ['FRONT', 'BACK']) {
      const preview = kind === 'FRONT' ? frontPreview : backPreview;
      // Older approvals may have no small rendition. Their verified fallback
      // already is the full image, so do not download those bytes twice.
      if (!preview || preview.loading || preview.url && preview.representation === 'full') continue;
      const key = mediaKey(kind, 'full'), source = approvedMediaSource(card, kind, { delivery: 'full' });
      // Another side or label settling must not silently retry a failed full
      // load. Only an explicit retry or a new 3D visit after cancellation does.
      if (images[key] && !images[key].cancelled) continue;
      sources.current[key] = source;
      if (source) void resource.current.read(source, value => setImages(previous => ({ ...previous, [key]: value })));
    }
  }, [card, identity, mode, enabled, blocked, requestFull, frontPreview, backPreview, images]);
  const retry = (kind, delivery = 'preview') => {
    const key = mediaKey(kind, delivery), source = sources.current[key];
    if (source && !blocked) void resource.current?.read(source, value => setImages(previous => ({ ...previous, [key]: value })));
  };
  const image = (kind, delivery = 'preview') => {
    if (blocked) return empty;
    const preview = images[mediaKey(kind)];
    if (delivery === 'full' && preview?.url && preview.representation === 'full') return preview;
    return images[mediaKey(kind, delivery)] ?? {
      ...empty, loading: (delivery !== 'full' || requestFull) && Boolean(approvedMediaSource(card, kind, { delivery })),
    };
  };
  return { image, retry, fail: (kind, url) => resource.current?.fail(kind, url), blocked };
}

/** Shared gallery composition. Both labels use only their saved artwork; a
 * historical record without reverse artwork keeps its plain reverse bay. */
export function ApprovedCardPresentation({ name, photo, side = 'FRONT', artwork, layoutVersion, actualSlab = false, onImageError }) {
  const digital = !actualSlab && (artwork?.url || artwork?.loading || artwork?.error || side === 'BACK');
  return digital ? <span className={archive.slab} role="img" aria-label={side === 'FRONT'
    ? `${name}. Digital slab preview using the approved front photograph${artwork?.url ? ' and saved ATLAS label' : ' in an illustrative holder. Saved label artwork is not yet available'}. Physical holder and NFC completion are separate.`
    : `${name}. Digital slab preview using the approved back photograph${artwork?.url ? ' and saved ATLAS back label' : ' in an illustrative holder. Reverse label artwork is not recorded'}. Physical holder and NFC completion are separate.`}>
    <img className={archive.slabShell} src={`${STAFF_BASE_PATH}/brand/archive/slab-shell-front.svg`} width="803" height="1354" alt="" aria-hidden="true" loading="lazy"/>
    <img className={archive.slabCard} src={photo.url} onError={() => onImageError(side, photo.url)} alt="" aria-hidden="true" decoding="async"/>
    {side === 'FRONT' && artwork?.url && <span className={archive.slabNfc} style={layoutVersion === APPROVED_LABEL_LAYOUT.version ? approvedNfcStyle : undefined} aria-hidden="true"><img src={`${STAFF_BASE_PATH}/brand/archive/nfc-tag-reference-384.webp`} alt="" loading="lazy"/></span>}
    {artwork?.url && <img className={archive.slabLabel} src={artwork.url} onError={() => onImageError(side === 'BACK' ? 'LABEL_BACK' : 'LABEL', artwork.url)} alt="" aria-hidden="true"/>}
  </span> : <img className={`${archive.photo}${actualSlab ? ` ${archive.slabPhoto}` : ''}`} src={photo.url}
    onError={() => onImageError(actualSlab ? 'SLAB' : side, photo.url)} alt={`${name} · ${actualSlab ? 'recorded slab photograph' : `approved ${side.toLowerCase()} photograph`}`} decoding="async"/>;
}

function GalleryMedia({ card, compact }) {
  const root = useRef(null), [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setEnabled(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEnabled(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const media = useCardMedia(card, 'gallery', enabled), front = media.image('FRONT'), slab = media.image('SLAB'), artwork = media.image('LABEL');
  const actualSlab = Boolean(slab.url), photo = actualSlab ? slab : front, digital = Boolean(photo.url && !actualSlab && (artwork.url || artwork.loading || artwork.error));
  const loading = !photo.url && (front.loading || slab.loading), name = gradedCardTitle(card);
  const retryKinds = ['FRONT', 'SLAB', 'LABEL'].filter(kind => media.image(kind).error);
  return <div ref={root} aria-busy={loading} className={`${archive.media}${compact ? ` ${archive.compactMedia}` : ''}`}>
    <Link href={gradedCardPath(card)} className={archive.photoLink} aria-label={`Open ${name}, ${card.certificateNumber || 'certificate not recorded'}`}>
      {photo.url ? <ApprovedCardPresentation name={name} photo={photo} artwork={artwork} layoutVersion={approvedMediaSource(card, 'LABEL')?.layoutVersion} actualSlab={actualSlab} onImageError={media.fail}/>
        : <span className={archive.noPhoto} role="status"><span aria-hidden="true">ATLAS</span><strong>{media.blocked ? 'Access ended' : loading ? 'Loading photograph…' : 'Photo unavailable'}</strong><small>{loading ? 'Opening saved evidence' : 'Open the saved card'}</small></span>}
    </Link>
    {!compact && <span className={archive.mediaCaption}>{digital ? 'Digital slab preview' : actualSlab ? 'Recorded slab photograph' : photo.url ? 'Approved front photograph' : loading ? 'Loading saved photograph' : 'Saved grade retained'}</span>}
    {!!retryKinds.length && !media.blocked && <button type="button" className={`${styles.galleryRetry}${compact ? ` ${styles.compactRetry}` : ''}`} onClick={() => retryKinds.forEach(kind => media.retry(kind))} aria-label={`Retry ${name} ${photo.url ? 'preview' : 'photograph'}`}>{photo.url ? 'Retry preview' : 'Retry photo'}</button>}
  </div>;
}

function PhotoState({ image, blocked, side, onRetry }) {
  return <div className={styles.state} role="status"><span aria-hidden="true">ATLAS</span>
    <strong>{blocked ? 'Staff access ended' : image.loading ? `Loading approved ${side.toLowerCase()} photograph…` : `Approved ${side.toLowerCase()} photograph unavailable`}</strong>
    <p>{blocked ? 'Sign in again to view saved evidence.' : image.loading ? 'Opening this saved report’s photograph.' : 'The saved grade and report are retained.'}</p>
    {!blocked && image.error && <button type="button" onClick={onRetry}>Retry {side.toLowerCase()} photo</button>}
  </div>;
}

function DetailMedia({ card }) {
  const [side, setSide] = useState('FRONT'), is3D = side === '3D';
  const media = useCardMedia(card, 'detail', true, is3D);
  const frontPreview = media.image('FRONT'), backPreview = media.image('BACK');
  const frontFull = media.image('FRONT', 'full'), backFull = media.image('BACK', 'full');
  const front = frontFull.url ? frontFull : frontPreview, back = backFull.url ? backFull : backPreview;
  const selectedPreview = media.image(is3D ? 'FRONT' : side), selectedFull = media.image(is3D ? 'FRONT' : side, 'full');
  const selected = selectedPreview.url ? selectedPreview : selectedFull.url ? selectedFull : selectedPreview;
  const slab = media.image('SLAB'), artwork = media.image('LABEL'), backArtwork = media.image('LABEL_BACK');
  const layoutVersion = approvedMediaSource(card, 'LABEL')?.layoutVersion;
  const backLabelRecorded = Boolean(approvedMediaSource(card, 'LABEL_BACK'));
  const backLabelNote = backArtwork.url ? 'Saved ATLAS back label.' : backLabelRecorded
    ? backArtwork.loading ? 'Opening saved back label…' : 'Saved back label artwork unavailable.' : 'Reverse label artwork not recorded.';
  const actualSlab = side === 'FRONT' && Boolean(slab.url), photo = actualSlab ? slab : selected;
  const digital = Boolean(photo.url && !actualSlab && (side === 'BACK' || artwork.url || artwork.loading || artwork.error));
  const loading = !photo.url && (selected.loading || side === 'FRONT' && slab.loading);
  const retryKinds = (is3D ? ['FRONT', 'BACK', 'LABEL', 'LABEL_BACK'] : side === 'FRONT' ? ['SLAB', 'LABEL'] : ['LABEL_BACK']).filter(kind => media.image(kind).error);
  const retryDetail = is3D ? ['FRONT', 'BACK'].filter(kind => media.image(kind, 'full').error) : [];
  const preview = <div className={styles.detailVisual}><ApprovedCardPresentation name={gradedCardTitle(card)} photo={photo} side={is3D ? 'FRONT' : side}
    artwork={side === 'BACK' ? backArtwork : artwork} layoutVersion={layoutVersion} actualSlab={actualSlab} onImageError={media.fail}/></div>;
  const ready3D = Boolean(front.url && back.url);
  const fallback3D = selected.url ? preview : <PhotoState image={selected} blocked={media.blocked} side="FRONT" onRetry={() => media.retry('FRONT')}/>;
  return <section className={styles.detail} aria-label="Approved card photographs">
    <div className={styles.photoStage} aria-busy={is3D ? !ready3D && (front.loading || back.loading) : loading}>
      {media.blocked ? <PhotoState image={empty} blocked side="FRONT"/>
        : is3D ? ready3D ? <OptionalSlabBoundary fallback={fallback3D}><Suspense fallback={fallback3D}><Slab3D key={approvedMediaIdentity(card)} name={gradedCardTitle(card)} frontUrl={front.url} backUrl={back.url}
          initialFrontUrl={frontPreview.url || front.url} initialBackUrl={backPreview.url || back.url}
          labelUrl={artwork.url} backLabelUrl={backArtwork.url} labelLayoutVersion={layoutVersion} fallback={fallback3D}/></Suspense></OptionalSlabBoundary>
          : <div className={styles.pending3D}>{fallback3D}<p className={styles.pending3DNote} role="status">{front.loading || back.loading
            ? 'Opening saved photographs for 3D…' : '3D needs both saved photographs. Front and Back remain available.'}</p></div>
        : photo.url ? preview
        : <PhotoState image={{ ...selected, loading }} blocked={media.blocked} side={side} onRetry={() => media.retry(side)}/>}
    </div>
    <div className={styles.controls}><div className={styles.sideSwitch} role="group" aria-label="Card view">{['FRONT', 'BACK', '3D'].map(value =>
      <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{value === '3D' ? '3D' : label(value)}</button>)}</div>
      {!!retryKinds.length && !media.blocked && <button type="button" onClick={() => retryKinds.forEach(kind => media.retry(kind))}>Retry preview</button>}
      {!!retryDetail.length && !media.blocked && <button type="button" onClick={() => retryDetail.forEach(kind => media.retry(kind, 'full'))}>Retry high detail</button>}
    </div>
    {is3D && !media.blocked ? <p className={styles.caption}>Illustrative 3D slab · Saved card photographs<br/><span>{backLabelNote}{!artwork.url && !artwork.loading ? ' Front label artwork unavailable.' : ''}</span></p>
      : photo.url && <p className={styles.caption}>{actualSlab ? 'Recorded slab photograph' : digital ? `Digital slab preview · ${label(side)}` : `Approved ${side.toLowerCase()} photograph`}
      {side === 'BACK' && <><br/><span>{backLabelNote}</span></>}
      {side === 'FRONT' && !actualSlab && !artwork.url && !artwork.loading && <><br/><span>Saved label artwork unavailable.</span></>}
    </p>}
  </section>;
}

/** Remount all owned resources when any saved card/report/media identity changes. */
export default function ApprovedCardMedia({ card, mode = 'gallery', compact = false }) {
  const key = approvedMediaIdentity(card);
  return mode === 'detail' ? <DetailMedia key={key} card={card}/> : <GalleryMedia key={key} card={card} compact={compact}/>;
}
