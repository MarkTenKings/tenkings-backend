import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';
import { cardOwnershipInput, projectOwnershipResult } from './card-ownership-contract.mjs';

export const OWNERSHIP_EVIDENCE_LIMITS = Object.freeze({ maxBytes: 65536, formats: Object.freeze(['image/png', 'image/jpeg']) });
export const OWNERSHIP_EVIDENCE_DEFAULTS = Object.freeze({ enabled: false, acceptedClaimKinds: Object.freeze([]), acceptedReviewKinds: Object.freeze([]),
  policyReference: null, retentionReference: null, retentionSeconds: null, namedReviewers: Object.freeze([]) });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/, KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const sha = b => createHash('sha256').update(b).digest('hex');
const bindingOf = config => Object.fromEntries(KEYS.map(k => [k, config?.[k]]));
const need = ok => requireThat(ok, 400, 'INVALID_OWNERSHIP_EVIDENCE');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_EVIDENCE_RESPONSE_INVALID');
function fields(v, names) {
  need(v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === names.length
    && names.every(k => Object.hasOwn(v, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value')));
}
export function ownershipEvidenceInput(action, input) {
  if (action === 'read_evidence') {
    fields(input, ['claimId', 'evidenceId']); need(UUID.test(input.claimId) && UUID.test(input.evidenceId));
    return { claimId: input.claimId, evidenceId: input.evidenceId };
  }
  need(['submit_claim', 'review_claim'].includes(action));
  const names = action === 'submit_claim' ? ['requestId', 'cardId', 'expectedOwnershipRevision', 'proofKind']
    : ['requestId', 'cardId', 'claimId', 'expectedOwnershipRevision', 'decision', 'proofKind'];
  fields(input, names); need(typeof input.proofKind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(input.proofKind));
  const { proofKind, ...base } = input;
  const checked = cardOwnershipInput(action, { ...base, evidence: { referenceId: '00000000-0000-4000-8000-000000000000', sha256: '0'.repeat(64) } });
  delete checked.evidence; return { ...checked, proofKind };
}
/** Signatures bound supported opaque attachment types only. They do not prove
 * complete image decoding, provenance, authenticity or legal sufficiency. */
export function ownershipEvidenceBytes(value) {
  need(value instanceof Uint8Array && value.buffer instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= OWNERSHIP_EVIDENCE_LIMITS.maxBytes);
  const bytes = Buffer.from(value), png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  const jpeg = bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) && bytes.subarray(-2).equals(Buffer.from('ffd9', 'hex'));
  need(png || jpeg); return { bytes, sha256: sha(bytes), mediaType: png ? 'image/png' : 'image/jpeg' };
}
async function assertGatewayRole(tx, audience) {
  const rows = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR has_database_privilege(current_user,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S'
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  const role = ok => requireThat(ok, 503, 'OWNERSHIP_EVIDENCE_DATABASE_ROLE_INVALID');
  role(rows.length === 1 && rows[0].unsafe === false);
  const routines = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
    p.prosecdef AS definer,p.proconfig AS config,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND (p.prorettype<>'trigger'::regtype OR n.nspname='atlas_ownership_evidence') AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  const expected = audience === 'CUSTOMER' ? 'customer_gateway(text, text, jsonb, text, jsonb, bytea)' : 'reviewer_gateway(text, text, jsonb, text[], text, jsonb, bytea)';
  role(routines.length === 1 && routines[0].schema === 'atlas_ownership_evidence' && routines[0].name === expected
    && routines[0].definer === true && routines[0].owned === false && JSON.stringify(routines[0].config) === '["search_path=pg_catalog"]');
  const guards = await tx.$queryRawUnsafe(`SELECT t.tgenabled,t.tgtype,p.prosecdef,p.proconfig,n.nspname,p.proname,
    p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='atlas_ownership' AND c.relname='event')
    AND t.tgname='evidence_gateway' AND NOT t.tgisinternal`);
  role(guards.length === 1 && guards[0].tgenabled === 'O' && guards[0].tgtype === 7 && guards[0].prosecdef === true
    && guards[0].nspname === 'atlas_ownership_evidence' && guards[0].proname === 'enforce_event'
    && guards[0].owned === false && JSON.stringify(guards[0].proconfig) === '["search_path=pg_catalog"]');
}
/** Proposal text only, never executed by this module. Use fresh restricted
 * roles. The DB trigger additionally rejects direct old-mutator claim inserts. */
export function cardOwnershipEvidenceGrantSQL(role, audience) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role) && role !== 'public' && !role.startsWith('pg_')
    && ['CUSTOMER', 'REVIEWER'].includes(audience), 500, 'OWNERSHIP_EVIDENCE_ROLE_INVALID');
  const signature = audience === 'CUSTOMER' ? 'customer_gateway(text,text,jsonb,text,jsonb,bytea)' : 'reviewer_gateway(text,text,jsonb,text[],text,jsonb,bytea)';
  return `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership FROM "${role}";\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_evidence FROM "${role}";\nGRANT USAGE ON SCHEMA atlas_ownership_evidence TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_ownership_evidence.${signature} TO "${role}";`;
}
function unbox(rows) {
  response(rows.length === 1 && rows[0]?.result && typeof rows[0].result === 'object'); const value = rows[0].result;
  if (value.error) { const { status, code } = value.error; response(Number.isInteger(status) && status >= 400 && status <= 599 && /^[A-Z][A-Z0-9_]{2,90}$/.test(code)); requireThat(false, status, code); }
  return value;
}
function project(action, value, request) {
  if (action === 'read_evidence') {
    response(value.evidenceId === request.evidenceId && HASH.test(value.sha256) && Number.isSafeInteger(value.byteCount)
      && value.byteCount > 0 && value.byteCount <= OWNERSHIP_EVIDENCE_LIMITS.maxBytes && typeof value.bodyBase64 === 'string'
      && value.bodyBase64.length <= 87384);
    const bytes = Buffer.from(value.bodyBase64, 'base64');
    response(bytes.length === value.byteCount && bytes.toString('base64') === value.bodyBase64 && sha(bytes) === value.sha256);
    ownershipEvidenceBytes(bytes);
    return { bytes, headers: Object.freeze({ 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="ownership-evidence-${request.evidenceId}.bin"`,
      'content-length': String(bytes.length), 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'content-security-policy': "sandbox; default-src 'none'" }) };
  }
  response(UUID.test(value.evidence?.referenceId) && HASH.test(value.evidence?.sha256));
  const receipt = projectOwnershipResult(action, value);
  response(receipt.requestId === request.requestId && receipt.kind === (action === 'submit_claim' ? 'CLAIM_SUBMITTED' : request.decision === 'VERIFY' ? 'CLAIM_VERIFIED' : 'CLAIM_REJECTED'));
  return { ...receipt, evidence: { referenceId: value.evidence.referenceId, sha256: value.evidence.sha256 } };
}
/** Server-only, unregistered. Inject existing CustomerAuth or DurableStaffAuth
 * and a NEW dedicated restricted client. Auth objects never come from requests.
 * Every DB gateway independently validates live sessions and deployment binding.
 */
export function createCardOwnershipEvidenceService({ auth, client, audience }) {
  const valid = ok => requireThat(ok, 500, 'OWNERSHIP_EVIDENCE_ADAPTER_INVALID');
  valid(['CUSTOMER', 'REVIEWER'].includes(audience) && auth?.config && typeof client?.$transaction === 'function');
  valid(audience === 'CUSTOMER' ? typeof auth.authority === 'function' : typeof auth.authenticate === 'function' && auth.actors instanceof WeakMap && auth.config.phoneByHash instanceof Map);
  const binding = bindingOf(auth.config), encoded = JSON.stringify(binding);
  valid(KEYS.every(k => typeof binding[k] === 'string') && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(binding.mode)
    && /^https?:\/\/[^\s]{1,200}$/.test(binding.origin) && /^[a-z0-9.-]{1,200}$/.test(binding.deploymentId) && /^[a-f0-9]{40}$/.test(binding.releaseSha) && HASH.test(binding.configHash));
  const phones = audience === 'REVIEWER' ? [...auth.config.phoneByHash.keys()].sort() : null;
  if (phones) valid(phones.length > 0 && phones.every(x => HASH.test(x)));
  async function call(cookie, csrf, action, input, suppliedBytes) {
    const data = ownershipEvidenceInput(action, input), writing = action !== 'read_evidence';
    const payload = writing ? ownershipEvidenceBytes(suppliedBytes).bytes : null;
    requireThat(typeof cookie === 'string' && cookie.length <= 8192, 401, 'SIGN_IN_REQUIRED');
    if (writing) requireThat(typeof csrf === 'string' && csrf.length > 0, 403, 'CSRF_REQUIRED');
    valid(JSON.stringify(bindingOf(auth.config)) === encoded && (!phones || JSON.stringify([...auth.config.phoneByHash.keys()].sort()) === JSON.stringify(phones)));
    const handle = audience === 'CUSTOMER' ? auth.authority(cookie, writing ? csrf : undefined)
      : auth.actors.get(await auth.authenticate(cookie, writing ? csrf : undefined));
    requireThat(handle && HASH.test(handle.sessionHash) && HASH.test(handle.browserHash), 401, 'SIGN_IN_REQUIRED');
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'"); await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      await assertGatewayRole(tx, audience);
      const args = [handle.sessionHash, handle.browserHash, encoded, ...(phones ? [phones] : []), action, JSON.stringify(data), payload];
      const query = audience === 'CUSTOMER' ? 'SELECT atlas_ownership_evidence.customer_gateway($1,$2,$3::jsonb,$4,$5::jsonb,$6::bytea) AS result'
        : 'SELECT atlas_ownership_evidence.reviewer_gateway($1,$2,$3::jsonb,$4::text[],$5,$6::jsonb,$7::bytea) AS result';
      return project(action, unbox(await tx.$queryRawUnsafe(query, ...args)), data);
    }, { maxWait: 3000, timeout: 8000 });
  }
  return Object.freeze(audience === 'CUSTOMER' ? { submit: (cookie, csrf, input, bytes) => call(cookie, csrf, 'submit_claim', input, bytes),
    read: (cookie, input) => call(cookie, undefined, 'read_evidence', input) }
    : { review: (cookie, csrf, input, bytes) => call(cookie, csrf, 'review_claim', input, bytes), read: (cookie, input) => call(cookie, undefined, 'read_evidence', input) });
}
