# Set Ops Handoff (Living)

## Current State
- Last reviewed: `2026-02-22` (parser hardening + production handoff sync)
- Branch: `main`
- Latest commits:
  - `6e3f20c` fix(set-ops): harden checklist parsing and block html/noise rows
  - `a3a7aa9` fix(set-ops): add direct source-url import and state reset
  - `01a191f` fix(set-ops): filter discovery results to card-set sources
  - `f683c0c` fix(set-ops): harden discovery against blocked source search
  - `9b7ffcf` feat(set-ops): add source discovery import workflow
  - `fbe2c0b` feat(set-ops): add csv/json upload flow for ingestion queue
- Environments touched: workstation, repository main branch
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
- P0-C Ticket 7 complete in code: review workspace page (`/admin/set-ops-review`) with ingestion->build->edit->save->approve/reject flow.
- P0-C Ticket 9 complete in code: seed monitor UI on review workspace (start/list/refresh/cancel/retry controls and progress display).

## Permissions Hardening Update (2026-02-22)
- Added Set Ops permission introspection endpoint: `GET /api/admin/set-ops/access`.
- `/admin/set-ops` now displays resolved role capabilities and blocks archive/delete actions in UI when role requirements are not met.
- `/admin/set-ops-review` now blocks ingestion/draft actions without reviewer role and approval/seed actions without approver role.
- Server remains source of truth: API-level RBAC enforcement and denied-attempt audit events are unchanged and still mandatory.

## QA + Rollout Hardening Update (2026-02-22)
- Added shared delete confirmation helpers and tests to enforce consistent typed confirm behavior across UI/API.
- `DELETE <setId>` phrase generation now uses shared normalization logic to reduce dirty-label mismatch risk.
- Extended regression coverage for dirty 2020 entity-encoded set labels in delete-confirmation path.
- Updated `docs/runbooks/SET_OPS_RUNBOOK.md` with:
  - P0 UI workflow and API map
  - pre-release validation checklist
  - production rollout checklist emphasizing dry-run-first and explicit approval for destructive actions

## Vercel Build Hotfix (2026-02-22)
- Fixed `frontend/nextjs-app/pages/admin/set-ops.tsx` union narrowing bug that caused Vercel compile failure (`Property 'sets' does not exist on type 'LoadResponse'`).
- Load response parsing now narrows payload before reading `sets` and `total`.

## Vercel Build Hotfix 2 (2026-02-22)
- Fixed Prisma JSON typing errors on Set Ops draft version writes.
- Updated:
  - `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`
  - `frontend/nextjs-app/pages/api/admin/set-ops/drafts/version.ts`
- `dataJson`/`validationJson` and related JSON fields are now explicitly cast to `Prisma.InputJsonValue` for compatibility with strict build type checks.

## Vercel Build Hotfix 3 (2026-02-22)
- Updated `frontend/nextjs-app/pages/api/admin/set-ops/drafts/version.ts` to use `z.record(z.string(), z.unknown())` for compatibility with current Zod signature used in CI/Vercel.

## Vercel Build Hotfix 4 (2026-02-22)
- Fixed `rawPayload` typing in Set Ops ingestion create API for strict Prisma `InputJsonValue` compatibility.
- Added explicit Prisma JSON input casts on additional Set Ops write paths (`approval`, `delete confirm`, `seed jobs`, `seed retry`, `setOpsSeed` runtime updates) to reduce CI/Vercel strict typing regressions.

## Vercel Build Hotfix 5 (2026-02-22)
- Fixed seed cancel API status guard typing in `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs/[jobId]/cancel.ts` by using a typed status `Set` instead of array `.includes(...)`.

## UX Upload Improvement (2026-02-22)
- `/admin/set-ops-review` Ingestion Queue now supports direct CSV/JSON upload parsing in-browser.
- Workflow no longer requires manual raw JSON paste for normal use.
- Advanced raw JSON editor remains available behind toggle for edge/debug cases.
- Queue action now validates non-empty payload row count before creating ingestion jobs.

## Source Discovery + Import Update (2026-02-22)
- Added online source discovery endpoints and UI workflow for year/manufacturer/sport/query search.
- Added import-from-source flow that fetches URL content with retry/rate-limit and parses JSON/CSV/HTML-table rows into ingestion jobs.
- Added provenance tracking per ingestion job via `parseSummaryJson` (`sourceProvider`, `sourceQuery`, `sourceFetchMeta`).
- `/admin/set-ops-review` now supports:
  - source search
  - one-click import as `parallel_db` / `player_worksheet`
  - provider visibility in ingestion queue rows
  - no-paste CSV/JSON upload path for manual files

## Discovery Build Safety Fixes (2026-02-22)
- Corrected discovery API relative import paths to `lib/server/*` to ensure strict build/type resolution succeeds.
- Fixed strict nullability issue in HTML table parser (`selectedTable` after non-empty table guard).
- Re-ran targeted lint and verified new discovery-related compile errors were cleared (remaining broad TypeScript failures in this workstation are pre-existing Prisma client/schema linkage issues).

## Discovery 403 Fallback Hardening (2026-02-22)
- Discovery search now degrades gracefully when upstream web search returns `HTTP 403`:
  1. DuckDuckGo HTML search
  2. Bing RSS search fallback
  3. provider-search fallback links if both upstream providers fail
- Source import now returns explicit fallback guidance for blocked fetches (`401/403`): use Step 1 CSV/JSON upload.

## Discovery Relevance Hardening (2026-02-22)
- Added strict source relevance controls so discovery focuses on trading-card set/checklist sources.
- Added site-scoped discovery variants (`site:tcdb.com`, `site:cardboardconnection.com`, `site:beckett.com`, `site:sportscardspro.com`) before broad web search.
- Added preferred-domain scoring and blocked-domain filtering (ex: `weforum.org` and generic social/news domains).
- Added query-alignment filtering (manufacturer/year/sport + trading-card/checklist signal) before results are shown.

## Discovery UX + Import Guardrail Fixes (2026-02-22)
- Added Step 0 direct URL import controls so operators can paste exact checklist page URLs and import immediately as `parallel_db` or `player_worksheet`.
- Added discovery result row action `Use URL` to prefill direct import URL/edit box.
- Fixed stale set carryover between searches by re-initializing discovery set override from current search context.
- Added ingestion guardrail blocking search-results URLs (`SearchText`, `?s=`, `/search`) from import to prevent low-quality row extraction from search pages.
- Added queue selection reset action (`Clear Selected Job`) to avoid sticky workspace context while switching sets.

## Parser + Quality Hardening (2026-02-22)
- Commit: `6e3f20c` (`main`, `origin/main`).
- User-reported issue reproduced: CardboardConnection article URL import generated garbage rows containing GTM/script/nav/eBay HTML fragments.
- Root problems identified:
  - HTML parser selected the largest table on page instead of checklist-like table.
  - Field matching used loose `includes` behavior, causing malformed headers to map into card fields.
  - No ingestion quality gate to reject HTML/navigation noise rows.
  - Draft validator did not block markup/script payloads.
- Backend extraction changes:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
  - Added HTML sanitization and content-scope selection before table parsing.
  - Added table scoring heuristics (checklist/card signals positive; nav/eBay/ad/script signals negative).
  - Tightened field-key matching with normalized key rules and unsafe-field rejection.
  - Removed overly broad `name` fallback from parallel/player mapping.
  - Added markdown negotiation support (`Accept: text/markdown`) and markdown table/list parser path.
  - Added checklist-link fallback crawl (follow checklist-like links from article pages, same domain group, depth-limited).
  - Added row-quality filtering before job creation and hard-fail behavior when output is mostly/noise-only.
  - Added parse summary metadata for dropped rows and rejection reasons.
- Draft validation hardening:
  - `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
  - Added blocking validation when `cardNumber`, `parallel`, or `playerSeed` appear to contain HTML/script/navigation payloads.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts` passed.
  - Repo-wide TypeScript still fails in this workspace from existing Prisma/client mismatch unrelated to these two files.
- Deployment status:
  - Commit is present on `origin/main`.
  - No deploy/restart/migration evidence was captured in this coding session after push.

## What To Test In Production (Current Step)
1. In `/admin/set-ops-review`, import this exact URL as `parallel_db`:
   - `https://www.cardboardconnection.com/2024-25-topps-chrome-basketball-review-and-checklist`
2. Expected:
   - No rows containing GTM/script/nav/eBay HTML junk.
   - If checklist rows cannot be parsed, import should fail with clear message instead of creating garbage draft rows.
3. Verify queue row `parseSummaryJson` (if exposed in UI/API) includes:
   - `rowCount`
   - `droppedRowCount`
   - `rejectionReasons`
4. Repeat with at least one known-good structured checklist URL to confirm legitimate rows still import.
5. Build a draft version and confirm blocking errors now appear for any row that still contains markup-like payloads.
