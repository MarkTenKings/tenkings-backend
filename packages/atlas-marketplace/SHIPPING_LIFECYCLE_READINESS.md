# R2 original-shipment tracking and parcel qualification

Updated 2026-10-23. This is a default-off implementation with local qualification evidence. No carrier account was accessed, no label was purchased or voided, and no actual package, coverage contract, or delivery was qualified in this session. Existing successful actual Stripe sandbox/PostgreSQL evidence remains the evidence for those separate lanes; it was not rerun here.

## Implemented operations

`src/provider-tracking-shipstation.mjs` implements the existing ShipStation/ShipEngine **v1** API dialect at the fixed `https://api.shipengine.com` origin. The only requests are authenticated, bounded GETs for the configured carrier account, exact label, exact shipment, and exact label's tracking. Redirects, arbitrary response URLs, label creation, voiding, subscription registration and webhook registration are unavailable. The current ShipStation v2 API has a different origin/path contract and is not silently substituted. [ShipEngine label tracking](https://www.shipengine.com/docs/tracking/track-by-label-id/), [ShipStation v2 tracking](https://docs.shipstation.com/tracking).

Every tracking sync first rereads the original carrier account, label and shipment. It verifies account identity, configured service, completed/nonvoid/domestic/trackable label, original IDs, tracking number, outbound/return direction, confirmation, exact shipment/insurance charges, address hashes, parcel measurements and declared value. Only a single generic `package` with ounce/inch units is currently accepted. Proprietary carrier packaging codes and multi-package labels need separate implementation and qualification; selecting a published branded-box estimate does not enable them. [Exact shipment retrieval](https://www.shipengine.com/docs/reference/get-shipment-by-id/), [label API reference](https://www.shipengine.com/docs/reference/).

`src/shipping-lifecycle.mjs` retains the original issuance and append-only bounded observations in the same marketplace transaction store. A paid, confirmed, bound order and independently reviewed issuance, coverage and measurement references are mandatory. A label created before confirmed payment is refused. The declared value must equal the card item amount. A second original for the same order/direction/return case or reuse of one label/shipment/tracking identity on another order is refused. Exact request replay returns the retained result without another provider read.

Tracking reads do not dispatch a package, release money, open/close a case, confirm a returned card's identity or make an ownership claim. Staff explicitly records each physical milestone through the service after reviewing the retained facts.

## Original-only operating procedure

1. Independently approve the exact API dialect, mode, carrier account, available service/confirmation/insurance combinations, maximum covered value, timestamp interpretation and effective/expiry period. Supply the API key and server callbacks through the trusted physical factory. Configuration strings alone are not approval evidence. Nothing discovers credentials or enables this automatically.
2. Pack the customer's actual order. Retain sealed-package scale weight, outside dimensions, package identity and packing proof. Resolve the exact destination and selected origin from authorized server records. Sacramento **3280 Ramos Circle, Sacramento, CA 95827** is the resolved first origin; required contact details must come from real records. The older **8 × 6 × 4 in, 1 lb** comparison is not a measurement.
3. Independently review applicable collectible/card/slab coverage, declared-value limits, exclusions, packing, signature, evidence and claims deadlines for the actual service/account. A rate or positive insured-value field does not establish that a card loss will be paid. ShipEngine's `third_party` option only reports separately arranged coverage and does not purchase it; this adapter refuses that option. The supported `carrier`, `parcelguard` or `shipsurance` values still need actual coverage approval. [ShipEngine insurance contract](https://www.shipengine.com/docs/shipping/add-insurance-to-shipment/).
4. An authorized operator issues **one** shipment outside this adapter through the independently qualified account/workflow. Retain its original label ID, shipment ID, tracking number, optional external shipment ID, issuance/purchase evidence, coverage evidence and measurement reference. If issuance outcome is uncertain, stop and recover that original with the provider/operator. Do not buy a replacement as recovery.
5. Call `retainIssuedShipment` with those exact identities and references. The trusted `resolveShipment` supplies expected address/measurement/service/insurance/charge facts; `validateShipmentEvidence` must independently verify the complete manifest and return exactly `true`. A user-entered reference is not sufficient. Exact provider GET verification must also succeed before retention commits.
6. Use `syncShipmentTracking` for the same retained shipment key. Staff calls `recordCarrierMilestone` with `DISPATCH` or `DELIVER`; the server derives the evidence and timestamps. No timestamp or proof reference is accepted from that milestone HTTP form. A carrier acceptance/possession event is required for dispatch; creating a label is not acceptance.
7. Review `missingShipmentScans` and tracking attention results. No-acceptance follow-up is due from issuance plus policy interval; no-recent-progress follow-up is due from the last carrier event plus that interval. These are investigation cues, not automatic refund or release decisions. Existing case/finance/tax/packing protections still apply.
8. For an approved return, retain a distinct `RETURN` original tied to its open approved return case. The initial payer is ATLAS. The trusted resolver must provide the correct reversed/approved return route and actual return parcel/coverage. Track that original separately. A return tracking delivery never closes the case or substitutes for parcel/card/holder inspection, refund reconciliation or responsibility review.

The provider's unique external shipment ID contract is useful for identifying a shipment, but it is not evidence of a safe replayable label purchase after an unknown response. This implementation therefore has no automatic purchase/replacement path. [Create-shipment identity contract](https://www.shipengine.com/docs/shipping/create-a-shipment/), [label purchase endpoint](https://www.shipengine.com/docs/labels/create-from-shipment/).

## Timestamp and release rules

Only explicit UTC `occurred_at` timestamps or `actual_delivery_date` from the exact original tracking read are used. Provider-normalized `occurred_at` is best effort UTC; the separately exposed `carrier_occurred_at` can be local/unknown-zone time and is not used. Actual carrier/account behavior and this interpretation must be qualified through `timestampPolicyApprovalRef`. [ShipEngine tracking timestamp contract](https://www.shipengine.com/docs/tracking/track-by-label-id/).

`DE` plus one consistent actual timestamp can establish delivery. An explicit normalized `DE` event can supply the timestamp if the top-level actual date is absent. Estimates, label creation, `AT` attempts, `SP` collection-point scans, unzoned/invalid/future dates and returned-to-sender delivery are not customer delivery. Multiple conflicting dates, later carrier progress, or a status regression after retained delivery create a persistent reconciliation hold. The first retained actual delivery is not rewritten to extend the buyer's deadline. Raw names, signer/location text, addresses and label download URLs are not retained or projected.

Observed time is stored separately from actual dispatch/delivery time. The owner's **24-hour** return interval begins at actual delivery even when ingestion is late. Eligible reasons remain **severe damage or wrong product**, with buyer proof and staff review. ATLAS initially pays approved return shipping. The seller's **8%** fee and buyer's **ShipStation rate + $3 per order** shipping-and-handling rule are unchanged. Observed label plus insurance charges are costs, not shipping profit or final carrier invoice reconciliation.

The branded lifecycle's synchronous `assertInTransaction(tx,{kind:'FULFILLMENT',input})` compares DISPATCH/DELIVER evidence to current retained facts and rechecks independent approval. For RELEASE it requires the bound outbound original, the same actual delivery as fulfillment and no original/return attention. The service invokes this both for release and at original-transfer recovery/preparation and dispatch claim, including after awaited account reads. Current lifecycle approval must continue to represent valid original-issuance, coverage and measurement authorization; revocation must make the synchronous approval callback return false. Persistent delivery conflicts require a separately designed, reviewed reconciliation path; no generic clear-hold action is exposed here.

The physical factory does not wire a tracking scheduler. The target operator/scheduler must poll original GET tracking on an independently approved schedule, including a current read before release when that policy requires one. Enforce freshness through the synchronous approval gate; no arbitrary age limit is invented here, because delivery evidence must legitimately remain usable after the 24-hour interval. `missingScans` exposes time-based due work without a provider call or automatic hold/financial transition. A staff refresh can display that list; staff must explicitly investigate and open an appropriate case when warranted.

## Trusted interfaces

Factories:

```js
createShipStationTrackingAdapter({enabled,config,apiKey,assertReady,fetchImpl,clock})
createShippingLifecycle({enabled,store,trackingAdapter,approvalRef,assertReady,
  resolveShipment,validateEvidence,clock})
assertShippingLifecycle(lifecycle,{store,environment}) // returns the branded instance
```

`config` requires exactly: `environment`, `approvalRef`, `accountApprovalRef`, `qualificationRef`, `timestampPolicyApprovalRef`, `effectiveAt`, `expiresAt`, `carrierId`, `carrierCode`, `carrierAccountNumber`, `serviceCodes`, `insuranceProviders`, `confirmations`, `maxDeclaredValueCents`. Mode must match the key convention. Approval is synchronous and rechecked before/after I/O and inside commits. Mutation of configuration or store methods invalidates the binding. API credentials and raw account number remain in server memory, not retained evidence.

The trusted resolver returns exactly:

```js
{
  shipFrom, shipTo, // validated quote address schema; no client override
  parcel: {weightOunces,lengthInches,widthInches,heightInches},
  serviceCode, confirmation, insuranceProvider, declaredValueCents,
  shipmentCostCents, insuranceCostCents
}
```

The reviewed issuance manifest binds environment, order/card/order binding, direction/case, original label/shipment/tracking/external IDs, all three proof references, expected-facts hash and initial return payer. The validator must check this complete binding against genuine evidence.

Lifecycle methods are `retainIssued`, `syncTracking`, `status`, `missingScans`, `dispatchEvidence`, `deliveryEvidence`, `validateEvidence`, `assertInTransaction`, `close`. Async methods accept a second `{authorizeCommit}` callback; the staff service supplies it to recheck actor/runtime authority around awaited work and at commit. Status is an array of sanitized DTOs: shipment key/order/direction/case, state, carrier status code, issuance/observation/possession/progress/delivery times, attention code, initial return payer and total observed cost. It excludes raw carrier IDs, tracking number, original proof references, address and download URLs.

Staff HTTP operations joined by the root integration:

| Operation | Route under `/api/marketplace` |
| --- | --- |
| Retain original issuance | `POST /staff/shipping/retain` |
| Reread original tracking | `POST /staff/shipping/sync` |
| Explicit carrier milestone | `POST /staff/shipping/milestone` |
| Sanitized order status | `GET /staff/shipping?orderId=…` |
| Missing-scan follow-up queue | `GET /staff/shipping/missing-scans` |

Existing authentication, staff role, CSRF, origin, body and rate controls remain required. Raw tracking webhooks are not trusted ingestion; this lane uses exact original authenticated GET reads.

## Parcel estimates requested by the owner

The pure browser module `ui/parcel-presets.mjs` exports `PARCEL_PRESETS`, `estimateParcelPreset({presetId,weightOunces})` and `WHATNOT_CARD_PROFILE_BENCHMARK`. Selection fills catalog dimensions while requiring an explicit comparison weight. It returns `ESTIMATE_ONLY`, `USER_COMPARISON_NOT_MEASURED` and `measurementRequired:true`. It produces no price, default card weight, measurement reference, fit/capacity claim or provider package code.

| Published U.S. packaging candidate | Catalog dimensions, inches (L × W × H) | Qualification note |
| --- | --- | --- |
| FedEx Extra Small Box | 7.25 × 4.6875 × 2.5 | Branded service/package code required |
| FedEx Small Box, flat | 12.375 × 10.875 × 1.5 | Branded service/package code required |
| FedEx Small Box, deeper | 11.25 × 8.75 × 2.625 | Branded service/package code required |
| FedEx Office plain brown box | 8 × 8 × 8 | Purchased generic packaging; measure actual parcel |

FedEx publishes the first three dimensions for One Rate packaging. Complimentary FedEx packaging is restricted to specified expedited/Express Saver/International Economy services; it is not a generic UPS/Ground box option. One Rate box weight must be below 50 lb, which is a service limit, not an assumed card-package weight. The separate brown box is sold by FedEx Office. These catalog dimensions still require sealed outside measurement and exact carrier service verification. [FedEx One Rate packaging](https://www.fedex.com/en-us/shipping/one-rate.html), [FedEx packaging and restrictions](https://www.fedex.com/en-us/shipping/packing/supplies/boxes.html).

Whatnot uses the **packed** item weight, including package and protection, and advises using a scale. Its Sports Cards and Trading Card Games **0–1 oz profiles** count the first item at the full profile weight and additional items at **0.5 oz**. That is a conditional Whatnot bundling rule, not a measured weight for every raw card, slab or box. No Whatnot rate, bundle entitlement or assumed slab weight is imported into ATLAS. [Whatnot shipping profiles](https://help.whatnot.com/hc/en-us/articles/4407962164621-Choose-shipping-profiles-for-your-listings), [Whatnot incremental weights](https://help.whatnot.com/hc/en-us/articles/16285911553677-How-Smart-Bundling-works).

Whatnot's card packing guidance includes sleeves, properly sized protection for high-value cards, padding that prevents movement and a sleeve/team bag for each slab. Vary package size and packed weight by customer quantity and protection needs; the catalog does not guarantee a fit. [Whatnot packaging guidance](https://help.whatnot.com/hc/en-us/articles/360061604591-Packaging-guidelines).

## Local evidence and remaining gates

Focused command (pinned Node 22.16.0):

```sh
/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node --test packages/atlas-marketplace/test/shipping-lifecycle.test.mjs packages/atlas-marketplace/test/shipping-service-joins.test.mjs packages/atlas-marketplace/test/parcel-presets.test.mjs
```

Result: **28/28 pass**, 14 top-level groups, no skips. Evidence includes actual loopback HTTP and SQLite with mocked provider payloads; default-off/config mutation/mode failures; exact-original mismatches; private projection; no duplicate original; delayed observation; invalid/attempted/collection-point/returned/conflicting delivery; missing scans; approved ATLAS-paid return; revocation during awaited review/read; unknown GET recovery; server-derived service milestones; 24-hour deadline; and release/transfer holds after tracking regresses between an account read and durable claim. The original prepared transfer remains `PREPARED`, dispatch count zero, and finance create calls zero in that race.

Actual-provider/physical gates still open:

- Approved actual API access and chosen v1 dialect/account/plan, including any billed tracking usage, real response shapes, service availability, exact account number representation, key mode and timestamp semantics.
- Genuine original issuance/coverage/measurement reviewer and resolver; persistent private evidence retention and revocation policy. Test callbacks are synthetic, not authorization to ship.
- Actual sealed package dimensions and weight for each quantity, applicable package code, packing protocol and card/slab coverage terms/limits/signature/claims procedure. No supplied API credential or real label was used.
- Original label/insurance issuance and recovery workflow qualified externally; actual carrier acceptance and customer delivery evidence; return receipt/identity/condition inspection; invoice adjustments and finance/tax reconciliation.
- A reviewed path for genuine tracking contradictions, proprietary branded packaging, multi-package/multi-order shipment grouping and any push-based tracking ingestion. They remain fail-closed/out of the narrow adapter.
- Fingerprint, title/consignment/custody authority, real ownership claims and history remain separate unavailable gates. None is enabled by these shipping changes.
