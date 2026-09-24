import {useEffect,useState} from 'react';
import Link from 'next/link';
import {request} from '../../lib/client.mjs';
export default function CustomerOrderHistory(){
 const [orders,setOrders]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(next=null){setBusy(true);setError('');try{const result=await request(`/orders${next?`?cursor=${next}`:''}`);setOrders(old=>next?[...old,...result.orders]:result.orders);setCursor(result.nextCursor);}catch{setError('Your paid order history is unavailable right now.');}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 return <section className="paid-order-history"><div className="section-heading compact"><h2>Paid grading orders</h2><button className="text-link" disabled={busy} onClick={()=>load()}>Refresh orders</button></div>{error&&<p role="status">{error}</p>}{!orders.length&&!busy&&!error?<p>No paid grading orders have been recorded yet.</p>:<div className="submission-list">{orders.map(order=><Link className="panel submission-item" key={order.id} href={`/orders/${order.id}`}><div><span className="eyebrow">{order.channel==='KIOSK'?'Kiosk grading':'Mail-in grading'}</span><h3>{order.reference}</h3><p>{order.cardCount} {order.cardCount===1?'card':'cards'}</p></div><span>Follow your cards →</span></Link>)}</div>}{cursor&&<button className="secondary" disabled={busy} onClick={()=>load(cursor)}>More orders</button>}</section>;
}
