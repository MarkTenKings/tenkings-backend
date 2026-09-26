# ATLAS Fingerprint v1 — local algorithm prototype

The owner requested a repeatable fingerprint built from card identity plus defect location, shape and size. Study 08 implements that recipe in `first-look/study.js`, between the `ATLAS_FINGERPRINT_V1_BEGIN/END` markers. It produces a deterministic visual signature from a supplied record. It does not detect defects in photographs or authenticate a physical card.

## Inputs and canonical form

- Card edition/identity string, width and height in millimeters.
- Each defect: front/back, category, polygon outline in normalized card coordinates `[0,1]`, measured magnitude and unit (`mm` or `mm²`). Position is represented by the polygon itself rather than a separately mutable display point.
- Coordinates and measurements round to six decimal places. Card identity is Unicode NFC-normalized and trimmed.
- Polygon start point, clockwise/counterclockwise ordering and an optional repeated closing vertex are canonicalized by choosing the lexically first cyclic representation. Findings are sorted by their serialized canonical descriptors. Reordering equivalent input data therefore does not change the result.
- Version `atlas-fingerprint-v1` is included in the canonical record. SHA-256 of its UTF-8 JSON yields the record digest. UI labels show a shortened digest for orientation; the full digest remains available in the computed result.

## Geometry

Defect polygon centroids, perimeter, area, side and measurement weights create spatial influences on the ridge field. A weighted centroid positions the core. Digest bytes deterministically choose whorl, loop or double-loop form, orientation, spacing, deformation and ridge endings/bifurcations. The renderer outputs SVG paths in a 320×440 coordinate space, using ATLAS gold. Coral outlines show the input defects. The disclosure/replay makes the sequence inspectable: locate defects → map position/shape/size → trace the fingerprint, over 4.3 seconds.

The same canonical record and recipe recreate the same paths. Changing identity/dimensions, a location, outline, side or measurement changes the signature. Distinct physical cards cannot be guaranteed to have distinct *detected records* by this prototype. The visual encoding is not a mathematical proof of uniqueness; the digest is not a secret, signature, secure chip identity or anti-copy mechanism. Anyone with the same record can reproduce the graphic. A production recipe must be versioned and frozen once records depend on it.

## Current evidence boundary

The three card examples use existing reference photographs and authored defect polygons/measurements. They are not findings extracted from those photographs. The selected record and generated fingerprint synchronize into the connected report view and NFC illustration, while the existing hero report stays independent and unchanged in content.

Owner confirmed NFC currently opens a saved report for the collector to compare. Physical re-scan matching, image calibration, detector repeatability, changes of lighting/rotation, measurement tolerance, false matches, false non-matches, report authenticity and chip authentication are separate engineering requirements. No production backend, report signing, grading formula, NFC profile or hardware behavior changed in this presentation work.

## Verification

Run `node --test docs/atlas/design/first-look/tests/fingerprint-v1.test.mjs` from the design checkout. Nine tests cover identical inputs/no mutation, ordering/winding/start-point invariance, changes to location/shape/size/card/side/dimensions, and malformed-input rejection. The browser and Node runner match the Alakazam fixture digest:

`d2b5b703f77f787b58b3db982a660339d5621a4ec0036f7d670f8973deb5e39c`

These tests establish record-to-graphic behavior, not biometric-grade physical-card recognition or resistance to counterfeiting.
