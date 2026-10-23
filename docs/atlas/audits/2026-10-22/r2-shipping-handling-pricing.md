# R2 approved shipping and handling pricing — 2026-10-22

The owner selected **the ShipStation carrier quote plus $3.00 per order**, disclosed upfront as **Shipping & handling**. The additional charge covers packaging, handling and margin before actual costs. The seller fee remains **8% of the card price including ordinary processing**; neither shipping nor tax enters that fee base.

This change implements the charge behind explicit approved checkout configuration. It does not enable a host, discover credentials, request a provider quote, purchase shipping or coverage, settle an expense, or assert realized profit. Qualification below uses only local synthetic money and injected HTTP responses.

## Configuration and immutable receipt

`src/shipping-pricing.mjs` exports:

```js
createPilotShippingPricing(input, context)
assertShippingPricingPolicy(policy, { environment, now })
createShippingPricingReceipt({ policy, providerReceipt, issuedAt, expiresAt })
assertShippingPricingReceipt(receipt, {
  shippingCents, providerReceipt, environment, now
})
allocateShippingRefund(receipt, amountCents, previousAllocations)
```

Builder input has exactly `id`, `version`, `environment`, `approvalRef`, `effectiveAt`, `expiresAt`, `shippingTaxCode`, and `maxBuyerChargeCents`. The environment must match the caller's branded authority context. There is no inferred tax classification, charge cap, validity period, approval reference, account, or activation. The builder returns frozen data using `atlas-shipping-pricing-policy-v1`, USD, `handlingCents:300`, and the deterministic refund-attribution contract. This is the approved fixed pilot charge; arbitrary percentage pricing is unsupported.

The new `atlas-checkout-policy-v2` is the exact v1 policy plus `shippingPricing`. It requires `ITEM_AND_SHIPPING` tax basis. The enabled checkout provider still needs its existing independent synchronous readiness gates and exact policy hash. Policy expiry, revocation, mutation, incompatible tax basis, excessive buyer charge, unsafe integers, mismatched provider cost, and incomplete configuration refuse a new checkout. Default-off behavior and existing v1 zero-cost/pass-through configurations remain unchanged.

The quote schema remains `atlas-checkout-quote-v1`, preserving existing reservation validation. Its optional `shippingPricing` receipt retains:

- The exact pricing policy snapshot/hash, provider cost receipt hash, and original carrier quote reference.
- `quotedCarrierCostCents`, `handlingCents`, and their sum `buyerChargeCents`.
- USD, environment, issue/expiry times, receipt hash, label/disclosure, and `costStatus:'QUOTED_NOT_SETTLED'`.

The original `shippingReceipt.amountCents` remains the quoted provider amount. `quote.shippingCents` is the full buyer charge. The pricing receipt is copied into the immutable reservation order, original payment order and paid order; the paid order also retains the full original quote. Changing either copy breaks the existing exact order/quote bindings.

The buyer disclosure is: **Includes the carrier quote plus a $3.00 ATLAS packaging and handling charge.** Root-owned projections expose only that disclosure and the label as `shippingCharge`; the buyer/seller receive no carrier-cost receipt or internal allocation. The staff projection exposes the closed cost/charge/status subset. These projection/UI checks are qualified separately by root and the listing specialist.

## Tax and accounting

The tax request carries the full buyer Shipping & handling amount, the pricing receipt hash and the explicit shipping tax code. The Stripe Tax adapter requires that code to match its independently approved configuration before provider I/O. It sends the full charge in `shipping_cost.amount`, then checks the retrieved calculation's amount/code/behavior and complete total. A calculation that taxes only the carrier quote cannot qualify the checkout. Actual jurisdictional taxability and registrations remain the configured provider's responsibility; this code does not invent a tax rate or exemption.

Current official primary documentation consulted: [Stripe calculation creation](https://docs.stripe.com/api/tax/calculations/create). The API accepts a separate shipping amount and returns shipping tax details. The existing adapter's [ShipStation rate API](https://docs.shipstation.com/apis/shipengine/openapi/rates/estimate_rates) remains the source of the private carrier quote; this delta changes no carrier request or response semantics.

On confirmed payment, new priced-shipping orders credit distinct per-order `shipping_carrier_deferred` and `shipping_handling_deferred` accounts. Their sum is the complete buyer shipping charge. They are deferred attribution, not an actual postage expense, payable to a proven supplier invoice, or realized margin. No cost payment, profit recognition, label purchase or automatic adjustment is fabricated. Legacy orders retain their original `shipping_payable` postings.

Financial refund authority still specifies the full `allocations.shippingCents`. Each original refund intent additionally retains `{carrierCents,handlingCents}`. The split uses the remaining unrefunded components, integer `BigInt` arithmetic and HALF_UP rounding, bounded by each remaining component. The final refund takes the exact remainder. Pending, dispatched and UNKNOWN refunds reserve both components; duplicate recovery cannot allocate them twice. Only verified terminal failure/returned-funds evidence releases the original allocation. Any financial hold persists for explicit review. A later refund needs its own reviewed intent; the implementation creates no replacement automatically.

Historical reconciliation and reviewed refunds use the retained original pricing receipt even after quote expiry. A provider-confirmed refund later returned reverses its retained split once, rather than recalculating with new prices. Existing tax reporting/reversal code uses the full original shipping charge and the separately reviewed actual tax allocation; no proportional tax guess was added.

## Evidence and limitations

Node 22 focused command:

```text
node --test test/shipping-pricing.test.mjs test/policy-quote.test.mjs \
  test/finance.test.mjs test/provider-quotes.test.mjs
```

The combined run passed **40/40** (shipping 6, policy quote 8, finance 14, provider quote 12). Final review then added one material returned-refund/expiry regression; the final shipping file passed **7/7**. Root owns the final combined aggregate and source manifest.

The seven shipping groups prove default-off/v1 compatibility; explicit $3 bounds and safe arithmetic; exact quote → reservation → payment → paid-order retention with item-only 8% seller fee; tamper/expiry refusal; full-charge Stripe Tax wire/code validation; partial/out-of-order/UNKNOWN/duplicate refunds with cumulative caps and final remainder; verified unpaid-refund release; and exact returned-refund correction after expiry without clearing the operational hold.

No actual shipping quote, Stripe Tax calculation, charge, refund, shipping purchase, PostgreSQL deployment, production activation or shared operation was performed for this change. Earlier actual Stripe standard payment/transfer/refund/reversal/payout evidence remains historical evidence for its original scope. Real carrier/coverage qualification, measured parcel, tax registration/classification, host readiness, physical fulfillment, actual cost evidence and any future cost-settlement/profit-recognition workflow remain distinct requirements.
