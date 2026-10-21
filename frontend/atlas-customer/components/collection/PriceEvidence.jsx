import { useEffect, useId, useState } from 'react';
import { COMP_REASON_LABELS, curateSoldComps, parseSavedCompSource } from '../../lib/sold-comp-curation.mjs';
import styles from './collection.module.css';

const amount = (minor, currency) => minor === null ? 'Amount unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
const date = value => value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Date unknown';

/** Optional staff curation preview. The server must repeat all binding and
 * eligibility checks when a future authenticated persistence path is added. */
export default function PriceEvidence({ accountId, source, binding, asOf, recencyDays, accessState = 'READY' }) {
  const prefix = useId(), [state, setState] = useState(null), [pageEnded, setPageEnded] = useState(false);
  useEffect(() => { const end = () => setPageEnded(true); window.addEventListener('pagehide', end); return () => window.removeEventListener('pagehide', end); }, []);
  useEffect(() => { setState(null); }, [accountId, accessState]);
  let preview = null;
  if (accessState === 'READY' && !pageEnded && typeof accountId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(accountId)) {
    try { preview = parseSavedCompSource(source, binding, { asOf, recencyDays }); } catch { /* no stale or unbound evidence */ }
  }
  if (!preview) return <section className={styles.workspace} aria-label="Sold price evidence"><h2>Sold price evidence</h2><p role="status">Saved sales are unavailable for this approval.</p></section>;
  const scope = JSON.stringify([accountId, preview.binding, preview.source, preview.policy]), local = state?.scope === scope ? state : { scope, selectedIds: [], decision: null, error: '' };
  const select = (id, checked) => setState({ scope, selectedIds: checked ? [...local.selectedIds, id] : local.selectedIds.filter(value => value !== id), decision: null, error: '' });
  const decide = outcome => {
    try {
      const ids = outcome === 'SELECTED' ? local.selectedIds : [];
      const decision = curateSoldComps(source, binding, { outcome, selectedIds: ids, reviewedIds: ids, asOf, recencyDays });
      setState({ scope, selectedIds: ids, decision, error: '' });
    } catch (error) {
      const message = error.code === 'COMP_GRADE_GROUP_MIXED' ? 'Choose sales from one grading company, exact grade and designation.'
        : error.code === 'COMP_CURRENCY_MIXED' ? 'Choose sales in one currency. No conversion is applied.' : 'Review one to five eligible sales before previewing guidance.';
      setState({ ...local, decision: null, error: message });
    }
  };
  const guidance = local.decision?.guidance;
  return <section className={styles.workspace} aria-labelledby={`${prefix}-title`}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>SAVED SOLD REFERENCES</p><h2 id={`${prefix}-title`}>Price evidence</h2><p>Select 1–5 recent matching sales, or continue without comps.</p></div></header>
    <aside className={styles.notice}><strong>Local curation preview</strong><p>Nothing is saved. Review the exact printing, serial denominator, autograph and relic evidence before selecting. Missing comps never block an approved report.</p></aside>
    <p className={styles.help}>Source observed {date(preview.source.observedAt)}. This preview uses a {recencyDays}-day sales window as of {date(asOf)}.</p>
    <div className={styles.sales}>{preview.candidates.map(sale => <article key={sale.id} className={styles.sale}>
      <label className={styles.selectSale}><input type="checkbox" checked={local.selectedIds.includes(sale.id)} disabled={!sale.eligible || !local.selectedIds.includes(sale.id) && local.selectedIds.length >= 5}
        onChange={event => select(sale.id, event.target.checked)}/><span><strong>{sale.title}</strong><span className={styles.help}>{sale.group}</span></span></label>
      <div className={styles.saleValue}><strong>{sale.priceMinor !== null && sale.currency ? amount(sale.priceMinor, sale.currency) : sale.priceBasis === 'accepted_offer_unknown' ? 'Accepted offer amount unknown' : 'Amount unknown'}</strong><span>{date(sale.soldAt)}</span></div>
      {sale.listingUrl && <a href={sale.listingUrl} target="_blank" rel="noopener noreferrer">View original sale ↗</a>}
      {!sale.eligible && <p className={styles.help}>Excluded from guidance: {sale.reasonCodes.map(reason => COMP_REASON_LABELS[reason]).join(' · ')}</p>}
    </article>)}</div>
    {!preview.candidates.length && <p>No saved sold references are available for this approval.</p>}
    <div className={styles.actions}><button type="button" className={styles.primary} disabled={!local.selectedIds.length} onClick={() => decide('SELECTED')}>Preview {local.selectedIds.length || ''} selected {local.selectedIds.length === 1 ? 'sale' : 'sales'}</button>
      <button type="button" className={styles.secondary} onClick={() => decide('SKIP')}>Skip comps</button><button type="button" className={styles.secondary} onClick={() => decide('NO_SUITABLE_COMPS')}>No suitable comps</button></div>
    {local.error && <p role="alert">{local.error}</p>}
    {local.decision && <div className={styles.guidance} role="status">{guidance ? <>
      <p className={styles.eyebrow}>PROPOSED METHOD · LOCAL PREVIEW</p><h3>Selected-sale mean <span>{amount(guidance.meanMinor, guidance.currency)}</span></h3>
      <p>{guidance.sampleCount} {guidance.sampleCount === 1 ? 'sale' : 'sales'} · {guidance.group} · {date(guidance.oldestSaleAt)} to {date(guidance.newestSaleAt)}</p>
      <p>Observed range: {amount(guidance.lowMinor, guidance.currency)}–{amount(guidance.highMinor, guidance.currency)}.</p>
      <p>{local.decision.selected.map(sale => amount(sale.priceMinor, guidance.currency)).join(' + ')} = {amount(guidance.sumMinor, guidance.currency)}; divided by {guidance.sampleCount}, rounded to the nearest cent with half cents upward.</p>
      <p>This is an arithmetic reference from the selected sales, not an appraisal or a guaranteed sale price. Shipping, taxes and fees are excluded. Grading companies are not treated as equivalent. The seller chooses the asking price.</p>
      <p className={styles.draft}>Preview only. The approved report and saved market snapshot are unchanged.</p>
    </> : <><h3>{local.decision.outcome === 'SKIP' ? 'Comps skipped in this preview' : 'No suitable comps selected'}</h3><p>No price is suggested. The approved report is unchanged.</p></>}</div>}
  </section>;
}
