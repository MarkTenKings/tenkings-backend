import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { gradedCardPath, gradedCardTitle } from '../lib/graded-cards-client.mjs';
import { APPROVED_MEDIA_ACCESS_ENDED, approvedMediaIdentity, approvedMediaSource, createApprovedMediaResource } from '../lib/approved-card-media.mjs';
import archive from './GradedCards.module.css';
import styles from './ApprovedCardMedia.module.css';

const empty = { loading: false, url: null, error: null };
const label = side => side === 'BACK' ? 'Back' : 'Front';
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

function useCardMedia(card, mode, enabled) {
  const [images, setImages] = useState({}), [blocked, setBlocked] = useState(false);
  const resource = useRef(null), sources = useRef({});
  const identity = approvedMediaIdentity(card);
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
    sources.current = Object.fromEntries((mode === 'detail' ? ['FRONT', 'BACK', 'SLAB', 'LABEL'] : ['FRONT', 'SLAB', 'LABEL'])
      .map(kind => [kind, approvedMediaSource(card, kind)]));
    setImages({});
    for (const source of Object.values(sources.current)) if (source)
      void owned.read(source, value => setImages(previous => ({ ...previous, [source.kind]: value })));
    return () => { owned.dispose(); if (resource.current === owned) resource.current = null; };
  }, [card, identity, mode, enabled, blocked]);
  const retry = kind => {
    const source = sources.current[kind];
    if (source && !blocked) void resource.current?.read(source, value => setImages(previous => ({ ...previous, [kind]: value })));
  };
  const image = kind => blocked ? empty : images[kind] ?? { ...empty, loading: Boolean(approvedMediaSource(card, kind)) };
  return { image, retry, fail: (kind, url) => resource.current?.fail(kind, url), blocked };
}

/** Shared gallery composition. The holder is illustrative; each photograph and
 * front label remain the exact saved assets. No reverse label/NFC is invented. */
export function ApprovedCardPresentation({ name, photo, side = 'FRONT', artwork, actualSlab = false, onImageError }) {
  const digital = !actualSlab && (artwork?.url || side === 'BACK');
  return digital ? <span className={archive.slab} role="img" aria-label={side === 'FRONT'
    ? `${name}. Digital slab preview using the approved front photograph and saved ATLAS label. Physical holder and NFC completion are separate.`
    : `${name}. Digital slab preview using the approved back photograph in an illustrative holder. Reverse label artwork is not recorded. Physical holder and NFC completion are separate.`}>
    <img className={archive.slabShell} src={`${STAFF_BASE_PATH}/brand/archive/slab-shell-front.svg`} width="803" height="1354" alt="" aria-hidden="true" loading="lazy"/>
    <img className={archive.slabCard} src={photo.url} onError={() => onImageError(side, photo.url)} alt="" aria-hidden="true" decoding="async"/>
    {side === 'FRONT' && <><span className={archive.slabNfc} aria-hidden="true"><img src={`${STAFF_BASE_PATH}/brand/archive/nfc-tag-reference.jpg`} alt="" loading="lazy"/></span>
      <img className={archive.slabLabel} src={artwork.url} onError={() => onImageError('LABEL', artwork.url)} alt="" aria-hidden="true"/></>}
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
  const actualSlab = Boolean(slab.url), photo = actualSlab ? slab : front, digital = Boolean(photo.url && !actualSlab && artwork.url);
  const loading = !photo.url && (front.loading || slab.loading), name = gradedCardTitle(card);
  const retryKinds = ['FRONT', 'SLAB', 'LABEL'].filter(kind => media.image(kind).error);
  return <div ref={root} aria-busy={loading} className={`${archive.media}${compact ? ` ${archive.compactMedia}` : ''}`}>
    <Link href={gradedCardPath(card)} className={archive.photoLink} aria-label={`Open ${name}, ${card.certificateNumber || 'certificate not recorded'}`}>
      {photo.url ? <ApprovedCardPresentation name={name} photo={photo} artwork={artwork} actualSlab={actualSlab} onImageError={media.fail}/>
        : <span className={archive.noPhoto} role="status"><span aria-hidden="true">ATLAS</span><strong>{media.blocked ? 'Access ended' : loading ? 'Loading photograph…' : 'Photo unavailable'}</strong><small>{loading ? 'Opening saved evidence' : 'Open the saved card'}</small></span>}
    </Link>
    {!compact && <span className={archive.mediaCaption}>{digital ? 'Digital slab preview' : actualSlab ? 'Recorded slab photograph' : photo.url ? 'Approved front photograph' : loading ? 'Loading saved photograph' : 'Saved grade retained'}</span>}
    {!!retryKinds.length && !media.blocked && <button type="button" className={`${styles.galleryRetry}${compact ? ` ${styles.compactRetry}` : ''}`} onClick={() => retryKinds.forEach(media.retry)} aria-label={`Retry ${name} ${photo.url ? 'preview' : 'photograph'}`}>{photo.url ? 'Retry preview' : 'Retry photo'}</button>}
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
  const media = useCardMedia(card, 'detail', true), [side, setSide] = useState('FRONT');
  const is3D = side === '3D', front = media.image('FRONT'), back = media.image('BACK');
  const selected = media.image(is3D ? 'FRONT' : side), slab = media.image('SLAB'), artwork = media.image('LABEL');
  const actualSlab = side === 'FRONT' && Boolean(slab.url), photo = actualSlab ? slab : selected;
  const digital = Boolean(photo.url && !actualSlab && (side === 'BACK' || artwork.url));
  const loading = !photo.url && (selected.loading || side === 'FRONT' && slab.loading);
  const retryKinds = (is3D ? ['FRONT', 'BACK', 'LABEL'] : side === 'FRONT' ? ['SLAB', 'LABEL'] : []).filter(kind => media.image(kind).error);
  const preview = <div className={styles.detailVisual}><ApprovedCardPresentation name={gradedCardTitle(card)} photo={photo} side={is3D ? 'FRONT' : side}
    artwork={artwork} actualSlab={actualSlab} onImageError={media.fail}/></div>;
  const ready3D = Boolean(front.url && back.url);
  const fallback3D = front.url ? preview : <PhotoState image={front} blocked={media.blocked} side="FRONT" onRetry={() => media.retry('FRONT')}/>;
  return <section className={styles.detail} aria-label="Approved card photographs">
    <div className={styles.photoStage} aria-busy={is3D ? !ready3D && (front.loading || back.loading) : loading}>
      {media.blocked ? <PhotoState image={empty} blocked side="FRONT"/>
        : is3D ? ready3D ? <OptionalSlabBoundary fallback={fallback3D}><Suspense fallback={fallback3D}><Slab3D name={gradedCardTitle(card)} frontUrl={front.url} backUrl={back.url}
          labelUrl={artwork.url} fallback={fallback3D}/></Suspense></OptionalSlabBoundary>
          : <div className={styles.pending3D}>{fallback3D}<p className={styles.pending3DNote} role="status">{front.loading || back.loading
            ? 'Opening saved photographs for 3D…' : '3D needs both saved photographs. Front and Back remain available.'}</p></div>
        : photo.url ? preview
        : <PhotoState image={{ ...selected, loading }} blocked={media.blocked} side={side} onRetry={() => media.retry(side)}/>}
    </div>
    <div className={styles.controls}><div className={styles.sideSwitch} role="group" aria-label="Card view">{['FRONT', 'BACK', '3D'].map(value =>
      <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{value === '3D' ? '3D' : label(value)}</button>)}</div>
      {!!retryKinds.length && !media.blocked && <button type="button" onClick={() => retryKinds.forEach(media.retry)}>Retry preview</button>}
    </div>
    {is3D && !media.blocked ? <p className={styles.caption}>Illustrative 3D slab · Saved card photographs<br/><span>Reverse label artwork not recorded.{!artwork.url && !artwork.loading ? ' Front label artwork unavailable.' : ''}</span></p>
      : photo.url && <p className={styles.caption}>{actualSlab ? 'Recorded slab photograph' : digital ? `Digital slab preview · ${label(side)}` : `Approved ${side.toLowerCase()} photograph`}
      {side === 'BACK' && <><br/><span>Reverse label artwork not recorded.</span></>}
      {side === 'FRONT' && !actualSlab && !artwork.url && !artwork.loading && <><br/><span>Saved label artwork unavailable.</span></>}
    </p>}
  </section>;
}

/** Remount all owned resources when any saved card/report/media identity changes. */
export default function ApprovedCardMedia({ card, mode = 'gallery', compact = false }) {
  const key = approvedMediaIdentity(card);
  return mode === 'detail' ? <DetailMedia key={key} card={card}/> : <GalleryMedia key={key} card={card} compact={compact}/>;
}
