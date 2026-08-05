# Measurement Accuracy acceptance evidence — 2026-08-04

This directory freezes the recoverable, read-only evidence for the approved
Measurement Accuracy Addendum. It does not certify the Cubone `<5%` target.
Certification is blocked until Mark saves and visually approves the corrected
Front final traces; those exact bytes do not exist in the recovered evidence.

The exact published Cubone 5.3 Front Corner baseline is
`20.903165735568%` (`19.0825 mm²` weighted over `91.29 mm²`), not the frozen
addendum's narrative "approximately 35%." This is a runtime-evidence conflict,
not a change to the approved one-time `<5%` target. No Production row, report,
asset, label, learning bank, or grade was changed while collecting this evidence.

## What is frozen

[`manifest.json`](./manifest.json) records:

- the exact public Cubone 5.3 and unrelated Nick Bosa control identities,
  semantic snapshot hashes, defect-ledger hashes, grades, and prepared-asset
  hashes;
- the original Cubone phone-capture hashes and committed Q95 geometry-fixture
  hashes;
- lossless raster reconstructions of the three historical Cubone accepted
  contours named by the conditional-wedge contract, including raw binary-mask
  hashes, pixel counts, boxes, measurements, and provenance;
- lossless raster hashes and measurements for all six unrelated-control
  findings; and
- the reproduced Cubone Back OpenCV candidate-core result before and after
  boundary subtraction.

The historical contours are sufficient to reconstruct their old accepted masks
exactly at `1270 x 1778`. They are not reviewer-corrected traces, not Mark's
visual approval, and not outputs from a post-change pinned-model replay. The
rendered screenshot named in the manifest is likewise evidence for visual
orientation only; antialiasing makes it unsuitable as a binary trace source.

## Transport-size evidence

The previously discussed RLE body above `1 MiB` was **worst-case analysis
only**, not an observed real trace. The completed Cubone/control reports contain
historical contours rather than persisted RLE traces. Counterfactual canonical
RLE encoding of all `32` recoverable real published contours produced a largest
SAM-generated trace body of `1,437` bytes, a largest human Smart-Mark body of
`2,533` bytes, and `31,713` bytes total. Every reconstructed real mask had one
connected component, and none approached `1 MiB`.

The over-limit example is the valid but synthetic maximally alternating
`1270 x 1778` binary mask. `TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1` removes that
transport-size dependency without changing the persisted
`TK_SPEEDSTER_TRACE_RLE_V1` authority. There is no real speckle evidence to
diagnose or repair in this inventory, so no mask-generation or speckle behavior
was changed.

## Honest acceptance state

The unchanged corner denominator is `9,129` canonical pixels = `91.29 mm²`.
The strict `<5%` target requires total Front Corner weighted area `<4.5645 mm²`.
If the `1.4375 mm²` faint sliver remains unchanged, it contributes
`0.71875 mm²` after its `0.5` multiplier. A corrected large chipping trace at
the unchanged `1.5` multiplier must therefore have raw area
`<2.563833333333333 mm²`. This is a bound, not evidence that the target passes.

The smallest missing release artifact is the exact saved, canonical Front final
trace for the large chipping finding plus its hash and Mark's visual approval.
The small sliver's saved trace and approval are also required if it changes.
Only then can the unchanged measurement and grade math produce an honest
before/after acceptance result.

## Conditional wedge decision

The decision is **not runnable from the historical masks alone**. Those masks
are valid immutable inputs, but they predate boundary subtraction and do not say
whether the large Front Memory proposal, the small Front Memory sliver, or the
large Back detector proposal passes the final post-change acceptance path.

The Back OpenCV fixture does prove a narrower result: boundary subtraction moves
the strongest top-right core from an `83 x 73` (`6,059`-box-pixel) top-eight
candidate to a `10 x 4` (`40`-box-pixel, `22` foreground-pixel) residual ranked
`142` zero-based (`143rd` ordinal), outside the ordinary top eight, while
retaining rim intersection. It
does not invoke SAM and cannot certify the Memory-generated Front findings.

To make the conditional decision, preserve the exact post-change mask bytes and
accept/reject results for all three findings from a replay bound to SAM 3 commit
`96914d2425f90a64f45ca977c2b5165418099543`, the manifest's prepared assets,
and the exact bank/policy preimage. Until those bytes exist, no boundary distance
or wedge threshold is defensible and none is asserted here.

## Read-only validation commands

Run from the repository root. These commands do not contact or mutate
Production:

```sh
jq -e '.schemaVersion == "TEN_KINGS_MEASUREMENT_ACCURACY_ACCEPTANCE_EVIDENCE_V1" and .productionWrites == 0 and .measurementAcceptance.status == "NOT_CERTIFIED" and .conditionalWedgeDecision.decisionRunnableFromHistoricalMasksAlone == false' \
  backend/ai-grader-speedster-service/test-fixtures/acceptance/measurement-accuracy-20260804/manifest.json

shasum -a 256 \
  backend/ai-grader-speedster-service/test-fixtures/geometry/cubone-front.jpg \
  backend/ai-grader-speedster-service/test-fixtures/geometry/cubone-back.jpg

python3 -m json.tool \
  backend/ai-grader-speedster-service/test-fixtures/acceptance/measurement-accuracy-20260804/manifest.json \
  >/dev/null

cd backend/ai-grader-speedster-service
# Use the pinned service test environment from requirements.txt; the macOS
# system Python does not include OpenCV.
python3 -m unittest \
  test_app.SpeedsterGeometryTest.test_cubone_back_corner_residual_is_rim_scale_after_boundary_subtraction \
  test_app.SpeedsterGeometryTest.test_non_boundary_aligned_chip_at_the_rim_survives_subtraction
```

The last command validates only the local OpenCV boundary-subtraction contract.
It is not the missing pinned SAM/Memory replay and it is not Cubone `<5%`
certification.

Public report verification, if deliberately repeated, must remain GET-only:

```sh
curl --fail --silent --show-error --location --request GET \
  https://collect.tenkings.co/ai-grader-v2/reports/speedster-cmsf6xyr600009uceq8pvjlzz \
  --output /tmp/ten-kings-cubone-report.html

curl --fail --silent --show-error --location --request GET \
  https://collect.tenkings.co/ai-grader-v2/reports/speedster-cmsasqis10000117qzol1ly3a \
  --output /tmp/ten-kings-control-report.html
```

Those GETs establish reachability only. Reproducing the semantic hashes requires
the canonicalization recorded in the manifest; signed-URL query strings must
not enter the hash preimage.
