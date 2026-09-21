// Application-level qualification; preserves all prior failed canaries and diagnostics.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Transform } from 'node:stream';
import { descriptorSha256 } from '../../packages/atlas-photo-core/src/index.mjs';
import { createPhotoStorage } from '../../packages/atlas-photo-storage/src/index.mjs';
import { createManualArtifactStore, createS3ManualArtifactTransport } from '../../packages/atlas-manual-service/src/artifacts.mjs';
import { QUALIFICATION_SOURCES } from './manual-release-storage-qualification.mjs';
export const ROOT = '/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/application-qualification-20260920';
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BOUNDS = Object.freeze({ keys: 2, requests: 60, puts: 6, putBytes: 390, deletes: 4, requestMs: 10000, totalMs: 600000, responseBytes: 4096, sdkMaxAttempts: 1 });
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (v, code) => { if (!v) throw Object.assign(new Error(code), { qualificationCode: code }); };
const safe = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(v) ? v : null;
const safeError = e => ({ name: safe(e?.name), code: safe(e?.qualificationCode ?? e?.code ?? e?.canaryCode),
  status: Number.isInteger(e?.$metadata?.httpStatusCode) ? e.$metadata.httpStatusCode : null });
const canonical = v => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const equal = (a,b) => canonical(a) === canonical(b);
export function prepareManifest({ id, createdAt, readSource = p => readFileSync(resolve(SOURCE_ROOT,p)) }) {
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id), 'ID_INVALID');
  need(typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt, 'TIME_INVALID');
  const prefix = `atlas-connected-manual-v1/app-qualification-20260920/${id}`;
  const target = { bucket: 'atlas-grading-private-20260910', region: 'nyc3', endpoint: 'https://nyc3.digitaloceanspaces.com',
    origin: 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com', staffOrigin: 'https://atlasgrading.com' };
  const photoBytes = Buffer.from(`ATLAS_APPLICATION_PHOTO_${id}_ONE`.padEnd(65,' '));
  const collisionBytes = Buffer.from(`ATLAS_APPLICATION_PHOTO_${id}_TWO`.padEnd(65,' '));
  const content = { p: 'ARTIFAC', id, v: 1 }, artifactBytes = Buffer.from(JSON.stringify(content));
  const artifactCollision = Buffer.from(JSON.stringify({ ...content, v: 2 }));
  need([photoBytes,collisionBytes,artifactBytes,artifactCollision].every(b=>b.length===65), 'PAYLOAD_SIZE');
  const uploadPlan = { schemaVersion:1,uploadId:`app-qualification-${id}`,binding:{cardId:`app-qualification-${id}`,pairId:`app-qualification-${id}`,side:'FRONT',version:1},
    object:{key:`${prefix}/originals/probe.bin`,versionId:null},expected:{byteCount:65,sha256:sha(photoBytes)} };
  const source = { cardId:id,kind:'STORAGE_QUALIFICATION',sourceHash:sha(Buffer.from(`application-qualification:${id}`)) };
  const lineageSha256 = sha(canonical(source));
  const artifactKey = `${prefix}/${id}/${source.kind}/${lineageSha256}-${sha(artifactBytes)}.json`;
  const manifest = { schemaVersion:1,purpose:'ACTUAL_APPLICATION_STORAGE_INTEGRITY',root:ROOT,id,createdAt,target,prefix,bounds:{...BOUNDS},
    photo:{key:uploadPlan.object.key,uploadPlan,payloadBase64:photoBytes.toString('base64'),sha256:sha(photoBytes),collisionBase64:collisionBytes.toString('base64'),collisionSha256:sha(collisionBytes),bindingSha256:descriptorSha256(uploadPlan)},
    artifact:{key:artifactKey,content,source,lineageSha256,payloadBase64:artifactBytes.toString('base64'),sha256:sha(artifactBytes),collisionBase64:artifactCollision.toString('base64'),collisionSha256:sha(artifactCollision)},
    sources:Object.fromEntries([...QUALIFICATION_SOURCES,'scripts/atlas/manual-storage-application-qualification.mjs'].map(p=>[p,sha(readSource(p))])) };
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');return{manifest,bytes,sha256:sha(bytes)};
}
export function validateManifest(expected, bytes) {
  need(/^[a-f0-9]{64}$/.test(expected)&&sha(bytes)===expected,'MANIFEST_HASH_CHANGED');const m=JSON.parse(bytes);
  need(equal(m,prepareManifest({id:m.id,createdAt:m.createdAt}).manifest),'MANIFEST_SOURCE_OR_CONTRACT_CHANGED');return m;
}

/** Production CLI delegates unchanged serialized requests to the SDK's own Node handler. */
export function createEffects({ manifest:m, sdk, getSignedUrl, credentials, onEvent=()=>{}, now=()=>performance.now(), fetchImpl=fetch,
  handlerOverride, timers={set:setTimeout,clear:clearTimeout} }) {
  const started=now(), deadline=started+BOUNDS.totalMs, counts={requests:0,puts:0,putBytes:0,deletes:0};
  const perKey=new Map([m.photo.key,m.artifact.key].map(k=>[k,{puts:0,deletes:0}]));
  const owned=new Set(), abort=new AbortController();let phase='preflight',sequence=0,unknown=false,decoderCalls=0;
  const emit=e=>onEvent({phase,...e});
  function begin(method,key,body) {
    need(!unknown,'PRIOR_TRANSPORT_UNKNOWN');
    need(!abort.signal.aborted&&now()<deadline&&counts.requests<BOUNDS.requests,'REQUEST_BOUND');
    need(['HEAD','GET','PUT','DELETE','OPTIONS'].includes(method),'METHOD_REFUSED');
    need(key===null&&['HEAD','GET'].includes(method)||perKey.has(key),'KEY_REFUSED');
    if(method==='PUT') {
      const p=key===m.photo.key?m.photo:m.artifact;
      need(body instanceof Uint8Array&&body.length===65&&[p.sha256,p.collisionSha256].includes(sha(body))
        &&counts.puts<6&&perKey.get(key).puts<3&&counts.putBytes+body.length<=390,'PUT_BOUND');
      counts.puts++;perKey.get(key).puts++;counts.putBytes+=body.length;owned.delete(key);
    }
    if(method==='DELETE') {need(owned.has(key)&&counts.deletes<4&&perKey.get(key).deletes<2,'DELETE_NOT_VERIFIED');counts.deletes++;perKey.get(key).deletes++;}
    const n=++sequence;counts.requests++;emit({state:'DISPATCHING',sequence:n,method,key,bytes:body?.length??0});return n;
  }
  const client=new sdk.S3Client({endpoint:m.target.endpoint,region:m.target.region,maxAttempts:1,credentials});
  const actual=handlerOverride??client.config.requestHandler;
  client.config.requestHandler={async handle(wire,options={}) {
    need(wire.protocol==='https:'&&wire.hostname===new URL(m.target.origin).hostname&&(!wire.port||wire.port===443),'SDK_TARGET_CHANGED');
    const key=wire.path==='/'?null:wire.path.slice(1);
    const n=begin(wire.method,key,wire.body);const control=new AbortController();let responseBody,settled=false,timer;
    const cancel=()=>control.abort();abort.signal.addEventListener('abort',cancel,{once:true});options.abortSignal?.addEventListener('abort',cancel,{once:true});
    const clean=()=>{if(settled)return;settled=true;timers.clear(timer);abort.signal.removeEventListener('abort',cancel);options.abortSignal?.removeEventListener('abort',cancel);};
    const timeout=new Promise((_,reject)=>{timer=timers.set(()=>{
      const error=Object.assign(new Error('REQUEST_TIMEOUT'),{qualificationCode:'REQUEST_TIMEOUT'});unknown=true;control.abort();responseBody?.destroy?.(error);reject(error);
    },Math.min(BOUNDS.requestMs,deadline-now()));});
    try {
      need(!options.abortSignal?.aborted&&!abort.signal.aborted,'CANCELLED');
      const out=await Promise.race([actual.handle(wire,{...options,abortSignal:control.signal}),timeout]);
      emit({state:'SDK_HTTP_RESPONSE',sequence:n,method:wire.method,key,status:out.response.statusCode,
        nativeChecksum:out.response.headers['x-amz-checksum-sha256']===undefined?'ABSENT':'PRESENT'});
      const upstream=out.response.body;
      if(upstream?.pipe){
        let received=0;
        responseBody=new Transform({transform(chunk,encoding,callback){
          received+=chunk.length;
          if(received>BOUNDS.responseBytes){const error=Object.assign(new Error('SDK_RESPONSE_BODY_LIMIT'),{qualificationCode:'SDK_RESPONSE_BODY_LIMIT'});unknown=true;control.abort();callback(error);}
          else callback(null,chunk);
        }});
        responseBody.once('error',error=>{unknown=true;emit({state:'SDK_RESPONSE_BODY_FAILED',sequence:n,method:wire.method,key,error:safeError(error)});clean();});
        upstream.once('error',error=>responseBody.destroy(error));
        responseBody.once('close',()=>{upstream.destroy?.();clean();});responseBody.once('end',clean);
        upstream.pipe(responseBody);out.response.body=responseBody;
      }else{need(upstream==null||upstream.length<=BOUNDS.responseBytes,'SDK_RESPONSE_BODY_LIMIT');clean();}
      return out;
    }catch(e){unknown=true;clean();emit({state:'SDK_TRANSPORT_FAILED',sequence:n,method:wire.method,key,error:safeError(e)});throw e;}
  },destroy(){actual.destroy?.();}};
  async function browser(url,options={}) {
    const parsed=new URL(url);need(parsed.origin===m.target.origin&&parsed.pathname===`/${m.photo.key}`,'BROWSER_TARGET_CHANGED');
    const method=options.method??'GET',n=begin(method,m.photo.key,options.body),controller=new AbortController();
    const cancel=()=>controller.abort();abort.signal.addEventListener('abort',cancel,{once:true});
    const timer=timers.set(cancel,Math.min(BOUNDS.requestMs,deadline-now()));
    try {
      const response=await fetchImpl(url,{...options,redirect:'error',signal:controller.signal});
      emit({state:'BROWSER_HTTP_RESPONSE',sequence:n,method,key:m.photo.key,status:response.status});
      const bytes=[];let length=0;const reader=response.body?.getReader();
      try{if(reader)for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;need(length<=4096,'BODY_LIMIT');bytes.push(Buffer.from(part.value));}}
      finally{await reader?.cancel();}
      return{status:response.status,headers:Object.fromEntries(response.headers),bytes:Buffer.concat(bytes,length)};
    }catch(e){unknown=true;emit({state:'BROWSER_TRANSPORT_FAILED',sequence:n,method,error:safeError(e)});throw e;}
    finally{timers.clear(timer);abort.signal.removeEventListener('abort',cancel);}
  }
  async function send(name,input) {try{return await client.send(new sdk[name](input),{abortSignal:abort.signal});}catch(e){emit({state:'SDK_COMMAND_ERROR',command:name,error:safeError(e)});throw e;}}
  async function raw(method,key,input={}) {
    const names={HEAD:'HeadObjectCommand',GET:'GetObjectCommand',DELETE:'DeleteObjectCommand'};
    try {
      const result=await send(names[method],{Bucket:m.target.bucket,Key:key,...input});let bytes;
      if(result.Body){const chunks=[];let length=0;try{for await(const chunk of result.Body){length+=chunk.length;need(length<=4096,'BODY_LIMIT');chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks,length);}finally{result.Body.destroy?.();}}
      return{status:result.$metadata.httpStatusCode,headers:result,bytes};
    }catch(e){if([400,403,404,412].includes(e?.$metadata?.httpStatusCode))return{status:e.$metadata.httpStatusCode,headers:{},error:safeError(e)};throw e;}
  }
  const photo=createPhotoStorage({client,bucket:m.target.bucket,keyPrefix:m.prefix,limits:{maxObjectBytes:65,timeoutMs:10000},
    decode:async()=>{decoderCalls++;emit({state:'DECODER_ENTERED'});throw Object.assign(new Error('DECODER_MUST_NOT_ENTER'),{qualificationCode:'DECODER_MUST_NOT_ENTER'});}});
  const artifactTransport=createS3ManualArtifactTransport({client,bucket:m.target.bucket,PutObjectCommand:sdk.PutObjectCommand,GetObjectCommand:sdk.GetObjectCommand});
  const store=createManualArtifactStore({transport:artifactTransport,prefix:m.prefix});
  return{counts,photo,artifactTransport,store,signal:abort.signal,raw,browser,
    async step(label,fn){phase=label;return fn();},markOwned:key=>owned.add(key),clearOwned:key=>owned.delete(key),unknown:()=>unknown,decoderCalls:()=>decoderCalls,
    async preflight(){await send('HeadBucketCommand',{Bucket:m.target.bucket});const r=await send('GetBucketVersioningCommand',{Bucket:m.target.bucket});need(r.Status===undefined,'VERSIONING_CHANGED');},
    async signedPhotoRead(){const url=await getSignedUrl(client,new sdk.GetObjectCommand({Bucket:m.target.bucket,Key:m.photo.key}),{expiresIn:300});return browser(url,{method:'GET',headers:{Origin:m.target.staffOrigin}});},
    async anonymous(key,method){
      if(key===m.photo.key)return browser(`${m.target.origin}/${key}`,{method});
      // Anonymous artifact reads share the same bounds and timeout, with no SDK authorization.
      const n=begin(method,key);const c=new AbortController(),cancel=()=>c.abort();abort.signal.addEventListener('abort',cancel,{once:true});const timer=timers.set(cancel,10000);
      try{const r=await fetchImpl(`${m.target.origin}/${key}`,{method,redirect:'error',signal:c.signal});emit({state:'ANONYMOUS_HTTP_RESPONSE',sequence:n,method,key,status:r.status});await r.body?.cancel();return{status:r.status};}
      catch(e){unknown=true;throw e;}finally{timers.clear(timer);abort.signal.removeEventListener('abort',cancel);}
    },close(){abort.abort();client.destroy();}};
}

export async function qualify({manifest:m,effects:e,onEvent=()=>{}}) {
  const observations={},cleanup={photo:'NOT_NEEDED',artifact:'NOT_NEEDED'};let failure=null,active=null;
  const emit=value=>onEvent(value);
  function objectMetadata(result,p,kind) {
    const h=result.headers;need(result.status===200&&h.ContentLength===65&&h.ContentType===(kind==='photo'?'application/octet-stream':'application/json')
      &&h.VersionId===undefined&&h.DeleteMarker!==true&&h.ContentRange===undefined&&h.ContentEncoding===undefined&&typeof h.ETag==='string'
      &&h.ETag.length>0&&h.ETag.length<=512&&!/[\x00-\x1f\x7f]/.test(h.ETag),'OBJECT_METADATA_CONFLICT');
    need(kind==='photo'?h.Metadata?.['atlas-kind']==='original'&&h.Metadata?.['atlas-binding-sha256']===p.bindingSha256
      :h.Metadata?.['atlas-manual-lineage-sha256']===p.lineageSha256,'OBJECT_LINEAGE_CONFLICT');
  }
  async function absent(p){need((await e.raw('HEAD',p.key)).status===404&&(await e.raw('GET',p.key)).status===404,'ABSENCE_UNPROVEN');e.clearOwned(p.key);}
  async function clean(p,kind,expectedSha){
    const head=await e.raw('HEAD',p.key);objectMetadata(head,p,kind);
    const get=await e.raw('GET',p.key,{IfMatch:head.headers.ETag});objectMetadata(get,p,kind);
    need(get.headers.ETag===head.headers.ETag&&get.bytes?.length===65&&sha(get.bytes)===expectedSha,'CLEANUP_OWNERSHIP_CONFLICT');
    e.markOwned(p.key);const removed=await e.raw('DELETE',p.key);need(removed.status>=200&&removed.status<300,'DELETE_NOT_CONFIRMED');await absent(p);cleanup[kind]='VERIFIED_ABSENT';
  }
  async function privateReads(p){for(const method of['GET','HEAD'])need([401,403].includes((await e.anonymous(p.key,method)).status),'PUBLIC_OBJECT');}
  try {
    await e.step('provider-preflight',()=>e.preflight());
    active='photo';const p=m.photo;need((await e.raw('HEAD',p.key)).status===404,'INITIAL_PHOTO_PRESENT');
    const original=Buffer.from(p.payloadBase64,'base64'),collision=Buffer.from(p.collisionBase64,'base64');
    const grant=await e.photo.createOriginalUpload({uploadPlan:p.uploadPlan,expiresIn:300,signal:e.signal});
    need(grant.object.key===p.key&&grant.byteCount===65&&!Object.hasOwn(grant.headers,'x-amz-sdk-checksum-algorithm'),'ORIGINAL_GRANT_CHANGED');
    for(const method of['PUT','GET','HEAD']) {
      const headers=method==='PUT'?Object.keys(grant.headers):['content-type'];
      const r=await e.browser(`${m.target.origin}/${p.key}`,{method:'OPTIONS',headers:{Origin:m.target.staffOrigin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers.join(',')}});
      const allowed=(r.headers['access-control-allow-headers']??'').toLowerCase().split(',').map(v=>v.trim());
      need(r.status===200&&r.headers['access-control-allow-origin']===m.target.staffOrigin&&(r.headers['access-control-allow-methods']??'').split(',').map(v=>v.trim()).includes(method)
        &&headers.every(h=>allowed.includes(h.toLowerCase())||allowed.includes('*')),'BROWSER_CORS_REFUSED');
    }
    await e.step('photo-wrong-bytes',async()=>{
      cleanup.photo='REQUIRED';const put=await e.browser(grant.url,{method:'PUT',headers:{...grant.headers,Origin:m.target.staffOrigin},body:collision});
      need(put.status===200,'WRONG_BYTES_PROBE_NOT_CREATED');let rejected=false;const decoderBefore=e.decoderCalls();
      // The injected decoder is unreachable on mismatched bytes; its entry has a distinct error.
      try{await e.photo.decodeOriginal({uploadPlan:p.uploadPlan,decodeLimits:{maxInputBytes:65,maxPixels:1,maxRasterBytes:3,maxOutputBytes:65,timeoutMs:10000},signal:e.signal});}
      catch(error){if(error.code==='PHOTO_STORAGE_CONFLICT')rejected=true;else throw error;}
      need(rejected&&e.decoderCalls()===decoderBefore,'WRONG_BYTES_ADOPTED');observations.photoWrongBytes={error:'PHOTO_STORAGE_CONFLICT',decoderCalls:0};emit({state:'APP_NEGATIVE_VERIFIED',...observations.photoWrongBytes});
      await clean(p,'photo',p.collisionSha256);
    });
    await e.step('photo-valid-application',async()=>{
      cleanup.photo='REQUIRED';need((await e.browser(grant.url,{method:'PUT',headers:{...grant.headers,Origin:m.target.staffOrigin},body:original})).status===200,'PHOTO_CREATE_FAILED');
      const found=await e.photo.readOriginal({uploadPlan:p.uploadPlan,signal:e.signal});need(found.byteCount===65&&found.sha256===p.sha256&&found.bytes.equals(original),'PHOTO_APP_READ_FAILED');
      observations.photoRead={bytes:65,sha256:sha(found.bytes)};
      const browserRead=await e.signedPhotoRead();need(browserRead.status===200&&browserRead.headers['access-control-allow-origin']===m.target.staffOrigin&&browserRead.bytes.length===65&&sha(browserRead.bytes)===p.sha256,'BROWSER_SIGNED_READ_FAILED');observations.photoBrowserRead='EXACT_SHA_CORS_VERIFIED';await privateReads(p);
      const collisionPlan=structuredClone(p.uploadPlan);collisionPlan.expected.sha256=p.collisionSha256;
      const collisionGrant=await e.photo.createOriginalUpload({uploadPlan:collisionPlan,expiresIn:300,signal:e.signal});
      need((await e.browser(collisionGrant.url,{method:'PUT',headers:{...collisionGrant.headers,Origin:m.target.staffOrigin},body:collision})).status===412,'PHOTO_CONDITIONAL_FAILED');
      const unchanged=await e.photo.readOriginal({uploadPlan:p.uploadPlan,signal:e.signal});need(unchanged.bytes.equals(original),'PHOTO_COLLISION_CHANGED_BYTES');
      need((await e.raw('GET',p.key,{IfMatch:'"atlas-app-never-match"'})).status===412,'PHOTO_READ_PRECONDITION_FAILED');
      observations.photoConditional='412_UNCHANGED';await clean(p,'photo',p.sha256);
    });
    active='artifact';const a=m.artifact;need((await e.raw('HEAD',a.key)).status===404,'INITIAL_ARTIFACT_PRESENT');
    await e.step('artifact-valid-application',async()=>{
      const payload=Buffer.from(a.payloadBase64,'base64'),collision=Buffer.from(a.collisionBase64,'base64');
      const before=e.counts.requests;let refused=false;
      try{await e.artifactTransport.putIfAbsent({key:a.key,bytes:payload,sha256:a.collisionSha256,lineageSha256:a.lineageSha256,signal:e.signal});}
      catch(error){refused=error.code==='MANUAL_ARTIFACT_UNVERIFIED';}
      need(refused&&e.counts.requests===before,'ARTIFACT_LOCAL_HASH_GUARD_FAILED');observations.artifactInvalidHash='REJECTED_WITHOUT_HTTP';
      cleanup.artifact='REQUIRED';const ref=await e.store.write(a.content,a.source,{signal:e.signal});
      need(ref.key===a.key&&ref.sha256===a.sha256&&ref.byteCount===65&&ref.lineageSha256===a.lineageSha256,'ARTIFACT_REFERENCE_CHANGED');
      need(equal(await e.store.read(ref,a.source,{signal:e.signal}),a.content),'ARTIFACT_APP_READ_FAILED');observations.artifactRead={bytes:65,sha256:ref.sha256,lineageSha256:ref.lineageSha256};
      await privateReads(a);let collisionRefused=false;
      try{await e.artifactTransport.putIfAbsent({key:a.key,bytes:collision,sha256:a.collisionSha256,lineageSha256:a.lineageSha256,signal:e.signal});}
      catch(error){collisionRefused=error?.$metadata?.httpStatusCode===412;emit({state:'ARTIFACT_COLLISION_RESULT',error:safeError(error)});}
      need(collisionRefused,'ARTIFACT_CONDITIONAL_FAILED');need(equal(await e.store.read(ref,a.source,{signal:e.signal}),a.content),'ARTIFACT_COLLISION_CHANGED_BYTES');
      need((await e.raw('GET',a.key,{IfMatch:'"atlas-app-never-match"'})).status===412,'ARTIFACT_READ_PRECONDITION_FAILED');
      observations.artifactConditional='412_UNCHANGED';await clean(a,'artifact',a.sha256);
    });
  }catch(error){failure=safeError(error);if(active&&cleanup[active]==='REQUIRED')cleanup[active]='REQUIRES_OPERATOR_RECONCILIATION';}
  finally{e.close();}
  return{status:failure?'APPLICATION_QUALIFICATION_FAILED':'APPLICATION_STORAGE_CONTRACT_PASS',nativeChecksumRefusalQualified:false,
    observations,cleanup,counts:{...e.counts},failure};
}
async function main(){
  const args=process.argv.slice(2);need(args.length===2&&args[0]==='--execute'&&/^--manifest-sha256=[a-f0-9]{64}$/.test(args[1]),'EXACT_EXECUTION_REQUIRED');
  const expected=args[1].slice('--manifest-sha256='.length),manifest=validateManifest(expected,readFileSync(`${ROOT}/manifest.json`));need(realpathSync(ROOT)===ROOT,'ROOT_CHANGED');
  const require=createRequire(new URL('../../packages/atlas-photo-storage/package.json',import.meta.url));need(require('@aws-sdk/client-s3/package.json').version==='3.914.0'&&require('@aws-sdk/s3-request-presigner/package.json').version==='3.982.0','SDK_CHANGED');
  for(const [name,relative]of[['@atlas/photo-core','packages/atlas-photo-core/src/index.mjs'],['@atlas/photo-runtime','packages/atlas-photo-runtime/src/index.mjs']])
    need(realpathSync(require.resolve(name))===realpathSync(resolve(SOURCE_ROOT,relative)),'WORKSPACE_MODULE_CHANGED');
  const sdk=require('@aws-sdk/client-s3'),{getSignedUrl}=require('@aws-sdk/s3-request-presigner');
  need(typeof process.env.ATLAS_DIAGNOSTIC_ACCESS_KEY_ID==='string'&&process.env.ATLAS_DIAGNOSTIC_ACCESS_KEY_ID.length>=8&&typeof process.env.ATLAS_DIAGNOSTIC_SECRET_ACCESS_KEY==='string'&&process.env.ATLAS_DIAGNOSTIC_SECRET_ACCESS_KEY.length>=16,'EXPLICIT_CREDENTIALS_REQUIRED');
  writeFileSync(`${ROOT}/execution.intent.json`,JSON.stringify({manifestSha256:expected,at:new Date().toISOString(),keys:[manifest.photo.key,manifest.artifact.key]})+'\n',{flag:'wx',mode:0o600});
  mkdirSync(`${ROOT}/evidence`,{mode:0o700});const journal=`${ROOT}/evidence/requests.ndjson`;writeFileSync(journal,'',{flag:'wx',mode:0o600});
  const onEvent=event=>appendFileSync(journal,JSON.stringify(event)+'\n');
  const effects=createEffects({manifest,sdk,getSignedUrl,credentials:{accessKeyId:process.env.ATLAS_DIAGNOSTIC_ACCESS_KEY_ID,secretAccessKey:process.env.ATLAS_DIAGNOSTIC_SECRET_ACCESS_KEY},onEvent});
  const stop=()=>effects.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await qualify({manifest,effects,onEvent});writeFileSync(`${ROOT}/evidence/result.json`,JSON.stringify({manifestSha256:expected,...result},null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='APPLICATION_STORAGE_CONTRACT_PASS')process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({status:'APPLICATION_QUALIFICATION_REFUSED_OR_INTERRUPTED',error:safeError(error)}));process.exitCode=1;});
