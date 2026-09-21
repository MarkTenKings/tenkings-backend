import { useEffect, useRef, useState } from 'react';

const setKey = 'Black & White-Legendary Treasures';
const endpoint = '/api/admin/set-ops/catalog/pokemon-preparation';
const storageKey = 'tenkings:pending-pokemon-catalog-preparation:v1';
const rejectedKey = `${storageKey}:last-rejected`;
type Binding = { draftId: string; draftVersionId: string; ingestionJobId: string; sourceId: string; programRowId: string };
const validBinding = (value: unknown): value is Binding => !!value && typeof value === 'object'
  && Object.keys(value).sort().join(',') === 'draftId,draftVersionId,ingestionJobId,programRowId,sourceId'
  && Object.values(value).every(id => typeof id === 'string' && id.length > 0 && id.length <= 256);
const sameBinding = (a: Binding, b: Binding) => validBinding(a) && Object.keys(a).every(key => a[key as keyof Binding] === b[key as keyof Binding]);
type Preview = { schemaVersion: 'setops-pokemon-additive-preparation-preview/v1'; proposalSha256: string; snapshotSha256: string;
  binding: Binding; creates: { parallels: number; scopes: number }; preservedCards: number; applicability: string };
type Request = { schemaVersion: 'setops-pokemon-additive-preparation-request/v1'; idempotencyKey: string;
  expectedSnapshotSha256: string; proposalSha256: string; binding: Binding; acknowledgement: 'PREPARE PENDING POKEMON CATALOG MAPPINGS' };
const button = 'rounded-lg border border-white/25 px-3 py-2 text-sm disabled:opacity-40';
class PreparationRequestError extends Error {
  constructor(message: string, readonly status: number, readonly response: Record<string, unknown>) { super(message); }
}

/** Pending request contains hashes and a retry key, never an access token or
 * source bytes. The server binds replay to the original human reviewer. */
export default function SetCatalogPokemonPreparation({ token, setId, canReview }: { token?: string; setId: string; canReview: boolean }) {
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
      const payload: Request = { schemaVersion: 'setops-pokemon-additive-preparation-request/v1', idempotencyKey: crypto.randomUUID(),
        expectedSnapshotSha256: preview.snapshotSha256, proposalSha256: preview.proposalSha256, binding: preview.binding,
        acknowledgement: 'PREPARE PENDING POKEMON CATALOG MAPPINGS' };
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
        && error.response.code === 'POKEMON_PREPARATION_SNAPSHOT_STALE'
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
      || result.receipt?.schemaVersion !== 'setops-pokemon-additive-preparation-receipt/v1'
      || result.receipt.baselineSha256 !== expected.expectedSnapshotSha256 || result.receipt.proposalSha256 !== expected.proposalSha256
      || result.receipt.idempotencyKey !== expected.idempotencyKey || !sameBinding(result.receipt.binding, expected.binding)
      || result.receipt.preservedCards !== 138 || result.receipt.applicability !== 'unknown' || result.receipt.approved !== false || result.receipt.publication !== null
      || !/^[a-f0-9]{64}$/.test(result.receiptSha256)) {
      throw new Error('The server response did not confirm preparation. Keep this request and retry.');
    }
    sessionStorage.removeItem(storageKey);
    retained.current = null; setPending(null); setPreview(null); setReceipt(result);
    setMessage('Pending mappings prepared. Download the receipt and the fresh taxonomy mapping to prepare the separate catalog review.');
  }
  return <section className="my-4 rounded-xl border border-white/15 bg-black/20 p-4">
    <h3 className="font-semibold">Prepare the Legendary Treasures Pokémon pilot</h3>
    <p className="my-2 text-sm text-slate-300">After building the complete 138-row worksheet, stage the exact Pokémon checklist PDF above and preview the two literal marker definitions. The original checklist source remains pending. This does not confirm physical finish or approve catalog evidence.</p>
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || !!pending || !token || !canReview} onClick={() => void run(async active => {
        setPreview(null);
        const result = await request();
        if (result.schemaVersion !== 'setops-pokemon-additive-preparation-preview/v1'
          || !/^[a-f0-9]{64}$/.test(result.snapshotSha256) || !/^[a-f0-9]{64}$/.test(result.proposalSha256)
          || result.creates?.parallels !== 2 || result.creates?.scopes !== 2 || !validBinding(result.binding)
          || result.preservedCards !== 138 || result.applicability !== 'unknown') throw new Error('Invalid preparation preview.');
        if (active()) { setPreview(result); setReceipt(null); }
      })}>Preview missing mappings</button>
      <button className={button} disabled={busy || (!pending && !preview) || !token || !canReview} onClick={() => void run(stage)}>
        {pending ? 'Retry same preparation' : 'Prepare pending mappings'}
      </button>
      {receipt !== null && <button className={button} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'pokemon-catalog-preparation-receipt.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download preparation receipt</button>}
    </div>
    {preview && <p className="mt-3 text-sm">Adds {preview.creates.parallels} literal marker definitions and {preview.creates.scopes} program scopes using the existing pending source. All 138 card identities and original metadata are preserved. Physical printing applicability remains unknown.</p>}
    {message && <p role="status" className="mt-3 whitespace-pre-wrap text-sm text-amber-200">{message}</p>}
  </section>;
}
