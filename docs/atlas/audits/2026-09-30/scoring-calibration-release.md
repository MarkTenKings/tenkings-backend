# ATLAS scoring calibration — September 30, 2026

## Owner decision

ATLAS uses the existing measured defect areas and defect-type multipliers. For each side's Corners, Edges and Surface, it multiplies the type-weighted damage percentage once by 1.5, then scores the adjusted percentage using the complete 0.010% bands in the [owner blueprint](../../../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md). Centering, Front 70% / Back 30%, equal category averaging and direct nearest-half-point final award remain the same. New drafts carry `ATLAS_2026_09_30_DAMAGE_1_5_V1`.

The persisted `weightedDamagePercent` is the base measurement; the explanation adds `scoringDamagePercent` and the global multiplier. Both figures are visible in staff and public grade calculations. Historical approved reports are explained under their recorded rule and are not edited or republished by this release.

## Exact approved-evidence replay, without publication

Read-only replay used the saved Front/Back geometry and every finding in the published homepage report packets, without changing their approved records:

| Card | Current approved award | Prospective new raw score | Prospective new award |
| --- | ---: | ---: | ---: |
| Drake Maye | 9.5 | 7.51265193903145 | 7.5 |
| Abomasnow | 10 | 8.350000000000001 | 8.5 |
| Dart | 10 | 9.978571428571435 | 10 |

These are deterministic scoring replays from saved evidence, not new human approvals or replacements for existing report versions.

## Implementation boundaries

- Connected machine drafts, manual previews and corrected final review calculate under the new rule. The legacy shared Speedster calculator remains unchanged.
- Old unapproved machine drafts remain immutable and require an explicit current-policy correction review before approval. Interrupted old batch reviews retain their exact receipt chain and reopen only at the verified current revision, with new inspection/confirmation required. An already committed historical approval recovers its exact saved award without regrading.
- The website's frozen report embed was rebuilt for rule-specific math and thresholds. All three historical approved `packet` and `explanation` objects compare exactly across the old and new homepage releases. Their surrounding image URLs are rebased to the new version directory, so the complete fixture file bytes differ only at those paths.
- The legacy StaffReports approval route is a separate Speedster-based path. Production currently has its bridge disabled and zero analysis, approvals or publications in that path. Its production approval guard now refuses old-policy reports before a new certification, while preserving historical reads and exact idempotent recovery.

## Qualification so far

- Grading core: 30/30 passed.
- Staff application: 767/767 passed, including the production guard tests.
- Public application: 40/40 passed. Public production Next build and boundary checks passed.
- Manual workspace: 245 passed, 6 optional native/browser prerequisites skipped in the local environment.
- Connected manual: 447 passed, 2 optional native prerequisites skipped in the local environment.
- Manual workflow: 49 passed, 1 optional native prerequisite skipped in the local environment.
- Frozen homepage/public fingerprint tests: 48/48 passed; browser-only dependency boundary passed.
- Exact threshold lower/at/upper probes across all ten finite boundaries: 30 passed.
- Staff and public production Next builds passed their boundary checks after the source changes.

Production source, image, web deployment identities, control revisions, signed transport checks and final preservation evidence will be recorded after a qualified cutover. No production mutation has occurred under this release record yet.
