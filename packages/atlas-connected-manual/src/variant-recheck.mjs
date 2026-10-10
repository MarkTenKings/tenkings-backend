import { canonical, requireThat } from '@atlas/manual-service/contract';
import { defectBase } from '@atlas/manual-workspace/defect-actions';
import { variantBinding } from './variant-job-store.mjs';

/** Uses the existing durable grading executor only after an explicit identity
 * correction. Repeated worker scans resume the exact action; they never invent
 * replacement requests for ambiguous paid outcomes or change human findings. */
export function createVariantRecheck({ store, boundary, workflow, assistance, onError = () => {}, admitDispatch = null }) {
  requireThat(store && boundary && workflow && assistance?.repository, 503, 'VARIANT_RECHECK_CONFIGURATION');
  let running = null;
  async function execute(row) {
    const admit = admitDispatch ? () => admitDispatch({ actionId: row.analysis_action_id }) : null;
    if (admit && !await admit()) return;
    const staff = boundary.machineOwner({ ownerId: row.owner_id, accessVersion: row.access_version });
    const card = await workflow.service.read(staff, row.card_id), binding = variantBinding(card);
    if (binding.sourceHash !== row.source_hash || binding.identityRevision !== row.identity_revision || binding.identityHash !== row.identity_hash) return;
    const confirmation = await store.currentConfirmation(staff, card);
    if (confirmation?.analysis_action_id !== row.analysis_action_id || !confirmation.reprocess_required) return;
    const previous = await assistance.repository.find(staff, { cardId: card.cardId, actionId: row.analysis_action_id });
    if (previous) {
      const status = await assistance.repository.status(staff, { cardId: card.cardId, analysisId: previous.analysisId });
      if (status.retired || status.state !== 'PREPARED') return;
      if (Number.isFinite(Date.parse(previous.expiresAt)) && Date.parse(previous.expiresAt) <= Date.now()) {
        await assistance.repository.retireUndispatched(staff, { cardId:card.cardId, actionId:row.analysis_action_id, baseHash:previous.baseHash, code:'DEFECT_ANALYSIS_REQUEST_EXPIRED' });
        return;
      }
      await assistance.executor.resume(staff, { cardId: card.cardId, analysisId: previous.analysisId, admitDispatch: admit });
      return;
    }
    const state = await workflow.hydrate(card);
    const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, defectBase(state.defects, side)]));
    // Hydration and reference reads cannot turn an older card revision into a
    // fresh request. The executor repeats its own card/source checks under lock.
    requireThat(canonical(variantBinding(await workflow.service.read(staff, card.cardId))) === canonical(binding), 409, 'VARIANT_IDENTITY_STALE');
    await assistance.analyzeMachine(staff, card.cardId, { actionId: row.analysis_action_id, base }, { admitDispatch: admit });
  }
  return () => {
    if (running) return running;
    running = (async () => {
      for (const row of await store.pendingRechecks(2)) {
        try { await execute(row); }
        catch (error) { onError({ code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'VARIANT_RECHECK_INTERRUPTED' }); }
      }
    })().finally(() => { running = null; });
    return running;
  };
}
