import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';

type Row = Record<string, unknown>;
const request = JSON.parse(readFileSync(new URL('../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json', import.meta.url), 'utf8')).requestDraft;

test('a successful review-version response distinguishes disabled ingestion and a failed taxonomy transaction', async context => {
  const userId = 'offline-pokemon-outcome-reviewer';
  const env = { NEXT_PUBLIC_ADMIN_USER_IDS: userId, SET_OPS_REVIEWER_USER_IDS: userId, AUTH_SERVICE_URL: '',
    NEXT_PUBLIC_AUTH_SERVICE_URL: '', TENKINGS_API_BASE_URL: '', NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_SITE_URL: '', SITE_URL: '',
    TAXONOMY_V2_FORCE_LEGACY: 'false', TAXONOMY_V2_INGEST: 'false' };
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let unexpected = 0, transactions = 0, versions = 0;
  const blocked = async () => { unexpected++; throw Error('Unexpected real DB/network operation'); };
  prisma.$use(blocked); context.mock.method(globalThis, 'fetch', blocked);
  const restores: Array<() => void> = [];
  function replace(target: object, key: string, value: unknown) {
    const object = target as Row, old = object[key]; object[key] = value; restores.push(() => { object[key] = old; });
  }
  let saved: Row = {}, draft: Row = {};
  const originalSummary = { sourceProvider: request.sourceProvider, sourceQuery: request.sourceQuery, sourceFetchMeta: request.sourceFetchMeta, csvContract: null };
  try {
    replace(prisma.session, 'findUnique', async () => ({ id: 'offline-human', tokenHash: 'a'.repeat(64), createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000), user: { id: userId, phone: null, displayName: null } }));
    replace(prisma.setIngestionJob, 'findUnique', async () => ({ ...request, id: 'offline-job', draftId: 'offline-draft', parseSummaryJson: structuredClone(originalSummary) }));
    replace(prisma.setIngestionJob, 'update', async ({ data }: { data: Row }) => { saved = data; return data; });
    replace(prisma.setDraft, 'findUnique', async () => ({ id: 'offline-draft' }));
    replace(prisma.setDraft, 'update', async ({ data }: { data: Row }) => { draft = data; return data; });
    replace(prisma.setDraftVersion, 'findFirst', async () => ({ version: versions }));
    replace(prisma.setDraftVersion, 'create', async ({ data }: { data: Row }) => ({ ...data, id: `offline-version-${++versions}`, createdAt: new Date() }));
    replace(prisma.setAuditEvent, 'create', async ({ data }: { data: Row }) => ({ ...data, id: 'offline-audit', createdAt: new Date() }));
    replace(prisma, '$transaction', async () => { transactions++; throw Error('PRIVATE_DATABASE_FAILURE_DETAIL'); });
    const { default: handler } = await import('../pages/api/admin/set-ops/drafts/build');
    async function invoke() {
      let code = 0, body: Row = {};
      const headers: Row = {};
      const res = { setHeader(k: string, v: string) { headers[k] = v; }, status(v: number) { code = v; return this; },
        json(v: Row) { body = v; return this; } };
      await handler({ method: 'POST', body: { ingestionJobId: 'offline-job' }, headers: { authorization: 'Bearer offline-token' },
        socket: { remoteAddress: '127.0.0.1' } } as NextApiRequest, res as unknown as NextApiResponse);
      assert.equal(code, 200); assert.equal(headers['Cache-Control'], 'private, no-store');
      assert.equal((body.summary as Row).rowCount, 138); assert.equal((body.summary as Row).blockingErrorCount, 0);
      assert.equal(saved.status, 'REVIEW_REQUIRED'); assert.equal(draft.status, 'REVIEW_REQUIRED');
      return body.taxonomyIngest as Row;
    }
    const skipped = await invoke();
    assert.equal(skipped.outcome, 'skipped'); assert.equal(skipped.result, null); assert.match(String(skipped.message), /skipped/);
    assert.equal(transactions, 0); assert.equal((saved.parseSummaryJson as Row).taxonomyIngest, null);
    process.env.TAXONOMY_V2_INGEST = 'true';
    const failed = await invoke();
    assert.equal(failed.outcome, 'failed'); assert.match(String(failed.message), /Inspect the saved job before another build/);
    assert.equal(transactions, 1); assert.equal(versions, 2);
    const result = failed.result as Row;
    assert.equal(result.applied, false); assert.equal(result.sourceId, null); assert.equal(result.skippedReason, 'taxonomy_ingest_failed');
    assert.ok(Object.values(result.counts as Row).every(v => v === 0));
    assert.equal(((saved.parseSummaryJson as Row).taxonomyIngest as Row).skippedReason, 'PRIVATE_DATABASE_FAILURE_DETAIL');
    assert.equal(JSON.stringify(failed).includes('PRIVATE_DATABASE_FAILURE_DETAIL'), false);
    assert.equal(unexpected, 0);
  } finally {
    restores.reverse().forEach(restore => restore());
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
