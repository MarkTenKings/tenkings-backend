# Speedster Card Map zone authority and calibration replay blueprint

Status: v2 contract implemented; Production activation owner-authorized on 2026-08-12 under an explicit replay-gate waiver; compatible replay verification remains pending

Date: 2026-08-11

Owner: Mark / Ten Kings

## Invariants

- Detector and Memory run before any Card Map zone decision.
- Raw Detector and Memory candidates, contours, scores, source views, and provenance remain immutable and auditable.
- Smart Marks always remain.
- A map never claims that a zone prevented detection. A filter-authorized zone may only remove an already-detected Detector or Memory finding from normal review and grading.
- Full containment is required. Partial overlap remains in normal review.
- Removed findings remain restorable with their original evidence and the exact map revision, zone, rule, and containment calculation recorded.
- Front and Back geometry, zone membership, registration, and evidence remain independent.
- Exact replaces family entirely. Runtime never merges exact and family zone sets.
- Missing, malformed, hash-invalid, or registration-invalid map evidence never guesses or chooses an unrelated map; the approved ordinary human-review path remains available.

## Split content description from filter authority

Each saved zone needs two independent concepts:

1. `semanticType`: what printed layout the polygon describes.
2. `filterAuthority`: whether full containment in that zone may remove Detector or Memory findings from normal review and grading.

Content zones such as Header, Artwork, Species Strip, Attack 1, Attack 2, Stats Bar, Artist + Set/Card ID, Flavor Text, and Copyright are layout descriptions. Their names alone never grant filter authority.

The initial authority default is derived from semantic type, remains visible, and is adjustable per zone before the overall Card Map is saved:

| Semantic type | Default filter authority |
| --- | --- |
| Printed text | On |
| Printed logo | On |
| Printed border | On |
| Printed artwork | Off |
| Foil / holographic print | Off |
| Other print context | Off |

The editor must explain the consequence beside the control: when On, a fully contained Detector or Memory finding is removed from normal review and grading; partial overlap and every Smart Mark remain. When Off, the zone is descriptive only.

The owner-approved tight-polygon remedy preserves the human polygon as the content boundary and defines the filter area as its deterministic `0.6 mm` physical-card dilation. Containment remains strict over every contour vertex and segment; the policy does not switch to centroid, bounding-box, partial-overlap, or percentage containment. Ambiguous numerical subdivision fails closed by retaining the finding. The review overlay shows the applied content zone and reports the best zone's exact covered/total contour vertices plus any outside/crossing condition.

## Versioning and compatibility

- Introduce a new explicit map/filter schema version for saved per-zone authority. Do not reinterpret historical `speedster-map-filter-containment-v1` bytes or destructively rewrite existing immutable revisions.
- Legacy revisions retain their existing behavior under their existing filter-policy version.
- A legacy revision edited or restored into the new policy creates a new immutable revision with an explicit authority value for every zone and a clear operator preview before activation.
- Revision hashes cover semantic type, filter authority, polygon vertex order, label, side, and all existing immutable map/provenance fields through the single canonical server-owned payload.
- FAMILY and EXACT revisions created together initially receive the same reviewed zone geometry and per-zone authority, but each revision retains its own distinct map key and hash.
- The explicit v2 fields are `contentType`, `filterAuthority`, `filterAuthoritySource`, `filterPaddingMm`, `proposalSource`, and `proposalConfidence`. The immutable version pair is `speedster-card-type-map-v2` / `speedster-map-filter-authority-padding-v2`; historical v1 bytes remain parsed and hashed only under their v1 pair.

## Auto-Build Zones

The first deterministic proposal targets reusable Pokémon layouts and proposes approximately:

- Header
- Artwork
- Species strip
- Attack 1
- Attack 2
- Stats bar
- Artist + set/card ID
- Flavor text
- Copyright

The proposal engine may snap to artwork frames, separator lines, text bands, and footer structure. Every proposal carries a normalized polygon, stable draft ID, label, semantic type, confidence, proposal source/version, and the visible default filter authority. It does not save, activate, filter, grade, or mutate evidence.

The human can resize vertices, rename, change semantic type, toggle filter authority, remove, or add zones. Nothing persists until the one overall `SAVE FAMILY + EXACT MAPS` action succeeds atomically.

`Copy Zones` may import zones only from a deliberately selected compatible map. It copies structured draft geometry and metadata for review; it never copies an active revision pointer, silently activates, merges runtime maps, or discards the new source card's imagery/provenance.

Draft export/import must round-trip proposal metadata as well as every existing identity, side, boundary, anchor, zone, label, semantic type, filter-authority value, and polygon vertex. Import remains an unsaved local draft until the human saves the full Card Map.

## Required 50-card calibration replay

The intended release gate is a known 50-card corpus with sufficient immutable truth to answer whether any proposed or tightly drawn zone would have hidden a real defect. On 2026-08-12 the owner explicitly waived this gate for the current v2 activation, accepting sole-grader review and the removed-findings audit as the Production safety net. This exception is recorded as `OWNER_WAIVER_2026_08_12`; it does not turn an inconclusive replay into a pass or remove the need for later compatible replay evidence.

For every replay card and side, the corpus must bind:

- authoritative card identity and exact/family eligibility;
- exact source image/evidence hashes;
- reviewed map kind and revision or explicit no-map state;
- registration outcome and projected zones on that copy's physical-card quad;
- raw Detector and Memory candidates with complete contours and provenance;
- Smart Marks;
- human truth label for each real defect and reviewed false positive;
- containment result for every active filter-authorized zone;
- the hypothetical decision without mutating the card, grade, report, label, permanent-card record, source image, or active map.

Replay must report, by map kind, side, zone type, zone ID, finding origin, and defect class:

- real defects that would be hidden (must be zero for activation);
- false positives that would be removed;
- partial overlaps correctly retained;
- Smart Marks retained;
- registration failures and no-map fallbacks;
- missing truth/map labels that make the run inconclusive;
- before/after normal-review candidate counts and grading impact simulation;
- geometry registration and filter-decision durations.

The replay is read-only and deterministic. Two runs over identical corpus bytes, map revisions, code version, and policy version must produce byte-identical canonical results. It must fail inconclusive rather than pass when truth labels, exact evidence hashes, map scope, registration evidence, or raw candidates are missing.

Absent an explicit owner exception, the activation gate requires human review of every would-hide-real-defect result, an explicit owner decision, retained replay artifacts and hashes, and a separately versioned release. Passing ordinary unit tests does not substitute for this replay. The 2026-08-12 waiver is activation authority only; verification remains `PENDING`.

### 2026-08-11 observed gate result

The zero-write audit of frozen corpus SHA-256 `255e3b81adf97562920e1b9da766c568d156aea210aeda21f9920261df125ad5` is `INCONCLUSIVE`, canonical report SHA-256 `71806fabd3ff336cc822d9f6e536167d1daa0d12966a57bfd3c181ba74f8c7d7`:

- exactly `50` cards and `2,292/2,292` human review outcomes are present;
- `0` cards match 2023 Pokémon + MEW EN + Reverse Holo;
- `0` cards bind the proposed FAMILY/EXACT revisions or compatible registration evidence;
- exact inspection-evidence hashes are absent from all 50 frozen manifest records.

The replay result itself remains `activationAllowed=false`. This is not a safety pass and does not justify applying Squirtle geometry to unrelated family keys. On 2026-08-12 the owner separately authorized v2 activation under waiver `OWNER_WAIVER_2026_08_12`; the API records that authority rather than claiming the replay passed. Existing v1 revisions and their decisions remain unchanged and restorable. A conclusive verification run still requires compatible MEW-family copies with exact evidence hashes, raw candidates, registration, and owner-reviewed truth.

## Acceptance coverage

- Content-only artwork and foil zones do not filter by default.
- Text, logo, and border defaults are visible and editable before save.
- Toggling authority changes the new immutable revision hash.
- Full containment filters only Detector/Memory findings; partial overlap and Smart Marks remain.
- Exact and family never merge authority or zones.
- Legacy revisions keep historical behavior and hashes.
- Auto-Build and Copy Zones cannot activate without the overall atomic save.
- Export/import retains every authority and proposal field.
- The 50-card replay deterministically proves zero hidden real defects or reports activation as inconclusive/failed; any owner exception is separately recorded and never represented as a replay pass.
