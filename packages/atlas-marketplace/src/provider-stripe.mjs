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
function noDueRequirements(value) {
  if (value == null) return true; // Stripe documents external requirements as nullable.
  return typeof value === 'object' && !Array.isArray(value) && ['currently_due','past_due','pending_verification','errors'].every(key => value[key] == null || Array.isArray(value[key]) && value[key].length === 0);
}
export const STRIPE_PRODUCTION_APPROVAL_REFS = Object.freeze(['activationRef', 'merchantLiabilityRef', 'connectControlRef', 'feePolicyRef', 'refundDisputePolicyRef', 'payoutPolicyRef', 'authorityRef', 'securityQualificationRef']);
const authorizations = new WeakSet();
// This is a server-composition brand, not verification that references are approved.
// The runtime must verify each referenced approval before constructing this value.
export function createStripeAuthorization({ environment, platformAccountId, allowedConnectedAccountIds, apiVersion, allowedReturnOrigins = [], approvalRefs } = {}) {
  check(['PROVIDER_SANDBOX', 'PRODUCTION'].includes(environment), 'STRIPE_ENVIRONMENT_REQUIRED');
  check(/^acct_[A-Za-z0-9]+$/.test(platformAccountId ?? ''), 'STRIPE_PLATFORM_REQUIRED');
  check(Array.isArray(allowedConnectedAccountIds) && allowedConnectedAccountIds.length > 0 && allowedConnectedAccountIds.every(account => /^acct_[A-Za-z0-9]+$/.test(account) && account !== platformAccountId) && new Set(allowedConnectedAccountIds).size === allowedConnectedAccountIds.length, 'STRIPE_CONNECTED_SCOPE_REQUIRED');
  check(typeof apiVersion === 'string' && /^20\d{2}-\d{2}-\d{2}(\.[a-z]+)?$/.test(apiVersion), 'STRIPE_API_VERSION_REQUIRED');
  check(Array.isArray(allowedReturnOrigins) && allowedReturnOrigins.every(origin => { try { const url = new URL(origin); return url.origin === origin && url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }), 'STRIPE_RETURN_ORIGINS_REQUIRED');
  if (environment === 'PRODUCTION') {
    check(approvalRefs && Object.keys(approvalRefs).length === STRIPE_PRODUCTION_APPROVAL_REFS.length, 'STRIPE_PRODUCTION_APPROVALS_REQUIRED');
    for (const key of STRIPE_PRODUCTION_APPROVAL_REFS) identifier(approvalRefs[key]);
  }
  const result = Object.freeze({ environment, platformAccountId, allowedConnectedAccountIds: Object.freeze([...allowedConnectedAccountIds]), apiVersion, allowedReturnOrigins: Object.freeze([...allowedReturnOrigins]), approvalRefs: Object.freeze({ ...(approvalRefs ?? {}) }) });
  authorizations.add(result); return result;
}
// Never reads env, retries writes, selects an account, or enables live execution by default.
export function createStripeProvider({ authorization, secretKey, publishableKey, liveExecutionEnabled = false, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  check(authorizations.has(authorization), 'STRIPE_AUTHORIZATION_REQUIRED');
  const { environment, platformAccountId, allowedConnectedAccountIds, apiVersion, allowedReturnOrigins } = authorization;
  const live = environment === 'PRODUCTION', financeEnvironment = live ? 'stripe-production' : 'stripe-sandbox';
  check(!live || liveExecutionEnabled === true, 'STRIPE_LIVE_EXECUTION_DISABLED');
  check(typeof secretKey === 'string' && (live ? /^(sk|rk)_live_[A-Za-z0-9]+$/ : /^(sk|rk)_test_[A-Za-z0-9]+$/).test(secretKey), live ? 'STRIPE_LIVE_KEY_REQUIRED' : 'STRIPE_TEST_KEY_REQUIRED');
  const validPublishableKey = () => typeof publishableKey === 'string' && (live ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/).test(publishableKey);
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
    check(balance.object === 'balance' && balance.livemode === live, 'STRIPE_MODE_MISMATCH');
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
  function intentScope(intent) {
    check(intent?.policy?.environment === financeEnvironment && intent.platformAccountId === platformAccountId && allowed.has(intent.connectedAccountId) && intent.accountId === (intent.kind === 'PAYOUT' ? intent.connectedAccountId : platformAccountId), 'STRIPE_INTENT_SCOPE_MISMATCH');
  }
  async function list(path, accountId, { maxPages = 20 } = {}) {
    check(Number.isSafeInteger(maxPages) && maxPages > 0 && maxPages <= 100, 'INVALID_RECONCILIATION_LIMIT');
    const data = []; let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const query = `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&starting_after=${id(cursor)}` : ''}`;
      const result = await request('GET', query, accountId);
      check(result.object === 'list' && Array.isArray(result.data) && typeof result.has_more === 'boolean', 'STRIPE_LIST_MISMATCH');
      for (const item of result.data) check(!data.some(prior => prior.id === item.id), 'STRIPE_LIST_DUPLICATE');
      data.push(...result.data);
      if (!result.has_more) return { data, complete: true };
      check(result.data.length > 0, 'STRIPE_LIST_MISMATCH'); cursor = result.data.at(-1).id;
    }
    return { data, complete: false };
  }
  function safeReturnURL(value) {
    let url; try { url = new URL(value); } catch { check(false, 'STRIPE_RETURN_URL_REJECTED'); }
    check(url.protocol === 'https:' && !url.username && !url.password && !url.hash && allowedReturnOrigins.includes(url.origin), 'STRIPE_RETURN_URL_REJECTED');
    return url.href;
  }
  return {
    acceptsAccount: accountId => allowed.has(accountId),
    async getIdentity() {
      await scope();
      return { provider: 'stripe', environment, livemode: live, platformAccountId, allowedConnectedAccountIds: [...allowed].filter(accountId => accountId !== platformAccountId), apiVersion, paymentCollectionConfigured: validPublishableKey(), onboardingConfigured: allowedReturnOrigins.length > 0 };
    },
    async getPaymentCollection(intent) {
      intentScope(intent); check(intent.kind === 'PAYMENT' && intent.accountId === platformAccountId && validPublishableKey(), 'STRIPE_PAYMENT_COLLECTION_NOT_CONFIGURED');
      await scope(); const object = await request('GET', `/v1/payment_intents/${id(intent.objectId)}`, platformAccountId);
      objectCheck(object, 'payment_intent', intent.objectId);
      check(object.livemode === live && object.amount === intent.amountCents && object.currency === 'usd' && Object.entries(metadata(intent)).every(([key, value]) => object.metadata?.[key] === value), 'STRIPE_INTENT_BINDING_MISMATCH');
      check(['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(object.status) && object.amount_received === 0 && object.capture_method === 'automatic' && object.confirmation_method === 'automatic', 'PAYMENT_NOT_COLLECTIBLE');
      check(typeof object.client_secret === 'string' && object.client_secret.startsWith(`${intent.objectId}_secret_`), 'STRIPE_CLIENT_SECRET_MISMATCH');
      return { strategy: 'stripe-payment-element', paymentIntentId: object.id, clientSecret: object.client_secret, publishableKey, amountCents: object.amount, currency: 'USD' };
    },
    async createOnboardingLink({ accountId, refreshUrl, returnUrl, collectionFields, policyEvidence }) {
      check(accountId !== platformAccountId && allowed.has(accountId), 'STRIPE_ACCOUNT_SCOPE_MISMATCH');
      check(policyEvidence?.approved === true && policyEvidence.accountId === accountId, 'CONNECT_POLICY_REQUIRED');
      identifier(policyEvidence.policyVersion); identifier(policyEvidence.evidenceRef);
      check(['currently_due', 'eventually_due'].includes(collectionFields), 'CONNECT_COLLECTION_POLICY_REQUIRED');
      const refresh_url = safeReturnURL(refreshUrl), return_url = safeReturnURL(returnUrl);
      await scope();
      const result = await request('POST', '/v1/account_links', platformAccountId, { account: accountId, refresh_url, return_url, type: 'account_onboarding', collection_options: { fields: collectionFields } });
      check(result.object === 'account_link' && Number.isSafeInteger(result.expires_at) && result.expires_at * 1000 > clock(), 'STRIPE_ACCOUNT_LINK_MISMATCH');
      const url = new URL(result.url); check(url.origin === 'https://connect.stripe.com' && !url.username && !url.password, 'STRIPE_ACCOUNT_LINK_MISMATCH');
      return { accountId, url: url.href, expiresAt: result.expires_at * 1000, status: 'ONBOARDING_REQUIRED' };
    },
    async getAccount(accountId) {
      await scope(); check(accountId !== platformAccountId && allowed.has(accountId), 'STRIPE_ACCOUNT_SCOPE_MISMATCH');
      const account = await request('GET', `/v1/accounts/${id(accountId)}`, platformAccountId); objectCheck(account, 'account', accountId);
      const balance = await request('GET', '/v1/balance', accountId); check(balance.livemode === live && balance.object === 'balance', 'STRIPE_MODE_MISMATCH');
      const external = await request('GET', `/v1/accounts/${id(accountId)}/external_accounts?object=bank_account&limit=100`, platformAccountId);
      check(external.object === 'list' && Array.isArray(external.data) && external.has_more === false, 'STRIPE_EXTERNAL_ACCOUNTS_INCOMPLETE');
      const transfersActive = account.capabilities?.transfers === 'active', payoutsEnabled = account.payouts_enabled === true, manualPayouts = account.settings?.payouts?.schedule?.interval === 'manual';
      const requirementsSatisfied = account.requirements?.disabled_reason === null && Array.isArray(account.requirements.currently_due) && Array.isArray(account.requirements.past_due) && Array.isArray(account.requirements.errors) && noDueRequirements(account.requirements);
      // External payout banks use `new`, not customer-ACH `verified`/`validated`.
      // Eligibility is provider permission for this destination, never proof of
      // the seller's legal ownership. Any stronger policy remains an activation gate.
      const bankAccounts = external.data.filter(bank => bank.object === 'bank_account' && bank.account === accountId).map(bank => {
        const availablePayoutMethods = Array.isArray(bank.available_payout_methods) ? bank.available_payout_methods.filter(method => ['standard','instant'].includes(method)) : [];
        const eligible = bank.deleted !== true && bank.status === 'new' && bank.currency === 'usd' && availablePayoutMethods.includes('standard') && noDueRequirements(bank.requirements) && noDueRequirements(bank.future_requirements) && transfersActive && payoutsEnabled && manualPayouts && requirementsSatisfied;
        return { id: id(bank.id), currency: String(bank.currency).toUpperCase(), status: bank.status, defaultForCurrency: bank.default_for_currency === true, availablePayoutMethods, qualification: eligible ? 'STRIPE_PAYOUT_ELIGIBLE' : 'UNAVAILABLE' };
      });
      const payoutEligibleExternalAccountIds = bankAccounts.filter(bank => bank.qualification === 'STRIPE_PAYOUT_ELIGIBLE').map(bank => bank.id);
      return { accountId, livemode: live, observedAt: clock(), transfersActive, payoutsEnabled, manualPayouts, requirementsSatisfied, requirements: { currentlyDue: account.requirements?.currently_due ?? [], pastDue: account.requirements?.past_due ?? [], pendingVerification: account.requirements?.pending_verification ?? [], disabledReason: account.requirements?.disabled_reason ?? null }, bankAccounts, payoutEligibleExternalAccountIds,
        // Historical compatibility name: same payout eligibility, NOT identity verification.
        verifiedExternalAccountIds: [...payoutEligibleExternalAccountIds] };
    },
    async getBalance(accountId) {
      await scope(); const balance = await request('GET', '/v1/balance', accountId);
      check(balance.object === 'balance' && balance.livemode === live && Array.isArray(balance.available), 'STRIPE_BALANCE_MISMATCH');
      const usd = balance.available.filter(value => value.currency === 'usd'); check(usd.length === 1, 'STRIPE_USD_BALANCE_UNAVAILABLE');
      cents(usd[0].amount);
      return { accountId, livemode: live, currency: 'USD', availableCents: usd[0].amount, observedAt: clock() };
    },
    async getAccountSnapshot(accountId) {
      await scope(); check(allowed.has(accountId), 'STRIPE_ACCOUNT_SCOPE_MISMATCH');
      const value = await request('GET', '/v1/balance', accountId);
      check(value.object === 'balance' && value.livemode === live && Array.isArray(value.available) && Array.isArray(value.pending), 'STRIPE_BALANCE_MISMATCH');
      const amount = entries => {
        const matches = entries.filter(row => row.currency === 'usd'); check(matches.length <= 1, 'STRIPE_BALANCE_MISMATCH');
        const result = matches[0]?.amount ?? 0; check(Number.isSafeInteger(result), 'INVALID_CENTS'); return result;
      };
      const availableCents = amount(value.available), pendingCents = amount(value.pending);
      const unsupported = [];
      for (const bucket of ['available', 'pending', 'connect_reserved', 'refund_and_dispute_prefunding']) {
        const rows = value[bucket] ?? []; check(Array.isArray(rows), 'STRIPE_BALANCE_MISMATCH');
        for (const row of rows) if (row.amount !== 0 && (row.currency !== 'usd' || !['available', 'pending'].includes(bucket))) unsupported.push({ bucket, currency: row.currency, amountCents: row.amount });
      }
      return { provider: 'stripe', accountId, livemode: live, currency: 'USD', availableCents, pendingCents, totalCents: safeSum(availableCents, pendingCents), unsupported, observedAt: clock(), rawHash: rawHashes.get(value) };
    },
    async listBalanceTransactions({ accountId, fromMs, toMs, maxPages = 20 }) {
      await scope(); check(allowed.has(accountId) && Number.isSafeInteger(fromMs) && Number.isSafeInteger(toMs) && fromMs >= 0 && toMs > fromMs && fromMs % 1000 === 0 && toMs % 1000 === 0, 'INVALID_RECONCILIATION_WINDOW');
      const result = await list(`/v1/balance_transactions?currency=usd&created[gte]=${fromMs / 1000}&created[lt]=${toMs / 1000}`, accountId, { maxPages });
      const transactions = result.data.map(raw => {
        const t = bt({ ...raw, source: raw.source ?? raw.id });
        check(Number.isSafeInteger(raw.created) && raw.created * 1000 >= fromMs && raw.created * 1000 < toMs, 'STRIPE_TRANSACTION_WINDOW_MISMATCH');
        return { ...t, sourceIsNull: raw.source == null, createdAt: raw.created * 1000, type: raw.type, rawHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex') };
      });
      return { provider: 'stripe', accountId, livemode: live, currency: 'USD', fromMs, toMs, complete: result.complete, transactions, observedAt: clock() };
    },
    async discover(intent, { maxPages = 20 } = {}) {
      intentScope(intent); await scope();
      if (intent.objectId) return { objectId: intent.objectId, complete: true };
      const result = await list(pathFor(intent), intent.accountId, { maxPages });
      const matches = result.data.filter(object => Object.entries(metadata(intent)).every(([key, value]) => object.metadata?.[key] === value));
      check(matches.length <= 1, 'MULTIPLE_PROVIDER_OBJECTS');
      // Incomplete discovery cannot establish uniqueness; no result permits a second POST.
      if (!result.complete) return { objectId: null, complete: false };
      return { objectId: matches.length === 1 ? id(matches[0].id) : null, complete: true };
    },
    async listRelatedObjects(intent) {
      intentScope(intent); await scope();
      check(['PAYMENT', 'TRANSFER'].includes(intent.kind), 'STRIPE_RELATED_SCOPE_MISMATCH');
      const kind = intent.kind === 'PAYMENT' ? 'REFUND' : 'REVERSAL';
      const result = await list(kind === 'REFUND' ? `/v1/refunds?charge=${id(intent.chargeId)}` : `/v1/transfers/${id(intent.objectId)}/reversals`, intent.accountId);
      return { complete: result.complete, objects: result.data.map(object => ({ kind, objectId: id(object.id), intentId: object.metadata?.atlas_marketplace_intent ?? null, parentObjectId: id(kind === 'REFUND' ? object.charge : object.transfer) })) };
    },
    async retrieveDispute(payment, { objectId }) {
      intentScope(payment); check(payment.kind === 'PAYMENT' && payment.confirmed, 'PAYMENT_UNCONFIRMED'); await scope();
      const object = await request('GET', `/v1/disputes/${id(objectId)}`, payment.accountId); objectCheck(object, 'dispute', objectId);
      check(object.livemode === live && object.currency === 'usd' && id(object.charge) === payment.chargeId && (!object.payment_intent || id(object.payment_intent) === payment.objectId) && Array.isArray(object.balance_transactions), 'STRIPE_DISPUTE_MISMATCH');
      const charge = await request('GET', `/v1/charges/${id(object.charge)}`, payment.accountId); objectCheck(charge, 'charge', payment.chargeId);
      check(charge.livemode === live && id(charge.payment_intent) === payment.objectId && charge.currency === 'usd' && charge.amount === payment.amountCents, 'STRIPE_CHARGE_MISMATCH');
      const transactions = [];
      for (const value of object.balance_transactions) transactions.push(await getTransaction(value, payment.accountId));
      const debits = transactions.filter(value => value.amountCents < 0), returns = transactions.filter(value => value.amountCents > 0);
      check(debits.length <= 1 && returns.length <= 1 && transactions.length === debits.length + returns.length, 'UNSUPPORTED_DISPUTE_MOVEMENTS');
      return { provider: 'stripe', accountId: payment.accountId, livemode: live, objectId, chargeId: payment.chargeId, currency: 'USD', amountCents: cents(object.amount, { positive: true }), status: object.status, balanceTransaction: debits[0] ?? null, reinstatementBalanceTransaction: returns[0] ?? null, observedAt: clock(), rawHash: rawHashes.get(object), chargeRawHash: rawHashes.get(charge) };
    },
    async create(intent) {
      intentScope(intent); check(intent.status === 'DISPATCHING' && typeof intent.idempotencyKey === 'string', 'STRIPE_INTENT_SCOPE_MISMATCH');
      await scope();
      const parameters = { amount: intent.amountCents, metadata: metadata(intent) };
      if (intent.kind !== 'REVERSAL' && intent.kind !== 'REFUND') parameters.currency = 'usd';
      if (intent.kind === 'PAYMENT') { parameters.payment_method_types = ['card']; parameters.transfer_group = intent.orderId; parameters.capture_method = 'automatic'; parameters.confirmation_method = 'automatic'; }
      if (intent.kind === 'TRANSFER') { parameters.destination = intent.connectedAccountId; parameters.source_transaction = intent.parentObjectId; parameters.transfer_group = intent.orderId; }
      if (intent.kind === 'REFUND') parameters.charge = intent.parentObjectId;
      if (intent.kind === 'PAYOUT') { parameters.destination = intent.externalAccountId; parameters.method = 'standard'; }
      const result = await request('POST', pathFor(intent), intent.accountId, parameters, intent.idempotencyKey);
      check(result.object === OBJECTS[intent.kind], 'STRIPE_OBJECT_MISMATCH');
      // Do not expose client_secret or adopt the create response as settlement.
      return { objectId: id(result.id) };
    },
    async retrieve(intent, { objectId } = {}) {
      intentScope(intent);
      await scope(); if (!objectId) return null; // Unknown original IDs need explicit operator discovery, never another POST.
      const object = await request('GET', pathFor(intent, objectId), intent.accountId); objectCheck(object, OBJECTS[intent.kind], objectId);
      const expectedMetadata = metadata(intent);
      check(Object.entries(expectedMetadata).every(([key, value]) => object.metadata?.[key] === value) && object.amount === intent.amountCents && object.currency === 'usd', 'STRIPE_INTENT_BINDING_MISMATCH');
      if (['PAYMENT', 'TRANSFER', 'PAYOUT'].includes(intent.kind)) check(object.livemode === live, 'STRIPE_MODE_MISMATCH');
      const evidence = { provider: 'stripe', rawHash: rawHashes.get(object), accountId: intent.accountId, livemode: live, kind: intent.kind, objectId, intentId: intent.id, orderId: intent.orderId, bindingHash: intent.bindingHash, currency: 'USD', amountCents: object.amount, observedAt: clock(), status: object.status ?? 'succeeded' };
      if (intent.kind === 'PAYMENT') {
        evidence.amountReceivedCents = object.amount_received;
        evidence.chargePaid = false; evidence.chargeCapturedCents = 0;
        if (object.latest_charge) {
          const chargeId = id(object.latest_charge); const charge = await request('GET', `/v1/charges/${chargeId}`, intent.accountId); objectCheck(charge, 'charge', chargeId);
          check(charge.livemode === live && id(charge.payment_intent) === objectId && charge.amount === intent.amountCents && charge.currency === 'usd', 'STRIPE_CHARGE_MISMATCH');
          evidence.chargeRawHash = rawHashes.get(charge); evidence.chargeId = chargeId; evidence.chargePaid = charge.paid === true; evidence.chargeCapturedCents = charge.amount_captured; evidence.chargeAmountCents = charge.amount; evidence.chargeCurrency = 'USD'; evidence.balanceTransaction = await getTransaction(charge.balance_transaction, intent.accountId);
        }
      } else if (intent.kind === 'TRANSFER') {
        check(id(object.destination) === intent.connectedAccountId && id(object.source_transaction) === intent.parentObjectId, 'STRIPE_TRANSFER_MISMATCH');
        evidence.parentObjectId = id(object.source_transaction); evidence.destinationAccountId = id(object.destination); evidence.destinationPaymentId = id(object.destination_payment);
        evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        const destination = await request('GET', `/v1/charges/${evidence.destinationPaymentId}`, intent.connectedAccountId); objectCheck(destination, 'charge', evidence.destinationPaymentId);
        check(destination.livemode === live && destination.amount === intent.amountCents && destination.currency === 'usd' && id(destination.source_transfer) === objectId, 'STRIPE_DESTINATION_PAYMENT_MISMATCH');
        evidence.destinationPaymentRawHash = rawHashes.get(destination);
        evidence.connectedBalanceTransaction = await getTransaction(destination.balance_transaction, intent.connectedAccountId);
      } else if (intent.kind === 'REFUND') {
        check(id(object.charge) === intent.parentObjectId, 'STRIPE_REFUND_MISMATCH');
        const charge = await request('GET', `/v1/charges/${id(object.charge)}`, intent.accountId); objectCheck(charge, 'charge', intent.parentObjectId); check(charge.livemode === live && charge.currency === 'usd', 'STRIPE_MODE_MISMATCH');
        evidence.parentRawHash = rawHashes.get(charge); evidence.parentObjectId = id(object.charge); evidence.balanceTransaction = await getTransaction(object.balance_transaction, intent.accountId);
        evidence.failureBalanceTransaction = await getTransaction(object.failure_balance_transaction, intent.accountId);
        evidence.failureConfirmed = ['failed', 'canceled'].includes(object.status) && !object.balance_transaction && !object.failure_balance_transaction;
      } else if (intent.kind === 'REVERSAL') {
        check(id(object.transfer) === intent.parentObjectId, 'STRIPE_REVERSAL_MISMATCH');
        const transfer = await request('GET', `/v1/transfers/${id(object.transfer)}`, intent.accountId); objectCheck(transfer, 'transfer', intent.parentObjectId);
        check(transfer.livemode === live && id(transfer.destination) === intent.connectedAccountId && transfer.currency === 'usd', 'STRIPE_MODE_MISMATCH');
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
