import { PrismaClient } from '../../.generated/staff-database/index.js';
import { LocalStaffAuth } from './auth.mjs';
import { assertLocalRequest, deny } from './policy.mjs';
import { productionAccessConfig, assertProductionStaffRequest, secureStaffCookie } from './access/config.mjs';
import { readLocalPostgresConfig } from './access/local-config.mjs';
import { StaffDatabase } from './access/database.mjs';
import { DurableStaffAuth } from './access/auth.mjs';
import { fixtureVerifyProvider } from './access/fixture-verify.mjs';
import { twilioVerifyTransport } from './access/twilio.mjs';
import { createFrontendManualRuntime } from './manual-frontend-runtime.mjs';
import { createPageAccess } from './page-access.mjs';
import { createStaffCompCurationFrontendRuntime } from './staff-comp-curation-frontend-runtime.mjs';

export function runtime(req, env = process.env) {
    if (env.ATLAS_CONNECTED_LOCAL_FIXTURE === '1') {
        assertLocalRequest(req, { ...env, ATLAS_LOCAL_SYNTHETIC: '1' });
        const fixture = globalThis[Symbol.for('atlas.staff.connected.local-fixture')];
        if (!fixture) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
        return fixture;
    }
    if (env.ATLAS_LOCAL_SYNTHETIC === '1') {
        assertLocalRequest(req, env);
        const key = Symbol.for('atlas.staff.local.v1');
        globalThis[key] ??= { auth: new LocalStaffAuth() };
        Object.setPrototypeOf(globalThis[key].auth, LocalStaffAuth.prototype);
        return globalThis[key];
    }
    const local = env.ATLAS_LOCAL_POSTGRES === '1';
    const config = local ? readLocalPostgresConfig(env) : productionAccessConfig(env);
    const assertRequest = local ? request => assertLocalRequest(request, { ...env, ATLAS_LOCAL_SYNTHETIC: '1' })
        : request => assertProductionStaffRequest(request, config);
    assertRequest(req);
    const key = Symbol.for(`atlas.staff.postgres.${config.mode}.${config.deploymentId}.${config.configHash}.current`);
    if (!globalThis[key]) {
        const client = new PrismaClient({ datasources: { db: { url: config.databaseUrl } }, errorFormat: 'minimal' });
        const provider = local ? fixtureVerifyProvider(config) : twilioVerifyTransport({ accountSid: config.accountSid, serviceSid: config.serviceSid,
            apiKeySid: env.ATLAS_AUTH_TWILIO_API_KEY_SID, apiKeySecret: env.ATLAS_AUTH_TWILIO_API_KEY_SECRET });
        const auth = new DurableStaffAuth({ database: new StaffDatabase(client, config), config, provider });
        globalThis[key] = { auth };
    }
    const state = globalThis[key];
    if (env.ATLAS_MANUAL_ENABLED === 'true' && !state.connectedManual) state.connectedManual = createFrontendManualRuntime({env,auth:state.auth,staffConfig:config,assertRequest});
    Object.setPrototypeOf(state.auth, DurableStaffAuth.prototype);
    Object.setPrototypeOf(state.auth.database, StaffDatabase.prototype);
    // Optional web-only proxy; construction owns no client and starts no work.
    // Keep this request's configuration separate from the cached grading proxy.
    const compCuration = createStaffCompCurationFrontendRuntime({ env, auth: state.auth, staffConfig: config, assertRequest });
    return { ...state, compCuration, mode: config.mode, origin: config.origin, cookies: config.cookies,
        cookie: local ? undefined : secureStaffCookie, assertRequest,
        // Global/phone budgets remain effective even if the platform cannot
        // provide a trusted per-client address. No arbitrary forwarding header
        // is accepted as rate-limit authority.
        clientAddress: local ? request => request.socket.remoteAddress : () => 'production-ingress' };
}

export const pageAccess = createPageAccess({ resolveRuntime: runtime });
