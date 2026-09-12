# Genuine HEVC fixtures

`heic-manifest.json` pins every source URL, byte count and SHA-256. Files are
unchanged upstream fixtures, with only local filenames changed. `LIBHEIF-COPYING`
and `PILLOW-HEIF-LICENSE` preserve the respective upstream licenses.

The libheif color fixtures are actual HEVC-encoded images, including a thumbnail
and an auxiliary alpha case. `two-images.heic` is libheif's original example;
tests change only its `pitm` item ID to prove correct second-primary selection.
Pillow-Heif's `rgb10.heic` and `rgb12.heic` have actual 10/12-bit HEVC samples.
The two metadata fixtures test explicit refusal of associated Exif, including
neutral and nonidentity orientation. These files are not browser-converted PNGs.

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
