import {useEffect,useState} from 'react';
import {request as defaultRequest} from '../../lib/client.mjs';
const labels={DEPOSIT_DECLARED:'You reported a dropbox deposit',COLLECTED:'ATLAS collected your card',ATLAS_RECEIVED:'Received at ATLAS',RETURN_DISPATCHED:'ATLAS dispatched your return',RETURNED_TO_KIOSK:'Returned to your kiosk',CUSTOMER_COLLECTED:'Customer pickup recorded',MAIL_DISPATCHED:'Return shipment dispatched',CUSTOMER_DELIVERED:'Delivery recorded',DELAY_REPORTED:'Route delay reported',DELAY_RESOLVED:'Route delay resolved'};
function date(value,zone){if(value&&!Number.isFinite(Date.parse(value)))return 'Schedule unavailable';return value?new Intl.DateTimeFormat('en-US',{timeZone:zone||'UTC',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Not recorded';}
export function OrderCard({card,onDeposit,busy}){
 const events=card.events??[],zone=card.originalSchedule?.timeZone,declared=events.some(e=>e.kind==='DEPOSIT_DECLARED'),received=events.some(e=>['COLLECTED','ATLAS_RECEIVED'].includes(e.kind));
 return <article className="panel card-progress"><div className="card-heading"><div><span className="eyebrow">{card.channel==='KIOSK'?'Kiosk grading':'Mail-in grading'}</span><h3>{card.identity?.title||'Your card'}</h3></div><span className="status">{card.grading==='HUMAN_APPROVED'?'Grading approved':card.grading==='IN_GRADING'?'In grading':'Awaiting physical intake'}</span></div>
 {card.channel==='KIOSK'&&<div className="notice"><strong>{card.originalLocation}</strong><p>One week from actual ATLAS collection. Pickup and return included.</p>
 <p>Collection shown at checkout: {date(card.originalSchedule?.nextCollectionAt,zone)}<br/>Return projected at checkout: {date(card.originalSchedule?.projectedReturnAt,zone)}</p>
 {card.collectedAt?<p>Actual ATLAS collection: {date(card.collectedAt,zone)}<br/>One-week target: {date(card.turnaroundTarget,zone)}</p>:<p>Next planned collection: {date(card.currentProjection?.nextCollection,zone)}. Collection has not been recorded.</p>}
 {card.scheduleChanged&&<p role="status">The location schedule changed after checkout. Your original dates remain above.</p>}
 {card.currentProjection?.projectedReturn&&<p>Current projected return: {date(card.currentProjection.projectedReturn,zone)}</p>}</div>}
 {!events.length?<p>No physical handoff has been recorded.</p>:<ol aria-label={`Recorded events for ${card.identity?.title||'your card'}`} className="order-events">{events.map(event=><li key={event.id}><strong>{labels[event.kind]??'Recorded update'}</strong><span> · {date(event.occurredAt,zone)}</span>{event.kind==='DEPOSIT_DECLARED'&&<p className="fine">This is your declaration. ATLAS collection and receipt are confirmed separately.</p>}{event.note&&<p>{event.note}</p>}{event.expectedReturnAt&&<p>Updated expected return: {date(event.expectedReturnAt,zone)}</p>}</li>)}</ol>}
 {card.approvedAt&&<p>Human report approval recorded {date(card.approvedAt,zone)}.</p>}
 {typeof card.reportUrl==='string'&&/^\/reports\/ar_[A-Za-z0-9_-]{24}(?:\?v=[1-9][0-9]*)?$/.test(card.reportUrl)&&<a className="text-link" href={card.reportUrl}>View your approved report ↗</a>}
 {card.channel==='KIOSK'&&!declared&&!received&&onDeposit&&<button className="secondary" disabled={busy} onClick={()=>onDeposit(card.cardId)}>I placed this card in the kiosk dropbox</button>}
 </article>;
}
export default function CustomerOrderTracking({orderId,csrf,request=defaultRequest,initial=null}){
 const [data,setData]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){setData(await request(`/orders/${orderId}`));}
 useEffect(()=>{let active=true;request(`/orders/${orderId}`).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('This order could not be loaded. Sign in to the account that placed it.');});return()=>{active=false;};},[orderId,request]);
 async function deposit(cardId){if(busy)return;setBusy(true);setError('');try{
  const key=`atlas-deposit-v1:${orderId}:${cardId}`;let requestId=window.sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();window.sessionStorage.setItem(key,requestId);}
  await request(`/orders/${orderId}/deposit`,{body:{cardId,requestId},csrf});await refresh();
 }catch{setError('Your deposit declaration could not be confirmed. Refresh or retry the same declaration.');}finally{setBusy(false);}}
 return <section className="order-tracking"><div className="section-heading"><div><span className="eyebrow">Recorded progress</span><h2>{data?.reference||'Your order'}</h2><p>Progress changes when an event is recorded. Scheduled times do not confirm a physical handoff.</p></div><button className="secondary" disabled={busy} onClick={()=>{setBusy(true);setError('');refresh().catch(()=>setError('Progress is unavailable right now.')).finally(()=>setBusy(false));}}>Refresh progress</button></div>
 {error&&<p role="status">{error}</p>}{!data?<p role="status">Loading your cards…</p>:data.cards.map(card=><OrderCard key={card.cardId} card={card} onDeposit={csrf?deposit:null} busy={busy}/>)}
 </section>;
}
