import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { custodyNames, journalLock } from '../lib/customer-operations.mjs';
import { ORDER_DESK_POLL_MS, ORDER_STAGES, acknowledgmentConfirmed, acknowledgmentJournal, cardSubtitle, cardTitle, isAccessFailure, mergeOrderPage, orderDate, orderDeskMessage, orderDeskPath, orderDetailPath, orderLabelBytes, orderMoney, orderPhotoPath, retainedSelection, stageLabel } from '../lib/order-desk-client.mjs';
import styles from './OrderDesk.module.css';

const words = value => typeof value === 'string' ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, v => v.toUpperCase()) : 'Not recorded';
const count = (n, label) => `${n} ${label}${n === 1 ? '' : 's'}`;
const customerName = order => order.customer?.name || 'Customer name not recorded';
const newOrder = order => !acknowledgmentConfirmed(order);
const photoReady = (card, side) => card?.photos?.[side]?.state === 'READY';
const shippingUnpaid = order => ['UNQUOTED_UNPAID', 'UNQUOTED', 'UNPAID', 'NOT_QUOTED', 'AWAITING_PAYMENT', 'PAYMENT_REQUIRED'].includes(order.shippingPayment?.state);
const shippingConcern = order => shippingUnpaid(order) ? 'Shipping unquoted or unpaid' : ({ UNKNOWN: 'Shipping payment outcome unconfirmed', FAILED: 'Shipping payment needs attention', PROCESSING: 'Shipping payment processing', NOT_RECORDED: 'Shipping payment not recorded' }[order.shippingPayment?.state] ?? '');

export default function OrderDesk({ staff, disabled = false, readDisabled = false, onAction, renderCardActions, renderReturnShipping, request = api, active = true }) {
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [stage, setStage] = useState('all'), [view, setView] = useState('all');
  const [queue, setQueue] = useState({ orders: [], counts: null, nextCursor: null }), [loading, setLoading] = useState(true), [updating, setUpdating] = useState(false), [error, setError] = useState(''), [accessLost, setAccessLost] = useState(false), [updatedAt, setUpdatedAt] = useState(null);
  const [selectedId, setSelectedId] = useState(null), [details, setDetails] = useState({}), [detailErrors, setDetailErrors] = useState({}), [mobileDetail, setMobileDetail] = useState(false);
  const [pendingAck, setPendingAck] = useState(null), [ackReady, setAckReady] = useState(false), [ackBusy, setAckBusy] = useState(false), [ackError, setAckError] = useState(''), [ackMessage, setAckMessage] = useState('');
  const selected = useRef(null), queueToken = useRef(0), live = useRef(true), ackStore = useRef(null), ackRunning = useRef(false), queueRequest = useRef(null), detailRequests = useRef(new Map()), refresh = useRef(null), lastRead = useRef(0), filterKey = `${search}\n${stage}\n${view}`;
  const filters = useRef({ q: search, stage, view }); filters.current = { q: search, stage, view };
  useEffect(() => { const timer = setTimeout(() => setSearch(q.trim()), 350); return () => clearTimeout(timer); }, [q]);
  useEffect(() => {
    live.current = true;
    try {
      const saved = retainedSelection(window.sessionStorage, staff.id);
      if (saved) { selected.current = saved; setSelectedId(saved); }
    } catch { /* Selection persistence is optional; never stores customer details. */ }
    try { ackStore.current = acknowledgmentJournal(window.localStorage, staff.id); setPendingAck(ackStore.current.read()); setAckReady(true); }
    catch (e) { setAckError(orderDeskMessage(e)); }
    const changed = event => {
      if (event.key !== ackStore.current?.key) return;
      try { setPendingAck(ackStore.current.read()); } catch (e) { setAckReady(false); setAckError(orderDeskMessage(e)); }
    };
    window.addEventListener('storage', changed);
    return () => { live.current = false; queueRequest.current?.abort(); for (const controller of detailRequests.current.values()) controller.abort(); window.removeEventListener('storage', changed); };
  }, [staff.id]);

  async function readDetail(id) {
    if (!id) return null;
    detailRequests.current.get(id)?.abort();
    const controller = new AbortController(); detailRequests.current.set(id, controller);
    try {
      const data = await request(orderDetailPath(id), { signal: controller.signal });
      if (!live.current || controller.signal.aborted) return null;
      if (data.order?.id !== id) throw new Error('The order reply did not match the selected order.');
      setDetails(old => ({ ...old, [id]: data.order })); setDetailErrors(old => ({ ...old, [id]: '' }));
      return data.order;
    } catch (e) {
      if (live.current && !controller.signal.aborted) {
        if (isAccessFailure(e)) { setAccessLost(true); setDetails({}); setQueue({ orders: [], counts: null, nextCursor: null }); }
        setDetailErrors(old => ({ ...old, [id]: orderDeskMessage(e) }));
      }
      return null;
    } finally { if (detailRequests.current.get(id) === controller) detailRequests.current.delete(id); }
  }
  async function readQueue({ append = false, cursor, initial = false } = {}) {
    const token = ++queueToken.current;
    queueRequest.current?.abort(); const controller = new AbortController(); queueRequest.current = controller;
    setUpdating(true); if (initial) setLoading(true);
    try {
      const data = await request(orderDeskPath({ ...filters.current, ...(append ? { cursor } : {}) }), { signal: controller.signal });
      if (!live.current || token !== queueToken.current || controller.signal.aborted) return;
      if (!Array.isArray(data.orders) || !data.counts) throw new Error('The order queue reply could not be verified.');
      setQueue(old => ({ ...data, orders: mergeOrderPage(old.orders, data.orders, append) })); setError(''); setAccessLost(false); setUpdatedAt(new Date().toISOString()); lastRead.current = Date.now();
      if (!selected.current && data.orders[0]) { selected.current = data.orders[0].id; setSelectedId(data.orders[0].id); }
    } catch (e) {
      if (live.current && token === queueToken.current && !controller.signal.aborted) {
        if (isAccessFailure(e)) { setAccessLost(true); setDetails({}); setQueue({ orders: [], counts: null, nextCursor: null }); }
        setError(orderDeskMessage(e));
      }
    } finally { if (live.current && token === queueToken.current) { setUpdating(false); setLoading(false); } }
  }
  refresh.current = () => { if (!active || document.visibilityState !== 'visible') return; void readQueue(); if (selected.current) void readDetail(selected.current); };
  useEffect(() => { if (active) void readQueue({ initial: !queue.counts }); }, [filterKey, active]);
  useEffect(() => { if (selectedId && active && !accessLost) void readDetail(selectedId); }, [selectedId, active]);
  useEffect(() => {
    if (!active) return;
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - lastRead.current >= 5000) refresh.current?.(); };
    const timer = setInterval(() => { if (!queueRequest.current || queueRequest.current.signal.aborted || Date.now() - lastRead.current >= ORDER_DESK_POLL_MS) refresh.current?.(); }, ORDER_DESK_POLL_MS);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [active]);
  function selectOrder(id) {
    selected.current = id; setSelectedId(id); setMobileDetail(true);
    try { retainedSelection(window.sessionStorage, staff.id, id); } catch { /* Keep this tab’s selection. */ }
  }
  async function checkAcknowledgment() {
    if (ackRunning.current || !ackStore.current) return;
    ackRunning.current = true; setAckBusy(true); setAckError('');
    try {
      await journalLock(navigator, ackStore.current.key, async () => {
        const saved = ackStore.current.read(); if (!saved) { setPendingAck(null); return; }
        const order = await readDetail(saved.orderId);
        if (order && acknowledgmentConfirmed(order)) { ackStore.current.clear(); setPendingAck(null); setAckMessage('The team acknowledgment is confirmed in the saved order.'); void readQueue(); }
        else setAckMessage('The saved order has not confirmed acknowledgment. The exact request is retained.');
      });
    } catch (e) { setAckError(orderDeskMessage(e)); }
    finally { ackRunning.current = false; if (live.current) setAckBusy(false); }
  }
  async function acknowledge(orderId, retry = false) {
    if (ackRunning.current || !ackReady || accessLost || !ackStore.current) return;
    ackRunning.current = true; setAckBusy(true); setAckError(''); setAckMessage('');
    try {
      const store = ackStore.current;
      await journalLock(navigator, store.key, async () => {
        let saved = store.read(), first = !saved, attempted = false, accepted = false;
        if (!retry && saved) { setPendingAck(saved); throw new Error('Check the retained acknowledgment before acknowledging another order.'); }
        if (retry && (!saved || saved.accepted)) throw new Error('Read the saved order to confirm this acknowledgment.');
        try {
          const session = await request('session');
          if (!session.csrf || session.staff?.id !== staff.id || session.staff.role !== 'REVIEWER') throw new Error('Sign in as the same reviewer before acknowledging this order.');
          if (first) { saved = { version: 1, staffId: staff.id, orderId, requestId: crypto.randomUUID(), accepted: false }; store.save(saved); setPendingAck(saved); }
          attempted = true;
          const result = await request(`${orderDetailPath(saved.orderId)}/acknowledge`, { body: { requestId: saved.requestId }, csrf: session.csrf });
          if (result.orderId !== saved.orderId || result.requestId !== saved.requestId || !['ACKNOWLEDGED', 'ALREADY_ACKNOWLEDGED'].includes(result.outcome) || !acknowledgmentConfirmed(result)) throw new Error('The acknowledgment reply could not be confirmed. Its exact request is retained.');
          accepted = true; saved = { ...saved, accepted: true }; store.save(saved); setPendingAck(saved);
          const order = await readDetail(saved.orderId);
          if (order && acknowledgmentConfirmed(order)) { store.clear(); setPendingAck(null); setAckMessage(result.outcome === 'ALREADY_ACKNOWLEDGED' ? 'A team member has already acknowledged this order.' : 'Order acknowledged for the team.'); }
          else setAckMessage('The server accepted the acknowledgment. Read its saved status to finish checking.');
          void readQueue();
        } catch (e) {
          if (first && !accepted && (!attempted || e.status >= 400 && e.status < 500)) { store.clear(); setPendingAck(null); }
          else if (saved) setPendingAck(saved);
          throw e;
        }
      });
    } catch (e) { setAckError(orderDeskMessage(e)); }
    finally { ackRunning.current = false; if (live.current) setAckBusy(false); }
  }
  async function actionFor(orderId, action, input, metadata = {}) {
    const result = await onAction(action, input, { ...metadata, orderId });
    void readDetail(orderId); void readQueue(); return result;
  }
  return <OrderDeskView {...{ queue, loading, updating, error, accessLost, updatedAt, q, stage, view, selectedId, details, detailErrors, mobileDetail, pendingAck, ackBusy, ackError, ackMessage }} onSearch={setQ} onStage={setStage} onView={setView} onSelect={selectOrder} onBack={() => setMobileDetail(false)} onRefresh={() => { void readQueue(); if (selectedId) void readDetail(selectedId); }} onLoadMore={() => readQueue({ append: true, cursor: queue.nextCursor })} onReadDetail={readDetail} onAcknowledge={acknowledge} onCheckAcknowledgment={checkAcknowledgment} ackDisabled={!ackReady || ackBusy || !!pendingAck || accessLost} disabled={disabled || accessLost} readDisabled={readDisabled || accessLost} onAction={actionFor} renderCardActions={renderCardActions} renderReturnShipping={renderReturnShipping}/>;
}

export function OrderDeskView({ queue, loading, updating, error, accessLost, updatedAt, q, stage, view, selectedId, details, detailErrors = {}, mobileDetail, pendingAck, ackBusy, ackError, ackMessage, onSearch, onStage, onView, onSelect, onBack, onRefresh, onLoadMore, onReadDetail, onAcknowledge, onCheckAcknowledgment, ackDisabled, disabled, readDisabled, onAction, renderCardActions, renderReturnShipping }) {
  const counts = queue.counts, orders = queue.orders ?? [], selectedVisible = orders.some(order => order.id === selectedId), queueRef = useRef(null), backRef = useRef(null);
  useEffect(() => { if (mobileDetail && window.matchMedia('(max-width:700px)').matches) backRef.current?.focus(); }, [mobileDetail]);
  function backToQueue() { onBack(); setTimeout(() => queueRef.current?.querySelector('button[aria-current="true"]')?.focus(), 0); }
  return <section className={`${styles.desk} ${mobileDetail ? styles.mobileDetail : ''}`} aria-label="Customer order desk">
    <div className={styles.overview}><header className={styles.heading}><div><p className={styles.eyebrow}>Customer submissions</p><h1>Order desk</h1><p>Paid orders, customer photographs, and the next recorded step.</p></div><div className={styles.refresh}><button type="button" disabled={updating} onClick={onRefresh}>{updating ? 'Checking…' : 'Refresh'}</button><span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Reading saved orders'}</span></div></header>
      <nav className={styles.stages} aria-label="Filter by recorded card stage">{ORDER_STAGES.map(([key, label]) => <button key={key} type="button" aria-pressed={stage === key} onClick={() => onStage(stage === key ? 'all' : key)}><span>{label}</span><strong>{counts?.groups?.[key] ?? '—'} <small>{counts?.groups?.[key] === 1 ? 'order' : 'orders'}</small></strong></button>)}</nav>
      <div className={styles.service}><span>Order stages follow the earliest incomplete card. Details show each card’s recorded progress.</span><button type="button" aria-pressed={view === 'new'} onClick={() => onView(view === 'new' ? 'all' : 'new')}>New orders <b>{counts?.new ?? '—'}</b></button></div>
    </div>
    {error && <div className={styles.notice} role="alert">{error} {accessLost && <a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a>}</div>}
    {pendingAck && <section className={styles.pending} aria-label="Retained acknowledgment"><strong>{pendingAck.accepted ? 'Acknowledgment accepted · checking saved record' : 'An acknowledgment needs checking'}</strong><p>The exact request is retained. Reading an order does not acknowledge it.</p><div><button type="button" disabled={ackBusy} onClick={onCheckAcknowledgment}>Check saved acknowledgment</button>{!pendingAck.accepted && <button type="button" disabled={ackBusy} onClick={() => onAcknowledge(pendingAck.orderId, true)}>Retry exact acknowledgment</button>}<button type="button" onClick={() => onSelect(pendingAck.orderId)}>Open retained order</button></div></section>}
    {ackError && <p className={styles.notice} role="alert">{ackError}</p>}{ackMessage && <p className={styles.message} role="status">{ackMessage}</p>}
    <div className={styles.workspace}>
      <aside className={styles.queue} ref={queueRef} aria-label="Paid order queue"><div className={styles.queueTools}><nav className={styles.queueTabs} aria-label="Order views">{[['all', 'All orders', counts?.all], ['new', 'New orders', counts?.new]].map(([key, label, n]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => onView(key)}>{label} <span>{n ?? '—'}</span></button>)}</nav><label className={styles.search}><span>Search orders</span><input type="search" value={q} onChange={event => onSearch(event.target.value)} maxLength={120} placeholder="Order, customer, or email"/></label></div>
        <div className={styles.queueLabel}><span>{stage === 'all' ? 'All stages · newest first' : stageLabel(stage)}</span>{stage !== 'all' && <button type="button" onClick={() => onStage('all')}>All stages</button>}</div>
        {loading && !orders.length ? <p className={styles.empty} role="status">Loading paid orders…</p> : !orders.length ? <div className={styles.empty}><h2>{q || stage !== 'all' ? 'No matching orders' : view === 'new' ? 'The team inbox is clear' : 'No paid submissions yet'}</h2><p>{view === 'new' ? 'Orders remain here until a team member explicitly acknowledges them.' : 'Confirmed paid orders appear here with their customer photographs.'}</p></div> : <ul className={styles.orderList}>{orders.map(order => <li key={order.id}><button type="button" className={styles.order} aria-current={selectedId === order.id ? 'true' : undefined} onClick={() => onSelect(order.id)}><span className={styles.orderPhoto}><CustomerPhoto orderId={order.id} card={order.photoCards?.[0]} side="FRONT"/>{order.cardCount > 1 && <small>+{order.cardCount - 1} more</small>}</span><span className={styles.orderCopy}><span className={styles.orderReference}>{order.reference}{newOrder(order) && <i aria-label="Team acknowledgment needed"/>}<span>{count(order.cardCount, 'card')}</span></span><strong>{customerName(order)}</strong><span>{stageLabel(order.stage)}</span><small className={shippingConcern(order) || order.attentionCount > 0 ? styles.warning : ''}>{shippingConcern(order) || (order.attentionCount > 0 ? 'Recorded progress needs attention' : newOrder(order) ? 'Team acknowledgment needed' : 'Grading paid')}</small></span></button></li>)}</ul>}
        {queue.nextCursor && <div className={styles.loadMore}><button type="button" disabled={updating} onClick={onLoadMore}>{updating ? 'Loading…' : 'Load more orders'}</button></div>}
      </aside>
      <div className={styles.inspectorArea}>
        <button type="button" className={styles.mobileBack} ref={backRef} onClick={backToQueue}>← Back to orders</button>
        {selectedId && !selectedVisible && !loading && <p className={styles.selectionContext}>The selected order is kept open outside this queue view.</p>}
        {!selectedId ? <div className={styles.empty}><h2>Select an order</h2><p>Inspect its actual customer photographs and recorded progress.</p></div> : <>
          {detailErrors[selectedId] && <div className={styles.notice} role="alert">{detailErrors[selectedId]}<button type="button" onClick={() => onReadDetail(selectedId)}>Read order again</button></div>}
          {!details[selectedId] && !detailErrors[selectedId] && <p className={styles.empty} role="status">Loading selected order…</p>}
          {Object.values(details).map(order => <div key={order.id} hidden={order.id !== selectedId}><OrderInspector order={order} onAcknowledge={onAcknowledge} ackDisabled={ackDisabled} disabled={disabled} readDisabled={readDisabled} onAction={(...args) => onAction(order.id, ...args)} renderCardActions={renderCardActions} renderReturnShipping={renderReturnShipping}/></div>)}
        </>}
      </div>
    </div>
  </section>;
}

export function CustomerPhoto({ orderId, card, side, size = 'thumbnail', retryKey = 0, onFailure }) {
  const src = photoReady(card, side) ? orderPhotoPath(orderId, card.cardId, side, size) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src, retryKey]);
  return src && !failed ? <img src={src} alt={`${card.title || cardTitle(card)}, customer ${side.toLowerCase()} photograph`} loading="lazy" decoding="async" onError={() => { setFailed(true); onFailure?.(); }}/> : <span className={styles.photoUnavailable}>No photo</span>;
}

function OrderInspector({ order, onAcknowledge, ackDisabled, disabled, readDisabled, onAction, renderCardActions, renderReturnShipping }) {
  const [tab, setTab] = useState('work'), acknowledged = acknowledgmentConfirmed(order), ack = order.acknowledgment;
  return <article className={styles.inspector} aria-label={`Order ${order.reference}`}><header className={styles.detailHeading}><div><p className={styles.eyebrow}>Paid submission · {order.channel === 'KIOSK' ? 'Card shop' : order.channel === 'MAIL_IN' ? 'Mail-in' : words(order.channel)}</p><h2>{order.reference}</h2><p>{customerName(order)} <span>· {count(order.cardCount, 'card')}</span></p></div><span className={styles.stageBadge}>{stageLabel(order.stage)}</span></header>
    <div className={styles.orderFacts}><span>Grading paid</span><span>Paid {orderDate(order.paidAt)}</span><span className={shippingUnpaid(order) ? styles.warning : ''}>Shipping: {words(order.shippingPayment?.state)}</span></div>
    <section className={`${styles.acknowledgment} ${acknowledged ? styles.acknowledged : ''}`} aria-label="Shared team acknowledgment"><div><strong>{acknowledged ? `Acknowledged by ${ack.acknowledgedBy?.name || 'a team member'}` : 'New order · team acknowledgment needed'}</strong><p>{acknowledged ? orderDate(ack.acknowledgedAt) : 'Let the team know this paid order has been noticed. Custody stays unchanged.'}</p></div>{!acknowledged && <button type="button" className={styles.primary} disabled={ackDisabled} onClick={() => onAcknowledge(order.id)}>Acknowledge order</button>}</section>
    <NextStep order={order}/>
    <nav className={styles.detailTabs} aria-label={`Details for ${order.reference}`}>{[['work', 'Cards & work'], ['payment', 'Payment'], ['contact', 'Contact & shipping'], ['history', 'History']].map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div hidden={tab !== 'work'}><div className={styles.sectionHeading}><h3>Customer card photographs</h3><span>{count(order.cards?.length ?? 0, 'card')}</span></div><p className={styles.photoNote}>Customer submission photo previews identify the customer’s cards. Grading evidence is in each linked grading card.</p>
      {!order.cards?.length && <p className={styles.empty}>No card roster was returned for this paid order.</p>}
      {order.cards?.map((card, index) => <CardItem key={card.cardId} order={order} card={card} first={index === 0} disabled={disabled} onAction={onAction} renderCardActions={renderCardActions}/>)}
      {renderReturnShipping?.({ order: { ...order, returnShipping: order.shipping?.return }, disabled: readDisabled, prepareDisabled: disabled, onPrepare: onAction })}
    </div>
    <div hidden={tab !== 'payment'}><PaymentDetails order={order}/></div>
    <div hidden={tab !== 'contact'}><ContactShipping order={order} disabled={readDisabled}/></div>
    <div hidden={tab !== 'history'}><OrderHistory order={order}/></div>
  </article>;
}

function NextStep({ order }) {
  const stages = new Set((order.cards ?? []).map(card => card.stage));
  const attention = stages.has('ATTENTION') || order.attentionCount > 0;
  let title = 'Continue each card’s recorded step', text = 'Open a card below to inspect its photos, saved history, and available actions.';
  if (attention) { title = 'A recorded outcome needs attention'; text = 'Check the saved card and any retained request before retrying an operation.'; }
  else if (stages.has('WAITING_FOR_ARRIVAL')) { title = 'Awaiting physical arrival'; text = 'Record the actual handoff or ATLAS receipt after the cards arrive. A paid order is not a custody record.'; }
  else if (stages.has('RECEIVED')) { title = 'Connect the received cards to grading'; text = 'Inspect the physical card and the staff intake photos before confirming a match.'; }
  else if (stages.has('GRADING') || stages.has('HUMAN_REVIEW')) { title = 'Continue grading and human review'; text = 'Open the linked grading card for its current work. Only the saved human approval completes grading.'; }
  else if (stages.has('FINISHING') || stages.has('READY_FOR_RETURN')) { title = 'Verify physical finishing before mailing'; text = 'An approved grade or a prepared label does not establish that assembly, welding, or packing is complete.'; }
  else if (stages.has('RETURNING')) { title = 'Return mailing is recorded'; text = 'Keep tracking and record the actual delivery when it is confirmed.'; }
  else if (stages.size === 1 && stages.has('COMPLETE')) { title = 'Delivery is recorded'; text = 'The customer’s saved photos, payments, and custody history remain available below.'; }
  return <section className={styles.nextStep} aria-label="Next recorded step"><p className={styles.eyebrow}>{attention ? 'Needs attention' : 'Next step'}</p><h3>{title}</h3><p>{text}</p>{shippingConcern(order) && <p className={styles.warning}>{shippingConcern(order)}. Check its saved payment and label status before arranging shipment.</p>}</section>;
}

function CardItem({ order, card, first, disabled, onAction, renderCardActions }) {
  const [enlarged, setEnlarged] = useState(null), [failedSides, setFailedSides] = useState({}), [photoRetries, setPhotoRetries] = useState({}), closeRef = useRef(null), openRefs = useRef({});
  const photoFailed = side => setFailedSides(old => ({ ...old, [side]: true }));
  function retryPhoto(side) { setFailedSides(old => ({ ...old, [side]: false })); setPhotoRetries(old => ({ ...old, [side]: (old[side] ?? 0) + 1 })); }
  useEffect(() => { if (enlarged) closeRef.current?.focus(); }, [enlarged]);
  function closePhoto() { const side = enlarged; setEnlarged(null); setTimeout(() => openRefs.current[side]?.focus(), 0); }
  return <details className={styles.card} open={first || undefined}><summary><span className={styles.cardThumbnail}><CustomerPhoto orderId={order.id} card={card} side="FRONT"/></span><span className={styles.cardIdentity}><strong>{cardTitle(card)}</strong><small>{cardSubtitle(card) || 'No additional identity details'}</small></span><span className={styles.cardStage}>{stageLabel(card.stage)}</span></summary><div className={styles.cardBody}>
    {enlarged ? <div className={styles.photoLarge}><button type="button" ref={closeRef} onClick={closePhoto}>← Front & back photographs</button><CustomerPhoto orderId={order.id} card={card} side={enlarged} size="detail" retryKey={photoRetries[enlarged] ?? 0} onFailure={() => photoFailed(enlarged)}/>{failedSides[enlarged] && <button type="button" onClick={() => retryPhoto(enlarged)}>Retry {enlarged.toLowerCase()} photograph</button>}<p>{words(enlarged)} · customer submission photo preview</p></div> : <div className={styles.photoPair}>{['FRONT', 'BACK'].map(side => <figure key={side}><button type="button" disabled={!photoReady(card, side)} ref={node => { openRefs.current[side] = node; }} aria-label={`${failedSides[side] ? 'Retry' : 'Enlarge'} ${side.toLowerCase()} customer photograph of ${cardTitle(card)}`} onClick={() => failedSides[side] ? retryPhoto(side) : setEnlarged(side)}><CustomerPhoto orderId={order.id} card={card} side={side} size="detail" retryKey={photoRetries[side] ?? 0} onFailure={() => photoFailed(side)}/></button><figcaption><span>{words(side)}</span><span>{failedSides[side] ? 'Retry photo ↻' : photoReady(card, side) ? 'Enlarge ↗' : 'Unavailable'}</span></figcaption></figure>)}</div>}
    {card.approvedAt && <p className={styles.small}>Human approval saved {orderDate(card.approvedAt)}</p>}
    {card.finishing && (card.grading?.state === 'HUMAN_APPROVED' || ['FINISHING', 'READY_FOR_RETURN', 'RETURNING', 'COMPLETE'].includes(card.stage)) && <div className={styles.finishing}><h4>Recorded finishing</h4><dl className={styles.facts}>{[['label', 'Label'], ['nfc', 'NFC'], ['assembly', 'Assembly'], ['welding', 'Welding'], ['packing', 'Packing']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{words(card.finishing[key])}</dd></div>)}</dl></div>}
    {renderCardActions?.({ card: { ...card, grading: typeof card.grading === 'string' ? card.grading : card.grading?.state }, manualCards: order.manualCards ?? [], disabled, onAction })}
  </div></details>;
}

function Receipt({ payment, title }) {
  const receipt = payment?.receipt;
  return <section className={styles.detailSection}><h3>{title}</h3><p>{words(payment?.state)}</p>{receipt ? <><dl className={styles.facts}>{[['subtotalCents', 'Subtotal'], ...(receipt.shippingCents != null ? [['shippingCents', 'Shipping in this receipt']] : []), ['taxCents', 'Tax'], ['totalCents', 'Total paid']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{orderMoney(receipt[key], receipt.currency)}</dd></div>)}{payment.paidAt && <div><dt>Paid</dt><dd>{orderDate(payment.paidAt)}</dd></div>}</dl>{receipt.reference && <p className={styles.small}>Receipt {receipt.reference}</p>}{receipt.cards?.length > 0 && <ul className={styles.receiptLines}>{receipt.cards.map(card => <li key={card.cardId}><span>{cardTitle(card)}</span><b>{orderMoney(card.unitCents, receipt.currency)}</b></li>)}</ul>}{receipt.shipping?.length > 0 && <ul className={styles.receiptLines}>{receipt.shipping.map((leg, index) => <li key={index}><span>{leg.leg === 'INBOUND' ? 'Customer to ATLAS' : leg.leg === 'RETURN' ? 'ATLAS to customer' : 'Saved shipping leg'}<small>{[leg.carrierName, leg.serviceName].filter(Boolean).join(' · ')}</small></span><b>{orderMoney(leg.amountCents, leg.currency || receipt.currency)}</b></li>)}</ul>}{receipt.terms?.days != null && <p className={styles.small}>Saved turnaround: {receipt.terms.days} days · {words(receipt.terms.clockStart)}</p>}</> : <p className={styles.small}>No saved receipt is available for this payment.</p>}</section>;
}
function PaymentDetails({ order }) {
  return <div><Receipt payment={order.payments?.grading} title="Grading payment"/><Receipt payment={order.payments?.shipping} title="Shipping payment"/><p className={styles.photoNote}>Amounts come from the saved payment receipts. Grading and later shipping remain separate charges.</p></div>;
}
function ContactShipping({ order, disabled }) {
  const customer = order.customer ?? {}, address = customer.returnAddress;
  return <><section className={styles.detailSection}><h3>Customer contact</h3><dl className={styles.facts}><div><dt>Name</dt><dd>{customer.name || 'Not recorded'}</dd></div><div><dt>Email</dt><dd>{customer.email || 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{customer.phone || 'Not recorded'}</dd></div><div><dt>Return address</dt><dd>{address ? [address.name, address.address1 ?? address.line1, address.address2 ?? address.line2, [address.city, address.region ?? address.state, address.postalCode].filter(Boolean).join(', '), address.country].filter(Boolean).map((line, index) => <span className={styles.addressLine} key={index}>{line}</span>) : 'Not recorded'}</dd></div></dl></section><div className={styles.shippingGrid}>{[['inbound', 'Customer to ATLAS'], ['return', 'ATLAS to customer']].map(([key, title]) => { const leg = order.shipping?.[key]; return <section key={key} className={styles.detailSection}><h3>{title}</h3><dl className={styles.facts}><div><dt>Shipping</dt><dd>{words(leg?.state)}</dd></div><div><dt>Label</dt><dd>{words(leg?.artifactState)}</dd></div><div><dt>Tracking</dt><dd>{leg?.trackingNumber || 'Not recorded'}</dd></div></dl>{key === 'inbound' && <InboundLabel order={order} disabled={disabled}/>}</section>; })}</div><p className={styles.photoNote}>A label is separate from physical custody. Record actual receipt, mailing, and delivery in the card’s history.</p></>;
}
function OrderHistory({ order }) {
  const rows = order.history ?? [];
  return <section className={styles.detailSection}><h3>Saved order history</h3>{!rows.length ? <p>No additional order history was returned. Each card’s recorded custody is available under Cards & work.</p> : <ol className={styles.history}>{rows.map((row, index) => <li key={row.id || index}><strong>{row.label || custodyNames[row.kind] || words(row.kind || row.type)}</strong><time>{orderDate(row.occurredAt || row.createdAt)}</time>{row.note && <p>{row.note}</p>}{row.actor?.name && <small>{row.actor.name}</small>}</li>)}</ol>}</section>;
}

function InboundLabel({ order, disabled }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), running = useRef(false);
  const shipping = order.shipping?.inbound;
  if (!['READY', 'SUCCEEDED'].includes(shipping?.artifactState)) return null;
  async function download() {
    if (disabled || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const label = await api(`${orderDetailPath(order.id)}/labels/INBOUND`);
      const bytes = await orderLabelBytes(label, order.id, 'INBOUND');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = `${order.reference}-customer-to-atlas.pdf`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.code === 'LABEL_NOT_READY' ? 'The inbound label is not ready. Refresh its saved status.' : orderDeskMessage(e)); }
    finally { running.current = false; setBusy(false); }
  }
  return <div className={styles.labelDownload}><button type="button" disabled={disabled || busy} onClick={download}>{busy ? 'Reading saved label…' : 'Download customer-to-ATLAS label'}</button>{error && <p className={styles.notice} role="alert">{error}</p>}</div>;
}
