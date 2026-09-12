import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PairedGeometryWorkspace } from '@atlas/manual-workspace';
import { DefectReviewWorkspace } from '@atlas/manual-workspace/defects';
import { geometryStatus } from '@atlas/manual-workspace/geometry-actions';
import { createManualClient } from '../src/client.mjs';
import '@atlas/manual-workspace/styles.css';
import '@atlas/manual-workspace/defects.css';
import './preview.css';

async function json(url, body, csrf) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-atlas-csrf': csrf }, body: JSON.stringify(body) } : {});
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function App() {
  const [session, setSession] = useState(null), [challenge, setChallenge] = useState(null), [code, setCode] = useState('');
  const [view, setView] = useState(null), [screen, setScreen] = useState('geometry'), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [report, setReport] = useState(null), [approving, setApproving] = useState(false), [preparing, setPreparing] = useState({});
  const [editing, setEditing] = useState(false);
  const client = useRef(null);
  async function open(current) {
    setSession(current);
    if (!current.staff) return;
    const { cardId } = await json('/fixture/card', {}, current.csrf);
    client.current = createManualClient({ cardId, staffId: current.staff.id, csrf: current.csrf, storage: localStorage, onView: setView, onStatus: setStatus });
    const loaded = await client.current.recover();
    setScreen(geometryStatus(loaded.geometry).confirmed ? 'defects' : 'geometry');
  }
  useEffect(() => { json('/api/staff/session').then(open).catch(() => setError('The local workspace could not load.')); }, []);
  useEffect(() => {
    if (!editing) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);
  const attempt = async work => { setError(''); try { return await work(); } catch { setError('The change needs review. Saved work is retained; retry a pending save before making another change.'); } };
  const execute = action => client.current.execute(action);
  const prepare = async side => {
    setPreparing(old => ({ ...old, [side]: true }));
    try { await execute({ type: 'PREPARE_SIDE', side }); }
    finally { setPreparing(old => ({ ...old, [side]: false })); }
  };
  // Read-only fixture observation and image-fault hooks are excluded from the
  // exported product bundles; they grant no server mutation or authentication.
  const [fault, setFault] = useState('none');
  window.manualFixture = { state: () => client.current?.current(), imageFault: setFault };
  const images = view && structuredClone(view.images);
  if (images && fault === 'missing') delete images.FRONT;
  if (images && fault === 'hash') images.FRONT.inspection.sha256 = '0'.repeat(64);
  if (images && fault === 'load') images.FRONT.inspection.url = '/missing-image.png';
  if (images && fault === 'dimensions') images.FRONT.inspection.url = images.FRONT.original.url;
  return <>
    <aside className="aw-fixture">Local synthetic build · test code 424242 · saves use an isolated PostgreSQL database and private files.</aside>
    {error && <p className="aw-error" role="alert">{error}</p>}
    {!session ? <p className="aw-loading">Loading staff session…</p> : !session.staff ? <main className="aw-login"><h1>Staff sign in</h1><p>Synthetic reviewer: +1 202 555 0141. No text message is sent.</p>
      {!challenge ? <button onClick={() => attempt(async () => setChallenge(await json('/api/staff/auth/request', { phone: '+12025550141', requestId: crypto.randomUUID() }, session.csrf)))}>Send test code</button>
        : <form onSubmit={event => { event.preventDefault(); attempt(async () => open(await json('/api/staff/auth/verify', { challengeId: challenge.challengeId, code }, session.csrf))); }}>
          <label>Verification code <input inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} /></label><button>Sign in</button></form>}
    </main> : !view ? <p className="aw-loading">Loading saved workspace…</p> : <>
      <nav className="aw-nav"><button disabled={screen === 'geometry' || editing || approving} onClick={() => { setReport(null); setScreen('geometry'); }}>Geometry</button>
        <button disabled={screen === 'defects' || editing || approving || !geometryStatus(view.geometry).confirmed} onClick={() => { setReport(null); setScreen('defects'); }}>Findings</button>
        <span>{session.staff.name} · revision {view.card.revision}</span>
        {client.current.hasPending() && <button onClick={() => attempt(() => client.current.recover())}>Retry pending save</button>}
      </nav>
      {screen === 'geometry' ? <PairedGeometryWorkspace workspace={view.geometry} images={images} onEditingChange={setEditing} saveStatus={status || 'Saved'} preparingSides={preparing} onPrepare={prepare}
        onEdit={async input => {
          const { actor, proposal, ...edit } = input;
          await execute({ type: 'GEOMETRY_EDIT', edit });
          if (input.kind === 'PHYSICAL') void attempt(() => prepare(input.side));
        }}
        onConfirm={async ({ base, reviewed }) => { await execute({ type: 'CONFIRM_GEOMETRY', base, reviewed }); setScreen('defects'); }} />
        : screen === 'defects' ? <DefectReviewWorkspace workspace={view.defects} images={images} onEditingChange={setEditing} saveStatus={status || 'Saved'}
          onEdit={async input => {
            await client.current.editDefect(input);
            // The candidate is already saved and can be resumed after reload.
            // Measurement has its own durable action and visible retry state.
            void attempt(() => execute({ type: 'MEASURE_SIDE', side: input.side }));
          }}
          onRetry={side => execute({ type: 'MEASURE_SIDE', side })}
          onDiscardPending={({ side, base }) => execute({ type: 'DISCARD_PENDING', side, base })}
          onInspect={({ side, base, inspected }) => execute({ type: 'INSPECT_SIDE', side, base, inspected })}
          onConfirm={({ base, reviewed }) => execute({ type: 'CONFIRM_FINDINGS', base, reviewed })}
          onContinue={() => attempt(async () => { setReport(await client.current.previewReport()); setScreen('report'); })} />
          : report && <main className="aw-report"><span className="am-brand">ATLAS</span><h1>Review draft report</h1>
            <p>{Object.values(report.report.identity).filter(value => typeof value === 'string' && value).join(' · ')}</p>
            <dl>{Object.entries(report.report.grade.subgrades ?? {}).map(([name, value]) => <React.Fragment key={name}><dt>{name}</dt><dd>{value}</dd></React.Fragment>)}</dl>
            <p className="aw-grade">Grade <strong>{report.report.grade.overall.displayGrade}</strong></p>
            <table><thead><tr><th>Condition</th><th>Front</th><th>Back</th></tr></thead><tbody>
              {['centering', 'corners', 'edges', 'surface'].map(name => <tr key={name}><th>{name}</th><td>{report.report.grade.front[name].score}</td><td>{report.report.grade.back[name].score}</td></tr>)}
            </tbody></table><p>Front contributes 70%; Back contributes 30%.</p>
            <p>{report.report.findingCounts.included} included findings · {report.report.findingCounts.removed} removed</p>
            <p>Findings confirmation is saved. Review the draft before approving this report.</p>
            {view.approval?.sourceHash === view.card.contentHash && view.approval.reportHash === report.reportHash
              ? <p role="status">Report approved and saved.</p>
              : <button disabled={approving} onClick={() => attempt(async () => {
                setApproving(true); try { await execute({ type: 'APPROVE_REPORT', reportHash: report.reportHash, reviewed: true }); } finally { setApproving(false); }
              })}>{approving ? 'Approving…' : 'Approve final report'}</button>}
            <button onClick={() => { setReport(null); setScreen('defects'); }}>Back to findings</button>
          </main>}
    </>}
  </>;
}
createRoot(document.getElementById('root')).render(<App />);
