import {useEffect,useState} from 'react';
import {request} from '../../lib/client.mjs';
import DealerPortal from './DealerPortal';
import styles from './handoff.module.css';

export default function DealerWorkspace({unavailable=false,renderAuthorized,handoff=false}){
 const [data,setData]=useState(null),[memberships,setMemberships]=useState(null),[customerCsrf,setCustomerCsrf]=useState(''),[dealerCsrf,setDealerCsrf]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[needsSignIn,setNeedsSignIn]=useState(false);
 async function load(){
  try{const current=await request('/dealer/session');setData(current);setDealerCsrf(current.csrf);return;}catch(failure){if(!['DEALER_SIGN_IN_REQUIRED','SIGN_IN_REQUIRED'].includes(failure.code))throw failure;}
  const boot=await request('/session');setCustomerCsrf(boot.csrf);
  if(!boot.customer){setNeedsSignIn(true);return;}
  const result=await request('/dealer/memberships');setMemberships(result.memberships??[]);
 }
 useEffect(()=>{if(unavailable)return;let current=true;load().catch(()=>{if(current)setError('Dealer access is unavailable. Please try again.');});return()=>{current=false;};},[unavailable]);
 async function enter(locationId){setBusy(true);setError('');try{const result=await request('/dealer/session',{body:{locationId},csrf:customerCsrf});setData(result);setDealerCsrf(result.csrf);}catch(failure){setError(failure.code==='DEALER_MEMBERSHIP_REQUIRED'?'This account has no current access to that location.':'Dealer access could not be opened. Refresh and try again.');}finally{setBusy(false);}}
 async function signOut(){setBusy(true);setError('');try{await request('/dealer/logout',{body:{},csrf:dealerCsrf});setData(null);setNeedsSignIn(false);await load();}catch{setError('Sign-out could not be confirmed. Please try again.');}finally{setBusy(false);}}
 if(unavailable)return <main className={`account-main ${handoff?styles.workspace:''}`}><h1>Dealer access is unavailable</h1><p>Please try again later.</p></main>;
 if(data&&renderAuthorized)return renderAuthorized({data,csrf:dealerCsrf,onSignOut:signOut});
 if(data)return <>{error&&<p role="status">{error}</p>}<DealerPortal initial={data} request={async()=>{const result=await request('/dealer/session');setDealerCsrf(result.csrf);return result;}} onSignOut={signOut}/></>;
 return <main className={`account-main ${handoff?styles.workspace:''}`}><header className="section-heading"><div><span className="eyebrow">ATLAS dealer account</span><h1>{handoff?"Sign in to receive cards.":"Your location’s activity."}</h1><p>{handoff?"Use your approved shop account to check and confirm this handoff.":"View your submissions, collection progress and commission record."}</p></div><a href="/account">Your ATLAS account</a></header>
 {error&&<p role="status">{error}</p>}{needsSignIn?<section className="panel"><h2>Verify your phone to continue</h2><p>Sign in with the number approved for your dealer location, then return here to open the dealer account.</p><a className="primary" href="/account" target={handoff?"_blank":undefined} rel={handoff?"noopener noreferrer":undefined}>{handoff?"Sign in in a new tab":"Sign in"}</a><button className="secondary" disabled={busy} onClick={()=>{setNeedsSignIn(false);load().catch(()=>setError('Dealer access is unavailable.'));}}>I’ve signed in</button></section>:memberships===null?<p role="status">Opening dealer access…</p>:!memberships.length?<section className="panel"><h2>No dealer location is assigned</h2><p>This verified account has no active dealer membership. Your ATLAS contact can confirm the approved phone number and location.</p></section>:<section className="panel"><h2>Choose your location</h2>{memberships.map(m=><button className="secondary" disabled={busy} key={m.locationId} onClick={()=>enter(m.locationId)}>{m.name}</button>)}</section>}
 </main>;
}
