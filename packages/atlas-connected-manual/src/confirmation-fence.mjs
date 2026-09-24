import { canonical, requireThat } from '@atlas/manual-service/contract';

// Called inside the existing card-lock transaction: metadata only, never
// provider, object storage, image decoding or measurement work.
export async function readConfirmationFence(tx, cardId) {
  const [row] = await tx.$queryRawUnsafe(`SELECT r.id,r.request_hash,q.evidence AS response_evidence,e.evidence_hash AS acceptance_hash
    FROM atlas_defect_analysis.run r
    LEFT JOIN atlas_defect_analysis.receipt q ON q.analysis_id=r.id AND q.kind='RESPONSE'
    LEFT JOIN atlas_defect_analysis.provider_event e ON e.analysis_id=r.id AND e.kind='ACCEPTED'
    WHERE r.card_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal f
      WHERE f.analysis_id=r.id AND f.card_id=r.card_id)
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1`, cardId);
  if (!row) return null;
  const response = row.response_evidence ? JSON.parse(row.response_evidence) : null;
  return { analysisId: row.id, requestHash: row.request_hash,
    responseHash: response?.responseHash ?? null, responseState: response?.state ?? null,
    acceptanceHash: row.acceptance_hash ?? null };
}

export async function validateConfirmationCommit({ tx, cardId, input, commitGuard }) {
  if (!['CONFIRM_FINDINGS', 'APPROVE_REPORT'].includes(input.action.type)) return;
  requireThat(commitGuard?.version === 'atlas-manual-confirmation-fence-v1', 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
  requireThat(Date.now() < commitGuard.deadlineAt, 422, 'MANUAL_CONFIRM_DEADLINE');
  // The card lock excludes a newly prepared run. Lock the existing latest run
  // too: receipt insertion takes its foreign-key KEY SHARE lock, so a late
  // response must finish before this lock or wait until the manual commit.
  // Read the receipt in a separate statement AFTER acquiring the lock, since a
  // SELECT snapshot taken before waiting would omit the just-committed receipt.
  await tx.$queryRawUnsafe(`SELECT r.id FROM atlas_defect_analysis.run r
    WHERE r.card_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal f
      WHERE f.analysis_id=r.id AND f.card_id=r.card_id)
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE OF r`, cardId);
  const current = await readConfirmationFence(tx, cardId);
  requireThat(canonical(current) === canonical(commitGuard.analysis), 409, 'MANUAL_ASTRA_REVIEW_STALE');
  requireThat(Date.now() < commitGuard.deadlineAt, 422, 'MANUAL_CONFIRM_DEADLINE');
}
