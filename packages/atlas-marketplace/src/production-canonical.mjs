import { requireValue } from './contract.mjs';
import { r1ProofLogout, assertMarketplaceSignedTarget } from './auth-r1.mjs';

const check = value => requireValue(value, 'PRODUCTION_CANONICAL_CONFIGURATION_REQUIRED');
const logoutPaths = Object.freeze({ staff: '/admin/api/staff/auth/logout', customer: '/account/api/customer/auth/logout' });
const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(JSON.stringify(value));
};

export async function readProductionR1Bindings({ staffEnvironment, customerEnvironment, publicEnvironment } = {}) {
    const [staff, customer, publicPolicy] = await Promise.all([
        import('../../../frontend/atlas-app/lib/server/access/config.mjs'),
        import('../../../frontend/atlas-customer/lib/server/config.mjs'),
        import('../../../frontend/atlas-public/lib/server/policy.mjs'),
    ]);
    const configurations = { staff: staff.productionAccessConfig(staffEnvironment),
        customer: customer.productionConfig(customerEnvironment), public: publicPolicy.productionConfig(publicEnvironment) };
    return Object.freeze(Object.fromEntries(Object.entries(configurations).map(([surface, config]) =>
        [surface, Object.freeze(Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, config[key]])))])));
}

/** Actual production classes/configuration, with explicit protected inputs.
 * No fixture, ambient credential discovery, enrollment, provider call or job.
 * Generated clients must come from this release's normal application build.
 * Credentials stay in these owned clients and are never in status output.
 */
export async function createProductionR1Canonical({ staffEnvironment, customerEnvironment, publicEnvironment, manualDatabaseUrl } = {}) {
    const [staffConfigModule, customerConfigModule, publicConfigModule, staffModule, customerModule, staffDbModule, customerDbModule, router] = await Promise.all([
        import('../../../frontend/atlas-app/lib/server/access/config.mjs'),
        import('../../../frontend/atlas-customer/lib/server/config.mjs'),
        import('../../../frontend/atlas-public/lib/server/policy.mjs'),
        import('../../../frontend/atlas-app/lib/server/access/auth.mjs'),
        import('../../../frontend/atlas-customer/lib/server/auth.mjs'),
        import('../../../frontend/atlas-app/lib/server/access/database.mjs'),
        import('../../../frontend/atlas-customer/lib/server/database.mjs'),
        import('../../atlas-site-router/server.mjs'),
    ]);
    check(staffEnvironment && customerEnvironment && publicEnvironment);
    const staffConfig = staffConfigModule.productionAccessConfig(staffEnvironment);
    const customerConfig = customerConfigModule.productionConfig(customerEnvironment);
    const publicConfig = publicConfigModule.productionConfig(publicEnvironment);
    let manual, staff;
    try { manual = new URL(manualDatabaseUrl); staff = new URL(staffConfig.databaseUrl); } catch { check(false); }
    check(['postgres:', 'postgresql:'].includes(manual.protocol) && manual.hostname === staff.hostname && manual.port === staff.port
        && manual.pathname === staff.pathname && manual.username && manual.password && manual.username !== staff.username
        && manual.searchParams.get('schema') === 'atlas_manual' && manual.searchParams.get('sslmode') === 'require' && !manual.hash);
    const [{ PrismaClient: StaffClient }, { PrismaClient: CustomerClient }] = await Promise.all([
        import('../../../frontend/atlas-app/.generated/staff-database/index.js'),
        import('../../../frontend/atlas-customer/.generated/customer-database/index.js'),
    ]);
    const clients = []; let closed = false;
    try {
        const client = (Client, url) => { const value = new Client({ datasources: { db: { url } }, errorFormat: 'minimal' }); clients.push(value); return value; };
        // This process owns session checks/logout only, never SMS issuance.
        const staffAuth = new staffModule.DurableStaffAuth({ database: new staffDbModule.StaffDatabase(client(StaffClient, staffConfig.databaseUrl), staffConfig), config: staffConfig, provider: {} });
        const customerAuth = new customerModule.CustomerAuth({ database: new customerDbModule.CustomerDatabase(client(CustomerClient, customerConfig.databaseUrl), customerConfig), config: customerConfig, provider: {} });
        const manualClient = client(StaffClient, manual.href);
        const current = () => check(!closed);
        const staffState = Object.freeze({ auth: staffAuth, config: staffConfig, assertRequest(req) { current(); staffConfigModule.assertProductionStaffRequest(req, staffConfig); } });
        const customerState = Object.freeze({ auth: customerAuth, config: customerConfig, assertRequest(req) {
            current(); check(!req.headers.authorization && router.acceptsSiteRequest(req, { zone: 'customer', deploymentId: customerConfig.deploymentHost, routerKey: customerConfig.routerKey }));
        } });
        const handlers = {};
        for (const [surface, state] of [['staff', staffState], ['customer', customerState]]) {
            handlers[surface] = async (req, res) => {
                if (req.url !== logoutPaths[surface]) return reply(res, 404, { error: 'NOT_FOUND' });
                try {
                    current(); state.assertRequest(req); assertMarketplaceSignedTarget(req, { mode: 'PRODUCTION' });
                    check(req.method === 'POST' && req.headers.origin === state.config.origin
                        && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
                        && /^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''));
                    // Never fall back to direct legacy SQL on this owned route.
                    // host-r1 installs this private hook only after the genuine
                    // C0 producer and all its owners have constructed.
                    check(typeof r1ProofLogout(state.auth) === 'function');
                    const chunks = []; let length = 0;
                    for await (const chunk of req) { length += chunk.length; check(length <= 16384); chunks.push(chunk); }
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    check(body && Object.getPrototypeOf(body) === Object.prototype && Reflect.ownKeys(body).length === 0);
                    const csrf = req.headers[surface === 'staff' ? 'x-atlas-csrf' : 'x-atlas-customer-csrf'];
                    if (surface === 'staff') await state.auth.authenticate(req.headers.cookie, csrf ?? '');
                    await state.auth.logout(req.headers.cookie, csrf ?? '');
                    current();
                    res.setHeader('Set-Cookie', surface === 'staff'
                        ? staffConfigModule.secureStaffCookie(staffConfig.cookies.session, '', 0)
                        : customerConfigModule.cookie(customerConfig, customerConfig.cookies.session, '', 0));
                    return reply(res, 200, { signedOut: true });
                } catch (error) {
                    const status = [400, 401, 403, 405, 409, 413, 429].includes(error?.status) ? error.status : 503;
                    return reply(res, status, { error: status === 503 ? 'MARKETPLACE_UNAVAILABLE' : (/^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'REQUEST_REFUSED') });
                }
            };
        }
        handlers.public = (_req, res) => reply(res, 404, { error: 'NOT_FOUND' });
        return Object.freeze({ staffState, customerState, manualClient, publicConfig, existingHandlers: Object.freeze(handlers),
            async close() { if (closed) return; closed = true; await Promise.all(clients.map(value => value.$disconnect())); } });
    } catch (error) { closed = true; await Promise.allSettled(clients.map(value => value.$disconnect())); throw error; }
}
