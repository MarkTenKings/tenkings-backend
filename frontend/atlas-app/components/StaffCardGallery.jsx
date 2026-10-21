import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { createStaffCardGalleryQueue, readStaffCardGalleryItem, staffCardGalleryKey, staffCardGalleryScope } from '../lib/staff-card-gallery-client.mjs';
import styles from './StaffCardGallery.module.css';

const emptyPhoto = { state: 'IDLE', metadata: null, url: null };
const reviewLabels = {
  UNKNOWN: ['Status not recorded', 'unknown', 'Saved grading status is unavailable.'],
  SAVED_DRAFT: ['Grading in progress', 'active', 'A current grading draft is saved.'],
  APPROVED_CURRENT: ['Grading complete', 'complete', 'The current saved review is approved.'],
  CHANGED_SINCE_APPROVAL: ['Review changed', 'attention', 'The saved draft changed after approval.'],
  PHOTOS_CHANGED: ['Photos changed', 'attention', 'Earlier grading does not match these photos.'],
};
const createdDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : null;

export function StaffGalleryCard({ card, queue, onRetryList }) {
  const node = useRef(null), [photo, setPhoto] = useState(emptyPhoto);
  const key = staffCardGalleryKey(card);
  useEffect(() => {
    setPhoto(emptyPhoto);
    if (!queue) return undefined;
    const unsubscribe = queue.subscribe(card, setPhoto);
    let observer;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => { for (const entry of entries) queue.visible(card, entry.isIntersecting); }, { rootMargin: '160px 0px' });
      if (node.current) observer.observe(node.current);
    } else queue.visible(card, true);
    return () => { observer?.disconnect(); unsubscribe(); };
  }, [card, key, queue]);
  const inaccessible = photo.state === 'UNAVAILABLE', stale = photo.state === 'STALE';
  const metadata = photo.metadata;
  const uploadLabel = typeof card.label === 'string' && card.label.trim() ? card.label.trim().slice(0, 160) : 'Untitled card';
  const title = inaccessible ? 'Card unavailable' : stale ? 'Card changed'
    : metadata?.title.state === 'CURRENT' ? metadata.title.text : uploadLabel;
  const [status, tone, note] = metadata ? reviewLabels[metadata.review.state]
    : ['IDLE', 'QUEUED', 'LOADING'].includes(photo.state) ? ['Reading grading status…', 'unknown', 'Waiting for the saved review.']
      : ['Status unavailable', 'unknown', 'The saved review could not be read.'];
  const originalMissing = !card.sides?.FRONT?.upload?.verification;
  const path = `/manual/${card.cardId}`, date = createdDate(card.createdAt);
  const titleBlock = <h2>{title}</h2>;
  return <article ref={node} className={styles.card} aria-label={title}>
    <div className={styles.photoFrame}>
      {photo.state === 'READY' && photo.url ? <Link className={styles.photoLink} href={path} aria-label={`Open ${title}`}>
        <img className={styles.photo} src={photo.url} width={photo.width} height={photo.height} alt={`Original Front upload preview of ${title}`}
          decoding="async" onError={() => queue?.imageFailed(card)}/>
      </Link> : <div className={styles.photoState}>
        <i className={styles.photoOutline} aria-hidden="true"/>
        {inaccessible ? <><strong>Card unavailable</strong><span>Refresh the workspace to check current access.</span></>
          : stale ? <><strong>Card changed</strong><span>Refresh to read its current photos and grading.</span></>
            : photo.state === 'FAILED' ? <><strong>Photo could not load</strong><span>Try loading its original-source preview again.</span><button type="button" onClick={() => queue?.retry(card)}>Retry photo</button></>
              : photo.state === 'MISSING' ? <><strong>{originalMissing ? 'Front photo needed' : 'Original preview unavailable'}</strong><span>{originalMissing ? 'Open this card to add its Front photo.' : 'No original-source display preview is available.'}</span>{!originalMissing && <button type="button" onClick={() => queue?.retry(card)}>Retry photo</button>}</>
                : <><strong role="status">{photo.state === 'LOADING' ? 'Loading original photo…' : 'Original photo preview'}</strong><span>{photo.state === 'QUEUED' ? 'Waiting to load…' : 'The full uploaded frame stays visible.'}</span></>}
        {(inaccessible || stale) && onRetryList && <button type="button" onClick={onRetryList}>Refresh workspace</button>}
      </div>}
    </div>
    <p className={styles.caption}>{photo.state === 'READY' ? 'Original upload · uncropped display preview' : 'Front photograph'}</p>
    <div className={styles.metadata}>
      {inaccessible || stale ? <div className={styles.title}>{titleBlock}</div> : <Link className={styles.title} href={path}>{titleBlock}</Link>}
      {!metadata && !inaccessible && !stale && <p className={styles.subtitle}>{['IDLE', 'QUEUED', 'LOADING'].includes(photo.state) ? 'Reading saved grading status…' : 'Saved identity and status are unavailable.'}</p>}
      <div className={styles.statusRow}><span className={styles.status} data-tone={inaccessible || stale ? 'attention' : tone}>{inaccessible ? 'Access unavailable' : stale ? 'Refresh required' : status}</span></div>
      <p className={styles.statusNote}>{inaccessible ? 'This card cannot be opened from the current view.' : stale ? 'The previous grading state has been cleared.' : note}</p>
      {!inaccessible && !stale && <Link href={path} className={styles.action}>Open card <span aria-hidden="true">↗</span></Link>}
      {!inaccessible && !stale && date && <p className={styles.created}>Added {date} · UTC</p>}
    </div>
  </article>;
}

/** Root retains list pagination, upload recovery and role-authorized actions. */
export default function StaffCardGallery({ staff, cards = [], cardsScope, nextCursor = null, loading = false, loadingMore = false,
  error = null, onLoadMore, onRetryList, accessState = 'READY', onAccessLost, actions, readCard = readStaffCardGalleryItem }) {
  const scope = staffCardGalleryScope(staff), [context, setContext] = useState(null), [endedStaff, setEndedStaff] = useState(null);
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost;
  const allowed = Boolean(scope && cardsScope === scope && accessState === 'READY' && endedStaff !== staff);
  useEffect(() => {
    if (!allowed) { setContext(null); return undefined; }
    const queue = createStaffCardGalleryQueue({ staffId: staff.id, readCard, onAccessLost: () => { setEndedStaff(staff); setContext(null); accessLost.current?.(); } });
    setContext({ staff, scope, queue });
    const hide = () => { queue.dispose(); setEndedStaff(staff); setContext(null); };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); queue.dispose(); };
  }, [allowed, staff, staff.id, scope, readCard]);
  // A replacement staff object cannot render the previous scope while effects clean up.
  const current = allowed && context?.staff === staff && context.scope === scope;
  let invalid = false;
  try { if (!Array.isArray(cards) || new Set(cards.map(staffCardGalleryKey)).size !== cards.length
    || new Set(cards.map(card => card.cardId)).size !== cards.length) invalid = true; } catch { invalid = true; }
  const ended = accessState !== 'READY' || endedStaff === staff;
  return <section className={styles.workspace} aria-label="Your grading workspace">
    <header className={styles.heading}><div><h1>Your grading workspace</h1><p>Cards assigned to your staff account, including cards still in review and completed grades. Shown with the original Front photograph.</p></div>{current && actions}</header>
    {ended ? <div className={styles.notice} role="alert"><p>This private workspace has closed. Sign in again to reload your cards.</p><a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a></div>
      : !current ? <div className={styles.empty} role="status"><p>Loading your grading workspace…</p></div>
        : invalid ? <div className={styles.notice} role="alert"><p>The saved card list could not be verified.</p>{onRetryList && <button type="button" onClick={onRetryList}>Refresh workspace</button>}</div>
          : <>
            <div className={styles.toolbar}><p role="status">{loading ? 'Loading saved cards…' : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} in this view${nextCursor ? ' · More available' : ''}`}<small>Newest upload first</small></p>{onRetryList && <button type="button" disabled={loading || loadingMore} onClick={onRetryList}>Refresh workspace</button>}</div>
            {error && <div className={styles.notice} role="alert"><p>The workspace could not refresh. The last loaded cards are shown when available.</p></div>}
            {cards.length ? <div className={styles.grid} aria-label="Your assigned card gallery">{cards.map(card => <StaffGalleryCard key={staffCardGalleryKey(card)} card={card} queue={context.queue} onRetryList={onRetryList}/>)}</div>
              : loading ? <div className={styles.empty} role="status"><p>Loading saved cards…</p></div>
                : !error && <div className={styles.empty}><h2>No cards in this workspace yet</h2><p>Cards assigned to this staff account will appear here.</p></div>}
            {nextCursor && onLoadMore && <div className={styles.pagination}><button type="button" className={styles.more} disabled={loading || loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading older cards…' : 'Load more cards'}</button></div>}
          </>}
  </section>;
}
