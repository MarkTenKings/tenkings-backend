import {useEffect,useState} from 'react';
import {request} from '../../lib/client.mjs';
import OrderReceipt from '../../components/commerce/OrderReceipt.jsx';
import CustomerOrderTracking from '../../components/orders/CustomerOrderTracking.jsx';
import {customerPage} from '../../lib/server/page.mjs';
import {UUID} from '../../lib/server/policy.mjs';
export default function Order({orderId,unavailable}){
 const [csrf,setCsrf]=useState(null),[signedIn,setSignedIn]=useState(null);
 useEffect(()=>{if(unavailable)return;request('/session').then(boot=>{setCsrf(boot.csrf);setSignedIn(Boolean(boot.customer));}).catch(()=>setSignedIn(false));},[unavailable]);
 return <main className="account-main"><a href="/account">← Your orders</a>{unavailable?<p>Order tracking is unavailable right now.</p>:signedIn===null?<p>Opening your account…</p>:signedIn?<><OrderReceipt orderId={orderId}/><CustomerOrderTracking orderId={orderId} csrf={csrf}/></>:<section className="panel"><h1>Sign in to view this order</h1><a className="primary" href="/account">Sign in</a></section>}</main>;
}
export function getServerSideProps(context){if(!UUID.test(context.params?.id??''))return {notFound:true};return customerPage(context,{orderId:context.params.id});}
