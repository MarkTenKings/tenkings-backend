# Label production corrections — October 23, 2026

## Implementation status

Implemented locally on the label worktree. No deployment, runtime/gateway change, migration, paid generation, approval change, production export or saved-artwork rewrite occurred. The owner is developing the custom default font separately; current font assets remain intact.

- Default output is **Card colors + transparent foil**. Only the saved variant/special artwork retains its card-derived colors/textures; metadata/support keep their prior foil or grade-10 black treatment. The graded-card digital URL, material preview, Print ink, individual PNG, 50-position sheet and both 25-position pages use the matching new mode/profiles. Historical output modes and stored exports remain valid.
- Sizing uses actual visible ink: heavy/wide lettering targets2.3mm, brush lettering2.6mm, neutral Roboto remains at its existing cap fit. Fitted name stays at least0.3mm taller, secondary text0.1–0.2mm smaller than variant where the physical layout permits. Secondary minimum is1.3mm visible ink; exact text and physical/NFC bounds remain enforced. Old renderer profile be7680a176376a245fee5ef4d54efbb96dad37ae9799e7378a533bced0f3d5fd remains supported.
- Texture policyv3 selects a central region with at most2:1 aspect wholly inside the cited photograph crop, avoiding thin128x10tiles without stretching or sampling uncited artwork. Existing saved SVGs are not rewritten.
- Protected serial numbering stays deterministic and exact, with its color taken from the variant's card-derived palette. No model-generated numbering is introduced.
- Finishing compares approved sports facts using publication's public projection, fixing rejection caused by private evidence redaction/version differences. Legacy finishing validation accepts strictly validated public sportsAttributes. Normal Card details exposes present suggested serial/autograph/relic facts with a review button before approval.

## Special-detail source finding

A bounded TLS-verified read-only query of the five screenshot certificates found sportsAttributes absent in all five approvals as well as labels. Their missing special details were not removed during label rendering. Identification results are object-storage references; the SQL read does not establish whether machine suggestions exist. No automatic fact backfill was attempted. Existing caption projection supports /500, AUTO and PATCH when approved facts contain them. The new visibility/validation fixes enable this normal workflow without silently treating suggestions as confirmed facts.

## Focused validation

Each owner ran affected existing checks once after its changes; no cross-review loop or new test framework. Texture/paint16 checks; special-detail finishing and UI18; output frontend/service/HTTP/media111, finishing15 and signed-transport1. Sizing geometry/metadata/physical-edge20checks passed, including long captions and raster edges. Source whitespace check passed.

Rendered exact saved production labels at2400ppi and new50/25front profiles at800ppi with the corrected output conversion. Root visually inspected the combined digital/print proof: red THRILLERS/RED PRIZM and silver/aqua/yellow accents appear in both columns; ordinary details retain existing foil treatment. This proof uses historical saved sizing, not the new sizing renderer, and is local output rather than a production download or physical print.

Proof: /Users/markthomas/.codex/atlas-handoffs/atlas-label-feedback-investigation-20261023/card-color-foil-output/five-labels-digital-and-print.png
Other retained artifacts: same folder, render-receipts.json and full-resolution PNGs.

## Release integration

This is a label patch based on6fe0e462, not a deployable replacement for the newer shared runtime. Integrate it onto current production successor first; fresh observation during investigation was6f3c6d14 and R1 auth changes may advance it further. Do not deploy the old label branch wholesale and revert unrelated geometry/auth work.

Release requires native main/label worker and staff frontend updates. Both external gateway artwork-query allowlists must admit exactly preview-card-foil and print-card-foil. Signed application transport is already updated. Coordinate shared runtime/gateway effects with the active R1 lead before execution. No schema migration is needed. Color conversion can use existing saved artwork without new AI calls; new sizing/texture extraction affect newly rendered artwork and must not silently replace immutable old labels/exports. Confirmed special details must exist in the approval before label regeneration.
