import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../lib/client.mjs';
import { createBrowserIntakeJournal, createCustomerUploader } from '../../lib/intake-journal.mjs';
import ProfileFields, { completeProfile, emptyProfile } from './ProfileFields.jsx';
import ServiceChoice from './ServiceChoice.jsx';
import CommerceCheckout from '../commerce/CommerceCheckout.jsx';
import CustomerOrderTracking from '../orders/CustomerOrderTracking.jsx';
import RapidCardCamera from '../../../atlas-shared/RapidCardCamera.jsx';
import { createCaptureBuffer } from '../../lib/capture-buffer.mjs';
import { captureCounts, connectCapturedDraft } from '../../lib/capture-state.mjs';
import SubmissionProgress from './SubmissionProgress.jsx';

const blankIdentity = { category: 'SPORTS', title: '', playerName: '', year: '', manufacturer: '', setName: '', cardNumber: '', parallel: '', insert: '' };
const status = { UPLOADING: 'Saving photos', QUEUED: 'Waiting for identification', PROCESSING: 'Identifying your card', READY: 'Details ready to review', ATTENTION: 'Check the details', UNKNOWN: 'Identification needs attention' };
function ReviewCard({ card, onCorrect, busy, editable = true }) {
  const [editing, setEditing] = useState(false), [identity, setIdentity] = useState({ ...blankIdentity, ...card.identity });
  useEffect(() => { if (!editing) setIdentity({ ...blankIdentity, ...card.identity }); }, [card.identity, editing]);
  return <article className="panel intake-review-card"><div className="card-heading"><div><span className="eyebrow">{status[card.identityState] ?? 'Saved card'}</span><h3>{card.identity?.title || 'Card details pending'}</h3></div>{editable && <button type="button" className="text-link" onClick={() => setEditing(!editing)}>{editing ? 'Cancel correction' : 'Check / correct details'}</button>}</div>
    {card.identity && <p>{[card.identity.playerName, card.identity.year, card.identity.setName, card.identity.parallel, card.identity.cardNumber && `#${card.identity.cardNumber}`].filter(Boolean).join(' · ')}</p>}
    {card.warnings?.map(warning => <p className="fine" key={warning}>{warning}</p>)}
    {editing && <form className="fields" onSubmit={async event => { event.preventDefault(); if (await onCorrect(card, identity)) setEditing(false); }}>
      <label><span>Category</span><select value={identity.category} onChange={event => setIdentity({ ...identity, category: event.target.value })}><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
      {[['title', 'Card description'], ['playerName', 'Player / character'], ['year', 'Year'], ['manufacturer', 'Manufacturer'], ['setName', 'Set'], ['cardNumber', 'Card number'], ['parallel', 'Parallel / variant'], ['insert', 'Insert']].map(([key, label]) => <label key={key}><span>{label}</span><input value={identity[key]} required={key === 'title'} maxLength={180} onChange={event => setIdentity({ ...identity, [key]: event.target.value })}/></label>)}<button className="primary" disabled={busy}>Save correction</button>
    </form>}
  </article>;
}
function PhotoThumb({ file, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (!file) { setUrl(null); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url && file ? <img src={url} alt={label}/> : <span className="captured-photo-check" aria-label={label}>✓</span>;
}
export default function CustomerIntake({ customer, csrf, initialService = null, onCustomer }) {
  const [service, setService] = useState(initialService), [draft, setDraft] = useState(null), [drafts, setDrafts] = useState([]);
  const [profile, setProfile] = useState({ ...emptyProfile, ...customer.profile }), [step, setStep] = useState('START');
  const [local, setLocal] = useState(null), [saved, setSaved] = useState(null), [camera, setCamera] = useState(false), [fileSide, setFileSide] = useState('FRONT');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [intakeAvailable, setIntakeAvailable] = useState(null), [paidOrder, setPaidOrder] = useState(null), [ownsCapture, setOwnsCapture] = useState(false);
  const buffer = useRef(null), uploader = useRef(null), fileInput = useRef(null), gate = useRef(false), active = useRef(true), flushTail = useRef(Promise.resolve()), creating = useRef(null);
  const api = useCallback((path, options = {}) => request(path.replace(/^\/api\/customer/, ''), { ...options, csrf }), [csrf]);
  const acceptDraft = useCallback(next => setDraft(old => !old || old.id !== next.id || next.revision >= old.revision ? next : old), []);
  async function work(operation) { if (gate.current) return false; gate.current = true; setBusy(true); setError(''); try { await operation(); return true; } catch (failure) { setError(failure.message); return false; } finally { gate.current = false; setBusy(false); } }
  useEffect(() => {
    active.current = true; let release, journal, alive = true; const abort = new AbortController();
    if (!navigator.locks?.request) { setError('This browser cannot protect a saved capture session. Use an updated Safari or Chrome browser.'); return; }
    navigator.locks.request(`atlas-customer-capture:${customer.id}`, { signal: abort.signal }, async () => {
      if (!alive) return;
      try {
        journal = createCaptureBuffer({ accountId: customer.id }); buffer.current = journal;
        const value = await journal.snapshot(); if (!alive) return;
        setLocal(value); setOwnsCapture(true);
        if (value.service) setService(value.service);
        if (value.pairIds.length || value.front) setStep('CAPTURE');
        await new Promise(resolve => { release = resolve; });
      } catch (failure) { if (alive) setError(failure.code === 'PHOTO_STORAGE_QUOTA' ? 'This device has reached its photo storage limit. Keep ATLAS site data intact and free device space before trying again.' : 'Your saved photos could not be opened. Keep ATLAS site data intact and reload to try again.'); }
      finally { await journal?.close(); }
    }).catch(failure => { if (alive && failure.name !== 'AbortError') setError('Your saved camera session could not be opened. Reload to try again.'); });
    return () => { alive = false; active.current = false; abort.abort(); release?.(); buffer.current = null; };
  }, [customer.id, api, acceptDraft]);
  useEffect(() => {
    let alive = true;
    api('/intake/drafts').then(result => { if (alive) { setDrafts(result.drafts); setIntakeAvailable(true); } }).catch(failure => {
      if (!alive) return; setIntakeAvailable(false); if (!['CUSTOMER_SERVICE_DISABLED','INTAKE_CONFIGURATION_REQUIRED','INTAKE_DISABLED','SERVICE_UNAVAILABLE','NOT_FOUND','CUSTOMER_INTAKE_DISABLED'].includes(failure.code)) setError('Saved online submissions are unavailable. Photos you capture here can still be saved on this device.');
    }); return () => { alive = false; };
  }, [api]);
  const flush = useCallback(() => {
    flushTail.current = flushTail.current.then(async () => {
      if (!uploader.current || !buffer.current) return;
      const current = await buffer.current.snapshot();
      for (const pair of current.pairs) if (!pair.uploaded && pair.files) await uploader.current?.appendPair(pair.files.FRONT, pair.files.BACK, pair);
    }).catch(failure => { if (active.current) setError(failure.message); });
    return flushTail.current;
  }, []);
  useEffect(() => {
    if (!draft?.id || !ownsCapture) return;
    let alive = true; const acknowledged = new Set(); const journal = createBrowserIntakeJournal({ accountId: customer.id, draftId: draft.id });
    const queue = createCustomerUploader({ draftId: draft.id, journal, request: api,
      onProgress: value => {
        if (!alive) return; setSaved(value);
        for (const pair of value.items) if (pair.done && !pair.cancelled && !acknowledged.has(pair.requestId)) {
          acknowledged.add(pair.requestId);
          buffer.current?.uploaded(pair.requestId).then(() => { if (alive) setLocal(current => current ? { ...current, pairs: current.pairs.map(item => item.requestId === pair.requestId ? { ...item, uploaded: true, files: null } : item) } : current); }).catch(() => acknowledged.delete(pair.requestId));
        }
      },
      onSaved: value => { if (alive) acceptDraft(value); } });
    uploader.current = queue; queue.resume().catch(failure => { if (alive) setError(failure.message); }); flush();
    return () => { alive = false; queue.dispose(); if (uploader.current === queue) uploader.current = null; queue.whenIdle().finally(() => journal.close()); };
  }, [draft?.id, customer.id, api, acceptDraft, flush, ownsCapture]);
  useEffect(() => {
    if (!draft?.id) return; let alive = true;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') api(`/intake/drafts/${draft.id}`).then(result => { if (alive) acceptDraft(result.draft); }).catch(() => {}); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [draft?.id, api, acceptDraft]);
  useEffect(() => {
    if (!initialService || !local || local.service || step !== 'START') return;
    if (initialService.intakeMethod === 'MAIL_IN' || initialService.kioskId) begin(initialService);
  }, [initialService, local]); // eslint-disable-line react-hooks/exhaustive-deps
  async function connectDraft() {
    if (!buffer.current || draft || intakeAvailable !== true) return;
    if (creating.current) return creating.current;
    const owner = buffer.current;
    creating.current = connectCapturedDraft({ buffer: owner, request: api }).then(next => {
      if (!next || !active.current || buffer.current !== owner) return;
      acceptDraft(next);
      if (['REVIEW', 'ORDERED'].includes(next.state)) setStep('CHECKOUT');
    }).finally(() => { creating.current = null; });
    return creating.current;
  }
  async function begin(chosen = service) {
    const value = await buffer.current.setService(chosen); setLocal(value); setService(chosen); setStep('CAPTURE'); setCamera(true);
    connectDraft().catch(() => setIntakeAvailable(false));
  }
  async function capturePhoto(file) {
    if (!buffer.current || !ownsCapture) throw Error('Your saved camera session is unavailable.');
    const next = await buffer.current.capture(local?.front ? 'BACK' : 'FRONT', file);
    setLocal(next); setFileSide(next.front ? 'BACK' : 'FRONT'); flush();
  }
  async function openDraft(value) {
    const current = await buffer.current.snapshot();
    if (current.pairIds.length && current.draftId !== value.id) throw Error('Finish your saved photos before switching to another submission.');
    const choice = { intakeMethod: value.intakeMethod, kioskId: value.kioskId };
    await buffer.current.setService(choice); setLocal(await buffer.current.attachDraft(value.id)); setService(choice); setDraft(value); setStep(['REVIEW','ORDERED'].includes(value.state) ? 'CHECKOUT' : 'CAPTURE');
  }
  useEffect(() => { if (local?.service && intakeAvailable === true && !draft) connectDraft().catch(() => setIntakeAvailable(false)); }, [local?.service, intakeAvailable, draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = saved?.items.filter(item => !item.done) ?? [];
  const { count, waitingCount, ready } = captureCounts(draft, local);
  const reviewLocked = ['REVIEW', 'ORDERED'].includes(draft?.state);
  const readyForCheckout = ready && pending.length === 0;
  const stageNumber = step === 'START' ? 1 : step === 'CAPTURE' ? 2 : step === 'PROFILE' ? 3 : 4;
  const selected = Boolean(service && (service.intakeMethod === 'MAIL_IN' || service.kioskId));
  const localOnly = !draft;
  return <div className="customer-intake">
    <SubmissionProgress current={stageNumber}/>
    {!ownsCapture && <p className="fine" role="status">Opening your saved photos. If this submission is open in another tab, close that tab to continue here.</p>}
    {error && <div role="alert" className="error">{error}</div>}
    {step === 'START' ? <><ServiceChoice value={service} onChange={setService}/><div className="wizard-footer"><p>Next up: your camera. We’ll handle the card details.</p><button className="primary" disabled={busy || !selected || !ownsCapture} onClick={() => work(() => begin())}>Continue to camera <span aria-hidden="true">→</span></button></div>
      {drafts.length > 0 && <section className="saved-intakes"><h2>Pick up where you left off</h2>{drafts.map(value => <button className="secondary" key={value.id} onClick={() => work(() => openDraft(value))}>Resume {value.cards.length} cards · {value.intakeMethod === 'MAIL_IN' ? 'Mail-in' : 'Kiosk'}</button>)}</section>}</> : step === 'PROFILE' ? <form className="panel profile-form" onSubmit={event => { event.preventDefault(); work(async () => { const result = await api('/profile', { body: { profile } }); onCustomer(result.customer); await connectDraft(); setStep('REVIEW'); }); }}>
      <span className="eyebrow">03 / Your details</span><h1>Where should they return?</h1><p>Your cards are saved. Add your receipt and return details once, and we’ll remember them for next time.</p><ProfileFields value={profile} onChange={setProfile} disabled={busy}/><div className="intake-actions"><button type="button" className="secondary" onClick={() => setStep('CAPTURE')}>Back to cards</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Review submission →'}</button></div>
    </form> : step === 'CHECKOUT' ? <><CommerceCheckout draft={draft} request={api} onBack={() => setStep('REVIEW')} onPaid={order => { setPaidOrder(order); buffer.current?.clearPaid(); try { window.sessionStorage.removeItem('atlas-submission-service-v1'); } catch {} }}/>{paidOrder?.id && <CustomerOrderTracking orderId={paidOrder.id} csrf={csrf} request={api}/>}</> : <>
      <div className="section-heading capture-heading"><div><span className="eyebrow">{step === 'REVIEW' ? '04 / Looking good' : '02 / Photo sprint'}</span><h1>{step === 'REVIEW' ? 'Meet your lineup.' : 'Front. Back. Next.'}</h1><p>{step === 'REVIEW' ? 'ATLAS fills in the card details from your photos. Check them here before payment.' : 'Keep the cards coming. Uploading and identification happen in the background.'}</p></div><span className="capture-total">{count}<small>{count === 1 ? 'CARD' : 'CARDS'}</small></span></div>
      {step === 'CAPTURE' && <>
        <div className="capture-launch"><div className="capture-outline" aria-hidden="true"><span>ATLAS</span><span>＋</span><small>FRONT + BACK</small></div><div><span className="eyebrow">No typing. No naming files.</span><h2>Point. Flip. Keep going.</h2><p>Fill the guide with one card. Take the front, flip it over, then take the back. The camera stays ready for your next card.</p><button className="primary add-card" disabled={!ownsCapture || count >= 100} onClick={() => setCamera(true)}>{local?.front ? 'Continue with the back' : count ? 'Keep capturing' : 'Open camera'} <span aria-hidden="true">↗</span></button><button className="text-link" onClick={() => { setFileSide(local?.front ? 'BACK' : 'FRONT'); fileInput.current?.click(); }} disabled={!ownsCapture}>Choose {local?.front ? 'back' : 'front'} from photos</button></div></div>
        <input className="camera-file" aria-label={`${fileSide === 'FRONT' ? 'Front' : 'Back'} photo`} ref={fileInput} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) work(() => capturePhoto(file)); event.target.value = ''; }}/>
        {camera && <RapidCardCamera side={local?.front ? 'BACK' : 'FRONT'} cardLabel={`Card ${count + 1}`} completedPairs={count} disabled={!ownsCapture || count >= 100} autoStart onCapture={capturePhoto} onClose={() => setCamera(false)}/>}
        <div className="capture-save-status" role="status"><span className="save-dot"/><strong>{count} {count === 1 ? 'pair' : 'pairs'} saved{localOnly ? ' on this device' : ''}</strong><span>{localOnly ? intakeAvailable === false ? 'Online upload is not available yet.' : 'Connecting your saved photos to ATLAS…' : waitingCount ? `${waitingCount} uploading · camera ready` : count ? 'All pairs verified at ATLAS' : 'Ready for your first card'}</span></div>
        {local?.front && !camera && <div className="notice"><p>Front saved on this device. Capture the back of the same card to complete the pair.</p><button className="text-link" onClick={() => work(async () => { setLocal(await buffer.current.discardFront()); setFileSide('FRONT'); setCamera(true); })}>Retake this front</button></div>}
        <div className="captured-strip" aria-label="Captured card pairs">{local?.pairs.map((pair, index) => <div key={pair.requestId} className="captured-pair"><PhotoThumb file={pair.files?.FRONT} label={`Card ${index + 1} front`}/><PhotoThumb file={pair.files?.BACK} label={`Card ${index + 1} back`}/><span>{String(index + 1).padStart(2,'0')}</span></div>)}</div>
        {pending.filter(item => item.error === 'DISTINCT_CARD_SIDES_REQUIRED').map(item => <div className="notice" key={item.requestId}><p>These two photos are identical. Remove this unsent pair and capture the front and back separately.</p><button className="secondary" onClick={() => work(async () => { await uploader.current.discardUnsent(item.requestId); setLocal(await buffer.current.discardUnsentPair(item.requestId)); })}>Remove unsent pair</button></div>)}
        {pending.some(item => item.error) && <button className="secondary" onClick={() => work(() => uploader.current?.resume())}>Resume saved uploads</button>}
        <div className="wizard-footer"><p>Photos stay saved on this device until their upload is confirmed. Keep this page open for background uploads.</p><button className="primary" disabled={!count || Boolean(local?.front) || busy} onClick={() => { setCamera(false); setStep(completeProfile(profile) ? 'REVIEW' : 'PROFILE'); }}>Done adding cards →</button></div>
      </>}
      {step === 'REVIEW' && <><div className="review-service-summary"><strong>{service?.intakeMethod === 'MAIL_IN' ? 'Mail-in · $40 per card' : 'Kiosk drop-off · $50 per card'}</strong><span>{service?.intakeMethod === 'MAIL_IN' ? 'Two-week service · FedEx quoted before payment' : 'One week from ATLAS collection · transport included'}</span></div>
        <div className="intake-review-list">{draft?.cards.map(card => <ReviewCard key={card.id} card={card} busy={busy} editable={!reviewLocked} onCorrect={(card, identity) => work(async () => { const result = await api(`/intake/drafts/${draft.id}/cards/${card.id}/correct`, { body: { expectedRevision: card.revision, identity } }); acceptDraft(result.draft); })}/>)}</div>
        {localOnly && <section className="panel local-draft-notice"><h2>Your {count} {count === 1 ? 'card is' : 'cards are'} saved on this device.</h2><p>Online photo submission is not available yet. Automatic identification and checkout will become available when ATLAS opens this service. You have not placed an order or been charged.</p><button className="secondary" onClick={() => work(async () => { const result = await api('/intake/drafts'); setDrafts(result.drafts); setIntakeAvailable(true); })}>Check availability</button></section>}
        {pending.length > 0 && <p role="status">{pending.length} pairs are still uploading. You can keep adding cards while they finish.</p>}
        <div className="intake-actions">{!reviewLocked && <><button className="secondary" onClick={() => setStep('CAPTURE')}>Add more cards</button><button className="text-link" onClick={() => setStep('PROFILE')}>Edit return details</button></>}<button className="primary" disabled={busy || !readyForCheckout} onClick={() => work(async () => { if (reviewLocked) { setStep('CHECKOUT'); return; } const result = await api(`/intake/drafts/${draft.id}/review`, { body: { expectedRevision: draft.revision, profile } }); acceptDraft(result.draft); setStep('CHECKOUT'); })}>Continue to checkout →</button></div>
      </>}
    </>}
  </div>;
}
