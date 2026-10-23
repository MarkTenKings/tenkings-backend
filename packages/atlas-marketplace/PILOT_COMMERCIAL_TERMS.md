# Approved pilot commercial terms candidate

The owner approved an 8% fee on card price including ordinary payment processing, no listing fee or buyer premium, and no percentage fee for standard withdrawals. The current approved return-request window is **24 hours after actual delivery**, replacing the earlier seven-day draft. Only severe damage or the wrong product (not the product sold) qualifies, and the buyer must provide proof to ATLAS staff for review. Seller proceeds remain held through the window and staff review of open cases. ATLAS initially pays return shipping; final responsibility is assigned after staff review. ShipStation is the selected shipping provider; service, coverage and account qualification remain separate. No owner choices for these fee/return terms remain pending.

`src/pilot-commercial-terms.mjs` exports `createPilotCommercialTerms(input, context)` and `applyPilotCommercialTerms({terms, listingPolicy, fulfillmentPolicy}, context)`. These functions only construct deeply frozen policy data. They do not activate a calculator, host, provider, real authority or live environment.

The strict builder input requires all of:

```js
{
  id, version, environment, approvalRef, effectiveAt, expiresAt,
  feeScheduleId, feeScheduleVersion, feeScheduleApprovalRef,
  termsRefs: {feeTermsRef, returnsTermsRef, transferTermsRef, payoutTermsRef}
}
```

No policy ID, version, date, approval or terms reference is generated. The `atlas-pilot-commercial-terms-v1` result retains those inputs and a full `termsHash`. Its existing-compatible fee schedule is USD / ITEM_PRICE / VOLUME, one unlimited tier at 800 basis points with fixed cents zero, no minimum or maximum, and processing INCLUDED. HALF_UP integer-cent rounding is an explicit engineering convention disclosed in the schedule; at this exact 8% rate integer-cent prices cannot produce an exact half-cent tie. The fee is rounded once from the full card price; shipping and tax are not part of its basis.

The returns object is `OWNER_TERMS_SELECTED`, recording these specific owner choices rather than global legal or launch approval. Its exact `eligibleReasons` are `['SEVERE_DAMAGE','WRONG_PRODUCT']`, with `requiresBuyerEvidence:true`, `requiresStaffReview:true`, `returnShippingPayer:'ATLAS_INITIALLY'` and `finalResponsibility:'STAFF_REVIEW'`; `pendingDecisions` is empty. Actual return costs and their final responsibility must still be evidenced and reviewed operationally; no deduction or recovery is implied by this data builder. The window starts at `ACTUAL_DELIVERY`, established by retained delivery evidence rather than the time a staff member records it. The release requirements explicitly include the end of the window, staff review, and clearance of open cases. `PILOT_RETURN_WINDOW_MS` is exactly 86400000 elapsed milliseconds: 24 hours, not business days or a local-midnight calculation. Return requests use an exclusive deadline; release can become eligible at that deadline but is never automatic.

Application checks original listing / fulfillment policy identities, versions, environment and supplied return / transfer references. It copies the policies, removes the old fixed fee, adds the exact schedule and commercial disclosures, sets `returnWindowMs`, and retains commercial metadata. Unrelated packing, coverage, protection and reservation requirements remain from the supplied policy. The original policy objects are not mutated. Fresh independent host/policy approval remains necessary for any changed policy hash; this builder does not grant legal or launch approval. Instant payout pricing is not set by these terms.

Focused qualification: `test/pilot-commercial-terms.test.mjs` **4/4 passed** on Node 22 after the final 24-hour/reasons/payer update. Checks cover strict inputs and deep immutability; original-policy preservation and binding refusal; actual fee calculator preview plus listing creation/revision at 8%, near-cent rounding and safe-integer limits; actual SQLite-backed fulfillment with the 24-hour hold, open-case refusal, staff review and release, and late return refusal. Root owns the actual-delivery timestamp and reason/evidence gates and their regressions. No provider, browser, production or shared database operation was performed. Synthetic fixture approval references are not real owner approval records. Callers must supply current approved versions and references; the module creates none.
