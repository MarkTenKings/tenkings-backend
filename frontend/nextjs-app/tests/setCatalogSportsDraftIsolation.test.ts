import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';

test('ordinary Build Draft cannot attach or rewrite either pending sports catalog source job', async context => {
  const userId = 'offline-sports-reviewer';
  const environment = {
    NEXT_PUBLIC_ADMIN_USER_IDS: userId, SET_OPS_REVIEWER_USER_IDS: userId,
    AUTH_SERVICE_URL: '', NEXT_PUBLIC_AUTH_SERVICE_URL: '', TENKINGS_API_BASE_URL: '',
    NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_SITE_URL: '', SITE_URL: '',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  let unexpected = 0;
  const forbidden = async () => { unexpected++; throw new Error('Unexpected database/network operation'); };
  // This test file owns its node:test process. All unlisted delegates stop
  // before any Prisma engine/network operation, including writes and audits.
  prisma.$use(forbidden);
  context.mock.method(globalThis, 'fetch', forbidden);
  // Prisma delegates expose methods through a proxy; assign/restores preserve
  // that proxy instead of node:test descriptor-based method replacement.
  const restores: Array<() => void> = [];
  const replace = (target: object, name: string, replacement: unknown) => {
    const object = target as Record<string, unknown>, previous = object[name];
    object[name] = replacement; restores.push(() => { object[name] = previous; });
  };
  const job = {
    id: 'offline-pending-sports-source', setId: '2023_Bowman_University_Chrome_Football', draftId: null,
    datasetType: 'PLAYER_WORKSHEET', parserVersion: 'catalog-sports-additive-preparation/v1',
    rawPayload: { schemaVersion: 'catalog-sports-additive-preparation/v1', sourceId: 'sports-checklist' },
    sourceUrl: 'https://example.com/synthetic-source.pdf',
    parseSummaryJson: { preparationOnly: true, genericDraftBuildAllowed: false },
  };
  let reads = 0;
  replace(prisma.session, 'findUnique', async () => ({
    id: 'offline-human-session', tokenHash: 'a'.repeat(64), createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000), user: { id: userId, phone: null, displayName: 'Offline reviewer' },
  }));
  replace(prisma.setIngestionJob, 'findUnique', async () => { reads++; return structuredClone(job); });
  try {
    const { default: handler } = await import('../pages/api/admin/set-ops/drafts/build');
    for (const datasetType of ['PLAYER_WORKSHEET', 'PARALLEL_DB']) {
      job.datasetType = datasetType;
      const before = structuredClone(job);
      let code = 0, body: unknown;
      const response = {
        setHeader() {}, status(value: number) { code = value; return this; },
        json(value: unknown) { body = value; return this; },
      } as unknown as NextApiResponse;
      await handler({ method: 'POST', headers: { authorization: 'Bearer offline-review-session' }, query: {},
        body: { ingestionJobId: job.id }, socket: { remoteAddress: '127.0.0.1' } } as NextApiRequest, response);
      assert.equal(code, 409);
      assert.match(JSON.stringify(body), /shared catalog preparation/);
      assert.deepEqual(job, before);
      assert.equal(unexpected, 0, 'No draft resolution, state changes, audit writes or external calls');
    }
    assert.equal(reads, 2);
  } finally {
    for (const restore of restores.reverse()) restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
