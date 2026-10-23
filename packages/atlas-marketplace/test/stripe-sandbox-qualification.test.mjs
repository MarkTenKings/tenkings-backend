import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStripeSandboxProvider } from '../src/provider-stripe-sandbox.mjs';
import { hash } from '../src/contract.mjs';
import { assertJournal } from '../src/ledger.mjs';
import { SANDBOX_PLATFORM as PLATFORM, SANDBOX_SELLER as SELLER, SANDBOX_PLAN_FORMAT, validateSandboxPlan, readPrivateJSON, openSandboxQualificationStore, openExistingSandboxStore, runSandboxStage, sandboxReceipt, sandboxCLI } from '../scripts/qualify-stripe-sandbox.mjs';

const NOW = 1792699200000;
function planFor(timing = 'AFTER_TRANSFER') {
  return {
    format: SANDBOX_PLAN_FORMAT, runId: 'r2qa_explicit_mock_run_001', platformAccountId: PLATFORM, connectedAccountId: SELLER, livemode: false, apiVersion: '2025-09-30.clover',
    authorization: { approved: true, evidenceRef: 'MOCK_TEST_ONLY_APPROVAL', approvedAt: NOW - 1000, expiresAt: NOW + 600000, allowedStages: ['preflight','opening','payment','confirm','transfer','refund','reversal','payout','reconcile'] },
    financePolicy: { version: 'MOCK_TEST_ONLY_POLICY', environment: 'stripe-sandbox', maxEvidenceAgeMs: 60000, ...Object.fromEntries(['approvalRef','authorityRef','feeTermsRef','refundTermsRef','transferTermsRef','payoutTermsRef','returnsTermsRef','reserveTermsRef','disputeTermsRef'].map(key => [key, `MOCK_ONLY_${key}`])) },
    amounts: { totalCents: 10000, itemCents: 10000, feeCents: 1000, sellerNetCents: 9000, taxCents: 0, shippingCents: 0 },
    refund: { timing, amountCents: 500, allocations: { sellerCents: 500, feeCents: 0, taxCents: 0, shippingCents: 0 }, evidenceRef: 'MOCK_REFUND_REVIEW' },
    payout: { amountCents: 8500, externalAccountId: 'ba_QAMockBank', evidenceRef: 'MOCK_PAYOUT_REVIEW' },
    openingReview: { approved: true, quiescent: true, reviewerId: 'mock_reviewer', policyVersion: 'MOCK_OPENING_POLICY', evidenceRef: 'MOCK_OPENING_REVIEW' },
    releaseRef: 'MOCK_PHYSICAL_RELEASE', paymentMethod: 'pm_card_bypassPending'
  };
}
function fixture(t, timing) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-qa-mock-'))), plan = planFor(timing), directory = join(parent, plan.runId);
  let now = NOW, store = openSandboxQualificationStore({ directory, plan, clock: () => now });
  t.after(() => { store.close(); rmSync(parent, { recursive: true }); });
  const balances = { [PLATFORM]: 0, [SELLER]: 0 }, transactions = { [PLATFORM]: [], [SELLER]: [] }, objects = new Map(), calls = [];
  const control = { loseNextPost: null, accountReady: true, liveBalance: false, payoutStatus: 'paid', transferPending: false };
  const put = (account, path, object) => objects.set(`${account}:${path}`, object);
  const get = (account, path) => objects.get(`${account}:${path}`);
  function transaction(account, id, source, amount, fee = 0) {
    const value = { object: 'balance_transaction', id, source, amount, fee, net: amount - fee, currency: 'usd', status: 'available', available_on: Math.floor(now / 1000), created: Math.floor(now / 1000), type: 'payment' };
    balances[account] += value.net; transactions[account].push(value); put(account, `/v1/balance_transactions/${id}`, value); return id;
  }
  const fetch = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname, account = options.headers['Stripe-Account'] ?? PLATFORM;
    assert.equal(parsed.origin, 'https://api.stripe.com'); assert.equal(options.redirect, 'error'); assert.equal(options.headers['Stripe-Version'], plan.apiVersion);
    calls.push({ method: options.method, path, account, idempotencyKey: options.headers['Idempotency-Key'] ?? null });
    let value;
    if (options.method === 'POST') {
      const params = new URLSearchParams(options.body), amount = Number(params.get('amount'));
      // Stripe removes empty metadata values rather than returning empty strings.
      const metadata = Object.fromEntries(['atlas_marketplace_intent','atlas_marketplace_order','atlas_marketplace_binding'].map(key => [key, params.get(`metadata[${key}]`)]).filter(([, value]) => value !== null && value !== ''));
      if (path === '/v1/payment_intents') {
        assert.deepEqual(params.getAll('payment_method_types[]'), ['card']);
        value = { object: 'payment_intent', id: 'pi_QAMock', amount, amount_received: 0, currency: 'usd', livemode: false, metadata, status: 'requires_payment_method', latest_charge: null, client_secret: 'SECRET_MUST_NOT_PERSIST', capture_method: 'automatic', confirmation_method: 'automatic', payment_method_types: ['card'], automatic_payment_methods: null };
        put(PLATFORM, '/v1/payment_intents/pi_QAMock', value);
      } else if (path === '/v1/payment_intents/pi_QAMock/confirm') {
        assert.equal(params.get('payment_method'), plan.paymentMethod);
        value = get(PLATFORM, '/v1/payment_intents/pi_QAMock'); value.status = 'succeeded'; value.amount_received = value.amount; value.latest_charge = 'ch_QAMock';
        put(PLATFORM, '/v1/charges/ch_QAMock', { object: 'charge', id: 'ch_QAMock', amount: value.amount, amount_captured: value.amount, currency: 'usd', livemode: false, paid: true, payment_intent: value.id, balance_transaction: transaction(PLATFORM, 'txn_QAPayment', 'ch_QAMock', value.amount, 300), payment_method_details: { type: 'card', card: { brand: 'visa', network: 'visa' } } });
      } else if (path === '/v1/transfers') {
        value = { object: 'transfer', id: 'tr_QAMock', amount, currency: 'usd', livemode: false, metadata, destination: params.get('destination'), source_transaction: params.get('source_transaction'), destination_payment: 'py_QAMock', balance_transaction: transaction(PLATFORM, 'txn_QATransfer', 'tr_QAMock', -amount) };
        put(PLATFORM, '/v1/transfers/tr_QAMock', value);
        put(SELLER, '/v1/charges/py_QAMock', { object: 'charge', id: 'py_QAMock', amount, currency: 'usd', livemode: false, source_transfer: value.id, balance_transaction: transaction(SELLER, 'txn_QAConnected', 'py_QAMock', amount) });
        if (control.transferPending) { const bt = get(SELLER, '/v1/balance_transactions/txn_QAConnected'); bt.status = 'pending'; bt.available_on += 86400; }
      } else if (path === '/v1/refunds') {
        value = { object: 'refund', id: 're_QAMock', amount, currency: 'usd', metadata, charge: params.get('charge'), status: 'succeeded', balance_transaction: transaction(PLATFORM, 'txn_QARefund', 're_QAMock', -amount) }; put(PLATFORM, '/v1/refunds/re_QAMock', value);
      } else if (path === '/v1/transfers/tr_QAMock/reversals') {
        value = { object: 'transfer_reversal', id: 'trr_QAMock', amount, currency: 'usd', metadata, transfer: 'tr_QAMock', destination_payment_refund: 'pyr_QAMock', balance_transaction: transaction(PLATFORM, 'txn_QAReversal', control.reversalSource ?? 'tr_QAMock', amount) }; put(PLATFORM, '/v1/transfers/tr_QAMock/reversals/trr_QAMock', value);
        put(SELLER, '/v1/refunds/pyr_QAMock', { object: 'refund', id: 'pyr_QAMock', amount, currency: 'usd', charge: 'py_QAMock', balance_transaction: transaction(SELLER, 'txn_QAReversalConnected', 'pyr_QAMock', -amount) });
      } else if (path === '/v1/payouts') {
        assert.equal(account, SELLER);
        value = { object: 'payout', id: 'po_QAMock', amount, currency: 'usd', metadata, livemode: false, status: control.payoutStatus, automatic: false, method: 'standard', type: 'bank_account', destination: params.get('destination'), balance_transaction: transaction(SELLER, 'txn_QAPayout', 'po_QAMock', -amount), failure_balance_transaction: null }; put(SELLER, '/v1/payouts/po_QAMock', value);
      } else assert.fail(`Unexpected POST ${path}`);
      if (control.loseNextPost === path) { control.loseNextPost = null; throw Object.assign(Error('mock lost response'), { code: 'MOCK_RESPONSE_LOST' }); }
    } else if (path === '/v1/account') value = { object: 'account', id: PLATFORM };
    else if (path === '/v1/balance') value = { object: 'balance', livemode: control.liveBalance, available: [{ currency: 'usd', amount: balances[account] }], pending: [{ currency: 'usd', amount: 0 }] };
    else if (path === `/v1/accounts/${SELLER}`) value = { object: 'account', id: SELLER, capabilities: { transfers: control.accountReady ? 'active' : 'inactive' }, payouts_enabled: control.accountReady, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: { disabled_reason: null, currently_due: [], past_due: [], errors: [] } };
    else if (path === `/v1/accounts/${SELLER}/external_accounts`) value = { object: 'list', has_more: false, data: [{ object: 'bank_account', id: plan.payout.externalAccountId, account: SELLER, currency: 'usd', status: 'new', available_payout_methods: ['standard'], default_for_currency: true }] };
    else if (path === '/v1/balance_transactions') value = { object: 'list', has_more: false, data: transactions[account].filter(row => row.created >= Number(parsed.searchParams.get('created[gte]')) && row.created < Number(parsed.searchParams.get('created[lt]'))) };
    else if (['/v1/payment_intents','/v1/transfers','/v1/refunds','/v1/payouts','/v1/transfers/tr_QAMock/reversals'].includes(path)) value = { object: 'list', has_more: false, data: [...objects.entries()].filter(([key]) => key.startsWith(`${account}:${path}/`) && !key.slice(`${account}:${path}/`.length).includes('/')).map(([, object]) => object) };
    else value = get(account, path);
    assert.ok(value, `Unexpected GET ${account} ${path}`);
    return { ok: true, body: { cancel: async () => {} }, text: async () => JSON.stringify(value) };
  };
  const credentials = { secretKey: 'sk_test_MOCKONLYNEVERREAL', platformAccountId: PLATFORM, connectedAccountId: SELLER };
  const provider = createStripeSandboxProvider({ authorizedSandbox: true, secretKey: credentials.secretKey, platformAccountId: PLATFORM, allowedConnectedAccountIds: [SELLER], apiVersion: plan.apiVersion, fetch, clock: () => now });
  return { parent, directory, plan, credentials, provider, control, calls, transactions, balances, get, fetch, failPayout() { const payout = get(SELLER, '/v1/payouts/po_QAMock'); payout.status = 'failed'; payout.failure_balance_transaction = transaction(SELLER, 'txn_QAPayoutReturn', payout.id, payout.amount); }, get store() { return store; }, advance(ms = 2000) { now += ms; }, reopen() { store.close(); store = openExistingSandboxStore({ directory, plan, clock: () => now }); }, stage(stage, overrides = {}) { return runSandboxStage({ stage, plan, store, provider, credentials, approvedPlanHash: hash(plan), clock: () => now, fetch, ...overrides }); } };
}

test('sandbox harness refuses live/permissive/symlink credential files and offline plan uses no credentials or network', async t => {
  const f = fixture(t), credentialPath = join(f.parent, 'credentials.json'), planPath = join(f.parent, 'plan.json');
  writeFileSync(credentialPath, JSON.stringify(f.credentials), { mode: 0o600 }); writeFileSync(planPath, JSON.stringify(f.plan), { mode: 0o600 });
  assert.equal(readPrivateJSON(credentialPath, { credential: true }).secretKey, f.credentials.secretKey);
  chmodSync(credentialPath, 0o644); assert.throws(() => readPrivateJSON(credentialPath, { credential: true }), { code: 'SANDBOX_PRIVATE_FILE_REFUSED' }); chmodSync(credentialPath, 0o600);
  const alias = join(f.parent, 'alias.json'); symlinkSync(credentialPath, alias); assert.throws(() => readPrivateJSON(alias, { credential: true }), { code: 'SANDBOX_PRIVATE_PATH_REQUIRED' });
  writeFileSync(credentialPath, JSON.stringify({ ...f.credentials, secretKey: 'sk_live_REFUSED' })); assert.throws(() => readPrivateJSON(credentialPath, { credential: true }), { code: 'SANDBOX_TEST_CREDENTIAL_REQUIRED' });
  const output = await sandboxCLI(['--plan', planPath, '--stage', 'plan']); assert.equal(output.apiCalls, 0); assert.equal(output.planHash, hash(f.plan)); assert.equal(f.calls.length, 0);
  const invalid = structuredClone(f.plan); invalid.livemode = true; assert.throws(() => validateSandboxPlan(invalid), { code: 'SANDBOX_ACCOUNT_SCOPE_REFUSED' });
  delete invalid.financePolicy.authorityRef; invalid.livemode = false; assert.throws(() => validateSandboxPlan(invalid), { code: 'SANDBOX_POLICY_REQUIRED' });
  await assert.rejects(f.stage('payment', { approvedPlanHash: 'not-approved' }), { code: 'SANDBOX_EXECUTION_NOT_AUTHORIZED' }); assert.equal(f.calls.length, 0);
});

test('actual adapter plus durable sandbox ledger completes mocked payment, partial refund, reversal and payout without secret persistence', async t => {
  const f = fixture(t); await f.stage('preflight'); await f.stage('opening'); f.advance();
  for (const stage of ['payment','confirm','transfer','refund','reversal','payout','reconcile']) await f.stage(stage);
  const before = f.calls.filter(row => row.method === 'POST').length; assert.equal(before, 6);
  f.reopen(); for (const stage of ['payment','confirm','transfer','refund','reversal','payout','reconcile']) await f.stage(stage);
  assert.equal(f.calls.filter(row => row.method === 'POST').length, before);
  const receipt = sandboxReceipt(f.store); assert.equal(receipt.sellerBalance.paidOutCents, 8500); assert.equal(receipt.sellerBalance.availableCents, 0); assert.equal(receipt.exceptions.length, 0);
  assert.equal(receipt.intents.every(intent => intent.dispatchCount === 1 && intent.confirmed), true); assertJournal(f.store.read().journals);
  assert.equal(f.balances[PLATFORM], 700); assert.equal(f.balances[SELLER], 0);
  const persisted = JSON.stringify(f.store.read()); assert.equal(persisted.includes('SECRET_MUST_NOT_PERSIST'), false); assert.equal(persisted.includes(f.credentials.secretKey), false); assert.equal(JSON.stringify(receipt).includes(f.credentials.secretKey), false);
  assert.equal(f.store.read().events.every(event => event.environment === 'PROVIDER_SANDBOX'), true);
});

test('lost create and confirmation responses survive restart and recover the original objects without another POST', async t => {
  const f = fixture(t, 'BEFORE_TRANSFER'); await f.stage('opening'); f.advance();
  f.control.loseNextPost = '/v1/payment_intents'; await assert.rejects(f.stage('payment'), { code: 'MOCK_RESPONSE_LOST' }); f.reopen(); await f.stage('payment');
  assert.equal(f.calls.filter(row => row.method === 'POST' && row.path === '/v1/payment_intents').length, 1);
  f.control.loseNextPost = '/v1/payment_intents/pi_QAMock/confirm'; await assert.rejects(f.stage('confirm'), { code: 'MOCK_RESPONSE_LOST' }); f.reopen(); await f.stage('confirm');
  assert.equal(f.calls.filter(row => row.method === 'POST' && row.path.endsWith('/confirm')).length, 1);
  await f.stage('refund'); await f.stage('transfer'); await f.stage('payout'); await f.stage('reconcile');
  assert.equal(sandboxReceipt(f.store).sellerBalance.paidOutCents, 8500);
});

test('pending payout stays pending and capability loss or unexplained external movement blocks a fresh payout', async t => {
  const f = fixture(t, 'BEFORE_TRANSFER'); await f.stage('opening'); f.advance();
  for (const stage of ['payment','confirm','refund','transfer']) await f.stage(stage);
  f.control.accountReady = false; await assert.rejects(f.stage('payout'), { code: 'ACCOUNT_INELIGIBLE' });
  f.control.accountReady = true; f.balances[SELLER] += 1;
  await assert.rejects(f.stage('payout'), { code: 'SANDBOX_ACCOUNT_REVIEW_REQUIRED' });
  assert.equal(f.calls.some(row => row.method === 'POST' && row.path === '/v1/payouts'), false);
  assert.ok(sandboxReceipt(f.store).exceptions.length > 0);
  const p = fixture(t, 'BEFORE_TRANSFER'); await p.stage('opening'); p.advance();
  for (const stage of ['payment','confirm','refund','transfer']) await p.stage(stage);
  p.control.payoutStatus = 'pending'; await p.stage('payout'); p.reopen(); await p.stage('payout');
  assert.equal(p.calls.filter(row => row.method === 'POST' && row.path === '/v1/payouts').length, 1);
  const payout = sandboxReceipt(p.store).intents.find(intent => intent.kind === 'PAYOUT'); assert.equal(payout.status, 'PENDING'); assert.equal(payout.confirmed, false); assert.equal(sandboxReceipt(p.store).sellerBalance.paidOutCents, 0);
  p.failPayout(); await p.stage('reconcile'); p.reopen(); await p.stage('payout');
  const returned = sandboxReceipt(p.store); assert.equal(returned.intents.find(intent => intent.kind === 'PAYOUT').status, 'FAILED'); assert.equal(returned.sellerBalance.paidOutCents, 0); assert.equal(returned.sellerBalance.availableCents, 8500); assert.equal(returned.sellerBalance.withdrawingCents, 0);
  assert.equal(p.calls.filter(row => row.method === 'POST' && row.path === '/v1/payouts').length, 1);
});

test('unknown original payment with non-card Link funding stays held across restart and never creates replacement money actions', async t => {
  const f = fixture(t); await f.stage('opening'); f.advance(); await f.stage('payment');
  const before = sandboxReceipt(f.store), journalCount = f.store.read(state => state.journals.length);
  f.control.loseNextPost = '/v1/payment_intents/pi_QAMock/confirm';
  await assert.rejects(f.stage('confirm'), { code: 'MOCK_RESPONSE_LOST' });
  f.get(PLATFORM, '/v1/charges/ch_QAMock').payment_method_details = { type: 'card', card: { brand: 'link', network: 'link' } };
  const postCount = f.calls.filter(call => call.method === 'POST').length;
  f.reopen();
  for (const stage of ['payment', 'confirm']) await assert.rejects(f.stage(stage), { code: 'STRIPE_PAYMENT_METHOD_SCOPE_MISMATCH' });
  await assert.rejects(f.stage('transfer'), { code: 'SANDBOX_PAYMENT_UNCONFIRMED' });
  const after = sandboxReceipt(f.store), payment = after.intents.find(intent => intent.kind === 'PAYMENT');
  assert.equal(payment.objectId, before.intents.find(intent => intent.kind === 'PAYMENT').objectId);
  assert.equal(payment.dispatchCount, 1); assert.equal(payment.confirmed, false);
  assert.equal(f.store.read(state => state.intents[`${f.plan.runId}_payment`].terminalUnpaid), false);
  assert.equal(f.store.read(state => state.journals.length), journalCount);
  assert.equal(after.sellerBalance.availableCents, 0); assert.equal(after.sellerBalance.paidOutCents, 0);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, postCount);
});

test('Stripe reversal recovers its original action using exact parent-transfer source and rejects foreign sources on either book', async t => {
  const f = fixture(t); await f.stage('opening'); f.advance();
  for (const stage of ['payment', 'confirm', 'transfer', 'refund']) await f.stage(stage);
  const journalCount = f.store.read(state => state.journals.length), reversalId = `${f.plan.runId}_reversal`;
  f.control.reversalSource = 'tr_foreign';
  await assert.rejects(f.stage('reversal'), { code: 'BALANCE_TRANSACTION_MISMATCH' });
  assert.equal(f.store.read(state => state.intents[reversalId].status), 'UNKNOWN');
  assert.equal(f.store.read(state => state.intents[reversalId].objectId), 'trr_QAMock');
  const platform = f.get(PLATFORM, '/v1/balance_transactions/txn_QAReversal');
  const connected = f.get(SELLER, '/v1/balance_transactions/txn_QAReversalConnected');
  for (const source of ['tr_foreign', 'trr_QAMock', 'ch_QAMock']) {
    platform.source = source;
    await assert.rejects(f.stage('reversal'), { code: 'BALANCE_TRANSACTION_MISMATCH' });
    assert.equal(f.store.read(state => state.journals.length), journalCount);
  }
  platform.source = 'tr_QAMock'; connected.source = 'pyr_foreign';
  await assert.rejects(f.stage('reversal'), { code: 'BALANCE_TRANSACTION_MISMATCH' });
  connected.source = 'pyr_QAMock';
  const reversal = f.get(PLATFORM, '/v1/transfers/tr_QAMock/reversals/trr_QAMock');
  reversal.transfer = 'tr_foreign'; await assert.rejects(f.stage('reversal'), { code: 'STRIPE_REVERSAL_MISMATCH' }); reversal.transfer = 'tr_QAMock';
  const refund = f.get(SELLER, '/v1/refunds/pyr_QAMock');
  refund.charge = 'py_foreign'; await assert.rejects(f.stage('reversal'), { code: 'STRIPE_DESTINATION_REFUND_MISMATCH' }); refund.charge = 'py_QAMock';
  assert.equal(sandboxReceipt(f.store).sellerBalance.recoveryDueCents, 500);
  f.reopen(); await f.stage('reversal'); await f.stage('reversal');
  const state = f.store.read(), receipt = sandboxReceipt(f.store);
  assert.equal(state.intents[reversalId].objectId, 'trr_QAMock'); assert.equal(state.intents[reversalId].dispatchCount, 1); assert.equal(state.intents[reversalId].confirmed, true);
  assert.equal(state.financeObservations[reversalId].balanceTransaction.source, 'tr_QAMock');
  assert.equal(state.financeObservations[reversalId].connectedBalanceTransaction.source, 'pyr_QAMock');
  assert.equal(state.journals.length, journalCount + 1); assert.equal(receipt.sellerBalance.recoveryDueCents, 0); assert.equal(receipt.sellerBalance.availableCents, 8500);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/v1/transfers/tr_QAMock/reversals').length, 1);
  assertJournal(state.journals);
});

test('lost transfer and payout replies remain GET-only; unavailable transferred funds never become payable by clock assumption', async t => {
  const f = fixture(t, 'BEFORE_TRANSFER'); await f.stage('opening'); f.advance();
  for (const stage of ['payment','confirm','refund']) await f.stage(stage);
  f.control.loseNextPost = '/v1/transfers'; await assert.rejects(f.stage('transfer'), { code: 'MOCK_RESPONSE_LOST' }); f.reopen(); await f.stage('transfer');
  f.control.loseNextPost = '/v1/payouts'; await assert.rejects(f.stage('payout'), { code: 'MOCK_RESPONSE_LOST' }); f.reopen(); await f.stage('payout');
  for (const path of ['/v1/transfers','/v1/payouts']) assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === path).length, 1);
  const p = fixture(t, 'BEFORE_TRANSFER'); await p.stage('opening'); p.advance();
  for (const stage of ['payment','confirm','refund']) await p.stage(stage);
  p.control.transferPending = true; await p.stage('transfer');
  await assert.rejects(p.stage('payout'), { code: 'SELLER_BALANCE_INSUFFICIENT' });
  assert.equal(p.calls.some(call => call.method === 'POST' && call.path === '/v1/payouts'), false);
  const transfer = sandboxReceipt(p.store).intents.find(intent => intent.kind === 'TRANSFER'); assert.equal(transfer.confirmed, true); assert.equal(transfer.available, false);
});

test('changed or missing local checkpoints and a repeated provider run cannot silently start a fresh financial action', async t => {
  const f = fixture(t); await f.stage('opening'); f.advance(); await f.stage('payment');
  const changed = structuredClone(f.plan); changed.releaseRef = 'changed-approved-reference';
  assert.throws(() => openExistingSandboxStore({ directory: f.directory, plan: changed }), { code: 'SANDBOX_STORE_BINDING_MISMATCH' });
  const missing = join(f.parent, 'missing', f.plan.runId); mkdirSync(missing, { recursive: true, mode: 0o700 });
  assert.throws(() => openExistingSandboxStore({ directory: missing, plan: f.plan }), { code: 'SANDBOX_STORE_MISSING_REFUSED' });
  const separate = join(f.parent, 'separate'); mkdirSync(separate, { mode: 0o700 });
  const store = openSandboxQualificationStore({ directory: join(separate, f.plan.runId), plan: f.plan, clock: () => NOW + 2000 });
  try {
    await f.stage('opening', { store });
    await assert.rejects(f.stage('payment', { store }), { code: 'SANDBOX_EXISTING_PROVIDER_ACTION_REFUSED' });
  } finally { store.close(); }
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/v1/payment_intents').length, 1);
});

test('unset payout order metadata recovers one original paid payout after restart while conflicting binding stays unknown', async t => {
  const f = fixture(t, 'BEFORE_TRANSFER'); await f.stage('opening'); f.advance();
  for (const stage of ['payment', 'confirm', 'refund', 'transfer']) await f.stage(stage);
  const payoutId = `${f.plan.runId}_payout`;
  f.control.loseNextPost = '/v1/payouts'; await assert.rejects(f.stage('payout'), { code: 'MOCK_RESPONSE_LOST' });
  // Preparation has already reserved the withdrawal; unknown recovery must not
  // add a debit/paid journal or release that reservation on conflicting metadata.
  const journalCount = f.store.read(state => state.journals.length);
  const payout = f.get(SELLER, '/v1/payouts/po_QAMock'), exact = structuredClone(payout.metadata);
  assert.equal(Object.hasOwn(exact, 'atlas_marketplace_order'), false);
  f.reopen();
  for (const metadata of [{ ...exact, atlas_marketplace_binding: 'foreign_binding' }, { ...exact, atlas_marketplace_order: 'foreign_order' }, { ...exact, atlas_marketplace_order: null }]) {
    payout.metadata = metadata;
    await assert.rejects(f.stage('payout'), { code: 'STRIPE_INTENT_BINDING_MISMATCH' });
    assert.equal(f.store.read(state => state.intents[payoutId].confirmed), false);
    assert.equal(f.store.read(state => state.intents[payoutId].status), 'UNKNOWN');
    assert.equal(f.store.read(state => state.journals.length), journalCount);
  }
  payout.metadata = exact; await f.stage('payout'); await f.stage('payout'); await f.stage('reconcile');
  const state = f.store.read(), receipt = sandboxReceipt(f.store);
  assert.equal(state.intents[payoutId].objectId, 'po_QAMock'); assert.equal(state.intents[payoutId].dispatchCount, 1); assert.equal(state.intents[payoutId].confirmed, true);
  assert.equal(state.journals.length, journalCount + 2); assert.equal(receipt.sellerBalance.paidOutCents, 8500); assert.equal(receipt.sellerBalance.withdrawingCents, 0);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/v1/payouts').length, 1); assert.equal(receipt.exceptions.length, 0);
  assertJournal(state.journals);
});
