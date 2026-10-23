// Explicit, private-curation-only capability. Construction performs no I/O and
// confers no approval, publication, presentation, search or worker authority.
import { requireThat, uuid } from '@atlas/manual-service/contract';
import { createManualFinishing } from './finishing.mjs';

const capabilities = new WeakMap();
const refuse = ok => requireThat(ok, 500, 'COMP_ARCHIVE_CONFIGURATION_INVALID');
function cardAccess(card, principal, expectedActor, expectedMode) {
  requireThat(principal?.id === expectedActor, 401, 'SIGN_IN_REQUIRED');
  requireThat(principal.mode === expectedMode, 409, 'COMP_APPROVAL_STALE');
  requireThat(principal.role === 'REVIEWER' && principal.actorKind !== 'MACHINE', 403, 'MANUAL_CARD_ACCESS_DENIED');
  requireThat(card && (card.owner_id === principal.id || ['approvers', 'editors', 'readers'].some(key => card[key]?.includes(principal.id))),
    404, 'MANUAL_CARD_NOT_FOUND');
}
export function assertCompCurationArchiveCapability(capability, dependencies) {
  const owned = capabilities.get(capability);
  refuse(owned && ['boundary', 'artifacts', 'validateAccess'].every(key => owned[key] === dependencies[key]));
}
export function createCompCurationArchiveCapability({ boundary, artifacts, validateAccess }) {
  const transaction = boundary?.transaction, read = artifacts?.read;
  refuse(typeof transaction === 'function' && typeof read === 'function' && typeof validateAccess === 'function');
  const current = () => refuse(boundary.transaction === transaction && artifacts.read === read);
  async function authorize(context, card, expectedActor) {
    current(); const refresh = context?.refresh;
    refuse(typeof refresh === 'function' && typeof context.tx?.$queryRawUnsafe === 'function');
    const expectedMode = context.principal.mode;
    let actor = await refresh(); current(); cardAccess(card, actor.principal, expectedActor, expectedMode);
    await validateAccess({ tx: context.tx, principal: actor.principal, cardId: card.id });
    // Match the archive's card-id OR intake identity discard rule, including a
    // missing intake row. The existing hook keeps its normal lock ordering.
    const [active] = await context.tx.$queryRawUnsafe(`/* curation-archive:active */ SELECT i.id FROM atlas_manual_intake.card i
      WHERE i.id=$1::uuid AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d
        WHERE d.card_id=i.id OR (d.owner_id=i.owner_id AND d.create_request_id=i.create_request_id)) FOR SHARE OF i`, card.id);
    requireThat(active?.id === card.id, 410, 'INTAKE_CARD_DELETED');
    actor = await refresh(); current(); refuse(context.refresh === refresh); cardAccess(card, actor.principal, expectedActor, expectedMode);
    return actor;
  }
  const repository = Object.freeze({ async load(staff, cardId, approvalActionId) {
    uuid(cardId); uuid(approvalActionId); current();
    const result = await transaction.call(boundary, staff, async context => {
      const expectedActor = context.principal.id;
      const [card] = await context.tx.$queryRawUnsafe('/* curation-archive:card */ SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE', cardId);
      const actor = await authorize(context, card, expectedActor);
      const [row] = await context.tx.$queryRawUnsafe(`/* curation-archive:publication */ SELECT p.*,i.public_token,i.report_number,
        a.actor_id,a.source_revision,a.source_hash,a.report_hash,a.report,a.approved_at,j.result
        FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity i USING(card_id)
        JOIN atlas_manual.approval a USING(card_id,action_id) JOIN atlas_manual.action j USING(card_id,action_id)
        WHERE p.card_id=$1::uuid ORDER BY p.version DESC LIMIT 1`, cardId);
      requireThat(row?.card_id === cardId && row.action_id === approvalActionId && row.state === 'PUBLISHED'
        && row.mode === actor.principal.mode, 409, 'COMP_APPROVAL_STALE');
      const final = await authorize(context, card, expectedActor);
      requireThat(row.mode === final.principal.mode, 409, 'COMP_APPROVAL_STALE');
      return row;
    });
    current(); return result;
  } });
  // Reuse immutable approval/packet/manifest checks and the post-storage reread;
  // only the private read repository differs. No publication writer is supplied.
  const finishing = createManualFinishing({ repository, artifacts: Object.freeze({ async read(...args) {
    current(); const result = await read.apply(artifacts, args); current(); return result;
  } }) });
  const capability = Object.freeze({ version: 'atlas-private-comp-archive-capability-v1', authorize, loadPacket: finishing.loadPacket });
  capabilities.set(capability, { boundary, artifacts, validateAccess });
  return capability;
}
