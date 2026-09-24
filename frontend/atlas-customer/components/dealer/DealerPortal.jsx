import {useState} from 'react';
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const labels={DEPOSIT_DECLARED:'Customer reports dropbox deposit',COLLECTED:'Collected by ATLAS',ATLAS_RECEIVED:'At ATLAS',RETURN_DISPATCHED:'Returning to kiosk',RETURNED_TO_KIOSK:'At kiosk for customer pickup',CUSTOMER_COLLECTED:'Customer collected',DELAY_REPORTED:'Route delay reported',DELAY_RESOLVED:'Route delay resolved'};
/** request is supplied by the dealer route, using a separate HttpOnly dealer
 * cookie and CSRF. No customer account/profile data is accepted or displayed. */
export default function DealerPortal({initial,request,onSignOut}) {
 const [data,setData]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){setBusy(true);setError('');try{setData(await request('/dealer'));}catch{setError('Dealer activity could not be loaded. Sign in again if your session has ended.');}finally{setBusy(false);}}
 const commission=data?.commission;
 return <main className="account-main"><header className="section-heading"><div><span className="eyebrow">ATLAS dealer account</span><h1>{data?.location?.name??'Dealer activity'}</h1><p>ATLAS handles collection, grading and return. Your location earns $5 for each paid full-price $50 card.</p></div><button className="secondary" onClick={onSignOut}>Sign out</button></header>
 {error&&<p role="status">{error}</p>}<button className="secondary" disabled={busy} onClick={refresh}>{busy?'Refreshing…':'Refresh activity'}</button>
 <section className="panel"><h2>Your location</h2><dl className="dealer-metrics"><div><dt>Customers</dt><dd>{data?.customerCount??0}</dd></div><div><dt>Paid orders</dt><dd>{data?.orderCount??0}</dd></div><div><dt>Cards</dt><dd>{data?.cardCount??0}</dd></div></dl>
 {commission&&<><h3>Commission record</h3><p>Accrued {money(commission.accruedCents)} · Reversed {money(commission.reversedCents)} · Net {money(commission.accruedCents-commission.reversedCents)}</p><p className="fine">Taxes and shipping are excluded. This is an earnings record; payout timing is not yet configured.</p></>}</section>
 <section className="panel"><h2>Submission progress</h2>{!data?.orders?.length?<p>No paid submissions have been recorded for your location.</p>:<div className="submission-list">{data.orders.map(order=><article key={order.reference}><h3>{order.reference}</h3><p>{order.cardCount} {order.cardCount===1?'card':'cards'}</p><ul>{order.cards.map((card,index)=><li key={card.cardId}>Card {index+1} · {labels[card.custody]??'Awaiting physical handoff'} · {card.grading==='HUMAN_APPROVED'?'Grading approved':card.grading==='IN_GRADING'?'In grading':'Grading not started'}</li>)}</ul></article>)}</div>}</section>
 </main>;
}
