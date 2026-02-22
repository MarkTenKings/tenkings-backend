# Set Ops Handoff (Living)

## Current State
- Last reviewed: `2026-02-22` (docs-only sync; no runtime/deploy changes in this session)
- Branch: `chore/seed-timeout-hardening`
- Latest commits:
  - `b1166dd` fix(admin-qa): correct legacy ref fallback counts and clean QA labels/player display
  - `f6baadc` fix(admin-variants): count/show legacy ALL/NULL refs for card-scoped rows
  - `cb42d9b` fix(admin-refs): include legacy NULL/ALL refs when filtering by card number
  - `08a4ce2` fix(qa-queue): ignore legacy ALL card variants when card-level rows exist
  - `0e7fc5c` fix(variant-seed): ignore legacy ALL variants when card-level rows exist
  - `d096ce3` fix(variant-seed): card-number scoped checklist seeding and manifest variant sync
  - `8a14194` Phase 1+2 refs fix: player-aware labels/pairing + cardNumber-backed reference model
- Environments touched: workstation, droplet, production UI/API
- 2020 run status: full pass completed with `queueCount: 0`

## What Works
- Card-number-aware seeding for 2020 set.
- Legacy `ALL` variant exclusion in seeder and QA gap queue.
- Manifest flow syncs variants from checklist CSV before seeding.
- API fallback logic added for legacy `ALL/NULL` ref rows.

## Known Problems
- User still reports production QA table rendering dirty labels and repeated `5152` counts for 2020 rows.
- Need to confirm if issue is:
  1. stale deployment surface,
  2. lingering dirty DB values,
  3. remaining aggregation logic edge case.
- For some older sets (ex: prior 2025-26 runs), refs can lack visible player association (`playerSeed` empty).

## Root Cause Notes
- Historical data includes HTML entity encoded set names and JSON-like parallel strings.
- Historical reference rows include `cardNumber = ALL/NULL` buckets that can distort card-level table counts.
- UI display and API aggregation both need defensive normalization/fallback for legacy rows.

## Recent Changes (by commit)
- `b1166dd`
  - Files:
    - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
  - Why:
    - Reduce false inflated counts from legacy fallback usage.
    - Hide legacy ALL rows when specific rows exist.
    - Add cleaner display labels and visible player line in ref cards.
- `f6baadc`
  - File: `frontend/nextjs-app/pages/api/admin/variants/index.ts`
  - Why:
    - Include legacy `ALL/NULL` refs in card-scoped counts/previews.
- `cb42d9b`
  - File: `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
  - Why:
    - Include legacy `ALL/NULL` refs when filtering by card number.

## Data State Notes
- `2020 Panini Stars & Stripes USA Baseball Cards` was seeded successfully in latest run.
- User deferred direct DB delete/cleanup and prefers productized Set Admin delete/archive UI.
- Dirty rows for this set may still be present in production display.

## Deploy/Runtime Notes
- Droplet path: `/root/tenkings-backend`
- Workstation path: `/home/mark/tenkings/ten-kings-mystery-packs-clean`
- Infra commands from: `/root/tenkings-backend/infra`
- Typical service refresh used: `docker compose restart`
- Important: restart alone may not pick code changes if images are stale; rebuild/recreate may be required.

## Product Direction (Approved)
Build Set Ops UI flow with:
1. Ingestion queue for `parallel_db` and `player_worksheet`.
2. Human review/edit before approval.
3. Approval gate + validation.
4. Seed run and monitoring from production UI.
5. Set Admin actions (archive/delete with dry-run impact and typed confirm).

## Next Actions (Ordered)
1. Verify current production API payload for `/api/admin/variants` for 2020 set and confirm whether labels/counts are still dirty at API layer.
2. If API still dirty, add/execute normalization at read boundary and/or cleanup migration endpoint.
3. Begin Set Ops implementation from sprint checklist (P0 first).
4. Implement Set Admin page (archive/delete dry-run/confirm) before manual DB cleanup commands.

## Do Not Forget
- Rotate any exposed secrets (SERPAPI key exposure occurred in terminal/chat text).
- Never delete set data without explicit user confirmation.
- Log every deploy/restart/migration action in session log.

## Session Update (2026-02-22)
- Mandatory context/runbook/handoff docs were re-read per `AGENTS.md`.
- No deploy/restart/migration commands were run in this session.
- No runtime or DB evidence was newly collected; existing `Next Actions (Ordered)` remains unchanged.

## Implementation Progress (2026-02-22)
- P0-A Ticket 1 complete in code: Set Ops Prisma foundation models/enums + migration scaffold added.
- Added user-relations needed for actor attribution and Set Ops auditing.
- Local Prisma checks:
  - `generate`: pass
  - `schema validate`: pass (with dummy `DATABASE_URL`)
  - `@tenkings/database build`: currently failing due existing Prisma type/client mismatch in workspace environment.
- P0-A Ticket 2 complete in code: shared set normalizer + unit tests for legacy dirty labels/card numbers/duplicate key behavior.
- `pnpm --filter @tenkings/shared test`: pass.
- P0-A Ticket 3 complete in code: Set Admin APIs (`sets`, `archive`, `delete/dry-run`, `delete/confirm`) plus Set Ops RBAC helper and audit logging.
- Delete confirm now enforces typed phrase `DELETE <setId>` and performs transactional delete path with audit event.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` still fails under existing Prisma-client workspace linkage issue (broad pre-existing failure).
- P0-B Ticket 10 complete in code: `/admin/set-ops` baseline UI (list/search/status/counts) and `/admin` navigation link.
- Targeted lint check for new admin page files: pass.
- P0-B Ticket 11 complete in code: archive/unarchive row actions with API wiring and audit id feedback snippet in UI.
- Targeted lint check for archive UI update: pass.
- P0-B Ticket 12 complete in code: delete modal UI with dry-run impact preview + typed confirm enforcement + confirm action wiring.
- Targeted lint check for delete UI update: pass.
- P0-C Ticket 5 complete in code: ingestion queue API (`GET/POST /api/admin/set-ops/ingestion`) with raw payload/source/parser persistence and draft linkage.
- P0-C Ticket 6 complete in code: draft normalization/build APIs + immutable draft version save/load endpoints.
- P0-C Ticket 8 complete in code: approval endpoint plus seed job start/list/cancel/retry APIs with persisted progress/log/result payloads.
