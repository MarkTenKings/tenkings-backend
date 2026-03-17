# Task 10 Investigation: Add Cards Flow, Task 10 Regression Surface, and Teach Path

Date: 2026-03-17

Scope:
- Read-only investigation on `main`
- No application code changes
- Sources traced from:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
  - `frontend/nextjs-app/lib/server/variantOptionPool.ts`
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
  - `frontend/nextjs-app/pages/api/admin/variants/options.ts`
  - Add-cards upload/queue/photo APIs
  - `packages/shared/src/cardAttributes.ts`

Important route note:
- There is no `pages/admin/add-cards.tsx` in this checkout.
- The active Add Cards implementation is `frontend/nextjs-app/pages/admin/uploads.tsx`.

## Executive Summary

Task 10 fixed screen 1 Product Set auto-selection by making the variant option pool auto-resolve `selectedSetId` whenever Year / Manufacturer / Sport scope narrows to a single approved set, then immediately writing that resolved set into the Product Set field on the client.

That change fixed screen 1 because Product Set no longer waits for `/api/admin/cards/[cardId]/ocr-suggest` to finish. But screen 2 still depends on the OCR suggest pipeline for:
- `insertSet`
- `parallel`
- `cardNumber`
- `numbered`
- `autograph`

Those fields are not driven by Task 10's new `selectedSetId` path. They still come from:
- existing persisted OCR audit already stored on the card, or
- a refreshed `/ocr-suggest` rerun that starts after the review screen loads and may retry for up to ~9 seconds client-side, on top of server OCR/LLM time.

The likely regression is a sequencing regression, not a pure mapping bug:
- before Task 10, operators often waited 10-12 seconds on screen 1 for Product Set to settle, which also gave `/ocr-suggest` time to finish and update screen 2 data
- after Task 10, Product Set settles immediately, so operators can enter screen 2 before the refreshed OCR/variant-match run finishes
- when that happens, screen 2 shows the earlier/staler OCR audit state, which is where the bad card numbers and over-aggressive `numbered` / `autograph` values are coming from

Teach From Corrections is not a separate teach API. It is the normal card metadata `PATCH` path with `recordOcrFeedback=true`. No server log files were present in the repo checkout or common local log directories, so the teach failure root cause below is an inference from code and error handling, not a confirmed runtime log.

## Full Flow Diagram

```text
/admin/uploads
  |
  | front capture screen ("front")
  |  - POST /api/admin/uploads/presign
  |  - PUT upload
  |  - POST /api/admin/uploads/complete
  |  - cardAsset created with reviewStage READY_FOR_HUMAN_REVIEW
  |
  | back capture screen ("back")
  |  - local pending back blob only
  |
  | tilt capture screen ("tilt")
  |  - POST /api/admin/kingsreview/photos/presign for BACK/TILT
  |  - PUT photo uploads
  |  - POST /api/admin/kingsreview/photos/process?mode=thumbnail
  |  - queue card id for OCR review
  |  - warm background GET /api/admin/cards/[cardId]/ocr-suggest
  |
  | queue screen ("front" review launcher)
  |  - GET /api/admin/uploads/ocr-queue
  |  - operator picks queued card
  |
  | load review card
  |  - GET /api/admin/cards/[cardId]
  |  - screen state seeded from:
  |    - classificationJson
  |    - classificationNormalized
  |    - existing ocrSuggestionJson.audit.fields
  |  - if OCR audit is incomplete, set pendingAutoOcrCardId
  |
  | required detail screen ("required") = screen 1
  |  - GET /api/admin/variants/options?year&manufacturer&sport[&productLine&setId]
  |  - Task 10 can auto-set Product Set immediately from scope.selectedSetId
  |  - pending OCR refresh:
  |    GET /api/admin/cards/[cardId]/ocr-suggest?[year/manufacturer/sport/productLine/setId/layoutClass]
  |    with client retries if status=pending
  |
  | Next fields
  |  - PATCH /api/admin/cards/[cardId]
  |    classificationUpdates only, includeOptional=false
  |
  | optional detail screen ("optional") = screen 2
  |  - same OCR/variant-option effects continue running
  |  - insert/parallel pickers enabled only when variant scope has selectedSetId
  |  - actual auto-selection still depends on OCR suggestions, not just selectedSetId
  |
  | Teach From Corrections
  |  - PATCH /api/admin/cards/[cardId]
  |    classificationUpdates + recordOcrFeedback=true
  |    then writes OcrFeedbackEvent rows and memory aggregates
  |
  | Send to KingsReview AI
  |  - PATCH /api/admin/cards/[cardId] with includeOptional=true
  |  - POST /api/admin/kingsreview/enqueue
  |  - background POST /api/admin/cards/[cardId]/photoroom
  |  - load next queued card or reset back to capture queue
```

Current UI step list in `uploads.tsx`:
- `front`
- `back`
- `tilt`
- `required`
- `optional`

Note:
- `IntakeStep` type still includes `"done"`, but current JSX does not render a dedicated `"done"` screen.

## Where Each Step Lives

Main client flow:
- `buildIntakeQuery`: `uploads.tsx:1703`
- `saveIntakeMetadata`: `uploads.tsx:2066`
- `loadQueuedCardForReview`: `uploads.tsx:2171`
- `validateRequiredIntake`: `uploads.tsx:2329`
- Product Set auto-pick effect: `uploads.tsx:2396-2449`
- Insert/parallel auto-pick effects: `uploads.tsx:2456-2519`
- `applySuggestions`: `uploads.tsx:2522`
- `warmOcrSuggestionsInBackground`: `uploads.tsx:2740`
- `fetchOcrSuggestions`: `uploads.tsx:2771`
- variant options fetch effect: `uploads.tsx:3324-3401`
- `handleIntakeRequiredContinue`: `uploads.tsx:4312`
- `handleTeachFromCorrections`: `uploads.tsx:4330`
- `handleSendToKingsReview`: `uploads.tsx:4357`

Server flow:
- variant option pool: `variantOptionPool.ts:706`
- Task 10 `selectedSetId` single-scope auto-resolution: `variantOptionPool.ts:796-797`
- options API: `pages/api/admin/variants/options.ts`
- OCR suggest route: `pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- card PATCH / feedback write route: `pages/api/admin/cards/[cardId].ts`

## Screen / Step Map

### Capture Queue Screen (`intakeStep === "front"`)

Purpose:
- start a new 3-photo capture
- show queued cards ready for review
- launch OCR review for a queued card

State / data sources:
- `queuedReviewCardIds`
  - persisted in local storage
  - refreshed from `GET /api/admin/uploads/ocr-queue`
- selected queue id
  - user radio selection

Autofill behavior:
- none for card metadata
- only queue hydration / card loading

### Back Capture Screen (`intakeStep === "back"`)

Purpose:
- capture required back photo

State / data sources:
- local preview only until upload

Autofill behavior:
- none

### Tilt Capture Screen (`intakeStep === "tilt"`)

Purpose:
- capture required tilt photo
- finalize card into OCR queue

State / data sources:
- local preview until upload

Autofill behavior:
- after finalize, `warmOcrSuggestionsInBackground(cardId)` starts calling `/ocr-suggest`

### Required Detail Screen (`intakeStep === "required"`) = Screen 1

Visible fields for sports cards:
- Category
- Player name
- Product Set
- Sport (display-only auto field)
- Manufacturer
- Year

Visible fields for TCG:
- Category
- Card name
- Game
- Manufacturer
- Year
- Product line / set

Also visible:
- OCR status / Auto-fill OCR button
- OCR By Photo summary
- Variant Explainability
- captured photo previews

### Optional Detail Screen (`intakeStep === "optional"`) = Screen 2

Visible fields for sports cards:
- Team name
- Insert Set
- Parallel
- Card number
- Numbered
- Autograph checkbox
- Patch checkbox
- Graded checkbox
- Grade company / Grade value if graded
- Teach On Send toggle
- Teach From Corrections
- Send to KingsReview AI
- Teach Regions UI

Visible fields for TCG:
- Team name is replaced by TCG-only set/rarity/language/out-of/foil fields

## Field-Level Source Map

## Screen 1: Required Fields

| Field | Initial source when card loads | Later auto-fill source | What triggers it |
| --- | --- | --- | --- |
| `category` | `classificationNormalized.categoryType` via `loadQueuedCardForReview` | user only after load | GET `/api/admin/cards/[cardId]` |
| `playerName` | `ocrFields.playerName ?? attributes.playerName` | `applySuggestions()` can overwrite if untouched and confidence strong | existing audit from GET, then refreshed `/ocr-suggest` |
| `cardName` | `ocrFields.cardName ?? attributes.cardName ?? normalized.displayName` | `applySuggestions()` if TCG and untouched | GET, then `/ocr-suggest` |
| `game` | `ocrFields.game ?? attributes.game` | `applySuggestions()` if TCG and untouched | GET, then `/ocr-suggest` |
| `manufacturer` | `ocrFields.manufacturer ?? normalized.company ?? attributes.brand` | `applySuggestions()` if untouched | GET, then `/ocr-suggest` |
| `year` | `ocrFields.year ?? normalized.year ?? attributes.year` | `applySuggestions()` if untouched | GET, then `/ocr-suggest` |
| `sport` | `ocrFields.sport ?? attributes.sport ?? inferSportFromProductLine(nextProductLineRaw)` | `applySuggestions()` if untouched | GET, then `/ocr-suggest` |
| `productLine` / Product Set | `resolveHydratedProductLine({ ocrSetName, normalizedSetName, taxonomyFieldStatus })` | Task 10 product-line effect can now set from `variantScopeSummary.selectedSetId`; `applySuggestions()` can also set from OCR `setName` when matched against options | GET audit, `GET /variants/options`, `/ocr-suggest`, touched/manual mode guards |

Notes on Product Set:
- Initial hydration is intentionally conservative and can return blank.
- Task 10 changed the later effect so screen 1 can set Product Set from variant scope alone, without waiting for OCR `setName`.

## Screen 2: Optional Fields

| Field | Initial source when card loads | Later auto-fill source | Dependencies / trigger |
| --- | --- | --- | --- |
| `teamName` | `ocrFields.teamName ?? attributes.teamName` | `applySuggestions()` if untouched | GET, then `/ocr-suggest` |
| `insertSet` | `ocrFields.insertSet ?? normalized.setCode` | `applySuggestions()` and insert auto-pick effect | needs `insertSetOptions.length > 0`; untouched; suggestions from OCR |
| `parallel` | `ocrFields.parallel ?? attributes.variantKeywords[0]` | `applySuggestions()` and parallel auto-pick effect | needs `parallelOptions.length > 0`; untouched; suggestions from OCR |
| `cardNumber` | `ocrFields.cardNumber ?? normalized.cardNumber` | `applySuggestions()` if blank or high-confidence suggestion | GET audit, then `/ocr-suggest` |
| `numbered` | `ocrFields.numbered ?? attributes.numbered` | `applySuggestions()` if blank or high-confidence suggestion | GET audit, then `/ocr-suggest` |
| `autograph` | `Boolean(attributes.autograph ?? false)` | `applySuggestions()` only sets it to `true`, never auto-clears | initial classification or later OCR suggestion |
| `memorabilia` | `Boolean(attributes.memorabilia ?? false)` | `applySuggestions()` only sets it to `true`, never auto-clears | initial classification or later OCR suggestion |
| `graded` | `ocrFields.graded === "true"` or grade fields present | `applySuggestions()` can set true | GET audit, then `/ocr-suggest` |
| `gradeCompany` | `attributes.gradeCompany ?? ocrFields.gradeCompany` | `applySuggestions()` if blank | GET, then `/ocr-suggest` |
| `gradeValue` | `attributes.gradeValue ?? ocrFields.gradeValue` | `applySuggestions()` if blank | GET, then `/ocr-suggest` |

Important screen 2 dependency:
- the insert and parallel pickers are disabled until `variantScopeSummary.selectedSetId` exists
- but having a resolved set scope only unlocks the option pool
- it does not choose insert / parallel by itself
- the actual choice still depends on `intakeSuggested.insertSet` and `intakeSuggested.parallel`, which come from the OCR audit

## What Feeds Screen 2 Specifically

### Insert Set

Client population points:
- initial load: `loadQueuedCardForReview` from `ocrFields.insertSet ?? normalized.setCode`
- later OCR apply: `applySuggestions()` from `suggestions.insertSet`
- later effect: blank field can be auto-set from `intakeSuggested.insertSet`

APIs involved:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/cards/[cardId]/ocr-suggest`
- `GET /api/admin/variants/options`

Required state dependencies:
- sport category
- `variantScopeSummary.selectedSetId` must exist before `insertSetOptions` are even exposed
- `intakeOptionalTouched.insertSet` must be false
- either existing audit or fresh OCR audit must contain a usable `insertSet`

### Parallel

Client population points:
- initial load: `loadQueuedCardForReview` from `ocrFields.parallel ?? attributes.variantKeywords[0]`
- later OCR apply: `applySuggestions()` from `suggestions.parallel`
- later effect: blank field can be auto-set from `intakeSuggested.parallel`

APIs involved:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/cards/[cardId]/ocr-suggest`
- `GET /api/admin/variants/options`

Required state dependencies:
- same as Insert Set

### Card Number

Client population points:
- initial load: `loadQueuedCardForReview` from `ocrFields.cardNumber ?? normalized.cardNumber`
- later OCR apply: `applySuggestions()` from `suggestions.cardNumber`

Server generation path:
- initial OCR heuristic payload is built in `/ocr-suggest`
- `groundScopedCardNumberFromOcr()` can replace card number using OCR text evidence within scoped approved sets
- `resolveScopedSetCard()` can replace card number from approved set-card or legacy variant lookup
- `runVariantMatch()` can backfill card number only if current value is blank or `ALL`

APIs involved:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/cards/[cardId]/ocr-suggest`

### `Numbered`

Client population points:
- initial load: `loadQueuedCardForReview` from `ocrFields.numbered ?? attributes.numbered`
- later OCR apply: `applySuggestions()` from `suggestions.numbered`

Server generation path:
- raw OCR heuristics start with `extractCardAttributes()` from combined OCR text
- `extractSerial()` in `packages/shared/src/cardAttributes.ts:525` matches `#?\d{1,3}/\d{1,4}` or `X OF Y`
- `/ocr-suggest` also runs another regex pass and then a hard rule:
  - if no explicit serial pattern exists in OCR text, `fields.numbered` is cleared back to `null`

APIs involved:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/cards/[cardId]/ocr-suggest`

### `Autograph`

Client population points:
- initial load: `loadQueuedCardForReview` from persisted `attributes.autograph`
- later OCR apply: `applySuggestions()` only sets it to true when suggestion is truthy; it does not auto-clear

Server generation path:
- raw OCR heuristics start with `extractCardAttributes()`
- `hasAutographIndicator()` in `packages/shared/src/cardAttributes.ts:568` returns true if OCR text contains `AUTOGRAPH`, `AUTO`, or `SIGNATURE`
- `/ocr-suggest` has a second heuristic pass that also sets `fields.autograph = "true"` when OCR text matches `auto|autograph|signature|signed`

APIs involved:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/cards/[cardId]/ocr-suggest`

## OCR / Classification Pipeline as Implemented

The implemented sequence in `/api/admin/cards/[cardId]/ocr-suggest` is:

1. read front/back/tilt images and OCR them
2. build raw heuristic fields from `extractCardAttributes(combinedTextRaw)`
3. add regex / keyword heuristics for:
   - year
   - numbered
   - parallel
   - autograph
   - memorabilia
   - grading
4. load taxonomy prompt candidates with `loadVariantOptionPool(...)`
5. run text-only LLM parse
6. optionally run multimodal LLM parse
7. apply region template hints
8. apply OCR feedback memory hints
9. force `numbered` to be grounded in explicit OCR text or clear it
10. run `groundScopedCardNumberFromOcr(...)`
11. run `resolveScopedSetCard(...)`
12. run `runVariantMatch(...)`
13. run `constrainTaxonomyFields(...)`
14. persist the audit into `cardAsset.ocrSuggestionJson`

Relevant line anchors:
- raw attribute seed: `ocr-suggest.ts:2862-2878`
- numbered heuristic: `ocr-suggest.ts:2929-2933`
- autograph heuristic: `ocr-suggest.ts:2958-2961`
- memory apply: `ocr-suggest.ts:3208`
- card-number grounding: `ocr-suggest.ts:3286`
- scoped set-card resolution: `ocr-suggest.ts:3328`
- variant image match: `ocr-suggest.ts:3384`
- taxonomy constraint pass: `ocr-suggest.ts:3440`

## What Task 10 Changed

### 1. `variantOptionPool.ts`

Task 10 added:

```ts
if (!selectedSetId && scopedSetIds.length === 1) {
  selectedSetId = scopedSetIds[0] ?? null;
}
```

Location:
- `frontend/nextjs-app/lib/server/variantOptionPool.ts:796-797`

Before Task 10:
- `selectedSetId` only existed when the client already supplied an explicit set candidate (`setId` or `productLine`) that the server could resolve
- a single-set Year / Manufacturer / Sport scope did not automatically become a resolved set

After Task 10:
- if scoping yields exactly one approved set, that set becomes `selectedSetId` immediately
- `querySetIds` then become `[selectedSetId]` instead of all scoped sets

Downstream effect:
- `/api/admin/variants/options` now returns:
  - `scope.selectedSetId`
  - insert options for that one set
  - parallel options for that one set
  - variant catalog for that one set

### 2. `uploads.tsx`

Task 10 changed the Product Set effect so the client can write `intakeOptional.productLine` from:
- `variantScopeSummary.selectedSetId`
- or a lone Product Set option
- before OCR `setName` is ready

Location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2396-2449`

Before Task 10:
- Product Set auto-fill only happened from an actionable OCR `setName` hint

After Task 10:
- Product Set can be auto-filled from server-resolved scope even when OCR `setName` is blank or still pending

## Why Task 10 Likely Broke Screen 2

This is the most likely explanation from code:

1. Task 10 fixed screen 1 Product Set without touching the screen 2 field sources.
2. Screen 2 still depends on `/ocr-suggest` for insert, parallel, card number, numbered, and autograph.
3. `loadQueuedCardForReview()` does not wait for the refreshed OCR run. It:
   - seeds state from the existing audit already stored on the card
   - queues a refresh via `pendingAutoOcrCardId`
   - immediately renders screen 1
4. `handleIntakeRequiredContinue()` does not wait for OCR either. It just saves required fields and moves to `optional`.
5. Before Task 10, operators often sat on screen 1 waiting for Product Set to finally appear. That accidental wait also gave `/ocr-suggest` time to finish and replace the stale initial audit.
6. After Task 10, Product Set appears almost immediately, so operators can enter screen 2 while the refreshed OCR/variant-match pipeline is still:
   - `running`
   - `pending`
   - or retrying

Net result:
- Product Set is right on screen 1
- screen 2 can still be showing the earlier/staler audit state
- insert / parallel may still be blank because the OCR suggestion that drives them has not landed yet
- card number / numbered / autograph may reflect raw OCR heuristics instead of the later grounded/scoped result

This is consistent with the observed "it worked after waiting 10-12 seconds" behavior.

## Why Insert / Parallel Are Not Auto-Selected on Screen 2

Task 10 did not add a new insert/parallel auto-resolution path parallel to Product Set.

Current behavior:
- Product Set can now be derived from `variantScopeSummary.selectedSetId`
- insert and parallel cannot
- they still need:
  - option pools from `/api/admin/variants/options`, and
  - OCR suggestions from `/api/admin/cards/[cardId]/ocr-suggest`

The specific client logic is:
- `setInsertSetOptions(hasResolvedSetScope ? insertLabels : [])`
- `setParallelOptions(hasResolvedSetScope ? parallelLabels : [])`
- then blank untouched fields are auto-picked only if `intakeSuggested.insertSet` / `intakeSuggested.parallel` exists

So:
- Task 10 made the options available earlier
- but it did not make the chosen values available earlier

## Why Card Numbers Are Wrong

Card number is not driven by the Product Set dropdown or the variants/options API.

It comes from the OCR suggest pipeline:
- raw OCR / heuristics
- scoped OCR card-number grounding
- scoped set-card resolver
- variant matcher fallback

If screen 2 opens before that refreshed OCR pass finishes, the UI can still be showing:
- stale `ocrFields.cardNumber` from an earlier audit, or
- no grounded card number yet

Additional detail:
- when `/ocr-suggest` does finish, it can replace card number from `groundScopedCardNumberFromOcr()` and `resolveScopedSetCard()`
- that is exactly the stage that the earlier 10-12 second wait was accidentally hiding

## Why `Numbered` and `Autograph` Over-Fire

These fields are seeded very early and aggressively from raw OCR text.

### `Numbered`

Raw seed paths:
- `extractCardAttributes()` calls `extractSerial()` from OCR text
- `/ocr-suggest` runs an additional serial regex

Good news:
- `/ocr-suggest` later clears `numbered` if it cannot find an explicit serial pattern in OCR text

Bad news:
- if the operator reaches screen 2 before the refreshed OCR pass finishes, they can still see the early / stale value

### `Autograph`

Raw seed paths are broad:
- `hasAutographIndicator()` treats `AUTO`, `AUTOGRAPH`, and `SIGNATURE` as a positive autograph signal
- `/ocr-suggest` also sets autograph from `auto|autograph|signature|signed`

UI limitation:
- `applySuggestions()` only auto-checks the box when OCR says `true`
- it never auto-clears an already-checked autograph box

That means any false positive that lands early is sticky until a human unchecks it.

## Teach From Corrections: What Actually Happens

Button handler:
- `frontend/nextjs-app/pages/admin/uploads.tsx:4330`

Client path:
1. validate required fields
2. call `saveIntakeMetadata(true, true)`
3. `saveIntakeMetadata()` sends:
   - `classificationUpdates`
   - `recordOcrFeedback: true`
4. request goes to `PATCH /api/admin/cards/[cardId]`

Server path in `pages/api/admin/cards/[cardId].ts`:
1. update `classificationJson` and related card fields
2. if `recordOcrFeedback=true`:
   - read OCR suggestion fields from `card.ocrSuggestionJson`
   - compare model values vs current human-confirmed values
   - build one feedback row per field in `FEEDBACK_FIELD_KEYS`
   - `createMany` into `OcrFeedbackEvent`
   - upsert replay memory into `OcrFeedbackMemoryAggregate`
3. re-fetch card and return it

Relevant line anchors:
- PATCH entry: `[cardId].ts:1004`
- `shouldRecordOcrFeedback`: `[cardId].ts:1035`
- build OCR-vs-human field map: `[cardId].ts:1253-1255`
- feedback event write: `[cardId].ts:1287`
- memory upsert: `[cardId].ts:1290`

## Teach From Corrections Failure Root Cause

Observed from the code:
- there is no dedicated teach endpoint
- there is no teach-specific server logging in this route
- there were no local runtime log files in:
  - repo checkout
  - `~/.pm2`
  - `~/Library/Logs`
  - `~/.local/state`

So the exact runtime error cannot be confirmed from logs in this investigation.

Most likely root cause from code:
- the card metadata update can succeed first
- then the route performs the teach writes:
  - `ocrFeedbackEvent.createMany(...)`
  - `upsertOcrFeedbackMemoryAggregates(...)`
- any exception there aborts the response and returns an error to the client

Why this matters:
- from the operator point of view, Teach From Corrections looks like it failed
- but the card metadata may already have been saved
- that matches the route order in `[cardId].ts`

Therefore the likeliest teach failure class is:
- post-save OCR feedback persistence failure, not the initial metadata save itself

Probable concrete causes:
- DB/schema mismatch in the running environment for `OcrFeedbackEvent` or `OcrFeedbackMemoryAggregate`
- DB error during memory aggregate upsert
- less likely: auth/session/card-not-found validation

Why it feels silent:
- the UI only sets a generic `intakeError`
- there is no route-specific teach error payload
- there is no visible telemetry or log lookup path for operators

## Recommendations for Fixing Without Breaking Screen 1

1. Keep Task 10's Product Set fix.
   - Do not remove the `selectedSetId` auto-resolution in `variantOptionPool.ts`.
   - Do not remove the screen 1 Product Set auto-fill from `variantScopeSummary.selectedSetId`.

2. Treat screen 2 readiness as separate from screen 1 Product Set readiness.
   - Product Set is now fast enough.
   - Screen 2 is not ready until the refreshed `/ocr-suggest` run has settled.

3. Gate the transition from `required` to `optional` when a refresh is outstanding.
   - If `pendingAutoOcrCardId` is set, or `ocrStatus` is `running` / `pending`, wait for `/ocr-suggest` to finish before calling `setIntakeStep("optional")`.
   - This preserves Task 10 and fixes the screen 2 race directly.

4. If waiting on Next is undesirable, disable screen 2 actionability until OCR settles.
   - Allow the screen to open, but keep:
     - insert/parallel pickers
     - Teach From Corrections
     - Send to KingsReview
     disabled or visually loading until the latest audit has landed.

5. Recompute screen 2 from the refreshed audit, not the stale initial audit.
   - The optional screen should prefer the latest `/ocr-suggest` response over the existing stored audit loaded by `GET /api/admin/cards/[cardId]`.
   - Right now that happens eventually, but not before the operator can act.

6. Make booleans less sticky.
   - `autograph`, `memorabilia`, and `graded` should not be auto-checked from broad raw heuristics and then remain sticky forever.
   - At minimum, allow the OCR apply path to auto-clear when a later refreshed audit strongly says false, or hold these as suggestions instead of checked boxes until the grounded refresh finishes.

7. Treat `cardNumber` and `numbered` as post-grounding values.
   - Prefer showing blank / unresolved until `ocrCardNumberGrounding` or `setCardResolution` is done.
   - Do not let the early heuristic value be the visible final default if a refresh is still in flight.

8. Improve Teach From Corrections observability.
   - Catch and log teach-write failures separately from metadata-save failures.
   - Return a specific error like `Card metadata saved, but teach feedback write failed`.
   - If partial success is not acceptable, wrap metadata save + teach writes in a transaction.

## Most Important Concrete Takeaways

- Screen 1 Product Set is now fed by `variants/options` scope resolution.
- Screen 2 fields are still fed by `/ocr-suggest`.
- Task 10 sped up screen 1 but did not speed up or gate screen 2.
- That exposed a pre-existing OCR-refresh race on screen 2.
- The teach button is a `PATCH /api/admin/cards/[cardId]` with feedback recording, not a separate workflow.
- Without runtime logs, the teach failure is best explained as a post-save feedback-write failure in `[cardId].ts`.
