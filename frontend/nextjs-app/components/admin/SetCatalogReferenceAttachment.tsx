import { useEffect, useRef, useState } from 'react';
import type { CatalogManifest } from '@tenkings/card-catalog-evidence';
import type { CatalogProposalDetail } from '../../lib/server/staffInventoryCatalogObservations';
export type CatalogReviewPacket = { manifest: CatalogManifest; reviewEvidence: unknown };
const button = 'rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
const field = 'mt-1 block w-full rounded bg-slate-900 p-2 text-sm';

/** Maps an explicit human choice into the loaded packet. The server only
 * prepares JSON; the existing full review remains the publication boundary. */
export default function SetCatalogReferenceAttachment({ token, detail, referenceReview, packet, onPrepared }: {
  token?: string; detail: CatalogProposalDetail; referenceReview: unknown; packet: CatalogReviewPacket | null;
  onPrepared: (packet: CatalogReviewPacket) => void;
}) {
  const [imageId, setImage] = useState(''), [cardId, setCard] = useState(''), [printingId, setPrinting] = useState('');
  const [represents, setRepresents] = useState<string[]>([]), [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [note, setNote] = useState(''), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setImage(''); setCard(''); setPrinting(''); setRepresents([]); setDiagnostics([]); setNote(''); setAccepted(false); setBusy(false); setError(''); return () => { generation.current++; }; }, [token, detail, referenceReview, packet]);
  if (!packet) return <p className="text-sm text-amber-200">Load an existing full catalog review packet below to attach this reference. Canonical card identities and supported printings must already be prepared from authoritative sources.</p>;
  const manifest = packet.manifest, proposal = JSON.parse(detail.canonicalProposalJson);
  const review = referenceReview as { proposalId?: string; submissionSha256?: string; submission?: { images?: { imageId: string; proposedPermission: unknown }[] } };
  if (review.proposalId !== detail.item.proposalId) return null;
  const printings = manifest.printings.filter(p => manifest.applicability.some(a => a.cardId === cardId && a.printingId === p.printingId && a.status === 'supported'));
  const features = manifest.printings.filter(p => represents.includes(p.printingId)).flatMap(p => p.diagnostics);
  const permission = review.submission?.images?.find(i => i.imageId === imageId)?.proposedPermission;
  async function prepare() {
    if (!packet || !token || busy || !accepted) return;
    const started = generation.current; setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/set-ops/catalog/reference-proposals', { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', proposalId: detail.item.proposalId, proposalSha256: detail.item.proposalSha256, submissionSha256: review.submissionSha256,
          packet, imageId, depicted: { cardId, printingId }, representsPrintingIds: represents, visibleDiagnosticIds: diagnostics, reviewNote: note.trim(), acknowledgement: 'PREPARE PHOTO FOR FULL CATALOG REVIEW' }) });
      const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024) throw new Error('Prepared packet exceeds its bound.');
      const value = JSON.parse(text); if (!response.ok || value.disposition !== 'requires_authorized_review' || !value.packet?.manifest || !value.packet?.reviewEvidence) throw new Error(value.message || 'Reference preparation failed.');
      if (started === generation.current) onPrepared(value.packet);
    } catch (e) { if (started === generation.current) setError(e instanceof Error ? e.message : 'Reference preparation failed.'); }
    finally { if (started === generation.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded border border-white/20 p-3" aria-label="Attach physical catalog reference">
    <h4 className="font-semibold">Prepare this photo for full review</h4>
    <p className="text-sm">Map the depicted card and printing in {manifest.set.label}. Representative finish scope is separate from the card pictured. This adds no card applicability and grants nothing until the complete packet is reviewed and published.</p>
    <label className="block text-sm">Submitted photo<select aria-label="Submitted photo" className={field} value={imageId} disabled={busy} onChange={e => { setImage(e.target.value); setAccepted(false); }}><option value="">Choose photo</option>{proposal.images.map((i: { imageId: string; role: string }) => <option key={i.imageId} value={i.imageId}>{i.role}</option>)}</select></label>
    <label className="block text-sm">Depicted card<select aria-label="Depicted card" className={field} value={cardId} disabled={busy} onChange={e => { setCard(e.target.value); setPrinting(''); setRepresents([]); setDiagnostics([]); setAccepted(false); }}><option value="">Choose existing card</option>{manifest.cards.map(c => <option key={c.cardId} value={c.cardId}>{c.number} · {c.name}</option>)}</select></label>
    <label className="block text-sm">Depicted printing<select aria-label="Depicted printing" className={field} value={printingId} disabled={busy || !cardId} onChange={e => { setPrinting(e.target.value); setRepresents(e.target.value ? [e.target.value] : []); setDiagnostics([]); setAccepted(false); }}><option value="">Choose supported printing</option>{printings.map(p => <option key={p.printingId} value={p.printingId}>{p.label} · {p.language ?? 'language unknown'} · {p.edition ?? 'edition unknown'}</option>)}</select></label>
    {printingId && <fieldset className="space-y-1 text-sm"><legend>Finish scope this photo can represent</legend>{manifest.printings.map(p => <label className="block" key={p.printingId}><input type="checkbox" disabled={busy} checked={represents.includes(p.printingId)} onChange={e => { setRepresents(old => e.target.checked ? [...old, p.printingId] : old.filter(id => id !== p.printingId)); setDiagnostics([]); setAccepted(false); }} /> {p.label} · {p.language ?? 'unknown language'}</label>)}</fieldset>}
    {features.length > 0 && <fieldset className="space-y-1 text-sm"><legend>Diagnostics actually visible in this photo</legend>{features.map(f => <label className="block" key={f.id}><input type="checkbox" disabled={busy} checked={diagnostics.includes(f.id)} onChange={e => { setDiagnostics(old => e.target.checked ? [...old, f.id] : old.filter(id => id !== f.id)); setAccepted(false); }} /> {f.description}</label>)}</fieldset>}
    {permission !== undefined && <div className="text-sm"><p>Proposed reuse permission to review:</p><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(permission, null, 2)}</pre></div>}
    <label className="block text-sm">Identity, finish and permission review note<textarea aria-label="Reference review note" className={field} maxLength={1000} disabled={busy} value={note} onChange={e => { setNote(e.target.value); setAccepted(false); }} /></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="Accept reference mapping for full review" disabled={busy || !imageId || !cardId || !printingId || !represents.length || !note.trim() || permission === undefined} checked={accepted} onChange={e => setAccepted(e.target.checked)} />I checked the depicted identity, representative scope, visible diagnostics and the proposed permission. Include this mapping and grant in the full packet for separate review.</label>
    <button type="button" className={button} disabled={busy || !token || !accepted} onClick={() => void prepare()}>Add photo to review packet</button>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
}
