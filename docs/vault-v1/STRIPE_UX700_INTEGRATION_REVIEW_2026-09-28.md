# Vault V1 — Stripe UX700 integration review (2026-09-28)

**Decision update:** Mark selected Stripe UX700. The [implementation status](STRIPE_PAYMENT_IMPLEMENTATION_STATUS_2026-09-28.md) records the provider-neutral refactor and test results; the original review below is a point-in-time assessment.

## Decision summary

Stripe documents Verifone UX700 unattended payments as generally available in the United States and recommends its server-driven Terminal integration for that reader. Stripe's API and simulated-reader tools let us implement and test the payment flow before a physical UX700 arrives. The simulator has no reader UI and is not a UX700-specific hardware emulator. Merchant approval, exact hardware quote/availability, maximum permitted transaction, actual account fees, and final installed qualification remain account-specific. Mark has a Stripe sales meeting pending; no provider switch, hardware order, live charge, deployment, or account change occurred in this review.

For the current V1 Vault, retain the Omarchy SER, Portrait B touchscreen, SQLite sale/door authority, Waveshare controller boundary, signed machine configuration, Ten Kings cloud administration, one cart payment, and one paid-door retry. The UX700 is a payment reader, not the Vault kiosk or door controller. Do not run the Vault customer UI on the UX700 based on Stripe's marketing page: the detailed setup-reader comparison currently lists Apps on Devices for S700/S710 and V660p, not UX700. The UX700 product page and setup guide also conflict on display size/OS/storage, so installed mechanical/electrical specifications must be confirmed from the actual Stripe-supplied model and current product sheet before cutting the cabinet.

## Verified Stripe path

1. Use a U.S. Stripe account and create a Terminal Location with `attended_type=UNATTENDED` and `unattended[premise_type]=OFF_PREMISE` for a remotely managed vending machine. Stripe says the attended/unattended state cannot be changed in place; create a new Location if a different state is needed. Register each UX700 to its Location and store its `tmr_...` reader ID against one Vault machine.
2. The Vault locks an exact cart, tax, reader, machine, and sale identity. A trusted payment service creates one `card_present` USD PaymentIntent for the full total using a stable idempotency key and metadata with non-sensitive Vault references. Initiate `process_payment_intent` on the mapped reader. Its HTTP 200 is only acknowledgement of an asynchronous reader action, not payment success.
3. Process signed Stripe webhooks for `terminal.reader.action_succeeded`, `terminal.reader.action_failed`, and related PaymentIntent status. Also retrieve the PaymentIntent and reader action on uncertain or missing webhook outcomes. Verify exact intent, reader, location, amount, currency, livemode, machine, and sale binding before granting local fulfillment authority. Maintain one durable delivery/receipt boundary between Stripe evidence and the local Vault machine, with replay-safe IDs and ordered outcomes.
4. Only a conclusively paid PaymentIntent can commit the sale and dispatch the existing selected-door commands. A timeout, `connection_error`, reader offline/busy, or absent webhook is not a decline and must hold the sale for reconciliation. Stripe explicitly notes a reader connection error can occur even when its backend has processed the payment. Do not create a second PaymentIntent or re-open a door to recover an ambiguous response.
5. Keep the no-sensor rule: controller ACK/OFF proves only the controller path, not physical door opening or customer retrieval. Stripe has no Nayax-style vend-result API. Vault owns door outcomes, support reference, one bounded paid-door retry, and staff-reviewed refunds. Use Stripe's refund API for approved full/partial refunds after a captured charge; never automatically refund based only on a serial ACK or UI timeout.

**Recommended V1 capture choice:** automatic capture simplifies the existing no-sensor purchase-before-door flow. A `succeeded` PaymentIntent means the payment is captured; durable local authorization/fulfillment commitment must be recorded before dispatching the door command. The current Nayax-shaped state machine cannot consume `SETTLED` as its first callback because it requires authorization/fulfillment commitment first. Implement a provider-neutral, atomic transition that records Stripe's already-captured fact and then commits fulfillment exactly once. Manual capture is a possible later design but requires a precise policy for a door that may have opened while its result is uncertain; Stripe's Terminal guide says manual capture must occur within two days. Do not choose manual capture merely to imitate Nayax's vend-result protocol.

## Current code fit and gaps

| Existing Vault asset | Stripe integration change |
| --- | --- |
| `packages/vault-machine` local SQLite, sale/idempotency, callback journal, recovery, signed config, controller queue | Preserve. Add a Stripe payment adapter and durable Stripe evidence ingress/reconciliation. Refactor Nayax-specific payment names and `reportVendResult` assumptions into provider-neutral boundaries. Keep LIVE blocked until release/field checks. |
| `packages/vault-contracts/src/adapters.ts` `NayaxAdapter` / `NayaxCapabilities` | Add a payment provider interface that represents Stripe intent ID, reader ID, captured/authorized state, limits, cancellation, and source evidence without pretending Stripe has a vend-result call. |
| `frontend/vault-kiosk` Portrait B | Preserve cart/door UI. Show pay-on-reader, declined/unknown, retrieval and support states. The UX700 handles secure card entry/PIN. |
| Ten Kings cloud admin/enrollment/outbox | Bind per-machine reader/location IDs, hold server-side Stripe credentials/webhook secret, receive and verify webhooks, expose least-privilege machine status and finance/support reconciliation. Design active-sale continuity if Ten Kings cloud fails: the current owner policy permits no new checkout during cloud loss, while an already-active paid sale must not be lost. The exact local-versus-cloud Stripe API authority and field-key exposure need an implementation security review before LIVE. |
| Existing website Stripe checkout code | Reuse account knowledge only; online card checkout is a different API flow and does not prove unattended Terminal acceptance. |

## What can be built before hardware

- Set up a Stripe sandbox/test-mode Terminal Location and a simulated smart reader. Stripe's server-driven test helper `present_payment_method` can exercise success and decline without money movement. Use test credentials only in a protected development environment.
- Implement stable sale-to-PaymentIntent idempotency, one reader action at a time, webhooks, status polling/reconciliation, restart replay, cancellation, refund-request review, and exact money/reader/location validation. Test network timeouts, webhook duplicates/reordering, paid-but-door-unknown, and a second-card attempt against the same PaymentIntent.
- Run the existing Vault simulator and test payment/door composition with a simulated Stripe reader. Record tests separately from physical UX700 verification. The simulator does not test UX700 display, PIN, chip/contactless, cable/power, firmware, or network reliability.
- Prepare a per-machine Terminal Location/Reader binding and an acceptance checklist for account approval, test-card flow, reader action status, receipt, high-ticket cart, reboot/reconnect, refund, and controller/door observation.

## Capabilities worth planning

| Priority | Capability | Vault use / boundary |
| --- | --- |
| V1 | Chip, contactless, Apple Pay/Google Pay and magstripe | UX700 product page lists these. Stripe's unattended guide currently names Visa, Mastercard, American Express and Discover; validate the actual supported tender list and high-ticket CVM/PIN path on the terminal. Wallets cannot be tested in Terminal test mode. |
| V1 | Reader/Location management, status and event webhooks | Per-machine mapping and actionable reader offline/busy/failure state. Stripe's reader status alone is not payment authorization. |
| V1 | Full and partial refunds, receipt email/customer support | Staff-approved financial resolution tied to immutable sale/intent/item records; collect only the customer contact required for receipt/support. Provide a compliant receipt option and support information at the unattended machine. |
| Evaluate | Reader cart display and custom splash | The API exposes `set_reader_display`; product page lists splash customization. Verify UX700-specific behavior with hardware before replacing any accepted Portrait B presentation. |
| Evaluate | Stripe Tax Calculation API | Potential future replacement for manually configured Vault tax rates. It is a separate integration/cost and cannot be silently substituted for the approved signed-rate/rounding policy. |
| Evaluate | Unified Stripe reporting, payout schedule, Radar/disputes | Reconcile Terminal charges and refunds with the current Stripe account; review account-specific risk and payout settings. No provider can guarantee issuer approval of high-value collectible sales. |
| Defer | Saving cards, subscriptions, custom POS on reader, offline payments | Not needed for anonymous one-time Vault sales. Server-driven Terminal does not collect offline. A product-page offline-mode label does not make the chosen server-driven flow offline-capable. |

Stripe offers daily automatic payouts of **available** funds every business day, but a daily payout schedule does not accelerate settlement. Stripe says the first live payout is typically delayed 7–14 days and later availability depends on account settlement timing and risk. Confirm the approved account schedule and any reserve with Stripe; do not equate daily payouts with next-day receipt of each sale.

## Questions for the Stripe sales/solutions call

1. Approve **fully unattended U.S. collectible mystery-pack vending**, with the actual product description, average ticket, maximum multi-pack cart including tax, and expected monthly volume. Confirm transaction/issuer/reader/contactless/PIN limits for the account; the PaymentIntent API's eight-digit amount field is not a promise of merchant approval at that value.
2. Confirm that the existing Stripe account may use UX700 and server-driven Terminal for this business, whether any underwriting, reserve, additional certification, or rollout review applies, and whether a test/sandbox UX700 can be ordered now.
3. Quote UX700 hardware, power/mount/accessories, shipping/lead time, domestic/international processing, any account-specific Terminal use fee, refunds/disputes/P2PE, payout schedule, and any reserve. Published standard Terminal pricing is a benchmark, not this account's approved quote.
4. Confirm the supported US network/payment methods, maximum transaction and multi-pack cart, PIN/CVM experience, receipts/signage, device-specific UI/splash/cart-display support, and whether offline mode is possible under **server-driven** integration (current docs say no).
5. Confirm the exact terminal model/revision, power/mount opening, network requirements, setup/registration procedure, hardware test-card process, and what production acceptance Stripe requires for one unit and later fleet units.

## Sources checked 2026-09-28

- UX700 setup and US availability: https://docs.stripe.com/terminal/payments/setup-reader/ux700
- Unattended Location fields, supported networks, disclosures: https://docs.stripe.com/terminal/unattended-readers
- Server-driven integration and simulated-reader support: https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=server-driven
- PaymentIntent flow, webhooks, error recovery, capture: https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven
- Reader registration: https://docs.stripe.com/terminal/payments/connect-reader?terminal-sdk-platform=server-driven&reader-type=internet
- Terminal testing: https://docs.stripe.com/terminal/references/testing
- Reader comparison and Apps on Devices: https://docs.stripe.com/terminal/payments/setup-reader
- UX700 marketing/specifications (conflicts with setup guide on some hardware details): https://stripe.com/terminal/ux700
- Published US Terminal pricing: https://stripe.com/pricing
- Payout schedule versus settlement timing: https://docs.stripe.com/payouts
- Nayax integration process, for comparison: https://devzone.nayax.com/docs/integration-process
