import { useEffect, useRef, useState } from 'react';
import type { CatalogDemand, CatalogDemandResult } from '@tenkings/card-catalog-evidence';

type Item = { demandKey: string; demand: CatalogDemand; state: string; attempt: number; snapshotHash: string | null; createdAt: string };
const endpoint = '/api/admin/set-ops/catalog/demands';
const button = 'rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

/** A reviewer can export immutable preparations and exact source bytes. This
 * component has no mutation/publication action and cannot replace a set draft. */
export default function SetCatalogDemandInbox({ token, canReview }: { token?: string; canReview: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null), [detail, setDetail] = useState<CatalogDemandResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), authority = useRef({ token, canReview }); authority.current = { token, canReview };
  useEffect(() => { generation.current++; setItems(null); setDetail(null); setBusy(false); setError(null); return () => { generation.current++; }; }, [token, canReview]);
  if (!canReview) return null;
  async function perform(work: (current: () => boolean) => Promise<void>) {
    if (!token || busy) return;
    const sequence = ++generation.current, current = () => generation.current === sequence && authority.current.token === token && authority.current.canReview;
    setBusy(true); setError(null);
    try { await work(current); } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'Prepared sources unavailable.'); }
    finally { if (current()) setBusy(false); }
  }
  async function request(params: Record<string, string>) {
    const response = await fetch(`${endpoint}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('Prepared sources exceed the review limit.');
    const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024) throw new Error('Prepared sources exceed the review limit.');
    const value = JSON.parse(text); if (!response.ok || value.disposition !== 'requires_authorized_review') throw new Error('Prepared sources unavailable.'); return value;
  }
  const load = () => perform(async current => { const result = await request({}); if (current()) { setItems(result.items); setDetail(null); } });
  const select = (item: Item) => perform(async current => {
    if (!item.snapshotHash) return;
    const value = await request({ demandKey: item.demandKey, snapshotHash: item.snapshotHash });
    if (value.result?.demandKey !== item.demandKey || value.result?.snapshotHash !== item.snapshotHash) throw new Error('Preparation revision changed.');
    if (current()) setDetail(value.result);
  });
  const source = (sourceId: string, sha256: string) => perform(async current => {
    if (!detail) return;
    const response = await fetch(`${endpoint}?${new URLSearchParams({ demandKey: detail.demandKey, snapshotHash: detail.snapshotHash, sourceId })}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok || response.headers.get('x-catalog-source-sha256') !== sha256 || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Source download unavailable.');
    const bytes = await response.arrayBuffer(); if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Source exceeds its bound.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== sha256) throw new Error('Source checksum mismatch.');
    if (current()) download(new Blob([bytes]), `catalog-source-${sha256}.bin`);
  });
  return <section aria-label="Prepared catalog sources" className="space-y-3 rounded-xl border border-white/15 bg-black/20 p-4">
    <div><h3 className="font-semibold">Prepared set references</h3><p className="mt-1 text-sm text-slate-300">First-seen sets can accumulate source evidence here. These are unreviewed preparations; program parallel lists do not prove card applicability, and they contain no approved reference photos.</p></div>
    <button type="button" className={button} disabled={busy || !token} onClick={() => void load()}>Load prepared sets</button>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {items?.length === 0 && <p className="text-sm text-slate-400">No sets have been prepared yet.</p>}
    <ul className="space-y-2">{items?.map(item => <li key={item.demandKey} className="rounded border border-white/10 p-3 text-sm">
      <span>{item.demand.year} {item.demand.manufacturer} {item.demand.setName} · {item.state.toLowerCase()} · attempt {item.attempt}/3</span>
      <button type="button" className={`${button} ml-3`} disabled={busy || !item.snapshotHash} onClick={() => void select(item)}>Inspect preparation</button>
    </li>)}</ul>
    {detail && <div className="space-y-2 text-sm">
      <p>{detail.choices.length} exact source rows · {detail.context.length} program-level parallel rows · coverage {detail.coverage}</p>
      <p className="text-slate-300">Export and map the evidence into an isolated catalog preparation. Verify exact card applicability, language and image permissions, then use the existing full-manifest human review. Approved sets remain unchanged.</p>
      <button type="button" className={button} onClick={() => download(new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' }), `unreviewed-catalog-demand-${detail.snapshotHash}.json`)}>Download preparation JSON</button>
      {detail.sources.map(item => <div key={item.sourceId} className="space-y-1 rounded border border-white/10 p-2">
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="break-all underline">{item.url}</a>
        <p className="break-all text-xs text-slate-400">Source SHA-256: {item.sha256}</p>
        <button type="button" className={button} disabled={busy} onClick={() => void source(item.sourceId, item.sha256)}>Download exact source bytes</button>
      </div>)}
    </div>}
  </section>;
}
