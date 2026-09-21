import { useEffect, useRef, useState } from 'react';

const setKey = '2023_Bowman_University_Chrome_Football';
const endpoint = '/api/admin/set-ops/catalog/sports-preparation';
const storageKey = 'tenkings:pending-sports-catalog-preparation:v1';
const rejectedKey = `${storageKey}:last-rejected`;
type Preview = { schemaVersion: 'setops-sports-additive-preparation-preview/v1'; proposalSha256: string; snapshotSha256: string;
  creates: { pendingJobs: number; sources: number; parallels: number; scopes: number } };
type Request = { schemaVersion: 'setops-sports-additive-preparation-request/v1'; idempotencyKey: string;
  expectedSnapshotSha256: string; proposalSha256: string; acknowledgement: 'PREPARE PENDING SPORTS CATALOG MAPPINGS' };
const button = 'rounded-lg border border-white/25 px-3 py-2 text-sm disabled:opacity-40';
class PreparationRequestError extends Error {
  constructor(message: string, readonly status: number, readonly response: Record<string, unknown>) { super(message); }
}

/** Pending request contains hashes and a retry key, never an access token or
 * source bytes. The server binds replay to the original human reviewer. */
export default function SetCatalogSportsPreparation({ token, setId, canReview }: { token?: string; setId: string; canReview: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null), [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [receipt, setReceipt] = useState<unknown>(null);
  const generation = useRef(0), inFlight = useRef(false), retained = useRef<string | null>(null);
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++; inFlight.current = false; retained.current = null;
    setBusy(false); setPreview(null); setReceipt(null); setMessage(''); setPending(null);
    if (setId !== setKey) return () => { lifecycle.current++; };
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) { retained.current = saved; setPending(saved); setMessage('A preparation request is awaiting confirmation. Retry it with the original reviewer account.'); }
    } catch { setMessage('This browser cannot preserve a preparation request. Enable session storage before preparing mappings.'); }
    return () => { lifecycle.current++; };
  }, [token, setId]);

  if (setId !== setKey) return null;
  async function request(body?: string) {
    const response = await fetch(endpoint, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
    const data = await response.json();
    if (!response.ok) throw new PreparationRequestError(data.message || 'Catalog preparation could not be confirmed.', response.status, data);
    return data;
  }
  async function run(action: (active: () => boolean) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const started = generation.current, active = () => started === generation.current;
    try { await action(active); }
    catch (error) { if (active()) setMessage(error instanceof Error ? error.message : 'Catalog preparation could not be confirmed.'); }
    finally { if (active()) { inFlight.current = false; setBusy(false); } }
  }
  async function stage(active: () => boolean) {
    let bytes = retained.current;
    if (!bytes) {
      if (!preview) return;
      const payload: Request = { schemaVersion: 'setops-sports-additive-preparation-request/v1', idempotencyKey: crypto.randomUUID(),
        expectedSnapshotSha256: preview.snapshotSha256, proposalSha256: preview.proposalSha256,
        acknowledgement: 'PREPARE PENDING SPORTS CATALOG MAPPINGS' };
      bytes = JSON.stringify({ action: 'stage', request: payload });
      // Save exact request bytes before dispatch. An uncertain response must
      // replay the same idempotency key, including after a page reload.
      sessionStorage.setItem(storageKey, bytes);
      retained.current = bytes; setPending(bytes);
    }
    const expected = JSON.parse(bytes).request as Request;
    let result;
    try { result = await request(bytes); }
    catch (error) {
      if (active() && error instanceof PreparationRequestError && error.status === 409
        && error.response.code === 'SPORTS_PREPARATION_SNAPSHOT_STALE'
        && error.response.idempotencyKey === expected.idempotencyKey
        && error.response.expectedSnapshotSha256 === expected.expectedSnapshotSha256) {
        // This exact attempt was rejected before creates. Preserve its bytes
        // for reconciliation, then allow a fresh deliberate preview/action.
        sessionStorage.setItem(rejectedKey, bytes);
        sessionStorage.removeItem(storageKey);
        retained.current = null; setPending(null); setPreview(null);
        setMessage('The catalog changed before preparation. No mappings were added by this attempt. Preview the current mappings again.');
        return;
      }
      throw error;
    }
    if (!active()) return;
    if (!['recorded', 'replay'].includes(result.outcome)
      || result.receipt?.schemaVersion !== 'setops-sports-additive-preparation-receipt/v1'
      || result.receipt.baselineSha256 !== expected.expectedSnapshotSha256 || result.receipt.proposalSha256 !== expected.proposalSha256
      || !/^[a-f0-9]{64}$/.test(result.receiptSha256)) {
      throw new Error('The server response did not confirm preparation. Keep this request and retry.');
    }
    sessionStorage.removeItem(storageKey);
    retained.current = null; setPending(null); setPreview(null); setReceipt(result);
    setMessage('Pending mappings prepared. Download the receipt and the fresh taxonomy mapping to prepare the separate catalog review.');
  }
  return <section className="my-4 rounded-xl border border-white/15 bg-black/20 p-4">
    <h3 className="font-semibold">Prepare the Bowman University sports pilot</h3>
    <p className="my-2 text-sm text-slate-300">Stage the pinned checklist and Round 2 odds files above, then preview the missing mappings. Existing card identities are preserved. Source evidence stays pending until the separate catalog review.</p>
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || !!pending || !token || !canReview} onClick={() => void run(async active => {
        setPreview(null);
        const result = await request();
        if (result.schemaVersion !== 'setops-sports-additive-preparation-preview/v1'
          || !/^[a-f0-9]{64}$/.test(result.snapshotSha256) || !/^[a-f0-9]{64}$/.test(result.proposalSha256)
          || result.creates?.sources !== 2 || result.creates?.parallels !== 3 || result.creates?.scopes !== 3 || result.creates?.pendingJobs !== 2) throw new Error('Invalid preparation preview.');
        if (active()) { setPreview(result); setReceipt(null); }
      })}>Preview missing mappings</button>
      <button className={button} disabled={busy || (!pending && !preview) || !token || !canReview} onClick={() => void run(stage)}>
        {pending ? 'Retry same preparation' : 'Prepare pending mappings'}
      </button>
      {receipt !== null && <button className={button} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'sports-catalog-preparation-receipt.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download preparation receipt</button>}
    </div>
    {preview && <p className="mt-3 text-sm">Adds {preview.creates.sources} sources, {preview.creates.parallels} parallel definitions and {preview.creates.scopes} program scopes, with {preview.creates.pendingJobs} pending source records. All nine card-to-printing relationships remain unknown.</p>}
    {message && <p role="status" className="mt-3 whitespace-pre-wrap text-sm text-amber-200">{message}</p>}
  </section>;
}
