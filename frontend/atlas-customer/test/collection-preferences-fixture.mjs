// Synthetic transaction adapter only; actual auth, qualified preference service,
// HTTP, signed ingress and browser contracts execute. No PostgreSQL/network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, webcrypto } from 'node:crypto';
import { signRoute } from '@atlas/site-router/proof';
import { acceptsSiteRequest } from '@atlas/site-router/server';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createCollectionPreferencesHandler } from '../lib/server/collection-preferences-http.mjs';
import { createCardOwnershipPreferencesService, OWNERSHIP_PREFERENCES_ROUTINE_PINS } from '../../../packages/atlas-connected-manual/src/card-ownership-preferences-service.mjs';
import { projectOwnershipPreferences } from '../../../packages/atlas-connected-manual/src/card-ownership-preferences-contract.mjs';
export const prefId = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const AID = prefId(1), CID = prefId(2), OTHER = prefId(3), TIME = '2026-10-22T09:30:00.000000Z';
export const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
export const rawCurrent = (card = false) => ({ accountId: AID, observedAt: TIME,
  collectionPreferences: { accountId: AID, revision: 0, visibility: 'PRIVATE', offersDisabled: false },
  cardPreferences: card ? { cardId: CID, ownershipRevision: 2, revision: 0, visibility: 'PRIVATE', offersDisabled: false } : null });
export const rawReceipt = (action, input) => ({ accountId: AID, observedAt: TIME, requestId: input.requestId, receipt: {
  eventId: randomUUID(), requestId: input.requestId, action, kind: action === 'set_card_preferences' ? 'CARD_PREFERENCES_SET' : 'COLLECTION_PREFERENCES_SET',
  cardId: input.cardId ?? null, input: { ...input }, preferenceRevision: input.expectedPreferenceRevision + 1, recordedAt: TIME } });
export const projected = (action, raw, input = {}) => projectOwnershipPreferences(action, raw, input, AID);
export function createPreferenceFixture() {
  const config = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', deploymentId: 'preference-fixture.vercel.app', deploymentHost: 'preference-fixture.vercel.app',
    releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64), routerKey: Buffer.alloc(32, 7), sessionKey: Buffer.alloc(32, 8), cookies: { browser: 'prefs_browser', session: 'prefs_session' } };
  config.binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(k => [k, config[k]]));
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('No broad customer call'); } }, provider: { start() { assert.fail('No provider'); } } });
  const b = Buffer.alloc(32, 2).toString('base64url'), s = Buffer.alloc(32, 3).toString('base64url'), cookie = `prefs_browser=${b}; prefs_session=${s}`, csrf = auth.digest('session:' + s);
  const records = new Map(), actions = [], requests = [], stats = { begins: 0, commits: 0, rollbacks: 0 };
  let current = rawCurrent(true);
  const defs = OWNERSHIP_PREFERENCES_ROUTINE_PINS.map(v => ({ ...v, config: [...v.config], owner: 'atlas_fixture_owner' }));
  const f = { config, auth, cookie, csrf, records, actions, requests, stats, defs, unsafe: false, liveAccount: AID, ownCard: true,
    beforeQuery: null, afterQuery: null, afterCommit: null, afterHTTP: null, requestHook: null, lastRequest: null };
  async function gateway(action, input) {
    if (!f.liveAccount) return { error: { status: 401, code: 'SIGN_IN_REQUIRED' } };
    const base = { accountId: f.liveAccount, observedAt: TIME };
    if (action === 'read_access') return base;
    if (action === 'read_preferences' || action === 'read_card') {
      if (action === 'read_card' && !f.ownCard) return { error: { status: 404, code: 'OWNERSHIP_NOT_FOUND' } };
      return { ...structuredClone(current), ...base, cardPreferences: action === 'read_card' ? structuredClone(current.cardPreferences) : null };
    }
    if (action === 'recover_request') return records.get(input.requestId) ?? { ...base, requestId: input.requestId, receipt: null };
    assert(['set_collection_preferences', 'set_card_preferences'].includes(action));
    if (records.has(input.requestId)) return records.get(input.requestId);
    const target = action === 'set_collection_preferences' ? current.collectionPreferences : current.cardPreferences;
    if (target.revision > input.expectedPreferenceRevision) return { ...base, requestId: input.requestId, action, cardId: input.cardId ?? null,
      input: { ...input }, observedPreferenceRevision: target.revision };
    if (action === 'set_card_preferences' && !f.ownCard) return { error: { status: 404, code: 'OWNERSHIP_NOT_FOUND' } };
    if (target.revision !== input.expectedPreferenceRevision || action === 'set_card_preferences' && target.ownershipRevision !== input.expectedOwnershipRevision)
      return { error: { status: 409, code: 'OWNERSHIP_PREFERENCE_CHANGED' } };
    const receipt = rawReceipt(action, input); records.set(input.requestId, receipt); target.revision++; target.visibility = input.visibility; target.offersDisabled = input.offersDisabled; return receipt;
  }
  const client = { async $transaction(work) {
    stats.begins++; const before = structuredClone(current), old = structuredClone(records); let committed = false;
    try {
      const value = await work({ async $executeRawUnsafe() {}, async $queryRawUnsafe(sql, ...args) {
        if (sql.startsWith('SELECT current_user')) return [{ name: 'atlas_fixture_preferences', session: 'atlas_fixture_preferences', unsafe: f.unsafe, memberships: [] }];
        if (sql.startsWith('SELECT n.nspname') && !sql.includes('bodySha256')) return [{ schema: defs[0].schema, name: defs[0].name }];
        if (sql.includes('bodySha256')) return defs;
        assert.match(sql, /^SELECT atlas_ownership_preferences\.customer_call\(/); assert.deepEqual(JSON.parse(args[2]), config.binding);
        const action = args[3], input = JSON.parse(args[4]); actions.push({ action, input });
        if (f.beforeQuery) await f.beforeQuery(action, input);
        const result = await gateway(action, input); if (f.afterQuery) await f.afterQuery(action, input, result); return [{ result: structuredClone(result) }];
      } });
      committed = true; stats.commits++; if (f.afterCommit) await f.afterCommit(); return value;
    } catch (error) { if (!committed) { stats.rollbacks++; current = before; records.clear(); for (const [k, v] of old) records.set(k, v); } throw error; }
  } };
  const serviceOptions = { customerAuth: auth, client, servingRole: 'atlas_fixture_preferences', schemaOwner: 'atlas_fixture_owner' };
  const service = createCardOwnershipPreferencesService(serviceOptions);
  // Mutable trusted capability facade permits observed replacement regression.
  const capabilities = Object.fromEntries(['readAccess', 'readPreferences', 'readCard', 'recoverRequest', 'setCollectionPreferences', 'setCardPreferences'].map(k => [k, (...args) => service[k](...args)]));
  const state = { config, auth, assertRequest(req) { if (!acceptsSiteRequest(req, { zone: 'customer', deploymentId: config.deploymentHost, routerKey: config.routerKey })) throw { status: 403 }; } };
  const options = { customerState: state, preferences: capabilities }, handler = createCollectionPreferencesHandler(options);
  async function invoke({ method = 'GET', path = '/api/customer/collection/preferences', body = '', headers = {}, signed = true } = {}) {
    const proof = signed ? await signRoute({ zone: 'customer', deployment: `https://${config.deploymentHost}`, method, target: '/account' + path, issuedAt: Date.now() }, config.routerKey.toString('base64'), webcrypto) : {};
    const req = Object.assign(new EventEmitter(), { method, url: path, body, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: config.deploymentHost, ...proof, 'x-forwarded-proto': 'https', 'x-forwarded-host': config.deploymentHost, cookie,
        ...(method === 'POST' ? { origin: config.origin, 'content-type': 'application/json', 'x-atlas-customer-csrf': csrf } : {}), ...headers } });
    const res = Object.assign(new EventEmitter(), { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.code = n; return this; },
      json(value) { this.value = value; this.writableEnded = true; return this; } });
    f.lastRequest = req; if (f.requestHook) f.requestHook(req); await f.handler(req, res);
    assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0); return res;
  }
  const request = async (path, input) => { requests.push({ path, input });
    const r = await invoke({ method: input.method, path: path.replace(/^\/account/, ''), body: input.body === undefined ? '' : JSON.parse(input.body), headers: input.headers });
    if (f.afterHTTP) await f.afterHTTP(r); return Response.json(r.value, { status: r.code, headers: r.headers }); };
  return Object.assign(f, { service, serviceOptions, capabilities, state, options, handler, invoke, request, session: { customer: { id: AID }, csrf },
    current: () => structuredClone(current), changeCurrent(patch) { current = { ...current, ...patch }; } });
}
