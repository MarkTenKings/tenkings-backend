import { acceptsSiteRequest } from '@atlas/site-router/server';
import { CustomerAuth } from './auth.mjs';
import { CustomerDatabase } from './database.mjs';
import { productionConfig, cookie } from './config.mjs';
import { deny } from './policy.mjs';
import { twilioVerifyTransport } from './twilio.mjs';
let current;
export async function runtime() {
    if (current) return current;
    const env = process.env;
    let config, provider;
    if (env.NODE_ENV === 'development' && env.ATLAS_LOCAL_CUSTOMER === '1') {
        const fixture = await import('./fixture.mjs'); config = fixture.readLocalConfig(env); provider = fixture.fixtureProvider(config);
    } else {
        config = productionConfig(env);
        provider = twilioVerifyTransport({ accountSid: config.accountSid, serviceSid: config.serviceSid,
            apiKeySid: env.ATLAS_CUSTOMER_TWILIO_API_KEY_SID, apiKeySecret: env.ATLAS_CUSTOMER_TWILIO_API_KEY_SECRET });
    }
    const { PrismaClient } = await import('../../.generated/customer-database/index.js');
    const client = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
    const database = new CustomerDatabase(client, config), auth = new CustomerAuth({ database, config, provider });
    current = { auth, config, cookie: (name, value, age) => cookie(config, name, value, age),
        assertRequest(req) {
            if (req.headers.authorization) deny(403, 'CUSTOMER_COOKIE_REQUIRED');
            if (config.mode === 'PRODUCTION') {
                if (!acceptsSiteRequest(req, { zone: 'customer', deploymentId: config.deploymentHost, routerKey: config.routerKey })) deny(403, 'HOST_NOT_ALLOWED');
            } else if (req.headers.host !== '127.0.0.1:4318' || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket?.remoteAddress)
                || (req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'] !== '127.0.0.1:4318')) deny(403, 'HOST_NOT_ALLOWED');
        },
        clientAddress(req) {
            if (config.mode === 'LOCAL_FIXTURE') return req.socket?.remoteAddress ?? 'loopback';
            // Vercel supplies this header on the trusted ingress; do not consume
            // an arbitrary forwarded chain as a separate rate-limit identity.
            const value = req.headers['x-vercel-forwarded-for'];
            return typeof value === 'string' && /^[a-fA-F0-9:.]{3,64}$/.test(value) ? value : 'customer-ingress';
        },
    };
    return current;
}
