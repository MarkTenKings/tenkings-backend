import {useEffect,useState} from 'react';
import {request as defaultRequest} from '../../lib/client.mjs';
import CustomerHandoff from '../dealer/CustomerHandoff.jsx';
import CardJourney from './CardJourney.jsx';
import {cardJourney} from '../../lib/card-journey.mjs';
const labels={DEALER_RECEIVED:'Card shop confirmed your handoff',DEPOSIT_DECLARED:'You reported a dropbox deposit',COLLECTED:'ATLAS collected your card',ATLAS_RECEIVED:'Received at ATLAS',RETURN_DISPATCHED:'ATLAS dispatched your return',RETURNED_TO_KIOSK:'Returned to your kiosk',CUSTOMER_COLLECTED:'Customer pickup recorded',MAIL_DISPATCHED:'Return shipment dispatched',CUSTOMER_DELIVERED:'Delivery recorded',DELAY_REPORTED:'Route delay reported',DELAY_RESOLVED:'Route delay resolved'};
function date(value,zone){if(value&&!Number.isFinite(Date.parse(value)))return 'Schedule unavailable';return value?new Intl.DateTimeFormat('en-US',{timeZone:zone||'UTC',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Not recorded';}
export function OrderCard({card}){
 const events=card.events??[],zone=card.originalSchedule?.timeZone;
 return <article className="panel card-progress"><div className="card-heading"><div><span className="eyebrow">{card.channel==='KIOSK'?'Card-shop grading':'Mail-in grading'}</span><h3>{card.identity?.title||'Your card'}</h3></div><span className="status">{cardJourney(card).label}</span></div>
 <CardJourney card={card}/>
 {card.channel==='KIOSK'&&<div className="notice"><strong>{card.originalLocation}</strong><p>One week from actual ATLAS collection. Pickup and return included.</p>
 <p>Collection shown at checkout: {date(card.originalSchedule?.nextCollectionAt,zone)}<br/>Return projected at checkout: {date(card.originalSchedule?.projectedReturnAt,zone)}</p>
 {card.collectedAt?<p>Actual ATLAS collection: {date(card.collectedAt,zone)}<br/>One-week target: {date(card.turnaroundTarget,zone)}</p>:<p>Next planned collection: {date(card.currentProjection?.nextCollection,zone)}. Collection has not been recorded.</p>}
 {card.scheduleChanged&&<p role="status">The location schedule changed after checkout. Your original dates remain above.</p>}
 {card.currentProjection?.projectedReturn&&<p>Current projected return: {date(card.currentProjection.projectedReturn,zone)}</p>}</div>}
 {!events.length?<p>No physical handoff has been recorded.</p>:<details className="journey-records"><summary>See recorded updates · {events.length}</summary><ol aria-label={`Recorded events for ${card.identity?.title||'your card'}`} className="order-events">{events.map(event=><li key={event.id}><strong>{labels[event.kind]??'Recorded update'}</strong><span> · {date(event.occurredAt,zone)}</span>{event.kind==='DEPOSIT_DECLARED'&&<p className="fine">This is your declaration. ATLAS collection and receipt are confirmed separately.</p>}{event.note&&<p>{event.note}</p>}{event.expectedReturnAt&&<p>Updated expected return: {date(event.expectedReturnAt,zone)}</p>}</li>)}</ol></details>}
 {card.approvedAt&&<p>Human report approval recorded {date(card.approvedAt,zone)}.</p>}
 {typeof card.reportUrl==='string'&&/^\/reports\/ar_[A-Za-z0-9_-]{24}(?:\?v=[1-9][0-9]*)?$/.test(card.reportUrl)&&<a className="text-link" href={card.reportUrl}>View your approved report ↗</a>}
 </article>;
}
export default function CustomerOrderTracking({orderId,csrf,request=defaultRequest,initial=null}){
 const [data,setData]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){setData(await request(`/orders/${orderId}`));}
 useEffect(()=>{let active=true;request(`/orders/${orderId}`).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('This order could not be loaded. Sign in to the account that placed it.');});return()=>{active=false;};},[orderId,request]);
 return <section className="order-tracking"><div className="section-heading"><div><span className="eyebrow">Recorded progress</span><h2>{data?.reference||'Your order'}</h2><p>Progress changes when an event is recorded. Scheduled times do not confirm a physical handoff.</p></div><button className="secondary" disabled={busy} onClick={()=>{setBusy(true);setError('');refresh().catch(()=>setError('Progress is unavailable right now.')).finally(()=>setBusy(false));}}>Refresh progress</button></div>
 {data?.cards?.some(card=>card.channel==='KIOSK')&&<CustomerHandoff orderId={orderId} csrf={csrf} request={request} compact initial={data.handoff?{handoff:data.handoff}:null}/>}
 {error&&<p role="status">{error}</p>}{!data?<p role="status">Loading your cards…</p>:data.cards.map(card=><OrderCard key={card.cardId} card={{...card,orderId,paidAt:data.paidAt}}/>)}
 </section>;
}
