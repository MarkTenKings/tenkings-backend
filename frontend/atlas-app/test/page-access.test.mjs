import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageAccess } from '../lib/server/page-access.mjs';
import { BoundaryError } from '../lib/server/policy.mjs';
import { productionAccessConfig } from '../lib/server/access/config.mjs';
const production = { ATLAS_STAFF_RUNTIME: 'postgres', NODE_ENV: 'production', VERCEL_ENV: 'production' };
const sensitive = 'DO_NOT_RECORD_PRIVATE_CREDENTIAL_OR_REQUEST';
function fixture({ env = production, runtimeError, databaseError, sessionError, logError, manual, signedIn = true } = {}) {
  const logs = [], calls = { runtime: 0, database: 0, session: 0 }, headers = {};
  const staff = { id: 'fixture-staff', role: 'REVIEWER' };
  const state = { mode: 'PRODUCTION', connectedManual: manual, auth: {
    database: { async transaction(work) { calls.database++; if (databaseError) throw databaseError; return work(); } },
    async maybeAuthenticate() { calls.session++; if (sessionError) throw sessionError; return signedIn ? staff : null; },
  } };
  const access = createPageAccess({ environment: () => ({ ...env, ATLAS_AUTH_SESSION_KEY: sensitive }),
    resolveRuntime() { calls.runtime++; if (runtimeError) throw runtimeError; return state; },
    log(entry) { logs.push(entry); if (logError) throw Error(sensitive); } });
  const ctx = { req: { method: 'GET', url: '/manual?private=' + sensitive, headers: { cookie: sensitive, authorization: sensitive } },
    res: { setHeader(key, value) { headers[key] = value; } } };
  return { access, ctx, logs, calls, headers, staff };
}
test('explicit disabled runtime is identified using the real production config gate', async () => {
  let error; try { productionAccessConfig({ ...production, ATLAS_STAFF_RUNTIME: 'off' }); } catch (failure) { error = failure; }
  const f = fixture({ env: { ...production, ATLAS_STAFF_RUNTIME: 'off' }, runtimeError: error });
  const result = await f.access(f.ctx);
  assert.equal(result.props.accessFailure.kind, 'DISABLED'); assert.equal(f.ctx.res.statusCode, 503);
  assert.equal(f.calls.database, 0); assert.equal(f.calls.session, 0);
  assert.equal(f.logs[0].code, 'STAFF_ACCESS_NOT_ENABLED'); assert.equal(f.logs[0].stage, 'RUNTIME');
});
test('database control mismatch never claims the deployment is disabled or returns staff', async () => {
  const f = fixture({ databaseError: new BoundaryError(503, 'STAFF_ACCESS_NOT_ENABLED') });
  const result = await f.access(f.ctx);
  assert.equal(result.props.unavailable, true); assert.equal(result.props.accessFailure.kind, 'CHECK_FAILED');
  assert.equal(result.props.staff, undefined); assert.equal(result.props.manualEnabled, undefined); assert.equal(f.calls.session, 0);
  assert.equal(f.logs[0].stage, 'DATABASE_ACCESS'); assert.equal(f.logs[0].code, 'STAFF_ACCESS_NOT_ENABLED');
});
test('configuration errors get their own safe category while ingress remains denied', async () => {
  for (const code of ['ACCESS_CONFIGURATION_INVALID', 'MANUAL_CONFIGURATION_INVALID', 'HOST_NOT_ALLOWED', 'STAFF_COOKIE_REQUIRED']) {
    const f = fixture({ runtimeError: new BoundaryError(code.startsWith('STAFF_') || code === 'HOST_NOT_ALLOWED' ? 403 : 503, code) });
    const result = await f.access(f.ctx);
    assert.equal(result.props.accessFailure.kind, code.endsWith('CONFIGURATION_INVALID') ? 'CONFIGURATION' : 'CHECK_FAILED');
    assert.equal(f.ctx.res.statusCode, 503); assert.equal(f.calls.database, 0); assert.equal(result.props.staff, undefined);
  }
});
test('Prisma and unknown failures retain only allowlisted diagnostics, never raw errors or context', async () => {
  for (const code of ['P2024', sensitive, undefined]) {
    const failure = Object.assign(new Error(sensitive), { code, meta: { query: sensitive }, cause: new Error(sensitive) });
    const f = fixture({ databaseError: failure }); const result = await f.access(f.ctx);
    assert.equal(f.logs[0].code, code === 'P2024' ? 'P2024' : 'UNCLASSIFIED');
    assert.deepEqual(Object.keys(f.logs[0]).sort(), ['event', 'reference', 'kind', 'stage', 'code', 'status'].sort());
    assert.equal(f.logs[0].reference, result.props.accessFailure.reference);
    assert.match(result.props.accessFailure.reference, /^[a-f0-9-]{36}$/);
    assert.doesNotMatch(JSON.stringify({ logs: f.logs, result }), new RegExp(sensitive));
    assert.equal(result.props.accessFailure.code, undefined); assert.equal(result.props.accessFailure.stage, undefined);
    assert.equal(f.headers['Cache-Control'], 'private, no-store, max-age=0'); assert.equal(f.headers.Vary, 'Cookie');
  }
});
test('runtime configuration ambiguity does not become a disabled-deployment claim', async () => {
  const f = fixture({ runtimeError: new BoundaryError(503, 'STAFF_ACCESS_NOT_ENABLED') });
  assert.equal((await f.access(f.ctx)).props.accessFailure.kind, 'CHECK_FAILED');
});
test('invalid upload CSP remains fail closed and is logged without the unsafe origin', async () => {
  const f = fixture({ manual: { uploadOrigin: 'https://user:' + sensitive + '@storage.example' } });
  const result = await f.access(f.ctx);
  assert.equal(result.props.accessFailure.kind, 'CHECK_FAILED'); assert.equal(f.logs[0].stage, 'CONTENT_SECURITY_POLICY');
  assert.equal(f.logs[0].code, 'CONTENT_SECURITY_POLICY_INVALID'); assert.equal(f.calls.database, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), new RegExp(sensitive));
});
test('session lookup failure does not return an actor or bypass the database check', async () => {
  const f = fixture({ sessionError: new BoundaryError(503, 'STAFF_DATABASE_ROLE_INVALID') });
  const result = await f.access(f.ctx);
  assert.equal(f.calls.database, 1); assert.equal(f.calls.session, 1); assert.equal(f.logs[0].stage, 'SESSION_ACCESS');
  assert.equal(result.props.staff, undefined); assert.equal(f.ctx.res.statusCode, 503);
});
test('normal sign-in, signed-out redirect and verified staff paths preserve existing checks', async () => {
  const signIn = fixture(); assert.deepEqual(await signIn.access(signIn.ctx, { authenticated: false }), { props: { mode: 'PRODUCTION' } });
  assert.equal(signIn.calls.database, 1); assert.equal(signIn.calls.session, 0); assert.equal(signIn.logs.length, 0);
  const signedOut = fixture({ signedIn: false }); assert.deepEqual(await signedOut.access(signedOut.ctx), { redirect: { destination: '/', permanent: false } });
  assert.equal(signedOut.calls.database, 1); assert.equal(signedOut.calls.session, 1);
  const verified = fixture({ manual: { uploadOrigin: 'https://storage.example' } }); verified.ctx.req.method = 'HEAD';
  assert.deepEqual(await verified.access(verified.ctx), { props: { staff: verified.staff, manualEnabled: true } });
  assert.match(verified.headers['Content-Security-Policy'], /https:\/\/storage.example/); assert.equal(verified.logs.length, 0);
});
test('non-read methods never invoke runtime, database, session, or a replay', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const f = fixture(); f.ctx.req.method = method;
    const result = await f.access(f.ctx);
    assert.equal(f.ctx.res.statusCode, 405); assert.equal(f.headers.Allow, 'GET, HEAD');
    assert.equal(result.props.accessFailure.kind, 'METHOD_NOT_ALLOWED'); assert.deepEqual(f.calls, { runtime: 0, database: 0, session: 0 });
  }
});
test('logger failure cannot alter denial and each failed check has a fresh reference', async () => {
  const f = fixture({ databaseError: new Error(sensitive), logError: true });
  const a = await f.access(f.ctx), b = await f.access(f.ctx);
  assert.equal(a.props.unavailable, true); assert.equal(b.props.unavailable, true);
  assert.notEqual(a.props.accessFailure.reference, b.props.accessFailure.reference); assert.equal(f.ctx.res.statusCode, 503);
});
