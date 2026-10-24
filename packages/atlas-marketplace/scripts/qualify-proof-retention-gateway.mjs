// Root operator only: fresh synthetic PostgreSQL, explicitly supplied owned
// connections. This does not produce a request, publisher or authority brand.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalJSON,clone,hash} from '../src/contract.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createPostgresStore,emptyMarketplaceState} from '../src/store-postgres.mjs';
import {createProofRetentionJournal} from '../src/proof-retention-journal.mjs';
import {syntheticRetentionFixture,seedSyntheticRetention} from './qualify-proof-retention-journal.mjs';

const protectedKeys=['marketplaceProofUploads','marketplaceProofObjects','marketplaceProofRetentionJournal','marketplaceProofRetentionOperations','marketplaceProofRetentionUploadIndex','marketplaceProofRetentionPublicationIndex'];
function nextState(state,fixture,cancel=false){
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>100});let journal;
  try{store.transaction(tx=>Object.assign(tx.state,clone(state)));journal=createProofRetentionJournal({enabled:true,store,binding:fixture.binding,maxOperations:8});
    const report=cancel?journal.cancelBeforeCommit({operation:fixture.operation,barrierId:randomUUID(),barrierRevision:4}):journal.commitRetention({operation:fixture.operation});
    return {state:store.read(),report};
  }finally{journal?.close();store.close();}
}
export async function qualifyProofRetentionGateway({admin,writer,retention}){
  const results=[];let refused=0;
  async function state(){const {rows}=await admin.query('SELECT * FROM atlas_marketplace.state WHERE id');assert.equal(rows.length,1);assert.equal(hash(rows[0].document),rows[0].state_hash);return rows[0];}
  async function deny(pool,sql,args=[],pattern){const before=await state();await assert.rejects(()=>pool.query(sql,args),error=>{if(pattern)assert.match(error.message,pattern);return true;});assert.deepEqual(await state(),before);refused++;}
  const generic='SELECT atlas_marketplace.commit_state($1,$2,$3::jsonb,$4,$5)';
  const special='SELECT atlas_marketplace.commit_retention_state_v1($1,$2,$3::jsonb,$4,$5,$6::uuid,$7)';
  const args=(before,next,fixture)=>[before.revision,before.state_hash,canonicalJSON(next),hash(next),100,...(fixture?[fixture.operation.operationId,hash(fixture.operation)]:[])];
  const fixtures=['commit','cancel','alter','race'].map(syntheticRetentionFixture),initial=emptyMarketplaceState();
  for(const f of fixtures)seedSyntheticRetention({state:initial},f);
  const count=(await admin.query('SELECT count(*)::integer AS n FROM atlas_marketplace.state')).rows[0].n;
  if(count===0)await admin.query("INSERT INTO atlas_marketplace.state VALUES(true,'atlas-marketplace-v2','SYNTHETIC_LOCAL',0,$1::jsonb,$2)",[canonicalJSON(initial),hash(initial)]);
  else {assert.equal(count,1);const before=await state();assert.equal(before.revision,'0');assert.deepEqual(before.document,initial);assert.equal((await admin.query('SELECT count(*)::integer AS n FROM atlas_marketplace.proof_retention_binding_v1')).rows[0].n,0);}
  // Without explicit installation the positive gate is closed.
  const pending=nextState(initial,fixtures[0]);
  await deny(retention,special,args(await state(),pending.state,fixtures[0]),/query returned no rows/);
  await admin.query('INSERT INTO atlas_marketplace.proof_retention_binding_v1 VALUES(true,$1::jsonb,8)',[canonicalJSON(fixtures[0].binding)]);

  for(const [pool,expected] of [[writer,['commit_state(bigint, text, jsonb, text, bigint)','lock_state()','read_state()']],[retention,['commit_retention_state_v1(bigint, text, jsonb, text, bigint, uuid, text)','lock_retention_state_v1()','read_retention_binding_v1()','read_retention_state_v1()']]]){
    const {rows}=await pool.query("SELECT p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' AS name, p.prosecdef AS definer, p.proconfig AS config,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(current_user,p.oid,'EXECUTE') ORDER BY name");
    assert.deepEqual(rows.map(r=>r.name),expected);for(const r of rows){assert.equal(r.definer,true);assert.equal(r.owner,'atlas_marketplace_owner');assert.deepEqual(r.config,['search_path=pg_catalog']);}
    await deny(pool,'SELECT * FROM atlas_marketplace.state',[],/permission denied/);
    await deny(pool,'SELECT atlas_marketplace.commit_state_internal_v1(0,$1,$2::jsonb,$1,100)',[hash(initial),canonicalJSON(initial)],/permission denied/);
    await deny(pool,"SELECT atlas_marketplace.proof_hash_v1('{}'::jsonb)",[],/permission denied/);
    await deny(pool,"UPDATE atlas_marketplace.proof_retention_binding_v1 SET max_operations=1",[],/permission denied/);
  }
  results.push('exact role function grants; no direct table/helper/common-CAS/binding write');

  for(const key of protectedKeys){const before=await state(),next=clone(before.document);next[key]={forged:true};await deny(writer,generic,args(before,next),/PROOF_RETENTION_GATEWAY_REQUIRED/);}
  await deny(writer,generic,args(await state(),pending.state),/PROOF_RETENTION_GATEWAY_REQUIRED/);
  await deny(retention,generic,args(await state(),pending.state),/permission denied/);
  const ordinary=createPostgresStore({enabled:true,pool:writer,environment:'SYNTHETIC_LOCAL',expectedRole:'atlas_marketplace_writer',expectedDatabase:'atlas_marketplace_review_candidate',expectedFunctionOwner:'atlas_marketplace_owner',clock:()=>100});
  try{await ordinary.transaction(tx=>{tx.state.consent.demo_unrelated={accepted:true};});assert.deepEqual((await ordinary.read()).consent.demo_unrelated,{accepted:true});}finally{ordinary.close();}
  results.push('all six protected maps blocked through generic writer; unrelated audited store change passes');

  // Actual PostgreSQL canonical encoding must agree with the unchanged JS C1
  // tuple, including UTF8/string escaping, integer extremes and negative zero.
  for(const value of [fixtures[0].operation,fixtures[0].row,fixtures[0].row.manifest,{a:'"\\\n\t\b\f\r é 雪 😀 \u2028',b:[null,true,false,0,-0,-9007199254740991,9007199254740991]}]){
    const {rows:[r]}=await admin.query('SELECT atlas_marketplace.proof_canonical_v1($1::jsonb) AS encoded,atlas_marketplace.proof_hash_v1($1::jsonb) AS hash',[canonicalJSON(value)]);assert.equal(r.encoded,canonicalJSON(value));assert.equal(r.hash,hash(value));
  }
  await assert.rejects(()=>admin.query('SELECT atlas_marketplace.proof_canonical_v1($1::jsonb)',[canonicalJSON({fraction:1.25})]),/PROOF_RETENTION_ENCODING_REFUSED/);
  results.push('canonical proof tuple bytes/hashes match JS; fractional values refused');

  let before=await state(),good=nextState(before.document,fixtures[0]);
  for(const change of [
    d=>{d.consent.forged=true;},
    d=>{d.marketplaceProofRetentionOperations[fixtures[0].operation.operationId].phase=null;},
    d=>{d.marketplaceProofRetentionOperations[fixtures[0].operation.operationId].result.status='VALIDATED';},
    d=>{d.marketplaceProofRetentionOperations[fixtures[0].operation.operationId].retainedUploadHash='0'.repeat(64);},
    d=>{d.marketplaceProofObjects[fixtures[0].row.proofId].manifest.sha256='0'.repeat(64);},
    d=>{d.marketplaceProofUploads[fixtures[0].row.uploadId].attempts++;},
    d=>{d.marketplaceProofRetentionJournal.maxOperations=9;},
    d=>{d.events.at(-1).payload.actorId='demo_forged';},
  ]){const bad=clone(good.state);change(bad);await deny(retention,special,args(before,bad,fixtures[0]),/PROOF_RETENTION_/);}
  const wrong=args(before,good.state,fixtures[0]);wrong[6]='0'.repeat(64);await deny(retention,special,wrong,/PROOF_RETENTION_IDENTITY_REFUSED/);
  await retention.query(special,args(before,good.state,fixtures[0]));assert.deepEqual((await state()).document,good.state);
  await deny(retention,special,args(before,good.state,fixtures[0]),/STALE_MARKETPLACE_STATE/);
  results.push('exact C1 commit passes; malformed outcome/hash/original/metadata/event/unrelated state and stale replay refused');

  before=await state();good=nextState(before.document,fixtures[1],true);
  const badBarrier=clone(good.state);badBarrier.marketplaceProofRetentionOperations[fixtures[1].operation.operationId].barrier.barrierRevision=3;await deny(retention,special,args(before,badBarrier,fixtures[1]),/PROOF_RETENTION_BARRIER_REFUSED/);
  const badHistory=clone(good.state);badHistory.marketplaceProofRetentionOperations[fixtures[0].operation.operationId].recordedAt++;await deny(retention,special,args(before,badHistory,fixtures[1]),/PROOF_RETENTION_UNRELATED_OR_MALFORMED_CHANGE/);
  await retention.query(special,args(before,good.state,fixtures[1]));assert.deepEqual((await state()).document,good.state);
  const tombstone=good.state.marketplaceProofRetentionOperations[fixtures[1].operation.operationId];
  before=await state();const overwrite=clone(before.document);overwrite.marketplaceProofRetentionOperations[fixtures[1].operation.operationId].phase='COMMITTED';await deny(retention,special,args(before,overwrite,fixtures[1]),/PROOF_RETENTION_ORIGINAL_ALREADY_RECORDED/);
  assert.deepEqual((await state()).document.marketplaceProofRetentionOperations[fixtures[1].operation.operationId],tombstone);
  results.push('exact permanent cancellation passes; old operation/tombstone changes and non-increasing barrier refused');

  before=await state();const committed=nextState(before.document,fixtures[3]),cancelled=nextState(before.document,fixtures[3],true);
  const contenders=await Promise.allSettled([retention.query(special,args(before,committed.state,fixtures[3])),retention.query(special,args(before,cancelled.state,fixtures[3]))]);
  assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);assert.match(contenders.find(r=>r.status==='rejected').reason.message,/STALE_MARKETPLACE_STATE/);
  const final=await state();assert.ok([hash(committed.state),hash(cancelled.state)].includes(final.state_hash));
  assert.equal(Object.keys(final.document.marketplaceProofRetentionOperations).length,3);
  results.push('actual concurrent commit/cancel has one winner and preserves the other originals');
  return {schema:'atlas-proof-retention-gateway-fixture-v1',classification:'UNQUALIFIED',scope:'ACTUAL_POSTGRES_TRANSITION_AND_GRANTS_ONLY',cases:results,refusals:refused,finalRevision:final.revision,finalStateHash:final.state_hash,notRun:['genuine canonical request/publisher/C0 authority','production installation','lost COMMIT response','protected initial intake gateway']};
}
// Focused follow-up on the retained revision-four fixture. No prior operation
// is replayed or reset. Malformed histories are data passed to the private
// checker by the fixture administrator; they are never installed as DB state.
export async function qualifyProofRetentionGatewayReviewFixes({admin,retention}){
  const {rows:[before]}=await admin.query('SELECT * FROM atlas_marketplace.state WHERE id');
  assert.equal(before.revision,'4');assert.equal(hash(before.document),before.state_hash);
  const f=syntheticRetentionFixture('alter'),good=nextState(before.document,f),tests=[];
  const check='SELECT atlas_marketplace.check_retention_transition_v1($1::jsonb,$2::jsonb,$3::uuid,$4,100,\'SYNTHETIC_LOCAL\')';
  const values=(old,next,operation=f.operation)=>[canonicalJSON(old),canonicalJSON(next),operation.operationId,hash(operation)];
  const tombstone=syntheticRetentionFixture('cancel'),oldId=before.document.marketplaceProofRetentionUploadIndex[tombstone.row.uploadId];
  tombstone.operation=clone(before.document.marketplaceProofRetentionOperations[oldId].operation);
  assert.equal(before.document.marketplaceProofRetentionOperations[oldId].phase,'CANCELLED_BEFORE_COMMIT');
  const pubKey=hash({ledgerId:tombstone.operation.publicationLedgerId,sessionId:tombstone.operation.publicationSessionId,operationId:tombstone.operation.publicationOperationId});
  const bad=clone(before.document);
  delete bad.marketplaceProofRetentionUploadIndex[tombstone.row.uploadId];bad.marketplaceProofRetentionUploadIndex.demo_miskeyed=oldId;
  delete bad.marketplaceProofRetentionPublicationIndex[pubKey];bad.marketplaceProofRetentionPublicationIndex['0'.repeat(64)]=oldId;
  // Reproduce the old count-only bypass with an original cancelled upload and
  // a fresh operation ID. Generate its otherwise-valid C1 document separately.
  const shadow=clone(before.document);for(const key of protectedKeys.slice(2))delete shadow[key];
  const retry={...tombstone,operation:{...tombstone.operation,operationId:randomUUID(),publicationOperationId:randomUUID()}};
  const retried=nextState(shadow,retry).state;
  for(const key of protectedKeys.slice(3))retried[key]={...bad[key],...retried[key]};
  await assert.rejects(()=>admin.query(check,values(bad,retried,retry.operation)),/PROOF_RETENTION_HISTORY_REFUSED/);
  tests.push('same-count miskeyed cancellation indexes cannot admit a new operation for the original upload');
  const corruptions=[
    d=>{d.marketplaceProofRetentionUploadIndex[tombstone.row.uploadId]=randomUUID();},
    d=>{d.marketplaceProofRetentionPublicationIndex[pubKey]=randomUUID();},
    d=>{d.marketplaceProofRetentionOperations[oldId].operationHash='0'.repeat(64);},
    d=>{d.marketplaceProofRetentionOperations[oldId].barrier.barrierRevision=tombstone.operation.retentionFenceRevision;},
    d=>{d.marketplaceProofRetentionOperations[oldId].operation.decoderRequestId='invalid';},
    d=>{d.marketplaceProofRetentionOperations[oldId].phase='UNKNOWN';},
    d=>{d.marketplaceProofRetentionOperations[oldId].result={};},
    d=>{d.marketplaceProofRetentionOperations[oldId].recordedAt=-1;},
  ];
  for(const change of corruptions){const old=clone(before.document),next=clone(good.state);change(old);change(next);await assert.rejects(()=>admin.query(check,values(old,next)),/PROOF_RETENTION_HISTORY_REFUSED/);}
  tests.push('all prior original identities, both indexes and terminal records revalidated');
  const whitespace=[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279].map(value=>String.fromCodePoint(value));
  const strings=['x','é','😀'.repeat(250),'😀'.repeat(251),'a'.repeat(500),'a'.repeat(501),'','a\tb','\u180ex','\u200bx',null,false,{},...whitespace.flatMap(w=>[w+'text','text'+w,'a'+w+'b'])];
  const {rows}=await admin.query('SELECT atlas_marketplace.proof_text_v1(value) AS valid FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY x(value,n) ORDER BY n',[canonicalJSON(strings)]);
  assert.deepEqual(rows.map(r=>r.valid),strings.map(s=>typeof s==='string'&&s.length>0&&s.length<=500&&s.trim()===s));
  tests.push('PostgreSQL text validation matches JS trim and UTF-16 length across '+strings.length+' values');
  for(const field of ['storageId','retentionRef']){
    const old=clone(before.document),next=clone(good.state),o=clone(f.operation),u=old.marketplaceProofUploads[o.uploadId];u.manifest[field]=field==='storageId'?'\tstore':'😀'.repeat(251);
    o.manifestHash=hash(u.manifest);o.expectedUploadHash=hash(u);
    next.marketplaceProofUploads[o.uploadId]={...clone(u),status:'RETAINED',completedAt:100};
    const object=next.marketplaceProofObjects[o.proofId];object.manifest=clone(u.manifest);object.manifestHash=o.manifestHash;
    const record=next.marketplaceProofRetentionOperations[o.operationId];record.operation=o;record.operationHash=hash(o);record.retainedUploadHash=hash(next.marketplaceProofUploads[o.uploadId]);record.proofObjectHash=hash(object);
    await assert.rejects(()=>admin.query(check,values(old,next,o)),/PROOF_RETENTION_MANIFEST_REFUSED/);
  }
  tests.push('real transition refuses tab-padded storage ID and excessive UTF-16 retention reference');
  // The added helpers remain inaccessible to the confined retention role.
  await assert.rejects(()=>retention.query("SELECT atlas_marketplace.proof_text_v1('\"x\"'::jsonb)"),/permission denied/);
  await assert.rejects(()=>retention.query("SELECT atlas_marketplace.check_retention_history_v1('{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,8)"),/permission denied/);
  const {rows:[unchanged]}=await admin.query('SELECT * FROM atlas_marketplace.state WHERE id');assert.deepEqual(unchanged,before);
  await retention.query('SELECT atlas_marketplace.commit_retention_state_v1($1,$2,$3::jsonb,$4,100,$5::uuid,$6)',[before.revision,before.state_hash,canonicalJSON(good.state),hash(good.state),f.operation.operationId,hash(f.operation)]);
  const {rows:[after]}=await admin.query('SELECT * FROM atlas_marketplace.state WHERE id');assert.equal(after.revision,'5');assert.deepEqual(after.document,good.state);assert.equal(after.state_hash,hash(good.state));
  tests.push('one previously unused operation commits through the changed gateway with all prior history preserved');
  return {classification:'UNQUALIFIED',tests,refusals:13,textValues:strings.length,finalRevision:after.revision,finalStateHash:after.state_hash,priorCasesReplayed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)throw new Error('OPERATOR_COMPOSITION_REQUIRED_NO_CREDENTIAL_DISCOVERY');
