#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { processingDollarLimitsScenarios } from './processing-dollar-limits-fixture.mjs';
const fixture = await disposablePostgres(process.argv.slice(2));
let passed = 0;
try {
    const scenario = async (name, work) => {
        const db = await fixture.database(), admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } }),
            client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } });
        const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
        const identities = await seedLocalStaff(admin, config, { analyses: true, trained: true, traces: true });
        const auth = new DurableStaffAuth({ config, database: new StaffDatabase(client, config), provider: fixtureVerifyProvider(config) });
        const login = async () => {
            const boot = await auth.bootstrap(undefined, 'processing-dollar-limits-fixture'), cookie = `${config.cookies.browser}=${boot.browserToken}`;
            const challenge = await auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'processing-dollar-limits-fixture');
            const result = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'processing-dollar-limits-fixture');
            return { ...result, cookie: `${cookie}; ${config.cookies.session}=${result.token}` };
        };
        try { await work({ db, admin, client, config, identities, auth, login, sql: (query, values) => fixture.sql(query, values, db.name) }); passed++; console.log(`PASS ${name}`); }
        finally { await admin.$disconnect(); await client.$disconnect(); await db.dispose(); }
    };
    await processingDollarLimitsScenarios(scenario);
    console.log(JSON.stringify({ result: 'PROCESSING_DOLLAR_LIMITS_POSTGRES_PASS', passed, source: fixture.source, directory: fixture.directory }));
} finally { await fixture.stop(); }
