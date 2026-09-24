import { createHash } from 'node:crypto';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { requireThat } from '@atlas/manual-service/contract';

export const CATALOG_ORIGIN = 'https://collect.tenkings.co';
export const CATALOG_SERVICE_VERSION = 'card-catalog-service/v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function pin(value) {
  requireThat(value && Object.keys(value).sort().join(',') === 'manifestSha256,publicationId,revision,setId'
    && opaque(value.publicationId) && opaque(value.setId) && Number.isSafeInteger(value.revision) && value.revision > 0 && hex(value.manifestSha256), 502, 'RESEARCH_CATALOG_INVALID');
  return structuredClone(value);
}
const samePin = (a,b) => canonicalJson(pin(a)) === canonicalJson(pin(b));
async function read(response, maximum, signal) {
  const header = response.headers.get('content-length');
  requireThat(!header || /^\d+$/.test(header) && Number(header) <= maximum, 502, 'RESEARCH_CATALOG_TOO_LARGE');
  const reader = response.body?.getReader(); requireThat(reader,502,'RESEARCH_CATALOG_INVALID');
  const chunks = []; let count=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});}; signal?.addEventListener('abort',cancel,{once:true});
  try {while(true){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;count+=part.value.length;
    requireThat(count<=maximum,502,'RESEARCH_CATALOG_TOO_LARGE');chunks.push(Buffer.from(part.value));}
    if(header && !response.headers.get('content-encoding'))requireThat(count===Number(header),502,'RESEARCH_CATALOG_TRUNCATED');
    return Buffer.concat(chunks,count);
  } finally {signal?.removeEventListener('abort',cancel);cancel();}
}

/** Only the existing collect facade has authority; no database or storage import.
 * fetchImpl may be the ATLAS durable effect adapter. Tokens never enter receipts. */
export function createAtlasCatalogClient({token,fetchImpl=globalThis.fetch}={}) {
  requireThat(typeof token==='string' && /^[A-Za-z0-9_-]{43,128}$/.test(token) && typeof fetchImpl==='function',503,'RESEARCH_CATALOG_NOT_CONFIGURED');
  const imagePins = new Map(); let currentChecks=0;
  async function send(operation,body,signal,purpose=null){
    const url=`${CATALOG_ORIGIN}/api/internal/card-catalog/v1/${operation}`;
    const response=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',signal,...(purpose?{researchPurpose:purpose}:{}),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    requireThat(!response.redirected && (!response.url || response.url===url),502,'RESEARCH_CATALOG_REDIRECT');
    const bytes=await read(response,operation==='media'?4*1024*1024:1024*1024,signal);
    requireThat(response.ok, response.status===409?409:503,'RESEARCH_CATALOG_UNAVAILABLE');
    if(operation==='media')return {response,bytes};
    requireThat(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'') && !bytes.includes(Buffer.from(token)),502,'RESEARCH_CATALOG_INVALID');
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{requireThat(false,502,'RESEARCH_CATALOG_INVALID');}
    requireThat(value?.schemaVersion===CATALOG_SERVICE_VERSION,502,'RESEARCH_CATALOG_INVALID');return value;
  }
  return Object.freeze({
    async findCurrentSetCatalogPublications({query}, signal) {
      const result=await send('discover',{query},signal);
      requireThat(Array.isArray(result.publications)&&result.publications.length<=8,502,'RESEARCH_CATALOG_INVALID');
      const pins=result.publications.map(pin);
      requireThat(new Set(pins.map(p=>p.publicationId)).size===pins.length&&new Set(pins.map(p=>p.setId)).size===pins.length,502,'RESEARCH_CATALOG_INVALID');
      return pins;
    },
    async lookupPublishedSetCatalogEvidence({publication,query}, signal){
      pin(publication);const {result}=await send('lookup',{publication,query},signal);
      const p=result?.publication;const observed=p&&{publicationId:p.publicationId,setId:p.setId,revision:p.revision,manifestSha256:p.manifestSha256};
      requireThat(result?.schemaVersion==='catalog-evidence-lookup/v1'&&result.authority==='host_authorized_setops_publication'
        && observed&&samePin(observed,publication)&&opaque(p.setApprovalId)&&Number.isFinite(Date.parse(p.reviewedAt))
        && result.set?.setId===publication.setId&&result.set.category===query.category
        && result.absenceEstablishesExclusion===false&&result.identityDecision==='consumer_review_required'
        && Array.isArray(result.candidates)&&result.candidates.length<=24&&Array.isArray(result.sources)
        && Number.isSafeInteger(result.totalCandidateCount)&&result.totalCandidateCount>=0&&result.returnedCount===result.candidates.length
        && result.returnedCount<=result.totalCandidateCount&&result.truncated===(result.totalCandidateCount>result.returnedCount)
        && ['text','applicability','images'].every(k=>['complete','partial','truncated','unknown'].includes(result.coverage?.[k]?.status)),502,'RESEARCH_CATALOG_INVALID');
      for(const candidate of result.candidates)for(const image of candidate.images??[]){
        requireThat(opaque(image.imageId)&&hex(image.sha256)&&['image/jpeg','image/png','image/webp'].includes(image.mimeType)
          && Number.isSafeInteger(image.width)&&image.width>0&&Number.isSafeInteger(image.height)&&image.height>0,502,'RESEARCH_CATALOG_INVALID');
        // Media retrieval is by reviewed publication/image id only. The host's
        // opaque artifact locator is never exposed to the core or its model.
        delete image.mediaRef;
        imagePins.set(`${canonicalJson(publication)}:${image.imageId}`,{...image});
      }
      return result;
    },
    async currentFor(publication,category,signal){
      requireThat(['SPORTS','POKEMON'].includes(category),400,'RESEARCH_CATALOG_INVALID');
      const result=await send('discover',{query:{setId:publication.setId,category}},signal,`catalog-current:${++currentChecks}`);
      requireThat(Array.isArray(result.publications)&&result.publications.length<=8,502,'RESEARCH_CATALOG_INVALID');
      const pins=result.publications.map(pin);
      requireThat(new Set(pins.map(p=>p.publicationId)).size===pins.length&&new Set(pins.map(p=>p.setId)).size===pins.length,502,'RESEARCH_CATALOG_INVALID');
      return pins.some(p=>samePin(p,publication));
    },
    async readPublishedSetCatalogImage({publication,imageId},signal){
      const expected=imagePins.get(`${canonicalJson(pin(publication))}:${imageId}`);requireThat(expected,409,'RESEARCH_CATALOG_IMAGE_UNBOUND');
      const {response,bytes}=await send('media',{publication,imageId},signal),mimeType=(response.headers.get('content-type')??'').split(';')[0].trim();
      requireThat(hash(bytes)===expected.sha256&&response.headers.get('x-catalog-image-sha256')===expected.sha256&&mimeType===expected.mimeType
        && Number(response.headers.get('x-catalog-image-width'))===expected.width&&Number(response.headers.get('x-catalog-image-height'))===expected.height,502,'RESEARCH_CATALOG_IMAGE_CHANGED');
      return {bytes,sha256:expected.sha256,mimeType,width:expected.width,height:expected.height};
    },
    async submit(proposal,signal){
      const prepared=prepareObservationProposal(proposal);requireThat(prepared.proposal.producer==='atlas'&&prepared.proposal.images.length===0,400,'RESEARCH_PROPOSAL_INVALID');
      const p=prepared.proposal, result=await send('proposals',{proposal:p,observation:{physicalCardRef:p.physicalCardRef,observationId:p.observationId,inputRevision:p.inputRevision,evidenceSha256:prepared.proposalSha256}},signal);
      const receipt=result.receipt;
      requireThat(result.disposition==='requires_authorized_review'&&opaque(receipt?.proposalId)&&receipt.proposalSha256===prepared.proposalSha256
        &&receipt.idempotencyKey===prepared.idempotencyKey&&['recorded','replay'].includes(receipt.outcome),502,'RESEARCH_PROPOSAL_RECEIPT_INVALID');
      return {state:'RECORDED',disposition:'requires_authorized_review',receipt};
    },
  });
}
