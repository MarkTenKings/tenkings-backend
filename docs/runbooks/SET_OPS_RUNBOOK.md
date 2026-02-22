# Set Ops Runbook

last_verified_at: 2026-02-21
owner: Mark

## Rules
- Never trust UI-only symptoms; validate via API + DB
- Log every run in `docs/handoffs/SESSION_LOG.md`
- No destructive production delete confirms without explicit approval

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
