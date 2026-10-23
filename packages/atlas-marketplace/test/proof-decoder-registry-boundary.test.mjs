import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,realpathSync,writeFileSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {openProofDecoderJobRegistry} from '../src/proof-decoder-job-registry.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

function fixture(t){
  const root=mkdtempSync(join(realpathSync(tmpdir()),'atlas-decoder-registry-'));
  const profile=syntheticDecoderProfile();profile.ipc.socketPath=join(root,'fixture.sock');
  const plan=createProofDecoderLaunchPlan({enabled:true,profile}),directory=join(root,'registry');
  const registry=openProofDecoderJobRegistry({enabled:true,directory,plan});
  t.diagnostic('Owned metadata fixture retained: '+root);
  return {root,plan,directory,registry};
}
const request=()=>{const now=Date.now();return {requestId:randomUUID(),epoch:'LOCAL_FIXTURE_REGISTRY',requestPlan:{byteCount:1,sha256:'a'.repeat(64),declaredType:'image/png'},now,deadlineAt:now+1000};};
function bytesIn(directory){return Object.fromEntries(readdirSync(directory).sort().map(name=>[name,readFileSync(join(directory,name))]));}

test('registry is default-off, private and metadata-only; explicit clean reopen retains intent and CAS',t=>{
  assert.equal(openProofDecoderJobRegistry(),null);
  const f=fixture(t),r=f.registry;
  try{
    assert.equal(lstatSync(f.directory).mode&0o777,0o700);
    assert.equal(lstatSync(join(f.directory,'jobs.sqlite')).mode&0o777,0o600);
    assert.throws(()=>r.reserve({...request(),requestPlan:{byteCount:0,sha256:'a'.repeat(64),declaredType:'image/png'}}));
    assert.throws(()=>r.reserve({...request(),requestId:'x'.repeat(36)}));
    const input=request(),row=r.reserve(input);
    assert.deepEqual(row.requestPlan,input.requestPlan);
    assert.equal(Object.hasOwn(row,'bytes'),false);
    assert.throws(()=>r.reserve(input),{code:'DECODER_REQUEST_REPLAY'});
    const next=r.transition(row.identity.jobId,0,{phase:'CREATE_INTENT'});
    assert.equal(next.revision,1);
    assert.throws(()=>r.transition(row.identity.jobId,0,{phase:'CREATE_INTENT'}),{code:'DECODER_REGISTRY_CAS'});
    assert.throws(()=>r.transition(row.identity.jobId,1,{phase:'FINALIZED'}));
    assert.equal(r.snapshot().occupiedSlots,1);
  }finally{r.close();}
  const before=bytesIn(f.directory);
  assert.throws(()=>openProofDecoderJobRegistry({enabled:true,directory:f.directory,plan:f.plan}),{code:'DECODER_REGISTRY_OWNERSHIP_REQUIRED'});
  assert.deepEqual(bytesIn(f.directory),before);
  const reopened=openProofDecoderJobRegistry({enabled:true,directory:f.directory,plan:f.plan,ownership:r.ownership});
  try{assert.equal(reopened.snapshot().occupiedSlots,1);assert.equal(reopened.snapshot().jobs[0].phase,'CREATE_INTENT');assert.equal(reopened.snapshot().journalMode,'delete');assert.equal(reopened.snapshot().synchronous,3);}finally{reopened.close();}
});

test('every journal/WAL/SHM sidecar refuses before SQLite recovery or mutation and preserves bytes',t=>{
  for(const suffix of ['-journal','-wal','-shm']){
    const f=fixture(t);f.registry.close();
    const sidecar=Buffer.alloc(512,0x3d);
    Buffer.from('d9d505f920a163d7','hex').copy(sidecar); // Plausible hot-journal magic is still never adopted.
    writeFileSync(join(f.directory,'jobs.sqlite'+suffix),sidecar,{mode:0o600,flag:'wx'});
    const before=bytesIn(f.directory);
    assert.throws(()=>openProofDecoderJobRegistry({enabled:true,directory:f.directory,plan:f.plan,ownership:f.registry.ownership}),{code:'DECODER_REGISTRY_RECOVERY_REQUIRED'});
    assert.deepEqual(bytesIn(f.directory),before);
  }
});

test('foreign database bytes and malformed owned rows refuse before writable open without repairing them',t=>{
  const foreign=fixture(t);foreign.registry.close();
  const dbPath=join(foreign.directory,'jobs.sqlite'),invalid=readFileSync(dbPath);invalid.fill(0,0,16);writeFileSync(dbPath,invalid);
  const beforeForeign=bytesIn(foreign.directory);
  assert.throws(()=>openProofDecoderJobRegistry({enabled:true,directory:foreign.directory,plan:foreign.plan,ownership:foreign.registry.ownership}),{code:'DECODER_REGISTRY_FOREIGN_FILE'});
  assert.deepEqual(bytesIn(foreign.directory),beforeForeign);
  const malformed=fixture(t),row=malformed.registry.reserve(request());malformed.registry.close();
  const raw=new DatabaseSync(join(malformed.directory,'jobs.sqlite'));
  try{raw.prepare('UPDATE jobs SET record=? WHERE id=?').run(JSON.stringify({...row,unrecognized:'must refuse'}),row.identity.jobId);}finally{raw.close();}
  const beforeMalformed=bytesIn(malformed.directory);
  assert.throws(()=>openProofDecoderJobRegistry({enabled:true,directory:malformed.directory,plan:malformed.plan,ownership:malformed.registry.ownership}),{code:'DECODER_CONTRACT_INVALID'});
  assert.deepEqual(bytesIn(malformed.directory),beforeMalformed);
});
