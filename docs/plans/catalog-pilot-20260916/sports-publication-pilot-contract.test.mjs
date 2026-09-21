import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateManifest, hashManifest, lookupManifestCandidates } from '../../../packages/card-catalog-evidence/src/index.mjs';
import { PILOTS } from './prepare-pilot.mjs';
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const packet = read('./sports-publication-pilot.unsubmitted.json');
const reconciliation = read('./sports-reconciliation-report.unreviewed.json');
const transcript = read('./sports-complete-checklist.unreviewed.json');

test('partial three-card contract probe validates with exact previously observed canonical IDs', () => {
  const m = validateManifest(packet.identityOnlyContractProbe.manifest);
  assert.equal(hashManifest(m), packet.identityOnlyContractProbe.manifestSha256);
  assert.equal(m.coverage.text.status, 'partial'); assert.equal(m.cards.length, 3);
  for (const card of m.cards) {
    const row = reconciliation.rows.find(r => r.printedCardNumber === card.number && r.canonicalProgramId === card.programId);
    assert.equal(row.status, 'exact_program_number_name_match');
    assert.equal(row.canonicalCardId, card.cardId); assert.equal(row.printedName, card.name);
  }
});

test('identity-only manifest is structurally valid but emits zero lookup candidates, never exclusion', () => {
  const result = lookupManifestCandidates(packet.identityOnlyContractProbe.manifest, packet.identityOnlyContractProbe.query);
  assert.equal(result.totalCandidateCount, 0); assert.equal(result.outcome, 'not_found');
  assert.equal(result.absenceEstablishesExclusion, false); assert.equal(result.authority, 'unreviewed_manifest');
});

test('171 unnumbered rows and remaining numbered identities are outside partial pilot, not an invented gate', () => {
  assert.equal(packet.decision.resolve171UnnumberedBeforePilot, false);
  assert.equal(packet.decision.fullCatalogCompletionRequired, false);
  assert.equal(packet.excludedCoverage.unnumberedSourceRows, transcript.rows.filter(r => r.printedCardNumber === null).length);
  assert.equal(packet.excludedCoverage.otherNumberedCanonicalCards + packet.selectedIdentities.length, 379);
  for (const card of packet.selectedIdentities) {
    const row = transcript.rows.find(r => r.rowOrdinal === card.sourceEvidence[0].sourceRowOrdinal);
    assert.equal(row.sourcePage, 10); assert.equal(row.printedCardNumber, card.number); assert.equal(row.printedName, card.name);
  }
});

test('all recipe relations stay unknown with null missing IDs, grants, images and publication request', () => {
  assert.deepEqual(packet.printingVocabularyEvidence.map(p => [p.key,p.label,p.serialDenominator]), PILOTS.sports.printings.map(p => [p.key,p.label,p.serialDenominator]));
  assert.equal(packet.applicabilityDraft.length, 9);
  for (const row of packet.applicabilityDraft) { assert.equal(row.status, 'unknown'); assert.equal(row.printingId, null); assert.deepEqual(row.sourceIds, []); }
  for (const printing of packet.printingVocabularyEvidence) for (const key of ['parallelId','parallelRowId','scopeRowId','printingId','language','edition','format','channel']) assert.equal(printing[key], null);
  for (const source of packet.reviewEvidenceDraft.sources) { assert.equal(source.taxonomySourceId, null); assert.equal(source.grant, null); }
  assert.deepEqual(packet.reviewEvidenceDraft.images, []); assert.equal(packet.loadableReviewPacket, null); assert.equal(packet.publicationRequest, null);
});

test('existing validator rejects a claimed relation to a nonexistent printing', () => {
  const m = structuredClone(packet.identityOnlyContractProbe.manifest);
  m.applicability = [{ cardId: m.cards[0].cardId, printingId: 'fixture-nonexistent-printing', status: 'supported', sourceIds: ['sports-checklist'], note: 'Synthetic invalid test only.' }];
  assert.throws(() => validateManifest(m), error => error.code === 'UNKNOWN_REFERENCE');
});

test('pinned manufacturer bytes remain exact; possession does not become staging or rights', () => {
  for (const source of packet.sourceEvidence) {
    const bytes = readFileSync(source.localEvidencePath);
    assert.equal(bytes.length, source.byteSize);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.equal(source.hostStagingVerified, false); assert.equal(source.grant, null);
  }
  assert.equal(packet.rightsVerified, false); assert.equal(packet.humanReviewed, false);
});
