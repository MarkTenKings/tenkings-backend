# AI Grader Mathematical Calibration V1 Runbook

last_verified_at: 2026-07-18
owner: Mark
status: supervised non-production calibration only; no protected rollout authority

## Purpose and hard boundary

This runbook creates one physically measured, immutable Mathematical Calibration V1 bundle for the fixed Basler/Leimac rig. It is not a Production deployment, database import, trust action, report publication, label print, inventory operation, or NFC workflow.

The executable acceptance and scoring authority is `packages/shared/src/aiGraderMathematicalCalibrationV1.ts`. The operator launcher is `scripts/ai-grader/run-mathematical-calibration-capture-v1.ps1`. A session is calibrated only when the analyzer and finalizer produce a complete accepted 12-member bundle. Never edit a result, submit placeholder metrology, or set `isCalibrated=true` manually.

Use the isolated feature worktree code directly. Do not install it over the Dell helper, change the Scheduled Task, rotate or print a station token, or persist new driver/firmware/controller settings. If another process already owns the camera or the requested loopback port, stop and obtain direction rather than changing the installed helper.

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

Run the bridge from this worktree in a separate foreground PowerShell. Use a new protected calibration-only bridge config rather than reading or changing the installed helper config. Never display its generated token or pass it on a command line. Use new non-production capture directories and the repository target identity. The example alternate port avoids the normal installed-helper port; confirm it is free first.

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
