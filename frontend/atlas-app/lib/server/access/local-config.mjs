import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deny } from '../policy.mjs';
import { localAccessConfig } from './fixture.mjs';

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
    return localAccessConfig({ databaseUrl: record.databaseUrl, sessionKey: Buffer.from(record.sessionKey, 'hex'), phoneKey: Buffer.from(record.phoneKey, 'hex') });
}
