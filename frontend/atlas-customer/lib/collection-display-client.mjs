import { COLLECTION_DISPLAY_LIMITS as LIMITS, collectionDisplayBinding, displayPath, parseCollectionDisplay, verifyDisplayWebp, displayCheck, displayError } from './collection-display-contract.mjs';

const aborted = () => Object.assign(new Error('Display read cancelled'), {name:'AbortError'});
function raceAbort(work,signal,late) {
  let listener;
  const promise=Promise.resolve(work); promise.then(value=>{if(signal.aborted)late?.(value);},()=>{});
  const stopped=new Promise((_,reject)=>{listener=()=>reject(aborted());signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();});
  return Promise.race([promise,stopped]).finally(()=>signal.removeEventListener('abort',listener));
}
const discard = response => { try { void Promise.resolve(response?.body?.cancel()).catch(()=>{}); } catch { /* cancelled */ } };
async function bytes(response,max,signal) {
  const declared=response.headers.get('content-length');
  displayCheck(declared===null || /^[1-9][0-9]*$/.test(declared) && Number(declared)<=max);
  displayCheck(response.body && typeof response.body.getReader==='function');
  const reader=response.body.getReader(),chunks=[];let length=0,done=false;
  const cancel=()=>{try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{/* closed */}};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    while(true){const value=await raceAbort(reader.read(),signal);if(value.done){done=true;break;}
      displayCheck(value.value instanceof Uint8Array);length+=value.value.length;displayCheck(length<=max);chunks.push(value.value);}
    displayCheck(declared===null || Number(declared)===length);
    const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
  } finally {signal.removeEventListener('abort',cancel);if(!done)cancel();try{reader.releaseLock();}catch{/* pending read */}}
}
async function get(fetcher,path,signal,type,max) {
  const response=await raceAbort(Promise.resolve().then(()=>{signal.throwIfAborted();return fetcher(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{accept:type}});}),signal,discard);
  try {
    if(response.status===401||response.status===403)throw displayError('COLLECTION_DISPLAY_ACCESS_ENDED',403);
    displayCheck(response.ok && !response.redirected && response.headers.get('content-type')?.split(';')[0]===type);
    return {response,bytes:await bytes(response,max,signal)};
  } catch(error){discard(response);throw error;}
}

/** Explicit injected browser capability. No default fetch, import effects,
 * durable cache, public-image fallback or retry. One shared reader queues at
 * most two visible component reads; cancelled queue entries never start. */
export function createCollectionDisplayReader({fetcher,crypto=globalThis.crypto,urls=globalThis.URL}={}) {
  displayCheck(typeof fetcher==='function' && typeof crypto?.subtle?.digest==='function' && typeof urls?.createObjectURL==='function' && typeof urls?.revokeObjectURL==='function');
  let active=0;const queue=[];
  function pump(){while(active<LIMITS.concurrent&&queue.length){const job=queue.shift();if(job.signal.aborted){job.reject(aborted());continue;}
    active++;job.start().then(job.resolve,job.reject).finally(()=>{active--;pump();});}}
  return Object.freeze({read({accountId,card,signal,onDisplay}={}) {
    const expected=collectionDisplayBinding(card,accountId),controller=new AbortController();
    const stop=()=>controller.abort(),timer=setTimeout(stop,LIMITS.timeoutMs);
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    const work=new Promise((resolve,reject)=>{queue.push({signal:controller.signal,resolve,reject,async start(){
      const s=controller.signal;
      const metadata=await get(fetcher,displayPath(card.cardId),s,'application/json',LIMITS.metadataBytes);
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata.bytes));}catch{throw displayError();}
      const display=parseCollectionDisplay(value,expected);s.throwIfAborted();onDisplay?.(display);s.throwIfAborted();
      if(display.front.status!=='AVAILABLE')return {display,url:null,dispose(){}};
      const photo=await get(fetcher,display.front.path,s,'image/webp',LIMITS.imageBytes);
      displayCheck(photo.response.headers.get('x-atlas-image-sha256')===display.front.sha256);
      verifyDisplayWebp(photo.bytes,display.front);
      const digest=await raceAbort(crypto.subtle.digest('SHA-256',photo.bytes),s);
      displayCheck([...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')===display.front.sha256);
      s.throwIfAborted();const url=urls.createObjectURL(new Blob([photo.bytes],{type:'image/webp'}));let disposed=false;
      return {display,url,dispose(){if(!disposed){disposed=true;urls.revokeObjectURL(url);}}};
    }});pump();});
    // A late ignored transport/body cannot hold component teardown hostage.
    return raceAbort(work,controller.signal,result=>result?.dispose()).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);});
  }});
}
