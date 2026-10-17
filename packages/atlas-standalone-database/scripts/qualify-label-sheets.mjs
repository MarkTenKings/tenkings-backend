// Finite nonce-owned PostgreSQL fixture only. Never connects to serving data.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { registeredMigrations } from '../registered-migrations.mjs';
import { validateLabelRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
import { createLabelRepository, labelFailureHash } from '../../atlas-connected-manual/src/label-sheet-repository.mjs';

const args = process.argv.slice(2), output = process.env.ATLAS_LABEL_EVIDENCE;
assert(output && resolve(output) === output); await mkdir(output, { recursive:true,mode:0o700 });
const { Pool, Client } = createRequire(import.meta.url)(args[args.indexOf('--pg-module')+1]);
const cluster = await disposablePostgres(args), checks = []; let pool, admin;
try {
  await cluster.sql('CREATE DATABASE atlas_labels'); admin = new Client({ connectionString:cluster.url('atlas_labels') }); await admin.connect();
  assert.equal((await applyStandaloneBaseline(admin)).status,'APPLIED');
  const before = (await admin.query('SELECT * FROM atlas_staff._standalone_migrations')).rows;
  const migrations=await registeredMigrations(),retryMigration=migrations.at(-1);assert.equal(retryMigration.version,'atlas-standalone-007-label-layout-retry');
  for(const migration of migrations.slice(0,-1)){await admin.query(migration.sql);await admin.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)',[migration.version,migration.sqlSha256]);}
  assert.equal((await applyStandaloneBaseline(admin)).status,'NO_OP');
  assert.deepEqual((await admin.query('SELECT * FROM atlas_staff._standalone_migrations WHERE version=$1',[before[0].version])).rows,before);
  checks.push('registered baseline→006 fixture; baseline no-op and receipt unchanged');
  const roles={staff:'atlas_labels_staff',manual:'atlas_labels_main',variant:'atlas_labels_variant',customer:'atlas_labels_customer',customerPrivate:'atlas_labels_private'};
  await admin.query(standaloneRoleSQL(roles)); const password=randomBytes(24).toString('hex'); await admin.query(`ALTER ROLE ${roles.manual} LOGIN PASSWORD '${password}'`);
  const url = new URL(cluster.url('atlas_labels')); url.username=roles.manual; url.password=password; pool=new Pool({connectionString:url.href,max:6});
  for (const role of Object.values(roles)) for (const table of ['label_item','label_sheet','label_export','label_print_event']) {
    const row=(await admin.query("SELECT has_table_privilege($1,$2,'SELECT') allowed,has_table_privilege($1,$2,'DELETE') deletion,has_table_privilege($1,$2,'TRUNCATE') truncation",[role,`atlas_manual_connected.${table}`])).rows[0];
    assert.equal(row.allowed,role===roles.manual); assert.equal(row.deletion,false); assert.equal(row.truncation,false);
  }
  checks.push('main-only label privileges; no variant/customer/staff read and no runtime DELETE/TRUNCATE');
  const actor=randomUUID(),other=randomUUID();
  for (const id of [actor,other]) await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')',[id,digest(id)]);
  const staff={id:actor,role:'REVIEWER',mode:'PRODUCTION',accessVersion:1}, foreign={...staff,id:other}, observer={...staff,role:'OBSERVER'};
  const txFor=client=>({$queryRawUnsafe:async(sql,...values)=>(await client.query(sql,values)).rows,$executeRawUnsafe:async(sql,...values)=>(await client.query(sql,values)).rowCount});
  const boundary={async transaction(principal,work){ const client=await pool.connect(); try {await client.query('BEGIN'); const value=await work({tx:txFor(client),principal,refresh:async()=>({principal})}); await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}},machineTransaction(_staff,work){return this.transaction(staff,work);}};
  const repo=createLabelRepository({boundary});
  async function seed({mode='PRODUCTION',state='PUBLISHED',cardId=randomUUID(),version=1,owner=actor}={}) {
    const actionId=randomUUID(),text='{}',h=digest(text);
    if(version===1) await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1,1,$2,$3,$4,$5)',[cardId,text,h,owner,owner===actor?[]:[actor]]);
    await admin.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,$6,$7,$4,$5,$5)',[cardId,actionId,owner,h,text,version*2-1,version*2]);
    await admin.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,$6,$4,$4,$5)',[cardId,actionId,owner,h,text,version*2-1]);
    if(version===1) await admin.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)',[cardId,`ar_${randomBytes(18).toString('base64url')}`,`ATLAS-${randomBytes(6).toString('hex').toUpperCase()}`]);
    await admin.query('INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,$3,$4)',[cardId,actionId,version,mode]);
    if(state==='PUBLISHED') await admin.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$3,manifest_hash=$4,public_hash=$4,published_at=clock_timestamp() WHERE card_id=$1 AND action_id=$2",[cardId,actionId,text,h]);
    const row=(await admin.query('SELECT p.*,a.source_revision,a.source_hash,a.report_hash FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id) WHERE p.card_id=$1 AND p.action_id=$2',[cardId,actionId])).rows[0];
    return {cardId,actionId,row};
  }
  const enqueue=f=>boundary.transaction(staff,ctx=>repo.publicationCommitted({...ctx,cardId:f.cardId,actionId:f.actionId}));
  const printSvg='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',artworkHash=digest(printSvg);
  const render=async f=>{const [row]=(await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE card_id=$1 AND action_id=$2 AND purpose=\'ORIGINAL\'',[f.cardId,f.actionId])).rows;
    const claim=await repo.claimItem(staff,row.id);return repo.finishItem(staff,claim,{row:f.row,state:'READY',snapshot:{identity:{playerName:'Fixture'},grade:9.5,reportNumber:'ATLAS-FIXTURE',approvalVersion:f.row.version},printSvg,previewSvg:printSvg,artworkHash,rendererProfileHash:digest('renderer'),materialProfileId:'atlas-v4-gold-v1',jigHash:digest('jig')});};
  const first=await seed({owner:other}); const race=await Promise.all([enqueue(first),enqueue(first)]);assert.equal(race.filter(Boolean).length,1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM atlas_manual_connected.label_item')).rows[0].n,1);
  const waiting=await seed({state:'PENDING'}),local=await seed({mode:'LOCAL_FIXTURE'});
  await assert.rejects(enqueue(waiting),{code:'LABEL_PUBLISHED_PRODUCTION_REQUIRED'});await assert.rejects(enqueue(local),{code:'LABEL_PUBLISHED_PRODUCTION_REQUIRED'});
  assert.equal(await boundary.transaction({...staff,mode:'LOCAL_FIXTURE'},ctx=>repo.publicationCommitted({...ctx,cardId:local.cardId,actionId:local.actionId})),null);
  checks.push('duplicate concurrent publication creates one pending item; PENDING and LOCAL_FIXTURE cannot allocate');
  const values=[first];for(let i=1;i<51;i++){const f=await seed();values.push(f);await enqueue(f);}
  const all=[];for(let i=0;i<48;i++)all.push(await render(values[i]));
  all.push(...await Promise.all(values.slice(48).map(render)));
  const sheets=(await repo.list(staff)).sheets;assert.equal(sheets.length,2);assert.deepEqual(sheets.map(s=>s.occupied).sort((a,b)=>a-b),[1,50]);
  const full=sheets.find(s=>s.occupied===50),partial=sheets.find(s=>s.occupied===1);assert.equal(full.state,'SEALED');assert.equal(partial.state,'OPEN');
  const detail=await repo.sheet(staff,full.sheetId);assert.deepEqual(detail.items.map(i=>i.slot),Array.from({length:50},(_,i)=>i+1));
  assert.equal(new Set(all.map(i=>`${i.sheetId}:${i.slot}`)).size,51);assert.equal(await repo.claimItem(staff,all[0].itemId),null);
  checks.push('real transactions race slots49/50/51, seal50 atomically and roll over without duplicate placement');
  await assert.rejects(repo.sheet(foreign,full.sheetId),{code:'LABEL_SHEET_NOT_FOUND'});await assert.rejects(repo.sheet(observer,full.sheetId),{code:'LABEL_ACCESS_DENIED'});
  await admin.query('UPDATE atlas_manual.card SET approvers=$2,revision=revision+1 WHERE id=$1',[detail.items[0].cardId,[]]);
  await assert.rejects(repo.sheet(staff,full.sheetId),{code:'MANUAL_CARD_NOT_FOUND'});
  assert(!(await repo.list(staff)).sheets.some(s=>s.sheetId===full.sheetId));
  await admin.query('UPDATE atlas_manual.card SET approvers=$2,revision=revision+1 WHERE id=$1',[detail.items[0].cardId,[actor]]);
  checks.push('cross-scope/observer refusal and all-member reauthorization hide an entire revoked sheet');
  const exportInput={requestId:randomUUID(),expectedSheetRevision:partial.revision,exportProfileId:'atlas-v4-sheet-800ppi-diagnostic-v2'};
  const request={kind:'SHEET',id:partial.sheetId,input:exportInput};const exportRace=await Promise.all([repo.prepareExport(staff,request),repo.prepareExport(staff,request)]);assert.deepEqual(exportRace[0],exportRace[1]);
  assert.equal((await repo.sheet(staff,partial.sheetId)).state,'SEALED');
  await assert.rejects(repo.prepareExport(staff,{...request,input:{...exportInput,expectedSheetRevision:999}}),{code:'LABEL_REQUEST_CONFLICT'});
  const claim=await repo.claimExport(staff,exportRace[0].exportId);assert(claim);assert.equal(await repo.claimExport(staff,claim.row.id),null);
  const saved=await repo.finishExport(staff,claim,{object:{key:'fixture/immutable',versionId:null,etag:'fixture'},sha256:digest('png'),byteCount:100,mapping:{canvasWidthMm:310,canvasHeightMm:400,cropXmm:0,cropYmm:0}});
  assert.equal(saved.state,'READY');assert.deepEqual(await repo.prepareExport(staff,request),saved);
  checks.push('concurrent partial seal/export freezes one immutable snapshot; replay survives lost reply and changed intent conflicts');
  const singleInput={requestId:randomUUID(),expectedLabelHash:all[0].labelHash,exportProfileId:'atlas-v4-individual-2400ppi-v1'};
  const singleRequest={kind:'SINGLE',id:all[0].itemId,input:singleInput};const single=await repo.prepareExport(staff,singleRequest);
  for(let i=0;i<3;i++){const attempt=await repo.claimExport(staff,single.exportId);assert(attempt);await repo.failExport(staff,attempt);}
  const failed=(await repo.export(staff,single.exportId)).row;assert.equal(failed.state,'FAILED');assert.equal(failed.attempts,3);
  assert.equal((await repo.prepareExport(staff,singleRequest)).state,'FAILED');
  await assert.rejects(admin.query("UPDATE atlas_manual_connected.label_export SET state='PREPARING' WHERE id=$1",[single.exportId]),/retry intent invalid/);
  const retryInput={...singleInput,requestId:randomUUID()};const retryRequest={...singleRequest,input:retryInput};
  const resumed=await repo.prepareExport(staff,retryRequest);assert.equal(resumed.exportId,single.exportId);assert.equal(resumed.retryCount,1);
  assert.deepEqual(await repo.prepareExport(staff,retryRequest),resumed);
  await assert.rejects(repo.prepareExport(staff,{...retryRequest,input:{...retryInput,expectedLabelHash:digest('wrong')}}),{code:'LABEL_REQUEST_CONFLICT'});
  const retried=(await repo.export(staff,single.exportId)).row;assert.equal(retried.manifest,failed.manifest);assert.equal(retried.manifest_hash,failed.manifest_hash);assert.equal(retried.attempt_base,3);
  await repo.finishExport(staff,await repo.claimExport(staff,single.exportId),{object:{key:'fixture/single',versionId:null,etag:'fixture'},sha256:digest('single png'),byteCount:99,mapping:{canvasWidthMm:68.342,canvasHeightMm:20.082}});
  checks.push('three failed render attempts stop; explicit new retry intent resumes exact immutable export, replay never starts another attempt');
  const confirmation={requestId:randomUUID(),exportId:saved.exportId,exportSha256:saved.sha256,manifestHash:saved.manifestHash,successfulSlots:[1],failedSlots:[]};
  const printed=await repo.confirmPrint(staff,confirmation);assert.deepEqual(await repo.confirmPrint(staff,confirmation),printed);
  await assert.rejects(repo.confirmPrint(staff,{...confirmation,successfulSlots:[2]}),{code:'LABEL_REQUEST_CONFLICT'});
  await assert.rejects(repo.confirmPrint(staff,{...confirmation,requestId:randomUUID(),successfulSlots:[2]}),{code:'LABEL_PRINT_SLOTS_INVALID'});
  for(const sql of ["UPDATE atlas_manual_connected.label_export SET sha256='"+digest('changed')+"' WHERE id='"+saved.exportId+"'",'DELETE FROM atlas_manual_connected.label_export', 'TRUNCATE atlas_manual_connected.label_export CASCADE',
    'UPDATE atlas_manual_connected.label_print_event SET successful_slots=ARRAY[2]', 'DELETE FROM atlas_manual_connected.label_print_event', 'TRUNCATE atlas_manual_connected.label_print_event']) await assert.rejects(admin.query(sql),/immutable/);
  checks.push('printing requires explicit exact successful slots; event replay is idempotent and issued artifacts/history reject UPDATE DELETE TRUNCATE');
  const original=all[0],reprintInput={requestId:randomUUID(),expectedLabelHash:original.labelHash,reason:'Damaged stock'};
  const duplicate=await repo.reprint(staff,original.itemId,reprintInput);assert.equal(duplicate.purpose,'REPRINT');assert.deepEqual(await repo.reprint(staff,original.itemId,reprintInput),duplicate);
  assert.equal(duplicate.originalItemId,original.itemId);await assert.rejects(repo.reprint(staff,original.itemId,{...reprintInput,reason:'changed reason'}),{code:'LABEL_REQUEST_CONFLICT'});
  const openItem=await seed();await enqueue(openItem);const readyOpen=await render(openItem);const oldSheet=await repo.sheet(staff,readyOpen.sheetId);
  const newer=await seed({cardId:openItem.cardId,version:2});await enqueue(newer);
  const retired=(await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE id=$1',[readyOpen.itemId])).rows[0];
  assert.equal(retired.state,'SUPERSEDED');assert.equal(retired.sheet_id,null);assert.deepEqual(retired.previous_assignment,{sheetId:readyOpen.sheetId,slot:readyOpen.slot});
  assert.equal((await repo.sheet(staff,readyOpen.sheetId)).revision,oldSheet.revision+1);
  const newerSealed=await seed({cardId:values[50].cardId,version:2});await enqueue(newerSealed);
  await assert.rejects(repo.export(staff,saved.exportId),{code:'LABEL_SOURCE_SUPERSEDED'});assert.equal((await repo.export(staff,saved.exportId,{latest:false})).view.sha256,saved.sha256);
  assert.equal((await admin.query('SELECT count(*)::int n FROM atlas_manual_connected.label_print_event')).rows[0].n,1);
  checks.push('explicit reprint retains lineage; newer approval records open-slot release and blocks old sealed export without changing bytes/printed history');
  const reconcile=await seed();const dry=await repo.reconciliation(staff,{cardIds:[reconcile.cardId]});assert.equal(dry.applied,false);assert.equal(dry.candidates.length,1);
  await repo.reconciliation(staff,{apply:true,cardIds:[reconcile.cardId],expectedPlanHash:dry.planHash});assert.equal((await repo.reconciliation(staff,{apply:true,cardIds:[reconcile.cardId]})).candidates.length,0);
  await assert.rejects(repo.reconciliation(staff,{apply:true}),{code:'LABEL_RECONCILIATION_SCOPE_REQUIRED'});
  checks.push('existing publications require explicit named reconciliation; dry-run read-only and repeated apply no-op');
  const blocked=(await admin.query("SELECT * FROM atlas_manual_connected.label_item WHERE state='PENDING_RENDER' ORDER BY created_at,id")).rows;
  for(const cardId of new Set(blocked.map(i=>i.card_id))){const version=(await admin.query('SELECT max(version)::int n FROM atlas_manual.publication WHERE card_id=$1',[cardId])).rows[0].n+1;await seed({cardId,version,state:'PENDING'});}
  const fresh=[];for(let i=0;i<5;i++){const f=await seed();fresh.push(f);await enqueue(f);}
  const fair=createLabelRepository({boundary});let eligible=0,denied=0;
  for(let cycle=0;cycle<8&&eligible<5;cycle++)for(const candidate of await fair.pendingCandidates(2)){
    if(candidate.kind!=='ITEM')continue;
    try{const claim=await fair.claimItem(staff,candidate.id);if(claim)eligible++;}
    catch(error){assert.equal(error.code,'LABEL_SOURCE_SUPERSEDED');denied++;}
  }
  assert.equal(eligible,5);assert(denied>0);
  assert.deepEqual((await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE id=ANY($1::uuid[]) ORDER BY created_at,id',[blocked.map(i=>i.id)])).rows,blocked);
  checks.push('bounded keyset discovery advances past unchanged unclaimable oldest sources; later eligible jobs run without unauthorized mutation');
  // Upgrade a real006 database containing READY/printed/exported and failed labels.
  const failedSource=await seed();const failedId=await enqueue(failedSource),failedClaim=await repo.claimItem(staff,failedId);
  const failedSnapshot={identity:{cardName:'Sylveon ex',productSet:'A complete long approved metadata fixture'},grade:8.5,finalGrade:8.5,cardProfile:'POKEMON'};
  await repo.finishItem(staff,failedClaim,{row:failedSource.row,state:'NEEDS_LAYOUT',code:'METADATA_OVERFLOW',snapshot:failedSnapshot,
    rendererProfileHash:null,materialProfileId:null,jigHash:null});
  const readItem=async id=>(await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE id=$1',[id])).rows[0];
  const beforeRetry=await readItem(failedId),protectedTables=['atlas_manual.card','atlas_manual.approval','atlas_manual.publication',...['label_item','label_sheet','label_export','label_print_event'].map(t=>'atlas_manual_connected.'+t)];
  const protectedBefore=await Promise.all(protectedTables.map(async table=>(await admin.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  await assert.rejects(validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)}),{code:'LABEL_SCHEMA_REQUIRED'});
  assert.deepEqual((await applyStandaloneMigrations(admin)).applied,[{version:retryMigration.version,checksum:retryMigration.sqlSha256}]);
  assert.equal((await applyStandaloneMigrations(admin)).status,'NO_OP');
  for(let i=0;i<protectedTables.length;i++)assert.deepEqual((await admin.query(`SELECT to_jsonb(t) value FROM ${protectedTables[i]} t ORDER BY to_jsonb(t)::text`)).rows,protectedBefore[i]);
  const main=await pool.connect();try{await validateLabelRuntimeConfiguration({enabled:true,client:txFor(main)});}finally{main.release();}
  checks.push('006→007 and repeated no-op preserve all existing card/approval/publication/label/sheet/export/print bytes;006 startup refused and007 runtime admitted');
  const target={rendererProfileHash:digest('fixed renderer'),materialProfileId:'atlas-v4-holo-v1',jigHash:digest('jig')};
  const layoutRetryInput={requestId:randomUUID(),expectedFailureHash:labelFailureHash(beforeRetry),expectedRendererProfileHash:target.rendererProfileHash};
  await assert.rejects(repo.retryLayout(foreign,failedId,layoutRetryInput,target),{code:'LABEL_ITEM_NOT_FOUND'});
  await assert.rejects(repo.retryLayout(observer,failedId,layoutRetryInput,target),{code:'LABEL_ACCESS_DENIED'});
  const retryRace=await Promise.all([repo.retryLayout(staff,failedId,layoutRetryInput,target),repo.retryLayout(staff,failedId,layoutRetryInput,target)]);
  assert.deepEqual(retryRace[0],retryRace[1]);const retriedItem=retryRace[0];assert.equal(retriedItem.purpose,'LAYOUT_RETRY');assert.equal(retriedItem.originalItemId,failedId);
  const afterRetry=await readItem(failedId);assert.equal(afterRetry.state,'SUPERSEDED');assert.deepEqual({...afterRetry,state:beforeRetry.state,updated_at:beforeRetry.updated_at},beforeRetry);
  assert.deepEqual(await repo.retryLayout(staff,failedId,layoutRetryInput,{...target,rendererProfileHash:digest('later deployment')}),retriedItem);
  await assert.rejects(repo.retryLayout(staff,failedId,{...layoutRetryInput,expectedRendererProfileHash:digest('changed intent')},target),{code:'LABEL_REQUEST_CONFLICT'});
  await assert.rejects(repo.retryLayout(staff,failedId,{...layoutRetryInput,requestId:randomUUID()},target),{code:'LABEL_LAYOUT_ALREADY_RETRIED'});
  const retiredView=(await repo.list(staff)).items.find(i=>i.itemId===failedId);assert.equal(retiredView.supersededReason,'LAYOUT_RETRIED');assert.equal(retiredView.layoutRetryItemId,retriedItem.itemId);
  const newClaim=await repo.claimItem(staff,retriedItem.itemId);
  const finalResult={row:failedSource.row,state:'READY',snapshot:failedSnapshot,printSvg,previewSvg:printSvg,artworkHash,...target};
  await assert.rejects(repo.finishItem(staff,newClaim,{...finalResult,rendererProfileHash:digest('unrequested renderer')}),{code:'LABEL_RENDERER_CHANGED'});
  const readyRetry=await repo.finishItem(staff,newClaim,finalResult);assert.equal(readyRetry.state,'READY');assert.deepEqual((await readItem(readyRetry.itemId)).snapshot,canonical(failedSnapshot));
  assert.equal((await repo.retryLayout(staff,failedId,layoutRetryInput,target)).itemId,readyRetry.itemId);
  await assert.rejects(repo.retryLayout(staff,readyRetry.itemId,{...layoutRetryInput,requestId:randomUUID()},target),{code:'LABEL_LAYOUT_RETRY_UNAVAILABLE'});
  assert.equal((await repo.finishItem(staff,failedClaim,finalResult)).state,'SUPERSEDED');
  for(const [table,index] of [['atlas_manual.card',0],['atlas_manual.approval',1],['atlas_manual.publication',2],['atlas_manual_connected.label_export',5],['atlas_manual_connected.label_print_event',6]])
    assert.deepEqual((await admin.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows,protectedBefore[index]);
  checks.push('one concurrent retry generation; same semantic replay survives rendering/deployment, changed request conflicts; exact failed history retained, grade/source unchanged and no export/print implied');
  for(const sql of [`UPDATE atlas_manual_connected.label_item SET renderer_profile_hash='${digest('tamper')}' WHERE id='${readyRetry.itemId}'`,
    `UPDATE atlas_manual_connected.label_item SET snapshot='{}' WHERE id='${failedId}'`])await assert.rejects(admin.query(sql),/immutable/);
  const failure=async(options)=>{const f=await seed(options),id=await enqueue(f),claim=await repo.claimItem(staff,id);await repo.finishItem(staff,claim,{row:f.row,state:'NEEDS_LAYOUT',code:'METADATA_OVERFLOW',snapshot:failedSnapshot,...target});return{...f,id};};
  const failedAgain=await failure(),failureRow=await readItem(failedAgain.id),nextInput={requestId:randomUUID(),expectedFailureHash:labelFailureHash(failureRow),expectedRendererProfileHash:target.rendererProfileHash};
  await assert.rejects(repo.retryLayout(staff,failedAgain.id,{...nextInput,expectedFailureHash:digest('stale')},target),{code:'LABEL_FAILURE_CHANGED'});
  await assert.rejects(repo.retryLayout(staff,failedAgain.id,{...nextInput,expectedRendererProfileHash:digest('stale')},target),{code:'LABEL_RENDERER_CHANGED'});
  assert.deepEqual(await readItem(failedAgain.id),failureRow);
  let generation=await repo.retryLayout(staff,failedAgain.id,nextInput,target);
  for(let depth=1;depth<=16;depth++){
    const claim=await repo.claimItem(staff,generation.itemId);await repo.finishItem(staff,claim,{row:failedAgain.row,state:'NEEDS_LAYOUT',code:'METADATA_OVERFLOW',snapshot:failedSnapshot,...target});
    const predecessor=await readItem(generation.itemId),input={requestId:randomUUID(),expectedFailureHash:labelFailureHash(predecessor),expectedRendererProfileHash:target.rendererProfileHash};
    if(depth===16){await assert.rejects(repo.retryLayout(staff,generation.itemId,input,target),{code:'LABEL_LAYOUT_RETRY_LIMIT'});assert.deepEqual(await readItem(generation.itemId),predecessor);}
    else generation=await repo.retryLayout(staff,generation.itemId,input,target);
  }
  const competing=await failure(),competingRow=await readItem(competing.id),intent={expectedFailureHash:labelFailureHash(competingRow),expectedRendererProfileHash:target.rendererProfileHash};
  const contenders=await Promise.allSettled([randomUUID(),randomUUID()].map(requestId=>repo.retryLayout(staff,competing.id,{...intent,requestId},target)));
  assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);assert.equal(contenders.find(r=>r.status==='rejected').reason.code,'LABEL_LAYOUT_ALREADY_RETRIED');
  const revoked=await failure({owner:other}),revokedRow=await readItem(revoked.id);
  await admin.query('UPDATE atlas_manual.card SET approvers=$2,revision=revision+1 WHERE id=$1',[revoked.cardId,[]]);
  await assert.rejects(repo.retryLayout(staff,revoked.id,{requestId:randomUUID(),expectedFailureHash:labelFailureHash(revokedRow),expectedRendererProfileHash:target.rendererProfileHash},target),{code:'MANUAL_CARD_NOT_FOUND'});
  assert.deepEqual(await readItem(revoked.id),revokedRow);
  const newerApproval=await seed({cardId:failedSource.cardId,version:2});await enqueue(newerApproval);
  const changedView=(await repo.list(staff)).items.find(i=>i.itemId===failedId);assert.equal(changedView.supersededReason,'APPROVAL_CHANGED');assert.equal(changedView.layoutRetryItemId,null);
  await assert.rejects(repo.retryLayout(staff,failedId,layoutRetryInput,target),{code:'LABEL_SOURCE_SUPERSEDED'});
  checks.push('stale failure/profile cannot mutate state; later failure can retry with immutable predecessors;16 generation ceiling refuses without retiring final failure');
  await admin.query('ALTER TABLE atlas_manual_connected.label_item DISABLE TRIGGER label_layout_retry_guard');
  await assert.rejects(validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)}),{code:'LABEL_SCHEMA_REQUIRED'});
  await admin.query('ALTER TABLE atlas_manual_connected.label_item ENABLE TRIGGER label_layout_retry_guard');
  await admin.query('BEGIN');try{
    await admin.query("CREATE OR REPLACE FUNCTION atlas_manual_connected.guard_label_layout_retry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RETURN NEW; END $$");
    await assert.rejects(validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)}),{code:'LABEL_SCHEMA_REQUIRED'});
  }finally{await admin.query('ROLLBACK');}
  await admin.query('BEGIN');try{
    await admin.query('ALTER FUNCTION atlas_manual_connected.guard_label_layout_retry() RESET search_path');
    await assert.rejects(validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)}),{code:'LABEL_SCHEMA_REQUIRED'});
  }finally{await admin.query('ROLLBACK');}
  await admin.query('BEGIN');try{
    await admin.query("SET LOCAL session_replication_role='replica'");
    await assert.rejects(validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)}),{code:'LABEL_SCHEMA_REQUIRED'});
  }finally{await admin.query('ROLLBACK');}
  await validateLabelRuntimeConfiguration({enabled:true,client:txFor(admin)});
  checks.push('runtime gate refuses disabled insert guard, changed procedure missing restricted search_path or a replication bypass session; immutable artwork/target guards remain enforced');
  const proof={status:'PASS',checks,fixtureDirectory:cluster.directory};await writeFile(resolve(output,'result.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(proof));
} finally {await pool?.end();await admin?.end();await cluster.stop();}
