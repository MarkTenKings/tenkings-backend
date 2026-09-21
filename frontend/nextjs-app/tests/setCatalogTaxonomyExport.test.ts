import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { createCatalogTaxonomyExporter } from '../lib/server/setCatalogTaxonomyExport';

const actor = { authority: 'local-database', sessionId: 'synthetic-export-session', tokenHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 3600000), user: { id: 'synthetic-export-human', phone: null, displayName: 'Synthetic export test' } };

test('preparation export is bounded, repeatable-read, explicitly read-only and contains no raw artifacts or grant', async () => {
  const oldEnabled = process.env.SET_CATALOG_EVIDENCE_ENABLED, oldAdmins = process.env.NEXT_PUBLIC_ADMIN_USER_IDS;
  process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true'; process.env.NEXT_PUBLIC_ADMIN_USER_IDS = actor.user.id;
  const calls: string[] = [];
  const draft = { id: 'synthetic-draft', setId: 'synthetic-set', normalizedLabel: null, status: 'APPROVED', archivedAt: null, currentCatalogPublicationId: null };
  const tx = { $executeRaw: async (strings: TemplateStringsArray) => { calls.push(strings.join('')); },
    setDraft: { findUnique: async (args: { select: object }) => { assert.equal(calls[0], 'SET TRANSACTION READ ONLY'); assert.ok(!('createdById' in args.select)); return draft; } },
    setDraftVersion: { findFirst: async (args: { select: object }) => { assert.ok(!('dataJson' in args.select)); return { id: 'synthetic-version', draftId: draft.id, version: 1, versionHash: 'a'.repeat(64), rowCount: 0, blockingErrorCount: 0 }; } },
    setCatalogEvidencePublication: { findFirst: async () => null },
    ...Object.fromEntries(['setTaxonomySource', 'setProgram', 'setCard', 'setParallel', 'setVariation', 'setParallelScope'].map(key => [key, { findMany: async (args: { where: object; take: number; select: object }) => {
      assert.deepEqual(args.where, { setId: draft.setId }); assert.equal(args.take, 5001); assert.ok(!('metadataJson' in args.select)); return [];
    } }])),
    setSeedJob: { count: async () => 0 }, setReplaceJob: { count: async () => 0 },
  };
  const db = { $transaction: async (fn: (arg: typeof tx) => unknown, options: object) => {
    assert.deepEqual(options, { isolationLevel: 'RepeatableRead', timeout: 10000 }); return fn(tx);
  } };
  try {
    const exporter = createCatalogTaxonomyExporter(db as never), result = await exporter({ setId: draft.setId }, actor as never);
    assert.equal(result.authority, 'unreviewed_taxonomy_snapshot'); assert.deepEqual(result.snapshot.blockers, []);
    assert.equal(result.snapshotSha256, createHash('sha256').update(canonicalJson(result.snapshot)).digest('hex'));
    assert.ok(!JSON.stringify(result).includes('grant'));
    (tx as unknown as Record<string, { findMany: () => Promise<unknown[]> }>).setTaxonomySource.findMany = async () => [
      { id: 'synthetic-source', setId: draft.setId, sourceKind: 'TRUSTED_SECONDARY', sourceUrl: 'https://example.invalid/source?signature=private-test-signature' },
    ];
    const privateSource = await exporter({ setId: draft.setId }, actor as never);
    assert.equal(privateSource.snapshot.sources[0].sourceUrl, null);
    assert.equal(privateSource.snapshot.sources[0].sourceUrlStatus, 'withheld_noncanonical');
    assert.ok(!JSON.stringify(privateSource).includes('private-test-signature'));
    (tx as unknown as Record<string, { findMany: () => Promise<unknown[]> }>).setCard.findMany = async () => Array.from({ length: 5001 }, () => ({}));
    await assert.rejects(exporter({ setId: draft.setId }, actor as never), /No partial taxonomy export/);
    delete process.env.SET_CATALOG_EVIDENCE_ENABLED;
    await assert.rejects(exporter({ setId: draft.setId }, actor as never), /not enabled/);
    process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
    await assert.rejects(exporter({ setId: draft.setId }, { ...actor, authority: 'operator-key' } as never), /human admin/);
  } finally {
    if (oldEnabled === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = oldEnabled;
    if (oldAdmins === undefined) delete process.env.NEXT_PUBLIC_ADMIN_USER_IDS; else process.env.NEXT_PUBLIC_ADMIN_USER_IDS = oldAdmins;
  }
});
