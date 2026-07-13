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
idle_safe/faulted -> shutdown
```

`faulted` is terminal for that attempt. A retry requires a new worker/session and an explicit operator action.

## Local process protocol

The protocol is newline-delimited JSON over child stdin/stdout. It never opens HTTP or a listening port. `stdout` is protocol only; bounded redacted diagnostics use `stderr`.

- Version: `tenkings.ai-grader.native-camera.v1`
- Maximum line: 1 MiB, including preview JPEG base64. Encoders cap JPEG bytes before publication and may reduce quality and display dimensions; `jpeg.width`/`jpeg.height` make the raw-geometry-to-display scale explicit while frame identity remains unchanged.
- Request IDs: 1-64 allowlisted ASCII characters; session IDs: 1-128.
- Every envelope carries request/session identity, worker/session/preview/side epochs, side, timeout, Unix deadline, and monotonically increasing sequence.
- Exact 64-bit Pylon BlockID and hardware timestamp ticks are decimal strings, never JavaScript numbers.
- Unknown/duplicate fields, malformed/empty/truncated/oversize lines, expired requests, stale epochs, wrong order, wrong frame identity, and incoherent Ready geometry fail closed.
- Duplicate request IDs are bounded and rejected; a changed duplicate body terminally faults the protocol.

Commands are `initialize`, `health`, `capabilities`, `start_preview`, `stop_drain`, `set_side`, `execute_forensic_plan`, `lighting_ack`, `lighting_completion`, `safe_off_completion`, `resume_preview`, `safe_idle`, and `shutdown`. Events are `preview_frame`, `lighting_profile_requested`, `lighting_grab_completed`, `safe_off_requested`, and `terminal_fault`.

Successful results include a strict path-free timing snapshot. Preview events bind the JPEG hash/body, raw-frame geometry, BlockID/timestamp, epochs/side, receive/detect/encode/emit monotonic timings, frame age, drop counts, frozen flag, and hysteresis to the same exact frame.

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

`full_forensic` stores lossless Mono8 PNG; `production_fast` stores lossless Mono8 TIFF. The profile is explicit. Missing, duplicate, reordered, overwritten, dimension-mismatched, frozen/reused-frame, or partially written roles fail the whole attempt.

Writes use a unique temporary file, flush to disk, and atomically move to a non-existing final name. Results include role/side, exact frame/epochs, capture receive time, BlockID/hardware ticks, dimensions, SHA-256, byte size, MIME, and grab/write/hash timing. Paths are local-only and are not copied into public health or geometry.

The raw `all_on` Mono8 frame is analyzed at full resolution before encoding. Its frame/hash and 3x3 projective transform are authoritative for the side. `accepted_profile` and channels 1-8 must share its dimensions/epochs/side and reuse that transform; `dark_control` is not mixed into normalized pixels without registration. Existing downstream normalization remains exactly `1200x1680` portrait, and every raw role remains immutable.

## Four-edge detector

Input is a bounded Mono8 buffer with width, height, stride, exact frame identity, epochs, side, monotonic receive time, drop count, and calibration. Calibration supplies a safe normalized ROI and optional camera matrix/distortion coefficients.

The fused detector performs:

1. ROI clipping and optional undistortion.
2. Reusable OpenCV buffers, mild Gaussian denoise, and CLAHE local contrast.
3. Bright and dark adaptive thresholds plus Canny gradients.
4. Morphological gap closing.
5. External contours, convex hull, and `approxPolyDP` quadrilateral candidates.
6. Incomplete-boundary recovery from segments and robust fitted lines.
7. Two plausible parallel line pairs and four intersections.
8. Independent edge gradient/continuity/residual scoring plus convexity, aspect, coverage, clearance/full visibility, and perspective.
9. Bounded corner refinement and source-to-`1200x1680` homography.
10. Epoch-scoped temporal evidence with display-only high-response smoothing and short Ready hysteresis.
11. Immediate evidence reset on stale, frozen, wrong-epoch, clipped, low-confidence, or inconsistent frames.

Source corners remain current unsmoothed evidence; only display corners are smoothed. Ready always requires the current frame to qualify. The detector never infers printed top/bottom, never substitutes a fixture boundary, and never fabricates an edge without gradient support. Honest missing support is `not_detected`; a credible but unsafe/clipped shape is `adjust_card`.

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

Add `--cpu-load-ms <bounded-ms>` to exercise the concurrent CPU-load path. A private corpus belongs only under the gitignored `native/fixtures/private` directory. Private manifest rows must use allowlisted relative paths, permitted SHA-256 hashes, dimensions, side/pair identity, and ground truth. Absolute paths, traversal, device identity, and unapproved hashes are rejected.

Package framework-dependent fake/replay workers without installing them:

```powershell
pnpm run native:package
```

Output is confined to gitignored `native/publish`. Packaging does not start a worker.

### Compile the Pylon host without executing it

The Pylon project is inert by default and compiles an SDK-disabled guard. To compile the real adapter, first run locked restore, then pass an installed SDK assembly or root:

```powershell
pnpm run native:build:pylon -- -PylonAssemblyPath '<installed-sdk>/Development/Assemblies/Basler.Pylon/net8.0/x64/Basler.Pylon.dll'
```

Safe installed-SDK discovery is also supported. The build validates the assembly exists and sets `Private=false`; it never copies a proprietary SDK binary into source control. `build-pylon-host.ps1` only compiles. It never runs the executable, initializes pylon, enumerates a camera, or opens/configures/grabs from hardware.

The runtime adapter constructor requires an internal activation permit. The host refuses to proceed unless the build included the SDK and all three explicit runtime acknowledgments are present. Those flags are intentionally not part of normal test, build, package, startup, station, or bridge paths. Do not run the Pylon host until a later Mark-approved Dell procedure.

## Offline evaluator and current evidence limits

The committed redacted manifest covers paired front/back cases; black, white, and neutral plates; same-tone borders; foil/glare/shadow; worn corners; rotations through plus/minus 35 degrees; perspective, translation, clipping; no card; hands; ruler; wrong object; frozen frames; and epoch changes. The CLI compares the current PCA-style baseline, contour quad, line recovery, and fused detector. Tests verify deterministic geometry/classification, projective transforms, temporal resets, CPU-load execution, and report schema.

Committed JSON and Markdown reports are synthetic/adversarial engineering regression evidence only. They do not establish Dell timing, production accuracy, front/back parity, or safe production thresholds. The report lists missing real-corpus categories explicitly, including approved blinded Dell Mono8 front/back frames, real plates/lighting/material prevalence, approved negatives, and hardware BlockID/age/load measurements.

The existing TypeScript/Sharp detector remains the offline/full-resolution comparator and downstream compatibility contract. No grading, Surface Intelligence, Vision Lab, finding, report, Confirm, Publish, label, slab, comps, inventory, or public-report algorithm changes are made here.

## Timing telemetry

The worker uses monotonic durations and never treats JPEG completion as capture time. Result snapshots reserve separate measurements for spawn-to-initialize, pylon initialize, discovery, camera open, configure, first preview frame, detect, encode, emit, drain, mode switch, lighting acknowledgment, first forensic frame, forensic grabs, writes, hashes, resume, and drops. Preview events include per-frame receive/detect/encode/emit time and frame age. Forensic evidence uses the raw frame's receive time plus hardware BlockID/timestamp when available.

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

Rollback is configuration-only for a future deployment: stop the native attempt, require injected safe-off completion, terminate the worker, and select the existing PowerShell path for a new operator-started session. Never switch to PowerShell automatically inside a failed native attempt.

Rapid remains separate because its trigger correctness depends on Agent 2's corrected back epoch and light lifecycle plus hardware-validated native stability. This subsystem provides the needed removal fence, fresh back epoch, distinct frame IDs, corners, center/scale/rotation, motion delta, stale/frozen state, hysteresis, and exact frame identity. A later Rapid change may replace only the Capture Back click; it may never bypass Confirm, Publish, labels, comps, slab photos, or inventory.
