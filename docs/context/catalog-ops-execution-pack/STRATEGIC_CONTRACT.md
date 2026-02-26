# Strategic Contract

Last updated: 2026-02-26

## Mission
Build a unified Catalog Ops workstation that reduces operator friction and removes taxonomy ambiguity, while preserving production safety and current operational throughput.

## Non-Negotiables
1. Manufacturer adapters over one shared taxonomy core.
2. Parallels are not base-only; scope must support base, inserts, autos, relics.
3. Canonical identity key used everywhere:
   - `setId + programId + cardNumber + variationId? + parallelId?`
4. Deterministic source precedence for conflicting artifacts.
5. Ambiguous mappings go to review queue, never silent auto-resolution.
6. Phased cutover with flags, parity checks, and rollback.

## User-Centered Outcomes
1. Add Card operators spend less time fixing wrong labels.
2. KingsReview queries return better sold-comps relevance.
3. Inventory review sees cleaner, consistent card metadata.
4. Set operations are safer and easier to monitor.

## Business Outcomes
1. Lower correction burden per card.
2. Faster ingest-to-seed cycle time.
3. Higher confidence in automated suggestions.
4. Better long-term support for multiple manufacturers.

## Scope
### In
- Catalog Ops workstation IA + page redesign for Workstation 2.
- Taxonomy V2 schema + ingest contracts + compatibility bridge.
- V2-aware option pools, matcher filters, and query builder.

### Out (for this program)
- Full visual redesign of Workstation 1 (`Add Cards -> KingsReview -> Inventory Review`).
- Replacing all legacy APIs in one release.
- Big-bang data rewrite with no dual-read safety period.

## Definition of Done
1. No conflation of program/variation/parallel in primary workflows.
2. New workstation routes are production-default with legacy routes still available as fallback.
3. Taxonomy parity gates pass before V2-first cutover.
4. End-to-end flow is measurable improvement in correction rate and operator task time.
5. Full auditability for ingest, replace, approval, seed, and manual conflict decisions.
