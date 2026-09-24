import {canonical,digest,requireThat} from '@atlas/manual-service/contract';
import {isStaffInventoryResearchImageUrl} from '@tenkings/card-research-core';
import {CATALOG_ORIGIN} from './research-catalog.mjs';
const CATALOG=`${CATALOG_ORIGIN}/api/internal/card-catalog/v1/`;
function effectRequest(url,init){
  const value=new URL(String(url)),method=init.method??'GET',body=init.body??null;
  const source=value.origin==='https://api.sold-comps.com'&&(value.pathname==='/v1/scrape'||/^\/v1\/item\/\d{10,15}$/.test(value.pathname))&&method==='GET';
  const model=value.href==='https://api.openai.com/v1/responses'&&method==='POST';
  const catalog=value.href.startsWith(CATALOG)&&/^(discover|lookup|media|proposals)$/.test(value.href.slice(CATALOG.length))&&method==='POST';
  const image=isStaffInventoryResearchImageUrl(value.href)&&method==='GET';
  requireThat((source||model||catalog||image)&&!value.username&&!value.password&&!value.hash&&(!body||typeof body==='string'),400,'RESEARCH_EFFECT_INVALID');
  requireThat(!body||Buffer.byteLength(body)<=15*1024*1024,413,'RESEARCH_REQUEST_TOO_LARGE');
  return {version:'atlas-research-effect-v1',kind:source?'SOURCE':model?'MODEL':catalog?'CATALOG':'IMAGE',url:value.href,method,body,purpose:init.researchPurpose??null};
}
function usage(bytes){try{const value=JSON.parse(bytes.toString('utf8'))?.usage;return value&&typeof value==='object'?Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(k=>Number.isSafeInteger(value[k])&&value[k]>=0).map(k=>[k,value[k]])):null;}catch{return null;}}
/** Exact responses are acknowledged before the shared core can parse/adopt them.
 * Re-entry reads a retained response. A dispatch without one is uncertain and
 * never buys the same effect again, even following a crash or session expiry. */
export function createResearchEffects({journal,artifacts,staff,cardId,requestId,sourceHash,fetchImpl=globalThis.fetch,secrets=[],reconcileCatalogProposal=false}){
  const write=(kind,value)=>artifacts.write(value,{cardId,kind,sourceHash});
  async function response(row,requestHash){
    requireThat(row?.evidence?.ref,409,'RESEARCH_OUTCOME_UNKNOWN');
    const value=await artifacts.read(row.evidence.ref,{cardId,kind:'RESEARCH_RESPONSE',sourceHash});
    const bytes=Buffer.from(value.base64,'base64');
    requireThat(value.requestHash===requestHash&&digest(bytes)===value.sha256&&bytes.toString('base64')===value.base64,503,'RESEARCH_RECEIPT_CORRUPT');
    return new Response(bytes,{status:value.status,headers:value.headers});
  }
  return async function recordedFetch(url,init={}){
    init.signal?.throwIfAborted();const request=effectRequest(url,init),requestHash=digest(JSON.stringify(request));
    requireThat(!secrets.some(secret=>secret&&(request.url.includes(secret)||request.body?.includes(secret))),400,'RESEARCH_REQUEST_INVALID');
    const ref=await write('RESEARCH_REQUEST',{request,requestHash});
    init.signal?.throwIfAborted();
    const claim=await journal.dispatch(staff,cardId,requestId,requestHash,{ref,kind:request.kind});
    if(!claim.created){
      const retained=claim.rows.find(row=>row.event==='RESPONSE');
      if(retained){
        const recorded=await response(retained,requestHash);
        if(reconcileCatalogProposal&&request.kind==='CATALOG'&&request.url===`${CATALOG}proposals`&&!recorded.ok){
          // Retain an acknowledged host failure and admit one fresh, explicitly
          // requested idempotent receipt attempt. The host payload stays exact.
          return recordedFetch(url,{...init,researchPurpose:`catalog-proposal-reconciliation:${claim.sequence}`});
        }
        return recorded;
      }
      // Only an explicit contribution retry may reconcile the host's exactly
      // idempotent metadata proposal. Paid research effects never enter here.
      requireThat(reconcileCatalogProposal&&request.kind==='CATALOG'&&request.url===`${CATALOG}proposals`,409,'RESEARCH_OUTCOME_UNKNOWN');
    }
    try {
      // The recorded envelope omits Authorization; only this transport has it.
      const {researchPurpose:ignored,...network}=init;
      const received=await fetchImpl(request.url,{...network,method:request.method,redirect:'error',cache:'no-store'});
      requireThat(!received.redirected&&(!received.url||received.url===request.url),502,'RESEARCH_REDIRECT');
      const maximum=request.kind==='SOURCE'?5*1024*1024:request.kind==='MODEL'?256*1024:request.kind==='IMAGE'?2*1024*1024:request.url.endsWith('/media')?4*1024*1024:1024*1024;
      const declared=received.headers.get('content-length');requireThat(!declared||/^\d+$/.test(declared)&&Number(declared)<=maximum,502,'RESEARCH_RESPONSE_TOO_LARGE');
      const reader=received.body?.getReader();requireThat(reader,502,'RESEARCH_RESPONSE_INVALID');const chunks=[];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;requireThat(size<=maximum,502,'RESEARCH_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});}
      const bytes=Buffer.concat(chunks,size);
      requireThat(!declared||received.headers.get('content-encoding')||size===Number(declared),502,'RESEARCH_RESPONSE_TRUNCATED');
      requireThat(!secrets.some(secret=>secret&&bytes.includes(Buffer.from(secret))),502,'RESEARCH_RESPONSE_INVALID');
      const headers=Object.fromEntries(['content-type','x-catalog-image-sha256','x-catalog-image-width','x-catalog-image-height','x-request-id']
        .flatMap(name=>{const value=received.headers.get(name);return value&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value)&&!secrets.some(secret=>secret&&value.includes(secret))?[[name,value]]:[];}));
      const evidence={requestHash,status:received.status,headers,base64:bytes.toString('base64'),sha256:digest(bytes),usage:request.kind==='MODEL'?usage(bytes):null};
      const responseRef=await write('RESEARCH_RESPONSE',evidence);
      try{await journal.receipt(cardId,requestId,claim.sequence,'RESPONSE',requestHash,{ref:responseRef});}
      catch(error){
        // A first catalog response may win while an explicit reconciliation is
        // in flight. Keep its exact immutable receipt (recorded vs replay differs).
        if(request.kind==='CATALOG'&&request.url===`${CATALOG}proposals`){
          const rows=await journal.read(staff,cardId,requestId);
          const retained=rows.find(row=>row.sequence===claim.sequence&&row.event==='RESPONSE');
          if(retained)return response(retained,requestHash);
        }
        throw error;
      }
      init.signal?.throwIfAborted();return new Response(bytes,{status:received.status,headers});
    }catch(error){
      await journal.receipt(cardId,requestId,claim.sequence,'FAILURE',requestHash,{code:'RESEARCH_OUTCOME_UNKNOWN'}).catch(()=>{});
      throw error;
    }
  };
}
