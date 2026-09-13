import { check, object, string, uuid, sha, digest, canonical, clone, reference, parseBinding } from './contract.mjs';

const compact = value => { const text = canonical(value, 32768);
  check(!/(?:data:|https?:|"(?:bytes|base64|pixels|bitmap|mask|rle|traceWire)"\s*:)/i.test(text), 'DEFECT_ANALYSIS_ARTIFACT_REQUIRED'); return text; };
function parseRun(row) {
  if (!row) return null;
  check(digest(row.binding) === row.binding_hash && digest(row.request_evidence) === row.evidence_hash,
    'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
  const binding = parseBinding(JSON.parse(row.binding));
  return { analysisId: row.id, cardId: row.card_id, actionId: row.action_id, actorId: row.actor_id, binding,
    baseHash: row.base_hash, bindingHash: row.binding_hash, requestHash: row.request_hash, requestRef: JSON.parse(row.request_ref),
    requestEvidence: JSON.parse(row.request_evidence), evidenceHash: row.evidence_hash, state: row.state,
    createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
    dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : null };
}
function refusal(row) {
  if (!row) return null;
  return { analysisId: row.analysis_id, actionId: row.action_id, cardId: row.card_id, actorId: row.actor_id,
    state: 'REFUSED', retired: true, dispatched: false, baseHash: row.base_hash, code: row.code,
    createdAt: new Date(row.created_at).toISOString(), receipts: [] };
}
const RETIRABLE = ['DEFECT_ANALYSIS_STALE', 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 'MANUAL_GEOMETRY_REVIEW_REQUIRED', 'MANUAL_DEFECT_PENDING'];
function verifyReply(value) {
  object(value, ['state', 'responseRef', 'resultRef', 'responseHash', 'providerRequestId', 'responseId', 'httpStatus', 'usage', 'code']);
  check(['READY', 'REFUSED', 'UNKNOWN'].includes(value.state));
  if (value.responseRef !== null) reference(value.responseRef);
  if (value.resultRef !== null) reference(value.resultRef);
  if (value.responseHash !== null) sha(value.responseHash);
  for (const k of ['providerRequestId', 'responseId', 'code']) if (value[k] !== null) string(value[k], 180);
  if (value.httpStatus !== null) check(Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599);
  if (value.usage !== null) {
    object(value.usage, ['input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'reasoning_output_tokens']);
    for (const [k, v] of Object.entries(value.usage)) check(v === null && ['cached_input_tokens', 'reasoning_output_tokens'].includes(k)
      || Number.isSafeInteger(v) && v >= 0);
    check(value.usage.total_tokens === value.usage.input_tokens + value.usage.output_tokens);
    check(value.usage.cached_input_tokens === null || value.usage.cached_input_tokens <= value.usage.input_tokens);
    check(value.usage.reasoning_output_tokens === null || value.usage.reasoning_output_tokens <= value.usage.output_tokens);
  }
  if (value.state === 'READY') check(value.resultRef && value.responseRef && value.responseHash && value.responseId
    && value.httpStatus >= 200 && value.httpStatus < 300 && value.code === null);
  else check(value.resultRef === null && value.code !== null);
  return compact(value);
}

/** Injection contract: authorize performs ordinary authenticated card ACL checks;
 * assertCurrent locks/verifies source + manual/identity/geometry/finding revisions.
 * Neither callback performs image, provider or object-store work. prepare and
 * claim use short card-scoped transactions; manual editing is never blocked by
 * the run's DISPATCHED or UNKNOWN status. Host owns explicit human adoption. */
export function createAnalysisRepository({ boundary, authorize, assertCurrent, receiptClient }) {
  check(typeof boundary?.transaction === 'function' && typeof authorize === 'function' && typeof assertCurrent === 'function'
    && typeof receiptClient?.$queryRawUnsafe === 'function');
  async function tx(staff, cardId, edit, work) {
    uuid(cardId);
    return boundary.transaction(staff, async context => {
      await authorize({ ...context, cardId, edit });
      return work(context);
    });
  }
  async function read(tx, cardId, id, lock = false) {
    return (await tx.$queryRawUnsafe(`SELECT * FROM atlas_defect_analysis.run WHERE card_id=$1::uuid AND id=$2::uuid${lock ? ' FOR UPDATE' : ''}`, cardId, id))[0] ?? null;
  }
  async function lockCard(context, cardId) {
    await context.tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId);
    const fresh = await context.refresh();
    await authorize({ ...context, ...fresh, cardId, edit: true });
    return { ...context, ...fresh };
  }
  const readRefusal = async (tx, cardId, kind, value) => refusal((await tx.$queryRawUnsafe(
    `SELECT * FROM atlas_defect_analysis.request_refusal WHERE card_id=$1::uuid AND ${kind === 'action' ? 'action_id' : 'analysis_id'}=$2::uuid`, cardId, value))[0]);
  async function refresh(context, cardId, binding) {
    await assertCurrent({ ...context, cardId, binding });
    const fresh = await context.refresh();
    await authorize({ ...context, ...fresh, cardId, edit: true });
    return { ...context, ...fresh };
  }
  const repository = {
    async prepare(staff, input) {
      object(input, ['analysisId', 'cardId', 'actionId', 'baseHash', 'binding', 'requestHash', 'requestRef', 'requestEvidence', 'expiresAt']);
      uuid(input.analysisId); uuid(input.cardId); uuid(input.actionId); sha(input.baseHash); sha(input.requestHash);
      const binding = parseBinding(input.binding), bindingText = compact(binding), requestRef = compact(reference(input.requestRef));
      const evidenceText = compact(input.requestEvidence), expiry = Date.parse(input.expiresAt);
      check(Number.isFinite(expiry) && new Date(expiry).toISOString() === input.expiresAt);
      return tx(staff, input.cardId, true, async context => {
        context = await lockCard(context, input.cardId);
        const retired = await readRefusal(context.tx, input.cardId, 'action', input.actionId);
        if (retired) {
          check(retired.actorId === context.principal.id && retired.baseHash === input.baseHash, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
          check(false, 'DEFECT_ANALYSIS_REQUEST_RETIRED', 409);
        }
        let prior = (await context.tx.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run WHERE card_id=$1::uuid AND action_id=$2::uuid', input.cardId, input.actionId))[0];
        if (!prior) {
          context = await refresh(context, input.cardId, binding);
          check(expiry > context.now.getTime() && expiry <= context.now.getTime() + 300000, 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 409);
          await context.tx.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run
            (id,card_id,action_id,actor_id,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at,base_hash)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,'PREPARED',$11::timestamptz,$12)
            ON CONFLICT(card_id,action_id) DO NOTHING`, input.analysisId, input.cardId, input.actionId, context.principal.id,
          bindingText, digest(bindingText), input.requestHash, requestRef, evidenceText, digest(evidenceText), input.expiresAt, input.baseHash);
          prior = (await context.tx.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run WHERE card_id=$1::uuid AND action_id=$2::uuid', input.cardId, input.actionId))[0];
        }
        check(prior && prior.id === input.analysisId && prior.actor_id === context.principal.id && prior.binding === bindingText
          && prior.base_hash === input.baseHash
          && prior.request_hash === input.requestHash && prior.request_ref === requestRef && prior.request_evidence === evidenceText
          && new Date(prior.expires_at).getTime() === expiry, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
        return clone(parseRun(prior));
      });
    },
    async claim(staff, { cardId, analysisId, requestHash }) {
      uuid(analysisId); sha(requestHash);
      return tx(staff, cardId, true, async context => {
        context = await lockCard(context, cardId);
        const retired = await readRefusal(context.tx, cardId, 'analysis', analysisId);
        if (retired) {
          check(retired.actorId === context.principal.id, 'DEFECT_ANALYSIS_NOT_FOUND', 404);
          return clone({ claimed: false, run: retired });
        }
        let row = await read(context.tx, cardId, analysisId, true);
        check(row && row.actor_id === context.principal.id && row.request_hash === requestHash, 'DEFECT_ANALYSIS_NOT_FOUND', 404);
        if (row.state !== 'PREPARED') return clone({ claimed: false, run: parseRun(row) });
        context = await refresh(context, cardId, parseRun(row).binding);
        check(new Date(row.expires_at).getTime() > context.now.getTime(), 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 409);
        const count = await context.tx.$executeRawUnsafe(`UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp()
          WHERE id=$1::uuid AND state='PREPARED' AND expires_at>clock_timestamp()`, analysisId);
        row = await read(context.tx, cardId, analysisId);
        return clone({ claimed: count === 1, run: parseRun(row) });
      });
    },
    async find(staff, { cardId, analysisId = null, actionId = null }) {
      check((analysisId === null) !== (actionId === null)); if (analysisId) uuid(analysisId); else uuid(actionId);
      return tx(staff, cardId, false, async ({ tx }) => clone(await readRefusal(tx, cardId, analysisId ? 'analysis' : 'action', analysisId ?? actionId)
        ?? (analysisId ? parseRun(await read(tx, cardId, analysisId))
          : parseRun((await tx.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, actionId))[0]))));
    },
    async status(staff, { cardId, analysisId }) {
      uuid(analysisId);
      return tx(staff, cardId, false, async ({ tx }) => {
        const retired = await readRefusal(tx, cardId, 'analysis', analysisId); if (retired) return clone(retired);
        const run = parseRun(await read(tx, cardId, analysisId)); if (!run) return null;
        const rows = await tx.$queryRawUnsafe('SELECT kind,evidence,recorded_at FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid ORDER BY kind', analysisId);
        const receipts = rows.map(row => { const evidence = JSON.parse(row.evidence); verifyReply(evidence);
          return { kind: row.kind, evidence, recordedAt: new Date(row.recorded_at).toISOString() }; });
        const selected = receipts.find(x => x.kind === 'RESPONSE') ?? receipts.find(x => x.kind === 'OUTCOME');
        const expired = Date.parse(run.expiresAt) <= Date.now();
        return clone({ ...run, state: selected?.evidence.state ?? (expired && run.state === 'DISPATCHED' ? 'UNKNOWN' : run.state), receipts });
      });
    },
    async latest(staff, { cardId }) {
      const found = await tx(staff, cardId, false, async ({ tx }) => (await tx.$queryRawUnsafe(
        `SELECT id FROM (SELECT id,created_at FROM atlas_defect_analysis.run WHERE card_id=$1::uuid
          UNION ALL SELECT analysis_id AS id,created_at FROM atlas_defect_analysis.request_refusal WHERE card_id=$1::uuid) AS actions
          ORDER BY created_at DESC,id DESC LIMIT 1`, cardId))[0] ?? null);
      return found ? repository.status(staff, { cardId, analysisId: found.id }) : null;
    },
    async retireUndispatched(staff, { cardId, actionId, baseHash, code }) {
      uuid(actionId); sha(baseHash); check(RETIRABLE.includes(code));
      return tx(staff, cardId, true, async context => {
        context = await lockCard(context, cardId);
        const prior = await readRefusal(context.tx, cardId, 'action', actionId);
        if (prior) {
          check(prior.actorId === context.principal.id && prior.baseHash === baseHash && prior.code === code, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
          return clone(prior);
        }
        const row = (await context.tx.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run WHERE card_id=$1::uuid AND action_id=$2::uuid FOR UPDATE', cardId, actionId))[0];
        if (row) {
          check(row.actor_id === context.principal.id && row.base_hash === baseHash, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
          if (row.state === 'DISPATCHED') return clone(parseRun(row));
        }
        const analysisId = row?.id ?? actionId;
        await context.tx.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.request_refusal
          (card_id,action_id,analysis_id,actor_id,base_hash,code) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`,
        cardId, actionId, analysisId, context.principal.id, baseHash, code);
        return clone(await readRefusal(context.tx, cardId, 'action', actionId));
      });
    },
    async recordReply({ analysisId, requestHash, kind, evidence }) {
      uuid(analysisId); sha(requestHash); check(['OUTCOME', 'RESPONSE'].includes(kind));
      const text = verifyReply(evidence);
      check(kind === 'RESPONSE' ? evidence.responseRef !== null && evidence.responseHash !== null : evidence.state === 'UNKNOWN');
      // Receipt-only retries never redispatch. The database verifies an existing
      // exact DISPATCHED request even after the initiating session expires.
      for (let i = 0; i < 3; i++) {
        try { return await receiptClient.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4)', analysisId, requestHash, kind, text); }
        catch (error) { if (i === 2) throw error; }
      }
    },
  };
  return Object.freeze(repository);
}

export function analysisGrantSQL(role) {
  check(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_defect_analysis TO "${role}";
GRANT SELECT,INSERT ON atlas_defect_analysis.run TO "${role}";
GRANT UPDATE (state,dispatched_at) ON atlas_defect_analysis.run TO "${role}";
GRANT SELECT ON atlas_defect_analysis.receipt TO "${role}";
GRANT SELECT,INSERT ON atlas_defect_analysis.request_refusal TO "${role}";`;
}
export function analysisReceiptGrantSQL(role) {
  check(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_defect_analysis TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_defect_analysis.append_receipt(uuid,text,text,text) TO "${role}";`;
}
