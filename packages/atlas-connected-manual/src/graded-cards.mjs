import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { archiveApprovedMedia } from './approved-card-media.mjs';
import { gradedCardsInstant as instant, gradedCardsListInput } from './graded-cards-contract.mjs';
export { gradedCardsListInput } from './graded-cards-contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function gradedCardsGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role), 500, 'GRADED_CARDS_ROLE_INVALID');
  return `GRANT EXECUTE ON FUNCTION atlas_manual.graded_cards(text,text,jsonb,text[],jsonb) TO "${role}";`;
}

export async function validateGradedCardsConfiguration({ client }) {
  const signature = 'atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)';
  const [schema] = await client.$queryRawUnsafe('SELECT to_regprocedure($1) IS NOT NULL AS installed', signature);
  requireThat(schema?.installed === true, 503, 'GRADED_CARDS_SCHEMA_REQUIRED');
  const [grants] = await client.$queryRawUnsafe("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", signature);
  requireThat(grants?.allowed === true, 503, 'GRADED_CARDS_GRANTS_REQUIRED');
}

const text = value => typeof value === 'string' && value.length <= 200 ? value : null;
const person = value => value && UUID.test(value.id ?? '') ? { id: value.id, name: text(value.name) } : null;
function projectCard(row) {
  requireThat(row && UUID.test(row.cardId ?? '') && UUID.test(row.approvalActionId ?? '')
    && typeof row.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(row.certificateNumber)
    && instant(row.approvedAt) && row.report && ['PENDING', 'PUBLISHED'].includes(row.report.state)
    && Number.isSafeInteger(row.report.version) && row.report.version > 0 && /^ar_[A-Za-z0-9_-]{24}$/.test(row.report.publicToken ?? '')
    && /^[a-f0-9]{64}$/.test(row.report.reportHash ?? '') && person(row.approver), 503, 'GRADED_CARDS_RESPONSE_INVALID');
  const identity = { category: ['SPORTS', 'POKEMON'].includes(row.identity?.category) ? row.identity.category : null,
    ...Object.fromEntries(['playerName', 'cardName', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber'].map(key => [key, text(row.identity?.[key])])) };
  const report = { state: row.report.state, version: row.report.version, publicToken: row.report.publicToken, reportHash: row.report.reportHash,
    path: row.report.state === 'PUBLISHED' ? `/reports/${row.report.publicToken}?v=${row.report.version}` : null };
  if (report.state === 'PUBLISHED') {
    requireThat(/^[a-f0-9]{64}$/.test(row.mediaEvidence?.publicHash ?? ''), 503, 'GRADED_CARDS_RESPONSE_INVALID');
    report.publicHash = row.mediaEvidence.publicHash;
  }
  const submission = row.submission && UUID.test(row.submission.orderId ?? '') && UUID.test(row.submission.cardId ?? '')
    && ['MAIL_IN', 'KIOSK'].includes(row.submission.channel) ? { orderId: row.submission.orderId, cardId: row.submission.cardId,
      reference: text(row.submission.reference), channel: row.submission.channel, customer: { name: text(row.submission.customer?.name) },
      dealer: row.submission.dealer && UUID.test(row.submission.dealer.id ?? '') && UUID.test(row.submission.dealer.locationId ?? '')
        ? { id: row.submission.dealer.id, locationId: row.submission.dealer.locationId, name: text(row.submission.dealer.name) } : null } : null;
  const media = archiveApprovedMedia({ cardId: row.cardId, approvalActionId: row.approvalActionId,
    publicToken: report.publicToken, approvalVersion: report.version, publicationState: report.state, publicHash: row.mediaEvidence?.publicHash,
    reportHash: report.reportHash, sourceRevision: row.mediaEvidence?.sourceRevision, sourceHash: row.mediaEvidence?.sourceHash,
    labelItem: row.mediaEvidence?.labelItem ?? null, presentation: row.mediaEvidence?.presentation ?? null });
  return { cardId: row.cardId, identity, finalGrade: typeof row.finalGrade === 'number' && row.finalGrade >= 1 && row.finalGrade <= 10 ? row.finalGrade : null,
    approvedAt: row.approvedAt, certificateNumber: row.certificateNumber, approvalActionId: row.approvalActionId,
    report, approver: person(row.approver), reviewers: Array.isArray(row.reviewers) ? row.reviewers.map(person).filter(Boolean) : [], submission, media };
}

/** Read-only capability: no provider, storage, card creation, publication or
 * ownership operation is reachable. SQL independently rechecks the session. */
export function createGradedCardsService({ auth, boundary }) {
  const binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, auth.config[key]]));
  return Object.freeze({ async list(staff, input = {}) {
    const query = gradedCardsListInput(input), handle = auth.actors.get(staff);
    requireThat(handle, 401, 'SIGN_IN_REQUIRED');
    return boundary.transaction(staff, async ({ tx, principal }) => {
      requireThat(principal.role === 'REVIEWER', 403, 'STAFF_REQUIRED');
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_manual.graded_cards($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
        handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(query));
      const result = row?.result;
      if (result?.error) requireThat(false, result.error.status, result.error.code);
      requireThat(result?.schemaVersion === 1 && Array.isArray(result.cards) && result.cards.length <= query.limit,
        503, 'GRADED_CARDS_RESPONSE_INVALID');
      let nextCursor = null;
      if (result.page) {
        const page = result.page, last = result.cards.at(-1);
        requireThat(instant(page.snapshot) && instant(page.approvedAt) && UUID.test(page.cardId ?? '')
          && page.approvedAt <= page.snapshot && page.cardId === last?.cardId && page.approvedAt === last?.approvedAt,
        503, 'GRADED_CARDS_RESPONSE_INVALID');
        const { q, category, from, to } = query;
        nextCursor = Buffer.from(JSON.stringify({ v: 1, filter: digest(canonical({ q, category, from, to })), ...page })).toString('base64url');
      }
      return { schemaVersion: 1, cards: result.cards.map(projectCard), nextCursor };
    });
  } });
}
