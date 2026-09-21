import { createHash } from 'node:crypto';
import { inventoryHash } from '@tenkings/database';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema } from '../lib/staffInventoryResearch';
import { prepareInventoryCatalogObservation } from '../lib/server/staffInventoryCatalogObservations';
import type { AdminSession } from '../lib/server/adminSessionAuthority';

export const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
export const reviewer: AdminSession = { sessionId: 'fixture-session', tokenHash: 'a'.repeat(64), authority: 'local-database', expiresAt: new Date('2099-01-01T00:00:00.000Z'), user: { id: 'fixture-reviewer', phone: null, displayName: null } };
export function source(n = 1, category = 'Pokémon') {
  const description = { name: 'Synthetic card', category, year: '2024', manufacturer: 'Synthetic publisher', set_name: 'Synthetic set', card_number: '1', variant: null, card_type: null };
  const front = 'a'.repeat(64), back = 'b'.repeat(64), key = (sha: string) => `inventory-photos/${uuid(99)}/${sha}.jpg`;
  // Match the sole writer: hash the complete saved description, then project
  // its descriptive fields into the immutable research input.
  const savedDescription = { name: description.name, category, notes: 'Private intake note', photo_key: key(front), back_photo_key: key(back), channel: 'store',
    card_details: { manufacturer: description.manufacturer, year: description.year, set_name: description.set_name, card_number: description.card_number, variant: null, card_type: null } };
  const input = StaffInventoryResearchInputSchema.parse({ schema_version: 1, unit_id: `inv:fixture:${n}`, description_event_id: `event:fixture:${n}`, description_hash: inventoryHash(savedDescription), description, front_photo_key: key(front), back_photo_key: key(back) });
  const result = StaffInventoryResearchResultSchema.parse({ schema_version: 1, unit_id: input.unit_id, description_event_id: input.description_event_id, description_hash: input.description_hash,
    engine_version: 'staff-inventory-research-v3', model: 'gpt-6-astra', researched_at: '2026-09-16T12:00:00.000Z', timings_ms: { photos: 1, sources: 1, images: 0, model: 1, total: 3 },
    photos: { front: { key: input.front_photo_key, sha256: front }, back: { key: input.back_photo_key, sha256: back } }, query: null,
    research_queries: [], comparison_assessments: [], diagnostics: { schema_version: 1, reason_codes: ['NO_EXACT_EVIDENCE'], sources: [], candidates: [] },
    identity: { status: 'unresolved', variant_name: null, suggestion: 'Possible finish requires review', reason: 'Synthetic visual evidence remains uncertain.', reference_ids: [], photo_features: [] },
    target_condition: { status: 'unresolved', grader: null, numeric_grade: null, photo_evidence: null }, references: [], candidates: [], selected_candidate_ids: [], rejections: [],
    estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'No accepted comparisons.' }, warnings: [] });
  return { id: uuid(n), unitId: input.unit_id, descriptionEventId: input.description_event_id, descriptionHash: input.description_hash,
    inputHash: inventoryHash(input), input: JSON.stringify(input), resultHash: inventoryHash(result), result: JSON.stringify(result),
    completedAttempt: { attempt: 1, lease_token: uuid(100), started_at: '2026-09-16T11:59:59.000Z', completed_at: '2026-09-16T12:00:01.000Z', outcome: 'complete', error: null, result } };
}
export function proposalRow(n = 1) {
  const { proposal, authority } = prepareInventoryCatalogObservation(source(n)), prepared = prepareObservationProposal(proposal);
  return { id: uuid(n + 1000), producer: proposal.producer, observationId: proposal.observationId, inputRevision: proposal.inputRevision, physicalCardRef: proposal.physicalCardRef,
    proposalJson: JSON.parse(canonicalJson(proposal)), proposalSha256: prepared.proposalSha256, actorKind: authority.actorKind, actorRef: authority.actorRef,
    bindingJson: JSON.parse(canonicalJson(authority)), bindingSha256: hash(authority), submittedById: null, submittedAt: new Date('2026-09-16T12:00:02.000Z') };
}
