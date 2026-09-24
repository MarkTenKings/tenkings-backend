import React, { useEffect, useRef, useState } from 'react';
import styles from './MarketReferencePicker.module.css';

const amount = sale => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sale.priceMinor / 100);
const date = value => value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Date unavailable';
const validSource = value => value?.state === 'READY' && typeof value.previewId === 'string' && value.previewId.length > 0
  && Array.isArray(value.preview?.candidates) && value.preview.candidates.length <= 60
  && value.preview.candidates.every(candidate => candidate.sale?.currency === 'USD' && candidate.sale.priceBasis === 'sold'
    && Number.isSafeInteger(candidate.sale.priceMinor) && candidate.sale.priceMinor > 0 && typeof candidate.sale.id === 'string')
  && new Set(value.preview.candidates.map(candidate => candidate.sale.id)).size === value.preview.candidates.length;
function message(error) {
  if (['MARKET_PREVIEW_EXPIRED', 'MARKET_PUBLICATION_MISMATCH'].includes(error?.code)) return 'This selection no longer matches the current report. Check the saved result before starting another search.';
  return 'The result is not confirmed yet. Retry this saved selection.';
}

/** Callbacks own authenticated transport and retain preview/commit intents on
 * the server. The browser supplies only the saved preview id and selected ids.
 * scopeKey must identify the exact card/approval; no paid lookup runs on mount.
 */
export default function MarketReferencePicker({ scopeKey, available = false, disabled = false, onPreview, onSave }) {
  const [source, setSource] = useState(null), [selected, setSelected] = useState([]), [busy, setBusy] = useState(''),
    [error, setError] = useState(''), [status, setStatus] = useState(''), [pending, setPending] = useState(false);
  const generation = useRef(0), lock = useRef(false), savedRequest = useRef(null), callbacks = useRef({ onPreview, onSave });
  callbacks.current = { onPreview, onSave };
  useEffect(() => {
    const owner = generation, version = ++owner.current;
    lock.current = false; savedRequest.current = null; setSource(null); setSelected([]); setBusy(''); setError(''); setStatus(''); setPending(false);
    return () => { if (owner.current === version) owner.current++; };
  }, [scopeKey, available]);
  async function search() {
    if (disabled || !available || lock.current || savedRequest.current || typeof callbacks.current.onPreview !== 'function') return;
    lock.current = true; const version = generation.current; setBusy('Finding sold cards…'); setError(''); setStatus(''); setSource(null); setSelected([]);
    try {
      const value = await callbacks.current.onPreview();
      if (version !== generation.current) return;
      if (value?.state === 'UNAVAILABLE') { setSource(null); setSelected([]); setStatus(({ PROVIDER_QUOTA_REACHED: 'The sold-sales provider quota is exhausted. Ask an administrator to check the account before searching again.', PROVIDER_REQUEST_LIMITED: 'The sold-sales provider has limited requests. Check the account limit or wait before starting another search.', PROVIDER_CONFIGURATION_ERROR: 'The sold-sales provider credential needs attention from an administrator.' })[value.reason] ?? 'Sold-card search is currently unavailable.'); return; }
      if (!validSource(value)) throw new Error('MARKET_PREVIEW_INVALID');
      setSource(value); setSelected([]);
      if (!value.preview.candidates.length) setStatus('No disclosed graded sales were found for review.');
    } catch (failure) { if (version === generation.current) setError(['MARKET_SEARCH_PENDING', 'MARKET_SEARCH_UNKNOWN'].includes(failure?.code)
      ? 'This saved search is not confirmed. Check it again to recover the same request.' : 'Could not load sold cards. Try the search again.'); }
    finally { if (version === generation.current) { lock.current = false; setBusy(''); } }
  }
  async function save() {
    if (disabled || lock.current || !source || !selected.length || typeof callbacks.current.onSave !== 'function') return;
    if (!savedRequest.current) savedRequest.current = { previewId: source.previewId, selectedIds: [...selected] };
    const request = savedRequest.current, version = generation.current; lock.current = true; setPending(true); setBusy('Saving references…'); setError(''); setStatus('');
    try {
      await callbacks.current.onSave(structuredClone(request));
      if (version !== generation.current) return;
      savedRequest.current = null; setPending(false); setSource(null); setSelected([]); setStatus('Sales references published.');
    } catch (failure) { if (version === generation.current) {
      if (failure?.code === 'MARKET_SELECTION_REVIEW_REQUIRED') {
        savedRequest.current = null; setPending(false); setSource(null); setSelected([]);
        setError('The report or sales search changed. Find sold cards again to review current references.');
      } else setError(message(failure));
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(''); } }
  }
  if (!available) return null;
  const blocked = disabled || Boolean(busy) || pending;
  return <section className={styles.panel} aria-label="Grade report sales references">
    <div className={styles.heading}><div><p className={styles.eyebrow}>REPORT · MARKET REFERENCES</p><h3>Show the sales behind the conversation.</h3></div>
      <button type="button" disabled={blocked} onClick={() => void search()}>{source ? 'Refresh sales' : 'Find sold cards'}</button></div>
    <p className={styles.note}>Choose matching cards. Each search checks one page of up to 40 provider results; fewer may qualify for review. Each keeps its original grader and grade; these sales do not set the value of this ATLAS card.</p>
    {source && <><div className={styles.query}><span>Search: {source.preview.query}</span><span>ATLAS {source.preview.atlasGrade} · {date(source.preview.retrievedAt)}</span></div>
      {source.preview.candidates.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th scope="col">Use</th><th scope="col">Sold card</th><th scope="col">Grader / grade</th><th scope="col">Sold</th><th scope="col">Price</th></tr></thead><tbody>
        {source.preview.candidates.map(({ sale, match }) => <tr key={sale.id}><td><input type="checkbox" aria-label={`Use sale ${sale.title}`} checked={selected.includes(sale.id)} disabled={blocked}
          onChange={event => { if (blocked || lock.current) return; setSelected(event.target.checked ? [...selected, sale.id] : selected.filter(id => id !== sale.id)); }}/></td>
          <td><span>{sale.title}</span><small>{match === 'UNKNOWN' ? 'Variant needs review' : 'Verify card identity'}</small></td><td>{sale.grader} {sale.grade}</td><td>{date(sale.soldAt)}</td><td className={styles.money}>{amount(sale)}</td></tr>)}
      </tbody></table></div>}
      <div className={styles.actions}><span>{selected.length} selected</span><button type="button" disabled={disabled || Boolean(busy) || !selected.length} onClick={() => void save()}>{pending ? 'Retry saved selection' : 'Publish references'}</button></div>
      {(source.preview.excluded?.undisclosedOrUnsupported > 0 || source.preview.excluded?.contradictory > 0) && <p className={styles.note}>Undisclosed prices, unsupported sales and conflicting variants are excluded.</p>}
    </>}
    {busy && <p role="status">{busy}</p>}{status && <p role="status">{status}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
