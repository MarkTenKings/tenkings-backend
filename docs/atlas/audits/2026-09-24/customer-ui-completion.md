# Customer receipt and browser verification — 2026-09-24

Local source verification by the fresh customer UI specialist. No production session, provider request, SMS, payment, label purchase, physical action, migration, deployment, commit or push occurred. The owner-approved blueprint remains unchanged. Root owns the final combined build and release.

## Corrected frontend gaps

- The paid receipt now reads its original immutable receipt channel, location/address, collection and projected-return dates, cutoff, schedule exceptions, turnaround clock/duration and mail shipping-leg terms. It renders grading subtotal, shipping, tax and paid total. Current checkout/location data cannot replace the saved receipt. The initial kiosk checkout also preserves its chosen channel while its server response loads.
- Provider `ACCEPTED` and `QUEUED` notification outcomes read **Accepted for delivery** and **Queued for delivery**. Only explicit `SENT` or `DELIVERED` evidence uses those claims; unknown status stays unconfirmed. A label download does not assert printing.
- Paid order detail now mounts the same saved receipt/label component alongside the existing ownership-scoped tracker. Returning customers can retrieve their receipt and labels from paid order history, independently of active checkout/provider admission. Existing PDF magic/4 MiB/SHA256 verification remains in the receipt download handler.
- Browser request budgets are115 seconds only for exact original-sign/complete and commerce checkout/quote/pay/reconcile paths, outliving the private95/API110 second deadlines. Ordinary account/auth/order reads retain25 seconds. Timeout keeps the original caller request and causes no automatic payment retry.
- Dealer/order pages have bounded responsive width, padding and readable count columns. Existing ATLAS brand/theme/fonts and the distinct customer/dealer authorization boundaries remain.

## Verification

`node --test frontend/atlas-customer/test/*.test.mjs`: **41/41 passed**. New rendered receipt tests cover saved kiosk and mail terms/amounts, delivery truthfulness and recovered payment whose original channel differs from the current view. New client tests cover explicit long-path timers, ordinary-path25 second timers and one uncertain payment dispatch with unchanged request identity. Existing intake durability, original-byte preservation, unknown request, HTTP ownership/CSRF and dealer tests pass.

Focused ESLint passed for `OrderReceipt.jsx`, `CommerceCheckout.jsx`, the order page and client; browser script syntax and scoped diff whitespace passed.

Actual Chrome/React browser harness `frontend/atlas-customer/scripts/customer-ui-browser.mjs` passed using the current JSX, all three real customer CSS files, actual local fonts and browser File/IndexedDB. All authentication, database, storage and payment responses are explicit local fixtures. Every HTTP(S) request is restricted to the harness's random loopback origin. Synthetic photo contents are arbitrary distinct bytes, so this proves intake interaction/durability rather than optical decoding or image identification quality. The secure form is an injected Stripe-shaped stub, not live Stripe acceptance.

Observed paths:

1. Kiosk QR attribution → phone/code → first-time name/email/address → Front/Back twice → automatic return to Add card → review → exact quote → unknown payment → reload → original payment reconciliation → saved receipt/tracker → customer deposit declaration.
2. Direct saved receipt reopen → original schedule/cutoff/amounts and pending email/SMS delivery retained; no second payment created.
3. Dealer account → authorized location selection → location counts, commission and truthful declared/actual custody → sign out. Customer email is absent.
4. Returning complete profile → mail-in selection → profile skipped → one new Front/Back pair → review → measured package selection → exact shipping/tax quote → synthetic secure payment → mail receipt with the fixture's saved turnaround start and both-leg terms.

Kiosk evidence:2 cards/4 originals, exactly1 payment creation,1 review write and1 profile write across reload. Mail evidence:1 card, PAID, exactly2 payment creations total for the two distinct orders; profile writes remain1. Zero browser errors.390px mobile and1280px desktop views are readable; mobile dealer/mail pages have no horizontal overflow. Nine screenshots were retained and mobile checkout/dealer/receipt screenshots were visually inspected.

Evidence: `/private/tmp/atlas-customer-ui-20260924-final/result.json` and adjacent PNGs. Earlier run2/run3 retain passing intermediate observations; the first failed harness run was only a fixture global-variable collision (`location`), corrected before application acceptance.

Command:

```sh
node frontend/atlas-customer/scripts/customer-ui-browser.mjs /Users/markthomas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /private/tmp/atlas-customer-ui-20260924-final
```

## Remaining acceptance boundary

No remaining defect was found in this bounded customer/dealer UI exercise. Actual SMS, browser/storage CORS, real card image identification, merchant/tax/FedEx qualification, secure payment/terminal behavior, receipt delivery, printing and custody remain operational acceptance. The mail fixture's clock and shipping legs are test data, not owner decisions or configured production terms. Production readiness still follows `customer-release-readiness.md` and root's independent runtime/schema/build evidence.
