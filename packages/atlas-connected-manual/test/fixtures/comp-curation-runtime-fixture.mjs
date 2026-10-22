import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonical, digest } from '@atlas/manual-service/contract';
import { DurableStaffAuth } from '../../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { makeAccessConfig } from '../../../../frontend/atlas-app/lib/server/access/config.mjs';
import { createPrivateManualNonceStore, createManualServiceProxy } from '../../src/transport.mjs';
import { curationFixture, deferred } from '../../../../frontend/atlas-app/test/staff-comp-curation-fixture.mjs';
import { COMP_CURATION_TABLES, inspectCompCurationSchema } from '../../src/comp-curation-database.mjs';
import { createNativeCompCurationRuntime } from '../../src/comp-curation-runtime.mjs';

// Synthetic catalog/transaction/auth rows only. Actual SQL/role behavior remains
// the prior disposable-PG proof, not something this fixture can establish.
async function catalog(role, owner) {
  const baseline = await readFile(new URL('../../../atlas-standalone-database/sql/baseline.sql', import.meta.url), 'utf8');
  const proposal = await readFile(new URL('../../sql/comp-curation-proposal.sql', import.meta.url), 'utf8');
  const functions = ['atlas_manual.authenticate', 'atlas_manual.card_revision', 'atlas_manual.immutable', 'atlas_manual_intake.card_guard']
    .map(name => ({ name, owner, source: baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name.replaceAll('.', '\\.')}\\(.*?AS \\$function\\$(.*?)\\$function\\$;`, 's'))[1] }));
  functions.push({ name: 'atlas_manual.comp_curation_guard', owner, source: proposal.match(/AS \$\$(.*?)\$\$;/s)[1] });
  return { role: [{ name: role, session_name: role, unsafe: false }],
    schemas: [{ name: 'atlas_manual', usage: true, create: false }, { name: 'atlas_manual_intake', usage: true, create: false }, { name: 'public', usage: true, create: false }],
    columns: COMP_CURATION_TABLES.flatMap(name => ['id', 'content', 'revision'].map(column => ({ name, column, sel: true,
      ins: name === 'atlas_manual.comp_curation', upd: ['atlas_manual.card', 'atlas_manual_intake.card'].includes(name) && column === 'id', refs: false, extra: false }))),
    sequences: [], routines: [{ name: 'atlas_manual.authenticate', arguments: 'text, text, jsonb, text[]' }], functions,
    schema: COMP_CURATION_TABLES.map(name => ({ name, owner, kind: 'r', rls: false, force_rls: false,
      columns: [{ name: 'id' }], constraints: [], indexes: [], triggers: [] })) };
}
export function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
export async function nativeCompRuntimeFixture({ runtimeFactory = createNativeCompCurationRuntime } = {}) {
  const f = await curationFixture(), hooks = {}, trace = [], counts = { create: 0, disconnect: 0, auth: 0, artifact: 0, transaction: 0 };
  const role = 'atlas_synthetic_comp', schemaOwner = 'atlas_synthetic_owner', data = await catalog(role, schemaOwner);
  const config = makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', basePath: '/admin',
    deploymentId: 'synthetic-native', releaseSha: 'a'.repeat(40), databaseUrl: 'postgresql://atlas_synthetic_staff:never-used@127.0.0.1:5432/synthetic?schema=atlas_staff',
    sessionKey: randomBytes(32), phoneKey: randomBytes(32), routerKey: randomBytes(32),
    approvedPhones: new Set(['+12025550123']), cookies: { session: 'synthetic_session', browser: 'synthetic_browser' } });
  const token = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
  const identity = { id: f.staff.id, name: 'Synthetic reviewer', role: 'REVIEWER', accessVersion: 1,
    revokedAt: null, phoneHash: [...config.phoneByHash.keys()][0] };
  const session = { tokenHash: digest(token), browserHash: digest(browser), identityId: identity.id, identity,
    revokedAt: null, expiresAt: new Date('2099-01-01'), controlRevision: 1, accessVersion: 1,
    browser: { controlRevision: 1, expiresAt: new Date('2099-01-01') } };
  const state = { expired: false, discarded: false, failCreate: false };
  const staffDatabase = { client: {}, async transaction(work) {
    counts.auth++; await hooks.auth?.();
    return work({ control: { revision: 1 }, now: new Date('2026-10-22T00:00:00Z'), tx: {
      staffSession: { async findUnique({ where }) { return where.tokenHash === digest(token) && !state.expired ? session : null; } },
      async $queryRaw() { return [identity]; },
    } });
  } };
  const auth = new DurableStaffAuth({ database: staffDatabase, config, provider: {} });
  const cookie = `${config.cookies.session}=${token}; ${config.cookies.browser}=${browser}`, csrf = auth.digest(`session:${token}`);
  const serviceTx = await f.options.boundary.transaction(f.staff, async ({ tx }) => tx);
  const tx = { async $executeRawUnsafe(sql, ...args) {
    trace.push(sql);
    if (sql.includes('curation:insert')) return serviceTx.$executeRawUnsafe(sql, ...args);
    assert.match(sql, /^SET (?:LOCAL|CONSTRAINTS)/); return 0;
  }, async $queryRawUnsafe(sql, ...args) {
    trace.push(sql); const key = sql.match(/comp-db:([a-z]+)/)?.[1];
    if (key) return structuredClone(data[key]);
    if (sql.includes('curation:')) return serviceTx.$queryRawUnsafe(sql, ...args);
    if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe: false }];
    if (sql.startsWith('SELECT * FROM atlas_manual.authenticate')) {
      assert.equal(args[0], digest(token)); assert.equal(args[1], digest(browser));
      assert.deepEqual(JSON.parse(args[2]), Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, config[key]])));
      await hooks.refresh?.(); return state.expired ? [] : [{ ...identity, access_version: 1, certification_until: new Date('2099-01-01'), now_at: new Date('2026-10-22') }];
    }
    if (sql.startsWith('SELECT * FROM atlas_manual_intake.card')) return [{ id: f.cardId, owner_id: identity.id, create_request_id: f.cardId }];
    if (sql.startsWith('SELECT 1 FROM atlas_manual_intake.discarded_card')) return state.discarded ? [{}] : [];
    if (sql.startsWith('SELECT * FROM atlas_manual.card')) return [structuredClone(f.card)];
    if (sql.startsWith('SELECT p.*,i.public_token')) return [structuredClone(f.row)];
    assert.fail(`Unexpected query: ${sql}`);
  } };
  const schemaSha256 = (await inspectCompCurationSchema(tx)).sha256; trace.length = 0;
  const owned = { async $transaction(work, limits) {
    counts.transaction++; assert.equal(limits.timeout, 8000); const before = f.rows.length;
    try { await hooks.transaction?.(); return await work(tx); } catch (error) { f.rows.splice(before); throw error; }
  }, async $disconnect() { counts.disconnect++; } };
  const options = { enabled: true, environment: {}, auth, staffConfig: config,
    settings: { databaseUrl: `postgresql://${role}:never-used@127.0.0.1:5432/synthetic?schema=atlas_manual`, role, schemaOwner, schemaSha256,
      origin: config.origin, transportKey: randomBytes(32) }, nonceStore: createPrivateManualNonceStore(),
    createClient(value) { counts.create++; assert.deepEqual(value, { databaseUrl: options.settings.databaseUrl });
      if (state.failCreate) throw Error('Synthetic constructor failure'); return owned; },
    artifactReader: { async read(ref, expected, { signal }) {
      counts.artifact++; await hooks.artifact?.(expected, signal); signal.throwIfAborted();
      if (expected.kind === 'PUBLIC_REPORT') { assert.equal(expected.sourceHash, f.row.public_hash); assert.equal(ref.sha256, f.row.public_hash); return structuredClone(f.packet); }
      return f.options.artifacts.read(ref, expected);
    } },
  };
  const runtime = runtimeFactory(options), rawRequests = [];
  const proxy = createManualServiceProxy({ origin: 'https://synthetic-native.atlasgrading.com', key: options.settings.transportKey,
    async fetchImpl(target, init) {
      const url = new URL(target), req = { method: init.method, url: url.pathname + url.search,
        headers: { ...init.headers }, rawBody: Buffer.from(init.body ?? '') };
      rawRequests.push(req); await hooks.beforeNative?.(req);
      const out = response(); assert.equal(await runtime.handler(req, out), true);
      return new Response(JSON.stringify(out.body), { status: out.statusCode, headers: { 'content-type': 'application/json', ...out.headers } });
    } });
  const path = `/api/staff/manual-connected/cards/${f.cardId}/comp-curation`;
  async function request(input = null) {
    const out = response(); out.send = value => { out.body = JSON.parse(Buffer.from(value).toString('utf8')); };
    await proxy({ method: input ? 'POST' : 'GET', url: path + (input ? '/decision' : `?approvalActionId=${f.actionId}&previewId=${f.previewId}`),
      headers: { cookie, ...(input ? { origin: config.origin, 'content-type': 'application/json', 'x-atlas-csrf': csrf } : {}) },
      body: input ?? undefined }, out); return out;
  }
  return { ...f, runtime, options, owned, config, auth, identity, state, counts, data, trace, hooks, request, rawRequests,
    decision: (outcome = 'SKIP') => f.input({ outcome, selectedIds: [], reviewedIds: [], expectedPolicyHash: null }) };
}

export { deferred };
