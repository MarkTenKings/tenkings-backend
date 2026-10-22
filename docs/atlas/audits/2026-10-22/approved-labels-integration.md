# Approved Atlas B labels — integration preparation

Owner authorized the existing Atlas website and generator update and production deployment using `Atlas_Final_Approved_Labels.zip`. Read `START_HERE_BUILDER_HANDOFF.md` first. The approved front is B; the back is the smaller three-section layout with the corrected, uniformly scaled logo. Both color and black/blank labels are used for printing, and color front/back artwork must also appear in graded-card compositions after human approval. White-capable print output remains a separate treatment.

## Current source and reusable pipeline

Task branch `codex/atlas-approved-labels` is isolated from the original dirty/conflicted checkout. It starts from `db916b66` and integrates the live photograph-recovery commit `f0fd4f15cefa59d0b57ebdd5deee7fedc170f61e`. Fresh October22 read-only native, provider and control evidence identifies f0fd4f15 as serving; older713573fc release preimages must not be reused.

The reusable implementation is `packages/atlas-finishing/src/label-v4.mjs`, with hash-pinned asset/font provenance, immutable renderer profiles, durable approval-bound preparation, PNG rasterization and the50-position sheet exporter. No generic template registry was found. The old v3 `label-design.mjs`/preview studio is not the active V4 production path. Extend this existing pipeline with a versioned approved-B adapter and keep historical V4 artwork readers intact.

| Consumer | Integration point |
| --- | --- |
| Dynamic front and print layout | `packages/atlas-finishing/src/label-v4.mjs` and versioned successor |
| Black/blank conversion, individual and sheet exports | `packages/atlas-finishing/src/label-sheet.mjs` and raster worker |
| Durable approval-bound labels and immutable refresh | `packages/atlas-connected-manual/src/label-sheet-service.mjs`, repository and replacement intent |
| Staff printing controls | `frontend/atlas-app/components/LabelSheets.jsx`, `lib/label-sheets-client.mjs` |
| Graded-card front/back composition | `approved-card-media.mjs` backend projection; frontend `ApprovedCardMedia.jsx`, media loader and3D scene |
| Public samples and canvas-created labels | `docs/atlas/design/experience/site/`; rebuild through `frontend/atlas-public/scripts/build-homepage.mjs` |
| Native source closure | Explicit approved asset list in `frontend/atlas-app/scripts/package-manual-container.mjs` |

Deployment alone does not replace saved READY labels. Ordinary reprints deliberately copy historical artwork. The existing `refreshLayout()` makes a new immutable replacement after verifying the exact current approved packet, material/jig and target renderer. Recorded successful physical prints fence that operation. Existing labels, frozen exports and approval/NFC history must remain retained.

## Dimensions and artwork

Actual V4 exports already use68.342×20.082mm,6458×1898pixels/2400ppi. The existing sheet remains310×400mm,9764×12598pixels with50 clockwise-rotated positions. The69.342×21.082mm homepage specimen is the old2.73×0.83-inch template, not evidence of a separate bleed setting. Do not enlarge or stretch approved artwork or change the jig.

Approved B has NFC reveal center51.8,9.75mm,radius5.1mm; earlier V4 uses51.25,10.041mm. The50-position jig only contains outer blank apertures, so it does not establish an internal NFC-hole constraint. A separately retained decorative cut file has the old internal circle; actual use of that internal cut on the current blanks is unverified. Preserve the explicitly approved new placement. Approved artwork clips at corner radius1.15mm versus nominal blank radius1.6mm; physical fit is not established by digital canvas agreement.

The provided masters contain embedded raster data and SVG filters. Whole SVGs exceed current1MiB limits and do not satisfy the old vector-only validator. A new narrowly validated format must use known pinned compact assets, not globally remove validation or pass arbitrary image URLs. The supplied rendered PNGs are the approved visual references. Preserve logo proportions and actual alpha; use exact approved PNG pixels because SVG raster engines differ in alpha/resampling even when they render all shapes correctly.

## Typography decision accepted

The package's approved name/detail lettering is raster artwork with no identified font. Existing bundled fonts are Montserrat900 and RobotoCondensed700. Uniform-height comparison confirms that they are not exact: MICHAEL width−2.5%,JORDAN−10.4%,ALAKAZAM+2.9%; detail-line widths+6.8% and+4.3%. The approved J has no top bar; the existing Montserrat J does. The approved lettering also has heavier strokes/smaller counters.

Prepared a full-label comparison of exact references, existing dynamic fonts, and a heavier dynamic proposal using Montserrat900 with45/1000-em outline expansion/tracking and RobotoCondensed900. These are review mockups of dynamic name/detail treatment, not completed production-generator verification. Neither is an exact recovered typeface. The owner explicitly selected the existing Montserrat Black and Roboto Condensed fonts consistently for dynamic labels. The production adapter therefore pins Montserrat900 and RobotoCondensed700, with uniform scaling and no synthetic weight or horizontal stretching. The approved original grade10 vector and static support artwork remain preserved.

Review artifacts: task visualization directory `atlas-label-review/`; private audit evidence `~/.codex/atlas-handoffs/atlas-approved-labels-20261022/release-readiness/`. No production mutation, deployment, restart, migration, card approval, paid analysis, printer operation or NFC write has occurred in this task.

## Implemented source and qualification

The new adapter uses exact pinned source pixels, existing pinned fonts accepted by the owner, and uniform outlined dynamic text. Old artwork stays validated by its original validator. New back/color exports require the exact B renderer and stored snapshot/artwork hashes before reservation; shared back bytes are pinned to the B profile. No arbitrary image URLs are admitted.

The primary post-approval action routes to current label sheets; the old v3 station renderer remains only historical recovery code. Saved station/NFC intents were not regenerated by the design change. Actual front/back, black/blank, white-capable and color PNGs passed physical metadata/pixel checks; the full50-label black sheet used the unchanged jig. Both gold/silver back QR rasters decode to the website URL. See the session log for test counts, artifact hashes and the fresh six-item immutable-refresh census. Native Linux qualification, release effects and post-deploy refresh acceptance remain pending.

## Full-sheet Linux timeout correction

Approved-B sheet raster correction: native qualification of source 6e74df01 stopped at the existing 180-second timeout before any candidate deployment. The worker now renders each Approved-B label once on the existing sheet pixel grid, retains the 1-pixel halo, caches at most 10 frames, and streams the original 256-row PNG strips. Frames are bounded at 640 × 2160 RGBA pixels; the raw cache is bounded at 55,296,000 bytes. V4 and 2400 ppi individual paths, the 180-second timeout, and the Approved-B limit of 1 GiB remain unchanged. New receipt fields identify the frame strategy and its actual allocations.

Local Node 22 verification passed 10 tests: five legacy golden tests, four existing Approved-B tests, and a new full-sheet/partial-sheet test. Fifty unique Kobe labels covering 19 grades rendered in 27.843 seconds with sampled peak RSS of 788,889,600 bytes and peak raw cache of 54,814,144 bytes. Full PNG SHA256: 7d9cdd22747d17d0d36eac2520c1bdd4d84a38a0c245d4db9ecdf6fd9b0443d3. Every retained pixel matched the seven-slot partial sheet, including row boundaries; all 123,006,872 output pixels contained black or transparency with binary alpha. V4 sheet and individual PNG goldens remained byte-identical.

The unpublished Approved-B implementation is not pixel-identical to its earlier strip rasterization. Across all 50 positions, the comparison found 1,178 black-front alpha-edge changes (maximum 57 per frame), 667 back alpha-edge changes (maximum 27), and 225,043 color-front changes (maximum 5,154; channel difference at most 17). Black/back changes occurred only at edges. Color changes consisted of edge quantization and 19 flat-neighborhood RGB changes of 1/255, without alpha changes at those 19 pixels. Source PNGs, glyph paths, proportions, physical geometry and output dimensions are unchanged. Evidence is recorded in frame-cache-review/qualification.json. Native prototype verification and a new immutable release qualification remain required before deployment.
