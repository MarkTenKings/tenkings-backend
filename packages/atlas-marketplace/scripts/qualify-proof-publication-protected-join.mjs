// Operator-only isolated Linux PG17→publisher-v4 join. This is not initial
// intake, canonical authentication, decoder qualification or production wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {canonicalJSON,hash,clone} from '../src/contract.mjs';
import {decoderContractData,decoderExact} from '../src/proof-decoder-profile.mjs';
import {createProofDecoderLinuxObserver} from '../src/proof-decoder-linux-observer.mjs';
import {openProofPublicationStore,openProofOriginalReader,migrateProofPublicationLedgerV2,migrateProofPublicationLedgerV3,migrateProofPublicationLedgerV4,openProofPublicationRetentionStore} from '../src/proof-publication-store.mjs';
import {createProofRetentionProtectedPostgresWriter,assertProofRetentionPostgresOutcome,retentionPreparedOperation} from '../src/proof-retention-postgres-writer.mjs';
import {createProofRetentionProtectedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {emptyMarketplaceState} from '../src/store-postgres.mjs';
const BASE='/var/lib/atlas-r2-protected-publisher-join-01',PG_DATA='/var/lib/atlas-r2-pg-publisher-join-01/data',SOCKET='/run/atlas-r2-pg-publisher-join-01';
const CASES=['clean','cancel','lost_after','lost_before','crash'],UID=65530,GID=65530,APP=65534,WORKER=65532;
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const key=()=>Buffer.alloc(32,0x51),sha=b=>createHash('sha256').update(b).digest('hex');
const markers={classification:'UNQUALIFIED',customerPublicationAuthority:false,canonicalAuthorityTested:false,decoderTested:false,syntheticInitialIntake:true};
function bytes(path,uid,max=131072){
 assert.ok(isAbsolute(path)&&resolve(path)===path&&fs.realpathSync(path)===path);
 for(let p=dirname(path);;p=dirname(p)){const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&[0,uid].includes(s.uid)&&(s.mode&0o022)===0);if(p==='/')break;}
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);assert.ok(s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&0o7022)===0&&s.size>0&&s.size<=max);const raw=Buffer.alloc(s.size+1);let n=0;while(n<raw.length){const count=fs.readSync(fd,raw,n,raw.length-n,null);if(!count)break;n+=count;}assert.equal(n,s.size);for(const after of [fs.fstatSync(fd),fs.lstatSync(path)])for(const k of ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'])assert.equal(after[k],s[k]);return raw.subarray(0,n);}finally{fs.closeSync(fd);}
}
function json(path,uid){const raw=bytes(path,uid);try{return decoderContractData(JSON.parse(raw));}finally{raw.fill(0);}}
function save(path,value){const fd=fs.openSync(path,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{const raw=canonicalJSON(value)+'\n';assert.ok(Buffer.byteLength(raw)<=131072);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(dirname(path),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
function emit(value){const line=JSON.stringify({...markers,...value})+'\n';assert.ok(Buffer.byteLength(line)<=16384);process.stdout.write(line);}
function role(){for(const get of ['getuid','geteuid','getgid','getegid'])assert.equal(process[get](),get.includes('gid')?GID:UID);assert.ok(process.getgroups().every(g=>g===GID));}
function paths(name){assert.ok(CASES.includes(name));const base=join(BASE,name);return {base,descriptorPath:join(BASE,name+'.json'),ledger:join(base,'ledger'),objects:join(base,'objects'),evidence:join(base,'evidence')};}
function options(name){return {enabled:true,descriptorPath:paths(name).descriptorPath,encryptionKey:key()};}
function checkpoint(name){return json(join(paths(name).objects,'.atlas-proof-publisher-seal-v1'),UID);}
function migration(name){const s=checkpoint(name);return {...options(name),expectedLedgerId:s.manifest.ledgerId,expectedRevision:s.revision,expectedHeadHash:s.headHash,migrationId:randomUUID()};}
function initialize(name,observer){const v1=openProofPublicationStore(options(name));v1.close();migrateProofPublicationLedgerV2(migration(name));migrateProofPublicationLedgerV3({...migration(name),linuxObserver:observer});migrateProofPublicationLedgerV4({...migration(name),linuxObserver:observer});return openProofPublicationRetentionStore({...options(name),linuxObserver:observer});}
function prepare(){
 assert.equal(process.getuid(),0);assert.equal(process.argv.length,3);assert.equal(fs.realpathSync(dirname(BASE)),dirname(BASE));assert.equal(fs.existsSync(BASE),false);fs.mkdirSync(BASE,{mode:0o755});fs.chmodSync(BASE,0o755);
 const shared={installationId:randomUUID(),qualificationSessionId:randomUUID(),qualificationEvidenceHash:hash('SYNTHETIC_NO_QUALIFICATION'),sourceClosureHash:hash('SYNTHETIC_OPERATOR_SETUP'),policyHash:hash('protected-join-fixture-policy')};
 for(const name of CASES){const p=paths(name);fs.mkdirSync(p.base,{mode:0o700});fs.chownSync(p.base,UID,GID);for(const child of ['ledger','objects','evidence']){fs.mkdirSync(p[child],{mode:0o700});fs.chownSync(p[child],UID,GID);}const descriptor={schema:'atlas-proof-publication-descriptor-v1',publisher:{uid:UID,gid:GID},app:{uid:APP},worker:{uid:WORKER},ledgerDirectory:p.ledger,storage:{directory:p.objects,keyId:'public-fixture-key',storageId:'protected-publisher-join-01',environment:'SYNTHETIC_LOCAL',retentionRef:'synthetic-protected-publisher-join',maxObjectBytes:10485760}};save(p.descriptorPath,descriptor);fs.chmodSync(p.descriptorPath,0o644);}
 save(join(BASE,'setup.json'),{schema:'atlas-proof-protected-join-setup-v1',shared,cases:CASES});fs.chmodSync(join(BASE,'setup.json'),0o644);emit({event:'PREPARED',base:BASE,cases:CASES});
}
function config(path){const c=json(path,0);decoderExact(c,['schema','sourcePath','addonPath','addonSha256','expectedBootId','configuration','admin']);assert.equal(c.schema,'atlas-proof-publication-protected-join-v1');assert.equal(c.sourcePath,path);assert.equal(c.addonPath,'/usr/local/lib/atlas-r2-target-08/proof-decoder-linux-peer.node');assert.equal(c.addonSha256,'e7eed62c5b791660dec2a595dec74a626a3fa8e04c66bcdb6fb535f8ab03ea03');assert.match(c.expectedBootId,/^[a-f0-9-]{36}$/);assert.deepEqual(c.configuration.endpoint,{kind:'LOCAL_UNIX',directory:SOCKET,port:55496});assert.equal(c.configuration.schema,'atlas-proof-retention-protected-connection-v1');assert.equal(c.configuration.database,'atlas_marketplace_review_candidate');assert.equal(c.configuration.role,'atlas_proof_retention_writer');assert.equal(c.configuration.functionOwner,'atlas_marketplace_owner');assert.equal(c.configuration.password,'synthetic-local-unused');decoderExact(c.admin,['role','password']);assert.equal(c.admin.role,'atlas_r2_protected_fixture_owner');assert.equal(c.admin.password,'synthetic-local-unused');return c;}
function seedRecord(name){const r=json(join(paths(name).evidence,'seed.json'),UID);decoderExact(r,['schema','name','binding','row','order','payment','operation','publication','sessionBinding','fence','requestId','envelopeHash']);assert.equal(r.schema,'atlas-proof-protected-join-seed-v1');assert.equal(r.name,name);retentionPreparedOperation(r.operation,r.binding);assert.equal(r.operation.expectedUploadHash,hash(r.row));assert.equal(r.operation.manifestHash,hash(r.row.manifest));assert.equal(r.row.objectKey,hash({binding:r.binding,uploadId:r.row.uploadId}));assert.deepEqual(r.publication.request,{objectKey:r.row.objectKey,manifestHash:hash(r.row.manifest),byteCount:PNG.length,sha256:sha(PNG)});for(const [key,field] of [['publicationLedgerId','ledgerId'],['publicationSessionId','publicationSessionId'],['publicationOperationId','publicationOperationId'],['publicationRevision','publicationRevision'],['publicationEvidenceHash','publicationEvidenceHash']])assert.equal(r.operation[key],r.publication[field]);assert.equal(r.envelopeHash,sha(bytes(join(paths(name).objects,r.row.objectKey+'.proof'),UID)));return r;}
function start(store,binding){const s=store.status();return store.beginSession({operationId:randomUUID(),expectedRevision:s.revision,previousSessionId:s.latestSessionId,previousCloseHash:s.lastCloseHash,binding}).record;}
function stage(store,observer,binding,requestId,fence,operationHash,revision){return {...binding,stageId:randomUUID(),stageRevision:revision,requestId,requestBindingHash:hash({syntheticRequestId:requestId}),actorAccessBindingHash:hash('synthetic-join-access'),operationHash,bootId:store.status().bootId,deadlineBootNs:String(observer.boottimeNanoseconds()+15000000000n),fences:[fence]};}
function publishSeed(name,store,observer,shared){
 const binding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:shared.policyHash,storageHash:hash(store.binding)},sessionBinding={...shared,intakeBindingHash:hash(binding)},session=start(store,sessionBinding),requestId=randomUUID();
 const fence={fenceId:randomUUID(),sourceKind:'POLICY',sourceKeyHash:shared.policyHash,sourceGenerationHash:hash('synthetic-join-generation'),ordinal:1,revision:1},createdAt=Date.now()-1000,uploadId='demo_join_upload_'+name,proofId='demo_join_proof_'+name;
 const order={orderId:'demo_join_order_'+name,cardId:'demo_join_card_'+name,buyerId:'demo_join_buyer',sellerId:'demo_join_seller',bindingHash:hash('synthetic-order-'+name),policyVersion:'synthetic-join-v1',paymentIntentId:'demo_join_payment_'+name},orderBinding=Object.fromEntries(['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion'].map(k=>[k,order[k]]));
 const plan={declaredType:'image/png',byteCount:PNG.length,sha256:sha(PNG)},manifest={schema:'atlas-marketplace-retained-proof-v1',proofId,uploadId,environment:'SYNTHETIC_LOCAL',storageId:store.binding.storageId,retentionRef:store.binding.retentionRef,retainUntil:createdAt+86400000,createdAt,validatedAt:createdAt+1,policyHash:shared.policyHash,orderBinding,actorId:order.buyerId,actorRole:'BUYER',purpose:'RETURN_REQUEST',byteCount:PNG.length,sha256:sha(PNG),validation:{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/png',byteCount:PNG.length,sha256:sha(PNG),width:1,height:1}};
 const row={uploadId,proofId,objectKey:hash({binding,uploadId}),requestHash:hash({requestId}),actorId:order.buyerId,actorRole:'BUYER',orderId:order.orderId,orderBinding,orderHash:hash(orderBinding),purpose:'RETURN_REQUEST',plan,status:'VALIDATED',createdAt,expiresAt:createdAt+900000,retainUntil:manifest.retainUntil,attempts:2,policyHash:shared.policyHash,manifest},publicationId=randomUUID();
 const publication=store.publishOriginal({operationId:publicationId,expectedRevision:store.status().revision,sessionId:session.sessionId,stageBinding:stage(store,observer,sessionBinding,requestId,fence,hash({publicationId,objectKey:row.objectKey}),2),objectKey:row.objectKey,manifest,bytes:PNG});
 const operation={schema:'atlas-proof-retention-operation-v1',operationId:randomUUID(),uploadId,proofId,orderId:order.orderId,orderHash:row.orderHash,actorId:row.actorId,actorRole:row.actorRole,actorAccessBindingHash:hash('synthetic-join-access'),originalRequestHash:row.requestHash,policyHash:binding.policyHash,intakeBindingHash:hash(binding),objectKey:row.objectKey,manifestHash:hash(manifest),originalSha256:sha(PNG),originalByteCount:PNG.length,validationAttemptId:randomUUID(),decoderRequestId:randomUUID(),publicationLedgerId:publication.ledgerId,publicationSessionId:publication.publicationSessionId,publicationOperationId:publication.publicationOperationId,publicationRevision:publication.publicationRevision,publicationEvidenceHash:publication.publicationEvidenceHash,qualificationSessionId:shared.qualificationSessionId,retentionFenceRevision:3,expectedUploadHash:hash(row)};
 const result={schema:'atlas-proof-protected-join-seed-v1',name,binding,row,order,payment:{kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:order.orderId,bindingHash:order.bindingHash},operation,publication,sessionBinding,fence,requestId,envelopeHash:sha(bytes(join(paths(name).objects,row.objectKey+'.proof'),UID))};save(join(paths(name).evidence,'seed.json'),result);return {result,session};
}
function waitSeed(){return new Promise((accept,reject)=>{let at=0,done=false;const expected=Buffer.from('SEEDED\n'),timer=setTimeout(()=>finish(new Error('SYNTHETIC_SETUP_TIMEOUT')),120000);function finish(error){if(done)return;done=true;clearTimeout(timer);process.stdin.off('data',read);process.stdin.off('end',end);process.stdin.off('error',finish);process.stdin.pause();error?reject(error):accept();}function read(chunk){try{assert.ok(at+chunk.length<=expected.length&&chunk.equals(expected.subarray(at,at+chunk.length)));at+=chunk.length;if(at===expected.length)finish();}catch(e){finish(e);}}function end(){finish(new Error('SYNTHETIC_SETUP_EOF'));}process.stdin.on('data',read);process.stdin.once('end',end);process.stdin.once('error',finish);process.stdin.resume();});}
async function runCase(c,name){
 const setup=json(join(BASE,'setup.json'),0);assert.deepEqual(setup.cases,CASES);const observer=createProofDecoderLinuxObserver({enabled:true,addonPath:c.addonPath,addonSha256:c.addonSha256});let store,writer;
 try{
  store=initialize(name,observer);assert.equal(store.status().bootId,c.expectedBootId);const {result:r,session}=publishSeed(name,store,observer,setup.shared);emit({event:'SYNTHETIC_SEED_READY',name,seedPath:join(paths(name).evidence,'seed.json'),seedHash:hash(r),publicationOperationId:r.operation.publicationOperationId});
  await waitSeed();assert.deepEqual(seedRecord(name),r);assert.equal(store.status().externalHoldCount,0);
  writer=createProofRetentionProtectedPostgresWriter({enabled:true,configuration:c.configuration,binding:r.binding,maxOperations:5});const prepared=writer.prepareRetention({operation:r.operation});
  const retentionStage=stage(store,observer,r.sessionBinding,r.requestId,r.fence,hash(r.operation),3),dispatch={operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId,stageBinding:retentionStage,writer,prepared};const recorded=store.beginRetentionDispatch(dispatch);
  assert.deepEqual(store.beginRetentionDispatch(dispatch),recorded);assert.equal(store.status().externalHoldCount,1);assert.throws(()=>store.beginRetentionDispatch({...dispatch,operationId:randomUUID(),expectedRevision:store.status().revision}),{code:'PUBLICATION_PREPARED_ALREADY_BOUND'});
  save(join(paths(name).evidence,'dispatch.json'),{dispatchOperationId:dispatch.operationId,record:recorded.record,deadlineBootNs:retentionStage.deadlineBootNs});
  const require=createRequire(import.meta.url),Client=require(join(c.configuration.driverDirectory,'pg/lib/client.js'));let outcome,injected=0;const original=Client.prototype.query,after=name==='lost_after';
  if(name==='lost_after'||name==='lost_before')Client.prototype.query=function(sql,...args){if(sql==='COMMIT'&&injected===0){injected++;return after?Promise.resolve(original.call(this,sql,...args)).then(()=>{throw new Error('OPERATOR_AFTER_COMMIT_LOSS');}):Promise.reject(new Error('OPERATOR_BEFORE_COMMIT_LOSS'));}return original.call(this,sql,...args);};
  try{outcome=await(name==='cancel'?writer.cancelPrepared(prepared,{barrierId:randomUUID(),barrierRevision:4}):writer.commitPrepared(prepared));}catch(error){outcome=error;}finally{Client.prototype.query=original;}
  const produced=assertProofRetentionPostgresOutcome(outcome,{writer});
  if(name==='crash'){assert.equal(produced.disposition,'COMMITTED');save(join(paths(name).evidence,'committed-before-crash.json'),produced);emit({event:'CRASH_AFTER_ACTUAL_COMMIT',name,operationId:r.operation.operationId,dispatchOperationId:dispatch.operationId});await new Promise((done,error)=>process.stdout.write('',e=>e?error(e):done()));process.kill(process.pid,'SIGKILL');throw new Error('SIGKILL_NOT_DELIVERED');}
  const settle=value=>({operationId:randomUUID(),expectedRevision:store.status().revision,dispatchOperationId:dispatch.operationId,writer,outcome:value});let first=settle(outcome),barrier;
  assert.throws(()=>store.settleRetentionDispatch({...first,outcome:structuredClone(outcome)}));
  const firstResult=store.settleRetentionDispatch(first);assert.deepEqual(store.settleRetentionDispatch(first),firstResult);
  if(name==='lost_after'||name==='lost_before'){
   assert.equal(injected,1);assert.equal(produced.disposition,'UNKNOWN');assert.equal(store.status().externalHoldCount,1);await assert.rejects(writer.commitPrepared(prepared),{code:'RETENTION_COMMIT_CONSUMED'});
   barrier=store.beginScopeBarrier({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId,canonicalMutationId:randomUUID(),barrierId:randomUUID(),barrierRevision:4,scope:r.fence}).record;
   store.beginSessionDrain({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId,reason:'ADMISSION_REVOKED'});assert.equal(store.settleScopeBarrier({operationId:randomUUID(),expectedRevision:store.status().revision,barrierId:barrier.barrierId}).observation,'UNSETTLED_HOLD');
   const lookup=await writer.lookupPrepared(prepared);assert.equal(lookup.disposition,after?'COMMITTED':'ABSENT_HOLD');
   if(!after){assert.equal(store.status().externalHoldCount,1);assert.throws(()=>store.settleRetentionDispatch(settle(lookup)),{code:'PUBLICATION_RETENTION_ALREADY_OBSERVED'});outcome=await writer.cancelPrepared(prepared,{barrierId:randomUUID(),barrierRevision:4});assert.equal(outcome.disposition,'CANCELLED_BEFORE_COMMIT');}else outcome=lookup;
   store.settleRetentionDispatch(settle(outcome));assert.equal(store.status().externalHoldCount,0);store.settleScopeBarrier({operationId:randomUUID(),expectedRevision:store.status().revision,barrierId:barrier.barrierId});
  }else{assert.equal(produced.disposition,name==='clean'?'COMMITTED':'CANCELLED_BEFORE_COMMIT');assert.equal(store.status().externalHoldCount,0);assert.deepEqual(await writer.lookupPrepared(prepared),outcome);store.beginSessionDrain({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId,reason:'SERVICE_STOP'});}
  const history=store.lookupRetentionDispatch({operationId:dispatch.operationId});assert.equal(history.observations.length,barrier?2:1);if(barrier)assert.equal(history.observations[0].outcome.disposition,'UNKNOWN');assert.equal(history.observations.at(-1).kind,'TERMINAL');store.closeSession({operationId:randomUUID(),expectedRevision:store.status().revision,sessionId:session.sessionId});store.close();store=null;
  const reopened=openProofPublicationRetentionStore({...options(name),linuxObserver:observer});try{assert.deepEqual(reopened.lookupRetentionDispatch({operationId:dispatch.operationId}),history);const successor=start(reopened,r.sessionBinding);reopened.beginSessionDrain({operationId:randomUUID(),expectedRevision:reopened.status().revision,sessionId:successor.sessionId,reason:'SERVICE_STOP'});reopened.closeSession({operationId:randomUUID(),expectedRevision:reopened.status().revision,sessionId:successor.sessionId});}finally{reopened.close();}
  assert.equal(sha(bytes(join(paths(name).objects,r.row.objectKey+'.proof'),UID)),r.envelopeHash);const reader=openProofOriginalReader(options(name));try{const original=reader.readOriginal({objectKey:r.row.objectKey,manifestHash:r.operation.manifestHash});assert.ok(original.bytes.equals(PNG));original.bytes.fill(0);}finally{reader.close();}
  save(join(paths(name).evidence,'result.json'),{...markers,name,history,originalEnvelopeUnchanged:true,cleanSuccessor:true,deadlineBootNs:retentionStage.deadlineBootNs});emit({event:'RESULT',name,disposition:history.observations.at(-1).outcome.disposition,observations:history.observations.length,originalEnvelopeUnchanged:true});
 }finally{try{await writer?.close();}finally{try{if(store)try{store.close();}catch{}}finally{try{observer.close();}finally{process.stdin.destroy();}}}}
}

// The admin path is confined to this NEW synthetic fixture. It never acts as a
// runtime producer and never installs schemas, roles, grants or source code.
async function administration(c,mode){
 const seeds=CASES.map(seedRecord),binding=seeds[0].binding;
 assert.equal(new Set(seeds.map(s=>s.operation.operationId)).size,5);
 for(const s of seeds)assert.deepEqual(s.binding,binding);
 // Constructor verifies the source-owned driver inventory and endpoint path;
 // connect() remains the real closure/installed-binding audit after seeding.
 const owner=createProofRetentionProtectedConnectionOwner({enabled:true,configuration:c.configuration,binding,maxOperations:5});
 const require=createRequire(import.meta.url),Client=require(join(c.configuration.driverDirectory,'pg/lib/client.js'));
 const admin=new Client({host:SOCKET,port:55496,database:c.configuration.database,user:c.admin.role,password:()=>c.admin.password,ssl:false,binary:false,replication:false,options:'-c search_path=pg_catalog',client_encoding:'UTF8',application_name:'atlas-r2-protected-publisher-join-v1',fallback_application_name:'atlas-r2-protected-publisher-join-v1',connectionTimeoutMillis:3000,query_timeout:20000,statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:15000});
 admin.connectionParameters.binary=false;admin.connectionParameters.replication=false;admin.binary=false;admin.replication=false;
 let received=0,began=false,commitSent=false,clientError;
 admin.connection.stream.on('data',chunk=>{received+=chunk.length;if(received>8388608)admin.connection.stream.destroy(new Error('OPERATOR_DATABASE_RESPONSE_BOUND'));});
 admin.on('error',error=>{clientError=error;});
 const timer=setTimeout(()=>admin.connection.stream.destroy(new Error('OPERATOR_DATABASE_LIFETIME')),60000);
 try{
  await admin.connect();
  const facts=(await admin.query("SELECT current_user AS role,current_database() AS database,current_setting('server_version_num') AS version,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listen,current_setting('unix_socket_directories') AS sockets,current_setting('port') AS port,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS sync,current_setting('full_page_writes') AS pages")).rows[0];
  assert.deepEqual(facts,{role:c.admin.role,database:c.configuration.database,version:'170011',directory:PG_DATA,listen:'',sockets:SOCKET,port:'55496',fsync:'on',sync:'on',pages:'on'});
  if(mode==='seed'){
   const initial=emptyMarketplaceState();initial.marketplaceProofUploads={};
   for(const r of seeds){
    assert.equal(Object.hasOwn(initial.orders,r.order.orderId),false);assert.equal(Object.hasOwn(initial.intents,r.order.paymentIntentId),false);
    initial.orders[r.order.orderId]=clone(r.order);initial.intents[r.order.paymentIntentId]=clone(r.payment);initial.marketplaceProofUploads[r.row.uploadId]=clone(r.row);
   }
   const initialHash=hash(initial);await admin.query('BEGIN');began=true;
   await admin.query('LOCK TABLE atlas_marketplace.state,atlas_marketplace.commits,atlas_marketplace.events,atlas_marketplace.proof_retention_binding_v1 IN ACCESS EXCLUSIVE MODE');
   const counts=(await admin.query('SELECT (SELECT count(*)::integer FROM atlas_marketplace.state) AS state,(SELECT count(*)::integer FROM atlas_marketplace.commits) AS commits,(SELECT count(*)::integer FROM atlas_marketplace.events) AS events,(SELECT count(*)::integer FROM atlas_marketplace.proof_retention_binding_v1) AS binding')).rows[0];assert.deepEqual(counts,{state:0,commits:0,events:0,binding:0});
   await admin.query("INSERT INTO atlas_marketplace.state VALUES(true,'atlas-marketplace-v2','SYNTHETIC_LOCAL',0,$1::jsonb,$2)",[canonicalJSON(initial),initialHash]);
   await admin.query('INSERT INTO atlas_marketplace.proof_retention_binding_v1 VALUES(true,$1::jsonb,5)',[canonicalJSON(binding)]);
   commitSent=true;await admin.query('COMMIT');began=false;
   const concrete=await owner.connect();try{assert.deepEqual((await concrete.query('SELECT atlas_marketplace.read_retention_binding_v1() AS binding')).rows,[{binding:{schema:'atlas-proof-retention-installed-binding-v1',binding,maxOperations:5}}]);}finally{concrete.release();}
   assert.equal(clientError,undefined);emit({event:'SYNTHETIC_SEEDED',initialStateHash:initialHash,bindingHash:hash(binding),operations:seeds.map(s=>s.operation.operationId),revision:0,closureAudited:true});
  }else{
   const rows=(await admin.query('SELECT revision,state_hash,document FROM atlas_marketplace.state WHERE id')).rows;assert.equal(rows.length,1);const state=rows[0];assert.equal(state.revision,'5');assert.equal(hash(state.document),state.state_hash);
   const d=state.document;assert.equal(d.events.length,5);assert.equal(Object.keys(d.marketplaceProofRetentionOperations).length,5);assert.equal(Object.keys(d.marketplaceProofObjects).length,3);
   const counts=(await admin.query('SELECT (SELECT count(*)::integer FROM atlas_marketplace.commits) AS commits,(SELECT count(*)::integer FROM atlas_marketplace.events) AS events')).rows[0];assert.deepEqual(counts,{commits:5,events:5});
   for(const s of seeds){
    const record=d.marketplaceProofRetentionOperations[s.operation.operationId],committed=['clean','lost_after','crash'].includes(s.name);assert.deepEqual(record.operation,s.operation);assert.equal(record.operationHash,hash(s.operation));assert.equal(record.phase,committed?'COMMITTED':'CANCELLED_BEFORE_COMMIT');
    if(committed){assert.equal(d.marketplaceProofUploads[s.row.uploadId].status,'RETAINED');assert.equal(record.retainedUploadHash,hash(d.marketplaceProofUploads[s.row.uploadId]));assert.equal(record.proofObjectHash,hash(d.marketplaceProofObjects[s.row.proofId]));}
    else{assert.deepEqual(d.marketplaceProofUploads[s.row.uploadId],s.row);assert.equal(Object.hasOwn(d.marketplaceProofObjects,s.row.proofId),false);}
    if(s.name!=='crash'){const result=json(join(paths(s.name).evidence,'result.json'),UID);assert.equal(result.originalEnvelopeUnchanged,true);assert.equal(result.cleanSuccessor,true);assert.equal(result.history.observations.at(-1).outcome.disposition,record.phase);}
   }
   const concrete=await owner.connect();try{assert.deepEqual((await concrete.query('SELECT atlas_marketplace.read_retention_binding_v1() AS binding')).rows,[{binding:{schema:'atlas-proof-retention-installed-binding-v1',binding,maxOperations:5}}]);}finally{concrete.release();}
   const crash=seeds.find(s=>s.name==='crash'),p=paths('crash'),lockPath=join(p.ledger,'writer.lock'),dbPath=join(p.ledger,'publication.sqlite');
   const lockBefore=sha(bytes(lockPath,UID)),dbBefore=sha(bytes(dbPath,UID,16777216)),sealBefore=hash(checkpoint('crash'));
   const db=new DatabaseSync(dbPath,{readOnly:true});try{
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,4);const local=JSON.parse(db.prepare('SELECT state FROM lifecycle_meta WHERE id=1').get().state);assert.equal(local.externalHoldCount,1);
    const dispatches=db.prepare('SELECT record FROM retention_dispatches').all();assert.equal(dispatches.length,1);assert.deepEqual(JSON.parse(dispatches[0].record).identity.prepared.operation,crash.operation);assert.equal(db.prepare('SELECT count(*) AS n FROM retention_settlements').get().n,0);assert.equal(JSON.parse(db.prepare('SELECT record FROM lifecycle_events ORDER BY revision DESC LIMIT 1').get().record).kind,'RETAIN_DISPATCH');
   }finally{db.close();}
   assert.equal(sha(bytes(lockPath,UID)),lockBefore);assert.equal(sha(bytes(dbPath,UID,16777216)),dbBefore);assert.equal(hash(checkpoint('crash')),sealBefore);
   const diagnostic=json(join(p.evidence,'committed-before-crash.json'),UID);assert.equal(diagnostic.disposition,'COMMITTED');assert.deepEqual(diagnostic.operation,crash.operation); // data only, never passed to a verifier or settlement
   for(const s of seeds){const reader=openProofOriginalReader(options(s.name));try{const original=reader.readOriginal({objectKey:s.row.objectKey,manifestHash:s.operation.manifestHash});assert.ok(original.bytes.equals(PNG));original.bytes.fill(0);}finally{reader.close();}}
   assert.equal(clientError,undefined);emit({event:'VERIFIED',revision:5,stateHash:state.state_hash,committed:3,cancelled:2,events:5,crashPublisherHoldPreserved:true,crashLockHash:lockBefore,crashDatabaseHash:dbBefore,originalEnvelopesUnchanged:true,realDatabase:true,realPublisherIO:true,powerLossTested:false});
  }
 }catch(error){if(began&&!commitSent)try{await admin.query('ROLLBACK');}catch{}throw error;}
 finally{clearTimeout(timer);admin.connection.stream.destroy();const endings=await Promise.allSettled([admin.end(),owner.close()]);const failure=endings.find(r=>r.status==='rejected');if(failure)throw failure.reason;}
}

assert.equal(process.versions.node,'22.16.0');assert.equal(process.platform,'linux');
const mode=process.argv[2];
if(mode==='prepare')prepare();
else{
 assert.ok(['seed','verify','case'].includes(mode));assert.equal(process.argv.length,mode==='case'?5:4);role();const c=config(process.argv[3]);
 if(mode==='case'){assert.ok(CASES.includes(process.argv[4]));await runCase(c,process.argv[4]);}
 else await administration(c,mode);
}
