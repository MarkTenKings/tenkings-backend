# Commerce and customer operations implementation — 2026-09-24 UTC

Local implementation only. This specialist did not deploy, apply shared migrations, charge a card, purchase a label, send a receipt, operate equipment, or modify any Ten Kings financial writer. Root owns migration publication, private transport/runtime integration and disposable PostgreSQL acceptance. No branch or commit was created by this specialist. This is the separate handoff/log note for root to include in SESSION_LOG without concurrent edits.

## Commerce implementation

`packages/atlas-commerce` implements immutable server-priced checkout ($40 mail, $50 kiosk), real tax calculation requirements, measured FedEx account-rate quotes, exact Stripe merchant/mode/version binding, online card and linked-reader payment adapters, payment unknown-outcome retrieval, verified paid evidence, durable receipt/tax/label outbox and restricted provider callbacks. An acknowledged payment or terminal command is never paid evidence. The SQL source locks the draft and exact profile/card/photo/location snapshots; payment is marked paid before the atomic order insertion so the dealer paid-card trigger sees verified state. Kiosk commission basis is exactly $5 per full-price paid card and excludes tax/shipping. Kiosk shipping is zero.

Mail clock start and charged shipping legs remain explicitly UNCONFIGURED pending owner decisions. Missing tax, merchant, measured package, provider or dedicated receipt sender configuration fails closed. Only ATLAS-specific configuration is accepted; no legacy provider credentials are reused. The names-only process inspection found no configured commerce keys. This is not provider qualification evidence.

Saved paid receipts survive later kiosk deactivation or absent current payment configuration. FedEx create timeouts remain unknown without a second create. Known real async job IDs may be retrieved read-only, with SQL maximum-five attempts and persisted backoff. Missing effect adapters leave effects PENDING. Stale dispatched effects become UNKNOWN. Unknown receipt sends are not automatically repeated. SendGrid ACCEPTED and Twilio QUEUED are recorded separately from actual delivery.

Printable outer-package labels are deterministic private PDFs, marked GENERATED and `printed:false`. FedEx PDFs preserve exact returned bytes and tracking. The customer download validates PDF magic, maximum 4 MiB and SHA256. Only the owner-scoped label GET permits up to 6 MiB JSON for base64; other customer reads retain 512 KiB. No actual print claim is made.

The separate customer checkout component uses server quote totals and Stripe Elements. Provider-issued secrets remain limited to the current authenticated attempt. Terminal processing/refusal and unknown states do not create fake success. Retrying an already-created failed reader action does not yet have a separate operator reprocess control; provider qualification and real terminal acceptance remain required.

Official adapter references reviewed: [Stripe server-driven Terminal](https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven), [PaymentIntents](https://docs.stripe.com/api/payment_intents/create), [Tax calculations](https://docs.stripe.com/api/tax/calculations/create), [Tax transactions](https://docs.stripe.com/api/tax/transactions/create_from_calculation), [webhook signatures](https://docs.stripe.com/webhooks/signature), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [FedEx authorization](https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html), [account rates](https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html), [shipping and async results](https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html), [Twilio messages](https://www.twilio.com/docs/messaging/api/message-resource), and [SendGrid mail](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send).

## Staff customer operations

New `/admin/customer-operations` page, reviewer-only navigation, `CustomerOperations.jsx`/CSS, small pure helper and focused tests. It consumes root's connected GET `manual-connected/dealer-operations` and explicit POST actions `location-configure`, `membership-configure`, `custody`, `bind-manual`. It exposes no arbitrary SQL/JSON writer, provider activation, payouts or hardware controls.

The paid roster is truthful when empty and describes its 100-order server limit. Actual custody records require a human-entered event timestamp, physical evidence reference and explicit human confirmation. Transition options follow saved physical events, never projected schedule times. Outbound transition requires saved human grading approval. Binding requires saved ATLAS_RECEIVED and an actual accessible, unlinked manual card selected from the server roster; the operator can open its staff record for physical comparison.

Kiosk setup has structured actual address/coordinates, IANA timezone, weekly pickup/cutoff and return slots, dated cancellation/replacement exceptions, terminal/location/printer IDs, opaque kiosk token and explicit authorization expiry. New locations default disabled with no sample schedules or coordinates. Device configuration does not establish operational qualification. Existing dealer/location binding and expected revision are retained. Dealer membership requires explicit account UUID, configured location and grant/revoke decision. Setup/access permission remains an existing fresh human operations grant enforced by the server; this page cannot provision or simulate that grant.

All writes retain their exact payload in a staff-scoped local browser journal before dispatch. Cross-tab Web Locks plus synchronous in-page ownership prevent duplicate sends. A reload never resubmits. Custody reconciliation requires the staff-only event request ID, actor, timestamp, kind and exact evidence from root's new `custodyEvents` projection. A refused explicit retry cannot erase a prior uncertain attempt. Acknowledged actions whose roster read does not confirm remain locked. Only an explicit same-request custody/binding retry is available; unknown setup/access saves have read-only reconciliation. Config/membership matching checks exact immutable location revision or membership version. A missing browser lock/storage capability blocks writes. The public customer/dealer timeline remains separate from staff-only evidence.

## Verification and remaining acceptance

Passed 52 targeted tests: 41 commerce package/provider fixtures, 2 customer response-size tests, 9 staff helper/rendered component/recovery tests. Staff tests exercise actual rendered empty/unavailable/binding/setup fields, unknown reply across remount, double-click exclusion, fresh-CSRF same-request retry, exact read reconciliation, retained acknowledged operations, first definite rejection, storage/other-tab refusal and unknown membership version handling. All provider and staff writes in tests are injected fixture responses; no real service was called.

Focused ESLint passed for CustomerOperations, Shell, the new page and helper. `node --check` passed helper and page-boundary script syntax. No host Next build was attempted because of the reported disk constraint; root is running complete three-app builds and SQL acceptance in Docker. Actual visual browser acceptance, live provider onboarding, physical custody evidence, printer acceptance and production activation are not claimed here.

Commands:

```sh
node --test frontend/atlas-app/test/customer-operations.test.mjs packages/atlas-commerce/test/*.test.mjs frontend/atlas-customer/test/commerce-client.test.mjs
# Run from frontend/atlas-app:
./node_modules/.bin/eslint --no-cache components/CustomerOperations.jsx components/Shell.jsx pages/customer-operations.jsx lib/customer-operations.mjs
```


## Privacy follow-up

Root identified raw immutable provider data in quote/paid receipt responses. Added explicit recursive public DTO allowlists in JS and canonical migration50, retaining internal snapshots unchanged. Customer outputs now exclude account/profile/phone, merchant/dealer/device identifiers, photo/content hashes, commissions, raw tax/payment evidence and carrier shipment requests. Allowed schedule exceptions, card descriptions, line prices, totals, turnaround terms and label statuses remain. Historical paid recovery uses the original receipt while handling both private source and safe SQL DTO reads. Only the active online awaiting-payment response exposes its necessary provider-issued form secret.

The updated focused run passed57/57:46 commerce tests including five new privacy/internal-preservation cases,2 customer client size tests and9 staff component/recovery checks. No frontend file or manifest changed for this fix; acceptance specialist owns the subsequent actual PostgreSQL privacy assertions. SESSION_LOG appended as root requested. This follow-up does not activate providers or alter stored paid histories.
