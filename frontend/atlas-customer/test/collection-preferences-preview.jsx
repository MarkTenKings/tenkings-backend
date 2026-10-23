// Browser-only synthetic composition: in-memory transport, no server/SQL/storage.
import {useMemo,useRef,useState} from 'react';
import CollectionWorkspace from '../components/collection/CollectionWorkspace.jsx';
import {createCollectionDisplayReader} from '../lib/collection-display-client.mjs';
import {displayPath} from '../lib/collection-display-contract.mjs';
export default function CollectionPreferencesPreview({data}) {
 const state=useRef({collection:{accountId:data.accountId,revision:0,visibility:'PRIVATE',offersDisabled:false},cards:new Map(),records:new Map(),lose:false,hold:false,pending:null,denied:false,reads:0,writes:0,photos:0});
 const [customer,setCustomer]=useState({id:data.accountId}),[access,setAccess]=useState('READY'),[enabled,setEnabled]=useState(true),[,paint]=useState(0);
 const session=useMemo(()=>({customer,csrf:'synthetic-existing-bootstrap-csrf'}),[customer]);
 const capability=useMemo(()=>{
  const s=state.current,photo=Uint8Array.from(atob(data.photoBase64),x=>x.charCodeAt(0));
  const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}}),base=()=>({accountId:data.accountId,observedAt:new Date().toISOString()});
  const request=async(path,options)=>{
   if(!['GET','POST'].includes(options.method)||options.credentials!=='same-origin'||options.cache!=='no-store'||options.redirect!=='error')throw Error('Unexpected fixture request');
   if(options.method==='GET')s.reads++;else s.writes++;paint(v=>v+1);if(s.denied)return json({error:'SIGN_IN_REQUIRED'},403);
   const recovery=path.match(/^\/account\/api\/customer\/collection\/preference-requests\/([a-f0-9-]+)$/);
   if(recovery&&options.method==='GET')return json({schema:'atlas-ownership-preferences-receipt-v1',...base(),requestId:recovery[1],outcome:s.records.has(recovery[1])?'RECORDED':'ABSENT',receipt:s.records.get(recovery[1])??null});
   const match=path.match(/^\/account\/api\/customer\/collection\/(?:cards\/([a-f0-9-]+)\/)?preferences$/);if(!match)throw Error('No fixture fallback');
   const cardId=match[1]??null;if(cardId&&!data.snapshot.cards.some(c=>c.cardId===cardId))return json({error:'NOT_FOUND'},404);
   if(cardId&&!s.cards.has(cardId))s.cards.set(cardId,{cardId,ownershipRevision:1,revision:0,visibility:'PRIVATE',offersDisabled:false});
   const target=cardId?s.cards.get(cardId):s.collection,action=cardId?'set_card_preferences':'set_collection_preferences';
   if(options.method==='GET')return json({schema:'atlas-ownership-preferences-current-v1',...base(),collectionPreferences:{...s.collection},cardPreferences:cardId?{...target}:null,
    effective:{visibility:s.collection.visibility==='PRIVATE'||target.visibility==='PRIVATE'?'PRIVATE':'PUBLIC',preference:s.collection.offersDisabled||target.offersDisabled?'DISABLED':'OPEN_TO_OFFERS',canReceiveOffers:false,notificationDelivery:'NOT_REQUESTED'}});
   if(options.headers['x-atlas-customer-csrf']!=='synthetic-existing-bootstrap-csrf')return json({error:'CSRF_REQUIRED'},403);
   const input=JSON.parse(options.body);let receipt=s.records.get(input.requestId);
   if(!receipt&&target.revision>input.expectedPreferenceRevision)return json({schema:'atlas-ownership-preferences-stale-v1',...base(),outcome:'NOT_APPLIED_STALE',requestId:input.requestId,action,cardId,input,observedPreferenceRevision:target.revision});
   if(!receipt){if(target.revision!==input.expectedPreferenceRevision)throw Error('Invalid fixture revision');target.revision++;target.visibility=input.visibility;target.offersDisabled=input.offersDisabled;
    receipt={eventId:crypto.randomUUID(),requestId:input.requestId,action,kind:cardId?'CARD_PREFERENCES_SET':'COLLECTION_PREFERENCES_SET',cardId,input,preferenceRevision:target.revision,recordedAt:new Date().toISOString()};s.records.set(input.requestId,receipt);}
   if(s.lose){s.lose=false;throw Error('Synthetic lost committed response');}if(s.hold){s.hold=false;await new Promise(resolve=>{s.pending=resolve;});}
   return json({schema:'atlas-ownership-preferences-receipt-v1',...base(),requestId:input.requestId,outcome:'RECORDED',receipt});
  };
  const reader=createCollectionDisplayReader({fetcher:async(path,options)=>{if(options.method!=='GET')throw Error('Read only');s.photos++;paint(v=>v+1);
   if(s.denied)return json({error:'COLLECTION_DISPLAY_ACCESS_ENDED'},403);if(path===displayPath(data.snapshot.cards[0].cardId))return json(structuredClone(data.display));
   if(path!==data.display.front.path)throw Error('No photo fallback');return new Response(photo.slice(),{headers:{'content-type':'image/webp','content-length':String(photo.length),'x-atlas-image-sha256':data.display.front.sha256}});
  }});return{request,reader,readPage:async()=>structuredClone(data.snapshot)};
 },[data]);
 const s=state.current;
 return <><aside aria-label="Synthetic preview controls" style={{padding:16,display:'flex',flexWrap:'wrap',gap:10,background:'#fff',color:'#17211d'}}>
  <strong>Synthetic settings and ownership only</strong><span role="status">Settings reads: {s.reads} · Saves: {s.writes} · Display GETs: {s.photos}</span>
  <button onClick={()=>{s.lose=true;}}>Lose next save reply</button><button onClick={()=>{s.collection.revision++;s.collection.visibility=s.collection.visibility==='PRIVATE'?'PUBLIC':'PRIVATE';}}>Change saved settings elsewhere</button>
  <button onClick={()=>{s.hold=true;}}>Hold next save reply</button><button onClick={()=>{s.pending?.();s.pending=null;}}>Release old save reply</button>
  <button onClick={()=>{s.denied=true;}}>Deny next request</button><button onClick={()=>setAccess('ENDED')}>End access</button>
  <button onClick={()=>{s.denied=false;setCustomer({id:data.accountId});setAccess('READY');}}>New session</button><button onClick={()=>setEnabled(v=>!v)}>{enabled?'Disable settings':'Enable settings'}</button>
 </aside><CollectionWorkspace customer={customer} accessState={access} readPage={capability.readPage} displayReader={capability.reader}
  preferencesSession={session} preferencesRequest={enabled?capability.request:null} onAccessLost={()=>setAccess('ENDED')}/></>;
}
