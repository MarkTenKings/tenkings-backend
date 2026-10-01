import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '../../.generated/public-database/index.js';
import { assertPublicRequest, LOCAL_ORIGIN, makePublicConfig, productionConfig, unavailable } from './policy.mjs';
import { PublicReportReader } from './reader.mjs';
import { publicMediaClient } from '@atlas/service-bridge/public-media';
import { manualPublicClient } from '@atlas/service-bridge/manual-public';
import { fixtureArtwork } from '@atlas/report-view/fixture-artwork';
import { createCustomerServiceClient } from '@atlas/service-bridge/customer-service';
import { customerCapacity } from '@atlas/commerce/capacity';

function localConfig(env) {
    if (env.NODE_ENV !== 'development' || env.ATLAS_LOCAL_PUBLIC !== '1'
        || Object.keys(env).some(k => /^(VERCEL|NOW_|AWS_LAMBDA|FUNCTIONS_WORKER)/.test(k))) unavailable();
    const path = realpathSync(env.ATLAS_LOCAL_PUBLIC_FILE), directory = dirname(path), info = statSync(path);
    if (!/^\/private\/tmp\/atlas-staff-db-[A-Za-z0-9]+\/public-config\.json$/.test(path)
        || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 8192) unavailable();
    const record = JSON.parse(readFileSync(path, 'utf8')), ownership = JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8'));
    const database = new URL(record.databaseUrl);
    if (!ownership.createdByHarness || ownership.uid !== process.getuid() || ownership.nonce !== record.nonce
        || ownership.data !== join(directory, 'data') || database.hostname !== '127.0.0.1' || !database.port
        || database.username !== 'atlas_fixture_public' || !/^\/atlas_fixture_case_\d+$/.test(database.pathname)
        || database.searchParams.get('schema') !== 'atlas_staff') unavailable();
    return makePublicConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, deploymentId: 'local-public-fixture',
        releaseSha: '0'.repeat(40), databaseUrl: record.databaseUrl });
}
export function runtime(req, env = process.env) {
    const config = env.ATLAS_LOCAL_PUBLIC === '1' ? localConfig(env) : productionConfig(env);
    assertPublicRequest(req, config);
    const key = Symbol.for(`atlas.public.reader.${config.configHash}.${config.deploymentId}.${config.releaseSha}`);
    globalThis[key] ??= new PublicReportReader(config.databaseUrl ? new PrismaClient({ datasources: { db: { url: config.databaseUrl } }, errorFormat: 'minimal' }) : null, config,
        config.mode === 'LOCAL_FIXTURE' ? { async read(_reference, descriptor) { return fixtureArtwork(descriptor.sourceRef); } } : config.mediaOrigin ? publicMediaClient(config) : null,
        config.manualOrigin ? manualPublicClient(config) : null);
    Object.setPrototypeOf(globalThis[key], PublicReportReader.prototype);
    globalThis[key].dealerLocations = async () => {
        const encoded = env.ATLAS_CUSTOMER_DIRECTORY_KEY;
        if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('KIOSK_DIRECTORY_UNAVAILABLE');
        const client = createCustomerServiceClient({url:env.ATLAS_CUSTOMER_SERVICE_URL,key:Buffer.from(encoded,'base64')});
        return client.call('dealer-locations',{input:{}});
    };
    globalThis[key].weeklyCapacity = async () => {
        const encoded = env.ATLAS_CUSTOMER_DIRECTORY_KEY;
        if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('WEEKLY_CAPACITY_UNAVAILABLE');
        const client = createCustomerServiceClient({ url: env.ATLAS_CUSTOMER_SERVICE_URL, key: Buffer.from(encoded, 'base64') });
        return customerCapacity(await client.call('weekly-capacity', { input: {} }));
    };
    return globalThis[key];
}
