import { useEffect, useId, useState } from 'react';
import { collectionCardDisplay, collectionScopeKey, parseOwnerCollection, previewCollectionSettings } from '../../lib/collection-contract.mjs';
import styles from './collection.module.css';

/** Isolated owner-projection preview. No fetch, storage, persistence or offer
 * action is supplied here; the root must connect an authenticated reader. */
export default function MyCollection({ accountId, snapshot, displays = {}, accessState = 'READY', renderCardMedia, readOnly = false, afterCardId = null }) {
  const prefix = useId(), [searchState, setSearchState] = useState(null), [draftState, setDraftState] = useState(null), [pageEnded, setPageEnded] = useState(false);
  useEffect(() => {
    const end = () => setPageEnded(true);
    window.addEventListener('pagehide', end);
    return () => window.removeEventListener('pagehide', end);
  }, []);
  useEffect(() => { setDraftState(null); setSearchState(null); }, [accountId, accessState]);
  let collection = null;
  if (accessState === 'READY' && !pageEnded) {
    try { collection = parseOwnerCollection(snapshot, accountId); } catch { /* fail closed before rendering private fields */ }
  }
  if (!collection) return <section className={styles.workspace} aria-label="My Collection"><h1>My Collection</h1>
    <p role="status">{accessState === 'LOADING' && !pageEnded ? 'Loading your collection…' : 'Your collection is unavailable. Refresh your signed-in account to continue.'}</p></section>;
  const scope = collectionScopeKey(collection), draft = draftState?.scope === scope ? draftState.value : {};
  const search = searchState?.scope === scope ? searchState.value : '';
  const preview = previewCollectionSettings(collection, draft), hasChanges = Object.keys(draft).length > 0;
  const update = patch => setDraftState({ scope, value: { ...draft, ...patch } });
  const updateCard = (cardId, patch) => update({ cards: { ...draft.cards, [cardId]: { ...draft.cards?.[cardId], ...patch } } });
  const rows = collection.cards.map(card => ({ card, display: collectionCardDisplay(card, displays[card.cardId]),
    preview: preview.cards.find(row => row.cardId === card.cardId) }));
  const query = search.trim().toLocaleLowerCase('en-US');
  const visible = rows.filter(row => `${row.display.title} ${row.display.certificateNumber}`.toLocaleLowerCase('en-US').includes(query));
  return <section className={styles.workspace} aria-labelledby={`${prefix}-title`}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>YOUR CARDS</p><h1 id={`${prefix}-title`}>My Collection</h1>
      <p>Cards linked to your verified ownership record.</p></div><span className={styles.count}>{collection.cards.length} {readOnly || collection.nextCardId ? 'on this page' : collection.cards.length === 1 ? 'card' : 'cards'}</span></header>
    {readOnly ? <aside className={styles.notice}><strong>Recorded preferences</strong><p>Collection: {collection.preferences.visibility === 'PRIVATE' ? 'Private' : 'Public'} · {collection.preferences.offersDisabled ? 'Offers disabled' : 'Open to offers'}. Settings changes and offer delivery are not available here.</p></aside>
      : <aside className={styles.notice}><strong>Local preview</strong><p>Privacy and offer controls below preview your choices. Changes are not saved, and offers cannot be sent.</p></aside>}
    {!readOnly && <details className={styles.settings}><summary>Preview collection preferences</summary>
      <div className={styles.controls}>
        <label><input type="checkbox" checked={preview.visibility === 'PUBLIC'} onChange={event => update({ visibility: event.target.checked ? 'PUBLIC' : 'PRIVATE' })}/> Show this collection publicly</label>
        <label><input type="checkbox" checked={preview.offersDisabled} onChange={event => update({ offersDisabled: event.target.checked })}/> Disable offers for every card</label>
      </div><p className={styles.help}>A private collection hides its cards from collection browsing. Each card keeps its own privacy and offer choice. Existing public grade reports remain available.</p>
      {hasChanges && <p role="status" className={styles.draft}>Preview only — changes have not been saved. <button type="button" className={styles.textButton} onClick={() => setDraftState(null)}>Reset preview</button></p>}
    </details>}
    <div className={styles.toolbar}><label htmlFor={`${prefix}-search`}>{readOnly ? 'Find a card on this page' : 'Find a card'}</label><input id={`${prefix}-search`} type="search" value={search} placeholder="Card name or certificate" onChange={event => setSearchState({ scope, value: event.target.value })}/></div>
    {!rows.length ? <div className={styles.empty}><h2>{afterCardId ? 'No cards remain on this page' : 'No verified cards yet'}</h2><p>{afterCardId ? 'Return to the first page to read the latest collection.' : 'Grading submissions and report access do not establish current ownership. Your collection will appear when a verified ownership record is connected.'}</p></div>
      : !visible.length ? <p role="status">No cards match your search.</p>
        : <div className={styles.grid}>{visible.map(({ card, display, preview: cardPreview }) => <article key={card.cardId} className={styles.card}>
          {renderCardMedia ? <div className={styles.media}>{renderCardMedia(card)}</div> : null}
          <p className={styles.eyebrow}>CERTIFICATE {display.certificateNumber}</p><h2>{display.title}</h2>
          {display.grade !== null && <p className={styles.grade}>ATLAS {display.grade}</p>}
          <div className={styles.statuses}><span>{card.visibility === 'PRIVATE' ? 'Private' : 'Public'}</span><span className={styles.offer}>{card.offers.preference === 'OPEN_TO_OFFERS' ? 'Open to offers' : 'Offers disabled'}</span></div>
          <p className={styles.help}>Offer preference recorded. Offer delivery is not available.</p>
          <dl className={styles.facts}><div><dt>Ownership</dt><dd>Verified record</dd></div><div><dt>Current physical holder</dt><dd>Unknown</dd></div></dl>
          <a className={styles.reportLink} href={display.reportPath}>Grade Report <span aria-hidden="true">↗</span></a>
          {!readOnly && <details className={styles.cardSettings}><summary>Preview card preferences</summary><div className={styles.controls}>
            <label><input type="checkbox" checked={cardPreview.cardVisibility === 'PUBLIC'} onChange={event => updateCard(card.cardId, { visibility: event.target.checked ? 'PUBLIC' : 'PRIVATE' })}/> Show this card publicly</label>
            <label><input type="checkbox" checked={cardPreview.cardDisabled} onChange={event => updateCard(card.cardId, { offersDisabled: event.target.checked })}/> Disable offers for this card</label>
          </div><p className={styles.help}>Preview: {cardPreview.visibility === 'PRIVATE' ? 'Private' : 'Public'} · {cardPreview.preference === 'OPEN_TO_OFFERS' ? 'Open to offers' : 'Offers disabled'}</p></details>}
        </article>)}</div>}
    {collection.nextCardId && <p className={styles.help}>{readOnly ? 'More verified cards are available on the next page.' : 'More verified cards are available. This preview shows the current page only.'}</p>}
  </section>;
}
