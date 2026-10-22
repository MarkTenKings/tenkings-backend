import { createHash } from 'node:crypto';
import { financeAssert as check, integerCents as cents, identifier, safeSum } from './ledger.mjs';

const OBJECTS = { PAYMENT: 'payment_intent', TRANSFER: 'transfer', REFUND: 'refund', REVERSAL: 'transfer_reversal', PAYOUT: 'payout' };
function id(value) { const result = typeof value === 'object' && value ? value.id : value; identifier(result); check(/^[a-z]+_[A-Za-z0-9]+$/.test(result), 'INVALID_STRIPE_ID'); return result; }
function metadata(intent) { return { atlas_marketplace_intent: intent.id, atlas_marketplace_order: intent.orderId ?? '', atlas_marketplace_binding: intent.bindingHash }; }
function objectCheck(object, type, expectedId) { check(object?.object === type && object.id === expectedId, 'STRIPE_OBJECT_MISMATCH'); }
function bt(raw) {
  check(raw?.object === 'balance_transaction' && raw.currency === 'usd', 'STRIPE_BALANCE_TRANSACTION_MISMATCH');
  check(Number.isSafeInteger(raw.amount) && Number.isSafeInteger(raw.net), 'INVALID_CENTS'); cents(raw.fee);
  check(safeSum(raw.amount, -raw.fee) === raw.net && Number.isSafeInteger(raw.available_on), 'STRIPE_BALANCE_TRANSACTION_MISMATCH');
  return { id: id(raw.id), source: id(raw.source), currency: 'USD', amountCents: raw.amount, feeCents: raw.fee, netCents: raw.net, status: raw.status, availableOn: raw.available_on * 1000 };
}
// Explicitly opt-in. No env lookup, live key, automatic retry, production URL override or onboarding.
export function createStripeSandboxProvider({ authorizedSandbox = false, secretKey, platformAccountId, allowedConnectedAccountIds, apiVersion, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  check(authorizedSandbox === true, 'STRIPE_SANDBOX_NOT_AUTHORIZED');
  check(typeof secretKey === 'string' && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey), 'STRIPE_TEST_KEY_REQUIRED');
  check(/^acct_[A-Za-z0-9]+$/.test(platformAccountId), 'STRIPE_PLATFORM_REQUIRED');
  check(Array.isArray(allowedConnectedAccountIds) && allowedConnectedAccountIds.length > 0 && allowedConnectedAccountIds.every(account => /^acct_[A-Za-z0-9]+$/.test(account) && account !== platformAccountId), 'STRIPE_CONNECTED_SCOPE_REQUIRED');
  check(typeof apiVersion === 'string' && /^20\d{2}-\d{2}-\d{2}(\.[a-z]+)?$/.test(apiVersion), 'STRIPE_API_VERSION_REQUIRED');
  const allowed = new Set([platformAccountId, ...allowedConnectedAccountIds]);
  let verifiedPlatform = false;
  const rawHashes = new WeakMap();
  async function request(method, path, accountId, parameters, idempotencyKey) {
    check(allowed.has(accountId) && path.startsWith('/v1/'), 'STRIPE_ACCOUNT_SCOPE_MISMATCH');
    const headers = { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': apiVersion };
    if (accountId !== platformAccountId) headers['Stripe-Account'] = accountId;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let body;
    if (parameters) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parameters)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) for (const [subkey, subvalue] of Object.entries(value)) params.append(`${key}[${subkey}]`, String(subvalue));
        else if (Array.isArray(value)) for (const item of value) params.append(`${key}[]`, String(item));
        else params.append(key, String(value));
      }
      body = params.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const response = await fetchImpl(`https://api.stripe.com${path}`, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const text = await response.text(); check(text.length <= 2097152, 'STRIPE_RESPONSE_TOO_LARGE');
    check(response.ok, 'STRIPE_REQUEST_REQUIRES_RECONCILIATION');
    let value; try { value = JSON.parse(text); } catch { check(false, 'INVALID_STRIPE_RESPONSE'); }
    check(value && typeof value === 'object', 'INVALID_STRIPE_RESPONSE');
    rawHashes.set(value, createHash('sha256').update(text).digest('hex'));
    return value;
  }
  async function scope() {
    if (verifiedPlatform) return;
    const account = await request('GET', '/v1/account', platformAccountId);
    objectCheck(account, 'account', platformAccountId);
    const balance = await request('GET', '/v1/balance', platformAccountId);
    check(balance.object === 'balance' && balance.livemode === false, 'STRIPE_TEST_MODE_REQUIRED');
    verifiedPlatform = true;
  }
  async function getTransaction(value, accountId) {
    if (!value) return null;
    const key = id(value);
    const raw = await request('GET', `/v1/balance_transactions/${key}`, accountId); objectCheck(raw, 'balance_transaction', key);
    return { ...bt(raw), rawHash: rawHashes.get(raw) };
  }
  function pathFor(intent, objectId) {
    if (intent.kind === 'REVERSAL') return `/v1/transfers/${id(intent.parentObjectId)}/reversals${objectId ? `/${id(objectId)}` : ''}`;
    const collection = { PAYMENT: 'payment_intents', TRANSFER: 'transfers', REFUND: 'refunds', PAYOUT: 'payouts' }[intent.kind]; check(collection, 'UNSUPPORTED_FINANCE_KIND');
    return `/v1/${collection}${objectId ? `/${id(objectId)}` : ''}`;
  }
  return {
    async getAccount(accountId) {
      await scope(); check(accountId !== platformAccountId && allowed.has(accountId), 'STRIPE_ACCOUNT_SCOPE_MISMATCH');
      const account = await request('GET', `/v1/accounts/${id(accountId)}`, platformAccountId); objectCheck(account, 'account', accountId);
      const balance = await request('GET', '/v1/balance', accountId); check(balance.livemode === false && balance.object === 'balance', 'STRIPE_TEST_MODE_REQUIRED');
      const external = await request('GET', `/v1/accounts/${id(accountId)}/external_accounts?object=bank_account&limit=100`, platformAccountId);
      check(external.object === 'list' && Array.isArray(external.data) && external.has_more === false, 'STRIPE_EXTERNAL_ACCOUNTS_INCOMPLETE');
      return { accountId, livemode: false, observedAt: clock(), transfersActive: account.capabilities?.transfers === 'active', payoutsEnabled: account.payouts_enabled === true, manualPayouts: account.settings?.payouts?.schedule?.interval === 'manual', requirementsSatisfied: account.requirements?.disabled_reason === null && Array.isArray(account.requirements.currently_due) && account.requirements.currently_due.length === 0 && Array.isArray(account.requirements.past_due) && account.requirements.past_due.length === 0 && Array.isArray(account.requirements.errors) && account.requirements.errors.length === 0, verifiedExternalAccountIds: external.data.filter(bank => bank.object === 'bank_account' && bank.status === 'verified' && bank.currency === 'usd' && bank.account === accountId).map(bank => id(bank.id)) };
    },
    async getBalance(accountId) {
      await scope(); const balance = await request('GET', '/v1/balance', accountId);
      check(balance.object === 'balance' && balance.livemode === false && Array.isArray(balance.available), 'STRIPE_BALANCE_MISMATCH');
      const usd = balance.available.filter(value => value.currency === 'usd'); check(usd.length === 1, 'STRIPE_USD_BALANCE_UNAVAILABLE');
      cents(usd[0].amount);
      return { accountId, livemode: false, currency: 'USD', availableCents: usd[0].amount, observedAt: clock() };
    },
    async create(intent) {
      check(intent.policy.environment === 'stripe-sandbox' && intent.platformAccountId === platformAccountId && allowed.has(intent.connectedAccountId) && intent.status === 'DISPATCHING' && typeof intent.idempotencyKey === 'string', 'STRIPE_INTENT_SCOPE_MISMATCH');
      await scope();
      const parameters = { amount: intent.amountCents, metadata: metadata(intent) };
      if (intent.kind !== 'REVERSAL' && intent.kind !== 'REFUND') parameters.currency = 'usd';
      if (intent.kind === 'PAYMENT') { parameters.payment_method_types = ['card']; parameters.transfer_group = intent.orderId; }
      if (intent.kind === 'TRANSFER') { parameters.destination = intent.connectedAccountId; parameters.source_transaction = intent.parentObjectId; parameters.transfer_group = intent.orderId; }
      if (intent.kind === 'REFUND') parameters.charge = intent.parentObjectId;
      if (intent.kind === 'PAYOUT') { parameters.destination = intent.externalAccountId; parameters.method = 'standard'; }
      const result = await request('POST', pathFor(intent), intent.accountId, parameters, intent.idempotencyKey);
      check(result.object === OBJECTS[intent.kind], 'STRIPE_OBJECT_MISMATCH');
      // Do not expose client_secret or adopt the create response as settlement.
      return { objectId: id(result.id) };
    },
    async retrieve(intent, { objectId } = {}) {
      check(intent.policy.environment === 'stripe-sandbox' && intent.platformAccountId === platformAccountId && allowed.has(intent.connectedAccountId), 'STRIPE_INTENT_SCOPE_MISMATCH');
      await scope(); if (!objectId) return null; // Unknown original IDs need explicit operator discovery, never another POST.
      const object = await request('GET', pathFor(intent, objectId), intent.accountId); objectCheck(object, OBJECTS[intent.kind], objectId);
      const expectedMetadata = metadata(intent);
      check(Object.entries(expectedMetadata).every(([key, value]) => object.metadata?.[key] === value) && object.amount === intent.amountCents && object.currency === 'usd', 'STRIPE_INTENT_BINDING_MISMATCH');
      if (['PAYMENT', 'TRANSFER', 'PAYOUT'].includes(intent.kind)) check(object.livemode === false, 'STRIPE_TEST_MODE_REQUIRED');
      const evidence = { provider: 'stripe', rawHash: rawHashes.get(object), accountId: intent.accountId, livemode: false, kind: intent.kind, objectId, intentId: intent.id, orderId: intent.orderId, bindingHash: intent.bindingHash, currency: 'USD', amountCents: object.amount, observedAt: clock(), status: object.status ?? 'succeeded' };
      if (intent.kind === 'PAYMENT') {
        evidence.amountReceivedCents = object.amount_received;
        evidence.chargePaid = false; evidence.chargeCapturedCents = 0;
        if (object.latest_charge) {
          const chargeId = id(object.latest_charge); const charge = await request('GET', `/v1/charges/${chargeId}`, intent.accountId); objectCheck(charge, 'charge', chargeId);
          check(charge.livemode === false && id(charge.payment_intent) === objectId && charge.amount === intent.amountCents && charge.currency === 'usd', 'STRIPE_CHARGE_MISMATCH');
          evidence.chargeRawHash = rawHashes.get(charge); evidence.chargeId = chargeId; evidence.chargePaid = charge.paid === true; evidence.chargeCapturedCents = charge.amount_captured; evidence.chargeAmountCents = charge.amount; evidence.chargeCurrency = 'USD'; evidence.balanceTransaction = await getTransaction(charge.balance_transaction, intent.accountId);
        }
      } else if (intent.kind === 'TRANSFER') {
        check(id(object.destination) === intent.connectedAccountId && id(object.source_transaction) === intent.parentObjectId, 'STRIPE_TRANSFER_MISMATCH');
        evidence.parentObjectId = id(object.source_transaction); evidence.destinationAccountId = id(object.destination); evidence.destinationPaymentId = id(object.destination_payment);
        evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        const destination = await request('GET', `/v1/charges/${evidence.destinationPaymentId}`, intent.connectedAccountId); objectCheck(destination, 'charge', evidence.destinationPaymentId);
        check(destination.livemode === false && destination.amount === intent.amountCents && destination.currency === 'usd' && id(destination.source_transfer) === objectId, 'STRIPE_DESTINATION_PAYMENT_MISMATCH');
        evidence.destinationPaymentRawHash = rawHashes.get(destination);
        evidence.connectedBalanceTransaction = await getTransaction(destination.balance_transaction, intent.connectedAccountId);
      } else if (intent.kind === 'REFUND') {
        check(id(object.charge) === intent.parentObjectId, 'STRIPE_REFUND_MISMATCH');
        const charge = await request('GET', `/v1/charges/${id(object.charge)}`, intent.accountId); objectCheck(charge, 'charge', intent.parentObjectId); check(charge.livemode === false && charge.currency === 'usd', 'STRIPE_TEST_MODE_REQUIRED');
        evidence.parentRawHash = rawHashes.get(charge); evidence.parentObjectId = id(object.charge); evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        evidence.failureConfirmed = ['failed', 'canceled'].includes(object.status) && !object.balance_transaction;
      } else if (intent.kind === 'REVERSAL') {
        check(id(object.transfer) === intent.parentObjectId, 'STRIPE_REVERSAL_MISMATCH');
        const transfer = await request('GET', `/v1/transfers/${id(object.transfer)}`, intent.accountId); objectCheck(transfer, 'transfer', intent.parentObjectId);
        check(transfer.livemode === false && id(transfer.destination) === intent.connectedAccountId && transfer.currency === 'usd', 'STRIPE_TEST_MODE_REQUIRED');
        evidence.parentRawHash = rawHashes.get(transfer); evidence.parentObjectId = id(object.transfer); evidence.destinationPaymentRefundId = id(object.destination_payment_refund);
        evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        const refund = await request('GET', `/v1/refunds/${evidence.destinationPaymentRefundId}`, intent.connectedAccountId); objectCheck(refund, 'refund', evidence.destinationPaymentRefundId);
        check(refund.amount === intent.amountCents && refund.currency === 'usd' && id(refund.charge) === id(transfer.destination_payment), 'STRIPE_DESTINATION_REFUND_MISMATCH');
        evidence.destinationPaymentRefundRawHash = rawHashes.get(refund);
        evidence.connectedBalanceTransaction = await getTransaction(refund.balance_transaction, intent.connectedAccountId);
      } else if (intent.kind === 'PAYOUT') {
        check(id(object.destination) === intent.externalAccountId && object.automatic === false && object.method === 'standard' && object.type === 'bank_account', 'STRIPE_PAYOUT_MISMATCH');
        evidence.externalAccountId = id(object.destination); evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        evidence.failureBalanceTransaction = await getTransaction(object.failure_balance_transaction, intent.accountId);
      }
      // Attach the observation time after all dependent reads have completed.
      evidence.observedAt = clock();
      return evidence;
    },
  };
}
