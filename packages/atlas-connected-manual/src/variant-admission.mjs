import { requireThat, uuid } from '@atlas/manual-service/contract';

/** Read-only priority observation. It reserves no main grading slot and cannot
 * prevent new grading work arriving immediately after this observation. An
 * explicit separate model project/quota is still a production release gate. */
export function createVariantAdmission({ boundary }) {
  requireThat(typeof boundary?.machineTransaction === 'function', 503, 'VARIANT_ADMISSION_CONFIGURATION');
  return async ({ actionId = null } = {}) => {
    if (actionId !== null) uuid(actionId);
    return boundary.machineTransaction(null, async ({ tx }) => {
      const [row] = await tx.$queryRawUnsafe(`SELECT
        EXISTS(SELECT 1 FROM atlas_manual_connected.batch_grading j
          WHERE (j.state IN ('QUEUED','RUNNING') OR j.analysis_reserved)
          AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)) AS batch_busy,
        EXISTS(SELECT 1 FROM atlas_manual_connected.identification i
          WHERE i.state='RUNNING'
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=i.card_id)) AS identification_busy,
        EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
          WHERE ($1::uuid IS NULL OR r.action_id<>$1::uuid)
          AND (r.state='PREPARED' AND r.expires_at>clock_timestamp() OR r.state='DISPATCHED')
          AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal f WHERE f.card_id=r.card_id AND f.action_id=r.action_id)
          AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt p WHERE p.analysis_id=r.id AND p.kind='RESPONSE')) AS analysis_busy`, actionId);
      requireThat(row && ['batch_busy','identification_busy','analysis_busy'].every(key => typeof row[key] === 'boolean'), 503, 'VARIANT_ADMISSION_UNAVAILABLE');
      // DISPATCHED without RESPONSE stays occupied even after an unknown outcome.
      // This also serializes accepted asynchronous variant rechecks with comparisons.
      return !row.batch_busy && !row.identification_busy && !row.analysis_busy;
    });
  };
}
