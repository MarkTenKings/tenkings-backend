// Explicit, operator-invoked QA only. Importing this module performs no I/O.
import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync, lstatSync, mkdirSync, chmodSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAsyncFunction } from 'node:util/types';
import { createStripeSandboxProvider } from '../src/provider-stripe-sandbox.mjs';
import { preparePayment, prepareTransfer, prepareRefund, prepareReversal, preparePayout, sellerBalance } from '../src/finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent } from '../src/payment.mjs';
import { recordAccountAdjustment, reconcileAccount } from '../src/reconciliation.mjs';
import { assertJournal, financeAssert as check } from '../src/ledger.mjs';
import { canonicalJSON, clone, hash } from '../src/contract.mjs';

export const SANDBOX_PLATFORM = 'acct_1UTTwXKDyZHjIV6p';
export const SANDBOX_SELLER = 'acct_1UTUO8KDyZ4wwGG0';
export const SANDBOX_PLAN_FORMAT = 'atlas-r2-stripe-sandbox-plan-v1';
const STORE_FORMAT = 'atlas-r2-stripe-sandbox-qualification-v1';
const CHECKOUT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const STAGES = ['preflight','opening','payment','confirm','transfer','refund','reversal','payout','reconcile'];
const refs = ['approvalRef','authorityRef','feeTermsRef','refundTermsRef','transferTermsRef','payoutTermsRef','returnsTermsRef','reserveTermsRef','disputeTermsRef'];
const strict = (value, keys, code) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), code);
const ref = value => check(typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,240}$/.test(value), 'SANDBOX_REFERENCE_REQUIRED');
const amount = (value, positive = false) => check(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), 'SANDBOX_AMOUNT_REQUIRED');
const safeCode = error => /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'SANDBOX_QUALIFICATION_ERROR';

export function validateSandboxPlan(value) {
  strict(value, ['format','runId','platformAccountId','connectedAccountId','livemode','apiVersion','authorization','financePolicy','amounts','refund','payout','openingReview','releaseRef','paymentMethod'], 'SANDBOX_PLAN_SHAPE');
  check(value.format === SANDBOX_PLAN_FORMAT && /^r2qa_[a-z0-9_-]{12,80}$/.test(value.runId ?? ''), 'SANDBOX_RUN_REQUIRED');
  check(value.platformAccountId === SANDBOX_PLATFORM && value.connectedAccountId === SANDBOX_SELLER && value.livemode === false, 'SANDBOX_ACCOUNT_SCOPE_REFUSED');
  check(/^20\d{2}-\d{2}-\d{2}(\.[a-z]+)?$/.test(value.apiVersion ?? ''), 'SANDBOX_API_VERSION_REQUIRED');
  strict(value.authorization, ['approved','evidenceRef','approvedAt','expiresAt','allowedStages'], 'SANDBOX_AUTHORIZATION_REQUIRED');
  check(value.authorization.approved === true && Number.isSafeInteger(value.authorization.approvedAt) && Number.isSafeInteger(value.authorization.expiresAt) && value.authorization.expiresAt > value.authorization.approvedAt, 'SANDBOX_AUTHORIZATION_REQUIRED');
  ref(value.authorization.evidenceRef);
  check(Array.isArray(value.authorization.allowedStages) && value.authorization.allowedStages.length > 0 && new Set(value.authorization.allowedStages).size === value.authorization.allowedStages.length && value.authorization.allowedStages.every(stage => STAGES.includes(stage)), 'SANDBOX_STAGE_APPROVAL_REQUIRED');
  strict(value.financePolicy, ['version','environment','maxEvidenceAgeMs',...refs], 'SANDBOX_POLICY_REQUIRED');
  check(value.financePolicy.environment === 'stripe-sandbox' && Number.isSafeInteger(value.financePolicy.maxEvidenceAgeMs) && value.financePolicy.maxEvidenceAgeMs > 0 && value.financePolicy.maxEvidenceAgeMs <= 300000, 'SANDBOX_POLICY_REQUIRED');
  for (const key of ['version',...refs]) ref(value.financePolicy[key]);
  strict(value.amounts, ['totalCents','itemCents','feeCents','sellerNetCents','taxCents','shippingCents'], 'SANDBOX_AMOUNTS_REQUIRED');
  for (const cents of Object.values(value.amounts)) amount(cents);
  amount(value.amounts.totalCents, true);
  check(value.amounts.totalCents >= 50 && value.amounts.totalCents <= 100000 && value.amounts.sellerNetCents > 0 && value.amounts.sellerNetCents + value.amounts.feeCents === value.amounts.itemCents && value.amounts.itemCents + value.amounts.taxCents + value.amounts.shippingCents === value.amounts.totalCents, 'SANDBOX_TOTAL_MISMATCH');
  strict(value.refund, ['timing','amountCents','allocations','evidenceRef'], 'SANDBOX_REFUND_REQUIRED');
  check(['BEFORE_TRANSFER','AFTER_TRANSFER'].includes(value.refund.timing), 'SANDBOX_REFUND_TIMING_REQUIRED');
  amount(value.refund.amountCents, true); ref(value.refund.evidenceRef);
  strict(value.refund.allocations, ['sellerCents','feeCents','taxCents','shippingCents'], 'SANDBOX_REFUND_ALLOCATIONS_REQUIRED');
  for (const cents of Object.values(value.refund.allocations)) amount(cents);
  check(Object.values(value.refund.allocations).reduce((sum, n) => sum + n, 0) === value.refund.amountCents && value.refund.amountCents < value.amounts.totalCents, 'SANDBOX_REFUND_ALLOCATION_MISMATCH');
  for (const [key, limit] of [['sellerCents','sellerNetCents'],['feeCents','feeCents'],['taxCents','taxCents'],['shippingCents','shippingCents']]) check(value.refund.allocations[key] <= value.amounts[limit], 'SANDBOX_REFUND_ALLOCATION_MISMATCH');
  strict(value.payout, ['amountCents','externalAccountId','evidenceRef'], 'SANDBOX_PAYOUT_REQUIRED');
  amount(value.payout.amountCents, true); ref(value.payout.evidenceRef);
  check(/^ba_[A-Za-z0-9]+$/.test(value.payout.externalAccountId ?? '') && value.payout.amountCents <= value.amounts.sellerNetCents - value.refund.allocations.sellerCents, 'SANDBOX_PAYOUT_SCOPE_REFUSED');
  strict(value.openingReview, ['approved','quiescent','reviewerId','policyVersion','evidenceRef'], 'SANDBOX_OPENING_REVIEW_REQUIRED');
  check(value.openingReview.approved === true && value.openingReview.quiescent === true, 'SANDBOX_OPENING_REVIEW_REQUIRED');
  for (const key of ['reviewerId','policyVersion','evidenceRef']) ref(value.openingReview[key]);
  ref(value.releaseRef);
  check(['pm_card_bypassPending','pm_card_visa'].includes(value.paymentMethod), 'SANDBOX_TEST_PAYMENT_METHOD_REQUIRED');
  return clone(value);
}

// Explicit files only: no environment discovery, symlinks, permissive modes,
// or raw JSON/file errors that could echo a credential back to a terminal.
export function readPrivateJSON(filename, { credential = false } = {}) {
  check(typeof filename === 'string' && isAbsolute(filename) && realpathSync(filename) === resolve(filename), 'SANDBOX_PRIVATE_PATH_REQUIRED');
  check(filename !== CHECKOUT && !filename.startsWith(`${CHECKOUT}/`), 'SANDBOX_EXTERNAL_FILE_REQUIRED');
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    check(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid() && stat.nlink === 1 && stat.size > 0 && stat.size <= 65536, 'SANDBOX_PRIVATE_FILE_REFUSED');
    let value; try { value = JSON.parse(readFileSync(descriptor, 'utf8')); } catch { check(false, 'SANDBOX_PRIVATE_JSON_INVALID'); }
    if (!credential) return value;
    strict(value, ['platformAccountId','connectedAccountId','secretKey'], 'SANDBOX_CREDENTIAL_SHAPE');
    check(value.platformAccountId === SANDBOX_PLATFORM && value.connectedAccountId === SANDBOX_SELLER && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(value.secretKey ?? ''), 'SANDBOX_TEST_CREDENTIAL_REQUIRED');
    return value;
  } finally { closeSync(descriptor); }
}

export function openSandboxQualificationStore({ directory, plan, clock = Date.now }) {
  check(isAbsolute(directory) && directory.endsWith(`/${plan.runId}`) && realpathSync(dirname(directory)) === resolve(dirname(directory)), 'SANDBOX_RUN_DIRECTORY_REQUIRED');
  mkdirSync(directory, { mode: 0o700 });
  return openQualificationStore({ directory, plan, clock, initialize: true });
}
export function openExistingSandboxStore({ directory, plan, clock = Date.now }) {
  return openQualificationStore({ directory, plan, clock, initialize: false });
}
function openQualificationStore({ directory, plan, clock, initialize }) {
  check(isAbsolute(directory) && directory.endsWith(`/${plan.runId}`) && realpathSync(directory) === resolve(directory), 'SANDBOX_RUN_DIRECTORY_REQUIRED');
  check(directory !== CHECKOUT && !directory.startsWith(`${CHECKOUT}/`), 'SANDBOX_EXTERNAL_FILE_REQUIRED');
  const dir = lstatSync(directory); check(dir.isDirectory() && (dir.mode & 0o777) === 0o700 && dir.uid === process.getuid(), 'SANDBOX_RUN_DIRECTORY_REQUIRED');
  const filename = join(directory, 'qualification.sqlite');
  if (initialize) { const descriptor = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); closeSync(descriptor); }
  try { const stat = lstatSync(filename); check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), 'SANDBOX_STORE_FILE_REFUSED'); } catch (error) { if (error.code === 'ENOENT') check(false, 'SANDBOX_STORE_MISSING_REFUSED'); throw error; }
  const db = new DatabaseSync(filename); chmodSync(filename, 0o600);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  try { check(initialize ? tables.length === 0 : tables.map(row => row.name).sort().join(',') === 'sandbox_commits,sandbox_state', 'SANDBOX_FOREIGN_STORE_REFUSED'); }
  catch (error) { db.close(); throw error; }
  if (initialize) db.exec(`CREATE TABLE IF NOT EXISTS sandbox_state(id INTEGER PRIMARY KEY CHECK(id=1),format TEXT NOT NULL,plan_hash TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,state_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sandbox_commits(revision INTEGER PRIMARY KEY,previous_hash TEXT NOT NULL,state_hash TEXT NOT NULL,document TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS sandbox_commits_immutable_update BEFORE UPDATE ON sandbox_commits BEGIN SELECT RAISE(ABORT,'immutable'); END;
    CREATE TRIGGER IF NOT EXISTS sandbox_commits_immutable_delete BEFORE DELETE ON sandbox_commits BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  const initial = { intents: {}, journals: [], events: [], sandbox: { runId: plan.runId, planHash: hash(plan), environment: 'PROVIDER_SANDBOX', confirmations: {}, checkpoints: [] } };
  if (initialize) db.prepare('INSERT INTO sandbox_state VALUES(1,?,?,0,?,?)').run(STORE_FORMAT, hash(plan), canonicalJSON(initial), hash(initial));
  function current() {
    const row = db.prepare('SELECT * FROM sandbox_state WHERE id=1').get();
    check(row?.format === STORE_FORMAT && row.plan_hash === hash(plan), 'SANDBOX_STORE_BINDING_MISMATCH');
    const state = JSON.parse(row.document); check(hash(state) === row.state_hash, 'SANDBOX_STORE_CORRUPT'); assertJournal(state.journals);
    if (row.revision) check(db.prepare('SELECT state_hash FROM sandbox_commits WHERE revision=?').get(row.revision)?.state_hash === row.state_hash, 'SANDBOX_STORE_CORRUPT');
    return { row, state };
  }
  let active = false;
  try { current(); } catch (error) { db.close(); throw error; }
  return {
    read(fn = state => state) { return clone(fn(current().state)); },
    transaction(fn) {
      check(typeof fn === 'function' && !isAsyncFunction(fn) && !active, 'SANDBOX_SYNC_REDUCER_REQUIRED'); active = true; let began = false;
      try {
        db.exec('BEGIN IMMEDIATE'); began = true;
        const { row, state } = current(), before = clone(state), now = clock();
        const result = fn({ state, now, emit(type, payload) { state.events.push({ sequence: state.events.length + 1, type, payload: clone(payload), at: now, environment: 'PROVIDER_SANDBOX' }); } });
        if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); check(false, 'SANDBOX_SYNC_REDUCER_REQUIRED'); }
        check(state.journals.length >= before.journals.length && hash(state.journals.slice(0, before.journals.length)) === hash(before.journals) && state.events.length >= before.events.length && hash(state.events.slice(0, before.events.length)) === hash(before.events), 'SANDBOX_HISTORY_MUTATION');
        assertJournal(state.journals);
        const nextHash = hash(state);
        if (nextHash !== row.state_hash) {
          db.prepare('INSERT INTO sandbox_commits VALUES(?,?,?,?)').run(row.revision + 1, row.state_hash, nextHash, canonicalJSON(state));
          db.prepare('UPDATE sandbox_state SET revision=?,document=?,state_hash=? WHERE id=1').run(row.revision + 1, canonicalJSON(state), nextHash);
        }
        db.exec('COMMIT'); began = false; return clone(result);
      } catch (error) { if (began) db.exec('ROLLBACK'); throw error; }
      finally { active = false; }
    },
    close() { db.close(); }
  };
}

function orderFor(plan) {
  const order = { ...plan.amounts, currency: 'USD', policyVersion: plan.financePolicy.version };
  for (const key of ['orderId','reservationId','listingId','cardId','sellerId','buyerId']) order[key] = `${plan.runId}_${key}`;
  order.bindingHash = hash({ planHash: hash(plan), order }); return order;
}
function checkpoint(store, stage, status, details) {
  return store.transaction(tx => { tx.state.sandbox.checkpoints.push({ stage, status, at: tx.now, details }); return { stage, status, details }; });
}
function accountReady(account, plan) {
  check(account.accountId === SANDBOX_SELLER && account.livemode === false && account.requirementsSatisfied === true && account.transfersActive === true && account.payoutsEnabled === true && account.manualPayouts === true && account.payoutEligibleExternalAccountIds?.includes(plan.payout.externalAccountId), 'SANDBOX_ACCOUNT_NOT_READY');
}
async function original({ store, provider, intentId }) {
  const intent = await store.read(state => state.intents[intentId]); check(intent?.dispatchCount === 1, 'SANDBOX_ORIGINAL_UNDISPATCHED');
  const found = intent.objectId ? { objectId: intent.objectId, complete: true } : await provider.discover(intent);
  check(found?.complete === true && found.objectId, 'SANDBOX_ORIGINAL_OUTCOME_UNKNOWN');
  return reconcileFinanceIntent({ store, provider, intentId, objectId: found.objectId });
}
async function dispatchOrRecover(args) {
  const prior = await args.store.read(state => state.intents[args.intentId]);
  if (prior.status !== 'PREPARED') return original(args);
  const existing = await args.provider.discover(prior);
  check(existing?.complete === true && existing.objectId === null, 'SANDBOX_EXISTING_PROVIDER_ACTION_REFUSED');
  return executeFinanceIntent({ ...args, enabled: true });
}

// Only this test-fixture confirmation uses HTTP outside the real adapter. It can
// confirm one exact bound PI using one documented test token, never raw cards.
export async function confirmSandboxPayment({ store, provider, intentId, plan, credentials, fetch: fetchImpl = globalThis.fetch }) {
  validateSandboxPlan(plan);
  check(intentId === `${plan.runId}_payment` && await store.read(state => state.sandbox.planHash === hash(plan)), 'SANDBOX_CONFIRMATION_SCOPE_REFUSED');
  check(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(credentials.secretKey ?? '') && credentials.platformAccountId === SANDBOX_PLATFORM && credentials.connectedAccountId === SANDBOX_SELLER, 'SANDBOX_TEST_CREDENTIAL_REQUIRED');
  const intent = await original({ store, provider, intentId });
  if (intent.confirmed || await store.read(state => Boolean(state.sandbox.confirmations[intentId]))) return intent;
  const evidence = await provider.retrieve(intent, { objectId: intent.objectId });
  check(evidence.livemode === false && ['requires_payment_method','requires_confirmation'].includes(evidence.status) && evidence.amountReceivedCents === 0 && evidence.chargePaid === false && evidence.chargeCapturedCents === 0, 'SANDBOX_CONFIRMATION_NOT_ALLOWED');
  const claimed = await store.transaction(tx => {
    if (tx.state.sandbox.confirmations[intentId]) return false;
    tx.state.sandbox.confirmations[intentId] = { objectId: intent.objectId, status: 'DISPATCHING', at: tx.now, paymentMethod: plan.paymentMethod }; return true;
  });
  if (!claimed) return original({ store, provider, intentId });
  try {
    const response = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${intent.objectId}/confirm`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${credentials.secretKey}`, 'Stripe-Version': plan.apiVersion, 'Idempotency-Key': `${intent.idempotencyKey}:sandbox-confirm`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ payment_method: plan.paymentMethod }).toString() });
    // Do not parse, retain or emit the secret-bearing response body.
    await response.body?.cancel(); check(response.ok, 'SANDBOX_CONFIRMATION_OUTCOME_UNKNOWN');
    await store.transaction(tx => { tx.state.sandbox.confirmations[intentId].status = 'RETRIEVE_REQUIRED'; });
    return original({ store, provider, intentId });
  } catch (error) { await store.transaction(tx => { tx.state.sandbox.confirmations[intentId].status = 'UNKNOWN'; }); throw error; }
}

export async function runSandboxStage({ stage, plan: suppliedPlan, store, provider, credentials, approvedPlanHash, clock = Date.now, fetch }) {
  const plan = validateSandboxPlan(suppliedPlan);
  check(hash(plan) === approvedPlanHash && plan.authorization.allowedStages.includes(stage) && plan.authorization.approvedAt <= clock() && clock() < plan.authorization.expiresAt, 'SANDBOX_EXECUTION_NOT_AUTHORIZED');
  check(await store.read(state => state.sandbox.planHash === approvedPlanHash && state.sandbox.environment === 'PROVIDER_SANDBOX'), 'SANDBOX_STORE_BINDING_MISMATCH');
  const identity = await provider.getIdentity();
  check(identity.provider === 'stripe' && identity.environment === 'PROVIDER_SANDBOX' && identity.livemode === false && identity.platformAccountId === SANDBOX_PLATFORM && identity.allowedConnectedAccountIds.length === 1 && identity.allowedConnectedAccountIds[0] === SANDBOX_SELLER && identity.apiVersion === plan.apiVersion, 'SANDBOX_IDENTITY_MISMATCH');
  const order = orderFor(plan), ids = Object.fromEntries(['payment','transfer','refund','reversal','payout'].map(kind => [kind, `${plan.runId}_${kind}`]));
  const get = kind => store.read(state => state.intents[ids[kind]]);
  const confirmed = async kind => check((await get(kind))?.confirmed === true && (await get(kind))?.status === 'SUCCEEDED', `SANDBOX_${kind.toUpperCase()}_UNCONFIRMED`);
  const reports = async () => {
    const output = [];
    for (const accountId of [SANDBOX_PLATFORM,SANDBOX_SELLER]) {
      const sequence = await store.read(state => Object.keys(state.financeReconciliationReports ?? {}).length + Object.keys(state.financeReconciliationFailures ?? {}).length + 1);
      const report = await reconcileAccount({ store, provider, accountId, platformAccountId: SANDBOX_PLATFORM, reportId: `${plan.runId}_report_${sequence}_${clock()}`, maxEvidenceAgeMs: plan.financePolicy.maxEvidenceAgeMs, enabled: true });
      output.push({ accountId, reportId: report.reportId, status: report.status, differenceCents: report.differenceCents ?? null });
      check(report.status === 'RECONCILED', 'SANDBOX_ACCOUNT_REVIEW_REQUIRED');
    }
    return output;
  };
  try {
    let result;
    if (stage === 'preflight') {
      const account = await provider.getAccount(SANDBOX_SELLER); accountReady(account, plan);
      result = { identity, accountReady: true, bankId: plan.payout.externalAccountId, balances: [] };
      for (const accountId of [SANDBOX_PLATFORM,SANDBOX_SELLER]) result.balances.push(await provider.getAccountSnapshot(accountId));
    } else if (stage === 'opening') {
      accountReady(await provider.getAccount(SANDBOX_SELLER), plan);
      // Establish the domain's exact seller/account binding without dispatching
      // any payment; openings must still precede the first cash journal.
      if (!await get('payment')) await store.transaction(tx => preparePayment(tx, { intentId: ids.payment, order, platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, policy: plan.financePolicy }));
      for (const accountId of [SANDBOX_PLATFORM,SANDBOX_SELLER]) {
        if (await store.read(state => Boolean(state.financeOpenings?.[accountId]))) continue;
        const before = await provider.getAccountSnapshot(accountId), after = await provider.getAccountSnapshot(accountId);
        check(['availableCents','pendingCents','totalCents'].every(key => before[key] === after[key]) && before.unsupported.length === 0 && after.unsupported.length === 0, 'SANDBOX_OPENING_NOT_QUIESCENT');
        const cutoffMs = Math.floor(after.observedAt / 1000) * 1000;
        const inventory = await provider.listBalanceTransactions({ accountId, fromMs: cutoffMs, toMs: cutoffMs + 1000 });
        check(inventory.complete === true && inventory.transactions.length === 0, 'SANDBOX_OPENING_CUTOFF_BUSY');
        await store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: `${plan.runId}_opening_${accountId}`, accountId, platformAccountId: SANDBOX_PLATFORM, kind: 'OPENING', evidence: { ...after, cutoffMs }, approval: { ...plan.openingReview, accountId, kind: 'OPENING' }, maxEvidenceAgeMs: plan.financePolicy.maxEvidenceAgeMs }));
      }
      result = await reports();
    } else if (stage === 'reconcile') {
      const intents = await store.read(state => Object.values(state.intents).filter(intent => intent.dispatchCount === 1));
      for (const intent of intents) await original({ store, provider, intentId: intent.id });
      result = await reports();
    } else {
      check(await store.read(state => [SANDBOX_PLATFORM,SANDBOX_SELLER].every(accountId => Boolean(state.financeOpenings?.[accountId]))), 'SANDBOX_OPENING_REQUIRED');
      const dispatched = ids[stage] ? await get(stage) : null;
      if (dispatched?.dispatchCount === 1) {
        // Later eligibility changes cannot turn an original unknown action into
        // a replacement create, nor prevent read-only original recovery.
        result = await original({ store, provider, intentId: dispatched.id });
      } else if (stage === 'payment') {
        if (!await get('payment')) await store.transaction(tx => preparePayment(tx, { intentId: ids.payment, order, platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, policy: plan.financePolicy }));
      } else if (stage === 'confirm') {
        result = await confirmSandboxPayment({ store, provider, intentId: ids.payment, plan, credentials, fetch });
      } else if (stage === 'transfer') {
        await confirmed('payment');
        if (plan.refund.timing === 'BEFORE_TRANSFER') await confirmed('refund');
        if (!await get('transfer')) {
          const accountEvidence = await provider.getAccount(SANDBOX_SELLER);
          await store.transaction(tx => prepareTransfer(tx, { intentId: ids.transfer, paymentIntentId: ids.payment, releaseEvidence: { approved: true, orderId: order.orderId, bindingHash: order.bindingHash, policyVersion: plan.financePolicy.version, releasedAt: tx.now, evidenceRef: plan.releaseRef }, accountEvidence }));
        }
      } else if (stage === 'refund') {
        await confirmed('payment');
        if (plan.refund.timing === 'AFTER_TRANSFER') await confirmed('transfer'); else check(!await get('transfer'), 'SANDBOX_REFUND_SEQUENCE_MISMATCH');
        if (!await get('refund')) await store.transaction(tx => prepareRefund(tx, { intentId: ids.refund, paymentIntentId: ids.payment, amountCents: plan.refund.amountCents, allocations: plan.refund.allocations, policyEvidence: { approved: true, orderId: order.orderId, policyVersion: plan.financePolicy.version, evidenceRef: plan.refund.evidenceRef } }));
      } else if (stage === 'reversal') {
        check(plan.refund.timing === 'AFTER_TRANSFER' && plan.refund.allocations.sellerCents > 0, 'SANDBOX_REVERSAL_NOT_PLANNED'); await confirmed('refund');
        if (!await get('reversal')) {
          const accountEvidence = await provider.getAccount(SANDBOX_SELLER);
          await store.transaction(tx => prepareReversal(tx, { intentId: ids.reversal, transferIntentId: ids.transfer, amountCents: plan.refund.allocations.sellerCents, accountEvidence }));
        }
      } else if (stage === 'payout') {
        await confirmed('transfer'); await confirmed('refund');
        if (plan.refund.timing === 'AFTER_TRANSFER' && plan.refund.allocations.sellerCents > 0) await confirmed('reversal');
        const prior = await get('payout');
        if (!prior || prior.status === 'PREPARED') await reports();
        if (!prior) {
          const accountEvidence = await provider.getAccount(SANDBOX_SELLER), balanceEvidence = await provider.getBalance(SANDBOX_SELLER);
          await store.transaction(tx => preparePayout(tx, { intentId: ids.payout, sellerId: order.sellerId, connectedAccountId: SANDBOX_SELLER, externalAccountId: plan.payout.externalAccountId, amountCents: plan.payout.amountCents, allocationOrderIds: [order.orderId], accountEvidence, balanceEvidence }));
        }
      } else check(false, 'SANDBOX_STAGE_UNKNOWN');
      if (stage !== 'confirm' && !result) result = await dispatchOrRecover({ store, provider, intentId: ids[stage] });
      result = { intentId: result.id, objectId: result.objectId, kind: result.kind, status: result.status, confirmed: result.confirmed, available: result.available ?? false, amountCents: result.amountCents };
    }
    return checkpoint(store, stage, 'OBSERVED', result);
  } catch (error) { checkpoint(store, stage, 'STOPPED', { code: safeCode(error) }); throw error; }
}

export function sandboxReceipt(store) {
  return store.read(state => ({ format: STORE_FORMAT, environment: 'PROVIDER_SANDBOX', livemode: false, runId: state.sandbox.runId, planHash: state.sandbox.planHash, stateHash: hash(state), journalEntries: state.journals.length, checkpoints: state.sandbox.checkpoints, intents: Object.values(state.intents).map(intent => ({ intentId: intent.id, kind: intent.kind, objectId: intent.objectId, status: intent.status, amountCents: intent.amountCents, dispatchCount: intent.dispatchCount, confirmed: intent.confirmed, available: intent.available ?? false, returned: intent.returned ?? false })), sellerBalance: Object.values(state.financeOrders ?? {}).length ? sellerBalance(state, Object.values(state.financeOrders)[0].sellerId) : null, reports: Object.values(state.financeReconciliationReports ?? {}).map(report => ({ reportId: report.reportId, accountId: report.accountId, status: report.status, differenceCents: report.differenceCents, evidenceHash: report.evidenceHash })), exceptions: Object.values(state.financeExceptions ?? {}).map(item => ({ exceptionId: item.exceptionId, code: item.code, status: item.status })) }));
}

export async function sandboxCLI(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) { check(['--plan','--credentials','--directory','--stage','--execute-approved-plan'].includes(argv[i]) && argv[i + 1] && !args[argv[i]], 'SANDBOX_ARGUMENTS_INVALID'); args[argv[i]] = argv[i + 1]; }
  const plan = validateSandboxPlan(readPrivateJSON(args['--plan']));
  if (args['--stage'] === 'plan') return { runId: plan.runId, planHash: hash(plan), platformAccountId: SANDBOX_PLATFORM, connectedAccountId: SANDBOX_SELLER, livemode: false, allowedStages: plan.authorization.allowedStages, apiCalls: 0 };
  const directory = args['--directory'];
  check(isAbsolute(directory ?? '') && directory.endsWith(`/${plan.runId}`), 'SANDBOX_RUN_DIRECTORY_REQUIRED');
  let store;
  try {
    try { lstatSync(directory); store = openExistingSandboxStore({ directory, plan }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; check(args['--stage'] !== 'receipt', 'SANDBOX_RUN_NOT_FOUND'); store = openSandboxQualificationStore({ directory, plan }); }
    if (args['--stage'] !== 'receipt') {
      const credentials = readPrivateJSON(args['--credentials'], { credential: true });
      const provider = createStripeSandboxProvider({ authorizedSandbox: true, secretKey: credentials.secretKey, platformAccountId: SANDBOX_PLATFORM, allowedConnectedAccountIds: [SANDBOX_SELLER], apiVersion: plan.apiVersion });
      await runSandboxStage({ stage: args['--stage'], plan, store, provider, credentials, approvedPlanHash: args['--execute-approved-plan'] });
    }
    return sandboxReceipt(store);
  } finally {
    if (store) {
      const temporary = join(directory, `receipt-${process.pid}-${Date.now()}.tmp`);
      try { writeFileSync(temporary, JSON.stringify(sandboxReceipt(store), null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, join(directory, 'receipt.json')); } finally { store.close(); }
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await sandboxCLI(process.argv.slice(2)))); }
  catch (error) { console.error(JSON.stringify({ status: 'STOPPED', code: safeCode(error), resumedAction: 'inspect retained receipt and reconcile original objects; never create a replacement run for an unknown outcome' })); process.exitCode = 1; }
}
