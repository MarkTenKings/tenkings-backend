import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { projectAtlasSportsAttributes } from '@atlas/grading-core/identity';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';
import { archiveApprovedMedia } from './approved-card-media.mjs';
import { cardProvenanceInput, provenanceId, provenanceInstant, provenanceEventId, PROVENANCE_CUSTODY_KINDS, unknownOwnership } from './card-provenance-contract.mjs';

const check = value => requireThat(value, 503, 'CARD_PROVENANCE_RESPONSE_INVALID');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const grade = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10;
const words = value => typeof value === 'string' && value.length <= 200 ? value : null;
const physical = kind => PROVENANCE_CUSTODY_KINDS.includes(kind) && !['DEPOSIT_DECLARED', 'DELAY_REPORTED', 'DELAY_RESOLVED'].includes(kind);
const unavailable = () => ({ state: 'UNAVAILABLE' });
const person = value => value && provenanceId(value.id) ? { id: value.id, name: words(value.name) } : null;
const categoryKeys = ['centering', 'corners', 'edges', 'surface'];

function approvedSnapshot(row) {
  if (row.approvedSnapshot == null) return null; // Older read models remain readable.
  check(typeof row.approvedSnapshot === 'string' && Buffer.byteLength(row.approvedSnapshot) <= 2 * 1024 * 1024
    && digest(row.approvedSnapshot) === row.report.reportHash);
  let value; try { value = JSON.parse(row.approvedSnapshot); } catch { check(false); }
  check(value && canonical(value.identity) === canonical(row.identity) && value.finalGrade === row.finalGrade);
  return value;
}

function approvedSummary(value) {
  const subgrades = value?.grade?.subgrades;
  if (!subgrades || !categoryKeys.every(key => typeof subgrades[key] === 'number' && Number.isFinite(subgrades[key]) && subgrades[key] >= 0 && subgrades[key] <= 10)
    || typeof value.ruleVersion !== 'string' || !value.ruleVersion.length || value.ruleVersion.length > 180
    || !['atlas-final-whole-point-v1', 'atlas-final-half-point-v1', 'atlas-historical-tenth-v1'].includes(value.finalGradePolicy)) return unavailable();
  return { state: 'AVAILABLE', ruleVersion: value.ruleVersion, finalGradePolicy: value.finalGradePolicy,
    subgrades: Object.fromEntries(categoryKeys.map(key => [key, subgrades[key]])) };
}

function savedComparables(row, report, snapshot) {
  const saved = row.presentationEvidence;
  if (report.state !== 'PUBLISHED' || !saved) return unavailable();
  // This is an existing selected-report presentation, never a search candidate
  // or mutable grading draft. Its optional failure cannot suppress the grade.
  try {
    check(saved.card_id === row.cardId && saved.approval_action_id === row.approvalActionId && positive(saved.revision)
      && provenanceInstant(saved.createdAt) && saved.createdAt <= snapshot
      && typeof saved.presentation === 'string' && Buffer.byteLength(saved.presentation) <= 2 * 1024 * 1024
      && digest(saved.presentation) === saved.presentation_hash
      && typeof saved.market_source === 'string' && Buffer.byteLength(saved.market_source) <= 32768
      && digest(saved.market_source) === saved.market_source_hash);
    const value = parseReportPresentation(JSON.parse(saved.presentation), { publicToken: report.publicToken, approvalVersion: report.version, publicHash: report.publicHash });
    const sources = JSON.parse(saved.market_source), source = sources.version === 'atlas-market-sources-v2' ? sources.soldReferences : sources;
    check(value.revision === saved.revision && Date.parse(value.updatedAt) <= Date.parse(snapshot)
      && value.market && Date.parse(value.market.observedAt) <= Date.parse(snapshot) && value.market.sales.length > 0 && value.market.sales.length <= 600
      && source?.version === 'atlas-selected-market-source-v1' && provenanceId(source.previewId) && hash(source.sourceHash)
      && source.ref?.cardId === row.cardId && source.ref.kind === 'MARKET_PREVIEW' && hash(source.ref.sha256)
      && Array.isArray(source.selectedIds) && source.selectedIds.length === value.market.sales.length
      && new Set(source.selectedIds).size === source.selectedIds.length
      && value.market.sales.every(sale => source.selectedIds.includes(sale.id)));
    const fields = ['id', 'title', 'listingUrl', 'grader', 'grade', 'soldAt', 'priceMinor', 'currency', 'priceBasis', 'raw', 'rawCondition',
      'designation', 'language', 'printing', 'variant', 'identityStatus', 'evidenceKind', 'matchReason', 'reportedPrice', 'imageUrl'];
    return { state: 'SAVED', selection: 'SAVED_REPORT_SELECTION', source: 'EBAY_SOLD_LISTINGS', observedAt: value.market.observedAt,
      presentationRevision: value.revision, sales: value.market.sales.map(sale => Object.fromEntries(fields.filter(key => Object.hasOwn(sale, key)).map(key => [key, sale[key]]))) };
  } catch { return unavailable(); }
}

function submission(value) {
  if (!value || !provenanceId(value.orderId) || !provenanceId(value.cardId) || !['MAIL_IN', 'KIOSK'].includes(value.channel)) return null;
  return { orderId: value.orderId, cardId: value.cardId, reference: words(value.reference), channel: value.channel,
    customer: { name: words(value.customer?.name) }, dealer: value.dealer && provenanceId(value.dealer.id) && provenanceId(value.dealer.locationId)
      ? { id: value.dealer.id, locationId: value.dealer.locationId, name: words(value.dealer.name) } : null };
}

export function cardProvenanceGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role), 500, 'CARD_PROVENANCE_ROLE_INVALID');
  return `GRANT EXECUTE ON FUNCTION atlas_manual.card_provenance(text,text,jsonb,text[],jsonb) TO "${role}";`;
}
export async function validateCardProvenanceConfiguration({ client }) {
  const signature = 'atlas_manual.card_provenance(text,text,jsonb,text[],jsonb)';
  const [schema] = await client.$queryRawUnsafe('SELECT to_regprocedure($1) IS NOT NULL AS installed', signature);
  requireThat(schema?.installed === true, 503, 'CARD_PROVENANCE_SCHEMA_REQUIRED');
  const [grant] = await client.$queryRawUnsafe("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", signature);
  requireThat(grant?.allowed === true, 503, 'CARD_PROVENANCE_GRANTS_REQUIRED');
}

function projectCard(row, cardId, snapshot) {
  check(row?.cardId === cardId && provenanceId(cardId) && provenanceId(row.approvalActionId)
    && typeof row.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(row.certificateNumber)
    && provenanceInstant(row.approvedAt) && row.approvedAt <= snapshot && grade(row.finalGrade)
    && row.report && ['PENDING', 'PUBLISHED'].includes(row.report.state) && positive(row.report.version)
    && typeof row.report.publicToken === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(row.report.publicToken) && hash(row.report.reportHash));
  const saved = approvedSnapshot(row), raw = row.identity ?? {}, identity = { category: Object.hasOwn(raw, 'playerName') && !Object.hasOwn(raw, 'cardName') ? 'SPORTS'
    : Object.hasOwn(raw, 'cardName') && !Object.hasOwn(raw, 'playerName') ? 'POKEMON' : null,
  ...Object.fromEntries(['playerName', 'cardName', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber'].map(key => [key, words(raw[key])])) };
  if (saved?.identity?.sportsAttributes && identity.category === 'SPORTS') {
    try { identity.sportsAttributes = projectAtlasSportsAttributes(saved.identity.sportsAttributes); } catch { /* Historical unsupported optional facts remain unavailable. */ }
  }
  const report = { state: row.report.state, version: row.report.version, publicToken: row.report.publicToken,
    reportHash: row.report.reportHash, path: row.report.state === 'PUBLISHED' ? `/reports/${row.report.publicToken}?v=${row.report.version}` : null };
  if (report.state === 'PUBLISHED') { check(hash(row.mediaEvidence?.publicHash)); report.publicHash = row.mediaEvidence.publicHash; }
  const media = archiveApprovedMedia({ cardId, approvalActionId: row.approvalActionId, publicToken: report.publicToken,
    approvalVersion: report.version, publicationState: report.state, reportHash: report.reportHash,
    sourceRevision: row.mediaEvidence?.sourceRevision, sourceHash: row.mediaEvidence?.sourceHash, publicHash: row.mediaEvidence?.publicHash,
    labelItem: row.mediaEvidence?.labelItem ?? null,
    presentation: row.presentationEvidence && provenanceInstant(row.presentationEvidence.createdAt)
      && row.presentationEvidence.createdAt <= snapshot ? row.presentationEvidence : null });
  return { cardId, certificateNumber: row.certificateNumber, identity, finalGrade: row.finalGrade, approvalActionId: row.approvalActionId,
    approvedAt: row.approvedAt, report, media, approvedSummary: approvedSummary(saved), savedComparables: savedComparables(row, report, snapshot),
    approver: person(row.approver), reviewers: Array.isArray(row.reviewers) ? row.reviewers.slice(0, 100).map(person).filter(Boolean) : [], submission: submission(row.submission) };
}

function projectEvent(row, card, snapshot) {
  check(row && provenanceEventId(row.eventId) && provenanceInstant(row.occurredAt) && provenanceInstant(row.recordedAt)
    && row.recordedAt <= snapshot && row.source?.cardId === card.cardId);
  const common = { eventId: row.eventId, kind: row.kind, category: row.category, occurredAt: row.occurredAt, recordedAt: row.recordedAt, verification: row.verification };
  if (row.category === 'GRADING') {
    const published = row.kind === 'REPORT_PUBLISHED', source = row.source, report = row.report;
    check((published || row.kind === 'REPORT_APPROVED') && row.verification === 'VERIFIED_RECORD'
      && source.type === (published ? 'PUBLICATION' : 'APPROVAL') && provenanceId(source.approvalActionId)
      && row.eventId === `${published ? 'publication' : 'approval'}:${source.approvalActionId}`
      && hash(source.reportHash) && report && positive(report.version) && grade(report.finalGrade)
      && report.version <= card.report.version
      && provenanceInstant(report.approvedAt) && report.approvedAt <= row.recordedAt && row.occurredAt === row.recordedAt);
    if (source.approvalActionId === card.approvalActionId) check(report.version === card.report.version && report.finalGrade === card.finalGrade
      && report.approvedAt === card.approvedAt && source.reportHash === card.report.reportHash
      && (!published || card.report.state === 'PUBLISHED' && source.publicHash === card.report.publicHash));
    const projectedSource = { type: source.type, cardId: card.cardId, approvalActionId: source.approvalActionId, reportHash: source.reportHash };
    const projectedReport = { version: report.version, finalGrade: report.finalGrade, approvedAt: report.approvedAt };
    if (published) {
      check(hash(source.publicHash) && hash(source.manifestHash) && report.publicHash === source.publicHash);
      Object.assign(projectedSource, { publicHash: source.publicHash, manifestHash: source.manifestHash });
      Object.assign(projectedReport, { publicHash: source.publicHash, path: `/reports/${card.report.publicToken}?v=${report.version}` });
    } else {
      check(positive(source.sourceRevision) && hash(source.sourceHash) && report.approvedAt === row.recordedAt);
      Object.assign(projectedSource, { sourceRevision: source.sourceRevision, sourceHash: source.sourceHash });
    }
    return { ...common, source: projectedSource, report: projectedReport };
  }
  const source = row.source;
  check(row.category === 'CUSTODY' && PROVENANCE_CUSTODY_KINDS.includes(row.kind) && positive(row.sequence)
    && row.verification === (row.kind === 'DEPOSIT_DECLARED' ? 'SUBMITTER_REPORTED' : 'VERIFIED_RECORD')
    && source.type === 'CUSTODY' && provenanceId(source.eventId) && row.eventId === `custody:${source.eventId}`
    && provenanceId(source.submissionCardId) && provenanceId(source.receivedEventId) && hash(source.inputHash)
    && provenanceInstant(source.linkedAt) && source.linkedAt <= snapshot);
  return { ...common, sequence: row.sequence, source: { type: 'CUSTODY', cardId: card.cardId, submissionCardId: source.submissionCardId,
    eventId: source.eventId, inputHash: source.inputHash, receivedEventId: source.receivedEventId, linkedAt: source.linkedAt } };
}

export function projectCardProvenance(result, query) {
  check(result?.schemaVersion === 1 && provenanceInstant(result.snapshot) && Array.isArray(result.events)
    && result.events.length <= query.limit && (!query.page || result.snapshot === query.page.snapshot));
  const card = projectCard(result.card, query.cardId, result.snapshot);
  const events = result.events.map(row => projectEvent(row, card, result.snapshot)), seen = new Set();
  let previous = query.page ? `${query.page.recordedAt}|${query.page.eventId}` : null;
  for (const event of events) {
    const key = `${event.recordedAt}|${event.eventId}`;
    check(!seen.has(event.eventId) && (!previous || key < previous)); seen.add(event.eventId); previous = key;
  }
  let latestRecorded = null;
  if (result.latestCustody != null) {
    const row = result.latestCustody;
    check(provenanceEventId(row.eventId) && row.eventId.startsWith('custody:') && physical(row.kind) && positive(row.sequence)
      && provenanceInstant(row.occurredAt) && provenanceInstant(row.recordedAt) && row.recordedAt <= result.snapshot);
    latestRecorded = { eventId: row.eventId, kind: row.kind, sequence: row.sequence, occurredAt: row.occurredAt, recordedAt: row.recordedAt };
  }
  let nextCursor = null;
  if (result.page != null) {
    const last = events.at(-1), page = result.page;
    check(page.v === 1 && page.cardId === card.cardId && page.snapshot === result.snapshot
      && last && page.eventId === last.eventId && page.recordedAt === last.recordedAt && events.length === query.limit);
    nextCursor = Buffer.from(JSON.stringify({ v: 1, cardId: card.cardId, snapshot: result.snapshot, recordedAt: last.recordedAt, eventId: last.eventId })).toString('base64url');
  }
  return { schemaVersion: 1, card, ownership: unknownOwnership(),
    custody: { status: latestRecorded ? 'RECORDED' : 'UNKNOWN', latestRecorded, currentPhysicalHolder: 'UNKNOWN' },
    history: { scope: 'RECORDED_ATLAS_EVENTS', complete: false, snapshot: result.snapshot, events, nextCursor },
    capabilities: { ownershipClaims: false, ownershipTransfers: false, reholder: false } };
}

/** A per-page redaction helper, not an unauthenticated reader or publication
 * consent. Only already-published grading facts survive. Private/source IDs,
 * custody, pending approvals, actors, addresses and internal cursors never do. */
export function publicCardProvenance(provenance) {
  check(provenance?.schemaVersion === 1 && provenanceId(provenance.card?.cardId)
    && typeof provenance.card.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(provenance.card.certificateNumber)
    && typeof provenance.card.report?.publicToken === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(provenance.card.report.publicToken)
    && provenanceInstant(provenance.history?.snapshot) && Array.isArray(provenance.history.events) && provenance.history.events.length <= 100);
  const events = provenance.history.events.filter(event => event.kind === 'REPORT_PUBLISHED')
    .map(event => projectEvent(event, provenance.card, provenance.history.snapshot))
    .map(event => ({ kind: 'REPORT_PUBLISHED', verification: 'VERIFIED_RECORD', approvedAt: event.report.approvedAt,
      publishedAt: event.recordedAt, reportVersion: event.report.version, finalGrade: event.report.finalGrade,
      reportPath: event.report.path, publicHash: event.report.publicHash }));
  if (!events.length) return null; // No unpublished certificate or private-page metadata.
  return { schemaVersion: 1, certificateNumber: provenance.card.certificateNumber,
    ownership: { status: 'UNKNOWN', verification: 'UNKNOWN' }, history: { scope: 'PUBLISHED_ATLAS_REPORTS', complete: false, events } };
}

export function createCardProvenanceService({ auth, boundary }) {
  const binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, auth.config[key]]));
  return Object.freeze({ async read(staff, cardId, input = {}) {
    const query = cardProvenanceInput(cardId, input), handle = auth.actors.get(staff);
    requireThat(handle, 401, 'SIGN_IN_REQUIRED');
    return boundary.transaction(staff, async ({ tx, principal }) => {
      requireThat(principal.role === 'REVIEWER', 403, 'STAFF_REQUIRED');
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_manual.card_provenance($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
        handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(query));
      if (row?.result?.error) requireThat(false, row.result.error.status, row.result.error.code);
      return projectCardProvenance(row?.result, query);
    });
  } });
}
