# R2 durable webhook ingress and optional instant payout

Date: 2026-10-22. Isolated marketplace package, continuation from `cef23852`. This change supplies engineering and mocked/local verification. It performs no Stripe call, credential access, hosted deployment, scheduler registration, migration, new charge, onboarding, live action or external alert delivery.

## Evidence boundary

The previously retained actual Stripe **standard** sandbox payment/refund/transfer/reversal/payout and native SCA receipts remain historical evidence. They are not evidence of instant eligibility, fee layout, current live capability, or hosted ingress. The existing bank's standard payout eligibility is not proof of legal bank ownership or instant eligibility. No commercial fee rate, subsidy, instant timing guarantee, platform daily limit or production activation is inferred here.

Current primary references checked:

- [Stripe webhook delivery](https://docs.stripe.com/webhooks): verify the original signed bytes and acknowledge promptly; asynchronous processing must retain the work durably first.
- [Stripe Instant Payouts for Connect](https://docs.stripe.com/connect/instant-payouts): eligibility includes a full service agreement and platform daily limit; destination `available_payout_methods` and expanded destination-specific `instant_available.net_available` are used. Platform application fee pricing is configured separately. Stripe's own instant cost is assessed with Connect fees. Typical timing is not a guarantee.
- [Payout object](https://docs.stripe.com/api/payouts/object): exact destination, method, application fee reference and debit/return balance transaction references.
- [Application Fee object](https://docs.stripe.com/api/application_fees/object), [official Stripe generated application-fee types](https://raw.githubusercontent.com/stripe/stripe-node/v18.3.0/types/ApplicationFees.d.ts), and [official balance transaction types](https://raw.githubusercontent.com/stripe/stripe-node/v18.3.0/types/BalanceTransactions.d.ts): payout fee source and fee-detail/application bindings. These schemas establish fields, not qualification of a particular runtime cash layout.

## Durable ingress contract

`retainFinanceWebhook` in `src/ingress.mjs` verifies the raw HMAC and endpoint scope **before store access**. Its server arguments are `enabled`, `store`, `rawBody`, `signature`, scoped `endpoints`, `platformAccountId`, `allowedConnectedAccountIds`, `expectedLivemode`, `now`, `maxRetained`, and synchronous `assertRuntimeReady`. Ingress remains disabled without explicit enablement. The host's normal raw receiver selects this route only when its own ingress option and the service's bound ingress option are both explicitly enabled.

The atomic receipt lives in `state.financeWebhookIngress[eventId]`. The returned ACK is `{eventId,receiptId,status:'QUEUED'|'DUPLICATE',receivedAt,deliveryCount}`. A successful return means the transaction has committed; it does **not** mean the financial object or order has settled. No provider, order-settlement, or alert-sender call is needed before ACK.

Retained fields include platform/account/mode, endpoint and configuration digest, original raw hash, verification/receipt times, minimal routing envelope and its hash, type/object identity, status, attempts, next-attempt time, lease, affected original payment IDs, and a bounded error code. The envelope contains IDs needed to retrieve original objects; it excludes payload status/amount claims, billing details, raw bytes, signing headers, credentials, and client secrets. Provider event IDs must begin `evt_`; inherited property names are refused.

Identical bytes are duplicates and do not reset work. Different signed bytes under an existing event ID quarantine the receipt and hold both affected configured account scopes. Duplicate counts are bounded. New receipts beyond `maxRetained` (explicit 1..100000) fail with backpressure; duplicates still work. No automatic pruning or deletion is implemented. Operations must monitor capacity and arrange separately approved retention/archive procedures before exhaustion.

The worker operates only on retained verification. It does not revalidate an expired delivery signature. It checks immutable envelope hash, platform/account/mode and current approved receipt-configuration hash, claims a durable per-receipt lease, retrieves exact original provider objects, reconciles once, and calls the existing opaque server recovery-settlement capability only for terminal original PAYMENT IDs. It never creates or confirms a payment, refund, transfer, reversal or payout. An early dispute can settle the captured original payment while leaving its finance hold active.

Retries and restart use the same receipt and original object. Processing faults retain `RETRY_REQUIRED`, then `EXHAUSTED` after the configured finite attempt count. A successful retry does not clear existing finance exceptions. `REVIEW_REQUIRED`, `QUARANTINED` and `EXHAUSTED` do not automatically rearm. Root's explicit operator workflow owns review and reconciliation; do not rewrite queued payloads or invent replacement intents.

## Hosted verification packet for R1

Use the same qualified store/provider/service and branded settlement capability as the existing host packet. There is no import-time timer, listener, registration or network request. Configure service webhook ingress:

```js
webhook: {
  endpoints: [
    {id: platformEndpointId, scope: 'PLATFORM', secret: platformSigningSecret},
    {id: connectedEndpointId, scope: 'CONNECTED', secret: connectedSigningSecret}
  ],
  allowedConnectedAccountIds: approvedSellerAccountIds,
  ingress: {enabled: true, maxRetained: approvedRetentionCapacity}
}
```

The corresponding `createHostedFinance` config adds:

```js
ingress: {
  enabled: true,
  maxItems: approvedMaxItems,                 // 1..500
  concurrency: approvedConcurrency,           // 1..8, <= recovery concurrency
  maxAttempts: approvedMaxAttempts,           // 1..100
  retryDelayMs: approvedRetryDelayMs,           // 1000..86400000
  leaseMs: approvedLeaseMs,                    // 1000..900000
  maxRoutingItems: approvedRelatedObjectLimit, // 1..500
  retainedConfigurationHashes: approvedOldDigests // optional, 0..4 unique SHA256
}
```

No example value constitutes operational approval. Ingress lease must cover `recovery.maxDurationMs + finalizationBudgetMs + 1000`. Ingress and ordinary GET recovery share the existing recovery deadline and host-wide transport capacity. The standalone worker also bounds read calls by its finite lease duration. Noncooperative late read promises retain transport slots until they actually finish; results are discarded after timeout and cannot perform detached ledger reconciliation. Transaction completion can extend the response within the existing store transaction bounds; the implementation never races an entire mutating runner and leaves writes behind.

The runtime approval binding includes the full new config and the service's redacted endpoint/ingress binding. Admission and mutations recheck readiness; dependency mutation is refused. `start()` and `stop()` remain explicit, and the durable scheduler prevents overlapping scheduled runs. Separate operator `runOnce()` calls must be joined by their owner during shutdown. The host snapshot exposes retained/pending/processing/review counts, oldest pending age, provider in-flight count, and durable alerts. Root's alert generations use `deliveryKey` with a historical `alertId` fallback.

Rotation procedure: qualify the new endpoint secret/scope, include the exact approved old configuration digest in `retainedConfigurationHashes`, then change config under a fresh runtime binding. This only authorizes processing already-verified old receipts; new deliveries still require current configured secrets. Unknown old digests become review-required. An already review-required receipt does not silently rearm after approval. Prefer draining the prior generation before removing its digest. Never accept every historical configuration automatically.

R1 hosted verification, still external:

1. Provision separately scoped platform and Connect **snapshot-event** sandbox webhook endpoints at the approved hosted raw route. Bind exact endpoint IDs, accounts, mode, secret storage, expected source revision and readiness approvals. No production secret reuse.
2. Start only the approved dedicated host/scheduler. Verify raw-byte handling through the actual gateway; bad signature, wrong endpoint scope and unapproved connected account must fail before retention or provider calls.
3. Deliver the original controlled sandbox event. Record receipt ID/raw hash and durable commit before 2xx; delay provider retrieval and establish that ACK does not wait for it. Re-deliver identical bytes and prove one original ledger/order effect.
4. Stop/restart the worker after retention and before processing. Demonstrate expired-signature-age replay from durable verification, no replacement POST, original settlement and both-account reconciliation. Retain retry/exhaustion and explicit incident resolution evidence.
5. Exercise approved secret rotation, finite capacity/backpressure, scope conflict quarantine, readiness revocation, timed-out reads and shutdown. Retain redacted health/alert receipts and no-secret logs.

Prior CLI-forwarded signed sandbox events do not satisfy this actual hosted transport packet.

## Optional instant payout contract

`src/payout-instant.mjs` supplies `validateInstantPayoutPolicy`, `createInstantPayoutQuote`, `validateInstantPayoutQuote`, and explicit `settleInstantProviderFees`. The server policy must set `enabled:true`; it requires:

- `environment` (`synthetic`, `stripe-sandbox`, or `stripe-production`), `version`, `platformAccountId`, `applicationId`.
- Independent `approvalRef`, `eligibilityRef`, `pricingRef`, `providerCostRef`, `bankOwnershipRef`, `feeQualificationRef`.
- Explicit positive `minCents`/`maxCents`, `maxEvidenceAgeMs` and `quoteTtlMs` (1..300000), timing and fee disclosures.
- `feeStrategy:'STRIPE_APPLICATION_FEE'`, `providerFeePayer:'PLATFORM'`, explicit boolean `allowPlatformSubsidy`, and `failureFeeTreatment:'RETAIN_OBSERVED'`.

No price/rate or policy is supplied by defaults. An independent server fee receipt must approve the exact seller, account, destination, amount and policy hash, with integer `sellerFeeCents`, integer `providerFeeCents`, observation time and evidence reference. Seller fee below provider cost requires explicit subsidy approval. A client cannot supply this approval or change the quoted fees.

The durable quote binds scope, amount, fee, total balance debit, exact policy/evidence hashes, disclosures and ISO expiry. It can be consumed by only one payout. Preparation and final dispatch claim both check fresh eligibility, ordinary available balance, expanded destination-specific instant net balance, manual payout/requirements and account scope/mode. Existing finance holds, release rules, available seller liability and fresh two-account reconciliation remain prerequisites. This feature does not accelerate unfulfilled sales or pending transfers.

The provider GET helper retrieves the exact bound bank and expanded balance. This pilot supports **bank accounts only**. Debit cards, recipient-only service agreements, unknown instant eligibility and unexplained funds do not qualify. Stronger legal bank verification, risk approval, supported region/currency, current platform daily volume allowance and Dashboard application pricing must be independently qualified before activation. The provider create port separately requires the quote policy hash in `createStripeAuthorization`'s explicit `instantPayoutPolicyHashes` allowlist and `instantPayoutQualificationRef`; both default off. Test-only factory accepts the same optional approval configuration and still refuses live keys.

`preparePayout` adds `{method:'instant',quoteId,instantPolicy,instantEvidence}`. The original idempotency key and intent metadata bind the amount, destination, allocation, method and quote. `executeFinanceIntent` checks synchronous server `assertInstantPayoutReady` before reading evidence and inside the claim transaction. Revocation or expiry prevents an unsent action. Any create error makes the original reconcile-only. GET recovery of an existing action does not depend on the old quote still being valid or current instant policy remaining enabled.

### Exact supported cash layout

For a nonzero seller fee, qualification and observed evidence must establish all of:

1. Original payout method `instant`, bank destination, amount, account, mode, intent and allocation/quote binding match.
2. The payout's linked application fee matches the approved fee amount, platform Connect application, connected account, currency, mode and `fee_source.payout` original ID. It has no refund.
3. Connected payout debit transaction has source original payout, amount `-bankAmount`, fee `sellerFee`, net `-(bankAmount+sellerFee)` and exactly one matching application-fee detail.
4. The linked application fee's platform balance transaction has source exact fee ID, amount/net `sellerFee`, fee zero. Both transactions are registered once under the original payout owner.

This is a narrowly supported **observed layout**, not a claim that every Stripe account/API version produces it. Missing fee references, other fee categories, separately debited seller fees, mismatched application/source, refunded fees or any different layout remain UNKNOWN/review-required. They do not create a fallback action or spendable money. Actual runtime qualification of this layout is still required before enabling nonzero instant seller fees. Zero seller fees require actual absence of an application fee and a zero-fee payout debit.

The ledger reserves bank amount plus seller fee. Observed debit consumes the fee, credits actual platform cash/fee revenue, and moves principal through payout clearing. Paid-out seller principal excludes fees. Provider Connect cost is separately accrued as expense/payable from the approved exact receipt; no provider cash is fabricated. Later `settleInstantProviderFees` needs an independent approved exact bill transaction (`stripe_fee`, exact account/mode/currency/amount, observed provider evidence) and original accrued payout allocation. Repeated settlement is idempotent; duplicate allocations, amount changes and reused transaction ownership fail.

The supported failure policy retains an actually observed seller fee and restores only exact verified returned principal. An unexpected fee refund, fee-return cash layout, or a platform bill that differs from its approved accrual requires explicit review/qualification. The code does not silently return fees from platform capital or silently adjust provider cost. Standalone fee-refund creation is not included or authorized.

### Unsent intent cancellation

`voidPreparedPayment` is PAYMENT-only, dispatch-zero, object/observation/provider-transaction/journal-free and unconfirmed. `voidPreparedPayout` is PAYOUT-only, dispatch-zero and provider-effect-free, verifies its exact original reservation journal, and posts one internal compensating amount-plus-fee release. Both use `VOIDED`, `locallyVoided` and `voidedAt`, never provider `terminalUnpaid`. Payout quote consumption remains retained. Dispatch and void compete in the same transaction boundary; after dispatch, only original provider reconciliation is allowed.

## Verification performed in this change

New focused files: `test/ingress.test.mjs` (7), `test/host-ingress.test.mjs` (2), `test/payout-instant.test.mjs` (5), `test/provider-instant.test.mjs` (2), `test/service-instant.test.mjs` (1). **17/17 passed** with Node 22, including actual owned SQLite close/reopen, concurrent workers, duplicate/conflicting/scoped deliveries, old-signature-age processing, explicit configuration-history approval/refusal, capacity, lease retry/exhaustion, late ignored read and retained transport slot, quote/fee/bank/mode refusals, reservation compensation, exact fee accounting/bill allocation, service claim-time revocation and GET recovery after revocation. Synthetic/mocked provider data only; no real instant payout qualification.

Final affected baseline command: `node --test test/finance.test.mjs test/provider.test.mjs test/webhook.test.mjs test/host-finance.test.mjs test/recovery.test.mjs` from the package directory: **52/52 passed**. The new-file command covering the five files above passed **17/17**. `git diff --check` passed. Root owns the final joined aggregate, source manifest, SESSION_LOG entry and final production gate report. This document does not claim a host was deployed or any production capability was activated.
