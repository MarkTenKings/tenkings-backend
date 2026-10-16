// Fresh nonce-owned local PostgreSQL only; all provider responses are synthetic.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {disposablePostgres} from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import {validateVariantRuntimeConfiguration} from '../../../frontend/atlas-app/lib/server/variant-runtime-settings.mjs';
import {applyStandaloneBaseline,applyStandaloneMigrations} from '../migrate.mjs';
import {registeredMigrations} from '../registered-migrations.mjs';
import {standaloneRoleSQL} from '../grants.mjs';
import {canonical,digest} from '../../atlas-manual-service/src/contract.mjs';
import {createVariantJobStore,variantJobKey,variantIdentityHash,VARIANT_POLICY} from '../../atlas-connected-manual/src/variant-job-store.mjs';
import {createVariantWorker} from '../../atlas-connected-manual/src/variant-worker.mjs';
import {variantWorkerRoleSQL,variantWorkerGrantSQL} from '../../atlas-connected-manual/src/variant-worker-grants.mjs';
import {createVariantPhotoProvider,prepareVariantLabelRequest} from '../../atlas-connected-manual/src/variant-photo-provider.mjs';
import {codexImageReservationKey,codexReadingKey} from '../../atlas-connected-manual/src/variant-codex.mjs';
import {labelCatalog,labelPhoto,labelResponse} from '../../atlas-connected-manual/test/variant-label-fixture.mjs';
import {variantSnapshotHash} from '../../card-catalog-evidence/src/variant-review.mjs';
import {createVariantAdmission} from '../../atlas-connected-manual/src/variant-admission.mjs';
const args=process.argv.slice(2),out=process.env.ATLAS_SHARED_RETRY_EVIDENCE;
assert(out&&resolve(out)===out);await mkdir(out,{recursive:true,mode:0o700});
const {Client}=createRequire(import.meta.url)(args[args.indexOf('--pg-module')+1]);
const cluster=await disposablePostgres(args),clients=[],checks=[];let receipt;
const connect=async(role=null,password=null)=>{const u=new URL(cluster.url('atlas_shared_retry'));if(role){u.username=role;u.password=password;}const c=new Client({connectionString:u.href});await c.connect();clients.push(c);return c;};
const txFor=c=>({$queryRawUnsafe:async(q,...v)=>(await c.query(q,v)).rows,$executeRawUnsafe:async(q,...v)=>(await c.query(q,v)).rowCount});
try {
 await cluster.sql('CREATE DATABASE atlas_shared_retry');const admin=await connect();await applyStandaloneBaseline(admin);
 const migrations=await registeredMigrations(),migration=migrations.at(-1);assert.equal(migration.version,'atlas-standalone-006-variant-shared-label-retry');
 for(const m of migrations.slice(0,-1)){await admin.query(m.sql);await admin.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)',[m.version,m.sqlSha256]);}
 const roles={staff:'atlas_shared_staff',manual:'atlas_shared_main',variant:'atlas_shared_worker',customer:'atlas_shared_customer',customerPrivate:'atlas_shared_private'};
 await admin.query(standaloneRoleSQL(roles));const peerRole='atlas_shared_worker_peer';await admin.query(variantWorkerRoleSQL(peerRole));await admin.query(variantWorkerGrantSQL(peerRole));const password=randomBytes(24).toString('hex');
 for(const role of [roles.manual,roles.variant,peerRole])await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
 const main=await connect(roles.manual,password),workerPeer=await connect(peerRole,password),worker=await connect(roles.variant,password);
 await assert.rejects(validateVariantRuntimeConfiguration({enabled:true,client:txFor(main)}),{code:'VARIANT_QUEUE_SCHEMA_REQUIRED'});
 const actor=randomUUID(),other=randomUUID();for(const id of [actor,other])await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')',[id,digest(id)]);
 const principal={id:actor,role:'REVIEWER',mode:'LOCAL_FIXTURE'};
 const transaction=c=>async(_,fn)=>{await c.query('BEGIN');try{const result=await fn({tx:txFor(c),principal});await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}};
 const storeFor=c=>createVariantJobStore({boundary:{machineTransaction:transaction(c),transaction:transaction(main)}});
 const store=storeFor(worker),competing=storeFor(workerPeer),media=new Map();let photoId=1000,sends=0;
 const provider=createVariantPhotoProvider({apiKey:'synthetic-only-not-a-key',readReferenceImage:async({snapshot,imageId})=>media.get(snapshot.referencePhotos.find(p=>p.imageId===imageId).sha256),fetchImpl:async(_url,options)=>{
  sends++;const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning.effort,'xhigh');
  const content=body.input[1].content,choices=JSON.parse(content[0].text).choices,photos=content.filter(p=>p.type==='input_text'&&p.text.startsWith('Sold reference')).map(p=>({sha256:p.text.match(/[a-f0-9]{64}/)[0]}));
  return Response.json(labelResponse({photos,choices}));
 }});
 const put=async(key,value)=>{const text=canonical(value,{maxBytes:8388608});await admin.query("INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at) VALUES($1,$2,$3,'2000-01-01')",[key,text,digest(text)]);};
 const jobRow=async key=>(await admin.query('SELECT * FROM atlas_manual_connected.variant_job WHERE key=$1',[key])).rows[0];
 const job=async x=>({...await jobRow(x.key),input:x.input,catalog:x.catalog});
 async function seed({photos=8,shared=null,state='FAILED',response='credit',extraChoices=0,reserve=true}={}){
  const card=randomUUID(),sourceHash=digest(card),identity={cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:null},identityHash=variantIdentityHash(identity),generation=randomUUID(),claim=randomUUID(),createId=randomUUID();
  const draft={source:{sourceHash},identityRevision:1,identity},content=canonical(draft),input={cardId:card,sourceHash,identityRevision:1,identityHash,generation,identity:{category:'POKEMON',name:'Magikarp',year:'2020',setName:'Rebel Clash',cardNumber:'039/192',manufacturer:null}},key=variantJobKey(input);
  await admin.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,\'Synthetic shared retry\')',[card,randomUUID(),actor,createId,digest(createId)]);
  await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)',[card,content,digest(content),actor]);
  await admin.query('INSERT INTO atlas_manual_connected.variant_job(key,card_id,actor_id,access_version,policy,generation,source_hash,identity_revision,identity_hash,input,input_hash,created_at) VALUES($1,$2,$3,1,$4,$5,$6,1,$7,$8,$9,clock_timestamp()-interval \'2 minutes\')',[key,card,actor,VARIANT_POLICY,generation,sourceHash,identityHash,canonical(input),digest(canonical(input))]);
  const catalog=structuredClone(labelCatalog({count:1+extraChoices,photos:0,candidateTransform:c=>{c.canonical.cardId='shared-'+card;c.source.recordId='shared-'+card;}}));
  catalog.referencePhotos=shared?shared.catalog.referencePhotos.slice(0,photos):Array.from({length:photos},()=>{const p=labelPhoto(photoId++);media.set(p.image.sha256,p.media);return p.image;});catalog.snapshotHash=variantSnapshotHash(catalog);
  await admin.query("UPDATE atlas_manual_connected.variant_job SET state='RUNNING',attempts=1,claim_id=$2,lease_until=clock_timestamp()+interval '3 minutes',catalog=$3,catalog_hash=$4 WHERE key=$1",[key,claim,canonical(catalog,{maxBytes:4194304}),catalog.snapshotHash]);
  const request=prepareVariantLabelRequest(catalog),prepared=shared?{evidence:shared.reservation.evidence}:await provider.prepare({catalog,photoShas:request.photos.map(p=>p.sha256)}),reservation={schemaVersion:'variant-label-dispatch/v1',request,evidence:prepared.evidence,catalog,jobKey:key,claimId:claim,reservedAt:new Date().toISOString()};
  const reply={version:prepared.evidence.policy,requestEvidence:prepared.evidence,httpStatus:response==='credit'?429:200,bodyText:JSON.stringify(response==='credit'?{error:{code:'credit_balance_exhausted'}}:labelResponse(request)),requestId:'fixture'};
  const saved={...reply,schemaVersion:'variant-label-response/v1',reservationHash:digest(canonical(reservation))};
  if(!shared&&reserve){await put('variant-label-dispatch:v1:'+request.requestKey,reservation);for(const p of request.photos)await put(codexImageReservationKey(request,p.sha256),{schemaVersion:'atlas-codex-reservation/v1',requestKey:request.requestKey});if(response!=='unknown')await put('variant-label-response:v1:'+request.requestKey,saved);}
  if(state==='FAILED')await admin.query("UPDATE atlas_manual_connected.variant_job SET state='FAILED',claim_id=NULL,lease_until=NULL,code='VARIANT_OPENAI_CREDITS_EXHAUSTED' WHERE key=$1",[key]);
  return {card,key,input,catalog,request,reservation,reply,saved,createId,args:[actor,randomUUID(),card,key,sourceHash,1,identityHash,catalog.snapshotHash,(shared??{request}).request.requestKey,digest(canonical(shared?.saved??saved,{maxBytes:8388608}))]};
 }
 const source=await seed(),current=await seed({photos:1,shared:source,extraChoices:1});
 const before=(await admin.query('SELECT * FROM atlas_manual_connected.variant_catalog_cache ORDER BY key,snapshot_hash')).rows,ledgerBefore=(await admin.query('SELECT * FROM atlas_staff._standalone_migrations ORDER BY version')).rows;
 const cardsBefore=(await admin.query('SELECT * FROM atlas_manual.card ORDER BY id')).rows,jobsBefore=(await admin.query('SELECT * FROM atlas_manual_connected.variant_job ORDER BY key')).rows;
 const applied=await applyStandaloneMigrations(admin);assert.deepEqual(applied.applied,[{version:migration.version,checksum:migration.sqlSha256}]);assert.equal((await applyStandaloneMigrations(admin)).status,'NO_OP');
 assert.deepEqual((await admin.query('SELECT * FROM atlas_manual_connected.variant_catalog_cache ORDER BY key,snapshot_hash')).rows,before);assert.deepEqual((await admin.query('SELECT * FROM atlas_manual.card ORDER BY id')).rows,cardsBefore);assert.deepEqual((await admin.query('SELECT * FROM atlas_manual_connected.variant_job ORDER BY key')).rows,jobsBefore);
 assert.deepEqual((await admin.query('SELECT * FROM atlas_staff._standalone_migrations WHERE version<>$1 ORDER BY version',[migration.version])).rows,ledgerBefore);
 for(const [c,isWorker]of [[main,false],[worker,true]])await validateVariantRuntimeConfiguration({enabled:true,client:txFor(c),worker:isWorker});
 checks.push('005→006 changes one existing function and one ledger row; all card/job/reference bytes preserved; repeat no-op;005 startup rejected and006 main/worker admitted');
 const signature='atlas_manual_connected.retry_variant_labels(uuid,uuid,uuid,text,text,integer,text,text,text,text)';
 const call=(c,a)=>c.query('SELECT atlas_manual_connected.retry_variant_labels($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) receipt',a);
 await assert.rejects(call(worker,current.args),/permission denied/);await assert.rejects(call(main,[other,...current.args.slice(1)]),/ACCESS_DENIED/);
 await assert.rejects(call(main,current.args.map((v,i)=>i===9?'0'.repeat(64):v)),/EVIDENCE_INVALID/);
 const foreign=await seed();await assert.rejects(call(main,current.args.map((v,i)=>i===8?foreign.request.requestKey:i===9?digest(canonical(foreign.saved)):v)),/EVIDENCE_INVALID/);
 const discard=async x=>{const id=randomUUID();await admin.query('INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1,$2,\'{}\',$3,\'{}\',$3)',[actor,id,digest('{}')]);await admin.query('INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1,$2,$3,$4)',[actor,x.createId,x.card,id]);};
 await discard(source);const projected=await store.read({},current.card);assert.equal(projected.labelFailure.retryable,true);assert.equal(projected.labelFailure.labelRequestKey,source.request.requestKey);
 const original=await jobRow(source.key),retry=(await call(main,current.args)).rows[0].receipt;
 assert.deepEqual((await call(main,current.args)).rows[0].receipt,retry);
 const runWorker=async()=>{await createVariantWorker({store:{...store,discover:async()=>{}},catalog:{prepare:()=>assert.fail('saved reference work must not reacquire catalog/listings')},provider}).drainOnce();};
 await runWorker();assert.equal(sends,1);assert.equal((await jobRow(current.key)).state,'READY');assert.deepEqual(await jobRow(source.key),original);
 const currentResult=JSON.parse((await jobRow(current.key)).result);assert.equal(currentResult.referenceLabels.readings.length,1);assert.equal(currentResult.catalog.snapshotHash,current.catalog.snapshotHash);
 for(const photo of source.request.photos){const reading=(await admin.query('SELECT snapshot::jsonb value FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1',[codexReadingKey(source.request,photo.sha256)])).rows[0].value;assert.equal(reading.requestKey,retry.attemptKey);assert.equal(reading.responseHash,digest(JSON.parse((await admin.query('SELECT snapshot FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1',['variant-label-response:v1:'+retry.attemptKey])).rows[0].snapshot).bodyText));}
 for(const r of before)assert.deepEqual((await admin.query('SELECT * FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 AND snapshot_hash=$2',[r.key,r.snapshot_hash])).rows,[r]);
 checks.push('living partial-overlap copy explicitly retries original eight-photo request after original owner discard; one synthetic Astra/xhigh call; exact old evidence/source unchanged; every reading cites retry response');
 const abandoned=await seed(),authorized=(await call(main,abandoned.args)).rows[0].receipt;await discard(abandoned);
 const adopted=await seed({photos:2,shared:abandoned,state:'RUNNING'}),adoptJob=await job(adopted);
 const resumable=await store.labelSource(adoptJob,adopted.request);assert.equal(resumable.state,'RESUME');
 const prepared=await provider.prepare({catalog:resumable.catalog,photoShas:resumable.request.photos.map(p=>p.sha256),request:resumable.request});
 const reserved=await store.labelSource(adoptJob,resumable.request,prepared.evidence);assert.equal(reserved.state,'RESERVED');assert.equal(reserved.attemptKey,authorized.attemptKey);
 assert.equal((await store.labelSource(adoptJob,resumable.request,prepared.evidence)).state,'PENDING');
 await admin.query("UPDATE atlas_manual_connected.variant_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",[adopted.key]);
 const later=await seed({photos:2,shared:abandoned,state:'RUNNING'});assert.equal((await store.labelSource(await job(later),later.request)).state,'UNKNOWN');
 checks.push('abandoned undispatched authorization consumed once by living copy; subsequent lost owner becomes UNKNOWN without replay');
 const unknown=await seed({photos:1,response:'unknown'}),mixed=await seed({photos:1,shared:unknown,state:'RUNNING'});
 const clean=Array.from({length:17},()=>{const p=labelPhoto(photoId++);media.set(p.image.sha256,p.media);return p.image;});
 // New immutable saved catalog with one overlapping uncertain photo + clean siblings.
 const mixedCatalog={...mixed.catalog,referencePhotos:[...mixed.catalog.referencePhotos,...clean]};mixedCatalog.snapshotHash=variantSnapshotHash(mixedCatalog);
 // Seed another current job with the desired complete catalog from its initial save.
 const mixed2=await seed({photos:18,shared:{...unknown,catalog:mixedCatalog},state:'RUNNING'});
 let claimed=false;await createVariantWorker({store:{...store,discover:async()=>{},claim:async()=>claimed?null:(claimed=true,await job(mixed2))},catalog:{},provider}).drainOnce();
 const partial=JSON.parse((await jobRow(mixed2.key)).result);assert.equal(partial.referenceLabels.readings.length,17);assert.equal(partial.labelProcessing.unread,1);assert.equal(sends,4);
 checks.push('one abandoned unknown SHA cannot suppress seventeen clean siblings across changed eight-photo batches; partial READY preserves exact unknown and zero replay');
 // Exact shared cache progress is permitted even when every admission returns false.
 const cached=await seed({photos:1,shared:source,state:'RUNNING'});claimed=false;
 await createVariantWorker({store:{...store,discover:async()=>{},claim:async()=>claimed?null:(claimed=true,await job(cached))},catalog:{},provider,admitDispatch:()=>assert.fail('cache-only progress must not request paid admission')}).drainOnce();assert.equal((await jobRow(cached.key)).state,'READY');assert.equal(sends,4);
 checks.push('saved shared reference completes under continuous busy admission without new provider work');
 // Two copies with overlapping batches race on actual shared journal locks.
 const simultaneous=await seed({photos:8,state:'RUNNING',reserve:false}),second=await seed({photos:8,state:'RUNNING',shared:simultaneous});
 const firstJob=await job(simultaneous),secondJob=await job(second),firstPrepared=await provider.prepare({catalog:simultaneous.catalog}),secondPrepared=await provider.prepare({catalog:second.catalog});
 const competingReservations=await Promise.all([store.labelSource(firstJob,simultaneous.request,firstPrepared.evidence),competing.labelSource(secondJob,second.request,secondPrepared.evidence)]);
 assert.deepEqual(competingReservations.map(r=>r.state).sort(),['PENDING','RESERVED']);
 const winner=competingReservations.findIndex(r=>r.state==='RESERVED'),winnerJob=[firstJob,secondJob][winner],winnerRequest=[simultaneous.request,second.request][winner],loserJob=[firstJob,secondJob][1-winner];
 const winning=competingReservations[winner],reply=await provider({prepared:[firstPrepared,secondPrepared][winner]});await store.saveLabelSource(winning.reservation,reply);
 await admin.query("UPDATE atlas_manual_connected.variant_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",[winnerJob.key]);
 await assert.rejects(store.publishLabelSource(winnerJob,winnerRequest),{code:'VARIANT_LEASE_LOST'});
 const recovered=await store.labelSource(loserJob,[simultaneous.request,second.request][1-winner]);assert.equal(recovered.state,'RECOVER');
 await store.publishLabelSource(loserJob,recovered.request,{attemptKey:recovered.attemptKey});assert.equal((await store.codexReadings(loserJob)).readings.length,8);assert.equal(sends,5);
 checks.push('simultaneous copies reserve one shared paid batch; lost owner lease blocks its projection while exact saved response projects for living copy without redispatch');
 // Busy gating uses actual PostgreSQL locks and indexed window records across processes.
 const fair=await seed({photos:1,state:'RUNNING'}),identificationId=randomUUID();await admin.query("INSERT INTO atlas_manual_connected.identification(id,card_id,source_hash,actor_id,state,input) VALUES($1,$2,$3,$4,'RUNNING','{}')",[identificationId,fair.card,fair.input.sourceHash,actor]);
 const admissionA=createVariantAdmission({boundary:{machineTransaction:transaction(worker)}}),admissionB=createVariantAdmission({boundary:{machineTransaction:transaction(workerPeer)}}),fairJob=await job(fair),permit={jobKey:fair.key,claimId:fairJob.claim_id};
 assert.equal(await admissionA(),false);const permissions=await Promise.all([admissionA(permit),admissionB(permit)]);assert.equal(permissions.filter(Boolean).length,1);
 for(let n=0;n<5;n++)assert.equal(await createVariantAdmission({boundary:{machineTransaction:transaction(workerPeer)}})(permit),false);
 const admissionRows=(await admin.query("SELECT count(*)::int n FROM atlas_manual_connected.variant_catalog_cache WHERE key LIKE 'variant-dispatch-admission:v1:%'")).rows[0].n;assert.equal(admissionRows,1);
 checks.push('continuous busy load admits exactly one bounded fair permission across two concurrent processes and restart-equivalent observers; refused polls append zero records');
 await admin.query('ALTER TABLE atlas_manual_connected.variant_catalog_cache DISABLE TRIGGER variant_label_retry_journal');await assert.rejects(validateVariantRuntimeConfiguration({enabled:true,client:txFor(main)}),{code:'VARIANT_QUEUE_SCHEMA_REQUIRED'});await admin.query('ALTER TABLE atlas_manual_connected.variant_catalog_cache ENABLE TRIGGER variant_label_retry_journal');
 const definition=(await admin.query('SELECT pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
 await admin.query(definition.replace("BEGIN\n", "BEGIN\n -- incompatible runtime mutation\n"));await assert.rejects(validateVariantRuntimeConfiguration({enabled:true,client:txFor(main)}),{code:'VARIANT_QUEUE_SCHEMA_REQUIRED'});await admin.query(definition);
 checks.push('startup refuses disabled retry journal guard and changed006 procedure body');
 receipt={status:'VARIANT_SHARED_RETRY_POSTGRES_PASS',migration,checks,groups:checks.length,syntheticProviderCalls:sends,externalProviderCalls:0,productionQueries:0,directory:cluster.directory};delete receipt.migration.sql;
}finally{await Promise.all(clients.map(c=>c.end()));await cluster.stop();}
receipt.cleanup=JSON.parse(await readFile(cluster.directory+'/cleanup.json','utf8'));assert.equal(receipt.cleanup.stoppedVerified,true);
await writeFile(out+'/postgres-result.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
