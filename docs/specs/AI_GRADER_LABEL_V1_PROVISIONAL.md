# Ten Kings AI Grader Label V1 - Approved Geometry / Barlow Readability Revision Specification

Status: original design approved on 2026-07-13; 8.5 x 11-inch FoilXpress geometry physically measured and accepted on 2026-07-14; Barlow readability revision authorized, physically printed at actual size, and approved for foil readability by Mark on 2026-07-15. The overall calibration profile remains provisional because unreported printer/Cricut measurements are not inferred.

Mark provided the exact approval phrase `Label V1 design approved`. That closes the visual design gate and authorizes the scoped runtime integration on `feature/ai-grader-label-v1`. It does not authorize hardware operation, NFC programming, deployment, merge, database changes, or a claim of physical print/cut accuracy.

## Version authority

- Schema: `ten-kings-label-spec-v1`
- Sports template: `ten-kings-sports-label-v1`
- Pokemon template: `ten-kings-pokemon-label-v1`
- Coordinate authority: `frontend/nextjs-app/lib/aiGraderLabelV1.ts`
- Renderer: `frontend/nextjs-app/lib/server/aiGraderLabelV1Renderer.ts`
- Proof generator: `frontend/nextjs-app/scripts/render-ai-grader-label-v1-proofs.ts`
- Current design revision: `barlow-readability-v2`, authorized and physically approved for actual-size foil readability on 2026-07-15, with immutable status `actual_size_foil_readability_approved`.
- Approval state: the exact derived crown, embedded Bebas Neue display font, embedded Barlow Regular small-text font, and embedded Barlow SemiBold live-wordmark font are the current production render inputs. The former composite raster logo and supplied source/reference images remain provenance only.

The template digest binds the schema version, asset IDs/versions/hashes, physical coordinate manifest, fixed text tiers, and field-mapping version. The renderer verifies asset hashes and PNG dimensions before producing output.

## Source assets

| Role | Asset/version | Format and dimensions | SHA-256 | Current status |
| --- | --- | --- | --- | --- |
| Exact logo source | `ten-kings-logo-2026/v1` | PNG, 1500 x 1170, RGBA, 300 dpi | `c7461cc51eefdf5c259c9895eca1ceab870865c660988273cc8241c1ea8ae470` | Exact supplied gold source; retained as immutable derivation provenance |
| Legacy label logo | `ten-kings-logo-2026-monochrome/v1-derived-from-ten-kings-logo-2026-v1` | PNG, 1500 x 1170, RGBA, 300 dpi | `801b4071499af546102c3d703f27deb3dabc7a4374d5d621eb8ad672ceeeae88` | Retained as immutable derivation provenance; no longer a production render input after the live Barlow wordmark revision |
| Crown ornament | `ten-kings-crown-2026-monochrome/v1-crop-from-ten-kings-logo-2026-v1` | PNG, 1206 x 784, RGBA, 300 dpi | `064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed` | Approved exact crown crop from the supplied source alpha bounds, recolored uniformly to dark black |
| Sports reference | `ten-kings-sports-label-design-reference/v1` | PNG, 2559 x 778, RGBA, approximately 937 dpi | `0da40a07ad789106af0498a1fd62703d33d98fa1680c4b4a30fd20d634ee01d6` | Reference only; not a production render source |
| Pokemon reference | `ten-kings-pokemon-label-design-reference/v1` | PNG, 2559 x 778, RGBA, approximately 937 dpi | `554a99edbec8806e7b03182e00de32f02a3d9dcbfcc29adac3d2d2191997f1a5` | Reference only; not a production render source |
| Display font | `bebas-neue/regular-400-ofl-v1` | TTF | `830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04` | Embedded locally for the primary name and grade only |
| Small-text font | `barlow/regular-400-ofl-v1` | TTF | `77fb1ac54d2ceb980e3ebdfa7a9d0f64e85a66e4fdfb7f914a7b0aa08fb33a5d` | Embedded locally for metadata, descriptor, card number, certificate ID, NFC, and GRADING |
| Wordmark font | `barlow/semibold-600-ofl-v1` | TTF | `07ea3ff2743cf6716122a520c5e6f1aed0e75c079bc3b75e512fbf1a85caef9b` | Embedded locally for the live TEN KINGS wordmark only; no synthesized weight |

The supplied SIL Open Font License is vendored as `fonts/OFL-BebasNeue.txt` (SHA-256 `5dfb66367e86929261375e6a6cf14410136c3c394962f1a381f0a17cf4c7f81d`). Bebas Neue Regular remains exact and unsynthesized for primary names and grades. Browser integration may declare the same local font with `@font-face`; print artifacts do not depend on a network request.

The complete static Barlow family is vendored under `fonts/barlow/` with its SIL OFL, weight/style map, CSS declarations, and SHA-256 inventory. This revision binds only the exact Regular 400 and SemiBold 600 files listed above. Both are static TrueType faces, embedded/subsetted directly, and never resolved from machine fonts or a network request.

## Physical geometry

All base geometry is expressed once in top-left PDF points, at 72 points per inch. PDF rendering converts each top-left Y coordinate to bottom-left PDF space with:

`pdfY = 792 - topLeftY - 59.76`

- Sheet: 8.50 x 11.00 inches, portrait, 612 x 792 points.
- Label: 2.73 x 0.83 inches, 196.56 x 59.76 points.
- Layout: 2 columns x 8 rows, 16 slots, row-major order.
- X coordinates: 72 and 343.44 points.
- Top Y coordinates: 72, 149.76, 227.52, 305.28, 383.04, 460.80, 538.56, and 616.32 points.
- Provisional gaps: 74.88-point (1.04-inch) column gap and 18-point (0.25-inch) row gap.
- Margins: 72 points (1 inch) at the left, top, and right; 115.92 points (1.61 inches) at the bottom.
- Slot 2 is exactly 1 inch from the top and right sheet edges. Each two-row group spans 1.91 inches, below the FoilXpress AP 2.25-inch print-head span reported by Mark.

The exact-dimension PDF is the print authority. The same manifest creates the individual label, 16-slot sheet, and Cricut SVG. The operator browser requests and previews the authenticated server-rendered PDF; browser HTML/CSS never becomes a second geometry authority.

Mark printed the exact calibration PDF at 100 percent and measured each label at `2.730 x 0.830 inches`, establishing observed print scale `1.000 x 1.000`. For top-right slot 2, Mark measured `1.125 inches` from paper top to label top and `1.375 inches` from paper right to label right. Relative to the PDF's one-inch top/right anchors, the accepted physical result is observed `27 pt` left and `9 pt` down. Mark accepted that placement and explicitly directed that the PDF layout not change, so those observations are recorded without applying a corrective transform.

Print and cut calibration remain separate, versioned profiles. The current IDs are `ten-kings-foilxpress-ap-letter-provisional-v2` and `ten-kings-cricut-explore-5-letter-provisional-v2`; their software transforms remain zero offsets, scale 1.0, and zero rotation because no correction was requested. Mark separately attested that he handled and accepted the Cricut work. Numeric Cricut X/Y offsets, scale, and rotation were not reported and are not inferred. Both renderers start from the same top-left, 612 x 792-point sheet coordinate manifest:

- PDF calibration uses the top-left sheet origin. Base coordinates are scaled on X/Y first, then translated by `printOffsetXPt` / `printOffsetYPt` in top-left point space.
- Cricut SVG calibration also uses the top-left sheet origin. Base coordinates are scaled first, rotated by `cutRotationDeg` (positive values are clockwise in SVG's downward-positive Y axis), and then translated by `cutOffsetXPt` / `cutOffsetYPt`.

Synthetic non-zero renderer tests assert the emitted PDF transform and Cricut SVG matrix. The provisional zero profile therefore leaves the approved base geometry unchanged while proving measured values will affect the output once authorized calibration supplies them.

## Label zones

- Far-left brand lockup: the exact approved crown crop remains byte-unchanged and is rendered at 120 percent of its prior visible label size (`25.007616 x 16.258954 pt`). The live `TEN KINGS` wordmark uses exact Barlow SemiBold at `9.005493 pt`, `0.12 pt` tracking, and 130 percent of the prior visible cap height. A deterministic `0.88` horizontal fit keeps the one-line wordmark inside the internal lockup without changing its vertical cap height. `GRADING` uses Barlow Regular below it.
- Internal brand/identity boundary: the left vertical separator is at X=`44 pt`; the center identity begins at X=`48 pt` and retains its original right boundary at X=`129.5 pt`. This is label-internal only and does not alter label or sheet coordinates.
- Center identity: the primary name renders first, metadata follows beneath it, and the optional descriptor remains below. The prior center horizontal divider and its small center crown are removed.
- Right reserved NFC area: the logical centered reserve remains 11 mm. Its printed circular guide is 9 mm so the physically fitted inlay can cover the guide edge. A generic `NFC` symbol is centered in it and the human-readable certificate ID sits directly beneath it. No NFC hole is added to the Cricut file and no NFC programming behavior exists.
- Far-right grade: final numeric grade with the actual Bebas Neue digit glyph bounds centered on the label centerline; Sports card number is set in small text above the grade when present.
- Section separators: both vertical rules are interrupted at the label centerline by the exact derived Ten Kings crown, with no `TEN KINGS` lettering.
- No visible QR is rendered in either Label V1 template or production proof. The former per-card QR print page is retired as a production authority and directs operators to authenticated Label Sheets. Public report links and existing internal inventory QR behavior remain separate systems.

## Provisional field hierarchy

Sports:

1. Line 1: player name in Bebas Neue, larger than the surrounding text and falling back to confirmed title.
2. Following line(s): `YEAR MANUFACTURER PRODUCT SET` in Barlow Regular.
3. Line 3: `PARALLEL / INSERT`, omitted when both fields are empty.
4. Reserved NFC zone: human-readable certificate ID directly beneath the printed NFC guide.
5. Far right: card number in small text above the final numeric grade when present.

Pokemon:

1. Line 1: card name in Bebas Neue, larger than the surrounding text and falling back to confirmed title.
2. Following line(s): `YEAR SET #CARD NUMBER` in Barlow Regular.
3. Line 3: `PARALLEL`, omitted when empty.
4. Reserved NFC zone: human-readable certificate ID directly beneath the printed NFC guide.
5. Far right: final numeric grade.

Whitespace is normalized and all card-information fields render uppercase. Sports parallel and insert use ` / ` punctuation. Certificate IDs preserve the confirmed source value. A grade must be numeric from 1 through 10, rounded to one decimal; an integer renders without `.0`.

## Deterministic overflow

Each field has a finite, ordered list of approved proof sizes. The renderer tries those sizes from largest to smallest and never selects a continuous arbitrary size. Wrapping is balanced across available lines so a normal word is not orphaned on a line when a non-orphan layout fits. Alphabetic hyphenated surnames may break only at the existing hyphen; the continuation keeps its leading hyphen, for example `SHAI GILGEOUS` / `-ALEXANDER`. Metadata balances complete words, for example `2023-24 PANINI NATIONAL` / `TREASURES BASKETBALL`. No word is truncated and no ellipsis is permitted. Metadata and primary may use up to four physical lines in total, and an optional descriptor may use up to two. If even the smallest tier cannot contain every complete word inside its fixed zone, rendering fails closed.

- Metadata: 9, 8, 7, 6, 5 pt.
- Primary name: 19, 17, 15, 13, 11 pt.
- Descriptor: 10, 9, 8, 7, 6, 5 pt.
- Certificate ID: 6.2, 5.6, 5 pt; unusually long IDs may use two lines and break only at an existing hyphen, preserving every character.
- Sports card number: 7, 6.2, 5.5 pt.
- Grade: 34, 31, 28, 25, 22, 19 pt. Grade text must fit exactly.
- Minimum readable proof text: 5 pt.

Names and grades are measured/drawn with the embedded Bebas Neue face. Metadata, descriptors, certificate IDs, card numbers, NFC, and GRADING are measured/drawn with the exact embedded Barlow Regular face and `0.12 pt` small-text tracking. The renderer uses the same face and tracking for fitting and output. Every field is bounded inside its zone, and blank sheet slots receive no label content.

## Proof bundle

The proof script creates:

- Actual-size individual Sports and Pokemon PDFs.
- A four-page 2.45x inspection PDF containing normal and long-field examples.
- A complete 16-slot PDF.
- A five-label partial PDF whose remaining eleven slots are blank.
- A clearly marked calibration PDF.
- Individual label SVGs and provisional Cricut cut/calibration SVGs.
- A machine-readable proof manifest containing the template digest, approval record, assets, coordinates, exact artifact hashes/byte lengths, deterministic two-pass rule, and accepted physical observations.

Generated proof files are under `output/pdf` and `output/ai-grader-label-v1`. Mark manually printed the exact populated Barlow NFC-fit PDF and reported that the new font looks great. The recorded physical observation applies to that byte-exact label artwork; software proofs alone are not physical evidence.

## Approval and remaining gate

The original visual design was approved by Mark with the exact phrase `Label V1 design approved` on 2026-07-13. Mark subsequently accepted the measured 8.5 x 11-inch print geometry and real inlay fit, then explicitly authorized the exact Barlow Regular small text, Barlow SemiBold wordmark, 120-percent crown, 130-percent wordmark cap height, primary-first center order, center-divider removal, and 9 mm printed-guide revision on 2026-07-15. Mark manually printed the exact populated Barlow PDF, reported `print with new font looks great. approved!`, and then answered `All of that is approved` when asked for the complete Label V1 physical handoff approval. The actual-size Barlow foil-readability gate is therefore closed.

Runtime records freeze the template digest, approved render asset versions/hashes, provisional calibration profile, durable confirmed identity, certificate ID, final grade, report ID, and public report URL at verified Publish. Rendering fails closed if the record is missing, altered, from a legacy assignment, or no longer matches the persisted published row. Server-rendered PDF/SVG routes require an authenticated human operator and an exact sheet revision. Preparing a sheet seals it; marking it printed remains a separate explicit human action.

The immutable runtime record also freezes the first verified Publish assignment: sheet ID, sheet number, slot number, and assignment time. It intentionally excludes mutable sealed time, printed time, and current revision. Rendering validates all four frozen assignment values against the persisted assignment before producing output.

Because PostgreSQL stores the record as JSONB, runtime validation compares objects recursively without depending on key order. It remains strict: object key sets, types, and values must match exactly; missing or extra fields fail; and arrays (including `renderAssets`) remain order-sensitive. The same rule protects the complete Label V1 record, design approval, identity snapshot, verified-Publish retry, and render-time authority checks.

Open and full sheets are not production-print authorities. `Print Current Sheet` seals the exact current revision with any 1-16 assigned labels, after which only sealed or already-printed sheets can return the production PDF/SVG. Empty positions remain blank, future verified Publish assignments use another digital sheet, repeated sealed downloads are deterministic and do not mutate state, and `Mark Sheet Printed` remains a distinct human action after a successful physical print.

Observed physical evidence now includes exact `2.730 x 0.830-inch` FoilXpress output, accepted slot-2 placement measurements, Mark's separate Cricut acceptance attestation, a real inlay that fits perfectly within the logical centered 11 mm reserve, and Mark's actual-size Barlow foil-readability approval. Exact driver/version, exact AP media SKU/material, an independently recorded 100-percent Fit/Scale-disabled dialog state, numeric Cricut offsets/scale/rotation, and measured NFC-inlay diameter remain explicitly unreported rather than assumed. The profile therefore remains `provisional_not_physically_calibrated`. No NFC tag was programmed.

Final merge remains gated on independent Mac architecture approval of the final exact PR head and fresh required GitHub/Vercel checks. Hardware must not be started automatically, generating a PDF/SVG must never mark a sheet printed, and merge does not authorize deployment.
