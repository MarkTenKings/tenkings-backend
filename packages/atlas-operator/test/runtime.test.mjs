import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { openAiBinding } from '../src/provider.mjs';
import { machineInitializationExecutionClient, verifyMachineInitializationExecution, MACHINE_INITIALIZATION_EXECUTION_PATH,
    MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER } from '@atlas/service-bridge/machine-initialize-transport';
import { makeOperatorConfig } from '../src/policy.mjs';
import { productionOperatorConfig, executeOperatorRun, executeOperatorInitialization, INITIALIZATION_MS, RUNTIME_TOOLS, CONNECT_MS, RECEIPT_DRAIN_MS, DISCONNECT_MS } from '../src/runtime.mjs';
import { main, parseArguments, readReleaseManifest } from '../scripts/run.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; };
const flush = async () => { for (let i=0;i<100;i++) await Promise.resolve(); };
function fakeClock() {
    let time=0, serial=0; const timers=new Map();
    return { setTimeout(fn,ms) { const id=++serial; timers.set(id,{at:time+ms,fn}); return id; }, clearTimeout(id) { timers.delete(id); },
        async advance(ms) { const end=time+ms; await flush();
            for (;;) { const entry=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
                if (!entry) break; timers.delete(entry[0]);time=entry[1].at;entry[1].fn();await flush(); }
            time=end;await flush(); }, count:()=>timers.size };
}
function fixture() {
    const env={NODE_ENV:'production',ATLAS_OPERATOR_ENABLED:'true',ATLAS_OPERATOR_RELEASE_SHA:'a'.repeat(40),ATLAS_OPERATOR_BUILD_HASH:'b'.repeat(64),
        ATLAS_OPERATOR_DATABASE_URL:'postgresql://synthetic_machine:synthetic_password@db.invalid:5432/synthetic?schema=atlas_staff',
        ATLAS_OPERATOR_OPENAI_PROJECT_ID:'proj_fixture000000',ATLAS_OPERATOR_OPENAI_API_KEY:'sk-synthetic-fixture-key-only-00000000',
        ATLAS_OPERATOR_EVIDENCE_ORIGIN:'https://evidence.invalid',ATLAS_OPERATOR_EVIDENCE_KEY:Buffer.alloc(32,2).toString('base64')};
    const provider=openAiBinding(env), config=makeOperatorConfig({databaseUrl:env.ATLAS_OPERATOR_DATABASE_URL,mode:'PRODUCTION',
        releaseSha:env.ATLAS_OPERATOR_RELEASE_SHA,buildHash:env.ATLAS_OPERATOR_BUILD_HASH,providerBindingHash:provider.bindingHash});
    env.ATLAS_OPERATOR_RUNTIME_HASH=config.configHash;
    const manifest={version:'atlas-operator-release-v2',mode:'PRODUCTION',model:'gpt-6-astra',nodeVersion:process.version,
        releaseSha:config.releaseSha,buildHash:config.buildHash,runtimeHash:config.configHash,databaseBindingHash:digest(env.ATLAS_OPERATOR_DATABASE_URL),
        providerBindingHash:provider.bindingHash,imageBridge:{origin:env.ATLAS_OPERATOR_EVIDENCE_ORIGIN,keyHash:digest(Buffer.from(env.ATLAS_OPERATOR_EVIDENCE_KEY,'base64'))},tools:[...RUNTIME_TOOLS],machineInitialization:null};
    const input={env,manifest,manifestHash:digest(canonical(manifest)),runId:randomUUID()}, events=[], clock=fakeClock();
    const client={$connect:async()=>{events.push('connect');},$disconnect:async()=>{events.push('disconnect');}};
    const ledger={transaction:async work=>{events.push('authority');return work();},recordReceipt:async()=>{events.push('late-receipt');}};
    const dependencies={clock,verifyArtifact:async()=>({}),execArgv:[],createClient:url=>{assert.equal(url,env.ATLAS_OPERATOR_DATABASE_URL);events.push('client');return client;},
        createLedger:({client:actual,config:actualConfig})=>{assert.equal(actual,client);assert.deepEqual(actualConfig,config);return ledger;},
        makeEvidenceClient:settings=>{assert.equal(settings.origin,manifest.imageBridge.origin);assert.equal(settings.runtimeHash,config.configHash);events.push('evidence-client');return {synthetic:true};},
        makeAdapters:({evidenceClient})=>{assert(evidenceClient.synthetic);events.push('adapters');return Object.fromEntries(RUNTIME_TOOLS.map(name=>[name,{apply:()=>{}}]));},
        makeProvider:settings=>{assert.equal(settings.binding.bindingHash,provider.bindingHash);assert.equal(typeof settings.takeDispatch,'function');events.push('provider');return {synthetic:true};},
        run:async options=>{assert.equal(options.runId,input.runId);assert.equal(options.ledger.transaction instanceof Function,true);events.push('run');
            assert(options.createProvider({takeDispatch:async()=>{},signal:options.signal}).synthetic);
            return {runId:input.runId,state:'READY_FOR_HUMAN',code:null,stepsApplied:1,receiptWrites:[Promise.resolve({state:'PERSISTED'})]};}};
    return {input,env,manifest,config,events,clock,client,ledger,dependencies,rehash(){input.manifestHash=digest(canonical(manifest));},
        start(overrides={}){return executeOperatorRun(input,{...dependencies,...overrides});}};
}

test('production bindings preserve exact release, model, database, provider and image identities',()=>{
    const f=fixture(), c=productionOperatorConfig(f.input); assert.equal(c.config.configHash,f.manifest.runtimeHash);
    for (const key of ['ATLAS_OPERATOR_DATABASE_URL','ATLAS_OPERATOR_OPENAI_PROJECT_ID','ATLAS_OPERATOR_OPENAI_API_KEY','ATLAS_OPERATOR_EVIDENCE_ORIGIN','ATLAS_OPERATOR_EVIDENCE_KEY',
        'ATLAS_OPERATOR_RELEASE_SHA','ATLAS_OPERATOR_BUILD_HASH','ATLAS_OPERATOR_RUNTIME_HASH']) {
        assert.throws(()=>productionOperatorConfig({...f.input,env:{...f.env,[key]:undefined}}),key);
    }
});

test('disabled runtime fails before client, evidence adapter or provider construction',async()=>{
    const f=fixture();delete f.env.ATLAS_OPERATOR_ENABLED;const r=await f.start();
    assert.equal(r.state,'INACTIVE');assert.equal(r.exitCode,78);assert.deepEqual(f.events,[]);
});

test('ambient credentials do not fill a missing dedicated binding',async()=>{
    const f=fixture();f.env.DATABASE_URL=f.env.ATLAS_OPERATOR_DATABASE_URL;f.env.OPENAI_API_KEY=f.env.ATLAS_OPERATOR_OPENAI_API_KEY;
    f.env.ATLAS_GRADING_BRIDGE_KEY=f.env.ATLAS_OPERATOR_EVIDENCE_KEY;delete f.env.ATLAS_OPERATOR_DATABASE_URL;
    const r=await f.start();assert.equal(r.state,'CONFIGURATION_REJECTED');assert.deepEqual(f.events,[]);
});

test('manifest substitution, unknown fields, local mode, model aliases and different Node fail closed',async()=>{
    for (const change of [{model:'gpt-6-astra-latest'},{mode:'LOCAL_FIXTURE'},{nodeVersion:'v22.0.0'},{tools:['approve_report']},
        {buildHash:'c'.repeat(64)},{unexpected:true}]) {
        const f=fixture();Object.assign(f.manifest,change);f.rehash();const r=await f.start();
        assert.equal(r.state,'CONFIGURATION_REJECTED');assert.deepEqual(f.events,[]);
    }
    const f=fixture();f.manifest.imageBridge.origin='https://elsewhere.invalid';assert.equal((await f.start()).code,'ASTRA_RELEASE_MANIFEST_CHANGED');
    const g=fixture();g.env.ATLAS_LOCAL_SYNTHETIC='';assert.equal((await g.start()).state,'CONFIGURATION_REJECTED');
});

test('one exact admitted run uses current role validation before adapters and disconnects after receipts',async()=>{
    const f=fixture(),r=await f.start();assert.equal(r.state,'READY_FOR_HUMAN');assert.equal(r.exitCode,0);assert.equal(r.disconnect,'CLOSED');
    assert.deepEqual(r.receipts,{total:1,persisted:1,unconfirmed:0,pending:0});
    assert.deepEqual(f.events,['client','connect','authority','evidence-client','adapters','run','provider','disconnect']);assert.equal(f.clock.count(),0);
});

test('role or activation rejection cannot construct evidence adapters or dispatch',async()=>{
    const f=fixture();f.ledger.transaction=async()=>{throw Object.assign(new Error('secret database information'),{code:'ASTRA_DATABASE_ROLE_INVALID'});};
    const r=await f.start();assert.equal(r.exitCode,3);assert.equal(r.code,'ASTRA_DATABASE_ROLE_INVALID');
    assert.deepEqual(f.events,['client','connect','disconnect']);assert(!JSON.stringify(r).includes('secret database information'));
});

test('shutdown drains late receipts before disconnect even when the caller signal is already aborted',async()=>{
    const f=fixture(),gate=deferred(),controller=new AbortController();f.input.signal=controller.signal;
    const pending=f.start({run:async()=>{controller.abort();return {runId:f.input.runId,state:'RECONCILIATION_REQUIRED',code:'ASTRA_RUNNER_STOPPED',stepsApplied:0,receiptWrites:[gate.promise]};}});
    await flush();assert(!f.events.includes('disconnect'));gate.resolve({state:'PERSISTED'});const r=await pending;
    assert.equal(r.exitCode,3);assert.equal(r.receipts.persisted,1);assert.equal(f.events.at(-1),'disconnect');
});

test('receipt drain expiry reports attention, closes once and prevents a late Prisma reconnect',async()=>{
    const f=fixture(),gate=deferred();let guarded;
    const pending=f.start({run:async({ledger})=>{guarded=ledger;return {runId:f.input.runId,state:'READY_FOR_HUMAN',code:null,stepsApplied:1,receiptWrites:[gate.promise]};}});
    await flush();await f.clock.advance(RECEIPT_DRAIN_MS+1);const r=await pending;
    assert.equal(r.state,'RECONCILIATION_REQUIRED');assert.equal(r.exitCode,3);assert.equal(r.code,'ASTRA_RECEIPT_DRAIN_UNCONFIRMED');
    assert.equal(r.receipts.pending,1);assert.equal(f.events.filter(x=>x==='disconnect').length,1);
    assert.throws(()=>guarded.recordReceipt({}),/ASTRA_DATABASE_CLOSED/);gate.resolve({state:'PERSISTED'});await flush();assert(!f.events.includes('late-receipt'));
});

test('failed or rejected receipt settlement cannot report successful completion',async()=>{
    for (const value of [Promise.resolve({state:'UNCONFIRMED'}),Promise.resolve({state:'MADE_UP'})]) {
        const f=fixture();const r=await f.start({run:async()=>({runId:f.input.runId,state:'READY_FOR_HUMAN',stepsApplied:1,receiptWrites:[value]})});
        assert.equal(r.exitCode,3);assert.equal(r.receipts.unconfirmed,1);assert.equal(r.state,'RECONCILIATION_REQUIRED');
    }
});

test('connection and disconnect hangs have bounded cleanup with nonzero outcomes',async()=>{
    for (const phase of ['connect','disconnect']) {
        const f=fixture(),gate=deferred();f.client[phase==='connect'?'$connect':'$disconnect']=()=>gate.promise;
        const pending=f.start();await flush();await f.clock.advance((phase==='connect'?CONNECT_MS:DISCONNECT_MS)+1);const r=await pending;
        assert.equal(r.exitCode,3);if(phase==='disconnect')assert.equal(r.disconnect,'UNCONFIRMED');else assert(!f.events.includes('run'));
        gate.resolve();await flush();assert.equal(f.clock.count(),0);
    }
});

test('human attention dispositions and failed runs remain nonzero without implying approval',async()=>{
    for(const state of ['NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED']) {
        const f=fixture(),r=await f.start({run:async()=>({runId:f.input.runId,state,code:null,stepsApplied:0,receiptWrites:[]})});
        assert.equal(r.state,state);assert.equal(r.exitCode,2);assert.equal(r.disconnect,'CLOSED');
    }
});

test('untrusted exception text or malformed runner fields never enter the safe report',async()=>{
    const f=fixture(),secret=f.env.ATLAS_OPERATOR_OPENAI_API_KEY;
    const r=await f.start({run:async()=>({runId:f.input.runId,state:'MADE_UP',code:secret,stepsApplied:secret,receiptWrites:[]})});
    assert.equal(r.state,'RECONCILIATION_REQUIRED');assert.equal(r.stepsApplied,0);assert(!JSON.stringify(r).includes(secret));
    const g=fixture(),failed=await g.start({run:async()=>{throw new Error(g.env.ATLAS_OPERATOR_DATABASE_URL);}});
    assert.equal(failed.code,'ASTRA_RUNTIME_FAILED');assert(!JSON.stringify(failed).includes(g.env.ATLAS_OPERATOR_DATABASE_URL));
});

test('CLI accepts one exact run and manifest, rejecting discovery, module overrides and duplicated flags',()=>{
    const id=randomUUID(),args=['--run-id',id,'--manifest','/synthetic/release.json','--manifest-sha256','a'.repeat(64)];
    assert.equal(parseArguments(args).runId,id);
    for(const bad of [[],['--all'],[...args,'--module','evil.mjs'],['--run-id',id,'--run-id',id,'--manifest','/x'],
        ['--run-id',id,'--manifest','relative.json','--manifest-sha256','a'.repeat(64)]])assert.throws(()=>parseArguments(bad));
});

test('CLI disabled mode does not read a manifest or load generated Prisma code',async()=>{
    const f=fixture(),signals=new EventEmitter();let reads=0,loads=0;
    const r=await main(['--run-id',f.input.runId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash],{},
        {signals,readManifest:async()=>{reads++;},loadClient:async()=>{loads++;}});
    assert.equal(r.exitCode,78);assert.equal(reads,0);assert.equal(loads,0);assert.equal(signals.listenerCount('SIGTERM'),0);
});

test('CLI constructs the explicit dedicated datasource and forwards shutdown without exposing credentials',async()=>{
    const f=fixture(),signals=new EventEmitter();let options,seenSignal;
    const r=await main(['--run-id',f.input.runId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash],f.env,
        {signals,execArgv:[],readManifest:async()=>f.manifest,verifyArtifact:async()=>({runtimePath:'/synthetic/runtime.mjs',clientPath:'/synthetic/prisma.js',enginePath:'/synthetic/engine.node'}),
            loadRuntime:async()=>({productionOperatorConfig}),loadClient:async()=>({PrismaClient:class{constructor(value){options=value;}}}),
            execute:async(input,deps)=>{await deps.createClient(f.env.ATLAS_OPERATOR_DATABASE_URL);seenSignal=input.signal;signals.emit('SIGTERM');
                return {runId:input.runId,state:'RECONCILIATION_REQUIRED',exitCode:3};}});
    assert.equal(options.datasources.db.url,f.env.ATLAS_OPERATOR_DATABASE_URL);assert.deepEqual(options.log,[]);assert(seenSignal.aborted);
    assert.equal(r.exitCode,3);assert(!JSON.stringify(r).includes(f.env.ATLAS_OPERATOR_OPENAI_API_KEY));assert.equal(signals.listenerCount('SIGINT'),0);
});

test('manifest reader checks exact canonical bytes and rejects oversized data without importing it',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'atlas-runtime-unit-'));
    try {const path=join(directory,'manifest.json'),f=fixture(),body=canonical(f.manifest);await writeFile(path,body);
        assert.deepEqual(await readReleaseManifest(path,digest(body)),f.manifest);
        await assert.rejects(()=>readReleaseManifest(path,'f'.repeat(64)));
        await writeFile(path,`${body}\n`);await assert.rejects(()=>readReleaseManifest(path,digest(`${body}\n`)));
        const large=' '.repeat(20_000);await writeFile(path,large);await assert.rejects(()=>readReleaseManifest(path,digest(large)));
    } finally {await rm(directory,{recursive:true,force:true});}
});


test('runtime rejects an unverified artifact before any client or provider construction',async()=>{
    const f=fixture(),result=await f.start({verifyArtifact:async()=>{throw Object.assign(new Error('ASTRA_ARTIFACT_CHANGED'),{code:'ASTRA_ARTIFACT_CHANGED'});}});
    assert.equal(result.code,'ASTRA_ARTIFACT_CHANGED');assert.equal(result.state,'CONFIGURATION_REJECTED');assert.deepEqual(f.events,[]);
});
test('bootstrap verification precedes all runtime and generated client imports',async()=>{
    const f=fixture(),events=[];
    const result=await main(['--run-id',f.input.runId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash],f.env,
        {execArgv:[],signals:new EventEmitter(),readManifest:async()=>f.manifest,verifyArtifact:async()=>{events.push('verify');throw Object.assign(new Error('changed'),{code:'ASTRA_ARTIFACT_CHANGED'});},
            loadRuntime:async()=>{events.push('runtime');},loadClient:async()=>{events.push('client');}});
    assert.equal(result.code,'ASTRA_ARTIFACT_CHANGED');assert.deepEqual(events,['verify']);
});
test('code preloads and Prisma engine overrides fail before artifact import or database construction',async()=>{
    for(const key of ['NODE_OPTIONS','NODE_PATH','PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_CLIENT_ENGINE_TYPE','LD_PRELOAD','DEBUG']){
        const f=fixture();f.env[key]='synthetic-override';assert.equal((await f.start()).code,'ASTRA_RELEASE_PROCESS_UNSAFE');assert.deepEqual(f.events,[]);
    }
    const f=fixture();assert.equal((await f.start({execArgv:['--import','evil.mjs']})).code,'ASTRA_RELEASE_PROCESS_UNSAFE');
});

test('OpenSSL startup and ambient CA overrides fail before bootstrap imports, run clients or initialization calls',async()=>{
    for(const key of ['OPENSSL_CONF','OPENSSL_MODULES','OPENSSL_ENGINES','SSL_CERT_FILE','SSL_CERT_DIR']) {
        for(const value of ['', '/synthetic/unopened-override']) {
            const f=fixture();f.env[key]=value;
            assert.equal((await f.start()).code,'ASTRA_RELEASE_PROCESS_UNSAFE',key);assert.deepEqual(f.events,[]);
            const initialization=initializationFixture();initialization.env[key]=value;
            assert.equal((await initialization.start()).code,'ASTRA_RELEASE_PROCESS_UNSAFE',key);assert.deepEqual(initialization.events,[]);
            const bootstrapEvents=[];
            const result=await main(['--run-id',f.input.runId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash],f.env,
                {execArgv:[],signals:new EventEmitter(),readManifest:async()=>{bootstrapEvents.push('manifest');return f.manifest;},
                    verifyArtifact:async()=>{bootstrapEvents.push('verify');},loadRuntime:async()=>{bootstrapEvents.push('runtime');},loadClient:async()=>{bootstrapEvents.push('client');}});
            assert.equal(result.code,'ASTRA_RELEASE_PROCESS_UNSAFE',key);assert.deepEqual(bootstrapEvents,[]);
        }
    }
});

function initializationFixture() {
    const f=fixture(),initializationId=randomUUID();
    Object.assign(f.env,{ATLAS_MACHINE_INITIALIZATION_ENABLED:'true',ATLAS_MACHINE_INITIALIZATION_ORIGIN:'https://initialize.invalid',
        ATLAS_MACHINE_EXECUTION_KEY:Buffer.alloc(32,7).toString('base64'),ATLAS_MACHINE_ADMISSION_KEY_HASH:digest(Buffer.alloc(32,8))});
    f.manifest.machineInitialization={origin:f.env.ATLAS_MACHINE_INITIALIZATION_ORIGIN,runtimeHash:f.config.configHash,
        admissionKeyHash:f.env.ATLAS_MACHINE_ADMISSION_KEY_HASH,executionKeyHash:digest(Buffer.alloc(32,7))};f.rehash();
    const {runId,...rest}=f.input,input={...rest,initializationId};
    const reply={jobId:initializationId,runtimeHash:f.config.configHash,state:'SUCCEEDED',analysisRevision:1,operatorRunId:runId};
    const link={id:runId,initializationId,runtimeHash:f.config.configHash};
    f.ledger.transaction=async work=>{f.events.push('authority');return work({tx:{staffOperatorRun:{findUnique:async({where})=>{assert.equal(where.id,runId);return link;}}}});};
    const client={binding:{origin:f.env.ATLAS_MACHINE_INITIALIZATION_ORIGIN,runtimeHash:f.config.configHash,
        admissionKeyHash:f.manifest.machineInitialization.admissionKeyHash,executionKeyHash:f.manifest.machineInitialization.executionKeyHash},
        execute:async(value,{signal})=>{f.events.push('private-execute');assert.deepEqual(value,{jobId:initializationId,runtimeHash:f.config.configHash});assert(!signal.aborted);return reply;}};
    const dependencies={...f.dependencies,verifyArtifact:async()=>{f.events.push('verify');return {};},makeInitializationClient:config=>{
        assert(!Object.hasOwn(config,'admissionKey'));assert.deepEqual(config.executionKey,Buffer.alloc(32,7));f.events.push('initialization-client');return client;}};
    return {...f,input,reply,client,link,initializationId,dependencies,start:overrides=>executeOperatorInitialization(input,{...dependencies,...overrides})};
}

test('one successful exact initialization reaches only its linked durable run after verification and current ledger authority',async()=>{
    const f=initializationFixture(),result=await f.start();
    assert.equal(result.runId,f.reply.operatorRunId);assert.equal(result.initializationId,f.initializationId);assert.equal(result.initializationState,'SUCCEEDED');
    assert.equal(result.state,'READY_FOR_HUMAN');assert.equal(result.exitCode,0);
    assert.deepEqual(f.events,['verify','initialization-client','private-execute','verify','client','connect','authority','evidence-client','adapters','run','provider','disconnect']);
});
test('unknown failed wrong-job wrong-runtime and malformed initialization replies cannot construct an operator provider',async()=>{
    for(const changed of [{state:'UNKNOWN'},{state:'FAILED'},{jobId:randomUUID()},{runtimeHash:'0'.repeat(64)},
        {analysisRevision:2},{operatorRunId:'arbitrary-run'},{extra:'untrusted result'}]){
        const f=initializationFixture();Object.assign(f.reply,changed);
        if(['UNKNOWN','FAILED'].includes(f.reply.state)){delete f.reply.analysisRevision;delete f.reply.operatorRunId;}
        const result=await f.start();assert.notEqual(result.exitCode,0);assert.equal(result.initializationId,f.initializationId);
        assert(!f.events.includes('client'));assert(!f.events.includes('provider'));assert(!f.events.includes('run'));
        assert.equal(f.events.filter(event=>event==='private-execute').length,1);
    }
});
test('successful initialization without a durable run id preserves the job for explicit same-job recovery',async()=>{
    const f=initializationFixture(),saved=f.reply.operatorRunId;delete f.reply.operatorRunId;
    const result=await f.start();assert.equal(result.state,'RECONCILIATION_REQUIRED');assert.equal(result.code,'ASTRA_OPERATOR_RUN_UNCONFIRMED');
    assert.equal(result.initializationState,'SUCCEEDED');assert.equal(result.initializationId,f.initializationId);assert.equal(result.runId,null);
    assert(!f.events.includes('provider'));assert(!f.events.includes('client'));
    f.reply.operatorRunId=saved;const recovered=await f.start();assert.equal(recovered.initializationId,f.initializationId);assert.equal(recovered.runId,saved);
    assert.equal(f.events.filter(event=>event==='private-execute').length,2);assert.equal(f.events.filter(event=>event==='provider').length,1);
});
test('aborted initialization never starts a private call and abort during a call remains unknown without retry',async()=>{
    const before=initializationFixture(),first=new AbortController();first.abort();before.input.signal=first.signal;
    const stopped=await before.start();assert.equal(stopped.initializationState,'NOT_STARTED');assert.equal(stopped.state,'NOT_STARTED');
    assert(!before.events.includes('private-execute'));assert(!before.events.includes('client'));
    const f=initializationFixture(),controller=new AbortController(),gate=deferred();f.input.signal=controller.signal;let observed;
    f.client.execute=async(_,{signal})=>{f.events.push('private-execute');observed=signal;return gate.promise;};
    const pending=f.start();await flush();controller.abort();const result=await pending;
    assert.equal(result.initializationState,'UNKNOWN');assert.equal(result.initializationId,f.initializationId);assert.equal(result.exitCode,3);assert(observed.aborted);
    gate.resolve(f.reply);await flush();assert(!f.events.includes('client'));assert(!f.events.includes('provider'));assert.equal(f.events.filter(e=>e==='private-execute').length,1);
});
test('uncooperative execution transport is bounded and a very late success never starts Astra',async()=>{
    const f=initializationFixture(),gate=deferred();let signal;
    f.client.execute=async(_,{signal:observed})=>{f.events.push('private-execute');signal=observed;return gate.promise;};
    const pending=f.start();await flush();await f.clock.advance(INITIALIZATION_MS+1);const result=await pending;
    assert.equal(result.code,'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED');assert.equal(result.runId,null);assert.equal(result.initializationId,f.initializationId);
    assert.equal(result.initializationState,'UNKNOWN');assert(signal.aborted);assert.equal(f.clock.count(),0);
    gate.resolve(f.reply);await flush();assert(!f.events.includes('provider'));assert(!f.events.includes('client'));
});
test('lost private reply exposes neither exception text nor a claim that worker cost was zero',async()=>{
    const f=initializationFixture();f.client.execute=async()=>{f.events.push('private-execute');throw Error(f.env.ATLAS_MACHINE_EXECUTION_KEY);};
    const result=await f.start();assert.equal(result.initializationState,'UNKNOWN');assert.equal(result.exitCode,3);
    assert.equal(result.initializationId,f.initializationId);assert.equal(result.runId,null);assert(!JSON.stringify(result).includes(f.env.ATLAS_MACHINE_EXECUTION_KEY));
    assert(!Object.hasOwn(result,'cost'));assert(!Object.hasOwn(result,'charged'));assert(!f.events.includes('client'));
});
test('wrong durable initialization/run association is rejected before evidence adapter and provider construction',async()=>{
    const f=initializationFixture();f.link.initializationId=randomUUID();const result=await f.start();
    assert.equal(result.code,'ASTRA_INITIALIZATION_RUN_MISMATCH');assert.equal(result.initializationState,'SUCCEEDED');assert.equal(result.state,'RECONCILIATION_REQUIRED');
    assert(!f.events.includes('provider'));assert(!f.events.includes('evidence-client'));assert(!f.events.includes('run'));assert.equal(f.events.at(-1),'disconnect');
});
test('manifest v2 pins distinct execution-only keys origin and runtime, and rejects admission key presence on either path',async()=>{
    for(const change of [f=>{f.env.ATLAS_MACHINE_EXECUTION_KEY=Buffer.alloc(32,9).toString('base64');},
        f=>{f.env.ATLAS_MACHINE_ADMISSION_KEY_HASH='1'.repeat(64);},f=>{f.env.ATLAS_MACHINE_INITIALIZATION_ORIGIN='https://wrong.invalid';},
        f=>{f.manifest.machineInitialization.runtimeHash='1'.repeat(64);f.input.manifestHash=digest(canonical(f.manifest));},
        f=>{f.env.ATLAS_MACHINE_INITIALIZATION_ENABLED='false';}]){
        const f=initializationFixture();change(f);const result=await f.start();assert.equal(result.state,'CONFIGURATION_REJECTED');assert(!f.events.includes('private-execute'));
    }
    for(const value of [undefined,'',Buffer.alloc(32,8).toString('base64')]){
        const f=initializationFixture();f.env.ATLAS_MACHINE_ADMISSION_KEY=value;assert.equal((await f.start()).code,'ASTRA_ADMISSION_KEY_FORBIDDEN');
        const run=fixture();run.env.ATLAS_MACHINE_ADMISSION_KEY=value;assert.equal((await run.start()).code,'ASTRA_ADMISSION_KEY_FORBIDDEN');
    }
    const f=initializationFixture();f.input.runId=randomUUID();assert.equal((await f.start()).code,'ASTRA_INITIALIZATION_ID_REQUIRED');assert(!f.events.includes('private-execute'));
});
test('CLI accepts exactly one initialization ID or run ID and preserves job identity on uncertain execution failure',async()=>{
    const f=initializationFixture(),args=['--initialization-id',f.initializationId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash];
    assert.equal(parseArguments(args).initializationId,f.initializationId);assert(!Object.hasOwn(parseArguments(args),'runId'));
    assert.throws(()=>parseArguments([...args,'--run-id',randomUUID()]));
    let loads=0,privateCalls=0;
    const result=await main(args,f.env,{signals:new EventEmitter(),execArgv:[],readManifest:async()=>f.manifest,
        verifyArtifact:async()=>({runtimePath:'/verified/runtime.mjs',clientPath:'/verified/client.js',enginePath:'/verified/engine.node'}),
        loadRuntime:async()=>({productionOperatorConfig}),loadClient:async()=>{loads++;},
        executeInitialization:async input=>{privateCalls++;assert.equal(input.initializationId,f.initializationId);assert(!Object.hasOwn(input,'runId'));throw Error('uncertain');}});
    assert.equal(loads,0);assert.equal(privateCalls,1);assert.equal(result.state,'RECONCILIATION_REQUIRED');assert.equal(result.initializationState,'UNKNOWN');assert.equal(result.initializationId,f.initializationId);
});


test('runtime composes the actual execution-only HMAC client with one fixed private request and no admission key',async()=>{
    const f=initializationFixture();let calls=0;
    const result=await f.start({makeInitializationClient:config=>machineInitializationExecutionClient(config,async(url,options)=>{
        calls++;assert.equal(url,`${f.env.ATLAS_MACHINE_INITIALIZATION_ORIGIN}${MACHINE_INITIALIZATION_EXECUTION_PATH}`);
        assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert(!Object.hasOwn(config,'admissionKey'));
        const packet=verifyMachineInitializationExecution(config,options.body,options.headers[MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER]);
        assert.deepEqual(packet.input,{jobId:f.initializationId,runtimeHash:f.config.configHash});
        assert.equal(packet.expiresAt-packet.issuedAt,30_000);assert(!Object.hasOwn(packet,'scope'));
        return new Response(canonical(f.reply),{status:200,headers:{'content-type':'application/json'}});
    })});
    assert.equal(calls,1);assert.equal(result.state,'READY_FOR_HUMAN');assert.equal(result.initializationState,'SUCCEEDED');
});
test('CLI unknown failed and signal-aborted initialization never import or construct a Prisma client or provider',async()=>{
    for(const state of ['UNKNOWN','FAILED','ABORTED']){
        const f=initializationFixture(),signals=new EventEmitter();let imports=0;
        if(state==='ABORTED')f.client.execute=async()=>{f.events.push('private-execute');signals.emit('SIGTERM');return f.reply;};
        else {f.reply.state=state;delete f.reply.operatorRunId;delete f.reply.analysisRevision;}
        const args=['--initialization-id',f.initializationId,'--manifest','/synthetic/release.json','--manifest-sha256',f.input.manifestHash];
        const result=await main(args,f.env,{signals,execArgv:[],readManifest:async()=>f.manifest,
            verifyArtifact:async()=>({runtimePath:'/verified/runtime.mjs',clientPath:'/verified/client.js',enginePath:'/verified/engine.node'}),
            loadRuntime:async()=>({productionOperatorConfig}),loadClient:async()=>{imports++;throw Error('MUST_NOT_LOAD_CLIENT');},
            executeInitialization:(input,deps)=>executeOperatorInitialization(input,{...f.dependencies,...deps})});
        assert.equal(imports,0);assert.equal(result.initializationState,state==='ABORTED'?'UNKNOWN':state);assert.equal(result.initializationId,f.initializationId);
        assert.equal(signals.listenerCount('SIGTERM'),0);
        assert(!f.events.includes('provider'));assert(!f.events.includes('run'));assert.equal(f.events.filter(e=>e==='private-execute').length,1);
    }
});
