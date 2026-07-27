# AI Grader Production Lighting Acceptance Protocol

Status: owner-operated validation worksheet. This document records the successful
direction discovered on 2026-07-27; it does not claim a finalized lighting profile
until the owner records the physical settings and completes the three-card matrix.

## Safety and authority

- The owner controls every physical light, card, camera, and background change.
- Software, agents, and monitors must not issue lighting or capture commands for
  this protocol.
- Do not change calibration to compensate for a lighting problem.
- Do not publish a card merely to validate lighting.
- Preserve the original normalized evidence and overlays for every accepted test.

## Successful direction observed by the owner

- Base/background: matte red paper beneath the card.
- Primary illumination: the fixed overhead ring light.
- Supplemental illumination: exterior light sufficient to keep the photographs
  useful for downstream OCR, EYES, and deterministic pixel analysis.
- Ring-light height experiment: moving the ring upward did not produce an obvious
  visual difference during the initial test.
- Practical result: the final owner-selected arrangement produced coherent Front
  and Back card contours and valid `1200 x 1680` normalized evidence on report
  `ai-grader-fb1ba591-488c-4239-8013-a795476def9d`.

The exact physical positions and settings were not recorded during discovery, so
the arrangement is not reproducible yet.

## Record the physical recipe before the next card

Photograph the complete rig from the front and side, then record:

| Setting | Recorded value |
| --- | --- |
| Red paper product / finish | |
| Camera-to-card distance | |
| Ring-to-card distance | |
| Ring duty / brightness | |
| Exterior light count | |
| Exterior light type / color temperature | |
| Exterior light position(s) relative to card center | |
| Exterior light height(s) | |
| Exterior light angle(s) | |
| Exterior light brightness setting(s) | |
| Room lights / window light | |
| Camera exposure / gain profile | |

Use fixed physical reference points or tape marks so the recipe can be restored.

## Three-card repeatability matrix

Run only after the physical recipe above is complete.

| Test | Card type | Front contour | Back contour | Normalized Front | Normalized Back | Hotspot / glare note | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Dark card | | | | | | |
| 2 | Light card | | | | | | |
| 3 | Foil / reflective card | | | | | | |

For each side, record:

- whether all four physical edges remain visible;
- whether the detected contour is enclosed and remains on the physical card edge;
- whether any green teeth/spikes jump to artwork, glare, shadow, or the base;
- whether the normalized output contains the full card with no clipped edge;
- whether text and surface detail remain usable downstream.

## Acceptance gate

The lighting recipe is accepted only when all three card types:

1. produce valid Front and Back normalized evidence;
2. retain all four physical card edges without clipping;
3. avoid persistent glare or shadow that moves the contour away from the card;
4. reach the review page without a normalized-evidence failure; and
5. are visually checked by the owner against their exact overlays.

If any class fails, change one physical variable at a time, record it, and repeat
only that class plus one previously passing control card. Do not silently tune
detector thresholds around an unrecorded lighting change.
