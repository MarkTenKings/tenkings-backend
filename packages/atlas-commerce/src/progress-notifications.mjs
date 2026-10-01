import { randomUUID } from 'node:crypto';
import { requireValue } from './contract.mjs';

export const PROGRESS_MESSAGES = Object.freeze({
  DEALER_RECEIVED: 'has been received and confirmed by the drop-off shop',
  COLLECTED: 'has been collected from the drop-off location',
  ATLAS_RECEIVED: 'has arrived at ATLAS',
  GRADING_STARTED: 'is being graded',
  REPORT_PUBLISHED: 'has an approved grading report ready to view',
  RETURN_DISPATCHED: 'has been dispatched back to the drop-off location',
  RETURNED_TO_KIOSK: 'has arrived back at the drop-off location',
  CUSTOMER_COLLECTED: 'has been recorded as collected by you',
  MAIL_DISPATCHED: 'has been dispatched to your return address',
  CUSTOMER_DELIVERED: 'has been recorded as delivered',
  DELAY_REPORTED: 'has a recorded delay; see your account for details',
  DELAY_RESOLVED: 'has a recorded delay resolution',
});

export function progressMessage(request) {
  requireValue(request && Object.hasOwn(PROGRESS_MESSAGES, request.eventKind)
    && /^[A-Z0-9-]{1,24}$/.test(request.reference ?? '')
    && /^[a-f0-9-]{36}$/.test(request.cardId ?? '')
    && Number.isFinite(Date.parse(request.occurredAt)), 'PROGRESS_EVENT_INVALID');
  requireValue(request.title === undefined || typeof request.title === 'string' && request.title.length <= 180 && !/[\x00-\x1f\x7f]/.test(request.title), 'PROGRESS_EVENT_INVALID');
  const card = `${request.title?.trim() ? `“${request.title.trim()}”` : 'Your card'} in order ${request.reference}`;
  return {
    subject: `ATLAS card update · ${request.reference}`,
    text: `ATLAS Grading: ${card} ${PROGRESS_MESSAGES[request.eventKind]}. View the recorded progress at https://atlasgrading.com/account.`,
  };
}

/** The database claim commits before the provider is called. Unknown outcomes
 * remain quarantined; polling cannot dispatch the same event/channel twice. */
export function createProgressNotificationWorker({ call, notifications, enabled = false, uuid = randomUUID }) {
  requireValue(typeof call === 'function', 'PROGRESS_CONFIGURATION_REQUIRED', 503);
  return { async runOnce() {
    if (!enabled || !notifications) return { enabled: false, processed: 0 };
    const { ids = [] } = await call('pending', {});
    requireValue(Array.isArray(ids) && ids.length <= 20 && ids.every(id => typeof id === 'string' && id.length <= 180), 'PROGRESS_RESPONSE_INVALID', 503);
    let processed = 0;
    for (const id of ids) {
      const claimId = uuid(), claim = await call('claim', { id, claimId });
      if (!claim.dispatch) continue;
      let result;
      try {
        requireValue(claim.effect?.id === id && ['EMAIL_PROGRESS', 'SMS_PROGRESS'].includes(claim.effect.kind), 'PROGRESS_RESPONSE_INVALID', 503);
        progressMessage(claim.effect.request);
        result = await notifications.send(claim.effect.kind, claim.effect.request, id);
      } catch {
        await call('finish', { id, claimId, state: 'UNKNOWN', result: { code: 'PROGRESS_OUTCOME_UNKNOWN' } });
        processed++; continue;
      }
      // Do not turn a lost finish acknowledgement into another provider send.
      await call('finish', { id, claimId, state: 'ACCEPTED', result });
      processed++;
    }
    return { enabled: true, processed };
  } };
}
