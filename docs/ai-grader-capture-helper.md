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

The same values can be supplied through environment variables:

- `AI_GRADER_CAPTURE_HELPER_MODE`, only `simulator` is accepted
- `AI_GRADER_CAPTURE_HELPER_DRIVER_SET`, only `mock` is accepted
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
- `GET /capabilities`
- `POST /manifest` with `{"mode":"QUICK"}`, `{"mode":"STANDARD"}`, or `{"mode":"AUTH_ONLY"}`

The transport does not connect to a database, does not upload files, does not open device handles, and does not start unless explicitly requested.

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

The current driver set is `mock` only. Mock drivers provide:

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
