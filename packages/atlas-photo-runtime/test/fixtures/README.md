# Genuine HEVC fixtures

`heic-manifest.json` pins every source URL, byte count and SHA-256. Files are
unchanged upstream fixtures, with only local filenames changed. `LIBHEIF-COPYING`
and `PILLOW-HEIF-LICENSE` preserve the respective upstream licenses.

The libheif color fixtures are actual HEVC-encoded images, including a thumbnail
and an auxiliary alpha case. `two-images.heic` is libheif's original example;
tests change only its `pitm` item ID to prove correct second-primary selection.
Pillow-Heif's `rgb10.heic` and `rgb12.heic` have actual 10/12-bit HEVC samples.
The two metadata fixtures test descriptive primary Exif and HEIF transform
precedence despite distinct thumbnail properties. These files are not browser-converted PNGs.

`heif-fixture-helpers.mjs` constructs controlled property variants while preserving
all original compressed image bytes. Its grid generator creates four distinct
HEVC tile item IDs sharing unchanged fixture extents, a real `grid` primary, exact
`dimg` references and precise property associations. Independent expected pixels
are assembled from actual decoded source tiles. Uniform-depth/color grids and
separate tile transform/color disagreements are tested. Synthetic source/geometry
fixtures do not establish real iPhone color or optical grading acceptance.

`process-fixture.mjs` is original test code. It deliberately blocks its own event
loop, floods output or repeatedly performs actual native HEVC decode so its parent
must enforce cancellation and reap that exact child. No model calls occur.

`icc-manifest.json` pins two unchanged CC0 compact v4 profiles and their upstream
license. `withExif` adds bounded synthetic TIFF graphs and correct `cdsc`/`iloc`
metadata associations to genuine HEVC fixtures; no compressed image samples are
rewritten. Tests compare preserved RGB/16-bit values and profile bytes, not names.
Apple Display P3's exact observed hash is qualified separately using retained
private task evidence and the metadata-only fixture described below. No user
photograph is copied into this repository. Native-reference and independent matrix/TRC-versus-LittleCMS evidence
is retained under `atlas-speedster-defects-20260912/iphone/` outside the repository.

`Apple-DisplayP3.icc` is only the standard 536-byte Apple Display P3 ICC metadata
already qualified by `heif-metadata.mjs` (SHA-256
`20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab`).
It was extracted from an owner-provided retained original for the synthetic
Apple SDR-base/CLLI regression fixture. It contains no photo pixels, Exif,
location, card identity or user-specific metadata. Existing licensed HEVC test
pixels are reused unchanged; no owner photo is committed.
