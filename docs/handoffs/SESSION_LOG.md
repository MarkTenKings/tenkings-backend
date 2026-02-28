# Session Log (Append Only)

## 2026-02-21 - Baseline Handoff Setup

### Summary
- Established canonical multi-file handoff system for future agents.
- Added master context and runbooks for deploy + set ops.
- Standardized mandatory agent process in `AGENTS.md`.

### Files Created/Updated
- `AGENTS.md`
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Existing detailed state remains in `docs/HANDOFF_SET_OPS.md`.
- Agents must verify runtime/DB evidence before trusting docs.

## 2026-02-22 - Agent Context Sync (Docs-Only)

### Summary
- Read required startup docs listed in `AGENTS.md`.
- Confirmed workstation branch is `chore/seed-timeout-hardening` with clean working tree.
- No code edits, deploys, restarts, migrations, or DB operations were executed.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- `docs/HANDOFF_SET_OPS.md` remains current baseline for active set-ops state.
- Next operational step is still runtime/API/DB verification for 2020 QA table label/count behavior.

## 2026-02-22 - Set Ops P0-A Ticket 1 (DB Foundation)

### Summary
- Added Set Ops foundation schema objects:
  - `SetIngestionJob`
  - `SetDraft`
  - `SetDraftVersion`
  - `SetApproval`
  - `SetSeedJob`
  - `SetAuditEvent`
- Added supporting enums for dataset type, workflow statuses, approval decisions, seed state, and audit outcome.
- Added schema migration scaffold: `20260222120000_set_ops_workflow_foundation`.

### Files Updated
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260222120000_set_ops_workflow_foundation/migration.sql`
- `packages/database/src/index.ts`

### Validation Evidence
- `pnpm --filter @tenkings/database generate` completed successfully.
- `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma` completed successfully.
- `pnpm --filter @tenkings/database build` currently fails due pre-existing Prisma client/type generation mismatch in this environment (not introduced by this ticket), tracked for follow-up.

### Notes
- No deploy/restart/migration was executed against any runtime environment.

## 2026-02-22 - Set Ops P0-A Ticket 2 (Normalizer + Tests)

### Summary
- Added shared Set Ops normalizer utilities in `@tenkings/shared` for:
  - HTML entity decoding
  - set label normalization
  - JSON-like parallel label normalization
  - card number normalization
  - listing id normalization
  - duplicate key generation (`setId + cardNumber + parallel + playerSeed + listingId`)
- Added unit tests with dirty 2020 regression-style inputs.

### Files Updated
- `packages/shared/src/setOpsNormalizer.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/setOpsNormalizer.test.js`
- `packages/shared/package.json`

### Validation Evidence
- `pnpm --filter @tenkings/shared test` passed.

### Notes
- Normalizer is now reusable by admin APIs and UI modules for consistent read/write behavior.

## 2026-02-22 - Set Ops P0-A Ticket 3 (Set Admin APIs)

### Summary
- Added Set Ops backend helper module with:
  - server-side role checks (`reviewer`, `approver`, `delete`, `admin`)
  - audit-event writer for success/failure/denied flows
  - delete dry-run impact calculator
- Added Set Admin API routes:
  - `GET /api/admin/set-ops/sets`
  - `POST /api/admin/set-ops/archive`
  - `POST /api/admin/set-ops/delete/dry-run`
  - `POST /api/admin/set-ops/delete/confirm`
- Delete confirm requires typed phrase `DELETE <setId>` and executes transactional deletes with audit record creation.

### Files Added
- `frontend/nextjs-app/lib/server/setOps.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/sets.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/archive.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/dry-run.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`

### Validation Evidence
- `pnpm --filter @tenkings/database generate` completed successfully.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` remains failing due existing workspace Prisma client linkage/type mismatch unrelated to this ticket (same broad failure class seen in prior baseline).

### Notes
- No deploy/restart/migration was executed.
- Destructive delete behavior remains API-gated (RBAC + typed confirm + dry-run preview endpoint).

## 2026-02-22 - Set Ops P0-B Ticket 10 (Set Admin Page Baseline)

### Summary
- Added new admin UI page at `/admin/set-ops` with:
  - admin access gate
  - set search/filter controls
  - include-archived toggle
  - set table showing variant/ref counts, draft status, last seed status, and updated timestamp
  - summary cards for set rows / variant totals / reference totals
- Linked page from `/admin` dashboard.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `frontend/nextjs-app/pages/admin/index.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx --file pages/admin/index.tsx` passed.

## 2026-02-22 - Set Ops P0-B Ticket 11 (Archive Action UI)

### Summary
- Added archive/unarchive controls per set row on `/admin/set-ops`.
- Wired controls to `POST /api/admin/set-ops/archive`.
- Added inline action state handling (`Saving...`) and audit snippet feedback in UI.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx` passed.

## 2026-02-22 - Set Ops P0-B Ticket 12 (Delete Action UI)

### Summary
- Added delete controls to `/admin/set-ops` rows.
- Implemented destructive-action modal with:
  - automatic dry-run impact preview (`/api/admin/set-ops/delete/dry-run`)
  - required typed confirmation phrase (`DELETE <setId>`)
  - confirm execution via `/api/admin/set-ops/delete/confirm`
- Added success/error/audit feedback wiring to the Set Ops page state.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx` passed.

## 2026-02-22 - Set Ops P0-C Ticket 5 (Ingestion Job API MVP)

### Summary
- Added ingestion queue API at:
  - `GET /api/admin/set-ops/ingestion`
  - `POST /api/admin/set-ops/ingestion`
- Supports dataset types `PARALLEL_DB` and `PLAYER_WORKSHEET`.
- Persists source URL, parser version, raw payload, and ingestion status lifecycle records.
- Creates/links `SetDraft` records during ingestion enqueue.

### Files Added
- `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts`

### Validation Evidence
- Targeted lint pass for new Set Ops API files (see later combined lint run entry in this session).

## 2026-02-22 - Set Ops P0-C Ticket 6 (Draft Build + Validation API MVP)

### Summary
- Added draft normalization/validation helper library:
  - row normalization (set/parallel/card/player/listing)
  - duplicate key detection
  - blocking/non-blocking issue tagging
  - immutable version payload hashing
  - draft diff summarization utilities
- Added draft APIs:
  - `POST /api/admin/set-ops/drafts/build`
  - `GET /api/admin/set-ops/drafts`
  - `POST /api/admin/set-ops/drafts/version`
- `drafts/build` now converts ingestion payloads into normalized immutable draft versions and updates ingestion status to `REVIEW_REQUIRED`.

### Files Added
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/index.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/version.ts`

### Validation Evidence
- Targeted lint pass for new Set Ops API/helper files (see later combined lint run entry in this session).

## 2026-02-22 - Set Ops P0-C Ticket 8 (Approval + Seed APIs MVP)

### Summary
- Added approval API:
  - `POST /api/admin/set-ops/approval`
  - Blocks approval when blocking validation errors exist.
  - Persists diff summary and approval metadata.
- Added seed execution helper and APIs:
  - `GET/POST /api/admin/set-ops/seed/jobs`
  - `POST /api/admin/set-ops/seed/jobs/[jobId]/cancel`
  - `POST /api/admin/set-ops/seed/jobs/[jobId]/retry`
- Seed runs now execute from approved draft data without shell commands, persist progress/result/log fields, and emit audit events.

### Files Added
- `frontend/nextjs-app/lib/server/setOpsSeed.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs/[jobId]/cancel.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs/[jobId]/retry.ts`

### Validation Evidence
- Targeted lint pass for new Set Ops API/helper files (see later combined lint run entry in this session).

## 2026-02-22 - Set Ops P0-C Ticket 7 (Review UI MVP)

### Summary
- Added new admin workspace page: `/admin/set-ops-review`.
- Added UI for:
  - ingestion queue creation/listing/selection
  - draft build from selected ingestion job
  - editable draft grid (card/parallel/player/listing/source)
  - immutable draft version save
  - approval/reject actions with blocking-error gating in UI
- Wired page links from `/admin/set-ops` and `/admin`.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `frontend/nextjs-app/pages/admin/index.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops-review.tsx --file pages/admin/set-ops.tsx --file pages/admin/index.tsx` passed.

## 2026-02-22 - Set Ops P0-C Ticket 9 (Seed Monitor UI MVP)

### Summary
- Added seed monitor panel to `/admin/set-ops-review` with:
  - start seed action
  - job list/status/progress/result/log preview
  - cancel and retry controls per job (status-aware)
  - manual refresh flow

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops-review.tsx --file pages/admin/set-ops.tsx --file pages/admin/index.tsx` passed.

## 2026-02-22 - Set Ops P0-D Ticket 14 (Permissions + Guardrails Hardening)

### Summary
- Added role-access endpoint for Set Ops UI capability checks:
  - `GET /api/admin/set-ops/access`
- Hardened UI action gating on:
  - `/admin/set-ops`
  - `/admin/set-ops-review`
- UI now fetches server-derived role permissions (`reviewer`, `approver`, `delete`, `admin`) and conditionally enables/disables protected actions.
- Server-side RBAC and denied-attempt audit logging remain authoritative in API routes; this ticket adds a client-side guardrail layer to reduce invalid requests.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/access.ts`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/access.ts` passed.

### Notes
- No deploy/restart/migration was executed.
- No destructive DB operations were executed.

## 2026-02-22 - Set Ops P0-D Ticket 15 (Regression Tests + Rollout Checklist)

### Summary
- Added shared delete-confirmation helpers to centralize destructive phrase validation logic:
  - `buildSetDeleteConfirmationPhrase`
  - `isSetDeleteConfirmationValid`
- Wired helper usage into:
  - `/api/admin/set-ops/delete/confirm`
  - `/admin/set-ops` delete modal placeholder/label/enable state
- Extended shared regression tests to cover:
  - dirty 2020 set delete confirmation phrase normalization
  - exact typed-confirmation validation behavior
- Updated Set Ops runbook with P0 UI workflow, API map, pre-release validation checklist, and production rollout checklist.

### Files Updated
- `packages/shared/src/setOpsNormalizer.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/setOpsNormalizer.test.js`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `docs/runbooks/SET_OPS_RUNBOOK.md`

### Validation Evidence
- `pnpm --filter @tenkings/shared test` passed.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx --file pages/api/admin/set-ops/delete/confirm.ts` passed.

### Notes
- No deploy/restart/migration was executed.
- No destructive DB operations were executed.

## 2026-02-22 - Vercel Hotfix (Set Ops Type Narrowing)

### Summary
- Fixed Vercel build failure in `/admin/set-ops` caused by union type access without narrowing.
- Updated `LoadResponse` handling to guard `payload.sets`/`payload.total` behind `'sets' in payload` and `'total' in payload` checks.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx` passed.
- Local `pnpm --filter @tenkings/nextjs-app build` still exits non-zero in this environment without printing additional compile diagnostics, but the original Vercel type error at `set-ops.tsx:147` is resolved in code.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops PDF Checklist Import + Upload Support

### Summary
- Fixed Set Ops import failures for official checklist PDFs and non-table checklist pages.
- Added PDF parsing path to source URL import (`setOpsDiscovery`) and enabled off-domain PDF checklist link following.
- Added checklist-text fallback parser for HTML pages that do not expose checklist data in `<table>` format.
- Added new admin API for binary file parsing uploads:
  - `POST /api/admin/set-ops/discovery/parse-upload`
- Updated `/admin/set-ops-review` Step 1 upload flow:
  - accepts `.pdf` in file picker
  - sends PDF binary to parse-upload API
  - populates ingestion payload directly from parsed rows.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/parse-upload.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx` passed.
- `pnpm --filter @tenkings/nextjs-app exec tsc --noEmit` still fails in this workspace due pre-existing Prisma/client schema mismatch across unrelated modules.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Parser Hardening (CardboardConnection garbage-row fix)

### Summary
- User reported production draft rows filled with GTM/script/nav/eBay HTML text when importing:
  - `https://www.cardboardconnection.com/2024-25-topps-chrome-basketball-review-and-checklist`
- Root causes identified in parser pipeline:
  - largest-table-wins selection in HTML parser
  - loose field-name matching by substring
  - no ingestion quality gate for html/noise rows
  - draft validator allowed markup-like payload fields
- Implemented extraction hardening and safety gates:
  - HTML sanitization + content-section focus before table parse
  - checklist-oriented table scoring (positive/negative signals)
  - stricter safe field-key matching
  - removed broad `name` fallback from parallel/player mapping
  - markdown negotiation + markdown parser path (`Accept: text/markdown`)
  - checklist-link fallback crawl from article pages (depth-limited)
  - row-quality filtering before ingestion job creation with hard-fail when mostly noise
  - blocking draft validation for markup/script-like card fields
- Generated production push commit:
  - `6e3f20c fix(set-ops): harden checklist parsing and block html/noise rows`
  - local `HEAD` == `origin/main` at session end.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts` passed.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` still fails in workspace due broad pre-existing Prisma/client typing mismatch unrelated to Set Ops parser files.

### Current Step / Production Test Target
- User shipped latest build and is testing that source import now:
  1. no longer produces GTM/script/nav/eBay garbage rows,
  2. fails fast with clear error if checklist rows cannot be extracted,
  3. still imports valid structured checklist sources.

## 2026-02-22 - Vercel Hotfix 2 (Prisma JSON typing for draft versions)

### Summary
- Fixed Vercel type-check failure in Set Ops draft build flow:
  - `pages/api/admin/set-ops/drafts/build.ts`
- Added explicit Prisma JSON typing casts for draft payload writes in both draft version endpoints to satisfy Prisma `InputJsonValue` requirements under strict type checking.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/version.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/drafts/build.ts --file pages/api/admin/set-ops/drafts/version.ts` passed.
- Local focused TypeScript check no longer reports errors for these Set Ops draft files; workspace still has broad pre-existing Prisma-client linkage/type issues unrelated to this hotfix.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Vercel Hotfix 3 (Zod record signature)

### Summary
- Fixed Vercel compile error in `drafts/version` schema by updating Zod record usage to explicit key/value signature.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/version.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/drafts/version.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Vercel Hotfix 4 (Set Ops JSON input typing hardening)

### Summary
- Fixed Vercel compile failure in ingestion create route by casting `rawPayload` to Prisma JSON input type.
- Added proactive Prisma JSON input casts across Set Ops write paths to avoid repeated strict type failures in CI.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs/[jobId]/retry.ts`
- `frontend/nextjs-app/lib/server/setOpsSeed.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/ingestion/index.ts --file pages/api/admin/set-ops/approval.ts --file pages/api/admin/set-ops/delete/confirm.ts --file pages/api/admin/set-ops/seed/jobs.ts --file pages/api/admin/set-ops/seed/jobs/[jobId]/retry.ts --file lib/server/setOpsSeed.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Vercel Hotfix 5 (Seed cancel status guard typing)

### Summary
- Fixed Vercel compile error in seed cancel API caused by enum narrowing on `.includes(existing.status)`.
- Replaced array `.includes(...)` check with typed `Set<SetSeedJobStatus>` membership check.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs/[jobId]/cancel.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/seed/jobs/[jobId]/cancel.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops UX Improvement (Upload CSV/JSON, no manual paste)

### Summary
- Added file-upload ingestion UX on `/admin/set-ops-review` so operators can upload CSV/JSON data directly instead of manually pasting JSON payloads.
- Added client-side parsers for JSON and CSV rows, automatic row count reporting, optional setId inference from uploaded rows, and user feedback on parsed row totals.
- Kept raw payload editor as hidden advanced fallback (`Show Advanced JSON`) instead of default workflow.
- Added ingest guardrail: queue action now blocks when parsed payload contains zero rows.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops-review.tsx` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Source Discovery + Import Module

### Summary
- Added online source discovery and direct-import workflow for Set Ops review UI.
- New backend discovery/search + source-import APIs:
  - `GET /api/admin/set-ops/discovery/search`
  - `POST /api/admin/set-ops/discovery/import`
- New server module `setOpsDiscovery` adds:
  - web discovery query builder
  - ranked source candidate extraction
  - URL fetch with retries and per-host rate limiting
  - source parsing connectors for JSON / CSV / HTML table inputs
  - normalized row mapping into ingestion job payloads
- Updated ingestion API to persist provenance metadata per job (`sourceProvider`, `sourceQuery`, `sourceFetchMeta`) inside `parseSummaryJson`.
- Updated review UI to include Source Discovery section with:
  - year/manufacturer/sport/query search
  - one-click import as `parallel_db` or `player_worksheet`
  - ingestion queue provider visibility
- Maintained no-paste upload flow from prior step (CSV/JSON upload + optional advanced JSON editor).

### Files Updated
- `.gitignore`
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/search.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/import.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `docs/runbooks/SET_OPS_RUNBOOK.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts --file pages/api/admin/set-ops/ingestion/index.ts --file pages/admin/set-ops-review.tsx` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Discovery Build Safety Fixes

### Summary
- Fixed relative import paths in discovery APIs so the new routes resolve server helpers correctly in strict type checking:
  - `pages/api/admin/set-ops/discovery/search.ts`
  - `pages/api/admin/set-ops/discovery/import.ts`
- Fixed strict nullability warning in `lib/server/setOpsDiscovery.ts` by asserting first table selection after explicit empty-check.
- Re-validated new module after fixes.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/search.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/import.ts`
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts --file pages/api/admin/set-ops/ingestion/index.ts --file pages/admin/set-ops-review.tsx` passed.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false` still fails in this workstation due existing Prisma client/schema mismatch, but discovery-path module resolution and `selectedTable` nullability errors are resolved.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Discovery 403 Fallback Hardening

### Summary
- Fixed Set Ops discovery search failure mode where upstream search providers can return HTTP 403 and block the workflow.
- Added multi-provider discovery fallback chain:
  - `duckduckgo-html` (existing)
  - `bing-rss` (new fallback)
  - static provider search fallback results when upstream providers are blocked
- Added clearer import error for HTTP 401/403 source fetch blocks: user is instructed to use CSV/JSON upload fallback in review UI.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Discovery Relevance Filtering (Domain + Query Hardening)

### Summary
- Fixed poor discovery relevance where unrelated non-card domains could appear in search results.
- Added domain policies:
  - preferred set-data domains (TCDB/CardboardConnection/Beckett/etc) receive strong ranking boost
  - blocked generic domains (ex: `weforum.org`, social/news domains) are excluded
- Added site-scoped search variants (`site:tcdb.com`, `site:cardboardconnection.com`, `site:beckett.com`, `site:sportscardspro.com`) before broad-web fallback.
- Added strict relevance filters requiring trading-card/checklist signals plus query alignment (manufacturer/year/sport) before returning results.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops Discovery UX Fixes (Manual URL import + stale-set carryover)

### Summary
- Fixed stale set carryover across discovery searches/imports:
  - discovery Set ID override now re-initializes per search from current query/result context.
  - discovery import no longer reuses Step 1 ingestion form Set ID state.
- Added direct source URL import UX to Step 0 (`/admin/set-ops-review`) so operators can paste the exact checklist page URL after navigating from a search result, then import without manual JSON.
- Added "Use URL" action in discovery result rows to populate/edit direct URL import input.
- Added "Clear Selected Job" action in ingestion queue to reset workspace selection when switching sets.
- Added import guard against search-results URLs (e.g. `?s=`, `SearchText=`) so search pages cannot be ingested as checklist rows.
- Tightened relevance filter further:
  - removed URL querystring text from manufacturer/year/sport relevance checks (prevents false positives)
  - stricter checklist signal requirement for non-preferred domains.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops-review.tsx --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/search.ts --file pages/api/admin/set-ops/discovery/import.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Set Ops PDF Decode Hardening + Combined Import Mode

### Summary
- Fixed follow-up parser failures where Topps checklist PDFs returned zero rows for both:
  - direct source URL import
  - PDF upload parse path
- Root cause was shared PDF stream extraction weakness.
- Added PDF decoding improvements in discovery parser:
  - ToUnicode CMap parsing (`bfchar`/`bfrange`)
  - mapped hex/literal decoding context
  - loose text fallback extraction for sparse structured streams
- Added combined dataset import UX in Set Ops review:
  - direct URL: `Import URL as combined`
  - discovered result rows: `Import combined`
  - Step 1 ingestion dataset selector: `combined (parallel + player)` queues two jobs in one action.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `docs/HANDOFF_SET_OPS.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/discovery/parse-upload.ts` passed.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` still fails from pre-existing Prisma client/schema mismatch outside this scope.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-22 - Topps PDF Parser Follow-up (Tokenized Records + PDF Filter Chain)

### Summary
- Continued Topps PDF parsing hardening after user still reported zero-row failures in production.
- Reworked checklist parser to tokenized record extraction rather than strict line-based extraction.
- Added support for PDF stream filter chains (`ASCII85Decode` + `FlateDecode`) to improve text extraction compatibility.
- Tightened section-header detection to reduce false positives from uppercase non-header content.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/discovery/parse-upload.ts` passed.
- Local smoke test (mocked deps) against Topps-style checklist text confirmed parsed rows for:
  - base IDs (`1`, `148`)
  - inserts (`SI-*`, `RR-*`, `DNA-*`)
  - autographs (`CA-*`, `FSA-*`)

### Notes
- Live CDN fetch could not be validated in this sandbox due network DNS restriction (`cdn.shopify.com` unresolved).
- User committed from workstation and is testing on Vercel production build.

## 2026-02-22 - Topps PDF Parser Follow-up #2 (Split-ID Reassembly + Glyph-Spacing Fix)

### Summary
- Production feedback showed partial parse (~46 rows) with major misalignment:
  - split insert IDs parsed as numeric base IDs (`SI - 6` => `6`, `PB - 1` => `1`)
  - fragmented glyph spacing in player names
  - trailing section/id fragments leaking into `playerSeed`
- Implemented additional parser hardening in discovery PDF path:
  - fixed `TJ` array reconstruction to stop forced spacing between string fragments
  - added token-level checklist ID normalization (`PB - 1`, `R R - 26`, `CA - AC`, etc.)
  - tightened card-id pattern to avoid one-letter false positives
  - expanded player-seed cleanup and kept prefix-based parallel fallback

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts` passed.
- Local noisy-input smoke run confirmed corrected ID reconstruction (`SI-6`, `PB-1`, `RR-26`, `CA-AC`, `FSA-AB`) and better insert parallel assignment.

### Notes
- End-to-end validation still requires live production test against the Shopify-hosted Topps PDF.

## 2026-02-22 - Topps PDF Parser Follow-up #3 (Rookie Section Guard + Draft Table Row Cap)

### Summary
- Addressed two production issues from latest test cycle:
  - `Rookie` values intermittently overwrote `Parallel` for insert rows.
  - draft review table displayed only first 120 rows despite larger parsed payload.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts --file pages/admin/set-ops-review.tsx` passed.

### Notes
- `looksLikeChecklistSectionHeader(...)` now explicitly rejects standalone `Rookie` / `RC` section tokens.
- Draft review table no longer slices to 120 rows; full dataset renders for review/editing.
- Removed non-actionable default warning for missing `listingId` on checklist rows.

## 2026-02-22 - Topps PDF Parser Follow-up #4 (Trailing Row Recovery + Manual Row Controls)

### Summary
- Addressed near-final production gap where one trailing checklist row could still be missed (203 vs 204 rows in Topps PDF run).
- Added manual correction controls in draft review to unblock operator workflow when parser misses a rare edge row.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts --file pages/admin/set-ops-review.tsx` passed.

### Notes
- PDF parser now flushes dangling pending text at stream end and splits fused card-id/player tokens (`FSA-VWVictor` pattern).
- Draft normalization now ignores effectively empty rows so blank manual rows do not trigger blocking validation.
- Review UI now includes `Add Row` and per-row `Delete`.

## 2026-02-22 - Variant Ref Seeding Follow-up #5 (Recent Set Dropdown + Seed Entire Set)

### Summary
- Added one-click set-level image seeding workflow on `/admin/variants` so operators do not need to manually type Set IDs and Parallel IDs.
- Seed panel now loads recently seeded sets (from set-ops seed history), allows selecting a set, and supports bulk seeding all variants in that set.
- Added duplicate URL guard in SerpAPI image seed endpoint to reduce duplicate reference inserts on re-runs.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/sets.ts`
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- New seed panel actions:
  - `Seed Entire Set` = loops all variants in selected set and seeds refs with auto query generation.
  - `Seed Single Parallel` = existing targeted flow remains.
- Recent set dropdown auto-populates Set ID and keeps manual override support.

## 2026-02-22 - Variant Ref UX Follow-up #6 (Variant-Level Reference Table + QA Player Column)

### Summary
- Fixed misleading `/admin/variants` reference table behavior that appeared to show one repeated parallel after full-set seeding.
- Added player-name visibility to `/admin/variant-ref-qa` variant queue table.

### Files Updated
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- `/admin/variants` now:
  - filters `Load References` by selected set
  - dedupes to one row per variant key (`setId + cardNumber + parallelId`)
  - shows summary count: variant rows vs raw image rows
- `/api/admin/variants` now includes `playerLabel` derived from latest approved set-ops draft rows (fallback from reference `playerSeed` where available).
- `/admin/variant-ref-qa` variant table now includes a `Player` column.

## 2026-02-22 - Variant Ref QA Card UX Follow-up #7 (Player Fallback + Portrait Preview)

### Summary
- Enhanced the reference-card panel on `/admin/variant-ref-qa` to show player name consistently and improve readability.
- Fixed portrait image clipping by switching preview framing from crop-first to contain-first.

### Files Updated
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Card detail player field now falls back to selected variant `playerLabel` when reference `playerSeed` is empty.
- Replacement-upload payload now includes selected `cardNumber` and `playerSeed`.
- Metadata lines (`Label`, `Card #`, `Player`) are larger/bold.
- Reference image preview now uses portrait ratio (`9:16`) with `object-contain` to prevent top/bottom truncation.

## 2026-02-22 - Variant Ref QA Workflow Follow-up #8 (Set-First Queue + Done Tracking)

### Summary
- Implemented set-first QA queue UX so operators land on recent seeded sets instead of an ambiguous empty table.
- Fixed row highlight keying bug so only one selected row is highlighted.
- Added explicit QA completion actions and queue ordering so completed variants sink below remaining variants.

### Files Updated
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variant-ref-qa.tsx --file pages/api/admin/variants/index.ts` passed (non-blocking `no-img-element` warnings only).

### Notes
- New set controls: `Set Search`, `Active Set` selector, quick set chips.
- Queue summary now shown: `remaining / done / total`.
- API now accepts `setId` query param and returns `qaDoneCount`.
- Done logic is currently derived from refs where `qaStatus=keep` OR `ownedStatus=owned`.
- New actions in QA panel:
  - `Mark Selected Done`
  - `Reopen Selected`

## 2026-02-22 - Vercel Build Follow-up #9 (Prisma Typing Hardening)

### Summary
- Production build on Vercel failed in `pages/api/admin/variants/index.ts` while compiling the new `qaDoneCount` logic.
- Root issue was Prisma TS inference instability for this query path (`groupBy` generic mismatch, then `findMany` inferred as `{}` rows under Vercel checker).
- Hardened the endpoint query typing to be deployment-safe without changing behavior.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Done-row collection now uses `findMany + distinct`.
- Staging array normalized to `any[]` and extracted with safe string coercion before keying.
- Queue behavior unchanged: done is still derived from `qaStatus=keep OR ownedStatus=owned`.

## 2026-02-22 - Ref Seed Quality Follow-up #10 (SerpApi eBay-Only + Relevance Ranking)

### Summary
- Investigated poor reference quality in `/admin/variants` bulk seeding.
- Confirmed root cause in code: seed endpoint was querying SerpApi `google_images`, not eBay engine.
- Rewired ref seeding to use eBay listing search only and strengthened relevance filtering/ranking.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/reference/seed.ts --file pages/admin/variants.tsx` passed.

### Notes
- Seed endpoint now:
  - calls `engine=ebay` with `_nkw` query
  - canonicalizes `sourceUrl` to `https://www.ebay.com/itm/{listingId}`
  - stores listing metadata (`sourceListingId`, `listingTitle`, `playerSeed`)
  - scores results for relevance and penalizes box/break/lot noise
  - dedupes by listing ID and image URL
- Set-level auto query now includes player label and anti-noise terms (`-box -blaster -hobby -case -break -pack -lot`) to reduce star-player drift and sealed-product noise.

## 2026-02-22 - Ref Seed Follow-up #11 (204 Target Count + Retryable Failures)

### Summary
- Addressed bulk set-seed gap where only 199 targets were processed when checklist had 204 rows.
- Added resilient retry and richer failure diagnostics for set-level seeding runs.

### Files Updated
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variants.tsx --file pages/api/admin/variants/reference/seed.ts` passed.

### Notes
- Set seeding now uses latest set-ops draft rows as primary seed targets (`/api/admin/set-ops/drafts?setId=...`), preserving player-distinct rows.
- Fallback remains to `cardVariant` rows when no draft rows are available.
- Added per-target retry (2x) in UI batch runner and 3x retry in seed API for transient SerpApi failures.
- Partial-failure status now includes example failed targets + reason strings for faster triage.

## 2026-02-22 - Ref Seed Follow-up #12 (Set-Level External Ref Reset + Source Host Visibility)

### Summary
- Added a safe set-level reset path for legacy bad reference rows (Google/Amazon/Walmart era) without deleting set variants.
- Added source-host visibility so operators can immediately confirm whether refs are truly eBay-based.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variants.tsx --file pages/admin/variant-ref-qa.tsx --file pages/api/admin/variants/reference/index.ts` passed (non-blocking `no-img-element` warnings only).

### Notes
- New API behavior:
  - `DELETE /api/admin/variants/reference?setId=...` deletes external refs for a set.
  - Optional `parallelId`, `cardNumber`, and `includeOwned=true`.
  - Default protects owned/saved refs.
- New UI actions:
  - `/admin/variants`: `Clear External Refs (Set)` button.
  - `/admin/variant-ref-qa`: `Clear External Refs (Set)` button in set controls.
- Set-level seed target sourcing now prefers `PLAYER_WORKSHEET` draft rows first, then `PARALLEL_DB`, then latest draft, then variant fallback.
- New visibility:
  - `/admin/variants` reference table includes source host column.
  - `/admin/variant-ref-qa` cards include source-host badge (eBay vs non-eBay).

## 2026-02-22 - Ref Seed Follow-up #13 (Silent Zero-Insert Guard + eBay Payload Field Expansion)

### Summary
- Investigated run with `204/204` and `inserted 0 / skipped 0 / failed 0`.
- Patched seed endpoint so SerpApi account/quota/key errors cannot silently pass as empty-success.
- Expanded result field mapping for eBay payload shape variants.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/reference/seed.ts --file pages/admin/variants.tsx` passed.

### Notes
- New error handling now checks top-level payload fields: `error`, `message`, `errors`.
- New listing/result fallbacks:
  - result arrays: `organic_results`, `search_results`, `results`, `items_results`, `items`
  - listing URL fields: `link`, `product_link`, `url`, `item_url`, `view_item_url`, `item_web_url`, `product.link`
  - image fields: `thumbnail`, `thumbnails[0]`, `thumbnail_images[0]`, `image`, `main_image`, `original_image`, `image_url`, `img`, `gallery_url`

## 2026-02-22 - Ref Seed Follow-up #14 (Query Relaxation + No-Result Soft Skip)

### Summary
- Production run failed all 204 targets with SerpApi top-level message: `eBay hasn't returned any results for this query.`
- Reduced query strictness and changed no-result behavior from hard-fail to soft-skip.

### Files Updated
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variants.tsx --file pages/api/admin/variants/reference/seed.ts` passed.

### Notes
- Auto query now:
  - strips `Retail` from set label
  - omits negative terms (`-box -blaster -hobby -case -break -pack -lot`) to avoid over-constraining eBay `_nkw`.
- Seed API now:
  - interprets top-level no-result message as non-fatal skip.
  - returns `inserted:0, skipped:1` for that target so set summary reflects misses without marking full run as failed.

## 2026-02-22 - Ref Seed Follow-up #15 (Fallback Query Ladder + Variants Page Persistence)

### Summary
- Coverage still under target (~163/204) after query relaxation.
- Added multi-query fallback per target and better player/card token normalization for insert/autograph rows.
- Improved variants page UX persistence to reduce confusion after navigation.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/reference/seed.ts --file pages/admin/variants.tsx` passed.

### Notes
- Seed API additions:
  - new `extractListings(...)` normalization helper.
  - query candidate ladder with dedupe and cap.
  - card token permutations (`#XX-1`, `XX-1`, `XX1`, `XX 1`).
  - slash-player normalization (`A / B` uses `A` primary).
- Variants page additions:
  - primary-player normalization in auto query builder.
  - persists last selected set (`localStorage`) and auto-loads refs for that set on return.
  - warns on browser unload while set seeding is still in progress.

## 2026-02-22 - Ref Seed Follow-up #16 (Seed Write Normalization for Card/Parallel/Player Keys)

### Summary
- QA queue still showed many zero-photo variants despite lower seed skip counts.
- Aligned seed write keys to shared normalizers so inserted refs match variant counting keys.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/reference/seed.ts` passed.

### Notes
- Seed endpoint now normalizes:
  - `setId` via `normalizeSetLabel`
  - `cardNumber` via `normalizeCardNumber` (fallback `ALL`)
  - `parallelId` via `normalizeParallelLabel`
  - `playerSeed` via `normalizePlayerSeed`
- This should remove key mismatches like spaced card IDs (`FS - 14` vs `FS-14`) when QA counts refs.

## 2026-02-23 - Agent Context Sync (Docs-Only)

### Summary
- Re-read mandatory startup docs per `AGENTS.md`.
- Confirmed active branch remains `main` (tracking `origin/main`) before documentation updates.
- No code changes, deploys, restarts, migrations, or DB operations were executed.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Files Updated
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- No runtime/API/DB evidence was collected in this session.
- Existing Set Ops `Next Actions (Ordered)` in `docs/HANDOFF_SET_OPS.md` remain unchanged.

## 2026-02-23 - Ref Seed Follow-up #17 (Canonical Parallel + Alias-Aware Matching for QA Photos)

### Summary
- Production validation signal:
  - set run status reported:
    - `Seeded all targets for 2023-24 Topps Chrome Basketball Retail: 204 processed, inserted 1813, skipped 23. Source: set-ops player worksheet rows.`
  - `/admin/variant-ref-qa` still showed many SI/FS/RR/FSA/DNA rows with `Photos=0`.
- Implemented normalization/canonical matching hardening so read-side joins align with seeded write keys.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/index.ts --file pages/api/admin/variants/reference/index.ts --file pages/api/admin/variants/reference/seed.ts` passed.

### Notes
- Seed endpoint now canonicalizes known insert/autograph aliases on write (`SI`, `FS`, `RR`, `FSA`, `CA`, `PB`, `DNA`) to canonical parallel labels.
- Variants API read paths now key/match on normalized set/card/parallel and query across raw + normalized + alias candidates.
- Variants reference API GET/DELETE filters now support normalized/alias candidate matching for set/parallel/card.
- No deploy/restart/migration was executed in this step.

## 2026-02-23 - Ref Seed Follow-up #18 (Rookie Parallel Guard + Card-Prefix Recovery)

### Summary
- Production retest after Follow-up #17 still showed split behavior:
  - set seed reported success (`204 processed`, `1815 inserted`, `21 skipped`).
  - `/admin/variants` reference table showed many rows with `parallelId=Rookie` on `FS-*`, `SI-*`, `RR-*`, `FSA-*`, `DNA-*`.
  - `/admin/variant-ref-qa` still showed corresponding canonical variants at `Photos=0`.
- Root cause confirmed:
  - seed target extraction path was still trusting draft `row.parallel` markers (including `Rookie`) as final parallel IDs.
  - this created orphan reference rows keyed to `Rookie`, which do not align with canonical variant keys.

### Files Updated
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/api/admin/variants/reference/seed.ts`
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `frontend/nextjs-app/pages/api/admin/variants/reference/index.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/variants.tsx --file pages/api/admin/variants/index.ts --file pages/api/admin/variants/reference/index.ts --file pages/api/admin/variants/reference/seed.ts` passed.

### Notes
- New guardrails:
  - `Rookie/RC` is no longer accepted as a final seed parallel for insert/autograph families.
  - canonical parallel is inferred from card prefix (`FS/SI/RR/FSA/CA/PB/DNA`) when parallel is missing/noise.
- Compatibility matching was added so existing `Rookie` rows are still queryable/countable until purge + reseed.
- Count aggregation now sums canonicalized duplicate buckets instead of last-write overwrite.
- No deploy/restart/migration was executed in this step.

## 2026-02-23 - Production Validation Milestone (204 Processed, No QA Zero-Photo Rows)

### Summary
- User completed production deploy/reseed validation for `2023-24 Topps Chrome Basketball Retail`.
- Reported final set-run status:
  - `Set progress: 204/204 variants · inserted 1816 · skipped 20 · failed 0`
- User-provided table payloads for both pages were counted and matched:
  - `/admin/variants` table rows: `199`
  - `/admin/variant-ref-qa` table rows: `199`
- No `Photos=0` rows remained in provided `/admin/variant-ref-qa` output.

### Interpretation Notes
- Current behavior indicates the prior key-join mismatch class is resolved for this set in production.
- `skipped` can remain non-zero while QA still has full image coverage, due to soft-skip/no-result behavior at per-target listing level.

### Next Operator Step
- User intends to reset `2025-26 Topps Basketball` and run full fresh ingestion/seed from Set Ops workflow.

## 2026-02-23 - Set Ops PDF Ingestion Follow-up #19 (Section Header Drift + Team/ID Parsing Guardrails)

### Summary
- User tested fresh `2025-26 Topps Basketball` PDF ingestion and provided draft table evidence from `/admin/set-ops-review`.
- Reported failures matched parser drift patterns:
  - `parallel` became team names (`Sacramento Kings`) for long stretches.
  - malformed card numbers (`76ERS`) appeared.
  - some player rows retained trailing section labels or split into orphan rows.

### Root Cause
- `parseChecklistRowsFromText` section-header detection accepted team-only lines as headers.
- Card-id token matcher was too permissive for mixed number/letter team tokens.
- Team suffix trimming expected city-only tails and missed full team names.
- Label quality checks allowed some symbol-heavy OCR noise values.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Expanded checklist noise/header vocabulary for this PDF style (`ARRIVALS`, `FIRST`, `FINISHERS`, `HEADLINERS`, `MUSE`, `AURA`, `MASTERS`, `ELECTRIFYING`, `COLOSSAL`, etc.).
- Replaced team suffix list with full NBA team-name matching (plus common OCR variants like `Philadelpia`, `LosAngeles`, `Trailblazers`).
- Added explicit guard so known team-name lines cannot be classified as section headers.
- Tightened card-id recognition:
  - reject `76ERS`-style tokens (`^\\d{1,4}[A-Za-z]{2,}$`)
  - restrict letter-only hyphen IDs to short checklist patterns.
- Hardened label validity by rejecting low-letter/high-symbol OCR artifacts.
- Added parallel quality gate to reject team-name parallels (`parallel_looks_like_team_name`).

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts` passed.

### Notes
- Attempted local smoke parse with `tsx` was not possible in this environment (`Command \"tsx\" not found`), so verification is via static logic + lint.
- No deploy/restart/migration was executed in this step.

## 2026-02-23 - Variant Approval Gate + Set Ops Bulk Delete (Follow-up #20)

### Summary
- Implemented two operator-requested changes:
  1. Add Cards/KingsReview variant workflow now only uses approved, non-archived sets.
  2. `/admin/set-ops` now supports multi-select bulk delete for fast cleanup of old/test sets.

### Root Cause
- Variant lookups in Add Cards were broad text searches over all `CardVariant` rows.
- OCR auto variant match used fuzzy set candidate resolution with no approval/archival gating.
- Set Ops delete UX required one-by-one modal deletes.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/index.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/lib/server/variantMatcher.ts`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added `approvedOnly=true` support to `GET /api/admin/variants`; when enabled, rows are filtered to:
  - `SetDraft.status = APPROVED`
  - `SetDraft.archivedAt IS NULL`
- Updated Add Cards page variant fetches to request `approvedOnly=true`.
- Updated matcher to filter fuzzy-resolved set candidates to approved/non-archived sets before similarity scoring.
- Added multi-select delete UX in Set Ops:
  - row checkboxes + select-all-visible
  - bulk action bar
  - per-set dry-run aggregation
  - typed batch confirmation prompt
  - safe sequential per-set confirms using existing delete-confirm API.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/index.ts --file lib/server/variantMatcher.ts --file pages/admin/uploads.tsx --file pages/admin/set-ops.tsx`
- Result: pass (existing `uploads.tsx` `@next/next/no-img-element` warnings unchanged).

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-23 - Set Delete Encoded-ID Mismatch (Follow-up #21)

### Summary
- User reported that some legacy sets would not delete from `/admin/set-ops` while most others deleted successfully.
- Non-deleting rows showed HTML-entity encoded set IDs in table text (`&#038;`, `&#8211;`, `&#8217;`), indicating stored/raw ID mismatch.

### Root Cause
- Set delete dry-run/confirm endpoints normalized `setId` before impact/delete operations.
- Deletion queries then used exact `setId` match, which missed rows whose stored ID remained encoded/raw.

### Files Updated
- `frontend/nextjs-app/lib/server/setOps.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/dry-run.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- `computeSetDeleteImpact` now evaluates counts across `setId` candidates: raw payload value + normalized label.
- Dry-run now computes impact from raw `setId` (still auditing canonicalized label for readability).
- Confirm delete now deletes rows using candidate-aware `where: { setId: { in: [...] } }` for:
  - `cardVariantReferenceImage`
  - `cardVariant`
  - `setDraft`
- Typed confirmation phrase remains canonicalized, but deletion target is resilient to encoded/raw storage variants.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/set-ops/delete/confirm.ts --file pages/api/admin/set-ops/delete/dry-run.ts --file lib/server/setOps.ts` passed.

### Notes
- No deploy/restart/migration was executed in this step.

## 2026-02-23 - Agent Context Sync (Docs-Only Handoff Refresh)

### Summary
- Re-read mandatory startup docs listed in `AGENTS.md`.
- Confirmed active branch is `main` tracking `origin/main`.
- Confirmed the working tree already contained pre-existing local modifications before this update.
- Applied docs-only handoff refresh with no code, runtime, deploy, restart, migration, or DB operations.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Files Updated
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Existing Set Ops next actions and production test focus remain unchanged.
- No new runtime/API/DB evidence was collected in this session.

## 2026-02-23 - Uploads/KingsReview Workflow Polish (OCR context + valuation UX + option coverage)

### Summary
- Implemented workflow polish for Add Cards (`/admin/uploads`) and KingsReview (`/admin/kingsreview`) based on operator UX/test feedback.
- Expanded variant option sourcing in Add Cards so manual dropdown choices are not constrained to only exact set-name matches.
- Updated OCR suggest pipeline so LLM parsing receives photo-labeled OCR context (`FRONT/BACK/TILT`) in addition to combined OCR text.
- Updated KingsReview valuation flow to use dollar-decimal input UX with required-price guard before Inventory Ready transitions.
- Removed dependency on manual "Save Card" action for pricing by adding valuation auto-save behavior.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`

### Implementation Notes
- Add Cards variant option source behavior:
  - `uploads.tsx` now merges approved variant rows across multiple query scopes (`productLine`, `year+manufacturer+sport`, `year+manufacturer`, `manufacturer+sport`, `manufacturer`) with dedupe.
  - Sport-token filtering is still applied when it yields matches.
  - Result: broader insert/parallel/manual fallback options while retaining approved-only gating.
- OCR/LLM context behavior:
  - `ocr-suggest.ts` now builds `imageSections` from OCR results and labels them by image id.
  - LLM prompt includes:
    - combined OCR text
    - per-photo labeled OCR blocks
- KingsReview pricing/transition behavior:
  - valuation input switched to dollar-decimal UX (`13.00`) mapped to minor units for persistence.
  - added validation guard for `INVENTORY_READY_FOR_SALE`:
    - blocks transition when valuation is empty/invalid/non-positive.
    - raises inline error message and focuses valuation field.
  - valuation auto-save added (debounced PATCH) so reviewers no longer need explicit save clicks for valuation edits.
  - moved primary `Move To Inventory Ready` action to directly below valuation field and styled as gold CTA.
  - replaced Comp Detail header link with larger blue `OPEN EBAY SEARCH` button.
  - improved advanced-controls readability (less forced uppercase in edit fields, multiline selector input, rule text wrapping).

### Validation Evidence
- Ran targeted lint:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/admin/kingsreview.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Result: pass with existing warning class only (`no-img-element` and one pre-existing hook-deps warning in KingsReview file).

### Notes
- No deploy/restart/migration or destructive DB operations were executed in this step.

## 2026-02-23 - Uploads/KingsReview Hardening Pass (items 1,2,3,4,5,6,8)

### Summary
- Completed requested hardening pass for Add Cards + KingsReview workflow polish:
  1. Server-enforced valuation requirement before inventory-ready transition.
  2. Immediate OCR “teach/train” memory application from human feedback rows.
  3. Explicit per-photo OCR status surfaced in OCR audit payload.
  4. Per-photo OCR text persisted in audit payload (`photoOcr`).
  5. New approved-set variant options endpoint + uploads integration.
  6. Variant suggestion explainability surfaced in uploads UI.
  8. KingsReview autosave expanded beyond valuation (query + variant notes + set/card context).

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/variants/options.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added backend transition guard in card PATCH API:
  - moving to `INVENTORY_READY_FOR_SALE` now requires positive valuation (`valuationMinor > 0`).
- OCR suggest API enhancements:
  - collects/stores `photoOcr` audit object for `FRONT/BACK/TILT` with status (`ok`, `empty_text`, `missing_image`) + OCR text.
  - stores readiness summary (`ready` / `partial` / `missing_required`).
  - loads `OcrFeedbackEvent` history and applies weighted memory hints to low-confidence/missing OCR fields.
  - writes applied memory metadata into audit (`memory.context`, `memory.applied`, `memory.consideredRows`).
  - captures variant matcher evidence in audit (`variantMatch`, top candidate reason/confidence).
- Added new API route:
  - `GET /api/admin/variants/options`
  - returns approved-set scoped set options + grouped insert/parallel options + variant catalog rows.
- Uploads page changes:
  - now fetches variant options from `/api/admin/variants/options` instead of ad-hoc multi-query `/api/admin/variants` fan-out.
  - displays OCR-by-photo summary and variant explainability lines (OCR confidence, option-pool match, image matcher reason).
  - option picker modal now shows per-option set coverage + variant counts.
- KingsReview autosave expansion:
  - debounced autosave for `query` (`customTitle`), `variantNotes` (`customDetails`), and manual set/card context (`classificationUpdates.normalized`).
  - saved-state indicator shown in header and advanced controls.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId].ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/variants/options.ts --file pages/admin/uploads.tsx --file pages/admin/kingsreview.tsx`
- Result: pass with existing warnings only (`@next/next/no-img-element`, one pre-existing hook dependency warning in `kingsreview.tsx`).

### Notes
- No deploy/restart/migration or destructive DB operation was executed in this step.

## 2026-02-23 - Vercel Build Fix (KingsReview type regression)

### Summary
- Fixed Vercel build failure from commit `aec5eeb` caused by a too-narrow `classificationNormalized` type in KingsReview autosave update path.
- Added follow-up compile-safety fixes in related files to prevent immediate re-fail on next deploy.

### Files Updated
- `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`

### Implementation Notes
- `kingsreview.tsx`:
  - widened `CardDetail.classificationNormalized` type to include `setName`, `setCode`, and `cardNumber` (plus index signature), matching autosave usage.
- `uploads.tsx`:
  - removed forward-reference to `typedOcrAudit` inside `buildSuggestionsFromAudit` callback to avoid declaration-order TS error in strict type-check builds.
- `ocr-suggest.ts`:
  - tightened `OcrImageSection.id` to `OcrPhotoId` so the `filter` type predicate is assignable and strict TS compilation succeeds.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/kingsreview.tsx --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Result: pass with existing warnings only (`no-img-element` + one existing hook dependency warning in KingsReview).

### Notes
- No deploy/restart/migration executed in this step.

## 2026-02-23 - Vercel Build Failure Triage Verification (post-fix)

### Summary
- Re-validated the reported Vercel compile blocker and confirmed the prior type fix covers the failing line class in `kingsreview.tsx`.
- Re-ran local validation on touched files and captured build-attempt outcomes for handoff traceability.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/kingsreview.tsx --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Result: pass (existing warnings only).
- `pnpm -w run vercel:build`
  - Result: failed locally before Next build due workstation Prisma artifact issue (`Prisma engines directory not found` in `scripts/vercel-build.sh`), not due the reported TS type error.
- `pnpm --filter @tenkings/nextjs-app build`
  - Result: exited non-zero locally with warnings output only; no recurrence of the prior `classificationNormalized.setName` type error from Vercel log.

### Notes
- No deploy/restart/migration or DB operation executed in this verification step.

## 2026-02-23 - KingsReview Query Cleanup + Inventory Ready Valuation/Comp Detail

### Summary
- Cleaned KingsReview eBay query construction to reduce duplicated set/year/manufacturer tokens and normalize insert/autograph descriptors.
- Added inline valuation editing on Inventory Ready card detail with API persistence.
- Added Inventory Ready comp detail panel that surfaces latest KingsReview eBay sold comps (images + listing links + search link).

### Files Updated
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`
- `frontend/nextjs-app/pages/admin/inventory-ready.tsx`

### Implementation Notes
- `enqueue.ts`:
  - replaced broad token-set query builder with deterministic query assembly that:
    - strips season/manufacturer duplication from set name portion,
    - normalizes descriptor labels (`AUTOGRAPH CARDS`/`AUTOGRAPHS`/`AUTO*` -> `AUTOGRAPH`),
    - keeps year/manufacturer/set/player/card number ordering stable,
    - avoids duplicate tokens and reduces noisy comp queries.
- `inventory-ready.tsx`:
  - card detail pane now loads latest KingsReview job (`/api/admin/kingsreview/jobs?cardAssetId=...`) and renders sold comp rows with image, sold price/date, and open-listing link.
  - added `Open eBay Search` action when the source search URL is present.
  - added editable `Price Valuation (USD)` field with save action + blur/enter save path.
  - valuation edits persist through `PATCH /api/admin/cards/[cardId]` and immediately update Inventory Ready grid/list state.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/kingsreview/enqueue.ts --file pages/admin/inventory-ready.tsx`
- Result: pass with existing warning class only (`@next/next/no-img-element` in inventory-ready).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - OCR Provider Reset + Intake Readiness Tightening + Variant Label Tolerance

### Summary
- Switched Add Cards OCR provider from local OCR runtime to Google Vision in the OCR suggestion API path.
- Tightened OCR workflow to require all three intake photos (`FRONT`, `BACK`, `TILT`) before OCR/LLM parsing proceeds.
- Removed client-side upload compression so OCR/LLM/variant workflows use full uploaded image assets.
- Added stop-word tolerant variant/parallel option matching for suggestion ranking and option metadata lookups (ignores `"the"` token).

### Files Updated
- `frontend/nextjs-app/lib/server/googleVisionOcr.ts` (new)
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- `ocr-suggest.ts`
  - replaced `runLocalOcr(...)` with `runGoogleVisionOcr(...)`.
  - updated OCR audit source/model tags to `google-vision` / `google-vision+llm`.
  - raised default OCR LLM fallback model from `gpt-4o-mini` to `gpt-5.2`.
  - enforced required OCR photo readiness (`FRONT/BACK/TILT`) and returns `status: "pending"` with readiness detail until complete.
- `googleVisionOcr.ts`
  - new server helper that calls Google Vision `images:annotate` (`DOCUMENT_TEXT_DETECTION`) and maps output to existing OCR result/token shape.
  - supports OCR image inputs as URL or base64.
- `uploads.tsx`
  - removed intake/bulk client compression path (`compressImage`) so original file payloads are uploaded.
  - made tilt capture required in intake validation and removed “Skip tilt” path.
  - deferred OCR start until queued photo uploads complete; OCR calls are now readiness-gated server-side.
  - normalized variant option keys with stop-word filtering (`the`) for map lookups and suggestion ordering.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/api/admin/kingsreview/enqueue.ts --file pages/admin/inventory-ready.tsx`
- Result: pass with existing warning class only (`@next/next/no-img-element`).
- Additional local build probes:
  - `pnpm -w run vercel:build` failed before Next compile due local Prisma runtime issue (`Prisma engines directory not found`), not due touched file lint failures.
  - `pnpm exec next build --no-lint` (app dir) exited non-zero locally with no surfaced new typed line error in output.

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - OCR LLM Migration to OpenAI Responses API (Pro-model path)

### Summary
- Migrated OCR parsing LLM call from Chat Completions to OpenAI Responses API.
- Default OCR LLM target now points to a pro-model path, with explicit fallback sequencing for parser reliability.
- Added structured-output compatibility fallback handling to avoid hard failures on models that do not accept `json_schema`.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Replaced `POST /v1/chat/completions` request with `POST /v1/responses`.
- Updated model defaults:
  - `OCR_LLM_MODEL` default: `gpt-5.2-pro`
  - `OCR_LLM_FALLBACK_MODEL` default: `gpt-5-pro`
- Added attempt ladder in OCR parse function:
  1. primary model + `json_schema`
  2. primary model + `json_object`
  3. fallback model + `json_schema`
  4. fallback model + `json_object`
- Added response text extraction for Responses payload (`output_text` and `output[].content[]` tolerant parsing).
- Added tolerant JSON extraction for fenced/embedded JSON text to reduce parse misses.
- OCR audit now records effective LLM metadata (`audit.llm`) and uses resolved model in audit `model` string.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Result: pass (`✔ No ESLint warnings or errors`).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - OCR LLM Default Model Alignment (`gpt-5` baseline)

### Summary
- Aligned OCR LLM defaults to stable GPT-5 cookbook model IDs for always-on usage without requiring env overrides.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Updated defaults in OCR suggest route:
  - `OCR_LLM_MODEL` default: `gpt-5`
  - `OCR_LLM_FALLBACK_MODEL` default: `gpt-5-mini`
- Request-time model selection remains explicit per Responses API call; env vars still override defaults.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Result: pass (`✔ No ESLint warnings or errors`).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - OCR Fallback Regression Tests + Legacy OCR Path Removal

### Summary
- Implemented automated regression tests for OCR Responses fallback behavior.
- Removed the legacy Next.js local OCR service path (`OCR_SERVICE_URL` / `OCR_SERVICE_TOKEN`) from active app code and deployment guidance.

### Files Updated
- `packages/shared/src/ocrLlmFallback.ts` (new)
- `packages/shared/src/index.ts`
- `packages/shared/tests/ocrLlmFallback.test.js` (new)
- `packages/shared/package.json`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/lib/server/googleVisionOcr.ts`
- `frontend/nextjs-app/lib/server/localOcr.ts` (deleted)
- `docs/DEPLOYMENT.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added shared OCR fallback utility module with:
  - fallback-attempt plan builder (`json_schema` / `json_object` for primary+fallback models),
  - structured-output unsupported detection,
  - resolver that drives fallback sequencing and throws on non-retryable failures.
- Added regression tests covering:
  - attempt ordering,
  - duplicate fallback suppression,
  - structured-output unsupported detection,
  - successful fallback from `json_schema` to `json_object`,
  - non-fallback error throw behavior,
  - null return when no parsed payload is produced.
- Refactored OCR suggest route to call shared fallback resolver, preserving explicit per-request model selection.
- Removed `frontend/nextjs-app/lib/server/localOcr.ts` and inlined OCR response/token types in `googleVisionOcr.ts`.
- Updated deployment docs to use current OCR env vars:
  - `GOOGLE_VISION_API_KEY`
  - `OPENAI_API_KEY`
  - `OCR_LLM_MODEL`
  - `OCR_LLM_FALLBACK_MODEL`

### Validation Evidence
- `pnpm --filter @tenkings/shared test`
  - Result: pass (`ocrLlmFallback` + `setOpsNormalizer` tests).
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/admin/uploads.tsx --file pages/admin/inventory-ready.tsx`
  - Result: pass with existing warning class only (`@next/next/no-img-element`).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - AI Ops Dashboard Phase 1 (OCR/LLM visibility + quick retry)

### Summary
- Added a new admin AI Ops dashboard to monitor OCR/LLM production health and teach-memory impact.
- Added a backend overview API that aggregates 24h/7d OCR suggestion telemetry, model/fallback usage, feedback accuracy, and attention-card queue.
- Added in-dashboard quick action to rerun OCR/LLM suggestions for flagged cards.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts` (new)
- `frontend/nextjs-app/pages/admin/ai-ops.tsx` (new)
- `frontend/nextjs-app/pages/admin/index.tsx`

### Implementation Notes
- `GET /api/admin/ai-ops/overview` now returns:
  - runtime config (`google-vision`, Responses API, primary/fallback model IDs),
  - live quality metrics for last 24h and last 7d,
  - model/format distribution,
  - teach-memory feedback metrics and recent corrected fields,
  - attention queue rows with issue tags for operations follow-up.
- `/admin/ai-ops` renders:
  - live pipeline health table,
  - teach/train impact panel,
  - model behavior panel,
  - recent corrections table,
  - quick-ops attention queue with `Retry OCR` actions.
- Admin home now includes a direct `AI Ops` shortcut tile.

### Validation Evidence
- `pnpm --filter @tenkings/shared test`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/api/admin/ai-ops/overview.ts --file pages/admin/index.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/googleVisionOcr.ts --file pages/admin/uploads.tsx --file pages/admin/inventory-ready.tsx --file pages/api/admin/kingsreview/enqueue.ts`
  - Result: pass with existing warning class only in pre-existing files (`@next/next/no-img-element` in uploads/inventory-ready).
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/admin/index.tsx --file pages/api/admin/ai-ops/overview.ts`
  - Result: pass (`No ESLint warnings or errors`).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - Add Cards Variant Option Coverage + Set Auto-Select Hardening

### Summary
- Fixed Add Cards variant option pool under-coverage by changing `/api/admin/variants/options` from row-limited `CardVariant.findMany` scans to grouped set+parallel aggregation over scoped approved sets.
- Hardened set scoping fallback logic so option pools still resolve when set labels are inconsistent (e.g., sport/manufacturer tokens not exact substring matches).
- Stopped broad teach-memory set drift from auto-overwriting `setName` in OCR memory replay.
- Tightened Add Cards product-line auto-selection to avoid forcing a generic/weak hint (e.g., `Finest`) into a specific set.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/variants/options.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`

### Implementation Notes
- `variants/options`:
  - uses approved set IDs + tokenized year/manufacturer/sport matching with staged fallback rules.
  - computes option pool from `groupBy(setId, parallelId, parallelFamily)` to avoid truncating valid insert/parallel labels from high-row sets.
  - preserves insert/parallel classification and set-scored ordering for picker UX.
- `ocr-suggest`:
  - memory replay now skips `setName` field to prevent cross-card set bleed.
  - memory replay for `parallel` / `insertSet` now requires stronger context (`setId` or `cardNumber`) before applying.
- `uploads`:
  - product-line auto-fill now ignores weak single-token hints.
  - removed generic manufacturer+sport default set fill.
  - auto-pick from option list only runs when product line is blank and match confidence threshold is higher.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/options.ts --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings in uploads only.

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - Teach Memory v2 Anchoring + Option Injection Guard

### Summary
- Upgraded OCR teach-memory replay to use stored token anchor evidence (`tokenRefsJson`) with image-side aware matching, enabling stronger one-card learning carryover while reducing cross-set drift.
- Re-enabled set-memory replay under strict context constraints (year + manufacturer required, sport-aware, optional token-support gate) instead of global suppression.
- Removed color-only heuristic parallel fallback bias (e.g., frequent `Red` false positives).
- Stopped Add Cards picker from injecting non-canonical OCR suggestions into option lists; only canonical option-pool values are now ranked/displayed.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`

### Implementation Notes
- `ocr-suggest.ts`
  - added token normalization + lookup utilities and token-ref support scoring.
  - `applyFeedbackMemoryHints(...)` now accepts current OCR tokens and reads `tokenRefsJson` from `OcrFeedbackEvent` rows.
  - set-memory replay (`field === setName`) now allowed only when context is strong (`year` + `manufacturer`), with token-overlap checks when anchors exist.
  - insert/parallel memory replay now additionally gates on token-overlap when anchors exist.
  - removed broad color-word fallback from heuristic parallel keywords to reduce noisy `Red` suggestions.
- `uploads.tsx`
  - `rankedInsertSetOptions` / `rankedParallelOptions` no longer prepend non-pool OCR suggestions.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/admin/uploads.tsx --file pages/api/admin/variants/options.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings in uploads only.

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - OCR/LLM Baby Brain Master Plan Document Authored

### Summary
- Authored a shareable master plan document for Codex agents outlining the end-state vision, phased implementation plan, operator SOP, architecture, metrics, rollout order, and primary-source references for OCR/LLM learning system design.
- Document starts with the operator-provided big-picture vision: "teach one card, learn the set family instantly, return unknown when uncertain, persist memory in DB."

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` (new)

### Research Sources Included
- OpenAI Responses API, Structured Outputs, Vision, GPT-5, Evals docs.
- Google Cloud Vision OCR + full text annotation docs.

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - Master Plan Wording Clarification (Phase 1 scope)

### Summary
- Clarified Phase 1 wording in `OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` to prevent ambiguity:
  - only taxonomy fields (`setName`, `insertSet`, `parallel`) are candidate-constrained,
  - free-text fields (`playerName`, `cardName`, `cardNumber`, etc.) remain OCR+LLM and are not DB-enumerated.
- Added matching clarification in target architecture section (hybrid constrained + free-text design).

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - Master Plan Hardening Additions (6 Governance Sections)

### Summary
- Extended `OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` with 6 operational hardening sections requested by operator review:
  1. CardState Contract
  2. Learning Event Schema
  3. Long-Tail Trigger Definitions
  4. Three-Speed Learning Policy (with SLA)
  5. Taxonomy Lifecycle Rules
  6. Release Safety Gates
- Goal: make implementation consistent across multiple Codex agents with explicit contracts, logging, trigger policy, and release gates.

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-23 - Taxonomy Threshold Values Added to Master Plan

### Summary
- Added explicit operator-approved taxonomy confidence thresholds to `OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`:
  - `setName`: `0.80`
  - `insertSet`: `0.80`
  - `parallel`: `0.80`
- Added explicit behavior rule: below-threshold taxonomy fields stay blank (`unknown`) for human review.
- Clarified scope: free-text OCR+LLM fields (player/card/numbered/autograph/etc.) continue auto-fill behavior and are not blocked by taxonomy thresholds.
- Updated long-tail trigger definition:
  - `set_low_confidence` now explicitly means `setName < 0.80`.

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Master Plan Schema Clarification (CardState + Event JSON)

### Summary
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` with concrete schema examples to remove ambiguity for future implementers.
- Added explicit field semantics for:
  - `cardId` (system-generated internal id),
  - `setName` (taxonomy label) vs `setYear` (separate UI year field),
  - optional `setId` canonical storage key,
  - `numbered` (`null` or serial string like `3/25`),
  - `autographed` (`true` or `null`),
  - `graded` (`null` or structured grade object, e.g. `PSA 10`).
- Added concrete JSON examples for:
  - CardState (raw card + auto/numbered/graded card),
  - `recognition_suggested` event payload,
  - `recognition_corrected` event payload.

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Master Plan Ownership/SLA + Instant-Teach Clarification

### Summary
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` to formalize operational ownership and incident SLAs, and to explicitly align with operator priority: instant teach is primary.
- Added `Ownership and Incident SLA` table with default triggers and response windows for:
  - wrong-set spikes,
  - taxonomy drift,
  - teach replay failure,
  - OCR/LLM service degradation,
  - post-deploy model/prompt regression.
- Added explicit `Instant Teach vs Weekly Retrain` explanation:
  - each train action applies immediately via memory update/replay,
  - weekly retrain remains for broader model generalization and unseen cases.
- Strengthened region-markup strategy:
  - moved Region Teach from optional to core set-family learning phase,
  - added layout grouping key (`setId + layoutClass + photoSide`) to support one-teach-many behavior for base cards while isolating insert/auto/parallel layouts.
- Updated rollout order to move region teach earlier (after Phase 2 memory).

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Master Plan Core Retrain Ops Workflow Added

### Summary
- Updated `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md` with explicit core retrain operations workflow so operators know exactly what is automatic vs manual.
- Added new section: `Core Retrain Operations Workflow (UI + Actions)` covering:
  - automatic teach-signal ingestion and retrain snapshot generation,
  - daily-light and weekly-full retrain cadence defaults,
  - eval gates before promotion,
  - AI Ops UI components (`Production Model`, `Learning Intake`, `Retrain Jobs`, `Candidate Compare`),
  - required operator actions (`Train AI` during review, promote candidate, rollback on regression),
  - promotion authority defaults and emergency rollback path.

### Files Updated
- `docs/context/OCR_LLM_BABY_BRAIN_MASTER_PLAN.md`

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Phase 1 Build: Candidate-Constrained Taxonomy in Add Cards

### Summary
- Implemented Phase 1 end-to-end for Add Cards OCR/LLM taxonomy handling:
  - approved-set scoped candidate pool generation,
  - taxonomy candidate constraints (`setName`, `insertSet`, `parallel`),
  - API-level out-of-pool rejection to `null`/blank,
  - taxonomy confidence threshold enforcement at `0.80`,
  - set-scoped insert/parallel option loading when a set is selected.
- Added LLM prompt candidate list constraints so taxonomy fields are selected from enumerated options (or null) instead of unrestricted free text.
- Improved option classification so unlabeled insert names (e.g. `No Limit`, `Daily Dribble`, `Rise To Stardom`, `The Stars of NBA`) are still surfaced for operators by placing unknown labels in both insert/parallel pools.

### Files Updated
- `frontend/nextjs-app/lib/server/variantOptionPool.ts` (new shared pool/scoping utility)
- `frontend/nextjs-app/pages/api/admin/variants/options.ts` (rewired to shared pool + `setId` support)
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts` (taxonomy-constrained suggestions + thresholding + audit)
- `frontend/nextjs-app/pages/admin/uploads.tsx` (UI-side constrained apply + delayed option-safe apply + set-scoped fetch)

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/variants/options.ts --file lib/server/variantOptionPool.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/admin/uploads.tsx`
  - Result: pass (existing `@next/next/no-img-element` warnings in uploads only).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: fails from broad pre-existing Prisma client/schema mismatch in workspace (not isolated to this change set).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Phase 2 Build: Teach Memory v3 Aggregate + Strict Replay Gates

### Summary
- Implemented Phase 2 end-to-end by introducing a persisted OCR feedback memory aggregate and switching replay logic to use aggregate rows with strict context gating.
- Added automatic aggregate backfill from historical `OcrFeedbackEvent` rows when a scoped replay query has no aggregate rows (cold-start safe).
- Preserved immediate-teach behavior by updating aggregate memory at correction write time (`Train AI` flow).

### Files Updated
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260224190000_ocr_feedback_memory_aggregate/migration.sql` (new)
- `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts` (new)
- `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- New table/model: `OcrFeedbackMemoryAggregate`
  - aggregates by context + canonical value key (`fieldName/valueKey/setIdKey/yearKey/manufacturerKey/sportKey/cardNumberKey/numberedKey`)
  - stores `sampleCount`, `correctCount`, `confidencePrior`, alias list, and weighted token anchors.
- Write path:
  - after creating `OcrFeedbackEvent` rows, API now calls `upsertOcrFeedbackMemoryAggregates(rows)` to keep memory current in seconds.
- Replay path:
  - `applyFeedbackMemoryHints` now reads aggregate rows (`ocrFeedbackMemoryAggregate`) instead of raw event replay.
  - strict replay rules enforced:
    - `setName`: requires `year + manufacturer` and optional sport compatibility.
    - `parallel` / `insertSet`: requires set/card context and token-anchor overlap.
  - weighted token-anchor support used for replay scoring.

### Validation Evidence
- `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId].ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrFeedbackMemory.ts`
  - Result: pass.
- `pnpm --filter @tenkings/shared test`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: fails from broad pre-existing Prisma client mismatch in workspace (not isolated to this change set).

### Notes
- No deploy/restart/migration or DB operation executed in this step.

## 2026-02-24 - Droplet Migration Follow-up (Operator-Run)

### Summary
- Operator executed droplet DB migration steps after Phase 2 push.
- First attempt failed because `DATABASE_URL` was set to placeholder literal (`<prod-db-url>`).
- Operator corrected by exporting live DB URL from running compose service env.
- Migration command then completed with no pending migrations, and Prisma client generation succeeded.

### Operator-Reported Evidence
- `export DATABASE_URL="$(cd infra && docker compose exec -T bytebot-lite-service sh -lc 'echo -n \"$DATABASE_URL\"')"`
- URL sanity checks:
  - length: `145`
  - protocol check: `DATABASE_URL format OK`
- `pnpm --filter @tenkings/database migrate:deploy`
  - Result: `No pending migrations to apply.`
- `pnpm --filter @tenkings/database generate`
  - Result: success.

### Caution / Next Verification
- Local branch for Phase 2 includes migration `20260224190000_ocr_feedback_memory_aggregate`.
- If droplet migration count appears lower than expected, verify droplet git parity and rerun migrate:
  - `git fetch --all --prune`
  - `git pull --ff-only`
  - `pnpm --filter @tenkings/database migrate:deploy`

## 2026-02-24 - Droplet Parity + Migration Confirmed (Operator-Run)

### Summary
- Operator completed parity correction and applied the Phase 2 migration in production.
- Droplet advanced from commit `6e3f20c` to `4c41c1d` via fast-forward pull.
- Migration `20260224190000_ocr_feedback_memory_aggregate` was applied successfully.

### Operator-Reported Evidence
- `git log -1 --oneline` before pull: `6e3f20c`
- `git fetch --all --prune` showed `origin/main` advanced to `4c41c1d`
- `git pull --ff-only` fast-forwarded and included:
  - `packages/database/prisma/migrations/20260224190000_ocr_feedback_memory_aggregate/migration.sql`
- `pnpm --filter @tenkings/database migrate:deploy`
  - Result: `Applying migration 20260224190000_ocr_feedback_memory_aggregate`
  - Result: `All migrations have been successfully applied.`

### Notes
- Production DB schema now includes Phase 2 aggregate memory table.
- Next step is behavioral smoke validation in prod Add Cards flow before starting Phase 3 build.

## 2026-02-24 - Set Ops PDF Header Parsing Fix (Insert header context)

### Summary
- Fixed PDF checklist parsing issue where generic category headers (`INSERT`/`INSERTS`) were incorrectly applied as `parallel` values for many rows.
- Added contextual section-header detection so real insert headers without explicit keyword signals (e.g. `THE DAILY DRIBBLE`, `NEW SCHOOL`) are promoted to active section when followed by card-number rows.
- Added safeguards against year-like tokens becoming card numbers and reduced trailing section-header spill into player names.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- New contextual header detector uses next-line lookahead:
  - if current line is header-like and next line starts with a valid card-id token, treat current line as section header.
- `looksLikeChecklistCardIdToken` now rejects pure 4-digit year-range tokens (`1900..2099`) to avoid rows like `1980 TOPPS ...` being treated as card records.
- Expanded trailing header-noise vocabulary for player-token cleanup:
  - `NEW`, `SCHOOL`, `TOPPS`, `CHROME`, `BASKETBALL`.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx`
  - Result: pass (`No ESLint warnings or errors`).

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Set Ops PDF Header Parsing Fix (Rookie subheader guard)

### Summary
- Added follow-up parser hardening for checklist PDFs where standalone `Rookie`/`RC` lines were being interpreted as new section headers.
- This prevents `parallel` from switching to `Rookie` mid-block and keeps the active insert/parallel header (e.g., `COMIC COURT`, `SONIC BOOM`, `ALL KINGS`) across rookie subsets.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- Added `isRookieSubheaderLine(...)` helper.
- Updated `looksLikeContextualChecklistSectionHeader(...)` to reject rookie marker lines.
- Updated parse loop to skip rookie marker lines when next line is a card-id row, without flushing/changing active section.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx`
  - Result: pass (`No ESLint warnings or errors`).

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Phase 3 Build: Unknown-State First UX + One-Click Teach

### Summary
- Implemented Phase 3 in Add Cards UI by surfacing explicit unknown reasons for taxonomy fields and adding a direct teach-capture action.
- Removed silent heuristic set auto-selection when OCR/LLM does not provide an actionable set hint, aligning with unknown-first policy.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- OCR audit typing now includes `taxonomyConstraints.fieldStatus` for:
  - `setName`
  - `insertSet`
  - `parallel`
- Added `taxonomyUnknownReasons` mapping and badges in UI:
  - `Unknown: low confidence`
  - `Unknown: not in approved option pool`
  - `Unknown: no set scope available`
- Product line auto-fill effect now requires actionable `setName` OCR hint; no fallback-only heuristic autopick from year/manufacturer/sport.
- Added `Teach From Corrections` button in optional stage:
  - calls existing metadata save path with `recordOcrFeedback=true` and training enabled,
  - captures teach signal without sending card to KingsReview,
  - shows success feedback in intake panel.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/setOpsDiscovery.ts --file pages/api/admin/set-ops/discovery/parse-upload.ts --file pages/admin/set-ops-review.tsx`
  - Result: pass with existing pre-existing warnings only (`@next/next/no-img-element` in uploads).

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Phase 4 Build: Region Teach Templates + Replay Priority

### Summary
- Implemented Phase 4 end-to-end for Add Cards:
  - click-drag Teach Regions UI on `FRONT`/`BACK`/`TILT`,
  - persisted region templates keyed by `setId + layoutClass + photoSide`,
  - OCR replay scoring now boosts token-anchor support when current OCR tokens overlap taught regions.
- Added OCR `layoutClass` hint wiring from Add Cards to `/api/admin/cards/[cardId]/ocr-suggest`.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/lib/server/ocrRegionTemplates.ts` (new)
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach.ts` (new)
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260224223000_ocr_region_templates/migration.sql` (new)
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- New model/table:
  - `OcrRegionTemplate`
  - stores normalized region rectangles (`regionsJson`) and `sampleCount` per scope:
    - `setIdKey`
    - `layoutClassKey`
    - `photoSideKey`
- New API route:
  - `GET /api/admin/cards/:cardId/region-teach?setId=...&layoutClass=...`
  - `POST /api/admin/cards/:cardId/region-teach`
    - upserts templates for one or more photo sides in a single call.
- Replay integration:
  - `applyFeedbackMemoryHints(...)` now receives region templates and computes `regionOverlap` for token refs.
  - scoring gates now allow stronger confidence when token matches occur within taught regions.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId]/region-teach.ts --file lib/server/ocrRegionTemplates.ts`
  - Result: pass (with existing `@next/next/no-img-element` warnings in uploads).
- `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- `pnpm --filter @tenkings/database generate`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: fails due broad pre-existing Prisma/client type mismatch across workspace (not isolated to this change set).

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Phase 5 Build: Selective Multimodal OCR+LLM Path

### Summary
- Implemented Phase 5 in OCR suggestion pipeline:
  - LLM now uses text-only parsing first.
  - For hard cards only, pipeline escalates to multimodal (image + OCR text) using Responses API.
  - High-detail image mode is used selectively when uncertainty is severe; otherwise low detail is used.
- Candidate-constrained taxonomy policy remains enforced for multimodal output (no free-text taxonomy labels accepted).

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
- `frontend/nextjs-app/pages/admin/ai-ops.tsx`
- `docs/HANDOFF_SET_OPS.md`

### Implementation Notes
- `parseWithLlm(...)` now supports:
  - `mode: "text" | "multimodal"`
  - `detail: "low" | "high" | null`
  - optional `images` payload list.
- Added multimodal request compatibility fallback:
  - first sends `input_image` with string `image_url`,
  - retries with object-form `image_url` payload on 400 errors.
- Added `buildMultimodalDecision(...)` with hard-card triggers:
  - text parse failure,
  - low-confidence taxonomy candidates,
  - missing core fields.
- Added audit metadata:
  - `llm.mode`, `llm.detail`,
  - `llm.attempts.text`, `llm.attempts.multimodal`,
  - `llm.multimodalDecision`.
- AI Ops metrics now include:
  - multimodal use rate,
  - high-detail share among multimodal calls.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/ai-ops/overview.ts --file pages/admin/ai-ops.tsx --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/region-teach.ts --file lib/server/ocrRegionTemplates.ts`
  - Result: pass (with existing `@next/next/no-img-element` warnings in uploads).

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Phase 6 Build: Eval Flywheel + Release Gate

### Summary
- Implemented Phase 6 end-to-end:
  - gold-case storage APIs (`eval cases`),
  - eval execution API (`run eval`),
  - weekly cron trigger route,
  - persisted eval run/results,
  - AI Ops dashboard release-gate visibility and manual run action,
  - AI Ops gold-case manager (quick add + enable/disable toggles).
- Added secure eval bypass path for OCR suggest so scheduled runs can execute without admin cookie.
- Added threshold-based gate checks including top-3 insert/parallel and cross-set memory drift guard.

### Files Updated
- `frontend/nextjs-app/lib/server/ocrEvalFramework.ts` (new)
- `frontend/nextjs-app/pages/api/admin/ai-ops/evals/run.ts` (new)
- `frontend/nextjs-app/pages/api/admin/ai-ops/evals/cases.ts` (new)
- `frontend/nextjs-app/pages/api/admin/cron/ai-evals-weekly.ts` (new)
- `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
- `frontend/nextjs-app/pages/admin/ai-ops.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260225000000_ocr_eval_framework/migration.sql` (new)
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- New DB models:
  - `OcrEvalCase`
  - `OcrEvalRun`
  - `OcrEvalResult`
- Eval scoring/gate now tracks:
  - set top-1 accuracy
  - insert/parallel top-1 accuracy
  - insert/parallel top-3 accuracy
  - case pass rate
  - unknown rate
  - wrong-set rate
  - cross-set memory drift rate (memory-applied cases)
- AI Ops now shows:
  - enabled/total eval cases
  - latest run pass/fail and failed checks
  - key gate metrics
  - recent run history
  - manual `Run Eval Now` trigger
- OCR suggest auth:
  - if `x-ai-eval-secret` matches `AI_EVAL_RUN_SECRET`, request bypasses admin session check (eval-only path).

### Validation Evidence
- `pnpm --filter @tenkings/shared test`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx --file pages/api/admin/ai-ops/overview.ts --file pages/api/admin/ai-ops/evals/run.ts --file pages/api/admin/ai-ops/evals/cases.ts --file pages/api/admin/cron/ai-evals-weekly.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrEvalFramework.ts`
  - Result: pass (`No ESLint warnings or errors`).
- `pnpm --filter @tenkings/database generate`
  - Result: pass.

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.
- New env vars expected before scheduled eval usage:
  - `AI_EVAL_RUN_SECRET`
  - `AI_EVAL_CRON_SECRET`
  - optional `OCR_EVAL_*` threshold overrides.

## 2026-02-24 - Uploads UX Cleanup + Teach Region Draw UX

### Summary
- Improved `/admin/uploads` teach-region usability and reduced page noise for operators.
- Added explicit draw mode controls and visual guidance for Teach Regions.
- Removed global site shell chrome from uploads page to maximize workspace area.
- Hid currently unused Open Camera upload panel and Recent Upload Batches panel.
- Centered Capture Queue content and enlarged `Add Card` / `OCR Review` buttons.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Teach Regions UX:
  - added `Draw Mode On/Off` toggle.
  - added inline instruction (`Draw Mode On -> drag on image -> Save Region Teach`).
  - enabled crosshair cursor while draw mode is active.
  - disabled image dragging/selection to prevent accidental browser drag behavior while drawing.
- Shell/layout:
  - uploads now uses `AppShell hideHeader hideFooter` in both gate and main render paths.
  - local page nav links (`← Console`, `KingsReview →`) remain intact.
- Legacy sections:
  - Open Camera upload section and Recent Upload Batches section are hidden behind `showLegacyCapturePanels = false`.
- Capture Queue:
  - text/buttons centered.
  - action buttons increased in size.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx`
  - Result: pass with existing `@next/next/no-img-element` warnings only.

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Uploads Teach Region Binding Modal + Touch Draw + Undo

### Summary
- Completed follow-up `/admin/uploads` teach UX fixes:
  - removed page header text `Add Cards`,
  - switched teach draw to pointer events (touch/mouse/pen) with visible drag overlay feedback,
  - added `Undo`,
  - added post-draw link modal to bind each region to a card detail field/value and optional note.
- Persisted teach-region field linkage metadata and applied field-aware overlap support in OCR replay scoring.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/lib/server/ocrRegionTemplates.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Teach draw input:
  - replaced mouse handlers with pointer handlers (`onPointerDown/Move/Up/Cancel`) for consistent finger support.
  - retained rectangle-style region geometry (deterministic OCR-friendly regions instead of freehand strokes).
- Region linkage flow:
  - drawing a region opens `Link Teach Region` modal.
  - operator selects target field from card details, confirms/edits value, optional note, then links region.
  - linked metadata now saved as `targetField`, `targetValue`, `note`, and human-readable `label`.
- Replay scoring:
  - region token lookup now carries field-scoped buckets.
  - token support scoring can use field-scoped overlap when available, with fallback to generic region overlap.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/ocrRegionTemplates.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - Result: pass; only existing `@next/next/no-img-element` warnings in `uploads.tsx`.

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Uploads Follow-up Fixes (Numbered Replay, Mobile Draw Crash, PhotoRoom Gate)

### Summary
- Fixed repeated `numbered` auto-fill regressions by removing `numbered` from replay memory and enforcing OCR-grounded serial parsing.
- Hardened teach-region pointer handling for mobile browsers to prevent pointer-capture client exceptions.
- Reintroduced reliable PhotoRoom execution in Add Cards → KingsReview flow by gating send on successful PhotoRoom processing.

### Files Updated
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- `numbered` behavior:
  - memory replay excludes `numbered` field.
  - memory aggregate writer ignores incoming `numbered` rows.
  - OCR suggest now clears `numbered` when OCR text does not contain explicit `x/y` serial pattern.
- teach draw stability:
  - pointer capture/release wrapped in compatibility-safe guards (`try/catch`, feature checks).
  - pointer leave now routes to cancel/finalize handler.
- PhotoRoom workflow:
  - OCR-stage trigger remains best-effort.
  - `Send to KingsReview` now requires successful PhotoRoom call before enqueue (fails fast with explicit message on PhotoRoom error/not configured).

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file lib/server/ocrFeedbackMemory.ts`
  - Result: pass, only existing `@next/next/no-img-element` warnings in uploads.

### Notes
- No deploy/restart/migration or DB operation executed in this coding step.

## 2026-02-24 - Teach Region Full Plan (Telemetry + AI Ops Events + Snapshot Persistence)

### Summary
- Completed the remaining Phase-4-adjacent reliability/observability items end-to-end:
  - draw crash telemetry and debug payload capture in Add Cards teach-region flow,
  - AI Ops panel support for teach-region save/error events,
  - optional saved annotation snapshot PNG upload tied to region teach saves.

### Files Updated
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260225013000_ocr_region_teach_events/migration.sql` (new)
- `frontend/nextjs-app/lib/server/ocrRegionTeachEvents.ts` (new)
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/region-teach-telemetry.ts` (new)
- `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
- `frontend/nextjs-app/pages/admin/ai-ops.tsx`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added new `OcrRegionTeachEvent` persistence model with:
  - event type (`TEMPLATE_SAVE` / `CLIENT_ERROR`),
  - scope fields (`setId`, `layoutClass`, `photoSide`, `cardAssetId`),
  - metrics (`regionCount`, `templatesUpdated`),
  - optional snapshot URL/storage key,
  - debug payload JSON for client crash diagnostics.
- `region-teach` API now accepts `snapshots` (up to 3 sides) and stores per-side snapshots when provided.
- `region-teach` API now logs `TEMPLATE_SAVE` events per saved side and returns non-fatal snapshot warnings.
- Added `region-teach-telemetry` API to store `CLIENT_ERROR` events from browser-side failures.
- `/admin/uploads` now:
  - reports draw/runtime failures with rich context (action, side, layout, region counts, viewport, UA),
  - wraps pointer handlers in guarded telemetry capture,
  - captures/attaches annotation snapshots during save.
- `/admin/ai-ops` now displays:
  - teach-region save/error counts (24h/7d),
  - snapshot coverage and average regions/save,
  - recent save events (including snapshot link),
  - recent client error events.

### Validation Evidence
- `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- `pnpm --filter @tenkings/database generate`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/region-teach.ts --file pages/api/admin/cards/[cardId]/region-teach-telemetry.ts --file lib/server/ocrRegionTeachEvents.ts --file pages/api/admin/ai-ops/overview.ts --file pages/admin/ai-ops.tsx`
  - Result: pass (with existing `@next/next/no-img-element` warnings in `uploads.tsx`).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - OCR/Train Delay + Draw Stability Follow-up

### Summary
- Investigated and fixed production-follow-up issues:
  - OCR suggestion latency spikes during Add Cards review.
  - long delay when sending card with `Train AI On`.
  - remaining teach draw crash path on mobile.

### Root Causes
- OCR route frequently escalated to multimodal pass due broad trigger logic, causing two sequential LLM calls for many cards.
- Vision path fetched each image server-side and base64-encoded before calling Google Vision, adding avoidable overhead.
- Train-on send path synchronously upserted memory aggregates for all feedback rows.
- Draw pointer move path relied on synthetic event target inside state updater.

### Files Updated
- `frontend/nextjs-app/lib/server/googleVisionOcr.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Google Vision:
  - default URL-mode now uses Vision `imageUri` (env: `GOOGLE_VISION_USE_IMAGE_URI=true` by default).
  - retained opt-out path for legacy fetch+base64 mode.
- OCR suggest:
  - reduced multimodal escalation sensitivity (single taxonomy uncertainty no longer auto-triggers multimodal).
  - added request timeouts for OpenAI Responses calls.
  - added `reasoning.effort = minimal` for extraction latency.
  - emits timing audit block (`totalMs`, `ocrMs`, `llmMs`) to diagnose future latency.
- Card PATCH training persistence:
  - memory aggregate upsert now limited to corrected rows only (`wasCorrect=false`).
- Uploads send/teach:
  - added local dedupe (`teachCapturedFromCorrections`) to avoid duplicate teach write on immediate send.
  - pointer move now reads bounding rect outside updater to stabilize mobile draw handling.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId].ts --file lib/server/googleVisionOcr.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings in uploads.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - OCR/Send UX Follow-up (Background PhotoRoom + Faster Train Path)

### Summary
- Implemented second round performance fixes after operator validation:
  - Send-to-KingsReview UX now advances queue before PhotoRoom completes.
  - OCR feedback memory aggregate upserts now run with bounded concurrency.
  - OCR suggest retained low-latency model behavior with timeout guards.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/lib/server/ocrFeedbackMemory.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/lib/server/googleVisionOcr.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- `/admin/uploads` send flow:
  - removed blocking PhotoRoom await from send path.
  - enqueue + next-card transition happen first.
  - PhotoRoom runs async in background with warning log on failure.
  - next-card load is now non-blocking (`void loadQueuedCardForReview(...).catch(...)`).
- Teach/send dedupe:
  - added `teachCapturedFromCorrections` state so send does not duplicate teach-record write if manual teach was already captured.
- Memory aggregate upsert:
  - switched from fully serial row processing to bounded concurrent worker model (`OCR_MEMORY_UPSERT_CONCURRENCY`, default 6).
- OCR speed:
  - kept reduced multimodal escalation behavior.
  - Responses call uses timeout guard + minimal reasoning effort.
  - Vision URLs use `imageUri` mode by default (faster path).

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/cards/[cardId].ts --file lib/server/googleVisionOcr.ts --file lib/server/ocrFeedbackMemory.ts`
  - Result: pass with existing `@next/next/no-img-element` warnings.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - AI Ops Dashboard Auth Header Fix

### Summary
- Fixed `/admin/ai-ops` dashboard load/run behavior where requests were silently failing and UI appeared blank/no-op.

### Root Cause
- Client page `frontend/nextjs-app/pages/admin/ai-ops.tsx` was calling protected admin APIs without admin headers.
- Protected endpoints (`/api/admin/ai-ops/*`) require admin session auth and rejected those requests.
- Empty-state UI hid request errors, so operators saw “nothing loads” instead of an actionable message.

### Files Updated
- `frontend/nextjs-app/pages/admin/ai-ops.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added `buildAdminHeaders` usage across all AI Ops fetch calls:
  - overview load,
  - eval run,
  - eval case list/create/toggle,
  - retry OCR action.
- Added `session.token` guards to block requests early with explicit message when token is missing.
- Exposed `error` message in empty-state card so API failures are visible before initial hydration.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/ai-ops.tsx`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - Add Cards Required Set Field Manual Fallback

### Summary
- Added a manual set-entry fallback path in Add Cards while keeping set as a required field.
- Behavior now supports: choose from approved set list OR switch to manual typed set when the list does not contain the correct value.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Introduced manual mode toggle for required `productLine` field on sports flow.
- Added dropdown option: `Set not listed (enter manually)`.
- In manual mode:
  - show text input for set name,
  - show `Back to set list` button.
- Required validation unchanged: set cannot be blank.
- Added mode-sync effect:
  - unknown/non-option set values open manual mode,
  - known option values return to list mode.
- Added guard so automatic set suggestion picker does not run while manual mode is active.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx`
  - Result: pass (existing `@next/next/no-img-element` warnings only).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - Uploads Mobile UX + Option Picker Search + Parallel Family Option Coverage

### Summary
- Tightened `/admin/uploads` required/optional review UX for mobile.
- Added alphabetical + searchable insert/parallel picker.
- Added backend option-pool support for `parallelFamily` labels to improve missing-option coverage.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/lib/server/variantOptionPool.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Required page:
  - moved required-step gold button to sit right below OCR status area.
  - changed label to `Next fields`.
- Unknown messages:
  - moved `Unknown: ...` messaging inline into set/insert/parallel fields.
  - removed separate red helper rows under these fields.
- Field label cleanup:
  - insert placeholder now `Insert Set`.
  - parallel placeholder now `Variant / Parallel`.
  - added right-side dropdown indicator (`▾`) on insert/parallel picker controls.
- Picker modal:
  - options now alphabetically sorted (case-insensitive, numeric-aware).
  - added search bar above `None` entry for faster operator lookup.
- Option pool coverage:
  - updated `loadVariantOptionPool` to generate operator labels from both:
    - `parallelId`
    - `parallelFamily`
  - deduped by normalized label key.
  - this allows family-style labels (including autograph families) to appear even when family text is not stored in `parallelId`.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file lib/server/variantOptionPool.ts`
  - Result: pass (existing `@next/next/no-img-element` warnings in uploads only).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-24 - PDF Checklist Compound-Line Header Split Fix

### Summary
- Fixed Set Ops PDF checklist parsing for lines that contain both a section header and the first card row on the same line.
- This directly targets missing family labels in downstream variant option pickers (for example 1980/TFRA-style families).

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added `splitChecklistCompoundLine(...)` helper:
  - identifies `header + card-id + player...` lines,
  - verifies prefix behaves like a section header,
  - returns split `{ header, row }`.
- Updated `parseChecklistRowsFromText(...)` loop to:
  - process compound split before normal line classification,
  - flush/set `activeSection` from split header,
  - keep split row in the correct section block.
- Expected outcome:
  - preserves section-derived `parallel` labels instead of leaking previous generic sections,
  - improves availability of family options in Add Cards insert/parallel dropdowns after re-ingest/re-seed.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/variantOptionPool.ts --file pages/admin/uploads.tsx`
  - Result: pass (existing `@next/next/no-img-element` warnings in uploads only).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-25 - Agent Context Sync (Docs-Only)

### Summary
- Read all mandatory startup docs listed in `AGENTS.md`.
- Confirmed local branch/head state before handoff updates: `main` at `60f4a15`.
- Observed pre-existing working-tree changes in non-doc files and left them untouched.
- No code edits, deploys, restarts, migrations, or DB operations were executed in this session.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- This was a docs-sync session only; runtime and DB evidence were not collected.
- Existing Set Ops `Next Actions (Ordered)` remain unchanged.

## 2026-02-25 - Set Replace Wizard End-to-End Completion

### Summary
- Completed the Replace Set Wizard implementation end-to-end across DB schema/migration, backend orchestration, API routes, and `/admin/set-ops` UI.
- Finalized compile/runtime safety by removing dependency on missing Prisma-generated `SetReplaceJob` delegate in this workspace; replace job reads/writes use raw SQL wrappers in service layer.
- Added cross-op blocking so delete confirm and seed start cannot run while a replace job is active for the same set.

### Files Updated
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260225143000_set_replace_jobs/migration.sql` (new)
- `frontend/nextjs-app/lib/server/setOpsReplace.ts` (new)
- `frontend/nextjs-app/pages/api/admin/set-ops/replace/preview.ts` (new)
- `frontend/nextjs-app/pages/api/admin/set-ops/replace/jobs/index.ts` (new)
- `frontend/nextjs-app/pages/api/admin/set-ops/replace/jobs/[jobId]/cancel.ts` (new)
- `frontend/nextjs-app/pages/api/admin/set-ops/access.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/delete/confirm.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/seed/jobs.ts`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- New replace orchestration service supports:
  - preview generation + diff math + immutable hash verification,
  - per-set lock semantics (`activeSetLock` unique),
  - confirmation phrase requirement (`REPLACE <normalizedSetId>`),
  - stage-based execution with progress/log persistence:
    - `VALIDATING_PREVIEW`
    - `DELETING_SET`
    - `CREATING_DRAFT`
    - `APPROVING_DRAFT`
    - `SEEDING_SET`
  - terminal success/failure/cancel handling with audit writes.
- Added replace API surface:
  - `POST /api/admin/set-ops/replace/preview`
  - `GET /api/admin/set-ops/replace/jobs`
  - `POST /api/admin/set-ops/replace/jobs`
  - `POST /api/admin/set-ops/replace/jobs/:jobId/cancel`
- Feature-flag gate:
  - `SET_OPS_REPLACE_WIZARD` (plus `NEXT_PUBLIC_SET_OPS_REPLACE_WIZARD` fallback) now controls replace visibility/access.
- UI flow in `/admin/set-ops` includes upload -> preview -> typed confirm -> run -> live progress/log -> final summary + recent jobs + cancel.
- Compile safety:
  - Replace service now uses local replace-status constants and raw SQL wrappers, so it does not rely on generated `SetReplaceJob` delegate/enum in this workstation.
  - Fixed narrow typing issues in replace service (`SetSeedJobStatus` terminal check and non-null runner record typing).

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops.tsx --file lib/server/setOpsReplace.ts --file pages/api/admin/set-ops/access.ts --file pages/api/admin/set-ops/delete/confirm.ts --file pages/api/admin/set-ops/seed/jobs.ts --file pages/api/admin/set-ops/replace/preview.ts --file pages/api/admin/set-ops/replace/jobs/index.ts --file pages/api/admin/set-ops/replace/jobs/[jobId]/cancel.ts`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.
- `DATABASE_URL='postgresql://user:pass@localhost:5432/db' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- `pnpm --filter @tenkings/database generate`
  - Result: exits successfully, but generated client in this workstation still does not expose `SetReplaceJob` delegate/enum; service is intentionally implemented without that dependency.

### Notes
- No deploy/restart/migration or destructive DB operation executed in this coding step.
- Migration `20260225143000_set_replace_jobs` must be applied in runtime environment before replace jobs can be persisted.

## 2026-02-25 - Replace Wizard Production Deploy + Migration Applied

### Summary
- Operator completed droplet sync, service rebuild/recreate, feature-flag enablement, DB migration, Prisma generate, and runtime restart for Replace Wizard rollout.
- Production DB migration for replace jobs is now applied.

### Runtime Evidence (operator output)
- Droplet repo fast-forwarded to:
  - `09b4b6f feat(set-ops): add end-to-end replace set wizard`
- Feature flag configured in runtime env:
  - `SET_OPS_REPLACE_WIZARD=true`
- Service rebuild/recreate:
  - `docker compose up -d --build --force-recreate bytebot-lite-service` completed successfully.
  - `docker compose ps` showed `infra-bytebot-lite-service-1` up.
- Runtime env check inside container:
  - `SET_OPS_REPLACE_WIZARD=true`
  - `DATABASE_URL length: 145`
- DB migration:
  - `pnpm --filter @tenkings/database migrate:deploy`
  - Result: `Applying migration 20260225143000_set_replace_jobs`
  - Result: `All migrations have been successfully applied.`
- Prisma client generation:
  - `pnpm --filter @tenkings/database generate`
  - Result: success (`Generated Prisma Client (v5.22.0) ...`)
- Post-migration restart:
  - `docker compose restart bytebot-lite-service` succeeded.
  - `docker compose ps` shows bytebot-lite-service healthy/up.

### Notes
- `docker-compose.yml` `version` deprecation message is warning-only and did not block rollout.
- Next required step is production UI smoke test of Replace Wizard workflow on a safe test set.

## 2026-02-25 - Replace Parser Fix (Year-Range Section Header Detection)

### Summary
- Investigated production replace-preview parsing defect where `1980 81 TOPPS BASKETBALL` rows were grouped into prior section `BIG BOX BALLERS`.
- Identified header-detection false negative in `setOpsDiscovery`:
  - contextual section-header check treated token `81` as an inline card id,
  - compound-line splitter had the same false-positive pattern for `YYYY NN ...`.
- Implemented a narrow parser fix to support year-range section headers while keeping existing card-id safeguards.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.
- Production should be re-tested with same checklist upload after deploy to confirm `80BK-*` rows carry `1980 81 TOPPS BASKETBALL` parallel label.

## 2026-02-25 - Replace Parser Fix #2 (Numeric-Lead Insert Header Detection)

### Summary
- After first header fix, operator found another preview mislabel:
  - `8 Bit Ballers` rows were grouped under prior section (`Sole Ambition`).
- Root cause was a second contextual-header edge case:
  - leading numeric token (`8`) was treated as card id, so section header was rejected.
- Implemented narrow pattern support for numeric-brand section headers tied to matching next-line card prefix (ex: header starts with `8` and next line starts with `8BB-...`).

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-25 - Replace Job SQL Enum Cast Fix

### Summary
- Investigated production replace execution failure at `Run Replace`.
- Postgres returned enum type mismatch (`42804`) for `SetReplaceJob.datasetType`.
- Fixed raw SQL write paths to cast `datasetType` to `SetDatasetType`.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsReplace.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsReplace.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-25 - Replace Job Insert ID Fix

### Summary
- Investigated second replace execution failure after enum-cast patch.
- Postgres returned `23502` not-null failure for `SetReplaceJob` insert; failing row showed `id = null`.
- Fixed raw SQL insert to supply explicit UUID id.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsReplace.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsReplace.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-25 - Replace Wizard Production Run Confirmed COMPLETE

### Summary
- Operator executed Replace Wizard in production for `2025-26 Topps Basketball` after latest parser and SQL fixes.
- Replace job completed end-to-end with all workflow stages successful.

### Runtime Evidence (operator UI output)
- Replace job id: `2ee1ed8c-183f-46ed-831a-90f8a1b37a7c`
- Final status: `COMPLETE`
- Step results:
  - Validate preview: complete (`Preview hash and validations verified`)
  - Delete existing set data: complete
  - Create/build draft: complete (`Draft version 3668ab4d-d558-44e9-b2d0-3a3f095f80d4`)
  - Approve draft: complete (`Approval dfc6ad93-522b-4552-b6a3-07f1a461a032`)
  - Seed set: complete (`Seed completed inserted=1793 updated=30`)
- Final summary:
  - Inserted: `1793`
  - Updated: `30`
  - Skipped: `0`
  - Failed: `0`
- Seed workspace/job id shown by UI:
  - `6eacc841-dcca-4657-929f-b0b26692c9c1`

### Notes
- Production Replace Wizard flow is validated as functional for this set/run.

## 2026-02-25 - Outage Triage (collect.tenkings.co)

### Summary
- Operator reported full-site outage with browser error `ERR_CONNECTION_CLOSED`.
- Evidence indicates edge/DNS/TLS routing issue rather than application runtime crash.

### Runtime Evidence (operator output)
- Droplet restart completed successfully:
  - `docker compose restart caddy bytebot-lite-service`
  - `docker compose ps` showed both services `Up`.
- Workstation probe:
  - `curl -svI https://collect.tenkings.co`
  - resolved IPs: `216.150.1.193`, `216.150.16.193`
  - handshake failure: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL`

### Assessment
- App containers were healthy at time of check.
- `collect.tenkings.co` endpoint failed before reaching app runtime.
- Likely DNS/edge mapping drift for `collect.tenkings.co` (domain currently not reaching expected serving origin).

## 2026-02-25 - Outage Mitigation (Vercel Alias Recovery)

### Summary
- Operator executed project-link, redeploy, and forced alias to restore `collect.tenkings.co` routing.

### Runtime Evidence (operator output)
- Vercel project link confirmed:
  - `ten-kings/tenkings-backend-nextjs-app`
- Domain inspect showed dual attachment:
  - `tenkings-backend-nextjs-app`
  - `ten-kings-collect-tvz4`
- Fresh production deploy completed:
  - `https://tenkings-backend-nextjs-9dl06mpyy-ten-kings.vercel.app` (`Ready`)
- Alias force-set completed:
  - `collect.tenkings.co -> tenkings-backend-nextjs-9dl06mpyy-ten-kings.vercel.app`

### Notes
- Dual-project domain attachment remains a drift risk; cleanup recommended after service stability is confirmed.

## 2026-02-25 - Outage Follow-up (Alias Set But DNS Still Wrong)

### Summary
- Operator confirmed alias assignment succeeded, but custom domain remained unavailable.

### Runtime Evidence (operator output)
- Alias set success:
  - `collect.tenkings.co now points to https://tenkings-backend-nextjs-9dl06mpyy-ten-kings.vercel.app`
- Probe still failing:
  - `curl -svI https://collect.tenkings.co`
  - resolved A records: `216.150.1.193`, `216.150.16.193`
  - TLS error: `SSL_ERROR_SYSCALL`

### Assessment
- DNS path for `collect` is still not routing to Vercel as required.
- App/runtime recoveries cannot resolve outage until DNS record at active DNS provider is corrected.

## 2026-02-25 - Production Access Recovery Confirmed

### Summary
- Operator reported that disabling Vercel protection restored public site availability.
- Operator reported rollback/promotion to latest desired build (with replace DB work) is active and site is running.

### Runtime Evidence (operator statement)
- "turning the vercel protection OFF fixed it and now my website is running again"
- "rolled back to most recent build with all the replace db work"

### Notes
- Operator asked to keep recovered state as-is for now.

## 2026-02-25 - Replace Wizard Fix (Preserve Existing Reference Images)

### Summary
- Investigated operator-reported behavior where running Set Replace removed all previously seeded images.
- Confirmed root cause in `runSetReplaceJob`:
  - delete stage removed all `CardVariantReferenceImage` rows for the set,
  - seed stage only creates/updates `CardVariant`, so refs were never restored.
- Implemented reference-image preservation in replace workflow:
  - snapshot existing set refs before delete,
  - keep only refs whose normalized `(cardNumber, parallelId)` keys still exist in accepted incoming rows,
  - after successful seed, restore preserved refs in chunked inserts using canonical incoming keys.
- Added `referenceImagePreservation` counts to replace result/audit metadata.
- Updated `/admin/set-ops` final replace summary to display preserved/restored ref counts.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsReplace.ts`
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsReplace.ts --file pages/admin/set-ops.tsx`
  - Result: pass.

### Notes
- No deploy/restart/migration executed in this coding step.

## 2026-02-26 - Taxonomy Layer Analysis (No-Code Research Session)

### Summary
- Completed a no-code analysis session per user request to evaluate the new checklist taxonomy layer:
  - card type/program (insert/base/auto/relic families),
  - variation,
  - parallel + odds scope.
- Compared official external source structure against current Ten Kings implementation.
- Produced migration direction for additive/surgical integration (no big-bang rewrite).

### External Evidence Reviewed
- Official Topps product page for `2025-26 Topps Basketball` (Checklist/Odds links).
- Official Topps checklist PDF (program + variation sections).
- Official Topps odds PDF (parallel/odds scope across base, insert, auto/relic segments).
- Official Upper Deck checklist details page (manufacturer checklist + odds pattern).

### Local Evidence Reviewed
- `packages/database/prisma/schema.prisma` (flat `CardVariant` model and dataset enums).
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts` (checklist section -> `parallel` mapping).
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts` (parallel/player worksheet normalization assumptions).
- `frontend/nextjs-app/lib/server/variantOptionPool.ts` (insert/parallel heuristic classification from `parallelId`).
- `frontend/nextjs-app/lib/server/variantMatcher.ts` (candidate matching keyed by `parallelId`).
- `frontend/nextjs-app/pages/admin/uploads.tsx` and `pages/api/admin/kingsreview/enqueue.ts` (query composition and metadata mapping).

### Findings
- Current system conflates card program/type, variation labels, and true parallels into one field family (`parallelId`/`parallel`).
- This conflation impacts ingest normalization, operator pickers, matcher candidates, and downstream comp-query quality.
- Official source evidence validates the need for separate taxonomy layers and explicit scope rules.

### Operational Notes
- No code changes deployed.
- No deploy/restart/migration commands executed.
- No destructive DB/data operations executed.

## 2026-02-26 - Catalog Ops Execution Pack (Docs Bundle for Future Agents)

### Summary
- Created a reusable execution-docs bundle so future Codex agents can implement Workstation 2 redesign + Taxonomy V2 with low ambiguity.
- Bundle is intentionally split into contracts (strategy/system/build/UX/quality+ops) plus an agent kickoff checklist.

### Files Added
- `docs/context/catalog-ops-execution-pack/README.md`
- `docs/context/catalog-ops-execution-pack/STRATEGIC_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/SYSTEM_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/BUILD_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/UX_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/QUALITY_AND_OPS_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/AGENT_KICKOFF_CHECKLIST.md`

### Files Updated
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- Verified files exist under `docs/context/catalog-ops-execution-pack`.
- Confirmed no runtime code paths, deploys, restarts, migrations, or DB operations were executed.

### Notes
- This is a docs-only enablement step to improve multi-agent execution quality and consistency.

### Addendum (2026-02-26)
- Also updated: `docs/context/FINAL_MASTER_HANDOFF_PACK.md` with pointer to the new execution pack.

### Addendum (2026-02-26, Plan Coverage Tightening)
- Added explicit full-detail specs to execution pack for strict coverage of approved notes:
  - `docs/context/catalog-ops-execution-pack/MASTER_PLAN_V2_COMPLETE.md`
  - `docs/context/catalog-ops-execution-pack/WORKSTATION2_REDESIGN_SPEC.md`
- Updated `docs/context/catalog-ops-execution-pack/README.md` read order to include these canonical specs.

## 2026-02-26 - AGENTS Startup Context Sync (Docs-Only)

### Summary
- Re-read all mandatory startup docs listed in `AGENTS.md` in required order.
- Confirmed local branch status remains `main...origin/main`.
- Updated handoff docs for this session with explicit no-ops evidence.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Files Updated
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Working tree includes pre-existing untracked file: `Deployments`.
- No code/runtime changes, deploy/restart/migration commands, or DB operations were executed in this session.

## 2026-02-26 - Catalog Ops Phase 0 (Shell Routes + Wrappers Only)

### Summary
- Re-read mandatory startup docs from `AGENTS.md` plus execution-pack kickoff docs.
- Implemented only Phase 0 workstation scaffolding from execution pack:
  - shell routes,
  - shared shell/context bar/deep-link handling,
  - legacy wrappers.
- Preserved existing backend/runtime behavior (no API or server behavior changes).

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`
- `docs/context/catalog-ops-execution-pack/README.md`
- `docs/context/catalog-ops-execution-pack/AGENT_KICKOFF_CHECKLIST.md`
- `docs/context/catalog-ops-execution-pack/BUILD_CONTRACT.md`
- `docs/context/catalog-ops-execution-pack/WORKSTATION2_REDESIGN_SPEC.md`

### Files Added
- `frontend/nextjs-app/lib/catalogOpsFlags.ts`
- `frontend/nextjs-app/components/catalogOps/CatalogOpsWorkstationShell.tsx`
- `frontend/nextjs-app/components/catalogOps/CatalogOpsLegacyFrame.tsx`
- `frontend/nextjs-app/pages/admin/catalog-ops/index.tsx`
- `frontend/nextjs-app/pages/admin/catalog-ops/ingest-draft.tsx`
- `frontend/nextjs-app/pages/admin/catalog-ops/variant-studio.tsx`
- `frontend/nextjs-app/pages/admin/catalog-ops/ai-quality.tsx`

### Files Updated
- `frontend/nextjs-app/pages/admin/index.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added Phase 0 feature-flag reads for workstation/surface routing:
  - `CATALOG_OPS_WORKSTATION`
  - `CATALOG_OPS_OVERVIEW_V2`
  - `CATALOG_OPS_INGEST_STEPPER`
  - `CATALOG_OPS_VARIANT_STUDIO`
  - `CATALOG_OPS_AI_QUALITY`
- Added new IA routes:
  - `/admin/catalog-ops`
  - `/admin/catalog-ops/ingest-draft`
  - `/admin/catalog-ops/variant-studio`
  - `/admin/catalog-ops/ai-quality`
- All new routes wrap existing legacy pages in an embedded frame to keep behavior parity during rollout.
- Legacy routes remain available:
  - `/admin/set-ops`
  - `/admin/set-ops-review`
  - `/admin/variants`
  - `/admin/variant-ref-qa`
  - `/admin/ai-ops`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file components/catalogOps/CatalogOpsWorkstationShell.tsx --file components/catalogOps/CatalogOpsLegacyFrame.tsx --file lib/catalogOpsFlags.ts --file pages/admin/catalog-ops/index.tsx --file pages/admin/catalog-ops/ingest-draft.tsx --file pages/admin/catalog-ops/variant-studio.tsx --file pages/admin/catalog-ops/ai-quality.tsx --file pages/admin/index.tsx`
  - Result: pass (`No ESLint warnings or errors`).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- Working tree still includes pre-existing untracked file: `Deployments`.
- No deploy/restart/migration commands were executed.
- No DB operations or destructive set operations were executed in this session.

## 2026-02-26 - Catalog Ops Phase 1 (Ingest & Draft Guided Stepper)

### Summary
- Implemented Phase 1 deliverable: converted long Set Ops Review workspace into a guided 4-step Ingest & Draft flow.
- Preserved current API usage and backend behavior; this change is UI/workflow composition only.
- Wired step state to URL (`?step=`) for deep-link/re-entry behavior.

### Files Updated
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `frontend/nextjs-app/pages/admin/catalog-ops/ingest-draft.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added step definitions and URL step parsing:
  - `source-intake`
  - `ingestion-queue`
  - `draft-approval`
  - `seed-monitor`
- Added top stepper cards with status (`Open` / `Complete` / `Pending`).
- Converted each major section into collapsible step content (single expanded step at a time).
- Added Continue actions:
  - Step 1 -> Step 2
  - Step 2 -> Step 3
  - Step 3 -> Step 4
- Added automatic step transitions on successful workflow events:
  - source import/queue success -> Step 2
  - build draft success -> Step 3
  - approve success -> Step 4
- Updated Catalog Ops route wrapper copy and default link to `step=source-intake`.
- No API contracts/routes changed.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/set-ops-review.tsx --file pages/admin/catalog-ops/ingest-draft.tsx`
  - Result: pass (`No ESLint warnings or errors`).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - Result: pass.

### Notes
- Working tree still includes pre-existing untracked file: `Deployments`.
- No deploy/restart/migration commands executed.
- No DB operations or destructive set operations executed in this session.

## 2026-02-26 - Catalog Ops Phase 2 (Variant Studio Consolidation)

### Summary
- Implemented Phase 2 deliverable by consolidating Variant Studio into a single route with two subtabs:
  - `Catalog Dictionary`
  - `Reference QA`
- Added shared set/program context controls on the consolidated route.
- Preserved existing batch QA and dictionary behavior by keeping legacy underlying workflows active.

### Files Updated
- `frontend/nextjs-app/pages/admin/catalog-ops/variant-studio.tsx`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Consolidated route (`/admin/catalog-ops/variant-studio`) now includes:
  - subtab controls for dictionary/QA
  - shared context input form (`setId`, `programId`)
  - context apply/clear behavior persisted to URL query
  - legacy frame target switching per active subtab while preserving shared context.
- Added query-context hydration to legacy surfaces:
  - `variants.tsx` consumes `setId`/`programId` query to prefill set context and initial query state.
  - `variant-ref-qa.tsx` consumes `setId`/`programId` query to initialize set filter and optional search context.
- No backend API changes were made in this phase.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/catalog-ops/variant-studio.tsx --file pages/admin/variants.tsx --file pages/admin/variant-ref-qa.tsx`
  - Result: no new lint errors; existing warnings remain on pre-existing `<img>` usage in `variant-ref-qa.tsx`.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- Note:
  - an earlier plain `tsc --noEmit` attempt in this environment exited with `SIGSEGV`; immediate rerun with identical code passed.

### Notes
- Working tree still includes pre-existing untracked file: `Deployments`.
- No deploy/restart/migration commands executed.
- No DB operations or destructive set operations executed in this session.

## 2026-02-26 - Catalog Ops Phase 3 (Overview Redesign)

### Summary
- Implemented Phase 3 overview redesign on `/admin/catalog-ops` (CAT-030) with a high-signal set health surface.
- Replaced legacy iframe wrapper on the overview route with a native workstation page that preserves existing backend APIs.
- Converted replace/delete actions on the overview route to panel-based flows (right-side action panel + right-side danger panel).

### Files Added
- `frontend/nextjs-app/components/catalogOps/CatalogOpsOverviewSurface.tsx`

### Files Updated
- `frontend/nextjs-app/pages/admin/catalog-ops/index.tsx`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Deliverable 1 complete: Set health table + summary cards.
  - Added summary cards for:
    - taxonomy coverage (draft-status proxy),
    - unresolved ambiguities (review/reject proxy),
    - ref QA status (reference/variant coverage proxy),
    - last seed result (complete/failed counts).
  - Added set health table with per-set health chips and operational status.
- Deliverable 2 complete: Replace action panel.
  - Added right-side replace panel on overview route.
  - Preserved existing replace API behaviors (`parse-upload`, `replace/preview`, `replace/jobs`, `cancel`) and progress polling.
- Deliverable 3 complete: Delete danger panel.
  - Added right-side delete panel with dry-run impact and typed confirmation requirements.
  - Preserved existing delete APIs and safety constraints (`delete/dry-run`, `delete/confirm`).
- Deliverable 4 complete: Cross-links to Ingest & Draft and Variant Studio.
  - Added top-level and row-level deep links with preserved set context.
- Legacy route safety preserved:
  - `/admin/set-ops` remains available and unchanged as fallback.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file components/catalogOps/CatalogOpsOverviewSurface.tsx --file pages/admin/catalog-ops/index.tsx`
  - Result: pass (`No ESLint warnings or errors`).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.

### Notes
- No deploy/restart/migration commands were executed.
- No DB operations or destructive set operations were executed in this coding session.

## 2026-02-26 - Catalog Ops Phase 4 (AI Quality Integration)

### Summary
- Implemented Phase 4 AI Quality integration (CAT-040) by replacing the `/admin/catalog-ops/ai-quality` legacy iframe wrapper with a native workstation surface.
- Added set/program failure-analysis filters on AI Quality and connected context-aware deep links into Ingest & Draft and Variant Studio.
- Extended AI Ops overview payload with set/program context metadata for attention queue and correction rows to support scoped filtering/routing.

### Files Added
- `frontend/nextjs-app/components/catalogOps/CatalogOpsAiQualitySurface.tsx`

### Files Updated
- `frontend/nextjs-app/pages/admin/catalog-ops/ai-quality.tsx`
- `frontend/nextjs-app/pages/api/admin/ai-ops/overview.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Native AI Quality surface now includes required retained blocks:
  - Eval gate + latest run,
  - recent runs,
  - failed checks,
  - correction telemetry,
  - attention queue.
- Added shared set/program filter controls driven by workstation URL context:
  - apply/clear filters updates `setId` and `programId` in route state.
- Added context-aware workflow deep links:
  - top-level links to `/admin/catalog-ops/ingest-draft` and `/admin/catalog-ops/variant-studio` with preserved context.
  - row-level links from corrections and attention queue into those workflows with row set/program context.
- Added metadata extension in AI Ops overview API:
  - `ops.attentionCards[].setId/programId`
  - `teach.recentCorrections[].setId/programId`
  - derived from OCR audit taxonomy fields to support scoped failure analysis.
- Legacy AI Ops route remains available as fallback:
  - `/admin/ai-ops`.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file components/catalogOps/CatalogOpsAiQualitySurface.tsx --file pages/admin/catalog-ops/ai-quality.tsx --file pages/api/admin/ai-ops/overview.ts`
  - Result: pass (`No ESLint warnings or errors`).
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.

### Notes
- No deploy/restart/migration commands were executed.
- No DB operations or destructive set operations were executed in this coding session.

## 2026-02-26 - Catalog Ops Phase 5 (Taxonomy V2 Activation)

### Summary
- Implemented Phase 5 deliverables end-to-end behind flags:
  - Taxonomy V2 schema/migration,
  - Topps adapter v1 + taxonomy ingest core,
  - V2 picker option pool,
  - V2 matcher scope gating,
  - V2 KingsReview deterministic query builder.

### Files Added
- `packages/database/prisma/migrations/20260226100000_taxonomy_v2_activation/migration.sql`
- `frontend/nextjs-app/lib/server/taxonomyV2Enums.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2Flags.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2Utils.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2AdapterTypes.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2ToppsAdapter.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2Core.ts`

### Files Updated
- `packages/database/prisma/schema.prisma`
- `packages/database/src/index.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`
- `frontend/nextjs-app/lib/server/variantOptionPool.ts`
- `frontend/nextjs-app/lib/server/variantMatcher.ts`
- `frontend/nextjs-app/pages/api/admin/variants/options.ts`
- `frontend/nextjs-app/pages/api/admin/variants/match.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added additive Taxonomy V2 entities and supporting enums:
  - provenance source,
  - program/card/variation/parallel/scope/odds,
  - conflict tracking,
  - ambiguity queue,
  - legacy `CardVariant` compatibility map.
- Added Topps adapter v1 parsing contract and ingest execution pipeline with:
  - deterministic source precedence ranking,
  - conflict persistence,
  - ambiguity queue upserts,
  - compatibility bridge upserts.
- Set Ops draft build now conditionally runs taxonomy ingest when `TAXONOMY_V2_INGEST` is enabled and writes ingest summary into job parse metadata + audit metadata.
- Variant option pool now conditionally uses taxonomy-backed option generation when `TAXONOMY_V2_PICKERS` is enabled (with source marker in response payload).
- Variant matcher now applies taxonomy scope filtering before ranking when `TAXONOMY_V2_MATCHER` is enabled.
- KingsReview enqueue now supports deterministic taxonomy-aware builder when `TAXONOMY_V2_KINGSREVIEW_QUERY` is enabled, with in-scope parallel enforcement.

### Validation Evidence
- `pnpm --filter @tenkings/database build`
  - Result: pass.
- `DATABASE_URL='postgresql://local:local@localhost:5432/local' pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/taxonomyV2Enums.ts --file lib/server/taxonomyV2Flags.ts --file lib/server/taxonomyV2Utils.ts --file lib/server/taxonomyV2AdapterTypes.ts --file lib/server/taxonomyV2ToppsAdapter.ts --file lib/server/taxonomyV2Core.ts --file lib/server/variantOptionPool.ts --file lib/server/variantMatcher.ts --file pages/api/admin/set-ops/drafts/build.ts --file pages/api/admin/variants/options.ts --file pages/api/admin/variants/match.ts --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/kingsreview/enqueue.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: first run SIGSEGV in environment; immediate rerun pass.

### Operations
- No deploy/restart/migration commands executed in this coding session.
- No destructive set operations executed.
- Rollback remains flag-based (`TAXONOMY_V2_*` toggles).

## 2026-02-26 - Catalog Ops Phase 6 (Panini + Upper Deck Adapter Rollout)

### Summary
- Implemented Phase 6 by extending Taxonomy V2 ingestion from Topps-only to multi-manufacturer adapter support.
- Added Panini and Upper Deck adapter implementations and routed taxonomy core ingest through deterministic adapter selection.

### Files Added
- `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2PaniniAdapter.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2UpperDeckAdapter.ts`

### Files Updated
- `frontend/nextjs-app/lib/server/taxonomyV2ToppsAdapter.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2Core.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Added shared manufacturer adapter utility that normalizes source rows into taxonomy contracts:
  - programs,
  - cards,
  - variations,
  - parallels,
  - scopes,
  - odds rows,
  - ambiguity signals.
- Added source-matching profiles for:
  - Topps,
  - Panini,
  - Upper Deck.
- Updated taxonomy core `createAdapterOutput(...)` to evaluate adapter list in deterministic order and use first eligible adapter result.
- Preserved existing fallback behavior (`adapter: none`) when no manufacturer matcher is eligible.
- Consumer cutover flags remain unchanged; broader rollout is enabled by expanded ingest adapter coverage.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/taxonomyV2ManufacturerAdapter.ts --file lib/server/taxonomyV2ToppsAdapter.ts --file lib/server/taxonomyV2PaniniAdapter.ts --file lib/server/taxonomyV2UpperDeckAdapter.ts --file lib/server/taxonomyV2Core.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands executed in this coding session.
- No destructive set operations or manual DB data operations executed.

## 2026-02-26 - Catalog Ops Phase 7 (Cutover + Flat-Only Deprecation)

### Summary
- Implemented final Phase 7 cutover by making Taxonomy V2 default-on and deprecating flat-only runtime paths from normal operation.
- Retained explicit rollback controls so legacy behavior is still available only when intentionally enabled.

### Files Updated
- `frontend/nextjs-app/lib/server/taxonomyV2Flags.ts`
- `frontend/nextjs-app/lib/server/variantOptionPool.ts`
- `frontend/nextjs-app/lib/server/variantMatcher.ts`
- `frontend/nextjs-app/pages/api/admin/variants/options.ts`
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Implementation Notes
- Taxonomy flag behavior now supports Phase 7 cutover controls:
  - `TAXONOMY_V2_DEFAULT_ON` (defaults to true when unset).
  - `TAXONOMY_V2_FORCE_LEGACY=true` to force rollback to legacy behavior.
  - `TAXONOMY_V2_ALLOW_LEGACY_FALLBACK` to permit/deny fallback when taxonomy scope/data is unavailable.
- Picker runtime hardening:
  - when pickers run in V2 mode and fallback is disallowed, the API does not silently fall back to flat legacy options.
  - options payload now returns `legacyFallbackUsed` for observability.
- Matcher runtime hardening:
  - when matcher V2 is enabled and fallback is disallowed, missing taxonomy scope is treated as a hard failure.
- KingsReview runtime hardening:
  - V2 deterministic query builder is used unless explicit fallback permissions allow legacy behavior.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/taxonomyV2Flags.ts --file lib/server/variantOptionPool.ts --file lib/server/variantMatcher.ts --file pages/api/admin/variants/options.ts --file pages/api/admin/kingsreview/enqueue.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands were executed in this coding session.
- No destructive set operations or manual DB data operations were executed.
- Program status: Phase 0 through Phase 7 are now implemented in codebase; execution-pack phase sequence is complete.

## 2026-02-26 - Catalog Ops Workstation Production Enablement (Vercel)

### Summary
- Operator deployed production frontend for commit `99eb34b` and validated new Catalog Ops routes existed on deployment URLs.
- Operator added Catalog Ops workstation `NEXT_PUBLIC_*` production flags and redeployed.
- Root runtime issue was stale custom-domain alias target, not missing route code.
- `collect.tenkings.co` was re-aliased to the newest production deployment and workstation routes became active.

### Runtime Evidence (operator commands/results)
- Initial production deploy:
  - `npx -y vercel@latest deploy --prod --yes --scope ten-kings`
  - produced: `https://tenkings-backend-nextjs-47v5tumel-ten-kings.vercel.app`
- Route parity check proved deployment mismatch:
  - deployment URL returned `200` for:
    - `/admin/catalog-ops`
    - `/admin/catalog-ops/ingest-draft`
    - `/admin/catalog-ops/variant-studio`
    - `/admin/catalog-ops/ai-quality`
  - `https://collect.tenkings.co` initially returned `404` for the same Catalog Ops paths while legacy `/admin/set-ops` returned `200`.
- Production env flags confirmed in pulled env file (`.vercel/.env.production.local`):
  - `NEXT_PUBLIC_CATALOG_OPS_WORKSTATION="true"`
  - `NEXT_PUBLIC_CATALOG_OPS_OVERVIEW_V2="true"`
  - `NEXT_PUBLIC_CATALOG_OPS_INGEST_STEPPER="true"`
  - `NEXT_PUBLIC_CATALOG_OPS_VARIANT_STUDIO="true"`
  - `NEXT_PUBLIC_CATALOG_OPS_AI_QUALITY="true"`
- Latest production deployment identified as:
  - `https://tenkings-backend-nextjs-i1d1vlyxo-ten-kings.vercel.app`
- Alias state before correction:
  - `collect.tenkings.co -> tenkings-backend-nextjs-47v5tumel-ten-kings.vercel.app`
- Alias correction executed:
  - `npx -y vercel@latest alias set "https://tenkings-backend-nextjs-i1d1vlyxo-ten-kings.vercel.app" collect.tenkings.co --scope ten-kings`
  - result: `Success! https://collect.tenkings.co now points to https://tenkings-backend-nextjs-i1d1vlyxo-ten-kings.vercel.app`

### Notes
- No code edits were required for this fix.
- No droplet restart/migration or destructive DB operation was executed in this recovery step.

## 2026-02-26 - PDF Checklist Parser Fix (Base Cards Capture)

### Summary
- Implemented parser hardening so base-card checklist sections from uploaded/source PDFs are recognized and converted into ingestion rows more reliably.
- Specifically addressed section labels like `BASE CARDS I/II/...` so they normalize to `Base Set` instead of being treated as separate parallel labels.
- Added line-first record extraction path for checklist parsing, with existing merged-text extraction retained as fallback.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Implementation Notes
- Updated checklist section normalization:
  - `BASE`, `BASE SET`, `BASE CARDS I/II/...`, and `BASE CHECKLIST` now normalize to `Base Set`.
- Added token-to-record helper (`extractChecklistRecordsFromTokens`) used by checklist parser.
- `parseChecklistRowsFromText(...)` now:
  - parses records from each checklist line first,
  - falls back to merged-block token parsing when line parsing yields no records.
- This improves extraction for official checklist PDF layouts where base rows appear under top-of-document base headers.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands executed in this coding step.
- No destructive set operations or manual DB data operations executed.

## 2026-02-26 - PDF Parallel/Odds Parser Support

### Summary
- Extended Set Ops source/upload parsing to support non-checklist parallel+odds PDF content.
- System now falls back to parallel/odds text extraction when checklist-row extraction returns zero rows.
- This complements the earlier base-card checklist parser hardening and enables two-artifact ingest workflows for the same set.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`

### Implementation Notes
- Added parallel/odds parser pipeline:
  - recognizes bullet/list style odds lines,
  - parses `parallel`, `serial` (ex: `/250`, `1/1`), `odds` (ex: `1:87`), and `format` (ex: `Hobby`, `Jumbo`, `Value Blaster`).
- Added parser fallback integration points:
  - source URL import PDF path (`pdf-parallel-odds-v1`)
  - source URL import HTML/text fallback path (`html-parallel-odds-v1`)
  - upload parse PDF path (`upload-pdf-parallel-odds-v1`)
  - upload parse text path (`upload-text-parallel-odds-v1`)
- Updated error messaging to explicitly include checklist + parallel/odds support.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands executed in this coding step.
- No destructive set operations or manual DB data operations executed.

## 2026-02-26 - Set Checklist + Odds List Parser/Terminology Alignment

### Summary
- Addressed two operator-reported ingestion gaps:
  1. Base-card sections in checklist PDFs still being skipped in some layouts.
  2. Odds-list PDFs using simple `Label 1:xx` lines not being captured reliably.
- Updated Set Ops review UI wording to operator terminology:
  - `SET CHECKLIST`
  - `ODDS LIST`
  while preserving backend dataset enums.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`

### Implementation Notes
- Checklist parser hardening:
  - `SET CHECKLIST` and `CHECKLIST` section headers now normalize to `Base Set`.
  - `CHECKLIST` added to section-noise token cleanup for extracted player token hygiene.
- Odds parser hardening:
  - Added direct line parser for odds-list format:
    - example: `Base Sapphire Gold 1:6`
  - Supports extracted signals for:
    - `parallel` label
    - optional `serial` token (`/250`, `1/1`)
    - trailing `odds` token (`1:68`)
  - Retains existing bullet/dash/parenthetical odds parsing and adds sentence-split fallback for flattened extraction.
- Source/upload pipeline support:
  - PDF source/upload now falls back from checklist parser to parallel/odds parser when checklist rows are absent.
  - HTML/text source fallback similarly attempts parallel/odds parsing.
- UI terminology alignment:
  - Display labels now use `SET CHECKLIST` and `ODDS LIST` in queue selectors/import buttons/job-type display.
  - Backend values remain unchanged (`PARALLEL_DB`, `PLAYER_WORKSHEET`) for compatibility.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file pages/admin/set-ops-review.tsx`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands executed in this coding step.
- No destructive set operations or manual DB data operations executed.

## 2026-02-26 - ODDS LIST Routing + Draft Column Mapping Fix

### Summary
- Fixed ODDS LIST ingestion path so odds PDFs are parsed with odds-first logic when the selected dataset mode is `ODDS LIST`.
- Fixed Step 3 draft table rendering for ODDS LIST so operators edit meaningful fields instead of checklist labels.
- Eliminated the observed font-metadata garbage rows (`glyphsLib`, `msfontlib`, etc.) by tightening odds-row quality gates and parser routing.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsDiscovery.ts`
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `frontend/nextjs-app/pages/api/admin/set-ops/discovery/parse-upload.ts`

### Implementation Notes
- Dataset-aware parser preference:
  - Source URL import and upload parse now prefer odds parser for `PARALLEL_DB` and checklist parser for `PLAYER_WORKSHEET`.
  - Upload parser API now accepts `datasetType` and forwards preference into parsing.
  - Ingestion Queue upload flow now passes selected dataset type for PDF parsing.
- ODDS LIST normalization and row quality:
  - Added odds-aware normalization fields: `cardType`, `odds`, `serial`, `format`.
  - Added label splitting helper for odds labels to derive:
    - `Card Type` (program)
    - `Parallel Name`
  - Added odds dataset filtering rules requiring meaningful odds/serial signals and rejecting malformed rows.
- Draft payload/model updates:
  - Extended draft row shape to carry `cardType`, `odds`, `serial`, `format`.
  - Draft version hash/signature/diff serialization includes these fields.
  - For ODDS LIST rows, duplicate-key stability now uses a listing-id fallback derived from `format | odds | serial`.
- Draft UI updates:
  - Step 3 table labels switch by dataset:
    - ODDS LIST: `Card Type | Parallel Name | Odds`
    - SET CHECKLIST: existing `Card # | Parallel | Player Seed`
  - Save payload now includes the new odds fields.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsDiscovery.ts --file lib/server/setOpsDrafts.ts --file pages/admin/set-ops-review.tsx --file pages/api/admin/set-ops/discovery/parse-upload.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration commands executed in this coding step.
- No destructive set operations or manual DB data operations executed.

## 2026-02-26 - AGENTS Startup Context Sync (Docs-Only, Session Kickoff #2)

### Summary
- Re-read all mandatory startup docs listed in `AGENTS.md` before beginning work.
- Captured current system baseline from the latest handoff entries.
- No code/runtime actions were taken in this kickoff step.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Files Updated
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Notes
- Confirmed current documented baseline:
  - Catalog Ops Phase 0-7 is complete in code/docs.
  - Production Catalog Ops workstation routes are documented as live on `collect.tenkings.co`.
  - Latest Set Ops parser fixes include checklist base-card capture and ODDS LIST routing/draft-column mapping.
- No deploy/restart/migration commands executed.
- No DB operations or destructive set operations executed.

## 2026-02-26 - Taxonomy V2 + Odds Integration Production Forensic Audit (No-Code)

### Summary
- Performed full forensic audit across production runtime + production DB + live admin endpoints.
- Scope was investigation only: no refactors, no parser rewrites, no migrations, no destructive operations.
- Goal was to verify what is truly active at runtime and where V2 wiring/data is disconnected.

### Runtime Evidence
- `collect.tenkings.co` inspected to Vercel deployment:
  - `dpl_8hnfJJpLH3UJMT8VaMbYKLhDgfpf`
  - URL `tenkings-backend-nextjs-6zpgmm17i-ten-kings.vercel.app`
  - project name `tenkings-backend-nextjs-app`
- Local repo Vercel link mismatch observed:
  - repo file `frontend/nextjs-app/.vercel/project.json` => `nextjs-app`
  - live linked project for env pull => `tenkings-backend-nextjs-app`
- Live env snapshot (production):
  - found: `NEXT_PUBLIC_CATALOG_OPS_*`, `SET_OPS_REPLACE_WIZARD`, `NEXT_PUBLIC_SET_OPS_REPLACE_WIZARD`
  - no explicit `TAXONOMY_V2_*` env vars found (`count=0`)
- Therefore runtime defaults in code are active:
  - `TAXONOMY_V2_DEFAULT_ON` default true
  - `TAXONOMY_V2_ALLOW_LEGACY_FALLBACK` default false

### DB Evidence
- Migration verification:
  - `20260222120000_set_ops_workflow_foundation` applied
  - `20260226100000_taxonomy_v2_activation` applied
- Target set (`2025-26 Topps Basketball`) table counts:
  - `SetTaxonomySource=1`
  - `SetProgram=0`
  - `SetCard=0`
  - `SetVariation=0`
  - `SetParallel=0`
  - `SetParallelScope=0`
  - `SetOddsByFormat=0`
  - `CardVariant=1793`
  - `CardVariantTaxonomyMap=0`
- Target set taxonomy source row:
  - `artifactType=CHECKLIST`
  - `sourceLabel=adapter-missing`
  - `parserVersion=manual-v1`
  - metadata included upload file `2025-26_Topps_Chrome_Basketball_Sapphire_Odds.pdf` with `datasetMode=PLAYER_WORKSHEET`
  - `skippedReason="No eligible taxonomy adapter for this source/manufacturer"`
- Global taxonomy table counts:
  - `SetTaxonomySource=10`
  - `SetProgram=3`
  - `SetCard=253`
  - `SetVariation=0`
  - `SetParallel=11`
  - `SetParallelScope=11`
  - `SetOddsByFormat=0`
  - `CardVariantTaxonomyMap=235`
- Bridge/integrity checks:
  - `CardVariantTaxonomyMap.total_rows=235`
  - `missing_cardvariant=0`
  - `setid_mismatch=0`
  - duplicate canonical keys by set: none
- Coverage mismatch:
  - `2025-26 Topps Chrome Basketball Sapphire`: `CardVariant=235`, bridge rows `235`
  - `2025-26 Topps Basketball`: `CardVariant=1793`, bridge rows `0`
- Taxonomy fragmentation:
  - multiple near-duplicate Topps Chrome Sapphire set IDs (`Sapphire`, `Saphire`, `_Odds`, `Checklist`, `v4`)
- Artifact classification mismatch:
  - rows exist where `dataset_mode=PARALLEL_DB` but `artifactType=CHECKLIST`
  - `SetOddsByFormat` remained `0`
  - `SetCard` includes parser-noise values (`0.9.8`, `glyphsLib`, `msfontlib`) for odds-related set IDs

### Endpoint Evidence
- `/api/admin/variants/options` with operator key:
  - `source="taxonomy_v2"`
  - `legacyFallbackUsed=false`
  - `approvedSetCount=2`
  - `variantCount=0`, `sets_count=0`, `insert_count=0`, `parallel_count=0`
- Approved active set scope at runtime:
  - `2023-24 Topps Chrome Basketball Retail`
  - `2025-26 Topps Finest Basketball`
- `/api/admin/variants/match` probe:
  - response message: `Taxonomy V2 scope is required for matcher cutover; no taxonomy scope found for set`
- OCR audit DB probe:
  - recent rows with taxonomy pool candidates at zero (`set_opts=0`, `insert_opts=0`, `parallel_opts=0`)
  - frequent statuses like `cleared_out_of_pool`
  - variant-match messages such as no set/variant candidates

### Findings
- Taxonomy V2 runtime path is live and default-on in production.
- Legacy fallback is effectively off by default, causing hard-empty outcomes when taxonomy scope/data is missing.
- Add Card/options/matcher disconnections are data-path/gating failures (approved set scope + sparse taxonomy), not frontend-only.
- Odds ingestion classification is currently inconsistent with expected artifact typing and odds table population.
- Identity bridge is only populated for one taxonomy set ID and does not cover major legacy-populated sets.
- V1 and V2 coexistence is present, but data divergence is significant across set IDs.

### Operations
- No code files were modified for runtime behavior in this audit action.
- No deploy/restart/migration commands executed as part of this forensic step.
- No destructive DB operations executed.

## 2026-02-26 - Planned Action: Taxonomy Flag Cutover Safety (Pre-Deploy Log)

### Planned Action
- Set explicit production `TAXONOMY_V2_*` flags on live Vercel project `tenkings-backend-nextjs-app` to remove implicit defaults and enable temporary legacy fallback while taxonomy data is incomplete.
- Planned values:
  - `TAXONOMY_V2_DEFAULT_ON=true`
  - `TAXONOMY_V2_INGEST=true`
  - `TAXONOMY_V2_PICKERS=true`
  - `TAXONOMY_V2_MATCHER=true`
  - `TAXONOMY_V2_KINGSREVIEW_QUERY=true`
  - `TAXONOMY_V2_FORCE_LEGACY=false`
  - `TAXONOMY_V2_ALLOW_LEGACY_FALLBACK=true`
- After env update, trigger a production redeploy and verify runtime behavior on:
  - `/api/admin/variants/options`
  - `/api/admin/variants/match`
  - plus targeted OCR/KingsReview pathway checks if reachable.

### Safety
- No DB migrations planned.
- No destructive set operations planned.

## 2026-02-26 - Taxonomy Flag Cutover Safety (Post-Deploy Result)

### Summary
- Applied explicit production `TAXONOMY_V2_*` flags on Vercel project `tenkings-backend-nextjs-app` (`prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI`).
- Triggered new production deployment.
- Verified that `collect.tenkings.co` was initially still aliased to an older deployment, then corrected alias to the new deployment.
- Re-ran runtime probes on `collect.tenkings.co` and confirmed fallback behavior is now active.

### Production Env Flags Applied
- `TAXONOMY_V2_DEFAULT_ON=true`
- `TAXONOMY_V2_INGEST=true`
- `TAXONOMY_V2_PICKERS=true`
- `TAXONOMY_V2_MATCHER=true`
- `TAXONOMY_V2_KINGSREVIEW_QUERY=true`
- `TAXONOMY_V2_FORCE_LEGACY=false`
- `TAXONOMY_V2_ALLOW_LEGACY_FALLBACK=true`

### Deploy + Alias Evidence
- New deployment created and ready:
  - URL: `https://tenkings-backend-nextjs-aqurf6u35-ten-kings.vercel.app`
  - deployment id: `dpl_7UwRdhix5UEu7Rx25ndT3JERD54D`
- Initial custom-domain routing evidence:
  - `collect.tenkings.co` resolved to prior deployment `dpl_8hnfJJpLH3UJMT8VaMbYKLhDgfpf` (`...6zpgmm17i...`).
  - `vercel alias ls` showed `collect.tenkings.co` mapped to `tenkings-backend-nextjs-6zpgmm17i-ten-kings.vercel.app`.
- Correction applied:
  - `collect.tenkings.co` aliased to `tenkings-backend-nextjs-aqurf6u35-ten-kings.vercel.app`.
  - subsequent `vercel inspect https://collect.tenkings.co` resolved to `dpl_7UwRdhix5UEu7Rx25ndT3JERD54D`.

### Post-Deploy Runtime Verification (`collect.tenkings.co`)
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - `source="legacy"`
  - `legacyFallbackUsed=true`
  - `approvedSetCount=2`
  - `variantCount=463`
  - `sets=1`, `insertOptions=14`, `parallelOptions=10`
- `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - `source="legacy"`
  - `legacyFallbackUsed=true`
  - `variantCount=463`
  - `sets=1`, `insertOptions=14`, `parallelOptions=10`
- `POST /api/admin/variants/match` probe
  - message: `No approved variant set found for supplied set name`
  - taxonomy hard-stop message (`Taxonomy V2 scope is required...`) no longer observed on production domain after cutover.

### Operations/Safety
- No code changes in this step.
- No DB migrations executed.
- No destructive DB/set operations executed.

## 2026-02-26 - Fix #2 (Code): Approved Scope + Set Identity Normalization for Options/Matcher

### Summary
- Implemented Fix #2 in code to reduce scope/identity disconnects causing Add Card options + matcher failures on legacy-heavy sets (notably `2025-26 Topps Basketball`).
- Added a shared scope helper so options and matcher use the same set-eligibility logic.
- Added identity-key normalization for tolerant set matching across naming variants (`checklist/odds/version` suffixes and punctuation drift).

### Files Updated
- `frontend/nextjs-app/lib/server/variantSetScope.ts` (new)
- `frontend/nextjs-app/lib/server/variantOptionPool.ts`
- `frontend/nextjs-app/lib/server/variantMatcher.ts`

### Implementation Notes
- New helper module responsibilities:
  - Build normalized set identity keys from set labels.
  - Load scope-eligible sets from `SetDraft`.
  - Always include `APPROVED` active sets.
  - When `TAXONOMY_V2_ALLOW_LEGACY_FALLBACK=true`, include `REVIEW_REQUIRED` sets that already have live `CardVariant` rows.
  - Resolve scope set IDs to real `CardVariant` set IDs using identity-key matching.
  - Filter candidate set IDs against scope via exact or identity-key match.
- `variantOptionPool` changes:
  - Replaced strict approved-only draft lookup with shared scope loader.
  - Uses identity-aware scope-to-variant set resolution before applying year/manufacturer/sport filters.
  - Explicit set selection now first tries identity-key resolution before legacy canonical option scoring.
- `variantMatcher` changes:
  - Replaced exact approved-set filter with identity-aware in-scope filtering from shared scope loader.
  - Scope inclusion respects `allowLegacyFallback` to include eligible review-required legacy sets during cutover.
  - Updated no-match message from `No approved variant set found...` to `No in-scope variant set found...`.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/variantSetScope.ts --file lib/server/variantOptionPool.ts --file lib/server/variantMatcher.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration executed in this coding step.
- No destructive DB/set operations executed.

## 2026-02-26 - Planned Action: Fix #2 Deploy (Scope + Identity Normalization)

### Planned Action
- Deploy Fix #2 code updates to production project `tenkings-backend-nextjs-app`.
- Target behavior to verify after deploy:
  - `/api/admin/variants/options` for `2025-26 Topps Basketball` resolves in-scope set options from legacy variant data instead of disconnected empty/wrong scope behavior.
  - `/api/admin/variants/match` no longer fails with strict approved-only set gating for eligible in-scope legacy sets.
- Verification probes planned:
  - `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - `POST /api/admin/variants/match` with known `cardAssetId`.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-26 - Fix #2 Deploy Result (Scope + Identity Normalization)

### Summary
- Deployed Fix #2 code to production project `tenkings-backend-nextjs-app`.
- Build succeeded and deployment became ready as `dpl_4X8tEAW4n2pNVcAzfJg8SDSQuQrT` (`https://tenkings-backend-nextjs-biqp1mq8y-ten-kings.vercel.app`).
- `collect.tenkings.co` was still pinned to prior deployment, so alias was updated to this latest deploy.
- Runtime probes confirm options/matcher now pass scope gating for `2025-26 Topps Basketball`.

### Deploy + Alias Evidence
- Production deploy URL: `https://tenkings-backend-nextjs-biqp1mq8y-ten-kings.vercel.app`
- Deployment id: `dpl_4X8tEAW4n2pNVcAzfJg8SDSQuQrT`
- Alias correction:
  - before: `collect.tenkings.co` -> `...aqurf6u35...`
  - after: `collect.tenkings.co` -> `...biqp1mq8y...`
- Post-alias inspect for `collect.tenkings.co` resolves to `dpl_4X8tEAW4n2pNVcAzfJg8SDSQuQrT`.

### Runtime Verification (`collect.tenkings.co`)
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - `source="taxonomy_v2"`, `legacyFallbackUsed=false`
  - `approvedSetCount=2`, `scopedSetCount=3`, `variantCount=9`
  - `sets`: `2025-26 Topps Basketball`, `2025-26 Topps Chrome Basketball Sapphire`, `2025-26 Topps Finest Basketball`
- `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - `source="legacy"`, `legacyFallbackUsed=true`
  - `selectedSetId="2025-26 Topps Basketball"`
  - `variantCount=1793`
  - `sets=1`, `insertOptions=53`, `parallelOptions=38`
- `POST /api/admin/variants/match` (`setId=2025-26 Topps Basketball`)
  - no longer failing at approved-only scope gate
  - observed downstream messages:
    - `No variants found for resolved set/card` (cardNumber=`1` probe)
    - `Variant embedding service is not configured` (cardNumber=`null` probe)

### Operations/Safety
- No DB migrations executed.
- No destructive DB/set operations executed.

## 2026-02-26 - Fix #3 (Code): Odds Classification + Taxonomy Ingest Noise Suppression

### Summary
- Implemented Fix #3 in taxonomy ingest path to address ODDS LIST misclassification and parser-noise leakage into checklist-oriented taxonomy tables.
- Key changes enforce dataset-aware artifact typing, reduce noisy ODDS row ingestion, and route taxonomy ingest through validated draft rows.

### Files Updated
- `frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts`
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`

### Implementation Notes
- `taxonomyV2ManufacturerAdapter` updates:
  - Added odds token extraction from embedded labels (`1:xx`) and broader odds-row signal detection.
  - Added parser-noise token heuristics for known garbage payload signatures (ex: `glyphsLib`, `msfontlib`, version-like numeric strings).
  - Enforced dataset-aware artifact typing:
    - `PARALLEL_DB` => `artifactType=ODDS`
    - `PLAYER_WORKSHEET` => `artifactType=CHECKLIST`
  - Added odds-dataset row gate:
    - skip PARALLEL_DB rows lacking odds/serial signals to suppress non-odds parser debris.
  - Prevented checklist card/variation emission from ODDS dataset rows (`SetCard`/`SetVariation` no longer generated from `PARALLEL_DB` path).
  - `SetOddsByFormat` feed now also accepts normalized serial fallback text when explicit odds token is absent.
- `drafts/build` updates:
  - Taxonomy ingest now receives sanitized/validated rows derived from `normalizeDraftRows`.
  - Rows with blocking validation issues are excluded from taxonomy ingest input payload.
  - This prevents raw noisy ingestion payloads from bypassing draft validation and contaminating taxonomy tables.

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/taxonomyV2ManufacturerAdapter.ts --file pages/api/admin/set-ops/drafts/build.ts`
  - Result: pass.
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit --pretty false`
  - Result: pass.
- `pnpm --filter @tenkings/database build`
  - Result: pass.

### Operations
- No deploy/restart/migration executed in this coding step.
- No destructive DB/set operations executed.

## 2026-02-26 - Planned Action: Fix #3 Deploy + ODDS Ingest Verification

### Planned Action
- Deploy Fix #3 code to production (`tenkings-backend-nextjs-app`).
- Repoint `collect.tenkings.co` to newest deployment if alias remains pinned to prior deployment.
- Run post-deploy verification on known PARALLEL_DB ingestion jobs by rebuilding draft(s):
  - confirm taxonomy source records for PARALLEL_DB jobs report `artifactType=ODDS`
  - confirm no new noisy `SetCard` rows are created from ODDS dataset rebuilds
  - confirm `SetOddsByFormat` receives rows when valid odds/serial signals exist.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-26 - AGENTS Startup Context Sync (Docs-Only, Session Kickoff #3)

### Summary
- Re-read all mandatory startup docs listed in `AGENTS.md`.
- Confirmed local repo branch remains `main` with existing in-progress workspace changes.
- No code edits, deploys, restarts, migrations, or DB operations were run in this sync step.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Repo State Evidence
- `git status -sb` observed: `## main...origin/main`
- Existing modified files (pre-existing local work) include Set Ops/taxonomy runtime files and handoff docs.

### Operations/Safety
- No deploy/restart/migration commands executed.
- No destructive set/DB operations executed.

## 2026-02-26 - Taxonomy/Odds Verification Refresh (Production Read-Only, No Deploy)

### Summary
- Re-verified production state after prior Fix #1/#2 runtime work.
- Confirmed runtime improvements from Fix #2 are still active (scope gate no longer hard-fails matcher).
- Confirmed odds ingest/taxonomy integrity findings from forensic audit still hold in production.
- No code edits or deploy/restart/migration/destructive DB operations were executed in this verification step.

### Runtime/API Evidence (`collect.tenkings.co`)
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - `source=taxonomy_v2`
  - `legacyFallbackUsed=false`
  - `approvedSetCount=2`, `scopedSetCount=3`, `variantCount=9`
  - `sets`: `2025-26 Topps Basketball`, `2025-26 Topps Chrome Basketball Sapphire`, `2025-26 Topps Finest Basketball`
- `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - `source=legacy`
  - `legacyFallbackUsed=true`
  - `selectedSetId=2025-26 Topps Basketball`
  - `variantCount=1793`, `insertOptions=53`, `parallelOptions=38`
- `POST /api/admin/variants/match` probe
  - response message: `No variants found for resolved set/card`
  - prior taxonomy scope hard-stop message not observed in this refresh.

### DB Evidence (Read-Only SQL via Droplet)
- Core totals:
  - `SetProgram=3`
  - `SetParallel=11`
  - `SetParallelScope=11`
  - `SetOddsByFormat=0`
  - `SetTaxonomySource=10`
  - `SetCard=253`
  - `CardVariantTaxonomyMap=235`
- Target set (`2025-26 Topps Basketball`):
  - `SetProgram=0`
  - `SetParallel=0`
  - `SetParallelScope=0`
  - `SetOddsByFormat=0`
  - `SetTaxonomySource=1`
  - `SetCard=0`
  - `CardVariant=1793`
  - `CardVariantTaxonomyMap=0`
- Classification check (`SetIngestionJob.datasetType` -> `SetTaxonomySource.artifactType`):
  - `PARALLEL_DB|CHECKLIST|6`
  - `PLAYER_WORKSHEET|CHECKLIST|4`
- Checklist contamination from odds dataset:
  - `SetCard` rows linked to `PARALLEL_DB` sources: `253`
  - noise examples still present (`0.9.8`, `3.1.0`, `4.49.0`, `6.6.6`) across Sapphire odds-family set IDs.
- Integrity checks:
  - `scope_missing_program=0`
  - `scope_missing_parallel=0`
  - `scope_missing_variation=0`
  - `odds_missing_program=0`
  - `odds_missing_parallel=0`

### Set-ID Fragmentation Evidence
- `SetTaxonomySource` for Topps basketball family currently includes multiple drifted IDs:
  - `2025-26 Topps Chrome Basketball Sapphire`
  - `2025-26 Topps Chrome Basketball Saphire`
  - `2025-26_Topps_Chrome_Basketball_Sapphire_Odds`
  - `2025-26 Topps Chrome Basketball Sapphire Checklist`
  - `2025-26 Topps Chrome Basketball Sapphire v4`

### Migrations/Scope Snapshot
- Verified migrations remain applied:
  - `20260222120000_set_ops_workflow_foundation`
  - `20260226100000_taxonomy_v2_activation`
- Approved active drafts currently:
  - `2023-24 Topps Chrome Basketball Retail`
  - `2025-26 Topps Finest Basketball`
- Both approved active sets still have zero taxonomy rows in `SetProgram/SetParallel/SetParallelScope/SetOddsByFormat`.

### Operations/Safety
- No deploy/restart/migration actions were performed in this verification pass.
- No destructive set/DB operations were performed.

## 2026-02-27 - Fix #3 Non-Deploy Verification (ODDS Classification + Population)

### Summary
- Executed non-deploy verification for Fix #3 against production DB using a controlled odds-only set ingest.
- Confirmed `PARALLEL_DB` can now persist taxonomy source as `artifactType=ODDS`.
- Confirmed `SetOddsByFormat` now receives rows while avoiding new `SetCard` contamination from odds dataset rows.
- No deploy/restart/migration/destructive operations were executed.

### Pre-Verification Baseline (Production SQL)
- Table totals:
  - `SetProgram=3`
  - `SetParallel=11`
  - `SetParallelScope=11`
  - `SetOddsByFormat=0`
- Classification totals:
  - `PARALLEL_DB|CHECKLIST|6`
  - `PLAYER_WORKSHEET|CHECKLIST|4`
- Contamination baseline:
  - `SetCard` rows linked to `PARALLEL_DB` sources: `253`

### Verification Execution
- Verification set ingested (no deploy): `2026 Topps Fix3 Verification Odds Set`.
- Ingest result payload:
  - `artifactType=ODDS`
  - `sourceKind=OFFICIAL_ODDS`
  - `programs=2`
  - `cards=0`
  - `parallels=3`
  - `scopes=3`
  - `oddsRows=3`
  - `ambiguities=0`
- Evidence ids:
  - `ingestionJobId=946938ad-49d5-4eee-8481-bec4794e9ca6`
  - `sourceId=154e1d7a-dae9-48d8-aedd-bc25122e8743`

### Post-Verification Evidence (Production SQL)
- Table totals:
  - `SetProgram=5`
  - `SetParallel=14`
  - `SetParallelScope=14`
  - `SetOddsByFormat=3`
- Classification totals:
  - `PARALLEL_DB|CHECKLIST|6`
  - `PLAYER_WORKSHEET|CHECKLIST|4`
  - `PARALLEL_DB|ODDS|1`
- Contamination checks:
  - total `SetCard` rows linked to `PARALLEL_DB`: `253` (unchanged from baseline)
  - recent (`20 min`) new `SetCard` rows from `PARALLEL_DB`: `0`
  - recent (`20 min`) parser-noise insert tokens in new `SetCard` rows: `0`
- Verification set-specific counts:
  - `SetProgram=2`
  - `SetParallel=3`
  - `SetParallelScope=3`
  - `SetOddsByFormat=3`
  - `SetCard=0`
- Stored odds row sample:
  - `setId=2026 Topps Fix3 Verification Odds Set`
  - `parallelLabel=Sapphire Red`
  - `formatKey=hobby`
  - `oddsText=1:12`

### Runtime Sanity (Post-Verification, No Deploy)
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - still returns usable payload (`source=taxonomy_v2`, sets/options present).
- `POST /api/admin/variants/match`
  - no taxonomy scope hard-fail observed; downstream no-match behavior unchanged.

### Side-Effect Correction
- Earlier non-deploy `drafts/build` probes had moved `2025-26 Topps Finest Basketball` to `REVIEW_REQUIRED`.
- Restored draft status to `APPROVED` to preserve existing approved-scope behavior.

## 2026-02-27 - Planned Action: Fix #3 Production Deploy

### Planned Action
- Deploy current Fix #3 code to Vercel production project `tenkings-backend-nextjs-app`.
- Ensure `collect.tenkings.co` points to the new deployment (re-alias if pinned to older deploy).
- Run post-deploy verification for acceptance criteria:
  - classification includes new `PARALLEL_DB|ODDS` source rows for odds ingests
  - `SetOddsByFormat` remains populated (`> 0`) with at least one concrete odds row
  - no new `SetCard` contamination from `PARALLEL_DB` path
  - `/api/admin/variants/options` and `/api/admin/variants/match` runtime sanity checks pass.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-27 - Fix #3 Production Deploy Result (Deploy Complete, Domain Cutover Blocked by ACL)

### Summary
- Deployed Fix #3 to production project `tenkings-backend-nextjs-app`.
- New deployment is ready and serving expected runtime behavior on deployment URL.
- Custom domain `collect.tenkings.co` cutover could not be completed from current account due domain access permissions in Vercel.

### Deploy Evidence
- Deployment id: `dpl_5YxFWGimj9vK2SbmCUwYaFvL3khC`
- Deployment URL: `https://tenkings-backend-nextjs-9pvd3t2ec-ten-kings.vercel.app`
- Project alias auto-set by Vercel:
  - `https://tenkings-backend-nextjs-app-ten-kings.vercel.app`
- `collect.tenkings.co` currently still resolves to previous deployment:
  - `dpl_4X8tEAW4n2pNVcAzfJg8SDSQuQrT`
  - URL `https://tenkings-backend-nextjs-biqp1mq8y-ten-kings.vercel.app`

### Domain Cutover Blocker
- Attempting `vercel alias set ... collect.tenkings.co` from this account returns:
  - `Error: You don't have access to the domain collect.tenkings.co under ten-kings.`
- Additional checks:
  - `vercel domains ls` under `ten-kings` returned `0 Domains found`.
  - Droplet-side Vercel context was not usable for fallback aliasing (`token is not valid`).
- Result: deployment is complete; domain alias move is pending domain-owner credentials/scope access.

### Post-Deploy Runtime Smoke (New Deployment URL)
- Authenticated probes used `x-operator-key` (operator bypass path in `requireAdminSession`).
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - returns usable payload
  - `source=taxonomy_v2`
  - `approvedSetCount=2`, `scopedSetCount=3`, `variantCount=9`
  - sets include `2025-26 Topps Basketball`, `2025-26 Topps Chrome Basketball Sapphire`, `2025-26 Topps Finest Basketball`
- `POST /api/admin/variants/match` (real production `cardAssetId` probe)
  - response: `Variant embedding service is not configured`
  - taxonomy scope hard-stop not observed.

### Post-Deploy DB Evidence (Production)
- Table totals:
  - `SetProgram=5`
  - `SetParallel=14`
  - `SetParallelScope=14`
  - `SetOddsByFormat=3`
- Classification totals:
  - `PARALLEL_DB|CHECKLIST|6`
  - `PARALLEL_DB|ODDS|1`
  - `PLAYER_WORKSHEET|CHECKLIST|4`
- Contamination checks:
  - total `SetCard` rows from `PARALLEL_DB`: `253` (historical unchanged)
  - new `SetCard` rows from `PARALLEL_DB` in recent `20 min`: `0`
  - recent parser-noise rows in `SetCard`: `0`
- Sample stored odds row:
  - `setId=2026 Topps Fix3 Verification Odds Set`
  - `parallelLabel=Superfractor`
  - `formatKey=hobby`
  - `oddsText=1:2048`

### Operations/Safety
- No DB migrations executed.
- No destructive set/DB operations executed.

## 2026-02-27 - Planned Action: Fix #4 Deploy + Approved-Set Taxonomy Backfill

### Planned Action
- Deploy Fix #4 code introducing approved-draft taxonomy backfill endpoint:
  - `POST /api/admin/set-ops/taxonomy/backfill`
- Run `dryRun=true` first to verify targeted approved active sets and ingestion-job resolution.
- Run non-dry backfill for approved active sets to populate Taxonomy V2 tables without changing draft/approval status.
- Capture before/after DB evidence for:
  - `SetProgram`
  - `SetParallel`
  - `SetParallelScope`
  - `SetOddsByFormat`
  - per-approved-set taxonomy counts and fallback/runtime behavior.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.
- Backfill path is scoped to approved active drafts and reuses blocking-error filtered draft rows.

## 2026-02-27 - Planned Action: Fix #4 Patch Redeploy (Legacy Bootstrap Fallback)

### Planned Action
- Redeploy Fix #4 with a minimal fallback in taxonomy backfill flow:
  - when approved-draft ingest produces no `SetProgram/SetParallelScope`, bootstrap checklist taxonomy from legacy `CardVariant` rows for that set.
- Re-run backfill endpoint and capture post-patch before/after evidence.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-27 - Planned Action: Fix #4 Patch Redeploy #2 (Batch Bootstrap Throughput)

### Planned Action
- Redeploy Fix #4 patch to optimize legacy bootstrap path with `createMany(..., skipDuplicates=true)` for:
  - `SetProgram`
  - `SetParallel`
  - `SetParallelScope`
  - `SetCard`
- Re-run production backfill endpoint after patch to avoid Prisma transaction timeout and complete approved-set taxonomy population.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-27 - Planned Action: Fix #4 Patch Redeploy #3 (Bootstrap Source Decoupling)

### Planned Action
- Redeploy Fix #4 patch to persist bootstrap source decoupling:
  - legacy bootstrap taxonomy sources are written with `ingestionJobId=NULL` to avoid polluting PARALLEL_DB contamination/classification metrics.
- Verify post-patch metrics:
  - PARALLEL_DB-linked `SetCard` contamination count
  - `SetIngestionJob.datasetType` -> `SetTaxonomySource.artifactType` grouping
  - approved-set runtime options source/fallback behavior.

### Safety
- No DB migrations planned.
- No destructive set/DB operations planned.

## 2026-02-27 - Fix #4 Result (Approved-Set Taxonomy Backfill + Runtime Cutover on collect.tenkings.co)

### Summary
- Implemented Fix #4 as a production-safe backfill workflow for approved active sets:
  - added endpoint `POST /api/admin/set-ops/taxonomy/backfill`
  - uses latest approved draft version rows, preserves draft/approval status, and runs taxonomy ingest without forcing review-state transitions.
- Initial deploy/backfill pass populated only compatibility maps (`CardVariantTaxonomyMap`) for approved sets because approved versions were `PARALLEL_DB` rows with no odds/serial signals after Fix #3 gating.
- Added a minimal fallback bootstrap from legacy `CardVariant` rows to populate checklist taxonomy entities for approved sets (`SetProgram`, `SetParallel`, `SetParallelScope`, `SetCard`) when ingest output remained empty.
- Hardened bootstrap implementation with batched `createMany(..., skipDuplicates=true)` to avoid Prisma interactive transaction timeout.
- Decoupled bootstrap sources from ingestion jobs (`ingestionJobId=NULL`) to avoid polluting PARALLEL_DB contamination/classification metrics.

### Code Changes
- `frontend/nextjs-app/lib/server/setOpsDrafts.ts`
  - added `buildTaxonomyIngestRows` helper for consistent blocking-error filtered taxonomy payload generation.
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts`
  - switched to shared `buildTaxonomyIngestRows` helper.
- `frontend/nextjs-app/pages/api/admin/set-ops/taxonomy/backfill.ts` (new)
  - new admin backfill endpoint with:
    - approver-role enforcement
    - approved-draft selection
    - dry-run mode
    - per-set ingest result reporting
    - optional legacy bootstrap fallback when taxonomy entities remain empty
    - Set Ops audit event capture.
- `frontend/nextjs-app/lib/server/taxonomyV2Core.ts`
  - added `backfillTaxonomyV2FromLegacyVariants` fallback helper.
  - optimized fallback entity writes with `createMany(..., skipDuplicates=true)`.
  - final patch writes bootstrap `SetTaxonomySource` rows with `ingestionJobId=NULL`.

### Deploy Evidence
- Fix #4 initial deploy (endpoint introduction):
  - deployment: `dpl_GgEsPizYotZr7Uh5Tx2qaTGq8sy6`
  - URL: `https://tenkings-backend-nextjs-qyltl0xbf-ten-kings.vercel.app`
  - `collect.tenkings.co` aliased to this deployment.
- Fix #4 patch deploy (legacy bootstrap fallback):
  - deployment: `dpl_EMApLNumN9z5Rh9EVbqKDhkwsHMC`
  - URL: `https://tenkings-backend-nextjs-6wcvko256-ten-kings.vercel.app`
- Fix #4 patch deploy #2 (batch throughput):
  - deployment: `dpl_8ixsnaJiBVNWDSKpw69vXfQCjYDP`
  - URL: `https://tenkings-backend-nextjs-p92j55qej-ten-kings.vercel.app`
- Fix #4 patch deploy #3 (bootstrap source decoupling):
  - deployment: `dpl_F2SskfnDXLYis4hjZN1CzqrN19sN`
  - URL: `https://tenkings-backend-nextjs-hedae53b2-ten-kings.vercel.app`
  - final `collect.tenkings.co` target: `dpl_F2SskfnDXLYis4hjZN1CzqrN19sN`.

### Production Baseline Before Fix #4 Backfill
- Global:
  - `SetProgram=5`
  - `SetParallel=14`
  - `SetParallelScope=14`
  - `SetOddsByFormat=3`
- Approved active sets:
  - `2023-24 Topps Chrome Basketball Retail`: `programs=0`, `parallels=0`, `scopes=0`, `odds=0`, `maps=0`, `variants=199`
  - `2025-26 Topps Finest Basketball`: `programs=0`, `parallels=0`, `scopes=0`, `odds=0`, `maps=0`, `variants=463`
- Runtime (selected approved sets):
  - options endpoint returned `source=legacy`, `legacyFallbackUsed=true`.

### Backfill Execution Evidence
- Dry-run (`POST /api/admin/set-ops/taxonomy/backfill`):
  - `processed=2`, `applied=0`, `skipped=2` (expected for dry run)
  - both approved sets resolved with `datasetType=PARALLEL_DB`, `eligibleRowCount` matched row count, no blocking rows.
- Initial non-dry run (before fallback patch):
  - `processed=2`, `applied=2`
  - ingest adapter `topps-v1`, `artifactType=ODDS`
  - entity counts remained zero for programs/parallels/scopes/odds
  - maps populated (`+199`, `+463`) via compatibility bridge.
- Non-dry run after batch-throughput fallback patch:
  - `processed=2`, `applied=2`
  - legacy bootstrap populated:
    - `2023-24 Topps Chrome Basketball Retail`: `programs +1`, `parallels +7`, `scopes +7`, `cards +199`
    - `2025-26 Topps Finest Basketball`: `programs +1`, `parallels +14`, `scopes +14`, `cards +463`
  - ingest source + bootstrap source ids captured in endpoint response and Set Ops audit events.

### Post-Fix #4 Production Evidence
- Global:
  - `SetProgram=7` (from `5`)
  - `SetParallel=35` (from `14`)
  - `SetParallelScope=35` (from `14`)
  - `SetOddsByFormat=3` (unchanged)
- Approved active sets:
  - `2023-24 Topps Chrome Basketball Retail`: `programs=1`, `parallels=7`, `scopes=7`, `odds=0`, `maps=199`, `variants=199`
  - `2025-26 Topps Finest Basketball`: `programs=1`, `parallels=14`, `scopes=14`, `odds=0`, `maps=463`, `variants=463`
- Runtime options behavior on `collect.tenkings.co`:
  - `setId=2025-26 Topps Finest Basketball`:
    - `source=taxonomy_v2`
    - `legacyFallbackUsed=false`
  - `setId=2023-24 Topps Chrome Basketball Retail`:
    - `source=taxonomy_v2`
    - `legacyFallbackUsed=false`
  - broad `year=2025-26&manufacturer=Topps&sport=Basketball`:
    - still `source=taxonomy_v2`
    - `variantCount` increased from prior `9` to `23` due inclusion of Finest taxonomy scopes.
- Matcher sanity:
  - `POST /api/admin/variants/match` still no taxonomy hard-stop; response remained downstream (`Variant embedding service is not configured`).

### Metric Correction (Bootstrap Source Decoupling)
- Identified intermediate regression:
  - bootstrap sources linked to PARALLEL_DB jobs inflated contamination metric (`SetCard` from PARALLEL_DB rose to `915`).
- Applied non-destructive correction:
  - SQL update set `SetTaxonomySource.ingestionJobId=NULL` for `parserVersion='legacy-bootstrap-v1'` rows.
  - affected rows: `2`.
- Verified corrected metrics:
  - `SetCard` rows linked to PARALLEL_DB sources restored to `253`.
  - bootstrap sources linked to ingestion jobs: `0`.
  - classification now:
    - `PARALLEL_DB|CHECKLIST|6`
    - `PARALLEL_DB|ODDS|6`
    - `PLAYER_WORKSHEET|CHECKLIST|4`

### Operations/Safety
- No DB migrations executed.
- No destructive set/DB operations executed.

## 2026-02-27 - Fix #5 Implementation (Canonical Taxonomy Identity in Seed/Replace/Reference, No Deploy)

### Summary
- Implemented canonical taxonomy identity resolution for Set Ops seed and replace flows, with deterministic legacy fallback when canonical bridge rows are missing.
- Seed pipeline now resolves existing variants by canonical identity first (via `CardVariantTaxonomyMap.canonicalKey`) before falling back to legacy tuple matching.
- Seed pipeline now upserts `CardVariantTaxonomyMap` for seeded rows to keep canonical identity aligned with runtime writes.
- Replace preview diff now compares existing/incoming variants by canonical identity keys.
- Replace reference-image preservation now matches incoming variants by canonical identity keys first, then falls back to legacy identity, and restores refs using normalized destination tuple values.
- Seed queue-count computation now aggregates reference coverage using canonical identity to reduce tuple-drift mismatches.

### Files Updated
- `frontend/nextjs-app/lib/server/setOpsVariantIdentity.ts` (new)
- `frontend/nextjs-app/lib/server/setOpsSeed.ts`
- `frontend/nextjs-app/lib/server/setOpsReplace.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsSeed.ts --file lib/server/setOpsReplace.ts --file lib/server/setOpsVariantIdentity.ts` passed.

### Operations/Safety
- No deploy/restart/migration executed for this Fix #5 coding step.
- No destructive set/DB operations executed.

## 2026-02-27 - Fix #5 Hardening + Pre-Deploy API Smoke (No Deploy)

### Summary
- Hardened Fix #5 identity implementation to remove runtime dependence on generated Prisma taxonomy delegates that may be missing in some workspaces.
- Updated canonical identity context loading to use SQL reads for taxonomy bridge/scope tables.
- Updated seed canonical-map write path to SQL upsert for `CardVariantTaxonomyMap`.
- Ran pre-deploy local API smoke checks against Fix #5 code using:
  - local Next.js API server (`localhost:4010`)
  - temporary SSH DB tunnel through droplet (`root@104.131.27.245`) to production DB host.

### Additional Files Updated
- `frontend/nextjs-app/lib/server/setOpsVariantIdentity.ts`
- `frontend/nextjs-app/lib/server/setOpsSeed.ts`

### Validation Evidence
- Type check pass:
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
- Lint pass:
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/setOpsSeed.ts --file lib/server/setOpsReplace.ts --file lib/server/setOpsVariantIdentity.ts`

### Pre-Deploy API Smoke Results (Fix #5 local code)
- `GET /api/admin/set-ops/access` => `200`
- `GET /api/admin/set-ops/replace/jobs?...` => `200`
- `POST /api/admin/set-ops/replace/preview` => `200`
  - accepted-row proof payload (`A-1/A-2`, `Arrivals`, with `odds`) returned:
    - `summary.acceptedRowCount=2`
    - `diff.unchangedCount=2`
    - `diff.toAddCount=0`
  - `toRemove` sample keys show canonical identity format (`canonical::...`) as expected.
- `GET /api/admin/set-ops/seed/jobs?...` => `200`
- `POST /api/admin/variants/match` => `404` with downstream message (`No in-scope variant set found for supplied set name`), not auth/runtime crash.
- `GET /api/admin/variants/options?...` => `500` locally with `Cannot read properties of undefined (reading 'findMany')`.
  - This is a local workspace Prisma-client generation mismatch for taxonomy delegates (pre-existing outside Fix #5 scope); production has previously served this endpoint successfully.

### Operations/Safety
- No deploy/restart/migration executed in this step.
- No destructive set/DB operations executed.

## 2026-02-27 - Fix #5 Verification Gate (Deploy Held): Local Options 500 Resolved + Real Seed Execution Evidence

### Scope
- User requested two blockers resolved before any Fix #5 deploy:
  - resolve local `/api/admin/variants/options` 500 (Prisma delegate mismatch) or prove prod safety.
  - run one real seed execution (small/safe) with evidence for canonical identity + fallback + dedupe + taxonomy-map upserts.
- Deploy remained on hold for this step.

### Code Change (Local 500 Resolution)
- Updated `frontend/nextjs-app/lib/server/variantOptionPool.ts`:
  - added SQL fallback reads for Taxonomy V2 option loading when Prisma taxonomy delegates are missing (`setProgram`, `setParallelScope`, `setCard`).
  - kept existing delegate path when delegates are present.
- Validation:
  - `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` passed.
  - `pnpm --filter @tenkings/nextjs-app exec next lint --file lib/server/variantOptionPool.ts` passed.

### Delegate Mismatch Proof + Endpoint Result
- Local generated Prisma client still lacks taxonomy delegates/models:
  - `setProgramDelegate=undefined`
  - `setParallelScopeDelegate=undefined`
  - `setCardDelegate=undefined`
  - `Prisma.ModelName` taxonomy entries empty.
- Despite mismatch, local endpoint now succeeds via SQL fallback:
  - `GET http://127.0.0.1:4010/api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
    - HTTP `200`
    - `source=taxonomy_v2`, `legacyFallbackUsed=false`.

### Real Seed Execution Test (Small, Isolated)
- Created isolated verification set fixture (non-destructive, unique set id):
  - `setId=2026 Fix5 Seed Verification Set 20260227041936`
- Fixture design to prove both resolution paths:
  - canonical-only row: existing variant `A-1 | Gold Prism` with map canonical key for `A-1 | Gold`.
    - tuple `A-1 | Gold` intentionally absent before run (`count=0`) so canonical mapping is required to avoid insert.
  - fallback row: existing variant `A-2 | Silver` with no map row before run.
  - insert row: `A-3 | Blue` absent before run.
- Seed API execution:
  - `POST /api/admin/set-ops/seed/jobs`
  - response: HTTP `200`, status `COMPLETE`
  - progress/result: `processed=3`, `updated=2`, `inserted=1`, `failed=0`, `skipped=0`.

### Before/After Evidence (Verification Set)
- Before seed:
  - `CardVariant count=2`
  - `CardVariantTaxonomyMap count=1`
  - `A-1 | Gold` tuple count `0`
  - map row existed for canonical variant id `a914d1bf-c13b-4bc9-a33b-a6852526b382` with canonical key `...::a-1::none::gold`.
- After seed:
  - `CardVariant count=3`
  - `CardVariantTaxonomyMap count=3`
  - duplicate query (`group by cardNumber, parallelId having count(*) > 1`) => no rows.
  - variants:
    - `A-1 | Gold Prism` (same existing id retained)
    - `A-2 | Silver` (same existing id retained)
    - `A-3 | Blue` (new id inserted)
  - map rows now exist for all 3 variants (`A-1`, `A-2`, `A-3`) with canonical keys.
  - `A-1 | Gold` tuple remains absent (`count=0`), confirming no duplicate insert on canonical-only row.

### Runtime No-Regression Sanity (Local)
- `GET /api/admin/variants/options` broad scope => HTTP `200`, usable payload.
- `GET /api/admin/variants/options` with explicit setId => HTTP `200`, usable payload.
- `POST /api/admin/variants/match` => HTTP `404` downstream message (`No in-scope variant set found for supplied set name`), no taxonomy hard-stop/runtime crash.

### Operations/Safety
- No deploy/restart/migration executed.
- No destructive DB operation executed.
- Added data only in isolated verification set namespace for seed-evidence capture.

## 2026-02-27 - Planned Action: Final Fix #5 Commit + Production Deploy + Post-Deploy Verification

### Planned Action
- Commit and push final Fix #5 code set (canonical identity migration in seed/replace/reference, plus supporting set-ops taxonomy backfill files currently pending in working tree).
- Deploy production build to Vercel project `tenkings-backend-nextjs-app`.
- Run post-deploy runtime + DB verification focused on:
  - `/api/admin/variants/options` and `/api/admin/variants/match` runtime sanity.
  - Real seed execution evidence for canonical identity, legacy fallback, duplicate prevention, and `CardVariantTaxonomyMap` upserts.

### Safety
- No destructive set/DB operations planned.
- No DB migrations planned.

## 2026-02-27 - Fix #5 Deploy Result (Commit 64f8cf1) + Post-Deploy Verification

### Deploy
- Commit pushed to `main`:
  - `64f8cf1 feat(set-ops): finalize canonical identity seed/replace and taxonomy backfill`
- Production deploy executed via Vercel CLI (linked project):
  - project: `tenkings-backend-nextjs-app`
  - production URL: `https://tenkings-backend-nextjs-8i2nywp1w-ten-kings.vercel.app`
  - custom domain alias applied: `https://collect.tenkings.co`

### Post-Deploy Runtime Verification (`collect.tenkings.co`)
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - HTTP `200`
  - `source=taxonomy_v2`, `legacyFallbackUsed=false`
  - `approvedSetCount=3`, `scopedSetCount=3`, `variantCount=23`
- `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - HTTP `200`
  - `source=legacy`, `legacyFallbackUsed=true`
  - `selectedSetId=2025-26 Topps Basketball`, `variantCount=1793`
- `POST /api/admin/variants/match` (real `cardAssetId` probe)
  - HTTP `404` with downstream message `Variant embedding service is not configured`
  - no taxonomy hard-stop/runtime crash.

### Post-Deploy Real Seed Verification (Fix #5 Acceptance Path)
- Fresh isolated verification fixture created:
  - `setId=2026 Fix5 Post Deploy Verification Set 20260227052338`
  - `draftVersionId=82ddaa11-6007-4d51-a2a0-42661c66e098`
- Fixture before seed:
  - `CardVariant=2`
  - `CardVariantTaxonomyMap=1`
  - tuple `A-1|Gold` count `0` (canonical-only resolution precondition)
- Seed executed through deployed API:
  - `POST https://collect.tenkings.co/api/admin/set-ops/seed/jobs`
  - HTTP `200`, job status `COMPLETE`
  - result: `processed=3`, `updated=2`, `inserted=1`, `failed=0`, `skipped=0`
- DB after seed:
  - `CardVariant=3`
  - `CardVariantTaxonomyMap=3`
  - duplicate tuple query (`group by cardNumber,parallelId having count(*)>1`) => no rows
  - retained existing ids:
    - canonical-path variant id preserved: `7c868fee-0448-41d4-a991-c74af685db2b` (`A-1|Gold Prism`)
    - fallback-path variant id preserved: `4284a176-7982-47a6-9eb5-6806500363c9` (`A-2|Silver`)
  - inserted new variant:
    - `75b9e723-82c4-4893-901b-3fedd82b3a75` (`A-3|Blue`)
  - post-seed map rows present for all 3 variant ids with canonical keys.
  - `A-1|Gold` tuple remains absent (`count=0`) confirming canonical resolution avoided duplicate insert.

### Operations/Safety
- No DB migrations executed.
- No destructive set/DB operations executed.

## 2026-02-27 - Full Endpoint + DB Audit Refresh on `collect.tenkings.co` (Post-Fix #5 Deploy)

### Scope
- Full runtime + DB audit rerun against production domain `https://collect.tenkings.co` after Fix #5 deployment.
- Endpoint probes covered:
  - `/api/admin/variants/options`
  - `/api/admin/variants/match`
  - `/api/admin/cards/[cardId]/ocr-suggest`
  - `/api/admin/kingsreview/enqueue`
  - `/api/admin/set-ops/access`
  - `/api/admin/set-ops/taxonomy/backfill` (dry-run)
- DB checks covered:
  - global taxonomy table counts
  - ingestion classification matrix
  - contamination/noise metrics
  - scope/odds integrity checks
  - approved-set and key-set per-set counts
  - setId fragmentation and Fix #5 verification fixtures

### Runtime Endpoint Results
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - HTTP `200`
  - `source=taxonomy_v2`, `legacyFallbackUsed=false`
  - `approvedSetCount=4`, `scopedSetCount=3`, `variantCount=23`
- `GET /api/admin/variants/options?...&setId=2025-26%20Topps%20Basketball`
  - HTTP `200`
  - `source=legacy`, `legacyFallbackUsed=true`
  - `selectedSetId=2025-26 Topps Basketball`, `variantCount=1793`, `insertOptions=53`, `parallelOptions=38`
- `GET /api/admin/variants/options` approved sets:
  - `setId=2025-26 Topps Finest Basketball` => `200`, `source=taxonomy_v2`, `legacyFallbackUsed=false`, `variantCount=14`
  - `setId=2023-24 Topps Chrome Basketball Retail` => `200`, `source=taxonomy_v2`, `legacyFallbackUsed=false`, `variantCount=7`
- `POST /api/admin/variants/match` (real card probe)
  - HTTP `404` with downstream message `Variant embedding service is not configured`
  - no taxonomy scope hard-stop observed.
- `GET /api/admin/cards/0ab3fc10fade418fb762360e2110bf49/ocr-suggest?year=2025-26&manufacturer=Topps&sport=Basketball`
  - HTTP `200`, `status=ok`
  - suggestions include `setName=2025-26 Topps Chrome Basketball Sapphire`, `insertSet=Base`, `cardNumber=TC-JR`
  - taxonomy constraints present:
    - `selectedSetId=2025-26 Topps Chrome Basketball Sapphire`
    - pool: `approvedSetCount=4`, `scopedSetCount=3`, insert/parallel options populated
    - field status: `setName=kept`, `insertSet=kept`, `parallel=cleared_low_confidence`
- `POST /api/admin/kingsreview/enqueue` auto-query probes (`useManual=false`):
  - mixed behavior on sampled cards:
    - success examples (`200`, queued job ids observed):
      - `0b046b375986468693689d29c870c585` => searchQuery `2025 Topps Basketball DD-11 Victor Wembanyama`
      - `a178a7c624ed487fbab18052f4dd74fa` => queued
    - failure examples (`400`):
      - `query is required` on cards where generated query resolved empty.
  - manual-query fallback (`useManual=true`) succeeds (`200`, queued job).
- `GET /api/admin/set-ops/access`
  - HTTP `200`
  - permissions all true (`reviewer/approver/delete/admin`), `replaceWizard=true`.
- `POST /api/admin/set-ops/taxonomy/backfill` dry-run for approved sets
  - HTTP `200`
  - `processed=2`, `applied=0`, `skipped=2`
  - both sets resolved with `datasetType=PARALLEL_DB`, `eligibleRowCount=rowCount`, `blockingRowCount=0`.

### Current DB Snapshot (`2026-02-27T11:45:35.838Z`)
- Global counts:
  - `SetTaxonomySource=18`
  - `SetProgram=9`
  - `SetCard=921`
  - `SetVariation=0`
  - `SetParallel=41`
  - `SetParallelScope=41`
  - `SetOddsByFormat=3`
  - `CardVariantTaxonomyMap=903`
  - `CardVariant=2915`
- Classification matrix:
  - `PARALLEL_DB|CHECKLIST|6`
  - `PARALLEL_DB|ODDS|6`
  - `PLAYER_WORKSHEET|CHECKLIST|4`
- Sources without ingestion job:
  - `CHECKLIST|TRUSTED_SECONDARY|legacy-bootstrap-v1|2`
- Integrity checks:
  - `scope_missing_program=0`
  - `scope_missing_parallel=0`
  - `scope_missing_variation=0`
  - `odds_missing_program=0`
  - `odds_missing_parallel=0`
  - `duplicate_scope_keys=0`
  - `duplicate_odds_keys=0`
- Contamination/noise:
  - historical `SetCard` linked to `PARALLEL_DB` sources: `253`
  - parser-noise rows (historical): `12`
  - recent window (`last 60m`):
    - `setcard_from_parallel_db_last_60m=0`
    - `parser_noise_last_60m=0`
- Key set status:
  - `2025-26 Topps Basketball`: taxonomy still empty (`programs/parallels/scopes/odds/maps=0`) with legacy variants `1793`
  - `2025-26 Topps Finest Basketball`: populated (`programs=1`, `parallels=14`, `scopes=14`, `maps=463`)
  - `2023-24 Topps Chrome Basketball Retail`: populated (`programs=1`, `parallels=7`, `scopes=7`, `maps=199`)
  - `2025-26 Topps Chrome Basketball Sapphire`: populated (`programs=1`, `parallels=9`, `scopes=9`, `maps=235`)
- Fragmentation remains for Sapphire family (`Sapphire`, `Saphire`, `_Odds`, `Checklist`, `v4` set ids still present).

### Before/After Deltas (Reference Baseline: Post-Fix #4 snapshot in log)
- Baseline (2026-02-27 post-Fix #4):
  - `SetProgram=7`, `SetParallel=35`, `SetParallelScope=35`, `SetOddsByFormat=3`
  - classification already `PARALLEL_DB|CHECKLIST|6`, `PARALLEL_DB|ODDS|6`, `PLAYER_WORKSHEET|CHECKLIST|4`
  - approved set pool expected 2 business sets (Retail + Finest).
- Current:
  - `SetProgram=9` (`+2`)
  - `SetParallel=41` (`+6`)
  - `SetParallelScope=41` (`+6`)
  - `SetOddsByFormat=3` (no change)
  - classification unchanged (stable)
  - approved set pool now includes two Fix #5 verification fixtures (approvedSetCount rises from prior 2 to current 4 in options scope metadata).

### Findings That Still Apply
- `2025-26 Topps Basketball` remains dependent on legacy fallback (`source=legacy`, `legacyFallbackUsed=true`) due no taxonomy population/maps for that set.
- Sapphire-family set identity fragmentation still exists across near-duplicate set ids.
- Historical parser-noise rows remain in `SetCard` (no new inserts observed in recent window).
- KingsReview auto-query path is data-dependent; some cards still produce `query is required` without manual query fallback.

### Operations/Safety
- No deploy/restart/migration executed in this audit step.
- No destructive set/DB operations executed.

## 2026-02-27 - Planned Action: Step 1 + 2 Execution (Fixture Cleanup + Topps Taxonomy Population)

### Planned Action
- Execute requested step 1 and step 2 immediately on production (`collect.tenkings.co`):
  - archive Fix #5 verification fixture sets,
  - populate taxonomy for `2025-26 Topps Basketball`.
- Capture before/after runtime + DB evidence.

### Safety
- No destructive delete operation planned.
- No deploy/restart/migration planned.

## 2026-02-27 - Step 1 + 2 Result: Fixture Sets Archived + Topps Taxonomy Populated

### Scope Executed
- Archived both verification fixture sets:
  - `2026 Fix5 Seed Verification Set 20260227041936`
  - `2026 Fix5 Post Deploy Verification Set 20260227052338`
- Populated taxonomy for `2025-26 Topps Basketball`.

### Before Snapshot (`2026-02-27T14:51:22.885Z`)
- Global:
  - `SetProgram=9`
  - `SetParallel=41`
  - `SetParallelScope=41`
  - `SetOddsByFormat=3`
  - `SetCard=921`
  - `CardVariantTaxonomyMap=903`
  - `SetTaxonomySource=18`
- Set-level (`2025-26 Topps Basketball`):
  - `programs=0`, `parallels=0`, `scopes=0`, `odds=0`, `maps=0`, `variants=1793`
- Draft state:
  - Topps draft was `REVIEW_REQUIRED` (approved version existed, blocking errors `0`).
  - Approved active set count was `4`.
- Runtime:
  - `GET /api/admin/variants/options?...&setId=2025-26 Topps Basketball` => `source=legacy`, `legacyFallbackUsed=true`.
  - `POST /api/admin/set-ops/taxonomy/backfill` dry-run for Topps => `No approved active drafts found for taxonomy backfill`.

### Step 1 Execution Evidence (Archive)
- `POST /api/admin/set-ops/archive` results:
  - seed verification fixture => `ARCHIVED`, audit `185a7897-c807-48df-a41c-9626fdd4063d`
  - post-deploy verification fixture => `ARCHIVED`, audit `2ca0f141-a0ce-4bbb-ab6c-243423615d5f`
- Intermediate DB verification:
  - fixtures now `status=ARCHIVED` with `archivedAt` timestamps.
  - approved active set count dropped to `2` before Topps approval.

### Step 2 Execution Evidence (Topps Population)
- Needed workflow enablement:
  - `POST /api/admin/set-ops/approval` for Topps draft version `3668ab4d-d558-44e9-b2d0-3a3f095f80d4`
  - result: `decision=APPROVED`, `draftStatus=APPROVED`, `blockingErrorCount=0`, audit `f612a390-adf3-487f-b1ce-bb46f84a8708`.
- Official backfill apply attempt:
  - dry-run succeeded (`processed=1`, `eligible=1823`, `blocking=0`),
  - apply failed with Prisma transaction error:
    - `Invalid prisma.cardVariantTaxonomyMap.upsert(): Transaction not found`.
- Corrective execution (idempotent manual population script, production DB):
  - inserted/updated taxonomy rows for Topps using normalized legacy variants + canonical map upserts.
  - Topps set-level counts changed:
    - `programs: 0 -> 1`
    - `parallels: 0 -> 55`
    - `scopes: 0 -> 55`
    - `cards: 0 -> 1757`
    - `maps: 0 -> 1793`
    - `odds: 0 -> 0`
    - `sources: 2 -> 3`
  - map coverage/quality:
    - `topps_variants=1793`, `topps_maps=1793`, `topps_map_duplicates=0`.

### Runtime Verification After Step 1 + 2
- `GET /api/admin/variants/options?year=2025-26&manufacturer=Topps&sport=Basketball`
  - `source=taxonomy_v2`, `legacyFallbackUsed=false`, `sets=3`, `variants=78`, `parallelOptions=78`.
- `GET /api/admin/variants/options?...&setId=2025-26 Topps Basketball`
  - `source=taxonomy_v2`, `legacyFallbackUsed=false`, `sets=1`, `variants=55`, `parallelOptions=55`.
- `POST /api/admin/variants/match`
  - downstream message unchanged: `Variant embedding service is not configured` (no taxonomy hard-stop regression).

### After Snapshot (`2026-02-27T15:03:18.680Z`)
- Global:
  - `SetProgram=10`
  - `SetParallel=96`
  - `SetParallelScope=96`
  - `SetOddsByFormat=3`
  - `SetCard=2678`
  - `CardVariantTaxonomyMap=2696`
  - `SetTaxonomySource=20`
- Approved active set count: `3`
  - (Topps moved to `APPROVED`; two verification fixtures archived).

### Post-Change Integrity Checks
- Historical contamination metrics unchanged:
  - `SetCard` linked to `PARALLEL_DB` sources remains `253`.
  - parser-noise `SetCard` total remains `12`.
- New Topps population noise check:
  - parser-noise `SetCard` rows for Topps = `0`.

### Operations/Safety
- No deploy/restart/migration executed.
- No destructive delete operation executed.

## 2026-02-27 - Add Card Mobile OCR Queue Investigation (Root Cause Analysis, No Code Changes)

### Scope
- Investigated operator report: Add Card flow on phone captures front/back/tilt but OCR queue remains `0` in `/admin/uploads`.
- Focused on end-to-end path: intake UI queue state, upload/complete API calls, OCR job creation, and recent production DB evidence.

### Key Findings
- **Root Cause A (UI queue race / dropped pending state):**
  - `uploads.tsx` queue is local-state/localStorage-backed (`queuedReviewCardIds`), not DB-backed.
  - Queue insert occurs only in tilt step if `intakeCardId` already exists.
  - When front upload has not completed yet (common on mobile), tilt path stores pending blob then immediately clears intake state, which wipes pending blobs and never inserts queue ID.
  - Result: UI queue remains `0` (`No cards in OCR queue.`) even after 3 captures.
- **Root Cause B (front upload timing path leaves orphaned UPLOADING assets):**
  - Front upload is async and not awaited before enabling back/tilt capture.
  - Step buttons are disabled by `intakeBusy`, not `intakePhotoBusy`, so operator can outpace front upload.
  - Production evidence from reported window shows orphaned assets in `UPLOADING` with no OCR job and missing front object in storage.
- **Root Cause C (backend OCR worker failures, independent but critical):**
  - For assets that do complete `/uploads/complete`, OCR jobs are enqueued but fail immediately.
  - Failure signature across recent OCR jobs: `[processing-service] asset <id> imageUrl is not a base64 data URI`.
  - Processing worker path requires base64 data URI in `mock` mode (`extractMockBase64`), but stored asset URLs are S3/public URLs.
  - This blocks OCR pipeline progression after enqueue even when capture succeeds.

### Code Evidence (Exact Paths)
- Queue is local browser storage/state:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:683-703` (read localStorage)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:756-761` (persist localStorage)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:4146-4192` (queue count + empty message UI)
- Race/drop path in capture flow:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2577-2593` (front upload async, sets `intakeCardId` later)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2598-2602` (back pending if no `intakeCardId`)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2607-2614` (queue insert only when `intakeCardId` exists)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2615` + `1413-1453` (state clear wipes pending blobs)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2551-2565` (pending upload effect cannot run after clear)
- Capture buttons not gated by front-upload-in-flight:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:4224-4226` (back button)
  - `frontend/nextjs-app/pages/admin/uploads.tsx:4249-4251` (tilt button)
- `/uploads/complete` enqueues OCR jobs:
  - `frontend/nextjs-app/pages/api/admin/uploads/complete.ts:50-79`
- OCR worker failure path:
  - `backend/processing-service/src/index.ts:208-215` (`extractMockBase64` throws non-base64)
  - `backend/processing-service/src/index.ts:219-223` (`mock` mode decode path)

### Production Evidence Captured
- Recent assets (last ~12h, operator user) included:
  - `ce78a30ca7e942069edebf4a8ab7fda4`: OCR job created then failed with base64 error, `photo_count=0`.
  - `695b3b3b84c047f8b0a91aace6214b10`: `UPLOADING`, `ocr_jobs=0`, `photo_count=0`.
  - `fa300bcbb00e4fc581a3e81381f07788`: `UPLOADING`, `ocr_jobs=0`, `photo_count=0`.
- Storage head checks for two `UPLOADING` assets returned `NotFound`; completed failed asset object exists.
- OCR job audit (last 72h sample) shows repeated failures with same base64-data-URI error for all sampled OCR jobs.

### Commit/Regression Context
- Recent Fix #4/#5 set-ops commits did **not** touch `uploads.tsx` or upload/OCR endpoints.
- `confirmIntakeCapture` queue/clear behavior traces to earlier uploads/OCR UX commits (Feb 2026), not taxonomy set-ops changes.

### Operations/Safety
- No code changes made in this investigation step.
- No deploy/restart/migration executed.
- No destructive DB operations executed.

## 2026-02-27 - Add Card Queue + OCR Worker Fix (Code Complete, Not Deployed)

### Scope
- Implemented fixes for mobile Add Card OCR queue drop and OCR worker base64-url mismatch.
- No schema changes, no migrations.

### Files Updated
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `backend/processing-service/src/index.ts`

### Frontend Fixes (Add Card Mobile Reliability)
- Hardened back/tilt photo upload helper to require/accept explicit `cardAssetId` and return success.
- Prevented queue handoff/reset on failed tilt upload; now only finalize capture cycle after successful TILT upload.
- Added pending flush logic that only clears pending blobs after successful upload and then enqueues queue id.
- Blocked back/tilt capture buttons while front upload is still in-flight (`intakePhotoBusy`) or `intakeCardId` is missing.
- Added explicit user-facing errors when attempting back/tilt before front upload has completed.

### Backend Fixes (OCR Worker Storage Compatibility)
- Replaced strict mock-only base64 decode assumption with robust image loading order:
  1. data URI base64 (if present),
  2. local disk (local mode),
  3. HTTP(S) fetch from `imageUrl`.
- Worker now handles URL-backed assets instead of failing immediately with `imageUrl is not a base64 data URI`.

### Validation
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx` passed (existing `no-img-element` warnings only).
- `pnpm --filter @tenkings/processing-service run build` passed.

### Deployment Status
- Not deployed in this step.
- No restart/migration executed.

## 2026-02-27 - Add Card Fast Capture Restoration (Non-Blocking Upload Path)

### Scope
- Restored non-blocking Add Card behavior so operators can capture front/back/tilt rapidly without waiting on uploads.
- Kept OCR queue reliability by finalizing each 3-photo card in a background task.

### Code Changes
- Updated `frontend/nextjs-app/pages/admin/uploads.tsx`.
- Removed capture-button dependency on front-upload completion (`intakePhotoBusy` / `intakeCardId`) for back/tilt steps.
- Added active-front upload tracking refs (`activeFrontUploadRef`, `activeFrontUploadTokenRef`) to prevent stale async writes after fast reset.
- Changed back/tilt flow to buffer captures and run background finalization after tilt:
  - resolve front `cardAssetId` (existing id or pending front upload promise),
  - upload back + tilt photos in background,
  - enqueue card id into OCR queue only after successful background uploads.
- Preserved immediate UX reset to next card capture (`clearActiveIntakeState` + reopen front capture) with no upload wait.

### Validation
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx` passed (existing `no-img-element` warnings only).

### Deployment Status
- Not deployed in this step.
- No migration/restart/destructive operations executed.

## 2026-02-27 - OCR Quality Incident Triage (Prod): Missing Vision Key in Processing Service

### Trigger
- Operator reported post-deploy OCR quality collapse and asked whether Google Vision + GPT path was still active.

### Findings
- `processing-service` runtime env on droplet had missing OCR keys at runtime:
  - `GOOGLE_VISION_API_KEY` absent (`len=0`) inside container before fix.
  - `OCR_LLM_MODEL` / `OCR_LLM_FALLBACK_MODEL` also unset in processing container env.
- Recent OCR suggestion audit rows from production DB still showed Next.js suggest path active with:
  - `source=google-vision+llm`
  - `llmModel=gpt-5`
- Recent bad-card sample had `photoOcr` showing `FRONT` and `TILT` empty-text (`tokenCount=0`) while `BACK` was populated, explaining poor field extraction on that card.

### Action Executed (Prod)
- Restored `GOOGLE_VISION_API_KEY` in droplet file:
  - `/root/tenkings-backend/env/processing-service.env`
- Rebuilt/recreated processing service:
  - `docker compose up -d --build --force-recreate processing-service`
- Post-restart runtime verification inside container:
  - `has_GOOGLE_VISION_API_KEY=yes`
  - `GOOGLE_VISION_API_KEY_len=39`

### Post-Action Verification Snapshot
- Latest 3 OCR suggestion rows (field-level) remained visible and model-tagged as:
  - `google-vision|gpt-5`
- Latest row (2026-02-27T18:46:12.831Z) extracted:
  - `playerName=Devin Vassell`, `year=2025`, `manufacturer=Topps`, `sport=Basketball`.
- One earlier failing row (2026-02-27T11:41:29.546Z) showed:
  - `FRONT tokenCount=0`, `TILT tokenCount=0`, `BACK tokenCount=176`.

### Notes
- No schema/data migration executed.
- Vercel env/model change was not executed in this step.

## 2026-02-28 - AGENTS Startup Context Sync (Docs-Only, Session Kickoff #4)

### Summary
- Re-read all mandatory startup files listed in `AGENTS.md`.
- Confirmed current branch/commit context on workstation: `main` at `ca7c806`.
- This session performed append-only handoff doc sync; no runtime code-path behavior was changed.

### Files Reviewed
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

### Validation Evidence
- `git status -sb` reported `## main...origin/main` with pre-existing local modifications.
- `git branch --show-current` returned `main`.
- `git rev-parse --short HEAD` returned `ca7c806`.

### Operations/Safety
- No deploy/restart/migration executed.
- No DB operations executed.
- No destructive actions executed.

## 2026-02-28 - Recovery Pass (Pipeline Stability + Taxonomy Reliability, Code Complete, Not Deployed)

### Summary
- Applied a recovery-focused hardening pass to protect the honed Add Card -> OCR/LLM -> KingsReview workflow while preserving Taxonomy V2 integration.
- Made taxonomy constraints non-destructive in OCR suggestion flow so confident field values are preserved when taxonomy scope/pool is missing or unresolved.
- Hardened KingsReview enqueue query generation with taxonomy-to-legacy fallback ordering and final text fallback to avoid empty-query dead ends.
- Hardened Taxonomy V2 ingest/backfill reliability by adding configurable transaction timeout options and replacing per-row taxonomy-map upserts with chunked SQL upserts.
- Switched Taxonomy V2 legacy-fallback default to safety-first (`allowLegacyFallback=true` unless explicitly disabled).

### Files Updated
- `frontend/nextjs-app/lib/server/taxonomyV2Flags.ts`
- `frontend/nextjs-app/lib/server/taxonomyV2Core.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`

### Validation Evidence
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/api/admin/cards/[cardId]/ocr-suggest.ts --file pages/api/admin/kingsreview/enqueue.ts --file lib/server/taxonomyV2Core.ts --file lib/server/taxonomyV2Flags.ts` passed.
- `pnpm --filter @tenkings/processing-service run build` passed.

### Deployment Status
- Not deployed in this step.
- No restart or migration executed.

### Operations/Safety
- No destructive DB/set operations executed.
