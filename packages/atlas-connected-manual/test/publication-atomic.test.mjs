import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical,digest } from '@atlas/manual-service/contract';
import { createManualService } from '@atlas/manual-service';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createPublicationRepository,approvedPublicationSource,publicationGrantSQL } from '../src/publication-repository.mjs';
import { publicationFixture } from './publication-fixture.mjs';
async function setup(){
 const f=await publicationFixture(),principal={id:f.actorId,role:'REVIEWER',canCertify:true,mode:'LOCAL_FIXTURE'},state={card:{id:f.cardId,revision:10,content:canonical(f.draft),content_hash:digest(canonical(f.draft)),owner_id:f.actorId,editors:[],approvers:[],readers:[]},actions:[],approvals:[],identities:[],publications:[]};
 let failIntent=false,revoke=false;
 const boundary={async transaction(staff,work){const next=structuredClone(state);const tx={async $queryRawUnsafe(sql,...args){
  if(sql.startsWith('SELECT * FROM atlas_manual.card'))return [structuredClone(next.card)];
  if(sql.startsWith('SELECT * FROM atlas_manual.action'))return next.actions.filter(r=>r.action_id===args[1]);
  throw new Error('Unexpected query '+sql);
 },async $executeRawUnsafe(sql,...a){
  if(sql.startsWith('UPDATE atlas_manual.card')){if(next.card.revision!==a[4]||next.card.content_hash!==a[5])return 0;Object.assign(next.card,{revision:a[0],content:a[1],content_hash:a[2]});return 1;}
  if(sql.startsWith('INSERT INTO atlas_manual.action')){next.actions.push({card_id:a[0],action_id:a[1],actor_id:a[2],request_hash:a[5],result:a[7]});return 1;}
  if(sql.startsWith('INSERT INTO atlas_manual.approval')){next.approvals.push({card_id:a[0],action_id:a[1],actor_id:a[2],source_revision:a[3],source_hash:a[4],report_hash:a[5],report:a[6]});return 1;}
  if(sql.startsWith('INSERT INTO atlas_manual.public_report_identity')){next.identities.push({card_id:a[0],public_token:a[1],report_number:a[2]});return 1;}
  if(sql.startsWith('INSERT INTO atlas_manual.publication')){if(failIntent)throw new Error('intent insert failure');next.publications.push({card_id:a[0],action_id:a[1],version:1,mode:a[2],state:'PENDING'});return 1;}
  throw new Error('Unexpected mutation '+sql);
 }};let refreshes=0;const refresh=async()=>({principal:{...principal,canCertify:!(revoke&&++refreshes>1)},now:new Date('2026-09-22T12:00:00Z')});
 const result=await work({tx,principal,now:new Date('2026-09-22T12:00:00Z'),refresh});Object.assign(state,next);return result;}};
 const publication=createPublicationRepository({boundary});const repository=createManualRepository({boundary,approvalCommitted:publication.approvalCommitted});
 const service=createManualService({repository,reduce(){throw new Error('approval must not reduce');},buildReport:async()=>f.approval});
 const input={actionId:f.actionId,expectedRevision:10,action:{type:'APPROVE_REPORT',reportHash:f.row.report_hash,reviewed:true}};
 return {...f,state,service,input,failIntent(){failIntent=true;},revoke(){revoke=true;}};
}
test('real service and repository atomically commit approval action and pending publication once; exact replay is inert',async()=>{
 const f=await setup(),before=f.state.card.content,result=await f.service.execute({},f.cardId,f.input);
 assert.equal(f.state.card.content,before);assert.equal(f.state.card.revision,11);for(const list of ['actions','approvals','identities','publications'])assert.equal(f.state[list].length,1,list);
 assert.match(f.state.identities[0].public_token,/^ar_[A-Za-z0-9_-]{24}$/);assert.match(f.state.identities[0].report_number,/^ATLAS-[A-F0-9]{12}$/);
 const source=approvedPublicationSource({...f.state.approvals[0],result:canonical(result)});assert.deepEqual(source.draft,f.draft);
 assert.deepEqual(await f.service.execute({},f.cardId,f.input),result);assert.equal(f.state.publications.length,1);
});
test('intent failure rolls back card revision, action, approval and assigned public identity together',async()=>{
 const f=await setup(),before=structuredClone(f.state);f.failIntent();await assert.rejects(f.service.execute({},f.cardId,f.input),/intent insert failure/);assert.deepEqual(f.state,before);
});
test('late certification revocation rolls back publication intent with approval, and stale CAS creates nothing',async()=>{
 const f=await setup(),before=structuredClone(f.state);f.revoke();await assert.rejects(f.service.execute({},f.cardId,f.input),{code:'MANUAL_CERTIFICATION_REQUIRED'});assert.deepEqual(f.state,before);
 const g=await setup();g.state.card.revision++;const current=structuredClone(g.state);await assert.rejects(g.service.execute({},g.cardId,g.input),{code:'MANUAL_DRAFT_STALE'});assert.deepEqual(g.state,current);
});
test('grant generator has only insert/read and completion columns plus the native read function',()=>{
 const sql=publicationGrantSQL('atlas_manual_fixture');assert.ok(sql.includes('UPDATE(state,manifest,manifest_hash,public_hash,published_at)'));assert.equal(/DELETE|TRUNCATE|ALL|UPDATE ON/.test(sql),false);assert.throws(()=>publicationGrantSQL('bad"role'));
});
