# Set Ops Handoff (Living)

## Current State
- Last reviewed: `2026-02-22` (parser hardening + PDF checklist ingestion support)
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
