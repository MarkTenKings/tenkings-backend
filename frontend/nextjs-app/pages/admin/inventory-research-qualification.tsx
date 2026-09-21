import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../hooks/useSession';
import { buildAdminHeaders } from '../../lib/adminHeaders';
import { hasAdminAccess, hasAdminPhoneAccess } from '../../constants/admin';
import type { ProviderQualificationReport } from '../../lib/server/staffResearchProviderQualification';
import StaffResearchExactInputQualification from '../../components/admin/StaffResearchExactInputQualification';

type Plan = { enabled: boolean; plan_sha256: string; acknowledge: string; plan: {
  cohorts: { id: string; keyword: string; sold: boolean }[]; maximum_searches: number;
  maximum_detail_requests: number; maximum_image_requests: number; provider_billing_units: string;
} };
const endpoint = '/api/v2/admin/inventory/provider-qualification';
const button = 'min-h-[48px] rounded-lg border border-white/30 px-4 py-3 text-sm disabled:opacity-40';

export function ProviderQualificationPanel({ token }: { token: string }) {
  const [plan, setPlan] = useState<Plan | null>(null), [cohort, setCohort] = useState('sports_anniversary');
  const [acknowledgment, setAcknowledgment] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading the fixed plan…'), [report, setReport] = useState<ProviderQualificationReport | null>(null);
  const pending = useRef(false), generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), requestGeneration = generation, current = ++requestGeneration.current;
    setPlan(null); setReport(null); setAcknowledgment(''); setBusy(false); pending.current = false;
    void fetch(endpoint, { headers: buildAdminHeaders(token), cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (current !== requestGeneration.current) return;
      if (!response.ok) throw Error(data.message ?? 'Plan unavailable.');
      setPlan(data); setMessage(data.enabled ? 'Choose one cohort and review its request limits.' : 'Execution is disabled. The plan can be reviewed without provider requests.');
    }).catch(() => { if (!controller.signal.aborted && current === requestGeneration.current) setMessage('The qualification plan is unavailable.'); });
    return () => { requestGeneration.current++; controller.abort(); };
  }, [token]);
  async function run() {
    if (!plan?.enabled || acknowledgment !== plan.acknowledge || pending.current) return;
    pending.current = true; setBusy(true); setReport(null); setMessage('Running one bounded provider check…');
    const current = generation.current;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: buildAdminHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cohort, plan_sha256: plan.plan_sha256, acknowledge: acknowledgment }), cache: 'no-store' });
      const data = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw Error(data.message ?? 'The check did not complete.');
      setReport(data); setMessage('Check complete. Review missing evidence and failures before drawing conclusions.');
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : 'The check did not complete. Do not automatically retry an uncertain request.'); }
    finally { pending.current = false; if (current === generation.current) { setBusy(false); setAcknowledgment(''); } }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `provider-qualification-${report.cohort}-${report.started_at.replace(/[:.]/g, '-')}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="space-y-5">
    <p className="text-white/70">This deliberate check uses the server’s SoldComps account. It does not run a model or change inventory, catalog evidence, estimates or the larger-image setting.</p>
    <p role="status" className="rounded-lg border border-white/20 p-4">{message}</p>
    {plan && <>
      <label className="block">Fixed query cohort<select className="mt-2 block w-full rounded-lg bg-neutral-900 p-3" value={cohort} disabled={busy} onChange={event => { setCohort(event.target.value); setAcknowledgment(''); }}>
        {plan.plan.cohorts.map(row => <option key={row.id} value={row.id}>{row.keyword} ({row.sold ? 'sold query' : 'active control'})</option>)}
      </select></label>
      <p>Per click: at most {plan.plan.maximum_searches} search, {plan.plan.maximum_detail_requests} item detail and {plan.plan.maximum_image_requests} image reads; no automatic retry. {plan.plan.provider_billing_units}</p>
      <p className="text-sm text-white/60">A query may return none of the desired sale/offer types. Returned fields and image dimensions alone do not prove a final price or better recognition. Save reports only to private storage.</p>
      <label className="block">Type <strong>{plan.acknowledge}</strong> to acknowledge this one provider request batch<input className="mt-2 block w-full rounded-lg border border-white/30 bg-neutral-900 p-3" autoComplete="off" value={acknowledgment} onChange={event => setAcknowledgment(event.target.value)} disabled={!plan.enabled || busy} /></label>
      <button className={button} disabled={!plan.enabled || busy || acknowledgment !== plan.acknowledge} onClick={() => void run()}>{busy ? 'Checking…' : 'Run one provider check'}</button>
    </>}
    {report && <div className="space-y-3"><h2 className="text-xl">Observed evidence</h2><button className={button} onClick={download}>Download private report</button><pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-neutral-900 p-4 text-xs">{JSON.stringify(report, null, 2)}</pre></div>}
  </section>;
}

export default function InventoryResearchQualificationPage({ inventoryPath = '/admin/physical-inventory' }: { inventoryPath?: string }) {
  const { session, loading, ensureSession } = useSession();
  const admin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  return <main className="min-h-screen bg-black px-4 py-8 text-white"><Head><title>Research qualification | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head><div className="mx-auto max-w-3xl space-y-6">
    <Link href={inventoryPath} className="underline">Back to inventory</Link><h1 className="text-3xl font-semibold">Research provider qualification</h1>
    {loading ? <p>Loading admin session…</p> : !session ? <button className={button} onClick={() => void ensureSession()}>Sign in</button> : !admin ? <p>Human inventory admin access is required.</p> : <div key={session.user.id} className="space-y-8"><ProviderQualificationPanel token={session.token} /><StaffResearchExactInputQualification token={session.token} actorId={session.user.id} /></div>}
  </div></main>;
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const { providerQualificationHost, providerQualificationPreviewHost } = await import('../../lib/staffResearchQualificationHost');
  if (!providerQualificationHost(req.headers.host, process.env.NODE_ENV === 'production', process.env)) return { notFound: true };
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return { props: { inventoryPath: req.headers.host === providerQualificationPreviewHost(process.env) ? '/staff/inventory' : '/admin/physical-inventory' } };
};
