import { useEffect, useRef, useState } from 'react';
import { collectionDisplayBinding, displayBindingKey, parseCollectionDisplay } from '../../lib/collection-display-contract.mjs';
import styles from './collection.module.css';
/* eslint-disable @next/next/no-img-element -- Only locally verified Blob bytes; an optimizer must not refetch or transform this evidence. */
const dispose = resource => { if(typeof resource?.dispose==='function')resource.dispose(); };

/** Approved Front evidence only. Never a slab, original master or ownership
 * detector. The supplied reader and all parent callbacks are lifetime-scoped. */
export default function CollectionCardMedia({accountId,card,reader,onDisplay,onAccessLost}) {
  const element=useRef(null),live=useRef(null),latest=useRef(null),ended=useRef(false);
  const [visible,setVisible]=useState(false),[attempt,setAttempt]=useState(0),[view,setView]=useState(null);
  const binding=collectionDisplayBinding(card,accountId),key=displayBindingKey(binding),read=reader?.read;
  latest.current={key,reader,read,accountId,card,onDisplay,onAccessLost};
  useEffect(()=>{
    let closed=false;const node=element.current;
    if(typeof IntersectionObserver!=='function'){setVisible(true);return()=>{closed=true;};}
    const observer=new IntersectionObserver(entries=>{if(!closed)setVisible(entries.some(x=>x.isIntersecting));},{rootMargin:'120px'});
    if(node)observer.observe(node);return()=>{closed=true;observer.disconnect();};
  },[]);
  useEffect(()=>{
    const run={key,reader,read,accountId,card,closed:false,controller:new AbortController(),resource:null};live.current=run;
    const current=()=>live.current===run&&!run.closed&&!run.controller.signal.aborted&&latest.current.key===key&&latest.current.reader===reader
      &&latest.current.read===read&&latest.current.accountId===accountId&&!ended.current;
    const clear=()=>{run.closed=true;run.controller.abort();dispose(run.resource);run.resource=null;};
    const hide=()=>{ended.current=true;clear();setView(null);};window.addEventListener('pagehide',hide);
    setView(null);
    if(visible&&!ended.current&&typeof read==='function'){
      setView({run,status:'LOADING'});
      Promise.resolve().then(()=>{if(!current())return null;return read.call(reader,{accountId,card,signal:run.controller.signal,onDisplay:value=>{
        if(!current())return;const display=parseCollectionDisplay(value,binding);setView({run,status:'LOADING',display});latest.current.onDisplay?.(display);
      }});}).then(resource=>{
        if(!current()){dispose(resource);return;}
        if(!resource)return;
        run.resource=resource;
        const display=parseCollectionDisplay(resource.display,binding);
        if(typeof resource.dispose!=='function'||resource.url!==null&&!(typeof resource.url==='string'&&resource.url.startsWith('blob:')))throw Error('Invalid image resource');
        latest.current.onDisplay?.(display);
        setView({run,status:resource.url?'DECODING':'LIMIT',display,url:resource.url});
      }).catch(error=>{
        if(!current())return;dispose(run.resource);run.resource=null;
        if(error?.code==='COLLECTION_DISPLAY_ACCESS_ENDED'||error?.status===401||error?.status===403){clear();setView(null);latest.current.onAccessLost?.();}
        else setView(prior=>({run,status:'FAILED',display:prior?.run===run?prior.display:null}));
      });
    }
    return()=>{clear();window.removeEventListener('pagehide',hide);};
  // Metadata callbacks deliberately do not restart a read after every render.
  // Each delivery uses latest only after the captured identity/lifetime guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,reader,read,accountId,visible,attempt]);
  const shown=view?.run===live.current&&!view.run.closed&&!ended.current&&view.run.key===key&&view.run.reader===reader&&view.run.read===read?view:null;
  const currentView=()=>shown&&live.current===shown.run&&!shown.run.closed&&!ended.current&&latest.current.key===key&&latest.current.reader===reader&&latest.current.read===read;
  const failed=()=>{if(!currentView())return;shown.run.resource?.dispose();shown.run.resource=null;setView({...shown,status:'FAILED',url:null});};
  const loaded=event=>{if(!currentView()||shown.run.resource?.url!==shown.url)return;const img=event.currentTarget;
    if(img.naturalWidth!==shown.display.front.width||img.naturalHeight!==shown.display.front.height){failed();return;}setView({...shown,status:'READY'});};
  return <figure ref={element} className={styles.cardPhoto} aria-label="Approved Front photograph">
    {shown?.url&&<img src={shown.url} width={1350} height={1858} alt="Front of this card in the saved approved grade report"
      className={shown.status==='READY'?styles.photoVisible:styles.photoPending} onLoad={loaded} onError={failed}/>}
    {shown?.status!=='READY'&&<p role="status">{shown?.status==='FAILED'?'Photograph unavailable.':shown?.status==='LIMIT'?'Photograph exceeds this display’s size limit.':visible?'Verifying approved photograph…':'Photograph loads when visible.'}</p>}
    {shown?.status==='FAILED'&&<button type="button" className={styles.photoRetry} onClick={()=>{if(currentView()){shown.run.closed=true;shown.run.controller.abort();shown.run.resource?.dispose();setAttempt(n=>n+1);}}}>Retry photograph</button>}
    <figcaption>Approved grading photograph · Front</figcaption>
  </figure>;
}
