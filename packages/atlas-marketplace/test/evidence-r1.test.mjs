import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR1ApprovedEvidenceReader,R1_APPROVED_EVIDENCE_ORIGIN} from '../src/evidence-r1.mjs';
import {verifyDisplayWebp} from '../../../frontend/atlas-customer/lib/collection-display-contract.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture() {
  // Header-only synthetic WebP contract fixture; no claim of decoder/browser
  // qualification. The actual canonical header verifier is exercised here.
  const image=Buffer.alloc(26);image.write('RIFF');image.writeUInt32LE(18,4);image.write('WEBP',8);image.write('VP8L',12);image.writeUInt32LE(5,16);image[20]=0x2f;image.writeUInt32LE((1350-1)|((1858-1)<<14),21);
  const descriptor={sha256:sha(image),byteCount:image.length,width:1350,height:1858,contentType:'image/webp'};
  const packet={version:'atlas-public-manual-report-v2',publicToken:'ar_'+'a'.repeat(24),approvalVersion:1,reportNumber:'ATLAS-ABCDEF123456',reportHash:'1'.repeat(64),mode:'LOCAL_FIXTURE',images:{FRONT:descriptor,BACK:{...descriptor}}};
  const expected={publicToken:packet.publicToken,version:1,publicHash:sha(JSON.stringify(packet)),reportHash:packet.reportHash,certificateNumber:packet.reportNumber};
  const f={image,packet,expected,calls:[],ready:true,transform:v=>v};
  f.options={enabled:true,mode:'LOCAL_FIXTURE',approvalRef:'ISOLATED_EVIDENCE_CONTRACT_ONLY',assertReady:()=>f.ready,
    parseReport:value=>structuredClone(value),verifyImage:verifyDisplayWebp,
    request:async(url,init)=>{f.calls.push({url,init});const body=url.includes('/images/')?image:JSON.stringify({packet:f.packet,publicHash:sha(JSON.stringify(f.packet))});return f.transform(new Response(body,{status:200,headers:{'Content-Type':url.includes('/images/')?'image/webp':'application/json','Cache-Control':'no-store','Content-Length':String(Buffer.byteLength(body))}}));}};
  f.reader=createR1ApprovedEvidenceReader(f.options);return f;
}

test('fixed R1 exact report and both original sides retain hash/version semantics and send no credentials',async()=>{
  const f=fixture();
  for(const side of ['FRONT','BACK']){const result=await f.reader.readImage(f.expected,side);assert.equal(result.sha256,sha(f.image));assert.equal(result.width,1350);assert.equal(result.height,1858);assert.deepEqual(result.bytes,f.image);}
  const report=await f.reader.readReport(f.expected);assert.equal(report.publicHash,f.expected.publicHash);assert.equal(report.packet.reportHash,f.expected.reportHash);assert.equal(report.reportPath,`/reports/${f.expected.publicToken}?v=1`);
  assert.equal(f.calls.length,7);
  for(const {url,init} of f.calls){assert.ok(url.startsWith(R1_APPROVED_EVIDENCE_ORIGIN+'/api/reports/'+f.expected.publicToken));assert.ok(url.endsWith('?v=1'));assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.deepEqual(Object.keys(init.headers).sort(),['accept','accept-encoding']);}
});

test('evidence reader refuses unapproved composition, selector aliases, stale publication, wrong bytes and mutated readiness',async()=>{
  const disabled=createR1ApprovedEvidenceReader();await assert.rejects(disabled.readReport(fixture().expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  for(const update of [{publicToken:'https://untrusted.invalid'},{version:0},{publicHash:'f'.repeat(64)},{reportHash:'e'.repeat(64)},{certificateNumber:'ATLAS-FFFFFFFFFFFF'},{url:'https://untrusted.invalid'}]) {
    const f=fixture();await assert.rejects(f.reader.readReport({...f.expected,...update}),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  }
  const stale=fixture();stale.options.request=async()=>assert.fail('port swap');await assert.rejects(stale.reader.readReport(stale.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  const revoked=fixture();revoked.ready=false;await assert.rejects(revoked.reader.readReport(revoked.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});assert.equal(revoked.calls.length,0);
  const mutation=fixture();let count=0;mutation.transform=response=>{if(++count===2)mutation.packet.approvalVersion=2;return response;};await assert.rejects(mutation.reader.readImage(mutation.expected,'BACK'),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  const corrupted=fixture();corrupted.image[25]=99;await assert.rejects(corrupted.reader.readImage(corrupted.expected,'FRONT'),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  const wrongDimensions=fixture();wrongDimensions.image.writeUInt32LE(2,21);wrongDimensions.packet.images.FRONT.sha256=sha(wrongDimensions.image);wrongDimensions.expected.publicHash=sha(JSON.stringify(wrongDimensions.packet));await assert.rejects(wrongDimensions.reader.readImage(wrongDimensions.expected,'FRONT'),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
});

test('bounded reader rejects oversized/redirect/encoded responses and retains slots for canceled unresolved transport',async()=>{
  for(const headers of [{'Content-Length':'8388609'},{'Content-Type':'text/html'},{'Content-Encoding':'gzip'},{'Cache-Control':'public'}]) {
    const f=fixture();f.transform=response=>{for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;};await assert.rejects(f.reader.readReport(f.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  }
  for(const [key,value] of [['redirected',true],['url','https://untrusted.invalid/evidence']]) {const f=fixture();f.transform=response=>{Object.defineProperty(response,key,{value});return response;};await assert.rejects(f.reader.readReport(f.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});}
  const f=fixture(),pending=[];f.options.request=async()=>new Promise(resolve=>pending.push(resolve));f.reader=createR1ApprovedEvidenceReader(f.options);
  const controllers=[new AbortController(),new AbortController()];
  const jobs=controllers.map(controller=>f.reader.readReport(f.expected,{signal:controller.signal}));
  await new Promise(resolve=>setImmediate(resolve));controllers.forEach(controller=>controller.abort());
  for(const job of jobs)await assert.rejects(job,{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
  await assert.rejects(f.reader.readReport(f.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});assert.equal(pending.length,2);
  pending.forEach(resolve=>resolve(new Response('{}')));await new Promise(resolve=>setImmediate(resolve));f.reader.close();await assert.rejects(f.reader.readReport(f.expected),{code:'R1_APPROVED_EVIDENCE_UNAVAILABLE'});
});
