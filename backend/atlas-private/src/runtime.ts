import { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '../.generated/database/index.js';
import { BRIDGE_PATH, canonical, requireBridge as check, verifyRequest } from '@atlas/service-bridge/protocol';
import { WORKSPACE_SERVICE_PATH, verifyWorkspaceRequest, workspaceResponseSignature } from '@atlas/service-bridge/workspace';
import { OPERATOR_EVIDENCE_PATH, OperatorEvidenceBridge, verifyOperatorEvidenceRequest } from '@atlas/service-bridge/operator-evidence';
import { assertWorkspacePrivileges } from '@atlas/service-bridge/workspace-privileges';
import { ScopedGradingBridge } from '@atlas/service-bridge/executor';
import { createAtlasWorkspaceSourceAuthority } from '../../../frontend/nextjs-app/lib/server/atlasWorkspaceSourceAuthority';
import { createAtlasWorkspaceSourceStorage } from '../../../frontend/nextjs-app/lib/server/atlasWorkspaceSourceStorage';
import { createAtlasWorkspaceSourceHost } from '../../../frontend/nextjs-app/lib/server/atlasWorkspaceSourceHost';
import { createAtlasWorkspaceInitialization } from '../../../frontend/nextjs-app/lib/server/atlasWorkspaceInitialization';
import { atlasGradingPolicyHash, createAtlasGradingPorts } from '../../../frontend/nextjs-app/lib/server/atlasGradingBridge';
import { renderAtlasOperatorImage } from '../../../frontend/nextjs-app/lib/server/atlasOperatorImages';
import { privateRuntimeConfig, privateWorkspaceBinding } from './config.mjs';
import { createPrivateServer } from './http.mjs';
import { assertPrivateProcess, privateEnginePath } from './process.mjs';
import { createPrivateOperatorHost } from './operator-host.mjs';

const maximumImageBytes = 50 * 1024 * 1024;
const mapRevisionSelect = { id: true, mapId: true, version: true, matchKeyHash: true, matchKey: true,
    displayIdentity: true, normalizedIdentity: true, sourceSessionId: true, authorAdminId: true,
    frontMap: true, backMap: true, mapSchemaVersion: true, filterPolicyVersion: true,
    revisionHash: true, supersedesRevisionId: true, createdAt: true } as const;
const json = (value: unknown) => ({ bytes: Buffer.from(canonical(value)), contentType: 'application/json' });

/** No server or client is constructed on module import. This is the concrete
 * standalone composition of the existing grading/preparation implementations,
 * with separate restricted database roles and explicit storage/worker credentials. */
export async function createPrivateRuntime(env: NodeJS.ProcessEnv) {
    assertPrivateProcess();
    const config = privateRuntimeConfig(env, atlasGradingPolicyHash());
    const makeClient = (url: string) => new PrismaClient({ datasources: { db: { url } },
        errorFormat: 'minimal', log: [], __internal: { engine: { binaryPath: privateEnginePath(import.meta.url) } } } as any);
    const database = makeClient(config.sourceDatabaseUrl);
    let operatorHost: Awaited<ReturnType<typeof createPrivateOperatorHost>> = null;
    const storageClient = new S3Client({ endpoint: config.storage.endpoint, region: config.storage.region,
        forcePathStyle: true, maxAttempts: 1,
        credentials: { accessKeyId: config.credentials.storageAccessKey, secretAccessKey: config.credentials.storageSecretKey } });
    // The original services use callback transactions. Reassert effective role
    // privileges for each transaction, including original source preparation.
    const client = new Proxy(database, { get(target, property) {
        if (property === '$transaction') return (work: (tx: any) => Promise<unknown>, options: Record<string, unknown> = {}) => {
            check(typeof work === 'function', 'ATLAS_PRIVATE_TRANSACTION_REQUIRED');
            return target.$transaction(async tx => {
                await assertWorkspacePrivileges(tx, 'SOURCE');
                // Original preparation/review raw SQL targets the legacy
                // public tables. @@schema covers model calls only. This fixed
                // transaction-local path preserves those exact original calls
                // while keeping catalog names first and temp objects last.
                await tx.$executeRaw`SET LOCAL search_path=pg_catalog,public,atlas_staff,pg_temp`;
                const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
            }, { ...options, maxWait: 5000, timeout: 15000 });
        };
        const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    try {
        await client.$transaction(async () => {});
        const storage = createAtlasWorkspaceSourceStorage({ client: storageClient, bucket: config.storage.bucket,
            uploadOrigin: config.storage.uploadOrigin });
        function sourceForKey(key: string) {
            const match = /^ai-grader-v2\/(atlas-staff-[a-f0-9-]{36})\/(atlas-[a-f0-9-]{36})\//.exec(key);
            check(match, 'ATLAS_PRIVATE_STORAGE_SCOPE_INVALID');
            return storage.forSource({ sourceOwnerId: match![1], sourceId: match![2] });
        }
        const revisionLookup = {
            findActiveMap: (matchKeyHash: string) => client.aiGraderV2CardTypeMap.findUnique({ where: { matchKeyHash },
                select: { id: true, matchKeyHash: true, currentRevisionId: true, currentRevision: { select: mapRevisionSelect } } }),
            findActiveMaps: (matchKeyHashes: readonly string[]) => client.aiGraderV2CardTypeMap.findMany({ where: { matchKeyHash: { in: [...matchKeyHashes] } },
                select: { id: true, matchKeyHash: true, currentRevisionId: true, currentRevision: { select: mapRevisionSelect } } }),
            findPinnedRevision: (id: string) => client.aiGraderV2CardTypeMapRevision.findUnique({ where: { id }, select: mapRevisionSelect }),
        };
        const workerEnv = Object.freeze({ NODE_ENV: 'production',
            AI_GRADER_SPEEDSTER_SERVICE_URL: config.workers.detectorOrigin,
            AI_GRADER_SPEEDSTER_SERVICE_API_KEY: config.credentials.detectorKey,
            AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1: 'true',
            AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID: config.receiptIds.DETECTION,
            AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET: config.credentials.detectionReceiptKey,
            AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS: '55000' });
        const ports = createAtlasGradingPorts(client as any, config.grading, { env: workerEnv,
            serviceHeaders: { authorization: `Bearer ${config.credentials.detectorKey}` }, mapLookup: revisionLookup as any,
            presignReadUrl: async key => sourceForKey(key).readUrl(key),
            readEvidence: descriptor => storage.readCapture({ ...descriptor, objectRef: descriptor.sourceRef } as any),
            openEvidence: async key => {
                const bytes = await sourceForKey(key).storage.read(key, maximumImageBytes);
                return { storageKey: key, byteSize: bytes.length, body: (async function* () { yield bytes; })() };
            } });
        const grading = new ScopedGradingBridge({ client, config: config.grading, ports });
        const worker = { geometryOrigin: config.workers.geometryOrigin, preparationOrigin: config.workers.preparationOrigin,
            apiKey: config.credentials.geometryKey, preparationApiKey: config.credentials.preparationKey,
            receiptKey: config.credentials.colorReceiptKey, receiptKeyId: config.receiptIds.COLOR,
            registrationOrigin: config.workers.registrationOrigin, registrationApiKey: config.credentials.registrationKey,
            mapReceiptKey: config.credentials.mapReceiptKey, mapReceiptKeyId: config.receiptIds.MAP };
        async function currentPeer(peerClient = client) {
            // HTTP has already authenticated the dedicated workspace HMAC.
            // Resolve the trusted current staff binding here so staging a new
            // private deployment and then its staff peer has no circular URL
            // dependency. The original host verifies the full packet against
            // this independently reconstructed configuration before any effect.
            const staff = await peerClient.$transaction(async tx => {
                await tx.$executeRaw`SELECT atlas_staff.lock_workspace_private_controls()`;
                const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active'`; return row;
            }) as any;
            const bridgeConfig = privateWorkspaceBinding(config, staff);
            const authority = createAtlasWorkspaceSourceAuthority(peerClient as any, { mode: 'PRODUCTION', staffOrigin: staff.origin,
                staffDeploymentId: staff.deploymentId, staffReleaseSha: staff.releaseSha, staffConfigHash: staff.configHash,
                configHash: bridgeConfig.configHash, sourceConfigHash: config.configHash,
                sourceDeploymentId: config.deploymentId, sourceReleaseSha: config.releaseSha, allowedPhoneHashes: config.allowedPhoneHashes });
            return { staff, bridgeConfig, authority };
        }
        async function sourceHost(peer: Awaited<ReturnType<typeof currentPeer>>) {
            const { staff, bridgeConfig, authority } = peer;
            return createAtlasWorkspaceSourceHost({ client: client as any, authority, storage, worker, bridgeConfig,
                initialization: createAtlasWorkspaceInitialization({ client: client as any, authority, gradingPorts: ports,
                    sourceConfigHash: config.configHash, config: { ...config.grading, runtimeHash: config.operatorRuntimeHash,
                        staffDeploymentId: staff.deploymentId, staffReleaseSha: staff.releaseSha } }) });
        }
        operatorHost = await createPrivateOperatorHost({ config, makeClient, currentPeer,
            onResult: (result: any) => process.stdout.write(JSON.stringify({ service: 'atlas-private-dispatch',
                runId: result.runId, state: result.state,
                code: /^(ASTRA|WORKSPACE)_[A-Z0-9_]{1,80}$/.test(result.code ?? '') ? result.code : null }) + '\n') });
        const evidence = new OperatorEvidenceBridge({ client, config: config.image, ports: { ...ports,
            render: renderAtlasOperatorImage,
            loadCapture: async (_tx: unknown, { workspace, originals }: any) => {
                for (const descriptor of Object.values(originals) as any[])
                    check(descriptor.objectRef.startsWith(`ai-grader-v2/${workspace.source.sourceOwnerId}/${workspace.source.sourceId}/original/`),
                        'ATLAS_PRIVATE_STORAGE_SCOPE_INVALID');
                return { captureHash: workspace.captureHash, originals };
            },
            readCapture: storage.readCapture,
            readEvidence: (descriptor: any, signal: AbortSignal) => storage.readCapture({ ...descriptor, objectRef: descriptor.sourceRef }, signal),
        } });
        const routes = new Map([
            [WORKSPACE_SERVICE_PATH, { key: config.workspaceKey, signatureHeader: 'x-atlas-workspace-signature',
                responseSignatureHeader: 'x-atlas-workspace-response', maximumBytes: 16384, maximumResponseBytes: maximumImageBytes,
                receive: async (body: string, signature: string) => {
                    const peer = await currentPeer(), packet = verifyWorkspaceRequest(peer.bridgeConfig, body, signature);
                    if (packet.claims.action !== 'EXECUTE_ASTRA') return (await sourceHost(peer)).receive(body, signature);
                    check(operatorHost, 'ATLAS_PRIVATE_OPERATOR_UNAVAILABLE');
                    const result = json(await operatorHost!.accept(packet.input));
                    return { ...result, signature: workspaceResponseSignature(peer.bridgeConfig, packet.claims, result.bytes, result.contentType) };
                } }],
            [BRIDGE_PATH, { key: config.grading.key, signatureHeader: 'x-atlas-signature', maximumBytes: 16384, maximumResponseBytes: maximumImageBytes,
                receive: async (body: string, signature: string) => {
                    const packet = verifyRequest(config.grading, body, signature);
                    if (packet.payload.action === 'READ_EVIDENCE') return grading.readEvidence(packet.claims, packet.payload.side);
                    check(packet.payload.action === 'RUN_REVIEW', 'ATLAS_PRIVATE_REQUEST_INVALID');
                    return json(await grading.run(packet.claims, packet.payload.operationId));
                } }],
            [OPERATOR_EVIDENCE_PATH, { key: config.image.key, signatureHeader: 'x-atlas-operator-evidence-signature',
                responseSignatureHeader: 'x-atlas-operator-evidence-signature', maximumBytes: 8192, maximumResponseBytes: 4400000,
                receive: async (body: string, signature: string) => {
                    const result = await evidence.read(verifyOperatorEvidenceRequest(config.image, body, signature));
                    return { bytes: Buffer.from(result.text), contentType: 'application/json', signature: result.signature };
                } }],
        ]);
        const health = { service: 'atlas-private', releaseSha: config.releaseSha, deploymentId: config.deploymentId,
            configHash: config.configHash, gradingConfigHash: config.grading.configHash, imageConfigHash: config.image.configHash,
            gradingPolicyHash: config.gradingPolicyHash, capabilities: ['WORKSPACE_SOURCE', 'ORIGINAL_GRADING', 'OPERATOR_EVIDENCE',
                ...(operatorHost ? ['WORKSPACE_DISPATCH'] : [])] };
        return { server: createPrivateServer({ origin: config.origin, routes, health }), health,
            stop() { operatorHost?.stop(); },
            async close() { await operatorHost?.close(); storageClient.destroy(); await database.$disconnect(); } };
    } catch (error) { await operatorHost?.close(); storageClient.destroy(); await database.$disconnect(); throw error; }
}
