# Set Ops Runbook

Current ATLAS checkpoint: the lossless release from `a11ca928a51309b50457579b74c849404e004043` is live, verified 2026-09-28T03:02 UTC. Staff/public/private source and controls are recorded in DEPLOY_RUNBOOK. New preparations use lossless WebP and progressive reviewer/customer previews; existing approved history is preserved. The owner six-card test is recorded in `docs/atlas/audits/2026-09-28/six-card-lossless-comparison.md`. No Ten Kings or Set Ops behavior changed. Earlier checkpoints below are historical.

ATLAS-only saved-photo/review-image reliability checkpoint — verified 2026-09-28T01:34:53.587Z: source `0de150fad9853cfafd7227e67b7c25f377261999` is live on staff/public and private container `atlas-review-photos-0de150fad985`, using image `sha256:b1bbd8a9d6265cb25244fa38ed88a91fb672e152153b77cd01d8ca1b92ab793a`. Opaque iPhone PNG preparation and physical-edge image delivery are corrected; post-ASTRA/customer reports retain their existing normalized WebP92 images. Staff/STAFF SMS/PublicReader controls are 43/41/23, customer 15/13 and ledgers 58/112 unchanged. Postflight preserved 23 grading histories and 43 jobs with zero active work. By 2026-09-28T01:47:22Z all 16 saved sides across eight cards were prepared with original hashes preserved; three cards progressed to analysis, four need identity review and one needs geometry review. The live Snivy lossless display proof passed without a database fingerprint change. The temporary one-connection maintenance allowance was restored to the prior four-connection role limit; no serving restart or configuration change was needed for repair. These are photo recovery results, not completed grades or human approvals. The older seven additional physical captures remain unexplained. No Ten Kings or Set Ops behavior changed. See DEPLOY_RUNBOOK for exact runtime, qualification and evidence; older checkpoints below are historical.

ATLAS-only reliability checkpoint — 2026-09-27, 22:41 UTC: source `c9023b8dce22f9d84c1424624b4de54b4fd3c3d1` is live, preserving the latest 229485b homepage. Staff timeout removed; managed six-connection transaction pool serves staff web traffic; pre-grading photo failures appear in Needs Attention. Staff ledger58, controls41/39/21, customer unchanged. Current container `atlas-staff-reliability-c9023b8dce22` / 61d05b127b4a retains the d4a image. See DEPLOY_RUNBOOK for exact source, bindings and qualification. This release changes no Ten Kings or Set Ops behavior. Earlier checkpoints below are historical.

ATLAS-only release checkpoint — 2026-09-27T09:19:58.455321+00:00: fixed rapid review and the exact approved voice are live from `851536b1368a90962cb4650eda7a8920d50bb2bb`. This release changed two private staff web-binding fields and three guarded ATLAS control rows, preserving all grading history and jobs. No Set Ops behavior, data, schema or permissions changed. Full release evidence is in the current Deploy Runbook and SESSION_LOG.

last_verified_at: 2026-02-21
owner: Mark

## Rules
- Never trust UI-only symptoms; validate via API + DB
- Log every run in `docs/handoffs/SESSION_LOG.md`
- No destructive production delete confirms without explicit approval

## AI Grader Mathematical V1 identity/reference boundary

Mathematical Calibration V1 does not change, discover, merge, seed, archive, or delete set/card identity. Before a V1 capture the operator supplies the exact existing `tenantId + setId + programId + cardNumber + variantId + parallelId` identity and chooses one centering profile per side. The capture path must fail closed on an incomplete or ambiguous identity; it must not silently choose a nearby checklist row, historical card, report, image, or grade.

`registered_design_template_v1` is a separate admin-controlled reference lifecycle. One exact private artifact is keyed to the complete identity and side, its bytes determine MIME type/dimensions/SHA-256, and it must be APPROVED before the station may stage it. Set Ops source imagery, internet/eBay imagery, listing thumbnails, arbitrary symmetry, or a loose card-name match are never precision centering authority. A changed set/program/card/variant identity requires a separately reviewed reference; do not rewrite an approved row to make it fit.

The product contract is in `docs/specs/AI_GRADER_MATHEMATICAL_CALIBRATION_V1.md`; supervised rig calibration is in `docs/runbooks/AI_GRADER_MATHEMATICAL_CALIBRATION_V1_RUNBOOK.md`. Neither runbook authorizes a Set Ops mutation. Destructive set operations still require the existing dry-run impact and typed confirmation rules.

## P0 UI Workflow (No Terminal)
Admin pages:
- `/admin/set-ops` (set list, archive/unarchive, delete dry-run/confirm)
- `/admin/set-ops-review` (ingestion queue, draft review/edit, approval, seed monitor)

Role capabilities (server-enforced):
- `reviewer`: list sets, ingestion queue, draft build/load/save
- `approver`: approve/reject draft, start/retry/cancel seed jobs
- `delete`: delete dry-run + confirm
- `admin`: archive/unarchive

Primary APIs:
- `GET /api/admin/set-ops/discovery/search`
- `POST /api/admin/set-ops/discovery/import`
- `GET /api/admin/set-ops/access`
- `GET /api/admin/set-ops/sets`
- `POST /api/admin/set-ops/archive`
- `POST /api/admin/set-ops/delete/dry-run`
- `POST /api/admin/set-ops/delete/confirm`
- `GET/POST /api/admin/set-ops/ingestion`
- `POST /api/admin/set-ops/drafts/build`
- `GET /api/admin/set-ops/drafts`
- `POST /api/admin/set-ops/drafts/version`
- `POST /api/admin/set-ops/approval`
- `GET/POST /api/admin/set-ops/seed/jobs`
- `POST /api/admin/set-ops/seed/jobs/:jobId/cancel`
- `POST /api/admin/set-ops/seed/jobs/:jobId/retry`

## Pre-Release Validation Checklist
Code checks:
- `pnpm --filter @tenkings/shared test`
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/access.ts --file pages/api/admin/set-ops/delete/confirm.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts --file lib/server/setOpsDiscovery.ts`

Manual staging flow:
1. Run source discovery search (year/manufacturer/sport/query), import one discovered source as ingestion job, and confirm row count > 0.
Note: if discovery/import reports source access blocked (`401/403`), use Step 1 file upload fallback (CSV/JSON/PDF) in `/admin/set-ops-review`.
Note: if discovery result opens a listing/search page instead of exact checklist page, copy the exact URL and use Step 0 direct URL import controls (`Import URL as parallel_db` / `player_worksheet` / `combined`).
2. Queue ingestion (`parallel_db`) and build draft.
Note: for checklist sources that include both parallel and player rows in one file/source, choose combined mode to queue both datasets together.
3. Edit at least one draft row and save a new immutable version.
4. Verify approval is blocked when blocking errors exist.
5. Approve clean draft and verify approval diff/metadata.
6. Start seed run; verify monitor updates, then retry/cancel paths as applicable.
7. From `/admin/set-ops`, run archive and unarchive.
8. Run delete dry-run and verify impact counts/audit snippet.
9. Only in non-prod/staging: run delete confirm with typed phrase and verify transaction + audit event.

## Production Rollout Checklist
1. Deploy code and verify serving commit hash.
2. Verify role access endpoint (`/api/admin/set-ops/access`) for admin accounts.
3. Smoke test `/admin/set-ops` list/search and `/admin/set-ops-review` queue view.
4. Run archive/unarchive on a safe test set and verify audit event presence.
5. Run delete dry-run only in production unless explicit delete approval is provided.
6. Capture evidence (API response snippets + UI screenshots) in `docs/handoffs/SESSION_LOG.md`.

## Batch CSV Import (Local CLI)
Use this when you want to queue many SET LIST + PARALLEL LIST pairs without changing the existing one-at-a-time UI.

Simplest folder layout:
```text
batch-imports/run-1/
  2025-26 Topps Basketball/
    set.csv
    parallel.csv
  2024-25 Panini Prizm Basketball/
    set.csv
    parallel.csv
```

In folder mode:
- parent folder = your batch
- each subfolder name = exact `setId`
- inside each set folder:
  - `set.csv`
  - `parallel.csv` (optional)

Preflight only (recommended first):
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
export SET_OPS_API_BASE_URL='https://collect.tenkings.co'
export SET_OPS_OPERATOR_KEY='<operator-key>'
pnpm set-ops:batch-import --folder batch-imports/run-1 --mode preflight
```

Commit after clean preflight:
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
export SET_OPS_API_BASE_URL='https://collect.tenkings.co'
export SET_OPS_OPERATOR_KEY='<operator-key>'
pnpm set-ops:batch-import --folder batch-imports/run-1 --mode commit
```

Advanced manifest example:
```csv
setId,setCsv,parallelCsv,setSourceUrl,parallelSourceUrl
2025-26 Topps Basketball,./imports/2025-26-topps-basketball-set.csv,./imports/2025-26-topps-basketball-parallel.csv,,
```

Manifest preflight:
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
export SET_OPS_API_BASE_URL='https://collect.tenkings.co'
export SET_OPS_OPERATOR_KEY='<operator-key>'
pnpm set-ops:batch-import --manifest scripts/set-ops/batch-manifest.example.csv --mode preflight
```

Manifest commit:
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
export SET_OPS_API_BASE_URL='https://collect.tenkings.co'
export SET_OPS_OPERATOR_KEY='<operator-key>'
pnpm set-ops:batch-import --manifest scripts/set-ops/batch-manifest.example.csv --mode commit
```

Notes:
- Script uses the same admin APIs as current Set Ops flow:
  - ingestion
  - draft build
  - approval
  - auto variant sync
- Folder mode is the simplest operator path and avoids hand-building a manifest.
- `set.csv`-only runs are supported.
- Later, when `parallel.csv` is ready for an existing set, rerun the CLI for that set with `--allow-existing-set`.
- `preflight` stops before approval and writes a JSON report with:
  - row counts
  - blocking-error counts
  - sample normalized draft rows
- Step 3 reference-image seeding is still optional and is not triggered by this CLI.
- Existing `/admin/set-ops-review` and `/admin/set-ops` remain the fallback and verification surfaces.

## Find Manifest Containing a Set (No ripgrep required)
```bash
cd /root/tenkings-backend
SET_ID='2020 Panini Stars &#038; Stripes USA Baseball Cards'
MANIFEST="$(grep -Rsl "\"setId\": \"$SET_ID\"" data/variants/checklists/checklist-batch.coverage.db-matched.chunk*.clean.json | head -n 1)"
echo "$MANIFEST"
```

If empty:
```bash
grep -R -n -F "$SET_ID" data/variants/checklists/checklist-batch.coverage.db-matched.chunk*.clean.json | head -n 20
```

## Run Set Seeding
```bash
cd /root/tenkings-backend
pnpm variants:sports:run --manifest "$MANIFEST" --set-id "$SET_ID" --seed-set-timeout-ms 1800000 --delay-ms 0 --no-gate --no-resume
```

## Build QA Gap Queue (Single Set)
```bash
cd /root/tenkings-backend
node scripts/variant-db/build-qa-gap-queue.js --set-id "$SET_ID" --ref-side front --min-refs 2 --out logs/seed-batch/manual-check/2020-panini-stars-038-stripes-usa-baseball-cards.qa-gap-queue.json
```

## Build QA Gap Queue (Broader)
```bash
cd /root/tenkings-backend
node scripts/variant-db/build-qa-gap-queue.js --ref-side front --min-refs 2 --limit 20000 --out logs/seed-batch/manual-check/next-set-gap-queue.json
```

## Validate Queue Result
- `queueCount: 0` means no remaining min-ref gaps per current queue rules
- If UI still looks wrong, investigate label normalization and API aggregation logic

## API Verification
```bash
curl -s "https://collect.tenkings.co/api/admin/variants?limit=20&gapOnly=false&minRefs=2"
curl -s "https://collect.tenkings.co/api/admin/variants/reference?setId=2020%20Panini%20Stars%20%26%20Stripes%20USA%20Baseball%20Cards&cardNumber=113&parallelId=USA%20Baseball&limit=50"
```

## SQL Diagnostics
```bash
psql "$DATABASE_URL" -c "select \"setId\", count(*) as refs from \"CardVariantReferenceImage\" where \"setId\" ilike '%Topps Basketball%' group by 1 order by 2 desc;"
```

```bash
psql "$DATABASE_URL" -c "select coalesce(nullif(\"cardNumber\",''), 'NULL') as card_number, count(*) as refs from \"CardVariantReferenceImage\" where \"setId\" = '2025-26 Topps Basketball' group by 1 order by 2 desc;"
```

```bash
psql "$DATABASE_URL" -c "select \"setId\", \"cardNumber\", \"parallelId\", count(*) from \"CardVariantReferenceImage\" where \"setId\" = '2020 Panini Stars &#038; Stripes USA Baseball Cards' group by 1,2,3 order by 4 desc limit 50;"
```

## Tooling Notes
- Prefer `rg` when available
- If missing, use `grep -Rsl` / `grep -R -n`
- Keep manifest commands on one line to avoid malformed shell expansion
