import { object, requireThat, uuid } from '@atlas/manual-service/contract';

export function reportImageAttemptBase(job) {
  const retry = job.audit?.findLast(event => event.event === 'RETRY_REQUESTED');
  return Number.isSafeInteger(retry?.attemptBase) && retry.attemptBase >= 0 && retry.attemptBase <= job.attempts ? retry.attemptBase : 0;
}

/** Historical retry reconciliation only. Migration005 makes the retained SQL
 * function read-only too. No route can create another same-upload attempt. */
export function createReportImageRetry({ boundary, intakeRepository }) {
  return async function retry(staff, cardId, side, input) {
    uuid(cardId); requireThat(['FRONT', 'BACK'].includes(side), 400, 'REPORT_IMAGE_RETRY_INVALID');
    object(input, ['requestId', 'uploadId', 'jobKey', 'failedRequestId']);
    uuid(input.requestId); uuid(input.uploadId); uuid(input.failedRequestId);
    requireThat(/^[a-f0-9]{64}$/.test(input.jobKey ?? ''), 400, 'REPORT_IMAGE_RETRY_INVALID');
    const receipt = await boundary.transaction(staff, async ({ tx, principal, refresh }) => {
      await intakeRepository.authorizeInTransaction(tx, principal, cardId, { edit: true, lock: 'UPDATE' });
      principal = (await refresh()).principal;
      // Terminal edits now select the original frame for the lifetime of this
      // upload. A new retry could change pixels underneath retained geometry.
      // Reconcile an already committed retry intent, but never create one here.
      const [prior] = await tx.$queryRawUnsafe(`SELECT j.recipe_hash FROM atlas_manual_connected.report_image_job j,
        LATERAL jsonb_array_elements(j.audit) e(value) WHERE j.key=$1 AND e.value->>'event'='RETRY_REQUESTED'
        AND e.value->>'requestId'=$2`, input.jobKey, input.requestId);
      requireThat(/^[a-f0-9]{64}$/.test(prior?.recipe_hash ?? ''), 409, 'REPORT_IMAGE_RETRY_UNAVAILABLE');
      const [saved] = await tx.$queryRawUnsafe(`SELECT atlas_manual_connected.retry_report_image(
        $1::uuid,$2::integer,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,$9) AS receipt`,
      principal.id, principal.accessVersion, input.requestId, cardId, input.uploadId, side, input.jobKey, input.failedRequestId, prior.recipe_hash);
      requireThat(saved?.receipt?.requestId === input.requestId && saved.receipt.jobKey === input.jobKey
        && saved.receipt.failedRequestId === input.failedRequestId, 503, 'REPORT_IMAGE_RETRY_NOT_SAVED');
      return saved.receipt;
    }).catch(error => {
      const code = String(error?.meta?.message ?? error?.message ?? '').match(/\b(REPORT_IMAGE_RETRY_(?:INVALID|ACCESS_DENIED|CONFLICT|UNAVAILABLE|EVIDENCE_INVALID))\b/)?.[1];
      if (code) requireThat(false, code.endsWith('ACCESS_DENIED') ? 403 : code.endsWith('_INVALID') && !code.endsWith('EVIDENCE_INVALID') ? 400 : 409, code);
      throw error;
    });
    return { state: 'ACCEPTED', acknowledgedRequest: { requestId: receipt.requestId, uploadId: receipt.uploadId,
      jobKey: receipt.jobKey, failedRequestId: receipt.failedRequestId, side: receipt.side } };
  };
}
