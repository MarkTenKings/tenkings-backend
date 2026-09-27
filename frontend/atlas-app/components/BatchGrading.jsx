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
import { createManualClient } from '@atlas/manual-workflow/client';

const path = '/api/staff/manual-connected/cards/batch';
const status = { QUEUED: 'Queued up for ATLAS', RUNNING: 'ATLAS processing', REVIEW: 'Review', NEEDS_ATTENTION: 'Check card', SUPERSEDED: 'Photos changed', APPROVED: 'Approved' };
const queueTabs = ['INTAKE', 'PROCESSING', 'REVIEW', 'NEEDS_ATTENTION'];
const stages = { PREPARE: 'ATLAS preparing', ANALYZE: 'ATLAS grading', REPORT: 'ATLAS preparing report' };
const messages = {
  BATCH_IDENTITY_NEEDS_REVIEW: 'Check card details', BATCH_GEOMETRY_NEEDS_REVIEW: 'Check edges',
  BATCH_HUMAN_WORK_PRESENT: 'Continue your review', BATCH_ANALYSIS_UNCERTAIN: 'Check saved analysis',
  BATCH_MANUAL_DRAFT_CHANGED: 'Review updated card', BATCH_PHOTOS_CHANGED: 'Review current photos',
  BATCH_ACCESS_CHANGED: 'Resume with your current access',
  BATCH_UNAVAILABLE: 'Batch grading is unavailable. Your saved cards are retained.',
  BATCH_RESUME_STALE: 'This card changed. Its current progress has been refreshed.',
  BATCH_ALREADY_APPROVED: 'This report is already approved.',
  BATCH_CONTINUE_MANUAL_REVIEW: 'Continue your saved corrections in the card workspace.',
  BATCH_FINAL_GEOMETRY_REQUIRED: 'Defect analysis and measurements are saved. Review the physical outlines and printed borders in final review; centering and the overall grade remain unavailable until supported geometry is saved.',
  BATCH_PROPOSAL_REVIEW_REQUIRED: 'The report is ready. Some observations could not be measured; check them in the card workspace before approval.',
};
function QueuePhoto({ job, side = 'FRONT', readPreview }) {
  const [src, setSrc] = useState(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false; setSrc(null); setFailed(false);
    readPreview(job, retry > 0).then(images => {
      if (!stopped) { setSrc(images?.[side]?.url ?? null); setFailed(!images?.[side]?.url); }
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [job.key, job.revision, side, readPreview, retry]);
  return src && !failed ? <img src={src} alt="" loading="lazy" onError={() => retry === 0 ? setRetry(1) : setFailed(true)}/>
    : <span className={styles.photoFallback} aria-label={failed ? 'Photo preview unavailable' : 'Loading photo preview'}>{failed ? '◇' : '·'}</span>;
}
export default function BatchGrading({ staff }) {
  const router = useRouter(), session = useRef(null), current = useRef(0), mutation = useRef(false);
  const [jobs, setJobs] = useState([]);
  const [intakeCards,setIntakeCards] = useState([]);
  const [tab, setTab] = useState(queueTabs.includes(router.query?.tab) ? router.query.tab : 'INTAKE'), [active, setActive] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [packet, setPacket] = useState(null), [imagesReady, setImagesReady] = useState(false), [reviewError, setReviewError] = useState('');
  const reviewing = useRef(null);
  const lifetime = useRef(null), approvalPopup = useRef(null), labelRead = useRef(0);
  const [lastApproved, setLastApproved] = useState(null), [finishing, setFinishing] = useState(null);
  const [autoPrintWindow, setAutoPrintWindow] = useState(null), [finishingError, setFinishingError] = useState('');
  const [preparingLabel, setPreparingLabel] = useState(false);
  const [deleteControls,setDeleteControls]=useState(null);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const previewReads = useRef(new Map());
  const onDiscarded=useCallback(result=>{
    current.current++;
    const removed=new Set(result.cardIds);
    setJobs(old=>old.filter(job=>!removed.has(job.cardId)));setActive(null);setPacket(null);setImagesReady(false);
    setIntakeCards(old=>old.filter(card=>!removed.has(card.cardId)));
    if(removed.has(lastApproved?.cardId)){labelRead.current++;setLastApproved(null);setFinishing(null);setAutoPrintWindow(null);setPreparingLabel(false);
      approvalPopup.current?.close();approvalPopup.current=null;}
  },[lastApproved?.cardId]);
  useEffect(() => { setTab(queueTabs.includes(router.query?.tab) ? router.query.tab : 'INTAKE'); setActive(null); }, [router.query?.tab]);
  function selectTab(value) {
    setTab(value); setActive(null);
    void router.replace({ pathname: router.pathname, query: { ...router.query, tab: value } }, undefined, { shallow: true });
  }
  const pendingKey = `atlas-batch-enqueue:${staff.id}`;
  const request = useCallback((url, options = {}) => manualRequest(url, { ...options, csrf: session.current?.csrf }), []);
  // Share bounded, short-lived reads between the rail and the active report.
  // Prepared inspection photos use the authorized storage URL, avoiding the
  // 4 MB proxy ceiling that rejects full-resolution originals.
  const readReview = useCallback((job, fresh = false) => {
    const key = `${job.key}:${job.revision}`, cached = previewReads.current.get(key);
    if (!fresh && cached && Date.now() - cached.at < 60000) return cached.promise;
    const promise = request(`${path}/${job.key}`);
    previewReads.current.set(key, { promise, at: Date.now() });
    if (previewReads.current.size > 30) previewReads.current.delete(previewReads.current.keys().next().value);
    promise.catch(() => { if (previewReads.current.get(key)?.promise === promise) previewReads.current.delete(key); });
    return promise;
  }, [request]);
  const readPreview = useCallback(async (job, fresh) => {
    if (job.state === 'REVIEW') {
      const detail = await readReview(job, fresh);
      if (detail.images?.FRONT?.inspection) return Object.fromEntries(['FRONT', 'BACK'].map(side => [side, detail.images[side]?.inspection]));
    }
    return (await request(`/api/staff/manual-connected/cards/${job.cardId}`)).previews;
  }, [request, readReview]);
  const refresh = useCallback(async () => {
    const sequence = ++current.current;
    const result = await request(path);
    if (sequence === current.current && !reviewing.current) { setJobs(result.jobs ?? []); setIntakeCards(result.intakeCards ?? []); setLoaded(true); }
  }, [request]);
  useEffect(() => {
    let stopped = false; const owner = {}; lifetime.current = owner; session.current = null;
    previewReads.current.clear();
    mutation.current = false; reviewing.current = null;
    setJobs([]); setIntakeCards([]); setActive(null); setPacket(null); setImagesReady(false); setLoaded(false); setBusy(false);
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
      if (!stopped) await refresh();
    })().catch(failure => { if (!stopped) setError(messages[failure.code] ?? manualMessage(failure)); });
    const timer = setInterval(() => { if (session.current && document.visibilityState !== 'hidden') void refresh().catch(failure => setError(messages[failure.code] ?? manualMessage(failure))); }, 3000);
    return () => { stopped = true; current.current++; labelRead.current++; clearInterval(timer);
      if (lifetime.current === owner) { lifetime.current = null; session.current = null; }
      approvalPopup.current?.close(); approvalPopup.current = null;
    };
  }, [staff.id, pendingKey, request, refresh]);
  const shown = jobs.filter(job => tab === 'PROCESSING' ? ['QUEUED', 'RUNNING'].includes(job.state) : job.state === tab);
  const focused = shown.find(job => job.key === active) ?? shown[0] ?? null;
  const open = useCallback(job => { if (job) void router.push(`/manual/${job.cardId}?from=batch`); }, [router]);
  async function correct(job) {
    if (!job || mutation.current || !session.current || packet?.key !== job.key) return;
    const owner = lifetime.current;
    mutation.current = true; setBusy(true); setReviewError('');
    try {
      const client = createManualClient({ cardId: job.cardId, staffId: staff.id, csrf: session.current.csrf,
        storage: localStorage, basePath: STAFF_BASE_PATH, timeoutMs: 210000 });
      const current = await client.recover();
      if (lifetime.current !== owner) return;
      if (!current.finalReview) await client.execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: job.key,
        reportHash: packet.reportHash });
      if (lifetime.current === owner) await router.push(`/manual/${job.cardId}?from=batch`);
    } catch (failure) { if (lifetime.current === owner) setReviewError(messages[failure.code] ?? manualMessage(failure)); }
    finally { if (lifetime.current === owner) { mutation.current = false; setBusy(false); } }
  }
  useEffect(() => {
    let stopped = false; setPacket(null); setImagesReady(false); setReviewError('');
    if (focused?.state === 'REVIEW') void readReview(focused).then(value => {
      if (!stopped) setPacket(value);
    }).catch(failure => { if (!stopped) setReviewError(messages[failure.code] ?? manualMessage(failure)); });
    return () => { stopped = true; };
  }, [focused?.key, focused?.revision, focused?.state, readReview]);
  useEffect(() => {
    const keydown = event => {
      if (mutation.current || event.defaultPrevented || event.target?.closest?.('.rr-inspect') || event.repeat || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return;
      const index = shown.findIndex(job => job.key === focused?.key);
      if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); setActive(shown[Math.min(shown.length - 1, index + 1)]?.key); }
      if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); setActive(shown[Math.max(0, index - 1)]?.key); }
      if (event.key === 'Enter' && focused && focused.state !== 'REVIEW') { event.preventDefault(); open(focused); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [shown, focused, open]);
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
    if (mutation.current || deleteControls?.busy || deleteControls?.pending || !session.current || !imagesReady || !packet?.canCertify || packet.key !== focused?.key) return;
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
  async function resume(job) {
    if (mutation.current || deleteControls?.busy || deleteControls?.pending || !session.current || !job.canResumeProcessing) return;
    const owner = lifetime.current;
    mutation.current = true; reviewing.current = job.key; setBusy(true); setError('');
    try {
      // The exact revision and existing job retain their original analysis
      // action. A lost response is reconciled by refreshing, never a new job.
      await request(`${path}/resume`, { method: 'POST', body: { key: job.key, expectedRevision: job.revision } });
      if (lifetime.current !== owner) return;
      setActive(null);
    } catch (failure) {
      if (lifetime.current === owner) setError(messages[failure.code] ?? manualMessage(failure));
    } finally {
      if (lifetime.current === owner) {
        reviewing.current = null; mutation.current = false; setBusy(false);
        await refresh().catch(failure => setError(manualMessage(failure)));
      }
    }
  }
  return <Shell staff={staff} manual title="Batch grading">
    <main className={styles.studio}>
      <header className={styles.heading}><div><p>ATLAS STUDIO</p><h1>Grading queue</h1></div><div className={styles.headingActions}>{staff.role==='REVIEWER'&&<button type="button" className={styles.deleteButton} disabled={busy||!deleteControls||deleteControls.disabled} onClick={()=>void deleteControls.removeAll()}>{deleteControls?.busy?'Deleting cards…':deleteControls?.pending?'Finish saved deletion':'Delete all cards'}</button>}<button type="button" className={styles.add} onClick={() => selectTab('INTAKE')}>+ Add cards</button></div></header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <nav className={styles.tabs} aria-label="Grading queues">
        {[['INTAKE', 'Add cards'], ['PROCESSING', 'Grading'], ['REVIEW', 'Review'], ['NEEDS_ATTENTION', 'Needs attention']].map(([value, label]) => {
          const count = value === 'INTAKE' ? null : jobs.filter(job => value === 'PROCESSING' ? ['QUEUED', 'RUNNING'].includes(job.state) : job.state === value).length;
          return <button key={value} disabled={busy} aria-current={tab === value ? 'page' : undefined} onClick={() => selectTab(value)}>{label}{count !== null && <span>{count}</span>}</button>;
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
      <section className={styles.intake} hidden={tab !== 'INTAKE'}>
        <BatchImport staff={staff} enabled={loaded} onImported={refresh} jobs={jobs} intakeCards={intakeCards} onDiscarded={onDiscarded} onDeleteControls={setDeleteControls} onOpenCard={cardId=>void router.push(`/manual/${cardId}?from=batch`)}/>
      </section>
      {tab !== 'INTAKE' && <div className={`${styles.review} ${!queueExpanded ? styles.compactQueue : ''}`}>
        <aside className={styles.rail} aria-label="Cards"><button className={styles.queueToggle} type="button" aria-expanded={queueExpanded} aria-label={queueExpanded ? 'Collapse card queue' : 'Expand card queue'} onClick={() => setQueueExpanded(value => !value)}>{queueExpanded ? '← Cards' : '☰'}<small>{shown.length}</small></button>{shown.map(job => <button disabled={busy} className={styles.cardRow} aria-label={`${job.evidence?.name || job.label || 'Card'} · ${status[job.state]}${job.evidence?.proposedGrade != null ? ` · ${job.evidence.proposedGrade}` : ''}`} title={job.evidence?.name || job.label || 'Card'} aria-current={focused?.key === job.key ? 'true' : undefined} key={job.key} onClick={() => setActive(job.key)}><QueuePhoto job={job} readPreview={readPreview}/><span className={styles.cardLabel}><strong>{job.evidence?.name || job.label || 'Card'}</strong><small>{job.state === 'RUNNING' ? stages[job.stage] : status[job.state]}</small></span><b>{job.evidence?.proposedGrade ?? '·'}</b></button>)}</aside>
        {focused?.state === 'REVIEW' ? <section className={styles.machineReview} aria-label="Review proposed grade">
          {reviewError && <p className={styles.error} role="alert">{reviewError}</p>}
          {packet?.key === focused.key && packet.state !== 'PENDING' ? <MachineReportReview key={packet.reportHash} packet={packet} onReadyChange={setImagesReady} onCorrectFinding={() => { if (!busy) void correct(focused); }} brandSrc={`${STAFF_BASE_PATH}/brand/atlas-grading-logo.png`}>
            <div className={styles.reviewActions}><button disabled={busy} onClick={() => void correct(focused)}>{packet.correctionAvailable ? 'Continue final review' : 'Review geometry / make corrections'}</button>
              {!packet.correctionAvailable && <button className={styles.primary} onClick={approve} disabled={busy || !imagesReady || !packet.canCertify}>{busy ? 'Saving your review…' : packet.resumeAvailable ? 'Finish approval & print' : 'Approve & print next'}</button>}</div>
            {packet.report?.calculationState === 'GEOMETRY_UNRESOLVED' || packet.reviewRequiredReason === 'BATCH_FINAL_GEOMETRY_REQUIRED'
              ? <p role="status">{messages.BATCH_FINAL_GEOMETRY_REQUIRED}</p>
              : packet.reviewRequiredReason === 'BATCH_PROPOSAL_REVIEW_REQUIRED'
              ? <p role="status">{messages.BATCH_PROPOSAL_REVIEW_REQUIRED}{' '}<button disabled={busy} onClick={() => void correct(focused)}>Review observations</button></p>
              : packet.correctionAvailable ? <p>Current corrections are saved. Continue final review to approve the exact updated report.</p> : !packet.canCertify && <p>A trained reviewer is required to approve this card.</p>}
          </MachineReportReview> : <div className={styles.empty}><p>{reviewError ? 'Open the current card to continue.' : packet?.state === 'PENDING' ? 'Preparation or measurement is incomplete. Open the card workspace to retry preparation, restore the previous outline or finish pending findings.' : 'Loading the exact grading evidence…'}</p><button onClick={() => open(focused)}>Open card workspace</button></div>}
        </section> : focused ? <section className={styles.focus} aria-label="Selected card">
          <div className={styles.focusHeader}><div><p>{focused.state === 'REVIEW' ? 'MACHINE DRAFT · HUMAN REVIEW' : status[focused.state]}</p><h2>{focused.evidence?.name || focused.label || 'Card review'}</h2></div>{Number.isFinite(focused.evidence?.proposedGrade) && <div className={styles.grade}><strong>{focused.evidence.proposedGrade}</strong><span>PROPOSED</span></div>}</div>
          <div className={styles.photos}>{['FRONT', 'BACK'].map(side => <figure key={`${focused.key}:${side}`}><QueuePhoto job={focused} side={side} readPreview={readPreview}/><figcaption>{side}</figcaption></figure>)}</div>
          <footer className={styles.actions}><span>{focused.state === 'REVIEW' ? `${focused.evidence.findingCount ?? 0} proposed findings` : messages[focused.code] ?? stages[focused.stage]}<small>↑ ↓ select · Enter review</small></span>
            {focused.canResumeProcessing && <button disabled={busy} onClick={() => resume(focused)}>{busy ? 'Resuming…' : 'Resume saved processing'}</button>}
            <button disabled={busy} className={styles.primary} onClick={() => open(focused)}>{focused.state === 'NEEDS_ATTENTION' ? 'Check card' : 'Review card'} <span aria-hidden="true">↗</span></button></footer>
        </section> : <section className={styles.empty}><span aria-hidden="true">◇</span><h2>{loaded ? tab === 'REVIEW' ? 'Your next review lands here.' : 'All clear.' : 'Loading saved work…'}</h2><p>{tab === 'REVIEW' ? 'Finished ATLAS drafts appear automatically.' : 'Every card keeps its own progress.'}</p></section>}
      </div>}
    </main>
  </Shell>;
}
