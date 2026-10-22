# ATLAS R2 marketplace pilot

Default-off, dependency-free local implementation for an ATLAS-held fixed-price marketplace. It does not register with any existing app, deployment, database manifest or grading/Ten Kings runtime. All local cards, actors, money and fulfillment evidence are explicitly synthetic. Claims and customer ownership history remain disabled.

## Run locally

Use Node 22.16.0 or later with `node:sqlite`. From the repository root:

```sh
node --test packages/atlas-marketplace/test/*.test.mjs
mkdir -m 700 /absolute/owned/new-demo-directory
node packages/atlas-marketplace/scripts/demo-server.mjs --synthetic-local --data-dir /absolute/owned/new-demo-directory
```

The server prints its random loopback URL. The owned directory must exist, be absolute and resolve without symlink parents. Stop with Ctrl-C. Reopening the same directory retains the original intents, provider fixture state and ledger. A fresh demonstration needs a new directory; do not erase an uncertain transaction to retry it. Existing R1/production servers are unrelated.

The page deliberately switches among local seller, buyer and staff fixtures. It is not production authentication. Its provider-simulation buttons move only the durable local simulator. It shows explicit Hold and list, exact fee/net, a complete buyer quote, one-card reservation, pending payment, fulfillment evidence, separate transfer settlement, balance states and bank-payout reconciliation. The illustrative $5 fee, $12 shipping, $10 tax and zero return-window are synthetic inputs, not approved terms. No real money can move through this demo.

## Boundaries

`service.mjs` composes synchronous domain reducers with async evidence/provider ports. `store.mjs` owns local SQLite `BEGIN IMMEDIATE`, append-only journal/event checks and hashed commit snapshots. This finite JSON snapshot store is for local qualification; it is not a production migration or scalable ledger service.

| Port | Required contract |
| --- | --- |
| Eligibility | Current, separate title, consignment, explicit hold consent, ATLAS custody and eligible seller/account evidence; permanent card/certificate and exact approved report/media/identity revision. Default adapter returns unavailable. |
| Listing/quote | Immutable source/policy/fulfillment-policy hash, seller-controlled integer-cent ask and agreed fee/net; server-derived tax/shipping/total, zero buyer premium and expiry. |
| R1 guidance | Explicitly supplied copied curation receipt and selected-sale provenance, current source binding and approved usage rights. Refresh appends a new receipt without changing report or asking price. Real unresolved rights remain unavailable. |
| Finance | Frozen reservation order; once-only durable intent before I/O; exact account/object/order/binding/currency/amount retrieval; balanced independent platform/connected books. |
| Fulfillment/protection | Exact purchased policy, paid order and recorded packing/tracking/delivery/release evidence. Cases can open before packing. Refund review binds immutable case amount, allocation and policy; only its confirmed refund closes the obligation. |
| Provider | `create`, `retrieve`, `getAccount`, `getBalance`; every uncertain result reconciles the same original intent. No automatic replacement or POST retry. |

The synthetic adapter requires `demo_` identities. A real R1 adapter, genuine auth and production persistence require separate implementation and qualification, not a flag change. Seller authority must never be inferred from staff access, grading submission, certificate knowledge or possession. Real ownership transfer writes are not implemented or enabled.

The Stripe sandbox adapter is opt-in, accepts an explicitly supplied test key and pinned account/API configuration, and is tested using injected HTTP fixtures only. No real sandbox session was run. It creates an unconfirmed PaymentIntent without exposing a client secret; real checkout collection/confirmation, Connect onboarding, complete webhook routing, operational reconciliation and exception handling remain integration work. Manual cash-out and transfer are separate. Spending proceeds, offers, dealer/direct shipping and instant payouts remain outside this pilot.

## Verification and handoff

The final local suite has 45 passing groups, including real SQLite multiprocess contention/reopen, uncertain payment/refund recovery, duplicate/out-of-order provider evidence, signed raw webhooks, capability loss, refund/reversal bounds, payout failure before/after paid and disputes after payout. Desktop Chrome completed the synthetic listing-to-paid-out flow. Mobile acceptance remains pending; no responsive screenshot is claimed.

See [lead handoff](../../docs/handoffs/ATLAS_R2_MARKETPLACE_HANDOFF_20261022.md), [integration audit](../../docs/atlas/audits/2026-10-22/r2-marketplace-pilot.md), [listing interface](../../docs/atlas/audits/2026-10-22/r2-listing-implementation.md) and [finance interface](../../docs/atlas/audits/2026-10-22/r2-finance-implementation.md). Shared production operations remain exclusively with the R1 lead.
