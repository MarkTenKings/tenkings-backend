import { canonical, digest, requireThat, object, uuid } from '@atlas/manual-service/contract';
import { geometryStatus } from '@atlas/manual-workspace/geometry-actions';
import { defectBase } from '@atlas/manual-workspace/defect-actions';
import { createDefectMemory, createDefectMemoryRepository } from '@atlas/defect-memory';
import { authorizeManualCard } from '@atlas/defect-memory/repository';
import { buildAstraDefectRequest } from '@atlas/defect-analysis';
import { createAnalysisRepository } from '@atlas/defect-analysis/repository';
import { createAnalysisExecutor } from '@atlas/defect-analysis/executor';
import { proposalRle } from '../../atlas-manual-workflow/src/proposal-review.mjs';

const SIDES = ['FRONT', 'BACK'];
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
  const repository = provider ? createAnalysisRepository({ boundary, receiptClient,
    authorize: ({ tx, principal, cardId, edit }) => authorizeManualCard(tx, principal, cardId, { edit }),
    assertCurrent: async ({ tx, principal, cardId, binding }) => {
      const card = await authorizeManualCard(tx, principal, cardId, { edit: true, lock: true,
        expectedContentHash: binding.manualContentHash });
      requireThat(card.revision === binding.manualRevision && card.draft.identityRevision === binding.identityRevision
        && card.draft.source.sourceHash === binding.sourceHash, 409, 'DEFECT_ANALYSIS_STALE');
      await validateSource({ tx, principal, cardId, draft: card.draft });
    },
  }) : null;
  const executor = repository ? createAnalysisExecutor({ repository, provider, artifacts }) : null;
  async function memoryStatus(staff, cardId) {
    if (!memory) return { enabled: false, status: 'UNSAVED' };
    const saved = await memory.status(staff, cardId);
    return { enabled: true, status: { NO_CONFIRMED_FINDINGS: 'UNSAVED', SUPERSEDED: 'UNSAVED',
      PENDING: 'PENDING', PUBLISHED: 'SAVED' }[saved.status] ?? 'UNKNOWN', exampleCount: saved.lessonCount ?? 0 };
  }
  async function project(staff, cardId, analysisId = null, snapshot = null) {
    if (!executor) return { astra: { enabled: false, status: 'IDLE' } };
    const run = analysisId ? await repository.status(staff, { cardId, analysisId }) : await repository.latest(staff, { cardId });
    if (!run) return analysisId ? { state: 'NOT_FOUND' } : { astra: { enabled: true, status: 'IDLE' } };
    if (run.retired) return { state: 'REFUSED', astra: { enabled: true, status: 'REFUSED', analysisId: run.analysisId,
      proposals: [], limitations: ['This request was retired before dispatch because its card state changed or its start window expired. Start a new analysis when the card is ready.'],
      resumeAvailable: false } };
    const card = snapshot?.card ?? await workflow.service.read(staff, cardId), state = snapshot?.state ?? await workflow.hydrate(card);
    const loaded = run.state === 'READY' ? await executor.readResult(staff, { cardId, analysisId: run.analysisId }) : null;
    const status = run.state === 'READY' && !compatible(run, card, state) ? 'STALE'
      : { PREPARED: 'UNKNOWN', DISPATCHED: 'RUNNING' }[run.state] ?? run.state;
    const reviews = state.assistance?.reviews ?? [];
    const proposals = (loaded?.result?.proposals ?? []).map(proposal => {
      const review = reviews.find(r => r.analysisId === run.analysisId && r.proposalId === proposal.id);
      return { ...proposal, reviewStatus: review ? { ACCEPT: 'ACCEPTED', TRACE_SAVE: 'CORRECTED', REJECT: 'REJECTED' }[review.action] : 'UNREVIEWED' };
    });
    return { state: run.state, astra: { enabled: true, status, analysisId: run.analysisId,
      base: Object.fromEntries(SIDES.map(side => [side, baseFromRun(run, side)])), proposals,
      limitations: loaded?.result?.limitations ?? [],
      resumeAvailable: run.state === 'PREPARED', knowledgeRevision: run.requestEvidence.knowledge.revision } };
  }
  return Object.freeze({
    memory, repository, executor,
    async publish(staff, cardId, actionId = null) {
      requireThat(memory, 503, 'DEFECT_MEMORY_DISABLED');
      const current = actionId ? { actionId } : await memory.status(staff, cardId);
      requireThat(current.actionId, 409, 'MEMORY_CONFIRMATION_REQUIRED');
      await memory.publish(staff, cardId, current.actionId);
      return { reviewedMemory: await memoryStatus(staff, cardId) };
    },
    async analyze(staff, cardId, input) {
      requireThat(executor, 503, 'DEFECT_ANALYSIS_DISABLED');
      object(input, ['actionId', 'base']); uuid(input.actionId); object(input.base, SIDES);
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
      const { card } = await workflow.service.authorizeEdit(staff, cardId), state = await workflow.hydrate(card);
      const binding = defectAnalysisBinding(card, state);
      requireThat(SIDES.every(side => canonical(input.base[side]) === canonical(defectBase(state.defects, side))), 409, 'DEFECT_ANALYSIS_STALE');
      const images = await imageEffects.currentImages(staff, card, binding);
      // This is a fresh database retrieval for every new request, after costly
      // image preparation. Pending reviewed publications refuse paid dispatch.
      const knowledge = await memory.retrieve(staff, { cardId, limit: 12 });
      const prepared = buildAstraDefectRequest({ analysisId: input.actionId, cardId, profile: state.geometry.profile,
        cornerShapes: Object.fromEntries(SIDES.map(side => [side, state.defects.sides[side].cornerShape])),
        binding, images, knowledge, lessonImages: await imageEffects.lessonImages(knowledge) });
      await executor.prepareAndRun(staff, { cardId, actionId: input.actionId, prepared,
        expiresAt: new Date(Date.now() + 180000).toISOString() });
      return project(staff, cardId, input.actionId);
      } catch (error) {
        const stale = ['DEFECT_ANALYSIS_STALE', 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 'MANUAL_DRAFT_STALE',
          'MANUAL_GEOMETRY_REVIEW_REQUIRED', 'MANUAL_DEFECT_PENDING', 'MANUAL_PHOTOS_CHANGED', 'INTAKE_PAIR_STALE'];
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
      requireThat(executor, 503, 'DEFECT_ANALYSIS_DISABLED'); uuid(analysisId);
      const loaded = await executor.readResult(staff, { cardId: card.cardId, analysisId });
      requireThat(loaded?.run?.state === 'READY' && loaded.result, 409, 'MANUAL_PROPOSAL_UNAVAILABLE');
      const state = await workflow.hydrate(card);
      requireThat(compatible(loaded.run, card, state), 409, 'MANUAL_PROPOSAL_STALE');
      const proposal = loaded.result.proposals.find(p => p.id === proposalId);
      requireThat(proposal, 404, 'MANUAL_PROPOSAL_NOT_FOUND');
      return { proposal, base: baseFromRun(loaded.run, proposal.side) };
    },
    async workspaceExtras({ staff, card, state }) {
      const extras = { astra: { enabled: Boolean(provider), status: 'UNKNOWN' },
        reviewedMemory: { enabled: memoryEnabled, status: 'UNKNOWN' } };
      // Ancillary read failures do not disable grading. Each route independently
      // reauthenticates; no previous or cross-card result is used as a fallback.
      try { Object.assign(extras, await project(staff, card.cardId, null, { card, state })); } catch { /* visible UNKNOWN */ }
      try { extras.reviewedMemory = await memoryStatus(staff, card.cardId); } catch { /* visible UNKNOWN */ }
      return extras;
    },
  });
}
