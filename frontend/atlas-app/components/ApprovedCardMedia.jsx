import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { gradedCardPath, gradedCardTitle } from '../lib/graded-cards-client.mjs';
import { APPROVED_MEDIA_ACCESS_ENDED, approvedMediaIdentity, approvedMediaSource, createApprovedMediaResource } from '../lib/approved-card-media.mjs';
import archive from './GradedCards.module.css';
import styles from './ApprovedCardMedia.module.css';

const empty = { loading: false, url: null, error: null };
const label = side => side === 'BACK' ? 'Back' : 'Front';

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
    sources.current = Object.fromEntries((mode === 'detail' ? ['FRONT', 'BACK'] : ['FRONT', 'SLAB', 'LABEL'])
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
      {photo.url ? digital ? <span className={archive.slab} role="img" aria-label={`${name}. Digital slab preview using the approved front photograph and saved ATLAS label. Physical holder and NFC completion are separate.`}>
        <img className={archive.slabShell} src={`${STAFF_BASE_PATH}/brand/archive/slab-shell-front.svg`} width="803" height="1354" alt="" aria-hidden="true" loading="lazy"/>
        <img className={archive.slabCard} src={photo.url} onError={() => media.fail('FRONT', photo.url)} alt="" aria-hidden="true" decoding="async"/>
        <span className={archive.slabNfc} aria-hidden="true"><img src={`${STAFF_BASE_PATH}/brand/archive/nfc-tag-reference.jpg`} alt="" loading="lazy"/></span>
        <img className={archive.slabLabel} src={artwork.url} onError={() => media.fail('LABEL', artwork.url)} alt="" aria-hidden="true"/>
      </span> : <img className={`${archive.photo}${actualSlab ? ` ${archive.slabPhoto}` : ''}`} src={photo.url} onError={() => media.fail(actualSlab ? 'SLAB' : 'FRONT', photo.url)} alt={`${name} · ${actualSlab ? 'recorded slab photograph' : 'approved front photograph'}`} decoding="async"/>
        : <span className={archive.noPhoto} role="status"><span aria-hidden="true">ATLAS</span><strong>{media.blocked ? 'Access ended' : loading ? 'Loading photograph…' : 'Photo unavailable'}</strong><small>{loading ? 'Opening saved evidence' : 'Open the saved card'}</small></span>}
    </Link>
    {!compact && <span className={archive.mediaCaption}>{digital ? 'Digital slab preview' : actualSlab ? 'Recorded slab photograph' : photo.url ? 'Approved front photograph' : loading ? 'Loading saved photograph' : 'Saved grade retained'}</span>}
    {!!retryKinds.length && !media.blocked && <button type="button" className={`${styles.galleryRetry}${compact ? ` ${styles.compactRetry}` : ''}`} onClick={() => retryKinds.forEach(media.retry)} aria-label={`Retry ${name} ${photo.url ? 'preview' : 'photograph'}`}>{photo.url ? 'Retry preview' : 'Retry photo'}</button>}
  </div>;
}

function PhotoState({ image, blocked, side, onRetry }) {
  return <div className={styles.state} role="status"><span aria-hidden="true">ATLAS</span>
    <strong>{blocked ? 'Staff access ended' : image.loading ? `Loading approved ${side.toLowerCase()} photograph…` : `Approved ${side.toLowerCase()} photograph unavailable`}</strong>
    <p>{blocked ? 'Sign in again to inspect saved evidence.' : image.loading ? 'Opening this saved report’s photograph.' : 'The saved grade and report are retained.'}</p>
    {!blocked && image.error && <button type="button" onClick={onRetry}>Retry {side.toLowerCase()} photo</button>}
  </div>;
}

function DetailMedia({ card }) {
  const media = useCardMedia(card, 'detail', true), [side, setSide] = useState('FRONT'), [inspect, setInspect] = useState(false), [zoom, setZoom] = useState(1);
  const dialog = useRef(null), viewport = useRef(null), opener = useRef(null), [decoded, setDecoded] = useState([]);
  const selected = media.image(side), name = gradedCardTitle(card), ready = Boolean(selected.url && decoded.includes(selected.url));
  const open = event => { opener.current = event.currentTarget; setInspect(true); };
  const close = () => { setInspect(false); setZoom(1); };
  const closed = () => {
    setInspect(false); setZoom(1);
    if (!media.blocked && opener.current?.isConnected) opener.current.focus();
  };
  useEffect(() => {
    if (inspect && !media.blocked) dialog.current?.showModal();
    else dialog.current?.close();
  }, [inspect, media.blocked]);
  useEffect(() => { setZoom(1); viewport.current?.scrollTo(0, 0); }, [side]);
  useEffect(() => {
    const region = viewport.current;
    if (inspect && region) region.scrollTo(Math.max(0, (region.scrollWidth - region.clientWidth) / 2), Math.max(0, (region.scrollHeight - region.clientHeight) / 2));
  }, [zoom, inspect, side]);
  const sides = <div className={styles.sideSwitch} role="group" aria-label="Photograph side">{['FRONT', 'BACK'].map(value => <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{label(value)}</button>)}</div>;
  const photo = selected.url ? <img src={selected.url} alt={`${name} · approved ${side.toLowerCase()} grading photograph`}
    onLoad={() => setDecoded(previous => previous.includes(selected.url) ? previous : [...previous, selected.url])} onError={() => media.fail(side, selected.url)} decoding="async"/> : null;
  return <section className={styles.detail} aria-label="Approved card photographs">
    <div className={styles.photoStage} aria-busy={selected.loading || Boolean(selected.url && !ready)}>
      {photo ? <button type="button" className={styles.inspectPhoto} onClick={open} aria-label={`Inspect approved ${side.toLowerCase()} photograph of ${name}`}>{photo}</button>
        : <PhotoState image={selected} blocked={media.blocked} side={side} onRetry={() => media.retry(side)}/>}
    </div>
    <div className={styles.controls}>{sides}<button type="button" disabled={!ready || media.blocked} onClick={open}>Inspect / zoom ↗</button></div>
    <p className={styles.caption}>Approved grading photograph · {label(side)}<br/><span>The saved report image, shown without retouching.</span></p>
    <dialog ref={dialog} className={styles.dialog} aria-label={`${name} approved photograph inspection`} onCancel={close} onClose={closed}>
      <header className={styles.dialogHeader}><div><strong>{name}</strong><span>Full-size approved photograph · {label(side)}</span></div><button type="button" autoFocus onClick={close} aria-label="Close photograph inspection">Close ✕</button></header>
      <div className={styles.inspectionControls}>{sides}<div className={styles.zoomControls} role="group" aria-label="Photograph zoom">
        <button type="button" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1 || !selected.url} aria-label="Zoom out">−</button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom === 4 || !selected.url} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => { setZoom(1); viewport.current?.scrollTo(0, 0); }}>Fit photo</button>
      </div>{selected.url && !media.blocked && <a href={selected.url} target="_blank" rel="noreferrer">Open full-size photo ↗</a>}</div>
      <div ref={viewport} className={styles.viewport} tabIndex="0" role="region" aria-label="Approved photograph. Zoom with the buttons, then scroll to inspect." aria-busy={selected.loading}>
        {selected.url && !media.blocked ? <div className={styles.zoomCanvas} style={{ width: `${zoom * 100}%`, minHeight: `${zoom * 100}%`, '--photo-zoom': zoom }}><img className={styles.zoomPhoto} src={selected.url} alt={`${name} · approved ${side.toLowerCase()} grading photograph`} onError={() => media.fail(side, selected.url)}/></div>
          : <PhotoState image={selected} blocked={media.blocked} side={side} onRetry={() => media.retry(side)}/>}
      </div>
      <p className={styles.dialogNote}>Zoom changes the viewing scale only. The approved image and report are unchanged.</p>
    </dialog>
  </section>;
}

/** Remount all owned resources when any saved card/report/media identity changes. */
export default function ApprovedCardMedia({ card, mode = 'gallery', compact = false }) {
  const key = approvedMediaIdentity(card);
  return mode === 'detail' ? <DetailMedia key={key} card={card}/> : <GalleryMedia key={key} card={card} compact={compact}/>;
}
