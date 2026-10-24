import { randomUUID } from 'node:crypto';
import { createProductionDatabasePool } from './production-database.mjs';
import { createProofAuthorityPostgres, assertProofAuthorityCommittedReport } from './proof-authority-postgres.mjs';
import { PROOF_AUTHORITY_ROLES } from './proof-authority-protocol.mjs';
import { PRODUCTION_C0_CLOSURE_HASHES } from './production-canonical-pins.mjs';
import { engineDataOptions } from './proof-decoder-engine-json.mjs';
import { requireValue } from './contract.mjs';

/** Fixed identities and source-owned SQL closure. JSON cannot select a role,
 * gateway function, driver constructor, query, database or owner identity. */
export function createProductionGateways({ configuration, secrets } = {}) {
    engineDataOptions(secrets, ['requestPassword', 'settlerPassword', 'revokerPassword', 'marketplacePassword']);
    const pools = [], gateways = {};
    let closed = false, verified = false, closing;
    const close = () => closing ??= (async () => {
        closed = true; verified = false;
        for (const gateway of Object.values(gateways)) gateway.close();
        await Promise.allSettled(pools.map(pool => pool.close()));
    })();
    try {
        for (const kind of ['REQUEST', 'SETTLER', 'REVOKER']) {
            const lower = kind.toLowerCase(), pool = createProductionDatabasePool({ configuration,
                role: `atlas_proof_${lower}`, password: secrets[`${lower}Password`] });
            pools.push(pool);
            gateways[`${lower}Gateway`] = createProofAuthorityPostgres({ enabled: true, pool,
                roleKind: kind, expectedRole: `atlas_proof_${lower}`, expectedDatabase: 'atlas_grading',
                expectedFunctionOwner: 'atlas_proof_authority_owner',
                functionHashes: Object.fromEntries(PROOF_AUTHORITY_ROLES[kind].map(name => [name, PRODUCTION_C0_CLOSURE_HASHES[name]])),
                closureHashes: PRODUCTION_C0_CLOSURE_HASHES });
        }
        const marketplacePool = createProductionDatabasePool({ configuration,
            role: 'atlas_marketplace_writer', password: secrets.marketplacePassword });
        pools.push(marketplacePool);
        return Object.freeze({ ...gateways, marketplacePool, close,
            assertReady() { requireValue(!closed && verified, 'PRODUCTION_GATEWAYS_UNVERIFIED'); return true; },
            async verify() {
                requireValue(!closed && !verified, 'PRODUCTION_GATEWAYS_VERIFICATION_CONSUMED');
                // These are SELECT-only absent-ID lookups. Their existing
                // adapters audit actual TLS role/grants/functions/writer hooks.
                // Absence is transport evidence, never an installed authority.
                for (const [name, gateway] of Object.entries(gateways)) {
                    const isRevoker = name === 'revokerGateway', id = randomUUID();
                    const report = isRevoker ? await gateway.readDrain({ mutationId: id })
                        : await gateway.lookupStage({ stageId: id, operationHash: '0'.repeat(64) });
                    assertProofAuthorityCommittedReport(report, { gateway,
                        action: isRevoker ? 'read_drain_v1' : 'lookup_stage_v1' });
                    requireValue(report.schema === 'atlas-proof-authority-observation-v1'
                        && report.status === 'ABSENT_HOLD' && report.authority === false, 'PRODUCTION_GATEWAYS_UNVERIFIED');
                }
                requireValue(!closed, 'PRODUCTION_GATEWAYS_CLOSED'); verified = true;
                return Object.freeze({ schema: 'atlas-production-canonical-gateway-check-v1',
                    auditedRoles: 3, sourceFunctions: 20, writerHooks: 20,
                    installationQualified: false, rowWrites: 0 });
            },
        });
    } catch (error) { void close(); throw error; }
}
