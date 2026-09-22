/* eslint-disable @next/next/no-img-element -- Private, expiring evidence previews must bypass the shared image optimizer. */
import { useEffect, useRef, useState } from 'react';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchCandidate, type StaffInventoryResearchResult } from '../../lib/staffInventoryResearch';
import { getStaffInventoryMarketCalculation, StaffInventoryResearchReviewSnapshotSchema, projectStaffInventoryResearchReview, bindStaffInventoryResearchRecovery, staffInventoryRecoveryDisplay,
  type StaffInventoryResearchJobWithReview, type StaffInventoryResearchReviewProjection } from '../../lib/staffInventoryMarketValue';
import StaffInventoryCompReview, { type InventoryReviewPhotos } from './StaffInventoryCompReview';
import StaffInventoryResearchRecovery from './StaffInventoryResearchRecovery';
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

function ComparisonCard({ candidate, preview, status, reason, assessmentReason, included = false }: {
  candidate: StaffInventoryResearchCandidate; preview?: string; status: string; reason: string; assessmentReason?: string; included?: boolean;
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
    <div className={styles.matchReason}><span className={included ? styles.includedBadge : styles.matchBadge}>{status}</span><p>{reason}</p>{candidate.exclusion_reason && candidate.exclusion_reason !== reason && <p>{candidate.exclusion_reason}</p>}{assessmentReason && assessmentReason !== reason && assessmentReason !== candidate.exclusion_reason && <p><strong>AI comparison: </strong>{assessmentReason}</p>}</div>
  </article>;
}

function ResearchEvidence({ result, previews, calculation, projection }: { result: StaffInventoryResearchResult; previews: Record<string, string>; calculation: ReturnType<typeof getStaffInventoryMarketCalculation>; projection: StaffInventoryResearchReviewProjection | null }) {
  const selected = new Set(projection?.selected_candidate_ids ?? calculation?.selected_candidates.map(candidate => candidate.id) ?? []);
  const staffExcludedIds = new Set(projection?.excluded_candidate_ids ?? []), duplicates = new Set(projection?.duplicate_candidate_ids ?? []);
  const assessments = new Map(result.comparison_assessments?.map(assessment => [assessment.candidate_id, assessment]));
  const included = result.candidates.filter(candidate => selected.has(candidate.id));
  const staffExcluded = result.candidates.filter(candidate => staffExcludedIds.has(candidate.id));
  const matched = result.candidates.filter(candidate => !selected.has(candidate.id) && !staffExcludedIds.has(candidate.id) && assessments.get(candidate.id)?.classification === 'matched');
  const possible = result.candidates.filter(candidate => !selected.has(candidate.id) && assessments.get(candidate.id)?.classification === 'possible');
  const rejected = result.candidates.filter(candidate => !selected.has(candidate.id) && assessments.get(candidate.id)?.classification === 'rejected');
  // Older research recorded every unselected listing as a rejection, including unresolved
  // prices and catalog coverage. That is not enough evidence to call the card a mismatch.
  const other = result.candidates.filter(candidate => !selected.has(candidate.id) && !staffExcludedIds.has(candidate.id) && !assessments.has(candidate.id));
  function cards(candidates: StaffInventoryResearchCandidate[], status: string, usedInEstimate = false) {
    return <div className={styles.comps}>{candidates.map(candidate => <ComparisonCard key={candidate.id} candidate={candidate}
      preview={candidate.image?.storage_key ? previews[candidate.image.storage_key] : undefined} included={usedInEstimate} status={status} assessmentReason={assessments.get(candidate.id)?.reason}
      reason={staffExcludedIds.has(candidate.id) ? 'Excluded by a saved staff decision. Restore it using the review controls above if appropriate.' : duplicates.has(candidate.id) && !selected.has(candidate.id) ? 'Repeated listing image. This evidence does not receive additional weight.' : !usedInEstimate ? result.rejections.find(rejection => rejection.candidate_id === candidate.id)?.reason ?? assessments.get(candidate.id)?.reason ?? candidate.exclusion_reason ?? 'This listing has not been established as a matching comparison.' : assessments.get(candidate.id)?.reason ?? 'Selected from matching sales with verified prices.'} />)}</div>;
  }
  const searches = result.research_queries;
  return <div className={styles.evidence}>
    {included.length > 0 && <section className={styles.resultGroup} aria-label={calculation ? 'Included in market estimate' : 'Eligible selected comps'}><h4>{calculation ? 'Included in estimate' : 'Selected comps · More evidence needed'} <span>{included.length}</span></h4><p>{calculation ? 'These selected sales enter the value above.' : 'The remaining selection does not yet establish a value.'} Check the card, printing and condition against your photos.</p>{cards(included, calculation ? 'Included in estimate' : 'Selected · Value unavailable', true)}</section>}
    {staffExcluded.length > 0 && <details className={styles.disclosure}><summary>Staff-excluded comps <span>{staffExcluded.length}</span></summary>{cards(staffExcluded, 'Staff excluded · Not used')}</details>}
    {matched.length > 0 && <section className={styles.resultGroup} aria-label="Matching research candidates"><h4>Matching research candidates <span>{matched.length}</span></h4><p>Research found a card match. These listings are not used in the value. The reason is shown with each listing.</p>{cards(matched, 'Research match · Not in estimate')}</section>}
    {possible.length > 0 && <section className={styles.resultGroup} aria-label="Candidates to review"><h4>Candidates to review <span>{possible.length}</span></h4><p>Possible comparisons with unresolved matching details. No prices here enter the estimate.</p>{cards(possible, 'Needs review · Not in estimate')}</section>}
    {!included.length && !matched.length && !possible.length && <div className={styles.emptyMatches}><strong>{result.candidates.length ? 'No matching comparisons established yet' : 'No usable listings returned'}</strong><p>{result.candidates.length ? 'The inspected listings remain available below, with their source prices and the reason each was not selected.' : 'Research did not find usable sale evidence for this card.'}</p></div>}
    {other.length > 0 && <details className={styles.disclosure} open={!included.length && !matched.length && !possible.length}><summary>Other results <span>{other.length}</span></summary><p>Retrieved listings without a completed match assessment. A source price or a sold listing alone does not establish a matching card.</p>{cards(other, 'Not included in estimate')}</details>}
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

function ValueCalculation({ result, calculation, projection }: { result: StaffInventoryResearchResult; calculation: ReturnType<typeof getStaffInventoryMarketCalculation>; projection: StaffInventoryResearchReviewProjection | null }) {
  const included = projection?.count ?? calculation?.count ?? 0, excluded = result.candidates.length - included;
  return <div className={styles.calculation} aria-label="How the eBay comp value is calculated">
    <h4>How this value is calculated</h4>
    {calculation ? <>
      <p className={styles.formula}>{calculation.selected_candidates.map(candidate => dollars(candidate.sold_price_cents!)).join(' + ')} <span aria-hidden="true">=</span> <strong>{dollars(calculation.total_cents)}</strong></p>
      <p className={styles.formula}>{dollars(calculation.total_cents)} ÷ {calculation.count} {calculation.count === 1 ? 'sale' : 'sales'} = <strong>{dollars(calculation.value_cents)}</strong></p>
      <p>Each selected sale has equal weight. The average is rounded to the nearest cent and excludes shipping.</p>
    </> : <p>{projection?.reason ?? (result.estimate.status === 'estimated' ? 'The saved selection needs review before a value can be shown. Its evidence does not pass the current calculation checks.' : 'At least two matching sold comparisons with verified prices and different listing images are needed for a value.')}</p>}
    <p className={styles.calculationCounts}><strong>{included} included</strong> · {excluded} {excluded === 1 ? 'listing' : 'listings'} not used</p>
    <p>Only selected sales enter the average. Possible matches, rejected cards and unverified prices are excluded. AI matching can make mistakes; inspect the selected photos, printing and condition below.</p>
  </div>;
}

export default function StaffInventoryResearchPanel({ unitId, token, descriptionEventId, actorId, inventoryPhotos = { front: null, back: null }, onEditDetails }: { unitId: string; token: string; descriptionEventId?: string | null; actorId?: string; inventoryPhotos?: InventoryReviewPhotos; onEditDetails?: () => void }) {
  const scope = JSON.stringify([unitId, descriptionEventId ?? null, token, actorId ?? null]), current = useRef(scope); current.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: string; job: StaffInventoryResearchJobWithReview | null; previews: Record<string, string>; recoveryEnabled: boolean } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retrying, setRetrying] = useState(false), [revision, setRevision] = useState(0);
  const job = snapshot?.scope === scope ? snapshot.job : null, previews = snapshot?.scope === scope ? snapshot.previews : {};
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null); setLoading(true); setError('');
    async function read() {
      try {
        const response = await fetch(`/api/v2/admin/inventory/research?unit_id=${encodeURIComponent(unitId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const value = await response.json();
        if (!response.ok || ![1, 2].includes(value.version) || !Array.isArray(value.jobs)) throw new Error();
        const next: StaffInventoryResearchJobWithReview | null = value.jobs.find((item: StaffInventoryResearchJobWithReview) => item.unit_id === unitId && (!descriptionEventId || item.description_event_id === descriptionEventId)) ?? null;
        if (next && (!['queued', 'running', 'complete', 'failed'].includes(next.status) || next.result !== null && (!StaffInventoryResearchResultSchema.safeParse(next.result).success || next.result.unit_id !== next.unit_id || next.result.description_event_id !== next.description_event_id || next.result.description_hash !== next.description_hash))) throw new Error();
        // This single-unit response must never fall back to the original AI value after staff review.
        if (value.version === 2 && (!next || next.status !== 'complete' || !next.review || !next.result_hash || next.review.revision < 1)) throw new Error();
        if (next?.review) {
          const review = StaffInventoryResearchReviewSnapshotSchema.parse(next.review);
          if (review.job_id !== next.job_id || review.unit_id !== next.unit_id || review.description_event_id !== next.description_event_id
            || review.input_hash !== next.input_hash || review.result_hash !== next.result_hash || !next.result
            || !projectStaffInventoryResearchReview(next.result, review, next.result_hash)) throw new Error();
        }
        if (value.recovery_enabled !== undefined && typeof value.recovery_enabled !== 'boolean') throw new Error();
        const recoveryEnabled = value.recovery_enabled === true;
        const recovery = next ? bindStaffInventoryResearchRecovery(next.recovery, next) : null;
        if (controller.signal.aborted) return;
        setSnapshot({ scope, job: next ? { ...next, recovery } : null, previews: value.image_previews && typeof value.image_previews === 'object' ? value.image_previews : {}, recoveryEnabled });
        setError(''); setLoading(false);
        if (next?.status === 'running' || next?.status === 'queued' && (!recovery || recovery.status === 'research_queued')
          || recovery && staffInventoryRecoveryDisplay(recovery, recoveryEnabled).active) timer = setTimeout(read, 15000);
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
  const result = job?.result, researching = job?.status === 'running' || job?.status === 'queued' && (!job.recovery || job.recovery.status === 'research_queued');
  const review = job?.review ?? null;
  const projection = job?.status === 'complete' && result && review && job.result_hash ? projectStaffInventoryResearchReview(result, review, job.result_hash) : null;
  const calculation = job?.status === 'complete' && result ? getStaffInventoryMarketCalculation(result, review, job.result_hash ?? undefined) : null;
  const recoveryEnabled = snapshot?.scope === scope && snapshot.recoveryEnabled === true;
  const recoveryDisplay = job?.recovery ? staffInventoryRecoveryDisplay(job.recovery, recoveryEnabled) : null;
  const reviewed = review?.decisions.length ?? 0, totalSelected = result?.selected_candidate_ids.length ?? 0;
  return <section className={styles.panel} aria-label="Card market research">
    <header><div><p className={styles.eyebrow}>SOLD COMPS · CARD RESEARCH</p><h3>Market research</h3></div><span className={styles.status}>{loading ? 'Loading' : researching ? job.status === 'running' ? 'Researching' : 'Queued' : calculation ? 'Updated' : recoveryDisplay?.label ?? (job?.status === 'failed' ? 'Needs attention' : result ? 'More evidence needed' : 'Not researched')}</span></header>
    {loading ? <p>Loading this card’s research…</p> : researching ? <p>We’re checking the card and recent eBay sales. You can keep adding inventory or close this page.</p> : !job ? <p>New individual cards receive automatic research after they are saved.</p> : job.status === 'failed' ? <p>{job.error?.message ?? 'This research attempt could not finish.'}</p> : null}
    {job?.recovery && <StaffInventoryResearchRecovery snapshot={job.recovery} enabled={recoveryEnabled} onEditDetails={onEditDetails} />}
    {result && <>
      <div className={styles.value}><div><span>eBay comp value · Research estimate</span><strong className={!calculation ? styles.unknownValue : undefined}>{calculation ? dollars(calculation.value_cents) : 'More evidence needed'}</strong></div>{calculation && <div className={styles.valueRange}><span>{calculation.count} {reviewed ? 'remaining sold comps' : 'AI-selected sold comps'}</span><p>{dollars(calculation.low_cents)}–{dollars(calculation.high_cents)}</p></div>}</div>
      {reviewed > 0 && <p className={styles.reviewStatus}>{reviewed === totalSelected ? 'Staff-reviewed selection' : 'Partially staff-reviewed'} · {reviewed} of {totalSelected} comps reviewed</p>}
      {result.estimate.status !== 'estimated' && <p>{result.estimate.reason}</p>}
      {actorId && review && job.result_hash && <StaffInventoryCompReview key={`${scope}:${job.job_id}:${job.input_hash}:${job.result_hash}`} actorId={actorId} token={token}
        binding={{ jobId: job.job_id, unitId, descriptionEventId: job.description_event_id, inputHash: job.input_hash, resultHash: job.result_hash }}
        result={result} review={review} previews={previews} photos={inventoryPhotos}
        onSaved={next => { if (current.current === scope) setSnapshot(previous => previous?.scope === scope && previous.job?.job_id === next.job_id ? { ...previous, job: { ...previous.job, review: next } } : previous); }}
        onConflict={() => { if (current.current === scope) setRevision(value => value + 1); }} />}
      <ValueCalculation result={result} calculation={calculation} projection={projection} />
      {result.photo_identity?.status === 'supported' && <div className={styles.identity} aria-label="Card matched from original photos"><span>Card matched from original photos</span><strong>{result.photo_identity.observations.find(observation => observation.field === 'treatment')?.value}</strong><p>{result.photo_identity.reason}</p><p>This is a private research match. Check the card, printing and condition against the selected listing photos.</p></div>}
      {result.photo_identity?.status === 'supported' && result.identity.status === 'unresolved'
        ? <details className={styles.disclosure}><summary>Catalog identity</summary><p>{result.identity.reason}</p><p>A missing catalog record does not prevent eBay searches. It is separate from the photo evidence used for this private research.</p></details>
        : <div className={styles.identity}><span>{result.identity.status === 'base' ? 'Base card' : result.identity.status === 'variant' ? 'Variant identified' : 'Catalog identity'}</span><strong>{result.identity.variant_name ?? result.identity.suggestion ?? 'Unresolved'}</strong><p>{result.identity.reason}</p></div>}
      <p className={styles.note}>Researched {new Date(result.researched_at).toLocaleDateString()}. Market estimates are separate from your cost and expected sale price.</p>
      <ResearchEvidence key={`${job.job_id}:${result.researched_at}`} result={result} previews={previews} calculation={calculation} projection={projection} />
    </>}
    {error && <p role="alert">{error}</p>}
    <footer>{!loading && !job && descriptionEventId && <button type="button" onClick={() => void startResearch()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research this card'}</button>}{job?.can_retry && <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research again'}</button>}{error && <button type="button" onClick={() => setRevision(value => value + 1)}>Refresh research</button>}</footer>
  </section>;
}
