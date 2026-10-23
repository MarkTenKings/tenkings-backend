# R2 launch decisions and physical acceptance

Status: review packet only. No business approval is recorded by this document. Production remains disabled; R1 owns deployment. Synthetic fixtures and Stripe test-bank results establish implementation behavior, not commercial policy, title, custody or physical acceptance. The proposed 8% including ordinary domestic processing is still unapproved.

## Decisions the owner must supply

Each decision needs an accountable approver, exact policy text/value, version, effective date, evidence reference and scope (sandbox or production). References identify independently reviewed records; a nonempty string is never approval. Values below are deliberately unset.

| Decision | Required answer | Implemented contract and consequence |
|---|---|---|
| Marketplace fee | Rate or fixed amount; fee basis; rounding; minimum/maximum; processing included or separately charged; treatment of refunds and disputes | Listing policy currently binds exact integer `feeCents` and `feeDisclosure` per listing. A percentage schedule needs an approved deterministic quote adapter that computes the cents before listing; no 8% default. Seller review retains the exact fee/net and policy version. |
| Tax | Responsible collecting/remitting entity; seller/buyer jurisdictions; taxable item/shipping/fee treatment; tax provider; exemptions and refund handling | Buyer quote requires exact `taxCents` and `taxQuoteRef` before reservation. Existing grading-tax credentials or treatment are not marketplace qualification. The quote and settlement allocation must agree. |
| Shipping | Who pays; allowed destinations/carriers; pricing basis and quote lifetime; service estimate; address validation; coverage, loss and return-label funding | Quote binds `shippingCents`, `shippingQuoteRef`, `deliveryEstimate` and total. ATLAS-held fulfillment requires actual tracking/coverage/dispatch evidence. No zero-price or estimated fixture value becomes a live quote. |
| Checkout and listing terms | Reservation duration; protection disclosure; seller consent and transfer of title point; revision and cancellation terms | `reservationTtlMs` must be positive and at most 24 hours. An uncertain payment retains the reservation until original-object reconciliation; elapsed time does not cancel a charge. Revised listings require fresh binding and quote. |
| Returns and appeals | Eligible reasons; return/appeal windows; condition requirements; return shipping payer; review authority; outcome evidence | `returnsTerms`, `returnsTermsRef`, `appealsTermsRef` and `returnWindowMs` must agree. The fixture's zero-day window is not approved. Return receipt and front/back/holder inspection must be retained; refund-dependent closure requires the confirmed original refund. |
| Seller reserve and release | Reserve amount/basis, duration and exceptions; delivery/protection milestone; reviewer; release conditions; who can release a hold | `reserveTermsRef`, `transferReleaseTerms`, `transferTermsRef`, fulfillment policy and explicit holds bind the decision. The engine supports evidenced holds/releases; no percentage reserve or timed automatic release is selected. Release cannot precede delivery plus the approved return window or bypass an open case/finance hold. |
| Bank cash-out | Manual request vs other schedule; availability rule; minimum/maximum; frequency; failed-payout handling; permitted bank/country/currency; disclosed timing/fees | Current candidate qualifies standard manual USD payout to the exact eligible bank. Payout is separate from seller transfer. Instant payout, indefinite holding and spending proceeds are not enabled. Any different schedule/product needs its own implementation and provider qualification. |
| Refund funding | Refund amount and allocations by item/tax/shipping/fee; fee reimbursement; platform vs seller responsibility; refunds after transfer or bank payout; insolvency funding | Exact original charge/refund and transfer reversal are separate retained intents. Seller recovery due is explicit. A refund cannot silently undo a bank payout or invent cash. Approved funding and exception authority are required before a live refund path. |
| Dispute and negative balance funding | Responsible entity; reserve/capital source; evidence owner/deadline; connected negative-balance handling; recovery/collection limits | Provider dispute evidence and held balances remain explicit. Money holds block physical release. No automatic exception clearing, new charge, seller debit or replacement money movement is authorized by recovery. |
| Seller/title/custody authority | Verified seller identity; genuine title evidence; signed consignment and current hold consent; ATLAS custody location; review and revocation authority | The R1 compatibility adapter remains unavailable until genuine qualified authority exists. A published report, collection card, test seller or policy reference does not authorize a listing. Claims and ownership history remain OFF pending Fingerprint. |
| Operations and incident authority | Named operators; alert destination/sender; reconciliation cadence and evidence age; retry limits; stop/restart authority; retention and incident response | Hosted recovery is default-off and bounded. Its independently approved capability permits GET reconciliation and idempotent settlement of originals only. Alert delivery needs a qualified idempotent sender plus lookup; uncertain delivery is looked up, not resent. |

## Engineering defaults already enforced

- Integer USD cents, balanced immutable journals, one retained intent per operation, distinct platform/connected cash and seller proceeds. No Ten Kings TKD access.
- Exact listing, report revision, quote, buyer, seller, account and policy binding. Browser success or an elapsed timer never proves payment, delivery or release.
- Raw signed webhook bytes are verified, delivery retained and provider facts independently retrieved. Unknown outcomes block replacement dispatch. Recovery does not create payment, transfer, refund, reversal or payout effects.
- Existing R1 staff/customer authentication, scoped cookies and original signed requests; exact approved deployment Host pins do not broaden browser Origin. Dedicated PostgreSQL is required for the candidate host.
- Fixed-price, ATLAS-held pilot only; no fabricated media/authority and no price guidance while guidance inputs/policy are unavailable. Buyer premium is zero in the current quote contract; changing that requires a reviewed contract and disclosure change.
- Default-off host, scheduler, settlement capability and alerts. Policy revocation is rechecked; opaque authority is not reconstructible from a browser role or JSON. Claims/history stay disabled.

These are implementation boundaries, not substitutes for approved business rules. Engineering can encode the selected rules once the answers exist; it must not infer them from sandbox amounts.

## Physical pilot acceptance record

Use one genuinely eligible approved card and an explicitly authorized transaction only after the above gates. The test owner supplies the real records; no fixture or generated reference can satisfy this checklist.

| Stage | Required retained evidence | Acceptance |
|---|---|---|
| Intake / sale authority | Exact card, approved Front/Back/report revision and hashes; verified title/seller; signed consignment and hold choice; custody location and independent reviewer | All refer to the same physical card and current authority. Report public hash and private approval hash remain distinct. |
| Packing | `intakeFrontRef`, `intakeBackRef`, `holderConditionRef`, `packingPhotoRef`, `fittedInsertRef`, `firstSealRef`, `secondSealRef`, `cleanLabelAreaRef`, `resaleInstructionsRef`, `replacementKitRef` | Operator records the actual two seals, fit, condition and label area under approved `packingProtocolRef`; replay does not manufacture a second pack. |
| Dispatch | `carrierRef`, `trackingRef`, `coverageRef`, `dispatchReceiptRef` | Real carrier acceptance and coverage bind the order/card; a purchased label alone is not dispatch. |
| Missing scan / exception | Carrier timeline, approved `missingScanAfterMs`, case evidence and assigned reviewer | Open the appropriate case only at its defined threshold; retain holds until explicit reviewed resolution. |
| Delivery | `deliveryProofRef` and delivery timestamp | Proof is retained and attributable. Return clock starts from the recorded event, not a fabricated timer. |
| Seller release | `releaseReviewRef`, original policy/quote/payment binding and fresh finance/case state | Return window elapsed, no open protection case or finance hold, explicit review and exact seller allocation. Only then may the original transfer proceed. |
| Return / appeal | Received parcel, return Front/Back/holder inspection, applicable policy and review evidence | Inspect the real item, retain the decision and reconcile any required original refund before case closure. |
| Cash-out / closeout | Eligible actual bank, provider/current balance evidence, original payout, complete two-account inventories and explicit exception reviews | Cash, seller proceeds and bank-paid amount reconcile; unknown effects remain held and operator-visible. |

## Release sequence for R1

1. Review the additive host/auth/storage and hosted-finance candidate against current R1 source; preserve grading, slab behavior and Ten Kings. Register/apply nothing from this packet automatically.
2. Fill and independently approve the above policy and authority inputs; bind exact versions/hashes. Validate fee/quote economics and actual provider/account capability with the approved account scope.
3. Qualify the exact hosted sandbox routes, raw webhook ingress, dedicated role/gateway, recovery lease and alert destination using the separate hosted packet. Reuse retained successful money-stage evidence unless a changed interface leaves a specific unresolved risk.
4. Complete the physical and joined authenticated pilot acceptance. Verify default-off rollback and independent stop controls; do not repeat grading, approve cards, print labels or dispatch live payments merely to prove read paths.
5. R1 coordinates the production freeze, credentials, migration/grants/routes, registration and release. This R2 checkout stops before that boundary. No live date or perfection claim replaces the remaining evidence.
