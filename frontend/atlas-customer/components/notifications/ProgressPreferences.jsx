import React,{useEffect,useRef,useState} from 'react';
import {request} from '../../lib/client.mjs';

export default function ProgressPreferences({csrf}) {
 const [saved,setSaved]=useState(null),[email,setEmail]=useState(false),[sms,setSms]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),pending=useRef(null);
 const accept=value=>{if(!Number.isInteger(value?.revision)||typeof value.email!=='boolean'||typeof value.sms!=='boolean')throw Error('Invalid preferences');setSaved(value);setEmail(value.email);setSms(value.sms);};
 useEffect(()=>{let active=true;request('/notifications').then(value=>{if(active)accept(value);}).catch(()=>{if(active)setMessage('Progress preferences are not available yet.');});return()=>{active=false;};},[]);
 async function save(event){event.preventDefault();if(busy||!saved)return;setBusy(true);setMessage('');
  const payload=pending.current??{requestId:crypto.randomUUID(),expectedRevision:saved.revision,email,sms};pending.current=payload;
  try{const value=await request('/notifications',{body:payload,csrf});accept(value);pending.current=null;setMessage('Progress preferences saved.');}
  catch(error){if(error.code==='UNCONFIRMED_REPLY')setMessage('The save could not be confirmed. Retry to check the same request.');
   else {pending.current=null;if(error.code==='PREFERENCES_CHANGED'){try{accept(await request('/notifications'));}catch{}setMessage('Preferences changed. Review the saved settings and save again.');}
    else setMessage(error.code==='PROFILE_EMAIL_REQUIRED'?'Add an email address to your profile before enabling email updates.':error.message||'Preferences could not be saved.');}}
  finally{setBusy(false);}
 }
 return <section className="progress-preferences"aria-label="Progress notifications"><div className="section-heading compact"><div><span className="eyebrow">Stay up to date</span><h2>Card progress updates</h2><p>Choose updates about recorded grading and custody events for your cards.</p></div></div>
 {saved&&<form onSubmit={save}><label style={{display:'flex',gap:12,alignItems:'center',minHeight:44}}><input type="checkbox"checked={email}disabled={busy||Boolean(pending.current)}onChange={e=>setEmail(e.target.checked)}/>Email updates to my profile email</label>
 <label style={{display:'flex',gap:12,alignItems:'center',minHeight:44}}><input type="checkbox"checked={sms}disabled={busy||Boolean(pending.current)}onChange={e=>setSms(e.target.checked)}/>SMS updates to my verified mobile number</label>
 <p className="fine">You can turn either channel off here. Sign-in codes and payment receipts are separate.</p>
 {!saved.deliveryEnabled&&<p className="fine">Progress delivery is not available yet. Your preferences can be saved now.</p>}
 <button className="secondary"type="submit"disabled={busy}>{busy?'Saving…':pending.current?'Retry saved request':'Save preferences'}</button></form>}
 {message&&<p role="status">{message}</p>}</section>;
}
