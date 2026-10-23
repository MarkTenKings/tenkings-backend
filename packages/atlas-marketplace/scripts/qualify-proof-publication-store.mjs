// Explicit Linux operator harness. No default run, network, decoder, secrets,
// customer objects or production admission. All fixtures and crash debris stay.
import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {constants,mkdirSync,chownSync,chmodSync,writeFileSync,readFileSync,renameSync,existsSync,statSync,openSync,closeSync,fstatSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash} from '../src/contract.mjs';
import {createEncryptedProofStorage} from '../src/proof-storage.mjs';
import {openProofPublicationStore,openProofOriginalReader} from '../src/proof-publication-store.mjs';

const CASES=['normal','legacy','replaced','rollback','stale','sidecar-journal','sidecar-wal','sidecar-shm','before-link','after-link-sync','after-complete','missing-original','corrupt-original'];
const key=()=>Buffer.alloc(32,0x51); // Public synthetic fixture key; never a real key.
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const storageModule=new URL('../src/proof-publication-store.mjs',import.meta.url).href;
function boundedJSON(path,max=32768){
  assert.ok(isAbsolute(path));assert.equal(realpathSync(path),resolve(path));const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=fstatSync(fd);assert.ok(info.isFile()&&info.uid===0&&info.nlink===1&&(info.mode&0o022)===0&&info.size<=max);const b=Buffer.alloc(info.size+1);let at=0;while(at<b.length){const n=readSync(fd,b,at,b.length-at,null);if(!n)break;at+=n;}assert.equal(at,info.size);return JSON.parse(b.subarray(0,at));}finally{closeSync(fd);}
}
function input(config){const storage=config.storage;return {operationId:randomUUID(),expectedRevision:0,objectKey:hash({fixture:storage.storageId}),bytes,
 manifest:{schema:'atlas-marketplace-retained-proof-v1',proofId:'demo_proof',uploadId:'demo_upload',environment:storage.environment,storageId:storage.storageId,retentionRef:storage.retentionRef,retainUntil:2000000000000,createdAt:1000,validatedAt:1001,policyHash:hash('synthetic-policy'),orderBinding:{orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',bindingHash:'legacy-fixture-binding',policyVersion:'fixture-v1'},actorId:'demo_buyer',actorRole:'BUYER',purpose:'RETURN_REQUEST',byteCount:bytes.length,sha256:sha(bytes),validation:{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/png',byteCount:bytes.length,sha256:sha(bytes),width:1,height:1}}};}
const args=process.argv.slice(2);assert.equal(process.platform,'linux');assert.equal(process.versions.node,'22.16.0');
if(args[0]==='prepare'){
  assert.equal(process.getuid(),0);assert.equal(args.length,6);const [,,uidText,gidText,appText,workerText]=args,base=args[1];
  const [uid,gid,app,worker]=[uidText,gidText,appText,workerText].map(value=>{assert.match(value,/^[1-9][0-9]{0,9}$/);const n=Number(value);assert.ok(n<=2147483647);return n;});assert.equal(new Set([uid,app,worker]).size,3);
  assert.ok(isAbsolute(base)&&resolve(base)===base&&!existsSync(base));assert.equal(realpathSync(dirname(base)),dirname(base));mkdirSync(base,{mode:0o755});chmodSync(base,0o755);
  const fixtures={};
  for(const name of CASES){const folder=join(base,name);mkdirSync(folder,{mode:0o700});chownSync(folder,uid,gid);for(const child of ['ledger','objects','evidence']){const p=join(folder,child);mkdirSync(p,{mode:0o700});chownSync(p,uid,gid);}
    const descriptor={schema:'atlas-proof-publication-descriptor-v1',publisher:{uid,gid},app:{uid:app},worker:{uid:worker},ledgerDirectory:join(folder,'ledger'),storage:{directory:join(folder,'objects'),keyId:'qualification-public-key',storageId:'qualification-'+name,environment:'SYNTHETIC_LOCAL',retentionRef:'qualification-retained-fixtures',maxObjectBytes:10485760}};
    const path=join(base,name+'.json');writeFileSync(path,JSON.stringify(descriptor),{flag:'wx',mode:0o644});chmodSync(path,0o644);fixtures[name]=path;
  }
  const path=join(base,'qualification.json');writeFileSync(path,JSON.stringify({schema:'atlas-proof-publication-qualification-v1',publisher:{uid,gid},appUid:app,fixtures}),{flag:'wx',mode:0o644});chmodSync(path,0o644);
  console.log(JSON.stringify({classification:'UNQUALIFIED_FIXTURE_SETUP',path,fixtures:CASES.length}));
}else if(args[0]==='run'){
  assert.equal(args.length,2);const config=boundedJSON(args[1]);assert.equal(config.schema,'atlas-proof-publication-qualification-v1');assert.equal(process.getuid(),config.publisher.uid);assert.equal(process.getgid(),config.publisher.gid);assert.deepEqual(Object.keys(config.fixtures),CASES);
  function fixture(name){const descriptorPath=config.fixtures[name],descriptor=boundedJSON(descriptorPath);return {descriptorPath,descriptor,open:()=>openProofPublicationStore({enabled:true,descriptorPath,encryptionKey:key()}),read:()=>openProofOriginalReader({enabled:true,descriptorPath,encryptionKey:key()}),request:input(descriptor),evidence:join(dirname(descriptor.ledgerDirectory),'evidence')};}
  const save=(path,value)=>writeFileSync(path,value,{flag:'wx',mode:0o600});
  test('actual owner publishes exact legacy format once, revokes, and clean reopen only reads',()=>{
    const f=fixture('normal'),store=f.open(),request=f.request;
    try{assert.equal(store.status().phase,'ACTIVE');const result=store.publishOriginal(request);assert.equal(result.record.phase,'COMPLETED');assert.equal(result.customerPublicationAuthority,false);assert.deepEqual(store.publishOriginal(request),result);assert.throws(()=>store.publishOriginal({...request,manifest:{...request.manifest,purpose:'PACK'}}),{code:'PUBLICATION_OPERATION_CONFLICT'});
      const read=store.readOriginal({objectKey:request.objectKey,manifestHash:hash(request.manifest)});assert.ok(read.bytes.equals(bytes));assert.deepEqual(read.manifest,request.manifest);read.bytes.fill(0);
      const legacy=createEncryptedProofStorage({...f.descriptor.storage,encryptionKey:key()});try{assert.deepEqual(legacy.binding,store.binding);const old=legacy.get({objectKey:request.objectKey});assert.ok(old.bytes.equals(bytes));old.bytes.fill(0);}finally{legacy.close();}
      const revision=store.status().revision,revocation={operationId:randomUUID(),expectedRevision:revision,reason:'OPERATOR_REVOKED'};const revoked=store.revoke(revocation);assert.deepEqual(store.revoke(revocation),revoked);assert.equal(store.status().phase,'REVOKED');assert.throws(()=>store.publishOriginal({...request,operationId:randomUUID(),objectKey:hash('other')}),{code:'PUBLICATION_STORE_HELD'});
    }finally{store.close();}
    const reopened=f.open();try{assert.equal(reopened.status().readOnly,true);assert.equal(reopened.status().phase,'REVOKED');const saved=reopened.readOriginal({objectKey:request.objectKey,manifestHash:hash(request.manifest)});assert.ok(saved.bytes.equals(bytes));saved.bytes.fill(0);}finally{reopened.close();}
  });
  test('preexisting v1 encrypted original is unchanged, readable and never adopted as new publication',()=>{
    const f=fixture('legacy'),legacy=createEncryptedProofStorage({...f.descriptor.storage,encryptionKey:key()});try{legacy.put(f.request);}finally{legacy.close();}
    const path=join(f.descriptor.storage.directory,f.request.objectKey+'.proof'),before=readFileSync(path),store=f.open();try{assert.equal(store.lookupOriginal({objectKey:f.request.objectKey,manifestHash:hash(f.request.manifest)}).observation,'UNTRACKED_ORIGINAL');assert.throws(()=>store.publishOriginal(f.request),{code:'PUBLICATION_UNTRACKED_ORIGINAL'});assert.ok(readFileSync(path).equals(before));}finally{store.close();}
  });
  test('volume seal refuses a replacement database and same-inode rollback to earlier valid state',()=>{
    for(const name of ['replaced','rollback']){const f=fixture(name),store=f.open(),dbPath=join(f.descriptor.ledgerDirectory,'publication.sqlite'),genesis=readFileSync(dbPath);store.close();const latest=readFileSync(dbPath);save(join(f.evidence,'revoked.sqlite'),latest);
      if(name==='replaced'){renameSync(dbPath,join(f.evidence,'original-inode.sqlite'));writeFileSync(dbPath,latest,{flag:'wx',mode:0o600});assert.throws(f.open,{code:'PUBLICATION_FILE_REFUSED'});}
      else{const inode=statSync(dbPath).ino;writeFileSync(dbPath,genesis);assert.equal(statSync(dbPath).ino,inode);assert.throws(f.open,{code:'PUBLICATION_LEDGER_ROLLBACK'});}
    }
  });
  test('abrupt owner exit retains writer lock; every SQLite sidecar refuses recovery',()=>{
    const f=fixture('stale'),child=`const {openProofPublicationStore}=await import(process.argv[1]);openProofPublicationStore({enabled:true,descriptorPath:process.argv[2],encryptionKey:Buffer.alloc(32,0x51)});process.exit(0);`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',child,storageModule,f.descriptorPath],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});assert.equal(result.status,0,result.stderr);assert.throws(f.open,{code:'PUBLICATION_WRITER_LOCKED'});
    for(const suffix of ['journal','wal','shm']){const x=fixture('sidecar-'+suffix),store=x.open();store.close();save(join(x.descriptor.ledgerDirectory,'publication.sqlite-'+suffix),Buffer.alloc(512,0x31));assert.throws(x.open,{code:'PUBLICATION_RECOVERY_REQUIRED'});}
  });
  test('missing or corrupted retained originals hold further writes and preserve prior evidence',()=>{
    for(const name of ['missing-original','corrupt-original']){
      const f=fixture(name),store=f.open(),request=f.request;store.publishOriginal(request);
      const path=join(f.descriptor.storage.directory,request.objectKey+'.proof'),saved=readFileSync(path);
      renameSync(path,join(f.evidence,'original.proof'));
      try{
        if(name==='missing-original')assert.equal(store.lookupOriginal({objectKey:request.objectKey,manifestHash:hash(request.manifest)}).observation,'ORIGINAL_UNAVAILABLE_HOLD');
        else{
          const envelope=JSON.parse(saved);const tag=Buffer.from(envelope.tag,'base64');tag[0]^=1;envelope.tag=tag.toString('base64');
          writeFileSync(path,JSON.stringify(envelope),{flag:'wx',mode:0o400});
          assert.throws(()=>store.lookupOriginal({objectKey:request.objectKey,manifestHash:hash(request.manifest)}),{code:'PROOF_STORAGE_CORRUPT'});
        }
        assert.equal(store.status().poisoned,true);
        assert.throws(()=>store.publishOriginal({...request,operationId:randomUUID(),objectKey:hash('must-remain-held'),expectedRevision:store.status().revision}),{code:'PUBLICATION_STORE_HELD'});
      }finally{store.close();}
      assert.throws(f.open,{code:'PUBLICATION_WRITER_LOCKED'});
    }
  });
  test('operator-only crash injection preserves intent, original and lost-reply completion without retry',()=>{
    for(const phase of ['before-link','after-link-sync','after-complete']){
      const f=fixture(phase),request=f.request,payload={phase,descriptorPath:f.descriptorPath,module:storageModule,request:{...request,bytes:bytes.toString('base64')},objects:f.descriptor.storage.directory,db:join(f.descriptor.ledgerDirectory,'publication.sqlite')};
      // Instrument ONLY this disposable operator child, never runtime options.
      const child=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {DatabaseSync} from 'node:sqlite';const p=JSON.parse(process.argv[1]);const final=p.objects+'/'+p.request.objectKey+'.proof';const link=fs.linkSync,sync=fs.fsyncSync;const kill=()=>process.kill(process.pid,'SIGKILL');fs.linkSync=(a,b)=>{if(b===final&&p.phase==='before-link')kill();return link(a,b);};fs.fsyncSync=fd=>{sync(fd);if(!fs.existsSync(final)||fs.fstatSync(fd).ino!==fs.statSync(p.objects).ino)return;if(p.phase==='after-link-sync')kill();if(p.phase==='after-complete'){const db=new DatabaseSync(p.db,{readOnly:true});let row;try{row=db.prepare('SELECT record FROM operations WHERE id=?').get(p.request.operationId);}finally{db.close();}if(row&&JSON.parse(row.record).phase==='COMPLETED')kill();}};syncBuiltinESMExports();const {openProofPublicationStore}=await import(p.module);const store=openProofPublicationStore({enabled:true,descriptorPath:p.descriptorPath,encryptionKey:Buffer.alloc(32,0x51)});store.publishOriginal({...p.request,bytes:Buffer.from(p.request.bytes,'base64')});throw new Error('crash boundary not reached');`;
      const result=spawnSync(process.execPath,['--input-type=module','-e',child,JSON.stringify(payload)],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});save(join(f.evidence,'child.stderr'),result.stderr??'');assert.equal(result.signal,'SIGKILL',result.stderr);assert.throws(f.open,{code:'PUBLICATION_WRITER_LOCKED'});
      const db=new DatabaseSync(payload.db,{readOnly:true});try{const record=JSON.parse(db.prepare('SELECT record FROM operations WHERE id=?').get(request.operationId).record);assert.equal(record.phase,phase==='after-complete'?'COMPLETED':'INTENT');save(join(f.evidence,'operation.json'),JSON.stringify(record));}finally{db.close();}
      const reader=f.read();try{const original=reader.readOriginal({objectKey:request.objectKey,manifestHash:hash(request.manifest)});if(phase==='before-link')assert.equal(original,null);else{assert.ok(original.bytes.equals(bytes));original.bytes.fill(0);}}finally{reader.close();}
    }
  });
}else if(args[0]==='check-app'){
  assert.equal(args.length,2);const config=boundedJSON(args[1]);assert.equal(process.getuid(),config.appUid);
  for(const descriptorPath of Object.values(config.fixtures)){const descriptor=boundedJSON(descriptorPath);for(const dir of [descriptor.ledgerDirectory,descriptor.storage.directory])assert.throws(()=>openSync(join(dir,'app-bypass'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600),error=>['EACCES','EPERM'].includes(error.code));assert.throws(()=>openProofOriginalReader({enabled:true,descriptorPath,encryptionKey:key()}),{code:'PUBLICATION_ROLE_REFUSED'});}
  console.log(JSON.stringify({classification:'UNQUALIFIED_APP_UID_DENIAL_OBSERVATION',cases:CASES.length}));
}else throw new Error('Explicit prepare, run or check-app mode is required.');
