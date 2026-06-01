# AI Grader Capture Helper

The AI Grader capture helper is the future local process boundary for rig/device control. The current implementation is a simulator-only skeleton. It never opens cameras, LED controllers, microscopes, XY stages, arm interlocks, sockets, or database connections.

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

This returns JSON with `overallStatus`, config validation checks, expected devices, unsupported real-driver notices, calibration path checks, safety gate status, and discovery stub results. `driverSet=real` is recognized only for readiness reporting and returns a fail-closed status until real drivers are implemented.

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

Device discovery is intentionally stubbed. Mock discovery reports `NOT_PROBED`; real discovery reports `NOT_IMPLEMENTED`. No camera, USB, serial, GRBL, microscope, Basler, Dino-Lite, LED controller, stage, or interlock API is imported or opened.

## Simulator-Only Limitation

This package defaults to simulator mode with the mock driver set and rejects any other backend or driver set. It uses `@tenkings/ai-grader-simulator` to generate:

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

The runnable driver set is `mock` only. `real` is accepted by readiness reporting solely to return a fail-closed configuration report. Mock drivers provide:

- `open()`, `close()`, and `health_check()` lifecycle behavior
- `DeviceCapabilityManifest` metadata compatible with shared validators
- deterministic fake macro frame and microscope evidence metadata
- LED, stage, and arm-interlock state methods that operate entirely in memory
- explicit failure injection for tests

The mock driver set never imports Basler, Dino-Lite, serial, GRBL, camera, USB, or microscope SDKs. It does not open OS device handles or sockets.

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
