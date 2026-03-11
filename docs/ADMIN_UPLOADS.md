# Admin Upload Pipeline

This document tracks the admin card-processing upload flow that now lives inside `frontend/nextjs-app`.

## Storage configuration

The API currently supports a local development storage mode that saves uploaded assets to `public/uploads/cards` inside the Next.js app. Configure the following environment variables in `frontend/nextjs-app/.env.local` before running the dev server:

```
CARD_STORAGE_MODE=local
CARD_STORAGE_LOCAL_ROOT=/home/mark/tenkings/ten-kings-mystery-packs/frontend/nextjs-app/public/uploads/cards
CARD_STORAGE_PUBLIC_PREFIX=/uploads/cards
CARD_UPLOAD_MAX_BYTES=26214400
```

> `CARD_UPLOAD_MAX_BYTES` defaults to 25 MB when omitted. Adjust the path to match your workspace if it ever changes.

S3/offsite storage is not wired yet. When that work begins we'll extend the storage helper in `lib/server/storage.ts`.

## Database migration

A new Prisma migration (`20250203120000_card_asset_uploading`) introduces the `CardAssetStatus.UPLOADING` state. Run the migration and regenerate the client once Postgres is available:

```
cd /home/mark/tenkings/ten-kings-mystery-packs
pnpm --filter @tenkings/database exec prisma migrate dev --name card-ingestion
pnpm --filter @tenkings/database exec prisma generate
```

## Upload flow (dev)

1. Start the Next.js dev server from `frontend/nextjs-app` (`pnpm dev`).
2. Sign in with an admin phone number (e.g. `7707139501`).
3. Visit `/admin/uploads`, select the card images, and click **Upload**.
4. The CLI will:
   - create or reuse a `CardBatch`,
   - stream the file to `/api/admin/uploads/file`, which stores it under `public/uploads/cards`,
   - mark the `CardAsset` as `UPLOADED` in the database.
5. Uploaded assets appear in the results list with their `assetId` and public preview URL (the images load directly from `public/uploads/cards`).

## Reviewing batches

- `GET /api/admin/batches` returns the operator's recent batches (latest first).
- `GET /api/admin/batches/[id]` expands a single batch with all associated assets, and `GET /api/admin/cards/[id]` surfaces the full record (notes, OCR, valuation, etc.).
- `/admin/uploads` now lists recent batches, and `/admin/batches/[id]` renders a gallery of the associated assets.

`POST /api/admin/uploads/complete` now finalizes the upload directly:
- it stores any final file metadata,
- attempts thumbnail generation,
- and marks the `CardAsset` as `READY`.

Batch list/detail screens compute `processedCount` and `READY` state from `CardAsset.status = READY`, so uploads now appear as processed without any separate background worker.
