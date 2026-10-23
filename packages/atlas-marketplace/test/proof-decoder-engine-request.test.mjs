import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProofDecoderEngineRequest,PROOF_DECODER_ENGINE_OPERATIONS} from '../src/proof-decoder-engine-request.mjs';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {syntheticEngineContext} from './proof-decoder-engine-fixtures.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function compile(operation,context=syntheticEngineContext({created:operation!=='CREATE'})){
  const {seccompBytes,...input}=context;return compileProofDecoderEngineRequest({...input,operation,...(operation==='CREATE'?{seccompBytes}:{})});
}
test('fixed reference requests compile only owned operations, with attach distinct from start',()=>{
  for(const operation of PROOF_DECODER_ENGINE_OPERATIONS){const result=compile(operation);assert.equal(result.classification,'UNQUALIFIED');assert.equal(result.executionAllowed,false);assert.ok(result.http.path.startsWith('/v1.47/'));assert.equal(result.operation,operation);assert.ok(Object.isFrozen(result.http));}
  const context=syntheticEngineContext(),container=`/v1.47/containers/${context.job.containerId}`;
  assert.equal(compile('ATTACH',context).http.path,`${container}/attach?logs=0&stream=1&stdin=1&stdout=1&stderr=1`);
  assert.deepEqual(compile('ATTACH',context).http.headers,{connection:'Upgrade',upgrade:'tcp'});
  assert.deepEqual(compile('START',context).http,{method:'POST',path:`${container}/start`,headers:{},body:null});
  assert.equal(compile('WAIT',context).http.path,`${container}/wait?condition=not-running`);
  assert.equal(compile('REMOVE',context).http.path,`${container}?force=0&v=0`);
  assert.equal(compile('KILL',context).http.path,`${container}/kill?signal=SIGKILL`);
});
test('create compiles supplied hash-verified seccomp contents and fixed isolation intent',()=>{
  const context=syntheticEngineContext({created:false}),request=compile('CREATE',context),body=JSON.parse(request.http.body),host=body.HostConfig;
  assert.equal(request.seccompArtifactSha256,digest(context.seccompBytes));assert.equal(request.bodySha256,digest(request.http.body));
  assert.ok(host.SecurityOpt.includes('seccomp={"defaultAction":"SCMP_ACT_ERRNO","syscalls":[]}'));
  assert.ok(!request.http.body.includes('/synthetic/profile.json'));
  for(const key of ['OpenStdin','StdinOnce','AttachStdin','AttachStdout','AttachStderr'])assert.equal(body[key],true);
  assert.equal(body.Tty,false);assert.equal(body.Env.length,5);assert.deepEqual(body.Entrypoint,['/opt/atlas-proof-decoder/bin/node']);
  assert.deepEqual(body.Cmd,['--max-old-space-size=128','/opt/atlas-proof-decoder/worker.mjs']);
  assert.equal(host.NetworkMode,'none');assert.equal(host.ReadonlyRootfs,true);assert.equal(host.Privileged,false);
  assert.equal(host.MemorySwap,host.Memory);assert.equal(host.AutoRemove,false);assert.deepEqual(host.Mounts,[]);assert.deepEqual(host.Devices,[]);
  assert.equal(host.LogConfig.Type,'none');assert.equal(host.RestartPolicy.Name,'no');assert.equal(host.CgroupParent,undefined);
  assert.throws(()=>{request.http.path='/containers/prune';},TypeError);
  context.seccompBytes.fill(0);assert.ok(request.http.body.includes('SCMP_ACT_ERRNO'));
});
test('arbitrary endpoint, selector, body, environment, mount and operation injection refuse before execution',()=>{
  const {seccompBytes,...context}=syntheticEngineContext();
  for(const key of ['endpoint','path','query','headers','body','environment','mounts','command','enabled'])assert.throws(()=>compileProofDecoderEngineRequest({...context,operation:'START',[key]:'forbidden'}));
  for(const operation of ['EXEC','BUILD','PULL','PRUNE','CGROUP_KILL','START?checkpoint=bad'])assert.throws(()=>compileProofDecoderEngineRequest({...context,operation}));
  for(const version of [undefined,'1.46','1.47/../../','latest',47])assert.throws(()=>compileProofDecoderEngineRequest({...context,apiVersion:version,operation:'START'}));
  for(const key of ['name','containerId','image','ownerNonce','profileHash'])assert.throws(()=>compile('START',{...context,job:{...context.job,[key]:'../foreign?force=1'}}));
  assert.throws(()=>compile('START',syntheticEngineContext({created:false})));
  assert.throws(()=>compile('CREATE',syntheticEngineContext()));
  assert.throws(()=>compileProofDecoderEngineRequest({...context,operation:'START',seccompBytes}));
});
test('seccomp mismatch, malformed, duplicate-key, invalid UTF8 and oversized artifacts refuse',()=>{
  const context=syntheticEngineContext({created:false});
  assert.throws(()=>compile('CREATE',{...context,seccompBytes:Buffer.from('{}')}));
  const candidates=[Buffer.from('{"x":1,"x":2}'),Buffer.from('{"x":1,"\\u0078":2}'),Buffer.from('[]'),Buffer.from('{"bad":'),Buffer.from([0xff]),Buffer.alloc(65537,32)];
  for(const seccompBytes of candidates){const profile=structuredClone(context.plan.profile);profile.seccomp.sha256=digest(seccompBytes);const plan=createProofDecoderLaunchPlan({enabled:true,profile});assert.throws(()=>compile('CREATE',{...context,plan,job:{...context.job,profileHash:plan.profileHash},seccompBytes}));}
  let reads=0;const getter={...context,operation:'CREATE'};Object.defineProperty(getter,'seccompBytes',{enumerable:true,get(){reads++;return Buffer.from('{}');}});assert.throws(()=>compileProofDecoderEngineRequest(getter));assert.equal(reads,0);
});
test('seccomp whitespace compaction preserves original numeric and escaped-string lexemes',()=>{
  const context=syntheticEngineContext({created:false}),seccompBytes=Buffer.from('{ "syntheticInteger": 9007199254740993, "syntheticString": "space \\u0078" }');
  const profile=structuredClone(context.plan.profile);profile.seccomp.sha256=digest(seccompBytes);const plan=createProofDecoderLaunchPlan({enabled:true,profile});
  const request=compile('CREATE',{...context,plan,job:{...context.job,profileHash:plan.profileHash},seccompBytes});
  assert.ok(JSON.parse(request.http.body).HostConfig.SecurityOpt.includes('seccomp={"syntheticInteger":9007199254740993,"syntheticString":"space \\u0078"}'));
});
