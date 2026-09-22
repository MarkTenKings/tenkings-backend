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
import { operationsRuntimeSettings, createOperationsRuntime } from './access/operations-runtime.mjs';
import { createFinishingRuntime } from './access/finishing-runtime.mjs';
import { StaffOperationalResolutionService } from './access/resolution.mjs';
import { machineAdmissionRuntimeSettings, StaffMachinePreparation } from './access/machine.mjs';
import { createLearningRuntime } from './access/learning-runtime.mjs';
import { createIdentityCorrectionRuntime } from './access/identity-correction-runtime.mjs';
import { StaffCustomerIntake } from './access/customer-intake.mjs';
import { createWorkspaceRuntime, workspaceRuntimeSettings } from './access/workspace-runtime.mjs';
import { localWorkspaceFixture } from './access/workspace-fixture.mjs';
import { createFrontendManualRuntime } from './manual-frontend-runtime.mjs';
import { staffContentSecurityPolicy } from '../content-security.mjs';

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
    const operationsSettings = operationsRuntimeSettings(env, config);
    const key = Symbol.for(`atlas.staff.postgres.${config.mode}.${config.deploymentId}.${config.configHash}.${operationsSettings?.key ?? 'no-operations'}`);
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
            proposals: new StaffProposals({ auth, review }),
            operations: createOperationsRuntime({ settings: operationsSettings, auth, Client: PrismaClient }) };
    }
    const state = globalThis[key];
    if (env.ATLAS_MANUAL_ENABLED === 'true' && !state.connectedManual) state.connectedManual = createFrontendManualRuntime({env,auth:state.auth,staffConfig:config,assertRequest});
    Object.setPrototypeOf(state.auth, DurableStaffAuth.prototype);
    Object.setPrototypeOf(state.auth.database, StaffDatabase.prototype);
    Object.setPrototypeOf(state.review, DurableReviewStore.prototype);
    Object.setPrototypeOf(state.reports, StaffReports.prototype);
    Object.setPrototypeOf(state.grading, StaffGrading.prototype);
    Object.setPrototypeOf(state.proposals, StaffProposals.prototype);
    let machineSettings = null;
    try { machineSettings = machineAdmissionRuntimeSettings(env, config); } catch { /* New admission denies below; retained records remain readable. */ }
    let workspaceSettings;
    try { workspaceSettings = workspaceRuntimeSettings(env, config); }
    catch { workspaceSettings = workspaceRuntimeSettings({}, config); }
    return { ...state, mode: config.mode, origin: config.origin, cookies: config.cookies,
        workspace: local && env.ATLAS_LOCAL_WORKSPACE_FIXTURE === '1'
            ? localWorkspaceFixture({ auth: state.auth, review: state.review, staffConfig: config, env })
            : createWorkspaceRuntime({ auth: state.auth, review: state.review, staffConfig: config, env, settings: workspaceSettings }),
        finishing: createFinishingRuntime({ auth: state.auth, review: state.review, staffConfig: config, env }),
        learning: createLearningRuntime({ auth: state.auth, review: state.review, staffConfig: config, env }),
        identityCorrection: createIdentityCorrectionRuntime({ auth: state.auth, review: state.review, staffConfig: config, env }),
        resolution: state.operations ? new StaffOperationalResolutionService({ admin: state.operations.admin }) : null,
        customerIntake: state.operations ? new StaffCustomerIntake({ admin: state.operations.admin }) : null,
        machine: state.operations ? new StaffMachinePreparation({ admin: state.operations.admin, settings: machineSettings }) : null,
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
        // Next's build-time headers cannot know a later private storage binding.
        // The authenticated staff runtime supplies its validated origin
        // on every HTML response, including the initial sign-in document.
        if(state.connectedManual) ctx.res.setHeader('Content-Security-Policy',staffContentSecurityPolicy({development:process.env.NODE_ENV==='development',
            uploadOrigins:[process.env.ATLAS_WORKSPACE_UPLOAD_ORIGIN,state.connectedManual.uploadOrigin]}));
        if (state.auth.database) await state.auth.database.transaction(() => undefined);
        if (!authenticated) return { props: { mode: state.mode ?? 'SYNTHETIC_LOCAL' } };
        const staff = await state.auth.maybeAuthenticate(ctx.req.headers.cookie);
        if (!staff) return { redirect: { destination: '/', permanent: false } };
        return { props: { staff, manualEnabled: Boolean(state.connectedManual) } };
    } catch {
        ctx.res.statusCode = 503; return { props: { unavailable: true } };
    }
}
