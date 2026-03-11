# Architecture Audit: Card Workflow

Date: 2026-03-11

Scope:
- Evidence source is repository code on local `main` at `da154e5`
- This is an investigation-only document
- No deploy, restart, migration, or runtime mutation was performed beyond reading code and updating docs

Primary code surfaces traced:
- Add Cards UI: `frontend/nextjs-app/pages/admin/uploads.tsx`
- KingsReview UI: `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- Inventory Ready UI: `frontend/nextjs-app/pages/admin/inventory-ready.tsx`
- Assigned Locations UI placeholder: `frontend/nextjs-app/pages/admin/location-batches.tsx`
- Card detail/update API: `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- OCR suggest API: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Region teach APIs: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach.ts`, `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach-telemetry.ts`
- Upload APIs: `frontend/nextjs-app/pages/api/admin/uploads/*`
- KingsReview APIs: `frontend/nextjs-app/pages/api/admin/kingsreview/*`
- Inventory Ready APIs: `frontend/nextjs-app/pages/api/admin/inventory-ready/*`
- Variant/reference APIs: `frontend/nextjs-app/pages/api/admin/variants/*`
- OCR memory/teach helpers: `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`, `ocrRegionTemplates.ts`, `ocrRegionTeachEvents.ts`
- Inventory-ready reference seeding: `frontend/nextjs-app/lib/server/kingsreviewReferenceLearning.ts`
- General reference prefetch seeding: `frontend/nextjs-app/lib/server/referenceSeed.ts`
- Variant matcher: `frontend/nextjs-app/lib/server/variantMatcher.ts`
- Legacy processing worker: `backend/processing-service/src/index.ts`
- KingsReview/refs worker: `backend/bytebot-lite-service/src/index.ts`

## Executive Summary

The card workflow is not a single pipeline. It is two overlapping systems:

1. The newer admin workflow:
- Add Cards intake
- OCR suggest with Google Vision + OpenAI + teach memory + region templates
- KingsReview comps/evidence/variant confirmation
- Inventory Ready item minting + trusted reference seeding
- Inventory batch assignment

2. The older background processing worker:
- `ProcessingJob` OCR
- Ximilar classify/grading
- eBay Browse valuation

Those two systems both write to `CardAsset`, and both are active today.

Important architectural conclusions:
- `Assigned Locations` is not a distinct workflow stage. It is `CardAsset.reviewStage = INVENTORY_READY_FOR_SALE` plus `inventoryBatchId` and `inventoryAssignedAt`.
- Draw Teach is live and is used by subsequent `ocr-suggest` calls.
- Teach From Corrections is live and does affect later cards.
- Add Cards reference prefetch creates provisional external refs. Inventory Ready creates trusted external refs. Neither path auto-promotes refs to owned storage.
- The KingsReview enqueue backend currently ignores requested sources and hardcodes `["ebay_sold"]`.
- The Assigned Locations page is still a placeholder UI.

## End-to-End Stage Map

Current effective stage progression:

1. Front image captured as `CardAsset`
2. Back and tilt captured as `CardPhoto`
3. Card appears in Add Cards OCR queue when:
- `reviewStage = READY_FOR_HUMAN_REVIEW`
- no `BytebotLiteJob` exists
- BACK and TILT photos exist
4. OCR suggest fills intake fields and optionally learns from operator corrections
5. Send to KingsReview enqueues a `BytebotLiteJob` and moves card to `reviewStage = BYTEBOT_RUNNING`
6. Bytebot worker completes and moves card back to `reviewStage = READY_FOR_HUMAN_REVIEW`
7. Operator reviews comps/evidence/variant and moves card to `reviewStage = INVENTORY_READY_FOR_SALE`
8. Inventory Ready assignment creates an `InventoryBatch` and sets `inventoryBatchId` / `inventoryAssignedAt`

Notably absent:
- No `ASSIGNED_LOCATIONS` enum or workflow state exists
- No backend batch-detail or print workflow exists for `/admin/location-batches`

## ADD CARDS Flow

### 1. Front capture and front asset creation

UI path:
- `uploads.tsx` -> `uploadCardAsset()`

API sequence:
1. `POST /api/admin/uploads/presign`
2. `PUT /api/admin/uploads/file?assetId=...` for local/mock, or direct S3 upload for S3 mode
3. `POST /api/admin/uploads/complete`

Database writes:

`/api/admin/uploads/presign`
- Creates `CardBatch` if no `batchId` was supplied
- Creates `CardAsset` with:
  - `id`
  - `batchId`
  - `storageKey`
  - `fileName`
  - `fileSize`
  - `mimeType`
  - `imageUrl`
  - `status = UPLOADING`
  - `reviewStage = READY_FOR_HUMAN_REVIEW` for Add Cards intake
  - `reviewStageUpdatedAt = now()`
- Updates `CardBatch.totalCount += 1`

`/api/admin/uploads/file`
- Writes binary to local storage in local mode
- Updates `CardAsset.imageUrl`
  - local/mock mode stores a data URL or local-public URL

`/api/admin/uploads/complete`
- Updates `CardAsset`:
  - `status = OCR_PENDING`
  - `processingStartedAt = null`
  - `processingCompletedAt = null`
  - `errorMessage = null`
  - optionally refreshed `fileName`, `mimeType`, `fileSize`
- Enqueues `ProcessingJob(type = OCR)`
- Tries to generate a front thumbnail and updates `CardAsset.thumbnailUrl`

Trigger created:
- Legacy processing-service pipeline starts from `ProcessingJob(type=OCR)`

### 2. Back and tilt photo capture

UI path:
- `uploads.tsx` -> `uploadCardPhoto()`

API sequence:
1. `POST /api/admin/kingsreview/photos/presign`
2. `PUT /api/admin/kingsreview/photos/file?photoId=...`
3. `POST /api/admin/kingsreview/photos/process?mode=thumbnail`

Database writes:

`/api/admin/kingsreview/photos/presign`
- Creates `CardPhoto` with:
  - `id`
  - `cardAssetId`
  - `kind = BACK` or `TILT`
  - `storageKey`
  - `fileName`
  - `fileSize`
  - `mimeType`
  - `imageUrl`
  - `createdById`

`/api/admin/kingsreview/photos/file`
- Writes photo binary to storage
- Updates `CardPhoto.imageUrl`

`/api/admin/kingsreview/photos/process?mode=thumbnail`
- Generates thumbnail
- Updates `CardPhoto.thumbnailUrl`

### 3. OCR queue eligibility

Queue API:
- `GET /api/admin/uploads/ocr-queue`

A card appears in the Add Cards review queue only when all are true:
- `reviewStage = READY_FOR_HUMAN_REVIEW`
- `bytebotLiteJobs: none`
- has a BACK photo
- has a TILT photo

### 4. Loading a queued card into the Add Cards review form

UI path:
- `uploads.tsx` -> `loadQueuedCardForReview()`
- API: `GET /api/admin/cards/[cardId]`

The response loads:
- front image and thumbnail from `CardAsset`
- BACK and TILT image records from `CardPhoto`
- `classificationJson`
- `classificationNormalized`
- `ocrSuggestionJson`
- `valuation*`
- `variantDecision`
- `notes`
- `photos`
- label metadata if a QR label pair already exists

### 5. Intake field provenance: where each Add Cards field gets its value

When a queued card is loaded, the intake form is hydrated in this order:

| UI field | Load precedence | Saved back to |
| --- | --- | --- |
| `category` | `classificationNormalized.categoryType`, defaulting to `sport` unless exactly `tcg` | `classificationJson.normalized.categoryType` |
| `playerName` | `ocrSuggestions.fields.playerName` -> `classification.playerName` | `classificationJson.attributes.playerName`, `classificationJson.normalized.displayName`, `classificationJson.normalized.sport.playerName`, `resolvedPlayerName` |
| `sport` | `ocrSuggestions.fields.sport` -> `classification.sport` -> inferred sport from product line | `classificationJson.normalized.sport.sport` |
| `manufacturer` | `ocrSuggestions.fields.manufacturer` -> `classificationNormalized.company` -> `classification.brand` | `classificationJson.attributes.brand`, `classificationJson.normalized.company` |
| `year` | `ocrSuggestions.fields.year` -> `classificationNormalized.year` -> `classification.year` | `classificationJson.attributes.year`, `classificationJson.normalized.year` |
| `cardName` (TCG) | `ocrSuggestions.fields.cardName` -> `classification.cardName` -> `classificationNormalized.displayName` | `classificationJson.normalized.displayName`, `classificationJson.normalized.tcg.cardName` |
| `game` (TCG) | `ocrSuggestions.fields.game` -> `classification.game` | `classificationJson.normalized.tcg.game` |
| `teamName` | `ocrSuggestions.fields.teamName` -> `classification.teamName` | `classificationJson.attributes.teamName`, `classificationJson.normalized.sport.teamName`, `resolvedTeamName` |
| `productLine` | `resolveHydratedProductLine(ocr setName, normalized setName, taxonomy field status)` | `classificationJson.attributes.setName`, `classificationJson.normalized.setName` |
| `insertSet` | `ocrSuggestions.fields.insertSet` -> `classificationNormalized.setCode` | `classificationJson.normalized.setCode` |
| `parallel` | `ocrSuggestions.fields.parallel` -> first `classification.variantKeywords[]` | `classificationJson.attributes.variantKeywords[0]` |
| `cardNumber` | `ocrSuggestions.fields.cardNumber` -> `classificationNormalized.cardNumber` | `classificationJson.normalized.cardNumber` |
| `numbered` | `ocrSuggestions.fields.numbered` -> `classification.numbered` | `classificationJson.attributes.numbered` |
| `autograph` | `classification.autograph` on load | `classificationJson.attributes.autograph`, and `classificationJson.normalized.sport.autograph` for sport cards |
| `memorabilia` | `classification.memorabilia` on load | `classificationJson.attributes.memorabilia` |
| `graded` | `ocrSuggestions.fields.graded == true` or both grade fields present | `classificationJson.normalized.sport.graded` for sport cards only |
| `gradeCompany` | `classification.gradeCompany` -> `ocrSuggestions.fields.gradeCompany` | `classificationJson.attributes.gradeCompany`, and `classificationJson.normalized.sport.gradeCompany` for sport cards |
| `gradeValue` | `classification.gradeValue` -> `ocrSuggestions.fields.gradeValue` | `classificationJson.attributes.gradeValue`, and `classificationJson.normalized.sport.grade` for sport cards |
| `tcgRarity` | `classificationNormalized.rarity` | `classificationJson.normalized.rarity`, `classificationJson.normalized.tcg.rarity` |
| `tcgSeries` | blank default | `classificationJson.normalized.tcg.series` |
| `tcgFoil` | false default | `classificationJson.normalized.tcg.foil` |
| `tcgLanguage` | blank default | `classificationJson.normalized.tcg.language` |
| `tcgOutOf` | blank default | `classificationJson.normalized.tcg.outOf` |

Important nuance:
- `CardAttributes` is sports-oriented. Several TCG fields live only in `classificationJson.normalized.*`, not in `attributes`.

### 6. OCR suggest path

UI path:
- `uploads.tsx` -> `fetchOcrSuggestions()`
- API: `GET /api/admin/cards/[cardId]/ocr-suggest`

Required read inputs:
- front `CardAsset.imageUrl`
- BACK `CardPhoto.imageUrl`
- TILT `CardPhoto.imageUrl`
- optional hints from current form:
  - `year`
  - `manufacturer`
  - `sport`
  - `productLine`
  - `setId`
  - `layoutClass`

OCR suggest steps:
1. Load front, back, tilt image URLs
2. Run Google Vision OCR on each image
3. Merge raw text and token boxes
4. Run heuristic parsing with `extractCardAttributes`
5. Run OpenAI Responses multimodal/text parse
6. Load region templates from `OcrRegionTemplate`
7. Apply region value hints from matched OCR tokens
8. Load OCR feedback memory from `OcrFeedbackMemoryAggregate`
9. If aggregates are empty, seed them from recent `OcrFeedbackEvent`
10. Apply memory hints back onto fields
11. Resolve/ground set and card number against scoped taxonomy/set-card tables
12. Run `runVariantMatch()` to suggest a parallel
13. Constrain set/insert/parallel to taxonomy option pools
14. Save final audit payload

Database writes:
- `CardAsset.ocrText = combined OCR text`
- `CardAsset.ocrSuggestionJson = audit payload`
- `CardAsset.ocrSuggestionUpdatedAt = now()`

External calls made here:
- Google Vision `https://vision.googleapis.com/v1/images:annotate`
- OpenAI Responses `https://api.openai.com/v1/responses`
- optional embedding service through `runVariantMatch()` if `VARIANT_EMBEDDING_URL` is configured

What triggers it:
- automatically after back/tilt upload
- automatically when a queued card loads and saved suggestions are absent/stale
- manually when the operator toggles OCR suggestions

### 7. Draw Teach system during Add Cards OCR

See dedicated section below. In short:
- yes, the saved regions are read by `ocr-suggest` today
- yes, they are applied to later cards today

### 8. Teach From Corrections

Button:
- `Teach From Corrections`

UI path:
- `uploads.tsx` -> `handleTeachFromCorrections()`
- calls `saveIntakeMetadata(includeOptional=true, recordOcrFeedback=true)`
- API: `PATCH /api/admin/cards/[cardId]`

Database writes:
- updates `CardAsset.classificationJson`
- updates `CardAsset.resolvedPlayerName`
- updates `CardAsset.resolvedTeamName`
- creates `OcrFeedbackEvent` rows for all tracked OCR fields
- upserts `OcrFeedbackMemoryAggregate` rows for mismatches

Effect on future cards:
- yes, later `ocr-suggest` calls read this memory and can override model guesses

### 9. Add Cards reference prefetch

Trigger:
- only for sport cards
- fires once there is a usable set, insert/program, player, and optionally card number
- trigger condition is either:
  - OCR confidence high enough for set + insert, or
  - operator corrections touched those fields

API:
- `POST /api/admin/variants/reference/prefetch`

External calls:
- SerpApi eBay search `engine=ebay`
- SerpApi product lookup `engine=ebay_product`

Database writes:
- creates `CardVariantReferenceImage` rows with defaults:
  - `qaStatus = pending`
  - `ownedStatus = external`
  - `setId`
  - `programId`
  - `cardNumber`
  - `parallelId`
  - `sourceListingId`
  - `playerSeed`
  - `listingTitle`
  - `sourceUrl`
  - `rawImageUrl`

This prefetch path creates provisional refs, not trusted refs.

### 10. Send to KingsReview

Button:
- `Send to KingsReview AI`

UI path:
- `uploads.tsx` -> `handleSendToKingsReview()`

Sequence:
1. Validate required front/back/tilt and required fields
2. `PATCH /api/admin/cards/[cardId]` to persist intake metadata
3. If train-AI toggle is on and Teach From Corrections was not already used, also record OCR feedback
4. `POST /api/admin/cards/[cardId]/photoroom` and wait for completion
5. `POST /api/admin/kingsreview/enqueue`
6. Remove card from local Add Cards queue
7. Load the next queued card

If PhotoRoom returns a real processing error, the handoff stops and the card is not enqueued into KingsReview.
If the API responds `PhotoRoom not configured`, the UI logs a warning and continues to KingsReview enqueue.

Backend enqueue behavior:
- requires BACK photo
- updates `CardAsset.reviewStage = BYTEBOT_RUNNING`
- updates `CardAsset.reviewStageUpdatedAt`
- creates `BytebotLiteJob`

Important mismatch:
- the UI sends multiple requested sources for some categories
- the backend currently ignores them and hardcodes `sources = ["ebay_sold"]`

### 11. Legacy processing-service pipeline that still starts from Add Cards upload

This older worker still runs after `uploads/complete`, independent of the newer Add Cards review UX.

Sequence:
1. `ProcessingJob(OCR)`
2. `ProcessingJob(CLASSIFY)`
3. `ProcessingJob(VALUATION)`

`handleOcrJob`
- reads front/back/tilt images
- calls Google Vision
- writes:
  - `CardAsset.ocrText`
  - `CardAsset.ocrJson`
  - initial `CardAsset.classificationJson`
  - initial eBay URL fields:
    - `ebaySoldUrl`
    - `ebaySoldUrlVariant`
    - `ebaySoldUrlHighGrade`
    - `ebaySoldUrlPlayerComp`
  - `resolvedPlayerName`
  - `resolvedTeamName`
  - thumbnail if available
  - `status = CLASSIFY_PENDING`
- enqueues `ProcessingJob(CLASSIFY)`

`handleClassifyJob`
- calls Ximilar collectibles classification
- optionally calls Ximilar card grader
- writes:
  - refined `classificationJson`
  - `classificationSourcesJson`
  - AI grade fields
  - more eBay URL fields
  - `status = VALUATION_PENDING`
- enqueues `ProcessingJob(VALUATION)`

`handleValuationJob`
- calls eBay Browse search API
- writes:
  - `valuationMinor`
  - `valuationCurrency`
  - `valuationSource`
  - `marketplaceUrl`
  - `status = READY`
  - `processingCompletedAt`
- updates `CardBatch.processedCount` / `CardBatch.status`

## KINGSREVIEW Flow

### 1. Card list and selection

List API:
- `GET /api/admin/kingsreview/cards?stage=...`

Default stage behavior:
- UI can show `BYTEBOT_RUNNING`, `READY_FOR_HUMAN_REVIEW`, `ESCALATED_REVIEW`, `REVIEW_COMPLETE`
- `INVENTORY_READY_FOR_SALE` cards are handled on the Inventory Ready page

When a card is selected, the page loads in parallel:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/kingsreview/jobs?cardAssetId=...`
- `GET /api/admin/kingsreview/evidence?cardAssetId=...`

Card detail payload loaded into the page includes:
- front image, thumbnail
- all `CardPhoto` side images
- `ocrText`
- `ocrSuggestions`
- `classification`
- `classificationNormalized`
- `customTitle`
- `customDetails`
- `valuation*`
- `variantId`
- `variantConfidence`
- latest `variantDecision`
- `reviewStage`
- `notes`
- `aiGrade*`
- `classificationSources`
- QR/label pair summary if one exists

The page also derives:
- query input from `customTitle ?? fileName`
- variant set field from `classificationNormalized.setName ?? setCode`
- variant card number from `classificationNormalized.cardNumber`
- variant notes from `variantDecision.humanNotes ?? customDetails`

Polling:
- list refresh every 2 seconds
- latest job refresh every 5 seconds while job status is `QUEUED` or `IN_PROGRESS`

### 2. Generate Comps

Button:
- `Generate Comps`

UI call:
- `handleEnqueue()`

API:
- `POST /api/admin/kingsreview/enqueue`

Payload behavior:
- `useManual = true`
- uses the current query text from the page
- source list passed by UI is `["ebay_sold"]`

Database writes:
- `CardAsset.reviewStage = BYTEBOT_RUNNING`
- `CardAsset.reviewStageUpdatedAt = now()`
- create `BytebotLiteJob`

External calls triggered later by worker:
- SerpApi eBay sold search

### 3. What the Bytebot worker does after enqueue

Worker path:
- `backend/bytebot-lite-service/src/index.ts`
- source implementation: `backend/bytebot-lite-service/src/sources/ebay.ts`

Current active source path:
- `ebay_sold`

Worker behavior:
1. Claims queued `BytebotLiteJob`
2. Calls SerpApi eBay search
3. Builds result payload with:
  - `searchUrl`
  - `searchScreenshotUrl`
  - `comps[]`
    - `url`
    - `title`
    - `price`
    - `soldDate`
    - `screenshotUrl`
    - `listingImageUrl`
    - `thumbnail`
4. Stores payload in `BytebotLiteJob.result`
5. Marks job `COMPLETE`
6. If `BYTEBOT_AUTO_ATTACH_COMPS=true`, auto-creates top sold comps as `CardEvidenceItem`
7. If linked to a card, sets `CardAsset.reviewStage = READY_FOR_HUMAN_REVIEW`

### 4. eBay Sold

UI behavior:
- the `eBay Sold` source tab is only a source selector in the page
- it does not call the backend by itself

### 5. Attach Search

Button:
- `Attach Search`

API:
- `POST /api/admin/kingsreview/evidence`

Database write:
- creates `CardEvidenceItem` with:
  - `cardAssetId`
  - `kind = SEARCH_PAGE`
  - `source`
  - `title`
  - `url = searchUrl`
  - `screenshotUrl = searchScreenshotUrl`
  - `note = "Search results overview"`
  - `createdById`

### 6. Mark Comp

Button:
- `Mark Comp`

API:
- `POST /api/admin/kingsreview/evidence`

Database write:
- creates `CardEvidenceItem` with:
  - `kind = SOLD_COMP`
  - `source`
  - `title`
  - `url`
  - `screenshotUrl`
  - `price`
  - `soldDate`
  - `createdById`

### 7. Mark Comp + Confirm Variant

This is a compound action:

1. Attach the sold comp as `CardEvidenceItem(kind = SOLD_COMP)`
2. If the card already has a selected variant and it is not `Unknown`, call `POST /api/admin/variants/decision`

Variant decision write:
- creates `CardVariantDecision`
- updates `CardAsset.variantId`
- updates `CardAsset.variantConfidence`

The page marks this as a human override confirmation.

### 8. Confirm Variant

Button:
- `Confirm Variant`

API:
- `POST /api/admin/variants/decision`

Database writes:
- create `CardVariantDecision`
- update `CardAsset.variantId`
- update `CardAsset.variantConfidence`

### 9. Variant Match

Button:
- `Match Variant`

API:
- `POST /api/admin/variants/match`

Read path:
- resolves candidate `CardVariant` rows by set/program/card number
- filters by taxonomy V2 scope if enabled
- reads `CardVariantReferenceImage` rows where:
  - `qaStatus = keep`, or
  - `ownedStatus = owned`
- optionally calls `VARIANT_EMBEDDING_URL`
- computes foil signal from the card tilt/front image

Writes:
- always creates a `CardVariantDecision`
- if confident, updates `CardAsset.variantId` and `variantConfidence`
- if not confident, clears those two fields

### 10. Draft autosave while in KingsReview

While the operator edits review text, the page auto-saves:
- query -> `CardAsset.customTitle`
- variant notes -> `CardAsset.customDetails`
- set field -> `classificationJson.normalized.setName`
- card number field -> `classificationJson.normalized.cardNumber`

API:
- `PATCH /api/admin/cards/[cardId]`

### 11. Move to Inventory Ready

Button:
- `Move to Inventory Ready`

UI/API:
- `PATCH /api/admin/cards/[cardId]` with:
  - `reviewStage = INVENTORY_READY_FOR_SALE`
  - `valuationMinor`
  - `valuationCurrency`

Backend validation:
- price must be present and `> 0`

Backend side effects:
1. update `CardAsset.reviewStage`
2. update `CardAsset.reviewStageUpdatedAt`
3. update valuation fields
4. call `ensureInventoryReadyArtifacts()`
5. call `seedTrustedReferencesFromInventoryReady()`

`ensureInventoryReadyArtifacts()` writes:
- `Item` if missing
  - `name`
  - `set`
  - `number = cardAsset.id`
  - `estimatedValue`
  - `imageUrl`
  - `thumbnailUrl`
  - `detailsJson`
- `ItemOwnership`
- QR/label records through `ensureLabelPairForItem()`:
  - `QrCode` for card
  - `QrCode` for pack
  - `PackLabel`
  - bind `Item.cardQrCodeId`

`seedTrustedReferencesFromInventoryReady()` writes:
- `CardVariantReferenceImage` rows with:
  - `qaStatus = keep`
  - `ownedStatus = external`
  - `setId`
  - `programId`
  - set-level row:
    - `parallelId = __SET_REFERENCE__`
    - `cardNumber = ALL`
  - optional parallel/card row:
    - `parallelId = confirmed parallel`
    - `cardNumber = confirmed card number`

## INVENTORY READY Flow

### 1. What actually happens when a card arrives here

The real automation happens at the moment KingsReview changes the stage to `INVENTORY_READY_FOR_SALE`.

What does happen:
- valuation is enforced
- `Item` and `ItemOwnership` are minted if missing
- QR/label pair is ensured
- sold comp images are read and trusted reference images are seeded
- selected eBay comp thumbnails are upgraded to HD using SerpApi `engine=ebay_product`

What does not happen here:
- no new PhotoRoom call is triggered by the Inventory Ready transition itself
- no automatic `variants/reference/process` call
- no automatic `variants/reference/promote` call
- no review-stage change when later assigning to location

### 2. PhotoRoom AI step

PhotoRoom exists, but not as an Inventory Ready stage hook.

Current triggers:
- Add Cards send-to-KingsReview calls `POST /api/admin/cards/[cardId]/photoroom` before KingsReview enqueue

That endpoint:
- runs PhotoRoom on the front `CardAsset`
- runs PhotoRoom on BACK and TILT `CardPhoto`
- overwrites stored image objects
- updates:
  - `imageUrl`
  - `thumbnailUrl`
  - `mimeType = image/png`
  - `fileSize`
  - `backgroundRemovedAt`

Because it checks `backgroundRemovedAt`, it is effectively idempotent.

Conclusion:
- PhotoRoom is part of Add Cards image cleanup, not an Inventory Ready entry processor

### 3. HD image conversion

HD upgrade is only done inside `seedTrustedReferencesFromInventoryReady()`.

Logic:
1. read attached `CardEvidenceItem(kind=SOLD_COMP)`
2. read recent `BytebotLiteJob.result`
3. match evidence URLs back to job comp payloads
4. take `listingImageUrl` / `screenshotUrl`
5. if the source is eBay and a listing/product ID can be parsed, call SerpApi `engine=ebay_product`
6. replace thumbnail-style image URL with the highest-quality product media image available

Result storage:
- stored as `CardVariantReferenceImage.rawImageUrl`

### 4. Reference image seeding on Inventory Ready

Seeder:
- `frontend/nextjs-app/lib/server/kingsreviewReferenceLearning.ts`

Input sources:
- `CardEvidenceItem(kind=SOLD_COMP)`
- recent `BytebotLiteJob.result.sources[].comps[]`
- `CardAsset.classificationJson`
- `CardAsset.variantId`

Rows created:
- set-level trusted external refs
- optional parallel/card trusted external refs

Quality state on insert:
- trusted enough for matching because `qaStatus = keep`
- still external because `ownedStatus = external`
- not promoted to managed owned storage

### 5. Inventory Ready page operations

List API:
- `GET /api/admin/inventory-ready/cards`

Filters on read:
- only `reviewStage = INVENTORY_READY_FOR_SALE`
- by default excludes already-assigned cards unless `includeAssigned=1`
- value/category/search filters are applied

Selecting a card loads:
- `GET /api/admin/cards/[cardId]`
- `GET /api/admin/kingsreview/evidence?cardAssetId=...`
- `GET /api/admin/kingsreview/jobs?cardAssetId=...`

Valuation edit:
- `PATCH /api/admin/cards/[cardId]`
- updates `CardAsset.valuationMinor`

Assign to Location:
- `POST /api/admin/inventory-ready/assign`
- creates `InventoryBatch`
- updates each selected `CardAsset`:
  - `inventoryBatchId`
  - `inventoryAssignedAt`

Return to KingsReview:
- `POST /api/admin/inventory-ready/return`
- updates each selected `CardAsset`:
  - `inventoryBatchId = null`
  - `inventoryAssignedAt = null`
  - `reviewStage = READY_FOR_HUMAN_REVIEW`
  - `reviewStageUpdatedAt = now()`

Delete Selected:
- `POST /api/admin/inventory-ready/purge`
- deletes:
  - `BytebotLiteJob`
  - `CardEvidenceItem`
  - `CardPhoto`
  - `CardNote`
  - `ProcessingJob`
  - `CardAsset`

## ASSIGNED LOCATIONS

This is the final state represented in code today:

- `CardAsset.reviewStage` remains `INVENTORY_READY_FOR_SALE`
- `CardAsset.inventoryBatchId` points to `InventoryBatch.id`
- `CardAsset.inventoryAssignedAt` is set
- `InventoryBatch.locationId` points to the chosen location
- `InventoryBatch.createdById` records the operator

Data that is expected to be complete before assignment, based on the intended flow:
- confirmed/edited classification
- human-reviewed comps/evidence
- valuation
- minted `Item`
- `ItemOwnership`
- QR/label pair
- trusted sold-comp-based reference seeds

What is actually enforced before assignment:
- only that every selected card is in `reviewStage = INVENTORY_READY_FOR_SALE`

What is not yet built:
- `/admin/location-batches` is a placeholder page
- no batch-detail, print, or downstream assigned-locations API was found

## Draw Teach System

### Where regions are stored

Primary template table:
- `OcrRegionTemplate`

Key fields:
- `setId`
- `setIdKey`
- `layoutClass`
- `layoutClassKey`
- `photoSide`
- `photoSideKey`
- `regionsJson`
- `sampleCount`
- `createdById`

Event/telemetry table:
- `OcrRegionTeachEvent`

Snapshot storage:
- stored in object storage under the card storage base, e.g. `.../teach/region-<timestamp>-<side>.png`

### What writes them

API:
- `POST /api/admin/cards/[cardId]/region-teach`

Writes:
- upsert `OcrRegionTemplate`
- store snapshot image
- create `OcrRegionTeachEvent(eventType = TEMPLATE_SAVE)`

Telemetry API:
- `POST /api/admin/cards/[cardId]/region-teach-telemetry`
- writes `OcrRegionTeachEvent(eventType = CLIENT_ERROR)`

### What reads them

Read path:
- `ocr-suggest.ts` -> `listOcrRegionTemplates()`

Apply timing:
1. OCR tokens are produced
2. global fallback BACK template is applied
3. set/layout-scoped templates are loaded and applied
4. memory may shift the resolved set
5. templates may be replayed for that newly resolved set

### Are they actually being used on subsequent cards today

Yes.

Evidence:
- `ocr-suggest.ts` explicitly loads `OcrRegionTemplate`
- `applyRegionTemplateValueHints()` boosts field values/confidence from matched token regions
- the result is merged into `CardAsset.ocrSuggestionJson`

## Teach Memory / Teach From Corrections

### What gets written

When `recordOcrFeedback = true` is sent to `PATCH /api/admin/cards/[cardId]`, the backend:

1. compares `ocrSuggestionJson.fields.*` against the operator-confirmed classification values
2. creates one `OcrFeedbackEvent` per tracked field
3. upserts `OcrFeedbackMemoryAggregate` for mismatch rows

Tracked fields include:
- `playerName`
- `year`
- `manufacturer`
- `sport`
- `game`
- `cardName`
- `setName`
- `insertSet`
- `parallel`
- `cardNumber`
- `numbered`
- `autograph`
- `memorabilia`
- `graded`
- `gradeCompany`
- `gradeValue`

### Where it is stored

Raw history:
- `OcrFeedbackEvent`

Learned memory:
- `OcrFeedbackMemoryAggregate`

Key context fields used for memory scoping:
- `setId`
- `year`
- `manufacturer`
- `sport`
- `cardNumber`
- `numbered`

Key learned payload fields:
- `value`
- `valueKey`
- `sampleCount`
- `correctCount`
- `confidencePrior`
- `aliasValuesJson`
- `tokenAnchorsJson`

### What reads it

Read path:
- `ocr-suggest.ts` -> `applyFeedbackMemoryHints()`

Behavior:
- queries aggregates by contextual OR clauses
- if no aggregates exist, back-fills them from recent `OcrFeedbackEvent` rows
- scores learned values using context match, token anchors, region overlap, and recency
- overwrites/boosts OCR fields when confidence is high enough

### Does it affect the next card

Yes.

Current-state nuance:
- direct teaching upserts memory primarily from mismatches
- if aggregates are absent, the next card can still bootstrap memory from raw event history

## Reference Image System

### Canonical storage table

Primary table:
- `CardVariantReferenceImage`

Important fields:
- `setId`
- `programId`
- `cardNumber`
- `parallelId`
- `refType`
- `pairKey`
- `sourceListingId`
- `playerSeed`
- `storageKey`
- `qaStatus`
- `ownedStatus`
- `promotedAt`
- `sourceUrl`
- `listingTitle`
- `rawImageUrl`
- `cropUrls`
- `cropEmbeddings`
- `qualityScore`

### Provisional vs trusted vs owned

Current effective states:

1. Provisional external ref
- created by Add Cards prefetch
- `qaStatus = pending`
- `ownedStatus = external`
- not used by matcher yet

2. Trusted external ref
- created by Inventory Ready seeding or manual QA keep
- `qaStatus = keep`
- `ownedStatus = external`
- used by matcher

3. Owned ref
- promoted through `/api/admin/variants/reference/promote`
- `ownedStatus = owned`
- `storageKey` points to managed storage
- used by matcher

### What writes reference images

Add Cards prefetch:
- `POST /api/admin/variants/reference/prefetch`
- creates provisional external refs

Inventory Ready seed:
- `seedTrustedReferencesFromInventoryReady()`
- creates trusted external refs

Manual/reference admin CRUD:
- `pages/api/admin/variants/reference/index.ts`

Reference PhotoRoom processing:
- `POST /api/admin/variants/reference/process`
- applies PhotoRoom to existing ref images
- writes managed processed image
- updates `cropUrls`
- clears `qualityScore` and `cropEmbeddings`

Reference promote:
- `POST /api/admin/variants/reference/promote`
- copies chosen current image into owned managed storage
- updates:
  - `storageKey`
  - `rawImageUrl`
  - `cropUrls`
  - `qaStatus = keep`
  - `ownedStatus = owned`
  - `promotedAt`
  - clears embeddings/quality for recompute

Reference worker:
- `backend/bytebot-lite-service/src/reference/queue.ts`
- computes:
  - `qualityScore`
  - `cropUrls`
  - `cropEmbeddings`

### What reads reference images

Variant matcher:
- reads refs where `qaStatus = keep` or `ownedStatus = owned`

Admin reference inspection:
- `GET /api/admin/variants/reference`

Add Cards option previews:
- reads top matching refs for insert/parallel previews

### Current-state reality

- Inventory Ready trust seeding does create matcher-usable refs
- It does not automatically PhotoRoom-process them
- It does not automatically promote them to owned storage
- Local fallback embedding generation may create crop URLs without vectors if the embedding service is absent

## Database Tables Involved

| Table | Role in workflow | Key fields used in this flow |
| --- | --- | --- |
| `CardBatch` | upload batch wrapper | `id`, `uploadedById`, `totalCount`, `processedCount`, `status`, `stage` |
| `BatchStageEvent` | batch lifecycle logging | `batchId`, `stage`, `actorId`, `createdAt` |
| `CardAsset` | main card record and workflow anchor | `status`, `reviewStage`, `ocr*`, `classification*`, `valuation*`, `variant*`, `inventoryBatchId`, `inventoryAssignedAt` |
| `CardPhoto` | side images | `cardAssetId`, `kind`, `storageKey`, `imageUrl`, `thumbnailUrl`, `backgroundRemovedAt` |
| `ProcessingJob` | legacy OCR/classify/valuation queue | `cardAssetId`, `type`, `status`, `payload`, `errorMessage` |
| `BytebotLiteJob` | KingsReview comps job queue/result | `cardAssetId`, `searchQuery`, `sources`, `status`, `payload`, `result` |
| `CardEvidenceItem` | search pages and comps attached by reviewer | `cardAssetId`, `kind`, `source`, `url`, `screenshotUrl`, `price`, `soldDate` |
| `CardVariant` | known parallel/program/card universe | `setId`, `programId`, `cardNumber`, `parallelId`, `keywords` |
| `CardVariantDecision` | matcher and human variant decisions | `cardAssetId`, `candidatesJson`, `selectedParallelId`, `confidence`, `humanOverride`, `humanNotes` |
| `CardVariantReferenceImage` | prefetch/trusted/owned reference image store | `setId`, `programId`, `cardNumber`, `parallelId`, `qaStatus`, `ownedStatus`, `rawImageUrl`, `cropUrls`, `cropEmbeddings` |
| `OcrFeedbackEvent` | raw teach-from-corrections history | `cardAssetId`, `fieldName`, `modelValue`, `humanValue`, `wasCorrect`, context columns |
| `OcrFeedbackMemoryAggregate` | learned OCR memory | `fieldName`, `value`, `valueKey`, context keys, `confidencePrior`, `tokenAnchorsJson` |
| `OcrRegionTemplate` | Draw Teach templates | `setId`, `layoutClass`, `photoSide`, `regionsJson`, `sampleCount` |
| `OcrRegionTeachEvent` | Draw Teach telemetry and snapshot audit | `cardAssetId`, `setId`, `layoutClass`, `photoSide`, `eventType`, snapshot fields |
| `InventoryBatch` | location assignment batch | `locationId`, `label`, `createdById` |
| `Item` | minted inventory object created on Inventory Ready transition | `name`, `set`, `number`, `estimatedValue`, `imageUrl`, `thumbnailUrl`, `cardQrCodeId` |
| `ItemOwnership` | ownership row for minted Item | `itemId`, `ownerId`, `note` |
| `QrCode` | QR code pair backing card/pack label | `code`, `serial`, `type`, `state`, `payloadUrl`, `locationId`, `boundAt` |
| `PackLabel` | the label pair tying QR codes to an item | `pairId`, `cardQrCodeId`, `packQrCodeId`, `itemId`, `locationId`, `status` |
| `BytebotPlaybookRule` | KingsReview teach panel scraping rules, separate from OCR teach | `source`, `action`, `selector`, `urlContains`, `priority`, `enabled` |

## External Service Calls

| Service | Trigger | Code path | Results stored where |
| --- | --- | --- | --- |
| Google Vision OCR | Add Cards `ocr-suggest` | `lib/server/googleVisionOcr.ts` | `CardAsset.ocrText`, `CardAsset.ocrSuggestionJson` |
| Google Vision OCR | legacy `ProcessingJob(OCR)` | `backend/processing-service/src/processors/vision.ts` | `CardAsset.ocrText`, `CardAsset.ocrJson`, initial `classificationJson` |
| OpenAI Responses | Add Cards `ocr-suggest` parse | `pages/api/admin/cards/[cardId]/ocr-suggest.ts` | merged into `CardAsset.ocrSuggestionJson` audit/suggestions |
| SerpApi `engine=ebay` | KingsReview comp job | `backend/bytebot-lite-service/src/sources/ebay.ts` | `BytebotLiteJob.result` |
| SerpApi `engine=ebay` | Add Cards reference prefetch | `lib/server/referenceSeed.ts` | `CardVariantReferenceImage` provisional rows |
| SerpApi `engine=ebay_product` | Add Cards reference prefetch HD listing image lookup | `lib/server/referenceSeed.ts` | `CardVariantReferenceImage.rawImageUrl` |
| SerpApi `engine=ebay_product` | Inventory Ready trusted-ref HD upgrade | `lib/server/kingsreviewReferenceLearning.ts` | `CardVariantReferenceImage.rawImageUrl` |
| PhotoRoom image edit API | card/background cleanup | `pages/api/admin/cards/[cardId]/photoroom.ts` | overwrites `CardAsset` and BACK/TILT `CardPhoto` image fields |
| PhotoRoom image edit API | reference processing | `pages/api/admin/variants/reference/process.ts` | new managed processed image in `cropUrls` |
| Ximilar collectibles APIs | legacy `ProcessingJob(CLASSIFY)` | `backend/processing-service/src/processors/ximilar.ts` | `classificationJson`, `classificationSourcesJson` |
| Ximilar card grader | legacy `ProcessingJob(CLASSIFY)` on ungraded cards | `backend/processing-service/src/processors/grading.ts` | `aiGrade*`, `aiGradingJson` |
| eBay Browse API | legacy `ProcessingJob(VALUATION)` | `backend/processing-service/src/processors/valuation.ts` | `valuationMinor`, `valuationCurrency`, `valuationSource`, `marketplaceUrl` |
| Variant embedding service `VARIANT_EMBEDDING_URL` | OCR suggest auto-match and KingsReview Match Variant | `lib/server/variantMatcher.ts` | transient for ranking; no DB write unless matcher decides and writes `CardVariantDecision` / `CardAsset.variant*` |
| Variant embedding service `VARIANT_EMBEDDING_URL` | reference worker | `backend/bytebot-lite-service/src/reference/embedding.ts` | `CardVariantReferenceImage.cropEmbeddings`, `cropUrls` |
| Optional corner-normalization service `VARIANT_CORNER_URL` | reference local crop generation | `backend/bytebot-lite-service/src/reference/embedding.ts` | transient normalization before crop upload |

## Known Gaps and Miswirings

1. `Assigned Locations` is not implemented as a real module.
- `/admin/location-batches` explicitly says it is coming next.
- No batch-detail, print, or assigned-location workflow API was found.

2. KingsReview enqueue ignores the UI-provided source list.
- Backend hardcodes `sources = ["ebay_sold"]`.
- Add Cards can submit `tcgplayer` and `pricecharting`, but they are currently discarded.

3. Inventory Ready does not trigger PhotoRoom.
- PhotoRoom cleanup happens earlier during Add Cards send-to-KingsReview handoff.
- If an operator expects PhotoRoom to happen on Inventory Ready entry, that expectation is wrong in current code.

4. Inventory Ready trust seeding does not process or promote refs.
- It only inserts trusted external refs.
- No automatic call to `/variants/reference/process` or `/variants/reference/promote` exists on stage transition.

5. Add Cards prefetch creates refs that the matcher does not use yet.
- Prefetch rows default to `qaStatus = pending`.
- Matcher only reads `qaStatus = keep` or `ownedStatus = owned`.

6. The workflow has two overlapping pipelines writing to `CardAsset`.
- New admin OCR suggest path
- Old processing-service OCR/classify/valuation path
- This creates duplication and potential field drift.

7. KingsReview stages `ESCALATED_REVIEW` and `REVIEW_COMPLETE` are mostly storage-only.
- UI exposes them.
- Backend PATCH saves the stage and timestamp.
- No extra automation or dedicated downstream behavior is attached to those stages.

8. `MARKET_COMP` exists in the enum but is unused in current UI/backend flow.
- No current path creates `CardEvidenceItem(kind = MARKET_COMP)`.

9. Inventory assignment does not propagate location into item/QR binding state.
- `inventory-ready/assign.ts` only creates `InventoryBatch` and updates `CardAsset.inventoryBatchId` / `inventoryAssignedAt`.
- It does not update `Item`, `PackLabel`, or `QrCode.locationId`.

10. Inventory purge does not obviously clean up minted inventory artifacts.
- `inventory-ready/purge.ts` deletes card-side rows only.
- It does not delete minted `Item`, `ItemOwnership`, `QrCode`, or `PackLabel`.

11. Add Cards UI requires BACK and TILT before send, but enqueue backend only enforces BACK.
- The frontend validates both.
- `/api/admin/kingsreview/enqueue` only checks for a BACK photo.

12. Reference embeddings may be absent even when crops exist.
- If `VARIANT_EMBEDDING_URL` is not configured, local fallback uploads crops but returns empty vectors.
- Matching then falls back to metadata scoring.

13. Legacy worker has stub/fallback behavior that can silently reduce quality.
- no Google Vision key -> vision stub text
- no eBay bearer token -> valuation stub
- unsupported storage modes in parts of processing-service fall back or error

## Bottom Line

The intended business workflow is:
- Add Cards intake and teach
- KingsReview comps/evidence/variant confirmation
- Inventory Ready item minting and trusted reference seeding
- Assigned to a location batch

The implemented workflow is close, but not complete:
- Add Cards teach systems are live
- KingsReview and Inventory Ready are live
- Assigned Locations is only partially represented in data and not yet in finished UI/workflow
- reference trust exists, but owned-reference promotion is still a separate manual step
