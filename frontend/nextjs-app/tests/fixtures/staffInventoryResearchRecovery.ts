import { StaffInventoryResearchResultSchema } from '../../lib/staffInventoryResearch';
import { StaffInventoryResearchRecoverySnapshotSchema, type StaffInventoryResearchRecoverySnapshot } from '../../lib/staffInventoryMarketValue';
import { marketJob, marketResult, MARKET_TIME } from './staffInventoryMarketValue';

export function recoveryJob() {
  const original = marketResult(3);
  return marketJob(StaffInventoryResearchResultSchema.parse({ ...original,
    identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'Reviewed catalog evidence is missing.', reference_ids: [], photo_features: [] },
    references: [], selected_candidate_ids: [], rejections: original.candidates.map(candidate => ({ candidate_id: candidate.id, reason: 'Catalog identity is unresolved.' })),
    estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'Catalog identity is unresolved.' },
  }));
}
export function recoverySnapshot(patch: Partial<StaffInventoryResearchRecoverySnapshot> = {}) {
  const job = recoveryJob();
  return StaffInventoryResearchRecoverySnapshotSchema.parse({ schema_version: 1, job_id: job.job_id, unit_id: job.unit_id,
    description_event_id: job.description_event_id, input_hash: job.input_hash, status: 'waiting_catalog_evidence',
    missing_fields: ['year'], reason: 'The card still needs reviewed catalog identity and a distinguishing visible feature.',
    checked_at: MARKET_TIME, next_check_at: '2026-09-21T18:00:00.000Z', photo_attempt_count: 1, automatic_refresh_count: 0,
    proposal: { name: 'Fixture Runner', category: 'Sports cards', manufacturer: 'Fixture Cards', year: '2024', set_name: 'Fixture Chrome', card_number: '007', variant: null, card_type: null },
    added_fields: ['year'], conflicts: [], ...patch });
}
