# R2 finance implementation — isolated local qualification

October 22, 2026. Owned implementation in `codex/atlas-r2-marketplace-pilot`, separate from R1 and every deployed grading/Ten Kings system. This is an inert local marketplace package, not a production financial service or evidence of Stripe sandbox qualification. No credentials were discovered, supplied or used; provider calls in tests are synthetic or injected HTTP fixtures. No live account, money, message, migration, release or grading operation occurred.

## Scope and money meaning

The implementation covers the R2 financial portion of master IDs17,19,23,27 and operational portions of04,21,29,30. All30 master-plan IDs retain their existing scope. Ownership/claims/history remain disabled. Listing, custody, fulfillment, buyer/seller authority, routes, persistence integration and schema proposals remain lead/sibling ownership.

`ledger.mjs` uses safe integer USD cents and immutable hash-chained journal entries. Positive postings are debits; negative postings are credits. Every entry balances independently within each platform or connected-account book. Inputs, cumulative balances and intermediate arithmetic reject unsafe integers. The shared local store additionally rejects rewriting existing journal entries and retains append-only commit snapshots. This finite local persistence is not a production SQL qualification.

A confirmed payment allocates gross money once to seller payable, fee revenue, tax and shipping liabilities. Actual processing fees are an expense separate from the agreed seller allocation. Transfer reduces platform cash/payable and adds connected cash/proceeds; it never creates a second sale. Only the exact connected balance transaction becoming available releases proceeds for withdrawal. A payout reserves specific order allocations, moves cash into payout clearing, and settles those allocations only after retrieved `paid` evidence. Failed payouts restore money once only after exact original debit plus distinct returned-funds evidence. A later failure after `paid` retains both original completion and correction.

Refunds have explicit cent-conserving seller/fee/tax/shipping allocations and cumulative per-component limits. A pre-transfer refund reduces seller payable; a post-transfer refund records seller recovery due. A distinct bounded transfer reversal recovers that debt only from still-unwithdrawn proceeds. After payout, insufficient recovery remains debt; there is no fabricated balance or assumed bank debit. Disputes separately record platform debit/fees and explicitly authorized seller recovery. One dispute per sale is supported; a second distinct dispute ID requires review. Refunds during an unresolved dispute require review to avoid duplicate compensation.

The pilot conservatively blocks **all new withdrawals for a seller** while any order has a hold, unresolved recovery, refund or open dispute. Hold amounts and reasons remain recorded; the projection marks otherwise available proceeds Reserved while this seller restriction exists. It does not promise a partial-hold implementation, release date, escrow, bank account, insurance or spending wallet.

## Public internal API

All reducers run synchronously in the lead-owned `store.transaction(tx => ...)`, using `{state,now,emit}`. `tx.now` is an integer epoch-millisecond clock. Shared `state.intents` and `state.journals` are used; private maps are `financeOrders`, `financeObjects`, `financeObservations`, `financeDisputes`, `financeHolds` and `financeWebhooks`. Reducer inputs are trusted service-side contracts, not public customer request bodies. Authorization and real evidence acquisition belong to the integration boundary.

- `preparePayment(tx,{intentId,order,platformAccountId,connectedAccountId,policy})`
- `prepareTransfer(tx,{intentId,paymentIntentId,releaseEvidence,accountEvidence})`
- `prepareRefund(tx,{intentId,paymentIntentId,amountCents,allocations,policyEvidence})`
- `prepareReversal(tx,{intentId,transferIntentId,amountCents,accountEvidence})`
- `preparePayout(tx,{intentId,sellerId,connectedAccountId,externalAccountId,amountCents,allocationOrderIds,accountEvidence,balanceEvidence})`
- `claimDispatch(tx,intentId,accountEvidence?,balanceEvidence?)`, `bindFinanceObject`, `markFinanceUnknown`
- `reconcileFinance(tx,{intentId,evidence})`, `reconcileDispute` (alias `recordDispute`)
- `recordHold(tx,{orderId,holdId,reason,evidenceRef,amountCents})`, `releaseHold(tx,{holdId,evidenceRef})`
- `sellerBalance(state,sellerId)` returns Pending, Available, Reserved, Withdrawal processing, Paid out and recovery-due cents.

The payment `order` freezes `orderId,reservationId,listingId,cardId,sellerId,buyerId,currency:'USD',totalCents,itemCents,feeCents,sellerNetCents,taxCents,shippingCents,policyVersion,bindingHash`. It must satisfy `sellerNet + fee = item` and `item + tax + shipping = total`. The cross-domain service compares these exact values with its immutable reservation; the finance module never grants ownership or fulfillment authority.

An intent has `id,intentId,kind,status,order,orderId,sellerId,accountId,platformAccountId,connectedAccountId,amountCents,currency,bindingHash,policy,requestHash,objectId,confirmed,terminalUnpaid,dispatchCount`. Statuses are PREPARED, DISPATCHING, UNKNOWN, PENDING, SUCCEEDED, FAILED or CANCELED. Only a retrieved canceled PaymentIntent with **zero received, zero captured and unpaid charge evidence** sets `terminalUnpaid:true`. `requires_payment_method`, `requires_action`, timeouts, missing evidence and browser redirects cannot release a card reservation. Payment settlement requires exact paid/captured charge and balance evidence.

`payment.mjs` exposes `executeFinanceIntent({store,provider,intentId,enabled:false})` and `reconcileFinanceIntent({store,provider,intentId,objectId?})`. Dispatch requires explicit enablement; it commits the single dispatch claim and deterministic provider idempotency identity before I/O. Transfer/reversal/payout recheck current account capability; payout also refreshes actual available balance. Any create exception consumes dispatch. Reconciliation only retrieves and never POSTs. An unknown original object ID requires exact discovery; no replacement intent or provider key is manufactured.

## Required policy and provider contract

The policy must provide `version`, environment `synthetic` or `stripe-sandbox`, and explicit references for approval, authority, fee, refund, transfer, payout, returns, reserve and dispute terms: `approvalRef,authorityRef,feeTermsRef,refundTermsRef,transferTermsRef,payoutTermsRef,returnsTermsRef,reserveTermsRef,disputeTermsRef`. `maxEvidenceAgeMs` must be a positive finite integer no greater than five minutes. These are required bindings, not policy approval. The exported synthetic policy says fixture-only. The test example's800-cent fee on a10000-cent item is synthetic arithmetic; **8% remains unapproved**.

Fresh `accountEvidence` requires `accountId,livemode:false,observedAt,transfersActive,requirementsSatisfied`; payouts additionally require `payoutsEnabled,manualPayouts,verifiedExternalAccountIds`. Fresh balance evidence binds the connected account, USD, test mode and `availableCents`. Aggregate platform balance never becomes one seller's allocation.

Provider port:

- `create(intent) -> {objectId}`; no create response establishes settlement.
- `retrieve(intent,{objectId}) -> normalized evidence | null`.
- `getAccount(accountId)`, `getBalance(accountId)`.

Normalized evidence binds provider, account, test mode, kind, exact object/intent/order, immutable binding hash, USD, amount, current status and observed time. Parent charge/transfer, transfer destination or bank destination must match. Balance transactions preserve ID, source, signed gross, fee, net, currency, settlement status and availability time. Transfer/reversal also retrieves the corresponding connected transaction. Stripe response raw-byte SHA256 hashes are retained in normalized evidence for object, dependent charge/transfer/refund and balance-transaction replies. Changes to an already-observed transaction's immutable financial fields fail closed.

`provider-synthetic.mjs` is explicitly enabled and durable in `state.syntheticProvider`. Configure synthetic accounts; use `resolve(intentId,{status,settlement,processingFeeCents})` to move the fixture provider, then call the real reconciliation wrapper. `failNextCreateAfterCommit(intentId)` simulates a lost response after durable provider acceptance. The local store persists both provider and marketplace state across reopen. All events remain tagged SYNTHETIC_LOCAL by the store.

`provider-stripe-sandbox.mjs` requires explicit `authorizedSandbox:true`, a directly supplied test key, exact platform account, allowlisted connected accounts and pinned API version. It has no environment lookup, live key acceptance, automatic retries or API-origin override. It verifies platform identity and test balance, sends immutable metadata/idempotency, retrieves current objects, binds parent/destination objects and checks manual standard-bank payout semantics. It returns no client secret. The adapter creates an unconfirmed card PaymentIntent; payment collection UI/confirmation is not integrated. Manual-payout account/controller support, actual verified bank behavior, provider acceptance and country-specific rules still require dedicated sandbox qualification and approved configuration.

## Webhooks and operational limits

`verifyRawWebhook` requires the original Buffer, bounds payload/header size, checks HMAC-SHA256 against the original bytes with constant-time comparison, and rejects stale/future signatures, wrong mode and invalid events. `handleFinanceWebhook` is disabled by default. Authenticated event hints are durably deduplicated by event ID and raw hash, then the exact object is freshly retrieved. Duplicate/out-of-order hints cannot directly post money or regress a completed payment.

Direct payment_intent/refund/transfer/transfer_reversal/payout object events are supported. Stripe's `transfer.reversed` carries the transfer object; a reversal intent still needs its own exact-object reconciliation. Charge-refund and dispute webhooks do not silently choose refund/recovery allocations; explicit dispute policy/retrieval integration remains required. The reducer supports exact normalized dispute observations, not autonomous dispute evidence filing or deadline handling. Unsupported/contradictory provider observations remain unresolved and do not unlock funds.

Outstanding activation work includes authoritative seller/title/consignment gates, provider-approved legal/fee/tax/return/reserve/recovery/timing terms, separate restricted production persistence/roles, actual sandbox collection/settlement/capability/payout/late-failure qualification, authenticated API integration, complete webhook event routing, scheduled account-wide reconciliation with genuine opening/external adjustments, operational exception handling and funded platform refund/dispute capacity. This journal accounts only for admitted marketplace actions; its cash account is not claimed to equal an unrelated pre-existing full Stripe balance without that reconciliation.

## Focused qualification

Node22.16.0 from `/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node`; actual lead-owned SQLite store. The current owned test set has19 groups:12 finance,2 journal,3 provider-HTTP mapping and2 raw-webhook groups. The first18 passed together; after the final dispute/refund constraint and in-flight payout correction test,12 finance groups passed and the3 changed provider groups passed. Unchanged journal/webhook evidence is reused. No broad R1 suites or real provider calls were run.

Material cases: unsafe/cumulative cents, independent-book balancing and journal mutation; exact account/mode/amount/order/object/charge bindings; duplicate settlement; restart after lost create response; same-intent dispatch contention; exact partial refunds and component caps; separate bounded reversals; pending connected funds; payout reservation contention; capability loss and explicit holds; payout failure before and after paid; disputes/refunds after payout with honest unpaid recovery; canceled-payment zero-funds proof; original-byte HMAC, old/future timestamps and duplicate/out-of-order events; Stripe-shaped two-book transfer/reversal/refund/payout and rejected live/foreign/mismatched objects.

## Official Stripe references consulted

- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) and [manual payouts](https://docs.stripe.com/connect/manual-payouts): transfers and bank payouts are separate; availability and holding limits need actual configuration.
- [Marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes): platform debit responsibility and separate recovery after an indirect-charge refund.
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests): durable domain intent outlives provider idempotency retention.
- [Webhooks](https://docs.stripe.com/webhooks): original bytes, event duplication/order and current-object retrieval.
- [Payout object](https://docs.stripe.com/api/payouts/object), [transfer object](https://docs.stripe.com/api/transfers/object), [reversal object](https://docs.stripe.com/api/transfer_reversals/object), [refund object](https://docs.stripe.com/api/refunds/object): parent/destination/balance transaction fields. Refund/reversal test mode is independently bound through their retrieved charge/transfer because those objects do not supply the same livemode field.

The finance specialist made no shared-file edits or commits. The lead owns SESSION_LOG, integration, package exports/scripts and the final source checkpoint.

## Narrow integration review

Finance specialist independently read the lead-owned service/store/reservation/fulfillment composition after implementation. No additional duplicate-money or uncertain-payment release defect was found in the reviewed paths: preparation and reservation binding are atomic; settlement re-reads the retained exact payment; canceled reservation release requires terminal-unpaid evidence; payout identity includes the seller; dispatch is durably single-use; current capabilities and balance are refreshed before withdrawal.

Two return-flow integration gaps were reported to the lead for resolution: the service initially exposed no refund prepare/dispatch/reconcile method, and `REFUND_REQUIRED` closure initially accepted any successful refund for the order without matching that case's approved amount/allocation. Those are review findings at this checkpoint, not a claim that later lead corrections are absent. The lead owns correction evidence and aggregate qualification. No shared source was edited by this specialist.
