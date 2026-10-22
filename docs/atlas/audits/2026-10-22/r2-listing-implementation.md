# R2 local listing, eligibility, reservation and buyer/seller UI

October 22, 2026. Implemented only in the isolated `codex/atlas-r2-marketplace-pilot` worktree. This is a standalone local synthetic implementation, not a production marketplace, title process or Stripe qualification. The canonical master plan retains all 30 scope IDs. This slice advances IDs 05, 15–18, 25 and the listing/checkout part of 27; the lead owns integrated fulfillment, finance and remaining gates.

## Authority and preservation

`packages/atlas-marketplace` imports no grading or Ten Kings code, discovers no credentials, and changes no production route, migration manifest, environment, queue or runtime. Real eligibility returns unavailable by default. The sole implemented authority adapter explicitly requires local synthetic enablement and `demo_` card, seller, approval and account identities. Fingerprint readiness, approved title/consignment rules, provider acceptance and real operational evidence are still required before a separately qualified real adapter can exist. Claims and customer ownership history remain off.

The seller must have separate current title, active consignment, eligible account and recorded ATLAS physical custody. A staff assignment, submitted grading order, certificate, scan or possession alone does not satisfy these checks. The approved-card packet binds the existing permanent card/certificate, exact approval and report version/hash, both original-side object hashes/dimensions/URLs and approved identity. The local fixture uses newly authored, labelled synthetic SVGs and a synthetic report; the lead's local fixture hashes the actual served bytes. No real card is imported, initialized, reset, graded or repriced.

Explicit `HOLD_AND_LIST` consent is a separate persisted fact. Its current seller/card/evidence reference is checked at publication, reservation, initial payment preparation and resumed undispatched payment preparation. `SHIP_TO_ME` never grants listing eligibility. The demo records a choice; it cannot cause a physical shipment.

## Module interfaces

All mutations take the lead's synchronous `tx` first. Its actual local SQLite store owns atomic `BEGIN IMMEDIATE`, persisted state and append-only commit/event evidence. No domain reducer performs asynchronous I/O.

- `eligibility.mjs`: `assertApprovedCard`, `assertEligibility`, `eligibilityBinding`, `createUnavailableEligibilityAdapter`, and explicitly enabled `createSyntheticEligibilityAdapter`. External authority is read outside a transaction, then exact short-lived assertion and binding are rechecked inside it.
- `listing.mjs`: `createListing(tx, {requestId, listingId, sellerId, askingPriceCents, eligibility, policy})`. `assertListingBinding`, `assertCurrentListingAuthority` and `assertCurrentHoldConsent` protect continued use. A content hash binds immutable identity, media, authority, fee/net, policy and creation facts separately from reservation status.
- `catalog.mjs`: `catalogListings(state, filters)`. Only ACTIVE listings enter the catalog; title, consignment, private custody, seller account and connected-account evidence are absent from its projection. Filters cover player/name, category, set, year, grade, price, numbered denominator, autograph and relic; unknown is never silently false. Historical decimal grades remain supported.
- `reservation.mjs`: `assertBuyerQuote`, `reserveListing`, `markReservationPaymentPending`, `settleReservation`, `releaseReservation`. Reservation output includes the exact finance `order` contract: order/reservation/listing/card/seller/buyer identities, USD item/total/fee/net/tax/shipping cents, policy version and immutable listing hash. `markReservationPaymentPending` accepts fresh eligibility and the already-prepared durable finance intent in the same transaction.
- `listing-guidance.mjs`: default-unavailable saved-guidance adapter, `previewListingGuidance` and explicit `recordListingGuidanceRefresh`. This is a compatibility port for a copied R1 curation receipt, with no grading import, provider acquisition or automatic comp selection. Actual R1 unresolved rights cannot supply listing guidance. Only explicit synthetic policy/rights, exact copied receipt/selected-fact hashes, current card/approval/report/identity/listing binding, confirmed designation/identity, dates, single comparison group, currency and explained method/count/range pass. Deliberate refresh appends a separate immutable guidance receipt and never changes asking price, approved report or listing version.

`test/listing-fixtures.mjs` contains reusable synthetic policy, eligibility, consent and quote constructors. The illustrative fixed $5 fee is explicitly a test fixture, not an approved ATLAS fee. The unfinalized 8% proposal is not used. Every policy input is required, including fee, protection, returns, release, payout terms and reservation duration. Tax and shipping require explicit quote references, including when their amounts are zero.

## Reservation and uncertain-payment contract

A complete buyer quote binds the exact listing and policy. Integer cents must sum exactly; numeric strings, fractions and overflow are rejected. A buyer premium is unsupported in this pilot. Current authority is rechecked before reservation and undispatched payment. Seller self-purchase and competing reservation of the same permanent card are rejected.

An untouched lease may expire. Once a durable payment intent is attached, expiry cannot free the card. UNKNOWN, DISPATCHING, PENDING and FAILED all retain the reservation. Only an exact shared-store PAYMENT intent with the complete matching immutable order, retained provider object and valid reconciliation time can resolve it: SUCCEEDED plus confirmed records one sale, while CANCELED plus explicit terminal-unpaid evidence permits release. A browser success redirect is not used. A confirmed or otherwise already-dispatched historical intent remains recoverable without pretending that the seller's current title is the old payment's authority.

Exact request retries return their original receipts; current status is a separate read. A settled card remains sold even if later stale cancellation data arrives. Refunds and inspected returns belong to the lead/finance flow, not lease release or fabricated relisting authority.

## Local UI

`ui/index.html`, `app.mjs`, `view.mjs` and `styles.css` implement a dependency-free white/emerald responsive interface. It presents source-bound Front/Back and a separate Grade Report; all catalog filters; explicit disposition consent; seller ask/fee/net; buyer item/shipping/tax/full total; reservation and original payment reconciliation; synthetic packing/dispatch/delivery/release controls; ATLAS Balance and separate bank-withdrawal reconciliation.

The persistent banner and action copy identify local synthetic data. Provider completion requires a deliberate **Simulate** action. A lost mutation response triggers only saved-state GET recovery; no POST or payment is automatically repeated. If saved state also cannot be read, new mutations remain disabled. Same-origin POSTs carry the lead server's local CSRF token. Dynamic text is escaped, evidence URLs stay under `/demo/`, and no real external media is fetched.

Root serves `/`, `/app.mjs`, `/view.mjs`, `/styles.css`, `/demo/front.svg`, `/demo/back.svg` and `/demo/report` through an explicit loopback allowlist. An initial browser attempt found a `/ui/` path mismatch; references were corrected without changing the server or performing a production restart. The lead owns actual integrated browser/layout acceptance and final evidence. Source tests alone are not visual or physical-phone qualification.

## Focused qualification

Node 22 focused run: 18 tests passed, zero skipped. Coverage includes unavailable real authority; separate title/custody/consignment/account failure; expired assertions; exact media/report binding; missing policy/hold consent; exact listing retries and immutable price/report; public redaction and unknown facets; full buyer totals; payment uncertainty; duplicate/stale settlement; exact terminal-unpaid release; resumed prepared-payment authority/consent; two actual independent SQLite processes competing for one card and durable reopen; guidance provenance/unknown designation/stale data/no repricing; UI text/URL escaping, strict cents and lost-response recovery with CSRF.

The first contention test correctly refused macOS's symlinked temporary path. Only the fixture was corrected to use its canonical `realpath`; the store guard was retained. The subsequent actual two-process test passed and removed only its owned temporary directory.

Run command: Node 22 `--test packages/atlas-marketplace/test/{eligibility,listing,listing-guidance,reservation,ui}.test.mjs`. Broader existing R1/grading suites were not replayed. Root owns final integration tests, browser acceptance, SESSION_LOG and commits. No production operation, provider cost, real payment, physical movement, notification or cross-chat message was performed by this slice.
