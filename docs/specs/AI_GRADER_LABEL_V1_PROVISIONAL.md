# Ten Kings AI Grader Label V1 - Approved Design / Provisional Calibration Specification

Status: design approved on 2026-07-13; runtime integration authorized; not physically calibrated.

Mark provided the exact approval phrase `Label V1 design approved`. That closes the visual design gate and authorizes the scoped runtime integration on `feature/ai-grader-label-v1`. It does not authorize hardware operation, NFC programming, deployment, merge, database changes, or a claim of physical print/cut accuracy.

## Version authority

- Schema: `ten-kings-label-spec-v1`
- Sports template: `ten-kings-sports-label-v1`
- Pokemon template: `ten-kings-pokemon-label-v1`
- Coordinate authority: `frontend/nextjs-app/lib/aiGraderLabelV1.ts`
- Renderer: `frontend/nextjs-app/lib/server/aiGraderLabelV1Renderer.ts`
- Proof generator: `frontend/nextjs-app/scripts/render-ai-grader-label-v1-proofs.ts`
- Approval state: the derived monochrome logo, crown ornament, and embedded Bebas Neue font are approved production render assets. Supplied source/reference images remain provenance-only and are not production render inputs.

The template digest binds the schema version, asset IDs/versions/hashes, physical coordinate manifest, fixed text tiers, and field-mapping version. The renderer verifies asset hashes and PNG dimensions before producing output.

## Source assets

| Role | Asset/version | Format and dimensions | SHA-256 | Current status |
| --- | --- | --- | --- | --- |
| Exact logo source | `ten-kings-logo-2026/v1` | PNG, 1500 x 1170, RGBA, 300 dpi | `c7461cc51eefdf5c259c9895eca1ceab870865c660988273cc8241c1ea8ae470` | Exact supplied gold source; retained as immutable derivation provenance |
| Label logo | `ten-kings-logo-2026-monochrome/v1-derived-from-ten-kings-logo-2026-v1` | PNG, 1500 x 1170, RGBA, 300 dpi | `801b4071499af546102c3d703f27deb3dabc7a4374d5d621eb8ad672ceeeae88` | Approved exact source alpha contours recolored uniformly to dark black `#0f0f0f`; no redraw, tracing, or AI generation |
| Crown ornament | `ten-kings-crown-2026-monochrome/v1-crop-from-ten-kings-logo-2026-v1` | PNG, 1206 x 784, RGBA, 300 dpi | `064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed` | Approved exact crown crop from the supplied source alpha bounds, recolored uniformly to dark black |
| Sports reference | `ten-kings-sports-label-design-reference/v1` | PNG, 2559 x 778, RGBA, approximately 937 dpi | `0da40a07ad789106af0498a1fd62703d33d98fa1680c4b4a30fd20d634ee01d6` | Reference only; not a production render source |
| Pokemon reference | `ten-kings-pokemon-label-design-reference/v1` | PNG, 2559 x 778, RGBA, approximately 937 dpi | `554a99edbec8806e7b03182e00de32f02a3d9dcbfcc29adac3d2d2191997f1a5` | Reference only; not a production render source |
| Label font | `bebas-neue/regular-400-ofl-v1` | TTF | `830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04` | Approved user-supplied Google Fonts package; embedded locally in PDF/SVG output |

The supplied SIL Open Font License is vendored as `fonts/OFL-BebasNeue.txt` (SHA-256 `5dfb66367e86929261375e6a6cf14410136c3c394962f1a381f0a17cf4c7f81d`). The provided package contains only Bebas Neue Regular 400, so all current proof text uses that exact file. Browser integration may declare the same local font with `@font-face`; print artifacts do not depend on a network request to Google Fonts.

## Physical geometry

All base geometry is expressed once in top-left PDF points, at 72 points per inch. PDF rendering converts each top-left Y coordinate to bottom-left PDF space with:

`pdfY = 864 - topLeftY - 59.76`

- Sheet: 8.50 x 12.00 inches, portrait, 612 x 864 points.
- Label: 2.73 x 0.83 inches, 196.56 x 59.76 points.
- Layout: 2 columns x 8 rows, 16 slots, row-major order.
- X coordinates: 72 and 343.44 points.
- Top Y coordinates: 72, 166.32, 260.64, 354.96, 449.28, 543.60, 637.92, and 732.24 points.
- Provisional gaps: 74.88-point column gap and 34.56-point row gap.
- Margins: 72 points on all four sides.

The exact-dimension PDF is the print authority. The same manifest creates the individual label, 16-slot sheet, and Cricut SVG. The operator browser requests and previews the authenticated server-rendered PDF; browser HTML/CSS never becomes a second geometry authority.

Print and cut calibration are separate, versioned, provisional profiles with zero offsets, scale 1.0, and zero rotation. Those values are placeholders until measured Foil Express and Cricut trials are completed from this branch. Both renderers start from the same top-left, 612 x 864-point sheet coordinate manifest:

- PDF calibration uses the top-left sheet origin. Base coordinates are scaled on X/Y first, then translated by `printOffsetXPt` / `printOffsetYPt` in top-left point space.
- Cricut SVG calibration also uses the top-left sheet origin. Base coordinates are scaled first, rotated by `cutRotationDeg` (positive values are clockwise in SVG's downward-positive Y axis), and then translated by `cutOffsetXPt` / `cutOffsetYPt`.

Synthetic non-zero renderer tests assert the emitted PDF transform and Cricut SVG matrix. The provisional zero profile therefore leaves the approved base geometry unchanged while proving measured values will affect the output once authorized calibration supplies them.

## Label zones

- Far left logo: exact derived dark-black Ten Kings artwork at 60% of the initial proof size, aspect ratio preserved, with `GRADING` centered beneath it in the same dark black.
- Center identity: category-specific fixed line hierarchy.
- Right reserved NFC area: an 11 mm-diameter provisional circle whose center lies on the label's vertical centerline; a generic `NFC` symbol is centered in it and the human-readable certificate ID sits directly beneath it with no horizontal divider.
- Far-right grade: final numeric grade with the actual Bebas Neue digit glyph bounds centered on the label centerline; Sports card number is set in small text above the grade when present.
- Center divider: one horizontal rule with the exact derived Ten Kings crown separates the name block from the optional descriptor. There is no horizontal rule beneath `HOLO`, `REFRACTOR / ROOKIE`, or any other descriptor.
- Section separators: both vertical rules are interrupted at the label centerline by the exact derived Ten Kings crown, with no `TEN KINGS` lettering.
- No visible QR is rendered in either Label V1 template or production proof. The former per-card QR print page is retired as a production authority and directs operators to authenticated Label Sheets. Public report links and existing internal inventory QR behavior remain separate systems.

## Provisional field hierarchy

Sports:

1. Line 1: `YEAR MANUFACTURER PRODUCT SET`.
2. Line 2: player name, larger than the surrounding text and falling back to confirmed title.
3. Line 3: `PARALLEL / INSERT`, omitted when both fields are empty.
4. Reserved NFC zone: human-readable certificate ID directly beneath the NFC circle.
5. Far right: card number in small text above the final numeric grade when present.

Pokemon:

1. Line 1: `YEAR SET #CARD NUMBER`.
2. Line 2: card name, larger than the surrounding text and falling back to confirmed title.
3. Line 3: `PARALLEL`, omitted when empty.
4. Reserved NFC zone: human-readable certificate ID directly beneath the NFC circle.
5. Far right: final numeric grade.

Whitespace is normalized and all card-information fields render uppercase. Sports parallel and insert use ` / ` punctuation. Certificate IDs preserve the confirmed source value. A grade must be numeric from 1 through 10, rounded to one decimal; an integer renders without `.0`.

## Deterministic overflow

Each field has a finite, ordered list of approved proof sizes. The renderer tries those sizes from largest to smallest and never selects a continuous arbitrary size. Wrapping is balanced across available lines so a normal word is not orphaned on a line when a non-orphan layout fits. Alphabetic hyphenated surnames may break only at the existing hyphen; the continuation keeps its leading hyphen, for example `SHAI GILGEOUS` / `-ALEXANDER`. Metadata balances complete words, for example `2023-24 PANINI NATIONAL` / `TREASURES BASKETBALL`. No word is truncated and no ellipsis is permitted. Metadata and primary may use up to four physical lines in total, and an optional descriptor may use up to two. If even the smallest tier cannot contain every complete word inside its fixed zone, rendering fails closed.

- Metadata: 9, 8, 7, 6 pt.
- Primary name: 19, 17, 15, 13, 11 pt.
- Descriptor: 10, 9, 8, 7, 6 pt.
- Certificate ID: 6.2, 5.6, 5 pt.
- Sports card number: 7, 6.2, 5.5 pt.
- Grade: 34, 31, 28, 25, 22, 19 pt. Grade text must fit exactly.
- Minimum readable proof text: 5 pt.

Text is measured with the embedded font before rendering. Every field is bounded inside its zone, and blank sheet slots receive no label content.

## Proof bundle

The proof script creates:

- Actual-size individual Sports and Pokemon PDFs.
- A four-page 2.45x inspection PDF containing normal and long-field examples.
- A complete 16-slot PDF.
- A five-label partial PDF whose remaining eleven slots are blank.
- A clearly marked calibration PDF.
- Individual label SVGs and provisional Cricut cut/calibration SVGs.
- A machine-readable proof manifest containing the template digest, approval record, assets, coordinates, and provisional physical-calibration status.

Generated proof files are under `output/pdf` and `output/ai-grader-label-v1`. They are approved-design artifacts, but not evidence of physical print/cut calibration.

## Approval and remaining gate

The supplied logo treatment, `GRADING` lockup, 40% reduction, Bebas Neue package, 11 mm NFC diameter and vertical position, certificate placement, crown dividers, Sports/Pokemon mappings, and whole-word overflow behavior were approved by Mark with the exact phrase `Label V1 design approved` on 2026-07-13.

Runtime records freeze the template digest, approved render asset versions/hashes, provisional calibration profile, durable confirmed identity, certificate ID, final grade, report ID, and public report URL at verified Publish. Rendering fails closed if the record is missing, altered, from a legacy assignment, or no longer matches the persisted published row. Server-rendered PDF/SVG routes require an authenticated human operator and an exact sheet revision. Preparing a sheet seals it; marking it printed remains a separate explicit human action.

The immutable runtime record also freezes the first verified Publish assignment: sheet ID, sheet number, slot number, and assignment time. It intentionally excludes mutable sealed time, printed time, and current revision. Rendering validates all four frozen assignment values against the persisted assignment before producing output.

Because PostgreSQL stores the record as JSONB, runtime validation compares objects recursively without depending on key order. It remains strict: object key sets, types, and values must match exactly; missing or extra fields fail; and arrays (including `renderAssets`) remain order-sensitive. The same rule protects the complete Label V1 record, design approval, identity snapshot, verified-Publish retry, and render-time authority checks.

Open and full sheets are not production-print authorities. `Print Current Sheet` seals the exact current revision with any 1–16 assigned labels, after which only sealed or already-printed sheets can return the production PDF/SVG. Empty positions remain blank, future verified Publish assignments use another digital sheet, repeated sealed downloads are deterministic and do not mutate state, and `Mark Sheet Printed` remains a distinct human action after a successful physical print.

Physical print/cut accuracy remains a separate gate. The 11 mm NFC circle represents the stated tag diameter, but the actual tag, Foil Express output, stock, and Cricut cut require measured physical calibration before production use.

Physical accuracy remains unclaimed until measured Foil Express printing and Cricut cutting establish approved versioned calibration profiles. Hardware must not be started automatically, and generating a PDF/SVG must never mark a sheet printed.
