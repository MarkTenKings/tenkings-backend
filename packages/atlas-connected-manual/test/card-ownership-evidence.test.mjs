import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { OWNERSHIP_EVIDENCE_DEFAULTS, ownershipEvidenceInput, ownershipEvidenceBytes, cardOwnershipEvidenceGrantSQL, createCardOwnershipEvidenceService } from '../src/card-ownership-evidence-service.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a7X8AAAAASUVORK5CYII=', 'base64');
const browser = Buffer.alloc(32, 1).toString('base64url'), session = Buffer.alloc(32, 2).toString('base64url');
const cookie = `evidence_browser=${browser}; evidence_session=${session}`;
const input = () => ({ requestId: randomUUID(), cardId: randomUUID(), expectedOwnershipRevision: 0, proofKind: 'FIXTURE_PROOF' });
function fixture({ audience = 'CUSTOMER', unsafe = false, routines, guards, answer, beforeQuery } = {}) {
  const config = { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'local-customer-fixture', releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64),
    cookies: { browser: 'evidence_browser', session: 'evidence_session' }, sessionKey: Buffer.alloc(32, 7), phoneByHash: new Map([['c'.repeat(64), '+12025550141']]) };
  const customer = new CustomerAuth({ config, database: { call() { assert.fail('No auth DB writer'); } }, provider: {} });
  const staff = {}, actors = new WeakMap([[staff, { sessionHash: hash(session), browserHash: hash(browser) }]]);
  const auth = audience === 'CUSTOMER' ? customer : { config, actors, async authenticate(header, csrf) { customer.authority(header, csrf); return staff; } };
  const signature = audience === 'CUSTOMER' ? 'customer_gateway(text, text, jsonb, text, jsonb, bytea)' : 'reviewer_gateway(text, text, jsonb, text[], text, jsonb, bytea)';
  const expectedRoutine = { schema: 'atlas_ownership_evidence', name: signature, definer: true, config: ['search_path=pg_catalog'], owned: false };
  const expectedGuard = { tgenabled: 'O', tgtype: 7, prosecdef: true, proconfig: ['search_path=pg_catalog'], nspname: 'atlas_ownership_evidence', proname: 'enforce_event', owned: false };
  const queries = [], settings = []; let transactions = 0;
  const client = { async $transaction(work, options) { transactions++; assert.deepEqual(options, { maxWait: 3000, timeout: 8000 });
    return work({ async $executeRawUnsafe(sql) { settings.push(sql); }, async $queryRawUnsafe(sql, ...args) {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe }];
      if (sql.startsWith('SELECT n.nspname')) return routines ?? [expectedRoutine];
      if (sql.startsWith('SELECT t.tgenabled')) return guards ?? [expectedGuard];
      await beforeQuery?.(); const data = JSON.parse(args.at(-2)), action = args.at(-3);
      return [{ result: answer ?? { eventId: randomUUID(), requestId: data.requestId, kind: action === 'submit_claim' ? 'CLAIM_SUBMITTED' : data.decision === 'VERIFY' ? 'CLAIM_VERIFIED' : 'CLAIM_REJECTED',
        evidence: { referenceId: randomUUID(), sha256: 'b'.repeat(64) }, privateOwner: 'NEVER_EXPOSE' } }];
    } });
  } };
  return { service: createCardOwnershipEvidenceService({ auth, client, audience }), auth, customer, config, queries, settings, staff, expectedRoutine, expectedGuard,
    csrf: customer.digest(`session:${session}`), get transactions() { return transactions; } };
}
test('disabled operational defaults name no accepted proof, retention, or reviewer', () => {
  assert.equal(OWNERSHIP_EVIDENCE_DEFAULTS.enabled, false); assert.deepEqual(OWNERSHIP_EVIDENCE_DEFAULTS.acceptedClaimKinds, []); assert.deepEqual(OWNERSHIP_EVIDENCE_DEFAULTS.namedReviewers, []);
  assert.equal(OWNERSHIP_EVIDENCE_DEFAULTS.retentionSeconds, null); assert(Object.isFrozen(OWNERSHIP_EVIDENCE_DEFAULTS));
});
test('closed request contract rejects caller authority, raw object URLs and arbitrary evidence references', () => {
  const d = input(); assert.deepEqual(ownershipEvidenceInput('submit_claim', d), d);
  for (const key of ['customerId', 'ownerAccountId', 'staffId', 'grantId', 'evidence', 'objectId', 'signedUrl', 'sourceSha', 'authority']) assert.throws(() => ownershipEvidenceInput('submit_claim', { ...d, [key]: 'injected' }));
  for (const proofKind of ['', 'http://proof.invalid', 'x', 'A'.repeat(41)]) assert.throws(() => ownershipEvidenceInput('submit_claim', { ...d, proofKind }));
  const bad = { ...d }; Object.defineProperty(bad, 'proofKind', { enumerable: true, get() { assert.fail('Getter executed'); } }); assert.throws(() => ownershipEvidenceInput('submit_claim', bad), { code: 'INVALID_OWNERSHIP_EVIDENCE' });
  assert.throws(() => ownershipEvidenceInput('propose_transfer', {}));
});
test('bytes are detached, bounded to64KiB and reject unsupported active/document formats', () => {
  const bytes = Buffer.from(png), saved = ownershipEvidenceBytes(bytes); bytes.fill(0); assert(saved.bytes.equals(png)); assert.equal(saved.sha256, hash(png)); assert.equal(saved.mediaType, 'image/png');
  const max = Buffer.concat([png.subarray(0, -12), Buffer.alloc(65536 - png.length), png.subarray(-12)]); assert.equal(ownershipEvidenceBytes(max).bytes.length, 65536);
  for (const bad of [Buffer.alloc(0), Buffer.alloc(65537), Buffer.from('<svg><script/></svg>'), Buffer.from('<html>private</html>'), Buffer.from('%PDF-1.7'), 'bytes', { sha256: hash(png), bytes: png }]) assert.throws(() => ownershipEvidenceBytes(bad), { code: 'INVALID_OWNERSHIP_EVIDENCE' });
});
test('real CustomerAuth binds session+browser+CSRF; caller ownership is never SQL authority', async () => {
  const f = fixture(), d = input(), result = await f.service.submit(cookie, f.csrf, d, png), q = f.queries.at(-1);
  assert.match(q.sql, /^SELECT atlas_ownership_evidence.customer_gateway/); assert.deepEqual(q.args.slice(0, 2), [hash(session), hash(browser)]);
  assert.deepEqual(JSON.parse(q.args[4]), d); assert(q.args[5].equals(png)); assert.equal(result.kind, 'CLAIM_SUBMITTED'); assert.equal(result.requestId, d.requestId); assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE|owner/i);
  assert.deepEqual(Object.keys(f.service), ['submit', 'read']); assert(Object.isFrozen(f.service));
  const g = fixture(); for (const bad of ['', 'wrong']) await assert.rejects(g.service.submit(cookie, bad, input(), png), { code: 'CSRF_REQUIRED' });
  await assert.rejects(g.service.submit({ accountId: randomUUID() }, g.csrf, input(), png), { code: 'SIGN_IN_REQUIRED' }); assert.equal(g.transactions, 0);
});
test('reviewer requires real server-held WeakMap handle and freezes exact phone/source binding', async () => {
  const f = fixture({ audience: 'REVIEWER' }), d = { ...input(), claimId: randomUUID(), decision: 'VERIFY' };
  const result = await f.service.review(cookie, f.csrf, d, png); assert.equal(result.kind, 'CLAIM_VERIFIED'); assert.deepEqual(f.queries.at(-1).args[3], ['c'.repeat(64)]);
  f.auth.actors.delete(f.staff); await assert.rejects(f.service.review(cookie, f.csrf, d, png), { code: 'SIGN_IN_REQUIRED' });
  const g = fixture({ audience: 'REVIEWER' }); g.config.phoneByHash.set('d'.repeat(64), '+12025550142'); await assert.rejects(g.service.review(cookie, g.csrf, d, png), { code: 'OWNERSHIP_EVIDENCE_ADAPTER_INVALID' });
  const h = fixture(); h.config.releaseSha = 'f'.repeat(40); await assert.rejects(h.service.submit(cookie, h.csrf, input(), png), { code: 'OWNERSHIP_EVIDENCE_ADAPTER_INVALID' });
});
test('no direct data/sequence/old-mutator authority or missing event guard is admitted', async () => {
  const base = fixture();
  const variants = [{ unsafe: true }, { routines: [] }, { routines: [base.expectedRoutine, { ...base.expectedRoutine, schema: 'atlas_ownership', name: 'customer_call(text, text, jsonb, text, jsonb)' }] },
    { routines: [{ ...base.expectedRoutine, owned: true }] }, { routines: [{ ...base.expectedRoutine, config: ['search_path=public'] }] }, { guards: [] },
    { guards: [{ ...base.expectedGuard, tgenabled: 'D' }] }, { guards: [{ ...base.expectedGuard, tgtype: 5 }] }, { guards: [{ ...base.expectedGuard, proname: 'other' }] }];
  for (const variant of variants) { const f = fixture(variant); await assert.rejects(f.service.submit(cookie, f.csrf, input(), png), { code: 'OWNERSHIP_EVIDENCE_DATABASE_ROLE_INVALID' }); assert(!f.queries.some(q => q.sql.startsWith('SELECT atlas_ownership_evidence.customer_gateway'))); }
  assert.match(base.expectedRoutine.name, /customer_gateway/);
});
test('retrieval yields exact checked opaque attachment, never inline or a signed URL', async () => {
  const d = { claimId: randomUUID(), evidenceId: randomUUID() }, answer = { evidenceId: d.evidenceId, sha256: hash(png), byteCount: png.length, bodyBase64: png.toString('base64'), url: 'NEVER_EXPOSE', owner: 'NEVER_EXPOSE' };
  const f = fixture({ answer }), result = await f.service.read(cookie, d); assert(result.bytes.equals(png));
  assert.equal(result.headers['content-type'], 'application/octet-stream'); assert.match(result.headers['content-disposition'], /^attachment;/); assert.equal(result.headers['x-content-type-options'], 'nosniff'); assert.equal(result.headers['cache-control'], 'private, no-store'); assert.match(result.headers['content-security-policy'], /sandbox/);
  assert.deepEqual(Object.keys(result), ['bytes', 'headers']); assert.equal(f.queries.at(-1).args.at(-1), null);
  for (const patch of [{ evidenceId: randomUUID() }, { sha256: '0'.repeat(64) }, { byteCount: png.length + 1 }, { bodyBase64: answer.bodyBase64 + ' ' }]) await assert.rejects(fixture({ answer: { ...answer, ...patch } }).service.read(cookie, d), { code: 'OWNERSHIP_EVIDENCE_RESPONSE_INVALID' });
});
test('disabled/revoked/notfound database outcomes cannot become success or empty evidence', async () => {
  for (const [status, code] of [[503, 'OWNERSHIP_EVIDENCE_DISABLED'], [401, 'SIGN_IN_REQUIRED'], [403, 'OWNERSHIP_REVIEW_REQUIRED'], [404, 'OWNERSHIP_EVIDENCE_NOT_FOUND']]) {
    const f = fixture({ answer: { error: { status, code } } }); await assert.rejects(f.service.submit(cookie, f.csrf, input(), png), { status, code });
  }
});
test('grants are proposal-only gateway grants and revoke old routines; original writer stays byte-identical', async () => {
  const sql = cardOwnershipEvidenceGrantSQL('atlas_fixture_evidence', 'CUSTOMER'); assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership FROM/); assert.match(sql, /GRANT EXECUTE ON FUNCTION atlas_ownership_evidence.customer_gateway/);
  assert.doesNotMatch(sql, /GRANT (SELECT|INSERT|UPDATE|DELETE)|GRANT EXECUTE ON FUNCTION atlas_ownership\./);
  for (const role of ['public', 'pg_read_all_data', 'x";DROP', 'UPPER']) assert.throws(() => cardOwnershipEvidenceGrantSQL(role, 'CUSTOMER'));
  assert.equal(hash(await readFile(new URL('../sql/card-ownership-proposal.sql', import.meta.url))), '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2');
  assert.equal(hash(await readFile(new URL('../src/card-ownership-service.mjs', import.meta.url))), '84c93ebb56ce32a29efa93ca51936e3476f44c84e9475218a9d0b2d651c971c9');
  const manifest = await readFile(new URL('../../atlas-standalone-database/migrations.manifest.json', import.meta.url), 'utf8'); assert.doesNotMatch(manifest, /ownership-evidence/);
});
