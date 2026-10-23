// Operator-only fresh v4 migration/storage cases. No PostgreSQL, Engine or
// canonical authority. Positive database settlement is a separate join test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJSON,hash} from '../src/contract.mjs';
import {createProofDecoderLinuxObserver} from '../src/proof-decoder-linux-observer.mjs';
import {openProofPublicationStore,openProofOriginalReader,migrateProofPublicationLedgerV2,openProofPublicationLifecycleStore,migrateProofPublicationLedgerV3,openProofPublicationDispatchStore,migrateProofPublicationLedgerV4,openProofPublicationRetentionStore} from '../src/proof-publication-store.mjs';
const CASES=['clean','initial','hold','crash'];
const key=()=>Buffer.alloc(32,0x51),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicPNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function file(path,uid=0,max=131072){
  assert.ok(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&fs.realpathSync(path)===path);
  for(let p=dirname(path);;p=dirname(p)){const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&[0,uid].includes(s.uid)&&(s.mode&0o022)===0);if(p==='/')break;}
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let bytes;
  try{const s=fs.fstatSync(fd);assert.ok(s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&0o022)===0&&s.size>0&&s.size<=max);bytes=Buffer.alloc(s.size+1);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}assert.equal(n,s.size);for(const after of [fs.fstatSync(fd),fs.lstatSync(path)])for(const k of ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'])assert.equal(after[k],s[k]);return bytes.subarray(0,n);}catch(e){bytes?.fill(0);throw e;}finally{fs.closeSync(fd);}
}
const json=(p,uid=0)=>JSON.parse(file(p,uid));
const emit=value=>process.stdout.write(JSON.stringify({classification:'UNQUALIFIED',customerPublicationAuthority:false,...value})+'\n');
const binding=()=>({installationId:randomUUID(),qualificationSessionId:randomUUID(),qualificationEvidenceHash:hash('operator-data-only'),sourceClosureHash:hash('operator-source'),policyHash:hash('fixture-policy'),intakeBindingHash:hash('fixture-intake')});
const scope=()=>({fenceId:randomUUID(),sourceKind:'POLICY',sourceKeyHash:hash('fixture-policy'),sourceGenerationHash:hash('generation'),ordinal:1,revision:1});
function fixture(setup,name){assert.ok(CASES.includes(name));const descriptorPath=setup.fixtures[name],descriptor=json(descriptorPath);assert.equal(descriptor.publisher.uid,process.getuid());assert.equal(descriptor.publisher.gid,process.getgid());return {descriptorPath,descriptor,dbPath:join(descriptor.ledgerDirectory,'publication.sqlite'),evidence:join(dirname(descriptor.ledgerDirectory),'evidence'),options:{enabled:true,descriptorPath,encryptionKey:key()}};}
function start(store,b=binding()){const s=store.status();return store.beginSession({operationId:randomUUID(),expectedRevision:s.revision,previousSessionId:s.latestSessionId,previousCloseHash:s.lastCloseHash,binding:b}).record;}
function end(store,session){store.beginSessionDrain({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId,reason:'SERVICE_STOP'});store.closeSession({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId});}
function seal(f){return json(join(f.descriptor.storage.directory,'.atlas-proof-publisher-seal-v1'),process.getuid());}
function migration(f){const s=seal(f);return {...f.options,expectedLedgerId:s.manifest.ledgerId,expectedRevision:s.revision,expectedHeadHash:s.headHash,migrationId:randomUUID()};}
function original(f){const s=f.descriptor.storage;return {operationId:randomUUID(),expectedRevision:0,objectKey:hash({fixture:s.storageId,original:true}),bytes:publicPNG,manifest:{schema:'atlas-marketplace-retained-proof-v1',proofId:'fixture-proof',uploadId:'fixture-upload',environment:s.environment,storageId:s.storageId,retentionRef:s.retentionRef,retainUntil:2000000000000,createdAt:1000,validatedAt:1001,policyHash:hash('fixture-policy'),orderBinding:{orderId:'fixture-order',cardId:'fixture-card',buyerId:'fixture-buyer',sellerId:'fixture-seller',bindingHash:'fixture-binding',policyVersion:'fixture-v1'},actorId:'fixture-buyer',actorRole:'BUYER',purpose:'RETURN_REQUEST',byteCount:publicPNG.length,sha256:sha(publicPNG),validation:{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/png',byteCount:publicPNG.length,sha256:sha(publicPNG),width:1,height:1}}};}
function setupV2(f,observer,openSession=true){const old=openProofPublicationStore(f.options),request=original(f);try{old.publishOriginal(request);}finally{old.close();}migrateProofPublicationLedgerV2(migration(f));if(!openSession)return request;const v2=openProofPublicationLifecycleStore({...f.options,linuxObserver:observer});try{const s=start(v2);end(v2,s);}finally{v2.close();}return request;}
function upgrade(f,observer){return migrateProofPublicationLedgerV3({...migration(f),linuxObserver:observer});}
function prefix(f,revision){const db=new DatabaseSync(f.dbPath,{readOnly:true});try{return {legacy:Object.fromEntries(['metadata','operations','events'].map(t=>[t,hash(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all().map(v=>({...v})))])),events:hash(db.prepare('SELECT * FROM lifecycle_events WHERE revision<=? ORDER BY revision').all(revision).map(v=>({...v})))};}finally{db.close();}}
function prepare(base,uid,gid,app,worker){
  assert.equal(process.getuid(),0);assert.equal(new Set([uid,app,worker]).size,3);assert.ok([uid,gid,app,worker].every(v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647));assert.ok(isAbsolute(base)&&resolve(base)===base&&!fs.existsSync(base));assert.equal(fs.realpathSync(dirname(base)),dirname(base));fs.mkdirSync(base,{mode:0o755});fs.chmodSync(base,0o755);const fixtures={};
  for(const name of CASES){const path=join(base,name);fs.mkdirSync(path,{mode:0o700});fs.chownSync(path,uid,gid);for(const child of ['ledger','objects','evidence']){fs.mkdirSync(join(path,child),{mode:0o700});fs.chownSync(join(path,child),uid,gid);}const descriptor={schema:'atlas-proof-publication-descriptor-v1',publisher:{uid,gid},app:{uid:app},worker:{uid:worker},ledgerDirectory:join(path,'ledger'),storage:{directory:join(path,'objects'),keyId:'public-fixture-key',storageId:'dispatch-'+name,environment:'SYNTHETIC_LOCAL',retentionRef:'synthetic-dispatch-fixture',maxObjectBytes:10485760}},target=join(base,name+'.json');fs.writeFileSync(target,canonicalJSON(descriptor),{flag:'wx',mode:0o644});fs.chmodSync(target,0o644);fixtures[name]=target;}
  const sourcePath=join(base,'fixtures.json');fs.writeFileSync(sourcePath,JSON.stringify({schema:'atlas-proof-publication-retention-fixtures-v1',sourcePath,publisher:{uid,gid},fixtures}),{flag:'wx',mode:0o644});fs.chmodSync(sourcePath,0o644);emit({event:'PREPARED',sourcePath,cases:CASES.length});
}

function v3(f,observer){const original=setupV2(f,observer);upgrade(f,observer);const store=openProofPublicationDispatchStore({...f.options,linuxObserver:observer});try{const s=start(store);end(store,s);}finally{store.close();}return original;}
function v4(f,observer){return migrateProofPublicationLedgerV4({...migration(f),linuxObserver:observer});}
const args=process.argv.slice(2);assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.versions.node,'22.16.0');
if(args[0]==='prepare'){assert.equal(args.length,6);assert.ok(args.slice(2).every(v=>/^[1-9][0-9]{0,9}$/.test(v)));prepare(args[1],...args.slice(2).map(Number));}
else{
 assert.ok(['run','crash-child'].includes(args[0])&&args.length===4);const setup=json(args[1]);assert.equal(setup.schema,'atlas-proof-publication-retention-fixtures-v1');assert.equal(setup.sourcePath,args[1]);assert.deepEqual(Object.keys(setup.fixtures),CASES);assert.equal(process.getuid(),setup.publisher.uid);assert.equal(process.geteuid(),setup.publisher.uid);assert.equal(process.getgid(),setup.publisher.gid);assert.equal(process.getegid(),setup.publisher.gid);assert.ok(process.getgroups().every(g=>g===setup.publisher.gid));
 const observer=createProofDecoderLinuxObserver({enabled:true,addonPath:args[2],addonSha256:args[3]}),checks=[];
 try{
  if(args[0]==='crash-child'){
   const f=fixture(setup,'crash'),exec=DatabaseSync.prototype.exec;let entered=false;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='PRAGMA user_version=4')entered=true;if(entered&&sql==='COMMIT')process.kill(process.pid,'SIGKILL');return result;};v4(f,observer);throw new Error('expected migration crash');
  }
  {
   const f=fixture(setup,'clean'),original=v3(f,observer),checkpoint=seal(f),history=prefix(f,checkpoint.revision),inode=fs.statSync(f.dbPath),envelope=sha(file(join(f.descriptor.storage.directory,original.objectKey+'.proof'),process.getuid()));
   v4(f,observer);assert.equal(fs.statSync(f.dbPath).ino,inode.ino);assert.equal(fs.statSync(f.dbPath).dev,inode.dev);assert.deepEqual(prefix(f,checkpoint.revision),history);assert.equal(sha(file(join(f.descriptor.storage.directory,original.objectKey+'.proof'),process.getuid())),envelope);
   for(let i=0;i<2;i++){const store=openProofPublicationRetentionStore({...f.options,linuxObserver:observer});try{const s=start(store);assert.equal(store.status().externalHoldCount,0);end(store,s);}finally{store.close();}}
   assert.deepEqual(prefix(f,checkpoint.revision),history);const reader=openProofOriginalReader(f.options);try{const read=reader.readOriginal({objectKey:original.objectKey,manifestHash:hash(original.manifest)});assert.ok(read.bytes.equals(publicPNG));read.bytes.fill(0);}finally{reader.close();}checks.push('same-inode-v3-v4-history-envelope-and-clean-successors');
  }
  {
   const f=fixture(setup,'initial');setupV2(f,observer,false);upgrade(f,observer);v4(f,observer);const store=openProofPublicationRetentionStore({...f.options,linuxObserver:observer});try{const session=start(store);assert.equal(session.previousSessionId,null);end(store,session);}finally{store.close();}const reopened=openProofPublicationRetentionStore({...f.options,linuxObserver:observer});reopened.close();checks.push('initial-v2-v3-v4-before-first-session');
  }
  {
   const f=fixture(setup,'hold');v3(f,observer);const store=openProofPublicationDispatchStore({...f.options,linuxObserver:observer}),s=start(store);store.holdExternalDispatch({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:s.sessionId,kind:'RETAIN',identityHash:hash('old unresolved hold')});assert.throws(()=>store.close());const lock=join(f.descriptor.ledgerDirectory,'writer.lock'),before=sha(file(lock,process.getuid()));assert.throws(()=>v4(f,observer));assert.equal(sha(file(lock,process.getuid())),before);checks.push('v3-old-hold-not-adopted-or-reset');
  }
  {
   const f=fixture(setup,'crash');v3(f,observer);const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'crash-child',...args.slice(1)],{encoding:'utf8',timeout:15000,maxBuffer:262144,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',TZ:'UTC'}});fs.writeFileSync(join(f.evidence,'child.stderr'),child.stderr??'',{flag:'wx',mode:0o600});assert.equal(child.signal,'SIGKILL',child.stderr);assert.ok(fs.existsSync(join(f.descriptor.ledgerDirectory,'writer.lock')));assert.throws(()=>openProofPublicationRetentionStore({...f.options,linuxObserver:observer}));assert.throws(()=>v4(f,observer));const db=new DatabaseSync(f.dbPath,{readOnly:true});try{const last=JSON.parse(db.prepare('SELECT record FROM lifecycle_events ORDER BY revision DESC LIMIT 1').get().record);assert.equal(last.kind,'RETENTION_MIGRATE');fs.writeFileSync(join(f.evidence,'last-event.json'),JSON.stringify(last),{flag:'wx',mode:0o600});}finally{db.close();}checks.push('v4-migration-commit-before-seal-owned-sigkill-held');
  }
  emit({event:'RESULT',scope:'ACTUAL_NATIVE_STORAGE_MIGRATION_ONLY',checks,powerLossTested:false,postgresSettlementTested:false});
 }finally{observer.close();process.stdin.destroy();}
}
