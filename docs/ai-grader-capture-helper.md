# AI Grader Capture Helper

The AI Grader capture helper is the future local process boundary for rig/device control. The default implementation remains simulator/mock-only. The only opt-in real-hardware-adjacent paths are Arduino LED controller readiness, GRBL/OpenBuilds stage status readiness, and manual Dino-Lite DNVideoX commands; each requires explicit CLI/config input. Default health, readiness, manifests, transport, and tests never open cameras, microscopes, XY stages, arm interlocks, sockets, uploads, or database connections.

## Local Usage

Build the package:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper build
```

Run the JSON CLI after building:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js health
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js capabilities
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js manifest --mode QUICK
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js manifest --mode STANDARD
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js manifest --mode AUTH_ONLY
```

Optional simulator inputs:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js manifest \
  --mode STANDARD \
  --session-id local-sim-session \
  --tenant-id local-tenant \
  --seed local-seed \
  --helper-instance-id local-helper
```

Hardware readiness validation is config-only and can be run before any real driver integration:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness \
  --driver-set real \
  --rig-mode readiness \
  --tenant-id local-tenant \
  --rig-id local-rig \
  --location-id local-location \
  --operator-id local-operator \
  --helper-instance-id local-helper
```

This returns JSON with `overallStatus`, config validation checks, expected devices, unsupported real-driver notices, calibration path checks, safety gate status, and discovery stub results. `driverSet=real` is fail-closed except for explicit Arduino LED readiness or GRBL stage status readiness with supplied ports; all other real drivers remain unimplemented.

Arduino LED controller readiness is the first opt-in real-hardware-adjacent slice. It is limited to opening one explicitly supplied serial port, sending `PING`, expecting `PONG`, sending `LED ALL OFF`, expecting `OK`, and closing the port:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js led-health \
  --port /dev/ttyACM0 \
  --baud 115200
```

The same check can be included in readiness only when all opt-ins are explicit:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness \
  --driver-set real \
  --rig-mode readiness \
  --led-controller arduino \
  --led-port /dev/ttyACM0 \
  --tenant-id local-tenant \
  --rig-id local-rig \
  --location-id local-location \
  --operator-id local-operator \
  --helper-instance-id local-helper
```

If no port is supplied, real Arduino readiness fails closed and does not open serial.

GRBL/OpenBuilds stage readiness is the second opt-in real-hardware-adjacent slice. It is limited to opening one explicitly supplied serial port, sending the safe GRBL status query `?`, parsing one status response such as `<Idle|MPos:0.000,0.000,0.000|FS:0,0>`, and closing the port:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js stage-health \
  --port /dev/ttyUSB0 \
  --baud 115200
```

The same check can be included in readiness only when all opt-ins are explicit:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness \
  --driver-set real \
  --rig-mode readiness \
  --stage grbl \
  --stage-port /dev/ttyUSB0 \
  --tenant-id local-tenant \
  --rig-id local-rig \
  --location-id local-location \
  --operator-id local-operator \
  --helper-instance-id local-helper
```

If no port is supplied, real GRBL stage readiness fails closed and does not open serial. This slice does not send `$H`, `G0`, `G1`, jogging, unlock, reset, spindle, coolant, or any movement/enabling commands.

The same values can be supplied through environment variables:

- `AI_GRADER_CAPTURE_HELPER_MODE`, only `simulator` is accepted
- `AI_GRADER_CAPTURE_HELPER_RIG_MODE`, `simulator` or `readiness`
- `AI_GRADER_CAPTURE_HELPER_DRIVER_SET`, `mock` for runnable helper commands; `real` is readiness-only and fail-closed
- `AI_GRADER_CAPTURE_HELPER_TENANT_ID`
- `AI_GRADER_CAPTURE_HELPER_SESSION_ID`
- `AI_GRADER_CAPTURE_HELPER_RIG_ID`
- `AI_GRADER_CAPTURE_HELPER_LOCATION_ID`
- `AI_GRADER_CAPTURE_HELPER_OPERATOR_ID`
- `AI_GRADER_CAPTURE_HELPER_INSTANCE_ID`
- `AI_GRADER_CAPTURE_HELPER_VERSION`
- `AI_GRADER_CAPTURE_HELPER_SEED`
- `AI_GRADER_CAPTURE_HELPER_CREATED_AT`
- `AI_GRADER_CAPTURE_HELPER_STORAGE_PREFIX`
- `AI_GRADER_CAPTURE_HELPER_CALIBRATION_IDS`, comma-separated
- `AI_GRADER_CAPTURE_HELPER_SURFACE_SUSPECT_IDS`, comma-separated
- `AI_GRADER_CAPTURE_HELPER_MACRO_CAMERA_SERIAL_HINT`
- `AI_GRADER_CAPTURE_HELPER_LED_CONTROLLER_SERIAL_HINT`
- `AI_GRADER_CAPTURE_HELPER_MICROSCOPE_SERIAL_HINT`
- `AI_GRADER_CAPTURE_HELPER_STAGE_SERIAL_HINT`
- `AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_SERIAL_HINT`
- `AI_GRADER_CAPTURE_HELPER_LED_CONTROLLER_KIND`, set to `arduino` for the opt-in Arduino readiness path
- `AI_GRADER_CAPTURE_HELPER_STAGE_KIND`, set to `grbl` or `openbuilds` for the opt-in GRBL stage readiness path
- `AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_PORT`
- `AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_BAUD_RATE`, default `115200`
- `AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_TIMEOUT_MS`, default `1000`
- `AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_OPEN_TIMEOUT_MS`, default `2000`
- `AI_GRADER_CAPTURE_HELPER_ARDUINO_LED_CLOSE_TIMEOUT_MS`, default `1000`
- `AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_PORT`
- `AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_BAUD_RATE`, default `115200`
- `AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_TIMEOUT_MS`, default `1000`
- `AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_OPEN_TIMEOUT_MS`, default `2000`
- `AI_GRADER_CAPTURE_HELPER_GRBL_STAGE_CLOSE_TIMEOUT_MS`, default `1000`
- `AI_GRADER_CAPTURE_HELPER_MACRO_CALIBRATION_PATH`
- `AI_GRADER_CAPTURE_HELPER_LED_CALIBRATION_PATH`
- `AI_GRADER_CAPTURE_HELPER_MICROSCOPE_CALIBRATION_PATH`
- `AI_GRADER_CAPTURE_HELPER_STAGE_CALIBRATION_PATH`
- `AI_GRADER_CAPTURE_HELPER_ARM_CALIBRATION_PATH`
- `AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_REQUIRED`
- `AI_GRADER_CAPTURE_HELPER_REQUIRE_CALIBRATION_ARTIFACTS`
- `AI_GRADER_CAPTURE_HELPER_TRANSPORT_HOST`, only loopback hosts are accepted
- `AI_GRADER_CAPTURE_HELPER_TRANSPORT_PORT`
- `TENKINGS_DINOLITE_SDK_RUNTIME_DIR`, optional outside-git DNVideoX helper runtime folder for manual Dino-Lite capture packages

## Local Transport

The local transport is disabled by default. It starts only when the explicit CLI command is run or when tests/importers call the transport start function directly:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js serve \
  --host 127.0.0.1 \
  --port 47650
```

The server binds only to loopback hosts. `127.0.0.1`, `localhost`, and `::1` are accepted; non-loopback hosts are rejected. It returns JSON only and exposes:

- `GET /health`
- `GET /readiness`
- `GET /capabilities`
- `POST /manifest` with `{"mode":"QUICK"}`, `{"mode":"STANDARD"}`, or `{"mode":"AUTH_ONLY"}`

The transport does not connect to a database, does not upload files, does not open device handles, and does not start unless explicitly requested.

## Hardware Readiness

The readiness path prepares the helper configuration boundary for future hardware work without touching physical devices. It checks:

- required identity fields: helper instance, rig, tenant, location, and operator ids
- driver set selection, including fail-closed `real`
- rig mode selection
- expected device list for macro camera, LED controller, microscope, XY stage, and arm interlock
- serial hints and calibration artifact paths when supplied
- arm interlock safety configuration

Calibration artifact paths are checked with filesystem existence only. A missing supplied path returns `WARN` by default and `FAIL` when `requireCalibrationArtifacts` is enabled.

Device discovery is intentionally stubbed. Mock discovery reports `NOT_PROBED`; real discovery reports `NOT_IMPLEMENTED`. No camera, USB, serial, GRBL, microscope, Basler, Dino-Lite, LED controller, stage, or interlock API is imported or opened by default readiness. The only exceptions are explicit Arduino and GRBL readiness health commands with supplied serial ports.

### Arduino LED Readiness

The Arduino LED readiness adapter assumes the v5 Appendix A ASCII serial protocol at `115200` baud:

- `PING` returns `PONG`
- `LED ALL OFF` returns `OK`

This slice intentionally does not implement `LED <ch> ON`, `LED <ch> OFF`, `STROBE`, image capture, frame manifests, uploads, grading math, or LED sequencing. The only LED command sent is the safe shutdown command `LED ALL OFF`, and the helper attempts it before closing any opened connection.

The package includes the `serialport` dependency only for explicit serial readiness paths. The module is dynamically imported by the shared serial transport only after an opt-in real readiness path is invoked with a port, so default health, readiness, simulator, mock driver, and transport tests do not import serial hardware code. Tests use fake serial transports and require no connected Arduino or GRBL controller.

### GRBL Stage Readiness

The GRBL/OpenBuilds stage readiness adapter assumes a standard GRBL ASCII serial status response at `115200` baud:

- `?` returns a bracketed status line such as `<Idle|MPos:0.000,0.000,0.000|FS:0,0>`

This slice intentionally does not implement homing, motion, jogging, unlock, reset, spindle, coolant, camera/microscope coordination, image capture, frame manifests, uploads, or grading math. It never sends `$H`, `G0`, `G1`, `$J`, `$X`, reset, spindle, coolant, or any movement/enabling command. Homing and motion must wait for a later approved slice after mechanical bounds, soft limits, hard limits, fixture coordinates, and emergency stop behavior are defined and tested.

The GRBL stage adapter reuses the same serial-line transport abstraction as Arduino readiness. The `serialport` module is dynamically imported only when the explicit real serial path is invoked with a port. Fake serial tests cover status success, timeout failure, malformed status failure, fail-closed missing-port readiness, and no emitted motion command strings.

### Dino-Lite Bridge Skeleton

The Dino-Lite bridge is a Windows-only out-of-process boundary under `packages/ai-grader-dinolite-bridge`. It targets .NET Framework 4.8, x86, and an STA entry point because DNVideoX is a registered 32-bit ActiveX/COM control. The bridge uses stdio JSON Lines so the TypeScript helper can spawn it manually without adding another localhost port.

Supported bridge JSONL commands:

- `health`
- `sdkInfo`
- `listDevices`
- `capabilities`
- `dinolite.enumerateDevices`
- `dinolite.status`
- `dinolite.captureStillJpg`
- `dinolite.getLightingStatus`
- `dinolite.setLightingRecipe`
- `dinolite.runtimeDiagnostics`
- `dinolite.capturePackage`
- `dinolite.captureDemoPackage`
- `dinolite.operatorWorkflow`
- `exit`

The fake bridge adapter is the default. It returns deterministic AF7915MZTL-like device metadata and simulated support flags for still capture, AMR, FLC, EDR, and EDOF. It never uses COM and does not require SDK files.

The real DNVideoX adapter is manual-only. It does not instantiate `DNVideoX.ocx` during tests, CI, default bridge startup, fake mode, readiness, or normal health/capability commands. The real COM paths are explicit `dinolite.enumerateDevices`, `dinolite.status`, `dinolite.captureStillJpg`, `dinolite.capturePackage`, and `dinolite.operatorWorkflow` commands with `--adapter dnvideox` plus the manual bridge flag set by the capture-helper CLI.

Manual enumeration creates the registered 32-bit ActiveX control through ProgID `VIDEOCAPX.VideoCapXCtrl.1` inside a hidden offscreen WinForms `AxHost`, calls `GetVideoDeviceCount`, then calls `GetVideoDeviceName` for detected indexes. It may also call `GetVideoDeviceDesc` and `GetDeviceID`; optional failures are reported without failing the whole enumeration when device count succeeds.

The hidden host is required because the vendor C#, VB6, HTML, and C++ samples all host DNVideoX as an ActiveX control with a control site/window. Plain COM activation could instantiate `DNVideoX.ocx` and read version `3, 0, 56, 6`, but it failed the enumeration path on the Dell capture node.

Enumeration does not set `Connected=True`, does not set `Preview=True`, and does not call capture/control methods. Manual status sets `Connected=True` only for the command, reads approved status fields, and disconnects in `finally`. Manual still capture sets `Connected=True`, enables `Preview=True` for `SaveFrameJPG` based on the vendor sample capture flow, saves one JPG to an explicit outside-git output directory, hashes it, then disables preview and disconnects in `finally`.

Capture-helper readiness reports whether a Dino-Lite bridge path is configured, but default readiness does not spawn the bridge. The only manual command added in this slice is fake bridge health:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-bridge-health \
  --bridge-path packages/ai-grader-dinolite-bridge/src/TenKings.AiGrader.DinoLiteBridge/bin/x86/Release/net48/TenKings.AiGrader.DinoLiteBridge.exe \
  --bridge-adapter fake
```

Manual fake enumeration smoke:

```sh
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-enumerate \
  --bridge-exe packages/ai-grader-dinolite-bridge/src/TenKings.AiGrader.DinoLiteBridge/bin/x86/Release/net48/TenKings.AiGrader.DinoLiteBridge.exe \
  --adapter fake
```

Manual real DNVideoX enumeration, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-enumerate `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --bridge-timeout-ms 10000
```

Local Dell smoke on 2026-06-09 after the hidden-host fix returned one device: `comActiveXInstantiated=true`, `connected=false`, `preview=false`, `deviceCount=1`, `devices[0].name=Dino-Lite Edge`, `devices[0].description=""`, OCX version `3, 0, 56, 6`, `host=hidden-winforms-axhost`, `optionalErrors=[]`. The `GetDeviceID` value was present and is intentionally omitted from docs except for USB VID/PID evidence: `vid_a168&pid_0990`. No `Connected=True`, `Preview=True`, capture, LED/FLC/lens/focus/exposure/EDR/EDOF/DPQ, or control command was used.

Manual real DNVideoX status, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-status `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --device-index 0 `
  --bridge-timeout-ms 15000
```

Manual real DNVideoX still JPG capture, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-capture-still `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --device-index 0 `
  --output-dir C:\TenKings\capture-data\dinolite-smoke `
  --bridge-timeout-ms 15000
```

Local Dell smoke on 2026-06-09 for manual status returned `comActiveXInstantiated=true`, OCX version `3, 0, 56, 6`, device `Dino-Lite Edge`, config bitfield `198`, decoded `amr=true` and `axi=true`, AMR `0`, exposure value `1048575`, gain `239`, auto exposure `0`, LED state `0`, `connectedDuringCommand=true`, `previewDuringCommand=false`, and cleanup `disconnected=true`, `hostDisposed=true`. `GetVideoFormat` and `GetLensPosLimits` returned optional type-mismatch errors and did not fail the command. Device ID was present and is redacted except for USB VID/PID `vid_a168&pid_0990`.

Local Dell smoke on 2026-06-09 for manual still JPG capture wrote `C:\TenKings\capture-data\dinolite-smoke\dinolite-still-20260609T184302837Z.jpg` outside git, `sha256=96eb68bc57756e01f35a819b403d3baa088c9d6c65216383d9faa18d3de168fb`, `byteSize=67326`, `mimeType=image/jpeg`, `connectedDuringCommand=true`, `previewDuringCommand=true`, and cleanup `previewStopped=true`, `disconnected=true`, `hostDisposed=true`. `Preview=True` was used for capture because the vendor sample capture flow enables preview before `SaveFrameJPG`; no second capture was run to test a no-preview path.

Manual real DNVideoX demo capture package, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-capture-demo-package `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --device-index 0 `
  --output-dir C:\TenKings\capture-data\dinolite-demo `
  --label card-demo-001 `
  --sdk-runtime-dir C:\TenKings\sdk\dino-lite\dnvideox-sdk `
  --include-lighting-sweep `
  --include-edr `
  --include-edof `
  --bridge-timeout-ms 60000
```

The optional `--sdk-runtime-dir` flag, or `TENKINGS_DINOLITE_SDK_RUNTIME_DIR`, points the bridge at a DNVideoX helper runtime directory outside git. The bridge validates the directory is outside the repo and reports required helper presence for `enfuse.exe`, `SMIUtility.dll`, and `d3dx9_31.dll`, plus optional VC90/helper files. During the explicit manual capture package command only, when the runtime directory is usable, the bridge temporarily sets the process current directory and Win32 DLL search directory to that runtime directory, then restores both in `finally`. Vendor runtime files must not be copied into the repo.

Local Dell smoke on 2026-06-09 with SDK runtime support wrote package folder `C:\TenKings\capture-data\dinolite-demo\dinolite-card-demo-001-20260609T234417886Z` outside git. The package contains `manifest.json`, `preview-report.html`, one normal JPG, four small lighting JPGs, one EDR JPG, and one EDOF JPG. Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`.

Earlier PR #29 smoke without SDK runtime support wrote normal, lighting sweep, and EDR outputs, but EDOF did not produce a file. `SaveEDOF(0, 3, path)` returned SDK result `1`, then timed out waiting for `edof.jpg`; diagnostics showed `enfuse.exe`, `SMIUtility.dll`, and `d3dx9_31.dll` absent from both the bridge executable directory and current working directory.

Updated PR #30 smoke with `--sdk-runtime-dir C:\TenKings\sdk\dino-lite\dnvideox-sdk` reported all required EDOF helper files present outside git and `edofHelperAvailable=true`. Captures succeeded for normal still (`sha256=68c67b2d31b734041028fd29683ddc074e9270f9f83d87896d6949080fa0f33c`, `byteSize=67640`), LED/FLC lighting sweep (`all-leds-on-normal`, `flc-all-level-3`, `flc-quadrant-1-level-4`, `flc-quadrant-2-level-4`), EDR (`sha256=8243097c7598e1a7855ae2cdaee0fc63964b651749143418889eb3bf01093fd6`, `byteSize=507954`), and EDOF (`sha256=5fefc49b0e562758be57c8f2154eedee213b65e96c6f54aba4aed57435def226`, `byteSize=359574`). `SaveEDOF(0, 3, path)` returned SDK result `1` and produced `edof.jpg`.

Cleanup reported `previewStopped=true`, `disconnected=true`, `hostDisposed=true`, no cleanup errors, and final safe FLC restore via `SetFLCLevel(0,3)` and `SetFLCSwitch(0,15)`.

The package preview report is local static HTML only and includes the required text `Dino-Lite capture package preview -- not a certified grade.` No DB writes, uploads, production report, certificate, or grade claim are produced by this command.

Manual real DNVideoX operator workflow, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-operator-workflow `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --device-index 0 `
  --output-dir C:\TenKings\capture-data\dinolite-operator `
  --plan operator-smoke-single `
  --sdk-runtime-dir C:\TenKings\sdk\dino-lite\dnvideox-sdk `
  --bridge-timeout-ms 1200000
```

Manual experimental Dino-Lite grading run, for the Dell Windows capture node only:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js dinolite-experimental-grading-run `
  --bridge-exe C:\TenKings\repos\tenkings-rip-it-live\packages\ai-grader-dinolite-bridge\src\TenKings.AiGrader.DinoLiteBridge\bin\x86\Release\net48\TenKings.AiGrader.DinoLiteBridge.exe `
  --adapter dnvideox `
  --device-index 0 `
  --output-dir C:\TenKings\capture-data\dinolite-grading-runs `
  --label card-experimental-001 `
  --sdk-runtime-dir C:\TenKings\sdk\dino-lite\dnvideox-sdk `
  --corner-profile sharp_90 `
  --capture-guides true `
  --bridge-timeout-ms 1800000
```

The operator workflow opens a local Windows preview window using the DNVideoX-hosted ActiveX control. The operator sees target name, target type, instructions, capture count, and manual fallback mode text. Controls are `Capture / continue`, `Skip target`, `Retake current target`, and `Abort session safely`. The default capture set is normal JPG only; optional flags are `--include-flc-sweep`, `--include-edr`, and `--include-edof`. The TypeScript stdio client leaves manual hardware child windows visible; default health/readiness paths still do not spawn the bridge.

Built-in operator plans:

- `operator-smoke-single`: one center-surface target for supervised window/capture smoke.
- `corners-basic`: top-left, top-right, bottom-right, and bottom-left corners.
- `surface-basic`: center, upper, and lower surface targets.
- `card-basic`: four corners plus center surface.
- `card-interim`: full-card overview, four corners, and center surface.
- `experimental-card-grading`: interim full-card overview, four corners, four edge midpoints, and center/upper/lower surface.

The `card-interim` overview target is intentionally labeled `interim_full_card_overview` with target type `interim_macro_overview`. The preview/report/manifest state that this overview is not production macro evidence, not calibrated macro capture, and not certified grading evidence. After the overview capture, the preview window instructs the operator to zoom/refocus for close-up detail captures before continuing. This is a manual fallback workflow until GRBL stage motion and dedicated macro camera evidence are integrated.

Operator workflow output is a local session folder outside git with `manifest.json`, `preview-report.html`, target-level artifact metadata, SHA-256 hashes, byte sizes, MIME type, timestamps, and no embedded image data. No DB writes, uploads, production report, certificate, final AI grade, or certified grading claim are produced by this command.

The experimental grading run is explicit and manual-only. It launches the `experimental-card-grading` operator plan, captures normal JPG targets by default, then runs deterministic local pixel analysis in the capture-helper process. The analysis writes `analysis.json` and replaces `preview-report.html` with `Experimental AI Grader Test Run - Not Certified`.

Algorithm provenance:

- `algorithmVersion`: `tenkings-dinolite-grading-v0.1`
- `thresholdSetVersion`: `tenkings-dinolite-thresholds-v0.1`

The v0.1 analyzers are pure TypeScript helpers under `packages/ai-grader-capture-helper/src/experimentalGrading.ts`. They use `sharp` only to decode local JPG files into pixels; no Windows bridge, DNVideoX, database, upload, Next.js/browser, or production runtime path imports the analyzer by default. The analyzer computes:

- centering from the interim overview when outer/inner rectangles can be detected
- corner defect-density proxy scores from four close-up corner targets, partial only when at least three corners exist
- edge whitening/dark/scratch/roughness proxy scores from edge midpoint targets
- surface speck/scratch/texture proxy scores from surface targets
- overall experimental fusion only when corners and surface are computed and at least one of centering or edges is computed

If detection or inputs are insufficient, the relevant result is `not_computed` with a reason and no placeholder score. All scores are labeled experimental and unvalidated. The report states the output is not a certified grade, not a certificate, not calibrated production macro evidence, and not a final AI grade.

PR #33 improves report clarity without changing the v0.1 scoring formulas, weights, thresholds, or fusion caps. Generated `analysis.json` and `preview-report.html` now include:

- score scale: all computed element scores are `1.0` to `10.0`, higher is better, displayed as `x.xx / 10`
- score bands: `9.0-10.0 Excellent`, `8.0-8.9 Very Good`, `7.0-7.9 Good`, `6.0-6.9 Fair / Review`, and below `6.0 Needs Review`
- element definitions for centering, corners, edges, and surface
- perfect `10/10` definitions for centering, corners, edges, surface, and overall
- "Why this score?" sections with top contributing metrics, top penalties, confidence, affected target images, limitations, and quality warnings
- quality diagnostics per target: card coverage estimate, background risk, sharpness/blur risk, brightness mean, contrast range, over/underexposure risk, target alignment confidence, and warnings such as possible background interference, low card coverage, target may not be centered, image may be blurry, lighting may be uneven, and score confidence reduced
- operator options metadata including `cornerProfile=sharp_90` and whether capture guides were enabled

The operator preview workflow now passes optional guide/profile metadata through the JSONL bridge protocol. The visible Windows operator panel shows guide text for each target class:

- full-card overview: fit as much of the card as possible, avoid background, keep card edges visible, and label it interim/not calibrated macro capture
- corner targets: place the corner tip at the center guide, include both edges, fill the frame mostly with card, avoid background, and use the `sharp_90` corner profile
- edge targets: align top/bottom edges with the horizontal guide and left/right edges with the vertical guide
- surface targets: fill the central patch with card surface only and avoid border/background

`--corner-profile sharp_90` is the only active corner profile in this slice. Unsupported values fail before spawning the bridge. `--capture-guides true|false` defaults to `true`; when enabled, guide metadata is recorded in the manifest and shown in the preview workflow. These changes are guidance and diagnostics only; they do not create fake/manual scores and do not retune analysis thresholds.

Local Dell supervised PR #33 smoke on 2026-06-10 used `dinolite-experimental-grading-run --corner-profile sharp_90 --capture-guides true`, normal JPG only, and output outside git at `C:\TenKings\capture-data\dinolite-grading-runs\dinolite-operator-report-diagnostics-smoke-20260610T082201807Z`. It completed `status=completed` with 12 captured targets, `manifest.json`, `analysis.json`, and `preview-report.html`. The report includes score scale, perfect `10/10` definitions, "Why this score?" sections, and quality warning summary. Computed outputs were centering `10.00 / 10`, corners `6.49 / 10`, edges `2.17 / 10`, surface `1.00 / 10`, and overall `5.13 / 10` (`Needs Review`, confidence `0.71`). Quality diagnostics recorded warnings on 11 targets, mostly blur/underexposure risk. Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`.

Local Dell supervised smoke on 2026-06-09/2026-06-10 used `operator-smoke-single` after fixing the child-process hidden-window spawn option. The operator window appeared as `Ten Kings Dino-Lite Operator Workflow`, Mark clicked `Capture / continue`, and the command completed with `status=completed`, `connectedDuringCommand=true`, `previewDuringCommand=true`, and cleanup `previewStopped=true`, `disconnected=true`, `hostDisposed=true`. Output folder: `C:\TenKings\capture-data\dinolite-operator\dinolite-operator-operator-smoke-single-20260610T034854043Z`. It contains `manifest.json`, `preview-report.html`, and `01-center-surface-attempt-01-normal.jpg` (`sha256=74016465bd7ee8a00c033f98ac72047abb3b302b40c33d7314f44baf42a9fd5f`, `byteSize=130542`). Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`. The optional `card-interim` run was deferred because the single-target supervised workflow proved the visible operator flow.

SDK binaries, OCX files, and DNVideoX DLLs must remain outside git. Do not run `regsvr32` from this repo flow.

## Simulator-First Limitation

This package defaults to simulator mode with the mock driver set and rejects any runnable backend other than simulator/mock. The exceptions are the explicit Arduino LED and GRBL stage readiness command/paths described above, which perform only serial `PING` plus `LED ALL OFF` and GRBL `?` status query respectively. The simulator path uses `@tenkings/ai-grader-simulator` to generate:

- `DeviceCapabilityManifest[]`
- QUICK `CaptureManifest`
- STANDARD `CaptureManifest` plus mock micro spot packages/evidence metadata
- AUTH_ONLY `CaptureManifest`

Generated payloads are validated with shared AI Grader validators. The basic CLI commands print JSON and exit; the local HTTP transport runs only when `serve` is explicitly invoked.

## Driver Boundary

The capture helper exposes TypeScript driver contracts for the future physical device boundary:

- `DeviceDriver`
- `MacroCameraDriver`
- `LEDControllerDriver`
- `MicroscopeDriver`
- `StageDriver`
- `ArmInterlockDriver`

The runnable driver set is `mock` only. `real` is accepted by readiness reporting for fail-closed real-driver validation and, when explicitly configured with `ledController=arduino` plus a port or `stage=grbl` plus a port, the corresponding readiness health check. Mock drivers provide:

- `open()`, `close()`, and `health_check()` lifecycle behavior
- `DeviceCapabilityManifest` metadata compatible with shared validators
- deterministic fake macro frame and microscope evidence metadata
- LED, stage, and arm-interlock state methods that operate entirely in memory
- explicit failure injection for tests

The mock driver set never imports Basler, Dino-Lite, serial, GRBL, camera, USB, or microscope SDKs. It does not open OS device handles or sockets.

The implemented real-adjacent adapters are Arduino LED readiness, GRBL stage status readiness, and manual Dino-Lite DNVideoX enumeration/status/still JPG/package/operator workflow/experimental grading capture. They are not part of the runnable mock driver set and require explicit CLI/config/env before they can open serial or instantiate DNVideoX.

## Future Hardware Boundary

The future hardware-backed helper should add drivers behind an explicit backend boundary instead of changing simulator behavior. The intended separation is:

- config/backend selection
- driver set selection and dependency injection
- device capability discovery
- capture package execution
- artifact upload/checksum handoff
- API/transport layer to the Ten Kings app

Future UI/helper bridge work should point admin tooling at the loopback transport while keeping API/UI feature gates in place. Future real driver work should add adapters behind the existing interfaces, keep mock drivers as the default test path, and require an explicit approved hardware integration phase before physical device access is enabled.

Before the first real hardware driver integration:

- approve the production/staging AI Grader migration path separately
- keep the helper loopback-only by default
- add one physical adapter behind the existing driver interface at a time
- keep mock drivers as the default test path
- add SDK dependencies only in the approved hardware slice
- require a readiness report with configured rig/helper/operator ids and calibration paths
- keep real discovery non-invasive until the specific device adapter is reviewed
- keep Arduino LED readiness limited to `PING` and `LED ALL OFF` until a later approved LED control slice
- keep GRBL stage readiness limited to `?` status query until mechanical bounds and emergency stop behavior are defined
- keep Dino-Lite real DNVideoX work limited to manual enumerate/status/still JPG/demo package/operator workflow/experimental non-certified grading capture, including outside-git SDK runtime diagnostics for EDOF, until a later approved lens/focus/exposure/DPQ/certified-grading slice
