import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { ownershipWorkflowInput, projectOwnershipWorkflow } from '../src/card-ownership-workflow-contract.mjs';
import { createCardOwnershipWorkflowReadService, cardOwnershipWorkflowReadGrantSQL } from '../src/card-ownership-workflow-read-service.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const now = '2026-10-21T12:00:00Z', account = randomUUID();
const browser = Buffer.alloc(32, 1).toString('base64url'), session = Buffer.alloc(32, 2).toString('base64url');
const cookie = `workflow_browser=${browser}; workflow_session=${session}`;
function row(audience = 'CUSTOMER') {
  const cardId = randomUUID();
  return { claimId: randomUUID(), cardId, requestId: randomUUID(), submittedAt: now,
    card: { cardId, approvalActionId: randomUUID(), approvalReportHash: 'd'.repeat(64), certificateNumber: 'ATLAS-AABBCCDDEEFF', report: { publicToken: 'ar_' + 'A'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } },
    decision: { state: 'PENDING', decidedAt: null, ...(audience === 'REVIEWER' ? { evidenceReferenceId: null } : {}) },
    evidence: { referenceId: randomUUID(), availability: 'AVAILABLE', usableUntil: '2026-11-21T12:00:00Z', proofKind: 'FIXTURE_PROOF' },
    reviewStatus: 'PENDING', actions: { downloadEvidence: true, ...(audience === 'REVIEWER' ? { verify: true, reject: true } : {}) },
    ...(audience === 'CUSTOMER' ? { currentlyOwnedByYou: false } : { expectedOwnershipRevision: 0 }) };
}
const raw = claim => ({ actorId: account, observedAt: now, claim });
function fixture({ audience = 'CUSTOMER', answer = raw(row(audience)), unsafe = false, routines } = {}) {
  const config = { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'local-workflow-fixture', releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64),
    cookies: { browser: 'workflow_browser', session: 'workflow_session' }, sessionKey: Buffer.alloc(32, 7), phoneByHash: new Map([['c'.repeat(64), '+12025550141']]) };
  const customer = new CustomerAuth({ config, database: { call() { assert.fail('No auth DB writer'); } }, provider: {} });
  const staff = {}, actors = new WeakMap([[staff, { sessionHash: hash(session), browserHash: hash(browser) }]]);
  const auth = audience === 'CUSTOMER' ? customer : { config, actors, async authenticate(header) { customer.authority(header); return staff; } };
  const expected = { schema: 'atlas_ownership_workflow', name: audience === 'CUSTOMER' ? 'customer_read(text, text, jsonb, text, jsonb)' : 'reviewer_read(text, text, jsonb, text[], text, jsonb)', definer: true, config: ['search_path=pg_catalog'], owned: false };
  const queries = [], settings = []; let transactions = 0;
  const client = { async $transaction(work, options) { transactions++; assert.deepEqual(options, { maxWait: 3000, timeout: 8000 });
    return work({ async $executeRawUnsafe(sql) { settings.push(sql); }, async $queryRawUnsafe(sql, ...args) {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe }];
      if (sql.startsWith('SELECT n.nspname')) return routines ?? [expected];
      return [{ result: answer }];
    } });
  } };
  return { service: createCardOwnershipWorkflowReadService({ auth, client, audience }), auth, config, staff, expected, queries, settings, answer, get transactions() { return transactions; } };
}
test('closed read actions reject mutators, caller identity, alternate certificates and unbounded pages', () => {
  for (const audience of ['CUSTOMER', 'REVIEWER']) for (const action of ['submit_claim', 'review_claim', 'withdraw', 'replace', 'set_card_preferences']) assert.throws(() => ownershipWorkflowInput(audience, action, {}), { code: 'OWNERSHIP_WORKFLOW_READ_ONLY' });
  assert.throws(() => ownershipWorkflowInput('REVIEWER', 'resolve_certificate', { certificateNumber: 'ATLAS-AABBCCDDEEFF' }));
  const d = { afterClaimId: null, limit: 25 }; assert.deepEqual(ownershipWorkflowInput('CUSTOMER', 'list_claims', d), d);
  for (const value of [{ ...d, limit: 51 }, { ...d, limit: 0 }, { ...d, accountId: account }, { ...d, afterClaimId: 'cursor' }]) assert.throws(() => ownershipWorkflowInput('CUSTOMER', 'list_claims', value));
  for (const certificateNumber of ['atlas-aabbccddeeff', ' ATLAS-AABBCCDDEEFF', 'https://atlasgrading.com/reports/x']) assert.throws(() => ownershipWorkflowInput('CUSTOMER', 'resolve_certificate', { certificateNumber }));
  const bad = {}; Object.defineProperty(bad, 'claimId', { enumerable: true, get() { assert.fail('Getter executed'); } }); assert.throws(() => ownershipWorkflowInput('CUSTOMER', 'read_claim', bad));
});
test('projection strips competing owners, reviewer identities, contacts, raw evidence and injected actions', () => {
  const claim = row(); Object.assign(claim, { ownerAccountId: 'SECRET', claimantEmail: 'SECRET' });
  Object.assign(claim.decision, { staffId: 'SECRET', evidenceReferenceId: randomUUID() });
  Object.assign(claim.evidence, { objectUrl: 'SECRET', bodyBase64: 'SECRET' });
  Object.assign(claim.actions, { verify: true, withdraw: true });
  const value = projectOwnershipWorkflow('CUSTOMER', 'read_claim', raw(claim), { claimId: claim.claimId });
  assert.doesNotMatch(JSON.stringify(value), /SECRET|ownerAccountId|staffId|verify|withdraw|bodyBase64|evidenceReferenceId/);
  assert.equal(value.currentlyOwnedByYou, undefined); assert.equal(value.claim.currentlyOwnedByYou, false);
});
test('evidence expiry/policy loss blocks pending review without inventing a rejected or withdrawn decision', () => {
  for (const availability of ['EXPIRED', 'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'UNAVAILABLE']) {
    const claim = row(); claim.evidence.availability = availability; claim.reviewStatus = 'BLOCKED'; claim.actions.downloadEvidence = false;
    const value = projectOwnershipWorkflow('CUSTOMER', 'read_claim', raw(claim), { claimId: claim.claimId });
    assert.equal(value.claim.decision.state, 'PENDING'); assert.equal(value.claim.reviewStatus, 'BLOCKED');
    claim.reviewStatus = 'PENDING'; assert.throws(() => projectOwnershipWorkflow('CUSTOMER', 'read_claim', raw(claim), { claimId: claim.claimId }));
  }
});
test('historical verification and current ownership stay independent, including evidence expiry', () => {
  const claim = row(); claim.decision = { state: 'VERIFIED', decidedAt: now }; claim.reviewStatus = 'DECIDED'; claim.evidence.availability = 'EXPIRED'; claim.actions.downloadEvidence = false;
  for (const currentlyOwnedByYou of [false, true]) {
    claim.currentlyOwnedByYou = currentlyOwnedByYou;
    const value = projectOwnershipWorkflow('CUSTOMER', 'read_claim', raw(claim), { claimId: claim.claimId });
    assert.equal(value.claim.decision.state, 'VERIFIED'); assert.equal(value.claim.currentlyOwnedByYou, currentlyOwnedByYou);
  }
});
test('approval/card/request binding and ordered bounded page cursor cannot drift', () => {
  const claim = row(), request = { claimId: claim.claimId };
  for (const change of [c => c.card.cardId = randomUUID(), c => c.card.approvalReportHash = 'bad', c => c.claimId = randomUUID(), c => c.card.report.version = 0]) {
    const value = structuredClone(claim); change(value); assert.throws(() => projectOwnershipWorkflow('CUSTOMER', 'read_claim', raw(value), request));
  }
  const claims = [row(), row()].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const page = { actorId: account, observedAt: now, claims, nextClaimId: null }, query = { afterClaimId: null, limit: 2 };
  assert.equal(projectOwnershipWorkflow('CUSTOMER', 'list_claims', page, query).claims.length, 2);
  for (const patch of [{ claims: [...claims].reverse() }, { claims: [claims[0], claims[0]] }, { nextClaimId: '00000000-0000-4000-8000-000000000000' }]) assert.throws(() => projectOwnershipWorkflow('CUSTOMER', 'list_claims', { ...page, ...patch }, query));
  assert.throws(() => projectOwnershipWorkflow('CUSTOMER', 'list_claims', page, { ...query, limit: 1 }));
});
test('reviewer eligibility cannot verify a known title and recovery binds the exact recorded request', () => {
  const claim = row('REVIEWER'); claim.expectedOwnershipRevision = 2; claim.actions.verify = false;
  const projected = projectOwnershipWorkflow('REVIEWER', 'read_claim', raw(claim), { claimId: claim.claimId }); assert.equal(projected.claim.actions.reject, true); assert.equal(projected.claim.actions.verify, false);
  claim.actions.verify = true; assert.throws(() => projectOwnershipWorkflow('REVIEWER', 'read_claim', raw(claim), { claimId: claim.claimId }));
  const own = row(), receipt = { eventId: own.claimId, requestId: own.requestId, kind: 'CLAIM_SUBMITTED', evidence: { referenceId: own.evidence.referenceId, sha256: 'a'.repeat(64) } };
  assert.equal(projectOwnershipWorkflow('CUSTOMER', 'recover_request', { ...raw(own), receipt }, { requestId: own.requestId }).receipt.eventId, own.claimId);
  assert.throws(() => projectOwnershipWorkflow('CUSTOMER', 'recover_request', { ...raw(own), receipt }, { requestId: randomUUID() }));
});
test('real CustomerAuth cookie digests and frozen deployment binding are the only adapter authority', async () => {
  const f = fixture(), claimId = f.answer.claim.claimId;
  await f.service.read(cookie, 'read_claim', { claimId }); const q = f.queries.at(-1);
  assert.match(q.sql, /^SELECT atlas_ownership_workflow.customer_read/); assert.deepEqual(q.args.slice(0, 2), [hash(session), hash(browser)]);
  assert.deepEqual(JSON.parse(q.args.at(-1)), { claimId }); assert.deepEqual(Object.keys(f.service), ['read']);
  assert(f.settings.every(s => s.startsWith('SET LOCAL')));
  const g = fixture(); await assert.rejects(g.service.read({ accountId: account }, 'read_claim', { claimId }), { code: 'SIGN_IN_REQUIRED' }); assert.equal(g.transactions, 0);
  f.config.releaseSha = 'f'.repeat(40); await assert.rejects(f.service.read(cookie, 'read_claim', { claimId }), { code: 'OWNERSHIP_WORKFLOW_ADAPTER_INVALID' });
});
test('reviewer uses server WeakMap and exact fixed phone binding, never request-supplied reviewer identity', async () => {
  const f = fixture({ audience: 'REVIEWER' }), claimId = f.answer.claim.claimId;
  await f.service.read(cookie, 'read_claim', { claimId }); assert.deepEqual(f.queries.at(-1).args[3], ['c'.repeat(64)]);
  f.auth.actors.delete(f.staff); await assert.rejects(f.service.read(cookie, 'read_claim', { claimId }), { code: 'SIGN_IN_REQUIRED' });
  const g = fixture({ audience: 'REVIEWER' }); g.config.phoneByHash.set('d'.repeat(64), '+12025550142'); await assert.rejects(g.service.read(cookie, 'read_claim', { claimId }), { code: 'OWNERSHIP_WORKFLOW_ADAPTER_INVALID' });
});
test('expanded routine/table/sequence privilege or wrong routine ownership/config fails before the data call', async () => {
  const base = fixture(), claimId = base.answer.claim.claimId;
  for (const patch of [{ unsafe: true }, { routines: [] }, { routines: [base.expected, { ...base.expected, name: 'customer_gateway(text, text, jsonb, text, jsonb, bytea)' }] },
    { routines: [{ ...base.expected, owned: true }] }, { routines: [{ ...base.expected, definer: false }] }, { routines: [{ ...base.expected, config: ['search_path=public'] }] }]) {
    const f = fixture(patch); await assert.rejects(f.service.read(cookie, 'read_claim', { claimId }), { code: 'OWNERSHIP_WORKFLOW_DATABASE_ROLE_INVALID' });
    assert(!f.queries.some(q => q.sql.startsWith('SELECT atlas_ownership_workflow.customer_read')));
  }
});
test('not-found/auth/disabled outcomes cannot become empty successes; immutable source remains pinned', async () => {
  for (const [status, code] of [[401, 'SIGN_IN_REQUIRED'], [403, 'OWNERSHIP_REVIEW_REQUIRED'], [404, 'OWNERSHIP_CLAIM_NOT_FOUND'], [503, 'OWNERSHIP_WORKFLOW_UNAVAILABLE']]) {
    await assert.rejects(fixture({ answer: { error: { status, code } } }).service.read(cookie, 'read_claim', { claimId: randomUUID() }), { status, code });
  }
  for (const [path, expected] of [['../sql/card-ownership-proposal.sql', '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2'],
    ['../sql/card-ownership-evidence-proposal.sql', 'ba9171cae508f2561ed6c71d9231fdcc885c67f9980d6c771f92d275ecf1aa1d'],
    ['../src/card-ownership-evidence-service.mjs', '037e0f090a315de0daed201f3e38fd7f00e75bf1106305cc322fd39d4bc35102']]) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected);
  const grant = cardOwnershipWorkflowReadGrantSQL('atlas_fixture_workflow', 'CUSTOMER'); assert.match(grant, /GRANT EXECUTE ON FUNCTION atlas_ownership_workflow.customer_read/); assert.doesNotMatch(grant, /INSERT|UPDATE|DELETE|customer_call|gateway/);
  for (const role of ['public', 'pg_read_all_data', 'x";DROP']) assert.throws(() => cardOwnershipWorkflowReadGrantSQL(role, 'CUSTOMER'));
});
