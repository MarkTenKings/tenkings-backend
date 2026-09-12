/* eslint-disable @next/next/no-img-element -- Private, expiring evidence previews must bypass the shared image optimizer. */
import { useEffect, useState } from 'react';
import type { StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchCandidate, type StaffInventoryResearchResult } from '../../lib/staffInventoryResearch';
import styles from './StaffInventoryResearchPanel.module.css';

const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const soldDate = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
function sourceAmount(amount: string | null, currency: string | null): string | null {
  if (!amount?.match(/^(\d{1,8})(?:\.(\d{1,2}))?$/) || Number(amount) <= 0) return null;
  return new Intl.NumberFormat('en-US', { ...(currency ? { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code' } : {}), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
}
function priceEvidence(candidate: StaffInventoryResearchCandidate) {
  // Source decimals are for display only. The engine's selected integer cents own the estimate.
  const reported = sourceAmount(candidate.sold_price, candidate.sold_currency);
  const accepted = candidate.accepted_offer ? sourceAmount(candidate.accepted_offer.amount, candidate.accepted_offer.currency) : null;
  const conflictingSource = /\bconflicting\b/i.test(candidate.exclusion_reason ?? '');
  if (accepted) return { amount: accepted, label: conflictingSource ? 'Reported accepted offer' : 'Accepted offer', detail: conflictingSource ? 'Conflicting source evidence · Unverified' : 'Verified sale amount', reported: reported !== accepted ? reported : null, available: true };
  if (!reported) return { amount: 'Price unavailable', label: 'Source price', detail: 'The source did not provide a usable amount.', reported: null, available: false };
  if (candidate.source_eligible && candidate.sold_price_cents !== null) return { amount: reported, label: 'Sold price', detail: 'Verified sale amount', reported: null, available: true };
  return { amount: reported, label: candidate.best_offer_accepted === true ? 'Listed price' : 'Reported price', detail: `${candidate.best_offer_accepted === true ? 'Accepted offer unavailable' : 'Final sale unverified'}${candidate.sold_currency ? '' : ' · Currency not provided'}`, reported: null, available: true };
}

function ComparisonCard({ candidate, preview, status, reason, included = false }: {
  candidate: StaffInventoryResearchCandidate; preview?: string; status: string; reason: string; included?: boolean;
}) {
  const [expanded, setExpanded] = useState(false), [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); setExpanded(false); }, [preview]);
  const price = priceEvidence(candidate), image = typeof preview === 'string' && preview && !imageFailed ? preview : null;
  return <article className={`${styles.compCard} ${included ? styles.includedCard : ''} ${expanded ? styles.expandedCard : ''}`} aria-label={candidate.title}>
    {image ? <button type="button" className={styles.photoButton} onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Reduce' : 'Enlarge'} listing photo: ${candidate.title}`}>
      <img src={image} alt={`Saved listing photo of ${candidate.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      <span>{expanded ? 'Reduce photo' : 'Enlarge photo'} <span aria-hidden="true">↗</span></span>
    </button> : <div className={styles.photoUnavailable}><span aria-hidden="true">▧</span><strong>Photo unavailable</strong><small>{imageFailed ? 'Private preview could not load.' : 'No private preview saved.'}</small></div>}
    <div className={styles.saleOverview}>
      <span className={styles.priceLabel}>{price.label}</span>
      <strong className={price.available ? styles.salePrice : styles.priceUnavailable}>{price.amount}</strong>
      <span className={styles.priceDetail}>{price.detail}</span>
      {price.reported && <span className={styles.priceDetail}>Reported listing: {price.reported}</span>}
      <div className={styles.saleMeta}>
        <span>{candidate.sold_date ? <>Sold <time dateTime={candidate.sold_date}>{soldDate(candidate.sold_date)}</time></> : 'Sale date unavailable'}</span>
        <span>{candidate.raw ? 'Raw / ungraded' : `${candidate.grader} ${candidate.numeric_grade}`}</span>
        <span>eBay · SoldCompsAPI</span>
      </div>
    </div>
    <a className={styles.listingTitle} href={candidate.listing_url} target="_blank" rel="noreferrer">{candidate.title}<span aria-hidden="true"> ↗</span></a>
    <div className={styles.matchReason}><span className={included ? styles.includedBadge : styles.matchBadge}>{status}</span><p>{reason}</p>{candidate.exclusion_reason && candidate.exclusion_reason !== reason && <p>{candidate.exclusion_reason}</p>}</div>
  </article>;
}

function ResearchEvidence({ result, previews }: { result: StaffInventoryResearchResult; previews: Record<string, string> }) {
  const selected = new Set(result.estimate.status === 'estimated' ? result.selected_candidate_ids : []);
  const assessments = new Map(result.comparison_assessments?.map(assessment => [assessment.candidate_id, assessment]));
  const included = result.candidates.filter(candidate => selected.has(candidate.id));
  const matched = result.candidates.filter(candidate => !selected.has(candidate.id) && assessments.get(candidate.id)?.classification === 'matched');
  const possible = result.candidates.filter(candidate => !selected.has(candidate.id) && assessments.get(candidate.id)?.classification === 'possible');
  const rejected = result.candidates.filter(candidate => !selected.has(candidate.id) && assessments.get(candidate.id)?.classification === 'rejected');
  // Older research recorded every unselected listing as a rejection, including unresolved
  // prices and catalog coverage. That is not enough evidence to call the card a mismatch.
  const other = result.candidates.filter(candidate => !selected.has(candidate.id) && !assessments.has(candidate.id));
  function cards(candidates: StaffInventoryResearchCandidate[], status: string, usedInEstimate = false) {
    return <div className={styles.comps}>{candidates.map(candidate => <ComparisonCard key={candidate.id} candidate={candidate}
      preview={candidate.image?.storage_key ? previews[candidate.image.storage_key] : undefined} included={usedInEstimate} status={status}
      reason={assessments.get(candidate.id)?.reason ?? result.rejections.find(rejection => rejection.candidate_id === candidate.id)?.reason ?? candidate.exclusion_reason ?? (usedInEstimate ? 'Selected from matching sales with verified prices.' : 'This listing has not been established as a matching comparison.')} />)}</div>;
  }
  const searches = result.research_queries;
  return <div className={styles.evidence}>
    {included.length > 0 && <section className={styles.resultGroup} aria-label="Included in market estimate"><h4>Included in estimate <span>{included.length}</span></h4><p>Matching sales with verified prices used in the estimate above.</p>{cards(included, 'Included in estimate', true)}</section>}
    {matched.length > 0 && <section className={styles.resultGroup} aria-label="Matching research candidates"><h4>Matching research candidates <span>{matched.length}</span></h4><p>Research found a match. These listings still lack the evidence required for the estimate.</p>{cards(matched, 'Research match · Not in estimate')}</section>}
    {possible.length > 0 && <section className={styles.resultGroup} aria-label="Candidates to review"><h4>Candidates to review <span>{possible.length}</span></h4><p>Possible comparisons with unresolved matching details. No prices here enter the estimate.</p>{cards(possible, 'Needs review · Not in estimate')}</section>}
    {!included.length && !matched.length && !possible.length && <div className={styles.emptyMatches}><strong>{result.candidates.length ? 'No matching comparisons established yet' : 'No usable listings returned'}</strong><p>{result.candidates.length ? 'The inspected listings remain available below, with their source prices and the reason each was not selected.' : 'Research did not find usable sale evidence for this card.'}</p></div>}
    {other.length > 0 && <details className={styles.disclosure}><summary>Other results <span>{other.length}</span></summary><p>Saved listings from earlier research. A source price or a sold listing alone does not establish a matching card.</p>{cards(other, 'Not included in estimate')}</details>}
    {rejected.length > 0 && <details className={styles.disclosure}><summary>Rejected comparisons <span>{rejected.length}</span></summary><p>Research found a mismatch. These listings are retained for inspection and excluded from the estimate.</p>{cards(rejected, 'Rejected comparison')}</details>}
    <details className={styles.disclosure}>
      <summary>Searches &amp; evidence {searches?.length ? <span>{searches.length} {searches.length === 1 ? 'search' : 'searches'}</span> : null}</summary>
      {searches?.length ? <ol className={styles.searchHistory}>{searches.map(search => <li key={search.sequence}>
        <div className={styles.searchHeading}><strong>{search.sequence === 1 ? 'Initial search' : `Refined search ${search.sequence - 1}`}</strong><span>{search.status === 'completed' ? `${search.candidate_ids.length} ${search.candidate_ids.length === 1 ? 'result' : 'results'}` : 'Search unavailable'}</span></div>
        <p className={styles.query}>{search.query}</p><p>{search.reason}</p>{search.status === 'failed' && <p>Earlier results remain available.</p>}
      </li>)}</ol> : result.query ? <><h4>Saved search</h4><p className={styles.query}>{result.query}</p></> : <p>No search query was recorded.</p>}
      {result.references.length > 0 && <><h4>Catalog references</h4><ul>{result.references.map(reference => <li key={reference.id}>{reference.source_url ? <a href={reference.source_url} target="_blank" rel="noreferrer">{reference.identity.set_name} · {reference.variant_name}</a> : `${reference.identity.set_name} · ${reference.variant_name} · Reviewed Ten Kings catalog`}</li>)}</ul></>}
      {result.warnings.length > 0 && <><h4>Research notes</h4><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></>}
    </details>
  </div>;
}

export default function StaffInventoryResearchPanel({ unitId, token, descriptionEventId }: { unitId: string; token: string; descriptionEventId?: string | null }) {
  const scope = JSON.stringify([unitId, descriptionEventId ?? null, token]);
  const [snapshot, setSnapshot] = useState<{ scope: string; job: StaffInventoryResearchStatusV2 | null; previews: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retrying, setRetrying] = useState(false), [revision, setRevision] = useState(0);
  const job = snapshot?.scope === scope ? snapshot.job : null, previews = snapshot?.scope === scope ? snapshot.previews : {};
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null); setLoading(true); setError('');
    async function read() {
      try {
        const response = await fetch(`/api/v2/admin/inventory/research?unit_id=${encodeURIComponent(unitId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const value = await response.json();
        if (!response.ok || value.version !== 1 || !Array.isArray(value.jobs)) throw new Error();
        const next = value.jobs.find((item: StaffInventoryResearchStatusV2) => item.unit_id === unitId && (!descriptionEventId || item.description_event_id === descriptionEventId)) ?? null;
        if (next && (!['queued', 'running', 'complete', 'failed'].includes(next.status) || next.result !== null && (!StaffInventoryResearchResultSchema.safeParse(next.result).success || next.result.unit_id !== next.unit_id || next.result.description_event_id !== next.description_event_id || next.result.description_hash !== next.description_hash))) throw new Error();
        if (controller.signal.aborted) return;
        setSnapshot({ scope, job: next, previews: value.image_previews && typeof value.image_previews === 'object' ? value.image_previews : {} });
        setError(''); setLoading(false);
        if (next?.status === 'queued' || next?.status === 'running') timer = setTimeout(read, 15000);
      } catch {
        if (!controller.signal.aborted) { setLoading(false); setError('Research is temporarily unavailable. Your inventory is saved.'); }
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [unitId, token, descriptionEventId, scope, revision]);
  async function retry() {
    if (!job?.can_retry || retrying) return;
    setRetrying(true); setError('');
    try {
      const response = await fetch('/api/v2/admin/inventory/research', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), jobId: job.job_id, unitId, descriptionEventId: job.description_event_id, inputHash: job.input_hash, expectedAttemptCount: job.attempt_count }) });
      if (!response.ok) throw new Error();
      setRevision(value => value + 1);
    } catch { setError('Research could not be restarted. Refresh this card and try again.'); }
    finally { setRetrying(false); }
  }
  async function startResearch() {
    if (job || !descriptionEventId || retrying) return;
    setRetrying(true); setError('');
    try {
      const response = await fetch('/api/v2/admin/inventory/research', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', requestId: crypto.randomUUID(), unitId, descriptionEventId }) });
      if (!response.ok) throw new Error();
      setRevision(value => value + 1);
    } catch { setError('Research could not be started. Refresh this card and try again.'); }
    finally { setRetrying(false); }
  }
  const result = job?.result, researching = job?.status === 'queued' || job?.status === 'running';
  return <section className={styles.panel} aria-label="Card market research">
    <header><div><p className={styles.eyebrow}>SOLD COMPS · CARD RESEARCH</p><h3>Market research</h3></div><span className={styles.status}>{loading ? 'Loading' : researching ? job.status === 'running' ? 'Researching' : 'Queued' : job?.status === 'failed' ? 'Needs attention' : result?.estimate.status === 'estimated' ? 'Updated' : result ? 'More evidence needed' : 'Not researched'}</span></header>
    {loading ? <p>Loading this card’s research…</p> : researching ? <p>We’re checking the card and recent eBay sales. You can keep adding inventory or close this page.</p> : !job ? <p>New individual cards receive automatic research after they are saved.</p> : job.status === 'failed' ? <p>{job.error?.message ?? 'This research attempt could not finish.'}</p> : null}
    {result && <>
      <div className={styles.value}><div><span>Estimated market value</span><strong className={result.estimate.value_cents === null ? styles.unknownValue : undefined}>{result.estimate.value_cents === null ? 'More evidence needed' : dollars(result.estimate.value_cents)}</strong></div>{result.estimate.status === 'estimated' && <div className={styles.valueRange}><span>{result.estimate.count} verified matching sales</span><p>{dollars(result.estimate.low_cents!)}–{dollars(result.estimate.high_cents!)}</p></div>}</div>
      <p>{result.estimate.reason}</p>
      <div className={styles.identity}><span>{result.identity.status === 'base' ? 'Base card' : result.identity.status === 'variant' ? 'Variant identified' : 'Variant check'}</span><strong>{result.identity.variant_name ?? result.identity.suggestion ?? 'Unresolved'}</strong><p>{result.identity.reason}</p></div>
      <p className={styles.note}>Researched {new Date(result.researched_at).toLocaleDateString()}. Market estimates are separate from your cost and expected sale price.</p>
      <ResearchEvidence key={`${job.job_id}:${result.researched_at}`} result={result} previews={previews} />
    </>}
    {error && <p role="alert">{error}</p>}
    <footer>{!loading && !job && descriptionEventId && <button type="button" onClick={() => void startResearch()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research this card'}</button>}{job?.can_retry && <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research again'}</button>}{error && <button type="button" onClick={() => setRevision(value => value + 1)}>Refresh research</button>}</footer>
  </section>;
}
