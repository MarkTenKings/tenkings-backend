# ATLAS Rush label integration — October 23, 2026

Status: implemented locally. Mark subsequently waived the physical-print check and explicitly authorized production deployment on October 23, 2026. This release is being prepared; live serving-source verification remains pending.

## Typeface and selection

Integrated the delivered static ATLAS-Rush-Regular.ttf, SHA256 `5ac5303a4fd8c8956d379891fe7dc0a265d39d1071210fbe06478d0034149aec`, as `atlas-rush`. The explicit file supplies original monochrome outlines. Its Regular face is registered at400 without synthetic weight/slant; file OS/2 weight700 is recorded in provenance. Proprietary ATLAS / Ten Kings license and provenance ship with the runtime asset, whose bytes are checked by the existing container verifier. Full editable source stays at `/Users/markthomas/.codex/atlas-handoffs/atlas-custom-label-font/`.

New photo-style requests select Rush when no reliable distinctive variant/special lettering is printed on the card. Card fields/borders can supply colors/textures, but cannot justify a different face. Printed card lettering and original wordmarks such as THRILLERS remain supported. Earlier requests retain their exact prompt/compiler semantics; the new default changes the immutable cache key. Older Knewave default-face preferences no longer override a new Rush selection; retained exact-photo paint feedback still applies. Saved artwork is not rewritten.

No default hue is introduced. New production styling requires usable photo-derived paint for the variant/special text. Missing/incomplete palette evidence reports LABEL_STYLE_CARD_COLOR_REQUIRED rather than silently emitting white/black text. Serial numbers retain their exact protected text and inherit the evidenced palette; a serial-only `/500` caption can retain its own photo-backed palette evidence. The font itself remains uncolored.

## Physical fitting

Shape the whole Rush caption once with kerning before splitting paint spans. Span boundaries preserve glyph positions, and per-word optical enlargement/normalization is disabled for this approved face. Measure full positioned outlines, brush overhangs and any contrast edge. Target2.3mm outer printed height, minimum2mm, maximum2.6mm; leave0.15mm on each side of the29mm text region. Scale uniformly. Retain existing name/secondary hierarchy, NFC clearance and label dimensions68.342×20.082mm.

Overlong captions return NEEDS_LAYOUT/METADATA_OVERFLOW with their original facts preserved. They are not horizontally squeezed, silently reduced below2mm or stripped of serial/auto/patch details. The existing two-row metadata layout does not gain a third row. A complete BLUE DIAMOND /500 · AUTO · PATCH caption needs an explicit layout decision.

Renderer hash: `cdf11e54cfe96ffc02b3de513f9fa1baebc8b00275ce644c0cbaa0f7c51ee694`. Previous correction profile `0e1705f9cf618b3c8a031dc020f9bbcea4353f7269ac7e50c25c60e8aefa64ab` and earlier saved profiles remain supported.

## Focused checks and print proof

Completed existing focused font/paint10, metadata10, geometry8, wordmark-edge3, policy/provider/preferences28, and container6 checks; additional targeted Rush checks passed after the serial-only correction. No broad suite or independent review loop.

Proof folder: `/Users/markthomas/.codex/atlas-handoffs/atlas-label-feedback-investigation-20261023/atlas-rush-integration/`

- `atlas-rush-actual-size-proof.pdf`: two-page actual-size proof; all10 label placements are68.342×20.082mm, with a29mm ruler. Print100% / Actual size; fit-to-page off.
- `atlas-rush-enlarged.png`: digital/material and print-ink comparison.
- Source scripts, proof data and placement verification are alongside the files.

Rush outer ink: REFRACTOR17.821×2.300mm, X-FRACTOR16.195×2.300mm, YELLOW RAYWAVE25.722×2.300mm. THRILLERS retains the existing saved original lettering at2.500mm. Nick/Cam Rush versions are explicitly labeled font/layout alternatives, not fresh model selections. The separate synthetic BLUE /50 · AUTO example fits; the longer synthetic combined example fails explicitly. No synthetic specials were added to approved real-card records. Proof uses retained paints without paid model calls and was visually inspected.

## Release boundary

This change builds on local correction commit1278181c, whose parent6fe0e462 predates serving geometry fixes. Integrate onto the actual release baseline; never deploy this old branch wholesale. R1 reports last verified production6f3c6d14 and corrected auth0aa2cdf6 still unpromoted; credential release is separate. The prior digital/print color correction also requires preview-card-foil and print-card-foil in both external gateway artwork-query allowlists.

No production deploy/build/restart/migration, paid provider request, label replacement/refresh, export persistence or physical printing occurred. Mark will check physical printer/stock reproduction after deployment, per his subsequent explicit authorization. The prior corrections and this font are not live at this checkpoint.

Release integration: corrections c01e3cdd and Rush 8d252398 were cleanly cherry-picked onto corrected auth source 0aa2cdf67a85a4e4fac114ec71ad3177fa91eb7c in codex/atlas-label-rush-release, preserving current grading/geometry and auth source. R1 retains exclusive shared-production ownership during its auth reconciliation; label builds may be prepared independently.
