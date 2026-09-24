import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { prepareManifest,validateManifest,createEffects,qualify } from './manual-storage-application-qualification.mjs';
const require=createRequire(new URL('../../packages/atlas-photo-storage/package.json',import.meta.url));
const sdk=require('@aws-sdk/client-s3'),{getSignedUrl}=require('@aws-sdk/s3-request-presigner');
const credentials={accessKeyId:'SYNTHETIC_ACCESS_KEY',secretAccessKey:'SYNTHETIC_SECRET_NOT_REAL'};
const prepared=prepareManifest({id:'d1a6565d-0d3b-4c85-9d9c-59c2e04b3b71',createdAt:'2026-09-21T00:00:00.000Z'}),m=prepared.manifest;
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture({conditional=true,privateAccess=true,corruptRead=false,unknownPut=false,unknownArtifactPut=false,oversizedArtifactError=false}={}){
 const objects=new Map(),wire=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),key=url.pathname.slice(1),parts=[];for await(const part of req)parts.push(part);const bytes=Buffer.concat(parts);
  wire.push({method:req.method,key,bodyBytes:bytes.length,signed:req.headers.authorization!==undefined||url.searchParams.has('X-Amz-Signature')});
  const response=(status,body='',headers={})=>{res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:body);};
  if(!key){if(req.method==='HEAD')return response(200);return response(200,'<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>',{'content-type':'application/xml'});}
  if(req.method==='OPTIONS')return response(200,'',{'access-control-allow-origin':m.target.staffOrigin,'access-control-allow-methods':req.headers['access-control-request-method'],'access-control-allow-headers':req.headers['access-control-request-headers']});
  if(privateAccess&&!req.headers.authorization&&!url.searchParams.has('X-Amz-Signature'))return response(403,'<Error><Code>AccessDenied</Code></Error>');
  if(req.method==='PUT'){
   if(unknownPut||unknownArtifactPut&&key===m.artifact.key){req.socket.destroy();return;}
   if(oversizedArtifactError&&key===m.artifact.key)return response(400,'<Error><Code>BadDigest</Code><Message>'+('x'.repeat(5000))+'</Message></Error>',{'content-type':'application/xml'});
   if(conditional&&objects.has(key))return response(412,'<Error><Code>PreconditionFailed</Code></Error>',{'content-type':'application/xml'});
   objects.set(key,{bytes,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>k.startsWith('x-amz-meta-'))),type:req.headers['content-type']});
   return response(200,'',{etag:`"${hash(bytes)}"`});
  }
  if(req.method==='DELETE'){objects.delete(key);return response(204);}
  const found=objects.get(key);if(!found)return response(404,'<Error><Code>NoSuchKey</Code></Error>',{'content-type':'application/xml'});
  const etag=`"${hash(found.bytes)}"`;if(req.headers['if-match']&&req.headers['if-match']!==etag)return response(412,'<Error><Code>PreconditionFailed</Code></Error>',{'content-type':'application/xml'});
  const body=corruptRead&&key===m.artifact.key?Buffer.alloc(65):found.bytes;
  return response(200,body,{'content-length':'65','content-type':found.type,etag,...found.headers,'access-control-allow-origin':m.target.staffOrigin});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const nativeClient=new sdk.S3Client({region:'nyc3',credentials,maxAttempts:1}),native=nativeClient.config.requestHandler;
 const events=[];
 const effects=createEffects({manifest:m,sdk,getSignedUrl,credentials,onEvent:e=>events.push(e),
  handlerOverride:{handle:(request,options)=>native.handle({...request,hostname:'127.0.0.1',port,protocol:'http:'},options),destroy:()=>native.destroy()},
  fetchImpl:(url,options)=>{const input=new URL(url);return fetch(`http://127.0.0.1:${port}${input.pathname}${input.search}`,options);}});
 return{objects,wire,events,effects,async close(){effects.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('manifest seals application source, canonical65-byte artifact key and exact caps',()=>{
 assert.deepEqual(validateManifest(prepared.sha256,prepared.bytes),m);
 assert.equal(Buffer.from(JSON.stringify(m.artifact.content)).length,65);
 assert.equal(hash(Buffer.from(JSON.stringify(m.artifact.content))),m.artifact.sha256);
 const changed=structuredClone(m);changed.photo.key+='-other';const bytes=Buffer.from(JSON.stringify(changed));
 assert.throws(()=>validateManifest(hash(bytes),bytes),/MANIFEST_SOURCE_OR_CONTRACT_CHANGED/);
});
test('actual Node SDK + browser HTTP passes application contracts with absent native checksums',async()=>{
 const f=await fixture();try{
  const result=await qualify({manifest:m,effects:f.effects,onEvent:e=>f.events.push(e)});
  assert.equal(result.status,'APPLICATION_STORAGE_CONTRACT_PASS',JSON.stringify(result));assert.equal(result.nativeChecksumRefusalQualified,false);
  assert.deepEqual(result.observations.photoWrongBytes,{error:'PHOTO_STORAGE_CONFLICT',decoderCalls:0});
  assert.equal(result.observations.artifactInvalidHash,'REJECTED_WITHOUT_HTTP');assert.equal(f.objects.size,0);
  assert.equal(result.counts.puts,5);assert.equal(result.counts.putBytes,325);assert.equal(result.counts.deletes,3);assert.ok(result.counts.requests<=60);
  assert.equal(result.counts.requests,f.wire.length);assert.equal(f.events.filter(e=>e.state==='DECODER_ENTERED').length,0);
  assert.equal(f.events.filter(e=>e.state==='SDK_HTTP_RESPONSE'&&e.method==='PUT').length,2);
  assert.ok(f.events.some(e=>e.state==='SDK_HTTP_RESPONSE'&&e.status===412));
  assert.ok(f.events.some(e=>e.state==='SDK_COMMAND_ERROR'&&e.error.status===412));
 }finally{await f.close();}
});
for(const [name,options,code]of[
 ['conditional ignored',{conditional:false},'PHOTO_CONDITIONAL_FAILED'],
 ['public objects',{privateAccess:false},'PUBLIC_OBJECT'],
 ['corrupt artifact',{corruptRead:true},'MANUAL_ARTIFACT_UNVERIFIED'],
 ['unknown photo PUT',{unknownPut:true},null],
])test(`${name} cannot pass or dispatch additional PUTs`,async()=>{
 const f=await fixture(options);try{const result=await qualify({manifest:m,effects:f.effects});
 assert.equal(result.status,'APPLICATION_QUALIFICATION_FAILED');if(code)assert.equal(result.failure.code,code);
 if(name==='unknown photo PUT'){assert.equal(result.counts.puts,1);assert.equal(result.counts.deletes,0);}
 assert.ok(Object.values(result.cleanup).includes('REQUIRES_OPERATOR_RECONCILIATION'));
 }finally{await f.close();}
});
test('wrapper refuses arbitrary-key and unverified delete before any wire request',async()=>{
 const f=await fixture();try{
 await assert.rejects(()=>f.effects.raw('HEAD','unplanned-key'),/KEY_REFUSED/);
 await assert.rejects(()=>f.effects.raw('DELETE',m.photo.key),/DELETE_NOT_VERIFIED/);
 assert.equal(f.wire.length,0);assert.equal(f.effects.counts.requests,0);
 }finally{await f.close();}
});

for(const [name,options] of [['artifact transport unknown',{unknownArtifactPut:true}],['oversized SDK error response',{oversizedArtifactError:true}]])test(`${name} prevents store reconciliation network`,async()=>{
 const f=await fixture(options);try{const result=await qualify({manifest:m,effects:f.effects});
  assert.equal(result.status,'APPLICATION_QUALIFICATION_FAILED');assert.equal(f.wire.at(-1).method,'PUT');assert.equal(f.wire.at(-1).key,m.artifact.key);
  assert.equal(result.counts.puts,4);assert.equal(result.counts.deletes,2);assert.equal(result.cleanup.artifact,'REQUIRES_OPERATOR_RECONCILIATION');
  if(options.oversizedArtifactError){assert.ok(f.events.some(e=>e.state==='SDK_HTTP_RESPONSE'&&e.status===400));assert.ok(f.events.some(e=>e.state==='SDK_RESPONSE_BODY_FAILED'));}
 }finally{await f.close();}
});
test('noncooperative SDK handler is bounded and latches unknown before any later request',async()=>{
 let dispatched=0;const effects=createEffects({manifest:m,sdk,getSignedUrl,credentials,
  handlerOverride:{handle:()=>{dispatched++;return new Promise(()=>{});},destroy(){}},timers:{set:fn=>setTimeout(fn,10),clear:clearTimeout}});
 try{await assert.rejects(()=>effects.raw('HEAD',m.photo.key));assert.equal(dispatched,1);assert.equal(effects.unknown(),true);
  await assert.rejects(()=>effects.raw('HEAD',m.photo.key),/PRIOR_TRANSPORT_UNKNOWN/);assert.equal(dispatched,1);
 }finally{effects.close();}
});
