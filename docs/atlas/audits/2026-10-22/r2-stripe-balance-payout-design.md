# R2 Stripe, ATLAS Balance and cash-out proposal

**Later local implementation:** The proposed isolated ledger/intent increment is now implemented in `packages/atlas-marketplace` with45 focused checks and synthetic desktop acceptance. See [R2 implementation](r2-marketplace-pilot.md) and [finance contract](r2-finance-implementation.md). Actual Stripe sandbox/provider acceptance and every real activation gate below remain pending. The design review that follows is historical; its statement about no implementation describes the time of that review.

Read-only design review, October 22, 2026. This is a proposed ATLAS-held, fixed-price pilot flow, not an activated payment contract or provider qualification. R1 foundation work continues independently. The proposed **8% including ordinary domestic processing remains unfinalized**; no fee, release period or reserve percentage is chosen here.

## Existing source and decisions

The [master plan](../../plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md), requirements 16–23, 27 and 29, calls for verified seller/consignment authority, actual ATLAS custody, exact fee/net review, buyer protection and real USD proceeds followed by verified bank cash-out. Spending proceeds on purchases remains R3 and provider-approved; ATLAS Balance is separate from Ten Kings TKD.

Existing [commerce integration](../../../../packages/atlas-commerce/INTEGRATION.md) serves grading submissions and shipping. In [contract.mjs](../../../../packages/atlas-commerce/src/contract.mjs), `SERVICE` and `assertCheckout` describe MAIL_IN/KIOSK grading; `assertPaidEvidence` verifies exact provider/merchant/amount/quote. [providers.mjs](../../../../packages/atlas-commerce/src/providers.mjs) creates PaymentIntents, tax transactions and shipping effects; [service.mjs](../../../../packages/atlas-commerce/src/service.mjs) preserves unresolved payment attempts; [webhook.mjs](../../../../packages/atlas-commerce/src/webhook.mjs) verifies raw events and retrieves the payment before confirming. The [SQL proposal](../../../../packages/atlas-commerce/sql/proposal.sql) has quotes/payments/orders/effects, not seller proceeds accounts or Connect transfers/payouts. These are useful design precedents, not a marketplace implementation or permission to reuse grading credentials, queues or runtime.

## Recommended flow, subject to the decisions below

Recommend **separate charges and transfers** if ATLAS deliberately retains the seller transfer until its defined fulfillment/protection milestone. Stripe supports a platform charge followed by a separate connected-account transfer; that extra complexity is justified only by a genuine transfer-delay requirement. If the final policy needs immediate seller transfer with only bank payout delayed, destination charges are the simpler alternative. This is a design inference from [Stripe charge types](https://docs.stripe.com/connect/charges), not an approved ATLAS configuration.

1. Before listing, bind the verified owner and signed consignment, exact approved card/report, physical custody and eligible seller Connect account. Before payment, atomically reserve the one listing, freeze buyer total, seller net, fee-policy version, taxes, shipping and protection terms. Concurrent buyers cannot reserve it twice.
2. Collect the buyer payment on the approved platform configuration. Confirm the retrieved provider payment and durable order before fulfillment or earnings; a browser success redirect is insufficient. Display seller proceeds as Pending while settlement, release criteria or transfer remain unresolved.
3. At the explicitly approved release milestone, transfer the exact seller net once to that seller's connected Stripe account. Link charge, order, seller and transfer identities. Record the fee as the agreed retained amount; an inclusive-processing fee must not silently deduct processing a second time from the seller. Keep tax/shipping allocations separate.
4. Cash out from the connected account's available USD balance to its verified eligible external bank account. **Transfer moves money between Stripe accounts; payout moves it to a bank/external account.** Recommend standard manual payouts for an explicit Cash out action only where the account configuration permits platform control. Show provider-informed timing, not an instant guarantee. [Stripe manual payouts](https://docs.stripe.com/connect/manual-payouts), [payout configuration and events](https://docs.stripe.com/connect/marketplace/tasks/payout).

ATLAS Balance should describe sale proceeds and their status, not a bank/deposit account. Stripe does not provide escrow; country-specific holding limits apply. Adopt an explicit timely payout/failed-withdrawal resolution policy, not indefinite parking. Do not infer access to a segregated-funds preview or a spending wallet. Instant payout remains optional only after platform, country, currency, connected-account, external-account and amount eligibility plus disclosed fees are verified. [Manual payout limits](https://docs.stripe.com/connect/manual-payouts), [Instant Payouts eligibility](https://docs.stripe.com/connect/instant-payouts).

## Proposed USD ledger and recovery

Use integer cents, immutable balanced journal entries and account-specific proceeds allocations. Track where funds actually sit separately from the UI status; moving the same earnings between platform, connected account and bank never creates earnings twice. Platform books distinguish cash/clearing, seller payable, fee revenue, processor cost and tax/shipping liabilities. Connected-account movements require their own reconciliation; they are not extra platform cash. Accounting treatment needs review against the selected legal arrangement.

| Customer label | Required evidence and boundary |
| --- | --- |
| Pending | Confirmed sale allocation awaiting settlement, release or transfer; not spendable/withdrawable. An unconfirmed payment is not earnings. |
| Available | Released allocation reconciled to the seller's connected available USD funds, less restrictions, reservations and in-flight withdrawals. Never use the platform's aggregate balance as one seller's money. |
| Reserved | Explicit reason, amount and policy/case reference; separate a disputed/held allocation from a new withdrawal reservation. No invented release date. |
| Withdrawal processing | One durable payout intent/request and allocation reservation; lost response stays unresolved until exact reconciliation. |
| Paid out | Retrieved payout status and reconciliation support completion; retain later failure/correction history rather than treating it as irreversible. |

Stripe's pending/available balances are distinct from these ATLAS business states. [Connect balances](https://docs.stripe.com/connect/account-balances). Persist provider account/live-mode, object and balance-transaction IDs, currency, gross/fee/net, availability date, event IDs and raw-evidence hash. Reconcile platform and connected balances plus payouts daily and after relevant events; expose exceptions and prevent excess cash-out. Manual payouts need an internal allocation map: Stripe's balance-transaction `payout` filter applies only to automatic payouts. [Balance transaction API](https://docs.stripe.com/api/balance_transactions/list).

Each charge/transfer/refund/reversal/payout gets its own immutable intent and provider idempotency identity. Unknown results never unlock funds or create a fresh money movement; reconcile the original object first. Provider idempotency is not a permanent ledger—v1 keys may be pruned after 24 hours. Verify original webhook bytes, deduplicate and tolerate out-of-order events; object retrieval and journal uniqueness establish state. [Idempotency](https://docs.stripe.com/api/idempotent_requests), [webhooks](https://docs.stripe.com/webhooks).

## Responsibilities and remaining decisions

For indirect charges Stripe debits platform funds for refunds/disputes and associated costs. Refunding a separate charge does **not** reverse its transfer automatically. Model refund and seller recovery as distinct reconciled operations; never promise successful reversal after cash-out. ATLAS needs funded loss/refund capacity, dispute evidence/deadline handling, inspected-return rules and a contractual seller recovery policy. A delivery/release milestone does not end later dispute exposure. [Stripe marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes).

Before pilot activation, resolve:

- Actual platform/connected-account country, legal seller/merchant-of-record and consignment roles, tax collection/reporting, `on_behalf_of` choice, customer statement and refund contact. No API parameter alone decides these obligations.
- Provider acceptance of the actual collectibles business and flow; account/controller/API-version model, onboarding/terms, active required capabilities, payout permission and verified external account. Phone sign-in or card ownership is not financial onboarding. Monitor requirements and restrictions continuously. [Connect verification requirements](https://docs.stripe.com/connect/handling-api-verification).
- Fee basis/rounding and real processing/Connect/payout/refund/dispute economics. Keep 8% a proposal; decide treatment of tax/shipping, low/high-value sales and partial refunds before showing a binding net.
- Exact custody, insured dispatch, delivery/inspection/return milestone, bounded transfer/payout timing, reserves, failed-bank recovery and seller loss allocation. No duration or percentage is invented here.

The next implementation can be an isolated, default-off marketplace ledger/intent contract and synthetic reconciliation tests: simultaneous checkout, lost/duplicate/out-of-order results, partial refund before/after transfer, payout failure, capability loss and dispute after payout. Live onboarding, real provider sandbox qualification and a controlled operational pilot are separate gates. This review performed only repository reads and official Stripe documentation browsing; no credentials, account inspection, money movement, code/runtime change or grading execution.
