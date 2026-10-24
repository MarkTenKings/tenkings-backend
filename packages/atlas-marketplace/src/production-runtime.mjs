import { setTimeout as delay } from 'node:timers/promises';
import { createAuthorityContext } from './authority-context.mjs';
import { hash, requireValue } from './contract.mjs';
import { engineDataOptions } from './proof-decoder-engine-json.mjs';
import { createMarketplacePhysicalFactory } from './physical-runtime.mjs';
import { assertCurrentR1ProofAccess } from './proof-authority-r1.mjs';
import { assertProofAuthorityCommittedReport } from './proof-authority-postgres.mjs';
import { createProductionAdmission } from './production-admission.mjs';
import { readProductionR1Bindings } from './production-canonical.mjs';
import { createProductionGateways } from './production-gateways.mjs';
import { startProductionMarketplaceHost } from './production-host.mjs';
import { openProductionProofOwners } from './production-proof-owners.mjs';
import { inspectMarketplaceReleaseManifest } from './release-readiness.mjs';
import { verifyProductionSource } from './production-source.mjs';

const check = value => requireValue(value, 'PRODUCTION_RUNTIME_BINDING_REFUSED');
const same = (a, b) => hash(a) === hash(b);

/** The only executable production assembly. Every IO/authority constructor is
 * imported above from the source closure. Input JSON supplies reviewed data,
 * never constructors, SQL, readiness functions or authority capabilities.
 * Checkout/finance/shipping owners have no construction path in this process.
 */
export async function openProductionMarketplaceProcess({ configuration, secrets }) {
    const c = engineDataOptions(configuration.runtime, ['schema', 'database', 'proof', 'hostConfig',
        'physicalConfig', 'context', 'marketplaceBinding', 'installationWaitMs']);
    check(c.schema === 'atlas-marketplace-production-runtime-v1' && configuration.manifest.operatingMode === 'NON_PAYMENT'
        && c.hostConfig.operatingMode === 'NON_PAYMENT' && c.physicalConfig.operatingMode === 'NON_PAYMENT'
        && c.hostConfig.environment === 'PRODUCTION' && c.physicalConfig.environment === 'PRODUCTION'
        && c.hostConfig.proofAuthority?.enabled === true && c.hostConfig.settlement == null
        && Number.isSafeInteger(c.installationWaitMs) && c.installationWaitMs >= 1000 && c.installationWaitMs <= 1800000);
    const source = verifyProductionSource(configuration), manifest = configuration.manifest;
    check(inspectMarketplaceReleaseManifest(manifest).configurationComplete && manifest.environment === 'PRODUCTION'
        && manifest.sourceRevision === source.sourceRevision && manifest.hostConfigHash === hash(c.hostConfig)
        && manifest.physicalConfigHash === hash(c.physicalConfig) && manifest.marketplaceBindingHash === hash(c.marketplaceBinding));
    const context = createAuthorityContext(c.context), canonicalBindings = await readProductionR1Bindings(secrets.canonicalInputs);
    const marketBinding = { operatingMode: 'NON_PAYMENT', environment: 'PRODUCTION', platformAccountId: manifest.platformAccountId,
        listingPolicyHash: null, financePolicyHash: null, fulfillmentPolicyHash: null, qualificationRefs: context.qualificationRefs };
    check(same(marketBinding, c.marketplaceBinding));
    const configPin = hash(configuration), proofBinding = c.proof.intake.installation.binding;
    check(proofBinding.environment === 'PRODUCTION' && proofBinding.policyHash === hash(c.physicalConfig.proof));
    let gateways, proof, admission, host, installed = null, phase = 'OPENING', closed = false, closing, startPromise;
    const abort = new AbortController();
    const close = () => closing ??= (async () => {
        closed = true; phase = 'STOPPING'; abort.abort();
        let failure;
        if (startPromise) { try { await startPromise; } catch {} }
        for (const owner of [host, admission, proof, gateways]) {
            try { await (owner?.stop?.() ?? owner?.close?.()); } catch (error) { failure ??= error; }
        }
        phase = failure ? 'HELD' : 'STOPPED'; if (failure) throw failure;
    })();
    const ready = () => {
        check(!closed && hash(configuration) === configPin && installed && Date.now() < installed.expiresAt);
        gateways.assertReady(); proof.assertReady(); return true;
    };
    try {
        gateways = createProductionGateways({ configuration: c.database, secrets: secrets.database });
        await gateways.verify();
        proof = await openProductionProofOwners({ configuration: c.proof, secrets: secrets.proof });
        check(same(proof.sessionBinding, c.proof.publisher.sessionBinding));
        phase = 'WAIT_INSTALL';
        const publicStatus = () => Object.freeze({ ...proof.status(), schema: 'atlas-marketplace-production-process-status-v1',
            phase, sourceRevision: source.sourceRevision, operatingMode: 'NON_PAYMENT', checkoutEnabled: false,
            productionReady: false, saleAuthorityAvailable: false });
        async function waitForInstallation() {
            const deadline = Date.now() + c.installationWaitMs;
            while (!closed && Date.now() < deadline) {
                const observed = await gateways.requestGateway.observeInstallation({ schema: 'atlas-proof-installation-observe-v1',
                    installationId: proof.sessionBinding.installationId });
                assertProofAuthorityCommittedReport(observed, { gateway: gateways.requestGateway, action: 'observe_access_v1' });
                if (observed.schema === 'atlas-proof-installation-report-v1') {
                    check(observed.installationId === proof.sessionBinding.installationId
                        && observed.publisherSessionId === proof.publisherSessionId && observed.publisherLedgerId === proof.status().ledgerId
                        && same(observed.sessionBinding, proof.sessionBinding) && same(observed.intakeBinding, proofBinding)
                        && same(observed.staffBinding, canonicalBindings.staff) && same(observed.customerBinding, canonicalBindings.customer)
                        && observed.observedAt <= Date.now() + 2000 && Date.now() - observed.observedAt < 5000
                        && observed.expiresAt > Date.now() && observed.expiresAt <= c.physicalConfig.proof.expiresAt);
                    installed = observed; ready(); return;
                }
                check(observed.schema === 'atlas-proof-authority-observation-v1' && observed.authority === false);
                await delay(5000, undefined, { signal: abort.signal });
            }
            requireValue(false, closed ? 'PRODUCTION_PROCESS_STOPPED' : 'PRODUCTION_INSTALLATION_DEADLINE');
        }
        const start = () => startPromise ??= (async () => {
            await waitForInstallation(); phase = 'STARTING';
            admission = createProductionAdmission(ready);
            const physicalBinding = { schema: 'atlas-marketplace-physical-factory-v1', environment: 'PRODUCTION', configHash: hash(c.physicalConfig) };
            const key = Buffer.from(secrets.proof.encryptionKeyBase64, 'base64');
            let createPhysicalPorts;
            try {
                createPhysicalPorts = createMarketplacePhysicalFactory({ enabled: true, config: c.physicalConfig, proofEncryptionKey: key,
                    approvals: {
                        physical(value) { ready(); check(same(value, physicalBinding)); return true; },
                        proof(value) { ready(); check(same(value, proofBinding)); return true; },
                    },
                    authorizeProof(actor, scope) {
                        ready(); check(scope.policyHash === proofBinding.policyHash);
                        return assertCurrentR1ProofAccess(actor, { policyHash: proofBinding.policyHash });
                    } });
                const hostBinding = { schema: 'atlas-r1-marketplace-host-v1', environment: 'PRODUCTION', origin: manifest.origin,
                    approvalRef: c.hostConfig.approvalRef, configHash: manifest.hostConfigHash,
                    database: { role: 'atlas_marketplace_writer', name: 'atlas_marketplace', functionOwner: 'atlas_marketplace_owner' },
                    ...canonicalBindings, marketplace: marketBinding };
                const releaseBinding = { schema: manifest.schema, operation: 'OWNED_MARKETPLACE_HOST', environment: manifest.environment,
                    platformAccountId: manifest.platformAccountId, manifestHash: hash(manifest), sourceRevision: manifest.sourceRevision,
                    physicalConfigHash: manifest.physicalConfigHash, hostConfigHash: manifest.hostConfigHash,
                    financeConfigHash: null, commerceConfigHash: null, marketplaceBindingHash: manifest.marketplaceBindingHash };
                host = await startProductionMarketplaceHost({ canonicalInputs: secrets.canonicalInputs, manifest,
                    assertReleaseReady(value) { ready(); check(same(value, releaseBinding)); return true; },
                    host: { enabled: true, config: c.hostConfig, r1: admission,
                        database: { pool: gateways.marketplacePool, expectedRole: 'atlas_marketplace_writer', expectedDatabase: 'atlas_marketplace', expectedFunctionOwner: 'atlas_marketplace_owner' },
                        proofAuthority: Object.fromEntries(['requestGateway', 'settlerGateway', 'revokerGateway'].map(name => [name, gateways[name]]).concat(
                            ['publisher', 'decoderClient', 'retentionWriter', 'accountedIntake', 'sessionBinding', 'publisherSessionId'].map(name => [name, proof[name]]))),
                        assertRuntimeReady(value) { ready(); check(same(value, hostBinding)); return true; },
                        marketplace: { context, platformAccountId: manifest.platformAccountId,
                            runtimeApproval: { approved: true, binding: marketBinding },
                            createPhysicalPorts, physicalConfig: c.physicalConfig,
                            assertRuntimeReady(value) { ready(); check(same(value, marketBinding)); return true; } },
                    } });
            } finally { key.fill(0); }
            ready(); phase = 'RUNNING'; return publicStatus();
        })();
        return Object.freeze({ start, close, status: publicStatus });
    } catch (error) { try { await close(); } catch {} throw error; }
}
