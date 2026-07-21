# Ten Kings AI Grader Mathematical Calibration V1

Status: implementation candidate; a finalized physical calibration bundle and independent Mac architecture/calibration review are required before any protected rollout.

## Purpose

Mathematical Calibration V1 grades a card from explicit physical measurements. It does not train against historical grades and does not use capture quality as card damage. Every calibrated final report contains Centering, Corners, Edges, Surface, and Overall scores from `1.00` through `10.00`, a one-decimal Label V1 grade, immutable evidence, exact measurement uncertainty, and a deduction ledger.

The only scoring and calibration-acceptance constant source is:

- `packages/shared/src/aiGraderMathematicalCalibrationV1.ts`
- threshold-set ID `ten-kings-mathematical-grading-v1.0.1`
- the finalized canonical threshold-set SHA-256 recorded in that module, every calibration bundle, and every V0.3 report

UI, report, storage, and publication code render or validate that authority. They do not define alternate scoring constants.

## V0 and V1 separation

Historical V0.1/V0.2 report reads remain supported. New V0 writes obey the strict `1.00..10.00` element/overall contract. Mathematical V1 uses report bundle `ai-grader-report-bundle-v0.3` and may not be projected into, or silently fall back to, a V0 grade.

V1 requires all four calibrated elements. Missing centering or any other element produces explicit insufficient evidence. V1 never redistributes a missing element's weight and never applies the historical missing-centering `9.0` cap.

## Evidence quality is not card condition

Focus, clipping, saturation, underexposure, common-mode/specular response, flat-field confidence, and usable-channel count determine whether pixels are valid evidence. They can exclude pixels, select another calibrated directional channel, lower evidence confidence, or require recapture. They cannot add points, deduct points, or be represented as physical damage.

The heatmap is a visualization derived from source evidence. It is never an independent grading input.

## Measurement uncertainty and Grade-10 meaning

Every physical measurement carries a versioned certified `U95` composed by root-sum-square propagation from the applicable sources:

- pixel/mm scale uncertainty;
- lens/distortion residual;
- normalization/registration residual;
- repeated-placement variation;
- segmentation-boundary uncertainty;
- repeated-measurement variation; and
- lighting/channel confidence.

The required calculations are:

```text
effectiveMeasurement = max(0, measuredMeasurement - U95)
grade10Buffer = max(U95, explicitGrade10Tolerance)
normalizedSeverity = clamp(effectiveMeasurement / referenceMeasurement, 0, 1)
deduction = maximumDefectDeduction * normalizedSeverity
```

The centralized manifest's deadband policy applies zero deduction while the measured value is within the Grade-10 buffer. A `10.00` means no condition defect was measured beyond certified resolution and the explicit published tolerance; it is not a claim of atomic perfection.

## Centering V1

Centering measures the normalized physical cut and intended printed design, never camera-frame placement.

For each axis:

```text
balanceRatio = 100 * min(marginA, marginB) / max(marginA, marginB)
sideScore = min(horizontalAxisScore, verticalAxisScore)
centeringScore = 0.70 * worst(frontScore, backScore)
               + 0.30 * average(frontScore, backScore)
```

The margin-difference U95/Grade-10 deadband is applied before the continuous manifest curve. The curve anchors are `95 -> 10`, `90 -> 9`, `85 -> 8`, `80 -> 7`, `75 -> 6`, `70 -> 5`, and continuous down to `1` below `70`.

Supported profiles:

- `printed_border_v1` robustly detects and fits many samples on the real printed frame. It retains the four line fits, contours, inliers, residuals, margins, U95, ratios, confidence, and overlay evidence. It does not invent design-relative color evidence when no approved design artifact exists.
- `registered_design_template_v1` requires one exact APPROVED controlled artifact keyed to tenant/set/program/card/variant/parallel/side. Artifact bytes, version, SHA-256, dimensions, intended contour, approval, source pixels, automatic correspondence ledger, locally computed transform/inliers/residual/confidence, and result hashes are bound into the report. Arbitrary internet imagery, image symmetry, and caller-authored transforms are prohibited.

If intended printed design cannot be established, centering is insufficient evidence. A normalized card filling the frame never earns an inferred `10`.

## Corners V1

All eight visible front/back corner observations are independently measured. Supported physical features include whitening/exposed fiber area, missing material, chip size, shape/radius deviation, deformation area, delamination length, and directional relief. Every location retains its exact ROI, segmentation/confidence/illumination masks, channel evidence, measurements, U95, and deduction.

After overlapping and front/back views of the same physical defect are deduplicated:

```text
cornerPenalty = 0.65 * worstLocationPenalty
              + 0.35 * averageLocationPenalty
cornerScore = clamp(10 - cornerPenalty, 1, 10)
```

## Edges V1

All eight front/back edge observations are independently measured. Supported physical features include damaged length, longest continuous span, chip/indentation depth, whitening/chipping area, roughness, fraying/fiber exposure, delamination/lift, and directional deformation.

After overlap merge and physical front/back deduplication:

```text
edgePenalty = 0.60 * worstLocationPenalty
            + 0.40 * averageLocationPenalty
edgeScore = clamp(10 - edgePenalty, 1, 10)
```

## Surface V1

The eight directional channels are dark-corrected and flat-field normalized. The processor derives per-pixel common-mode response, per-channel directional residuals, clipping, specular/calibrated-pattern, low-confidence, and insufficient-directional-observation masks.

Candidates are measured only on valid pixels and must satisfy the centralized coverage, corroboration, and channel thresholds. Alternate non-glare channels may recover a partly obscured finding. A smooth calibrated/common-mode reflection is retained as visible illumination evidence with zero condition deduction. A region obscured in every usable channel is ungradable and cannot receive a false `10`.

Supported surface classes are scratch, scuff, dent, crease, stain, print defect, foreign material/residue, alteration, and material loss. Overlapping candidates representing one physical defect are merged and assigned one primary grading category; secondary evidence remains linked without a second deduction.

```text
surfaceScore = clamp(10 - sum(unique physical-finding deductions), 1, 10)
```

Severe crease, dent, alteration, and material-loss caps are explicit members of the threshold manifest.

## Overall V1

```text
weightedGrade = 0.30 * Centering
              + 0.25 * Corners
              + 0.25 * Edges
              + 0.20 * Surface

overallGrade = clamp(
  min(weightedGrade, weakestElement + 0.50, applicableSevereDefectCaps),
  1.00,
  10.00
)
```

Internal and report scores round to two decimals with the manifest rounding policy. Label V1 renders the overall grade to one decimal. A finding is deducted once and only once.

## Immutable calibration authority

A finalized calibration is one hash-protected `ten-kings-mathematical-calibration-bundle-v1`. Its ordered 12-member ledger contains:

- finalized mathematical calibration profile;
- physical calibration artifact;
- acceptance record;
- eight ordered channel flat-field artifacts; and
- illumination-pattern/direction artifact.

The bundle binds the non-production capture package, exact rig/camera/profile/settings, printable target hash, ruler evidence, distortion/normalization models, scale, repeated placement/measurement, boundary uncertainty, channel response/direction, algorithms, threshold set, and every member byte. `isCalibrated=true` is emitted only by the finalizer after all centralized acceptance gates pass.

Database trust is a separate admin lifecycle. Publication requires one exact current TRUSTED CalibrationSnapshot whose complete bundle authority equals the report. Import, trust, revoke, and supersede reread the current private bundle/member bytes. A loose profile or structural self-attestation is insufficient.

## Finding review and publication

The grader derives candidate measurements, evidence confidence, and proposed deductions. Before a final package, the operator sees exact normalized geometry plus the immutable ROI, segmentation, confidence, illumination, true-view, and directional evidence. The operator supplies disposition and review time; the operator does not author measurement confidence or score math.

Rejected or unreviewed findings cannot enter a final V0.3 report. Confirmed/adjusted findings retain their evidence-derived measurement and confidence authority. The single existing human `Approve & Publish` action completes pending review first and then enters the existing protected publication flow.

Publication independently verifies:

- strict V0.3 schema and all four element formulas;
- exact finalized calibration bundle and current TRUSTED snapshot;
- exact APPROVED design-reference rows and current artifact bytes;
- complete immutable Publish authority, including calibration and condition observations;
- exact Mathematical V1 release schema and statuses;
- exact Label V1 identity, element scores, one-decimal grade, report/QR links; and
- the stored report artifact's canonical sealed body.

No publication gate authorizes physical label printing, inventory mutation, NFC access, deployment, migration, or merge.

## Public report contract

The existing True View, Surface Vision, heatmaps, directional replay, normalized front/back evidence, ROI crops, hashes, findings, Why Not 10, label, inventory, NFC, slab-photo, and comps linkages remain.

V1 adds all four mandatory scores, front/back/location subscores, centering geometry, measured finding ledger, `10.00` starting score, exact measured/U95/effective/reference/tolerance values, explicit curve and arithmetic, deductions, element and overall formulas/caps, calibration/threshold/algorithm identities, clickable finding evidence, and a separate evidence-quality limitation ledger with zero deductions.

## Honest limitations

- V1 is an explicit engineering policy, not a model trained on millions of third-party grades.
- Thresholds are versioned Ten Kings policy values and must be independently reviewed before rollout.
- Borderless/asymmetric cards remain insufficient until an exact approved controlled design reference exists.
- Unsupported material/optical modalities remain insufficient; the system does not infer residue, relief, or print intent from absent evidence.
- A physically accepted fixed-rig calibration is specific to its rig, protected settings, target, algorithms, threshold set, validity window, and bundle hash.
- Production rollout remains blocked until supervised physical calibration/test-card evidence, all validation, one reviewed PR, and independent Mac architecture/calibration review are complete.
