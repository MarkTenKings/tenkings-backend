import { createMarketplaceHostBootstrap } from './host-bootstrap.mjs';
import { createProductionR1Canonical } from './production-canonical.mjs';
import { requireValue } from './contract.mjs';

/** Persistent production startup, not a fixture runner or approval generator.
 * The source-owned runtime owner must supply actual private physical/C0 ports
 * and current readiness capabilities. NON_PAYMENT has no financial owners. JSON evidence alone
 * cannot construct them. No defaults manufacture these missing authorities.
 * The caller owns signals, protected input loading, and final process exit.
 */
export async function startProductionMarketplaceHost({ canonicalInputs, manifest, host, finance, assertReleaseReady } = {}) {
    requireValue(manifest?.environment === 'PRODUCTION' && host?.config?.proofAuthority?.enabled === true
        && host?.config?.environment === 'PRODUCTION' && host?.proofAuthority
        && typeof host?.r1?.admitRequest === 'function' && typeof host?.r1?.admitPublicRequest === 'function'
        && !host.r1.staffState && !host.r1.customerState && !host.r1.manualClient && !host.r1.publicConfig,
        'PRODUCTION_RUNTIME_OWNERS_REQUIRED');
    const canonical = await createProductionR1Canonical(canonicalInputs);
    let bootstrap;
    try {
        bootstrap = createMarketplaceHostBootstrap({ enabled: true, manifest, finance, assertReleaseReady,
            existingHandlers: canonical.existingHandlers,
            host: { ...host, r1: { ...host.r1, staffState: canonical.staffState, customerState: canonical.customerState,
                manualClient: canonical.manualClient, publicConfig: canonical.publicConfig } } });
        await bootstrap.start();
    } catch (error) { await bootstrap?.stop().catch(() => {}); await canonical.close(); throw error; }
    let stopping;
    return Object.freeze({ status: bootstrap.status, health: bootstrap.health,
        stop() { return stopping ??= (async () => { try { await bootstrap.stop(); } finally { await canonical.close(); } })(); } });
}
