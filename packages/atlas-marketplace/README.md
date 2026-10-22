# ATLAS R2 marketplace pilot

Default-off, isolated implementation of an ATLAS-held fixed-price marketplace. Nothing in this package registers routes, applies shared migrations, reads grading credentials, schedules jobs or changes grading/Ten Kings. Ownership claims and customer ownership history remain disabled pending Fingerprint and separate authority/policy approval.

## Local preview and tests

Use Node 22.16.0 or later with `node:sqlite`, from the repository root:

```sh
node --test packages/atlas-marketplace/test/*.test.mjs
mkdir -m 700 /absolute/owned/new-demo-directory
node packages/atlas-marketplace/scripts/demo-server.mjs --synthetic-local --data-dir /absolute/owned/new-demo-directory
```

The server prints its random loopback URL. `/` is the explicit synthetic seller/buyer/staff workspace; `/marketplace/` is the public catalog. The directory must exist, be absolute and resolve without symlink parents. Reopening it retains original intents and provider state. Use a new directory for a fresh demonstration; never erase uncertain financial state to retry. Stop with Ctrl-C. The public sign-in link targets the intended `/account/marketplace/` integration mount, which the standalone demo does not implement.

The demo uses synthetic identities, artwork, policy and provider effects. The illustrative $5 fee, $12 shipping, $10 tax and zero return window are fixtures. No actual customer, inventory, shipment or money is involved. The proposed production 8% fee remains unapproved.

## Implemented boundaries

| Component | Contract |
| --- | --- |
| `service.mjs` | Async composition over atomic reducers; explicit policy/evidence/provider ports. Non-local environments require matching server qualification bindings. |
| `authority-context.mjs`, `authority-r1.mjs` | Separate synthetic/sandbox/production identity and evidence contracts. R1 copied owner/display facts do not establish sale authority; unresolved title/consignment/custody fails closed. |
| `listing.mjs`, `reservation.mjs` | Frozen identity, Front/Back/report, policies and quote. Price revision/withdrawal use exact version/hash and reject financial exposure. Atomic reservation, untouched cancellation and conservative expiry. |
| `public-http.mjs`, `runtime-public-node.mjs` | Default-off session-free GET catalog; mandatory request admission, typed facets and a closed public projection. No financial commands. Exact public media/report access requires a qualified host reader. |
| `http.mjs`, `runtime-node.mjs`, `auth-r1.mjs` | Mounted account/staff workspace, exact Host/Origin/CSRF, opaque per-request authorization and role projections. Preserve the original request/socket. Short R1 authority checks before/after I/O; no R1 lock across Stripe calls. |
| `provider-stripe.mjs`, `payment.mjs` | Explicit account/mode/API authorization; buyer-bound ephemeral Payment Element collection, prebound Connect onboarding, once-only dispatch, exact original retrieval/discovery. Unknown outcomes never create a replacement. |
| `ledger.mjs`, `finance.mjs`, `reconciliation.mjs` | Integer-cent append-only journal; separate platform and connected books; exact refunds/reversals, disputes, capability loss and failed payouts; reviewed opening balances and two-account reconciliation before cash-out. |
| `fulfillment.mjs` | Purchased policy and retained physical evidence. Packing/dispatch/release stop on financial or protection holds. Delivery observations can still be recorded. Exact reviewed refund obligation must reconcile before case closure. |
| `store.mjs`, `store-postgres.mjs` | Owned local SQLite and separate function-only PostgreSQL adapter/proposal. PostgreSQL rechecks role, effective database-wide privileges, exact gateway ownership and search paths on every acquisition. |
| `ui/` | Public filters, exact card evidence, seller listing lifecycle, buyer quote/reservation/payment, staff fulfillment/refund queue, USD proceeds and bank-payout status. Synthetic controls exist only in the local demo mode. |

`ui/workspace.html` loads relative assets. Configure customer routes inside the existing `/account` cookie path and staff routes inside the existing staff cookie path; pass matching `mountPath` and `apiPath`. `auth-r1.mjs` takes canonical R1 class instances and explicit audience/role policy. REVIEWER alone can map to STAFF; OBSERVER is refused. The customer passive-session gateway in `sql/r1-session-access-proposal.sql` is intentionally guarded and unapplied. Shared signed-ingress allowlists and route registration remain R1 integration work.

The hosted Stripe UI can confirm only its original buyer/reservation capability. Client secrets stay ephemeral and are removed from return URLs before application reads. Raw webhook verification uses the exact received bytes; payment and early-dispute events settle the original order without requiring a buyer return. A financial review hold is preserved while settlement completes.

Stripe payout eligibility is not proof of bank ownership. Actual account capability, manual payout schedule, supported bank destination and fresh platform/connected reconciliation are independently required. A provider outage leaves saved work visible and removes payout readiness. ATLAS Balance represents USD sale proceeds; it has no connection to Ten Kings TKD. Spending proceeds, dealer/direct shipping, offers and instant payout remain outside this pilot.

## Qualification and integration

The original 45-group checkpoint and desktop synthetic sale-to-payout remain retained historical evidence. Continuation evidence adds actual PostgreSQL 17 contention/restart and 17 transactional privilege-drift checks, authenticated HTTP and original-request boundaries, actual Chrome 320px workspace inspection, and the public catalog. Tests that inject Stripe HTTP responses are explicitly mocked.

The owner-created ATLAS R2 Marketplace QA sandbox is isolated from the live grading account. Connect platform setup and synthetic seller agreement submission are complete; submission alone is not proof of enabled capabilities. The dedicated, resumable CLI `scripts/qualify-stripe-sandbox.mjs` binds only that sandbox and test keys. Its exact private-file/plan schema and safe invocation are documented in the [finance audit](../../docs/atlas/audits/2026-10-22/r2-finance-implementation.md). Never copy test-plan references into live approval or treat a test payout as real bank settlement.

Use the current [lead handoff](../../docs/handoffs/ATLAS_R2_MARKETPLACE_HANDOFF_20261022.md), [integration audit](../../docs/atlas/audits/2026-10-22/r2-marketplace-pilot.md), [auth bridge](../../docs/atlas/audits/2026-10-22/r2-auth-r1-bridge.md), [listing interface](../../docs/atlas/audits/2026-10-22/r2-listing-implementation.md) and finance audit for exact evidence and open gates. Shared production operations remain with the R1 lead. A flag change alone cannot supply real authority, legal terms, infrastructure qualification or physical acceptance.
