import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import type { AdminSession } from '../lib/server/admin';
type HandlerFactory = typeof import('../pages/api/admin/set-ops/catalog/pokemon-preparation').createPokemonPreparationHandler;

test('pokemon preparation API requires enabled human review and explicit stage; it preserves the actor and request', async context => {
  const userId = 'offline-pokemon-api-reviewer';
  const environment = {
    NEXT_PUBLIC_ADMIN_USER_IDS: userId, SET_OPS_REVIEWER_USER_IDS: userId, SET_CATALOG_EVIDENCE_ENABLED: 'true',
    AUTH_SERVICE_URL: '', NEXT_PUBLIC_AUTH_SERVICE_URL: '', TENKINGS_API_BASE_URL: '',
    NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_SITE_URL: '', SITE_URL: '',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  let unexpected = 0;
  const forbidden = async () => { unexpected++; throw new Error('Unexpected database/network operation'); };
  prisma.$use(forbidden);
  context.mock.method(globalThis, 'fetch', forbidden);
  // Prisma delegates expose methods through a proxy; assign/restores preserve
  // that proxy instead of node:test descriptor-based method replacement.
  const restores: Array<() => void> = [];
  const replace = (target: object, name: string, replacement: unknown) => {
    const object = target as Record<string, unknown>, previous = object[name];
    object[name] = replacement; restores.push(() => { object[name] = previous; });
  };
  replace(prisma.session, 'findUnique', async () => ({ id: 'offline-api-human', tokenHash: 'a'.repeat(64),
    createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), user: { id: userId, phone: null, displayName: null } }));
  const calls: Array<{ action: string; actor: AdminSession; request?: unknown }> = [];
  const service = {
    preview: async (actor: AdminSession) => { calls.push({ action: 'preview', actor }); return { authority: 'unreviewed_preparation', approved: false }; },
    stage: async (request: unknown, actor: AdminSession) => { calls.push({ action: 'stage', actor, request }); return { outcome: 'recorded', approved: false }; },
  } as unknown as Parameters<HandlerFactory>[0];
  const { createPokemonPreparationHandler } = await import('../pages/api/admin/set-ops/catalog/pokemon-preparation');
  const handler = createPokemonPreparationHandler(service);
  async function invoke(method = 'GET', body?: unknown, query = {}, headers: Record<string, string> = { authorization: 'Bearer offline-human-token' }) {
    let code = 0, result: unknown;
    const responseHeaders: Record<string, string> = {};
    const response = { setHeader(name: string, value: string) { responseHeaders[name.toLowerCase()] = value; },
      status(value: number) { code = value; return this; }, json(value: unknown) { result = value; return this; } } as unknown as NextApiResponse;
    await handler({ method, body, query, headers, socket: { remoteAddress: '127.0.0.1' } } as NextApiRequest, response);
    assert.equal(responseHeaders['cache-control'], 'private, no-store');
    return { code, result, responseHeaders };
  }
  try {
    assert.equal((await invoke('GET', undefined, {}, {})).code, 401);
    assert.equal((await invoke('GET', undefined, {}, { authorization: 'Bearer offline-human-token', 'x-operator-key': 'fixture-static-key' })).code, 401);
    process.env.SET_CATALOG_EVIDENCE_ENABLED = 'false';
    assert.equal((await invoke()).code, 503);
    process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
    assert.equal((await invoke('DELETE')).code, 405);
    assert.equal((await invoke('GET', undefined, { setId: 'different-set' })).code, 400);
    assert.equal((await invoke('POST', { action: 'publish', request: {} })).code, 400);
    assert.equal((await invoke('POST', { action: 'stage', request: {}, sourceUrl: 'untrusted' })).code, 400);
    assert.equal(calls.length, 0);
    assert.equal((await invoke()).code, 200);
    const request = { schemaVersion: 'fixture-request-forwarding', expectedSnapshotSha256: 'b'.repeat(64) };
    assert.equal((await invoke('POST', { action: 'stage', request })).code, 200);
    assert.deepEqual(calls.map(call => call.action), ['preview', 'stage']);
    assert.equal(calls[1].request, request);
    for (const call of calls) { assert.equal(call.actor.user.id, userId); assert.equal(call.actor.authority, 'local-database'); }
    const { StalePokemonPreparationSnapshotError } = await import('../lib/server/setCatalogPokemonPreparation');
    service.stage = async () => { throw new StalePokemonPreparationSnapshotError('fixture-exact-key', 'd'.repeat(64)); };
    const stale = await invoke('POST', { action: 'stage', request });
    assert.equal(stale.code, 409);
    assert.deepEqual(stale.result, { message: 'Preparation snapshot changed; preview again.', code: 'POKEMON_PREPARATION_SNAPSHOT_STALE',
      idempotencyKey: 'fixture-exact-key', expectedSnapshotSha256: 'd'.repeat(64) });
    const { HttpError } = await import('../lib/server/adminSessionAuthority');
    service.stage = async () => { throw new HttpError(409, 'Occupied source'); };
    const occupied = await invoke('POST', { action: 'stage', request });
    assert.equal(occupied.code, 409); assert.deepEqual(occupied.result, { message: 'Occupied source' });
    assert.equal(unexpected, 0);
  } finally {
    for (const restore of restores.reverse()) restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
