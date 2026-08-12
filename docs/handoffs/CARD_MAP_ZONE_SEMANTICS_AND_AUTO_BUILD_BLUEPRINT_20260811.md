# Card Map Zone Semantics, Auto-Build, and Replay Blueprint

Date: 2026-08-11
Status: owner-approved direction; not implemented by the atomic-save/draft-recovery repair

## Sequencing boundary

Atomic Family + Exact creation and durable draft recovery ship first. This blueprint does not change current detector, Memory, filter, grading, map registration, or zone behavior. Existing map revisions remain readable and unchanged.

## Versioned zone contract

A later additive map-schema version should separate these independent facts on every zone:

- `contentType`: the visual layout role, such as `HEADER`, `ARTWORK`, `SPECIES_STRIP`, `ATTACK`, `STATS_BAR`, `ARTIST_AND_CARD_ID`, `FLAVOR_TEXT`, `COPYRIGHT`, or `OTHER`.
- `filterType`: the current print-context semantic, such as text, logo, border, artwork, foil/holo, or other.
- `filterAuthority`: explicit boolean controlling whether full containment removes an already-detected Detector/Memory candidate from normal review.
- `filterAuthoritySource`: `TYPE_DEFAULT` or `HUMAN_OVERRIDE`, so an operator adjustment remains auditable.
- `proposalSource`: `HUMAN`, `POKEMON_STANDARD_TEMPLATE`, `VISUAL_SNAP`, or `COPIED_COMPATIBLE_MAP`.
- `proposalConfidence`: bounded numeric evidence for proposals only; it is never activation or grading authority.

Defaults for newly proposed zones:

- text, logo, and border: filter authority ON;
- artwork and foil/holo: filter authority OFF;
- content/layout zones do not filter merely because they identify content.

The UI must state the consequence beside every authority control: Detector and Memory run first; raw candidates/provenance remain immutable; only a fully contained candidate is removed from normal review/grading; partial overlap remains; Smart Marks always remain; removed evidence remains auditable and restorable. Existing revisions retain their frozen current behavior until a human creates a new revision under the additive schema.

## Auto-Build Zones

`Auto-Build Zones` creates draft-only proposals and never saves or activates a map. The first deterministic Pokémon template proposes approximately:

1. Header
2. Artwork
3. Species strip
4. Attack 1
5. Attack 2
6. Stats bar
7. Artist + set/card ID
8. Flavor text
9. Copyright

Visual snapping may deterministically refine polygons to artwork frames, separator lines, text bands, and footer structure. It must return normalized ordered polygons, labels, content/filter types, default filter authority, proposal source, and confidence. The human can resize, rename, remove, change authority, or add zones before the one overall Family + Exact save.

`Copy Zones` may import zones only from a human-selected compatible Card Map. It copies draft geometry and semantics, not map identity, source imagery, hashes, current-revision pointers, or runtime registration. The copy remains unsaved until the overall atomic save.

## Calibration replay remains mandatory

Before claiming the tighter zones or authority defaults are safe, run the existing zero-write replay over all 50 known cards, 1,784 human-removed fakes, 508 human-kept real findings, the print-overlap cohort, and every saved Front/Back boundary. Keep training cards separate from independent sibling cards and state the corpus-contamination limit.

Report map coverage; every exact map/revision/zone/rule decision; before/after finding counts and grades; all-real, map-covered-real, and filter-eligible-real retention; boundary reprojection; centering ratios/grades; and unexpected or unusable maps. If even one kept real finding would be filtered, immediately identify the exact card/session, finding, side, crop, origin, type, map, revision, zone, and rule. Do not hide it in an aggregate, disable anything automatically, or retune maps/rules/thresholds without Mark's decision.

Required status until that replay and a separately predeclared held-out cohort complete:

`defect filter verification: PENDING`
