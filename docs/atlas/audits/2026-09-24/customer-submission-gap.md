# Customer submission implementation audit — September 24, 2026

Read-only source review at `db18d133`, following the [owner's mobile submission workflow](../../plans/CUSTOMER_SUBMISSION_WORKFLOW_20260924.md). Two fresh Astra Extra High specialists reviewed customer intake and payments; the existing independent Astra reviewer audited dealer authority and tracking. No production, payment, notification, hardware or database effects occurred.

## What can be retained

The dedicated customer application already provides SMS account creation/sign-in, returning-account reuse, session/CSRF protection, canonical phone handling, saved name/return-address profiles, immutable submission snapshots, idempotent submission requests and customer-owned status reads. Its serving database role is deliberately restricted to `atlas_customer.customer_call(text,jsonb,jsonb)`.

Neutral photo handling and identification engines exist, but their current staff repositories are not customer APIs. Retain the customer gateway and supply genuine customer ownership and durable effect records rather than fabricating staff/reviewer principals. Keep ATLAS merchant/customer/order records separate from Ten Kings inventory, wallet and pack sales.

## Gaps and concrete integration points

| Required behavior | Observed source | Implementation work |
| --- | --- | --- |
| Profile before capture, including email | `frontend/atlas-customer/lib/server/policy.mjs` and SQL `valid_profile` require exactly seven name/address fields; email is rejected. | Add email and missing-profile completion with compatibility for historical profile snapshots. |
| Repeat front/back camera intake | `components/AccountWorkspace.jsx` accepts manual title/category rows, maximum25. `lib/server/http.mjs` has no photo/identification operations. | Customer-owned draft cards, exact-side upload plans, immutable originals, upload recovery and background identification; then review and an immutable checkout snapshot. |
| Mobile camera and previews | Customer `next.config.mjs` and the public `/account` mount explicitly disable camera; customer CSP restricts images/connections. | Permit same-origin customer camera deliberately in both layers; narrowly admit the required preview/upload sources. |
| Trusted kiosk attribution | Existing submission records only `DEALER_DROP_OFF` versus `MAIL_IN`. Directory entries are configuration, not authenticated kiosk records. | Active server-owned dealer/location registry, QR/NFC entry context retained through sign-in, exact location snapshot on order. A shared static link does not prove physical presence. |
| Checkout, tax and payment | No ATLAS customer quote, payment, terminal or provider webhook exists. | Server-priced exact card roster, authoritative tax/shipping, durable idempotent payment attempt and verified provider completion; online and terminal adapters share order finalization. |
| Kiosk terminal handoff | No configured reader or terminal integration exists in these applications. | Authenticated kiosk/reader association and short-lived single-use handoff for the exact checkout; serialize reader use and reconcile unknown/busy results. Client-supplied reader IDs cannot choose arbitrary terminals. |
| Financial receipt by email and SMS | Existing Twilio code provides Verify only. Existing receipt terminology describes physical/technical facts. | Financial receipt and separately tracked transactional delivery jobs after confirmed payment; delivery failure never repeats collection. |
| Package label and postage | Existing grading label is a slab label, not submission shipping. | Paid-order package label and kiosk printer transport; distinct actual carrier postage integration if the route includes purchased postage. |
| Current grading progress | Existing `CustomerCard.specimenId` and `card_projection` read legacy `StaffSpecimen`/`StaffGradingOperation`/`StaffReportApproval` and finishing records. | Explicit immutable customer-card→current `atlas_manual.card` linkage at physical intake; evidence-derived projection preserves historical legacy records. |
| Dealer portal and commission | No dealer memberships, location-scoped sessions, commission journal or dropbox custody events exist. | Distinct dealer authorization, own-location projections, exact payment-line attribution and refund/reversal accounting; recorded pickup/return events with no dealer-operated workflow requirement. |

The main existing customer migration is `frontend/atlas-app/prisma/migrations/20260909020000_customer_accounts/migration.sql`. Extend behavior through additive migrations; do not rewrite it or historical profile/submission bytes. Customer-owned projections must continue denying other accounts, and dealer projections must deny unrelated locations and customer private address/payment data.

## Payment boundary

Ten Kings' `backend/pack-service/src/index.ts` and `frontend/nextjs-app/components/StripeCheckout.tsx` provide reference examples of PaymentIntents/card entry only. The inspected legacy routes accept client identifiers, lack a supplied creation idempotency key and write unrelated pack/Item/wallet state. Its shipping operation accepts a client fee and charges a wallet. These are not an ATLAS payment/order/terminal/tax implementation to import.

The ATLAS customer runtime should keep the customer gateway for customer actions. Provider callbacks need a separate restricted, raw-body/signature-verified authority. The ordinary customer JSON+same-origin+CSRF route cannot serve as that webhook by inventing a customer session. Public and staff build boundaries exclude Stripe dependencies; payment effects belong in the customer/private commerce boundary. Any hosted payment fields need a narrowly revised customer CSP.

Store integer minor-unit prices ($40 =4000; $50 =5000), exact currency and versioned service terms. Unknown tax/postage is not zero. Pin a durable payment request to the exact immutable checkout hash before provider dispatch, reconcile unknown results under the same identity, and enforce one confirmed payment/order outcome. A button click, redirect or terminal-command acknowledgement is not proof of payment.

## Acceptance and operating inputs

Required implementation acceptance includes new/returning customer flows; interrupted multi-card photo capture; side-pair ownership; uncertain identification; exact cart/tax/payment binding; duplicate/lost payment replies and webhooks; concurrent kiosk customers; reader offline/cancel/recovery; receipt delivery failure; label retry; physical custody progression; cross-account/location denial; immutable commission accrual/refund records; and continuity of historical submissions. Fixture success is not physical terminal, printer or real-customer acceptance.

Still needed for live effects: the ATLAS merchant/provider binding, actual terminal/location configuration, authoritative tax configuration, mailing destination and shipping rules, transactional email/SMS sender, kiosk printing hardware, mail-in turnaround start event and refund/payout policy. These inputs do not prevent independent customer-flow development, but must not be fabricated or replaced with another company's financial credentials.

No code implementing these new gaps was added by this audit. The owner requirements are now recorded for the implementation, and the already deployed staff grading workflow remains separate.

## Owner shipping follow-up and FedEx adapter audit

The owner subsequently confirmed $5 per full-price dealer card excluding tax/shipping, zero additional customer shipping fee for dealer service, and ATLAS staff collection/return. Mail-in requires an additional FedEx account-rate quote before checkout and a purchased printable inbound FedEx label. Service differences must be visible at the beginning, with a nearby authorized-kiosk map/list; turnaround also appears at checkout. Kiosk turnaround is confirmed as one week from actual ATLAS collection; location pickup/return days and times must be shown. Mail-in clock start and return-leg charging remain unresolved. These answers supersede the earlier unspecified commission basis/carrier choice; they do not establish deployed adapters.

The checkout specialist found no existing FedEx application adapter/config references, without reading secret files. Use a dedicated server adapter for quote, validation, label creation and reconciliation; keep account/project credentials server-only. Carrier requests need configured origin/destination, intended tender date, package count, packing type/weight/dimensions/units, service and applicable shipment options. Use measured packaging presets or confirmed actual package inputs, not invented weight derived from card count. The return leg must use its own slabbed-card packaging and shipment inputs; do not double the inbound quote by assumption.

FedEx rate responses are estimates and not themselves service-availability proof. Create Shipment returns tracking and label information; PDF labels are supported. Shipment validation does not establish street-address validity. Persist the exact paid order/leg/version request before dispatch and retain returned label bytes for repeat printing. The reviewed documentation did not establish Create Shipment idempotency: a timed-out request stays UNKNOWN and must be reconciled, not automatically replaced. Actual async job IDs can be retrieved; reference tracking is not proof that original label bytes can be recovered. No provider account operation, rate request or label purchase was executed in this audit.

Official sources reviewed: [authorization](https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html), [rates](https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html), [ship/labels](https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html), and [tracking](https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html).

Owner clock follow-up: Monday dealer deposit with Wednesday ATLAS pickup is due the following Wednesday. This selects the actual kiosk collection event, not a universal Wednesday schedule. Add location-local pickup/return schedules and exceptions, projected dates before collection, actual custody timestamps afterward, and preserve visible schedule changes. It does not set the separate mail-in clock.
