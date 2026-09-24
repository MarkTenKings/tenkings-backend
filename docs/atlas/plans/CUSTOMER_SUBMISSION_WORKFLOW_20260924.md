# ATLAS customer submissions — owner direction, September 23 Pacific / September 24 UTC, 2026

Status: owner-selected product workflow. This document records the intended experience and separates it from current implementation. It does not assert that checkout, kiosk hardware or dealer payouts are live.

## Service choices

| Route | Grading price | Shipping / transport | Advertised turnaround | Physical handoff |
| --- | --- | --- | --- | --- |
| Mail-in | $40 per card | Additional FedEx shipping, quoted through ATLAS's account before checkout | Two weeks | Customer prints the supplied FedEx label, attaches it to the box and ships to ATLAS. |
| Authorized dealer kiosk | $50 per card | Included; no customer shipping fee | One week from ATLAS collection | Customer uses the kiosk dropbox. An ATLAS team member collects and returns the cards to the dealer location. |

The authorized dealer is a location and referral partner, not a quoting, checkout or fulfillment operator. ATLAS handles the submission, payment, receipt, packaging guidance, label and subsequent custody workflow. The shop earns **$5 per $50 card**, the owner-confirmed 10% of the grading fee with taxes and shipping excluded, and performs no required submission or handling work. Promoting ATLAS and serving visitors in the shop are optional dealer activities.

This supersedes the lead's contact/quote-only interpretation of **grading submissions**. Existing separate market features for selling an already graded card do not define this submission flow; this direction does not invent dealer buy offers or rewrite their contracts.

Owner follow-up confirms the commission basis and route-specific shipping policy above. Mail-in shipping is an additional real FedEx quote on the ATLAS account, included in the order total before payment, with a printable label afterward. Mark confirms that kiosk turnaround starts at **actual ATLAS collection**: a Monday deposit collected Wednesday has its one-week deadline the following Wednesday. Advertised turnaround appears at the beginning and checkout. The mail-in turnaround start event and whether mail-in checkout charges both inbound and return shipping remain pending explicit answers. Discounts, refunds and payout timing are not silently decided by the $5 full-price commission. Do not describe unconfirmed return postage as included.

## Entry-page comparison and dealer map

Present the two options clearly **before** customers begin SMS verification or card capture. Each service card should show its price, shipping/transport difference, turnaround and physical handoff in plain language:

- **Drop off nearby — $50/card.** One week from ATLAS pickup. ATLAS pickup and return included. Find a nearby authorized dealer, submit from your phone and use its ATLAS kiosk dropbox. Action: **Find a dealer**.
- **Mail your cards — $40/card + shipping.** Two-week service. See your FedEx shipping quote before payment, then print the label and send your cards. Action: **Start mail-in**.

Show the one-week/two-week advertised turnaround both on this first screen and again at checkout; Mark explicitly confirmed both placements. State **one week from ATLAS pickup** for kiosks. Show applicable taxes clearly and attach the remaining mail-in start/transit terms once confirmed. Do not hide shipping until after payment or imply that a starting grading price is the final total.

The dealer option needs a map plus a usable list of actual enabled authorized kiosk locations, with address/directions and an explicit location selection. Let customers search by ZIP/city; using device location is optional and requires browser permission. Do not label a contact-only directory listing as a live submission kiosk. Preserve the selected location through sign-in, capture, checkout and the final order. A kiosk QR/NFC entrant already has a resolved location but still sees that route's price and included pickup/return before proceeding.

## Dealer pickup and return schedule

The owner explicitly requires pickup/drop-off days and times to be communicated. Each live kiosk location needs its real ATLAS collection and return schedule, local time zone, customer drop-off hours and any intake cutoff. Show the next scheduled collection and projected return date on the location/map detail, route selection and checkout; preserve those details in the order/receipt and tracker. Do not invent a Wednesday route for every dealer: Monday/Wednesday is the owner's illustrative clock example, not a configured operating schedule.

Before physical collection, status is waiting for collection and any projected date is based on the configured schedule. Actual ATLAS collection starts the seven-day service clock. Record that actual event and calculate its target; never turn a planned pickup into completed custody because its time has passed. Retain the originally shown schedule and make missed collection/route changes visible instead of silently shifting a displayed promise. Support explicit holiday/closure exceptions. ATLAS personnel record collection and return; no dealer processing work is added.

## One mobile submission flow

1. **Enter.** Online customers see the service comparison above and select mail-in or a nearby authorized kiosk on the map/list. A kiosk's QR code or NFC link opens the same ATLAS mobile website with that configured dealer/location context. No app installation or dealer-operated data entry is required.
2. **Verify phone.** Enter phone number and complete SMS verification. Reuse the existing account for a verified returning customer. Do not reveal account existence before verification.
3. **Complete profile once.** A new customer enters name, postal address and email. A returning customer with complete details proceeds directly to adding cards. Saved details remain editable and the final order retains its own confirmed snapshot. An older account missing email or required address fields completes only the missing information.
4. **Add cards.** Tap **Add card**, take the front photograph, then the back photograph using the phone camera. Persist the exact pair and return to **Add card** for the next card. Upload and identification continue in the background; the customer does not type routine card details or press an identification/grading start button. Preserve originals, explicit side association and interrupted-upload recovery. An uncertain identity must remain visibly pending or correctable instead of being invented.
5. **Finish adding.** Tap **Done / Submit for grading** to open the review screen. This action does not imply that payment succeeded or physical cards arrived.
6. **Review and checkout.** Show all cards and identified details in a list, allow review/correction, and show card count, unit price, grading subtotal, any shipping line items, actual applicable taxes and the final total. Bind the payable quote to the exact cart, customer, channel and location. Changing the cart invalidates the old payable amount.
7. **Pay.** At a kiosk, the customer's phone prompts payment at the associated tap/insert terminal. The practical implementation interpretation for mail-in is remote online payment on the phone; the at-home flow cannot depend on a physical kiosk terminal. This does not select a payment provider or product. Both complete the same order contract. Provider-confirmed payment, not the browser success screen, authorizes a paid order.
8. **Receipt.** Show confirmation, order number and digital receipt, and automatically deliver the receipt by email and SMS. Persist separate notification outcomes; a delivery failure must not charge again or lose the paid order. Communication is transactional, not a marketing opt-in.
9. **Prepare and hand off.** Show packaging instructions and produce the appropriate order/package label. Kiosk customers attach the printed order label and use the dropbox; ATLAS handles collection and return with no added customer shipping fee. Mail-in customers receive the purchased FedEx label to print and attach to their box. Order-identification labels and purchased carrier postage remain different artifacts. A print request is not physical print completion, and checkout is not proof of drop-off or mailing.
10. **Track.** Show understandable order and per-card progress through recorded custody, grading and return events. Customers see only their own cards. The dealer portal shows its own kiosk usage, customer/submission counts, financial attribution and custody progress, without requiring the dealer to advance the workflow.

## Authority and evidence

- Customer capture is customer-owned intake/identification evidence. These photos start identification, not pre-arrival customer grading. It does not grant staff authority, establish physical receipt, confirm a final grade or publish a report. Preserve the separate staff grading and trained-human final approval boundaries.
- Resolve kiosk identifiers against an active server-managed location registry. A QR/NFC entry establishes entry provenance, not verified physical presence or a deposited package. Never accept an arbitrary client-supplied dealer, price, terminal, commission or custody event.
- The order, customer-owned card records, submitted image pair, location and later physical grading records must remain linked without granting public access to private photos or customer data.
- Dealer staff authentication and location memberships are distinct from customer and grading-staff permissions. Aggregate counts and order/card status projections do not confer access to customer addresses, payment data or another dealer's records.
- Payment collection, provider confirmation, refunds, notification delivery, printing, physical deposit, pickup, ATLAS receipt, grading, dispatch and return are separate facts with idempotent operations and recoverable unknown outcomes. Only recorded events move the tracker.
- Commission accounting must be attributable to exact paid order lines and support explicit refund/reversal records. Actual payout scheduling, transfer permissions and refund terms remain configuration/operating decisions; no payout is authorized by an implementation test.
- ATLAS customer commerce stays separate from Ten Kings inventory ownership, TKD, buyback, tax records and merchant credentials. Reuse suitable technical patterns through scoped adapters, not unrelated financial writers.

## FedEx quote and label boundary

Use the ATLAS FedEx account's actual rate response, not a hardcoded per-card shipping surcharge. Card count should select configured packing guidance and a measured package preset; origin/destination, package weight, dimensions, service and any selected shipment options must match the request sent to FedEx. If customers use a different box, the quote needs that actual packaging information. The card count and customer address alone are not a complete shipping-rate input.

Store the quoted shipping line and its source with the checkout. After verified payment, create the corresponding shipment/printable label under the same durable order operation; recover an uncertain creation outcome before trying again. The returned carrier tracking number belongs to the shipment, separate from the ATLAS order number. A failed rate lookup blocks an accurate payable quote; a failed label response preserves the paid order and shows recoverable label status rather than charging again.

Official technical references: [FedEx Comprehensive Rates documentation](https://developer.fedex.com/api/en-us/catalog/comprehensive-rate/docs.html) describes account rates and package inputs; [FedEx Ship API documentation](https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html) describes shipment creation, returned tracking and labels. These public documents do not prove that the ATLAS account is configured or that a live rate or label has been requested.

## Current implementation boundary

The September 24 V5 release deployed automatic **staff grading intake**, shared research/catalog integration and report/dealer presentation. The customer application remains the earlier dedicated release. Existing customer phone authentication, accounts, saved return profiles, immutable text-based submissions and ownership-scoped per-card tracking provide a foundation.

The existing customer form requires manual card descriptions, limits a submission to 25 cards, has no email profile field, and has no customer camera/upload/automatic identification path. Existing customer submission creation is not a payment or kiosk order. Photo intake, checkout/tax/payment terminals, transactional receipt delivery, kiosk printing, trusted location attribution, dealer access/commission accounting and the complete pickup/return event sequence require further implementation and acceptance. Do not present the deployed staff Add cards screen as the completed customer journey.

The user-defined experience above is the acceptance target. Historical customer docs that defer email, require manual card descriptions, offer dealer quotes, or describe handoff to shop personnel do not override it. Existing deployed behavior and historical evidence remain recorded accurately until superseded by a verified release.
