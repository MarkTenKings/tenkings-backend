# ATLAS Rush label integration — October 23, 2026

Status: deployed on native, staff, public and both production gateways from application source `8ee3f108d15e085796efc2fb0fcabb5b02e4d9a9`. Mark waived the physical-print check and authorized this lead to deploy independently. Current production authentication is retained; the separate R1 credential transition is excluded.

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

The prior cf4a5b64 native/staff/public candidates were built against pending replacement authentication material and remain staged only. This label-only release instead preserves the current6f3 authentication modules and configuration, with label patches28823288 andb8348778. The same completed focused label checks are reused. Fresh native/web artifacts were built and activated for exact source8ee3f108; staff/public/STAFF SMS bindings are151/113/119. Customer remains84/CUSTOMER SMS36, sourcea537f922. No schema or credential change, paid provider request, label replacement/refresh, saved-export rewrite or physical printing is part of the release. Mark will check the production result after deployment.


## Observed production outcome

Native image5c6b9391 and both canonical web deployments serve exact8ee3f108. Staff/Public/STAFF SMS control revisions151/113/119 were committed once. Both gateways now admit preview-card-foil/print-card-foil while preserving all other routing/authentication. Current credentials and customer site are retained. Canonical and native health passed; exact focused source/font/render checks were reused rather than expanded into a new suite.

The original start refused a concurrent completed staff login before dispatch; an explicit continuation retained that login and the three already committed controls. Final held preservation passed, then the continuation holder lost its connection/verification before an explicit release could be delivered. Its failed-ending receipt is retained, and fresh absence proves its transaction/locks/replacement holder are gone. Current native readback passed after that ending. This is an observed deployed result with a reconciled holder failure, not a claimed successful explicit release. Full identities, hashes and final observations are in the current [Deploy Runbook](../../../runbooks/DEPLOY_RUNBOOK.md).

Final unheld07:08:34Z observation (`6a040a3c…`) found no table/workload changes versus the final held checkpoint, including controls, cards, labels and provider observations. Both gateways passed their six bounded authorization/invalid-mode checks (`6d32983a…`). Technical deployment is complete.
