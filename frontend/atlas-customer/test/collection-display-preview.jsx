// Browser-only synthetic qualification entry. Root supplies serialized output
// of createCollectionDisplayPreviewData(); no server/SQL/storage imports.
import {useMemo,useRef,useState} from 'react';
import CollectionWorkspace from '../components/collection/CollectionWorkspace.jsx';
import {createCollectionDisplayReader} from '../lib/collection-display-client.mjs';
import {displayPath} from '../lib/collection-display-contract.mjs';

export default function CollectionDisplayPreview({data}) {
 const control=useRef({failed:false,ownerLost:false,holdNext:false,pending:null,requests:[]});
 const [customer,setCustomer]=useState({id:data.accountId}),[access,setAccess]=useState('READY'),[enabled,setEnabled]=useState(true),[count,setCount]=useState(0);
 const capability=useMemo(()=>{
  const photo=Uint8Array.from(atob(data.photoBase64),x=>x.charCodeAt(0));
  const reader=createCollectionDisplayReader({fetcher:async(path,options)=>{
    if(options.method!=='GET'||options.credentials!=='same-origin'||options.redirect!=='error'||options.cache!=='no-store')throw Error('Unexpected fixture request');
    control.current.requests.push(path);setCount(control.current.requests.length);
    if(control.current.ownerLost)return Response.json({error:'COLLECTION_DISPLAY_ACCESS_ENDED'},{status:403});
    if(path===displayPath(data.snapshot.cards[0].cardId))return Response.json(structuredClone(data.display));
    if(path!==data.display.front.path)throw Error('No fixture route fallback');
    if(control.current.holdNext){control.current.holdNext=false;return new Promise(resolve=>{control.current.pending=()=>resolve(Response.json({error:'COLLECTION_DISPLAY_ACCESS_ENDED'},{status:403}));});}
    if(control.current.failed)return Response.json({error:'COLLECTION_DISPLAY_UNAVAILABLE'},{status:503});
    return new Response(photo.slice(),{headers:{'content-type':'image/webp','content-length':String(photo.length),'x-atlas-image-sha256':data.display.front.sha256}});
  }});
  return {reader,readPage:async()=>structuredClone(data.snapshot)};
 },[data]);
 const controls={display:'flex',flexWrap:'wrap',gap:8,padding:16,background:'#fff',color:'#17211d'};
 return <><aside style={controls} aria-label="Synthetic preview controls">
  <strong>Synthetic ownership and approved photo fixture</strong><span role="status">Display GETs: {count}</span>
  <button onClick={()=>{control.current.failed=true;}}>Photo unavailable on next read</button>
  <button onClick={()=>{control.current.failed=false;}}>Restore photo</button>
  <button onClick={()=>{control.current.ownerLost=true;}}>Owner lost on next read</button>
  <button onClick={()=>{control.current.holdNext=true;}}>Hold next photograph</button>
  <button onClick={()=>{control.current.pending?.();control.current.pending=null;}}>Release old refusal</button>
  <button onClick={()=>{control.current.failed=false;control.current.ownerLost=false;setCustomer({id:data.accountId});setAccess('READY');}}>New session</button>
  <button onClick={()=>setEnabled(value=>!value)}>{enabled?'Disable display':'Enable display'}</button>
  <button onClick={()=>setAccess('ENDED')}>End access</button>
 </aside><CollectionWorkspace customer={customer} accessState={access} readPage={capability.readPage}
   displayReader={enabled?capability.reader:null} onAccessLost={()=>setAccess('ENDED')}/></>;
}
