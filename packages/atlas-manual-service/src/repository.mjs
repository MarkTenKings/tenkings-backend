import { canonical, digest, immutable, inputCommand, requireThat, revision, stateDocument, uuid } from './contract.mjs';

function access(row, principal, kind = 'read') {
  requireThat(row, 404, 'MANUAL_CARD_NOT_FOUND');
  const own = row.owner_id === principal.id;
  const edit = own || row.editors.includes(principal.id);
  const approve = own || row.approvers.includes(principal.id);
  const read = edit || approve || row.readers.includes(principal.id);
  requireThat(read, 404, 'MANUAL_CARD_NOT_FOUND');
  if (kind !== 'read') requireThat(principal.role === 'REVIEWER' && (kind === 'approve' ? approve : edit), 403, 'MANUAL_CARD_ACCESS_DENIED');
  if (kind === 'approve') requireThat(principal.canCertify, 403, 'MANUAL_CERTIFICATION_REQUIRED');
}
function card(row) {
  requireThat(digest(row.content) === row.content_hash, 503, 'MANUAL_STORED_CONTENT_INVALID');
  return { cardId: row.id, revision: row.revision, contentHash: row.content_hash, draft: JSON.parse(row.content) };
}
function replay(row, principal, requestHash) {
  if (!row) return null;
  requireThat(row.actor_id === principal.id && row.request_hash === requestHash, 409, 'MANUAL_ACTION_ID_CONFLICT');
  return JSON.parse(row.result);
}
function approvalSnapshot(row) {
  if (!row) return null;
  requireThat(digest(row.report) === row.report_hash, 503, 'MANUAL_STORED_CONTENT_INVALID');
  return { actionId: row.action_id, actorId: row.actor_id, sourceRevision: row.source_revision, sourceHash: row.source_hash,
    reportHash: row.report_hash, report: JSON.parse(row.report), approvedAt: new Date(row.approved_at).toISOString() };
}

/** No provider/storage/reducer effect is accepted inside these transactions.
 * Brief row locks cover auth/ACL, CAS, action receipt and optional approval.
 */
export function createManualRepository({ boundary, validateSource = null, validateCommit = null, approvalCommitted = null }) {
  const loadRow = async (tx, cardId, lock = false) => (await tx.$queryRawUnsafe(
    `SELECT * FROM atlas_manual.card WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, cardId))[0];
  return Object.freeze({
    async provision(staff, { cardId, draft }) {
      uuid(cardId); const document = stateDocument(draft);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'MANUAL_CARD_ACCESS_DENIED');
        if (validateSource) await validateSource({ tx, principal, cardId, draft: document.draft, initial: true });
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id)
          VALUES($1::uuid,1,$2,$3,$4::uuid) ON CONFLICT(id) DO NOTHING`, cardId, document.text, document.hash, principal.id);
        const row = await loadRow(tx, cardId, true); access(row, principal, 'edit');
        requireThat(row.owner_id === principal.id && row.revision === 1 && row.content_hash === document.hash, 409, 'MANUAL_CARD_ID_CONFLICT');
        return card(row);
      });
    },
    async load(staff, cardId) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal);
        return immutable({ card: card(row), principal });
      });
    },
    async authorizeEdit(staff, cardId) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal, 'edit');
        return immutable({ card: card(row), principal });
      });
    },
    async findAction(staff, cardId, input) {
      uuid(cardId); const { input: command, requestHash } = inputCommand(input);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal, command.action.type === 'APPROVE_REPORT' ? 'approve' : 'edit');
        const found = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.action WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, command.actionId))[0];
        return replay(found, principal, requestHash);
      });
    },
    async status(staff, cardId, actionId) {
      uuid(cardId); uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal);
        const found = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.action WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, actionId))[0];
        requireThat(!found || found.actor_id === principal.id, 404, 'MANUAL_ACTION_NOT_FOUND');
        return found ? { state: 'COMMITTED', requestHash: found.request_hash, result: JSON.parse(found.result) }
          : { state: 'NOT_FOUND' };
      });
    },
    async readApproval(staff, cardId, actionId) {
      uuid(cardId); uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal);
        const found = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, actionId))[0];
        requireThat(found, 404, 'MANUAL_APPROVAL_NOT_FOUND');
        return approvalSnapshot(found);
      });
    },
    async latestApproval(staff, cardId) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await loadRow(tx, cardId); access(row, principal);
        const found = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid ORDER BY source_revision DESC LIMIT 1', cardId))[0];
        return approvalSnapshot(found);
      });
    },
    async commit(staff, { cardId, input, baseHash, draft, approval = null, commitGuard = null }) {
      uuid(cardId); const { input: command, requestHash } = inputCommand(input);
      const document = stateDocument(draft), request = canonical(command, { maxBytes: 65536, publicAction: true });
      const report = approval === null ? null : stateDocument(approval);
      requireThat((report !== null) === (command.action.type === 'APPROVE_REPORT'), 400, 'MANUAL_APPROVAL_INVALID');
      return boundary.transaction(staff, async ({ tx, principal, now, refresh }) => {
        const row = await loadRow(tx, cardId, true);
        ({ principal, now } = await refresh());
        access(row, principal, report ? 'approve' : 'edit');
        const found = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.action WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, command.actionId))[0];
        const previous = replay(found, principal, requestHash); if (previous) return previous;
        requireThat(row.revision === command.expectedRevision && row.content_hash === baseHash, 409, 'MANUAL_DRAFT_STALE');
        if (validateSource) await validateSource({ tx, principal, cardId, draft: document.draft });
        if (validateCommit) await validateCommit({ tx, principal, cardId, input: command, commitGuard });
        const nextRevision = revision(row.revision + 1);
        const receipt = { actionId: command.actionId, actorId: principal.id, actorKind: 'HUMAN',
          expectedRevision: row.revision, revision: nextRevision, requestHash, recordedAt: now.toISOString(),
          ...(report ? { approval: { sourceRevision: row.revision, sourceHash: row.content_hash, reportHash: report.hash } } : {}) };
        const result = { card: { cardId, revision: nextRevision, contentHash: document.hash, draft: document.draft }, receipt };
        const resultText = canonical(result, { maxBytes: 524288 });
        const count = await tx.$executeRawUnsafe(`UPDATE atlas_manual.card SET revision=$1,content=$2,content_hash=$3,updated_at=clock_timestamp()
          WHERE id=$4::uuid AND revision=$5 AND content_hash=$6`, nextRevision, document.text, document.hash, cardId, row.revision, row.content_hash);
        requireThat(count === 1, 409, 'MANUAL_DRAFT_STALE');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`, cardId, command.actionId, principal.id, row.revision, nextRevision, requestHash, request, resultText);
        if (report) await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7)`, cardId, command.actionId, principal.id, row.revision, row.content_hash, report.hash, report.text);
        // Compact durable publication intent only. Object storage and media
        // verification run after this transaction, never under the card lock.
        if (report && approvalCommitted) await approvalCommitted({ tx, principal, cardId, actionId: command.actionId });
        if (report) access(row, (await refresh()).principal, 'approve');
        return result;
      });
    },
  });
}
