import { validateManualFinishingPlan } from './manual.mjs';

/** Hosted/native integration contract, not a browser hardware API. Each injected
 * adapter owns its durable exact-intent reservation and independent recovery.
 * Native station activation requires a qualified profile and enrolled bridge.
 */
export async function dispatchApprovedFinishing({ plan, association, printer = null, nfc = null, now = Date.now() }) {
  validateManualFinishingPlan(plan);
  if (plan.label.mode !== 'PRODUCTION') throw new Error('FINISHING_FIXTURE_CANNOT_DISPATCH');
  if (!association || association.planHash !== plan.planHash || association.cardId !== plan.binding.cardId
    || association.approvalActionId !== plan.binding.approvalActionId || association.armed !== true
    || !Number.isFinite(association.expiresAt) || association.expiresAt <= now || association.expiresAt - now > 15 * 60 * 1000
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(association.stationId)) throw new Error('FINISHING_PHYSICAL_ASSOCIATION_REQUIRED');
  const run = async (kind, adapter) => {
    if (!adapter || adapter.capability?.qualified !== true) return { state: 'UNAVAILABLE', reason: kind === 'nfc' ? 'MAC_NFC_QUALIFICATION_REQUIRED' : 'PRINTER_CONFIGURATION_REQUIRED' };
    if (kind === 'nfc' && adapter.capability.profile !== plan.nfc.requiredProfile) return { state: 'UNAVAILABLE', reason: 'MAC_NFC_QUALIFICATION_REQUIRED' };
    try {
      const result = await adapter.prepare({ plan, association });
      if (result?.intentId !== plan[kind].intentId || result.planHash !== plan.planHash
        || !(kind === 'print' ? ['SPOOL_ACCEPTED', 'SPOOL_COMPLETED', 'SPOOL_FAILED', 'UNKNOWN']
          : ['WAITING_FOR_TAG', 'PROCESSING', 'WRITE_INTENT', 'READBACK_VERIFIED', 'LOCK_INTENT', 'LOCK_VERIFIED', 'WAITING_FOR_HOST_ACK', 'WAITING_FOR_REMOVAL', 'NFC_COMPLETE', 'UNKNOWN']).includes(result.state))
        throw new Error('FINISHING_ADAPTER_RESULT_INVALID');
      if (kind === 'nfc' && (result.lockVerified === true && result.readbackVerified !== true
        || result.state === 'NFC_COMPLETE' && !['readbackVerified', 'lockVerified', 'removalObserved', 'hostedAcknowledged'].every(key => result[key] === true)))
        throw new Error('FINISHING_ADAPTER_RESULT_INVALID');
      return result;
    } catch { return { intentId: plan[kind].intentId, planHash: plan.planHash, state: 'UNKNOWN', reason: 'RECONCILE_EXACT_INTENT' }; }
  };
  const [print, tag] = await Promise.all([run('print', printer), run('nfc', nfc)]);
  // No aggregate DONE/printed/written state can be inferred from preparation.
  return { planId: plan.id, print, nfc: tag, assembly: 'NOT_RECORDED' };
}
