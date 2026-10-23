import { createHash } from 'node:crypto';
import { requireValue } from './contract.mjs';

export const R1_APPROVED_EVIDENCE_ORIGIN='https://atlasgrading.com';
export const R1_APPROVED_EVIDENCE_LIMITS=Object.freeze({reportBytes:8*1024*1024,imageBytes:2*1024*1024,timeoutMs:20000,concurrent:2});
const check=value=>requireValue(value,'R1_APPROVED_EVIDENCE_UNAVAILABLE');
const sha=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const SHA=/^[a-f0-9]{64}$/;

/** Load the current canonical parser and WebP header checker explicitly. No R1
 * runtime(), storage clients, secret configuration or publication operations. */
export async function loadR1CanonicalEvidenceBindings() {
  const [report,display]=await Promise.all([import('../../atlas-report-view/src/manual-public-contract.mjs'),import('../../../frontend/atlas-customer/lib/collection-display-contract.mjs')]);
  return Object.freeze({parseReport:report.parsePublicManualReport,verifyImage:display.verifyDisplayWebp});
}

/** Concrete fixed-publication transport. The expected binding must come from a
 * separately qualified approved-card reader, never a browser report selector.
 * It proves only these exact already-public bytes, not title/custody/eligibility.
 * Server-injected request/validators permit isolated contract tests; deployment
 * passes loadR1CanonicalEvidenceBindings() and a separately checked approval.
 */
export function createR1ApprovedEvidenceReader(options={}) {
  const {enabled=false,mode,approvalRef,assertReady,request=fetch,parseReport,verifyImage}=options;
  let closed=false,active=0;
  function current() {
    check(!closed&&enabled===true&&options.enabled===true&&['PRODUCTION','LOCAL_FIXTURE'].includes(mode)&&options.mode===mode
      &&typeof approvalRef==='string'&&approvalRef.trim().length>0&&options.approvalRef===approvalRef&&options.assertReady===assertReady
      &&typeof assertReady==='function'&&typeof request==='function'&&(options.request??fetch)===request
      &&typeof parseReport==='function'&&options.parseReport===parseReport&&typeof verifyImage==='function'&&options.verifyImage===verifyImage);
    const result=assertReady({operation:'READ_EXACT_PUBLIC_APPROVED_EVIDENCE',origin:R1_APPROVED_EVIDENCE_ORIGIN,mode,approvalRef});
    if(result&&typeof result.then==='function'){void Promise.resolve(result).catch(()=>{});check(false);}check(result===true);
  }
  function binding(value) {
    check(exact(value,['publicToken','version','publicHash','reportHash','certificateNumber'])&&/^ar_[A-Za-z0-9_-]{24}$/.test(value.publicToken)
      &&Number.isSafeInteger(value.version)&&value.version>0&&value.version<2147483647&&SHA.test(value.publicHash)&&SHA.test(value.reportHash)&&/^ATLAS-[A-F0-9]{12}$/.test(value.certificateNumber));
    return Object.freeze({...value});
  }
  const discard=value=>{try{void Promise.resolve(value?.body?.cancel()).catch(()=>{});}catch{}};
  function abortable(work,signal,late) {
    const promise=Promise.resolve(work);promise.then(value=>{if(signal.aborted)late?.(value);},()=>{});
    let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(Object.assign(new Error('R1_APPROVED_EVIDENCE_UNAVAILABLE'),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'}));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    return Promise.race([promise,stopped]).finally(()=>signal.removeEventListener('abort',abort));
  }
  async function bytes(path,type,limit,signal) {
    current();signal.throwIfAborted();const url=R1_APPROVED_EVIDENCE_ORIGIN+path;let response,reader;
    try {
      response=await Promise.resolve().then(()=>{signal.throwIfAborted();current();return request(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{accept:type,'accept-encoding':'identity'},signal});});
      current();signal.throwIfAborted();
      check(response?.ok===true&&response.status===200&&!response.redirected&&(!response.url||response.url===url)
        &&response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()===type&&/\bno-store\b/i.test(response.headers.get('cache-control')??''));
      const length=response.headers.get('content-length');check(length===null||/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)<=limit);
      const encoding=response.headers.get('content-encoding');check(encoding===null||encoding==='identity');
      check(response.body?.getReader);reader=response.body.getReader();const chunks=[];let count=0;
      while(true){const part=await reader.read();signal.throwIfAborted();if(part.done)break;check(part.value instanceof Uint8Array);count+=part.value.byteLength;check(count<=limit);chunks.push(Buffer.from(part.value));}
      check(count>0&&(length===null||count===Number(length)));current();return Buffer.concat(chunks,count);
    } finally {try{void Promise.resolve(reader?.cancel()).catch(()=>{});reader?.releaseLock();}catch{}discard(response);}
  }
  async function report(expected,signal) {
    const raw=await bytes(`/api/reports/${expected.publicToken}?v=${expected.version}`,'application/json',R1_APPROVED_EVIDENCE_LIMITS.reportBytes,signal);
    let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{check(false);}
    check(exact(result,['packet','publicHash'])&&result.publicHash===expected.publicHash&&sha(JSON.stringify(result.packet))===expected.publicHash);
    const packet=parseReport(result.packet);
    check(sha(JSON.stringify(packet))===expected.publicHash&&packet.publicToken===expected.publicToken&&packet.approvalVersion===expected.version
      &&packet.reportHash===expected.reportHash&&packet.reportNumber===expected.certificateNumber&&packet.mode===mode);
    check(exact(packet.images,['FRONT','BACK']));
    for(const side of ['FRONT','BACK']) {const d=packet.images[side];check(exact(d,['sha256','byteCount','width','height','contentType'])&&SHA.test(d.sha256)&&Number.isSafeInteger(d.byteCount)&&d.byteCount>0&&d.byteCount<=50*1024*1024&&d.width===1350&&d.height===1858&&d.contentType==='image/webp');}
    current();signal.throwIfAborted();return {packet,publicHash:result.publicHash,reportPath:`/reports/${expected.publicToken}?v=${expected.version}`};
  }
  async function bounded(expected,externalSignal,work) {
    current();const pinned=binding(expected);check(active<R1_APPROVED_EVIDENCE_LIMITS.concurrent&&(!externalSignal||externalSignal instanceof AbortSignal));
    active++;const signal=externalSignal?AbortSignal.any([externalSignal,AbortSignal.timeout(R1_APPROVED_EVIDENCE_LIMITS.timeoutMs)]):AbortSignal.timeout(R1_APPROVED_EVIDENCE_LIMITS.timeoutMs);
    // Keep capacity occupied until ignored/late transport actually settles.
    // Timeout returns promptly but cannot create unlimited abandoned I/O.
    const pending=Promise.resolve().then(()=>{signal.throwIfAborted();return work(pinned,signal);}).finally(()=>{active--;});
    try{return await abortable(pending,signal);}catch{check(false);}
  }
  return Object.freeze({
    readReport(expected,{signal}={}) {return bounded(expected,signal,report);},
    readImage(expected,side,{signal}={}) {return bounded(expected,signal,async(pinned,s)=>{
      check(['FRONT','BACK'].includes(side));const before=await report(pinned,s),descriptor=before.packet.images[side];
      check(descriptor.byteCount<=R1_APPROVED_EVIDENCE_LIMITS.imageBytes);
      const data=await bytes(`/api/reports/${pinned.publicToken}/images/${side}?v=${pinned.version}`,'image/webp',R1_APPROVED_EVIDENCE_LIMITS.imageBytes,s);
      check(data.length===descriptor.byteCount&&sha(data)===descriptor.sha256);const verified=verifyImage(data,descriptor);
      if(verified&&typeof verified.then==='function'){void Promise.resolve(verified).catch(()=>{});check(false);}check(verified===undefined);
      const after=await report(pinned,s);check(sha(JSON.stringify(after))===sha(JSON.stringify(before)));current();s.throwIfAborted();
      return {bytes:Buffer.from(data),contentType:descriptor.contentType,sha256:descriptor.sha256,width:descriptor.width,height:descriptor.height};
    });},
    close(){closed=true;},
  });
}
