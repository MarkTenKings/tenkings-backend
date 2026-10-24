# Approved Atlas B static artwork

These files are derived from `Atlas_Final_Approved_Labels.zip`, approved October 22, 2026. They contain no baked card name, card details, numerical grade, grade descriptor or certificate. Use the manifest's geometry and the versioned dynamic renderer; do not stretch these assets or use a finished sample as a general template.

- `front-black.png`: approved static black body, logo, fingerprint treatment, silhouette and NFC aperture. Dynamic areas are restored to opaque black. The certificate region follows the source's exact clearing rectangle at x17.1/y16.75 mm; it includes the variable-width frame and the right portion of its small leading connector. The original connector segment left of x17.1 and every neighboring fingerprint ridge remain intact. The renderer must draw the closed frame and complete connector again.
- `front-support-white.png`: only the exact supplied GRADE / REPORT lettering. Composite white for white-capable output; use its alpha as a knockout for black/blank output. Do not flatten a preview stock background into either print mode.
- `front-support-black.png`: identical support alpha with black RGB, for luminance-mask knockout composition. It does not add black letters over the opaque body.
- `back-black.png`: byte-for-byte copy of the approved shared back PNG. Instructions, small logo proportions, native raster edges and website QR remain unchanged. This QR points to `https://atlasgrading.com/`; it is separate from a card's NFC destination.
- `vectors.json`: unchanged original grade-10 vector from the supplied Alakazam SVG, including its placement transform.
- `manifest.json`: source hashes, output hashes, exact physical/pixel dimensions, dynamic-region rectangles, source geometry and verification receipts.

Run the reproducible importer with Python and Pillow 12.3.0:

```sh
python3 packages/atlas-finishing/scripts/import-approved-b-assets.py /path/to/Atlas_Final_Approved_Labels
```

The importer uses the approved PNG pixels as the visual authority. Sharp 0.33.5/librsvg 2.58.93 and WebKit render the SVG shapes, but their raster/alpha values are not pixel-identical to the supplied PNG. Direct PNG extraction avoids that rasterization variance. Transparent artwork must be inspected over an opaque substrate: invisible RGB under alpha zero is not a visible design difference. The importer fills only manifest-listed dynamic/support rectangles; the two supplied sample fronts must then be pixel-identical. Replacing the removed regions with their original pixels and compositing the isolated support plate must reconstruct each complete approved source with zero differing visible-RGB or alpha values.

The front assets use a lossless PNG palette: all 256 entries have the same black or white RGB, and alpha values are exactly 0–255. There is no tracing, alpha threshold, resampling or approximate color quantization. Only invisible RGB values under alpha zero are normalized; all source alpha values outside the cleared dynamic rectangles remain intact. The back file's bytes are unchanged.

Each print face must remain below the existing 1 MiB SVG limit, including dynamic glyph outlines. The manifest records the exact front data-URI size and remaining SVG budget. The renderer must fail visibly if a record cannot meet its layout/size constraints. Never weaken historical SVG validation to admit arbitrary image URLs.
