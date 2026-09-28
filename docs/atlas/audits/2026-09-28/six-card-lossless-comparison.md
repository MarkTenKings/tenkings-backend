# Six-card lossless comparison

Observed September 27, 2026, 8:49 p.m. Pacific (September 28, 03:49 UTC). Read-only production comparison; no new grading requests, human approvals, repairs or deployment.

The six newest captures are Cards 38–43, captured at 8:28–8:30 p.m. Pacific. They match the card identities below. The matching previous analyses are from September 25, except Stormfront Magikarp, whose latest previous analysis is September 22. Some previous cards were reviewed or approved later. The September 27 Magikarp #039/192 is Rebel Clash, a different card, and is excluded.

## Results

These are original machine results, before human changes. ASTRA proposes defect locations and types; deterministic measurement and scoring produce the proposed grades.

| Card | Previous result | New lossless result |
|---|---|---|
| Snivy, Legendary Treasures RC1/RC25 | Six raw proposals, but response rejected for an outline outside the card; no completed grade | Grade **10**, 11 measured findings: eight back whitening marks, two back scuffs and one possible front scuff |
| Abomasnow, Astral Radiance TG01/TG30 | Grade **10**, 13 measured findings | 14 raw proposals, but response rejected; no new grade |
| Magikarp, Stormfront 65/100 | Ten validated proposals; no saved completed grade found | Grade **9.5**, nine measured findings: six whitening marks and three scuffs, all on the back |
| Jaxson Dart, Mosaic Center Stage #7 | Three back scuffs; printed geometry unresolved, no overall grade | One possible front scuff and one back scuff; printed geometry still unresolved, no overall grade |
| Drake Maye, Donruss Threads DTBH-DME | Grade **9.5**, seven findings | Back physical edge detection stopped preparation before ASTRA analysis |
| Jaxson Dart, Donruss Threads DTBH-JDT | Grade **10**, zero findings | Back physical edge detection stopped preparation before ASTRA analysis |

Three new reports reached the review queue, but only Snivy and Magikarp have numeric grades. The Mosaic report has analyzed defects without an overall grade. Three other cards are in Needs Attention. No pair currently has a completed original machine grade on both sides of this comparison.

The Snivy raw score is 9.775, displayed as 9.8 in detailed scoring and rounded to the proposed half-point grade of 10. Magikarp's raw score is 9.668, with proposed grade 9.5. These follow the existing rule; lossless did not change the grading formula.

Magikarp's new run retains the prominent bottom-edge and lower-left whitening seen in its previous analysis. It adds upper-border hairlines and upper-left wear, drops the previous possible front whitening, and no longer labels a lower-right mark as exposed-stock chipping. More or fewer findings alone does not establish correctness. The Mosaic run also changes which scuffs it identifies, with medium/high uncertainty and glare limitations.

## Why the four cards did not receive a new overall grade

**Drake Maye and Jaxson Dart Donruss Threads:** Both saved back photographs visibly contain all four edges and corners, with background around them. Their fronts passed physical detection. On each back, the detector generated two candidate outlines, but neither passed the complete four-side support rule. This occurred before lossless WebP encoding. The receipt records `NO_SUPPORTED_PHYSICAL_OUTLINE`, not a photo-format error, missing upload, ambiguity rejection or engine exception. Its zero per-side sample values are default empty diagnostics; they do not identify the failing side. The retained evidence does not establish the exact rejected threshold. A diagnostic replay on the exact working PNGs is the next step for that deeper investigation.

**Jaxson Dart Mosaic:** Physical edges were found and both photographs were prepared. The engine could not establish a supported printed frame on either side of this borderless design. ASTRA returned two valid scuff proposals. The same printed-geometry limitation existed in the previous run. The photos also show glare, which ASTRA reported as a limitation; glare is not independently established as the geometry failure's cause.

**Abomasnow:** Photo preparation and geometry succeeded. ASTRA returned 14 findings. Five bottom-edge whitening outlines (findings 9, 10, 11, 13 and 14) extend up to three pixels below the allowed card boundary after crop-to-card conversion. The validator rejects the entire response on the first such outline. This is a localization/validation failure, not a cut-off photograph or failed upload. The new request also included 12 previously reviewed examples; the old request included none. Raw rejected proposals are diagnostic evidence and have not been treated as approved or measurable findings.

## Encoding, timing and usage

All eight prepared sides actually used by the four new ASTRA runs were verified by immutable artifact hash and matched to their run's image binding. They use `atlas-prepared-lossless-webp-v1`, whereas their earlier counterparts use WebP quality 92. New full inspection files are 2.35–2.87 MB per side at the unchanged 1350×1858 dimensions. ASTRA's PNG/crop inputs come from these images. These checks confirm the live format change, not an increase in prepared dimensions.

| Analysis | Previous ASTRA dispatch → stored response | New | Input tokens, previous → new | Output tokens, previous → new |
|---|---:|---:|---:|---:|
| Snivy | 3m 22s, rejected | 4m 10s | 16,210 → 16,157 | 9,411 → 11,056 |
| Abomasnow | 4m 33s | 5m 18s, rejected | 16,167 → 35,574 | 13,489 → 14,200 |
| Magikarp | 8m 25s | 5m 42s | 16,157 → 16,206 | 14,661 → 15,050 |
| Jaxson Dart Mosaic | 2m 39s | 2m 34s | 16,176 → 16,197 | 7,074 → 6,678 |

These are analysis intervals, not capture/upload-to-finished-review times. No cached input tokens were recorded. Input usage stayed around 16.2k for the three requests without reviewed examples. Abomasnow's larger request included 12 reviewed lessons and their example imagery, so its usage increase cannot be assigned to lossless alone. Output usage varies with reasoning and generated findings. No dollar costs are claimed without verified pricing or billing evidence.

The model (`gpt-6-astra`), reasoning effort (`xhigh`), prompt hash, response-schema hash and crop layout match between the paired runs. However, the physical photographs, camera distance, lighting, geometry, and in Abomasnow's case reviewed examples changed. This is not an encoding-only controlled experiment, and it does not establish improved grading accuracy or a consistent speed change.

## Evidence and identities

Private evidence directory: `/Users/markthomas/.codex/atlas-handoffs/atlas-six-card-comparison-20260928`. It contains database snapshots, 99 hash/length/lineage-verified immutable JSON artifacts, `comparison.json`, exact outside-boundary calculations, and six full-frame scaled copies of the verified sports-card working images. Image inspection copies were resized only for diagnosis; production images were not modified.

| Card | Previous card ID | New card ID |
|---|---|---|
| Snivy | cb960f4b-a762-40a7-af74-17aa7493b449 | 83b2d9a3-e5c6-43f7-86fb-427ba25ab102 |
| Abomasnow | d9c352d0-7156-426f-ab8b-e758d1e6cca4 | 4387f336-dc5d-4837-9f81-c0397d1d884e |
| Magikarp | e1846c0d-daac-429b-8c9f-b34a38785e8d | 922200f4-d127-4d03-a553-46d4f0575837 |
| Jaxson Dart Mosaic | a33907e7-7545-4a55-94d4-d015410e0b08 | 14ca115c-73fc-41a0-bc2e-d16805f91057 |
| Drake Maye Threads | 53d7cc51-4fcb-4fda-ab6f-2e19d8eb122c | b5071619-0cc3-4da5-92b0-d78faeaf4f91 |
| Jaxson Dart Threads | 70175eb0-c180-4b56-a5dc-586c22a7c142 | 0883e437-dd44-46c4-893a-06f7ea6bb3f6 |
