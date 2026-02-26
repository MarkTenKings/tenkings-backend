# Build Contract

Last updated: 2026-02-26

## Phase Plan

## Phase 0 - Workstation Shell (No Behavior Change)
Goals:
1. Add new routes and shell navigation.
2. Preserve old routes and existing behavior.

Deliverables:
1. `/admin/catalog-ops`
2. `/admin/catalog-ops/ingest-draft`
3. `/admin/catalog-ops/variant-studio`
4. `/admin/catalog-ops/ai-quality`
5. Shared context bar and deep-link state handling.

## Phase 1 - Ingest & Draft Redesign
Goals:
1. Convert long page into guided stepper.
2. Keep API usage stable.

Deliverables:
1. Step 1 Source Intake
2. Step 2 Ingestion Queue
3. Step 3 Draft & Approval
4. Step 4 Seed Monitor

## Phase 2 - Variant Studio Consolidation
Goals:
1. Merge `Variants` and `Variant Ref QA` into one page with subtabs.
2. Keep current batch QA actions.

Deliverables:
1. `Catalog Dictionary` subtab
2. `Reference QA` subtab
3. Shared set/program context across both subtabs

## Phase 3 - Overview Redesign
Goals:
1. Convert Set Ops to high-signal overview and action routing.
2. Replace large modal dependence with panels.

Deliverables:
1. Set health table and summary cards
2. Replace action panel
3. Delete danger panel
4. Cross-links to Ingest & Draft and Variant Studio

## Phase 4 - AI Quality Integration
Goals:
1. Move AI Ops into workstation shell.
2. Add context-aware deep links back to catalog actions.

## Phase 5 - Taxonomy V2 Activation
Goals:
1. Introduce taxonomy entities and adapters.
2. Run dual-read parity and progressive cutover.

Deliverables:
1. Topps adapter v1 (checklist + odds)
2. Scope resolver + precedence + ambiguity queue
3. V2-aware pickers and matcher gating
4. V2-aware KingsReview query builder

## Ticket Backbone (Initial)
1. `CAT-001` Shell routes and nav
2. `CAT-002` Shared context + URL state
3. `CAT-003` Legacy compatibility links
4. `CAT-010` Stepper infrastructure
5. `CAT-011` Source intake compose
6. `CAT-012` Queue manager compose
7. `CAT-013` Draft grid V2-ready columns
8. `CAT-014` Seed monitor compose
9. `CAT-020` Variant Studio container + subtabs
10. `CAT-021` Catalog Dictionary panels
11. `CAT-022` Reference QA panels
12. `CAT-030` Overview redesign
13. `CAT-040` AI Quality integration
14. `CAT-050` Taxonomy schema/migration
15. `CAT-051` Adapter contracts
16. `CAT-052` Topps adapter implementation
17. `CAT-053` Scope resolver + precedence
18. `CAT-054` Ambiguity/conflict queues
19. `CAT-055` Parity dashboard and gates
20. `CAT-056` Cutover flags and rollback switches

## Feature Flags
1. `CATALOG_OPS_WORKSTATION`
2. `CATALOG_OPS_INGEST_STEPPER`
3. `CATALOG_OPS_VARIANT_STUDIO`
4. `CATALOG_OPS_OVERVIEW_V2`
5. `CATALOG_OPS_AI_QUALITY`
6. `TAXONOMY_V2_INGEST`
7. `TAXONOMY_V2_PICKERS`
8. `TAXONOMY_V2_MATCHER`
9. `TAXONOMY_V2_KINGSREVIEW_QUERY`

## Cutover Gates
1. Functional parity gate passed.
2. Error budget not exceeded.
3. Rollback toggle validated in staging.
4. Operator acceptance check signed off.
