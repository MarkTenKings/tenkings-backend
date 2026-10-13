import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deny } from '../policy.mjs';
import { makeAccessConfig } from './config.mjs';
import { BROWSER_COOKIE, SESSION_COOKIE, LOCAL_ORIGIN } from '../policy.mjs';
import { STAFF_BASE_PATH } from '../../routes.mjs';

function localAccessConfig({ databaseUrl, sessionKey, phoneKey }) {
    return makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, basePath: STAFF_BASE_PATH, deploymentId: 'local-postgres-fixture',
        releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`,
        databaseUrl, cookies: { browser: BROWSER_COOKIE, session: SESSION_COOKIE }, sessionKey, phoneKey,
        approvedPhones: new Set(['+12025550141', '+12025550142']), providerLifetimeMs: 600_000 });
}

export function readLocalPostgresConfig(env) {
    if (env.NODE_ENV !== 'development' || env.ATLAS_LOCAL_POSTGRES !== '1' || env.ATLAS_LOCAL_SYNTHETIC
        || Object.keys(env).some(key => /^(VERCEL|NOW_|AWS_LAMBDA|FUNCTIONS_WORKER)/.test(key))) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    const path = realpathSync(env.ATLAS_LOCAL_POSTGRES_FILE);
    const directory = dirname(path), info = statSync(path);
    if (!/^\/private\/tmp\/atlas-staff-db-[A-Za-z0-9]+\/web-config\.json$/.test(path)
        || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 8192) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    const ownership = JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8'));
    const database = new URL(record.databaseUrl);
    if (!ownership.createdByHarness || ownership.uid !== process.getuid() || ownership.nonce !== record.nonce
        || ownership.data !== join(directory, 'data') || database.hostname !== '127.0.0.1' || !database.port
        || database.username !== 'atlas_fixture_staff' || !/^\/atlas_fixture_case_\d+$/.test(database.pathname)
        || database.searchParams.get('schema') !== 'atlas_staff'
        || !/^[a-f0-9]{64}$/.test(record.sessionKey ?? '') || !/^[a-f0-9]{64}$/.test(record.phoneKey ?? '')) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    return Object.freeze({ ...localAccessConfig({ databaseUrl: record.databaseUrl, sessionKey: Buffer.from(record.sessionKey, 'hex'),
        phoneKey: Buffer.from(record.phoneKey, 'hex') }) });
}
