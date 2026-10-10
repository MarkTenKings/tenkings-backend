import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { canonicalJson, lookupManifestCandidates } from '@tenkings/card-catalog-evidence';
import { attachCatalogReference } from '../lib/server/setCatalogReferenceAttachment';
import { prepareReferenceProposal } from '../lib/server/setCatalogReferenceProposals';
import { prepareCatalogVerification } from '../lib/server/setCatalogEvidenceMedia';
import Attachment from '../components/admin/SetCatalogReferenceAttachment';
import { referenceFixture, referenceActor } from './catalogReferenceFixtures';
// @ts-expect-error Synthetic fixture is deliberately outside the public package API.
import { fixture as manifestFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
async function fixture() {
  const input = await referenceFixture(), prepared = prepareReferenceProposal(input, referenceActor), p = prepared.prepared.proposal;
  const row = { id: randomUUID(), producer: p.producer, observationId: p.observationId, inputRevision: p.inputRevision, physicalCardRef: p.physicalCardRef,
    proposalJson: p as any, proposalSha256: prepared.prepared.proposalSha256, bindingJson: prepared.authority as any, bindingSha256: hash(prepared.authority) };
  const receipt = { submissionSha256: prepared.submissionSha256, submissionJson: prepared.submission };
  const manifest = manifestFixture('SPORTS'); manifest.images = [];
  const artifacts = new Map<string, Buffer>();
  for (const source of manifest.sources) { const bytes = Buffer.from(`synthetic bytes ${source.sourceId}`); source.sourceRef = `catalog:sha256:${source.sha256}`; artifacts.set(source.sourceRef, bytes); }
  for (const a of [...prepared.sourceArtifacts, ...prepared.artifacts]) artifacts.set(a.image.mediaRef, a.bytes);
  const reviewEvidence = { schemaVersion: 'setops-catalog-review-evidence/v2', sources: manifest.sources.map((s: any) => ({ sourceId: s.sourceId, taxonomySourceId: null,
    classificationNote: 'Synthetic source context', factUse: { purpose: 'catalog_facts', sourceSha256: s.sha256, detail: 'Reviewed fixture facts', consumers: ['inventory', 'atlas'] } })), images: [] };
  const packet = { manifest, reviewEvidence };
  const request = { action: 'prepare', proposalId: row.id, proposalSha256: row.proposalSha256, submissionSha256: receipt.submissionSha256, packet,
    imageId: p.images[0].imageId, depicted: { cardId: manifest.cards[0].cardId, printingId: manifest.printings[0].printingId },
    representsPrintingIds: [manifest.printings[0].printingId], visibleDiagnosticIds: [manifest.printings[0].diagnostics[0].id],
    reviewNote: 'I inspected the physical finish and accept the submitted permission for both internal apps.', acknowledgement: 'PREPARE PHOTO FOR FULL CATALOG REVIEW' };
  return { input, row, receipt, prepared, packet, request, artifacts };
}
test('submitted capture bytes attach to full review with preserved lineage and exact vs representative lookup', async () => {
  const f = await fixture(), before = canonicalJson(f.packet), { packet } = attachCatalogReference(f.request, f.row, f.receipt);
  assert.equal(canonicalJson(f.packet), before, 'immutable input packet unchanged');
  for (const key of ['set', 'setOps', 'programs', 'cards', 'printings', 'applicability', 'aliases'] as const) assert.deepEqual(packet.manifest[key], f.packet.manifest[key]);
  assert.equal(packet.manifest.sources.length, f.packet.manifest.sources.length + 3); assert.equal(packet.manifest.images.length, 1);
  const verified = await prepareCatalogVerification(packet.manifest, packet.reviewEvidence, async ref => { const bytes = f.artifacts.get(ref); assert.ok(bytes); return bytes; });
  assert.equal(verified.verification.artifacts.length, 5, 'official/listing sources plus actual descriptor and both source photo byte streams');
  const query = { category: 'SPORTS' as const, setId: packet.manifest.set.setId, printingLabel: 'Silver', language: 'en', edition: 'standard' };
  const exact = lookupManifestCandidates(packet.manifest, { ...query, cardId: packet.manifest.cards[0].cardId });
  const representative = lookupManifestCandidates(packet.manifest, { ...query, cardId: packet.manifest.cards[1].cardId });
  assert.equal(exact.candidates[0].images[0].relationship, 'depicts_candidate_identity');
  assert.equal(representative.candidates[0].images[0].relationship, 'representative_finish');
  assert.equal(packet.manifest.coverage.images.status, 'partial');
});
test('attachment refuses unconfirmed depicted applicability, changed receipt and missing capture ancestry', async () => {
  const f = await fixture();
  assert.throws(() => attachCatalogReference({ ...f.request, depicted: { ...f.request.depicted, printingId: f.packet.manifest.printings[1].printingId } }, f.row, f.receipt), /supported/);
  assert.throws(() => attachCatalogReference({ ...f.request, submissionSha256: 'f'.repeat(64) }, f.row, f.receipt), /exact pending/);
  assert.throws(() => attachCatalogReference({ ...f.request, acknowledgement: undefined }, f.row, f.receipt));
  const prepared = attachCatalogReference(f.request, f.row, f.receipt).packet;
  await assert.rejects(prepareCatalogVerification(prepared.manifest, prepared.reviewEvidence, async ref => {
    if (ref === f.prepared.sourceArtifacts[0].image.mediaRef) return Buffer.from('changed descriptor'); return f.artifacts.get(ref)!;
  }), /reference/);
  assert.throws(() => attachCatalogReference({ ...f.request, packet: prepared }, f.row, f.receipt), /already in the packet/);
});
test('human attachment requires mapping, permission acknowledgement and note; prepares JSON without publication', async () => {
  const f = await fixture(), dom = new JSDOM('<div id="root"></div>'), globals = new Map<string, PropertyDescriptor | undefined>();
  let calls = 0, returned: any = null;
  const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(url, '/api/admin/set-ops/catalog/reference-proposals'); assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer human'); const request = JSON.parse(String(init?.body)); return Response.json(attachCatalogReference(request, f.row, f.receipt)); };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById('root')!, root = createRoot(host);
  const detail: any = { item: { proposalId: f.row.id, proposalSha256: f.row.proposalSha256 }, canonicalProposalJson: canonicalJson(f.row.proposalJson) };
  const review = { proposalId: f.row.id, submissionSha256: f.receipt.submissionSha256, submission: f.receipt.submissionJson };
  try {
    await act(async () => root.render(<Attachment token="human" detail={detail} referenceReview={review} packet={f.packet} onPrepared={p => { returned = p; }} />));
    const button = () => host.querySelector('button')!; assert.equal(button().disabled, true); assert.equal(calls, 0);
    const change = async (label: string, value: string) => { const input = host.querySelector(`[aria-label="${label}"]`)!; await act(async () => Simulate.change(input, { target: { value } } as never)); };
    await change('Submitted photo', f.request.imageId); await change('Depicted card', f.request.depicted.cardId); await change('Depicted printing', f.request.depicted.printingId); await change('Reference review note', f.request.reviewNote);
    assert.equal(button().disabled, true);
    await act(async () => Simulate.change(host.querySelector('[aria-label="Accept reference mapping for full review"]')!, { target: { checked: true } } as never));
    assert.equal(button().disabled, false); await act(async () => button().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(calls, 1); assert.equal(returned.manifest.images.length, 1); assert.equal(returned.reviewEvidence.observations[0].proposalId, f.row.id);
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; } }
});
