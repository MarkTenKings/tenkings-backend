const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

test('catalog migration installs only additive publication/proposal authority and database guards', { skip: process.env.TEN_KINGS_CATALOG_DISPOSABLE_VALIDATION !== '1' }, async () => {
  const url = new URL(process.env.DATABASE_URL); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/tenkings_set_catalog_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  try {
    const triggers = await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('SetCatalogPublication_immutable', 'SetCatalogProposal_immutable', 'SetApproval_catalog_immutable', 'SetDraftVersion_catalog_immutable', 'SetAuditEvent_catalog_immutable', 'SetCatalogPublication_insert_binding', 'SetDraft_catalog_pointer', 'SetCatalogPublication_atomic_current') ORDER BY tgname`;
    assert.equal(triggers.length, 8);
    const constraints = await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN ('SetDraft_catalog_current_fkey', 'SetCatalogEvidencePublication_version_fkey', 'SetCatalogEvidencePublication_approval_fkey', 'SetCatalogEvidencePublication_predecessor_fkey')`;
    assert.equal(constraints.length, 4);
    assert.equal(await db.setCatalogEvidencePublication.count(), 0, 'migration never retroactively promotes a legacy approval');
    assert.equal(await db.setCatalogObservationProposal.count(), 0);
    const auditIndex = await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname='SetAuditEvent_catalog_transition_key'`;
    assert.equal(auditIndex.length, 1);
  } finally { await db.$disconnect(); }
});
