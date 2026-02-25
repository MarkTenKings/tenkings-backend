# Set Ops Handoff (Living)

## Current State
- Last reviewed: `2026-02-23` (rookie-parallel guard + seed/read fallback alignment)
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

## Session Update (2026-02-23)
- Re-read mandatory startup docs per `AGENTS.md`:
  - `docs/context/MASTER_PRODUCT_CONTEXT.md`
  - `docs/runbooks/DEPLOY_RUNBOOK.md`
  - `docs/runbooks/SET_OPS_RUNBOOK.md`
  - `docs/HANDOFF_SET_OPS.md`
  - `docs/handoffs/SESSION_LOG.md`
- Confirmed active branch remains `main` (`git status -sb` showed `## main...origin/main` before doc updates).
- No code/runtime changes, deploys, restarts, migrations, or DB operations were executed.
- Existing `Next Actions (Ordered)` remains unchanged.

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

## PDF Checklist Support + Import Recovery (2026-02-22)
- Root issue from production QA:
  - Direct PDF checklist URLs were treated as generic text/HTML and failed with "No checklist rows were detected..."
  - Step 1 upload accepted only CSV/JSON, so official checklist PDFs could not be used as fallback.
  - Some source pages linked to off-domain checklist PDFs (ex: Topps page -> `cdn.shopify.com`), but checklist-link follow logic was same-domain only and skipped those links.
- Backend changes:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
  - Added PDF content negotiation (`Accept: application/pdf,...`) and PDF parsing path for source imports.
  - Added text-stream PDF extraction + checklist-line parser (card number + player + section/parallel inference).
  - Added HTML checklist-text parser fallback (for article pages that are not structured `<table>` checklists).
  - Relaxed checklist-link follower to allow off-domain PDF checklist links.
  - Added reusable upload parser export: `parseUploadedSourceFile(...)` for CSV/JSON/PDF.
- API/UI changes:
  - Added API route: `frontend/nextjs-app/pages/api/admin/set-ops/discovery/parse-upload.ts`
    - reviewer-role protected
    - raw binary upload parsing for PDF/CSV/JSON files
  - Updated file upload UX:
    - `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
    - Upload accept now includes `.pdf`
    - PDF file uploads are parsed server-side and loaded directly into ingestion raw payload.
  - Updated runbook fallback wording:
    - `docs/runbooks/SET_OPS_RUNBOOK.md` now documents CSV/JSON/PDF fallback.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx` passed.
  - Workspace-wide TypeScript still fails from existing Prisma/client mismatch unrelated to these files.

## What To Test In Production (Current Step)
1. In `/admin/set-ops-review`, import this article URL as `parallel_db`:
   - `https://www.cardboardconnection.com/2024-25-topps-chrome-basketball-review-and-checklist`
2. Expected for article import:
   - no GTM/script/nav/eBay HTML junk rows
   - either meaningful checklist rows or clear parse failure (no garbage draft rows).
3. Import this direct PDF URL as `parallel_db`:
   - `https://cdn.shopify.com/s/files/1/0662/9749/5709/files/NBA2402-24TCBKRetailChecklist.pdf`
4. Expected for PDF URL import:
   - ingestion job is created with non-zero row count
   - parser metadata indicates PDF parser path in `parseSummaryJson`.
5. Upload the same PDF through Step 1 file picker.
6. Expected for PDF file upload:
   - UI accepts `.pdf`
   - raw payload is populated with parsed rows
   - no manual JSON editing required.
7. Build a draft version and confirm blocking validation still rejects markup-like noise if any slips through.

## PDF Parser Hardening + Combined Import Mode (2026-02-22)
- User-reported follow-up issue:
  - Topps PDF direct URL import returned `Source parser returned zero rows.`
  - Same PDF uploaded via Step 1 returned `No checklist rows were detected from this PDF...`.
  - User requested combined import mode for sources that contain both parallel + player checklist content.
- Root cause:
  - URL import and PDF upload both depended on the same low-level PDF extractor path.
  - That extractor failed on some font-encoded PDFs (especially when text required ToUnicode CMap translation), yielding zero parsed checklist rows.
- Backend parser changes:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
  - Added PDF ToUnicode CMap parsing (`bfchar` / `bfrange`) and decode context support.
  - Added mapped hex/literal decoding in PDF text stream parsing.
  - Added loose text fragment fallback extraction from PDF streams when structured extraction yields too few lines.
  - Kept existing PDF->checklist row normalization path; improved extraction quality feeding it.
- UI workflow changes:
  - `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
  - Added combined mode (`COMBINED`) for Step 1 Ingestion Queue dataset selection:
    - queues both `PARALLEL_DB` and `PLAYER_WORKSHEET` jobs from the same payload in one action.
  - Added third direct URL action in Step 0:
    - `Import URL as combined`.
  - Added third discovered source row action:
    - `Import combined`.
  - Added clearer queue button label:
    - `Queue parallel_db + player_worksheet` when combined mode is selected.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/discovery/parse-upload.ts` passed.
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` still fails with existing repo-wide Prisma/client mismatch errors (pre-existing; unrelated to these file edits).

## Production Test Focus (Latest Build)
1. In `/admin/set-ops-review`, paste Topps PDF URL and run:
   - `Import URL as combined`
2. Confirm:
   - two ingestion jobs are queued: one `PARALLEL_DB`, one `PLAYER_WORKSHEET`.
   - row counts are non-zero.
3. Upload the same PDF file via Step 1 and choose dataset mode:
   - `combined (parallel + player)`
   - click queue button.
4. Confirm:
   - two ingestion jobs are queued from upload payload.
   - no zero-row parser error appears for that PDF.

## Topps PDF Parser Surgery (2026-02-22, Follow-up)
- Context:
  - After shipping combined mode + CMap decode, user still saw zero-row failures in production.
  - User provided full copied Topps checklist text confirming the PDF is highly structured (card number, player, team, rookie).
- Additional root problems fixed:
  - Parser still assumed too much row-per-line structure; real PDF extraction can merge/split rows and section text.
  - Section-header detection could over-trigger on uppercase content and break record grouping.
  - Some PDFs use filter chains (ex: `ASCII85Decode` + `FlateDecode`), while parser only handled `FlateDecode`.
- Backend changes:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
  - Replaced checklist row extraction with tokenized record parsing per section block:
    - detects card IDs like `1`, `SI-1`, `DNA-1`, `CA-AC`, `FSA-AB`
    - handles merged text fragments and dedupes parsed records
    - strips trailing team + `Rookie` marker to derive clean `playerSeed`
  - Tightened section-header detection:
    - uppercase short lines are accepted as sections only when they match section-noise vocabulary or section keywords
    - prevents false section splits from uppercase player/content lines
  - Added PDF filter-chain decode support:
    - new `ASCII85Decode` stream decoding
    - generic filter application pipeline (`ASCII85Decode`, `FlateDecode`) before text extraction
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/discovery/parse-upload.ts` passed.
  - Local smoke tests (mocked deps) against Topps-style checklist text produced correct rows for:
    - base cards
    - insert IDs (`SI-*`, `RR-*`, `DNA-*`)
    - autograph IDs (`CA-*`, `FSA-*`)
- Environment note:
  - Live Shopify PDF URL fetch could not be tested from this sandbox due DNS/network restriction (`Could not resolve host: cdn.shopify.com`).
  - End-to-end production validation remains required.
- Current step:
  - User committed on workstation and is waiting for Vercel build completion, then running live Topps PDF URL + upload tests.

## Topps PDF Parser Surgery (2026-02-22, Follow-up #2)
- New production feedback:
  - parser returned only ~46 rows, with wrong card ID alignment and heavily fragmented player names (`LaMe l o`, `Mar cus`, etc.).
  - many insert IDs were split and misread (`SI - 6` parsed as `6`, `PB - 1` parsed as `1`).
- Additional root causes fixed:
  - `TJ` array text reconstruction inserted artificial spacing between glyph chunks.
  - split card IDs across token boundaries/newlines were not being reassembled before row detection.
  - leaked section/id fragments (`Base Set`, trailing `SI -`) polluted `playerSeed`.
- Code changes:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
  - `parsePdfArrayString(...)` now concatenates decoded array text directly (instead of chunk-join with forced spaces), with kerning-based soft-space fallback on large negative spacing values.
  - Added token-level ID normalization for patterns like:
    - `PB- 1` -> `PB-1`
    - `PB - 1` -> `PB-1`
    - `R R - 26` -> `RR-26`
    - `CA - AC` -> `CA-AC`
  - Tightened card-id detector to avoid one-letter false positives (`S-A`-style noise).
  - Added player-seed cleanup for leaked header/id fragments and preserved insert parallel fallback from card prefix map (`FS`, `PB`, `RR`, `CA`, `FSA`, etc.) when section detection falls back to base.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts` passed.
  - Local synthetic noisy-input smoke test confirms:
    - card IDs are now reconstructed (`SI-6`, `PB-1`, `RR-26`, `CA-AC`, `FSA-AB`)
    - insert rows are assigned to the correct parallel family via prefix fallback.
- Remaining uncertainty:
  - exact live Topps PDF behavior still needs production validation because this sandbox cannot fetch Shopify CDN PDF directly.

## Topps PDF Parser Surgery (2026-02-22, Follow-up #3)
- New production feedback after follow-up #2:
  - major progress (many more valid rows), but `Rookie` was still appearing in `Parallel` for portions of inserts.
  - reviewer UI appeared to stop at row `120` even when parser loaded `204` rows, causing confusion about data loss.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - blocked standalone `Rookie` / `RC` from being treated as section headers in checklist parsing.
  - `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
    - removed legacy `name` fallback from parallel extraction to avoid accidental field cross-mapping.
    - removed default per-row `listingId missing` warning for checklist imports (listing IDs are optional and this warning created noisy false alarms).
  - `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
    - removed hardcoded UI render cap (`slice(0, 120)`) so full draft row set is visible/editable.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts --file pages/admin/set-ops-review.tsx` passed.

## Topps PDF Parser Surgery (2026-02-22, Follow-up #4)
- New production feedback:
  - parse quality now near-perfect but one trailing row was still missing in one run (`FSA-VW Victor Wembanyama ...`), yielding 203 vs expected 204.
  - operators requested manual row add/remove controls in draft review to patch rare parser misses quickly.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - added trailing pending-text flush in PDF content-stream extraction (`extractLinesFromPdfContentStream`) so end-of-stream text fragments are not dropped.
    - added fused card-id split normalization (`FSA-VWVictor` -> `FSA-VW Victor`) to improve final-row detection.
  - `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
    - added `Add Row` action in draft workspace.
    - added per-row `Delete` action.
    - table now supports manual correction workflow without external JSON edits.
  - `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
    - skips effectively empty rows during normalization (blank manual rows won't create blocking errors).
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts --file pages/admin/set-ops-review.tsx` passed.

## Variant Ref Seeding UX (2026-02-22, Follow-up #5)
- New production feedback:
  - Operators can complete set-ops seeding but image seeding UX on `/admin/variants` still required manual Set ID / Parallel ID typing, which is error-prone.
  - Requested one-click flow: choose recent set and seed refs for all variants in that set.
- Fixes shipped:
  - Added new admin API endpoint:
    - `frontend/nextjs-app/pages/api/admin/variants/sets.ts`
    - returns recent seeded set IDs (from `SetSeedJob`) with variant counts and latest seed timestamp/status for dropdown population.
  - Updated image seed API:
    - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - skips duplicate `rawImageUrl` rows for same set/card/parallel before insert.
  - Updated `/admin/variants` UX:
    - `frontend/nextjs-app/pages/admin/variants.tsx`
    - recent-set dropdown at top of **Seed Images (SerpApi)** section
    - one-click **Seed Entire Set** action that loops all variants for selected set and seeds refs per variant automatically
    - live set-level progress stats (completed/total/inserted/skipped/failed)
    - existing manual **Seed Single Parallel** path remains available.

## Variant Ref UX Fixes (2026-02-22, Follow-up #6)
- New production feedback:
  - `/admin/variants` "Reference Images" table appeared to show only one parallel (e.g., repeated `SUDDEN IMPACT`) after full-set seeding.
  - `/admin/variant-ref-qa` variant list needed a player column for easier QA decisions.
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - "Load References" now uses selected `Set ID` filter.
    - table now dedupes to one row per variant key (`setId + cardNumber + parallelId`) instead of rendering raw newest image rows.
    - added table summary: "Showing X variants from Y image rows".
    - table includes card number + player display metadata.
  - `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
    - increased max `limit` from `500` to `5000` for larger set-level loads.
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - exposes `playerLabel` on variant rows by deriving from latest approved set-ops draft rows (fallback to reference `playerSeed` when available).
  - `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
    - added `Player` column in variant table.

## Variant Ref QA Card UX (2026-02-22, Follow-up #7)
- New production feedback:
  - In `/admin/variant-ref-qa`, per-reference detail cards showed `Player: —` for seeded refs.
  - Card metadata text (Label/Card#/Player) needed higher visual prominence.
  - Preview image frame cropped portrait cards (`object-cover`) and needed portrait-safe layout.
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
    - per-reference `Player` now resolves from:
      1) ref `playerSeed` when present
      2) selected variant `playerLabel` fallback
    - replacement upload now persists `cardNumber` and `playerSeed` from selected variant where available.
    - Label/Card#/Player lines increased to larger bold text for easier QA scanning.
    - preview frame switched to portrait-friendly container (`aspect-[9/16]` + `object-contain`) to avoid top/bottom clipping.

## Variant Ref QA Workflow UX (2026-02-22, Follow-up #8)
- New production feedback:
  - operators wanted a set-first queue experience (recent sets visible first) instead of starting from a blank variant table.
  - active-row highlight in QA table was too broad and highlighted many rows at once.
  - QA completion workflow needed explicit per-variant done tracking so reviewed rows sink to the bottom.
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
    - added seeded-set discovery controls (set search + active set selector + quick set chips).
    - variant queue now defaults to a selected set and shows queue summary (`remaining / done / total`).
    - fixed active-row highlight to match full key (`setId + cardNumber + parallelId`) rather than set+parallel only.
    - changed default `Gap Queue` filter to OFF and relabeled it (`Gap Queue (< Min Refs)`).
    - added QA actions:
      - `Mark Selected Done` (sets selected refs to `qaStatus=keep`)
      - `Reopen Selected` (sets selected refs back to `qaStatus=pending`)
    - selected-variant header now includes player label for better context.
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - supports `setId` filtering for targeted queue loads.
    - computes `qaDoneCount` per variant (`qaStatus=keep` or `ownedStatus=owned`) and returns it in API payload.
    - sorts queue so unfinished variants stay at top; done variants sink to bottom.

## Vercel Build Stabilization (2026-02-22, Follow-up #9)
- New production feedback:
  - Vercel build failed in `/api/admin/variants/index.ts` due Prisma TypeScript inference mismatch on `qaDoneCount` query path.
  - errors included `groupBy` generic mismatch and then `findMany` inferred as `{}` rows on Vercel TS checker.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - replaced fragile `groupBy`-typed assignment path for done rows with a safer `findMany + distinct` approach.
    - switched `qaDoneRows` staging to `any[]` and normalized fields via safe extraction before map keying.
    - preserved behavior (`qaStatus=keep` OR `ownedStatus=owned` marks variant as done for queue ordering).
- Result:
  - build compiles successfully on Vercel after this patch while preserving QA queue behavior.

## Ref Image Seeding Accuracy (2026-02-22, Follow-up #10)
- New production feedback:
  - seeded refs contained many non-card/box images and wrong-player cards.
  - source links were often not direct eBay item pages.
- Root cause found:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts` was using `engine: "google_images"` (SerpApi image search), not eBay engine.
  - image-search links (`images_results.link`) frequently point to arbitrary pages, not eBay item URLs.
  - set-level query builder did not include player context, so star-player drift was common.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - switched to SerpApi `engine: "ebay"` with `_nkw` query.
    - enforces canonical eBay item URL extraction (`https://www.ebay.com/itm/{id}`).
    - extracts/stores `sourceListingId` + `listingTitle` + `playerSeed`.
    - ranks listings by relevance (player/set/parallel/card number) and penalizes box/break/lot terms.
    - dedupes by listing ID and image URL.
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - set-level auto query now includes player label + anti-noise terms (`-box -blaster -hobby -case -break -pack -lot`).
    - sends `playerSeed` per variant to seed API for ranking.
- Expected result:
  - source links resolve to actual eBay listing pages.
  - fewer box/lot hits and fewer wrong-player images during bulk set seeding.

## Set-Level Ref Seeding Reliability + Full Target Count (2026-02-22, Follow-up #11)
- New production feedback:
  - set-level ref seed reported `199/199` with one failure; operator expects full checklist cardinality (204) when source draft has 204 rows.
  - needed better visibility on which rows fail during bulk set seed.
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - bulk set seeding now pulls targets from latest set-ops draft rows first (`/api/admin/set-ops/drafts?setId=...`), so duplicate card+parallel rows with different players are preserved in target count.
    - fallback to `/api/admin/variants` remains for sets without draft rows.
    - per-target retry (2 attempts) added for transient seed failures.
    - error message now includes sample failed targets and reasons.
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - SerpApi request retry loop added (up to 3 attempts) for rate-limit/transient failures.
    - returns clearer upstream error messages on final failure.
- Expected result:
  - set-level progress reflects full checklist target count when draft rows are available (e.g., 204).
  - fewer one-off failed targets from transient SerpApi/network responses.

## Ref Reset + Source Visibility (2026-02-22, Follow-up #12)
- New production feedback:
  - operators still saw legacy Amazon/Walmart rows in `/admin/variant-ref-qa` and could not tell if they were looking at old data or new eBay-only seeds.
  - no one-click set-level reset existed to purge bad external refs before reseeding.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
    - added set-level delete mode:
      - `DELETE /api/admin/variants/reference?setId=...`
      - optional `parallelId`, `cardNumber`, `includeOwned=true`
      - default behavior deletes external refs only (`ownedStatus != owned`) to protect manually promoted refs.
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - added `Clear External Refs (Set)` button in Seed section.
    - set-level seeding now prefers `PLAYER_WORKSHEET` draft rows first, then `PARALLEL_DB`, then latest draft, then variant fallback.
    - reference table now includes `Source` host to spot non-eBay rows quickly.
  - `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
    - added `Clear External Refs (Set)` action on QA page for active set.
    - added inline tip to purge legacy rows once after eBay-only switch, then reseed.
    - reference cards now display `Source Host` with visual eBay/non-eBay indicator.
- Operator workflow now:
  1. select set
  2. clear external refs for that set
  3. reseed entire set
  4. QA refs (source host should trend `ebay.com`)

## Silent Zero-Insert Guard (2026-02-22, Follow-up #13)
- New production signal:
  - set run showed `204/204` with `inserted 0 · skipped 0 · failed 0`.
  - this indicates all calls returned no rows without surfacing upstream error.
- Root cause:
  - seed endpoint accepted SerpApi 200 payloads with top-level `error/message` as success and proceeded with empty listings.
  - eBay payload field shape variance could also miss URL/image fields and collapse rows to zero.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - treat top-level SerpApi `error/message/errors` as real failures (with retry for retryable cases).
    - broaden listing extraction keys (`results`, `items_results`) and URL/image field fallbacks.
- Expected result:
  - bad key/quota/account states now appear as explicit failed variants instead of silent `0 inserted`.
  - more eBay payload variants map into usable listing/image rows.

## eBay Query Relaxation + No-Result Soft Handling (2026-02-22, Follow-up #14)
- New production signal:
  - set run returned `204 failed` with repeated SerpApi message: `eBay hasn't returned any results for this query.`
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - relaxed auto-query generation:
      - strips `Retail` token from set label
      - removes negative tokens (`-box`, `-blaster`, etc.) that may over-constrain eBay queries.
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - treats top-level “no results” response as soft skip (not hard failure) so set runs continue cleanly.
    - returns `{ inserted: 0, skipped: 1 }` for no-result queries to improve set-level visibility.
- Expected result:
  - fewer all-fail runs from over-constrained query syntax.
  - no-result variants show as skipped, while real account/key/quota issues still surface as failures.

## Variant Gap Coverage + Page Persistence UX (2026-02-22, Follow-up #15)
- New production signal:
  - seeding quality improved significantly, but coverage stopped around ~163/204 with many insert/autograph rows at zero refs.
  - leaving `/admin/variants` made context appear cleared and interrupted operator confidence.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - added query fallback ladder per target:
      - base query
      - player+set+card+parallel variants
      - player+set+parallel
      - set+card+parallel
    - card tokens now try multiple forms (`#FS-14`, `FS-14`, `FS14`, `FS 14`).
    - player token normalization now uses primary player for slash rows (`A / B` => `A`) to improve dual-player insert matching.
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - query builder now uses normalized primary player label.
    - persists last active set ID in browser storage and auto-reloads references for that set on return.
    - adds unload warning while set-seed run is in-flight.
    - adds explicit UI note: set seeding is browser-driven and tab should stay open until complete.
- Expected result:
  - better hit-rate on SI/FS/RR/FSA style inserts and dual-player rows.
  - less operator confusion after navigation, with set context + refs reloaded automatically.

## Seed-Key Normalization Alignment (2026-02-22, Follow-up #16)
- New production signal:
  - set run reported relatively low skips, but QA queue still showed many `Photos=0` variants.
- Root cause identified:
  - seed writes used raw `cardNumber/parallel/player` strings from draft targets; some rows can include spacing variants (`FS - 14`, etc.).
  - variants API keys by normalized variant values, so non-normalized stored refs can miss join/count and appear as zero-photo.
- Fix shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - now normalizes before write using shared normalizers:
      - `normalizeSetLabel`
      - `normalizeCardNumber` (fallback `ALL`)
      - `normalizeParallelLabel`
      - `normalizePlayerSeed`
- Expected result:
  - reference rows align with variant keys more reliably.
  - QA `Photos` count should match seed inserts after clearing external refs and reseeding.

## Variant Ref Key-Match Hardening (2026-02-23, Follow-up #17)
- New production signal:
  - production set run reported:
    - `Seeded all targets for 2023-24 Topps Chrome Basketball Retail: 204 processed, inserted 1813, skipped 23. Source: set-ops player worksheet rows.`
  - `/admin/variant-ref-qa` still showed many insert/autograph rows with `Photos=0` (SI/FS/RR/FSA/DNA style rows).
- Root-cause class:
  - read-side matching in variant/ref APIs was still exact-string based for `setId + cardNumber + parallelId`.
  - seed writes were normalized/canonicalized, so any dirty/alias variant keys (whitespace/entity/alias like `SI`) could miss joins and appear as zero-photo.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - canonicalizes parallel aliases on write (`SI` -> `SUDDEN IMPACT`, `FS` -> `FILM STUDY`, `RR` -> `ROUNDBALL ROYALTY`, `FSA` -> `FUTURE STARS AUTOGRAPHS`, etc.).
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - keying now normalizes set/card/parallel before join/count.
    - count/done/preview fetch paths now query across raw + normalized + alias candidates to catch legacy key drift.
  - `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
    - GET filter path now resolves set/parallel/card candidate keys (raw/normalized/alias) to return matching refs for QA drill-down.
    - set-level DELETE path now uses normalized/alias-aware filters so purge/reseed operations hit both legacy and canonical key variants.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/index.ts --file pages/api/admin/variants/reference/index.ts --file pages/api/admin/variants/reference/seed.ts` passed.
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## Rookie Parallel Regression Guard + Orphan-Key Recovery (2026-02-23, Follow-up #18)
- New production signal after reseed:
  - set run reported `204 processed, inserted 1815, skipped 21` with player-worksheet source.
  - `/admin/variants` reference table showed many rows with `parallelId = Rookie` on insert/autograph card numbers (`FS-*`, `SI-*`, `RR-*`, `FSA-*`, `DNA-*`).
  - `/admin/variant-ref-qa` still showed those same variants at `Photos=0`.
- Root cause identified:
  - seed target extraction trusted draft `row.parallel` values directly; `Rookie` marker values were treated as actual parallel IDs.
  - those writes created orphan ref keys (`card + Rookie`) that do not align with canonical variant parallels (`FILM STUDY`, `SUDDEN IMPACT`, etc.).
  - two pages surfaced different views:
    - `/admin/variants` shows raw reference rows by set.
    - `/admin/variant-ref-qa` counts by variant-key join.
- Fixes shipped:
  - `frontend/nextjs-app/pages/admin/variants.tsx`
    - seed target extraction now canonicalizes parallel IDs and ignores `Rookie/RC` markers.
    - when parallel is missing/noise (`Rookie`), it infers canonical parallel from card prefix (`FS/SI/RR/FSA/CA/PB/DNA`).
  - `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
    - seed write path now refuses `Rookie/RC` as final parallel and infers canonical parallel from card prefix before insert.
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - count/join paths now include controlled `Rookie/RC` compatibility candidates (when card-prefix implies known insert family) so existing bad rows can still be matched/read until reseeded.
    - fixed count aggregation to sum duplicate canonicalized key buckets instead of overwrite.
  - `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
    - GET/DELETE filters now include same card-aware `Rookie/RC` compatibility matching.
    - response rows normalize display parallel to canonical value for consistency.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variants.tsx --file pages/api/admin/variants/index.ts --file pages/api/admin/variants/reference/index.ts --file pages/api/admin/variants/reference/seed.ts` passed.
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## Production Validation Milestone (2026-02-23)
- User reported post-deploy production reseed status for `2023-24 Topps Chrome Basketball Retail`:
  - `Set progress: 204/204 variants · inserted 1816 · skipped 20 · failed 0`
- Manual table checks from user-provided production payloads:
  - `/admin/variants` set reference table contained `199` variant rows for this set.
  - `/admin/variant-ref-qa` table contained `199` variant rows for this set.
  - No `Photos=0` rows remained in provided QA output (first clean run observed by user).
- Interpretation:
  - Canonical key alignment between seed writes and QA/read joins appears restored.
  - Remaining `skipped` values can occur even when all variant rows have images (per-target listing/query limits and soft-skip behavior), so `skipped > 0` is not by itself a QA gap signal.
- Next operator goal:
  - User plans to reset `2025-26 Topps Basketball` and re-ingest from scratch via Set Ops flow.

## PDF Ingestion Header/Team Drift Hardening (2026-02-23, Follow-up #19)
- New production signal on fresh `2025-26 Topps Basketball` ingest from PDF:
  - draft rows in `/admin/set-ops-review` showed repeated `parallel = Sacramento Kings`.
  - card ids and player seeds were corrupted in some rows (`76ERS` as card number, split `Kareem / ABDUL-JABBAR` rows, trailing section labels in player field).
- Root-cause class:
  - PDF text parser could classify team-only lines as section headers.
  - card-id detector was overly permissive (`76ERS`-style tokens treated as card ids).
  - team suffix trimming expected city-only tails and missed full team names (`Sacramento Kings`, `Los Angeles Lakers`, etc.).
  - label validation allowed low-signal symbol garbage to pass.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - expanded checklist heading noise vocabulary for this checklist style (`ARRIVALS`, `FIRST`, `FINISHERS`, `HEADLINERS`, `MUSE`, `AURA`, `MASTERS`, `ELECTRIFYING`, `COLOSSAL`, etc.).
    - replaced team suffix matcher with full NBA team-name matching (including OCR variants like `Philadelpia`, `LosAngeles`, `Trailblazers`).
    - added guard: known team-name lines cannot be treated as section headers.
    - tightened card-id recognition to reject team-like numeric tokens (`76ERS`) and long letter-pair tokens (`ABDUL-JABBAR`-style false ids).
    - strengthened player-label validation to reject low-letter/high-symbol OCR garbage.
    - added ingest quality gate rejecting `parallel` values that look like team names (`parallel_looks_like_team_name`).
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts` passed.
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## Approved-Only Variant Flow + Set Ops Bulk Delete UX (2026-02-23, Follow-up #20)
- New operator requirement:
  - In Add Cards -> OCR/LLM/variant flow, only approved sets should be considered.
  - Need fast cleanup UX to delete many old/test sets from production without one-by-one modals.
- Root-cause class:
  - Add Cards product-line + variant option fetches used broad `/api/admin/variants?q=...` queries over the full variant corpus.
  - OCR auto variant matcher accepted fuzzy set candidates from `CardVariant` without an approval/archival gate.
  - `/admin/set-ops` supported only single-set delete at a time.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/index.ts`
    - added `approvedOnly=true` query support on GET.
    - when enabled, variants are restricted to `SetDraft.status = APPROVED` and `archivedAt IS NULL`.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - Add Cards variant/product-line lookups now call `/api/admin/variants` with `approvedOnly=true`.
  - `frontend/nextjs-app/lib/server/variantMatcher.ts`
    - matcher now filters resolved set candidates through approved, non-archived set drafts before matching.
    - if none qualify, returns explicit `No approved variant set found...`.
  - `frontend/nextjs-app/pages/admin/set-ops.tsx`
    - added multi-select table checkboxes.
    - added bulk action bar with `Delete Selected`.
    - bulk flow runs per-set dry-runs, shows aggregate confirm prompt, requires typed batch phrase, then executes safe per-set confirm deletes.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/index.ts --file lib/server/variantMatcher.ts --file pages/admin/uploads.tsx --file pages/admin/set-ops.tsx`
  - result: pass (existing `uploads.tsx` no-img warnings unchanged).
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## Set Delete Encoded-ID Fix (2026-02-23, Follow-up #21)
- New production signal:
  - a subset of old sets would not delete from `/admin/set-ops` even though most sets deleted normally.
  - non-deleting rows had HTML-entity encoded set IDs (`&#038;`, `&#8211;`, `&#8217;`) in table output.
- Root cause:
  - delete dry-run/confirm paths normalized `setId` first and then performed exact `setId` deletes.
  - encoded stored IDs did not equal the normalized label, so impact/delete missed those rows.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOps.ts`
    - `computeSetDeleteImpact` now computes counts across both raw + normalized `setId` candidates.
  - `frontend/nextjs-app/pages/api/admin/set-ops/delete/dry-run.ts`
    - uses raw payload `setId` for impact; audits canonical `setId` for readability.
  - `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
    - computes/deletes across both raw + normalized `setId` candidates.
    - keeps typed confirmation phrase canonicalized but deletion target candidate-aware.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/delete/confirm.ts --file pages/api/admin/set-ops/delete/dry-run.ts --file lib/server/setOps.ts` passed.
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## Session Update (2026-02-23, Docs Sync)
- Re-read mandatory startup docs per `AGENTS.md`:
  - `docs/context/MASTER_PRODUCT_CONTEXT.md`
  - `docs/runbooks/DEPLOY_RUNBOOK.md`
  - `docs/runbooks/SET_OPS_RUNBOOK.md`
  - `docs/HANDOFF_SET_OPS.md`
  - `docs/handoffs/SESSION_LOG.md`
- Confirmed git state at check time:
  - branch `main` tracking `origin/main`
  - working tree already had pre-existing local modifications in:
    - `docs/HANDOFF_SET_OPS.md`
    - `docs/handoffs/SESSION_LOG.md`
    - `frontend/nextjs-app/lib/server/setOps.ts`
    - `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
    - `frontend/nextjs-app/pages/api/admin/set-ops/delete/dry-run.ts`
- No code/runtime changes, deploys, restarts, migrations, tests, or DB operations were executed in this session.
- Existing `Next Actions (Ordered)` remain unchanged.

## Uploads/KingsReview Hardening (2026-02-23, Follow-up #22)
- Scope completed in this coding session:
  - backend valuation enforcement on inventory-ready transition
  - OCR teach-memory feedback loop using `OcrFeedbackEvent`
  - per-photo OCR state + text persistence in OCR audit payload
  - dedicated approved-set variant options API for Add Cards
  - uploads-side variant explainability rendering
  - KingsReview autosave expansion (query + variant notes + set/card manual context)
- Files changed:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - `frontend/nextjs-app/pages/api/admin/variants/options.ts`
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
  - `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- Behavioral notes:
  - API now blocks transition to `INVENTORY_READY_FOR_SALE` without positive `valuationMinor` even if caller bypasses UI.
  - OCR audit now includes `photoOcr` (`FRONT/BACK/TILT`) with per-photo status + OCR text, and `readiness` summary.
  - OCR suggestion now applies immediate memory hints from prior human-corrected feedback rows and records applied hints in `audit.memory`.
  - OCR pipeline now stores variant matcher evidence in audit (`audit.variantMatch`) for UI explainability.
  - Add Cards variant choices now come from `/api/admin/variants/options` (approved, non-archived sets) scoped by year/manufacturer/sport with grouped set/insert/parallel options.
  - KingsReview now autosaves reviewer draft context (query, variant notes, variant set/card context) and shows saved state indicator.
- Validation run:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId].ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/variants/options.ts --file pages/admin/uploads.tsx --file pages/admin/kingsreview.tsx`
  - Result: pass with existing warnings only (`no-img-element`, pre-existing hook-deps warning in KingsReview).
- Deploy/runtime status:
  - No deploy/restart/migration executed in this coding session.

## Build Fix Follow-up (2026-02-23, Vercel compile unblock)
- Context:
  - Vercel build failed on `pages/admin/kingsreview.tsx` with strict type error at autosave merge path (`classificationNormalized.setName` not allowed by local type).
- Fixes applied:
  - `frontend/nextjs-app/pages/admin/kingsreview.tsx`
    - widened local `classificationNormalized` type to include `setName`, `setCode`, `cardNumber` (and index signature).
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - removed forward-reference to `typedOcrAudit` in callback to avoid declaration-order TS compile issues.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - aligned OCR section id typing (`OcrPhotoId`) so strict type predicate checks pass.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/kingsreview.tsx --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts` passed (existing warnings only).
- Deploy status:
  - no deploy/restart/migration executed in this coding step.

## Build Triage Verification (2026-02-23, Vercel failure follow-up)
- Context:
  - user provided Vercel failure log for `kingsreview.tsx` strict type mismatch (`classificationNormalized.setName` unsupported in local type).
- Verification completed:
  - re-ran targeted lint for touched files and confirmed pass with existing warnings only.
  - attempted workspace `vercel:build`; local failure occurred before app compile due workstation Prisma artifact gap (`Prisma engines directory not found`), not the reported TS issue.
  - attempted app-only Next build; local run exited non-zero with warnings output only and did not reproduce the prior `kingsreview.tsx` type error.
- Operational status:
  - no deploy/restart/migration/DB operation executed in this follow-up.

## KingsReview Query + Inventory Ready Detail Upgrade (2026-02-23)
- Scope completed:
  - normalized KingsReview SerpApi/eBay query construction to remove duplicate year/manufacturer/set noise and canonicalize autograph descriptor tokens.
  - added Inventory Ready inline valuation editing (`valuationMinor` PATCH path).
  - added Inventory Ready comp-detail rendering from latest KingsReview job results (image + listing link + search link).
- Files changed:
  - `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`
  - `frontend/nextjs-app/pages/admin/inventory-ready.tsx`
- Behavioral notes:
  - query builder now derives cleaner terms from classification payload (`year`, `brand`, `setName`, `setCode`, `player`, `cardNumber`) with descriptor normalization (`AUTOGRAPH CARDS` -> `AUTOGRAPH`).
  - Inventory Ready selected-card panel now includes latest sold comps from `/api/admin/kingsreview/jobs?cardAssetId=...`.
  - valuation edits in Inventory Ready persist immediately via `PATCH /api/admin/cards/[cardId]` and update the local card grid values/totals.
- Validation run:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/kingsreview/enqueue.ts --file pages/admin/inventory-ready.tsx`
  - Result: pass with existing warnings only (`no-img-element`).
- Deploy/runtime status:
  - no deploy/restart/migration executed in this coding step.

## OCR Provider Reset + Intake Readiness Tightening (2026-02-23, Follow-up #23)
- New operator requirements addressed:
  - return OCR provider to Google Vision.
  - wait for all three intake photos before OCR/LLM parse starts.
  - stop using compressed upload images for OCR/LLM/variant workflows.
  - tolerate label stop-word drift (e.g., missing `"the"`) in variant/parallel option matching.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/googleVisionOcr.ts` (new)
    - adds Google Vision OCR client (`images:annotate`, `DOCUMENT_TEXT_DETECTION`) mapped into existing OCR response/token structure.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - switched OCR execution from local OCR to Google Vision helper.
    - required photo readiness now `FRONT/BACK/TILT` before OCR call; returns `pending` readiness audit otherwise.
    - OCR LLM default fallback model updated to `gpt-5.2`.
    - audit source/model labels updated to `google-vision` / `google-vision+llm`.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - removed client compression path; uploads now send original file payload.
    - tilt photo is now required in intake flow (skip path removed).
    - OCR kickoff now re-checks readiness after queued photo uploads and relies on server-side required-photo gate.
    - variant option ranking/lookup now canonicalizes labels with stop-word tolerance (`the` ignored) to reduce false misses.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/api/admin/kingsreview/enqueue.ts --file pages/admin/inventory-ready.tsx`
  - result: pass with existing warnings only (`no-img-element` class).
  - local `pnpm -w run vercel:build` still fails pre-compile in this workstation due `Prisma engines directory not found` (known local environment gap, not new lint failure).
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## OCR LLM Responses API Migration (2026-02-23, Follow-up #24)
- New operator requirement:
  - move OCR parse from Chat Completions to Responses API and target top pro-model path explicitly.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - migrated OCR LLM request to `POST /v1/responses`.
    - default model target now `gpt-5.2-pro`.
    - added `OCR_LLM_FALLBACK_MODEL` default `gpt-5-pro`.
    - added compatibility attempt ladder:
      1) primary + `json_schema`
      2) primary + `json_object`
      3) fallback + `json_schema`
      4) fallback + `json_object`
    - detects structured-output unsupported errors and auto-continues to next compatible attempt.
    - added Responses payload text extraction (`output_text` + `output[].content[]`) and tolerant JSON unwrapping.
    - persisted selected LLM metadata to OCR audit (`audit.llm`) and resolved audit model labeling.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - result: pass (`No ESLint warnings or errors`).
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## OCR LLM Default Alignment to GPT-5 IDs (2026-02-23, Follow-up #25)
- Operator preference:
  - ensure OCR parse defaults use canonical GPT-5 family model IDs and request model explicitly every call.
- Fix shipped:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - default `OCR_LLM_MODEL` changed to `gpt-5`.
    - default `OCR_LLM_FALLBACK_MODEL` changed to `gpt-5-mini`.
    - per-request model selection remains explicit in Responses API call path.
- Validation executed:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - result: pass (`No ESLint warnings or errors`).
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## OCR Fallback Regression Coverage + Legacy OCR Wire Cleanup (2026-02-23, Follow-up #26)
- Operator requests addressed:
  - complete item #5 (remove old OCR wires/path confusion).
  - implement item #1 (automated regression coverage for Responses fallback path).
- Fixes shipped:
  - `packages/shared/src/ocrLlmFallback.ts` (new):
    - shared fallback planner + resolver for OCR Responses calls.
    - structured-output unsupported detector for `json_schema` fallback decisions.
  - `packages/shared/tests/ocrLlmFallback.test.js` (new):
    - validates fallback sequence and failure behavior.
  - `packages/shared/src/index.ts`, `packages/shared/package.json`:
    - exports new helper and includes new test in shared test run.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`:
    - now uses shared fallback resolver instead of local fallback loop.
  - `frontend/nextjs-app/lib/server/localOcr.ts`:
    - deleted (legacy OCR service client removed from active app path).
  - `frontend/nextjs-app/lib/server/googleVisionOcr.ts`:
    - now owns OCR input/output/token type definitions directly.
  - `docs/DEPLOYMENT.md`:
    - removed `OCR_SERVICE_URL`/`OCR_SERVICE_TOKEN` guidance; replaced with Google Vision + OpenAI OCR env guidance.
- Validation executed:
  - `pnpm --filter @tenkings/shared test` passed.
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/admin/uploads.tsx --file pages/admin/inventory-ready.tsx` passed (existing `no-img-element` warnings only).
- Deployment status:
  - No deploy/restart/migration executed in this coding session.

## AI Ops Dashboard Phase 1 (2026-02-23)
- Scope completed:
  - Added `/admin/ai-ops` as the Phase 1 OCR/LLM operations dashboard.
  - Added `/api/admin/ai-ops/overview` aggregation endpoint for OCR/LLM health and teach-memory metrics.
  - Added `AI Ops` shortcut tile on `/admin`.
  - Added quick action to rerun OCR for flagged cards directly from the dashboard.
- Files changed:
  - `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts` (new)
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx` (new)
  - `frontend/nextjs-app/pages/admin/index.tsx`
- Dashboard sections now shipped:
  - Live pipeline health (24h vs 7d parse/fallback/match/readiness/latency)
  - Teach/Train impact (lessons, corrections, accuracy trend, top corrected fields)
  - Model behavior (model + response-format distribution)
  - Recent human correction feed
  - Attention queue with `Retry OCR` action
- Validation run:
  - `pnpm --filter @tenkings/shared test` passed.
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/api/admin/ai-ops/overview.ts --file pages/admin/index.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/admin/uploads.tsx --file pages/admin/inventory-ready.tsx --file pages/api/admin/kingsreview/enqueue.ts` passed (existing `no-img-element` warnings only in pre-existing pages).
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/admin/index.tsx --file pages/api/admin/ai-ops/overview.ts` passed clean.
- Deployment status:
  - No deploy/restart/migration executed in this coding step.

## Add Cards Variant Option Coverage + Set Drift Fix (2026-02-23)
- Trigger:
  - Prod test cards in Add Cards were missing expected insert/parallel options (e.g., No Limit, Daily Dribble, Rise To Stardom, The Stars of NBA, Holo/Refractor) and product-line selection was over-biasing to Topps Finest.
- Root causes addressed:
  - `/api/admin/variants/options` used row-limited variant scans and strict substring filters, which could drop valid option labels in larger year/manufacturer scopes.
  - OCR teach-memory replay could over-apply `setName` across cards with only broad year/manufacturer/sport overlap.
  - Add Cards auto product-line selection accepted weak hints too aggressively.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/variants/options.ts`
    - switched to grouped option aggregation (`setId + parallelId + parallelFamily`) over scoped approved sets.
    - added staged token-based set scope fallback (year/manufacturer/sport) to improve coverage when naming is inconsistent.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - disabled memory replay writes for `setName`.
    - required stronger context before replaying `parallel`/`insertSet` memory hints.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - blocked weak single-token product-line auto-hints.
    - removed generic manufacturer+sport product-line default.
    - only auto-picks product line when blank and candidate match is stronger.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/options.ts --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts` passed (existing `no-img-element` warnings only).
- Deployment status:
  - No deploy/restart/migration executed in this coding step.

## Teach Memory v2 + Add Cards Option Guard (2026-02-23)
- Trigger:
  - Operator observed: set misses persisted, insert suggestions appeared one-card-only without canonical option continuity, and frequent `Red` parallel bias.
- Fixes shipped:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - memory replay now uses `tokenRefsJson` anchor overlap against current OCR tokens (including per-image id context).
    - set-memory replay re-enabled with strict year+manufacturer context and token-support gating to reduce cross-set bleed.
    - insert/parallel memory replay strengthened with token-support gating.
    - removed color-only fallback keywords from heuristic parallel inference.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - option ranking no longer injects non-canonical OCR suggestions into picker lists.
- Expected behavior change:
  - Teach on one card should apply faster to same set patterns while reducing wrong-set drift.
  - Insert/parallel pickers should stay canonical to DB-backed option pool.
  - Random color over-suggestion should reduce.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/admin/uploads.tsx --file pages/api/admin/variants/options.ts` passed (existing uploads warnings only).
- Deployment status:
  - No deploy/restart/migration executed in this coding step.

## OCR/LLM Baby Brain Master Plan Doc (2026-02-23)
- Added planning artifact for multi-agent coordination:
  - `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`
- Document contents:
  - big-picture product vision for "teach once, learn set family"
  - phased implementation roadmap with "what/why/done" criteria
  - target architecture and guardrails
  - operator teaching SOP
  - suggested data model/API changes
  - eval gates and rollout sequence
  - primary-source research links (OpenAI + Google Vision docs)
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Clarification (2026-02-23)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` Phase 1 wording for clarity:
  - constrained fields: `setName`, `insertSet`, `parallel`
  - unconstrained OCR+LLM fields: `playerName`, `cardName`, `cardNumber`, etc.
- Purpose: avoid misinterpretation that all player/card text must be pre-enumerated in DB.
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Governance Additions (2026-02-23)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` to include 6 implementation-governance sections:
  - CardState Contract
  - Learning Event Schema
  - Long-Tail Trigger Definitions
  - Three-Speed Learning Policy (SLA)
  - Taxonomy Lifecycle Rules
  - Release Safety Gates
- Purpose: ensure future agents implement the same contracts, logging semantics, and promotion safeguards.
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Threshold Clarification (2026-02-23)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` with explicit taxonomy thresholds:
  - `setName` auto-fill >= `0.80`
  - `insertSet` auto-fill >= `0.80`
  - `parallel` auto-fill >= `0.80`
- Added rule: below-threshold taxonomy fields remain blank (`unknown`) for human review.
- Added scope clarification: free-text OCR+LLM fields continue normal auto-fill behavior.
- Added explicit long-tail trigger cutoff: `set_low_confidence` = `setName < 0.80`.
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Schema Clarification (2026-02-24)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` to add concrete CardState and event schema examples for implementation consistency.
- Clarified field contracts:
  - `cardId` is system-generated and not operator-entered.
  - `setName` (taxonomy display value) remains separate from `setYear` (year field).
  - optional `setId` canonical key recommended for storage/join safety.
  - `numbered` is `null` or serial text (e.g. `1/5`, `3/25`).
  - `autographed` is `true` or `null`.
  - `graded` is `null` or object (`company`, `gradeValue`, `label`).
- Added concrete JSON payload examples:
  - CardState raw-card example
  - CardState auto+numbered+graded example
  - `recognition_suggested`
  - `recognition_corrected`
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Ops Ownership + Instant-Teach Policy Update (2026-02-24)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` with explicit operations ownership and SLA table:
  - wrong-set spike, taxonomy drift, teach replay failure, service degradation, and post-deploy regression triggers
  - default ack/mitigation windows
  - explicit rollback authority mapping.
- Added explicit model explaining that instant teach and retraining are complementary:
  - train action writes memory and affects next similar card immediately
  - retraining improves base model behavior for broader/unseen cases.
- Upgraded Region Teach strategy from optional to core phase:
  - added layout grouping key (`setId + layoutClass + photoSide`)
  - documented one-teach-many behavior for base cards in same set family
  - kept class isolation guardrails to avoid cross-layout contamination.
- Updated rollout sequence to pull region teach earlier (after memory phase).
- Operational status:
  - No deploy/restart/migration executed in this step.

## Master Plan Core Retrain Workflow Clarification (2026-02-24)
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` to add explicit operator-facing core retrain workflow.
- Added `Core Retrain Operations Workflow (UI + Actions)` section with:
  - automatic data intake from teaches/corrections/region templates,
  - scheduled retrain candidate generation (`daily-light`, `weekly-full`),
  - eval-gated candidate comparison and promotion flow,
  - concrete AI Ops UI surfaces and required operator actions,
  - promotion authority and emergency rollback policy.
- Purpose:
  - make retraining understandable operationally,
  - preserve instant-teach priority while adding global model improvement cadence.
- Operational status:
  - No deploy/restart/migration executed in this step.

## Phase 1 Implementation Complete (2026-02-24)
- Scope delivered:
  - candidate-constrained taxonomy (`setName`, `insertSet`, `parallel`) for Add Cards OCR suggestions,
  - approved-set scoping by year/manufacturer/sport aliases,
  - set-scoped insert/parallel pools once set is selected,
  - out-of-pool taxonomy rejection in API (clears to blank/unknown),
  - taxonomy confidence gate at `0.80`.
- Backend implementation:
  - new shared utility: `frontend/nextjs-app/lib/server/variantOptionPool.ts`
  - options API now sourced from shared utility and supports `setId` narrowing:
    - `frontend/nextjs-app/pages/api/admin/variants/options.ts`
  - OCR suggest API now:
    - prompts LLM with candidate lists,
    - enforces taxonomy constraints post-parse,
    - stores taxonomy constraint audit payload:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Add Cards UI implementation:
  - sends OCR suggest context hints (`year/manufacturer/sport/productLine/setId`)
  - applies taxonomy suggestions only when matched to option pool
  - retries delayed insert/parallel autofill after options load
  - removes fallback behavior that injected non-pool suggestions into ranked lists
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
- Validation:
  - targeted lint passed for changed files.
  - workspace-wide TS check still fails due known pre-existing Prisma/client mismatch.
- Operational status:
  - No deploy/restart/migration executed in this step.

## Phase 2 Implementation Complete (2026-02-24)
- Scope delivered:
  - persisted OCR teach-memory aggregate model for set-family replay (`OcrFeedbackMemoryAggregate`),
  - correction write-path now updates aggregate memory on every `Train AI` event,
  - OCR replay now reads aggregate memory with strict Phase 2 gates:
    - `setName` replay requires `year + manufacturer` (and sport match when present),
    - `insertSet` / `parallel` replay requires set/card context plus token-anchor overlap,
  - automatic cold-start backfill from historical `OcrFeedbackEvent` rows when aggregate memory is empty.
- Backend implementation:
  - new aggregate utility:
    - `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`
  - correction write-path integration:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
  - replay-path migration to aggregate reads:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Prisma schema + migration:
    - `packages/database/prisma/schema.prisma`
    - `packages/database/prisma/migrations/20260224190000_ocr_feedback_memory_aggregate/migration.sql`
- Validation:
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma` (pass)
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId].ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrFeedbackMemory.ts` (pass)
  - `pnpm --filter @tenkings/shared test` (pass)
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` (fails due broad pre-existing Prisma client mismatch in workspace; not isolated to this change set)
- Operational status:
  - No deploy/restart/migration executed in this step.

## Deploy/Migration Field Note (2026-02-24)
- Operator-reported runtime actions on droplet:
  - initial migrate attempt failed due placeholder env (`DATABASE_URL='<prod-db-url>'` not a real postgres URL).
  - operator then exported live `DATABASE_URL` from compose service env.
  - `pnpm --filter @tenkings/database migrate:deploy` returned `No pending migrations to apply`.
  - `pnpm --filter @tenkings/database generate` succeeded.
- Verification caution:
  - local Phase 2 branch contains migration `20260224190000_ocr_feedback_memory_aggregate`;
  - if droplet reports fewer migrations than expected, run droplet `git pull --ff-only` and rerun migrate before relying on parity.

## Deploy/Migration Confirmation (2026-02-24, Follow-up)
- Operator confirmed droplet parity + migration apply:
  - `git fetch --all --prune` pulled `origin/main` to commit `4c41c1d`.
  - `git pull --ff-only` updated droplet working tree from `6e3f20c` to `4c41c1d`.
  - migration folder `20260224190000_ocr_feedback_memory_aggregate` now present on droplet.
  - `pnpm --filter @tenkings/database migrate:deploy` applied migration `20260224190000_ocr_feedback_memory_aggregate` successfully.
- Current interpretation:
  - Phase 2 schema changes are now live in production DB.
  - Remaining validation is behavioral smoke in prod UI/API (teach replay quality), not deployment parity.

## Set Ops PDF Parse Fix (2026-02-24)
- Trigger:
  - PDF upload in `/admin/set-ops-review` parsed many rows with `parallel = INSERT` instead of insert-set headers such as `THE DAILY DRIBBLE` / `NEW SCHOOL`.
  - Evidence pattern: card numbers and player names mostly correct, but section/parallel labeling collapsed to generic category header.
- Root cause:
  - checklist section-header detector required keyword-based headers and missed contextual insert headers lacking explicit keywords.
  - generic header (`INSERT`) became active section while real insert header line was treated as row text.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - added contextual section-header detection using line lookahead (if next line starts with card-id token).
    - now recognizes headers like `THE DAILY DRIBBLE`, `NEW SCHOOL`, and year-led headers (e.g. `1980 TOPPS CHROME BASKETBALL`) when followed by card-number rows.
    - hardened card-id token logic to reject 4-digit season/year-like tokens (`1900..2099`) as card numbers.
    - expanded trailing header-noise cleanup tokens to reduce section bleed into player names.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx` (pass)
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Set Ops PDF Parse Fix - Follow-up (2026-02-24)
- Trigger:
  - improved parse still had scattered rows where `parallel` became `Rookie` for rookie subsections inside insert blocks.
- Root cause:
  - contextual header detection was still eligible to promote standalone `Rookie`/`RC` lines to active section headers when followed by card-id rows.
- Fixes shipped:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - added `isRookieSubheaderLine(...)` guard.
    - contextual header detector now explicitly rejects rookie marker lines as section headers.
    - parse loop now drops rookie marker lines while preserving current section (prevents parallel overwrite to `Rookie`).
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx` (pass)
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Phase 3 Implementation Complete (2026-02-24)
- Scope delivered:
  - unknown-first UX for taxonomy fields in Add Cards (`setName`, `insertSet`, `parallel`):
    - added field-level reason badges when taxonomy remains blank
    - reasons surfaced from OCR audit status (`low confidence`, `out of pool`, `no set scope`)
  - removed silent heuristic set auto-pick when no concrete OCR/LLM set hint exists.
  - added one-click teach capture in Add Cards:
    - `Teach From Corrections` button persists current corrected card state with OCR feedback/training enabled without sending to KingsReview.
- Frontend implementation:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - typed `taxonomyConstraints.fieldStatus` in OCR audit payload.
    - computed `taxonomyUnknownReasons` from audit and rendered badges next to taxonomy controls.
    - hardened product-line auto-fill effect to require actionable OCR set hint (Phase 3 no silent set forcing).
    - added `handleTeachFromCorrections` action + UI button + success feedback.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx`
  - Result: pass with existing pre-existing `@next/next/no-img-element` warnings in `pages/admin/uploads.tsx`.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Phase 4 Implementation Complete (2026-02-24)
- Scope delivered:
  - Added Region Teach storage and APIs for Add Cards phase (`setId + layoutClass + photoSide`).
  - Added click-drag Teach Regions UI in Add Cards optional stage with:
    - side selector (`FRONT`/`BACK`/`TILT`),
    - layout class input,
    - draw/clear/delete/save region flow.
  - OCR replay memory scoring now prioritizes token-anchor matches that overlap taught regions.
  - Add Cards OCR request now sends `layoutClass` hint to keep replay scoped by layout.
- Backend implementation:
  - new server helper:
    - `frontend/nextjs-app/lib/server/ocrRegionTemplates.ts`
  - new API route:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach.ts`
  - OCR suggest integration:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Prisma schema + migration:
    - `packages/database/prisma/schema.prisma`
    - `packages/database/prisma/migrations/20260224223000_ocr_region_templates/migration.sql`
- Frontend implementation:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - region teach state/handlers,
    - region overlay draw UI,
    - save/load template calls,
    - layout-class query hint on `/ocr-suggest`.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId]/region-teach.ts --file lib/server/ocrRegionTemplates.ts`
    - pass (existing pre-existing `@next/next/no-img-element` warnings in `uploads.tsx`).
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
    - pass.
  - `pnpm --filter @tenkings/database generate`
    - pass.
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - fails due broad pre-existing Prisma client/type mismatch in workspace (not isolated to this change set).
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Phase 5 Implementation Complete (2026-02-24)
- Scope delivered:
  - Added selective multimodal OCR+LLM path for hard cards only in Add Cards suggestion flow.
  - LLM now runs text-first; only escalates to image+text when uncertainty conditions are met.
  - Added low/high image detail policy:
    - low detail for moderate uncertainty
    - high detail for severe uncertainty (`text_parse_failed`, multiple taxonomy misses, or missing core fields).
  - Preserved candidate-constrained taxonomy output contract (`setName`/`insertSet`/`parallel`) for both text and multimodal calls.
- Backend implementation:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - refactored `parseWithLlm` into mode-aware text/multimodal request builder,
    - added resilient multimodal payload retry for `input_image` schema variants,
    - added hard-card decision engine (`buildMultimodalDecision`),
    - added confidence-aware merge logic for text+multimodal parsed fields,
    - writes multimodal decision + attempt metadata into OCR audit (`llm.attempts`, `llm.multimodalDecision`, `llm.mode`, `llm.detail`).
  - `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
    - added live metrics for multimodal usage and high-detail share.
- Frontend implementation:
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx`
    - added Pipeline Health rows:
      - `Multimodal use rate`
      - `High-detail share`
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/ai-ops/overview.ts --file pages/admin/ai-ops.tsx --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/region-teach.ts --file lib/server/ocrRegionTemplates.ts`
    - pass (existing pre-existing `@next/next/no-img-element` warnings in `uploads.tsx`).
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Phase 6 Implementation Complete (2026-02-24)
- Scope delivered:
  - Added OCR eval framework for weekly release gating with persisted cases/runs/results.
  - Added eval run API and cron trigger API.
  - Added AI Ops dashboard coverage for eval gate state, latest metrics, and manual run action.
  - Added secure eval-only bypass path so scheduled/manual eval can call OCR suggest without admin cookie.
- Backend implementation:
  - new helper: `frontend/nextjs-app/lib/server/ocrEvalFramework.ts`
    - case CRUD helpers
    - threshold/env resolution
    - scoring + gate checks
  - new APIs:
    - `frontend/nextjs-app/pages/api/admin/ai-ops/evals/cases.ts`
    - `frontend/nextjs-app/pages/api/admin/ai-ops/evals/run.ts`
    - `frontend/nextjs-app/pages/api/admin/cron/ai-evals-weekly.ts`
  - OCR suggest auth update:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - allows `x-ai-eval-secret` when it matches `AI_EVAL_RUN_SECRET`.
  - AI Ops overview extension:
    - `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
    - now returns eval case counts + recent run summaries.
- Frontend implementation:
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx`
    - added Eval Gate panel
    - added `Run Eval Now` action
    - shows latest gate status + failed checks + recent run list
    - added Gold Eval Cases manager (quick-add case form + enable/disable toggles + case list refresh).
- DB implementation:
  - Prisma schema + migration added:
    - `packages/database/prisma/schema.prisma`
    - `packages/database/prisma/migrations/20260225000000_ocr_eval_framework/migration.sql`
  - New models:
    - `OcrEvalCase`
    - `OcrEvalRun`
    - `OcrEvalResult`
- Gate metrics currently enforced:
  - `set_top1`
  - `insert_parallel_top1`
  - `insert_parallel_top3`
  - `case_pass_rate`
  - `unknown_rate`
  - `wrong_set_rate`
  - `cross_set_memory_drift` (when memory-applied opportunities exist)
  - `min_cases`
- Validation:
  - `pnpm --filter @tenkings/shared test` (pass)
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/api/admin/ai-ops/overview.ts --file pages/api/admin/ai-ops/evals/run.ts --file pages/api/admin/ai-ops/evals/cases.ts --file pages/api/admin/cron/ai-evals-weekly.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrEvalFramework.ts` (pass)
  - `pnpm --filter @tenkings/database generate` (pass)
- Required env vars for runtime:
  - `AI_EVAL_RUN_SECRET` (used by eval runner to call OCR suggest)
  - `AI_EVAL_CRON_SECRET` (used by cron trigger and scheduled eval route)
  - optional threshold overrides:
    - `OCR_EVAL_MIN_CASES`
    - `OCR_EVAL_SET_TOP1_MIN`
    - `OCR_EVAL_INSERT_PARALLEL_TOP1_MIN`
    - `OCR_EVAL_INSERT_PARALLEL_TOP3_MIN`
    - `OCR_EVAL_CASE_PASS_RATE_MIN`
    - `OCR_EVAL_UNKNOWN_RATE_MAX`
    - `OCR_EVAL_WRONG_SET_RATE_MAX`
    - `OCR_EVAL_CROSS_SET_MEMORY_DRIFT_MAX`
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Uploads UX + Teach Clarification Update (2026-02-24)
- Trigger:
  - Operator reported teach-region drawing was not obvious and appeared non-functional.
  - Operator requested `/admin/uploads` cleanup: hide unused Open Camera/Recent Upload Batches sections, remove global header/footer/hamburger, keep only local console/kingsreview links, and enlarge/center Capture Queue actions.
- Changes made:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - Added explicit draw control for region teach:
      - `Draw Mode On/Off` toggle.
      - inline 3-step instruction text.
      - crosshair cursor while draw mode is on.
      - disabled image drag/selection (`draggable={false}`, `pointer-events-none`, `select-none`) to reduce accidental image drag interference while marking regions.
    - Hid global AppShell chrome on uploads (header/footer/hamburger removed):
      - page now renders with `hideHeader` + `hideFooter`.
    - Hid legacy bottom sections not currently used:
      - Open Camera upload panel
      - Recent Uploads · Batches panel
      - both gated behind `showLegacyCapturePanels = false`.
    - Updated Capture Queue card:
      - centered text/buttons,
      - increased button sizes (Add Card and OCR Review),
      - kept queue controls in same block.
    - tightened top spacing (`py-6`) to shift content up.
- Functional clarification captured from current code:
  - `Teach From Corrections` saves the current corrected fields as OCR feedback events and updates memory aggregates immediately (instant replay path).
  - `Train AI On/Off` controls whether send-to-KingsReview writes teach feedback for that card.
  - draw/region teach is separate from field-value teach; region templates are used during OCR replay scoring via set/layout/side scope.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx`
  - Result: pass with pre-existing `@next/next/no-img-element` warnings only.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Uploads Teach Region Binding + Touch Draw Fix (2026-02-24)
- Trigger:
  - Operator reported no visible draw feedback on touch/finger input.
  - Operator requested explicit teach linkage from drawn image region to corrected card-detail context.
  - Operator requested `ADD CARDS` page title removal and `UNDO` support for teach drawing.
- Changes made:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - Removed white header text `Add Cards` from `/admin/uploads`.
    - Replaced mouse-only teach draw handlers with pointer events (`mouse`/`touch`/`pen`) for live visual feedback while dragging.
    - Added `Undo` action for teach regions (cancel active draft or remove latest saved region on active side).
    - Added post-draw `Link Teach Region` modal:
      - choose card detail field (set/insert/parallel/card number/player/etc),
      - auto-prefill current corrected value from form state,
      - optional note text,
      - save/discard controls.
    - Teach regions now persist linkage metadata per region:
      - `targetField`
      - `targetValue`
      - `note`
      - readable `label` summary in region list.
  - `frontend/nextjs-app/lib/server/ocrRegionTemplates.ts`
    - Extended region sanitizer/persistence to store `targetField`, `targetValue`, and `note`.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - Region-overlap token scoring now supports field-aware region hints:
      - if a region is linked to a specific field, overlap can reinforce that field’s replay confidence path.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/ocrRegionTemplates.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings in `uploads.tsx`.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Uploads Follow-up Stabilization (2026-02-24)
- Trigger:
  - Operator reported `numbered` auto-filling as `42/99` on many cards even after teach corrections.
  - Operator reported mobile draw flow crashing with client-side exception.
  - Operator reported PhotoRoom cleanup no longer reliably applied before KingsReview handoff.
- Changes made:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - Excluded `numbered` from OCR memory replay candidate fields.
    - Added strict OCR grounding for `numbered`:
      - keep only when OCR text explicitly contains `x/y` serial pattern;
      - otherwise clear `numbered` + confidence to `null`.
  - `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`
    - Excluded `numbered` from persisted memory aggregate upserts to prevent future over-generalized serial replay.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - hardened pointer capture/release paths with safe guards for mobile browser compatibility.
    - added pointer-leave finalize path to reduce stuck draft states.
    - restored deterministic PhotoRoom run at send step:
      - `Send to KingsReview` now calls card PhotoRoom processing first and blocks send when PhotoRoom fails or is not configured.
      - OCR-stage PhotoRoom trigger remains best-effort and logs warning on failure.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrFeedbackMemory.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings only.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Teach Region Full Plan Completion (2026-02-24)
- Scope delivered:
  - Completed draw crash telemetry + debug payload capture for `/admin/uploads` teach-region workflow.
  - Added AI Ops Teach Region event visibility (save/error metrics and recent event details).
  - Added optional annotation snapshot PNG persistence alongside vector region templates.
- Backend implementation:
  - Prisma schema + migration:
    - `packages/database/prisma/schema.prisma`
    - `packages/database/prisma/migrations/20260225013000_ocr_region_teach_events/migration.sql`
    - New model: `OcrRegionTeachEvent` (save/error event log with optional snapshot URL + debug payload).
  - New helper:
    - `frontend/nextjs-app/lib/server/ocrRegionTeachEvents.ts`
    - snapshot upload (`storeOcrRegionSnapshot`)
    - event persistence (`createOcrRegionTeachEvent`)
  - API updates:
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach.ts`
      - now accepts `snapshots` payload (multi-side),
      - stores side snapshots,
      - writes `TEMPLATE_SAVE` events,
      - returns non-fatal `warnings` list.
    - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach-telemetry.ts` (new)
      - captures client-side draw/runtime failures as `CLIENT_ERROR` events.
  - AI Ops overview API:
    - `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
    - now returns `teachRegions` block with:
      - 24h/7d save counts,
      - 24h/7d client error counts,
      - snapshot coverage,
      - templates-updated totals,
      - avg regions/save,
      - recent save/error event lists.
- Frontend implementation:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - client telemetry sender to `/region-teach-telemetry` with draw/session context,
    - guarded pointer handlers (`down/move/up/cancel`) to capture/report runtime errors,
    - global `window error` / `unhandledrejection` hooks with teach-region filtering,
    - snapshot builder for taught regions (image+overlay, fallback overlay-only),
    - `Save Region Teach` now uploads snapshots with templates,
    - teach preview image error telemetry.
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx`
    - new Teach Region Telemetry panel:
      - summary counters (save/error/snapshot coverage),
      - recent template saves table,
      - recent client error feed.
- Validation:
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
    - pass.
  - `pnpm --filter @tenkings/database generate`
    - pass.
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/region-teach.ts --file pages/api/admin/cards/[cardId]/region-teach-telemetry.ts --file lib/server/ocrRegionTeachEvents.ts --file pages/api/admin/ai-ops/overview.ts --file pages/admin/ai-ops.tsx`
    - pass (existing `@next/next/no-img-element` warnings only in `uploads.tsx`).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## OCR Latency + Train Send Delay Stabilization (2026-02-24)
- Trigger:
  - Operator reported OCR suggestions in Add Cards were delayed (~60s) before fields appeared.
  - Operator reported `Train AI On` + `Send to KingsReview` introduced long delay before queue advanced.
  - Operator reported teach draw path still crashing at pointer interaction stage.
- Root causes identified:
  - OCR latency:
    - `ocr-suggest` often executed two LLM passes (`text` + `multimodal`) because multimodal escalation criteria were too broad (single taxonomy uncertainty could trigger multimodal).
    - Google Vision ingestion did expensive server-side URL fetch + base64 conversion for each image before Vision call.
  - Train send delay:
    - `PATCH /api/admin/cards/[cardId]` synchronously upserted OCR memory aggregates for all feedback rows whenever training was enabled.
    - Send path could duplicate teach persistence after `Teach From Corrections`.
  - Draw crash:
    - pointer move handler referenced synthetic event target inside state updater path, which is fragile on mobile pointer batching.
- Fixes implemented:
  - `frontend/nextjs-app/lib/server/googleVisionOcr.ts`
    - switched URL image handling to Vision `imageUri` mode by default (configurable via `GOOGLE_VISION_USE_IMAGE_URI`, default `true`).
    - retained fallback local fetch/base64 path when `GOOGLE_VISION_USE_IMAGE_URI=false`.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - reduced multimodal escalation aggressiveness (single taxonomy uncertainty no longer forces multimodal run).
    - added OpenAI Responses timeout guards (`text` and `multimodal`) + `reasoning.effort="minimal"` for extraction latency reduction.
    - added OCR audit timing metrics: `timings.totalMs`, `timings.ocrMs`, `timings.llmMs`.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
    - OCR memory aggregate upsert now runs only for corrected rows (`wasCorrect=false`) instead of all feedback rows.
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - added `teachCapturedFromCorrections` guard to avoid duplicate teach persistence on send after explicit teach action.
    - hardened pointer move handler to compute bounds before state updater (removes synthetic-event target coupling).
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId].ts --file lib/server/googleVisionOcr.ts`
    - pass (existing `@next/next/no-img-element` warnings only).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## OCR + Send UX Follow-up (2026-02-24)
- Trigger:
  - Operator requested no blocking wait on `Send to KingsReview` and confirmed draw crash still reproducing.
- Additional fixes delivered:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - send flow no longer blocks on PhotoRoom:
      - enqueue + queue-advance happens first,
      - PhotoRoom runs in background (fire-and-forget) after handoff.
    - queue advance no longer waits synchronously on `loadQueuedCardForReview`; it is now async with error capture.
    - added explicit dedupe signal for teach-on-send:
      - `teachCapturedFromCorrections` prevents duplicate teach write after manual teach.
  - `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`
    - memory aggregate upsert path now processes candidate rows with bounded concurrency (`OCR_MEMORY_UPSERT_CONCURRENCY`, default 6) instead of strict serial loop.
    - reduces train-on send latency while preserving same aggregate semantics.
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
    - Responses API calls now include timeout guards and `reasoning.effort=minimal`.
    - multimodal fallback remains but with tighter escalation conditions.
  - `frontend/nextjs-app/lib/server/googleVisionOcr.ts`
    - Vision URL input now defaults to `imageUri` mode to avoid pre-fetch/base64 conversion overhead.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId].ts --file lib/server/googleVisionOcr.ts --file lib/server/ocrFeedbackMemory.ts`
    - pass (existing `@next/next/no-img-element` warnings only).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## AI Ops Dashboard Load + Run Eval Fix (2026-02-24)
- Trigger:
  - `/admin/ai-ops` appeared empty on load.
  - `Run Eval Now` appeared non-functional.
- Root cause:
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx` used raw `fetch(...)` calls without admin auth headers.
  - Backend AI Ops routes require `Authorization`/admin session, so requests failed and dashboard never hydrated.
  - Empty-state UI did not surface request errors, which made failures look like a no-op.
- Fixes implemented:
  - `frontend/nextjs-app/pages/admin/ai-ops.tsx`
    - added `buildAdminHeaders` import and memoized header generation from `session.token`.
    - added admin headers to all AI Ops fetch calls:
      - `/api/admin/ai-ops/overview`
      - `/api/admin/ai-ops/evals/run`
      - `/api/admin/ai-ops/evals/cases` (GET/POST/PATCH)
      - retry OCR call (`/api/admin/cards/:id/ocr-suggest`)
    - added token guards with explicit error text when session token is missing.
    - surfaced `error` text in the empty-state block so failures are visible even before dashboard data loads.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx`
    - pass.
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Add Cards Set Field: Manual Entry Fallback While Keeping Required (2026-02-24)
- Trigger:
  - Need to keep set required while allowing operators to enter a set manually when correct set is not in option list.
- Change:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - Added manual set-entry mode for required sport set field even when approved set options exist.
    - Added select option: `Set not listed (enter manually)`.
    - Added manual text input mode with `Back to set list` action.
    - Preserved required validation (`Product line / set is required.`) with no bypass.
    - Added sync logic so unknown loaded/suggested sets auto-open manual mode, known sets auto-return to list mode.
    - Prevented set auto-pick effect from overriding operator intent while manual mode is active.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx`
    - pass (existing `@next/next/no-img-element` warnings only).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Uploads UX Tightening + Variant Option Coverage (2026-02-24)
- Trigger:
  - Operator requested required-step UX compression on mobile, inline unknown messaging, cleaner insert/parallel picker labels, alphabetical option ordering with search, and investigation of missing autograph-family option.
- Changes implemented:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
    - Required-step action button moved up directly below OCR status row.
    - Gold button text changed from `Continue to optional fields` to `Next fields`.
    - Unknown taxonomy messages moved inline into fields:
      - set field placeholder option/manual input placeholder,
      - insert/parallel picker button text.
    - Removed separate red helper blocks under set/insert/parallel fields to reduce vertical space.
    - Insert/parallel picker field placeholders shortened:
      - `Insert Set`
      - `Variant / Parallel`
    - Added right-side dropdown indicator (`▾`) in insert/parallel picker buttons.
    - Picker modal now supports search input at top (above `None` option).
    - Picker options now sorted alphabetically (case-insensitive, numeric-aware).
  - `frontend/nextjs-app/lib/server/variantOptionPool.ts`
    - option pool now emits labels from both `parallelId` and `parallelFamily` (deduped by normalized key).
    - this addresses missing family-name options (e.g., autograph-family names) when family label is present but `parallelId` differs.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/variantOptionPool.ts`
    - pass (existing `@next/next/no-img-element` warnings only in `uploads.tsx`).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.

## Set Ops PDF Parser: Preserve Section Headers on Compound Lines (2026-02-24)
- Trigger:
  - Operator reported missing option families in Add Cards (example: `1980 81 TOPPS CHROME BASKETBALL`, `1980 81 TOPPS BASKETBALL AUTOGRAPHS`) despite source PDF containing them.
- Root cause:
  - Some checklist PDFs emit a single text line containing both section header and first card row.
  - Existing parser treated that as row text only, causing section label loss/bleed into previous section (e.g., generic `INSERT`/`ROOKIE` drift).
- Fix:
  - `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
    - added `splitChecklistCompoundLine(...)`:
      - detects `header + cardId + player` compound lines,
      - splits into true section header and row segment,
      - preserves section name as `parallel` for row normalization.
    - integrated split before normal section-header detection in `parseChecklistRowsFromText(...)`.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/variantOptionPool.ts --file pages/admin/uploads.tsx`
    - pass (existing `@next/next/no-img-element` warnings only in `uploads.tsx`).
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
    - pass.
- Operational status:
  - No deploy/restart/migration executed in this coding step.
