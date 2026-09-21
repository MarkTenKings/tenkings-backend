import { useEffect, useRef, useState } from 'react';
import { buildAdminHeaders } from '../../lib/adminHeaders';
import type { ExactInputPlanResponse, ExactInputReceiptStatus } from '../../lib/server/staffResearchExactInputQualification';

const endpoint = '/api/v2/admin/inventory/research-qualification';
const button = 'min-h-[48px] rounded-lg border border-white/30 px-4 py-3 text-sm disabled:opacity-40';
type Pending = { invocation_id: string; plan_sha256: string };
function readPending(key: string): Pending | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!/^[a-f0-9-]{36}$/.test(value.invocation_id) || !/^[a-f0-9]{64}$/.test(value.plan_sha256)) throw Error('Stored invocation needs manual recovery.');
  return value;
}
function verifiedReceipt(value: unknown, saved: Pending): ExactInputReceiptStatus {
  const data = value as ExactInputReceiptStatus;
  if (!data || data.invocation_id !== saved.invocation_id || !['not_found', 'uncertain', 'completed', 'failed', 'stale_input'].includes(data.status)
    || typeof data.message !== 'string' || data.message.length > 2000
    || !(data.receipt_sha256 === null || /^[a-f0-9]{64}$/.test(data.receipt_sha256))
    || !(data.download_url === null || typeof data.download_url === 'string' && data.download_url.length <= 8192
      && /^https:\/\//.test(data.download_url) && !new URL(data.download_url).username && !new URL(data.download_url).password)) throw Error('Unverified response.');
  return data;
}
export default function StaffResearchExactInputQualification({ token, actorId }: { token: string; actorId: string }) {
  const [plan, setPlan] = useState<ExactInputPlanResponse | null>(null), [ack, setAck] = useState('');
  const [pending, setPending] = useState<Pending | null>(null), [receipt, setReceipt] = useState<ExactInputReceiptStatus | null>(null);
  const [message, setMessage] = useState('Loading the exact-input plan…'), [busy, setBusy] = useState(false), [storageReady, setStorageReady] = useState(false);
  const generation = useRef(0), running = useRef(false), key = `tk-exact-research-invocation:${actorId}`;
  useEffect(() => {
    const controller = new AbortController(), requestGeneration = generation, current = ++requestGeneration.current;
    setPlan(null); setReceipt(null); setAck(''); setPending(null); setBusy(false); setStorageReady(false); running.current = false;
    try { const prior = readPending(key); setPending(prior); setStorageReady(true); if (prior) setMessage('A previous invocation is retained. Read its receipt before any further action.'); }
    catch { setMessage('Invocation storage is unavailable or damaged. Execution is disabled to preserve uncertain requests.'); }
    void fetch(endpoint, { headers: buildAdminHeaders(token), cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json(); if (current !== generation.current) return;
      if (!response.ok) throw Error('Plan unavailable.'); setPlan(data);
      setMessage(readPending(key) ? 'A previous invocation is retained. Read its receipt before any further action.' : data.reason ?? 'Review the fixed input and request limits. Dollar cost may be unavailable.');
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) setMessage('The exact-input plan is unavailable. Any retained invocation can still be recovered.'); });
    return () => { requestGeneration.current++; controller.abort(); };
  }, [token, key]);
  async function recover(saved = pending) {
    if (!saved || running.current) return;
    running.current = true; setBusy(true); const current = generation.current;
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams(saved)}`, { headers: buildAdminHeaders(token), cache: 'no-store' });
      const data = await response.json(); if (current !== generation.current) return;
      if (!response.ok) throw Error(); const verified = verifiedReceipt(data, saved); setReceipt(verified); setMessage(verified.message);
    } catch { if (current === generation.current) setMessage('Receipt recovery is unavailable. The invocation is retained; no provider work was requested by this read.'); }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  async function run() {
    if (!plan?.enabled || !plan.plan_sha256 || ack !== plan.acknowledge || pending || running.current || !storageReady) return;
    const current = generation.current;
    let saved: Pending;
    try {
      // localStorage preserves the small, non-secret identifiers across reloads/tabs.
      // This read/write reduces accidents; it is not a cross-tab atomic lock.
      const prior = readPending(key); if (prior) { setPending(prior); setMessage('An invocation already exists. Recover its receipt.'); return; }
      saved = { invocation_id: window.crypto.randomUUID(), plan_sha256: plan.plan_sha256 };
      window.localStorage.setItem(key, JSON.stringify(saved));
      if (JSON.stringify(readPending(key)) !== JSON.stringify(saved)) throw Error();
    } catch { setStorageReady(false); setMessage('Could not retain an invocation before execution. No run was submitted.'); return; }
    setPending(saved); running.current = true; setBusy(true); setReceipt(null); setAck(''); setMessage('Running one exact-input diagnostic. Keep this invocation for recovery.');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: buildAdminHeaders(token, { 'Content-Type': 'application/json' }), cache: 'no-store',
        body: JSON.stringify({ ...saved, acknowledge: plan.acknowledge }) });
      const data = await response.json(); if (current !== generation.current) return;
      if (!response.ok) throw Error(); const verified = verifiedReceipt(data, saved); setReceipt(verified); setMessage(verified.message);
    } catch { if (current === generation.current) setMessage('The response is uncertain. Recover the retained receipt; do not repeat the provider run.'); }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  return <section className="space-y-4 border-t border-white/20 pt-6" aria-label="Exact-input research diagnostic">
    <h2 className="text-xl">One saved card: V5 research diagnostic</h2>
    <p className="text-white/70">Uses one server-pinned physical input and two verified original photos. It retains private evidence without updating Inventory or saved research jobs.</p>
    <p role="status">{message}</p>
    {plan && <>
      <p>{plan.reason ?? 'Review the exact saved card and limits before this one invocation.'}</p>
      {plan.plan && <>
        <dl className="space-y-2 break-all text-sm"><dt>Saved card</dt><dd>{plan.plan.input.description.name} · {plan.plan.input.description.year} · {plan.plan.input.description.set_name} · #{plan.plan.input.description.card_number}</dd>
          <dt>Physical unit</dt><dd>{plan.plan.config.unit_id}</dd><dt>Exact input SHA-256</dt><dd>{plan.plan.config.input_sha256}</dd>
          <dt>Front / back SHA-256</dt><dd>{plan.plan.config.photos.front.sha256}<br />{plan.plan.config.photos.back.sha256}</dd>
          <dt>Plan SHA-256</dt><dd>{plan.plan_sha256}</dd></dl>
        <p>At most 3 searches, 2 details, 3 {plan.plan.model.requested} model requests and 12 candidate-image reads. No automatic retry.</p>
        <p className="text-sm text-white/60">Limits apply to one server execution. They are not a global account quota. Concurrent copies can overwrite the same invocation receipt; a receipt does not prove that no duplicate execution occurred.</p>
        <p>{plan.plan.cost_status === 'unavailable' ? 'Dollar cost unavailable. Request counts are bounded; they are not a dollar cap.'
          : `Configured maximum reservation: $${(plan.plan.config.billing!.maximum_total_microusd / 1000000).toFixed(6)} USD. This is a configured bound, not an invoice.`}</p>
        <p>{plan.plan.references.length} matching legacy reference records. The catalog publication consumer is off. Missing references or unreadable evidence may leave identity/value unresolved.</p>
        <details><summary className="cursor-pointer underline">Review full fixed plan and cost basis</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(plan.plan, null, 2)}</pre></details>
      </>}
      {!pending && <><label className="block">Type <strong>{plan.acknowledge}</strong><input aria-label="Exact-input acknowledgement" className="mt-2 block w-full rounded-lg border border-white/30 bg-neutral-900 p-3" autoComplete="off" value={ack} disabled={!plan.enabled || busy || !storageReady} onChange={event => setAck(event.target.value)} /></label>
        <button className={button} disabled={!plan.enabled || busy || !storageReady || ack !== plan.acknowledge} onClick={() => void run()}>Run one exact-input diagnostic</button></>}
    </>}
    {pending && <div className="space-y-3"><p className="break-all text-sm">Retained invocation: {pending.invocation_id}. This panel cannot submit another run.</p>
      <button className={button} disabled={busy} onClick={() => void recover()}>Recover receipt (read only)</button></div>}
    {receipt && <div className="space-y-3"><p>Receipt status: {receipt.status}</p><p className="break-all text-xs">SHA-256: {receipt.receipt_sha256 ?? 'unavailable'}</p>
      {receipt.download_url && <a className="underline" href={receipt.download_url} rel="noreferrer" target="_blank">Download private replay evidence (short-lived link)</a>}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(receipt.summary, null, 2)}</pre></div>}
  </section>;
}
