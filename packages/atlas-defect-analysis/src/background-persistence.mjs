import { check, object, string, integer, uuid, sha, digest, canonical, clone, reference } from './contract.mjs';

const VERSION = 'atlas-astra-defect-analysis-v2';
const responseId = value => check(typeof value === 'string' && /^resp_[A-Za-z0-9_-]{1,180}$/.test(value));
const date = value => { string(value, 80); check(Number.isFinite(Date.parse(value))); return value; };
export function acceptanceEvidence(value) {
  object(value, ['responseId', 'providerRequestId', 'httpStatus', 'providerStatus', 'model', 'responseHash', 'receivedAt', 'pollUntil']);
  responseId(value.responseId); sha(value.responseHash); integer(value.httpStatus, 200, 299);
  check(['queued', 'in_progress', 'completed', 'failed', 'incomplete', 'cancelled'].includes(value.providerStatus));
  check(value.model === 'gpt-6-astra');
  check(value.providerRequestId === null || typeof value.providerRequestId === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value.providerRequestId));
  date(value.receivedAt); date(value.pollUntil);
  check(Date.parse(value.pollUntil) > Date.parse(value.receivedAt) && Date.parse(value.pollUntil) <= Date.parse(value.receivedAt) + 1800000);
  return clone(value);
}
export function parseAcceptance(row, run) {
  if (!row) return null;
  check(row.kind === 'ACCEPTED' && row.analysis_id === run.analysisId && row.request_hash === run.requestHash
    && row.provider_binding_hash === run.requestEvidence.providerBindingHash && run.requestEvidence.version === VERSION
    && digest(row.evidence) === row.evidence_hash, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
  const evidence = acceptanceEvidence(JSON.parse(row.evidence));
  check(evidence.responseId === row.response_id, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
  return evidence;
}
/** This capability only records provider custody and reads already accepted
 * response IDs. It has no prepare/claim/POST or human card-editing operation. */
export function createBackgroundPersistence({ receiptClient, parseRun }) {
  const query = (...args) => receiptClient.$queryRawUnsafe(...args);
  async function append(...args) {
    for (let i = 0; i < 3; i++) {
      try { return await query(...args); } catch (error) { if (i === 2) throw error; }
    }
  }
  const read = async ({ analysisId = null, providerBindingHash, limit, now, cursor = null }) => {
    sha(providerBindingHash); if (analysisId) uuid(analysisId);
    integer(limit, 1, 11); check(now instanceof Date && Number.isFinite(now.getTime()));
    if (cursor) { object(cursor, ['recordedAt', 'analysisId']); date(cursor.recordedAt); uuid(cursor.analysisId); }
    const [row] = await query('SELECT atlas_defect_analysis.read_background($1,$2::uuid,$3::timestamptz,$4::uuid,$5::integer,$6::timestamptz) AS items',
      providerBindingHash, analysisId, cursor?.recordedAt ?? null, cursor?.analysisId ?? null, limit, now.toISOString());
    check(Array.isArray(row?.items), 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
    return row.items.map(value => {
      const run = parseRun(value.run), acceptance = parseAcceptance(value.acceptance, run);
      check(value.acceptance.provider_binding_hash === providerBindingHash);
      return { run, acceptance, cursor: { recordedAt: String(value.acceptance.recorded_at), analysisId: run.analysisId } };
    });
  };
  return Object.freeze({
    async appendAcceptance({ analysisId, requestHash, providerBindingHash, evidence }) {
      uuid(analysisId); sha(requestHash); sha(providerBindingHash); acceptanceEvidence(evidence);
      return append('SELECT atlas_defect_analysis.append_provider_event($1::uuid,$2,$3,$4,$5)',
        analysisId, requestHash, providerBindingHash, 'ACCEPTED', canonical(evidence, 16384));
    },
    async appendAcceptanceArtifact({ analysisId, requestHash, responseId: id, responseRef, responseHash }) {
      uuid(analysisId); sha(requestHash); responseId(id); sha(responseHash); reference(responseRef);
      return append('SELECT atlas_defect_analysis.append_provider_event($1::uuid,$2,$3,$4,$5)',
        analysisId, requestHash, null, 'ACK_ARTIFACT', canonical({ responseId: id, responseRef, responseHash }, 16384));
    },
    async findAccepted({ analysisId, providerBindingHash }) {
      uuid(analysisId);
      const [found] = await read({ analysisId, providerBindingHash, limit: 1, now: new Date() });
      return found ? clone({ run: found.run, acceptance: found.acceptance }) : null;
    },
    async listAcceptedPending({ providerBindingHash, limit = 5, now = new Date(), cursor = null }) {
      integer(limit, 1, 10);
      const found = await read({ providerBindingHash, limit: limit + 1, now, cursor });
      const selected = found.slice(0, limit);
      return clone({ items: selected.map(({ run, acceptance }) => ({ run, acceptance })),
        nextCursor: found.length > limit ? selected.at(-1).cursor : null });
    },
  });
}
