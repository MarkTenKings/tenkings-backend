# Card Automation Pipeline

This note now serves as a historical record for the retired background-processing design.
The active upload flow no longer uses `backend/processing-service` or enqueues `ProcessingJob` work from upload completion.

## High-level flow

```
Upload (browser)
  → `CardAsset` row created (`status = UPLOADING`)
  → File stream finishes
  → `/api/admin/uploads/complete` stores final metadata, attempts thumbnail generation,
    and marks the asset `READY`
  → Later admin review flows enrich the same `CardAsset` record interactively
```

The legacy worker-specific status ladder is no longer active.

## Services & components

| Component | Responsibility |
|-----------|----------------|
| `frontend/nextjs-app` | Upload UI, admin consoles, triggers REST endpoints |
| `pages/api/admin/uploads/*` | Creates batches/assets, finalizes uploads, and marks assets `READY` |
| `packages/shared` | Shared types/constants used by admin flows |

## Queue mechanism

The PostgreSQL-backed `ProcessingJob` queue described in the original plan is now legacy-only.
The Prisma model/table remains for historical records, but the active upload flow does not enqueue or consume processing jobs.

### Processing statuses

Current upload completion behavior:

1. `UPLOADING` while the file transfer is in progress
2. `/api/admin/uploads/complete` finalizes the asset and marks it `READY`

Historical `ProcessingJob.status` / worker-managed transitions remain in the schema only for old records.

## External integrations

The removed worker design referenced Google Vision, Ximilar, and eBay Browse integrations.
Those are no longer part of the upload-complete background pipeline documented here.

## Database changes

1. Add `ProcessingJob` table.
2. Add columns on `CardAsset` for raw OCR JSON, classification labels, valuation metadata (already present).
3. Add `processingStartedAt`, `processingCompletedAt` timestamps for metrics.

## API adjustments

- `POST /api/admin/uploads/complete` now finalizes the upload directly and marks the asset `READY`.
- Historical follow-on ideas in the original plan included retry and notes endpoints, but they were tied to the retired worker model and are not part of the active upload path described here.

## Dev/testing strategy

- Validate upload creation and completion through the Next.js admin APIs.
- Confirm batch list/detail readiness against `CardAsset.status = READY`.
- Keep historical `ProcessingJob` data available for audit purposes only.

## Next implementation steps

The original worker rollout described in this note has been retired.
Current work should treat upload completion as a direct API operation rather than a queued background pipeline.
