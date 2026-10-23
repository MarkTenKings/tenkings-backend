# R2 deterministic fee and destination quote candidate

October 22, 2026; isolated continuation from `cef23852`. This lane implements the fee/quote engineering contracts for master IDs 16–19 and 29. It records no commercial approval, provider tax/shipping qualification, title evidence or live activation. No provider/API call, credential discovery, shared migration, route registration or production action was performed. Browser work was limited to the explicitly labeled, inert local fixture described below. Ownership claims/history and real sale authority remain unavailable.

## Exact seller fee calculation

`src/fee-policy.mjs` exports `assertFeeSchedule`, `calculateSellerFee`, `assertSellerFeeQuote` and default-off `createApprovedFeeCalculator`. A disabled calculator cannot quote or authorize a fee. Enabled composition requires an independently checked approval binding, exact trusted environment and immutable schedule hash. Synchronous approvals must return literal true; an accidental Promise is refused and its rejection consumed. Source policy mutation, approval revocation and a backward clock fail closed.

The closed `atlas-fee-schedule-v1` contract requires id/version/environment/USD, approval reference, effective/expiry times, `basis:ITEM_PRICE`, `tierMode:VOLUME`, explicit `rounding:DOWN|UP|HALF_UP`, explicit ordered tiers and a final unbounded tier, nullable minimum/maximum, processing treatment and complete disclosure. Each tier contains exactly `upToCents`, `rateBps` and `fixedCents`. An upper boundary is inclusive; the selected tier applies to the **entire** item price. The rate uses integer basis points. BigInt multiplication and division avoid floating-point rounding; rounding is applied to the percentage before the fixed amount, then the approved minimum and maximum apply. The result must fit safe integer cents and leave a positive seller net.

Only `processing:INCLUDED` is supported by this complete-allocation contract. There is no inferred seller processing surcharge, shipping/tax fee basis, graduated tier rule or buyer premium. A separately charged processing component requires an explicit additional approved allocation contract; accepting a disclosure alone would produce an incomplete net. The proposed 8% is not a default, configuration or approval. All test rates/amounts are deliberately synthetic fixtures.

Factory interface:

```js
const calculator = createApprovedFeeCalculator({
  enabled, context, schedule, approvalRef, assertReady, clock, maxQuoteAgeMs,
});
const input = {
  policy, cardId, sellerId, askingPriceCents,
  listingId: null, listingVersion: 0, listingHash: null,
};
const receipt = calculator.preview(input);
calculator.assertCurrent(receipt, input, transactionNow); // synchronous
```

`policy` is the exact full listing policy, including its fulfillment policy. For a revision the input carries the existing listing id/version/binding hash and retained policy. A scheduled policy cannot also contain a conflicting `feeCents`; `feeDisclosure` must equal its schedule disclosure. Receipt `.id` is the service `feeQuoteId`; its immutable hash binds the card, seller, price, full policy, schedule, selected tier, exact fee/net and timestamps. Lifetime is explicitly configured, at most 15 minutes, capped by schedule expiry.

Root service integration saves receipts in `state.feeQuotes`; POST `/listings/preview` takes `{cardId,askingPriceCents,listingId?}`. Publication/revision requires the retained `feeQuoteId` when a schedule exists. Both the service and pure domain recheck the binding. `listing.mjs` preserves a fee receipt in the immutable listing hash. Revision archives the original listing, recomputes the fee/net for the new ask, and changes the listing binding without mutating the report or photographs. Existing exact fixed-fee contracts remain compatible; no existing fixture policy was silently changed to a commercial rate.

## Destination, shipping and tax composition

`src/checkout-quote.mjs` exports default-off `createApprovedCheckoutQuoteProvider` and `assertCheckoutQuoteBinding`. The returned callable has `.listDestinations`, synchronous `.assertCurrent`, `.destinationRequired:true`, immutable `.binding` and `.close`. Construction performs no I/O. No credential, address, tax responsibility, provider or delivery price is discovered implicitly.

The closed `atlas-checkout-policy-v1` specifies id/version/environment/USD, independent approval, effective/expiry times, maximum quote age (at most 15 minutes), exact shipping/tax/responsible-entity references, explicit taxable basis (`ITEM_ONLY` or `ITEM_AND_SHIPPING`) and allowed destination countries. Separate qualified ports are mandatory:

- `resolveDestination.list({buyerId,signal})`, `.resolve({buyerId,destinationId,signal})`, synchronous `.assertCurrent(destination,{buyerId,destinationId})` and `.assertReady(binding)`.
- `shipping.quote(request)` and `tax.quote(request)`, each with independent synchronous `.assertReady(binding)`.

The resolver returns exactly `{id,buyerId,version,addressHash,countryCode,label,evidenceRef,observedAt,expiresAt}`. It must bind a genuine saved destination and current version in the future host; it cannot infer identity from request data. No street address is stored in the quote. Only `{id,label,version}` leaves `.listDestinations`, with a maximum of 25 unique selectors.

Shipping is quoted before tax. Both requests bind environment, exact listing id/version/hash, buyer, destination, currency, item cents and their approved policy reference. Tax additionally binds shipping cents and receipt reference, taxable basis cents and responsible entity. A port returns exactly `{requestHash,quoteRef,amountCents,currency,policyRef,issuedAt,expiresAt}` plus `deliveryEstimate` for shipping or `basisCents` for tax. `requestHash` is the canonical hash of the request **excluding** its AbortSignal. The response must match that exact request; zero is accepted only as an explicit qualified amount, never as a fallback.

Composition is bounded to 20 seconds and two logical calls by default (configured limits cannot exceed 20 seconds/four calls). Each entire destination→shipping→tax sequence owns one slot. Timeout/abort cannot publish a late quote; a port that ignores abort retains its slot until the underlying operation settles. Response content is bounded, adapter methods/policy are pinned and independent readiness/current destination are rechecked after I/O. Final expiry is the earliest policy, destination, shipping, tax or configured lifetime. Total is an overflow-checked sum of item, shipping and tax; buyer premium is exactly zero.

Root service POST `/quote` takes `{listingId,destinationId}` and retains the full immutable server receipt in `state.quotes`. The HTTP projection exposes totals, public listing/policy/times and safe destination selector fields, without internal shipping/tax receipts or address hashes. Reservation retains the complete server quote and buyer binding. Readiness, freshness and destination revocation are rechecked before reserve and before the first original payment dispatch. A returned browser success never establishes payment.

## Expired undispatched payment recovery

The pure reservation path now refuses first/resumed `PREPARED` dispatch after the original reservation/quote expires. It does not relax this rule for a durable prepared record.

Finance supplies `voidPreparedPayment`; root invokes it atomically with buyer-owned cancellation. The new domain `UNDISPATCHED_CANCELED` release is available only for the same exact payment/order binding and local `VOIDED` record with dispatch count zero, no provider object, no confirmed/terminal-unpaid claim, no dispatch/reconciliation timestamp, no journal/observation/object registry effect and no confirmed finance order. The original intent and unconfirmed finance order remain retained. A valid local void permits a later listing revision; it does not fabricate provider evidence. If dispatch wins the atomic transaction, cancellation fails and the card remains held. UNKNOWN, DISPATCHING, PENDING and confirmed outcomes retain their existing reconciliation requirements.

## Customer and operator surfaces

Authenticated seller UI requests a server fee preview, shows exact fee/net/disclosure and expiry, and requires a second deliberate list/revise submission. A price/version change invalidates the preview. Buyer UI selects a qualified saved destination and requests a complete POST quote; changing it invalidates the displayed quote. Missing destinations or failed pricing leave reserve unavailable. The UI consumes the safe projection without private receipt fields.

The same role-scoped UI now supports root's finance operations projection. Staff explicitly acknowledge or resolve the exact incident version/evidence hash with a retained review reference. Resolving an alert does not clear a money exception or release funds. The optional provider instant-fee settlement form appears only when its independently gated port is available; it selects the exact unsettled original payout intents and requires genuine provider-assessment and review references. It initiates no payout.

Seller optional instant payout controls appear only under projected availability. A seller enters the amount to the bank, requests the current fee-inclusive quote, reviews amount/fee/total debit/timing/disclosure, and explicitly confirms the original quote. Missing, expired, changed-bank or over-balance quotes cannot enable confirmation; the browser never supplies a fee as authority. Only an owned `PREPARED` payout exposes cancellation; the service atomically verifies it was never dispatched and releases its internal reservation through the finance reducer. UNKNOWN, PENDING, DISPATCHING and confirmed payouts never expose this cancellation. The standard withdrawal path remains unchanged. Instant implementation/provider qualification belongs to the finance lane; these UI checks do not claim actual instant-payout provider acceptance.

New fields use the existing white/emerald accessible style, labeled selects/inputs, 44–48px controls, wrap-safe identifiers and a 320px CSS rule. DOM/module interaction tests cover the real app listeners. The bounded browser visual check below covers these new controls without calling a financial endpoint.

## Bounded browser visual qualification

Root logged both planned preview starts before execution. An owned GET-only server bound to `127.0.0.1:51155`, first PID 9003 (2026-10-23 03:31:28 UTC), then PID 9700 (03:36:52 UTC) after adding the narrow-viewport wrapper. It imported the actual `renderApp` and stylesheet with synthetic seller/buyer/staff projections. Every page visibly identified synthetic local qualification; no application script, API action, form submission, provider port, real card image or real account was available. The preview used a fixed synthetic clock to show quote review states; it did not test live expiry timing.

Actual controlled Chrome rendered the seller and staff pages at 1594 CSS px; measured document and body widths were both 1594, with no horizontal overflow. Same-origin iframes had measured `clientWidth:320` and `clientHeight:760`. Visual inspection confirmed readable exact seller fee/net, buyer destination/shipping/tax/total, instant bank amount/fee/debit/confirmation, undispatched withdrawal cancellation, staff provider-fee evidence fields and incident review controls. Long references wrapped and no horizontal clipping was visible. Browser DOM scope did not expose the nested document's scroll width, so the narrow check is explicitly visual; it is a 320px CSS viewport in real Chrome, not physical-device emulation. No mobile browser, actual network checkout or financial action is claimed.

Evidence is outside Git at `/Users/markthomas/.codex/atlas-handoffs/atlas-r2-parallel-lead-20261022/continuation/r2-commerce-ui/`: `preview.mjs`, `server.json`, `measurements.json`, `cleanup.json`, `seller-desktop.png`, `staff-desktop.png`, `instant-cancel-desktop.png`, `seller-fee-320.png`, `buyer-total-320.png`, `instant-cancel-320.png`, `staff-fees-320.png` and `staff-incident-320.png`. Cleanup at 03:39:52 UTC proved both owned PIDs absent and port 51155 refused connection (61); the owned tab 2132133702 was closed and absent from the browser inventory. The receipt retains SHA-256 hashes of the preview, measurements and images.

The final narrow read-only review of root integration confirmed the three reported fixes: destination selectors are closed and validated, synchronous current-receipt gates cannot accept false/Promise results, and listings carry their own retained public policy rather than displaying current global terms. No residual material defect was found in those deltas.

## Focused qualification and remaining inputs

The six affected/new test files passed **34 groups** on Node 22: `policy-quote.test.mjs` (8), `commerce-service.test.mjs` (3), `ui-commerce.test.mjs` (5), existing listing (3), reservation (7) and UI (8). The latest instant-fee staff form and prepared-payout cancellation extensions then passed all five UI-commerce groups again. Coverage includes arithmetic boundaries/overflow/rounding, missing policy, drift/revocation/expiry, exact revision allocation, adapter binding/timeout/capacity, async gate refusal, safe role projections, actual mounted UI payloads and CSRF, exact synthetic service flow, destination revocation before intent creation, and both atomic cancellation/dispatch interleavings. The existing SQLite cross-process contention group remains unchanged and passed with the affected reservation checks. No broad unchanged suite, PostgreSQL cluster or real provider scenario was repeated.

Remaining owner/deployment inputs: actual fee schedule and processing/refund treatment; tax collecting/remitting responsibility and taxable basis; qualified tax and shipping ports, destination authority, countries/services/prices/lifetimes, shipping/coverage/return costs; independent policy approvals; physical acceptance and genuine title/custody/Fingerprint authority. Source implementations and synthetic reference ports do not supply these decisions. The exact interfaces permit separately approved adapters without enabling any default live behavior. Root owns integrated test totals, shared decision documents and SESSION_LOG updates.
