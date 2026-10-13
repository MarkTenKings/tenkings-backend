import { assertPublicRequest, productionConfig } from './policy.mjs';
import { PublicReportReader } from './reader.mjs';
import { manualPublicClient } from '@atlas/service-bridge/manual-public';
import { createCustomerServiceClient } from '@atlas/service-bridge/customer-service';
import { customerCapacity } from '@atlas/commerce/capacity';

export function runtime(req, env = process.env) {
    const config = productionConfig(env);
    assertPublicRequest(req, config);
    const key = Symbol.for(`atlas.public.manual.reader.${config.configHash}.${config.deploymentId}.${config.releaseSha}`);
    globalThis[key] ??= new PublicReportReader(config, manualPublicClient(config));
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
