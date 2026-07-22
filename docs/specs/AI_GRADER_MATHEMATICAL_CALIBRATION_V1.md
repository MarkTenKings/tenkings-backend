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

Every physical measurement carries a versioned `U95` authority composed by root-sum-square propagation from the applicable sources:

- pixel/mm scale uncertainty;
- lens/distortion residual;
- normalization/registration residual;
- repeated-placement variation;
- segmentation-boundary uncertainty;
- repeated-measurement variation; and
- lighting/channel confidence.

One-time rig-characterization target authority uses `product_owner_confirmed_exact_target_geometry_v1`, derived automatically from the active session's exact protected target version/SHA-256 and immutable captured target bytes. Its four records are explicitly protected nominal checkerboard geometry, never physical measurements. The 24 physical-direction records and their U95 values are derived deterministically from the exact three-per-channel immutable illumination captures and the ten-capture checkerboard repeatability evidence under the centralized uncertainty coverage factor. The operator contract has no measuring-device, certificate, coordinate, or U95 questions. No scoring formula, centralized threshold, capture count, or grading/subgrading algorithm changes.

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

### Standard Pokémon corner authority

`pokemon_tcg_standard` version `1.0.0` is the single Mark/Ten Kings owner-approved Production operational contour for trusted standard-size Pokémon TCG identities. Its canonical UTF-8 artifact binds 63.50 mm x 88.90 mm physical dimensions, a circular 3.18 mm corner radius, the exact contour generator, applicable standard variants, the Mathematical threshold-set ID/hash, provenance, and canonical profile SHA-256. It covers standard-size Japanese, international, Wizards-era, vintage, modern, foil, and promo cards. It explicitly excludes jumbo, oversize, nonstandard, unresolved, contradictory, or untrusted formats.

The hosted resolver signs the immutable set-card/taxonomy source identity and its trusted physical-format claim. The browser supplies only the exact lookup and centering choice; it cannot supply the profile, signature, contour, tolerance, or measurements. The local bridge verifies the resolver HMAC and exact card identity before the station adapter can select the profile. The report builder separately signs the analyzer-created eight-corner measurement artifact, and publication verifies both authentications again. A replayed valid card identity therefore cannot authorize caller-created measurements. There is no nearest-profile fallback.

Each front/back top-left, top-right, bottom-right, and bottom-left observation reports the analyzer-created contour deviation, calibrated U95, threshold decision, deduction, source image/contour hashes, calibration bundle, profile authority, and analyzer versions. Contour deviation remains distinct from whitening, chipping/material loss, deformation, delamination, and other visible damage. This profile is a Ten Kings operational grading standard, not an official Pokémon manufacturer specification.

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

The bundle binds the non-production capture package, exact rig/camera/profile/settings, printable target hash, protected target-geometry and physical-direction evidence, distortion/normalization models, scale, repeated placement/measurement, boundary uncertainty, channel response/direction, algorithms, threshold set, and every member byte. `isCalibrated=true` is emitted only by the finalizer after all centralized acceptance gates pass.

### Fast calibration V1.2 authority composition

Fast calibration contract '1.2.0' is a distinct Production-compatible producer contract. It is not the incomplete V1.1 profile contract and it does not convert, relabel, or fall back to V0, V1.1, a provisional artifact, or an older profile.

V1.2 separates two hash-bound authority layers:

- one-time rig characterization: target metrology with exact product-owner-confirmed protected-target authority, camera/lens identity and authority, physical light directions, component identities and channel wiring, measurement repeatability, protected algorithms, and the centralized threshold manifest; and
- quick site/lighting calibration: exact location and lighting configuration, live camera/controller settings and identities, four capture-time checkerboard placements, one blank-reverse flip, geometry verification, dark response, eight per-channel flat fields, and illumination response.

The quick capture contract is exactly '4' checkerboard images plus '72' automated photometric images ('24' dark, '24' flat-field, and '24' illumination-pattern), for '76' images and '0' new quick physical measurements. Physical metrology, direction, and repeatability evidence are inherited only through the exact immutable rig-characterization hashes; they are never fabricated or inferred from the quick images.

The V1.2 state is an append-only event chain. Every accepted image is checkpointed and hashed immediately. A failed operation retains its immutable operation ID and leaves only its exact slot pending. Retry uses a new operation ID. Explicit accepted-pose replacement preserves the superseded evidence and lineage. Pose four cannot be accepted unless the active four-pose set satisfies unchanged minimum coverage, safe-margin, X span, Y span, rotation span, residual, and U95 gates.

Analysis retains the centralized Mathematical V1/V1.0.1 acceptance thresholds. Successful finalization emits the same complete Production 'ten-kings-mathematical-calibration-bundle-v1' outer schema and exact ordered 12-member ledger, with additional exact '1.2.0' capture-contract, runtime-context, and rig-characterization authority hashes. The canonical loader requires the exact V1.2 source contract and, at the local Start New Card boundary, the exact live camera, rig, controller, wiring, settings, target, component, algorithm, location, and lighting context.

V1.2 authority is reconstructable rather than self-attested. Session creation and every resume reread and hash-verify an exact canonical five-member one-time rig source. The trusted local analyzer reruns the checkerboard detector against each exact active checkpoint and requires the rederived pose to equal the accepted event geometry. It applies the immutable Brown-Conrady model, fits the target homography from a deterministic training partition of the 11-by-16 internal lattice, and records actual held-out undistorted reprojection residuals. A separately detected target outer contour is fit against the extrapolated target boundary and produces the independently named outer-boundary residual vector; one statistic is never copied into both authority classes.

Photometric analysis decodes exact unnormalized Mono8 evidence, rejects color-converted samples, uses the accepted pose-four lens/homography authority to isolate and warp only the blank target ROI, masks all background/fixture pixels, and reduces that normalized-card coordinate frame to fixed 8-by-8 grids. Dark subtraction, relative response, response scale, directional centroids/errors, residual patterns, and artifact bytes are computed locally. Physical light vectors first use the immutable stage-to-undistorted-sensor transform and then the inverse homography Jacobian into the same normalized-card coordinates before angular comparison. The public analysis mutation accepts no builder values, artifact bytes, acceptance booleans, or hashes.

Completed analysis is not trusted merely because its serialization and ledger hashes are valid. Every session reopen reruns the same evidence analyzer from the checkpointed image bytes and requires byte-for-byte equality with the stored deterministic analysis before canonical finalization/member verification can pass. The camera/lens normalization transform remains one-time authority, while its current-site sample residual vector is evidence-derived quick geometry and is hash-bound in the quick authority layer.
The geometry/photometric identity is content-addressed from the complete shipped V1.2 executable module-byte set, exact checkerboard detector bytes, reviewed pinned Python/OpenCV dependency-manifest bytes, and exact Node/Sharp/libvips runtime versions. It does not rely on a selected function list. Protected runtime and component-identity authority must bind those manifest hashes. Any top-level or transitive implementation-byte or dependency drift therefore fails before session authority can be created or resumed.
The Production finalizer identity is independently content-addressed from the complete shipped finalization executable/module and dependency-byte ledger plus its exact runtime dependency version. Runtime context and component authority must bind that exact finalizer hash alongside geometry, photometric, and threshold hashes; transitive finalizer drift invalidates previously materialized authority rather than silently reusing it.

One-time V1.2 rig authority is created only by the protected local operator materializer from exact supervised raw-capture, metrology, protected target, lens, stage-transform, component, controller, and wiring evidence. The materializer requires each protected-target geometry authority to match the source capture's exact target version/SHA-256 and exact captured target bytes; it asks for and consumes no measuring-device or calibration-certificate authority for that path. It verifies all source hashes, reruns the existing physical acceptance calculation, and atomically emits canonical runtime context, five ordered authority members, their rig-source bundle, a complete copied source-evidence ledger, a reproducible physical-analysis receipt, and a redacted hash-only handoff. The Production loader reopens every emitted file, checks the shipped analyzer/dependency/finalizer identities, reconstructs all source links and physical acceptance, and rejects missing, extra, partial, duplicate, relabelled, corrupt, changed, old-profile, or synthetic-fixture inputs. Identical restaging is idempotent by exact rig-source bundle hash; conflicting bytes fail closed. This operator-only path has no browser route and performs no activation, import, trust, or hosted mutation.

The authoritative local helper route family is '/calibration/mathematical-v1.2': read-only 'GET /sessions' and 'GET /status'; 'POST /start'; server-owned expected-step 'POST /capture' and 'POST /retry'; acknowledged 'POST /replace-pose'; and exact 'POST /analyze' and 'POST /finalize'. Mutations use a server-issued revision token. The browser cannot supply operation/role/channel/sample identity, runtime or rig authority, acceptance booleans, analysis/bundle bytes, or trusted hashes. There is no activation mutation in this route family.


The real 'ai-grader-station-bridge' CLI constructs this authority from seven all-or-none protected local settings: exact runtime-context path/hash, exact rig-source bundle path/hash, exact five-member directory, exact Agent 4 finalizer-staging root, and operator ID. Partial, absent, relative-path, corrupt, algorithm-mismatched, rig-mismatched, or live-context-mismatched authority fails closed. Construction is inert and exposes no protected paths through the route DTOs. Start/resume performs an exact live Basler/Leimac identity/settings probe; capture owns exact-still acquisition; and the automated sweep uses one long-lived PowerShell process with one opened Pylon camera and one opened Leimac TCP session, exact per-command ACK validation, safe-off before/after each frame, and final safe-off/close. Close success is not returned until the child exits and releases resources; probe/open/request timeout, malformed output, or unexpected exit performs bounded termination before rejection.
The public driver barrel does not export the raw V1.2 analysis/finalizer builder seam. Production callers receive authority only through the durable local session and its canonical finalized result.
Successful local finalization atomically stages '<protected-root>/<bundleManifestSha256>/' with the exact bundle manifest, all twelve hash-verified members, and the exact nine-key 'mathematical-calibration-finalizer-handoff-v1.json' consumed by Agent 4. Repeated staging of the same exact bundle is idempotent; any conflicting, extra, missing, or corrupt byte fails closed. The browser supplies neither the staging root nor any path, and staging does not activate or mutate hosted state.
Core completion is only 'ready_for_explicit_activation'. It means the exact local bundle is eligible for the separate Agent 4 activation transaction; it does not mean active. The core's Start New Card assertion always fails until that explicit activation receipt exists. The activation boundary must then require the exact live camera, rig, controller, wiring, settings, target, component, algorithm, location, and lighting context.

The under-ten-minute target is a Dell physical acceptance objective only. Repository tests establish deterministic behavior and contract integrity; they do not establish physical capture time, controller latency, image-transfer latency, checkerboard handling time, analyzer time on Dell, thermal stability, or repeatability.

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
