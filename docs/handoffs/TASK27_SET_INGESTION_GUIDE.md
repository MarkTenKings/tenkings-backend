# Task 27: Set Ingestion Pipeline Guide

Date: 2026-04-02
Branch: `main`
HEAD at investigation start: `5047226`

## Scope

This guide traces the current Set Ops CSV ingestion path from upload to approved data, explains why `SetCard` is still empty in production, and documents the batch-import workflow that was used for the large March 2026 set loads.

The current primary approved-set ingestion path is:

1. Upload `set.csv` / `parallel.csv` in `/admin/set-ops-review`
2. Queue `/api/admin/set-ops/ingestion`
3. Build draft with `/api/admin/set-ops/drafts/build`
4. Approve with `/api/admin/set-ops/approval`
5. Auto-run seed job, which currently syncs `CardVariant`

Important distinction: the Step 1 “Bulk import” block in the same UI posts to `/api/admin/variants/bulk-import` and goes straight to `CardVariant`. That is a legacy direct variant importer, not the approved set taxonomy flow. See `frontend/nextjs-app/pages/admin/set-ops-review.tsx:1138-1187`.

## 1. How set list CSVs are uploaded

### 1.1 Current admin page

The current operator UI is `/admin/set-ops-review`. The ingestion state and handlers live in `frontend/nextjs-app/pages/admin/set-ops-review.tsx`.

Relevant state:

- `queueDatasetMode` defaults to `PARALLEL_DB` and can be `PARALLEL_DB`, `PLAYER_WORKSHEET`, or `COMBINED`: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:506-519`
- file upload handler is `handlePayloadFileChange(...)`: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:1061-1135`
- queue submit handler is `createIngestionJob(...)`: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:947-1059`

### 1.2 Upload behavior

`handlePayloadFileChange(...)` has two paths:

1. Non-PDF CSV/JSON upload:
   - reads the local file in the browser with `await file.text()`
   - parses it with `parseRowsFromFileContent(file.name, text)`
   - writes the parsed object rows into `rawPayloadInput`
   - code: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:1104-1125`

2. PDF upload:
   - posts the raw binary to `POST /api/admin/set-ops/discovery/parse-upload`
   - optionally passes `datasetType` unless the mode is `COMBINED`
   - code: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:1079-1103`
   - route: `frontend/nextjs-app/pages/api/admin/set-ops/discovery/parse-upload.ts:50-123`

For CSV uploads, nothing is written to the database until the operator submits the queue form.

### 1.3 Queue API

Submitting the Step 1 form calls `POST /api/admin/set-ops/ingestion` once per dataset in `expandDatasetMode(queueDatasetMode)`.

Actual request body fields from the UI:

- `setId`
- `datasetType`
- `sourceUrl`
- `parserVersion`
- `sourceProvider`
- `sourceFetchMeta.rowCount`
- `sourceFetchMeta.fileName`
- `sourceFetchMeta.importedAt`
- `sourceFetchMeta.datasetMode`
- `rawPayload`

Code: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:975-995`

If `queueDatasetMode === "COMBINED"`, the UI loops and sends two ingestion jobs, one with `PLAYER_WORKSHEET` and one with `PARALLEL_DB`. Code: `frontend/nextjs-app/pages/admin/set-ops-review.tsx:972-1012`.

## 2. CSV format and contract detection

### 2.1 Set checklist CSV

The checklist detector is in `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:189-225`.

It classifies a file as `SET_LIST` when the normalized headers include:

- `card_number`
- `player_name`
- `team`
- one of `subset`, `card_type`, or `program`

Code: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:193-200`

Your target checklist format:

```csv
Card_Number,Player_Name,Team,Card_Type,Rookie
```

is accepted because:

- `Card_Number` maps to `cardNumber`
- `Player_Name` maps to `playerName`
- `Team` maps to `team`
- `Card_Type` is accepted as a subset/program alias
- `Rookie` maps to `rookie`

Alias table: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:49-57`

### 2.2 Parallel CSV

The same detector classifies a file as `PARALLEL_LIST` when:

- normalized headers include `card_type`
- at least one other column looks like an odds/format column
- sampled cells also look like odds data

Code: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:201-223`

Your target parallel format:

```csv
Card_Type,Parallel,Odds_Hobby,Odds_HTA_Jumbo,...
```

fits the parser:

- `Card_Type` is required
- `Parallel` is optional but used when present
- `Odds_*` columns are explicitly recognized as odds headers

Code:

- odds header detection: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:146-155`
- odds payload builder: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:491-698`

### 2.3 How the raw payload is reshaped before DB insert

`POST /api/admin/set-ops/ingestion` always calls `adaptCsvContractPayloadForIngestion(...)` before creating the job. Code: `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts:173-179`

For checklist CSVs:

- rows are grouped by `Card_Type` / subset
- the adapted payload becomes:
  - `artifactType: "CHECKLIST"`
  - `sourceKind: "OFFICIAL_CHECKLIST"`
  - `contractType: "SET_LIST"`
  - `programs: [{ label, cards: [...] }]`

Code: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:379-489`

For parallel CSVs:

- rows are parsed into:
  - `artifactType: "ODDS"`
  - `sourceKind: "OFFICIAL_ODDS"`
  - `contractType: "PARALLEL_LIST"`
  - `formats: [...]`
  - `odds: [...]`

Code: `frontend/nextjs-app/lib/server/setOpsCsvContract.ts:491-698`

## 3. Where the uploaded data lands first

The first database landing point is `SetIngestionJob`.

Schema:

- `SetDraft`: `packages/database/prisma/schema.prisma:610-631`
- `SetIngestionJob`: `packages/database/prisma/schema.prisma:633-658`

`POST /api/admin/set-ops/ingestion` does two writes:

1. `prisma.setDraft.upsert(...)` by `setId`
2. `prisma.setIngestionJob.create(...)`

Code: `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts:186-239`

What is stored on the ingestion job:

- `rawPayload`: the adapted structured checklist/odds payload
- `parseSummaryJson`: source-provider metadata plus CSV contract summary/quality
- `status: QUEUED`

Code: `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts:200-225`

So the original parsed checklist data is not lost. It is preserved first in `SetIngestionJob.rawPayload`.

## 4. How ingestion jobs become draft rows

### 4.1 Build draft endpoint

The build step is `POST /api/admin/set-ops/drafts/build`. Route: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:52-283`

Core sequence:

1. load `SetIngestionJob`
2. find or create `SetDraft`
3. normalize raw payload with `normalizeDraftRows(...)`
4. run quality gate with `evaluateDraftQuality(...)`
5. optionally run taxonomy ingest
6. create immutable `SetDraftVersion`
7. mark draft and ingestion job as `REVIEW_REQUIRED`

Key code:

- job load: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:76-88`
- normalize rows: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:114-118`
- quality gate: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:119-163`
- taxonomy ingest call: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:165-201`
- draft version create: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:203-242`
- status change to `REVIEW_REQUIRED`: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:244-257`

### 4.2 How checklist rows are reconstructed

`normalizeDraftRows(...)` is in `frontend/nextjs-app/lib/server/setOpsDrafts.ts:445-605`.

If `rawPayload` contains structured checklist `programs`, `parseRawRows(...)` expands them back into flat rows with:

- `cardNumber`
- `playerName`
- `playerSeed`
- `team`
- `isRookie`
- `cardType`
- `program`
- `programLabel`

Code: `frontend/nextjs-app/lib/server/setOpsDrafts.ts:184-230`

Then `normalizeDraftRows(...)` produces one normalized draft row per card:

- validates blocking errors
- computes duplicate keys
- preserves the original row in `raw`

Code: `frontend/nextjs-app/lib/server/setOpsDrafts.ts:456-593`

### 4.3 Where the card-level checklist data is stored long-term

`createDraftVersionPayload(...)` writes every normalized row, including `raw`, into `SetDraftVersion.dataJson.rows`.

Code: `frontend/nextjs-app/lib/server/setOpsDrafts.ts:689-751`

`SetDraftVersion.sourceLinksJson` also stores the source ingestion job ID:

- `sourceUrl`
- `ingestionJobId`

Code: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:224-227`

This is the key reason the new `SetCard` population script can work without original files on disk. The approved checklist draft versions still contain the original card-level rows.

## 5. What creates SetProgram, SetParallel, SetTaxonomySource, and SetCard today

### 5.1 Taxonomy ingest is called during draft build

The build route creates `taxonomyRows = buildTaxonomyIngestRows(normalized.rows)` and then calls `ingestTaxonomyV2FromIngestionJob(...)` when the taxonomy flags allow it.

Code:

- taxonomy row build: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:165`
- ingest call: `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:167-179`

`buildTaxonomyIngestRows(...)` maps normalized draft rows into taxonomy input rows. Code: `frontend/nextjs-app/lib/server/setOpsDrafts.ts:607-687`

### 5.2 Where SetProgram / SetParallel / SetCard would be created

`ingestTaxonomyV2FromIngestionJob(...)` is the only active approved-set ingestion path that upserts taxonomy tables from ingestion jobs.

Route function: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1302-1536`

Actual creation loops:

- `upsertProgram(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:267-353`
- `upsertCard(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:355-507`
- `upsertParallel(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:605-731`
- `upsertScope(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:733-810`
- `upsertOdds(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:812-941`

These are invoked here:

- programs: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1415-1427`
- parallels: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1450-1462`
- cards: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1464-1476`
- scopes: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1478-1490`
- odds: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1492-1505`

### 5.3 Why `SetProgram` gets populated

The manufacturer adapter does run for `PARALLEL_DB`.

`canRunManufacturerAdapter(...)` explicitly blocks only `PLAYER_WORKSHEET`, not `PARALLEL_DB`.

Code: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:515-520`

When the odds adapter runs, it emits:

- `programs`
- `parallels`
- `scopes`
- `oddsRows`

Code: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:356-467`

That is why production has non-zero `SetProgram` and `SetParallel` counts.

The source of `SetProgram.label` is the parsed program/card-type label. In the odds path, it comes from `parsedProgram` / `cardType`. See:

- raw program extraction: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:295-307`
- emitted program row: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:356-362`

### 5.4 Why `SetTaxonomySource` gets populated

Every taxonomy ingest, even a failed adapter selection, creates a `SetTaxonomySource`.

If no adapter can run:

- `createAdapterOutput(...)` returns `output: null`
- `ingestTaxonomyV2FromIngestionJob(...)` still creates a `SetTaxonomySource`
  - `artifactType: CHECKLIST`
  - `sourceKind: TRUSTED_SECONDARY`
  - `sourceLabel: "adapter-missing"`

Code:

- adapter selection: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1252-1300`
- adapter-missing source create: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1326-1378`

That is why production shows many `SetTaxonomySource` rows even when cards were never materialized.

## 6. Approval flow and what the “seed COMPLETE” step actually means

Approval route: `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts:59-358`

Actual approval sequence for `decision === APPROVED`:

1. create `SetSeedJob`
2. call `runSeedJob(...)`
3. create `SetApproval`
4. update `SetDraft.status = APPROVED`
5. update matching `SetIngestionJob.status = APPROVED`

Key code:

- create seed job: `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts:179-206`
- execute seed: `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts:208-236`

`runSeedJob(...)` is in `frontend/nextjs-app/lib/server/setOpsSeed.ts:80-320`.

That seed job:

- reads approved draft rows
- skips blocking rows
- resolves variant identity
- creates or updates `CardVariant`
- upserts `CardVariantTaxonomyMap`
- computes reference-image queue count

Code:

- load rows: `frontend/nextjs-app/lib/server/setOpsSeed.ts:89-98`
- create/update `CardVariant`: `frontend/nextjs-app/lib/server/setOpsSeed.ts:170-199`
- map table upsert: `frontend/nextjs-app/lib/server/setOpsSeed.ts:207-259`

Important conclusion:

The Set Ops “seed” step showing `COMPLETE` means the `CardVariant` sync completed. It does not mean `SetCard` was populated.

There is no `setCard.create(...)` or `setCard.createMany(...)` call anywhere in `runSeedJob(...)`.

## 7. Why `SetCard` has zero rows

This is the exact failure chain.

### 7.1 The code that is supposed to create SetCard exists

There is real `SetCard` write code in `taxonomyV2Core.ts`:

- `upsertCard(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:355-507`
- loop invoking it: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1464-1476`

There is also a legacy bootstrap path that can bulk-create `SetCard` from existing `CardVariant` rows:

- `backfillTaxonomyV2FromLegacyVariants(...)`: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1064-1220`
- `SetCard.createMany(...)` there: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1200-1212`
- manual backfill route that can invoke it: `frontend/nextjs-app/pages/api/admin/set-ops/taxonomy/backfill.ts:386-412`

So `SetCard` population was built. It is just not part of the normal approved CSV pipeline.

### 7.2 Why checklist ingestion never reaches `upsertCard(...)`

The manufacturer adapter gate is the blocker:

```ts
export function canRunManufacturerAdapter(...) {
  if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET) {
    return false;
  }
  ...
}
```

Code: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:515-520`

That means checklist ingestion jobs (`PLAYER_WORKSHEET`) do not get an adapter output.

Then `createAdapterOutput(...)` falls through to:

- `adapter: "none"`
- `output: null`
- `skippedReason: "No eligible taxonomy adapter for this source/manufacturer"`

Code: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1284-1299`

Then the taxonomy ingest creates only an `adapter-missing` source row and one ambiguity row, with zero cards/programs/parallels materialized.

Code: `frontend/nextjs-app/lib/server/taxonomyV2Core.ts:1326-1378`

### 7.3 Why the odds path does not rescue SetCard

The odds adapter does run, but card creation inside the adapter is guarded by:

```ts
if (!isOddsDataset && cardNumber) {
  ...
  cards.push(...)
}
```

Code: `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts:365-386`

So `PARALLEL_DB` jobs emit no `cards` at all. They only emit programs/parallels/scopes/odds.

### 7.4 Why approval does not fix it later

The approval seed job only writes `CardVariant` rows. Code: `frontend/nextjs-app/lib/server/setOpsSeed.ts:170-199`

It never writes `SetCard`.

### 7.5 Final conclusion

`SetCard` is zero because:

1. checklist CSVs are preserved in approved draft versions
2. checklist taxonomy ingest is blocked by `canRunManufacturerAdapter(... PLAYER_WORKSHEET) => false`
3. odds taxonomy ingest creates programs/parallels but no cards
4. approval seed sync creates `CardVariant`, not `SetCard`
5. the manual taxonomy backfill route exists but is not part of the normal import/approval workflow

## 8. Batch upload process and the March 2026 large imports

### 8.1 Script used

The batch script is `scripts/set-ops/batch-import.js`.

Usage header: `scripts/set-ops/batch-import.js:42-83`

Package script from the repo root:

- `pnpm set-ops:batch-import`

The CLI uses the same backend APIs as the UI:

- queue ingestion jobs
- build drafts
- optionally approve them

The actual flow is documented in the script usage and in the March 8-9 handoff entries in `docs/HANDOFF_SET_OPS.md:4450-5115`.

### 8.2 Supported batch modes

1. Manifest mode
   - required manifest columns/fields:
     - `setId,setCsv,parallelCsv,setSourceUrl,parallelSourceUrl`
   - code: `scripts/set-ops/batch-import.js:54-55`
   - manifest parsing: `scripts/set-ops/batch-import.js:303-334`

2. Folder mode
   - parent folder contains one subfolder per set
   - subfolder name must be the exact canonical `setId`
   - inside each set folder:
     - `set.csv`
     - `parallel.csv` optional
   - code: `scripts/set-ops/batch-import.js:57-63`

### 8.3 What commands were actually run

The handoff docs show this was a multi-run operational workflow, not one single “load 241 sets” command.

Examples captured in `docs/HANDOFF_SET_OPS.md`:

- first successful large preflight:
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both --mode preflight --continue-on-error`
- ready-only commit subset:
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-ready --mode commit`
- later reruns on failed subsets:
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-failed --mode preflight --continue-on-error`
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-failed-ready --mode commit`
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-remaining-27 --mode preflight --continue-on-error`
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-final-25-ready --mode commit`
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-final-2 --mode commit`
- existing-set rerun:
  - `pnpm set-ops:batch-import --folder batch-imports/run-1-both-existing-5 --mode commit --allow-existing-set`
- NBA follow-up:
  - `pnpm set-ops:batch-import --folder batch-imports/missing-parallels-nba-3 --mode commit`
- MLB parallel-only additions:
  - `pnpm set-ops:batch-import --folder batch-imports/mlb-missing-parallels-122-parallel-ready --mode commit --allow-existing-set`

These commands are recorded in `docs/HANDOFF_SET_OPS.md:4526-5115`.

### 8.4 How the batch script maps files to set IDs

Folder mode mapping is exact:

- folder name = canonical `setId`
- `set.csv` in that folder is uploaded as `PLAYER_WORKSHEET`
- `parallel.csv` in that folder is uploaded as `PARALLEL_DB`

Code:

- dataset definitions: `scripts/set-ops/batch-import.js:7-22`
- folder convention: `scripts/set-ops/batch-import.js:57-63`

This is not a filename-derived mapper like `2025_Topps_Chrome_Basketball_SET_List.csv -> setId`. The folder name is the canonical source of truth in folder mode.

Manifest mode can point at arbitrarily named files, but the manifest `setId` field is still the authoritative destination ID. Code: `scripts/set-ops/batch-import.js:314-333`

### 8.5 Why `SetDraft = 241` should not be read as one batch size

The production `SetDraft` count of `241` is the cumulative database state, not proof of a single 241-set batch run.

Evidence from the handoff docs shows:

- multiple preflight/commit waves
- reruns against smaller ready-only subsets
- `--allow-existing-set` reprocessing of already-existing sets
- later NBA and MLB follow-up batches

So the right conclusion is:

- yes, there was a batch-import script
- no, the available repo evidence does not show one single command that created 241 new drafts in one pass
- `241` is the current accumulated `SetDraft` table size after multiple runs and prior state

## 9. The new SetCard population script

To fill the missing `SetCard` table without modifying the active ingestion pipeline, this task adds:

- `frontend/nextjs-app/scripts/populate-set-cards.ts`

Why the script lives there:

- `pnpm --filter @tenkings/nextjs-app exec ...` runs inside `frontend/nextjs-app`
- verified with `pnpm --filter @tenkings/nextjs-app exec pwd` -> `/Users/markthomas/tenkings-task27-main/frontend/nextjs-app`

Run command:

```bash
pnpm --filter @tenkings/nextjs-app exec tsx scripts/populate-set-cards.ts --dry-run
```

What it does:

1. iterate approved active `SetDraft` rows
2. find the latest approved `PLAYER_WORKSHEET` draft version for each set
3. extract preserved checklist rows from `SetDraftVersion.dataJson.rows`
4. resolve the checklist `SetTaxonomySource.id`
5. match checklist `Card_Type` to existing `SetProgram`
6. insert or fill-in `SetCard` rows in batches

It is intentionally:

- idempotent
- batched
- safe to dry-run
- limited to `SetCard` writes only

## 10. Practical future upload guide

If the goal is to load another batch of sets through the approved pipeline, use this order:

1. Prepare one canonical folder per set.
2. Name the folder exactly as the target `setId`.
3. Put `set.csv` inside for checklist rows.
4. Put `parallel.csv` inside for odds/parallels if available.
5. Run batch preflight:

```bash
pnpm set-ops:batch-import --folder <batch-folder> --mode preflight --continue-on-error
```

6. Inspect the JSON report and isolate only `preflight_complete` sets if needed.
7. Commit only the passing subset:

```bash
pnpm set-ops:batch-import --folder <ready-only-folder> --mode commit
```

8. If the set already exists and you are adding only `parallel.csv`, rerun with:

```bash
pnpm set-ops:batch-import --folder <parallel-only-folder> --mode commit --allow-existing-set
```

9. If you need `SetCard` rows afterward, run the new population script, because the normal approval flow still does not create them.
