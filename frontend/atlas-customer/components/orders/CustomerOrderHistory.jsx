import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {request as defaultRequest} from '../../lib/client.mjs';
import {orderJourney} from '../../lib/card-journey.mjs';
import CardJourney from './CardJourney.jsx';

export function OrderSummary({order,detail,failed=false}) {
 const cards=detail?.cards??[],journey=orderJourney(cards),focus=cards.find(card=>!orderJourney([card]).complete)??cards[0];
 return <article className="my-atlas-order"><header><div><span className="eyebrow">{order.channel==='KIOSK'?'CARD SHOP':'MAIL-IN'} / {order.reference}</span><h3>{journey.complete?'Back with you.':'Your cards. In motion.'}</h3></div><div className="order-count">{order.cardCount}<small>{order.cardCount===1?'CARD':'CARDS'}</small></div></header>
 {focus?<><CardJourney card={{...focus,orderId:order.id,paidAt:order.paidAt}} compact/>{cards.length>1&&<p className="order-card-names">{journey.summary.map(group=>`${group.count} ${group.label.toLowerCase()}`).join(' · ')}</p>}</>:<p className="my-atlas-status">{failed?'Progress could not be refreshed. Open the order to try again.':'Loading recorded progress…'}</p>}
 <footer><span>{journey.attention?`${journey.attention} ${journey.attention===1?'card needs':'cards need'} your attention`:journey.approved?`${journey.approved} approved ${journey.approved===1?'report':'reports'} ready`:'Every update comes from recorded work.'}</span><Link className="text-link" href={`/orders/${order.id}`}>Follow your cards ↗</Link></footer></article>;
}
export default function CustomerOrderHistory({request=defaultRequest,onCards}) {
 const [orders,setOrders]=useState([]),[details,setDetails]=useState({}),[failed,setFailed]=useState({}),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 const generation=useRef(0),alive=useRef(true),loaded=useRef([]),cardsCallback=useRef(onCards);
 cardsCallback.current=onCards;
 const load=useCallback(async(next=null)=>{
  const version=++generation.current;setBusy(true);setError('');
  try {
   const result=await request(`/orders${next?`?cursor=${next}`:''}`);if(!alive.current||version!==generation.current)return;
   const merged=next?[...loaded.current,...result.orders.filter(row=>!loaded.current.some(old=>old.id===row.id))]:result.orders;
   loaded.current=merged;setOrders(merged);setCursor(result.nextCursor);setReady(true);
   let index=0;const fresh={},errors={};
   // Bound status reads independently of the number of cards in an order.
   await Promise.all(Array.from({length:Math.min(3,result.orders.length)},async()=>{while(index<result.orders.length){const order=result.orders[index++];try{fresh[order.id]=await request(`/orders/${order.id}`);}catch{errors[order.id]=true;}if(!alive.current||version!==generation.current)return;}}));
   if(!alive.current||version!==generation.current)return;
   setDetails(old=>next?{...old,...fresh}:fresh);setFailed(old=>next?{...old,...errors}:errors);
  } catch {if(alive.current&&version===generation.current){setError('Your order history could not be refreshed.');setReady(true);}}
  finally{if(alive.current&&version===generation.current)setBusy(false);}
 },[request]);
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;generation.current++;cardsCallback.current?.([]);};},[load]);
 useEffect(()=>{cardsCallback.current?.(orders.flatMap(order=>(details[order.id]?.cards??[]).map(card=>({...card,orderId:order.id}))));},[orders,details]);
 const active=orders.filter(order=>!details[order.id]||!orderJourney(details[order.id].cards??[]).complete),complete=orders.filter(order=>details[order.id]&&orderJourney(details[order.id].cards??[]).complete);
 return <section className="paid-order-history" aria-labelledby="active-orders-title"><div className="section-heading compact"><div><span className="eyebrow">FIRST THINGS FIRST</span><h2 id="active-orders-title">Where are my cards?</h2></div><button className="text-link" disabled={busy} onClick={()=>load()}>{busy?'Updating…':'Refresh progress ↻'}</button></div>
 {error&&<p role="status">{error}</p>}{!ready?<p role="status" className="my-atlas-status">Opening your orders…</p>:!orders.length&&!error?<p className="journey-empty">Your next submission starts a new story. Once you submit, follow every recorded step right here.</p>:<><div className="my-atlas-orders">{active.map(order=><OrderSummary key={order.id} order={order} detail={details[order.id]} failed={failed[order.id]}/>)}</div>{complete.length>0&&<details className="journey-records"><summary>Completed orders · {complete.length}</summary><div className="my-atlas-orders">{complete.map(order=><OrderSummary key={order.id} order={order} detail={details[order.id]}/>)}</div></details>}</>}
 {cursor&&<button className="secondary" disabled={busy} onClick={()=>load(cursor)}>Load earlier orders</button>}</section>;
}
