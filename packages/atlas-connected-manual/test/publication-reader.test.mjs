import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request } from 'node:http';
import { once } from 'node:events';
import { signManualPublicRequest,MANUAL_PUBLIC_ORIGIN,MANUAL_PUBLIC_PATH } from '@atlas/service-bridge/manual-public';
import { createApprovedManualReader,createManualPublicHandler } from '../src/publication-reader.mjs';
import { publicationFixture } from './publication-fixture.mjs';
const config={manualKey:Buffer.alloc(32,7),manualOrigin:MANUAL_PUBLIC_ORIGIN,deploymentId:'approved-fixture.vercel.app',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64)};
async function setup(options){const f=await publicationFixture(options);await f.publication.publish({},f.cardId,f.actionId);let reads=0,disabled=false;
 const client={$transaction:async fn=>fn({$queryRawUnsafe:async(sql,...args)=>{reads++;assert.equal(sql,'SELECT * FROM atlas_manual.read_publication($1::text,$2::integer,$3::text,$4::text,$5::text)');assert.equal(args[0],f.row.public_token);return disabled?[]:[f.row];}})};
 const reader=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage,inspectionAlphaPreviews:options?.inspectionAlphaPreviews});const claims=kind=>({request:{kind,token:f.row.public_token,version:1,side:kind==='IMAGE'?'FRONT':null,findingId:kind==='TRACE'?f.full.findings[0].id:null},expiresAt:Date.now()+30000,deploymentId:config.deploymentId,releaseSha:config.releaseSha,configHash:config.configHash});
 return {...f,reader,claims,disable(){disabled=true;},get reads(){return reads;}};
}
test('native reader returns only approved packet/media/trace and rechecks control after every successful read',async()=>{
 const f=await setup();const report=JSON.parse((await f.reader.read(f.claims('REPORT'))).bytes);assert.equal(report.packet.approvalVersion,1);assert.equal(f.reads,2);
 assert.deepEqual((await f.reader.read(f.claims('IMAGE'))).bytes,f.bytes.FRONT);assert.equal(f.reads,4);
 assert.equal(JSON.parse((await f.reader.read(f.claims('TRACE'))).bytes).side,'FRONT');assert.equal(f.reads,6);
 f.disable();assert.equal(await f.reader.read(f.claims('REPORT')),null);
});
test('reader rejects byte corruption and control revocation during slow media hydration',async()=>{
 const f=await setup();f.corruptBytes();await assert.rejects(f.reader.read(f.claims('IMAGE')),{code:'MANUAL_PUBLICATION_IMAGE_MISMATCH'});
 const g=await setup(),original=g.storage.readDerivative;g.storage.readDerivative=async args=>{const result=await original(args);g.disable();return result;};
 await assert.rejects(g.reader.read(g.claims('IMAGE')),{code:'MANUAL_PUBLICATION_CHANGED'});
});

test('direct access grants only the exact approved image and rechecks revocation before returning', async()=>{
 const f=await setup(); let calls=0;
 f.storage.createDerivativeRead=async({descriptor,expiresIn})=>{calls++;assert.equal(expiresIn,120);const c=descriptor.raster.content;
   return {url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/approved?signature=fixture',sha256:c.sha256,byteCount:c.byteCount,mime:c.mime};};
 const claims=f.claims('IMAGE');claims.request.kind='IMAGE_ACCESS';
 const result=JSON.parse((await f.reader.read(claims)).bytes);
 assert.equal(result.image.sha256,f.geometry.sides.FRONT.prepared.frame.inspection.sha256);
 assert.equal(result.publicHash,f.row.public_hash);assert.equal(result.side,'FRONT');assert.equal(calls,1);assert.equal(result.image.alphaPreviewPending,undefined);
 const original=f.storage.createDerivativeRead;
 f.storage.createDerivativeRead=async input=>{const value=await original(input);f.disable();return value;};
 await assert.rejects(f.reader.read(claims),{code:'MANUAL_PUBLICATION_CHANGED'});
});
test('real HTTP bridge authenticates once, refuses replay and isolates malformed or oversized bodies',async t=>{
 let calls=0;const handler=createManualPublicHandler({key:config.manualKey,reader:{async read(){calls++;return {contentType:'application/json',bytes:Buffer.from('{}')};}}});
 const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.statusCode=404;res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const send=(body,signature,headers={})=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:server.address().port,path:MANUAL_PUBLIC_PATH,method:'POST',headers:{host:'private.atlasgrading.com','content-type':'application/json','x-atlas-manual-public-signature':signature,...headers}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end(body);});
 const signed=signManualPublicRequest(config,{kind:'REPORT',token:'ar_'+'A'.repeat(24),version:1,side:null,findingId:null});
 assert.equal((await send(signed.body,signed.signature)).status,200);assert.equal((await send(signed.body,signed.signature)).status,409);assert.equal(calls,1);
 for(const args of [['x','0'.repeat(64)],['x'.repeat(4097),'0'.repeat(64)],[signed.body,signed.signature,{cookie:'staff-session'}]]){const result=await send(...args);assert.ok([403,413].includes(result.status));assert.equal(result.headers.connection,'close');assert.equal(result.body.includes('staff-session'),false);}
 assert.equal(calls,1);
});

test('private host mounts the dedicated public reader without staff authentication; unexpected rejection is isolated',async t=>{
 const {createPrivateManualServer}=await import('../scripts/private-server.mjs');let staffCalls=0,reads=0;
 const boundary={async authenticate(){staffCalls++;throw new Error('must not authenticate staff');}};
 const reader=createManualPublicHandler({key:config.manualKey,reader:{async read(){reads++;return {contentType:'application/json',bytes:Buffer.from('{}')};}}});
 const server=createPrivateManualServer({connected:{workflow:{service:{}},intake:{}},boundary,origin:'https://app.atlasgrading.com',key:Buffer.alloc(32,9),publicHandler:async(req,res)=>{if(req.headers['x-test-refusal'])throw new Error('private secret');return reader(req,res);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const send=(url,body='',signature='',extra={})=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:server.address().port,path:url,method:'POST',headers:{host:'private.atlasgrading.com','content-type':'application/json','x-atlas-manual-public-signature':signature,...extra}},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end(body);});
 const signed=signManualPublicRequest(config,{kind:'REPORT',token:'ar_'+'A'.repeat(24),version:1,side:null,findingId:null});
 assert.equal((await send(MANUAL_PUBLIC_PATH,signed.body,signed.signature)).status,200);
 assert.equal((await send('/api/staff/manual-intake/cards',signed.body,signed.signature)).status,401);
 const refused=await send(MANUAL_PUBLIC_PATH,'','',{'x-test-refusal':'1'});assert.equal(refused.status,503);assert.equal(refused.headers.connection,'close');assert.equal(refused.body.includes('private secret'),false);
 assert.equal(staffCalls,0);assert.equal(reads,1);
});

 test('publication carries a separate source-bound preview into direct access without changing approved images',async()=>{
 const f=await setup({withPreview:true});const claims=f.claims('IMAGE');claims.request.kind='IMAGE_ACCESS';const purposes=[];
 f.storage.createDerivativeRead=async({descriptor})=>{purposes.push(descriptor.purpose);return {url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/'+descriptor.purpose,...descriptor.raster.content};};
 const value=JSON.parse((await f.reader.read(claims)).bytes);assert.deepEqual(purposes,['inspection','preview']);
 assert.equal(value.image.preview.sourceSha256,value.image.sha256);assert.equal(value.image.preview.width,558);
 const report=JSON.parse((await f.reader.read(f.claims('REPORT'))).bytes);assert.equal(report.packet.images.FRONT.preview,undefined);
 assert.equal(report.packet.images.FRONT.sha256,value.image.sha256);assert.equal(report.publicHash,value.publicHash);
 });

test('optional preview signing failure does not hide the approved full image',async()=>{
 const f=await setup({withPreview:true});const claims=f.claims('IMAGE');claims.request.kind='IMAGE_ACCESS';
 f.storage.createDerivativeRead=async({descriptor})=>{
  if(descriptor.purpose==='preview')throw Object.assign(Error('preview unavailable'),{code:'PHOTO_STORAGE_UNAVAILABLE'});
  return{url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/'+descriptor.purpose,...descriptor.raster.content};};
 const value=JSON.parse((await f.reader.read(claims)).bytes);
 assert.equal(value.image.sha256,f.geometry.sides.FRONT.prepared.frame.inspection.sha256);
 assert.equal(value.image.preview,undefined);assert.equal(value.publicHash,f.row.public_hash);
});

test('optional report images are separate from the packet and cannot take a valid report offline',async()=>{
 const f=await setup();let enabled=true,calls=0;
 const client={$transaction:async fn=>fn({$queryRawUnsafe:async()=>enabled?[f.row]:[]})};
 const reportImages={async manifest(){calls++;throw Error('optional cache unavailable');},async image(){enabled=false;return{bytes:Buffer.from('png'),contentType:'image/png'};}};
 const reader=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage,reportImages});
 const response=JSON.parse((await reader.read(f.claims('REPORT'))).bytes);
 assert.equal(response.reportImages,undefined);assert.equal(response.packet.images.FRONT.sha256,f.geometry.sides.FRONT.prepared.frame.inspection.sha256);assert.equal(calls,1);
 const claims=f.claims('IMAGE');claims.request.kind='REPORT_IMAGE';claims.request.outputSha256='d'.repeat(64);
 await assert.rejects(reader.read(claims),{code:'MANUAL_PUBLICATION_CHANGED'});
});

test('hung optional report image lookup is omitted within a bounded wait and a late failure is observed',async()=>{
 const f=await setup();let rejectLookup,reads=0;
 const client={$transaction:async fn=>fn({$queryRawUnsafe:async()=>{reads++;return[f.row];}})};
 const reportImages={manifest:()=>new Promise((_,reject)=>{rejectLookup=reject;})};
 const reader=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage,reportImages});
 const started=performance.now();
 const response=JSON.parse((await reader.read(f.claims('REPORT'))).bytes);
 assert.ok(performance.now()-started<1500,'optional work must not add multiple seconds');
 assert.equal(response.reportImages,undefined);assert.equal(reads,2);
 assert.equal(response.packet.images.FRONT.sha256,f.geometry.sides.FRONT.prepared.frame.inspection.sha256);
 rejectLookup(Error('late optional failure'));
 await new Promise(resolve=>setImmediate(resolve));
});


test('Photoroom access follows current approval authority and remains JSON-only through the native reader',async()=>{
 const f=await setup();let enabled=true,calls=0;
 const client={$transaction:async fn=>fn({$queryRawUnsafe:async()=>enabled?[f.row]:[]})};
 const value={version:'atlas-approved-report-image-access-v1',execution:'PHOTOROOM_PLUS_API',publicToken:f.row.public_token,approvalVersion:1,
  publicHash:f.row.public_hash,side:'FRONT',image:{url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/cutout?grant=fixture',
   sha256:'d'.repeat(64),byteCount:25*1024*1024,mime:'image/png',width:3024,height:4032}};
 const claims=f.claims('IMAGE');claims.request.kind='REPORT_IMAGE_ACCESS';claims.request.outputSha256=value.image.sha256;
 const reportImages={async imageAccess(row,packet,side,hash){calls++;assert.equal(row.manifest_hash,f.row.manifest_hash);assert.equal(packet.publicToken,f.row.public_token);
  assert.equal(side,'FRONT');assert.equal(hash,value.image.sha256);return value;}};
 const reader=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage,reportImages});
 const result=await reader.read(claims);assert.equal(result.contentType,'application/json');assert.deepEqual(JSON.parse(result.bytes),value);assert.ok(result.bytes.length<16384);
 reportImages.imageAccess=async()=>{enabled=false;return value;};
 await assert.rejects(reader.read(claims),{code:'MANUAL_PUBLICATION_CHANGED'});assert.equal(calls,1);
});

const alphaGrant = saved => ({ policyVersion: 'atlas-inspection-alpha-preview-v1', sourceSha256: saved.descriptor.raster.content.sha256,
  mime: 'image/webp', width: 558, height: 768, byteCount: 1234, sha256: 'e'.repeat(64),
  url: 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/alpha?grant=fixture' });
function approvedReadGrants(f) {
  f.storage.createDerivativeRead = async ({ descriptor }) => ({
    url: 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/' + descriptor.purpose,
    ...descriptor.raster.content,
  });
  const claims = f.claims('IMAGE'); claims.request.kind = 'IMAGE_ACCESS'; return claims;
}

test('alpha access is additive for historical and new approvals and retains the exact saved JPEG', async () => {
  for (const withPreview of [false, true]) {
    let calls = 0;
    const f = await setup({ withPreview, inspectionAlphaPreviews: { async resolve({ saved, signal }) {
      calls++; assert.equal(signal.aborted, false); return alphaGrant(saved);
    } } });
    const manifest = f.row.manifest, hash = f.row.public_hash, claims = approvedReadGrants(f);
    const value = JSON.parse((await f.reader.read(claims)).bytes);
    assert.equal(value.image.alphaPreview.sourceSha256, value.image.sha256);
    assert.equal(value.image.alphaPreview.mime, 'image/webp'); assert.equal(value.image.alphaPreviewPending, undefined); assert.equal(calls, 1);
    assert.equal(Boolean(value.image.preview), withPreview);
    if (withPreview) assert.equal(value.image.preview.mime, 'image/jpeg');
    assert.equal(f.row.manifest, manifest); assert.equal(value.publicHash, hash); assert.equal(f.reads, 2);
  }
});

test('optional invalid alpha descriptors and cache failures preserve the independent JPEG and full grants', async () => {
  for (const broken of [() => { throw Error('cache unavailable'); }, saved => ({ ...alphaGrant(saved), sourceSha256: 'f'.repeat(64) }),
    saved => ({ ...alphaGrant(saved), mime: 'image/jpeg' }), saved => ({ ...alphaGrant(saved), byteCount: 2 * 1024 * 1024 })]) {
    const f = await setup({ withPreview: true, inspectionAlphaPreviews: { async resolve({ saved }) { return broken(saved); } } });
    const value = JSON.parse((await f.reader.read(approvedReadGrants(f))).bytes);
    assert.equal(value.image.alphaPreview, undefined); assert.equal(value.image.alphaPreviewPending, true); assert.equal(value.image.preview.mime, 'image/jpeg');
    assert.equal(value.image.sha256, f.geometry.sides.FRONT.prepared.frame.inspection.sha256); assert.equal(f.reads, 2);
  }
});

test('authority revocation during alpha preparation refuses every image grant', async () => {
  let f;
  f = await setup({ withPreview: true, inspectionAlphaPreviews: { async resolve({ saved }) { f.disable(); return alphaGrant(saved); } } });
  await assert.rejects(f.reader.read(approvedReadGrants(f)), { code: 'MANUAL_PUBLICATION_CHANGED' });
});

test('cold or hung alpha preparation adds at most the short optional wait and observes late rejection', async () => {
  let optionalSignal, rejectLate;
  const f = await setup({ withPreview: true, inspectionAlphaPreviews: { resolve({ signal }) {
    optionalSignal = signal; return new Promise((_, reject) => { rejectLate = reject; });
  } } });
  const start = performance.now(), value = JSON.parse((await f.reader.read(approvedReadGrants(f))).bytes);
  assert.ok(performance.now() - start < 750, 'alpha generation must not hold the primary image response for seconds');
  assert.equal(optionalSignal.aborted, true); assert.equal(value.image.alphaPreview, undefined); assert.equal(value.image.alphaPreviewPending, true);
  assert.equal(value.image.preview.mime, 'image/jpeg'); assert.equal(f.reads, 2);
  rejectLate(Error('late optional failure')); await new Promise(resolve => setImmediate(resolve));
});
