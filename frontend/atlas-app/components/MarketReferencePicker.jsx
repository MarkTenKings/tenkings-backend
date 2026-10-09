import React, { useEffect, useRef, useState } from 'react';
import { groupSoldReferences, marketSearchMessage, saleAmountLabel, saleDateLabel } from '@atlas/manual-workspace/sold-references';
import styles from './MarketReferencePicker.module.css';

const validSource = value => value?.state === 'READY' && typeof value.previewId === 'string' && value.previewId.length > 0
  && Array.isArray(value.preview?.candidates) && value.preview.candidates.length <= 60
  && value.preview.candidates.every(candidate => candidate.sale?.currency === 'USD' && candidate.sale.priceBasis === 'sold'
    && Number.isSafeInteger(candidate.sale.priceMinor) && candidate.sale.priceMinor > 0 && typeof candidate.sale.id === 'string')
  && new Set(value.preview.candidates.map(candidate => candidate.sale.id)).size === value.preview.candidates.length;
function message(error) {
  if (['MARKET_PREVIEW_EXPIRED', 'MARKET_PUBLICATION_MISMATCH'].includes(error?.code)) return 'This selection no longer matches the current report. Check the saved result before starting another search.';
  return 'The result is not confirmed yet. Retry this saved selection.';
}

/** Saved evidence is read automatically; search and public selection are owned by
 * authenticated callbacks. No paid lookup or publication runs on mount. */
export default function MarketReferencePicker({ scopeKey, available = false, disabled = false, onPreview, onSave, onCheck,
  savedSource = null, automatic = false, automaticEnabled = false, card = null, cardImage = null,
  title = 'eBay sold comps', searchLabel = 'Find sold cards', refreshLabel = 'Refresh sales',
  note = 'Review the card identity and each sold listing before publishing references. Graders and grades stay as recorded; these sales do not set the value of this ATLAS card.' }) {
  const [source, setSource] = useState(null), [selected, setSelected] = useState([]), [activeGroup, setActiveGroup] = useState(''),
    [busy, setBusy] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(''), [pending, setPending] = useState(false), [searchPending, setSearchPending] = useState(false);
  const generation = useRef(0), lock = useRef(false), savedRequest = useRef(null), tabs = useRef(null), callbacks = useRef({ onPreview, onSave, onCheck });
  callbacks.current = { onPreview, onSave, onCheck };
  useEffect(() => {
    const owner = generation, version = ++owner.current;
    lock.current = false; savedRequest.current = null; setSource(null); setSelected([]); setActiveGroup(''); setBusy(''); setError(''); setStatus(''); setPending(false); setSearchPending(false);
    return () => { if (owner.current === version) owner.current++; };
  }, [scopeKey, available]);
  useEffect(() => {
    if (!savedSource || savedRequest.current) return;
    if (validSource(savedSource)) {
      setSource(savedSource); setSearchPending(false);
      if (savedSource.previewId !== source?.previewId) { setSelected([]); setActiveGroup(''); setStatus(''); setError(''); }
    } else if (savedSource.state !== 'READY') { setSource(null); setStatus(''); }
    // Retain user selection while a poll confirms the same saved result.
  }, [savedSource, scopeKey]);
  async function search() {
    if (disabled || !available || lock.current || savedRequest.current || typeof callbacks.current.onPreview !== 'function') return;
    lock.current = true; const version = generation.current; setBusy('Finding sold cards…'); setError(''); setStatus('');
    try {
      const value = await callbacks.current.onPreview();
      if (version !== generation.current) return;
      if (['QUEUED', 'SEARCHING', 'PENDING', 'UNKNOWN', 'FAILED', 'UNAVAILABLE'].includes(value?.state)) {
        setSearchPending(value.state === 'UNKNOWN' || value.state === 'PENDING'); setStatus(marketSearchMessage(value)); return;
      }
      if (!validSource(value)) throw new Error('MARKET_PREVIEW_INVALID');
      setSearchPending(false); setSource(value); setSelected([]); setActiveGroup('');
    } catch (failure) { if (version === generation.current) {
      const refused = failure?.code === 'MARKET_SEARCH_REVIEW_REQUIRED'; setSearchPending(!refused);
      setError(refused ? 'The report presentation changed before this search began. Find sold cards again using its current version.'
        : 'This saved search is not confirmed. Check it again to recover the same request; no new lookup will be purchased.');
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(''); } }
  }
  async function save() {
    if (disabled || lock.current || !source || !selected.length || typeof callbacks.current.onSave !== 'function') return;
    if (!savedRequest.current) savedRequest.current = { previewId: source.previewId, selectedIds: [...selected] };
    const request = savedRequest.current, version = generation.current; lock.current = true; setPending(true); setBusy('Saving references…'); setError(''); setStatus('');
    try {
      await callbacks.current.onSave(structuredClone(request));
      if (version !== generation.current) return;
      savedRequest.current = null; setPending(false); setSelected([]); setStatus('Sales references published.');
    } catch (failure) { if (version === generation.current) {
      if (failure?.code === 'MARKET_SELECTION_REVIEW_REQUIRED') {
        savedRequest.current = null; setPending(false); setSelected([]);
        setError('The report or sales search changed. Check the saved result to review current references.');
      } else setError(message(failure));
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(''); } }
  }
  if (!available) return null;
  const blocked = disabled || Boolean(busy) || pending, current = savedSource?.state === 'READY' ? source : savedSource ?? source;
  const waiting = ['QUEUED', 'SEARCHING', 'PENDING'].includes(current?.state), uncertain = current?.state === 'UNKNOWN';
  const expired = current?.state === 'FAILED' && current.reason === 'MARKET_PREVIEW_EXPIRED' && current.refreshable === true && current.refreshAction === 'SEARCH_AGAIN';
  const groups = groupSoldReferences(source?.preview.candidates), active = groups.find(group => group.key === activeGroup) ?? groups[0];
  const notice = busy || status || marketSearchMessage(current);
  const cardName = card?.playerName || card?.cardName;
  const excluded = source?.preview.excluded ?? {}, excludedCount = Number.isFinite(source?.preview.counts?.excluded) ? source.preview.counts.excluded : Object.values(excluded).filter(Number.isFinite).reduce((sum, count) => sum + count, 0);
  const tabPrefix = `market-${automatic ? 'automatic' : 'manual'}-${String(scopeKey).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  function keyTab(event, index) {
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : event.key === 'ArrowRight' ? (index + 1) % groups.length : event.key === 'ArrowLeft' ? (index + groups.length - 1) % groups.length : null;
    if (target === null) return; event.preventDefault(); setActiveGroup(groups[target].key);
    const tab = tabs.current?.querySelectorAll('[role="tab"]')[target]; tab?.focus(); tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return <section className={styles.panel} aria-label="Grade report sales references">
    <div className={styles.heading}><div><p className={styles.eyebrow}>REPORT · MARKET REFERENCES</p><h3>{title}</h3></div>
      <button type="button" disabled={blocked || waiting || current?.refreshable === false && !uncertain}
        onClick={() => { if ((uncertain || automatic && searchPending) && callbacks.current.onCheck) void callbacks.current.onCheck(); else void search(); }}>{uncertain || searchPending ? 'Check saved search' : expired ? 'Start fresh search' : current?.refreshAction === 'RETRY_SAVED_RESPONSE' ? 'Retry saved results' : source ? refreshLabel : searchLabel}</button></div>
    {(cardName || cardImage) && <div className={styles.cardHeading}>{cardImage && <div className={styles.cardImage}>{cardImage}</div>}<div><h4>{cardName || 'Approved card'}{card?.cardNumber && <span> #{card.cardNumber}</span>}</h4>
      {card?.parallel && <span className={styles.variant}>{card.parallel}</span>}<p>{[card?.year, card?.manufacturer, card?.productSet].filter(Boolean).join(' · ')}</p><small>Approved ATLAS identity · Unrecorded variant details remain unconfirmed</small></div></div>}
    <p className={styles.note}>{note}</p>
    {notice && <p className={styles.searchStatus} role="status">{notice}</p>}
    {!notice && !error && <p className={styles.searchStatus} role="status">{source ? source.preview.candidates.length ? `${source.preview.candidates.length} sold ${source.preview.candidates.length === 1 ? 'comp' : 'comps'} ready for your review` : 'Search saved · No qualifying sales'  : automatic ? automaticEnabled ? 'Saved results appear here automatically after approval.' : 'Saved results appear here. Start a search when needed.' : 'Search when needed · no lookup starts from opening this tool'}</p>}
    {source && <><div className={styles.query}><span>Search: {source.preview.query}</span><span>ATLAS {source.preview.atlasGrade} · Retrieved {saleDateLabel(source.preview.retrievedAt)}</span></div>
      {!groups.length && <div className={styles.empty}><strong>No qualifying sold listings</strong><p>The saved search returned no selectable sales for this card. Your approved grade is unchanged.</p></div>}
      {groups.length > 0 && <><div className={styles.groupTabs} ref={tabs} role="tablist" aria-label="Sales by grade, condition and variant">{groups.map((group, index) => <button key={group.key} id={`${tabPrefix}-tab-${index}`} type="button" role="tab" aria-selected={group.key === active.key} aria-controls={`${tabPrefix}-sales`} tabIndex={group.key === active.key ? 0 : -1}
        onClick={() => setActiveGroup(group.key)} onKeyDown={event => keyTab(event, index)}><strong>{group.label}</strong><span>{group.candidates.length} observed {group.candidates.length === 1 ? 'sale' : 'sales'}</span><small>{group.identityLabel}</small>{group.needsReview && <small>Identity needs review</small>}</button>)}</div>
        <div id={`${tabPrefix}-sales`} role="tabpanel" aria-labelledby={`${tabPrefix}-tab-${groups.indexOf(active)}`}><div className={styles.groupHeading}><h4>{active.label} sales</h4><span>Most recent first</span></div>
          <p className={styles.groupIdentity}>{active.identityLabel}. {active.needsReview ? 'Unspecified identity details remain unverified.' : 'Recorded identity details.'}</p>
          <div className={styles.tableWrap}><table><caption className={styles.srOnly}>{active.label} sold references · Most recent first</caption><thead><tr><th scope="col">Use</th><th scope="col">Date</th><th scope="col">Sold listing</th><th scope="col">Sold price</th></tr></thead><tbody>
            {active.candidates.map(({ sale, match, matchReason }) => <tr key={sale.id}><td className={styles.choose}><label><input type="checkbox" aria-label={`Use sale ${sale.title}`} checked={selected.includes(sale.id)} disabled={blocked}
              onChange={event => { if (blocked || lock.current) return; setSelected(event.target.checked ? [...selected, sale.id] : selected.filter(id => id !== sale.id)); }}/><span className={styles.mobileOnly}>Include</span></label></td>
              <td className={styles.soldDate}>{sale.soldAt ? <time dateTime={sale.soldAt}>{saleDateLabel(sale.soldAt)}</time> : 'Date unavailable'}</td>
              <td className={styles.saleTitle}><a href={sale.listingUrl} target="_blank" rel="noopener noreferrer">{sale.title}<span aria-hidden="true"> ↗</span></a><small>{match === 'UNKNOWN' || sale.identityStatus === 'UNKNOWN' ? 'Identity / variant needs review' : 'Verify card identity'}</small>{matchReason && <details><summary>Match details</summary><p>{matchReason}</p></details>}</td>
              <td className={styles.money}>{saleAmountLabel(sale)}</td></tr>)}
          </tbody></table></div></div></>}
      {excludedCount > 0 && <p className={styles.note}>{excludedCount} provider {excludedCount === 1 ? 'result' : 'results'} excluded from selection: undisclosed or unsupported sold amounts, unsupported grades, or conflicting identity evidence.</p>}
      {groups.length > 0 && <div className={styles.actions}><span>{selected.length} selected across all groups</span><button type="button" disabled={disabled || Boolean(busy) || !selected.length} onClick={() => void save()}>{pending ? 'Retry saved selection' : 'Publish references'}</button></div>}
      <p className={styles.footnote}>Saved results are staff review evidence. Only the references you publish appear on the customer report.</p>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
