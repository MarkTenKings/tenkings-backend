# ATLAS customer submissions — owner direction, September 23 Pacific / September 24 UTC, 2026

Status: owner-selected product workflow. This document records the intended experience and separates it from current implementation. It does not assert that checkout, kiosk hardware or dealer payouts are live.

## Service choices

| Route | Grading price | Advertised turnaround | Physical handoff |
| --- | --- | --- | --- |
| Mail-in | $40 per card | Two weeks | Customer packages and mails the cards to ATLAS. |
| Authorized dealer kiosk | $50 per card | One week | Customer packages and deposits the cards in the ATLAS kiosk dropbox at that dealer. |

The authorized dealer is a location and referral partner, not a quoting, checkout or fulfillment operator. ATLAS handles the submission, payment, receipt, packaging guidance, label and subsequent custody workflow. The shop earns 10% for cards submitted through its kiosk and performs no required submission or handling work. Promoting ATLAS and serving visitors in the shop are optional dealer activities.

This supersedes the lead's contact/quote-only interpretation of **grading submissions**. Existing separate market features for selling an already graded card do not define this submission flow; this direction does not invent dealer buy offers or rewrite their contracts.

The exact commission basis, shipping charges and turnaround start event are pending answers to the root's two concise follow-up questions. $5 per dealer card is the proposed interpretation of 10% of the $50 grading fee, not a silently finalized rule about tax, postage, discounts, refunds or payouts. Do not advertise an all-inclusive delivered price or invent a date guarantee while these details remain unresolved.

## One mobile submission flow

1. **Enter.** Online customers select mail-in or an authorized kiosk location. A kiosk's QR code or NFC link opens the same ATLAS mobile website with that configured dealer/location context. No app installation or dealer-operated data entry is required.
2. **Verify phone.** Enter phone number and complete SMS verification. Reuse the existing account for a verified returning customer. Do not reveal account existence before verification.
3. **Complete profile once.** A new customer enters name, postal address and email. A returning customer with complete details proceeds directly to adding cards. Saved details remain editable and the final order retains its own confirmed snapshot. An older account missing email or required address fields completes only the missing information.
4. **Add cards.** Tap **Add card**, take the front photograph, then the back photograph using the phone camera. Persist the exact pair and return to **Add card** for the next card. Upload and identification continue in the background; the customer does not type routine card details or press an identification/grading start button. Preserve originals, explicit side association and interrupted-upload recovery. An uncertain identity must remain visibly pending or correctable instead of being invented.
5. **Finish adding.** Tap **Done / Submit for grading** to open the review screen. This action does not imply that payment succeeded or physical cards arrived.
6. **Review and checkout.** Show all cards and identified details in a list, allow review/correction, and show card count, unit price, grading subtotal, any shipping line items, actual applicable taxes and the final total. Bind the payable quote to the exact cart, customer, channel and location. Changing the cart invalidates the old payable amount.
7. **Pay.** At a kiosk, the customer's phone prompts payment at the associated tap/insert terminal. The practical implementation interpretation for mail-in is remote online payment on the phone; the at-home flow cannot depend on a physical kiosk terminal. This does not select a payment provider or product. Both complete the same order contract. Provider-confirmed payment, not the browser success screen, authorizes a paid order.
8. **Receipt.** Show confirmation, order number and digital receipt, and automatically deliver the receipt by email and SMS. Persist separate notification outcomes; a delivery failure must not charge again or lose the paid order. Communication is transactional, not a marketing opt-in.
9. **Prepare and hand off.** Show packaging instructions and produce the appropriate order/package label. Kiosk customers attach the printed label and use the dropbox. Mail-in customers package and mail the cards. Order-identification labels and purchased carrier postage are different artifacts; shipping configuration must establish which the selected route provides. A print request is not physical print completion, and checkout is not proof of drop-off or mailing.
10. **Track.** Show understandable order and per-card progress through recorded custody, grading and return events. Customers see only their own cards. The dealer portal shows its own kiosk usage, customer/submission counts, financial attribution and custody progress, without requiring the dealer to advance the workflow.

## Authority and evidence

- Customer capture is customer-owned intake/identification evidence. These photos start identification, not pre-arrival customer grading. It does not grant staff authority, establish physical receipt, confirm a final grade or publish a report. Preserve the separate staff grading and trained-human final approval boundaries.
- Resolve kiosk identifiers against an active server-managed location registry. A QR/NFC entry establishes entry provenance, not verified physical presence or a deposited package. Never accept an arbitrary client-supplied dealer, price, terminal, commission or custody event.
- The order, customer-owned card records, submitted image pair, location and later physical grading records must remain linked without granting public access to private photos or customer data.
- Dealer staff authentication and location memberships are distinct from customer and grading-staff permissions. Aggregate counts and order/card status projections do not confer access to customer addresses, payment data or another dealer's records.
- Payment collection, provider confirmation, refunds, notification delivery, printing, physical deposit, pickup, ATLAS receipt, grading, dispatch and return are separate facts with idempotent operations and recoverable unknown outcomes. Only recorded events move the tracker.
- Commission accounting must be attributable to exact paid order lines and support explicit refund/reversal records. Actual payout scheduling, transfer permissions and refund terms remain configuration/operating decisions; no payout is authorized by an implementation test.
- ATLAS customer commerce stays separate from Ten Kings inventory ownership, TKD, buyback, tax records and merchant credentials. Reuse suitable technical patterns through scoped adapters, not unrelated financial writers.

## Current implementation boundary

The September 24 V5 release deployed automatic **staff grading intake**, shared research/catalog integration and report/dealer presentation. The customer application remains the earlier dedicated release. Existing customer phone authentication, accounts, saved return profiles, immutable text-based submissions and ownership-scoped per-card tracking provide a foundation.

The existing customer form requires manual card descriptions, limits a submission to 25 cards, has no email profile field, and has no customer camera/upload/automatic identification path. Existing customer submission creation is not a payment or kiosk order. Photo intake, checkout/tax/payment terminals, transactional receipt delivery, kiosk printing, trusted location attribution, dealer access/commission accounting and the complete pickup/return event sequence require further implementation and acceptance. Do not present the deployed staff Add cards screen as the completed customer journey.

The user-defined experience above is the acceptance target. Historical customer docs that defer email, require manual card descriptions, offer dealer quotes, or describe handoff to shop personnel do not override it. Existing deployed behavior and historical evidence remain recorded accurately until superseded by a verified release.
