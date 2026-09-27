import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { PERSISTENT_STAFF_EXPIRY } from '../lib/server/access/session-policy.mjs';
import { hash } from '../lib/server/policy.mjs';

// Owns a disposable cluster, with synthetic SMS and no production credentials.
const fixture = await disposablePostgres(process.argv.slice(2));
let admin, client;
try {
    const db = await fixture.database();
    admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } });
    const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    await seedLocalStaff(admin, config);
    const database = new StaffDatabase(client, config);
    // Issue through the real restricted role two hours in the past. The SQL
    // manual boundary below uses its real current database clock.
    let offset = -2 * 3600_000;
    const clocked = { transaction: work => database.transaction(c => work({ ...c, now: new Date(+c.now + offset) })) };
    const auth = new DurableStaffAuth({ database: clocked, config, provider: fixtureVerifyProvider(config) });
    const boot = await auth.bootstrap('');
    const browserCookie = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browserCookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'fixture');
    const verified = await auth.verify(browserCookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture');
    const cookie = `${browserCookie}; ${config.cookies.session}=${verified.token}`;
    const session = await admin.staffSession.findUnique({ where: { tokenHash: hash(verified.token) }, include: { browser: true } });
    assert.equal(session.expiresAt.toISOString(), PERSISTENT_STAFF_EXPIRY);
    assert.equal(session.browser.expiresAt.toISOString(), PERSISTENT_STAFF_EXPIRY);
    assert(Date.now() - +session.createdAt > 3600_000);
    offset = 0;
    assert.equal((await auth.authenticate(cookie, verified.csrf)).id, session.identityId);
    const binding = JSON.stringify(Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,config[k]])));
    const manual = () => admin.$queryRawUnsafe('SELECT * FROM atlas_manual.authenticate($1,$2,$3::jsonb,$4::text[])',
        session.tokenHash, session.browserHash, binding, [...config.phoneByHash.keys()]);
    assert.equal((await manual()).length,1);
    await auth.logout(cookie,verified.csrf);
    await assert.rejects(()=>auth.authenticate(cookie),{message:'SIGN_IN_REQUIRED'});
    assert.equal((await manual()).length,0);
    const result={ok:true,issuedThroughRestrictedRole:true,elapsedHours:2,manualSqlAcceptsPersistentSession:true,
        logoutRevokesWebAndManual:true,staffMigrations:fixture.source.staffMigrations.length};
    writeFileSync(`${fixture.directory}/persistent-result.json`,JSON.stringify(result,null,2));
    console.log(JSON.stringify({...result,evidence:fixture.directory}));
} finally {
    await client?.$disconnect(); await admin?.$disconnect(); await fixture.stop();
}
