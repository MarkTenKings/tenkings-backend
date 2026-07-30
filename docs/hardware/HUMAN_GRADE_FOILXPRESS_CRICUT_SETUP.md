# Human Grade FoilXpress AP + Cricut Explore 5 setup

## Fixed production geometry

- Physical stock: `8.5 x 11 in`, portrait.
- FoilXpress AP driver selection: `8 x 10 in`.
- PDF scale: `100%` / `Actual Size`.
- Finished label: `2.73 x 0.83 in`.
- Label columns start at `x = 1.00 in` and `x = 4.77 in`.
- Label rows start at `y = 1.00, 2.08, 3.16, 4.24, 5.32, 6.40, 7.48, 8.56 in`.
- Horizontal gap: `1.04 in`; vertical gap: `0.25 in`.

The FoilXpress `8 x 10 in` value describes its virtual print window. It does
not change the physical sheet to 8 x 10 in. Cricut must be configured around
the actual 8.5 x 11 in stock.

## FoilXpress print

1. Download the Human Grade page PDF fresh from Production.
2. Open the PDF in Preview or Acrobat.
3. Select the FoilXpress AP and its `8 x 10 in` paper setting.
4. Select `100%` or `Actual Size`.
5. Disable `Fit`, `Scale to Fit`, `Shrink oversized pages`, borderless
   expansion, auto-rotate, and centering overrides.
6. Print one calibration sheet. Do not use `97%`.
7. Confirm one gold cut guide measures `2.73 x 0.83 in` at its inside edges.

## Cricut Design Space project

1. Use a `12 x 12 in` machine mat and select `On Mat`.
2. Upload `human-grade-cricut-8.5x11-cut-template.svg` as a Cut Image.
3. On Canvas, keep the aspect ratio locked and confirm the imported compound
   path is exactly `W 8.5 in` by `H 11 in`.
4. Set Operation to `Basic Cut`. Do not Flatten and do not use Print Then Cut.
5. Keep all paths as the one imported/attached layout. Do not Contour, Weld,
   resize, rotate, mirror, or let Design Space rearrange individual labels.
6. Select Make. Confirm the project is on one `12 x 12 in` mat, portrait, with
   the group beginning at the standard `0.25 x 0.25 in` mat margin.
7. Place the physical sheet in portrait at `0.25 x 0.25 in` on the physical
   mat. The top printed row must be at the top of the mat, label 1 on the left
   and label 2 on the right.
8. Tape outside the label field if the metallic stock can shift. Support the
   mat flat while it feeds.
9. Test the blade/pressure on a scrap of the exact metallic stock before the
   calibration sheet.

## Registration calibration

Use the first `100%` FoilXpress sheet as a calibration sheet, not as production
inventory.

1. Run the nominal Basic Cut once.
2. Inspect the cut against the inside edge of the gold guide at all four page
   corners.
3. Measure signed error at top-left and bottom-right:
   - positive X means the cut is too far right;
   - positive Y means the cut is too far down.
4. If the error is equal at both corners, apply one global X/Y position
   correction to the complete attached group.
5. If the error grows across the sheet, stop. A scale, rotation, mat-placement,
   or feed issue remains; do not compensate individual labels.
6. Repeat on a second calibration sheet. Production use begins only after the
   cut stays immediately inside the gold guide at all four corners.

The black metallic/reflective stock and reflective gold are outside Cricut's
supported Print Then Cut material behavior, so this workflow intentionally
uses Basic Cut plus a fixed physical-sheet registration process.
