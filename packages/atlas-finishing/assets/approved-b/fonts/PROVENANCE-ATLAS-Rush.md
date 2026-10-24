# ATLAS Rush - provenance and owner designation

ATLAS Rush v1.000 was created for **ATLAS / Ten Kings**, following Mark Thomas's selection of the original Rush direction and instruction to record it as the ATLAS-owned font. Copyright and owner attribution are recorded in the font metadata and `LICENSE.txt`. The delivery uses proprietary terms, not an open-source font license.

## Original design inputs

The approved Rush concept was generated with the built-in OpenAI Imagegen tool from a written athlete-autograph/brush brief. No reference image or existing font was supplied to that first generation. The reference required uppercase lettering, moderate flourishes, strong small-print structure and monochrome output.

The missing uppercase letters F G J K Q R S V W X Y Z were generated as an original production sheet using only the approved Rush image as the visual reference. This completed the selected design rather than introducing a new design direction. The exact extension prompt and output are in `source/artwork/`.

## Font engineering

The actual original shapes for B E D I A M O N L U P T C H, the ten numerals and principal caption marks were isolated from our approved Rush image. Touching original letters were separated by their stroke cores. Those original bitmap shapes and the original extension glyphs were converted into smooth editable outlines with Potrace. Supporting punctuation was constructed as original vector paths and combinations of our own dot/stroke forms.

This process **vectorized our own original artwork; it did not trace an existing font**. No commercial, open-source, system or other third-party font outline was copied or used to create the ATLAS glyphs. Standard PDF base fonts appear only in explanatory specimen captions.

The glyphs were normalized to a coherent baseline/cap system, spaced in slanted coordinates and given pair kerning. UFO3 is the editable master. Static TrueType and CFF/OpenType binaries were compiled from that master using FontTools/ufo2ft. The TTF includes smart dropout control for monochrome rasterizers; it is not represented as fully hand-hinted.

Per-glyph inputs, source image hashes and construction details are recorded in `source/glyph-provenance.json`. The exact delivered font hashes are in `validation/build-manifest.json`, and independent checks refer to those same binaries.

## Licensing scope

See `LICENSE.txt` for the proprietary font-software terms and owner-authorized use, modification, embedding and printing. The record identifies the requested owner and creation history; it is not a claim that the general autograph lettering style is exclusive. Tool dependencies retain their own licenses and are not redistributed as part of the font package.

## Current state

The full uppercase alphabet, numerals, caption punctuation, editable outlines, two validated static font formats and actual-font specimen are complete. No colors or card textures are embedded. Real printer/label-stock qualification and production renderer integration remain downstream steps.
