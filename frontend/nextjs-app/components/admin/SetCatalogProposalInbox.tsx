import { useEffect, useRef, useState } from 'react';
import type { CatalogProposalDetail, CatalogProposalList, CatalogProposalListItem } from '../../lib/server/staffInventoryCatalogObservations';

type Props = { token?: string; canReview: boolean };
const endpoint = '/api/admin/set-ops/catalog/proposals';
const MAX_RESPONSE_BYTES = 1024 * 1024, MAX_EXPORT_BYTES = 3 * 1024 * 1024, MAX_SELECTED = 4;
const buttonClass = 'rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
function downloadJson(bytes: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

/** Selection prepares an explicit review packet. It never supplies a source
 * classification, media reuse permission or publication acknowledgement. */
export default function SetCatalogProposalInbox({ token, canReview }: Props) {
  const [producer, setProducer] = useState('');
  const [page, setPage] = useState<CatalogProposalList | null>(null);
  const [selected, setSelected] = useState<CatalogProposalDetail[]>([]);
  const [detail, setDetail] = useState<CatalogProposalDetail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef({ value: 0 });
  const authority = useRef({ token, canReview, producer });
  authority.current = { token, canReview, producer };
  useEffect(() => {
    const requests = generation.current;
    requests.value++; setPage(null); setSelected([]); setDetail(null); setBusy(false); setError(null);
    return () => { requests.value++; };
  }, [token, canReview, producer]);
  if (!canReview) return null;

  async function request<T>(params: Record<string, string>): Promise<T> {
    if (!token) throw new Error('Sign in with a current Set Ops reviewer session.');
    const response = await fetch(`${endpoint}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Proposal response exceeds the review limit.');
    const bytes = await response.text();
    if (new TextEncoder().encode(bytes).byteLength > MAX_RESPONSE_BYTES) throw new Error('Proposal response exceeds the review limit.');
    const value = JSON.parse(bytes);
    if (!response.ok) throw new Error(typeof value.message === 'string' ? value.message : 'Proposal review is unavailable.');
    return value as T;
  }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (busy || !token) return;
    const sequence = ++generation.current.value, captured = { token, canReview, producer };
    const current = () => sequence === generation.current.value && captured.token === authority.current.token
      && captured.canReview === authority.current.canReview && captured.producer === authority.current.producer;
    setBusy(true); setError(null);
    try { await action(current); }
    catch (problem) { if (current()) setError(problem instanceof Error ? problem.message : 'Proposal review is unavailable.'); }
    finally { if (current()) setBusy(false); }
  }
  const load = (cursor?: string) => perform(async current => {
    const result = await request<CatalogProposalList>({ ...(producer ? { producer } : {}), ...(cursor ? { cursor } : {}) });
    if (current()) { setPage(result); setDetail(null); }
  });
  const select = (item: CatalogProposalListItem) => perform(async current => {
    const result = await request<CatalogProposalDetail>({ proposalId: item.proposalId, proposalSha256: item.proposalSha256 });
    if (result.item.proposalId !== item.proposalId || result.item.proposalSha256 !== item.proposalSha256
      || result.reviewLink.proposalId !== item.proposalId || result.reviewLink.proposalSha256 !== item.proposalSha256
      || result.disposition !== 'requires_authorized_review') throw new Error('The selected immutable proposal could not be verified.');
    if (current()) {
      setDetail(result);
      setSelected(previous => previous.some(p => p.item.proposalId === item.proposalId) ? previous : previous.length < MAX_SELECTED ? [...previous, result] : previous);
    }
  });
  function exportSelection() {
    try {
      const packet = { schemaVersion: 'catalog-proposal-review-export/v1', disposition: 'requires_authorized_review',
        proposals: selected.map(p => ({ proposalId: p.item.proposalId, proposalSha256: p.item.proposalSha256,
          canonicalProposalJson: p.canonicalProposalJson })),
        reviewEvidence: { observations: selected.map(p => ({ ...p.reviewLink, sourceIds: [], reviewNote: '' })) } };
      const bytes = JSON.stringify(packet, null, 2);
      if (new TextEncoder().encode(bytes).byteLength > MAX_EXPORT_BYTES) throw new Error('Select fewer proposals to keep the export below 3 MiB.');
      downloadJson(bytes, 'tenkings-unreviewed-observations.json');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Proposal export failed.'); }
  }

  return <section className="space-y-4 rounded-xl border border-white/15 bg-black/20 p-4" aria-label="Catalog observation proposal inbox">
    <div><h3 className="font-semibold">Observation inbox</h3>
      <p className="mt-1 text-sm text-slate-300">Each proposal is an unreviewed contribution. Identity can be uncertain; selection grants no catalog authority or permission to reuse photos.</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Producer <select aria-label="Proposal producer" className="ml-2 rounded bg-slate-900 p-2" value={producer} onChange={event => setProducer(event.target.value)}>
        <option value="">All producers</option><option value="inventory">Inventory</option><option value="atlas">Atlas</option>
      </select></label>
      <button type="button" className={buttonClass} disabled={busy || !token} onClick={() => void load()}>Load proposals</button>
      <button type="button" className={buttonClass} disabled={busy || !page?.nextCursor} onClick={() => void load(page!.nextCursor!)}>Next page</button>
      <button type="button" className={buttonClass} disabled={busy || !selected.length} onClick={exportSelection}>Export selected proposals</button>
      <span className="text-xs text-slate-400">{selected.length}/{MAX_SELECTED} selected</span>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {page && <p className="text-xs text-slate-400">{page.items.length} proposals on this page.{page.unavailableCount > 0 && ` ${page.unavailableCount} unavailable proposals were excluded because their integrity or size could not be verified.`}</p>}
    <ul className="space-y-3">{page?.items.map(item => {
      const isSelected = selected.some(p => p.item.proposalId === item.proposalId);
      return <li key={`${item.proposalId}:${item.proposalSha256}`} className="space-y-2 rounded border border-white/10 p-3">
        <p className="font-medium">{item.identity.name ?? 'Unidentified card'} · {item.identity.setLabel ?? 'Unconfirmed set'} <span className="text-xs uppercase text-slate-400">{item.producer}</span></p>
        <p className="text-sm text-slate-300">{item.note}</p>
        <p className="break-all text-xs text-slate-400">SHA-256: {item.proposalSha256}<br />Observed {item.observedAt} · {item.sourceCount} source records · {item.imageCount} unreviewed image records</p>
        <button type="button" className={buttonClass} disabled={busy || (!isSelected && selected.length >= MAX_SELECTED)} onClick={() => void select(item)}>{isSelected ? 'Inspect selected proposal' : 'Select exact proposal'}</button>
      </li>;
    })}</ul>
    {selected.length > 0 && <div className="space-y-2 text-sm"><p>Selected proposals stay pinned to their exact hashes across pages.</p>
      {selected.map(proposal => <button key={proposal.item.proposalId} type="button" disabled={busy} className={`${buttonClass} mr-2`} onClick={() => {
        setSelected(previous => previous.filter(p => p.item.proposalId !== proposal.item.proposalId));
        if (detail?.item.proposalId === proposal.item.proposalId) setDetail(null);
      }}>Remove {proposal.item.identity.name ?? proposal.item.proposalId}</button>)}
      <p className="text-xs text-slate-400">Export contains exact proposal JSON and an incomplete review-link template. Prepare explicit source mappings, review notes and reuse permissions before a fresh full catalog review.</p>
    </div>}
    {detail && <details open className="space-y-2"><summary className="cursor-pointer text-sm">Exact immutable proposal</summary>
      <button type="button" className={buttonClass} onClick={() => downloadJson(detail.canonicalProposalJson, `proposal-${detail.item.proposalId}-${detail.item.proposalSha256}.json`)}>Download exact proposal JSON</button>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-3 text-xs">{detail.canonicalProposalJson}</pre>
    </details>}
  </section>;
}
