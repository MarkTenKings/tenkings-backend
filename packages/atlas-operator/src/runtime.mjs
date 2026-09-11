import { verifyOperatorArtifact, assertReleaseProcess, SUPPORTED_NODE_VERSIONS } from './release-artifact.mjs';
import { canonical, digest, keys, keyBytes, bridgeOrigin, requireBridge as check, SHA, UUID } from '@atlas/service-bridge/protocol';
import { operatorEvidenceClient } from '@atlas/service-bridge/operator-evidence';
import { makeMachineInitializationExecutionConfig, machineInitializationExecutionClient } from '@atlas/service-bridge/machine-initialize-transport';
import { MODEL } from './responses.mjs';
import { CAPTURE_TOOL_NAMES } from './capture-protocol.mjs';
import { makeOperatorConfig } from './policy.mjs';
import { OperatorLedger } from './ledger.mjs';
import { openAiBinding, responsesTransport } from './provider.mjs';
import { operatorAdapters } from './adapters.mjs';
import { runOperator, reportOperatorFailure } from './runner.mjs';
import { performance } from 'node:perf_hooks';

export const RUNTIME_TOOLS = Object.freeze(['read_card_report','inspect_region','inspect_card_geometry','measure_centering','inspect_finding',
    'propose_identity','propose_finding_change','submit_for_human_review',...CAPTURE_TOOL_NAMES.filter(name=>name!=='inspect_region')]);
export const INITIALIZATION_MS = 220_000;
export const CONNECT_MS = 15_000, RECEIPT_DRAIN_MS = 30_000, DISCONNECT_MS = 15_000;
const timers = { setTimeout, clearTimeout };
const codeOf = error => /^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code) ? error.code : 'ASTRA_RUNTIME_FAILED';
const hash = value => typeof value === 'string' && SHA.test(value);
const safeSteps = value => Number.isSafeInteger(value) && value >= 0 && value <= 64 ? value : 0;

/** The offline producer supplies this canonical manifest and independent SHA.
 * buildHash identifies the exact read-only runtime/Prisma/native/Node inventory.
 * The bootstrap verifies the artifact before importing this runtime; execution
 * verifies again before constructing a client. It is not an activation command.
 */
export function productionOperatorConfig({ env, manifest, manifestHash, nodeVersion = process.version }) {
    check(env?.ATLAS_OPERATOR_ENABLED === 'true', 'ASTRA_RUNTIME_INACTIVE');
    check(!Object.hasOwn(env, 'ATLAS_MACHINE_ADMISSION_KEY'), 'ASTRA_ADMISSION_KEY_FORBIDDEN');
    check(env.NODE_ENV === 'production' && !Object.keys(env).some(key => key.startsWith('ATLAS_LOCAL_')),
        'ASTRA_PRODUCTION_RUNTIME_REQUIRED');
    check(hash(manifestHash) && digest(canonical(manifest)) === manifestHash, 'ASTRA_RELEASE_MANIFEST_CHANGED');
    keys(manifest, ['version','mode','model','nodeVersion','releaseSha','buildHash','runtimeHash','databaseBindingHash',
        'providerBindingHash','imageBridge','machineInitialization','tools']);
    keys(manifest.imageBridge, ['origin','keyHash']);
    check(manifest.version === 'atlas-operator-release-v2' && manifest.mode === 'PRODUCTION' && manifest.model === MODEL
        && SUPPORTED_NODE_VERSIONS.includes(manifest.nodeVersion) && manifest.nodeVersion === nodeVersion
        && /^[a-f0-9]{40}$/.test(manifest.releaseSha) && manifest.releaseSha !== '0'.repeat(40)
        && ['buildHash','runtimeHash','databaseBindingHash','providerBindingHash'].every(key => hash(manifest[key]))
        && hash(manifest.imageBridge.keyHash) && canonical(manifest.tools) === canonical(RUNTIME_TOOLS), 'ASTRA_RELEASE_MANIFEST_INVALID');
    check(env.ATLAS_OPERATOR_RELEASE_SHA === manifest.releaseSha && env.ATLAS_OPERATOR_BUILD_HASH === manifest.buildHash
        && env.ATLAS_OPERATOR_RUNTIME_HASH === manifest.runtimeHash, 'ASTRA_RELEASE_CONFIGURATION_CHANGED');
    const databaseUrl = env.ATLAS_OPERATOR_DATABASE_URL;
    check(typeof databaseUrl === 'string' && databaseUrl.length <= 4096 && digest(databaseUrl) === manifest.databaseBindingHash,
        'ASTRA_DATABASE_BINDING_CHANGED');
    const provider = openAiBinding(env);
    check(provider.bindingHash === manifest.providerBindingHash, 'ASTRA_PROVIDER_BINDING_CHANGED');
    const imageOrigin = bridgeOrigin(env.ATLAS_OPERATOR_EVIDENCE_ORIGIN), imageKey = keyBytes(env.ATLAS_OPERATOR_EVIDENCE_KEY);
    check(imageOrigin === manifest.imageBridge.origin && digest(imageKey) === manifest.imageBridge.keyHash,
        'ASTRA_IMAGE_BRIDGE_BINDING_CHANGED');
    const config = makeOperatorConfig({ databaseUrl, mode: 'PRODUCTION', releaseSha: manifest.releaseSha,
        buildHash: manifest.buildHash, providerBindingHash: provider.bindingHash });
    check(config.configHash === manifest.runtimeHash, 'ASTRA_RUNTIME_BINDING_CHANGED');
    let initialization = null;
    if (manifest.machineInitialization !== null) {
        const binding = manifest.machineInitialization;
        keys(binding, ['origin','runtimeHash','admissionKeyHash','executionKeyHash']);
        check(binding.runtimeHash === config.configHash && [binding.admissionKeyHash,binding.executionKeyHash].every(hash)
            && binding.admissionKeyHash !== binding.executionKeyHash && binding.admissionKeyHash !== digest(imageKey),
        'ASTRA_INITIALIZATION_BINDING_CHANGED');
        initialization = makeMachineInitializationExecutionConfig({ mode: 'PRODUCTION',
            origin: bridgeOrigin(env.ATLAS_MACHINE_INITIALIZATION_ORIGIN), runtimeHash: config.configHash,
            key: keyBytes(env.ATLAS_MACHINE_EXECUTION_KEY), peerKeyHash: env.ATLAS_MACHINE_ADMISSION_KEY_HASH,
            otherKeyHashes: [digest(imageKey)] });
        check(initialization.origin === binding.origin && initialization.admissionKeyHash === binding.admissionKeyHash
            && initialization.executionKeyHash === binding.executionKeyHash && !Object.hasOwn(initialization,'admissionKey'),
        'ASTRA_INITIALIZATION_BINDING_CHANGED');
    } else check(['ATLAS_MACHINE_EXECUTION_KEY','ATLAS_MACHINE_ADMISSION_KEY_HASH','ATLAS_MACHINE_INITIALIZATION_ORIGIN']
        .every(key => !Object.hasOwn(env,key)), 'ASTRA_INITIALIZATION_BINDING_CHANGED');
    return { config, databaseUrl, provider, initialization, image: { origin: imageOrigin, key: imageKey, runtimeHash: config.configHash } };
}

async function bounded(promise, ms, clock) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
        timer = clock.setTimeout(() => reject(Object.assign(new Error('ASTRA_SHUTDOWN_TIMEOUT'), { code: 'ASTRA_SHUTDOWN_TIMEOUT' })), ms);
    })]); } finally { clock.clearTimeout(timer); }
}

/** Single already-admitted run only. Injection ports are for tests/packaging,
 * never environment-selected modules or model-controlled adapters. No intake,
 * activation, polling, retry, outbox delivery, invoice or human authority here.
 * All return values are deliberately projected; no exception text/credentials,
 * provider receipts, model text or private image URLs enter the CLI report.
 */
export async function executeOperatorRun({ env, manifest, manifestHash, runId, signal, artifactRoot, expectedInitializationId, expectedControlRevision }, {
    createClient, createLedger = value => new OperatorLedger(value),
    makeEvidenceClient = operatorEvidenceClient, makeAdapters = operatorAdapters,
    makeProvider = responsesTransport, run = runOperator, clock = timers, nodeVersion = process.version,
    verifyArtifact = verifyOperatorArtifact, execArgv = process.execArgv, onDiagnostic,
} = {}) {
    let configuration, client, databaseOpen = false, connected = false, result, failureCode = null;
    let phase = 'CONFIGURATION', disconnect = 'NOT_OPENED';
    const now = () => typeof clock.now === 'function' ? clock.now() : performance.now();
    let phaseStartedAt = now();
    const enterPhase = name => { phase = name; phaseStartedAt = now(); };
    const receiptStates = [];
    try {
        check(typeof runId === 'string' && UUID.test(runId), 'ASTRA_RUN_ID_REQUIRED');
        check(expectedInitializationId === undefined || typeof expectedInitializationId === 'string' && UUID.test(expectedInitializationId),
            'ASTRA_INITIALIZATION_ID_REQUIRED');
        check(expectedControlRevision === undefined || Number.isSafeInteger(expectedControlRevision) && expectedControlRevision > 0,
            'ASTRA_CONTROL_REVISION_REQUIRED');
        configuration = productionOperatorConfig({ env, manifest, manifestHash, nodeVersion });
        assertReleaseProcess({ env, execArgv });
        await verifyArtifact({ root: artifactRoot, expectedBuildHash: manifest.buildHash });
        check(typeof createClient === 'function', 'ASTRA_DATABASE_CLIENT_REQUIRED');
        if (signal?.aborted) return { runId, state: 'NOT_STARTED', code: 'ASTRA_RUNNER_STOPPED', stepsApplied: 0,
            receipts: { total: 0, persisted: 0, unconfirmed: 0, pending: 0 }, disconnect, exitCode: 2 };
        // The factory constructs a dedicated client with an explicit datasource;
        // it must not connect or obtain credentials on its own.
        client = await createClient(configuration.databaseUrl);
        check(client && typeof client.$connect === 'function' && typeof client.$disconnect === 'function', 'ASTRA_DATABASE_CLIENT_REQUIRED');
        enterPhase('CONNECT'); await bounded(Promise.resolve().then(() => client.$connect()), CONNECT_MS, clock);
        connected = true; databaseOpen = true;
        const ledger = createLedger({ client, config: configuration.config, ...(expectedControlRevision === undefined ? {} : {
            expectedClaim: { runId, controlRevision: expectedControlRevision },
        }) });
        // Includes the exact role/grant assertion and current deployment/pilot
        // authority, before even constructing evidence/provider adapters.
        enterPhase('ADMISSION'); await bounded(ledger.transaction(async context => {
            if (expectedInitializationId !== undefined) {
                const row = await context.tx.staffOperatorRun.findUnique({ where: { id: runId } });
                check(row && row.id === runId && row.initializationId === expectedInitializationId
                    && row.runtimeHash === configuration.config.configHash, 'ASTRA_INITIALIZATION_RUN_MISMATCH');
            }
        }), CONNECT_MS, clock);
        if (signal?.aborted) { result = { state: 'NOT_STARTED', code: 'ASTRA_RUNNER_STOPPED', stepsApplied: 0, receiptWrites: [] }; }
        else {
            const evidenceClient = makeEvidenceClient(configuration.image);
            const adapters = makeAdapters({ evidenceClient });
            check(canonical(Object.keys(adapters).sort()) === canonical([...RUNTIME_TOOLS].sort()), 'ASTRA_ADAPTER_NOT_ADMITTED');
            // A very late response must not reopen Prisma after bounded drain
            // and disconnect. Calls already in flight retain ledger timeouts.
            const guardedLedger = new Proxy(ledger, { get(target, name) {
                const value = target[name];
                return typeof value !== 'function' ? value : (...args) => {
                    check(databaseOpen, 'ASTRA_DATABASE_CLOSED'); return value.apply(target, args);
                };
            } });
            enterPhase('RUN'); result = await run({ ledger: guardedLedger, runId, adapters, signal, onDiagnostic,
                createProvider: ({ takeDispatch, signal: runSignal }) => makeProvider({ binding: configuration.provider,
                    takeDispatch, signal: runSignal }) });
            check(result && result.runId === runId && ['READY_FOR_HUMAN','PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED',
                'NOT_CLAIMED','RECONCILIATION_REQUIRED','PAUSED','TAKEN_OVER'].includes(result.state)
                && Number.isSafeInteger(result.stepsApplied) && result.stepsApplied >= 0 && result.stepsApplied <= 64
                && Array.isArray(result.receiptWrites) && result.receiptWrites.length <= 100, 'ASTRA_RUN_RESULT_INVALID');
        }
        enterPhase('DRAIN');
        const writes = result.receiptWrites.map((write, index) => {
            receiptStates[index] = 'PENDING';
            return Promise.resolve(write).then(value => {
                receiptStates[index] = value?.state === 'PERSISTED' ? 'PERSISTED' : 'UNCONFIRMED';
            }, () => { receiptStates[index] = 'UNCONFIRMED'; });
        });
        await bounded(Promise.all(writes), RECEIPT_DRAIN_MS, clock);
        if (receiptStates.some(state => state !== 'PERSISTED')) failureCode = 'ASTRA_RECEIPT_DRAIN_UNCONFIRMED';
    } catch (error) {
        reportOperatorFailure(onDiagnostic, { runId, phase: 'RUNTIME', operation: phase, error, elapsedMs: now() - phaseStartedAt });
        failureCode = phase === 'DRAIN' ? 'ASTRA_RECEIPT_DRAIN_UNCONFIRMED' : codeOf(error);
    } finally {
        databaseOpen = false;
        if (client && typeof client.$disconnect === 'function') {
            const disconnectStartedAt = now();
            try { await bounded(Promise.resolve().then(() => client.$disconnect()), DISCONNECT_MS, clock); disconnect = 'CLOSED'; }
            catch (error) {
                reportOperatorFailure(onDiagnostic, { runId, phase: 'RUNTIME', operation: 'DISCONNECT', error, elapsedMs: now() - disconnectStartedAt });
                disconnect = 'UNCONFIRMED'; failureCode = 'ASTRA_DATABASE_DISCONNECT_UNCONFIRMED';
            }
        }
    }
    const receipts = { total: receiptStates.length, persisted: receiptStates.filter(s => s === 'PERSISTED').length,
        unconfirmed: receiptStates.filter(s => s === 'UNCONFIRMED').length, pending: receiptStates.filter(s => s === 'PENDING').length };
    if (failureCode) {
        const inactive = failureCode === 'ASTRA_RUNTIME_INACTIVE';
        return { runId: typeof runId === 'string' && UUID.test(runId) ? runId : null,
            state: phase === 'CONFIGURATION' ? (inactive ? 'INACTIVE' : 'CONFIGURATION_REJECTED') : 'RECONCILIATION_REQUIRED',
            code: failureCode, stepsApplied: safeSteps(result?.stepsApplied), receipts, disconnect,
            exitCode: phase === 'CONFIGURATION' ? (inactive ? 78 : 64) : 3 };
    }
    return { runId, state: result?.state ?? (connected ? 'RECONCILIATION_REQUIRED' : 'NOT_STARTED'),
        code: result?.code && /^ASTRA_[A-Z0-9_]{1,74}$/.test(result.code) ? result.code : null,
        stepsApplied: safeSteps(result?.stepsApplied), receipts, disconnect,
        exitCode: ['READY_FOR_HUMAN','PREPARATION_READY'].includes(result?.state) ? 0 : result?.state === 'RECONCILIATION_REQUIRED' ? 3 : 2 };
}


const initializationProjection = (initializationId, initializationState, state, code, exitCode, runId = null) => ({
    initializationId: typeof initializationId === 'string' && UUID.test(initializationId) ? initializationId : null,
    initializationState, runId, state, code, stepsApplied: 0,
    receipts: { total: 0, persisted: 0, unconfirmed: 0, pending: 0 }, disconnect: 'NOT_OPENED', exitCode,
});

/** One already-admitted machine job, one execution-only HTTP call. A lost reply
 * has no automatic retry or local inference. The explicit same job can later be
 * replayed through the private service's durable idempotency. Only its exact
 * successful reply may supply the next operator run; caller run IDs are denied.
 */
export async function executeOperatorInitialization(input, {
    makeInitializationClient = machineInitializationExecutionClient, executeRun = executeOperatorRun,
    verifyArtifact = verifyOperatorArtifact, nodeVersion = process.version, execArgv = process.execArgv,
    clock = timers, ...runDependencies
} = {}) {
    const { env, manifest, manifestHash, initializationId, signal, artifactRoot } = input;
    let phase = 'CONFIGURATION', initializedRunId = null, configuration, initializationState = 'NOT_STARTED';
    try {
        check(typeof initializationId === 'string' && UUID.test(initializationId) && !Object.hasOwn(input,'runId'), 'ASTRA_INITIALIZATION_ID_REQUIRED');
        configuration = productionOperatorConfig({ env, manifest, manifestHash, nodeVersion });
        assertReleaseProcess({ env, execArgv });
        await verifyArtifact({ root: artifactRoot, expectedBuildHash: manifest.buildHash });
        check(configuration.initialization && env.ATLAS_MACHINE_INITIALIZATION_ENABLED === 'true', 'ASTRA_INITIALIZATION_NOT_ENABLED');
        if (signal?.aborted) return initializationProjection(initializationId,'NOT_STARTED','NOT_STARTED','ASTRA_RUNNER_STOPPED',2);
        const client = makeInitializationClient(configuration.initialization);
        check(client && typeof client.execute === 'function' && canonical(Object.keys(client).sort()) === canonical(['binding','execute'])
            && canonical(client.binding) === canonical({origin:configuration.initialization.origin,runtimeHash:configuration.config.configHash,
                admissionKeyHash:configuration.initialization.admissionKeyHash,executionKeyHash:configuration.initialization.executionKeyHash}),
        'ASTRA_INITIALIZATION_CLIENT_INVALID');
        const controller = new AbortController(); let timer, rejectStopped;
        const stopped = new Promise((_, reject) => { rejectStopped = reject; }); stopped.catch(() => {});
        const abort = () => { controller.abort(); rejectStopped(Object.assign(new Error('ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED'),
            {code:'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED'})); };
        signal?.addEventListener('abort',abort,{once:true});
        let reply;
        try {
            if (signal?.aborted) return initializationProjection(initializationId,'NOT_STARTED','NOT_STARTED','ASTRA_RUNNER_STOPPED',2);
            controller.signal.throwIfAborted();
            timer = clock.setTimeout(abort,INITIALIZATION_MS);
            // Once this call is entered, any lost/aborted outcome is uncertain:
            // it may have committed and may have consumed the worker budget.
            phase = 'INITIALIZATION'; initializationState = 'UNKNOWN';
            reply = await Promise.race([stopped, Promise.resolve().then(() => {
                controller.signal.throwIfAborted();
                return client.execute({jobId:initializationId,runtimeHash:configuration.config.configHash},{signal:controller.signal});
            })]);
            controller.signal.throwIfAborted();
        } finally { if(timer!==undefined)clock.clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort(); }
        check(reply && reply.jobId === initializationId && reply.runtimeHash === configuration.config.configHash
            && ['SUCCEEDED','UNKNOWN','FAILED'].includes(reply.state), 'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED');
        keys(reply,['jobId','runtimeHash','state',...(reply.state==='SUCCEEDED'?['analysisRevision']:[]),
            ...(Object.hasOwn(reply,'operatorRunId')?['operatorRunId']:[])]);
        check(!Object.hasOwn(reply,'operatorRunId') || reply.state==='SUCCEEDED' && typeof reply.operatorRunId==='string' && UUID.test(reply.operatorRunId),
            'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED');
        if (reply.state === 'UNKNOWN') return initializationProjection(initializationId,'UNKNOWN','RECONCILIATION_REQUIRED','ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED',3);
        if (reply.state === 'FAILED') return initializationProjection(initializationId,'FAILED','FAILED','ASTRA_INITIALIZATION_FAILED',2);
        check(reply.analysisRevision === 1, 'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED');
        initializationState = 'SUCCEEDED';
        if (!reply.operatorRunId) return initializationProjection(initializationId,'SUCCEEDED','RECONCILIATION_REQUIRED','ASTRA_OPERATOR_RUN_UNCONFIRMED',3);
        initializedRunId = reply.operatorRunId;
        if (signal?.aborted) return initializationProjection(initializationId,'SUCCEEDED','NOT_STARTED','ASTRA_RUNNER_STOPPED',2,initializedRunId);
        phase = 'OPERATOR';
        const result = await executeRun({env,manifest,manifestHash,artifactRoot,signal,runId:initializedRunId,expectedInitializationId:initializationId},
            {...runDependencies,verifyArtifact,nodeVersion,execArgv,clock});
        check(result && result.runId === initializedRunId && ['READY_FOR_HUMAN','PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED','NOT_CLAIMED',
            'RECONCILIATION_REQUIRED','CONFIGURATION_REJECTED','INACTIVE','NOT_STARTED','PAUSED','TAKEN_OVER'].includes(result.state)
            && [0,2,3,64,78].includes(result.exitCode), 'ASTRA_RUN_RESULT_INVALID');
        keys(result,['runId','state','code','stepsApplied','receipts','disconnect','exitCode']);
        return {...result,initializationId,initializationState:'SUCCEEDED'};
    } catch (error) {
        const inactive = error?.code === 'ASTRA_RUNTIME_INACTIVE';
        return initializationProjection(initializationId,initializationState,
            phase==='CONFIGURATION'?(inactive?'INACTIVE':'CONFIGURATION_REJECTED'):'RECONCILIATION_REQUIRED',
            phase==='INITIALIZATION'?'ASTRA_INITIALIZATION_OUTCOME_UNCONFIRMED':codeOf(error),
            phase==='CONFIGURATION'?(inactive?78:64):3,initializedRunId);
    }
}
