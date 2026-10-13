import { randomUUID } from 'node:crypto';
import { BROWSER_COOKIE, SESSION_COOKIE, LOCAL_ORIGIN } from '../policy.mjs';
import { makeAccessConfig } from './config.mjs';
import { STAFF_BASE_PATH } from '../../routes.mjs';

export function localAccessConfig({ databaseUrl, sessionKey, phoneKey, phones = ['+12025550141', '+12025550142'] }) {
    return makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, basePath: STAFF_BASE_PATH, deploymentId: 'local-postgres-fixture',
        releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`,
        databaseUrl, cookies: { browser: BROWSER_COOKIE, session: SESSION_COOKIE },
        sessionKey, phoneKey, approvedPhones: new Set(phones), providerLifetimeMs: 600_000 });
}

export { fixtureVerifyProvider } from './fixture-verify.mjs';

/** Elevated seeding is only used by the owned disposable fixture, never HTTP. */
export async function seedLocalStaff(admin, config, { identities: seedIdentities = true, trained = false } = {}) {
    if (config.mode !== 'LOCAL_FIXTURE') throw new Error('FIXTURE_ONLY');
    const now = new Date();
    const identities = [];
    await admin.$transaction(async tx => {
        await tx.staffControl.create({ data: { enabled: true, mode: config.mode, origin: config.origin,
            deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
            gradingPolicyHash: null } });
        for (const [index, phoneHash] of [...config.phoneByHash.keys()].entries()) {
            if (!seedIdentities) continue;
            identities.push(await tx.staffIdentity.create({ data: { id: randomUUID(), phoneHash,
                name: index === 1 ? 'Sample observer' : 'Sample reviewer', role: index === 1 ? 'OBSERVER' : 'REVIEWER',
                ...(trained && index !== 1 ? { certificationUntil: new Date(+now + 60 * 60_000) } : {}) } }));
        }
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    return identities;
}
