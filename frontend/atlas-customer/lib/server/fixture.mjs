import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeConfig, LOCAL_COOKIES, LOCAL_ORIGIN } from './config.mjs';
import { deny } from './policy.mjs';

export function localConfig({ databaseUrl, sessionKey, phoneKey }) {
    return makeConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, deploymentId: 'local-customer-fixture',
        releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`,
        cookies: LOCAL_COOKIES, databaseUrl, sessionKey, phoneKey });
}
export function readLocalConfig(env) {
    if (env.NODE_ENV !== 'development' || env.ATLAS_LOCAL_CUSTOMER !== '1'
        || Object.keys(env).some(key => /^(VERCEL|NOW_|AWS_LAMBDA|FUNCTIONS_WORKER)/.test(key))) deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
    const path = realpathSync(env.ATLAS_LOCAL_CUSTOMER_FILE), info = statSync(path), dir = dirname(path);
    if (!/^\/private\/tmp\/atlas-staff-db-[A-Za-z0-9]+\/customer-web-config\.json$/.test(path)
        || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 8192) deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
    const record = JSON.parse(readFileSync(path, 'utf8')), ownership = JSON.parse(readFileSync(join(dir, 'ownership.json'), 'utf8'));
    const url = new URL(record.databaseUrl);
    if (!ownership.createdByHarness || ownership.uid !== process.getuid() || ownership.nonce !== record.nonce
        || ownership.data !== join(dir, 'data') || url.hostname !== '127.0.0.1' || !url.port
        || url.username !== 'atlas_fixture_customer' || !/^\/atlas_fixture_case_\d+$/.test(url.pathname)
        || url.searchParams.get('schema') !== 'atlas_customer' || !/^[a-f0-9]{64}$/.test(record.sessionKey ?? '')
        || !/^[a-f0-9]{64}$/.test(record.phoneKey ?? '')) deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
    return localConfig({ databaseUrl: url.href, sessionKey: Buffer.from(record.sessionKey, 'hex'), phoneKey: Buffer.from(record.phoneKey, 'hex') });
}
/** Synthetic responses only; no network. Production cannot select this runtime. */
export function fixtureProvider(config) {
    const issued = new Map();
    return {
        async start(phone) {
            const result = { accountSid: config.accountSid, serviceSid: config.serviceSid,
                verificationSid: `VE${randomBytes(16).toString('hex')}`, phone, channel: 'sms', status: 'pending' };
            issued.set(result.verificationSid, result); return result;
        },
        async check(sid, code) {
            const old = issued.get(sid); if (!old) throw Error('SYNTHETIC_VERIFICATION_EXPIRED');
            return { ...old, status: code === '424242' ? 'approved' : 'pending' };
        },
    };
}
