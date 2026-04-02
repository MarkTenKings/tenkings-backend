# Task 22 Analysis: Upload Pipeline Regression

Date: `2026-04-02`
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch at investigation start: `main`
HEAD at investigation start: `6bc33fe`

## Summary

The April 2 failure is a real intake-pipeline regression, but not the exact one implied by the UI symptom text.

What is actually happening:

1. `CardAsset` rows are being created too early in `uploads/presign.ts`, with `reviewStage=READY_FOR_HUMAN_REVIEW` before the front image upload is finished.
2. Some April 2 front uploads never finished the browser PUT or never reached `/api/admin/uploads/complete`, so those rows stayed `UPLOADING` with no OCR, no thumbnails/CDN variants, and no back/tilt photos.
3. Those incomplete rows still surfaced in KingsReview because the KingsReview list filters by `reviewStage`, not by upload completeness.
4. OCR queue showed `0` because the OCR queue route requires both `BACK` and `TILT` photos. The broken April 2 rows did not have those photos.
5. The “filename image” symptom is a presentation artifact from broken/missing image objects. The persisted `imageUrl` values on the broken rows are full Spaces URLs, but at least one broken April 2 URL returns `403`, proving the object is not actually available.

## Step 1: Upload / Complete Flow Trace

### 1. `frontend/nextjs-app/pages/api/admin/uploads/presign.ts`

What it does:

- Validates `fileName`, `size`, `mimeType`, optional `batchId`, optional `reviewStage`
- Creates the `CardBatch` if needed
- Creates a `CardAsset` immediately with:
  - `status: UPLOADING`
  - `imageUrl: publicUrlFor(storageKey)`
  - `reviewStage: reviewStageValue`
  - `reviewStageUpdatedAt: now` when `reviewStage` is supplied
- Returns:
  - `uploadUrl`
  - `assetId`
  - `batchId`
  - `publicUrl`
  - `storageMode`
  - `acl`

Important finding:

- The Add Cards flow passes `reviewStage=READY_FOR_HUMAN_REVIEW`, so the asset becomes review-visible before the file upload is confirmed.

### 2. `frontend/nextjs-app/pages/api/admin/uploads/file.ts`

What it does:

- Only used for non-S3 modes
- Writes the uploaded bytes locally
- Rewrites `imageUrl` to a `data:` URL for local mode

Important finding:

- This route is not the production path for the broken April 2 rows because storage mode is S3/Spaces in `.env.production`.

### 3. `frontend/nextjs-app/pages/api/admin/uploads/complete.ts`

What it does today:

- Loads the existing `CardAsset`
- Updates metadata fields (`fileName`, `mimeType`, `fileSize`)
- Tries to read the uploaded object via `readStorageBuffer(asset.storageKey)`
- Tries to generate `thumbnailUrl`
- In S3 mode, tries to generate `cdnHdUrl` and `cdnThumbUrl`
- Unconditionally sets:
  - `status: READY`

Important findings:

- It does **not** set OCR data or trigger OCR itself
- It does **not** verify that `readStorageBuffer()` succeeded before advancing the row to `READY`
- Its last status change was introduced in commit `9ca2d06` (`fix: mark uploads ready after completion`), replacing the earlier `OCR_PENDING`

### 4. `frontend/nextjs-app/pages/api/admin/uploads/ocr-queue.ts`

Query filters:

- `batch.uploadedById = admin.user.id`
- `reviewStage = READY_FOR_HUMAN_REVIEW`
- `bytebotLiteJobs: none`
- must have a `BACK` photo
- must have a `TILT` photo

Important finding:

- OCR queue is controlled by `reviewStage` plus photo presence, not by `status`
- Front-only rows or rows missing `TILT` will never show here

### 5. `frontend/nextjs-app/lib/server/storage.ts`

Relevant behavior:

- `publicUrlFor(storageKey)` returns full Spaces/CDN URLs in S3 mode
- `.env.production` uses:
  - `CARD_STORAGE_MODE="s3"`
  - `CARD_STORAGE_PUBLIC_BASE_URL="https://tenkings-cards.nyc3.digitaloceanspaces.com"`

Important finding:

- The code path for production image URLs is correct
- The broken April 2 symptom is not caused by `publicUrlFor()` returning bare filenames

## Step 2: Recent History Check

Requested recent commits:

- `4ad4656` `fix(add-cards): stabilize identify-set and screen2 prefetch effect lifecycles`
- `f7e2173` `fix(add-cards): fix screen 2 prefetch timeout + remove T17-DEBUG instrumentation`
- `512665d` `fix(add-cards): fix identify-set SetCard ID mismatch + restore product set fallbacks`

Findings from `git log --oneline --all -- <filepath>`:

- `frontend/nextjs-app/pages/api/admin/uploads/complete.ts`
  - last meaningful workflow change: `9ca2d06` `fix: mark uploads ready after completion`
  - later image-variant add: `9bc79a9`
- `frontend/nextjs-app/pages/api/admin/uploads/presign.ts`
  - no April 1 commit touched it
- `frontend/nextjs-app/pages/api/admin/uploads/file.ts`
  - no April 1 commit touched it
- `frontend/nextjs-app/lib/server/storage.ts`
  - no April 1 commit touched upload semantics
- `frontend/nextjs-app/lib/server/images.ts`
  - no April 1 commit touched upload semantics
- `frontend/nextjs-app/lib/server/imageVariants.ts`
  - added by `9bc79a9`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
  - touched by `4ad4656`
  - touched by `f7e2173`
  - touched by `512665d`

Important conclusion:

- The April 1 commits only touched the frontend `uploads.tsx` page logic, not the server upload endpoints.
- The server-side status regression in `complete.ts` predates April 1 and is still present on `main`.

## Step 3: CardAsset Status / Review Flow

### What determines OCR queue vs KingsReview visibility?

Observed in current code:

- OCR queue route:
  - `reviewStage=READY_FOR_HUMAN_REVIEW`
  - `BACK` + `TILT` required
  - no Bytebot job
- KingsReview list route:
  - includes `reviewStage=READY_FOR_HUMAN_REVIEW`
  - no guard against `status=UPLOADING`

### What should a newly uploaded card have?

Practically, a newly usable Add Cards row must have:

- completed front upload
- readable front image object
- `reviewStage=READY_FOR_HUMAN_REVIEW` only after that
- `BACK` and `TILT` added before it can enter OCR queue

### What are the broken April 2 cards getting?

Direct DB evidence:

- Four April 2 front rows were found in:
  - `status=UPLOADING`
  - `reviewStage=READY_FOR_HUMAN_REVIEW`
  - `thumbnailUrl=null`
  - `cdnHdUrl=null`
  - `cdnThumbUrl=null`
  - `ocrTextLen=0`
  - no `BACK` photo
  - no `TILT` photo

Example:

- `e7d457fc6f9349929bc5f1ea477cea0b`
  - `createdAt=2026-04-02T12:04:35.539Z`
  - `status=UPLOADING`
  - `reviewStage=READY_FOR_HUMAN_REVIEW`
  - no photos

One partially completed April 2 row:

- `b9875cfa989e4f648eae67b8d5236836`
  - `status=READY`
  - `reviewStage=READY_FOR_HUMAN_REVIEW`
  - front image + thumbnail + CDN variants exist
  - `BACK` exists
  - `TILT` missing
  - `ocrTextLen=0`

Working April 1 rows:

- `status=READY`
- `reviewStage=READY_FOR_HUMAN_REVIEW`
- `BACK` + `TILT` both present
- OCR text populated
- thumbnails/CDN variants populated

Important conclusion:

- The April 2 cards are not being auto-advanced to a true post-OCR/KingsReview stage.
- They are surfacing early because `reviewStage` is assigned too soon and KingsReview does not exclude incomplete uploads.

## Step 4: Image URL Generation Check

### `uploads/complete.ts`

Current behavior:

- Does not rewrite `imageUrl`
- Only writes `thumbnailUrl`, `cdnHdUrl`, and `cdnThumbUrl` after reading the source object

### Actual DB comparison

Broken April 2 row:

- `imageUrl` is a full Spaces URL, not a filename

Working April 1 row:

- `imageUrl` is also a full Spaces URL

### Public URL verification

Checked with HTTP `HEAD`:

- broken April 2 front URL:
  - returned `403`
- working April 2/April 1 front URL:
  - returned `200`

Important conclusion:

- The broken image symptom is caused by missing/inaccessible uploaded objects, not by storing the filename in `imageUrl`.
- The alt text (`intake-front-...jpg front`) is the UI fallback when the image request fails.

## Step 5: “Load failed” Error Check

Search result:

- The user-facing message comes through `humanizeRequestFailure()` in `frontend/nextjs-app/pages/admin/uploads.tsx`
- It maps browser fetch transport failures like:
  - `load failed`
  - `failed to fetch`
  - `network request failed`

Important conclusion:

- “Load failed” is a client-side network/transport failure, not a server-thrown application error string.
- In this intake flow, it can occur on:
  - front upload PUT to Spaces
  - `/api/admin/uploads/complete`
  - photo presign/upload for BACK/TILT

## Root Cause

This is a multi-part robustness bug:

1. **Premature visibility**
   - `presign.ts` assigns `reviewStage=READY_FOR_HUMAN_REVIEW` before the front file is actually uploaded.
   - Incomplete `UPLOADING` rows therefore leak into KingsReview queries.

2. **Fail-open completion behavior**
   - `complete.ts` advances rows to `READY` even if source-object reads fail.
   - That makes recovery paths too permissive and allows broken rows to look more complete than they are.

3. **Intake concurrency is fragile**
   - The Add Cards capture flow opens the next card immediately while the prior card finalizes in background.
   - On April 2 this produced transport failures and stranded rows:
     - front-only `UPLOADING` rows
     - partially finalized rows with only `BACK`

## Fix Direction

1. Move `reviewStage` assignment from `presign.ts` to `complete.ts` so rows are not review-visible until the front upload actually finalizes.
2. Make `complete.ts` fail closed when the source image is unreadable instead of silently advancing.
3. Exclude `UPLOADING` rows from KingsReview list queries.
4. Reduce/add robustness around Add Cards background finalization so repeated captures do not strand later cards mid-upload.
