# Workstation 2 Redesign Spec (Catalog Ops)

Last updated: 2026-02-26
Source: approved operator direction + codebase review

## Current Pages Reviewed
- `frontend/nextjs-app/pages/admin/set-ops.tsx`
- `frontend/nextjs-app/pages/admin/set-ops-review.tsx`
- `frontend/nextjs-app/pages/admin/variants.tsx`
- `frontend/nextjs-app/pages/admin/variant-ref-qa.tsx`
- `frontend/nextjs-app/pages/admin/ai-ops.tsx`

## Current Pain Points
1. Dense pages with overlapping responsibilities.
2. `Set Ops Review` combines discovery + queue + draft + approval + seed in one long scroll.
3. `Variants` and `Variant Ref QA` overlap on reference image workflows.
4. `Set Ops` carries heavy replace/delete workflows in giant modal structures.
5. `AI Ops` is strong but disconnected from catalog workflow context.

## Redesign Vision
One workstation with four focused surfaces:
1. `Overview`
2. `Ingest & Draft`
3. `Variant Studio`
4. `AI Quality`

Legacy routes remain live for safety during rollout.

## Route IA
1. `/admin/catalog-ops` -> Overview
2. `/admin/catalog-ops/ingest-draft` -> Ingest & Draft
3. `/admin/catalog-ops/variant-studio` -> Variant Studio
4. `/admin/catalog-ops/ai-quality` -> AI Quality

Legacy links retained:
- `/admin/set-ops`
- `/admin/set-ops-review`
- `/admin/variants`
- `/admin/variant-ref-qa`
- `/admin/ai-ops`

## Global Shell Spec
1. Top bar:
   - workstation title,
   - environment badge,
   - role badges (`reviewer`, `approver`, `delete`, `admin`),
   - global refresh.
2. Context bar:
   - active set,
   - active program/card type,
   - active queue/job status,
   - deep links (`Open in ...`).
3. Left nav:
   - Overview,
   - Ingest & Draft,
   - Variant Studio,
   - AI Quality.
4. URL state persistence:
   - `setId`, `programId`, `jobId`, `tab`.

## Surface Specifications

## 1) Overview (from Set Ops)
Keep:
- set search/list,
- count summaries,
- archive/unarchive,
- replace status,
- delete entrypoint.

Change:
- replace flow moves from giant modal to right-side panel,
- delete detail in explicit danger slide-over,
- show set health cards first:
  - taxonomy coverage,
  - unresolved ambiguities,
  - ref QA status,
  - last seed result,
- add row actions:
  - `Open Ingest & Draft`,
  - `Open Variant Studio`.

## 2) Ingest & Draft (from Set Ops Review)
Layout:
- stepper at top:
  1. Source Intake
  2. Ingestion Queue
  3. Draft & Approval
  4. Seed Monitor

Behavior:
- one step expanded by default,
- completed steps collapse,
- current APIs/actions preserved,
- split into focused cards.

Draft table becomes Taxonomy V2-ready:
- Program/Card Type,
- Card #,
- Variation,
- Parallel,
- Player,
- Issues.

## 3) Variant Studio (merge Variants + Variant Ref QA)
Subtabs:
1. `Catalog Dictionary`
2. `Reference QA`

Catalog Dictionary:
- manage definitions:
  - programs,
  - variations,
  - parallels,
  - scope rules,
- import tools,
- replace flat add-variant semantics with structured V2 entries.

Reference QA:
- keep strong current card-grid QA behavior,
- add queue presets:
  - needs refs,
  - needs QA,
  - low quality,
  - non-ebay source,
- keep batch actions, simplify context/filter flow.

## 4) AI Quality (from AI Ops)
Keep:
- eval gate,
- recent runs,
- failed checks,
- correction telemetry,
- attention queue.

Change:
- add set/program filters for failure analysis,
- add deep links into Ingest & Draft and Variant Studio with preserved context.

## Taxonomy V2 UX Alignment
1. Explicit separate semantics:
   - card type/program,
   - variation,
   - parallel.
2. Scope-aware options and QA filters.
3. Replace/seed screens include taxonomy completeness as first-class signal.

## Low-Risk Implementation Plan
1. Build shell + tabs + shared context bar first.
2. Rehost existing pages in wrappers with minimal markup change.
3. Redesign surfaces one-by-one:
   - first Ingest & Draft,
   - then Variant Studio,
   - then Overview,
   - then AI Quality.
4. Keep legacy routes during rollout.
5. Add per-surface flags + rollback.
6. Acceptance checks before switching defaults:
   - task completion time,
   - error/misclick rate,
   - operator correction count,
   - API regression absence.

## Wireframe-Level Acceptance Criteria
1. No loss of existing capability.
2. Reduced clicks for common workflows.
3. Lower correction rate in draft/QA.
4. Faster ingest -> draft -> seed handoff.
5. Stable rollback and error behavior.
