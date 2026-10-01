import {useEffect,useState} from 'react';
import {request as defaultRequest} from '../../lib/client.mjs';
import styles from './handoff.module.css';
const message=code=>({SIGN_IN_REQUIRED:'Sign in to the account that paid for this order to open its handoff code.',HANDOFF_ALREADY_ADVANCED:'Your cards have already moved beyond shop handoff. See their recorded progress below.',SHOP_HANDOFF_NOT_AVAILABLE:'A shop handoff is not available for this order.',CONFIRMED_PAYMENT_REQUIRED:'Your handoff code will be ready once payment is confirmed.'})[code]||'Your handoff code could not be loaded. Please try again.';
export function HandoffCode({qr}){
 if(!Number.isInteger(qr?.size)||qr.size<21||qr.size>200||typeof qr.path!=='string')return null;
 return <svg className={styles.qr} viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="Shop staff handoff QR code" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="white"/><path d={qr.path} fill="black"/></svg>;
}
export default function CustomerHandoff({orderId,csrf,request=defaultRequest,compact=false,initial=null}){
 const [open,setOpen]=useState(!compact),[data,setData]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{
  let proof=csrf;if(!proof){const boot=await request('/session');if(!boot.customer)throw {code:'SIGN_IN_REQUIRED'};proof=boot.csrf;}
  setData(await request(`/orders/${orderId}/handoff`,{body:{},csrf:proof}));
 }catch(failure){setError(message(failure.code));}finally{setBusy(false);}}
 useEffect(()=>{if(open&&!data?.qr&&data?.handoff?.status!=='RECEIVED')load();},[open,orderId,csrf]);
 const handoff=data?.handoff,received=handoff?.status==='RECEIVED';
 if(!open)return <aside className={styles.compact}><div><strong>{received?'Shop handoff confirmed':'Your shop handoff'}</strong><p>{received?'Your receipt is saved with this order.':'Show your paid order to staff and confirm every card together.'}</p></div><button className="secondary" onClick={()=>setOpen(true)}>{received?'View receipt':'Show handoff code'}</button></aside>;
 return <section className={styles.panel} aria-label="Shop handoff"><div className={styles.heading}><div><span className={styles.eyebrow}>{received?'SHOP RECEIPT SAVED':'NEXT · HAND YOUR CARDS TO STAFF'}</span><h3>{received?'Your shop has your cards.':'One scan. Every card accounted for.'}</h3></div>{compact&&<button className="secondary" onClick={()=>setOpen(false)}>Close</button>}</div>
 {handoff&&<><p><strong>{handoff.location?.name}</strong> · {handoff.cardCount} {handoff.cardCount===1?'card':'cards'} · {handoff.reference}</p>
 {received?<div className={styles.confirmed}><span aria-hidden="true">✓</span><div><strong>{handoff.receipt.cardCount} {handoff.receipt.cardCount===1?'card received':'cards received'} by shop staff</strong><p>{new Date(handoff.receipt.receivedAt).toLocaleString()}</p><small>Receipt {handoff.receipt.id}</small></div></div>:<div className={styles.codeLayout}><HandoffCode qr={data.qr}/><div><p>Show this code to shop staff. They will sign in and confirm each card in your paid order.</p><p className={styles.note}>Keep your cards until staff are ready to check them. A QR code or payment alone does not confirm receipt.</p><p>Once staff confirm the handoff, your receipt appears here. ATLAS collection is recorded separately.</p></div></div>}</>}
 {busy&&!data&&<p role="status">Opening your paid order’s handoff…</p>}{error&&<p role="alert">{error}</p>}
 <button className="secondary" disabled={busy} onClick={load}>{busy?'Checking…':received?'Refresh receipt':data?'Check for shop confirmation':'Try again'}</button>
 </section>;
}
