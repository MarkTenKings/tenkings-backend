# AI Grader Native Camera Worker

Status: software-only foundation; disabled by default; not installed or activated on the Dell.

The current PowerShell/pylon capture path remains the production default. The native path is an additive, explicit opt-in seam for a later integration PR after Agent 2's preview/back-light lifecycle work is merged and Mark approves supervised Dell validation. A native attempt never cold-falls back: any worker, protocol, camera, lighting, epoch, output, or timeout fault safe-offs and ends that attempt.

## Architecture

The capture-helper owns the solution under `packages/ai-grader-capture-helper/native`:

- `TenKings.AiGrader.Vision`: hardware-independent Mono8 detector, calibration contracts, projective geometry, and temporal tracking.
- `TenKings.AiGrader.Worker.Core`: persistent serialized camera owner, strict state machine and NDJSON protocol, latest-frame queue, forensic capture writer, fake/replay cameras, and injected lighting boundary.
- `TenKings.AiGrader.Worker.Host`: standalone fake/replay worker using the real OpenCV detector. It has no Basler reference.
- `TenKings.AiGrader.Pylon.Host`: Windows x64 adapter and host. This is the only project that references `Basler.Pylon`.
- `TenKings.AiGrader.Replay`: deterministic comparison/evaluator CLI for PCA baseline, contour quad, line recovery, and fused detection.
- `TenKings.AiGrader.Vision.Tests` and `TenKings.AiGrader.Worker.Tests`: fake/replay-only tests. One guard test references the SDK-disabled host assembly solely to prove the hardware backend is absent; tests cannot reference `Basler.Pylon`, load its SDK, or instantiate the SDK-enabled `PylonCameraBackend`.

TypeScript integration is additive under `src/drivers/nativeCamera*`. It is not imported by `aiGraderLocalStationBridge.ts`, and no station/production lifecycle has been activated.

One worker owns one camera for its lifetime. Initialization/open/configuration occurs once. Preview, drain, capture, safe idle, and resume are serialized through that owner:

```text
uninitialized -> idle_safe -> previewing -> draining -> capture_ready
capture_ready -> capturing -> idle_safe -> resuming -> previewing
any invalid transition, timeout, malformed input, camera loss, or incomplete output -> faulted
idle_safe -> shutdown
```

`faulted` is terminal for that attempt. A retry requires a new worker/session and an explicit operator action.

## Trusted rig configuration

Hardware settings come only from a versioned, canonical, protected local host file. The browser cannot submit a selector, serial, exposure, gain, trigger, transport, FPS, JPEG quality, queue strategy, output contract, timeout, calibration, or orientation. Protocol `initialize` supplies only the expected configuration ID and canonical lowercase SHA-256; `start_preview` and `resume_preview` have empty payloads. The host loads the full contract, validates its ID/digest and calibration digest, and accepts only a non-reparse absolute file of at most 64 KiB. On Windows, both the file and parent must have trusted owners and present protected DACLs. Only SYSTEM, Administrators, and explicitly supplied current/service identities may hold any generic write/all, maximum-allowed, add-file/subdirectory, append, extended-attribute/attribute write, delete/delete-child, WRITE_DAC, or WRITE_OWNER access; inherited, callback, unsupported allow forms, and arbitrary writers fail closed. Read-only ACEs may remain. The Pylon path proves this contract before SDK initialization, discovery, or camera open.

The committed redacted/non-activatable example is:

- schema/version: `tenkings.ai-grader.trusted-rig` / `1`
- configuration: `redacted-dell-fixed-rig-v1` / `2c80972da97473206429fc42aee8262203d3a322b4d663f8e24e1267490e8847`
- calibration: `redacted-fixed-rig-calibration-v1` / `1218d5d01e21a67cbc0bbfb43da51368c3d468b23db99f3e90852325c4807d57`
- camera contract: exact Basler `a2A2448-23gmBAS`, GEV/GigE, Mono8, 2448x2048, offsets 0/0, exposure 45000 microseconds, gain 0, exposure/gain auto Off
- acquisition contract: Continuous; FrameStart TriggerMode Off with Software as the configured source; Line2 Output, inverter true, ExposureActive
- preview/queue/output: 15 FPS, JPEG quality 72, depth one, `LatestImages` preview, `OneByOne` forensic, lossless Mono8 PNG/TIFF, normalized 1200x1680
- sensor orientation: 90 degrees clockwise, no mirrors; bounded initialize/open/configure/grab/drain/shutdown timeouts

Its selector value is deliberately `UNCONFIGURED_DO_NOT_USE`; the Pylon adapter rejects that sentinel before SDK initialization. A later Dell installation must create a protected local copy with the reviewed exact selector and new canonical digest. The fake/replay contract is `rig-1` / `e1dc50f7f4d7d6fc08f690c8dbd5bc7382344420df9abb533805735a245c104f`, with calibration `fake-calibration-v1` / `98699abf844c40cc1537adf6125ff4547512c2d1fbbf1562fae0eadd97185b93`.

Real activation must find exactly one exact-identity GEV camera. Missing, unsupported, multiple, wrong-model, wrong-transport, config/digest/calibration/orientation, application, or readback mismatch fails closed. The adapter explicitly writes and reads back all 18 required settings, including output queue depth; it never inherits a prior camera state, selects another device, or loads/saves a hardware User Set. Exposure selection preserves the deployed `ExposureTime` then `ExposureTimeAbs` order, and gain preserves `Gain`, `GainAbs`, then `GainRaw`; a present but empty, unreadable, unwritable, or wrong-typed node is skipped, and the exact selected node is retained for both write and readback. Public health exposes only a verified boolean and redacted configuration attestation, never the selector/device identity or local path.

## Local process protocol

The protocol is newline-delimited JSON over child stdin/stdout. It never opens HTTP or a listening port. `stdout` is protocol only; bounded redacted diagnostics use `stderr`.

- Version: `tenkings.ai-grader.native-camera.v1`
- Maximum line: 1 MiB, including preview JPEG base64. Encoders cap JPEG bytes before publication and may reduce quality and display dimensions; `jpeg.width`/`jpeg.height` make the raw-geometry-to-display scale explicit while frame identity remains unchanged.
- Request IDs: 1-64 allowlisted ASCII characters; session IDs: 1-128.
- Every envelope carries request/session identity, worker/session/preview/side epochs, side, timeout, Unix deadline, and monotonically increasing sequence.
- Exact unsigned 64-bit Pylon BlockID and hardware timestamp ticks are canonical decimal strings, never JavaScript numbers; leading zeroes, sign characters, overflow, and sequence-number substitution are rejected.
- Invalid UTF-8, duplicate JSON keys at any nesting level, unknown fields, malformed/empty/whitespace-only/truncated/oversize lines, unsafe terminal-fault/error diagnostics, clean unexpected stdout EOF, stdin/stdout errors, late results, expired requests, stale epochs, wrong order, wrong frame identity, and incoherent Ready geometry or telemetry fail closed.
- At most 32 commands may be in flight in both client and worker. The client rejects command 33 before sequence allocation, encoding, timer/map insertion, or write; the first `stdin.write(false)` terminally safe-offs and kills instead of creating an unbounded drain queue. Worker completed tasks are removed and exceptions observed; EOF awaits only active work. Duplicate/completed bookkeeping is deterministic and bounded to 256 request IDs; an active request is never selected for eviction. An exact duplicate is idempotently rejected, and a changed duplicate body terminally faults the protocol.

Commands are `initialize`, `health`, `capabilities`, `start_preview`, `stop_drain`, `set_side`, `execute_forensic_plan`, `lighting_ack`, `lighting_completion`, `safe_off_completion`, `resume_preview`, `safe_idle`, and `shutdown`. Events are `preview_frame`, `lighting_profile_requested`, `lighting_grab_completed`, `safe_off_requested`, and `terminal_fault`. `set_side` is accepted only in `idle_safe` or `capture_ready`, never while a raw preview grab is in flight; `shutdown` is accepted only from `idle_safe`. Capture and shutdown share an exclusive lifecycle fence, so a concurrent shutdown either follows a completed atomic capture or aborts it before commit.

`initialize` carries only the expected trusted-rig ID/digest; backend selection belongs to the already-created host process. Preview start/resume carry no tuning fields. Forensic success returns only path-free package IDs/digests and artifact metadata. The TypeScript lifecycle client validates the attested config/calibration/orientation, request correlation and order, deadlines, exact epochs, geometry authority, all 11 roles, telemetry order/coherence, and package digests. It serializes lighting-role events so the next profile cannot begin before the prior role completes, bounds every injected profile/stability/authorization/completion/safe-off await, and redacts Windows and Unix absolute paths. Any malformed output, timeout, child exit, capture fault, or mismatch invokes injected safe-off, kills the child, and never starts a fallback backend.

Successful results include a strict path-free timing snapshot. Preview events bind the JPEG hash/body, raw-frame geometry, BlockID/timestamp, epochs/side, receive/detect/encode/emit monotonic timings, frame age, cumulative backend skipped-image plus latest-queue drop counts, frozen flag, and hysteresis to the same exact frame.

## Lighting boundary and safe-off

The native worker does not contain Leimac transport or commands. `ProtocolLightingCoordinator` and `NativeCameraLightingCoordinator` form the narrow injected boundary:

1. Worker requests the next evidence-role profile.
2. The external bridge applies its reviewed profile and returns a positive stable-light acknowledgment.
3. The bridge authorizes exactly one bounded grab and sends its expiry; the worker rechecks that expiry immediately before the grab.
4. The worker captures/writes one role and returns its exact frame identity.
5. The bridge completes that role before the next request.
6. The worker emits `safe_off_requested`; only the injected TypeScript coordinator can acknowledge it with `safe_off_completion`. The worker cannot enter `idle_safe` merely because no role is pending. Timeout, negative/duplicate/mismatched completion, worker exit, malformed protocol, wrong epochs/order, capture/output failure, or shutdown is terminal and causes the client to safe-off and kill the attempt.

A requested profile is never treated as proof that lighting is stable. Failure to acknowledge, authorize, complete, or safe-off is terminal. Native code never connects to or controls Leimac directly.

## Forensic side contract

Every front or back side plan contains exactly, once, and in this order:

1. `dark_control`
2. `all_on`
3. `accepted_profile`
4. `channel_1` through `channel_8`

`full_forensic` stores lossless Mono8 PNG; `production_fast` stores uncompressed lossless Mono8 TIFF. The profile is explicit. Missing, duplicate, reordered, overwritten, dimension-mismatched, frozen/reused-frame, or partially written roles fail the whole attempt.

A side is one crash-safe transaction, not 11 independently visible files. The writer hashes the session ID and CaptureId, creates a unique same-volume owned staging directory, holds an exclusive lease file for its entire writable lifetime, and binds the capture-plan, trusted-configuration, calibration, orientation, side, and epoch digests. Each role is written through a unique create-new temp file, write-through flushed/fsynced, hashed/sized, reread, signature-decoded, and verified for MIME, dimensions, exact lossless Mono8 pixels, role, side, frame, and BlockID before its staged rename. Only after all 11 roles and authoritative all-on geometry pass does the worker obtain external safe-off, write/fsync and reread the canonical manifest, validate the exact package and manifest digests, and remove both staging-only owner and lease metadata. It then requires the candidate to contain exactly the manifest plus 11 role files before atomically renaming the directory to its immutable final name. Every allocation, validation, cancellation check, and test boundary is before that same-volume rename; after the rename there is no fallible or cancellable I/O that could report failure while exposing a final package. A failure before the commit point safe-offs and leaves no final package.

The final directory is never overwritten. The same CaptureId plus exact package digest resolves idempotently; a different digest is an immutable conflict. Before an explicit retry, reconciliation touches only staging directories carrying a valid owned marker for the same hashed session/CaptureId/side and only after acquiring their lease. A live transaction therefore cannot be deleted or quarantined by a concurrent retry. Provably incomplete crash-released staging is removed, unlocked staging with a manifest or untrusted marker is quarantined, and valid final evidence is never deleted. Public-safe protocol results contain package/capture-plan/manifest digests and artifact metadata, never absolute paths.

The raw `all_on` Mono8 frame is analyzed at full resolution before image encoding. Its frame/hash and 3x3 projective transform can become authoritative only through the typed current-frame predicate below. `accepted_profile` and channels 1-8 must share its dimensions/epochs/side and reuse that transform; `dark_control` is not mixed into normalized pixels without registration. Existing downstream normalization remains exactly `1200x1680` portrait, and every raw role remains immutable.

## Four-edge detector

Input is a bounded Mono8 buffer with width, height, stride, exact frame identity, epochs, side, monotonic receive time, drop count, and calibration. Calibration supplies a safe normalized ROI and optional camera matrix/distortion coefficients.

The fused detector performs:

1. ROI clipping and optional undistortion.
2. Reusable OpenCV buffers, mild Gaussian denoise, and CLAHE local contrast.
3. Bright and dark adaptive thresholds plus bounded Canny thresholds derived from frame intensity statistics.
4. Morphological gap closing.
5. External contours, convex hull, and `approxPolyDP` quadrilateral candidates.
6. Incomplete-boundary recovery from segments using OpenCV Huber line fitting and bounded outlier rejection.
7. Two plausible parallel line pairs and four intersections.
8. Independent edge gradient/continuity/residual scoring plus convexity, aspect, coverage, clearance/full visibility, and perspective.
9. Bounded corner refinement and source-to-`1200x1680` homography.
10. Epoch-scoped temporal evidence with display-only high-response smoothing and short Ready hysteresis.
11. Immediate evidence reset on stale, frozen, wrong-epoch, clipped, low-confidence, or inconsistent frames.

Source corners remain current unsmoothed evidence; only display corners are smoothed. Ready always requires the current frame to qualify. The detector never infers printed top/bottom, never substitutes a fixture boundary, and never fabricates an edge without gradient support. Honest missing support is `not_detected`; a credible but unsafe/clipped shape is `adjust_card`.

Live hysteresis and forensic authority are deliberately separate. Live Ready uses current evidence plus the configured short hysteresis; motion, removal, stale/frozen identity, epoch/side change, or failed current evidence immediately resets it. For the forensic `all_on` grab, `normalizationSafe` and `captureReady` are recomputed from that one exact current raw frame without borrowing live Ready history. The first structurally and evidentially valid forensic frame may therefore pass. It must match frame ID, BlockID, worker/session/preview/side epochs and side; match the attested calibration/orientation; contain four finite ordered convex corners and four coherent normalized fitted lines; map the physical long-edge pair to normalized height 1680 and the short-edge pair to width 1200; have a finite nonsingular corner-consistent homography; be fully visible with safe clearance/aspect/coverage/perspective; meet confidence, all-four-edge support/continuity, and residual thresholds; and be neither stale nor frozen with reason exactly `none`.

`adjust_card`, `not_detected`, clipped, unsafe coverage/aspect/perspective, low confidence, unsupported edge, stale/frozen, uncalibrated, orientation mismatch, failed reason, or invalid homography can never be authoritative. Hough/line recovery and internal artwork can suggest a candidate but cannot independently establish Ready without four independent gradient-supported, externally corroborated boundaries. A correct-aspect rectangle formed only by internal artwork is explicitly `unsupported_edge`. The worker repeats this validation, the atomic package repeats it before commit, and the TypeScript client validates the path-free result; any failure requires safe-off and ends the attempt.

The coordinate chain is explicit: raw Mono8 sensor pixels may be undistorted for detection, are transformed by the configured sensor-to-portrait rotation (only 0/90/180/270) and explicitly supported bounded mirrors, then cropped to the calibrated portrait ROI for analysis. Refined corners are mapped back through ROI/analysis scaling, inverse sensor orientation, and lens distortion so `sourceCorners` remain raw-source coordinates. A nonlinear lens correction cannot be represented for interior raw pixels by the single 3x3 source homography, even when its four construction corners fit. Therefore a result carrying `NonlinearLensCalibrationApplied` is display-only and authority rejects it as `unsupported_lens_transform`; an authoritative rig must use `lens: null` until a later protocol/package carries and applies an explicit nonlinear normalization chain. With no nonlinear lens transform, the homography coherently maps raw source coordinates to the fixed portrait rectangle. Missing or contradictory orientation blocks authority; orientation is never inferred from artwork or printed top/bottom.

Geometry includes ordered source/display/normalized corners; four fitted lines; homography; center, scale, rotation; confidence; per-edge support/continuity/residual; aspect, coverage, convexity, clearance, visibility, perspective; exact frame/epochs/side/timestamps; processing/age/drops/frozen/motion; removal fence; and hysteresis evidence. These are future Rapid inputs only. This PR does not implement Rapid triggering.

## Restore, build, test, and package

Requirements are .NET 8 runtime/targeting support on Windows x64 and the repository's pinned Node/pnpm toolchain. NuGet dependencies are centralized and locked. OpenCvSharp packages are exact version `4.11.0.20250507`; lockfiles record resolved transitive versions and content hashes. No NuGet, OpenCV, or Basler binary is committed.

From `packages/ai-grader-capture-helper`:

```powershell
pnpm run native:restore
pnpm run native:build
pnpm run native:test
```

`native:test` restores in locked mode and runs only fake/replay test assemblies. It never executes the Pylon host or loads the Basler SDK; the activation-guard test loads only the normal SDK-disabled host assembly.

Run the committed synthetic evaluator and write local generated reports:

```powershell
pnpm run native:replay -- --manifest native/fixtures/synthetic-manifest.json --json native/reports/generated/replay.json --markdown native/reports/generated/replay.md
```

Add `--cpu-load-ms <bounded-ms>` to exercise the concurrent CPU-load path. A private corpus belongs only under the gitignored `native/private-fixtures/` directory. Private manifest rows must use allowlisted relative paths, permitted SHA-256 hashes, dimensions, side/pair identity, and ground truth. Expected-card rows require exactly four finite ordered raw-source ground-truth corners inside the decoded image. The C# private loader uses explicitly offline-only coordinate calibration `offline-replay-coordinate-calibration-v1` / `90e4068a4c28764ce1a34d26e0bb96a0495c3b798286acbdc305068c724a73db`; it is not a production calibration attestation. Absolute paths, traversal, device identity, and unapproved hashes are rejected.

The existing TypeScript/Sharp detector is exercised by a separate offline full-resolution comparator, after building the capture helper:

```powershell
pnpm run native:sharp-comparator -- --manifest native/private-fixtures/sharp-comparator-manifest.json --fixture-root native/private-fixtures
```

Its strict manifest follows `native/fixtures/sharp-comparator-manifest.schema.json` and binds each encoded fixture to a root-relative name, permitted SHA-256, oriented dimensions, expected detection/Ready decisions, and ordered raw-source corner truth. Output is deterministic and path-free. The tracked `sharp-comparator-missing-corpus.json` intentionally returns zero cases, null accuracy metrics, and decision digest `64239bbaa5e0b1df311df5526fd85fd582d42f30eb31e763fe973640e71fc714` when no authorized real corpus is available. These Sharp results are separate from the C# synthetic PCA/contour/line/fused report; neither report borrows the other's metrics.

Package framework-dependent fake/replay workers without installing them:

```powershell
pnpm run native:package
```

Output is confined to gitignored `native/publish`. The package verifier requires the fake/replay host executable, DLL, deps/runtimeconfig, OpenCvSharp managed assembly, exactly one OpenCvSharp native runtime, and the pinned dependency entry. It also proves git tracks zero PE/vendor binaries. Packaging and verification do not start or reflect over a worker and do not load an SDK assembly.

### Compile the Pylon host without executing it

The Pylon project is inert by default and compiles an SDK-disabled guard. To compile the real adapter, first run locked restore, then pass an installed SDK assembly or root:

```powershell
pnpm run native:build:pylon -- -PylonAssemblyPath '<installed-sdk>/Development/Assemblies/Basler.Pylon/net8.0/x64/Basler.Pylon.dll'
```

Installed-SDK discovery succeeds only when exactly one managed candidate exists; an ambiguous machine must pass the reviewed assembly/root explicitly. The project reference uses `Private=true` so a normal ignored publish has a resolvable managed dependency. Compile-only validates the assembly and never copies it into source control. `build-pylon-host.ps1` only compiles; it never runs the executable, initializes pylon, enumerates a camera, or opens/configures/grabs from hardware.

Create and statically verify an ignored Pylon publish only on the reviewed Windows build machine:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File native/scripts/publish-workers.ps1 `
  -CompilePylon `
  -PylonAssemblyPath '<installed-sdk>/Development/Assemblies/Basler.Pylon/net8.0/x64/Basler.Pylon.dll'
```

This copies the installed managed `Basler.Pylon.dll` into `native/publish/pylon` only, records its source/published SHA-256 and managed file version, and requires OpenCvSharp `4.11.0.20250507`, expected host files, and hash equality. Vendor binaries remain ignored and untracked. The installed, licensed Pylon native runtime remains an external Dell prerequisite; it is not bundled, installed, or modified. Verification reports `sdkHostExecuted=false` and `sdkAssemblyLoaded=false`.

The runtime adapter constructor requires an internal activation permit. The host refuses to proceed unless the build included the SDK and all three explicit runtime acknowledgments are present. Those flags are intentionally not part of normal test, build, package, startup, station, or bridge paths. Do not run the Pylon host until a later Mark-approved Dell procedure.

## Windows CI

`.github/workflows/native-camera.yml` is path-scoped to native/nativeCamera files and runs on `windows-2022` with Node 20, pnpm 9.12.0, and .NET 8. It forbids Pylon/Basler SDK variables and station credentials, performs frozen pnpm install plus locked NuGet restore, builds SDK-disabled x64 with warnings as errors, runs all fake/replay tests, verifies the production-threshold replay decision report, builds/tests the TypeScript seam, statically verifies the fake package, and fails on lock/report/generated-source drift. The workflow never enables Pylon compile or hardware. Installed-SDK Pylon compile/package is separately labeled compile-only build-machine evidence and never Dell hardware validation.

The final local corrective validation passed 82 vision/replay plus 107 worker/protocol/config/atomic tests (189 native tests total), 65 focused native TypeScript checks, 338 full capture-helper checks, 127 shared checks, capture-helper TypeScript no-emit, the production-threshold replay contract, and bounded CPU-load replay. The Pylon host compiled with zero warnings/errors against the explicitly selected installed net8 x64 managed assembly; static fake and Pylon package verification both reported no host execution or SDK assembly loading and zero tracked proprietary binaries. These are workstation software/compile results, not Dell hardware validation.

## Offline evaluator and current evidence limits

The committed redacted manifest drives deterministic multi-frame sequences at the production/default detector thresholds and hysteresis length. It covers paired front/back; black, white, and neutral plates; same-tone/no-gradient borders; foil/glare/shadow; worn corners; rotations through plus/minus 35 degrees; perspective, translation, clipping; no card; hands; ruler; wrong rectangle; frozen identities; slow drift and sudden motion; wrong side/epoch; removal/replacement; all sensor rotations and supported mirror behavior; and bounded CPU load. The CLI compares the PCA-style baseline, contour quad, robust line recovery, and fused detector. Tests verify current-frame qualification, the first valid forensic frame, default live Ready hysteresis, motion/removal/frozen reset, no stale/old-epoch Ready, repeated negatives never Ready, honest no-gradient failure, homography round trips, deterministic decisions, and report schema.

The aggregate reports detection recall/precision, Ready recall/precision, false detection, false Ready, corner error, and timing separately. Timing is deliberately excluded from the deterministic decision digest because it is machine/run dependent. The committed report is regenerated and checked for decision/report-contract drift in Windows CI.

Current tracked synthetic report `tenkings.ai-grader.replay-report.v2` uses seed `20260712`, 33 sequences, 4 comparators, and 132 evaluations; its deterministic decision digest is `d6720d650abe97352ff44ff53dcc6865f47bf4f5ea15f28c898d2ffce08806c7`. Fused results are TP/FP/TN/FN `23/3/6/1`, detection recall `95.83%`, detection precision `88.46%`, Ready recall/precision `100%/100%`, three non-Ready false detections, zero false Ready, mean corner error `8.875 px`, measured P50 `9.571 ms`, and measured P95 `13.049 ms`. Negative detections remain non-Ready, and the internal correct-aspect rectangle cannot qualify because it lacks external-boundary corroboration. These exact values describe only the tracked synthetic run; timing can change on regeneration and is neither a deterministic gate nor Dell evidence.

Committed JSON and Markdown reports are synthetic/adversarial engineering regression evidence only. They do not establish Dell timing, production accuracy, front/back parity, or safe production thresholds. The report lists missing real-corpus categories explicitly, including approved blinded Dell Mono8 front/back frames, real plates/lighting/material prevalence, approved negatives, and hardware BlockID/age/load measurements.

The existing TypeScript/Sharp detector remains the separately executable offline/full-resolution comparator and downstream compatibility contract. The additive wrapper invokes that detector with its production defaults; it does not alter `cardGeometry.ts`. The committed empty comparator manifest proves the runner and honestly reports that no authorized encoded real corpus was available, so it contributes no accuracy claim to the C# metrics above. No grading, Surface Intelligence, Vision Lab, finding, report, Confirm, Publish, label, slab, comps, inventory, or public-report algorithm changes are made here.

## Timing telemetry

The worker uses monotonic durations and never treats JPEG completion as capture time. Result snapshots reserve separate measurements for spawn-to-initialize, pylon initialize, discovery, camera open, configure, first preview frame, detect, encode, emit, drain, mode switch, lighting acknowledgment, first forensic frame, forensic grabs, writes, hashes, resume, backend skipped images, queue replacement, and combined drops. Preview events include per-frame receive/detect/encode/emit time and frame age. Forensic evidence uses the raw frame's receive time plus hardware BlockID/timestamp when available.

Offline software timing is reported separately from these unproven later Dell targets:

- detector P95 at or below 30 ms;
- grab-to-geometry P95 at or below 100 ms;
- overlay age P95 at or below 150 ms;
- at least 15 Hz geometry;
- first back outline within 500 ms;
- front/back recall gap no more than one point;
- zero false Ready on approved negatives;
- zero accepted old epochs;
- one persistent camera owner through preview/capture/resume;
- materially lower startup than the historical 4-6 second path.

Only a later Mark-approved supervised Dell run can evaluate those targets. Synthetic results and compile success must never be described as hardware proof.

## Opt-in, rollback, and later activation

`DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG` is disabled with backend `disabled`, hardware permission false, and automatic fallback false. A later bridge integration must explicitly select one worker backend before the session, inject the lighting/safe-off coordinator, and enforce version/capability parity. This PR does not edit or activate the production bridge.

Later Dell prerequisites are a reviewed protected trusted-rig file with the exact selector and new approved digest, matching calibration/orientation and `lens: null` while only a projective normalization transform is carried, installed .NET 8 x64, the licensed Pylon SDK/native runtime and hash-matched ignored managed dependency, reviewed output-root permissions/capacity, injected bridge lighting/safe-off coordination, and supervised Mark approval. Validation must first prove exact single-camera selection, all-setting application/readback, persistent ownership through preview/capture/resume, atomic evidence behavior, and the hardware targets below. None of those prerequisites is installed or activated by this PR.

Rollback is configuration-only for a future deployment: stop the native attempt, require injected safe-off completion, terminate the worker, disable/remove the native selection and ignored package, and select the existing PowerShell path for a new operator-started session. Never switch to PowerShell automatically inside a failed native attempt. No camera User Set, station startup, production environment, or database rollback is involved because native activation is absent here.

Rapid remains separate because its trigger correctness depends on Agent 2's corrected back epoch and light lifecycle plus hardware-validated native stability. This subsystem provides the needed removal fence, fresh back epoch, distinct frame IDs, corners, center/scale/rotation, motion delta, stale/frozen state, hysteresis, and exact frame identity. A later Rapid change may replace only the Capture Back click; it may never bypass Confirm, Publish, labels, comps, slab photos, or inventory.
