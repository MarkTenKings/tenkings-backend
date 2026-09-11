/* eslint-disable @next/next/no-img-element -- Private, expiring evidence previews must bypass the shared image optimizer. */
import { useEffect, useState } from 'react';
import type { StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { StaffInventoryResearchResultSchema } from '../../lib/staffInventoryResearch';
import styles from './StaffInventoryResearchPanel.module.css';

const dollars = (cents: number | null) => cents === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export default function StaffInventoryResearchPanel({ unitId, token, descriptionEventId }: { unitId: string; token: string; descriptionEventId?: string | null }) {
  const [job, setJob] = useState<StaffInventoryResearchStatusV2 | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retrying, setRetrying] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setJob(null); setLoading(true); setError(''); setPreviews({});
    async function read() {
      try {
        const response = await fetch(`/api/v2/admin/inventory/research?unit_id=${encodeURIComponent(unitId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const value = await response.json();
        if (!response.ok || value.version !== 1 || !Array.isArray(value.jobs)) throw new Error();
        const next = value.jobs.find((item: StaffInventoryResearchStatusV2) => item.unit_id === unitId && (!descriptionEventId || item.description_event_id === descriptionEventId)) ?? null;
        if (next && (!['queued', 'running', 'complete', 'failed'].includes(next.status) || next.result !== null && !StaffInventoryResearchResultSchema.safeParse(next.result).success)) throw new Error();
        if (controller.signal.aborted) return;
        setJob(next); setError(''); setLoading(false);
        setPreviews(value.image_previews && typeof value.image_previews === 'object' ? value.image_previews : {});
        if (next?.status === 'queued' || next?.status === 'running') timer = setTimeout(read, 15000);
      } catch {
        if (!controller.signal.aborted) { setLoading(false); setError('Research is temporarily unavailable. Your inventory is saved.'); }
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [unitId, token, descriptionEventId, revision]);
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
      <div className={styles.value}><div><span>Estimated market value</span><strong>{dollars(result.estimate.value_cents)}</strong></div><div><span>{result.estimate.count ? `${result.estimate.count} matched sales` : 'No verified value yet'}</span>{result.estimate.status === 'estimated' && <p>{dollars(result.estimate.low_cents)}–{dollars(result.estimate.high_cents)}</p>}</div></div>
      <p>{result.estimate.reason}</p>
      <div className={styles.identity}><span>{result.identity.status === 'base' ? 'Base card' : result.identity.status === 'variant' ? 'Variant identified' : 'Variant check'}</span><strong>{result.identity.variant_name ?? result.identity.suggestion ?? 'Unresolved'}</strong><p>{result.identity.reason}</p></div>
      <p className={styles.note}>Researched {new Date(result.researched_at).toLocaleDateString()}. Market estimates are separate from your cost and expected sale price.</p>
      <details><summary>Sales &amp; supporting evidence ({result.candidates.length})</summary>
        {result.candidates.length === 0 && <p>No usable sold listings were returned.</p>}
        <div className={styles.comps}>{result.candidates.map(candidate => {
          const selected = result.selected_candidate_ids.includes(candidate.id), image = candidate.image?.storage_key ? previews[candidate.image.storage_key] : null;
          return <article key={candidate.id}>{image && <img src={image} alt="Saved eBay listing evidence" loading="lazy" referrerPolicy="no-referrer" />}<div><a href={candidate.listing_url} target="_blank" rel="noreferrer">{candidate.title}</a><strong>{dollars(candidate.sold_price_cents)} <small>{candidate.sold_date ?? 'Sale date unavailable'}</small></strong><p>{selected ? 'Included in estimate' : result.rejections.find(item => item.candidate_id === candidate.id)?.reason ?? candidate.exclusion_reason ?? 'Not included'}</p></div></article>;
        })}</div>
        {result.references.length > 0 && <><h4>Catalog references</h4><ul>{result.references.map(reference => <li key={reference.id}>{reference.source_url ? <a href={reference.source_url} target="_blank" rel="noreferrer">{reference.identity.set_name} · {reference.variant_name}</a> : `${reference.identity.set_name} · ${reference.variant_name} · Reviewed Ten Kings catalog`}</li>)}</ul></>}
        {result.warnings.length > 0 && <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      </details>
    </>}
    {error && <p role="alert">{error}</p>}
    <footer>{!loading && !job && descriptionEventId && <button type="button" onClick={() => void startResearch()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research this card'}</button>}{job?.can_retry && <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? 'Requesting…' : 'Research again'}</button>}{error && <button type="button" onClick={() => setRevision(value => value + 1)}>Refresh research</button>}</footer>
  </section>;
}
