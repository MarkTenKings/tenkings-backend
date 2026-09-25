import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { recordApiFailure, markAccessFailure } from '../lib/server/api-failure.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';

const reference = 'ac7aba2c-94e7-4bd4-8b86-572606c2746b';
const response = () => { const result = {}; return { result, setHeader() {}, status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } }; };

test('unexpected session failure preserves safe response and logs only allowlisted context', async () => {
  const secret = 'private-cookie-image-query-value', entries = [];
  const error = Object.assign(new Error(secret), { name: 'PrismaClientKnownRequestError', code: 'P2010',
    meta: { code: '42501', message: secret, query: secret }, stack: secret });
  markAccessFailure(error, 'IDENTITY_LOCK'); markAccessFailure(error, 'STAFF_WORK'); markAccessFailure(error, secret);
  const handler = createHandler({ assertRequest() {}, auth: { async bootstrap() { throw error; } } },
    { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), DATABASE_URL: secret }, { log: value => entries.push(value), reference: () => reference });
  const res = response();
  await handler({ url: `/api/staff/session?secret=${secret}`, method: 'GET', headers: { cookie: secret }, socket: {} }, res);
  assert.deepEqual(res.result, { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE', reference } });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].phases, ['IDENTITY_LOCK', 'STAFF_WORK']);
  assert.equal(entries[0].stage, 'SESSION'); assert.equal(entries[0].route, 'SESSION');
  assert.equal(entries[0].databaseCode, 'P2010'); assert.equal(entries[0].sqlState, '42501');
  assert.equal(entries[0].release, 'a'.repeat(40));
  assert.equal(JSON.stringify(entries).includes(secret), false);
});

test('unknown error properties cannot enter diagnostics and logger failure keeps denial', async () => {
  const entries = [], secret = 'private-content';
  const id = recordApiFailure({ error: { name: secret, code: secret, errorCode: secret, meta: { code: secret } }, stage: secret,
    req: { url: `/admin/api/staff/manual-intake/cards/${secret}/uploads/${secret}/complete?token=${secret}`, method: secret },
    env: { VERCEL_GIT_COMMIT_SHA: secret }, elapsedMs: Infinity, reference: () => reference, log: value => entries.push(value) });
  assert.equal(id, reference); assert.equal(entries[0].route, 'UPLOAD_COMPLETE');
  assert.equal(entries[0].stage, 'UNKNOWN'); assert.equal(entries[0].elapsedMs, null);
  assert.equal(entries[0].databaseCode, null); assert.equal(entries[0].sqlState, null);
  assert.equal(JSON.stringify(entries).includes(secret), false);
  const handler = createHandler(() => { throw new TypeError(secret); }, {}, { reference: () => reference, log() { throw new Error(secret); } });
  const res = response(); await handler({ method: 'GET', url: '/api/staff/session' }, res);
  assert.equal(res.result.status, 503); assert.equal(res.result.body.reference, reference);
});

test('pool acquisition and authenticated lookup failures retain their distinct phases', async () => {
  const poolError = Object.assign(new Error('not logged'), { code: 'P2028' });
  const database = new StaffDatabase({ async $transaction() { throw poolError; } }, {});
  await assert.rejects(database.transaction(() => { throw new Error('must not start'); }), error => error === poolError);
  const lookupError = Object.assign(new Error('not logged'), { code: 'P2010', meta: { code: '42703' } });
  const auth = new DurableStaffAuth({});
  await assert.rejects(auth.current({ tx: { staffSession: { async findUnique() { throw lookupError; } } } }, 'hash', 'hash'), error => error === lookupError);
  const entries = [];
  for (const error of [poolError, lookupError]) recordApiFailure({ error, stage: 'SESSION', req: {}, elapsedMs: 0,
    log: value => entries.push(value), reference: () => reference });
  assert.deepEqual(entries.map(value => value.phases), [['STAFF_BEGIN'], ['SESSION_LOOKUP']]);
});
