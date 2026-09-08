import { PrismaClient } from '../../.generated/staff-database/index.js';
import { LocalStaffAuth } from './auth.mjs';
import { LocalReviewStore } from './review.mjs';
import { assertLocalRequest, privateHeaders, deny } from './policy.mjs';
import { productionAccessConfig, assertProductionStaffRequest, secureStaffCookie } from './access/config.mjs';
import { readLocalPostgresConfig } from './access/local-config.mjs';
import { StaffDatabase } from './access/database.mjs';
import { DurableStaffAuth } from './access/auth.mjs';
import { DurableReviewStore } from './access/review.mjs';
import { StaffReports } from './access/reports.mjs';
import { fixtureEvidence, fixtureVerifyProvider } from './access/fixture.mjs';
import { twilioVerifyTransport } from './access/twilio.mjs';
import { bridgeClient } from '@atlas/service-bridge/transport';
import { keyBytes } from '@atlas/service-bridge/protocol';
import { StaffGrading } from './access/grading.mjs';
import { StaffProposals } from './access/proposals.mjs';

export function runtime(req, env = process.env) {
    if (env.ATLAS_LOCAL_SYNTHETIC === '1') {
        assertLocalRequest(req, env);
        const key = Symbol.for('atlas.staff.local.v1');
        globalThis[key] ??= { auth: new LocalStaffAuth(), review: new LocalReviewStore() };
        Object.setPrototypeOf(globalThis[key].auth, LocalStaffAuth.prototype);
        Object.setPrototypeOf(globalThis[key].review, LocalReviewStore.prototype);
        return globalThis[key];
    }
    const local = env.ATLAS_LOCAL_POSTGRES === '1';
    const config = local ? readLocalPostgresConfig(env) : productionAccessConfig(env);
    const assertRequest = local ? request => assertLocalRequest(request, { ...env, ATLAS_LOCAL_SYNTHETIC: '1' })
        : request => assertProductionStaffRequest(request, config);
    assertRequest(req);
    const key = Symbol.for(`atlas.staff.postgres.${config.mode}.${config.deploymentId}.${config.configHash}`);
    if (!globalThis[key]) {
        const client = new PrismaClient({ datasources: { db: { url: config.databaseUrl } }, errorFormat: 'minimal' });
        const provider = local ? fixtureVerifyProvider(config) : twilioVerifyTransport({ accountSid: config.accountSid, serviceSid: config.serviceSid,
            apiKeySid: env.ATLAS_AUTH_TWILIO_API_KEY_SID, apiKeySecret: env.ATLAS_AUTH_TWILIO_API_KEY_SECRET });
        const auth = new DurableStaffAuth({ database: new StaffDatabase(client, config), config, provider });
        const bridge = !local && env.ATLAS_GRADING_BRIDGE_ORIGIN && env.ATLAS_GRADING_BRIDGE_KEY
            ? bridgeClient({ origin: env.ATLAS_GRADING_BRIDGE_ORIGIN, key: keyBytes(env.ATLAS_GRADING_BRIDGE_KEY),
                deploymentId: config.deploymentId, releaseSha: config.releaseSha }) : null;
        const evidence = local ? fixtureEvidence() : { async read(binding) {
            if (!bridge || binding.sourceType !== 'SPEEDSTER') deny(503, 'EVIDENCE_UNAVAILABLE');
            return bridge.call(binding.scope, { action: 'READ_EVIDENCE', side: binding.side });
        } };
        const review = new DurableReviewStore({ auth, evidence });
        globalThis[key] = { auth, review, reports: new StaffReports({ auth, review }), grading: new StaffGrading({ auth, review, bridge }),
            proposals: new StaffProposals({ auth, review }) };
    }
    const state = globalThis[key];
    Object.setPrototypeOf(state.auth, DurableStaffAuth.prototype);
    Object.setPrototypeOf(state.auth.database, StaffDatabase.prototype);
    Object.setPrototypeOf(state.review, DurableReviewStore.prototype);
    Object.setPrototypeOf(state.reports, StaffReports.prototype);
    Object.setPrototypeOf(state.grading, StaffGrading.prototype);
    Object.setPrototypeOf(state.proposals, StaffProposals.prototype);
    return { ...state, mode: config.mode, origin: config.origin, cookies: config.cookies,
        cookie: local ? undefined : secureStaffCookie, assertRequest,
        // Global/phone budgets remain effective even if the platform cannot
        // provide a trusted per-client address. No arbitrary forwarding header
        // is accepted as rate-limit authority.
        clientAddress: local ? request => request.socket.remoteAddress : () => 'production-ingress' };
}

export async function pageAccess(ctx, { authenticated = true } = {}) {
    privateHeaders(ctx.res);
    if (!['GET', 'HEAD'].includes(ctx.req.method)) {
        ctx.res.setHeader('Allow', 'GET, HEAD'); ctx.res.statusCode = 405;
        return { props: { unavailable: true } };
    }
    try {
        const state = runtime(ctx.req);
        if (state.auth.database) await state.auth.database.transaction(() => undefined);
        if (!authenticated) return { props: { mode: state.mode ?? 'SYNTHETIC_LOCAL' } };
        const staff = await state.auth.maybeAuthenticate(ctx.req.headers.cookie);
        if (!staff) return { redirect: { destination: '/', permanent: false } };
        return { props: { staff } };
    } catch {
        ctx.res.statusCode = 503; return { props: { unavailable: true } };
    }
}
