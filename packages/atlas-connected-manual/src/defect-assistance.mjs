import { canonical, digest, requireThat, object, uuid } from '@atlas/manual-service/contract';
import { geometryStatus } from '@atlas/manual-workspace/geometry-actions';
import { defectBase } from '@atlas/manual-workspace/defect-actions';
import { createDefectMemory, createDefectMemoryRepository } from '@atlas/defect-memory';
import { authorizeManualCard } from '@atlas/defect-memory/repository';
import { buildAstraContextBackgroundDefectRequest, INSPECTION_CONTEXT_CROP_LAYOUT } from '@atlas/defect-analysis';
import { createAnalysisRepository } from '@atlas/defect-analysis/repository';
import { createAnalysisExecutor, createAnalysisResultReader } from '@atlas/defect-analysis/executor';
import { proposalRle } from '../../atlas-manual-workflow/src/proposal-review.mjs';
import { readConfirmationFence } from './confirmation-fence.mjs';

const SIDES = ['FRONT', 'BACK'];
function confirmationOffer(run, result, state) {
  const reviews = state.assistance?.reviews ?? [];
  return { analysisId: run.analysisId, resultHash: digest(canonical(result)),
    proposalIds: result.proposals.filter(proposal => !reviews.some(review => review.analysisId === run.analysisId
      && review.proposalId === proposal.id)).map(proposal => proposal.id).sort() };
}
export function defectAnalysisBinding(card, state) {
  requireThat(state.defects && geometryStatus(state.geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
  requireThat(SIDES.every(side => !state.defects.sides[side].pending), 409, 'MANUAL_DEFECT_PENDING');
  return { sourceHash: card.draft.source.sourceHash, manualRevision: card.revision, manualContentHash: card.contentHash,
    identityRevision: card.draft.identityRevision, geometryRevision: state.geometry.reportRevision,
    defectRevision: state.defects.draftRevision, sides: Object.fromEntries(SIDES.map(side => {
      const slot = state.defects.sides[side];
      return [side, { frame: slot.frame, findingRevision: slot.findingRevision, reviewRevision: slot.reviewRevision }];
    })) };
}
function baseFromRun(run, side) {
  const evidence = run.requestEvidence, slot = run.binding.sides[side];
  return { schemaVersion: 1, cardId: run.cardId, profile: evidence.profile, side, frame: slot.frame,
    cornerShape: evidence.cornerShapes[side], findingRevision: slot.findingRevision, reviewRevision: slot.reviewRevision };
}
function compatible(run, card, state) {
  return Boolean(state.defects && run.binding.sourceHash === card.draft.source.sourceHash
    && run.binding.identityRevision === card.draft.identityRevision
    && run.requestEvidence.profile === state.geometry.profile && SIDES.every(side => {
      const base = baseFromRun(run, side), current = defectBase(state.defects, side);
      return canonical(base.frame) === canonical(current.frame) && base.cornerShape === current.cornerShape;
    }));
}

/** Memory and model state are independently durable. Neither changes a manual
 * draft; only an authenticated, journaled human proposal action can do that. */
export function createDefectAssistance({ boundary, intakeRepository, workflow, artifacts, imageEffects,
  memoryEnabled = false, provider = null, receiptClient = null }) {
  requireThat(!provider || memoryEnabled, 503, 'DEFECT_ANALYSIS_MEMORY_REQUIRED');
  const validateSource = ({ tx, principal, cardId, draft }) => intakeRepository.assertCurrentPair(tx, principal,
    { cardId, sourceHash: draft.source?.sourceHash });
  const memory = memoryEnabled ? createDefectMemory({ repository: createDefectMemoryRepository({ boundary, validateSource }),
    hydrate: workflow.hydrate, createExemplar: imageEffects.createExemplar, proposalTrace: proposalRle }) : null;
  const repository = memoryEnabled ? createAnalysisRepository({ boundary, receiptClient,
    authorize: ({ tx, principal, cardId, edit }) => authorizeManualCard(tx, principal, cardId, { edit }),
    assertCurrent: async ({ tx, principal, cardId, binding }) => {
      const card = await authorizeManualCard(tx, principal, cardId, { edit: true, lock: true,
        expectedContentHash: binding.manualContentHash });
      requireThat(card.revision === binding.manualRevision && card.draft.identityRevision === binding.identityRevision
        && card.draft.source.sourceHash === binding.sourceHash, 409, 'DEFECT_ANALYSIS_STALE');
      await validateSource({ tx, principal, cardId, draft: card.draft });
    },
  }) : null;
  const executor = provider ? createAnalysisExecutor({ repository, provider, artifacts }) : null;
  const reader = repository ? createAnalysisResultReader({ repository, artifacts }) : null;
  async function reviewContext(staff, card, state = null) {
    if (!reader) return { fence: null, offer: null, entries: [] };
    const fence = await boundary.transaction(staff, async ({ tx, principal }) => {
      await authorizeManualCard(tx, principal, card.cardId);
      return readConfirmationFence(tx, card.cardId);
    });
    if (!fence) return { fence, offer: null, entries: [] };
    const run = await repository.status(staff, { cardId: card.cardId, analysisId: fence.analysisId });
    requireThat(run && !run.retired && run.requestHash === fence.requestHash, 409, 'MANUAL_ASTRA_REVIEW_STALE');
    requireThat(!['PREPARED', 'DISPATCHED', 'RUNNING'].includes(run.state), 409, 'MANUAL_ASTRA_ANALYSIS_PENDING');
    if (run.state !== 'READY') return { fence, offer: null, entries: [] };
    state ??= await workflow.hydrate(card);
    if (!compatible(run, card, state)) return { fence, offer: null, entries: [] };
    const loaded = await reader.readResult(staff, { cardId: card.cardId, analysisId: run.analysisId });
    requireThat(loaded?.result && loaded.run.state === 'READY', 409, 'MANUAL_ASTRA_REVIEW_STALE');
    const offer = confirmationOffer(loaded.run, loaded.result, state);
    return { fence, offer, entries: loaded.result.proposals.filter(proposal => offer.proposalIds.includes(proposal.id))
      .sort((a, b) => a.id.localeCompare(b.id)).map(proposal => ({ proposal, base: baseFromRun(loaded.run, proposal.side) })) };
  }
  async function memoryStatus(staff, cardId) {
    if (!memory) return { enabled: false, status: 'UNSAVED' };
    const saved = await memory.status(staff, cardId);
    return { enabled: true, status: { NO_CONFIRMED_FINDINGS: 'UNSAVED', SUPERSEDED: 'UNSAVED',
      PENDING: 'PENDING', PUBLISHED: 'SAVED' }[saved.status] ?? 'UNKNOWN', exampleCount: saved.lessonCount ?? 0 };
  }
  async function project(staff, cardId, analysisId = null, snapshot = null) {
    if (!reader) return { astra: { enabled: false, requestAvailable: false, status: 'IDLE' } };
    let run = analysisId ? await repository.status(staff, { cardId, analysisId }) : await repository.latest(staff, { cardId });
    // A retired undispatched attempt has no replacement findings. Keep the
    // workspace on its existing active saved analysis; exact action-status
    // reads still expose the immutable refusal and its normal recovery copy.
    if (!analysisId && run?.retired) {
      const active = await boundary.transaction(staff, async ({ tx, principal }) => {
        await authorizeManualCard(tx, principal, cardId);
        return readConfirmationFence(tx, cardId);
      });
      if (active) run = await repository.status(staff, { cardId, analysisId: active.analysisId });
    }
    if (!run) return analysisId ? { state: 'NOT_FOUND' } : { astra: { enabled: true, requestAvailable: Boolean(provider), status: 'IDLE' } };
    if (run.retired) return { state: 'REFUSED',
      ...(['DEFECT_ANALYSIS_PENDING', 'DEFECT_ANALYSIS_REPLACEMENT_INVALID'].includes(run.code) ? { followLatest: true } : {}),
      astra: { enabled: true, requestAvailable: Boolean(provider), status: 'REFUSED', analysisId: run.analysisId,
      proposals: [], limitations: [run.code === 'DEFECT_ANALYSIS_PENDING'
        ? 'Another analysis is still pending. Check the saved analysis before starting another.'
        : run.code === 'DEFECT_ANALYSIS_REPLACEMENT_INVALID'
          ? 'The saved analysis changed. Reload its current status before requesting a replacement.'
          : 'This request was retired before dispatch because its card state changed or its start window expired. Start a new analysis when the card is ready.'],
      resumeAvailable: false } };
    const card = snapshot?.card ?? await workflow.service.read(staff, cardId), state = snapshot?.state ?? await workflow.hydrate(card);
    const loaded = run.state === 'READY' ? await reader.readResult(staff, { cardId, analysisId: run.analysisId }) : null;
    const status = run.state === 'READY' && !compatible(run, card, state) ? 'STALE'
      : { PREPARED: 'UNKNOWN', DISPATCHED: 'RUNNING' }[run.state] ?? run.state;
    const reviews = state.assistance?.reviews ?? [];
    const proposals = (loaded?.result?.proposals ?? []).map(proposal => {
      const review = reviews.find(r => r.analysisId === run.analysisId && r.proposalId === proposal.id);
      return { ...proposal, reviewStatus: review ? { ACCEPT: 'ACCEPTED', TRACE_SAVE: 'CORRECTED', REJECT: 'REJECTED' }[review.action] : 'UNREVIEWED' };
    });
    let replacement = null;
    if (run.state === 'UNKNOWN' && !run.backgroundAccepted) {
      // Eligibility is an authenticated read of the exact saved no-ID outcome.
      // Read-only staff may still inspect the card without replacement authority.
      try { replacement = await repository.replacementEligibility(staff, { cardId, analysisId: run.analysisId }); }
      catch { /* No verified replacement capability is exposed on read failure. */ }
    }
    // The repository verifies acceptance and receipt evidence. Admission expiry
    // never means that collection of an accepted provider response has stopped.
    const collectionStopped = run.state === 'UNKNOWN' && run.backgroundAccepted && run.acceptance
      && (Date.parse(run.acceptance.pollUntil) <= Date.now() || run.receipts.some(receipt => receipt.kind === 'OUTCOME'
        && receipt.evidence.code === 'DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED'
        && receipt.evidence.responseId === run.acceptance.responseId));
    return { state: run.state, astra: { enabled: true, requestAvailable: Boolean(provider), status, analysisId: run.analysisId,
      base: Object.fromEntries(SIDES.map(side => [side, baseFromRun(run, side)])), proposals,
      ...(status === 'READY' && loaded?.result ? { proposalReview: confirmationOffer(run, loaded.result, state) } : {}),
      limitations: loaded?.result?.limitations ?? [],
      resumeAvailable: run.state === 'PREPARED', knowledgeRevision: run.requestEvidence.knowledge.revision,
      ...(run.backgroundAccepted ? { backgroundAccepted: true } : {}), ...(collectionStopped ? { collectionStopped: true } : {}),
      ...(replacement ? { replacement } : {}) } };
  }
  return Object.freeze({
    memory, repository, executor,
    async resolveConfirmation({ staff, card, selection = null }) {
      const context = await reviewContext(staff, card);
      if (selection) {
        object(selection, ['analysisId', 'resultHash', 'proposalIds']);
        requireThat(context.offer && context.offer.proposalIds.length > 0
          && canonical(selection) === canonical(context.offer), 409, 'MANUAL_ASTRA_REVIEW_STALE');
      } else requireThat(!context.entries.length, 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
      return context;
    },
    async assertReviewComplete({ staff, card, selection = null }) {
      const context = await reviewContext(staff, card);
      requireThat(!context.entries.length, 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
      if (selection) requireThat(context.offer?.analysisId === selection.analysisId
        && context.offer?.resultHash === selection.resultHash, 409, 'MANUAL_ASTRA_REVIEW_STALE');
      return context.fence;
    },
    async publish(staff, cardId, actionId = null) {
      requireThat(memory, 503, 'DEFECT_MEMORY_DISABLED');
      const current = actionId ? { actionId } : await memory.status(staff, cardId);
      requireThat(current.actionId, 409, 'MEMORY_CONFIRMATION_REQUIRED');
      await memory.publish(staff, cardId, current.actionId);
      return { reviewedMemory: await memoryStatus(staff, cardId) };
    },
    async analyze(staff, cardId, input) {
      requireThat(executor, 503, 'DEFECT_ANALYSIS_DISABLED');
      object(input, Object.hasOwn(input ?? {}, 'replacement') ? ['actionId', 'base', 'replacement'] : ['actionId', 'base']);
      uuid(input.actionId); object(input.base, SIDES);
      if (input.replacement) {
        object(input.replacement, ['analysisId', 'outcomeHash']); uuid(input.replacement.analysisId);
        requireThat(input.replacement.analysisId !== input.actionId && typeof input.replacement.outcomeHash === 'string'
          && /^[a-f0-9]{64}$/.test(input.replacement.outcomeHash));
      } else requireThat(!Object.hasOwn(input, 'replacement'));
      input = JSON.parse(canonical(input));
      const baseHash = digest(canonical(input));
      try {
      const old = await repository.find(staff, { cardId, actionId: input.actionId });
      if (old) {
        requireThat(old.baseHash === baseHash, 409, 'DEFECT_ANALYSIS_ACTION_CONFLICT');
        if (old.retired) return project(staff, cardId, old.analysisId);
        requireThat(SIDES.every(side => canonical(input.base[side]) === canonical(baseFromRun(old, side))), 409, 'DEFECT_ANALYSIS_ACTION_CONFLICT');
        if (old.state === 'PREPARED') await executor.resume(staff, { cardId, analysisId: old.analysisId });
        return project(staff, cardId, old.analysisId);
      }
      // Reads and same-action recovery never create another provider request.
      // The repository repeats this latest-run gate under its card lock before
      // prepare, closing the race between different human action IDs.
      const latest = await repository.latest(staff, { cardId });
      if (input.replacement) {
        requireThat(latest?.analysisId === input.replacement.analysisId, 409, 'DEFECT_ANALYSIS_REPLACEMENT_INVALID');
        const eligible = await repository.replacementEligibility(staff, { cardId, analysisId: input.replacement.analysisId });
        requireThat(eligible && canonical(eligible) === canonical(input.replacement), 409, 'DEFECT_ANALYSIS_REPLACEMENT_INVALID');
      } else requireThat(latest?.retired || !['PREPARED', 'DISPATCHED', 'RUNNING', 'UNKNOWN'].includes(latest?.state),
        409, 'DEFECT_ANALYSIS_PENDING');
      const { card } = await workflow.service.authorizeEdit(staff, cardId), state = await workflow.hydrate(card);
      const binding = defectAnalysisBinding(card, state);
      requireThat(SIDES.every(side => canonical(input.base[side]) === canonical(defectBase(state.defects, side))), 409, 'DEFECT_ANALYSIS_STALE');
      const images = await imageEffects.currentImages(staff, card, binding, INSPECTION_CONTEXT_CROP_LAYOUT);
      // This is a fresh database retrieval for every new request, after costly
      // image preparation. Pending reviewed publications refuse paid dispatch.
      const knowledge = await memory.retrieve(staff, { cardId, limit: 12 });
      const prepared = buildAstraContextBackgroundDefectRequest({ analysisId: input.actionId, cardId, profile: state.geometry.profile,
        cornerShapes: Object.fromEntries(SIDES.map(side => [side, state.defects.sides[side].cornerShape])),
        binding, images, knowledge, lessonImages: await imageEffects.lessonImages(knowledge) });
      await executor.prepareAndRun(staff, { cardId, actionId: input.actionId, prepared,
        expiresAt: new Date(Date.now() + 180000).toISOString(), baseHash,
        ...(input.replacement ? { replacement: input.replacement } : {}) });
      return project(staff, cardId, input.actionId);
      } catch (error) {
        const stale = ['DEFECT_ANALYSIS_STALE', 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 'MANUAL_DRAFT_STALE',
          'MANUAL_GEOMETRY_REVIEW_REQUIRED', 'MANUAL_DEFECT_PENDING', 'MANUAL_PHOTOS_CHANGED', 'INTAKE_PAIR_STALE',
          'DEFECT_ANALYSIS_PENDING', 'DEFECT_ANALYSIS_REPLACEMENT_INVALID'];
        if (!stale.includes(error?.code)) throw error;
        // A durable card-serialized refusal proves this exact action can never
        // dispatch later. Generic HTTP failures never clear the browser journal.
        const code = ['MANUAL_DRAFT_STALE', 'MANUAL_PHOTOS_CHANGED', 'INTAKE_PAIR_STALE'].includes(error.code)
          ? 'DEFECT_ANALYSIS_STALE' : error.code;
        await repository.retireUndispatched(staff, { cardId, actionId: input.actionId, baseHash, code });
        return project(staff, cardId, input.actionId);
      }
    },
    status: (staff, cardId, analysisId = null) => project(staff, cardId, analysisId),
    async resolveProposal({ staff, card, analysisId, proposalId }) {
      requireThat(reader, 503, 'DEFECT_ANALYSIS_DISABLED'); uuid(analysisId);
      const loaded = await reader.readResult(staff, { cardId: card.cardId, analysisId });
      requireThat(loaded?.run?.state === 'READY' && loaded.result, 409, 'MANUAL_PROPOSAL_UNAVAILABLE');
      const state = await workflow.hydrate(card);
      requireThat(compatible(loaded.run, card, state), 409, 'MANUAL_PROPOSAL_STALE');
      const proposal = loaded.result.proposals.find(p => p.id === proposalId);
      requireThat(proposal, 404, 'MANUAL_PROPOSAL_NOT_FOUND');
      return { proposal, base: baseFromRun(loaded.run, proposal.side) };
    },
    async workspaceExtras({ staff, card, state }) {
      const extras = { astra: { enabled: Boolean(reader), requestAvailable: Boolean(provider), status: 'UNKNOWN' },
        reviewedMemory: { enabled: memoryEnabled, status: 'UNKNOWN' } };
      // Ancillary read failures do not disable grading. Each route independently
      // reauthenticates; no previous or cross-card result is used as a fallback.
      try { Object.assign(extras, await project(staff, card.cardId, null, { card, state })); } catch { /* visible UNKNOWN */ }
      try { extras.reviewedMemory = await memoryStatus(staff, card.cardId); } catch { /* visible UNKNOWN */ }
      return extras;
    },
  });
}
