import { pathToFileURL } from 'node:url';
import { digest, requireBridge as check, SHA, UUID } from '@atlas/service-bridge/protocol';
import { workspaceServiceClient } from '@atlas/service-bridge/workspace';
import { assertWorkspacePrivileges } from '@atlas/service-bridge/workspace-privileges';
import { createWorkspaceDispatcher } from '@atlas/operator/workspace-dispatcher';
import { assertReleaseProcess, readCanonicalRelease, verifyOperatorArtifact } from '../../../packages/atlas-operator/src/release-artifact.mjs';

/** The HTTP acknowledgment follows a read-only database admission. Work is
 * finite, tied to service lifetime, and limited to one physical card. Exact
 * saved commands distinguish retries from newly granted STEP work. Existing
 * durable command/run/lease/source records remain the restart authority.
 */
export function dispatchHost({ makeDispatcher, onResult = () => {}, automaticPickup = false,
    intervalMs = 5000, clock = { setTimeout, clearTimeout } }) {
    check(typeof automaticPickup === 'boolean' && Number.isSafeInteger(intervalMs) && intervalMs >= 1 && intervalMs <= 60000,
        'ASTRA_DISPATCH_CONFIGURATION_REQUIRED');
    const running = new Map(); let closing = false, timer = null, polling = null, lastPickupFailure = null;
    function stop() {
        closing = true;
        if (timer !== null) { clock.clearTimeout(timer); timer = null; }
        for (const value of running.values()) value.controller.abort();
    }
    function report(result) { try { onResult(result); } catch { /* Logging cannot change a retained outcome. */ } }
    function schedule() {
        if (!automaticPickup || closing) return;
        timer = clock.setTimeout(() => {
            timer = null;
            polling = pickup().finally(() => { polling = null; schedule(); });
        }, intervalMs);
        timer?.unref?.();
    }
    async function pickup() {
        if (closing || running.size) return;
        try {
            const dispatcher = await makeDispatcher();
            check(typeof dispatcher?.pickup === 'function', 'ASTRA_DISPATCH_CONFIGURATION_REQUIRED');
            const command = await dispatcher.pickup();
            if (command !== null && !closing) await host.accept(command);
            lastPickupFailure = null;
        } catch (error) {
            // A failed local admission is never permission to retry a paid
            // request. The next pass only re-reads durable queue/command state.
            const code = /^(?:ASTRA|WORKSPACE)_[A-Z0-9_]{1,69}$/.test(error?.code ?? '')
                ? error.code : 'ASTRA_QUEUE_PICKUP_UNAVAILABLE';
            if (code !== lastPickupFailure) report({ state: 'HELD', phase: 'QUEUE', code });
            lastPickupFailure = code;
        }
    }
    const host = {
        async accept({ runId, commandId }) {
            check(!closing && UUID.test(runId ?? '') && UUID.test(commandId ?? ''), 'ASTRA_DISPATCH_UNAVAILABLE');
            const dispatcher = await makeDispatcher();
            const admission = await dispatcher.admit({ runId, commandId });
            check(!closing && admission?.runId === runId && admission.commandId === commandId,
                'ASTRA_DISPATCH_UNAVAILABLE');
            check(['ADMITTED', 'SETTLED', 'IN_FLIGHT'].includes(admission.state)
                && SHA.test(admission.commandHash ?? '') && UUID.test(admission.workspaceCardId ?? '')
                && UUID.test(admission.activeRunId ?? ''), 'ASTRA_DISPATCH_NOT_ADMITTED');
            if (admission.state === 'SETTLED') return { state: 'SETTLED', runId, commandId };
            const cardId = admission.workspaceCardId, active = running.get(cardId);
            if (active) {
                check(active.commandId === commandId && active.commandHash === admission.commandHash, 'ASTRA_DISPATCH_BUSY');
                return { state: 'ACCEPTED', runId, commandId };
            }
            check(admission.state === 'ADMITTED', 'ASTRA_DISPATCH_NOT_ADMITTED');
            check(running.size === 0, 'ASTRA_DISPATCH_BUSY');
            const controller = new AbortController();
            const promise = Promise.resolve().then(() => dispatcher.run({ runId, commandId, signal: controller.signal }))
                .then(report)
                .catch(() => { report({ runId, state: 'HELD', code: 'ASTRA_DISPATCH_OUTCOME_UNCONFIRMED' }); })
                .finally(() => { running.delete(cardId); });
            running.set(cardId, { controller, promise, commandId, commandHash: admission.commandHash });
            return { state: 'ACCEPTED', runId, commandId };
        },
        stop,
        async close() {
            stop();
            if (polling) await polling;
            await Promise.allSettled([...running.values()].map(value => value.promise));
        },
    };
    schedule();
    return host;
}

/** Source, coordinator and operator clients have separate credentials/grants.
 * The operator module and generated client are imported only after their
 * independently pinned manifest and complete read-only artifact verify.
 */
export async function createPrivateOperatorHost({ config, makeClient, currentPeer, onResult }) {
    if (!config.dispatch) return null;
    // Check the actual process before constructing the deliberately narrower
    // operator credential environment. Filtering must not hide loader options.
    assertReleaseProcess({ env: process.env, execArgv: process.execArgv });
    const selected = config.dispatch;
    const manifest = await readCanonicalRelease(selected.manifestPath, selected.manifestHash);
    const artifact = await verifyOperatorArtifact({ root: selected.artifactRoot, expectedBuildHash: manifest.buildHash });
    const runtime = await import(pathToFileURL(artifact.runtimePath).href);
    const operator = runtime.productionOperatorConfig({ env: selected.operatorEnv, manifest, manifestHash: selected.manifestHash });
    check(manifest.machineInitialization === null && operator.config.configHash === config.operatorRuntimeHash
        && operator.image.origin === config.origin && digest(operator.image.key) === config.image.clientKeyHash,
    'ATLAS_PRIVATE_OPERATOR_BINDING_CHANGED');
    const database = makeClient(selected.coordinatorDatabaseUrl);
    const client = new Proxy(database, { get(target, property) {
        if (property === '$transaction') return (work, options = {}) => {
            check(typeof work === 'function', 'ATLAS_PRIVATE_TRANSACTION_REQUIRED');
            return target.$transaction(async tx => {
                await assertWorkspacePrivileges(tx, 'COORDINATOR');
                await tx.$executeRaw`SET LOCAL search_path=pg_catalog,atlas_staff,pg_temp`;
                const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
            }, { ...options, maxWait: 5000, timeout: 15000 });
        };
        const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    try {
        await client.$transaction(async () => {});
        const executeOperator = ({ runId, expectedControlRevision, signal }) => {
            check(Number.isSafeInteger(expectedControlRevision) && expectedControlRevision > 0
                && expectedControlRevision < 2147483647, 'ASTRA_DISPATCH_COMMAND_CHANGED');
            return runtime.executeOperatorRun({ env: selected.operatorEnv,
                manifest, manifestHash: selected.manifestHash, runId, expectedControlRevision,
                signal, artifactRoot: selected.artifactRoot }, {
                async createClient(databaseUrl) {
                    const { PrismaClient } = await import(pathToFileURL(artifact.clientPath).href);
                    return new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal', log: [],
                        __internal: { engine: { binaryPath: artifact.enginePath } } });
                },
            });
        };
        const host = dispatchHost({ onResult, automaticPickup: true, async makeDispatcher() {
            const { authority, bridgeConfig } = await currentPeer(client);
            const transport = workspaceServiceClient(bridgeConfig);
            return createWorkspaceDispatcher({ client, authority, operatorConfig: operator.config, executeOperator,
                source: { prepare: input => transport.call('PREPARE_SIDE', input),
                    finalize: input => transport.call('INITIALIZE_REPORT', input), status: input => transport.call('READ_STATUS', input) } });
        } });
        return { accept: host.accept, stop: host.stop,
            async close() { await host.close(); await database.$disconnect(); } };
    } catch (error) { await database.$disconnect(); throw error; }
}
