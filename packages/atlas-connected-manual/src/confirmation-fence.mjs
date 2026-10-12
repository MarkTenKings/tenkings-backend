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
