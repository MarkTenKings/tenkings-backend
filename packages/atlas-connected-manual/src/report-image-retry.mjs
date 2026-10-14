import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { REPORT_IMAGE_RECIPE, reportImageRecipeHash } from './report-image-provider.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function reportImageAttemptBase(job) {
  const retry = job.audit?.findLast(event => event.event === 'RETRY_REQUESTED');
  return Number.isSafeInteger(retry?.attemptBase) && retry.attemptBase >= 0 && retry.attemptBase <= job.attempts ? retry.attemptBase : 0;
}

/** A definite rejected edit has no output to reconcile. Neither a failed local
 * decoder nor an accepted/unknown request grants permission for another edit. */
export function reportImageRejection(job) {
  if (!job || job.state !== 'FAILED' || job.code !== 'REPORT_IMAGE_REQUEST_REJECTED' || job.result != null
    || job.claim_id != null || job.lease_until != null || !Array.isArray(job.audit) || !Number.isSafeInteger(job.attempts)) return null;
  const failure = job.audit.at(-1), requestId = failure?.requestId;
  if (failure?.event !== 'FAILED' || failure.code !== job.code || !UUID.test(requestId ?? '')) return null;
  const requested = job.audit.filter(event => event.event === 'REQUESTED');
  const responses = job.audit.filter(event => event.event === 'RESPONSE' && event.requestId === requestId);
  if (requested.at(-1)?.requestId !== requestId || requested.filter(event => event.requestId === requestId).length !== 1
    || responses.length !== 1 || job.audit.some(event => event.event === 'RETRY_REQUESTED' && event.failedRequestId === requestId)) return null;
  const receipt = responses[0].receipt;
  if (!receipt || receipt.status !== 400 || receipt.clientRequestId !== requestId || receipt.sourceSha256 !== job.source_hash
    || receipt.recipeHash !== job.recipe_hash || receipt.execution !== REPORT_IMAGE_RECIPE.execution || receipt.model !== REPORT_IMAGE_RECIPE.model
    || receipt.promptVersion !== REPORT_IMAGE_RECIPE.promptVersion || receipt.promptSha256 !== digest(REPORT_IMAGE_RECIPE.prompt)
    || job.recipe_hash !== reportImageRecipeHash(REPORT_IMAGE_RECIPE)
    || ['outputSha256', 'byteCount', 'usage'].some(key => Object.hasOwn(receipt, key))) return null;
  try { if (canonical(receipt) !== canonical(failure.receipt)) return null; } catch { return null; }
  return { code: 'REPORT_IMAGE_REQUEST_REJECTED', retryable: true, jobKey: job.key, failedRequestId: requestId };
}

export function createReportImageRetry({ boundary, intakeRepository, recipe, wake = () => {} }) {
  const recipeHash = reportImageRecipeHash(recipe);
  return async function retry(staff, cardId, side, input) {
    uuid(cardId); requireThat(['FRONT', 'BACK'].includes(side), 400, 'REPORT_IMAGE_RETRY_INVALID');
    object(input, ['requestId', 'uploadId', 'jobKey', 'failedRequestId']);
    uuid(input.requestId); uuid(input.uploadId); uuid(input.failedRequestId);
    requireThat(/^[a-f0-9]{64}$/.test(input.jobKey ?? ''), 400, 'REPORT_IMAGE_RETRY_INVALID');
    const receipt = await boundary.transaction(staff, async ({ tx, principal, refresh }) => {
      await intakeRepository.authorizeInTransaction(tx, principal, cardId, { edit: true, lock: 'UPDATE' });
      principal = (await refresh()).principal;
      const [saved] = await tx.$queryRawUnsafe(`SELECT atlas_manual_connected.retry_report_image(
        $1::uuid,$2::integer,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,$9) AS receipt`,
      principal.id, principal.accessVersion, input.requestId, cardId, input.uploadId, side, input.jobKey, input.failedRequestId, recipeHash);
      requireThat(saved?.receipt?.requestId === input.requestId && saved.receipt.jobKey === input.jobKey
        && saved.receipt.failedRequestId === input.failedRequestId, 503, 'REPORT_IMAGE_RETRY_NOT_SAVED');
      return saved.receipt;
    }).catch(error => {
      const code = String(error?.meta?.message ?? error?.message ?? '').match(/\b(REPORT_IMAGE_RETRY_(?:INVALID|ACCESS_DENIED|CONFLICT|UNAVAILABLE|EVIDENCE_INVALID))\b/)?.[1];
      if (code) requireThat(false, code.endsWith('ACCESS_DENIED') ? 403 : code.endsWith('_INVALID') && !code.endsWith('EVIDENCE_INVALID') ? 400 : 409, code);
      throw error;
    });
    // The committed intent is sufficient; a wake failure cannot make the
    // acknowledged request uncertain or authorize a second dispatch.
    try { Promise.resolve(wake()).catch(() => {}); } catch {}
    return { state: 'ACCEPTED', acknowledgedRequest: { requestId: receipt.requestId, uploadId: receipt.uploadId,
      jobKey: receipt.jobKey, failedRequestId: receipt.failedRequestId, side: receipt.side } };
  };
}
