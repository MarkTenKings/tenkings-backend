# AI Grader Capture Helper

The AI Grader capture helper is the future local process boundary for rig/device control. The default implementation remains simulator/mock-only. The only opt-in real-hardware-adjacent paths are Arduino LED controller readiness, GRBL/OpenBuilds stage status readiness, and manual Dino-Lite DNVideoX enumeration; each requires explicit CLI/config input. Default health, readiness, manifests, transport, and tests never open cameras, microscopes, XY stages, arm interlocks, sockets, uploads, or database connections.

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
- `exit`

The fake bridge adapter is the default. It returns deterministic AF7915MZTL-like device metadata and simulated support flags for still capture, AMR, FLC, EDR, and EDOF. It never uses COM and does not require SDK files.

The real DNVideoX adapter is manual enumeration only. It does not instantiate `DNVideoX.ocx` during tests, CI, default bridge startup, fake mode, readiness, or normal health/capability commands. The only real COM path is the explicit `dinolite.enumerateDevices` command with `--adapter dnvideox --manual-enumerate`.

Manual enumeration creates the registered 32-bit ActiveX control through ProgID `VIDEOCAPX.VideoCapXCtrl.1` inside a hidden offscreen WinForms `AxHost`, calls `GetVideoDeviceCount`, then calls `GetVideoDeviceName` for detected indexes. It may also call `GetVideoDeviceDesc` and `GetDeviceID`; optional failures are reported without failing the whole enumeration when device count succeeds.

The hidden host is required because the vendor C#, VB6, HTML, and C++ samples all host DNVideoX as an ActiveX control with a control site/window. Plain COM activation could instantiate `DNVideoX.ocx` and read version `3, 0, 56, 6`, but it failed the enumeration path on the Dell capture node.

This slice does not set `Connected=True`, does not set `Preview=True`, and does not call capture/control methods for frame capture, LEDs, FLC, lens, focus, exposure, EDR, EDOF, DPQ, or microscope state.

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

The implemented real-adjacent adapters are Arduino LED readiness, GRBL stage status readiness, and manual Dino-Lite DNVideoX enumeration. They are not part of the runnable mock driver set and require explicit CLI/config/env before they can open serial or instantiate DNVideoX.

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
- keep Dino-Lite real DNVideoX work limited to manual enumeration until a later approved connect/preview/capture/control slice
