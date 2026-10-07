import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeAccessConfig } from '../lib/server/access/config.mjs';
import { operationsRuntimeSettings } from '../lib/server/access/operations-runtime.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { deny, LOCAL_HOST, LOCAL_ORIGIN } from '../lib/server/policy.mjs';

const fixture = () => {
    const staff = makeAccessConfig({ basePath: '/admin', mode: 'PRODUCTION', origin: 'https://atlasgrading.com', deploymentId: 'staff-fixture.vercel.app',
        releaseSha: 'a'.repeat(40), databaseUrl: 'postgresql://staff:fictional@db.invalid:5432/fixture?schema=atlas_staff&sslmode=require',
        sessionKey: Buffer.alloc(32, 1), phoneKey: Buffer.alloc(32, 2), approvedPhones: new Set(['+12025550141']),
        accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`, providerLifetimeMs: 600_000 });
    const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_OPERATIONS_ENABLED: 'true',
        ATLAS_OPERATIONS_DATABASE_URL: 'postgresql://operations:fictional@db.invalid:5432/fixture?schema=atlas_staff&sslmode=require',
        ATLAS_INTAKE_ENABLED: 'true', ATLAS_INTAKE_ORIGIN: 'https://private-fixture.invalid',
        ATLAS_INTAKE_DEPLOYMENT_ID: 'private-fixture.vercel.app', ATLAS_INTAKE_RELEASE_SHA: 'b'.repeat(40),
        ATLAS_INTAKE_KEY: Buffer.alloc(32, 3).toString('base64'), ATLAS_INTAKE_GRADING_POLICY_HASH: 'c'.repeat(64) };
    return { staff, env };
};
test('operations requires its own explicit credential; intake binds its independent release and phone roster', () => {
    const { staff, env } = fixture(), settings = operationsRuntimeSettings(env, staff);
    assert.equal(settings.database.roleName, 'operations');
    assert.equal(settings.intake.deploymentId, env.ATLAS_INTAKE_DEPLOYMENT_ID);
    assert.equal(settings.intake.releaseSha, env.ATLAS_INTAKE_RELEASE_SHA);
    assert.notEqual(settings.intake.releaseSha, staff.releaseSha);
    for (const change of [{ ATLAS_OPERATIONS_DATABASE_URL: staff.databaseUrl }, { ATLAS_INTAKE_RELEASE_SHA: undefined },
        { ATLAS_INTAKE_GRADING_POLICY_HASH: 'invalid' }, { ATLAS_INTAKE_KEY: staff.sessionKey.toString('base64') },
        { ATLAS_LOCAL_POSTGRES: '1' }]) assert.throws(() => operationsRuntimeSettings({ ...env, ...change }, staff));
    assert.equal(operationsRuntimeSettings({ ...env, ATLAS_OPERATIONS_ENABLED: 'false' }, staff), null);
    assert.equal(operationsRuntimeSettings({ ...env, ATLAS_INTAKE_ENABLED: 'false' }, staff).intake, null);
    assert.notEqual(operationsRuntimeSettings({ ...env, ATLAS_INTAKE_KEY: Buffer.alloc(32, 4).toString('base64') }, staff).key, settings.key);
});
test('optional local operations requires the owned local configuration, never production environment credentials', () => {
    const { staff, env } = fixture(), local = { ...staff, mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, releaseSha: '0'.repeat(40),
        databaseUrl: 'postgresql://atlas_fixture_staff:fictional@127.0.0.1:54329/fixture?schema=atlas_staff' };
    assert.equal(operationsRuntimeSettings(env, local), null);
    const settings = operationsRuntimeSettings({}, { ...local,
        operationsDatabaseUrl: 'postgresql://atlas_fixture_operations:fictional@127.0.0.1:54329/fixture?schema=atlas_staff' });
    assert.equal(settings.database.roleName, 'atlas_fixture_operations'); assert.equal(settings.intake, null);
});

test('named operations routes require current authentication, CSRF, methods and bounded bodies before the service', async () => {
    let allowed = false, invoked = 0, last;
    const actor = Object.freeze({ id: randomUUID() });
    const auth = { async authenticate(cookie, csrf) {
        if (cookie !== 'synthetic-session') deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && csrf !== 'synthetic-csrf') deny(403, 'CSRF_REQUIRED');
        return actor;
    } };
    const methods = ['roster', 'updateRoster', 'assign', 'previewIntake', 'admitIntake', 'preparePilot', 'reconcileInvoice', 'pilotSummary'];
    const operations = Object.fromEntries(methods.map(name => [name, async (staff, input) => {
        assert.equal(staff, actor); if (!allowed) deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        invoked++; last = { name, input }; return { received: name };
    }]));
    const state = { auth, review: {}, operations }, env = { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' };
    const handler = createHandler(state, env);
    async function call(path, method, body, headers = {}) {
        const out = { headers: {} }, res = { setHeader(k, v) { out.headers[k] = v; }, status(value) { out.status = value; return this; },
            json(value) { out.body = value; return this; } };
        await handler({ url: `/api/staff/operations/${path}`, method, body, socket: { remoteAddress: '127.0.0.1' },
            headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie: 'synthetic-session',
                'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf', ...headers } }, res);
        return out;
    }
    assert.equal((await call('roster', 'GET', undefined, { cookie: '' })).status, 401);
    assert.equal((await call('roster', 'GET')).status, 403);
    allowed = true;
    assert.equal((await call('assign', 'POST', {}, { 'x-atlas-csrf': '' })).status, 403);
    assert.equal((await call('assign', 'POST', {}, { origin: 'https://unrelated.invalid' })).status, 403);
    assert.equal((await call('assign', 'POST', { value: 'x'.repeat(16384) })).status, 413);
    assert.equal((await call('roster', 'POST', {})).status, 405);
    assert.equal((await call('activate', 'POST', {})).status, 404);
    assert.equal(invoked, 0);
    const id = randomUUID();
    for (const [path, method, name, envelope] of [['roster', 'GET', 'roster', 'roster'],
        ['roster/update', 'POST', 'updateRoster', 'receipt'], ['assign', 'POST', 'assign', 'receipt'],
        ['intake/preview', 'POST', 'previewIntake', 'preview'], ['intake/admit', 'POST', 'admitIntake', 'receipt'],
        ['pilots/prepare', 'POST', 'preparePilot', 'receipt'], ['invoices/reconcile', 'POST', 'reconcileInvoice', 'receipt'],
        [`pilots/${id}`, 'GET', 'pilotSummary', 'summary']]) {
        const result = await call(path, method, method === 'POST' ? { requested: name } : undefined);
        assert.equal(result.status, 200); assert.deepEqual(result.body, { [envelope]: { received: name } });
        assert.equal(last.name, name); assert.deepEqual(last.input, name === 'pilotSummary' ? id : method === 'POST' ? { requested: name } : undefined);
    }
    state.operations = null;
    assert.equal((await call('roster', 'GET')).status, 404);
});
