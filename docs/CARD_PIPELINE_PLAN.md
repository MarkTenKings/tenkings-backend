# Card Automation Pipeline

This note captures the structure we will implement for automated processing of uploaded card assets.

## High-level flow

```
Upload (browser)
  → `CardAsset` row created (`status = UPLOADING`)
  → File stream finishes → API marks row `UPLOADED` and enqueues job
  → Worker service pulls job
      1. Download the image from storage (local for dev)
      2. Google Vision OCR → store text/JSON
      3. Ximilar classification using OCR text & raw image
      4. Valuation lookup (eBay sold listings, other sources)
      5. Update `CardAsset` status & metadata
```

Each step emits a `CardAssetStatus` transition so the UI reflects progress.

## Services & components

| Component | Responsibility |
|-----------|----------------|
| `frontend/nextjs-app` | Upload UI, admin consoles, triggers REST endpoints |
| `pages/api/admin/uploads/*` | Creates batches/assets and enqueues the first job |
| `backend/processing-service` (new) | Background worker that processes card assets |
| `packages/shared` | Shared types/constants for queue payloads |

## Queue mechanism

We will start with PostgreSQL-backed polling (no Redis dependency yet):

- A `ProcessingJob` table records pending work (`cardAssetId`, `type`, `payload`, `status`, timestamps).
- Worker service keeps a short polling loop (e.g. 5s) selecting the next job in `QUEUED` status.
- Lock rows with `FOR UPDATE SKIP LOCKED` to avoid duplicate work when scaling later.

Future: swap to BullMQ/Redis without changing the API surface.

### Processing statuses

`CardAssetStatus` transitions:

1. `UPLOADED` → `OCR_PENDING`
2. `OCR_PENDING` → `OCR_COMPLETE` (on Google Vision success)
3. `OCR_COMPLETE` → `CLASSIFY_PENDING`
4. `CLASSIFY_PENDING` → `CLASSIFIED`
5. `CLASSIFIED` → `VALUATION_PENDING`
6. `VALUATION_PENDING` → `READY`
7. Any failure → `ERROR` with `errorMessage`

A new `ProcessingJob.status` enum will track job progress (`QUEUED`, `IN_PROGRESS`, `COMPLETE`, `FAILED`).

## External integrations

| Integration | Env vars | Notes |
|-------------|----------|-------|
| Google Vision API | `GOOGLE_VISION_API_KEY` | Worker calls the REST `images:annotate` endpoint with base64 image payload |
| Ximilar API | `XIMILAR_API_KEY`, `XIMILAR_COLLECTION_ID` | REST call using OCR text + raw image to classify |
| Valuation provider (eBay) | `EBAY_BEARER_TOKEN`, `EBAY_MARKETPLACE_ID` (default `EBAY_US`) | Browse API search for recent sold listings |

For development without credentials, the worker will fall back to stub implementations and mark jobs as `CLASSIFIED`/`READY` with placeholder data.

## Database changes

1. Add `ProcessingJob` table.
2. Add columns on `CardAsset` for raw OCR JSON, classification labels, valuation metadata (already present).
3. Add `processingStartedAt`, `processingCompletedAt` timestamps for metrics.

## API adjustments

- `POST /api/admin/uploads/complete` will insert an `OCR` job once the asset is stored.
- New admin endpoints:
  - `POST /api/admin/cards/:id/retry` — resets status to the right stage and enqueues a new job.
  - `POST /api/admin/cards/:id/notes` — attach operator notes during manual review.

## Worker outline

```
loop {
  job = fetchNextQueuedJob()
  if (!job) sleep(5000) and continue
  mark job IN_PROGRESS
  try {
    switch (job.type) {
      case 'OCR': runVision(); enqueue('CLASSIFY'); break;
      case 'CLASSIFY': runXimilar(); enqueue('VALUATION'); break;
      case 'VALUATION': runValuation(); mark asset READY; break;
    }
    mark job COMPLETE
  } catch (err) {
    mark job FAILED; update CardAsset.status = ERROR; store errorMessage
  }
}
```

All processing helpers live in `backend/processing-service/src/processors/*` with dependency injection for mocks.

## Dev/testing strategy

- Provide `npm run worker` script to start the processor locally (polling the same database used by the services).
- Add seed script to create a fake job for testing without uploading new files.
- Provide jest/vitest unit tests for the processors with mock responses.

## Next implementation steps

1. Apply Prisma migration for `ProcessingJob` (schema + enum, extend `CardAsset` timestamps).
2. Implement queue helper in `packages/database/src/processingJobs.ts`.
3. Update upload completion API to insert the first job (`OCR`).
4. Scaffold `backend/processing-service` (Express not required; simple worker script).
5. Update admin UI to show processing status/allow manual retry (future step once worker is done).

This plan keeps all automation within the existing monorepo and uses Postgres as the initial job queue so we can iterate quickly before introducing heavier infra.
