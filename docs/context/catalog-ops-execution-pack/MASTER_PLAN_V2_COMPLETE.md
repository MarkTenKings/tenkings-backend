# Master Plan v2: Unified Card Taxonomy + Odds Intelligence (End-to-End)

Last updated: 2026-02-26
Source: approved operator plan

## 1. Mission
Build a manufacturer-agnostic card intelligence platform where every card is modeled as:
- `Set -> Program/Card Type -> Card -> Variation (optional) -> Parallel (optional)`

This model must be used consistently across:
- ingestion,
- replace,
- add-card recognition,
- matching,
- KingsReview comp search.

## 2. Non-Negotiable Design Rules
1. Manufacturer adapters are required: one shared model, source-specific parsers.
2. Parallels are not base-only: support base, inserts, autos, relics, program-specific rules.
3. Canonical identity key is universal:
   - `setId + programId + cardNumber + variationId? + parallelId?`
4. Source precedence is explicit and deterministic when artifacts disagree.
5. Ambiguous mappings go to manual review queue; no silent auto-resolution.
6. Cutover is phased with flags, parity metrics, and rollback gates.

## 3. Target Product Outcomes
1. Set Ops ingests checklist and odds artifacts as separate-but-linked layers.
2. Replace wizard diff/execution uses canonical identity, not flat `parallelId`.
3. Add Card shows scoped pickers: `Card Type`, `Variation`, `Parallel`.
4. OCR/matcher suggestions are constrained by valid set/program scope.
5. KingsReview queries are deterministic and taxonomy-aware.
6. Data quality, provenance, and conflict visibility are first-class.

## 4. Core Architecture
1. Shared Taxonomy Core Service:
   - normalization,
   - identity building,
   - scope resolution,
   - precedence/conflict detection.
2. Manufacturer Adapter Layer:
   - Topps, Panini, Upper Deck, etc.,
   - all emit normalized contracts.
3. Workflow Layer:
   - set review,
   - approval,
   - replace,
   - seeding,
   - audit.
4. Runtime Consumers:
   - Add Card UI,
   - matcher,
   - option pools,
   - KingsReview query builder.

## 5. Data Model (Taxonomy v2)
1. `SetProgram` (program/card type), optional code prefix.
2. `SetCard` (`DD-11`, `150`, etc.).
3. `SetVariation` (scoped applicability).
4. `SetParallel` (name, serial data, finish family).
5. `SetParallelScope` (allowed program scopes + optional format/channel constraints).
6. `SetOddsByFormat` (raw odds rows by format/channel).
7. `SetTaxonomySource` (provenance: `official_checklist`, `official_odds`, `secondary`, `manual`).
8. `SetTaxonomyConflict` (precedence conflicts).
9. `SetTaxonomyAmbiguityQueue` (human resolution queue).
10. Compatibility bridge:
   - keep `CardVariant` during transition,
   - map to canonical entities.

## 6. Ingestion System
1. Artifact types:
   - `CHECKLIST`,
   - `ODDS`,
   - `COMBINED`,
   - `MANUAL_PATCH`.
2. Adapter output contract includes:
   - programs,
   - cards,
   - variations,
   - parallels,
   - scopes,
   - odds rows,
   - provenance metadata.
3. Normalization pipeline:
   - label normalization,
   - code-prefix extraction,
   - serial parsing,
   - format/channel normalization,
   - identity key generation.
4. Validation pipeline:
   - blocking schema errors,
   - cross-artifact consistency checks,
   - scope integrity checks,
   - canonical dedupe checks.

## 7. Precedence + Conflict Policy
1. Priority order:
   - official checklist > official odds > trusted secondary > manual patch.
2. Tie-breakers:
   - newer official timestamp > parser-confidence signals > manual override.
3. Conflict handling:
   - persist conflicts,
   - surface conflicts,
   - block auto-promotion until resolved.
4. Manual resolutions:
   - audited,
   - reusable as override rules.

## 8. Set Ops + Replace Workflow v2
1. Review screens/layers:
   - program/card layer,
   - variation layer,
   - parallel/odds scope layer,
   - conflicts/ambiguities layer.
2. Replace preview computes diff on canonical identity.
3. Replace run validates:
   - preview hash,
   - precedence state,
   - unresolved ambiguity count,
   before destructive action.
4. Delete/approve/seed orchestration remains transactional with full step logs/audit events.
5. Existing reference-image preservation logic remains and maps by canonical keys.

## 9. Add Card Recognition Flow v2
1. Step order:
   - identify set,
   - identify program/card type,
   - identify card number/player,
   - propose variation (if allowed),
   - propose parallel (if allowed).
2. Pickers are scope-gated by taxonomy resolver.
3. Unknown options blocked unless manually justified and queued for taxonomy review.
4. OCR confidence is advisory; scope validity is authoritative.

## 10. Matcher v2
1. Candidate generation starts with set + program + card number.
2. Variation and parallel scoring are separate channels with scope filters.
3. No out-of-scope candidate can enter final ranking.
4. Decisions store reasoning traces for audit/debug.

## 11. KingsReview Query Builder v2
1. Deterministic token order:
   - `year + manufacturer + set + program + cardNumber + player + variation? + parallel?/serial?`
2. Variation/parallel tokens included only if selected or high-confidence and in-scope.
3. Query templates differ by program class (base/insert/auto/relic) but use one core builder.

## 12. Migration Strategy
1. Phase-in with dual-write and dual-read.
2. Backfill flat rows into taxonomy tables via mapper + ambiguity queue.
3. Parity dashboard compares old vs new outputs for:
   - option pools,
   - matcher top candidate,
   - KingsReview query strings.
4. Switch consumers one-by-one behind flags with immediate rollback.

## 13. Observability + Controls
1. Metrics:
   - ingest success/block rates,
   - ambiguity volume,
   - conflict volume,
   - scope-violation attempts,
   - matcher precision deltas.
2. Dashboards by manufacturer adapter and set.
3. Audit events for:
   - promotion,
   - override,
   - conflict resolution,
   - replace run.

## 14. Testing Strategy
1. Unit:
   - canonical key stability,
   - precedence correctness,
   - scope resolver behavior.
2. Integration:
   - checklist+odds merge,
   - ambiguity queue lifecycle,
   - replace diff parity on canonical keys.
3. E2E:
   - add-card picker correctness,
   - matcher scope correctness,
   - KingsReview query accuracy.
4. Regression:
   - known problematic set pack and label edge cases.

## 15. Rollout Plan
1. `TAXONOMY_V2_INGEST` (admin-only ingestion)
2. `TAXONOMY_V2_PICKERS` (Add Card)
3. `TAXONOMY_V2_MATCHER`
4. `TAXONOMY_V2_KINGSREVIEW_QUERY`
5. Progressive enablement by manufacturer and set family.
6. Production default only after parity thresholds + ambiguity backlog SLA.

## 16. Execution Phases
1. Phase A: schema + core resolver + provenance/conflict/ambiguity tables.
2. Phase B: Topps adapter v1 (checklist + odds) + review UI layer split.
3. Phase C: canonical replace diff + replace guardrails + compatibility bridge.
4. Phase D: Add Card scoped pickers + matcher v2 shadow mode.
5. Phase E: KingsReview builder v2 + parity/quality dashboard.
6. Phase F: Panini/Upper Deck adapters + broader rollout.
7. Phase G: deprecate flat-only logic after stability window.

## 17. Definition of Done
1. No conflation of card type, variation, parallel in primary workflows.
2. Replace uses canonical identity and preserves operational safety guarantees.
3. Add Card and matcher are scope-correct and measurably more accurate.
4. KingsReview queries are structured and precision-improved.
5. Multi-manufacturer ingestion is operational via adapters over shared model.
