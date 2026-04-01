# Task 19B Analysis: Identify-Set and Screen 2 Prefetch Lifecycle Races

Date: 2026-04-01
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch: `main`

## Scope

- Investigate `cardNumber` timing/state in Add Cards.
- Fix the identify-set effect so it does not cancel itself on unrelated rerenders.
- Fix the Screen 2 prefetch effect so it does not regenerate unstable prefetch keys and refire unnecessarily.
- Limit code changes to `frontend/nextjs-app/pages/admin/uploads.tsx`.

## Findings

### 1. `cardNumber` lives in `intakeOptional`, not `intakeRequired`

- State definitions in `frontend/nextjs-app/pages/admin/uploads.tsx`:
  - `IntakeRequiredFields` does not include `cardNumber`
  - `IntakeOptionalFields` includes `cardNumber: string`
- The primary state hooks confirm this split:
  - `intakeRequired` is initialized at `uploads.tsx:689-696`
  - `intakeOptional` is initialized at `uploads.tsx:698-715`

Conclusion:
- `cardNumber` is treated as an optional/form-step-2 field in the state model, even though downstream identify-set logic needs it earlier.

### 2. OCR populates `cardNumber` before the user taps Next

- When OCR suggestions are fetched and succeed, `fetchOcrSuggestions(...)` does two immediate writes before any Next button interaction:
  - `syncOptionalFieldsFromOcrAudit(...)` at `uploads.tsx:3142-3145`
  - `applySuggestions(...)` at `uploads.tsx:3146-3149`
- Both of those functions write directly into `intakeOptional.cardNumber`:
  - `syncOptionalFieldsFromOcrAudit(...)` updates `next.cardNumber` at `uploads.tsx:2624-2633`
  - `applySuggestions(...)` updates `next.cardNumber` at `uploads.tsx:2826-2833`
- Existing review loads also hydrate `cardNumber` directly into `intakeOptional` before the UI enters the required step:
  - `loadQueuedCardForReview(...)` sets `cardNumber` in `setIntakeOptional(...)` at `uploads.tsx:2316-2323`
  - then sets `intakeStep("required")` at `uploads.tsx:2378-2379`
- The Next button handler does not “commit” optional fields into state. It only saves metadata and flips the step:
  - `handleIntakeRequiredContinue(...)` calls `saveIntakeMetadata(false)` and then `setIntakeStep("optional")` at `uploads.tsx:4849-4858`

Conclusion:
- `cardNumber` is available in state as soon as OCR finishes, not only after the user taps Next.
- The Screen 1 / Screen 2 distinction is a UI step distinction, not a delayed state-commit model.

### 3. Identify-set currently reads only `intakeOptional.cardNumber`

- The identify-set effect currently derives:
  - `cardNumber = sanitizeNullableText(intakeOptional.cardNumber)` at `uploads.tsx:3961-3967`
- The effect requires all five primary fields:
  - year
  - manufacturer
  - sport
  - cardNumber
  - playerName
- If any of those are blank, it clears/returns at `uploads.tsx:3978-3981`

Conclusion:
- There is no evidence that Screen 1 waits until Next to populate `cardNumber`.
- The more likely failure mode is not “optional fields only commit on Next”; it is that the identify-set effect lifecycle is unstable and gets invalidated by unrelated rerenders while OCR/product-set state is still settling.

### 4. OCR state lands in three places, but the live form state is `intakeOptional`

- OCR response first updates `ocrAudit`:
  - `setOcrAudit(payload?.audit ?? null)` at `uploads.tsx:3105`
- OCR also updates `intakeSuggested`:
  - `applySuggestions(...)` merges into `intakeSuggested` at `uploads.tsx:2728`
- OCR writes directly into the live editable form state:
  - required fields into `intakeRequired` at `uploads.tsx:2729-2780`
  - optional fields into `intakeOptional` at `uploads.tsx:2781-2878`

Conclusion:
- `ocrAudit` and `intakeSuggested` are supporting/staging surfaces, but `intakeOptional` is updated immediately as part of OCR application.
- There is no “transfer to intakeOptional on Next” path in the current code.

### 5. Identify-set cancellation is caused by lifecycle churn, not missing primary state storage

- The identify-set effect currently depends on:
  - `fetchIdentifiedSetMatch`
  - OCR text-derived strings
  - `intakeOptional.cardNumber`
  - `intakeOptional.insertSet`
  - `intakeOptional.teamName`
  - required fields
  - `ocrStatus`
  - auth/admin flags
- It computes a request key including:
  - the five primary fields
  - `teamName`
  - `insertSet`
  - front OCR text
  - combined OCR text
- Cleanup always flips `cancelled = true`

Why this is unstable:
- `insertSet`, `teamName`, and OCR-adjacent state can change while the identify request is in flight.
- Those changes cause cleanup to run and cancel the prior request, even when the real identify inputs the operator cares about have not changed.

### 6. Screen 2 prefetch key is broader than the actual prefetch identity

- The Screen 2 prefetch effect computes `prefetchKey` from:
  - `intakeCardId`
  - `scopedProductSetId`
  - `scopedCardNumber`
  - `year`
  - `manufacturer`
  - `sport`
  - `teachLayoutClass`
- That key is created at `uploads.tsx:3236-3244`

Why this is unstable:
- The actual Screen 2 prefetch target is the scoped set + card number for the current card.
- Extra fields like `teachLayoutClass` and the required-field values can change during OCR/application churn without changing the intended prefetch target.
- `fetchOcrSuggestions(...)` itself is also recreated from changing dependencies, which further increases effect churn if the prefetch effect depends on that callback directly.

## Root Causes

### Problem 1: Identify-set self-cancellation

- The effect cleanup cancels in-flight requests on every dependency-driven rerender.
- The dependency and request-key surface is wider than the core identify inputs.
- Result: the request often resolves after the effect has already invalidated itself.

### Problem 2: Screen 2 prefetch key churn

- The prefetch key includes fields beyond the actual scoped set/card identity.
- The effect depends on unstable values/callback identities, so the lifecycle is easier to restart than necessary.
- Result: repeated prefetch attempts and dropdown loading-state flicker.

### Problem 3: “Next commits cardNumber” is not confirmed

- Investigation does not support this hypothesis.
- `cardNumber` is written into `intakeOptional` immediately when OCR resolves.
- The issue is lifecycle stability, not delayed commit on Next.

## Fix Direction

1. Keep `cardNumber` in the existing state model.
   - No data-model change is needed.
2. Stabilize identify-set around the real identify inputs.
   - Use refs so cleanup only aborts when those inputs truly change.
   - Avoid rerunning solely because optional/tiebreak helper fields changed.
3. Stabilize Screen 2 prefetch around the real prefetch identity.
   - Key it from card + scoped set + scoped card number.
   - Use refs for the latest callback/touched flags so unrelated rerenders do not restart the lifecycle.
