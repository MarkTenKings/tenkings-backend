# Native four-edge offline replay

- Detector: `native_four_edge_v2`
- Corpus: `synthetic`
- Seed: `20260712`
- Deterministic decision digest: `d6720d650abe97352ff44ff53dcc6865f47bf4f5ea15f28c898d2ffce08806c7`
- Sequence evaluations: `132`

> Synthetic/adversarial results are engineering regression evidence only; they are not production accuracy, approved thresholds, or Dell hardware performance claims.

| Comparator | Detection recall | Detection precision | Ready recall | Ready precision | False detection | False Ready | P50 detect | P95 detect | Mean corner error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PcaBaseline | 95.8% | 88.5% | 0.0% | 100.0% | 3 | 0 | 5.10 ms | 6.90 ms | 29.64 px |
| ContourQuad | 95.8% | 92.0% | 100.0% | 100.0% | 2 | 0 | 4.89 ms | 5.61 ms | 17.78 px |
| LineRecovery | 83.3% | 90.9% | 66.7% | 100.0% | 2 | 0 | 6.39 ms | 12.71 ms | 28.20 px |
| Fused | 95.8% | 88.5% | 100.0% | 100.0% | 3 | 0 | 9.57 ms | 13.05 ms | 8.87 px |

<!-- replay-accuracy-projection:start -->
## Deterministic accuracy projection

- Decision digest: `d6720d650abe97352ff44ff53dcc6865f47bf4f5ea15f28c898d2ffce08806c7`
| Comparator | Cases | TP | FP | TN | FN | False Ready | Detection recall | Detection precision | Ready recall | Ready precision | Mean corner error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PcaBaseline | 33 | 23 | 3 | 6 | 1 | 0 | 0.958333 | 0.884615 | 0.000000 | 1.000000 | 29.642559 |
| ContourQuad | 33 | 23 | 2 | 7 | 1 | 0 | 0.958333 | 0.920000 | 1.000000 | 1.000000 | 17.777231 |
| LineRecovery | 33 | 20 | 2 | 7 | 4 | 0 | 0.833333 | 0.909091 | 0.666667 | 1.000000 | 28.198295 |
| Fused | 33 | 23 | 3 | 6 | 1 | 0 | 0.958333 | 0.884615 | 1.000000 | 1.000000 | 8.874867 |
<!-- replay-accuracy-projection:end -->

## Missing real-corpus coverage

- Approved blinded Dell Basler Mono8 front/back corpus
- Real black, white, and neutral production plates under accepted Leimac profiles
- Real same-tone borders, foil, glare, shadow, and worn-corner prevalence
- Human-approved no-card, hand, ruler, and wrong-object negatives
- Measured front/back recall gap and zero-false-Ready negative set
- Dell CPU-load, BlockID, hardware timestamp, and overlay-age timing

## Sequence results

| Case | Side | Category | Comparator | Frames | Expected detection | Detected | Expected Ready | Ready | Qualified | First Ready | Final reason | Motion reset | Epoch reset | Frozen reset | Old-epoch Ready | Safe outcome |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| neutral-front | Front | neutral_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| neutral-back | Back | neutral_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| black-front | Front | black_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| black-back | Back | black_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| white-front | Front | white_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsafeContinuity | False | False | False | False | False |
| white-back | Back | white_plate | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| same-tone-front | Front | same_tone_border | PcaBaseline | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| same-tone-back | Back | same_tone_border | PcaBaseline | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| foil-front | Front | foil_glare | PcaBaseline | 5 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| foil-back | Back | foil_shadow | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| worn-front | Front | worn_corners | PcaBaseline | 5 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| worn-back | Back | worn_corners | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| rotation-minus35 | Front | rotation_envelope | PcaBaseline | 5 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| rotation-plus35 | Back | rotation_envelope | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| perspective-front | Front | perspective_translation | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| perspective-back | Back | perspective_translation | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| clipped-front | Front | clipped | PcaBaseline | 5 | True | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| clipped-back | Back | clipped | PcaBaseline | 5 | True | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| no-card | Front | no_card | PcaBaseline | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| hands | Back | hands | PcaBaseline | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| ruler | Front | ruler | PcaBaseline | 5 | False | True | False | False | 0 | n/a | ExcessResidual | False | False | False | False | True |
| wrong-object | Back | wrong_object | PcaBaseline | 5 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| frozen-source | Front | fresh_before_frozen | PcaBaseline | 5 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| frozen-repeat | Front | frozen_frame | PcaBaseline | 5 | True | True | False | False | 0 | n/a | FrozenFrame | False | False | True | False | True |
| slow-drift | Front | slow_drift | PcaBaseline | 6 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| sudden-motion | Back | sudden_motion | PcaBaseline | 7 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| epoch-transition | Front | epoch_transition | PcaBaseline | 7 | True | True | True | False | 0 | n/a | ExcessResidual | False | True | False | False | False |
| wrong-epoch | Back | wrong_epoch | PcaBaseline | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| wrong-side | Back | wrong_side | PcaBaseline | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| removal-replacement | Back | removal_replacement | PcaBaseline | 8 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| orientation-90cw | Front | sensor_orientation | PcaBaseline | 5 | True | True | True | False | 0 | n/a | ExcessResidual | False | False | False | False | False |
| orientation-mirror | Back | sensor_orientation | PcaBaseline | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| internal-rectangle | Front | internal_wrong_rectangle | PcaBaseline | 6 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| neutral-front | Front | neutral_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| neutral-back | Back | neutral_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-front | Front | black_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-back | Back | black_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-front | Front | white_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-back | Back | white_plate | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| same-tone-front | Front | same_tone_border | ContourQuad | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| same-tone-back | Back | same_tone_border | ContourQuad | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| foil-front | Front | foil_glare | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| foil-back | Back | foil_shadow | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| worn-front | Front | worn_corners | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| worn-back | Back | worn_corners | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-minus35 | Front | rotation_envelope | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-plus35 | Back | rotation_envelope | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| perspective-front | Front | perspective_translation | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| perspective-back | Back | perspective_translation | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| clipped-front | Front | clipped | ContourQuad | 5 | True | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| clipped-back | Back | clipped | ContourQuad | 5 | True | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| no-card | Front | no_card | ContourQuad | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| hands | Back | hands | ContourQuad | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| ruler | Front | ruler | ContourQuad | 5 | False | True | False | False | 0 | n/a | UnsafeCoverage | False | False | False | False | True |
| wrong-object | Back | wrong_object | ContourQuad | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| frozen-source | Front | fresh_before_frozen | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| frozen-repeat | Front | frozen_frame | ContourQuad | 5 | True | True | False | False | 1 | n/a | FrozenFrame | False | False | True | False | True |
| slow-drift | Front | slow_drift | ContourQuad | 6 | True | True | True | True | 6 | 3 | None | False | False | False | False | True |
| sudden-motion | Back | sudden_motion | ContourQuad | 7 | True | True | True | True | 7 | 3 | None | True | False | False | False | True |
| epoch-transition | Front | epoch_transition | ContourQuad | 7 | True | True | True | True | 7 | 3 | None | False | True | False | False | True |
| wrong-epoch | Back | wrong_epoch | ContourQuad | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| wrong-side | Back | wrong_side | ContourQuad | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| removal-replacement | Back | removal_replacement | ContourQuad | 8 | True | True | True | True | 6 | 7 | None | False | False | False | False | True |
| orientation-90cw | Front | sensor_orientation | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| orientation-mirror | Back | sensor_orientation | ContourQuad | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| internal-rectangle | Front | internal_wrong_rectangle | ContourQuad | 6 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| neutral-front | Front | neutral_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| neutral-back | Back | neutral_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-front | Front | black_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-back | Back | black_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-front | Front | white_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-back | Back | white_plate | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| same-tone-front | Front | same_tone_border | LineRecovery | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| same-tone-back | Back | same_tone_border | LineRecovery | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| foil-front | Front | foil_glare | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| foil-back | Back | foil_shadow | LineRecovery | 5 | True | False | True | False | 0 | n/a | NoBoundary | False | False | False | False | False |
| worn-front | Front | worn_corners | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| worn-back | Back | worn_corners | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-minus35 | Front | rotation_envelope | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-plus35 | Back | rotation_envelope | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| perspective-front | Front | perspective_translation | LineRecovery | 5 | True | False | True | False | 0 | n/a | NoBoundary | False | False | False | False | False |
| perspective-back | Back | perspective_translation | LineRecovery | 5 | True | False | True | False | 0 | n/a | NoBoundary | False | False | False | False | False |
| clipped-front | Front | clipped | LineRecovery | 5 | True | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| clipped-back | Back | clipped | LineRecovery | 5 | True | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| no-card | Front | no_card | LineRecovery | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| hands | Back | hands | LineRecovery | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| ruler | Front | ruler | LineRecovery | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| wrong-object | Back | wrong_object | LineRecovery | 5 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| frozen-source | Front | fresh_before_frozen | LineRecovery | 5 | True | True | True | False | 0 | n/a | UnsafeCoverage | False | False | False | False | False |
| frozen-repeat | Front | frozen_frame | LineRecovery | 5 | True | True | False | False | 0 | n/a | FrozenFrame | False | False | True | False | True |
| slow-drift | Front | slow_drift | LineRecovery | 6 | True | True | True | False | 0 | n/a | NoBoundary | False | False | False | False | False |
| sudden-motion | Back | sudden_motion | LineRecovery | 7 | True | True | True | True | 4 | 6 | None | False | False | False | False | True |
| epoch-transition | Front | epoch_transition | LineRecovery | 7 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | True | False | False | False |
| wrong-epoch | Back | wrong_epoch | LineRecovery | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| wrong-side | Back | wrong_side | LineRecovery | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| removal-replacement | Back | removal_replacement | LineRecovery | 8 | True | True | True | True | 4 | 7 | None | False | False | False | False | True |
| orientation-90cw | Front | sensor_orientation | LineRecovery | 5 | True | True | True | False | 0 | n/a | UnsupportedEdge | False | False | False | False | False |
| orientation-mirror | Back | sensor_orientation | LineRecovery | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| internal-rectangle | Front | internal_wrong_rectangle | LineRecovery | 6 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| neutral-front | Front | neutral_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| neutral-back | Back | neutral_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-front | Front | black_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| black-back | Back | black_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-front | Front | white_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| white-back | Back | white_plate | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| same-tone-front | Front | same_tone_border | Fused | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| same-tone-back | Back | same_tone_border | Fused | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| foil-front | Front | foil_glare | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| foil-back | Back | foil_shadow | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| worn-front | Front | worn_corners | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| worn-back | Back | worn_corners | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-minus35 | Front | rotation_envelope | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| rotation-plus35 | Back | rotation_envelope | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| perspective-front | Front | perspective_translation | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| perspective-back | Back | perspective_translation | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| clipped-front | Front | clipped | Fused | 5 | True | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| clipped-back | Back | clipped | Fused | 5 | True | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| no-card | Front | no_card | Fused | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| hands | Back | hands | Fused | 5 | False | False | False | False | 0 | n/a | NoBoundary | False | False | False | False | True |
| ruler | Front | ruler | Fused | 5 | False | True | False | False | 0 | n/a | UnsafeCoverage | False | False | False | False | True |
| wrong-object | Back | wrong_object | Fused | 5 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
| frozen-source | Front | fresh_before_frozen | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| frozen-repeat | Front | frozen_frame | Fused | 5 | True | True | False | False | 1 | n/a | FrozenFrame | False | False | True | False | True |
| slow-drift | Front | slow_drift | Fused | 6 | True | True | True | True | 6 | 3 | None | False | False | False | False | True |
| sudden-motion | Back | sudden_motion | Fused | 7 | True | True | True | True | 7 | 3 | None | True | False | False | False | True |
| epoch-transition | Front | epoch_transition | Fused | 7 | True | True | True | True | 7 | 3 | None | False | True | False | False | True |
| wrong-epoch | Back | wrong_epoch | Fused | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| wrong-side | Back | wrong_side | Fused | 6 | False | False | False | False | 0 | n/a | WrongEpoch | False | True | False | False | True |
| removal-replacement | Back | removal_replacement | Fused | 8 | True | True | True | True | 6 | 7 | None | False | False | False | False | True |
| orientation-90cw | Front | sensor_orientation | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| orientation-mirror | Back | sensor_orientation | Fused | 5 | True | True | True | True | 5 | 3 | None | False | False | False | False | True |
| internal-rectangle | Front | internal_wrong_rectangle | Fused | 6 | False | True | False | False | 0 | n/a | UnsupportedEdge | False | False | False | False | True |
