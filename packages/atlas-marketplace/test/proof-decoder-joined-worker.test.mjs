import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProofDecoderClient} from '../src/proof-decoder-client.mjs';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {openProofDecoderJobRegistry} from '../src/proof-decoder-job-registry.mjs';
import {createLocalFixtureDecoderExecutor} from '../src/proof-decoder-fixture-executor.mjs';
import {createProofDecoderWatchdog} from '../src/proof-decoder-watchdog.mjs';
import {createProofDecoderSupervisor} from '../src/proof-decoder-supervisor.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';
import {image,digest} from './proof-fixtures.mjs';

test('existing unqualified client joins real one-shot decode and durable fixture cleanup without validator authority',async t=>{
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'atlas-decoder-joined-'));
  t.diagnostic('Owned joined fixture retained: '+directory);
  const profile=syntheticDecoderProfile();
  profile.ipc.socketPath=join(directory,'decoder.sock');
  const plan=createProofDecoderLaunchPlan({enabled:true,profile});
  const registryDirectory=join(directory,'registry');
  const registry=openProofDecoderJobRegistry({enabled:true,directory:registryDirectory,plan});
  const executor=createLocalFixtureDecoderExecutor({enabled:true,plan});
  const watchdog=createProofDecoderWatchdog({enabled:true,registry,executor,plan});
  const expectedQualificationHash='7'.repeat(64),epoch='LOCAL_FIXTURE_JOINED_WORKER';
  const supervisor=createProofDecoderSupervisor({enabled:true,plan,registry,executor,watchdog,expectedQualificationHash,epoch});
  const client=createProofDecoderClient({enabled:true,socketPath:profile.ipc.socketPath,expectedQualificationHash,expectedEpoch:epoch,limits:profile.limits});
  const originals=[];
  try {
    await supervisor.start();
    for(const format of ['png','jpeg']) {
      const bytes=await image(format),original=Buffer.from(bytes);
      originals.push(original);
      const requestPlan={byteCount:bytes.length,sha256:digest(bytes),declaredType:'image/'+format};
      const result=await client.validate({bytes,plan:requestPlan});
      assert.equal(result.classification,'UNQUALIFIED');
      assert.equal(result.reportedCleanup,'REAPED');
      assert.deepEqual(result.validation,{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/'+format,byteCount:bytes.length,sha256:digest(original),width:20,height:30});
      assert.deepEqual(bytes,original);
      assert.throws(()=>assertProofImageValidator(client),{code:'PROOF_DECODER_UNAVAILABLE'});
      assert.throws(()=>assertProofImageValidator(result),{code:'PROOF_DECODER_UNAVAILABLE'});
    }
    const invalid=Buffer.concat([originals[0],Buffer.from('trailing-invalid-image')]);
    await assert.rejects(client.validate({bytes:invalid,plan:{byteCount:invalid.length,sha256:digest(invalid),declaredType:'image/png'}}),{code:'PROOF_IMAGE_INVALID'});
    assert.equal(client.status().occupiedSlots,0);
    assert.equal(client.status().cleanupUncertain,false);
    const snapshot=registry.snapshot();
    assert.equal(snapshot.classification,'UNQUALIFIED');
    assert.equal(snapshot.occupiedSlots,0);
    assert.equal(snapshot.jobs.length,3);
    assert.ok(snapshot.jobs.every(job=>job.phase==='FINALIZED'&&job.cleanup.confirmed===true));
  } finally {
    await client.close();
    await supervisor.close();
    await watchdog.close();
    await executor.close();
    registry.close();
  }
  assert.equal(existsSync(profile.ipc.socketPath),false);
  const executorState=executor.snapshot();
  assert.equal(executorState.classification,'UNQUALIFIED');
  assert.equal(executorState.evidenceOrigin,'LOCAL_FIXTURE');
  assert.ok(executorState.containers.every(item=>item.exited&&item.removed));
  for(const item of executorState.containers)if(item.pid)assert.throws(()=>process.kill(item.pid,0),{code:'ESRCH'});
  t.diagnostic('Actual owned local workers exited and socket absent; container/cgroup observations remain simulated.');
  // Owned durable fixture metadata remains inspectable; no original bytes are
  // stored in the registry and a clean reopen does not invent qualification.
  const database=readFileSync(join(registryDirectory,'jobs.sqlite'));
  for(const original of originals)assert.equal(database.includes(original),false);
  const reopened=openProofDecoderJobRegistry({enabled:true,directory:registryDirectory,plan,ownership:registry.ownership});
  try {
    assert.equal(reopened.snapshot().occupiedSlots,0);
    assert.equal(reopened.snapshot().jobs.length,3);
    assert.equal(reopened.classification,'UNQUALIFIED');
  } finally {reopened.close();}
});
