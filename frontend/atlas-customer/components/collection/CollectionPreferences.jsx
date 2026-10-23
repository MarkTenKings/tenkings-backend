import {useEffect,useId,useRef,useState} from 'react';
import {createCollectionPreferencesController} from '../../lib/collection-preferences-state.mjs';
import {preferenceId} from '../../lib/collection-preferences-client.mjs';
import styles from './CollectionPreferences.module.css';

const newRequestId=()=>globalThis.crypto.randomUUID();
const choices=value=>({visibility:value.visibility,offersDisabled:value.offersDisabled});
const describe=value=>`${value.visibility==='PRIVATE'?'Private':'Public'} · ${value.offersDisabled?'Offers turned off':'Offers not turned off'}`;
const busy=phase=>['READING','SAVING','RECOVERING'].includes(phase);

/** Optional local composition only. The supplied session is the existing
 * bootstrap object and CSRF, never form authority. No default transport. */
export default function CollectionPreferences({session,request=null,cardId=null,accessState='READY',onAccessLost,createRequestId=newRequestId}) {
 const prefix=useId(),customer=session?.customer,accountId=customer?.id,csrf=session?.csrf;
 const latest=useRef(null);latest.current={session,customer,accountId,csrf,request,cardId,accessState,onAccessLost,createRequestId};
 const active=useRef(null),endedSession=useRef(null);
 const [view,setView]=useState(null),[draft,setDraft]=useState(null),[requested,setRequested]=useState(null),[expanded,setExpanded]=useState(cardId===null),[,wake]=useState(0);
 const sameScope=entry=>entry&&!entry.closed&&active.current===entry&&endedSession.current!==entry.session
  &&latest.current.session===entry.session&&latest.current.customer===entry.customer&&latest.current.accountId===entry.accountId
  &&entry.customer.id===entry.accountId&&latest.current.csrf===entry.csrf&&latest.current.request===entry.request
  &&latest.current.cardId===entry.cardId&&latest.current.accessState==='READY';
 const valid=entry=>sameScope(entry)&&entry.controller.isCurrent(latest.current.session,latest.current.request,latest.current.cardId,latest.current.accessState);
 useEffect(()=>{
  setView(null);setDraft(null);setRequested(null);
  if(accessState!=='READY'){endedSession.current=session;return;}
  if(!request||!preferenceId(accountId)||typeof csrf!=='string'||!csrf||endedSession.current===session)return;
  const entry={session,customer,accountId,csrf,request,cardId,closed:false,sequence:0,queued:false,controller:null};
  const changed=snapshot=>{if(!valid(entry))return;entry.sequence++;setView({entry,sequence:entry.sequence,snapshot});};
  entry.controller=createCollectionPreferencesController({session,request,cardId,onChange:changed,onAccessLost:()=>{
   if(!sameScope(entry))return;endedSession.current=session;entry.closed=true;setView(null);setDraft(null);setRequested(null);latest.current.onAccessLost?.();
  }});
  active.current=entry;changed(entry.controller.snapshot());
  const hide=()=>{endedSession.current=session;entry.closed=true;entry.controller.dispose();setView(null);setDraft(null);setRequested(null);wake(v=>v+1);};
  window.addEventListener('pagehide',hide);
  return()=>{entry.closed=true;entry.controller.dispose();if(active.current===entry)active.current=null;window.removeEventListener('pagehide',hide);};
 // Each setup gets a fresh controller, including StrictMode setup/cleanup replay.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[session,customer,accountId,csrf,request,cardId,accessState]);
 const entry=active.current,shown=view?.entry===entry&&valid(entry)?view:null;
 const snapshot=shown?.snapshot,phase=snapshot?.phase??'READING';
 useEffect(()=>{
  const current=active.current;
  if(expanded&&valid(current)&&current.controller.snapshot().phase==='IDLE')void current.controller.load();
 // The controller's IDLE guard prevents metadata/form rerenders from re-reading.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[expanded,view]);
 if(request===null)return null;
 const ended=accessState!=='READY'||endedSession.current===session||!preferenceId(accountId)||phase==='ENDED';
 const current=snapshot?.current,stored=cardId?current?.cardPreferences:current?.collectionPreferences;
 const pendingChoice=requested?.entry===entry&&snapshot?.pending?.requestId===requested.requestId?requested.value:null;
 const form=pendingChoice??(draft&&draft.current===current?draft.value:stored?choices(stored):null);
 const dirty=!!(form&&stored&&(form.visibility!==stored.visibility||form.offersDisabled!==stored.offersDisabled));
 const canEdit=!!shown&&phase==='READY'&&!snapshot.pending&&!!form;
 const live=()=>shown&&valid(entry)&&entry.sequence===shown.sequence&&!entry.queued;
 const invoke=(method,value)=>{
  if(!live())return;entry.queued=true;
  Promise.resolve().then(()=>{if(!valid(entry))return;entry.controller.assertScope(session,request,cardId,accessState);return entry.controller[method](value);})
   .catch(()=>{/* Controller preserves UNKNOWN; stale events never create a new request. */})
   .finally(()=>{entry.queued=false;});
 };
 const edit=patch=>{if(!live()||!canEdit)return;setDraft({current,value:{...form,...patch}});};
 const save=()=>{
  if(!live()||!canEdit||!dirty)return;
  const requestId=latest.current.createRequestId();setRequested({entry,requestId,value:{...form}});
  invoke('save',{requestId,...form});
 };
 const toggle=()=>{if(ended||!valid(entry))return;setExpanded(value=>!value);};
 const title=cardId?'Card settings':'Collection settings';
 const message=ended?'Sign in again to manage your settings.':phase==='READING'?'Loading settings…':phase==='SAVING'?'Saving settings…'
  :phase==='RECOVERING'?'Checking the saved request…':phase==='UNKNOWN'?(snapshot.recovery==='ABSENT'?'That save has not been found yet. Its outcome is still unconfirmed.':'Your change may have been saved. Check the saved request before making another change.')
   :phase==='STALE_REQUIRES_REFRESH'?'These settings changed elsewhere. Reload the latest settings before choosing again.'
    :phase==='CONFIRMED'?'Your save is confirmed. Reload to see the current settings.':phase==='UNAVAILABLE'?'Settings are unavailable. Please try again.'
     :dirty?'Unsaved changes.':'Current saved settings.';
 return <section className={styles.panel} aria-labelledby={`${prefix}-title`}>
  {cardId?<h3 className={styles.disclosure}><button type="button" id={`${prefix}-title`} aria-expanded={expanded} aria-controls={`${prefix}-body`} onClick={toggle} disabled={ended}>{title}<span aria-hidden="true">{expanded?'−':'+'}</span></button></h3>
   :<h2 id={`${prefix}-title`}>{title}</h2>}
  {(expanded||ended)&&<div id={`${prefix}-body`}>
   <p role="status" className={phase==='UNKNOWN'||phase==='STALE_REQUIRES_REFRESH'?styles.caution:styles.status}>{message}</p>
   {!ended&&stored&&<p className={styles.saved}>Current: {describe(stored)}</p>}
   {!ended&&pendingChoice&&<p className={styles.requested}>Requested change: {describe(pendingChoice)}. This save is not confirmed yet.</p>}
   {!ended&&snapshot?.receipt&&<p className={styles.receipt}>Last confirmed save: {describe(snapshot.receipt.receipt.input)}. This is the saved request, which may differ from the current settings.</p>}
   {!ended&&form&&<fieldset className={styles.fields} disabled={!canEdit||busy(phase)}>
    <legend>{cardId?'Choose settings for this card':'Choose collection settings'}</legend>
    <label htmlFor={`${prefix}-visibility`}>Visibility</label>
    <select id={`${prefix}-visibility`} value={form.visibility} onChange={event=>edit({visibility:event.target.value})}>
     <option value="PRIVATE">Private</option><option value="PUBLIC">Public</option>
    </select>
    <label className={styles.check}><input type="checkbox" checked={form.offersDisabled} onChange={event=>edit({offersDisabled:event.target.checked})}/><span>{cardId?'Turn off offers for this card':'Turn off offers for all cards'}</span></label>
   </fieldset>}
   {!ended&&<div className={styles.actions}>
    {phase==='READY'&&!snapshot.pending&&<><button type="button" className={styles.primary} disabled={!dirty} onClick={save}>Save settings</button><button type="button" disabled={!dirty} onClick={()=>{if(live())setDraft(null);}}>Reset changes</button></>}
    {phase==='UNKNOWN'&&<><button type="button" className={styles.primary} onClick={()=>invoke('recover')}>Check saved request</button><button type="button" onClick={()=>invoke('retry')}>Retry this same save</button></>}
    {['CONFIRMED','STALE_REQUIRES_REFRESH','UNAVAILABLE'].includes(phase)&&<button type="button" onClick={()=>invoke('load')}>{phase==='UNAVAILABLE'?'Try again':'Reload current settings'}</button>}
   </div>}
   {!ended&&<p className={styles.help}>Public saves a visibility preference; public collection browsing is not available yet. Offer delivery is unavailable. A private collection and its offer opt-out take priority over individual card choices. Public grade reports are unchanged.</p>}
  </div>}
 </section>;
}
