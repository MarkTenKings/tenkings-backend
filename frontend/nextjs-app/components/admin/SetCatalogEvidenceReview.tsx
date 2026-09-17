import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { CatalogManifest, PublicationPin } from '@tenkings/card-catalog-evidence';
import SetCatalogProposalInbox from './SetCatalogProposalInbox';

type ReviewPacket = { manifest: CatalogManifest; reviewEvidence: unknown };
type Preview = { manifest: CatalogManifest; manifestSha256: string; verificationSha256: string; verification: unknown;
  expectedCurrent: PublicationPin | null; expectedHistory: PublicationPin | null; previousManifest: unknown;
  excerpts: { sourceId: string; text: string | null }[] };
type ReviewImage = { url: string; status: 'loading' | 'loaded' | 'failed' };
const endpoint = '/api/admin/set-ops/catalog';
const panel = 'rounded-xl border border-white/15 bg-black/20 p-4';
const button = 'rounded-lg border border-white/25 px-3 py-2 text-sm disabled:opacity-40';
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** Explicit human review only. The legacy draft Approve action does not mount or
 * submit this publication request, and file loading never publishes. */
export default function SetCatalogEvidenceReview({ token, setId, canReview, canApprove }: {
  token?: string; setId: string; canReview: boolean; canApprove: boolean;
}) {
  const [packet, setPacket] = useState<ReviewPacket | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [current, setCurrent] = useState<PublicationPin | null>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [reason, setReason] = useState('');
  const [imageReview, setImageReview] = useState<{ preview: Preview | null; token?: string; images: Record<string, ReviewImage> }>({ preview: null, images: {} });
  const images = imageReview.preview === preview && imageReview.token === token ? imageReview.images : {};
  const activeImages = useRef({ preview, token, images }); activeImages.current = { preview, token, images };
  const generation = useRef(0);
  useEffect(() => { generation.current++; setPacket(null); setPreview(null); setCurrent(null); setReviewed(false); setMessage(''); setReason(''); setBusy(false); }, [token, setId]);
  async function api(path: string, body?: unknown) {
    const response = await fetch(`${endpoint}/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token ?? ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Catalog request failed.');
    return data;
  }
  async function run(action: (guard: () => boolean) => Promise<void>) {
    const started = generation.current; setBusy(true); setMessage('');
    const active = () => started === generation.current;
    try { await action(active); } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : 'Catalog request failed.'); }
    finally { if (active()) setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false; const urls: string[] = []; setImageReview({ preview, token, images: {} }); setReviewed(false);
    if (preview && token) void (async () => {
      for (const image of preview.manifest.images) {
        try {
          const response = await fetch(`${endpoint}/media?ref=${encodeURIComponent(image.mediaRef)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) throw new Error('A reviewed image could not be loaded.');
          const bytes = await response.arrayBuffer(); if (cancelled) return;
          const url = URL.createObjectURL(new Blob([bytes], { type: image.mimeType })); urls.push(url);
          setImageReview(old => old.preview === preview && old.token === token
            ? { ...old, images: { ...old.images, [image.imageId]: { url, status: 'loading' } } } : old);
        } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Image unavailable.'); }
      }
    })();
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [preview, token]);
  const allImagesLoaded = !preview || preview.manifest.images.every(image => images[image.imageId]?.status === 'loaded');
  function imageRendered(imageId: string, url: string, loaded: boolean) {
    if (activeImages.current.preview !== preview || activeImages.current.token !== token || activeImages.current.images[imageId]?.url !== url) return;
    setImageReview(old => old.preview === preview && old.token === token && old.images[imageId]?.url === url
      ? { ...old, images: { ...old.images, [imageId]: { url, status: loaded ? 'loaded' : 'failed' } } } : old);
    if (!loaded) { setReviewed(false); setMessage('A reviewed image could not be displayed. Load and validate the packet again before publishing.'); }
  }

  return <details className={panel}>
    <summary className="cursor-pointer font-semibold text-white">Reviewed shared catalog evidence</summary>
    <p className="my-3 text-sm text-slate-300">Prepare a clean, approved SetOps draft first. This separate review publishes the complete identity, applicability, source and image evidence. Private review artifacts stay internal. Missing image coverage stays unknown.</p>
    <SetCatalogProposalInbox token={token} canReview={canReview} />
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || !setId || !canReview || !token} onClick={() => void run(async active => {
        const result = await api(`taxonomy?setId=${encodeURIComponent(setId)}`);
        if (!active()) return;
        const url = URL.createObjectURL(new Blob([pretty(result)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'setops-catalog-taxonomy.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage('Taxonomy mapping downloaded for preparation. This snapshot does not approve evidence or grant reuse rights.');
      })}>Download taxonomy mapping</button>
      <label className={button}>Load review packet JSON<input className="mt-2 block max-w-full text-xs" type="file" accept="application/json,.json" disabled={busy || !canReview || !token}
        onChange={event => { const file = event.target.files?.[0]; if (!file) return; void run(async active => {
          if (file.size > 3 * 1024 * 1024) throw new Error('Review packet exceeds 3 MiB.');
          const value = JSON.parse(await file.text());
          if (!value?.manifest || !value?.reviewEvidence || Object.keys(value).some(k => !['manifest', 'reviewEvidence'].includes(k))) throw new Error('Packet needs exactly manifest and reviewEvidence.');
          if (setId && value.manifest.set?.setId !== setId) throw new Error('Packet belongs to a different selected set.');
          if (active()) { setPacket(value); setPreview(null); setReviewed(false); setMessage('Packet loaded. Stage its exact source/image files, then validate.'); }
        }); }} /></label>
      <label className={button}>Stage source / image files<input className="mt-2 block max-w-full text-xs" type="file" multiple disabled={busy || !canReview || !token}
        onChange={event => { const files = Array.from(event.target.files ?? []); if (!files.length) return; void run(async active => {
          const staged: string[] = [];
          for (const file of files) {
            if (!active()) return;
            if (!file.size || file.size > 3 * 1024 * 1024) throw new Error('Each uploaded artifact must contain 1 byte to 3 MiB.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
            let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            const result = await api('media', { sha256, bytesBase64: btoa(binary) }); staged.push(`${file.name}: ${result.ref}`);
          }
          if (active()) setMessage(staged.join('\n'));
        }); }} /></label>
      <button className={button} disabled={busy || !packet || !canReview} onClick={() => void run(async active => {
        const result = await api('preview', packet); if (active()) { setPreview(result); setReviewed(false); setCurrent(result.expectedCurrent); }
      })}>Validate and prepare full review</button>
      <button className={button} disabled={busy || !setId || !canReview} onClick={() => void run(async active => {
        const result = await api(`publication?setId=${encodeURIComponent(setId)}`); if (active()) { setCurrent(result.publication); setMessage(result.publication ? 'Current publication loaded.' : 'No usable current publication.'); }
      })}>Load current publication</button>
    </div>
    {message && <p role="status" className="my-3 whitespace-pre-wrap break-all text-sm text-amber-200">{message}</p>}
    {preview && <div className="mt-4 space-y-4">
      <h3 className="font-semibold">{preview.manifest.set.label} · revision {preview.manifest.revision}</h3>
      <p className="break-all text-xs text-slate-400">Complete manifest SHA-256: {preview.manifestSha256}<br />Verification SHA-256: {preview.verificationSha256}</p>
      <div className="grid gap-3 md:grid-cols-3">{Object.entries(preview.manifest.coverage).map(([key, value]) => <div className={panel} key={key}><strong>{key}: {value.status}</strong><p className="text-sm">{value.detail}</p></div>)}</div>
      <section className={panel}><h4 className="font-semibold">Original source evidence</h4>{preview.manifest.sources.map(source => <div key={source.sourceId} className="my-3 border-b border-white/10 pb-3">
        <p className="break-all">{source.sourceId} · {source.kind} · {source.sha256}</p><p className="break-all text-xs">{source.sourceUrl ?? 'No source URL recorded'} · roots: {source.originKeys.join(', ')}</p>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs">{preview.excerpts.find(e => e.sourceId === source.sourceId)?.text ?? 'Binary source: download and inspect the complete original.'}</pre>
        <button className={button} disabled={busy} onClick={() => void run(async () => {
          const response = await fetch(`${endpoint}/media?ref=${encodeURIComponent(source.sourceRef)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) throw new Error('Source download failed.');
          const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `catalog-source-${source.sha256}.bin`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        })}>Download full source</button>
      </div>)}</section>
      {(['set', 'programs', 'cards', 'printings', 'applicability', 'aliases'] as const).map(key => <details key={key} open className={panel}><summary className="font-semibold capitalize">{key} — complete proposed content</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{pretty(preview.manifest[key])}</pre></details>)}
      <section className={panel}><h4 className="font-semibold">Image identity and representative scope</h4>{preview.manifest.images.length === 0 && <p>No images proposed. This does not prove visual coverage.</p>}{preview.manifest.images.map(image => <div key={image.imageId} className="my-4 grid gap-3 md:grid-cols-2">
        {images[image.imageId] ? <div><Image key={images[image.imageId].url} unoptimized src={images[image.imageId].url} width={image.width} height={image.height} alt={`Review evidence ${image.imageId}`} className="h-auto max-h-96 w-auto max-w-full object-contain"
          onLoad={event => imageRendered(image.imageId, images[image.imageId].url, event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0)}
          onError={() => imageRendered(image.imageId, images[image.imageId].url, false)} />
          {images[image.imageId].status === 'failed' && <p role="alert">Image could not be displayed. Publication is blocked.</p>}
        </div> : <p>Loading exact reviewed bytes…</p>}
        <div><p className="text-sm font-semibold">The depicted card can differ from a card using this representative finish.</p><pre className="overflow-auto whitespace-pre-wrap text-xs">{pretty(image)}</pre></div>
      </div>)}</section>
      <details open className={panel}><summary>Source classification, fact use and image reuse grants</summary>
        <p className="my-2 text-sm">Source fact use identifies the catalog facts and apps being reviewed. It does not claim image ownership or authorize source-file distribution. Review image grants separately; existing source grants retain their recorded scope.</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{pretty(preview.verification)}</pre></details>
      <details className={panel}><summary>Previous immutable manifest for comparison</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{pretty(preview.previousManifest)}</pre></details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !canApprove || !allImagesLoaded} onChange={event => setReviewed(event.target.checked)} />I reviewed the complete identities, aliases, applicability and unknowns, original sources, intended fact use or recorded source grants, and image identities, diagnostics and reuse grants.</label>
      <button className={button} disabled={busy || !canApprove || !reviewed || !allImagesLoaded} onClick={() => void run(async active => {
        const result = await api('publication', { action: 'publish', manifest: preview.manifest, reviewEvidence: packet?.reviewEvidence,
          manifestSha256: preview.manifestSha256, verificationSha256: preview.verificationSha256, expectedCurrent: preview.expectedCurrent,
          expectedHistory: preview.expectedHistory, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' });
        if (active()) { setCurrent(result.current ? result.publication : null); setMessage(result.current ? `Reviewed revision ${result.publication.revision} published (${result.outcome}).` : 'This exact review was already recorded; its publication is no longer current.'); setReviewed(false); }
      })}>Publish reviewed catalog evidence</button>
    </div>}
    {current && <section className={`${panel} mt-4`}><p className="break-all text-sm">Current publication: {current.publicationId} · revision {current.revision}</p>
      <label className="mt-3 block text-sm">Reason to revoke this exact publication<input className="mt-1 block w-full rounded bg-white/10 p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy || !canApprove} /></label>
      <button className={`${button} mt-2`} disabled={busy || !canApprove || !reason.trim()} onClick={() => void run(async active => {
        await api('publication', { action: 'revoke', publication: current, reason });
        if (active()) { setCurrent(null); setReviewed(false); setMessage('Publication revoked. Immutable review and prior evidence remain retained.'); }
      })}>Revoke current publication</button>
    </section>}
  </details>;
}
