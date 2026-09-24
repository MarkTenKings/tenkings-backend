import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../lib/client.mjs';
import { createBrowserIntakeJournal, createCustomerUploader } from '../../lib/intake-journal.mjs';
import ProfileFields, { completeProfile, emptyProfile } from './ProfileFields.jsx';
import ServiceChoice from './ServiceChoice.jsx';
import CommerceCheckout from '../commerce/CommerceCheckout.jsx';
import CustomerOrderTracking from '../orders/CustomerOrderTracking.jsx';

const blankIdentity = { category: 'SPORTS', title: '', playerName: '', year: '', manufacturer: '', setName: '', cardNumber: '', parallel: '', insert: '' };
const status = { UPLOADING: 'Saving photos', QUEUED: 'Waiting for identification', PROCESSING: 'Identifying your card', READY: 'Details ready to review', ATTENTION: 'Check the details', UNKNOWN: 'Identification needs attention' };
function ReviewCard({ card, onCorrect, busy }) {
  const [editing, setEditing] = useState(false), [identity, setIdentity] = useState({ ...blankIdentity, ...card.identity });
  useEffect(() => { if (!editing) setIdentity({ ...blankIdentity, ...card.identity }); }, [card.identity, editing]);
  return <article className="panel intake-review-card"><div className="card-heading"><div><span className="eyebrow">{status[card.identityState] ?? 'Saved card'}</span><h3>{card.identity?.title || 'Card details pending'}</h3></div><button type="button" className="text-link" onClick={() => setEditing(!editing)}>{editing ? 'Cancel correction' : 'Check / correct details'}</button></div>
    {card.identity && <p>{[card.identity.playerName, card.identity.year, card.identity.setName, card.identity.parallel, card.identity.cardNumber && `#${card.identity.cardNumber}`].filter(Boolean).join(' · ')}</p>}
    {card.warnings?.map(warning => <p className="fine" key={warning}>{warning}</p>)}
    {editing && <form className="fields" onSubmit={async event => { event.preventDefault(); if (await onCorrect(card, identity)) setEditing(false); }}>
      <label><span>Category</span><select value={identity.category} onChange={event => setIdentity({ ...identity, category: event.target.value })}><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
      {[['title', 'Card description'], ['playerName', 'Player / character'], ['year', 'Year'], ['manufacturer', 'Manufacturer'], ['setName', 'Set'], ['cardNumber', 'Card number'], ['parallel', 'Parallel / variant'], ['insert', 'Insert']].map(([key, label]) => <label key={key}><span>{label}</span><input value={identity[key]} required={key === 'title'} maxLength={180} onChange={event => setIdentity({ ...identity, [key]: event.target.value })}/></label>)}<button className="primary" disabled={busy}>Save correction</button>
    </form>}
  </article>;
}
export default function CustomerIntake({ customer, csrf, initialService = null, onCustomer }) {
  const [service, setService] = useState(initialService), [draft, setDraft] = useState(null), [drafts, setDrafts] = useState([]), [profile, setProfile] = useState({ ...emptyProfile, ...customer.profile });
  const [paidOrder,setPaidOrder]=useState(null);
  const [step, setStep] = useState('START'), [saved, setSaved] = useState(null), [front, setFront] = useState(null), [back, setBack] = useState(null), [capture, setCapture] = useState(false);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const uploader = useRef(null), frontInput = useRef(null), backInput = useRef(null), createId = useRef(null), generation = useRef(0), entryStarted = useRef(false);
  const api = useCallback((path, options = {}) => request(path.replace(/^\/api\/customer/, ''), { ...options, csrf }), [csrf]);
  const paid = useCallback(order => { setPaidOrder(order); try { window.sessionStorage.removeItem(`atlas-intake-create:${customer.id}`); window.sessionStorage.removeItem('atlas-submission-service-v1'); } catch {} }, [customer.id]);
  const acceptDraft = useCallback(next => setDraft(old => !old || old.id !== next.id || next.revision >= old.revision ? next : old), []);
  async function work(operation) { if (busy) return false; setBusy(true); setError(''); try { await operation(); return true; } catch (failure) { setError(failure.message); return false; } finally { setBusy(false); } }
  useEffect(() => { let alive = true; api('/intake/drafts').then(result => { if (alive) setDrafts(result.drafts); }).catch(failure => { if (alive) setError(failure.message); }); return () => { alive = false; }; }, [api]);
  useEffect(() => {
    if (entryStarted.current || !initialService || (initialService.intakeMethod === 'DEALER_DROP_OFF' && !initialService.kioskId)) return;
    entryStarted.current = true; setService(initialService); work(() => start(initialService));
  }, [initialService]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!draft?.id) return;
    const token = ++generation.current;
    let journal;
    try {
      journal = createBrowserIntakeJournal({ accountId: customer.id, draftId: draft.id });
      const queue = createCustomerUploader({ draftId: draft.id, journal, request: api,
        onProgress: value => { if (generation.current === token) setSaved(value); }, onSaved: value => { if (generation.current === token) acceptDraft(value); } });
      uploader.current = queue; queue.resume().catch(failure => { if (generation.current === token) setError(failure.message); });
      return () => { generation.current = token + 1; queue.dispose(); queue.whenIdle().finally(() => journal.close()); uploader.current = null; };
    } catch { setError('This browser could not save photos. Free device storage or use another browser before taking photographs.'); }
  }, [draft?.id, customer.id, api, acceptDraft]);
  useEffect(() => {
    if (!draft?.id) return;
    let alive = true;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') api(`/intake/drafts/${draft.id}`).then(result => { if (alive) acceptDraft(result.draft); }).catch(() => {}); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [draft?.id, api, acceptDraft]);
  useEffect(() => {
    if (!front || !back || saving || !uploader.current) return;
    let alive = true;
    setSaving(true); setError('');
    uploader.current.appendPair(front, back).then(() => {
      if (!alive) return; setFront(null); setBack(null); setCapture(false); if (frontInput.current) frontInput.current.value = ''; if (backInput.current) backInput.current.value = '';
    }).catch(failure => { if (alive) setError(failure.code === 'BROWSER_SAVE_UNAVAILABLE' ? 'Your photos could not be saved on this device. They remain selected; free space and try again.' : failure.message); }).finally(() => { if (alive) setSaving(false); });
    return () => { alive = false; };
  }, [front, back]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = saved?.items.filter(item => !item.done) ?? [], selected = Boolean(service && (service.intakeMethod === 'MAIL_IN' || service.kioskId));
  function openDraft(value) { setDraft(value); setService({ intakeMethod: value.intakeMethod, kioskId: value.kioskId }); setStep(['REVIEW', 'ORDERED'].includes(value.state) ? 'CHECKOUT' : completeProfile(profile) ? 'CAPTURE' : 'PROFILE'); }
  async function start(chosen = service) {
    if (!completeProfile(profile)) { setStep('PROFILE'); return; }
    const key = `atlas-intake-create:${customer.id}`;
    if (!createId.current) {
      try { const retained = JSON.parse(window.sessionStorage.getItem(key)); if (retained?.requestId && retained.intakeMethod === chosen.intakeMethod && retained.kioskId === chosen.kioskId) createId.current = retained; } catch {}
      createId.current ??= { requestId: crypto.randomUUID(), ...chosen };
      window.sessionStorage.setItem(key, JSON.stringify(createId.current));
    }
    const result = await api('/intake/drafts', { body: createId.current }); openDraft(result.draft);
  }
  const readyForCheckout = draft?.cards.length > 0 && pending.length === 0 && draft.cards.every(card => card.identity && ['FRONT', 'BACK'].every(side => card.uploads?.[side]?.state === 'VERIFIED'));
  return <div className="customer-intake">{error && <div role="alert" className="error">{error}</div>}
    {step === 'START' ? <><ServiceChoice value={service} onChange={value => { createId.current = null; setService(value); }}/><button className="primary" disabled={busy || !selected} onClick={() => work(start)}>Continue</button>
      {drafts.length > 0 && <section className="panel saved-intakes"><h2>Your saved card submissions</h2>{drafts.map(value => <button className="secondary" key={value.id} onClick={() => openDraft(value)}>Resume {value.cards.length} cards · {value.intakeMethod === 'MAIL_IN' ? 'Mail-in' : 'Kiosk'}</button>)}</section>}</> : step === 'PROFILE' ? <form className="panel profile-form" onSubmit={event => { event.preventDefault(); work(async () => { const result = await api('/profile', { body: { profile } }); onCustomer(result.customer); if (draft) setStep('CAPTURE'); else await start(); }); }}>
      <span className="eyebrow">Your receipt and return address</span><h1>Complete your details.</h1><p>We save these for next time. You can review them before payment.</p><ProfileFields value={profile} onChange={setProfile} disabled={busy}/><button className="primary" disabled={busy}>Save and add cards</button>
    </form> : step === 'CHECKOUT' ? <><CommerceCheckout draft={draft} request={api} onBack={() => setStep('REVIEW')} onPaid={paid}/>{paidOrder?.id&&<CustomerOrderTracking orderId={paidOrder.id} csrf={csrf} request={api}/>}</> : <>
      <div className="section-heading"><div><span className="eyebrow">{draft?.intakeMethod === 'MAIL_IN' ? '$40/card · Mail-in · Two weeks' : '$50/card · One week from ATLAS pickup'}</span><h1>{step === 'REVIEW' ? 'Review your cards.' : 'One card. Two photos.'}</h1><p>{step === 'REVIEW' ? 'Check the identified details before continuing to checkout.' : 'Photograph the front, then the back of the same card. We’ll fill in the details.'}</p></div><button className="text-link" onClick={() => setStep('PROFILE')}>Edit your details</button></div>
      {step === 'CAPTURE' && <section className="panel camera-panel">
        <input className="camera-file" aria-label="Front photo" ref={frontInput} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" capture="environment" disabled={saving} onChange={event => { if (event.target.files?.[0]) { setFront(event.target.files[0]); setCapture(true); } }}/>
        <input className="camera-file" aria-label="Back photo" ref={backInput} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" capture="environment" disabled={saving} onChange={event => { if (event.target.files?.[0]) setBack(event.target.files[0]); }}/>
        {saving ? <p role="status">Saving both original photos on your device…</p> : !capture ? <button className="primary add-card" onClick={() => { setCapture(true); frontInput.current?.click(); }}>＋ Add card</button> : !front ? <button className="primary add-card" onClick={() => frontInput.current?.click()}>Take front photo</button> : <><p>Front saved for this pair. Turn the same card over.</p><button className="primary add-card" onClick={() => backInput.current?.click()}>Take back photo</button><button className="text-link" onClick={() => frontInput.current?.click()}>Retake front</button></>}
        <p className="fine">Use a flat surface, include all four corners and avoid glare. Keep this page open until photos are saved to ATLAS. Your originals stay unchanged.</p>
        <div className="intake-count"><strong>{Math.max(draft.cards.length, saved?.items.filter(item => !item.cancelled).length ?? 0)} cards added</strong><span>{pending.length ? `${pending.length} photo pairs saving` : 'All uploaded photos saved'}</span></div>
        {pending.filter(item => item.error === 'DISTINCT_CARD_SIDES_REQUIRED').map(item => <div className="notice" key={item.requestId}><p>This pair contains the same photo twice. Remove it and photograph the front and back separately.</p><button className="secondary" onClick={() => work(() => uploader.current.discardUnsent(item.requestId))}>Remove this unsent pair</button></div>)}
        {pending.some(item => item.error) && <button className="secondary" onClick={() => work(() => uploader.current?.resume())}>Resume saved uploads</button>}
        <button className="secondary" disabled={!draft.cards.length || saving || Boolean(front) || Boolean(back)} onClick={() => setStep('REVIEW')}>Done · Review cards</button>
      </section>}
      {step === 'REVIEW' && <><div className="intake-review-list">{draft.cards.map(card => <ReviewCard key={card.id} card={card} busy={busy} onCorrect={(card, identity) => work(async () => { const result = await api(`/intake/drafts/${draft.id}/cards/${card.id}/correct`, { body: { expectedRevision: card.revision, identity } }); acceptDraft(result.draft); })}/>)}</div>
        {pending.length > 0 && <p role="status">Wait for {pending.length} saved photo pairs to finish uploading before checkout.</p>}
        <div className="intake-actions"><button className="secondary" onClick={() => setStep('CAPTURE')}>Add more cards</button><button className="primary" disabled={busy || !readyForCheckout} onClick={() => work(async () => { const result = await api(`/intake/drafts/${draft.id}/review`, { body: { expectedRevision: draft.revision, profile } }); acceptDraft(result.draft); setStep('CHECKOUT'); })}>Continue to checkout</button></div>
      </>}
    </>}
  </div>;
}
