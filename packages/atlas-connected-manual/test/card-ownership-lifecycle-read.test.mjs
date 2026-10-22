import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { parseClaimConfiguration, parseClaimTarget, parseClaimLifecycle } from '../../../frontend/atlas-customer/lib/ownership-claim-submission-client.mjs';
import { ownershipLifecycleReadInput, ownershipLifecycleReaderUI, projectOwnershipLifecycleRead } from '../src/card-ownership-lifecycle-read-contract.mjs';
import { createCardOwnershipLifecycleReadService, cardOwnershipLifecycleReadGrantSQL } from '../src/card-ownership-lifecycle-read-service.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const accountId = randomUUID(), claimId = randomUUID(), cardId = randomUUID(), originalBundle = randomUUID(), replacementBundle = randomUUID();
const submittedAt = '2026-10-21T12:00:00.000Z', observedAt = '2026-10-21T13:00:00.000Z';
const card = { cardId, approvalActionId: randomUUID(), approvalReportHash: 'd'.repeat(64), certificateNumber: 'ATLAS-AABBCCDDEEFF',
  report: { publicToken: 'ar_' + 'A'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } };
const browser = Buffer.alloc(32, 1).toString('base64url'), session = Buffer.alloc(32, 2).toString('base64url');
const cookie = `reader_browser=${browser}; reader_session=${session}`;
const raw = value => ({ actorId: accountId, observedAt, ...structuredClone(value) });
const claim = (patch = {}) => ({ claimId, cardId, card: structuredClone(card), claimRevision: 1, state: 'PENDING', bundleId: originalBundle,
  blockedReasons: [], currentlyOwnedByYou: false, ...structuredClone(patch) });
const facts = (patch = {}) => ({ policiesPresent: true, live: true, policyHash: 'a'.repeat(64), acceptedClaimKinds: ['FIXTURE_PROOF'],
  acceptedFormats: ['image/jpeg', 'image/png', 'image/heic'], ...patch });
const ui = () => ({ enabled: true, policyNotice: 'Synthetic test policy notice, not an operational policy.', proofKinds: [{ code: 'FIXTURE_PROOF', label: 'Synthetic proof' }],
  proofPreparation: { policyHash: 'a'.repeat(64), formats: ['image/jpeg'], storageOrigin: 'https://proof.invalid', storagePathPrefix: '/fixture/' } });
const step = (claimRevision, action, state, bundleId) => ({ claimRevision, action, state, bundleId, occurredAt: submittedAt });

function fixture({ answer = raw({ claim: claim() }), unsafe = false, routines, uiConfig = null } = {}) {
  const config = { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'lifecycle-reader-fixture', releaseSha: '0'.repeat(40), configHash: 'a'.repeat(64),
    cookies: { browser: 'reader_browser', session: 'reader_session' }, sessionKey: Buffer.alloc(32, 7) };
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('Reader must not invoke auth writer'); } }, provider: {} });
  const expected = { schema: 'atlas_ownership_lifecycle_reader', name: 'customer_read(text, text, jsonb, text, jsonb)', definer: true, config: ['search_path=pg_catalog'], owned: false };
  const queries = [], settings = []; let transactions = 0;
  const client = { async $transaction(work, options) {
    transactions++; assert.deepEqual(options, { maxWait: 3000, timeout: 8000 });
    return work({ async $executeRawUnsafe(sql) { settings.push(sql); }, async $queryRawUnsafe(sql, ...args) {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT r.rolsuper')) return [{ unsafe }];
      if (sql.startsWith('SELECT n.nspname')) return routines ?? [expected];
      return [{ result: typeof answer === 'function' ? answer(args[3]) : answer }];
    } });
  } };
  return { service: createCardOwnershipLifecycleReadService({ customerAuth: auth, client, uiConfig }), config, auth, expected, queries, settings,
    get transactions() { return transactions; } };
}

test('closed reads reject writes, supplied identities, arbitrary certificate URLs and unbounded cursors', () => {
  for (const action of ['submit_claim', 'reserve_bundle', 'replace_evidence', 'withdraw_claim', 'review_claim', 'read_plan', 'retain_object', 'recover_request'])
    assert.throws(() => ownershipLifecycleReadInput(action, {}), { code: 'OWNERSHIP_LIFECYCLE_READ_ONLY' });
  for (const [action, value] of [['read_access', { accountId }], ['configuration', { enabled: true }], ['read_claim', { claimId, accountId }],
    ['list_claims', { afterClaimId: null, limit: 51 }], ['list_claims', { afterClaimId: 'wrong', limit: 10 }],
    ['list_history', { claimId, afterRevision: -1, limit: 10 }], ['list_history', { claimId, afterRevision: 2147483647, limit: 10 }],
    ['resolve_certificate', { certificateNumber: 'https://atlasgrading.com/reports/x' }]]) assert.throws(() => ownershipLifecycleReadInput(action, value));
  const getter = {}; Object.defineProperty(getter, 'claimId', { enumerable: true, get() { assert.fail('Getter must not execute'); } });
  assert.throws(() => ownershipLifecycleReadInput('read_claim', getter));
  const input = { afterClaimId: null, limit: 50 }; assert.deepEqual(ownershipLifecycleReadInput('list_claims', input), input);
});

test('withdrawal/replacement projection uses current lifecycle state and exact current bundle, never old PENDING state', () => {
  for (const [state, bundleId, claimRevision] of [['PENDING', replacementBundle, 2], ['WITHDRAWN', replacementBundle, 3], ['VERIFIED', replacementBundle, 3]]) {
    const value = projectOwnershipLifecycleRead('read_claim', raw({ claim: claim({ state, bundleId, claimRevision, blockedReasons: ['POLICY_UNAVAILABLE'] }) }), { claimId });
    assert.equal(value.claim.state, state); assert.equal(value.claim.bundleId, bundleId); assert.equal(value.claim.claimRevision, claimRevision);
    assert.deepEqual(parseClaimLifecycle(value, accountId, 'read_claim', { claimId }), value);
    assert.equal(value.claim.currentlyOwnedByYou, false);
  }
  const stale = raw({ claim: { ...claim(), decision: { state: 'PENDING' }, reviewStatus: 'PENDING' } });
  assert.throws(() => projectOwnershipLifecycleRead('read_claim', stale, { claimId }));
});

test('closed projections reject proof URLs, identities, private bytes, injected actions and mismatched source bindings', () => {
  for (const field of ['ownerAccountId', 'customerId', 'reviewerId', 'proofUrl', 'bodyBase64', 'actions']) {
    assert.throws(() => projectOwnershipLifecycleRead('read_claim', raw({ claim: { ...claim(), [field]: 'PRIVATE' } }), { claimId }));
  }
  for (const change of [c => c.card.cardId = randomUUID(), c => c.card.approvalReportHash = 'bad', c => c.claimId = randomUUID(),
    c => c.card.report.version = 0, c => c.blockedReasons = ['POLICY_UNAVAILABLE', 'POLICY_UNAVAILABLE']]) {
    const c = claim(); change(c); assert.throws(() => projectOwnershipLifecycleRead('read_claim', raw({ claim: c }), { claimId }));
  }
  const unavailable = claim({ card: null, state: 'WITHDRAWN', claimRevision: 2, blockedReasons: ['CARD_UNAVAILABLE', 'EVIDENCE_EXPIRED'] });
  const result = projectOwnershipLifecycleRead('read_claim', raw({ claim: unavailable }), { claimId });
  assert.equal(result.claim.state, 'WITHDRAWN'); assert.equal(result.claim.card, null);
  assert.doesNotMatch(JSON.stringify(result), /https:|bodyBase64|reviewerId|ownerAccountId/);
});

test('own claims page preserves withdrawn and replaced claims, enforces sorted unique bounded cursor', () => {
  const claims = [claim({ claimId: randomUUID(), state: 'WITHDRAWN', claimRevision: 2 }), claim({ claimId: randomUUID(), bundleId: replacementBundle, claimRevision: 2 })]
    .sort((a, b) => a.claimId.localeCompare(b.claimId));
  const page = raw({ claims, nextClaimId: claims.at(-1).claimId }), input = { afterClaimId: null, limit: 2 };
  const value = projectOwnershipLifecycleRead('list_claims', page, input);
  assert.equal(value.schema, 'atlas-ownership-claims-page-v2'); assert.equal(value.claims.length, 2);
  assert(value.claims.some(c => c.state === 'WITHDRAWN')); assert(value.claims.some(c => c.bundleId === replacementBundle));
  for (const patch of [{ claims: [...claims].reverse() }, { claims: [claims[0], claims[0]] }, { nextClaimId: claims[0].claimId }, { claims: [] }])
    assert.throws(() => projectOwnershipLifecycleRead('list_claims', { ...page, ...patch }, input));
  assert.throws(() => projectOwnershipLifecycleRead('list_claims', page, { afterClaimId: claims[0].claimId, limit: 2 }));
  assert.deepEqual(projectOwnershipLifecycleRead('list_claims', raw({ claims: [], nextClaimId: null }), input).claims, []);
});

test('actual transition history retains original and replacement bundle metadata without rewriting the earlier receipt', () => {
  const current = claim({ state: 'WITHDRAWN', claimRevision: 3, bundleId: replacementBundle });
  const transitions = [step(1, 'submit_claim', 'PENDING', originalBundle), step(2, 'replace_evidence', 'PENDING', replacementBundle), step(3, 'withdraw_claim', 'WITHDRAWN', replacementBundle)];
  const base = raw({ claim: current, submittedAt, origin: 'PROOF_V2', transitions, nextRevision: null });
  const first = projectOwnershipLifecycleRead('list_history', { ...base, transitions: transitions.slice(0, 2), nextRevision: 2 }, { claimId, afterRevision: 0, limit: 2 });
  assert.equal(first.transitions[0].bundleId, originalBundle); assert.equal(first.claim.bundleId, replacementBundle); assert.equal(first.claim.state, 'WITHDRAWN');
  const last = projectOwnershipLifecycleRead('list_history', { ...base, transitions: transitions.slice(2) }, { claimId, afterRevision: 2, limit: 2 });
  assert.equal(last.transitions[0].state, 'WITHDRAWN'); assert.equal(last.nextRevision, null);
  assert.doesNotMatch(JSON.stringify(last), /requestId|staffId|grantId|manifest|https:|objectId|observation/);
});

test('legacy origin preserves its submittedAt without inventing a revision1 v2 transition', () => {
  const base = raw({ claim: claim({ bundleId: null }), submittedAt, origin: 'LEGACY_V1', transitions: [], nextRevision: null });
  const input = { claimId, afterRevision: 0, limit: 10 };
  assert.deepEqual(projectOwnershipLifecycleRead('list_history', base, input).transitions, []);
  for (const [action, state, bundleId] of [['withdraw_claim', 'WITHDRAWN', null], ['replace_evidence', 'PENDING', replacementBundle]]) {
    const value = projectOwnershipLifecycleRead('list_history', { ...base, claim: claim({ claimRevision: 2, state, bundleId }), transitions: [step(2, action, state, bundleId)] }, input);
    assert.equal(value.origin, 'LEGACY_V1'); assert.equal(value.submittedAt, submittedAt); assert.equal(value.transitions[0].claimRevision, 2);
  }
  assert.throws(() => projectOwnershipLifecycleRead('list_history', { ...base, transitions: [step(1, 'submit_claim', 'PENDING', originalBundle)] }, input));
});

test('history refuses inconsistent current revision/state/bundle, forged actions, missing transitions and cursor skips', () => {
  const base = raw({ claim: claim({ claimRevision: 2, bundleId: replacementBundle }), submittedAt, origin: 'PROOF_V2',
    transitions: [step(1, 'submit_claim', 'PENDING', originalBundle), step(2, 'replace_evidence', 'PENDING', replacementBundle)], nextRevision: null });
  const input = { claimId, afterRevision: 0, limit: 2 };
  for (const mutate of [v => v.transitions[1].bundleId = originalBundle, v => v.transitions[1].state = 'WITHDRAWN', v => v.transitions[1].action = 'APPROVED',
    v => v.transitions = [], v => v.transitions = [v.transitions[1]], v => v.transitions[1].claimRevision = 3,
    v => v.nextRevision = 1, v => v.transitions[1].staffId = randomUUID(), v => v.transitions[0].occurredAt = '2025-01-01T00:00:00Z']) {
    const value = structuredClone(base); mutate(value); assert.throws(() => projectOwnershipLifecycleRead('list_history', value, input));
  }
});

test('configuration is unavailable by default or missing policy and never invents proof labels/notices', () => {
  assert.equal(ownershipLifecycleReaderUI(), null);
  assert.throws(() => projectOwnershipLifecycleRead('configuration', raw({ configuration: facts() }), {}, null), { code: 'OWNERSHIP_LIFECYCLE_CONFIGURATION_UNAVAILABLE' });
  assert.throws(() => projectOwnershipLifecycleRead('configuration', raw({ configuration: facts({ policiesPresent: false, live: false, policyHash: null }) }), {}, ui()), { code: 'OWNERSHIP_LIFECYCLE_CONFIGURATION_UNAVAILABLE' });
  for (const mutate of [v => v.policyNotice = '', v => v.proofKinds[0].label = '', v => v.proofPreparation.storageOrigin = 'https://proof.invalid/path',
    v => v.proofPreparation.storageOrigin = 'https://user:secret@proof.invalid', v => v.proofPreparation.storagePathPrefix = '/a/../b/',
    v => v.proofPreparation.policyHash = 'bad', v => v.proofPreparation.formats = ['application/pdf'], v => v.enabled = false]) {
    const value = ui(); mutate(value); assert.throws(() => ownershipLifecycleReaderUI(value));
  }
});

test('disabled/expired/changed proof policy allows deliberately configured management with no upload capability', () => {
  for (const [f, settings] of [[facts({ live: false }), ui()], [facts({ policyHash: 'b'.repeat(64) }), ui()],
    [facts(), { ...ui(), proofPreparation: null }], [facts({ acceptedClaimKinds: ['OTHER_KIND'] }), ui()]]) {
    const value = projectOwnershipLifecycleRead('configuration', raw({ configuration: f }), {}, settings);
    assert.equal(value.canPrepareEvidence, false); assert.equal(value.storageOrigin, null); assert.equal(value.storagePathPrefix, null);
    assert.deepEqual(value.proofKinds, []); assert.deepEqual(value.formats, []); assert.deepEqual(parseClaimConfiguration(value, accountId), value);
  }
});

test('prepared config requires exact live policy hash and intersects approved formats/explicit labels', () => {
  const settings = ui(); settings.proofKinds.push({ code: 'NOT_APPROVED', label: 'Do not expose' });
  const value = projectOwnershipLifecycleRead('configuration', raw({ configuration: facts() }), {}, settings);
  assert.equal(value.canPrepareEvidence, true); assert.deepEqual(value.proofKinds, [settings.proofKinds[0]]); assert.deepEqual(value.formats, ['image/jpeg']);
  assert.equal(value.storageOrigin, 'https://proof.invalid'); assert.deepEqual(parseClaimConfiguration(value, accountId), value);
  assert.doesNotMatch(JSON.stringify(value), /policyHash|policyReference|retention|sessionHash|uploadPolicy/);
});

test('target wire shape remains compatible while exact certificate, approval and zero/null revision cannot drift', () => {
  for (const canSubmit of [true, false]) {
    const value = projectOwnershipLifecycleRead('resolve_certificate', raw({ card, canSubmit, expectedOwnershipRevision: canSubmit ? 0 : null }), { certificateNumber: card.certificateNumber });
    assert.deepEqual(parseClaimTarget(value, accountId, card.certificateNumber), value);
  }
  const base = raw({ card, canSubmit: false, expectedOwnershipRevision: null });
  for (const mutate of [v => v.expectedOwnershipRevision = 2, v => v.card.certificateNumber = 'ATLAS-111111111111', v => v.card.report.version = 0,
    v => v.card.ownerAccountId = randomUUID(), v => v.canSubmit = 'true']) {
    const value = structuredClone(base); mutate(value); assert.throws(() => projectOwnershipLifecycleRead('resolve_certificate', value, { certificateNumber: card.certificateNumber }));
  }
});

test('real CustomerAuth digests and frozen deployment are passed on every read; no caller account or cached access', async () => {
  let count = 0;
  const f = fixture({ answer: () => ++count === 1 ? raw({}) : { error: { status: 401, code: 'SIGN_IN_REQUIRED' } } });
  assert.deepEqual(await f.service.readAccess(cookie), { schema: 'atlas-ownership-customer-access-v1', accountId });
  await assert.rejects(f.service.readAccess(cookie), { status: 401, code: 'SIGN_IN_REQUIRED' });
  assert.equal(f.transactions, 2); const q = f.queries.at(-1);
  assert.match(q.sql, /^SELECT atlas_ownership_lifecycle_reader.customer_read/); assert.deepEqual(q.args.slice(0, 2), [hash(session), hash(browser)]);
  assert.equal(q.args[3], 'read_access'); assert.deepEqual(JSON.parse(q.args[4]), {});
  assert(f.settings.every(s => s.startsWith('SET LOCAL')));
  await assert.rejects(f.service.readAccess({ accountId }), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.transactions, 2);
  f.config.releaseSha = 'f'.repeat(40); await assert.rejects(f.service.readAccess(cookie), { code: 'OWNERSHIP_LIFECYCLE_READ_ADAPTER_INVALID' });
});

test('configuration settings are copied, while all convenience readers retain live authority/role checks', async () => {
  const settings = ui(); const f = fixture({ uiConfig: settings, answer: action => action === 'configuration' ? raw({ configuration: facts() })
    : action === 'resolve_certificate' ? raw({ card, canSubmit: false, expectedOwnershipRevision: null })
      : action === 'list_claims' ? raw({ claims: [], nextClaimId: null }) : raw({ claim: claim() }) });
  settings.proofPreparation.storageOrigin = 'https://evil.invalid'; settings.policyNotice = 'changed';
  const config = await f.service.configuration(cookie); assert.equal(config.storageOrigin, 'https://proof.invalid'); assert.notEqual(config.policyNotice, 'changed');
  await f.service.resolveTarget(cookie, { certificateNumber: card.certificateNumber });
  await f.service.listClaims(cookie, { afterClaimId: null, limit: 10 }); await f.service.readClaim(cookie, { claimId });
  assert.equal(f.transactions, 4); assert.equal(f.queries.filter(q => q.sql.startsWith('SELECT r.rolsuper')).length, 4);
  await assert.rejects(f.service.read(cookie, 'withdraw_claim', { claimId }), { code: 'OWNERSHIP_LIFECYCLE_READ_ONLY' }); assert.equal(f.transactions, 4);
});

test('writer/legacy/helper/private-guard/expanded roles refuse before a read, including owner and search_path changes', async () => {
  const base = fixture();
  for (const options of [{ unsafe: true }, { routines: [] },
    { routines: [{ ...base.expected, schema: 'atlas_ownership_workflow' }] },
    { routines: [{ ...base.expected, schema: 'atlas_ownership_lifecycle', name: 'customer_gateway(text, text, jsonb, text, jsonb)' }] },
    { routines: [base.expected, { ...base.expected, schema: 'atlas_ownership_evidence', name: 'enforce_event()' }] },
    { routines: [{ ...base.expected, owned: true }] }, { routines: [{ ...base.expected, definer: false }] },
    { routines: [{ ...base.expected, config: ['search_path=public'] }] }]) {
    const f = fixture(options); await assert.rejects(f.service.readClaim(cookie, { claimId }), { code: 'OWNERSHIP_LIFECYCLE_READ_DATABASE_ROLE_INVALID' });
    assert(!f.queries.some(q => q.sql.startsWith('SELECT atlas_ownership_lifecycle_reader.customer_read')));
  }
  const grant = cardOwnershipLifecycleReadGrantSQL('atlas_fixture_lifecycle_reader');
  assert.match(grant, /GRANT EXECUTE ON FUNCTION atlas_ownership_lifecycle_reader.customer_read/); assert.doesNotMatch(grant, /gateway|INSERT|UPDATE|DELETE|ALL/);
  for (const role of ['public', 'pg_read_all_data', 'x";DROP']) assert.throws(() => cardOwnershipLifecycleReadGrantSQL(role));
});

test('not-found/auth/policy errors are refusals, never empty success or legacy retry', async () => {
  for (const [status, code] of [[401, 'SIGN_IN_REQUIRED'], [404, 'OWNERSHIP_CLAIM_NOT_FOUND'], [503, 'OWNERSHIP_LIFECYCLE_READ_UNAVAILABLE']]) {
    const f = fixture({ answer: { error: { status, code } } }); await assert.rejects(f.service.readClaim(cookie, { claimId }), { status, code });
    assert.equal(f.queries.filter(q => q.sql.startsWith('SELECT atlas_ownership_lifecycle_reader.customer_read')).length, 1);
  }
  for (const answer of [{}, { error: { status: 200, code: 'OK' } }, { error: { status: 401, code: 'SIGN_IN_REQUIRED', secret: 'never' } }])
    await assert.rejects(fixture({ answer }).service.readClaim(cookie, { claimId }), { code: 'OWNERSHIP_LIFECYCLE_READ_RESPONSE_INVALID' });
});

test('proposal surface is read-only, locks/auth are explicit, and previously qualified writer sources remain unchanged', async () => {
  // Static source guard only: this does NOT claim PostgreSQL installation,
  // actual wait/expiry behavior or role grants have been qualified in a DB.
  const sql = await readFile(new URL('../sql/card-ownership-lifecycle-reader-proposal.sql', import.meta.url), 'utf8');
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|GRANT)\b|customer_gateway\(|reviewer_gateway\(|object_gateway\(|atlas_ownership_workflow\.(?:customer_read|claim_projection)\(/i);
  assert.match(sql, /e\.customer_id=actor\.id AND e\.kind='CLAIM_SUBMITTED'/);
  assert.match(sql, /atlas_ownership_lifecycle\.state\(e\.id\)->>'state'='PENDING'/);
  assert.match(sql, /atlas_ownership_lifecycle\.claim_projection/); assert.match(sql, /ORDER BY e\.card_id/);
  assert.equal((sql.match(/INTO fresh FROM atlas_ownership_evidence\.customer_actor/g) ?? []).length, 2);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_lifecycle_reader FROM PUBLIC/);
  for (const [path, expected] of [
    ['../sql/card-ownership-proposal.sql', '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2'],
    ['../sql/card-ownership-evidence-proposal.sql', 'ba9171cae508f2561ed6c71d9231fdcc885c67f9980d6c771f92d275ecf1aa1d'],
    ['../sql/card-ownership-lifecycle-successor-proposal.sql', 'e4cd3109efff541670c23ef815a8eeab24122dbe4b669f5eae872e1b6cd8b1eb'],
    ['../src/card-ownership-lifecycle-service.mjs', '3751b2cf60af3c591087f9a714103ecb23daeb368310124c38ffe733fc4220dc'],
  ]) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected);
});
