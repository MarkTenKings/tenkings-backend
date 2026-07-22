# AI Grader Mathematical Calibration V1 Runbook

last_verified_at: 2026-07-21
owner: Mark
status: supervised non-production calibration only; no protected rollout authority

## Purpose and hard boundary

This runbook creates one physically measured, immutable Mathematical Calibration V1 bundle for the fixed Basler/Leimac rig. It is not a Production deployment, database import, trust action, report publication, label print, inventory operation, or NFC workflow.

The executable acceptance and scoring authority is `packages/shared/src/aiGraderMathematicalCalibrationV1.ts`. The operator launcher is `scripts/ai-grader/run-mathematical-calibration-capture-v1.ps1`. A session is calibrated only when the analyzer and finalizer produce a complete accepted 12-member bundle. Never edit a result, submit placeholder metrology, or set `isCalibrated=true` manually.

Use one exact reviewed checkout pinned to the intended source commit. Do not install it over the Dell helper, change the Scheduled Task, rotate or print a station token, or persist new driver/firmware/controller settings. If another process already owns the camera or the requested loopback port, stop and obtain direction rather than changing the installed helper.

## V1.1 compatibility stop and V1.2 software candidate

The four-pose/one-flip V1.1 profile prototype remains **not** a Production activation path:

- V1.1 seals '76' captures and '48' measurements, but its finalizer emits only 'ten-kings-mathematical-calibration-profile-v1.1'.
- Production accepts the pinned V1.0.1 authority and the complete outer bundle plus its exact 12 members. The current V1.1 finalizer does not create the physical artifact, acceptance artifact, eight flat-field artifacts, illumination-pattern artifact, or outer bundle.
- 'open-mathematical-calibration-v1-1.ps1' only opens the protected preview page. It is not an end-to-end operator runner.
- A per-pose Distinct indicator does not prove the final aggregate X/Y/rotation diversity gates.

The hardware-free V1.2 core is a separate contract, not a reinterpretation of V1.1. Its quick session is exactly four capture-time checkerboard placements, one explicit blank-reverse flip, and 72 automated photometric images: 24 dark, 24 flat-field, and 24 illumination-pattern. That is 76 images and zero new quick physical measurements. It consumes one exact immutable rig-characterization authority for target metrology, camera/lens, physical directions, component identities, and repeatability.

V1.2 persists an append-only event/hash chain, retains successful poses across failures and restart, permits explicit lineage-preserving pose supersession, resumes a persistent camera/controller batch at the first missing frame, enforces exact safe-off/controller acknowledgement, and produces the complete Production outer bundle and ordered 12-member ledger. The canonical loader accepts V1.2 only when its exact source, threshold, runtime-context, and rig-characterization contracts verify. Local Start New Card remains blocked if exact live context is absent or differs.

The frozen local-helper contract is:

- 'GET /calibration/mathematical-v1.2/sessions' and 'GET /calibration/mathematical-v1.2/status?sessionId=...';
- 'POST /calibration/mathematical-v1.2/start';
- 'POST /calibration/mathematical-v1.2/capture' and '/retry', each meaning execute only the current server-owned expected step;
- 'POST /calibration/mathematical-v1.2/replace-pose' with an accepted slot and the exact history-preservation acknowledgement; and
- 'POST /calibration/mathematical-v1.2/analyze' and '/finalize'.

Use the server-issued revision token for every resume or mutation. Never supply a browser operation ID, role/slot/channel/sample, runtime context, rig authority, acceptance boolean, analysis bytes, bundle bytes, or trusted hash. The route family has no activation endpoint. Successful finalization stops at 'ready_for_explicit_activation'; Start New Card remains hard-blocked until the separate Agent 4 activation receipt and exact live-context check succeed.

Session creation/resume rereads the exact five-member rig source. The local 'analyze' action has no result payload: it rereads the four active checkerboard bytes and all 72 active photometric bytes, reruns exact-still geometry, and locally derives every quick numeric result and artifact. Geometry applies the immutable Brown-Conrady lens model, fits a deterministic target homography, records true held-out reprojection residuals, and separately fits the independently segmented outer boundary. Photometry rejects color-converted evidence, samples only the undistorted and pose-four-warped blank-target ROI into normalized-card 8-by-8 grids, and excludes the fixture/background. Physical directions are transformed through the immutable stage-to-sensor mapping and the current inverse homography Jacobian before angular comparison. A valid source hash attached to a browser-authored number is never accepted as measurement authority. Reopening a completed session reruns the same byte-derived analysis and requires the exact stored analysis bytes/hashes before the outer bundle and all 12 members are canonical-loader verified.

The installed 'ai-grader-station-bridge' CLI now has one inert Production construction path. Configure all seven values together or none; partial configuration is a hard error:

- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_PATH';
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SHA256';
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_PATH';
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_SHA256';
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_MEMBER_DIR';
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_FINALIZER_STAGING_ROOT'; and
- 'AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_OPERATOR_ID'.

The exact canonical runtime file must bind the complete shipped executable-module-byte geometry, photometric, and finalizer manifests. The rig source must contain the exact five ordered member bytes, including the controller unit-information identity, channel wiring, stage-to-undistorted-sensor transform, target/lens authority, and algorithm hashes. The helper reads these files locally; routes never return their paths. Construction and read-only list/status do not open hardware. Start/resume probes live camera/controller context. Checkerboard capture and the 72-frame sweep open only through the serialized Basler/Leimac seam; the sweep keeps one camera and controller connection open, validates protocol-recognized ACKs, and safe-offs before/after every frame plus final close. Successful close waits for actual child exit/resource release; all protocol timeouts and malformed/unexpected output paths perform bounded cleanup before returning failure.

### Protected one-time V1.2 rig-authority materialization

Do this once on the protected Dell acceptance path before any 76-image quick V1.2 session. It is a one-time physical characterization, not a quick calibration, profile conversion, browser action, activation, or hosted mutation.

1. Complete the supervised V1.0.1 physical procedure below and retain its exact canonical capture manifest, source package, 102 raw captures, 102 normalized derivatives, 78 measurement artifacts, and target artifact. The materializer consumes those raw bytes and reruns the checked-in physical analyzer; it never consumes acceptance from a V1.0.1/V1.1 profile.
2. Record one canonical protected-live-probe evidence file from the existing protected `mathematical-calibration-context` result after it has closed the Basler/Leimac probe. Bind its exact observed camera serial/model, exposure, gain, pixel format/resolution, controller unit-information identity/unit and ACK response kinds. Add the supervised station ID, rig ID, duty, location label, and lighting-configuration ID; every observable value must equal the raw-capture ledger.
3. Record canonical supervised component and stage-transform evidence. Component evidence binds operator, rig, controller identity, component configuration, exact channels 1-8/controller outputs/component IDs/physical-direction IDs, target identity, lens-authority evidence hash, and wiring-evidence hash. Stage evidence binds operator, rig, camera/lens identity, the measured non-singular stage-to-undistorted-sensor matrix, and at least three exact stage-measurement hashes.
4. Place exact external evidence bytes beside the input manifest for every required role: `instrument_calibration`, `metrology_source`, `lens_authority`, `component_wiring`, and `stage_transform_measurement`. Every hash named by a measurement/component/stage artifact must dereference one of these exact files. No duplicate bytes, duplicate paths, unused reference, extra source-package artifact, or missing reference is permitted.
5. Write canonical `ten-kings-mathematical-calibration-v1.2-rig-materialization-input-v1` JSON with exactly `schemaVersion`, `captureManifest`, `liveProbe`, `componentEvidence`, `stageTransformEvidence`, and `referencedEvidence`. Each file reference has only `fileName` and lowercase `sha256`; each referenced-evidence entry has only `role`, `fileName`, and lowercase `sha256`. All names are safe paths relative to the input manifest directory. Compute the exact canonical input-manifest SHA-256.
6. From the exact built/reviewed helper checkout, invoke only the protected operator CLI:

   ```powershell
   tk-ai-grader-materialize-mathematical-calibration-v1-2-rig-authority `
     --input-manifest '<absolute-protected-input-root>\rig-materialization-input-v1.json' `
     --input-manifest-sha256 '<exact-lowercase-sha256>' `
     --acceptance-root '<absolute-protected-write-once-acceptance-root>' `
     --confirm 'MATERIALIZE MATHEMATICAL CALIBRATION V1.2 RIG AUTHORITY'
   ```

7. The command reruns physical acceptance and atomically creates exactly one `<acceptance-root>/<rigSourceBundleSha256>/` directory. It contains canonical `mathematical-calibration-runtime-context-v1.2.json`; `target-metrology-authority-v1.json`; `camera-lens-authority-v1.json`; `physical-light-directions-authority-v1.json`; `component-identities-authority-v1.json`; `repeatability-authority-v1.json`; `rig-characterization-source-v1.2.json`; `rig-characterization-source-evidence-v1.json`; `rig-characterization-physical-analysis-v1.json`; `rig-characterization-materializer-handoff-v1.json`; and the exact `source-evidence/` byte ledger. The redacted CLI/handoff output contains hashes and the bundle-directory name, never a token or absolute path. Same exact evidence is idempotent; partial or conflicting destination bytes fail closed.
8. Set the seven protected helper values above from the runtime/bundle hashes and the single materialized directory, independently reopen it through the Production loader, and preserve the handoff hashes. Only after that one-time authority is accepted may the separate quick V1.2 flow collect exactly four checkerboard plus 72 photometric images. The quick flow does not repeat or weaken target metrology, lens, direction, component, or repeatability authority.

A changed shipped geometry, photometric, finalizer, Python analyzer, dependency manifest, target, camera/controller/wiring identity, or source byte invalidates the old authority. Create a new supervised one-time characterization; never edit, relabel, copy forward, or fall back to an older authority.

Finalization writes only through the protected staging root. The exact destination is '<root>/<bundleManifestSha256>/' and contains exactly fourteen files: 'mathematical-calibration-bundle-v1.json', all twelve verified members, and 'mathematical-calibration-finalizer-handoff-v1.json'. Reopen verifies these exact bytes. Same-hash restaging is idempotent; conflicting or incomplete staging fails closed. Do not supply a staging path through the browser or invoke Agent 4 activation in this workflow.

This software candidate does **not** authorize a Dell run, activation, helper install/restart, Production port use, database import/trust, or deployment. The checked-in CLI/controller seam remains physically unexercised and unapproved; Dell timing, optical/coordinate validation, thermal/repeatability evidence, and explicit activation remain required. The V1.0.1 '102'-capture/'78'-measurement process below remains the established physical procedure until those V1.2 Dell gates pass. There is no conversion or automatic fallback among V1.0.1, V1.1, V1.2, provisional geometry, or V0.

Under ten minutes is an acceptance target, not a present claim. Measure wall time on the Dell from session creation through ready-for-explicit-activation, including operator moves, controller acknowledgements, image transfer/checkpointing, four OpenCV checkerboard/outer-contour reruns, 72 full-resolution Sharp decodes and normalized-ROI grid reductions, analysis, finalization, and safe-off. On real frames verify Brown-Conrady inversion, held-out homography residuals, independent outer-boundary residuals, pose-four blank-flip registration, background exclusion, and the stage-to-sensor-to-normalized-card direction orientation under rotation/mirroring/perspective. Never lower pose, residual, U95, repeatability, or threshold-manifest gates to meet the target.

The Basler transport is not the unresolved blocker. Prior protected sessions received real frame streams, including sessions with successful valid overlays/captures. Pylon Viewer may be used only for coarse physical positioning and must then be closed completely. The protected bridge must be the sole camera owner for preview and capture. A black browser canvas, invalid checkerboard contour, missing lighting-controller acknowledgement, or disagreement between preview and capture-time geometry is an explicit stop, not authority to use Pylon Viewer frames or another image source.

Machine grading remains Mathematical V1 or explicit failure. A later authenticated admin adjudication may supply all four confirmed sub-grades and complete a human-reviewed report, but it is a separate human authority: it does not repair calibration, mutate raw evidence, set `isCalibrated`, or relabel the failed machine run as a successful Mathematical V1 run.

## Before asking Mark to position anything

1. Finish all hardware-free repository validation and freeze the centralized threshold-set SHA-256.
2. Regenerate the target twice and require byte-identical PDF and manifest output:

   ```powershell
   python scripts/ai-grader/generate-mathematical-calibration-target-v1.py
   Get-FileHash output/pdf/ten-kings-mathematical-calibration-target-v1.pdf -Algorithm SHA256
   Get-Content output/pdf/ten-kings-mathematical-calibration-target-v1.json -Raw
   ```

3. Print `output/pdf/ten-kings-mathematical-calibration-target-v1.pdf` one-sided on Letter paper at **Actual size / 100%**. Disable Fit, Shrink, Scale to fit, borderless expansion, and duplex printing.
4. Use a traceable ruler or calibrated caliper and its documented U95. The printed target is acceptable only when both axes pass:

   ```text
   abs(measuredSpanMm - nominalSpanMm) + measurementU95Mm <= 0.20 mm
   ```

   Verify the 100.00 mm X bar and 200.00 mm Y bar. Verify the cut coupon independently at 63.50 mm by 88.90 mm with the same equation. Record instrument ID, kind, calibration version, and calibration-artifact SHA-256. A visual or printer-dialog claim is not metrology.
5. The coupon reverse used for flat-field evidence must be blank, matte, neutral, and free of print show-through. Reject and reprint if the physical target, cut, reverse, or verification evidence is unsuitable.
6. Append the planned hardware action to `docs/handoffs/SESSION_LOG.md`. Ask Mark to confirm that the verified, clearly non-production target is positioned checkerboard face up. No capture may occur before that confirmation.

## Protected worktree bridge

Run the bridge from that exact checkout in a separate foreground PowerShell. Use a new protected calibration-only bridge config rather than reading or changing the installed helper config. Never display its generated token or pass it on a command line. Use new non-production capture directories and the repository target identity. The example alternate port avoids the normal installed-helper port; confirm it is free first.

```powershell
$targetManifest = Get-Content output/pdf/ten-kings-mathematical-calibration-target-v1.json -Raw | ConvertFrom-Json
.\scripts\ai-grader\start-local-station-bridge.ps1 `
  -Real `
  -ConfigPath 'C:\TenKings\capture-data\ai-grader-mathematical-calibration-v1\private-bridge-config.json' `
  -Port 47653 `
  -OutputDir 'C:\TenKings\capture-data\ai-grader-mathematical-calibration-station-v1' `
  -ReportBundleOutputDir 'C:\TenKings\capture-data\ai-grader-mathematical-calibration-reports-v1' `
  -MathematicalCalibrationOutputDir 'C:\TenKings\capture-data\ai-grader-mathematical-calibration-v1' `
  -MathematicalCalibrationTargetPath (Resolve-Path 'output/pdf/ten-kings-mathematical-calibration-target-v1.pdf').Path `
  -MathematicalCalibrationTargetVersion ([string]$targetManifest.version) `
  -MathematicalCalibrationTargetSha256 ([string]$targetManifest.pdfSha256) `
  -MathematicalCalibrationRigId 'fixed-rig-dell-v1'
```

Do not use `-SkipBuild`. The foreground bridge must build the checked-out source, bind only to loopback, retain the serialized camera/lighting gate, and retain bridge-owned safe-off. Do not open the hosted station or perform a card/report flow for calibration.

## Deterministic capture sequence

In a second PowerShell in the same worktree, load the token from that exact protected calibration-only config into the process environment without displaying it. Use a safe session ID such as `math-cal-v1-YYYYMMDD-01`. Remove the environment value when the supervised run ends. First review the complete worksheet:

```powershell
$privateCalibrationBridgeConfig = Get-Content 'C:\TenKings\capture-data\ai-grader-mathematical-calibration-v1\private-bridge-config.json' -Raw | ConvertFrom-Json
$env:AI_GRADER_STATION_TOKEN = [string]$privateCalibrationBridgeConfig.stationToken
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 -Action Worksheet
```

After Mark's first target-position confirmation, create the session. The target version/hash must come from the checked-in manifest:

```powershell
$targetManifest = Get-Content output/pdf/ten-kings-mathematical-calibration-target-v1.json -Raw | ConvertFrom-Json
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action Start `
  -BridgeUrl 'http://127.0.0.1:47653' `
  -SessionId '<safe-session-id>' `
  -OperatorId '<safe-operator-id>' `
  -TargetVersion ([string]$targetManifest.version) `
  -TargetSha256 ([string]$targetManifest.pdfSha256) `
  -ConfirmInitialCheckerboardPositioned
```

The immutable plan contains exactly 102 captures:

- 10 lens-geometry checkerboard poses;
- 10 normalization/registration checkerboard poses;
- 10 explicit remove-and-reseat placement captures;
- 8 channels x 3 dark controls;
- 8 channels x 3 flat fields; and
- 8 channels x 3 illumination-pattern captures.

Use `-Action Status` before every continuation. `Advance` deliberately pauses when a physical action is required. Perform exactly the displayed action, then rerun with `-ConfirmPhysicalAction`. There are 19 checkerboard reposition pauses, 10 remove/reseat pauses, and one flip to the blank reverse. After the blank-reverse flip is confirmed, the launcher automatically completes the remaining 72 bounded channel captures without further target movement.

```powershell
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action Status -BridgeUrl 'http://127.0.0.1:47653' -SessionId '<safe-session-id>'

.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action Advance -BridgeUrl 'http://127.0.0.1:47653' -SessionId '<safe-session-id>' `
  -ConfirmPhysicalAction
```

Do not reuse `-ConfirmPhysicalAction` until the next displayed movement has actually been completed. On any capture, acknowledgement, identity, hash, safe-off, or source-validation failure, stop and preserve the session. Never substitute another camera, image, target, channel, or manual measurement.

## Metrology, repeatability, seal, and finalization

After exactly 102 captures, create a new write-once 28-slot metrology template:

```powershell
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action CreateMetrologyTemplate `
  -BridgeUrl 'http://127.0.0.1:47653' `
  -SessionId '<safe-session-id>' `
  -MetrologyInputPath '<new-metrology-json-path>'
```

Complete every null from observed physical evidence. The template requires:

- print-scale X/Y and coupon-cut X/Y measurements with U95 and traceable instrument authority; and
- three independently recorded source/card-center point measurements for each of the eight fixed lighting directions, including point U95, the allowlisted fixed-ring geometry method, and its instrument authority.

Compute the exact completed-file SHA-256 and independently review the artifact. Submission is explicit and immutable:

```powershell
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action SubmitMetrology `
  -BridgeUrl 'http://127.0.0.1:47653' `
  -SessionId '<safe-session-id>' `
  -MetrologyInputPath '<completed-metrology-json-path>' `
  -MetrologyInputSha256 '<exact-lowercase-sha256>' `
  -ConfirmMetrologySubmission
```

Derive the 50 repeated-measurement records from the pinned analyzer, inspect `Status` for exactly `102/102` captures and `78/78` measurements, then seal and finalize into new paths:

```powershell
.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action DeriveRepeatability `
  -BridgeUrl 'http://127.0.0.1:47653' `
  -SessionId '<safe-session-id>' `
  -RepeatabilityOutputPath '<new-repeatability-json-path>'

.\scripts\ai-grader\run-mathematical-calibration-capture-v1.ps1 `
  -Action CompleteOffline `
  -BridgeUrl 'http://127.0.0.1:47653' `
  -SessionId '<safe-session-id>' `
  -ProfileId '<safe-profile-id>' `
  -CalibrationVersion '<safe-version>' `
  -ArtifactId '<safe-artifact-id>' `
  -AnalysisOutputDir '<new-analysis-directory>' `
  -FinalizedOutputDir '<new-finalized-directory>' `
  -ConfirmSeal
```

`CompleteOffline` must return `offline_calibration_complete`, `productionMutation=false`, and `v0FallbackUsed=false`. Preserve the capture manifest, source package, certified analysis SHA-256, complete bundle, bundle SHA-256, and all acceptance issues. A rejected analysis is an honest result: it produces no trusted profile and must be corrected with a new calibration session rather than edited.

## Acceptance evidence and supervised test card

Before using the bundle on a test card, independently verify that:

- all manifest acceptance criteria pass and the finalized profile says `isCalibrated=true` only inside the complete bundle;
- the 12-member ledger and every member hash revalidate;
- scale relative U95, lens residual, registration residual, placement U95, segmentation-boundary U95, flat-field deviation, channel direction confidence/U95, sample counts, and target/capture identities match the centralized threshold set;
- the bundle threshold-set ID/hash equals the frozen source manifest; and
- the bridge reaches safe-off and releases the camera.

Then ask Mark to place the clearly designated non-production test card. Run only the local Mathematical V1 station path with the exact finalized bundle path/hash and a non-production card identity. Exercise printed-border centering when a real measurable border exists; use registered-template centering only with an exact controlled APPROVED artifact. Record front/back centering, all eight corner and eight edge observations, surface findings/limitations, overlays, deduction ledger, Why Not 10, and exact report/package hashes. Fully obscured or unsupported evidence must remain insufficient; it must not become a 10 or fall back to V0.

Do not publish, create a Production CalibrationSnapshot, trust a snapshot, upload a report, print Label V1, add inventory, access NFC, or mutate Production. Those are separate post-merge rollout authorities and are not granted by this runbook.

## Session log and handoff

Append before and after every bridge start/stop, capture block, seal, analysis, and finalization. Record redacted-safe IDs and hashes, exact acceptance values, capture/measurement counts, safe-off evidence, pass/fail issues, and whether any output was rejected. Do not record station tokens, private object keys, raw local paths in public handoff text, card-owner data, or Production credentials.

The final PR may include redacted screenshots or evidence-package-relative paths. Independent Mac architecture/calibration review is required before any protected rollout. No merge or deployment is authorized by completion of this physical run.
