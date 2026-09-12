import { canonical, immutable, inputCommand, object, requireThat, stateDocument } from './contract.mjs';

/** reduce and buildReport are trusted server adapters, never browser callbacks.
 * They may decode/measure/store/hydrate, but execute with NO DB transaction.
 * Only compact refs and deterministic content reach CAS; conflicting results
 * remain immutable unreferenced artifacts, never overwrites of newer work.
 */
export function createManualService({ repository, reduce, buildReport = null }) {
  requireThat(repository && typeof reduce === 'function', 500, 'MANUAL_SERVICE_INVALID');
  return Object.freeze({
    authorizeEdit: (staff, cardId) => repository.authorizeEdit(staff, cardId),
    read: async (staff, cardId) => (await repository.load(staff, cardId)).card,
    status: (staff, cardId, actionId) => repository.status(staff, cardId, actionId),
    readApproval: (staff, cardId, actionId) => repository.readApproval(staff, cardId, actionId),
    latestApproval: (staff, cardId) => repository.latestApproval(staff, cardId),
    async previewReport(staff, cardId) {
      requireThat(typeof buildReport === 'function', 503, 'MANUAL_REPORT_UNAVAILABLE');
      const { card, principal } = await repository.load(staff, cardId);
      const report = stateDocument(await buildReport({ card, principal }));
      return { report: report.draft, reportHash: report.hash, sourceRevision: card.revision, sourceHash: card.contentHash };
    },
    async execute(staff, cardId, input) {
      const { input: command } = inputCommand(input);
      const previous = await repository.findAction(staff, cardId, command); if (previous) return previous;
      const { card, principal } = await repository.load(staff, cardId);
      requireThat(card.revision === command.expectedRevision, 409, 'MANUAL_DRAFT_STALE');
      let draft, approval = null;
      if (command.action.type === 'APPROVE_REPORT') {
        object(command.action, ['type', 'reportHash', 'reviewed']);
        requireThat(command.action.reviewed === true && principal.canCertify, 403, 'MANUAL_CERTIFICATION_REQUIRED');
        requireThat(typeof buildReport === 'function', 503, 'MANUAL_REPORT_UNAVAILABLE');
        const report = stateDocument(await buildReport({ card, principal }));
        requireThat(report.hash === command.action.reportHash, 409, 'MANUAL_REPORT_STALE');
        approval = report.draft; draft = card.draft;
      } else {
        draft = await reduce(immutable({ card, action: command.action, principal }));
      }
      // Snapshot again before awaiting persistence; caller-owned references do
      // not survive across the commit's authentication/lock awaits.
      draft = JSON.parse(canonical(draft));
      return repository.commit(staff, { cardId, input: command, baseHash: card.contentHash, draft, approval });
    },
  });
}
