import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Shell from './Shell';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import styles from './BatchGrading.module.css';
import BatchImport from './BatchImport';
import { MachineReportReview } from '@atlas/manual-workspace/report-review';
import ManualFinishing, { openManualLabelPrintWindow } from './ManualFinishing';

const path = '/api/staff/manual-connected/cards/batch';
const status = { QUEUED: 'Queued', RUNNING: 'Grading', REVIEW: 'Review', NEEDS_ATTENTION: 'Check card', SUPERSEDED: 'Photos changed', APPROVED: 'Approved' };
const stages = { PREPARE: 'Preparing', ANALYZE: 'Astra analysis', REPORT: 'Measuring' };
const messages = {
  BATCH_IDENTITY_NEEDS_REVIEW: 'Check card details', BATCH_GEOMETRY_NEEDS_REVIEW: 'Check edges',
  BATCH_HUMAN_WORK_PRESENT: 'Continue your review', BATCH_ANALYSIS_UNCERTAIN: 'Check saved analysis',
  BATCH_MANUAL_DRAFT_CHANGED: 'Review updated card', BATCH_PHOTOS_CHANGED: 'Review current photos',
  BATCH_ACCESS_CHANGED: 'Resume with your current access',
  BATCH_UNAVAILABLE: 'Batch grading is unavailable. Your saved cards are retained.',
};
export default function BatchGrading({ staff }) {
  const router = useRouter(), session = useRef(null), current = useRef(0), mutation = useRef(false);
  const [jobs, setJobs] = useState([]), [cards, setCards] = useState([]), [selected, setSelected] = useState([]);
  const [tab, setTab] = useState('REVIEW'), [active, setActive] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(null);
  const [packet, setPacket] = useState(null), [imagesReady, setImagesReady] = useState(false), [reviewError, setReviewError] = useState('');
  const reviewing = useRef(null);
  const lifetime = useRef(null), approvalPopup = useRef(null), labelRead = useRef(0);
  const [lastApproved, setLastApproved] = useState(null), [finishing, setFinishing] = useState(null);
  const [autoPrintWindow, setAutoPrintWindow] = useState(null), [finishingError, setFinishingError] = useState('');
  const [preparingLabel, setPreparingLabel] = useState(false);
  const pendingKey = `atlas-batch-enqueue:${staff.id}`;
  const request = useCallback((url, options = {}) => manualRequest(url, { ...options, csrf: session.current?.csrf }), []);
  const refresh = useCallback(async () => {
    const sequence = ++current.current;
    const result = await request(path);
    if (sequence === current.current && !reviewing.current) { setJobs(result.jobs ?? []); setLoaded(true); }
  }, [request]);
  const loadCards = useCallback(async (cursor = null) => {
    const owner = lifetime.current;
    const result = await request(`/api/staff/manual-intake/cards${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (lifetime.current !== owner) return;
    setCards(previous => cursor ? [...previous, ...(result.cards ?? [])].filter((card, index, all) => all.findIndex(item => item.cardId === card.cardId) === index) : result.cards ?? []);
    setHasMore(result.nextCursor ?? null);
  }, [request]);
  useEffect(() => {
    let stopped = false; const owner = {}; lifetime.current = owner; session.current = null;
    mutation.current = false; reviewing.current = null;
    setJobs([]); setCards([]); setSelected([]); setActive(null); setPacket(null); setImagesReady(false); setLoaded(false); setBusy(false);
    setLastApproved(null); setFinishing(null); setAutoPrintWindow(null); setFinishingError(''); setPreparingLabel(false);
    (async () => {
      const result = await request('/api/staff/session');
      if (stopped) return;
      if (result.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
      session.current = result;
      const saved = localStorage.getItem(pendingKey);
      if (saved) {
        // Exactly the original admission request survives a lost response.
        const body = JSON.parse(saved);
        try {
          await request(path, { method: 'POST', body });
          if (localStorage.getItem(pendingKey) === saved) localStorage.removeItem(pendingKey);
        } catch (failure) {
          if ([400, 403, 404, 409, 413, 422].includes(failure.status) && localStorage.getItem(pendingKey) === saved) localStorage.removeItem(pendingKey);
          throw failure;
        }
      }
      if (!stopped) await Promise.all([refresh(), loadCards()]);
    })().catch(failure => { if (!stopped) setError(messages[failure.code] ?? manualMessage(failure)); });
    const timer = setInterval(() => { if (session.current && document.visibilityState !== 'hidden') void refresh().catch(failure => setError(messages[failure.code] ?? manualMessage(failure))); }, 3000);
    return () => { stopped = true; current.current++; labelRead.current++; clearInterval(timer);
      if (lifetime.current === owner) { lifetime.current = null; session.current = null; }
      approvalPopup.current?.close(); approvalPopup.current = null;
    };
  }, [staff.id, pendingKey, request, refresh, loadCards]);
  const shown = jobs.filter(job => tab === 'PROCESSING' ? ['QUEUED', 'RUNNING'].includes(job.state) : job.state === tab);
  const focused = shown.find(job => job.key === active) ?? shown[0] ?? null;
  const eligible = cards.filter(card => card.ready && !jobs.some(job => job.cardId === card.cardId && job.sourceHash === card.sourceHash));
  const open = useCallback(job => { if (job) void router.push(`/manual/${job.cardId}?from=batch`); }, [router]);
  useEffect(() => {
    let stopped = false; setPacket(null); setImagesReady(false); setReviewError('');
    if (focused?.state === 'REVIEW') void request(`${path}/${focused.key}`).then(value => {
      if (!stopped) setPacket(value);
    }).catch(failure => { if (!stopped) setReviewError(messages[failure.code] ?? manualMessage(failure)); });
    return () => { stopped = true; };
  }, [focused?.key, focused?.state, request]);
  useEffect(() => {
    const keydown = event => {
      if (mutation.current || event.repeat || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return;
      const index = shown.findIndex(job => job.key === focused?.key);
      if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); setActive(shown[Math.min(shown.length - 1, index + 1)]?.key); }
      if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); setActive(shown[Math.max(0, index - 1)]?.key); }
      if (event.key === 'Enter' && focused && focused.state !== 'REVIEW') { event.preventDefault(); open(focused); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [shown, focused, open]);
  async function enqueue() {
    if (mutation.current || !selected.length) return;
    mutation.current = true; setBusy(true); setError(''); let saved = null;
    try {
      const old = localStorage.getItem(pendingKey);
      const body = old ? JSON.parse(old) : { actionId: crypto.randomUUID(), cards: selected.map(id => {
        const card = eligible.find(item => item.cardId === id); if (!card) throw { code: 'BATCH_PHOTOS_CHANGED' };
        return { cardId: id, sourceHash: card.sourceHash };
      }) };
      saved = JSON.stringify(body); localStorage.setItem(pendingKey, saved);
      await request(path, { method: 'POST', body });
      if (localStorage.getItem(pendingKey) === saved) localStorage.removeItem(pendingKey);
      setSelected([]); setTab('PROCESSING'); await refresh();
    } catch (failure) {
      // Closed refusals prove no admission; uncertain responses keep the exact
      // request for recovery. A new action is never silently substituted.
      if ([400, 403, 404, 409, 413, 422].includes(failure.status) && localStorage.getItem(pendingKey) === saved) localStorage.removeItem(pendingKey);
      setError(messages[failure.code] ?? manualMessage(failure));
    } finally { mutation.current = false; setBusy(false); }
  }
  async function loadApprovedLabel(result, popup = null) {
    const owner = lifetime.current, sequence = ++labelRead.current;
    setFinishing(null); setAutoPrintWindow(null); setFinishingError(''); setPreparingLabel(true);
    try {
      const publication = result.publication;
      if (publication?.state !== 'PUBLISHED') {
        popup?.close(); setFinishingError('Report approved. Finish publishing in the card workspace to prepare its label.'); return;
      }
      if (publication.actionId !== result.actionId) throw { code: 'BATCH_REVIEW_BINDING_CHANGED' };
      const plan = await request(`/api/staff/manual-connected/cards/${result.cardId}/finishing/${result.actionId}`);
      if (lifetime.current !== owner || sequence !== labelRead.current) { popup?.close(); return; }
      if (plan?.binding?.cardId !== result.cardId || plan.binding.approvalActionId !== result.actionId
        || plan.binding.publicHash !== publication.publicHash || plan.binding.reportHash !== publication.reportHash
        || plan.binding.approvalVersion !== publication.version || plan.binding.reportNumber !== publication.reportNumber) {
        throw { code: 'BATCH_REVIEW_BINDING_CHANGED' };
      }
      setFinishing(plan); setAutoPrintWindow(popup);
    } catch (failure) {
      popup?.close(); if (lifetime.current === owner && sequence === labelRead.current) setFinishingError(`Report approved. ${manualMessage(failure)}`);
    } finally { if (lifetime.current === owner && sequence === labelRead.current) setPreparingLabel(false); }
  }
  async function approve() {
    if (mutation.current || !session.current || !imagesReady || !packet?.canCertify || packet.key !== focused?.key) return;
    const owner = lifetime.current;
    mutation.current = true; reviewing.current = focused.key; setBusy(true); setReviewError('');
    approvalPopup.current?.close(); let popup = null;
    try { popup = openManualLabelPrintWindow(); } catch { /* A blocked popup cannot prevent approval. */ }
    approvalPopup.current = popup;
    setLastApproved(null); setFinishing(null); setAutoPrintWindow(null); setFinishingError('');
    try {
      const result = await request(`${path}/${packet.key}/review`, { method: 'POST', body: {
        reportHash: packet.reportHash, reviewed: true,
        images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, packet.report.geometry[side].frame.inspectionImageSha256])),
      } });
      if (lifetime.current !== owner) { popup?.close(); return; }
      if (result.cardId !== packet.cardId || !result.actionId) throw { code: 'BATCH_REVIEW_BINDING_CHANGED' };
      setLastApproved(result);
      await loadApprovedLabel(result, popup);
      if (lifetime.current !== owner) return;
      setPacket(null); setImagesReady(false); setActive(null);
    } catch (failure) {
      popup?.close(); if (lifetime.current === owner) setReviewError(messages[failure.code] ?? manualMessage(failure));
    } finally {
      if (lifetime.current === owner) {
        reviewing.current = null; mutation.current = false; setBusy(false);
        await refresh().catch(failure => setError(manualMessage(failure)));
      }
    }
  }
  return <Shell staff={staff} manual title="Batch grading">
    <main className={styles.studio}>
      <header className={styles.heading}><div><p>ATLAS STUDIO</p><h1>Grading queue</h1></div><Link className={styles.add} href="/manual">+ Add cards</Link></header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <nav className={styles.tabs} aria-label="Grading queues">
        {[['REVIEW', 'Review'], ['PROCESSING', 'Grading'], ['NEEDS_ATTENTION', 'Needs attention'], ['INTAKE', 'Ready to queue']].map(([value, label]) => {
          const count = value === 'INTAKE' ? eligible.length : jobs.filter(job => value === 'PROCESSING' ? ['QUEUED', 'RUNNING'].includes(job.state) : job.state === value).length;
          return <button key={value} disabled={busy} aria-current={tab === value ? 'page' : undefined} onClick={() => { setTab(value); setActive(null); }}>{label}<span>{count}</span></button>;
        })}
      </nav>
      {lastApproved && <section className={styles.finishingDock} aria-label="Last approved card finishing">
        {preparingLabel && <p role="status">Preparing the approved label…</p>}
        {finishingError && <p className={styles.error} role="alert">{finishingError}{' '}
          {lastApproved.publication?.state === 'PUBLISHED' && <button disabled={busy || preparingLabel} onClick={() => void loadApprovedLabel(lastApproved)}>Reload label</button>}{' '}
          <Link href={`/manual/${lastApproved.cardId}?from=batch`}>Open approved card</Link></p>}
        {finishing && <ManualFinishing key={finishing.id} plan={finishing} autoPrintWindow={autoPrintWindow} staffId={staff.id} csrf={session.current?.csrf}
          onPrintDialog={() => setAutoPrintWindow(null)} printDisabled={busy} />}
      </section>}
      {tab === 'INTAKE' ? <section className={styles.intake}>
        <BatchImport staff={staff} enabled={loaded} onImported={async()=>{await Promise.all([refresh(),loadCards()]);}}/>
        <div className={styles.intakeBar}><button onClick={() => setSelected(eligible.slice(0, 50).map(card => card.cardId))} disabled={!eligible.length}>Select up to 50</button><button className={styles.primary} onClick={enqueue} disabled={!selected.length || busy}>{busy ? 'Queueing…' : `Grade ${selected.length || ''} cards`}</button></div>
        <div className={styles.cards}>{eligible.map(card => <label className={styles.selectCard} key={card.cardId}><input type="checkbox" checked={selected.includes(card.cardId)} disabled={!selected.includes(card.cardId) && selected.length >= 50} onChange={event => setSelected(ids => event.target.checked ? [...ids, card.cardId] : ids.filter(id => id !== card.cardId))}/><img src={`${STAFF_BASE_PATH}/api/staff/manual-connected/cards/${card.cardId}/preview-image/FRONT`} alt="Front" loading="lazy"/><span>{card.label || 'Ready card'}</span></label>)}</div>
        {hasMore && <button onClick={() => void loadCards(hasMore).catch(failure => setError(manualMessage(failure)))}>Load more cards</button>}
        {!eligible.length && <p className={styles.empty}>Add a Front and Back photo to get started.</p>}
      </section> : <div className={styles.review}>
        <aside className={styles.rail} aria-label="Cards">{shown.map(job => <button disabled={busy} className={styles.cardRow} aria-current={focused?.key === job.key ? 'true' : undefined} key={job.key} onClick={() => setActive(job.key)}><img src={`${STAFF_BASE_PATH}/api/staff/manual-connected/cards/${job.cardId}/preview-image/FRONT`} alt="" loading="lazy"/><span><strong>{job.evidence?.name || job.label || 'Card'}</strong><small>{job.state === 'RUNNING' ? stages[job.stage] : status[job.state]}</small></span><b>{job.evidence?.proposedGrade ?? '·'}</b></button>)}</aside>
        {focused?.state === 'REVIEW' ? <section className={styles.machineReview} aria-label="Review proposed grade">
          {reviewError && <p className={styles.error} role="alert">{reviewError}</p>}
          {packet?.key === focused.key ? <MachineReportReview key={packet.reportHash} packet={packet} onReadyChange={setImagesReady} brandSrc={`${STAFF_BASE_PATH}/brand/atlas-brand.png`}>
            <div className={styles.reviewActions}><button disabled={busy} onClick={() => open(focused)}>Make corrections</button>
              <button className={styles.primary} onClick={approve} disabled={busy || !imagesReady || !packet.canCertify}>{busy ? 'Saving your review…' : packet.resumeAvailable ? 'Finish approval & print' : 'Approve & print next'}</button></div>
            {!packet.canCertify && <p>A trained reviewer is required to approve this card.</p>}
          </MachineReportReview> : <div className={styles.empty}><p>{reviewError ? 'Open the current card to continue.' : 'Loading the exact grading evidence…'}</p><button onClick={() => open(focused)}>Open card workspace</button></div>}
        </section> : focused ? <section className={styles.focus} aria-label="Selected card">
          <div className={styles.focusHeader}><div><p>{focused.state === 'REVIEW' ? 'MACHINE DRAFT · HUMAN REVIEW' : status[focused.state]}</p><h2>{focused.evidence?.name || focused.label || 'Card review'}</h2></div>{focused.evidence?.proposedGrade !== undefined && <div className={styles.grade}><strong>{focused.evidence.proposedGrade}</strong><span>PROPOSED</span></div>}</div>
          <div className={styles.photos}>{['FRONT', 'BACK'].map(side => <figure key={side}><img src={`${STAFF_BASE_PATH}/api/staff/manual-connected/cards/${focused.cardId}/preview-image/${side}`} alt={`${side === 'FRONT' ? 'Front' : 'Back'} of selected card`}/><figcaption>{side}</figcaption></figure>)}</div>
          <footer className={styles.actions}><span>{focused.state === 'REVIEW' ? `${focused.evidence.findingCount ?? 0} proposed findings` : messages[focused.code] ?? stages[focused.stage]}<small>↑ ↓ select · Enter review</small></span><button className={styles.primary} onClick={() => open(focused)}>{focused.state === 'NEEDS_ATTENTION' ? 'Check card' : 'Review card'} <span aria-hidden="true">↗</span></button></footer>
        </section> : <section className={styles.empty}><span aria-hidden="true">◇</span><h2>{loaded ? tab === 'REVIEW' ? 'Your next review lands here.' : 'All clear.' : 'Loading saved work…'}</h2><p>{tab === 'REVIEW' ? 'Finished Astra drafts appear automatically.' : 'Every card keeps its own progress.'}</p></section>}
      </div>}
    </main>
  </Shell>;
}
