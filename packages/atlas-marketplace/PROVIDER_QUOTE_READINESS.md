# Marketplace shipping, tax and reporting candidate — 2026-10-22

This lane adds concrete ShipStation / ShipEngine rate and Stripe Tax HTTP adapters, durable original tax reporting, and authenticated staff controls. All new provider factories default off. Qualification used injected HTTP responses and synthetic addresses only: no credentials were discovered or reused, no provider requests were made, no label or shipment was purchased, and no provider registration, account configuration or production route was changed. This is implementation evidence, not shipping, insurance, tax-registration or live-account acceptance.

## Sources and separation

Read-only grading commerce evidence identified the existing ShipStation / ShipEngine integration and Stripe Tax calculation / transaction integration. This package imports neither implementation, configuration nor credentials from grading. The marketplace adapters take their own explicit account, credential, mode, measured parcel, warehouse address and approved policy inputs.

Provider behavior was checked against current official sources:

- [ShipStation / ShipEngine rates API](https://docs.shipstation.com/apis/shipengine/openapi/rates/estimate_rates), [authentication](https://docs.shipstation.com/apis/shipengine/docs/guides/auth), [sandbox](https://docs.shipstation.com/apis/shipengine/docs/getting-started/sandbox), and [carrier API](https://docs.shipstation.com/apis/openapi/carriers).
- [Adding shipment insurance](https://docs.shipstation.com/apis/shipengine/docs/shipping/add-insurance-to-shipment) and [insurance](https://docs.shipstation.com/apis/shipengine/docs/shipping/insurance). A quoted insurance amount or trackable service does not prove a purchased policy or coverage of graded cards. The API's third-party marker does not purchase external coverage; this candidate refuses that unsupported mode.
- [Stripe custom Tax integration](https://docs.stripe.com/tax/custom), [calculation creation](https://docs.stripe.com/api/tax/calculations/create), [original calculation retrieval](https://docs.stripe.com/api/tax/calculations/retrieve), [transaction from calculation](https://docs.stripe.com/api/tax/transactions/create_from_calculation), [partial reversal](https://docs.stripe.com/api/tax/transactions/create_reversal), [transaction object](https://docs.stripe.com/api/tax/transactions/object), [transaction retrieval](https://docs.stripe.com/api/tax/transactions/retrieve), and [idempotent requests](https://docs.stripe.com/api/idempotent_requests). Tax calculation provider expiry is distinct from the short checkout quote deadline. Provider idempotency retention does not justify blindly repeating an unknown original POST.

## Exported composition

`src/provider-quote-http.mjs` supplies strict address validation, fixed-origin bounded HTTP, independently approved configuration gates and durable quote-operation receipts. `src/provider-shipping-shipstation.mjs` exports `createShipStationQuoteAdapter`; `src/provider-tax-stripe.mjs` exports `createStripeTaxQuoteAdapter` and its branded server-only assertion. Each enabled adapter has `{enabled,binding,assertReady,quote,close}`. Both implement the existing `createApprovedCheckoutQuoteProvider` shipping / tax ports and return its exact receipt shape.

Factories require `enabled:true`, the exact shared `store`, explicit `config`, `resolveDestination`, independent synchronous `assertReady`, and supplied credentials (`apiKey` or `secretKey`). Optional `fetchImpl`, `clock` and bounded `timeoutMs` permit isolated qualification. Only `PROVIDER_SANDBOX` and `PRODUCTION` modes are supported; supplying a production-shaped policy does not enable real authority. Account, mode, configuration hash, store-method identity, destination-port identity and current approval are rechecked. Accidentally asynchronous approval gates refuse safely without an unhandled rejection.

The destination reader contract is:

```js
resolveDestination.assertCurrent(descriptor, {buyerId}) // structural/current approval only
await resolveDestination.readAddress({buyerId,destinationId,version,addressHash,signal})
```

The private result has only `{name,phone,line1,line2,city,state,postalCode,country,residential}`. Initial support is US addresses; `line2` is null or trimmed text, and residential is `yes`, `no` or `unknown`. The address must hash exactly to the buyer-owned current descriptor. User entry is not postal verification. Root's encrypted destination store additionally checks current version/removal inside quote commit, reservation and first payment-dispatch transactions. Historical paid-order addresses are retained separately in encrypted snapshots.

No raw request address, phone, provider response or credential enters quote / lifecycle receipts. Durable `quoteProviderOperations` retains closed request descriptors, wire hashes, receipt amounts, original IDs and approved evidence hashes. It does not retain the actual wire request. Addresses are necessarily sent to the explicitly approved provider to obtain the requested quote.

## Shipping contract

Shipping configuration explicitly binds carrier ID/code/account number, service, measurement reference, weight and dimensions, warehouse address, ship date and time zone, confirmation service, approved coverage provider and terms. There is no guessed parcel, carrier, shipping date, default insurance or free shipping fallback.

Coverage configuration requires `coveredItemType:'GRADED_TRADING_CARD'`, `valueBasis:'ITEM_PRICE'`, maximum declared value, independent approval / terms references and disclosure. Supported API providers are `carrier`, `parcelguard` and `shipsurance`; the exact item price is sent as the declared insured value. Actual exclusions, deductible, limits, eligible cards and fulfillment purchase remain an external approval / execution requirement.

The adapter retrieves the exact configured carrier account and submits only `POST /v1/rates` at the fixed ShipEngine origin. It requires one completed, validated, trackable rate for the configured carrier/service and rejects warning/error/ambiguous responses. The provider cost receipt equals the safe integer sum of shipping, confirmation, other and insurance amounts. Legacy v1 checkout passes that cost through; explicitly approved v2 pricing adds the owner-selected $3 handling charge and taxes the full buyer shipping/handling amount. Nonzero carrier tax surcharges are refused until explicitly supported, rather than silently dropped. Currency and fractional-cent mismatches fail closed. Delivery text is explicitly an estimate; missing timing remains unknown.

The returned receipt is `{requestHash,quoteRef,amountCents,currency,policyRef,issuedAt,expiresAt,deliveryEstimate}`. No label-purchase, shipment-purchase, tracking mutation or insurance-purchase method is exported. A rate quote does not establish a physical shipment or issued coverage.

## Tax quote and original reporting contract

Tax configuration pins platform account, API version, explicit item / shipping tax codes, tax basis, responsible-entity and registration approval references, warehouse origin and explicitly allowed zero-tax reasons. The adapter checks the original platform account, supplied credential mode, exact customer / origin address hashes, line reference / quantity / tax code, exclusive-tax amounts, shipping amount, total and provider expiry. No absent registration, uncertain response or missing tax amount becomes zero tax.

Tax receipts extend the existing quote receipt with `basisCents`; closed provider evidence retains item and shipping tax splits, original calculation ID and provider expiry. Successful quote operations replay only their same unexpired receipt. A claimed quote/calculation with a lost or invalid response remains unknown; there is no automatic replacement POST or fabricated quote.

`src/tax-lifecycle.mjs` exports:

```js
createStripeTaxLifecycle({enabled:false,store,taxAdapter,approvalRef,assertReady,clock})
assertStripeTaxLifecycle(lifecycle,{store,environment,platformAccountId})
// Enabled lifecycle methods:
await lifecycle.recordSale({orderId,signal})
await lifecycle.recordRefund({refundIntentId,itemTaxCents,shippingTaxCents,reviewRef,signal})
await lifecycle.resume({operationId,signal})
await lifecycle.reconcile({operationId,providerId,recoveryReviewRef,signal})
await lifecycle.listUnresolved({limit})
await lifecycle.status({orderId})
```

The lifecycle is branded to the exact store, tax adapter, environment, platform and independent approval. It accepts only an exact confirmed payment/order or confirmed refund. A retained `marketplaceTaxRequirements` row must match lifecycle binding hash, original calculation and payment binding. Existing operations are rechecked; changing an approval cannot generate another operation for the same original sale/refund, including legacy records without a requirement row.

Operations durably move `PREPARED → DISPATCHING → SUCCEEDED` or `UNKNOWN`. The atomic dispatch claim permits one POST. Returned provider IDs are saved before independent original GET verification, including when approval changes after I/O. There is no replay of claimed POSTs. `resume` is an explicit operation for only a never-dispatched PREPARED record, preserving original amounts and review; simultaneous resumes claim once. `reconcile` is GET-only. If the original provider ID was lost, independently approved `recoveryReview` plus exact original GET evidence is required before attaching it. A wrong candidate ID is not retained.

Refunds use the original sale transaction and line IDs, explicit reviewed item/shipping tax allocation and exact confirmed financial refund. Outstanding and successful reversals reserve the original remaining amounts; proportional tax guesses are not made. A tax reporting failure cannot relabel or undo the original confirmed money movement. Quote policy expiry stops new quotes but does not prevent original reporting/recovery when independently approved and the provider calculation is still usable; provider calculation expiry still refuses sale creation.

Root composition adds the actual service, HTTP, host-finance followup and fulfillment requirements. Automatic tax reporting is a separately approved operation from GET-only financial recovery. Root owns qualification of that combined host/service wiring.

## Staff experience

Authenticated STAFF workspaces consume the closed `taxReporting` projection. The app supports `/staff/tax/sale`, `/staff/tax/refund`, `/staff/tax/resume` and `/staff/tax/reconcile`. Missing sale records can be recorded; PREPARED records have an explicit original resume; DISPATCHING/UNKNOWN records offer original reconciliation with optional manually supplied original ID and independent review. Refund input requires nonnegative safe integer cents summing exactly to confirmed refunded tax, and explicit retained review. No provider IDs are automatically projected, and buyer/seller/local simulator surfaces have no tax controls.

The UI states that these orders are already paid and that tax requirements may hold fulfillment or case closure. Interrupted responses trigger a state read, never an automatic repeat POST. Existing destination controls were preserved. Role checks exposed and fixed an empty-seller fee-preview dereference when neither approved card nor fee quote exists.

## Focused verification

Node 22 targeted checks, with mocked HTTP only:

- `test/provider-quotes.test.mjs`: **12/12**. Default-off/account/mode/coverage gates; measured insured full shipping total; ambiguity/identity/cent/validation failures; bounded abort-ignoring transport capacity and redaction; exact tax/address/registration/no-zero fallback; confirmed sale and partial reversal; unknown POST original recovery; pending/mismatched money refusal; retained requirement / approval pin; concurrent PREPARED resume; quote/provider expiry separation; actual quote composer plus encrypted saved destination and removal checks.
- `test/ui-tax.test.mjs`: **3/3**. Staff-only closed rendering, escaped/private fields, unavailable controls, exact CSRF-scoped commands and integer-cent split, unprojected IDs and role refusals, original recovery review, and lost response without write replay.
- Existing `test/ui-commerce.test.mjs`: **5/5**, rerun because the shared app/view changed. Exact fee/destination/instant/incident flows remain intact.

No full baseline suite, browser, PostgreSQL, provider or physical test was rerun in this lane. Existing unrelated acceptance evidence remains valid within its original scope. Root records combined interface tests separately.

## Remaining release inputs and proof

Actual marketplace carrier/provider account qualification, credentials, tax registrations/responsible entity and tax-code decisions, coverage terms for these cards, measured packaging, warehouse/dispatch practice and complete live-host acceptance remain required. Sandbox dummy rate behavior is not proof of production price or carrier coverage. This implementation does not enable Fingerprint/title/custody authority, ownership claims/history, label purchase, or production traffic. The existing genuine R1 authority gates remain closed until independently qualified.
