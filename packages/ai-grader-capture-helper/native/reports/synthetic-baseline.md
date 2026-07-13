# Native four-edge offline replay

- Detector: `native_four_edge_v1`
- Corpus: `synthetic`
- Seed: `20260712`
- Evaluations: `96`

> Synthetic/adversarial results are engineering regression evidence only; they are not production accuracy or Dell hardware performance claims.

| Comparator | Recall | Precision | False detector positive | False Ready | P50 detect | P95 detect | Mean corner error |
|---|---:|---:|---:|---:|---:|---:|---:|
| PcaBaseline | 26.3% | 83.3% | 1 | 0 | 6.23 ms | 12.08 ms | 37.91 px |
| ContourQuad | 84.2% | 94.1% | 1 | 0 | 5.43 ms | 10.44 ms | 24.10 px |
| LineRecovery | 94.7% | 100.0% | 0 | 0 | 8.29 ms | 16.35 ms | 28.31 px |
| Fused | 94.7% | 94.7% | 1 | 0 | 9.93 ms | 16.50 ms | 18.33 px |

## Missing real-corpus coverage

- Approved blinded Dell Basler Mono8 front/back corpus
- Real black, white, and neutral production plates under accepted Leimac profiles
- Real same-tone borders, foil, glare, shadow, and worn-corner prevalence
- Human-approved no-card, hand, ruler, and wrong-object negatives
- Measured front/back recall gap and zero-false-Ready negative set
- Dell CPU-load, BlockID, hardware timestamp, and overlay-age timing

## Case results

| Case | Side | Category | Comparator | Card present | Expected detection | Status | Reason | Confidence | Safe outcome |
|---|---|---|---|---:|---:|---|---|---:|---:|
| neutral-front | Front | neutral_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.590 | False |
| neutral-back | Back | neutral_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.530 | False |
| black-front | Front | black_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.534 | False |
| black-back | Back | black_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.529 | False |
| white-front | Front | white_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.615 | False |
| white-back | Back | white_plate | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.613 | False |
| same-tone-front | Front | same_tone_border | PcaBaseline | True | True | NotDetected | NoBoundary | 0.000 | False |
| same-tone-back | Back | same_tone_border | PcaBaseline | True | True | NotDetected | NoBoundary | 0.000 | False |
| foil-front | Front | foil_glare | PcaBaseline | True | True | AdjustCard | WarmingUp | 0.756 | True |
| foil-back | Back | foil_shadow | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.546 | False |
| worn-front | Front | worn_corners | PcaBaseline | True | True | AdjustCard | WarmingUp | 0.780 | True |
| worn-back | Back | worn_corners | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.525 | False |
| rotation-minus35 | Front | rotation_envelope | PcaBaseline | True | True | AdjustCard | WarmingUp | 0.893 | True |
| rotation-plus35 | Back | rotation_envelope | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.533 | False |
| perspective-front | Front | perspective_translation | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.606 | False |
| perspective-back | Back | perspective_translation | PcaBaseline | True | True | NotDetected | NoGradientSupport | 0.504 | False |
| clipped-front | Front | clipped | PcaBaseline | True | True | AdjustCard | ClippedBoundary | 0.401 | True |
| clipped-back | Back | clipped | PcaBaseline | True | True | NotDetected | NoBoundary | 0.000 | True |
| no-card | Front | no_card | PcaBaseline | False | False | NotDetected | NoBoundary | 0.000 | True |
| hands | Back | hands | PcaBaseline | False | False | NotDetected | NoBoundary | 0.000 | True |
| ruler | Front | ruler | PcaBaseline | False | False | AdjustCard | UnsafeCoverage | 0.395 | False |
| wrong-object | Back | wrong_object | PcaBaseline | False | False | NotDetected | NoGradientSupport | 0.458 | True |
| frozen-source | Front | fresh_before_frozen | PcaBaseline | True | True | AdjustCard | WarmingUp | 0.934 | True |
| frozen-repeat | Front | frozen_frame | PcaBaseline | True | False | NotDetected | FrozenFrame | 0.000 | True |
| neutral-front | Front | neutral_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.944 | True |
| neutral-back | Back | neutral_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.792 | True |
| black-front | Front | black_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.805 | True |
| black-back | Back | black_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.786 | True |
| white-front | Front | white_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.929 | True |
| white-back | Back | white_plate | ContourQuad | True | True | AdjustCard | WarmingUp | 0.929 | True |
| same-tone-front | Front | same_tone_border | ContourQuad | True | True | NotDetected | NoBoundary | 0.000 | False |
| same-tone-back | Back | same_tone_border | ContourQuad | True | True | NotDetected | NoBoundary | 0.000 | False |
| foil-front | Front | foil_glare | ContourQuad | True | True | AdjustCard | WarmingUp | 0.900 | True |
| foil-back | Back | foil_shadow | ContourQuad | True | True | AdjustCard | WarmingUp | 0.766 | True |
| worn-front | Front | worn_corners | ContourQuad | True | True | AdjustCard | WarmingUp | 0.800 | True |
| worn-back | Back | worn_corners | ContourQuad | True | True | AdjustCard | WarmingUp | 0.875 | True |
| rotation-minus35 | Front | rotation_envelope | ContourQuad | True | True | AdjustCard | WarmingUp | 0.950 | True |
| rotation-plus35 | Back | rotation_envelope | ContourQuad | True | True | AdjustCard | WarmingUp | 0.853 | True |
| perspective-front | Front | perspective_translation | ContourQuad | True | True | AdjustCard | WarmingUp | 0.852 | True |
| perspective-back | Back | perspective_translation | ContourQuad | True | True | AdjustCard | WarmingUp | 0.759 | True |
| clipped-front | Front | clipped | ContourQuad | True | True | AdjustCard | ClippedBoundary | 0.416 | True |
| clipped-back | Back | clipped | ContourQuad | True | True | NotDetected | NoBoundary | 0.000 | True |
| no-card | Front | no_card | ContourQuad | False | False | NotDetected | NoBoundary | 0.000 | True |
| hands | Back | hands | ContourQuad | False | False | NotDetected | NoBoundary | 0.000 | True |
| ruler | Front | ruler | ContourQuad | False | False | AdjustCard | UnsafeCoverage | 0.655 | False |
| wrong-object | Back | wrong_object | ContourQuad | False | False | NotDetected | NoBoundary | 0.000 | True |
| frozen-source | Front | fresh_before_frozen | ContourQuad | True | True | AdjustCard | WarmingUp | 0.949 | True |
| frozen-repeat | Front | frozen_frame | ContourQuad | True | False | NotDetected | FrozenFrame | 0.000 | True |
| neutral-front | Front | neutral_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.945 | True |
| neutral-back | Back | neutral_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.809 | True |
| black-front | Front | black_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.831 | True |
| black-back | Back | black_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.857 | True |
| white-front | Front | white_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.924 | True |
| white-back | Back | white_plate | LineRecovery | True | True | AdjustCard | WarmingUp | 0.699 | True |
| same-tone-front | Front | same_tone_border | LineRecovery | True | True | NotDetected | NoBoundary | 0.000 | False |
| same-tone-back | Back | same_tone_border | LineRecovery | True | True | AdjustCard | UnsafeCoverage | 0.618 | True |
| foil-front | Front | foil_glare | LineRecovery | True | True | AdjustCard | UnsafeCoverage | 0.698 | True |
| foil-back | Back | foil_shadow | LineRecovery | True | True | AdjustCard | UnsafeAspect | 0.564 | True |
| worn-front | Front | worn_corners | LineRecovery | True | True | AdjustCard | WarmingUp | 0.887 | True |
| worn-back | Back | worn_corners | LineRecovery | True | True | AdjustCard | WarmingUp | 0.890 | True |
| rotation-minus35 | Front | rotation_envelope | LineRecovery | True | True | AdjustCard | WarmingUp | 0.939 | True |
| rotation-plus35 | Back | rotation_envelope | LineRecovery | True | True | AdjustCard | WarmingUp | 0.948 | True |
| perspective-front | Front | perspective_translation | LineRecovery | True | True | AdjustCard | WarmingUp | 0.780 | True |
| perspective-back | Back | perspective_translation | LineRecovery | True | True | AdjustCard | WarmingUp | 0.700 | True |
| clipped-front | Front | clipped | LineRecovery | True | True | AdjustCard | UnsafeCoverage | 0.630 | True |
| clipped-back | Back | clipped | LineRecovery | True | True | AdjustCard | UnsafeCoverage | 0.592 | True |
| no-card | Front | no_card | LineRecovery | False | False | NotDetected | NoBoundary | 0.000 | True |
| hands | Back | hands | LineRecovery | False | False | NotDetected | NoBoundary | 0.000 | True |
| ruler | Front | ruler | LineRecovery | False | False | NotDetected | NoBoundary | 0.000 | True |
| wrong-object | Back | wrong_object | LineRecovery | False | False | NotDetected | NoBoundary | 0.000 | True |
| frozen-source | Front | fresh_before_frozen | LineRecovery | True | True | AdjustCard | WarmingUp | 0.831 | True |
| frozen-repeat | Front | frozen_frame | LineRecovery | True | False | NotDetected | FrozenFrame | 0.000 | True |
| neutral-front | Front | neutral_plate | Fused | True | True | AdjustCard | WarmingUp | 0.945 | True |
| neutral-back | Back | neutral_plate | Fused | True | True | AdjustCard | WarmingUp | 0.809 | True |
| black-front | Front | black_plate | Fused | True | True | AdjustCard | WarmingUp | 0.831 | True |
| black-back | Back | black_plate | Fused | True | True | AdjustCard | WarmingUp | 0.857 | True |
| white-front | Front | white_plate | Fused | True | True | AdjustCard | WarmingUp | 0.929 | True |
| white-back | Back | white_plate | Fused | True | True | AdjustCard | WarmingUp | 0.929 | True |
| same-tone-front | Front | same_tone_border | Fused | True | True | NotDetected | NoBoundary | 0.000 | False |
| same-tone-back | Back | same_tone_border | Fused | True | True | AdjustCard | UnsafeCoverage | 0.618 | True |
| foil-front | Front | foil_glare | Fused | True | True | AdjustCard | WarmingUp | 0.900 | True |
| foil-back | Back | foil_shadow | Fused | True | True | AdjustCard | WarmingUp | 0.766 | True |
| worn-front | Front | worn_corners | Fused | True | True | AdjustCard | WarmingUp | 0.887 | True |
| worn-back | Back | worn_corners | Fused | True | True | AdjustCard | WarmingUp | 0.890 | True |
| rotation-minus35 | Front | rotation_envelope | Fused | True | True | AdjustCard | WarmingUp | 0.950 | True |
| rotation-plus35 | Back | rotation_envelope | Fused | True | True | AdjustCard | WarmingUp | 0.948 | True |
| perspective-front | Front | perspective_translation | Fused | True | True | AdjustCard | WarmingUp | 0.852 | True |
| perspective-back | Back | perspective_translation | Fused | True | True | AdjustCard | WarmingUp | 0.759 | True |
| clipped-front | Front | clipped | Fused | True | True | AdjustCard | UnsafeCoverage | 0.630 | True |
| clipped-back | Back | clipped | Fused | True | True | AdjustCard | UnsafeCoverage | 0.592 | True |
| no-card | Front | no_card | Fused | False | False | NotDetected | NoBoundary | 0.000 | True |
| hands | Back | hands | Fused | False | False | NotDetected | NoBoundary | 0.000 | True |
| ruler | Front | ruler | Fused | False | False | AdjustCard | UnsafeCoverage | 0.655 | False |
| wrong-object | Back | wrong_object | Fused | False | False | NotDetected | NoGradientSupport | 0.458 | True |
| frozen-source | Front | fresh_before_frozen | Fused | True | True | AdjustCard | WarmingUp | 0.949 | True |
| frozen-repeat | Front | frozen_frame | Fused | True | False | NotDetected | FrozenFrame | 0.000 | True |
