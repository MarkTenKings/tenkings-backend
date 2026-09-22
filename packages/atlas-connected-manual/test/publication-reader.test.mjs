import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request } from 'node:http';
import { once } from 'node:events';
import { signManualPublicRequest,MANUAL_PUBLIC_ORIGIN,MANUAL_PUBLIC_PATH } from '@atlas/service-bridge/manual-public';
import { createApprovedManualReader,createManualPublicHandler } from '../src/publication-reader.mjs';
import { publicationFixture } from './publication-fixture.mjs';
const config={manualKey:Buffer.alloc(32,7),manualOrigin:MANUAL_PUBLIC_ORIGIN,deploymentId:'approved-fixture.vercel.app',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64)};
async function setup(){const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);let reads=0,disabled=false;
 const client={$transaction:async fn=>fn({$queryRawUnsafe:async(sql,...args)=>{reads++;assert.equal(sql,'SELECT * FROM atlas_manual.read_publication($1::text,$2::integer,$3::text,$4::text,$5::text)');assert.equal(args[0],f.row.public_token);return disabled?[]:[f.row];}})};
 const reader=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage});const claims=kind=>({request:{kind,token:f.row.public_token,version:1,side:kind==='IMAGE'?'FRONT':null,findingId:kind==='TRACE'?f.full.findings[0].id:null},expiresAt:Date.now()+30000,deploymentId:config.deploymentId,releaseSha:config.releaseSha,configHash:config.configHash});
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
