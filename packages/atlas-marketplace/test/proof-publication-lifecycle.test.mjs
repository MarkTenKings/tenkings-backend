import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {openProofPublicationLifecycleStore,migrateProofPublicationLedgerV2} from '../src/proof-publication-store.mjs';
import {PUBLICATION_LIFECYCLE_LIMITS as L,PUBLICATION_LIFECYCLE_SQL,publicationSessionBinding,publicationStageBinding,publicationStageLive,publicationScopeKey,publicationLifecycleState,publicationCapacity,publicationSession,reducePublicationSession,publicationOperation,publicationRow} from '../src/proof-publication-lifecycle.mjs';

const binding=()=>({installationId:randomUUID(),qualificationSessionId:randomUUID(),qualificationEvidenceHash:hash('qualification-observation'),sourceClosureHash:hash('closure'),policyHash:hash('policy'),intakeBindingHash:hash('intake')});
const scope=()=>({fenceId:randomUUID(),sourceKind:'POLICY',sourceKeyHash:hash('policy-key'),sourceGenerationHash:hash('generation'),ordinal:1,revision:7});
const stage=b=>({...b,stageId:randomUUID(),stageRevision:8,requestId:randomUUID(),requestBindingHash:hash('request'),actorAccessBindingHash:hash('actor'),operationHash:hash('operation'),bootId:randomUUID(),deadlineBootNs:'15000000001',fences:[scope()]});
const session=()=>({sessionId:randomUUID(),binding:binding(),previousSessionId:null,previousCloseHash:hash('migrated-close'),phase:'ACTIVE',reason:null,openedRevision:4,revision:4,publicationCount:0,byteCount:0,closeHash:null});
const state=()=>({revision:10,latestSessionId:randomUUID(),lastCloseHash:hash('close'),sessionCount:1,operationCount:3,objectCount:0,originalBytes:0,heldOperationId:null,externalHoldCount:0,unsettledBarrierCount:0});

test('both v2 IO entrypoints stay default off and reject authority, IO and clock injection',()=>{
  for(const open of [openProofPublicationLifecycleStore,migrateProofPublicationLedgerV2]){assert.equal(open(),null);assert.equal(open({enabled:false}),null);for(const extra of ['authorize','qualified','storage','put','clock','clearHold','fault'])assert.throws(()=>open({enabled:false,[extra]:()=>true}));let invoked=false;assert.throws(()=>open({get enabled(){invoked=true;return true;}}));assert.equal(invoked,false);}
  assert.throws(()=>openProofPublicationLifecycleStore({enabled:true,linuxObserver:{boottimeNanoseconds:()=>1n}}),{code:'DECODER_LINUX_OBSERVER_REQUIRED'});
});
test('all installation, qualification, source, policy and intake bindings are mandatory and session-exact',()=>{
  const b=binding(),s=stage(b);assert.deepEqual(publicationStageBinding(s,b),s);
  for(const key of Object.keys(b)){const missing={...s};delete missing[key];assert.throws(()=>publicationStageBinding(missing,b));const changed={...s,[key]:key.endsWith('Id')?randomUUID():hash('changed')};assert.throws(()=>publicationStageBinding(changed,b),{code:'PUBLICATION_SESSION_BINDING_MISMATCH'});}
  assert.throws(()=>publicationSessionBinding({...b,qualified:true}));
});
test('closed stage data never invokes accessors or scalar coercion',()=>{
  const b=binding(),s=stage(b);let touched=false;assert.throws(()=>publicationStageBinding({...s,get operationHash(){touched=true;return hash('x');}},b));assert.equal(touched,false);
  assert.throws(()=>publicationStageBinding({...s,deadlineBootNs:{toString(){touched=true;return '1';}}},b));assert.equal(touched,false);
});
test('fence order and source-generation identity prevent aliasing or contradictory same-source references',()=>{
  const b=binding(),s=stage(b),other={...scope(),sourceKind:'ACCESS'};const ordered=[s.fences[0],other].sort((a,b)=>a.fenceId.localeCompare(b.fenceId));assert.equal(publicationStageBinding({...s,fences:ordered},b).fences.length,2);
  assert.throws(()=>publicationStageBinding({...s,fences:[...ordered].reverse()},b));assert.throws(()=>publicationStageBinding({...s,fences:[ordered[0],ordered[0]]},b));
  const alias={...s.fences[0],fenceId:randomUUID(),ordinal:2,sourceGenerationHash:hash('other-generation')};assert.throws(()=>publicationStageBinding({...s,fences:[s.fences[0],alias].sort((a,b)=>a.fenceId.localeCompare(b.fenceId))},b));
  assert.equal(publicationScopeKey({...s.fences[0],fenceId:randomUUID()}),publicationScopeKey(s.fences[0]));
});
test('actual-time comparison preserves the original boot and deadline without renewal',()=>{
  const b=binding(),s=publicationStageBinding(stage(b),b);publicationStageLive(s,{bootId:s.bootId,nowNs:1n});
  for(const clock of [{bootId:randomUUID(),nowNs:1n},{bootId:s.bootId,nowNs:15000000001n},{bootId:s.bootId,nowNs:15000000002n},{bootId:s.bootId,nowNs:0n}])assert.throws(()=>publicationStageLive(s,clock),{code:'PUBLICATION_STAGE_EXPIRED'});
  let invoked=false;assert.throws(()=>publicationStageLive(s,{bootId:s.bootId,get nowNs(){invoked=true;return 1n;}}));assert.equal(invoked,false);
});
test('session close is irreversible and preserves every predecessor/binding/count field',()=>{
  const first=session(),completed=reducePublicationSession(first,{kind:'COMPLETE',byteCount:71},5),draining=reducePublicationSession(completed,{kind:'DRAIN',reason:'SERVICE_STOP'},6),closed=reducePublicationSession(draining,{kind:'CLOSE'},7);
  assert.equal(closed.phase,'CLOSED');assert.equal(closed.publicationCount,1);assert.equal(closed.byteCount,71);assert.deepEqual(closed.binding,first.binding);assert.equal(closed.previousCloseHash,first.previousCloseHash);assert.equal(closed.closeHash,hash({...closed,closeHash:null}));
  for(const action of [{kind:'COMPLETE',byteCount:1},{kind:'DRAIN',reason:'SERVICE_STOP'},{kind:'CLOSE'},{kind:'RESET'}])assert.throws(()=>reducePublicationSession(closed,action,8));
  assert.throws(()=>publicationSession({...closed,publicationCount:0}),{code:'PUBLICATION_CLOSE_MISMATCH'});assert.throws(()=>reducePublicationSession(first,{kind:'CLOSE'},5));assert.throws(()=>reducePublicationSession(draining,{kind:'COMPLETE',byteCount:1},7));
});
test('finite capacity reserves maintenance for every pending barrier and clean closure',()=>{
  const s=state();publicationCapacity(s);publicationCapacity({...s,operationCount:L.operations-2},{maintenance:true});assert.throws(()=>publicationCapacity({...s,operationCount:L.operations-2}),{code:'PUBLICATION_STORE_FULL'});
  assert.throws(()=>publicationCapacity({...s,operationCount:L.operations-4,unsettledBarrierCount:2}),{code:'PUBLICATION_STORE_FULL'});
  for(const changed of [{sessionCount:L.sessions},{objectCount:L.objects},{originalBytes:L.originalBytes}])assert.throws(()=>publicationCapacity({...s,...changed},{newSession:true,newObjectBytes:1}),{code:'PUBLICATION_STORE_FULL'});
  assert.throws(()=>publicationLifecycleState({...s,operationCount:-1}));assert.throws(()=>publicationCapacity({...s,revision:L.events-63}),{code:'PUBLICATION_STORE_FULL'});
});
test('publication count is per session and cannot be decremented or reset by transitions',()=>{
  let s=session();for(let n=0;n<L.publicationsPerSession;n++)s=reducePublicationSession(s,{kind:'COMPLETE',byteCount:1},s.revision+1);assert.equal(s.publicationCount,128);assert.throws(()=>reducePublicationSession(s,{kind:'COMPLETE',byteCount:1},s.revision+1));assert.throws(()=>reducePublicationSession(s,{kind:'COMPLETE',byteCount:-1},s.revision+1));
  const closed=reducePublicationSession(reducePublicationSession(s,{kind:'DRAIN',reason:'SERVICE_STOP'},s.revision+1),{kind:'CLOSE'},s.revision+2);assert.equal(closed.publicationCount,128);assert.equal(closed.byteCount,128);
});
test('unknown operation is data only, cannot carry a successful completion or extra authority field',()=>{
  const b=binding(),s=stage(b),value={operationId:randomUUID(),kind:'PUBLICATION',request:{sessionId:randomUUID(),binding:b,stageBinding:s,original:{objectKey:hash('key'),manifestHash:hash('manifest'),byteCount:71,sha256:hash('original')}},phase:'UNKNOWN',intentRevision:9,completedRevision:null,revision:10};assert.equal(publicationOperation(value).phase,'UNKNOWN');assert.throws(()=>publicationOperation({...value,completedRevision:10}));assert.throws(()=>publicationOperation({...value,settled:true}));
});
test('publication completion revision cannot be replaced by a later session or lookup revision',()=>{
  const b=binding(),value={operationId:randomUUID(),sessionId:randomUUID(),request:{objectKey:hash('key'),manifestHash:hash('manifest'),byteCount:71,sha256:hash('original')},stageBinding:stage(b),binding:b,phase:'COMPLETED',intentRevision:9,completedRevision:10,revision:10,evidenceHash:hash('synthetic-data-only')};assert.equal(publicationRow(value).completedRevision,10);assert.throws(()=>publicationRow({...value,revision:11}));assert.throws(()=>publicationRow({...value,phase:'UNKNOWN'}));
});
test('new SQLite schema freezes old rows and append-only history without rewriting their contents',()=>{
  const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE metadata(id INTEGER PRIMARY KEY,manifest TEXT,state TEXT); CREATE TABLE operations(id TEXT PRIMARY KEY,object_key TEXT,record TEXT); CREATE TABLE events(revision INTEGER PRIMARY KEY,record TEXT); INSERT INTO metadata VALUES(1,\'original-manifest\',\'original-state\'); INSERT INTO events VALUES(1,\'original-event\');');for(const sql of Object.values(PUBLICATION_LIFECYCLE_SQL))db.exec(sql);
    const actual=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(r=>Object.hasOwn(PUBLICATION_LIFECYCLE_SQL,r.name)).map(({name,sql})=>({name,sql}));assert.deepEqual(actual,Object.entries(PUBLICATION_LIFECYCLE_SQL).sort(([a],[b])=>a.localeCompare(b)).map(([name,sql])=>({name,sql})));
    for(const sql of ["UPDATE metadata SET state='reset'","DELETE FROM events","INSERT INTO operations VALUES('x',NULL,'x')"])assert.throws(()=>db.exec(sql),/frozen legacy/);
    db.exec("INSERT INTO lifecycle_events VALUES(2,'old','new','hash')");assert.throws(()=>db.exec("UPDATE lifecycle_events SET record='changed'"),/immutable event/);assert.throws(()=>db.exec('DELETE FROM lifecycle_events'),/immutable event/);
    db.exec("INSERT INTO publication_v2 VALUES('op','object','session','stage','request',3,'fixture')");assert.throws(()=>db.exec("INSERT INTO publication_v2 VALUES('other','other-object','other-session','stage','other-request',4,'fixture')"),/UNIQUE constraint/);assert.throws(()=>db.exec("INSERT INTO publication_v2 VALUES('third','third-object','other-session','other-stage','request',4,'fixture')"),/UNIQUE constraint/);
    assert.equal(db.prepare('SELECT manifest FROM metadata').get().manifest,'original-manifest');assert.equal(db.prepare('SELECT record FROM events').get().record,'original-event');
  }finally{db.close();}
});
