# Successor note

The remaining-engineering increment adds explicitly configured durable verified ingress, bounded worker replay, staff incident review and optional instant payouts. See `r2-completion-engineering.md` and `r2-durable-ingress-instant-payout.md` for new interfaces and evidence. The original configuration/checks below remain historical unless explicitly extended there. No hosted or live qualification is implied.

# R2 hosted finance readiness and R1 verification packet

Status: implementation candidate, disabled by default. This continuation used local synthetic fixtures only. It did not register an endpoint, start a hosted worker, send an external alert, read credentials, call Stripe, create another financial action, change environment, migrate a database or deploy. R1 owns all shared runtime operations. No hosted sandbox or production qualification is claimed.

The accepted actual sandbox evidence remains `continuation/r2-provider-qualification.json`, `r2-stripe-finance-final.json`, `r2-stripe-payout-review.json`, `r2-stripe-sca-evidence.json` and `r2-stripe-sca03-webhook-receipts.json` under the external R2 handoff. Plan01's five originals were confirmed with dispatch count one and both account differences zero; its historical reversal/payout HTTP 409 deliveries remain historical failures recovered by GET. Plan03 separately proved the native 3DS challenge and signed CLI forwarding. Those are provider/accounting and local transport proofs; they are not hosted endpoint, R1 authorization or physical-custody evidence. No charge needs repeating to restate them.

## Code and exact server contracts

- `src/host-finance.mjs`: `createHostedFinance({enabled:false,store,provider,service,settlementCapability,config,assertRuntimeReady,alertSender?,timers?})`. Enabling is an explicit server decision. Construction performs synchronous qualification checks only; it does not fetch, register, listen or start timers. The returned ports are `receiveProviderWebhook({rawBody,signature})`, `runOnce({runId,signal?})`, `start()`, `stop()`, `snapshot()` and immutable `binding`.
- `assertHostedFinanceBinding(finance,{store,provider,service,settlementCapability,environment,platformAccountId})` checks an opaque in-process brand and exact dependency identities, then fresh readiness. A copied object or JSON cannot reconstruct it. `host-r1.mjs` consumes this before attaching its staff raw webhook receiver.
- Root's `createRecoverySettlementCapability` and `service.settleRecoveredPayments(capability,{intentIds})` perform the retained payment-to-order commit. The capability is separately approved and bound to the exact raw store, environment and platform. Only terminal, independently reconciled original PAYMENT IDs qualify; no STAFF actor is invented. Recovery filters affected IDs and passes unique batches of at most 100. An early dispute can settle the original payment and still hold fulfillment.
- `service.getHostedWebhookBinding()` is a server-only configuration port, with no HTTP route. It returns `{environment,platformAccountId,endpoints:[{id,scope}],configurationHash}`. The digest binds the credential generation without exposing a secret. Hosted finance pins this result and refuses drift.
- `assertRuntimeReady({...config,webhookBinding})` must synchronously return exactly `true`, based on independently retained approval and runtime evidence. An approval reference by itself is not authority. Readiness is rechecked at each entry, each recovery admission, settlement and alert operation. Unexpected asynchronous readiness is refused and its rejection consumed.
- Provider reads required by recovery are `getIdentity`, `retrieve`, `discover`, `getAccountSnapshot`, `listBalanceTransactions`. Identity must match environment, platform, mode and the complete connected-account allowlist. No provider create, confirmation, refund/transfer/payout create, onboarding or adjustment capability enters the recovery runner.

Exact config keys, with **proposed hosted-sandbox verification bounds only** (these numbers are not approved production policy):

```js
{
  environment: 'PROVIDER_SANDBOX',
  platformAccountId: 'acct_1UTTwXKDyZHjIV6p',
  connectedAccountIds: ['acct_1UTUO8KDyZ4wwGG0'],
  activationRef: /* independently approved hosted activation record */,
  operationsRef: /* independently approved operator/incident record */,
  qualificationRefs: {
    fingerprintRef: /* same exact context binding, not fabricated availability */,
    titlePolicyRef: /* independently approved context record */,
    marketplacePolicyRef: /* independently approved context record */,
    evidenceContractRef: /* independently approved context record */
  },
  recovery: {
    approvalRef: /* GET-only original recovery approval */,
    maxItems: 25, concurrency: 2, maxEvidenceAgeMs: 60000,
    maxDurationMs: 60000
  },
  finalizationBudgetMs: 10000,
  schedule: { intervalMs: 60000, pollIntervalMs: 1000, leaseMs: 71000 },
  alerts: {
    approvalRef: /* approved idempotent sender and incident scope */,
    destinationRef: /* approved private operations destination */,
    maxItems: 10, leaseMs: 10000,
    staleIntentMs: 900000, staleReportMs: 300000
  }
}
```

`qualificationRefs` must exactly match the independently qualified authority context. R1 currently does not supply sale/title/Fingerprint authority; the compatibility adapter stays unavailable. Neither this packet nor finance activation can promote a collection card/report into sale authority. Production additionally needs its own platform/accounts, live-key qualification, policy/authority and release approvals. The sandbox account IDs cannot be relabeled as production.

The host checks a lease of at least `recovery.maxDurationMs + finalizationBudgetMs + 1000`. Recovery bounds are 1–500 items, 1–8 concurrent operations, 1–300000 ms observation age and 1000–300000 ms admission duration. Finalization is 1–60000 ms. Alert batch size is 1–100; transport lease/timeout is 1000–300000 ms. All are supplied explicitly. No cadence or threshold cancels an unpaid intent or releases a card.

## Signed raw ingress: two scopes, one exact route

R1 candidate route, subject to its explicit route binding: `POST https://atlasgrading.com/admin/marketplace/api/provider/webhook`, with staff mount `/admin/marketplace/` and staff API path `/admin/marketplace/api`. If R1 chooses another approved mount, derive the URL as the exact configured `routes.staff.apiPath + '/provider/webhook'` and requalify that complete binding; do not register an assumed URL.

Two separately registered Stripe sandbox snapshot destinations are required: Your account / platform scope, and Connected accounts / Connect scope. Each destination has its own signing secret. Configure the service with:

```js
webhook: {
  endpoints: [
    {id: /* retained platform destination/generation ID */, scope: 'PLATFORM', secret: /* private endpoint secret */},
    {id: /* retained Connect destination/generation ID */, scope: 'CONNECTED', secret: /* private endpoint secret */}
  ],
  resolveDisputePolicy: /* independently qualified, exact order policy port */
}
```

The bounded list supports at most four unique ID/secret entries, permitting two credential generations per scope. A rotation entry uses its own retained generation ID; preserve the actual Stripe endpoint ID in the activation evidence. Mixed `secret` plus `endpoints` configuration, duplicate keys/IDs and unknown scopes are refused. Legacy single-secret fixture service configuration cannot enter hosted composition. Rebuild/reapprove the host after rotating; an already constructed host refuses a changed endpoint configuration digest.

The verifier checks original bytes and timestamped HMAC before any store/provider access. It never lets a body field select a key. Only a successfully matched endpoint can authorize scope: absent/platform `event.account` requires PLATFORM; a distinct valid connected account requires CONNECTED and then the existing account allowlist/original binding. The event's `livemode` must match the server environment. Bad signatures, wrong modes and endpoint-scope failures do not persist attacker payloads or trigger financial reads. Body/signature/error-message values are not retained in operational alerts.

R1 must preserve raw bytes through TLS termination and request handling, preserve `Stripe-Signature`, and permit this exact route to reach the raw-signature handler without customer/staff cookies or CSRF. Do not exempt surrounding staff routes. Current Node transport caps the raw body at 262144 bytes; the finance verifier independently caps it at 1048576. Exact origin/Host and upstream deployment Host pins remain R1's boundary. No request rewriting, URL query, proxy-trust widening or global middleware bypass is implied.

Use snapshot events with the pinned tested API contract `2025-03-31.basil` where the registered destination supports it, and retain the actual destination version. Existing CLI proof used a newer event payload version while financial truth came from pinned GETs. An event destination must not silently change versions: raw hash conflicts are refused, and object facts always come from current GET evidence. Thin-event notifications are outside this receiver contract.

Candidate subscription packet (R1 must validate selected event names in its endpoint setup; do not subscribe to every Stripe product):

| Destination | Event families used by the existing handler |
|---|---|
| Platform | `payment_intent.processing`, `payment_intent.requires_action`, `payment_intent.payment_failed`, `payment_intent.succeeded`, `payment_intent.canceled`; `refund.created`, `refund.updated`, `refund.failed`; `charge.refunded`; `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`; `transfer.created`, `transfer.updated`, `transfer.reversed`; `balance.available` |
| Connected | `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`; `account.updated`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `capability.updated`, `person.updated`, `account.application.deauthorized`; `balance.available` |

Unknown/unsupported financial notifications remain operator review, not silent success. Aggregate refund/reversal events retrieve exact related originals; missing/foreign actions open exceptions. Account capability loss remains a hold. A payout destination's Stripe payout-eligible status does not prove independent bank ownership or approve a business withdrawal policy.

The current endpoint acknowledges only after durable finance reconciliation and original-payment settlement. This preserves retry correctness but can exceed a host's response budget for slow or large provider reads. Hosted verification **must measure latency and timeout behavior**. There is no implemented fast-ACK durable raw-event queue; do not claim one or return early while reconciliation is detached. Stripe redelivery and scheduled original GET recovery handle uncertainty, while the historical failed-delivery receipt stays visible.

## Recovery lifecycle, exact bounds and alerts

`start()` explicitly registers one process-local polling timer. A durable `financeSchedules` row owns the due slot using a token/expiry and monotonically numbered run. Duplicate processes sharing the store cannot claim the same active slot. Restart reads the retained next-due time; expired runs become INTERRUPTED, and no missed-interval burst is replayed. `stop()` removes the timer, aborts new admissions and joins the scheduled run. An operator's separate `runOnce` caller owns that call's abort/join lifecycle. During host shutdown, stop admitting ingress/operator calls and drain them before closing shared storage.

Recovery uses the original object ID or a complete, exactly bound discovery GET when the original create response was lost. It never creates another action. Original pending/unknown objects remain held until exact terminal evidence permits settlement. Both account reports still require genuine approved openings, complete inventories and matched cash; no starting balance, external adjustment, exception resolution or entitlement is invented by this worker.

The recovery deadline stops further provider admission and races read-only responses only. Late read results are discarded before they can reach reconciliation. Finalization has its own explicit remaining budget; no new settlement batch, alert scan or sender operation starts after the overall deadline. **The entire mutating runner or a store transaction is never raced away.** Already admitted database commits are joined and can extend response time within the qualified store's limits (current PG statements 15 s, locks 5 s; pool acquisition must also be qualified). The final durable run receipt is written even on interruption.

A host retains each timed-out provider transport slot until the underlying promise actually settles; all subsequent runs share the configured concurrency cap. The wrapper does not pretend it canceled an adapter that ignores cancellation. The current Stripe adapter bounds individual fetches at 20 s, but its admitted read operation may continue bounded pagination. Slots prevent repeated runs accumulating abandoned transport promises. `snapshot()` exposes only redacted `providerInFlightCount` and `alertTransportInFlightCount` plus bounded alert/schedule status. An external process-health monitor is still required for a dead process, hung database/pool or missing scheduler heartbeat; this code cannot alert while its own host is down.

Alert conditions include open finance exceptions, retained webhook review/retry receipts, stale financial intents, missing/stale/failed account reports, recovery review/errors and settlement failures. They are persisted in `financeOperationalAlerts` and `financeAlertOutbox`. Alerts are **sticky incidents**: a delivered alert remains OPEN; recurring observations update its last observation/evidence/reference without automatically sending a new message. There is no implicit resolution or rearm. The successor adds authenticated STAFF incident review with exact version/evidence binding, independent nonlocal review validation and immutable receipts. A subsequent observed recurrence creates a new delivery generation; prior uncertain deliveries stay lookup-only. Resolving a finance exception does not rewrite historical delivery failure or clear these alerts.

A sender is absent by default. A real sender must provide pinned `assertReady(binding)`, `send({idempotencyKey,alert,signal})` and `lookup({idempotencyKey,signal})`, qualified to the exact destination and approval. The only transmitted envelope is `{alertId,code,reference,evidenceHash,firstObservedAt}`. No balances, customer data, raw body, secret or error message is transmitted. The sender must return `{status:'DELIVERED',receiptId}` only with a durable delivery receipt.

The outbox claims before sending. Timeout, interruption or lost response becomes UNKNOWN with dispatch count one. Recovery uses lookup of that same key, including after restart; even NOT_FOUND does not authorize another send. Destination changes are refused for an existing delivery binding. Sender methods are pinned and rechecked. A noncooperative sender is raced to UNKNOWN and its transport slot remains occupied until actual completion; no later flush accumulates another transport. Delivered late responses after timeout are ignored and require lookup. Tests use local functions only; no external alert was sent.

## Exact R1 hosted-sandbox verification packet (not executed)

1. **Retain preflight identity.** Record R1 release/source manifest and additive R2 source hashes; approved origin/Host/mount pins; isolated sandbox database/role/function-owner grant qualification; immutable authority/policy hashes; both endpoint IDs, scopes, configured API versions and private secret references; recovery/settlement/alert approval bindings. Record platform `acct_1UTTwXKDyZHjIV6p`, connected `acct_1UTUO8KDyZ4wwGG0`, false livemode, exact allowed account list, manual payout scheduling, and relevant eligible bank `ba_1UTUrCKDyZ4wwGG03hLYFryn`. Never record keys or signing secrets in the packet.
2. **Preserve honest source state.** Retain both account opening/inventory histories and original intent/object bindings from authorized evidence. Do not import a finance-only qualification store and fabricate missing R1 reservations/orders to make service settlement pass. The historic money proof does not supply genuine listing/title/custody authority. Full joined checkout remains blocked until those independent records exist.
3. **Compose disabled first.** Construct R1 host/store/service and finance from the same exact dependencies. Validate brand and both scopes. Confirm no listener/timer/provider read or message occurs from imports/factory. Require actual qualification readiness ports, not `()=>true` outside fixtures. Confirm the raw receiver is present only on the approved staff provider route and authenticated routes retain original R1 authorization/CSRF.
4. **R1 alone activates the approved sandbox packet.** Provision/register only the separately approved sandbox resources and route after its required planned-action log; leave production and sale authority OFF. Start recovery explicitly only after store/opening/provider/sender qualification. Record the observed registration, URL, scopes and worker start. This document grants no deployment/credential permission.
5. **Prove hosted delivery without repeating money.** Where retained events remain eligible for provider resend, R1 may separately authorize resending a retained platform event and connected event to their exact new destinations. A `balance.available`/account observation can establish hosted signing transport without requiring a new charge; full original-payment-to-order settlement uses only a genuine retained original reservation/payment or a separate authorized joined pilot. If the retained event/fixture cannot satisfy that binding, record the gap rather than minting an order. Distinguish hosted Stripe delivery from CLI forwarding. Retain event ID/type/account/mode, destination ID/version, raw SHA-256, response status/time, received/reconciled times, exact original object/intent, dispatch counts and journal/account-report before/after hashes.
6. **Fault proofs.** Replay the same valid provider delivery with its fresh provider signature, and deliver an older event after a newer one. Confirm current GET truth and no duplicate journal/order. Send a locally fabricated bad signature and a correctly signed fixture with wrong endpoint scope/mode against an isolated test fixture; expect refusal with zero provider/store work. Prove transient GET failure returns non-2xx and durable retry evidence; restart a worker and recover the original by GET/discovery with dispatch one. Exercise whole-run deadline, concurrent duplicate workers, expired lease, missing opening/external movement, sender unknown/timeout/lookup and capability loss using fixtures; do not create another real charge/payout solely for these already covered risks.
7. **Reconcile and review.** Record exact two-account reports with status/difference/cash-hash/observation times and every OPEN exception. The operator explicitly reviews any resolution with its own evidence and authority. Confirm unknown objects remain reserved; disputed paid orders remain held; a fresh report does not erase a previous exception. Record any historical HTTP 409 as such even if GET recovery succeeds later. Verify the alert sender against an approved private test destination only under a separate explicit send authorization.
8. **Stop and rollback proof.** Stop scheduler, drain admitted ingress/operator calls, join scheduled ledger work, record residual transport-slot count, then close store/host. Confirm no timer remains and a disabled service refuses further actions. R1 controls endpoint pause/removal, route rollback and operational logs. Do not delete financial history, old receipts or exceptions as cleanup.

Minimum retained hosted receipt: source/config/binding hashes; qualified runtime and database refs; endpoint IDs/scope/version; test account IDs/mode; event IDs/raw hashes/HTTP timing; worker run IDs/status/selected original IDs/settled IDs; account reports/differences/evidence hashes; alert IDs/delivery status/receipt IDs; explicit reviews; restart/stop observations. Exclude credentials, raw webhook bodies, signatures, personal details and private endpoint secret values.

## Local verification completed

Focused Node 22 command: `node --test --test-reporter=spec test/host-finance.test.mjs test/finance-alerts.test.mjs test/finance-scheduler.test.mjs test/recovery.test.mjs test/webhook.test.mjs` from `packages/atlas-marketplace`.

Observed final result: **29 tests passed, 0 failed**, Node 22, approximately 1.25 seconds. No provider call or external message was made.

The focused groups cover raw-byte rejection, endpoint scope/rotation/mode, duplicate/delayed events, original settlement across actual SQLite reopen, lost-create discovery, unknown payable preservation, early-dispute fulfillment holds, exact capability/dependency brands, durable due/lease contention, stop/expiry fencing, bounded alert batches, unknown send lookup and no resend, destination/method drift, readiness revocation, deadline response discard and transport-slot retention across later runs. These are synthetic/local tests, not hosted or live qualification. Root retains the final joined-interface aggregate and source manifest separately.

## Official documentation consulted

Stripe distinguishes platform and connected-account destinations, including their account attribution; sandbox destinations must be configured separately. [Connect webhooks](https://docs.stripe.com/connect/webhooks), [Webhook endpoint API](https://docs.stripe.com/api/webhook_endpoints).

Stripe requires original bytes for signature checks and a secret per endpoint, supports overlapping secret rotation, and documents duplicate/out-of-order deliveries and separate automatic/manual retry behavior. Hosted HTTPS and response latency need their own proof. [Receive Stripe events](https://docs.stripe.com/webhooks).

Remaining external gates: R1-approved hosting/routing and dedicated database provisioning; both actual hosted sandbox destinations and latency receipts; independently qualified runtime/authority/policy bindings; qualified alert sender/destination and incident workflow; genuine joined auth/checkout/physical-pilot evidence. Production remains disabled and R1-owned.
