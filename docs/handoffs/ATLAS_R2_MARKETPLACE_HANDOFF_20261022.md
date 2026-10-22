# ATLAS R2 parallel lead handoff — October 22 continuation

## Source and ownership

Isolated worktree `/Users/markthomas/.codex/worktrees/atlas-r2-marketplace-pilot/ten-kings-mystery-packs-clean`, branch `codex/atlas-r2-marketplace-pilot`, foundation base `5132a2c2e40b6d1d1aa8e378aa21c4d05f9e9ee5`. Initial R2 checkpoint `d2945cd22f3034d4649ece5d2f0ed24cc5f1bc61`. The external `R2_IMPLEMENTATION_HANDOFF.md` records the continuation commit and evidence manifest without a self-referential hash.

Exactly two original Astra/xHigh specialists completed complementary listing/auth/public-interface and finance/provider/recovery implementation. No additional agent or sidebar chat was created. The lead model setting was not exposed for changing or verification; no switch is claimed. Original dirty checkout and R1 integration source were not edited. All non-document changes are inside `packages/atlas-marketplace`.

**Shared production operations remain R1-owned.** No shared schema, roles, migration manifest, deploy, restart, provider production configuration or release lock was changed. Grading, report/label/photo behavior and Ten Kings remain untouched. Ownership claims and customer ownership history are always disabled; real authority fails closed pending Fingerprint and separate title/consignment/custody policy evidence. Fingerprint alone is insufficient activation authority.

## Implemented continuation

- Public GET catalog/UI with all typed facets, price conversion, paging/empty/retry states, exact Front/Back/report projection and scoped sign-in handoff.
- Seller ask/fee/net, price revision/withdrawal and buyer reservation cancellation/expiry, with immutable evidence/policy/quote bindings and financial-exposure refusal.
- Customer/staff workspace, strict role/CSRF/admission projections, exact signed-request preservation and explicit R1 auth bridge. Existing REVIEWER capability only; OBSERVER cannot receive write rights. Two short authority checks bracket provider work without retaining an R1 lock.
- Ephemeral buyer/reservation-bound Stripe Payment Element confirmation/return handling, prebound Connect onboarding, explicit test/live authorization, exact raw webhooks, original payment/order settlement and finance holds on physical commitments.
- Integer-cent independent platform/connected journals; payment/transfer/refund/reversal/payout and failure/dispute reconciliation; reviewed openings, external suspense and fresh two-account reconciliation before withdrawals.
- Default-off bounded GET-only recovery runner with durable overlap/expiry receipts and affected original payment IDs for host settlement. No scheduler, replacement financial action or automatic exception resolution.
- Separate function-only PostgreSQL persistence/proposal with per-acquisition effective-privilege qualification; retained local SQLite implementation and explicitly synthetic preview.
- Staff fulfillment/protection/refund evidence UI, seller bank readiness and USD balance, production-only metrics with synthetic activity excluded.

## Interfaces R1 must supply and qualify

| Interface | Explicit requirement |
| --- | --- |
| Permanent card evidence | Card/certificate identity, exact approved report version/hash and Front/Back object/hash/dimensions. Changed evidence cannot silently rebind a listing/order. Public bytes need a separately qualified read-only projection/reader. |
| Seller authority | Independent current title, consignment, Hold and list consent, ATLAS custody and seller/account evidence. R1 staff/submission/display/holder facts are never sale authority. `authority-r1.mjs` currently returns unavailable for real eligibility. |
| Authentication | Canonical R1 instances, approved audience/role policy and genuine original request. The guarded `sql/r1-session-access-proposal.sql` must be reviewed and registered as a passive customer gateway by R1; it is unapplied. Signed transport allowlists/routes remain unchanged. |
| Mounted routes | Public `/marketplace/`; customer workspace/API beneath existing `/account` cookie scope; staff workspace/API beneath existing staff cookie scope. Configure explicit `mountPath`/`apiPath`; do not widen cookies or bypass signed ingress. |
| Persistence | Review `sql/proposal.sql` separately. Runtime writer can execute exactly three owned SECURITY DEFINER gateways with sole `search_path=pg_catalog`, no unrelated data/column/schema/function rights. Actual integration must provision and qualify exact roles. |
| Financial policy | Versioned approved fee/tax/shipping/returns/reserve/release/payout/recovery/authority references and funded refund/dispute capacity. Proposed8% is not approved. Fixture amounts/timing establish no production terms. |
| Provider | Exact approved platform/connected allowlist, test/live mode, pinned API version, private key, webhook secret and allowed HTTPS onboarding returns. Provider payout eligibility does not establish actual bank ownership. |
| Durable operations | Run the bounded recovery runner under qualified server identity. Feed affected payment IDs to `service.reconcileFinance` in batches<=100 with genuine STAFF authority; this settles exact originals and preserves financial holds. Persist/alert on REVIEW_REQUIRED, ERROR, INTERRUPTED and stale reports. Never discard uncertain state or replace an intent. |
| Physical evidence | Trusted evidence validation for consent, packing/dispatch/delivery/release, refund review and case closure. Actual fitted insert/two seals/label area/resale instructions/replacement kit, tracking/coverage and inspected-return acceptance. |
| Comp guidance | Current copied curation receipt, selected sold facts, method/date/count/range and approved usage rights. Unresolved rights remain unavailable; refresh cannot rewrite reports or seller asks. |

## Verified evidence to reuse

Final Node22.16.0 package run: **147 passing tests across121 top-level groups**, zero failures/skips. `continuation/r2-continuation-tests.tap`. Includes SQLite multiprocess contention/reopen and focused mocked provider/auth/HTTP/UI risks; these are not actual Stripe transactions. Original45-group source evidence remains historical.

Actual owned PostgreSQL17 qualification: competing transactions, rollback, async-reducer refusal, reopen/restart and full synthetic sale-to-payout; six journals/21 events, unchanged unrelated sentinel. Subsequent17 temporary privilege/function drift cases rolled back and preserved hash `cf8055d0ca00b3bc057f5387a38cc5ecfffc8389991b184ca625572319bb7c0e`. Receipts `r2-postgres-qualification.json` and `r2-postgres-qualification-privilege-drift.json`. Exact QA cluster stopped; TCP was disabled.

Actual Chrome: historical local-demo-02 completed$125 ask→$147 buyer total→$120 paid out. Continuation local-demo-03 verified revise/cancel/retry, early appeal and a truthful insufficient-cash refund hold. Saved refund remains pending; no hidden capital. Workspace and new public catalog inspected at320×740 with documentWidth320, loaded600px Back and no captured console errors. Public exact-price exclusion and account-path handoff passed. Responsive browser preview is not physical-phone performance acceptance. Evidence lives in the external `continuation/` directory.

Preserve valid existing R1 build/schema/grading evidence within its original source bounds; no unchanged broad R1 suite was rerun. Owner-reported desktop/phone Front/Back/3D/report/return success stays an owner report. The deferred Shaquille Workspace geometry issue is untouched.

## Stripe status and exact next step

Dedicated **ATLAS R2 Marketplace QA** sandbox platform `acct_1UTTwXKDyZHjIV6p`; live settings were not copied. Connect platform setup complete under explicit owner approvals. Synthetic seller `acct_1UTUO8KDyZ4wwGG0` uses official Stripe test identity and STRIPE TEST BANK ending6789. Owner approved final connected-account agreement, disclosure and test-phone consent. Stripe confirmed **Information submitted**; screenshot `r2-stripe-seller-submitted.png`.

The dashboard then redirected to sign-in. Owner was asked to sign back in; no keys were acquired. Submission does not prove active transfers/payouts/manual schedule. No actual Stripe API payment/refund/transfer/payout or signed delivery has run.

After sign-in: inspect exact sandbox seller capabilities and manual payout configuration; safely retain only the sandbox test credential in an external mode0600 file without printing it. Use `scripts/qualify-stripe-sandbox.mjs` and the finance audit's exact private plan schema to qualify the original payment, actual balances/fees, transfer, partial refund/reversal and bank outcome. Test amounts and operational references must remain explicitly synthetic, never copied into production approval. Preserve/reconcile the original checkpoint if a response is lost. Qualify browser Elements/redirect/SCA and raw provider webhook delivery separately; server fixture confirmation does not cover them.

## Release gate

Master ID27 remains open. Real transaction acceptance requires genuine authority, approved commercial/provider/physical inputs, qualified shared auth/storage/operations and actual test/live payment acceptance. R3 offers, dealer/direct shipping, expanded social and spending proceeds remain excluded. Review/cherry-pick only this additive checkpoint into the final R1 successor, reconcile documentation overlaps intentionally, and keep runtime registration disabled until R1 coordinates production activation.

See [integration audit](../atlas/audits/2026-10-22/r2-marketplace-pilot.md), [auth bridge](../atlas/audits/2026-10-22/r2-auth-r1-bridge.md), [listing audit](../atlas/audits/2026-10-22/r2-listing-implementation.md), [finance audit](../atlas/audits/2026-10-22/r2-finance-implementation.md), and [run instructions](../../packages/atlas-marketplace/README.md).
