import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {constants,lstatSync,realpathSync,readdirSync,mkdirSync,openSync,closeSync,fstatSync,readSync,writeFileSync,fsyncSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {setImmediate as yieldToIO,setTimeout as delay} from 'node:timers/promises';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,engineBytesHash} from './proof-decoder-engine-json.mjs';
import {loadProofDecoderLinuxPrimitives,assertProofDecoderLinuxObserver} from './proof-decoder-linux-observer.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {openProofDecoderTargetRegistry,assertProofDecoderTargetRegistry} from './proof-decoder-target-registry.mjs';
import {reviewProofDecoderRecoverySnapshot,classifyProofDecoderRecoveryResource} from './proof-decoder-recovery-record.mjs';
import {createProofDecoderEngineTargetEndpoint} from './proof-decoder-engine-target-endpoint.mjs';
import {createProofDecoderFixedParentBinding,assertProofDecoderFixedParentReport} from './proof-decoder-engine-target-binding.mjs';
import {compileProofDecoderEngineRequest} from './proof-decoder-engine-request.mjs';
import {projectProofDecoderEngineResponse} from './proof-decoder-engine-response.mjs';

const ROOT='/var/lib/atlas-r2-decoder-recovery',LEDGER=ROOT+'/ledger',CATALOG=ROOT+'/catalog.json',ENROLLMENT=ROOT+'/enrollment.json';
const entries=new WeakMap(),retainedLocks=new Set();
const check=(value,code='DECODER_RECOVERY_REFUSED')=>requireValue(value,code);
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const stamp=st=>[st.dev,st.ino,st.uid,st.gid,st.mode,st.nlink,st.size,st.mtimeNs,st.ctimeNs].map(String);
const inode=st=>({device:String(st.dev),inode:String(st.ino)});
const MARKERS={classification:'UNQUALIFIED',executionAllowed:false,admissionAllowed:false,originalOutcomeChanged:false,capacityReleased:false};
function pathExists(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

function protectedDirectory(path,privateMode=false){
  for(let p=path;;p=dirname(p)){const st=lstatSync(p,{bigint:true});check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0n&&(st.mode&0o022n)===0n&&realpathSync(p)===p,'DECODER_RECOVERY_PATH');if(p===path&&privateMode)check((st.mode&0o7777n)===0o700n,'DECODER_RECOVERY_PATH');if(p==='/')break;}
  return stamp(lstatSync(path,{bigint:true}));
}
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);try{fsyncSync(fd);}finally{closeSync(fd);}}
function readProtected(path,max,privateMode=true){
  protectedDirectory(dirname(path));const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_CLOEXEC);
  try{
    const before=fstatSync(fd,{bigint:true});check(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o7022n)===0n&&(!privateMode||(before.mode&0o7777n)===0o600n)&&before.size<=BigInt(max),'DECODER_RECOVERY_FILE');
    const bytes=Buffer.alloc(Number(before.size));let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);check(n>0);at+=n;}
    check(same(stamp(before),stamp(fstatSync(fd,{bigint:true})))&&same(stamp(before),stamp(lstatSync(path,{bigint:true}))),'DECODER_RECOVERY_FILE_CHANGED');
    return {bytes,pin:{identity:stamp(before),sha256:engineBytesHash(bytes),byteCount:bytes.length}};
  }finally{closeSync(fd);}
}
function dataFile(path,max){const file=readProtected(path,max);let value;try{value=JSON.parse(file.bytes.toString('utf8'));}catch{check(false,'DECODER_RECOVERY_CORRUPT');}check(canonicalJSON(value)===file.bytes.toString('utf8'),'DECODER_RECOVERY_CORRUPT');return {...file,value};}
function durable(path,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(canonicalJSON(value));const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_CLOEXEC,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(dirname(path));return readProtected(path,bytes.length).pin;}
function nativeLock(options){
  const native=loadProofDecoderLinuxPrimitives({enabled:true,addonPath:options.addonPath,addonSha256:options.addonSha256});
  check(typeof native.captureRecoveryLock==='function'&&typeof native.inspectRecoveryLock==='function','DECODER_RECOVERY_ADDON');
  const handle=native.captureRecoveryLock();retainedLocks.add(handle);
  const assert=()=>{check(native.inspectRecoveryLock(handle)===true,'DECODER_RECOVERY_OWNER_LOST');return true;};assert();return assert;
}
function rootOnly(){check(process.platform==='linux'&&process.arch==='x64'&&process.versions.node==='22.16.0'&&process.getuid()===0&&process.getgid()===0,'DECODER_RECOVERY_TARGET');}
function catalogFor(plan,controller,epoch,ownerLock){const parent=controller.status();return {schema:'atlas-proof-decoder-recovery-catalog-v1',bootId:parent.bootId,parentBindingHash:parent.bindingHash,parentDevice:parent.device,parentInode:parent.inode,addonSha256:parent.addonSha256,epoch,plan,ledgerDirectory:LEDGER,ownerLock};}
function assertBinding(catalog,controller){
  decoderExact(catalog,['schema','bootId','parentBindingHash','parentDevice','parentInode','addonSha256','epoch','plan','ledgerDirectory','ownerLock']);
  check(catalog.schema==='atlas-proof-decoder-recovery-catalog-v1'&&catalog.ledgerDirectory===LEDGER&&typeof catalog.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(catalog.epoch));
  const plan=assertProofDecoderLaunchPlan(catalog.plan),state=controller.status();check(!state.closed&&same(readProtected(ROOT+'/owner.lock',0).pin,catalog.ownerLock)&&same(catalog,catalogFor(plan,controller,catalog.epoch,catalog.ownerLock)),'DECODER_RECOVERY_BINDING');return plan;
}
function currentBinding(catalog,controller){const state=controller.status();check(!state.closed&&state.bootId===catalog.bootId&&state.bindingHash===catalog.parentBindingHash&&state.device===catalog.parentDevice&&state.inode===catalog.parentInode&&state.addonSha256===catalog.addonSha256,'DECODER_RECOVERY_BINDING');}
function currentPin(path,pin){check(same(stamp(lstatSync(path,{bigint:true})),pin.identity),'DECODER_RECOVERY_FILE_CHANGED');}
function enrollmentLive(state){
  // Initial bytes/hash are immutable. These frequent effect/guard checks use
  // exact inode, mode, link count, size and nanosecond ctime/mtime plus the
  // native retained owner lock; they never refresh an expected fingerprint.
  state.assertLock();currentPin(CATALOG,state.catalogPin);currentPin(ROOT+'/owner.lock',state.catalog.ownerLock);currentBinding(state.catalog,state.controller);
  if(state.enrollmentPin)currentPin(ENROLLMENT,state.enrollmentPin);
}

/** Additive enrollment entry point. Creates exactly one fixed catalog/ledger;
 * an existing catalog is never reset or adopted. The native lock is retained
 * for process lifetime, including clean close and all uncertain failures. */
export function openProofDecoderEnrolledTargetRegistry(options={}){
  const input=engineDataOptions(options,[],['enabled','plan','controller','epoch','addonPath','addonSha256']);if(input.enabled!==true)return null;
  rootOnly();const plan=assertProofDecoderLaunchPlan(input.plan),controller=assertProofDecoderLinuxCgroupController(input.controller);
  check(plan.profile.limits.maxConcurrent===1&&typeof input.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.epoch));
  const parent=controller.status();check(parent.healthy&&!parent.frozen&&!parent.freezeRequested&&parent.addonSha256===input.addonSha256);controller.observeEmpty();
  protectedDirectory(dirname(ROOT));check(!pathExists(ROOT),'DECODER_RECOVERY_ENROLLMENT_EXISTS');mkdirSync(ROOT,{mode:0o700});syncDirectory(dirname(ROOT));protectedDirectory(ROOT,true);
  const ownerLock=durable(ROOT+'/owner.lock',Buffer.alloc(0));const assertLock=nativeLock(input),catalog=catalogFor(plan,controller,input.epoch,ownerLock),catalogPin=durable(CATALOG,catalog);
  const token=Object.freeze({...MARKERS}),state={assertLock,catalog,catalogPin,controller,plan,registry:null,enrollmentPin:null};entries.set(token,state);
  const registry=openProofDecoderTargetRegistry({enabled:true,directory:LEDGER,plan,controller,epoch:input.epoch,recoveryEnrollment:token});
  return Object.freeze({...MARKERS,registry,status(){enrollmentLive(state);return decoderFreeze({...MARKERS,enrolled:true,registryId:registry.status().registryId,catalogSha256:catalogPin.sha256,nativeOwnerRetained:true});}});
}

// Only the concrete enrolled factory can create these private values. These
// integration exports accept no JSON substitute, custom verifier or callback.
export function assertProofDecoderRecoveryRegistryOpen(value,options){
  const {plan,controller,directory,epoch}=engineDataOptions(options,['plan','controller','directory','epoch']);
  const state=entries.get(value);check(state&&!state.registry&&state.controller===controller&&state.plan.profileHash===plan.profileHash&&directory===LEDGER&&epoch===state.catalog.epoch,'DECODER_RECOVERY_ENROLLMENT_REQUIRED');enrollmentLive(state);return true;
}
export function bindProofDecoderRecoveryRegistry(value,registry){
  const state=entries.get(value);check(state&&!state.registry,'DECODER_RECOVERY_ENROLLMENT_REQUIRED');assertProofDecoderTargetRegistry(registry,{plan:state.plan,controller:state.controller});enrollmentLive(state);
  state.registry=registry;const status=registry.status();check(status.occupiedSlots===0&&!status.poisoned&&!status.closed&&status.epoch===state.catalog.epoch);
  const manifest=dataFile(LEDGER+'/ownership.json',4096);check(manifest.value.registryId===status.registryId&&manifest.value.bindingHash===status.bindingHash);
  state.enrollmentPin=durable(ENROLLMENT,{schema:'atlas-proof-decoder-recovery-enrollment-v1',catalogSha256:state.catalogPin.sha256,registryId:status.registryId,bindingHash:status.bindingHash,manifestPin:manifest.pin,directory:inode(lstatSync(LEDGER,{bigint:true})),database:manifest.value.database});state.registry=registry;
}
export function assertProofDecoderRecoveryRegistryLive(value,registry){const state=entries.get(value);check(state?.registry===registry,'DECODER_RECOVERY_ENROLLMENT_REQUIRED');enrollmentLive(state);return true;}
export function assertProofDecoderRecoveryUnenrolled(){check(!pathExists(ROOT),'DECODER_RECOVERY_ENROLLMENT_REQUIRED');return true;}

function ledgerSnapshot(catalog,enrollment){
  protectedDirectory(LEDGER,true);const names=readdirSync(LEDGER).sort();check(same(names,['ownership.json','target.sqlite'])||same(names,['ownership.json','target.sqlite','writer.lock']),'DECODER_RECOVERY_SIDECAR_OR_FOREIGN');
  const files=Object.fromEntries(names.map(name=>[name,readProtected(join(LEDGER,name),name==='target.sqlite'?16777216:4096)]));
  check(same(files['ownership.json'].pin,enrollment.manifestPin)&&same(inode(lstatSync(LEDGER,{bigint:true})),enrollment.directory)&&same(inode(lstatSync(LEDGER+'/target.sqlite',{bigint:true})),enrollment.database),'DECODER_RECOVERY_LEDGER_CHANGED');
  const db=new DatabaseSync(LEDGER+'/target.sqlite',{readOnly:true});let manifest,state,jobs,events;
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN;');check(db.prepare('PRAGMA application_id').get().application_id===0x4154444c&&db.prepare('PRAGMA user_version').get().user_version===1);
    check(same(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),['events','jobs','metadata']));
    const metadata=db.prepare('SELECT id,manifest,state FROM metadata LIMIT 2').all();check(metadata.length===1&&metadata[0].id===1&&metadata[0].manifest===files['ownership.json'].bytes.toString());manifest=JSON.parse(metadata[0].manifest);state=JSON.parse(metadata[0].state);check(canonicalJSON(state)===metadata[0].state);
    jobs=db.prepare('SELECT id,revision,record FROM jobs ORDER BY id LIMIT 129').all().map(row=>({...row}));events=db.prepare('SELECT job_id,revision,previous_hash,record_hash,event FROM events ORDER BY job_id,revision LIMIT 8193').all().map(row=>({...row}));db.exec('COMMIT');
  }finally{db.close();}
  const review=reviewProofDecoderRecoverySnapshot({plan:catalog.plan,manifest,state,jobs,events});
  check(manifest.registryId===enrollment.registryId&&manifest.bindingHash===enrollment.bindingHash&&manifest.binding.bootId===catalog.bootId&&manifest.binding.epoch===catalog.epoch&&manifest.binding.parentBindingHash===catalog.parentBindingHash);
  for(const row of review.rows)if(row.cleanup)check(row.cleanup.nativeEmpty.device===catalog.parentDevice&&row.cleanup.nativeEmpty.inode===catalog.parentInode);
  for(const name of names)check(same(readProtected(join(LEDGER,name),name==='target.sqlite'?16777216:4096).pin,files[name].pin),'DECODER_RECOVERY_LEDGER_CHANGED');
  check(same(readdirSync(LEDGER).sort(),names));return {review,pins:Object.fromEntries(names.map(name=>[name,files[name].pin])),snapshotHash:hash({manifest,state,jobs,events})};
}

function responseHeaders(raw){
  check(Array.isArray(raw)&&raw.length<=64,'DECODER_RECOVERY_HTTP');const headers={};let bytes=0;
  for(let i=0;i<raw.length;i+=2){const name=raw[i].toLowerCase(),value=raw[i+1];check(/^[a-z0-9-]{1,64}$/.test(name)&&typeof value==='string'&&!Object.hasOwn(headers,name));bytes+=Buffer.byteLength(name)+Buffer.byteLength(value);check(bytes<=8192);headers[name]=value;}
  check(headers['content-encoding']===undefined);return headers;
}
async function request(c,job,operation){
  check(['LOOKUP','INSPECT','REMOVE'].includes(operation));await yieldToIO();c.live();
  const compiled=compileProofDecoderEngineRequest({apiVersion:'1.47',plan:c.plan,job,operation,targetBinding:c.targetBinding});
  const agent=new http.Agent({keepAlive:false,maxSockets:1,maxTotalSockets:1,maxFreeSockets:0}),connecting=new AbortController();
  agent.createConnection=(_,callback)=>{c.endpoint.connect({timeoutMs:500,signal:connecting.signal}).then(socket=>callback(null,socket),error=>callback(error));};
  try{return await new Promise((resolve,reject)=>{
    let req,socket,timer,headerTimer,finished=false,used=0;const buffer=Buffer.alloc(262144);
    const live=()=>{c.live();c.endpoint.assertSocket(socket);};
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(headerTimer);connecting.abort();buffer.fill(0);if(error){req?.destroy();reject(Object.assign(new Error(error),{code:error}));}else resolve(value);};
    try{
      const remaining=Math.min(1000,Number(c.deadline-c.controller.boottimeNanoseconds())/1e6);check(remaining>0);
      timer=setTimeout(()=>finish('DECODER_RECOVERY_REQUEST_DEADLINE'),remaining);headerTimer=setTimeout(()=>finish('DECODER_RECOVERY_HEADER_DEADLINE'),Math.min(500,remaining));
      req=http.request({agent,socketPath:'/run/docker.sock',host:'localhost',method:compiled.http.method,path:compiled.http.path,headers:{connection:'close','content-length':'0'},maxHeaderSize:8192,insecureHTTPParser:false,joinDuplicateHeaders:false},response=>{
        clearTimeout(headerTimer);let headers;try{live();headers=responseHeaders(response.rawHeaders);}catch{response.destroy();finish('DECODER_RECOVERY_HTTP');return;}
        response.on('data',chunk=>{try{live();check(!finished&&used+chunk.length<=buffer.length);chunk.copy(buffer,used);used+=chunk.length;}catch{response.destroy();finish('DECODER_RECOVERY_HTTP');}});
        response.on('aborted',()=>finish('DECODER_RECOVERY_HTTP'));response.on('error',()=>finish('DECODER_RECOVERY_HTTP'));
        response.on('end',()=>{if(finished)return;try{live();check(response.complete&&response.rawTrailers.length===0);const body=buffer.subarray(0,used),report=projectProofDecoderEngineResponse({apiVersion:'1.47',plan:c.plan,job,operation,statusCode:response.statusCode,headers,body});if(report.kind==='CONTAINER_REPORTED')assertProofDecoderFixedParentReport({body,targetBinding:c.targetBinding,plan:c.plan});finish(null,report);}catch{finish('DECODER_RECOVERY_HTTP');}});
      });
      req.on('socket',value=>{socket=value;try{live();}catch{finish('DECODER_RECOVERY_PEER');}});
      req.on('information',()=>finish('DECODER_RECOVERY_HTTP'));req.on('upgrade',(_,value)=>{value.destroy();finish('DECODER_RECOVERY_HTTP');});req.on('error',()=>finish('DECODER_RECOVERY_HTTP'));c.live();req.end();
    }catch{finish('DECODER_RECOVERY_HTTP');}
  });}finally{connecting.abort();agent.destroy();}
}

/** Automatic resource reconciliation for this enrolled epoch only. This never
 * opens the original ledger for writing, resumes a job, thaws, releases its
 * writer lock, clears UNKNOWN, or produces a normal cleanup receipt. */
export async function reconcileProofDecoderRestart(options={}){
  const input=engineDataOptions(options,[],['enabled','controller','linuxObserver','addonPath','addonSha256']);if(input.enabled!==true)return null;
  rootOnly();const controller=assertProofDecoderLinuxCgroupController(input.controller),observer=assertProofDecoderLinuxObserver(input.linuxObserver);
  check(observer.addonSha256===input.addonSha256&&controller.status().addonSha256===input.addonSha256,'DECODER_RECOVERY_ADDON');
  if(!pathExists(ROOT))return decoderFreeze({...MARKERS,disposition:'LEGACY_UNENROLLED_HOLD',engineRequests:0,resourceResults:[]});
  protectedDirectory(ROOT,true);const assertLock=nativeLock(input);assertLock();
  const catalogFile=dataFile(CATALOG,32768),catalog=catalogFile.value,plan=assertBinding(catalog,controller);
  // A recognized enrolled epoch is quarantined even if its later ledger or
  // journal validation refuses. Acquiring the owner lock never opens admission.
  controller.freezeAndKill();
  const enrollmentFile=dataFile(ENROLLMENT,4096),enrollment=decoderContractData(enrollmentFile.value);
  decoderExact(enrollment,['schema','catalogSha256','registryId','bindingHash','manifestPin','directory','database']);check(enrollment.schema==='atlas-proof-decoder-recovery-enrollment-v1'&&enrollment.catalogSha256===catalogFile.pin.sha256);
  const original=ledgerSnapshot(catalog,enrollment),journal=ROOT+'/journal';
  check(readdirSync(ROOT).every(name=>['owner.lock','catalog.json','enrollment.json','ledger','journal'].includes(name)),'DECODER_RECOVERY_FOREIGN');
  if(!existsSync(journal)){mkdirSync(journal,{mode:0o700});syncDirectory(ROOT);}protectedDirectory(journal,true);
  const journalNames=readdirSync(journal);check(journalNames.length<=512&&journalNames.every(name=>name==='snapshot.json'||/^attempt-(?:0[1-9]|1[0-6])\.(?:intent|result)\.json$/.test(name)||/^[a-f0-9-]{36}\.(?:delete-intent|delete-result|after-uncertain)\.json$/.test(name)),'DECODER_RECOVERY_JOURNAL');
  const frozenSnapshot={schema:'atlas-proof-decoder-recovery-original-v1',catalogPin:catalogFile.pin,enrollmentPin:enrollmentFile.pin,ledgerPins:original.pins,snapshotHash:original.snapshotHash};
  if(existsSync(journal+'/snapshot.json'))check(same(dataFile(journal+'/snapshot.json',16384).value,frozenSnapshot),'DECODER_RECOVERY_LEDGER_CHANGED');else durable(journal+'/snapshot.json',frozenSnapshot);
  let attempt=1;while(existsSync(join(journal,`attempt-${String(attempt).padStart(2,'0')}.intent.json`)))attempt++;check(attempt<=16,'DECODER_RECOVERY_ATTEMPT_LIMIT');
  const began=controller.boottimeNanoseconds(),deadline=began+30000000000n,attemptName=join(journal,`attempt-${String(attempt).padStart(2,'0')}`);
  durable(attemptName+'.intent.json',{schema:'atlas-proof-decoder-recovery-attempt-v1',snapshotHash:original.snapshotHash,attempt,beganAtNs:String(began),deadlineAtNs:String(deadline)});
  const resourceResults=[];let engineRequests=0,failure=null;const quarantined=true;
  function fixedFiles(){assertLock();check(same(readProtected(CATALOG,32768).pin,catalogFile.pin)&&same(readProtected(ENROLLMENT,4096).pin,enrollmentFile.pin),'DECODER_RECOVERY_CATALOG_CHANGED');for(const [name,pin] of Object.entries(original.pins))check(same(stamp(lstatSync(join(LEDGER,name),{bigint:true})),pin.identity),'DECODER_RECOVERY_LEDGER_CHANGED');check(same(readdirSync(LEDGER).sort(),Object.keys(original.pins).sort()),'DECODER_RECOVERY_LEDGER_CHANGED');assertBinding(catalog,controller);}
  const c={plan,controller,deadline,targetBinding:createProofDecoderFixedParentBinding({enabled:true,plan}),endpoint:createProofDecoderEngineTargetEndpoint({enabled:true,socketPath:'/run/docker.sock',linuxObserver:observer}),live(){fixedFiles();const current=controller.status();check(!current.closed&&!current.populated&&current.freezeRequested&&current.frozen&&controller.boottimeNanoseconds()<deadline,'DECODER_RECOVERY_PARENT_OR_DEADLINE');}};
  const observe=async(job,operation)=>{engineRequests++;return request(c,job,operation);};
  try{
    fixedFiles();
    const emptyDeadline=controller.boottimeNanoseconds()+1000000000n;
    while(true){fixedFiles();const current=controller.status();if(!current.populated&&current.freezeRequested&&current.frozen)break;check(controller.boottimeNanoseconds()<emptyDeadline,'DECODER_RECOVERY_PARENT_NOT_EMPTY');await delay(10);}c.live();
    // This is the sole allowed public policy artifact; no arbitrary config,
    // credential path, Config.Env or environment enumeration is read.
    check(plan.profile.seccomp.path==='/etc/atlas-r2-decoder/security-01/seccomp.json','DECODER_RECOVERY_SECCOMP_PATH');
    const seccomp=readProtected(plan.profile.seccomp.path,65536,false).bytes;check(engineBytesHash(seccomp)===plan.profile.seccomp.sha256);
    for(const row of original.review.rows){
      c.live();
      for(const effect of row.effects){const compiled=compileProofDecoderEngineRequest({apiVersion:'1.47',plan,job:{...row.identity,containerId:effect.operation==='CREATE'?null:row.identity.containerId},operation:effect.operation,targetBinding:c.targetBinding,...(effect.operation==='CREATE'?{seccompBytes:seccomp}:{})});check(engineBytesHash(Buffer.from(canonicalJSON(compiled.http)))===effect.requestHash,'DECODER_RECOVERY_REQUEST_HASH');}
      const base={jobId:row.identity.jobId,originalPhase:row.phase,originalRevision:row.revision,originalRecordHash:hash(row),capacityHeld:row.phase!=='FINALIZED'};
      const policy=observation=>classifyProofDecoderRecoveryResource({phase:row.phase,hasCreateIntent:row.effects.some(effect=>effect.operation==='CREATE'),hasOriginalRemoveIntent:row.effects.some(effect=>effect.operation==='REMOVE'),hasRecoveryRemoveIntent:existsSync(join(journal,row.identity.jobId+'.delete-intent.json')),observation});
      if(policy('UNOBSERVED').action==='NO_ENGINE_EFFECT_HOLD'){resourceResults.push({...base,disposition:'NO_ENGINE_EFFECT_RECORDED_HOLD'});continue;}
      let observed=await observe(row.identity,row.identity.containerId===null?'LOOKUP':'INSPECT');
      if(observed.kind==='NOT_FOUND_REPORTED'){check(policy('ABSENT').action==='ABSENCE_HOLD');resourceResults.push({...base,disposition:'ABSENCE_OBSERVED_ORIGINAL_UNCHANGED',observedAtNs:String(controller.boottimeNanoseconds())});continue;}
      check(observed.kind==='CONTAINER_REPORTED','DECODER_RECOVERY_LOOKUP');const job={...row.identity,containerId:observed.data.containerId};
      if(policy('PRESENT').action==='CONTRADICTION_HOLD'){resourceResults.push({...base,disposition:'FINALIZED_RESOURCE_CONTRADICTION_HOLD',containerId:job.containerId});continue;}
      const intentPath=join(journal,row.identity.jobId+'.delete-intent.json'),resultPath=join(journal,row.identity.jobId+'.delete-result.json');
      if(policy('PRESENT').action==='LOOKUP_ONLY_HOLD'){
        if(existsSync(intentPath)){const prior=dataFile(intentPath,8192).value;check(prior.snapshotHash===original.snapshotHash&&same(prior.identity,job)&&prior.originalRecordHash===hash(row),'DECODER_RECOVERY_JOURNAL');}
        const lookupPath=join(journal,row.identity.jobId+'.after-uncertain.json');if(!existsSync(lookupPath))durable(lookupPath,{schema:'atlas-proof-decoder-recovery-lookup-v1',identity:job,snapshotHash:original.snapshotHash,observedAtNs:String(controller.boottimeNanoseconds()),state:observed.data.state,deleteResubmitted:false});
        resourceResults.push({...base,disposition:'PRIOR_REMOVE_INTENT_HOLD_NO_RETRY',containerId:job.containerId});continue;
      }
      check(policy('PRESENT').action==='ONE_OWNED_DELETE_CANDIDATE');const terminal=observed.data.state;check(['created','exited','dead'].includes(terminal.status)&&!terminal.running&&!terminal.paused&&!terminal.restarting&&terminal.pid===0,'DECODER_RECOVERY_EXIT_UNCERTAIN');
      const compiled=compileProofDecoderEngineRequest({apiVersion:'1.47',plan,job,operation:'REMOVE',targetBinding:c.targetBinding});
      c.live();durable(intentPath,{schema:'atlas-proof-decoder-recovery-delete-intent-v1',snapshotHash:original.snapshotHash,identity:job,originalRecordHash:hash(row),requestHash:engineBytesHash(Buffer.from(canonicalJSON(compiled.http))),observedTerminal:terminal,intentAtNs:String(controller.boottimeNanoseconds())});
      // Once the durable intent exists, any error leaves it permanently held.
      // A future process may LOOKUP, but never retransmits this DELETE.
      c.live();const removed=await observe(job,'REMOVE');check(removed.kind==='REMOVE_REPORTED'&&removed.statusCode===204,'DECODER_RECOVERY_REMOVE_UNCERTAIN');
      c.live();durable(resultPath,{schema:'atlas-proof-decoder-recovery-delete-response-v1',snapshotHash:original.snapshotHash,identity:job,status:204,observedAtNs:String(controller.boottimeNanoseconds())});
      observed=await observe(job,'INSPECT');check(observed.kind==='NOT_FOUND_REPORTED','DECODER_RECOVERY_ABSENCE_UNCERTAIN');c.live();resourceResults.push({...base,disposition:'RESOURCE_REMOVED_ORIGINAL_OUTCOME_HELD',containerId:job.containerId,status:204,absenceObserved:true});
    }
    seccomp.fill(0);c.live();const after=ledgerSnapshot(catalog,enrollment);check(after.snapshotHash===original.snapshotHash&&same(after.pins,original.pins),'DECODER_RECOVERY_LEDGER_CHANGED');
  }catch(error){failure=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)?error.code:'DECODER_RECOVERY_UNCERTAIN';}
  // Native ownership remains retained even if recording this result fails.
  fixedFiles();const result=decoderFreeze({schema:'atlas-proof-decoder-restart-reconciliation-v1',...MARKERS,disposition:'EPOCH_QUARANTINED_HOLD',attempt,snapshotHash:original.snapshotHash,engineRequests,quarantined,failure,resourceResults,originalHeldJobs:original.review.heldJobs,writerLockRetired:false,epochReset:false,nativeOwnerRetained:true,finishedAtNs:String(controller.boottimeNanoseconds())});durable(attemptName+'.result.json',result);return result;
}
