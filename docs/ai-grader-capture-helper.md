# AI Grader Capture Helper

The AI Grader capture helper is the future local process boundary for rig/device control. The default implementation remains simulator/mock-only. The only opt-in real-hardware-adjacent paths are Arduino auxiliary LED readiness, GRBL/OpenBuilds stage status readiness, manual Leimac IDMU-P Ethernet readiness/status/guarded low-duty trigger-profile/polarity commands, manual Dino-Lite DNVideoX commands, and manual Basler pylon GigE readiness/list/Line2/still capture commands; each requires explicit CLI/config input. Default health, readiness, manifests, transport, and tests never open cameras, microscopes, Leimac controllers, XY stages, arm interlocks, sockets, uploads, or database connections.

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

This returns JSON with `overallStatus`, config validation checks, expected devices, unsupported real-driver notices, calibration path checks, safety gate status, and discovery stub results. `driverSet=real` is fail-closed except for explicit Arduino auxiliary LED readiness or GRBL stage status readiness with supplied ports; all other default readiness drivers remain unimplemented. Leimac IDMU-P Ethernet readiness is intentionally a separate manual CLI path requiring an explicit host.

Leimac IDMU-P Ethernet readiness is the production lighting-controller direction for this Dell rig. It is limited to a TCP connection to one explicit controller IP/port and sends only read commands from the hard allowlist:

- `08` status / error status, unit-targeted as `R0801` for base unit 1 and system-targeted as `R0800`
- `16` firmware version, unit-targeted as `R1601` for base unit 1
- `47` operation mode, targetless as `R47`
- `80` temperature data, unit-targeted as `R8001` for base unit 1
- `83` unit information, confirmed as `R830000` on the Dell Leimac controller

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-readiness `
  --host 169.254.191.156 `
  --port 1000 `
  --timeout-ms 1500

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-status `
  --host 169.254.191.156 `
  --port 1000 `
  --timeout-ms 1500

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-read-frame `
  --host 169.254.191.156 `
  --port 1000 `
  --frame R0801 `
  --timeout-ms 2000

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-trigger-sync-plan `
  --mode basler-exposure-active-to-trg-in1
```

The Leimac IDMU command path rejects missing/invalid hosts, rejects discovery port `50001` as a command port, rejects unknown commands, and rejects all `W` write commands. The result includes the raw request frame, raw response text, parsed fields only when the parser is confident enough, controller address/port/timeout metadata, and safety flags: `writesAllowed=false`, `lightsCommanded=false`, `outputSettingsChanged=false`, and `triggerSettingsChanged=false`.

The IDMU-P manual command order is header, command number, target designation/unit where required, then data. The manual write example `W 01 01 0001` serializes as the exact ASCII frame `W01010001` with no implicit CR/LF terminator; this repo includes that composer only as an explicit test helper, while every runtime/hardware path still rejects `W` writes.

`leimac-idmu-read-frame` is a manual read-only diagnostic path for a single operator-supplied frame from the manual. It requires explicit `--host` and `--frame`, uses no implicit CR/LF terminator, sends no retries, and rejects frames that do not start with `R`, contain `W`, include non-uppercase-ASCII-alphanumeric characters, exceed `32` characters, or use command numbers outside the PR #35 read allowlist (`08`, `16`, `47`, `80`, `83`).

`leimac-idmu-trigger-sync-plan` is dry-run only. It does not open Basler hardware, does not connect to Leimac hardware, and reports `dryRun=true`, `writesApplied=false`, `lightsCommanded=false`, `baslerSettingsChanged=false`, and `leimacSettingsChanged=false`.

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

If no port is supplied, real Arduino readiness fails closed and does not open serial. The Arduino Mega + MOSFET path is superseded for Leimac lighting control on this rig. Arduino may remain useful later for interlocks, buttons, sensors, emergency stop, or auxiliary devices.

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
- `AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT`, optional pylon install root override for manual Basler commands
- `AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL`, optional lens model label for manual Basler smoke metadata
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
- `TENKINGS_BASLER_PYLON_ROOT`, optional pylon install root override for manual Basler commands
- `TENKINGS_BASLER_LENS_MODEL`, optional lens model label for manual Basler smoke metadata

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

Device discovery is intentionally stubbed. Mock discovery reports `NOT_PROBED`; real discovery reports `NOT_IMPLEMENTED`. No camera, USB, serial, GRBL, microscope, Basler, Dino-Lite, Leimac, LED controller, stage, or interlock API is imported or opened by default readiness. The only exceptions are explicit Arduino and GRBL readiness health commands with supplied serial ports. Leimac IDMU-P readiness remains a separate explicit-host command and does not run from ordinary readiness.

### Leimac IDMU-P Ethernet Readiness

PR #35 adds a manual-only read path for Leimac IDMU-P Series PWM Dimming Unit for LED Lighting controllers. PR #36 adds the guarded transient Basler Line2 / Leimac TRG IN1 sync foundation and low-duty smoke command surface. The Dell rig controller is confirmed as `IDMU-P8B-24`; the base unit owns LAN communication and edge/expansion units are controlled through the base-unit bus connector. This replaces the old production-lighting assumption that the Leimac dome is controlled primarily by Arduino Mega + MOSFET channels on this rig.

Relevant vendor manual facts recorded for this rig:

- Setup/control is through LAN communication.
- Supported control protocols are Leimac ASCII commands over TCP/IP or UDP/IP and GigE Vision / GenICam.
- Leimac ASCII command order is `Header + CommandNumber + TargetDesignation/UnitNumber + Data`; command number precedes target/unit.
- Default first Leimac command TCP port is `1000`; the four command ports are `1000` through `1003` by default.
- UDP command port uses the same first command port.
- Port `50001` is Leimac Discovery and is not valid as the first command port.
- Fixed default IP is `192.168.0.30`, but fixed IP is disabled by default.
- DHCP is enabled, and LLA is enabled and cannot be changed, so a `169.254.x.x` address is expected on a direct/no-DHCP rig network.
- Base unit is unit `1`; edge units are units `2` through `5`.
- Lighting outputs are PWM at approximately `125 kHz` with `1000` steps.
- The confirmed Dell controller is the 24 V model and is powered by a Mean Well `HLG-150H-24A` 24 VDC supply.
- Confirm the exact 24 V model current/watt/channel-pair limits from the manual/nameplate before any duty increase beyond the PR #36 5% smoke cap.
- Channel pairs are `1-2`, `3-4`, `5-6`, and `7-8`.
- Overcurrent detection occurs around `113%` rated current and stops affected unit/pair outputs.
- Temperature abnormality threshold is `90 C` and stops outputs; internal temperature can be read by LAN command.

EXT I/O facts needed for later trigger acceptance:

- Pin `1`: `IN_COM`, input signal common for pins `2-9`.
- Pin `2`: `TRG IN1`.
- Pins `3-9`: `TRG IN2` through `TRG IN8` with documented programming-mode alternates.
- Pin `10`: `FG`.
- Pin `11`: `OUT_COM`.
- Pins `12-15`: `TRG OUT1-4`.
- Pin `16`: `ERROR OUT`.
- Pins `17-18`: DC 24 V input `+V`.
- Pins `19-20`: DC 24 V input `-V`.

External trigger input constraints:

- `TRG IN1-8` use pins `2-9`.
- NPN and PNP can be used.
- Trigger input current is about `10 mA`.
- Use an open collector circuit with about `50 mA` current capacity, or a contact circuit.
- Voltage between pin `1` and pins `2-9` should be `5-24 V`.
- Trigger activation modes are `LevelHigh`, `RisingEdge`, `LevelLow`, and `FallingEdge`.

The intended synchronized macro lighting architecture is:

- Basler ace 2 captures macro images.
- Basler Line 2 outputs `Exposure Active` during exposure.
- Basler Line 2 triggers Leimac `TRG IN1`.
- Leimac lights only during the camera exposure after controller/camera acceptance in a later PR.
- Leimac is configured/read over Ethernet using Leimac ASCII commands or GenICam/GigE Vision.

The dry-run trigger-sync plan records the future vendor-guide configuration without applying it:

- Basler Line Selector: `Line 2`.
- Basler Line Mode: `Output`.
- Basler Line Inverter: `false`.
- Basler Line Source: `Exposure Active`.
- Leimac trigger input: `TRG IN1`.
- Leimac Trigger Control Mode: `Level Low`.

Vendor trigger-guide wiring notes:

- Requires a Basler `CEBR119` or `CEBR120` camera I/O cable.
- Requires a `5-24 VDC` trigger supply for the trigger input circuit.
- Leimac pin `1` COM / `IN_COM` goes to trigger supply `V+`.
- Leimac pin `2` CH1 Trg In / `TRG IN1` goes to Basler camera pin `4` / Line 2.
- Basler camera pin `6` / Ground goes to trigger supply GND.
- `CEBR119` / `CEBR120` cable Line 2 GPIO is camera pin `4`, black wire.
- `CEBR119` / `CEBR120` cable GPIO Ground is camera pin `6`, pink wire.

PR #35 does not configure the camera line, does not save Basler user sets, does not change Leimac trigger/source/mode/output settings, does not reset errors, and does not turn lights on or off.

PR #36 adds these explicit commands:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-line2-exposure-active

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-line2-exposure-active `
  --line-inverter false `
  --apply `
  --confirm "APPLY BASLER LINE2 EXPOSURE ACTIVE"

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-trigger-profile `
  --host 169.254.191.156 `
  --port 1000 `
  --profile basler-line2-trg-in1-low-duty `
  --duty 5 `
  --trigger-activation LevelLow

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-trigger-profile `
  --host 169.254.191.156 `
  --port 1000 `
  --profile basler-line2-trg-in1-low-duty `
  --duty 5 `
  --trigger-activation LevelHigh `
  --apply `
  --confirm "APPLY LEIMAC LOW DUTY TRIGGER PROFILE"

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-idmu-safe-off `
  --host 169.254.191.156 `
  --port 1000 `
  --apply `
  --confirm "APPLY LEIMAC SAFE OFF"
```

The Basler Line2 command is dry-run by default. The apply path opens the selected Basler GigE camera only after `--apply` plus exact confirmation text, sets only transient `LineSelector=Line2`, `LineMode=Output`, caller-selected `LineInverter=false|true`, and `LineSource=ExposureActive`, reads back those settings plus `LineStatus` / `LineStatusAll` when supported, and never saves a Basler User Set.

The Leimac trigger-profile command is dry-run by default. The apply path requires explicit host/port, `--apply`, exact confirmation text, a successful `R830000` unit-info read showing one 8-channel unit, and duty `<= 5`. It supports only the supervised `LevelLow` and `LevelHigh` trigger-activation candidates. It does not use Leimac SYSTEM RESET, FACTORY DEFAULT, network setting commands, persistent saves, or arbitrary write-frame input.

The PR #36 low-duty profile write frames are command-before-unit and channel/value expanded for the confirmed 8-channel base unit:

- Safe-off before profile: `W8601010000020000030000040000050000060000070000080000`, `W8501010000020000030000040000050000060000070000080000`, `W1101010000020000030000040000050000060000070000080000`.
- Trigger activation Level Low: `W0901010002020002030002040002050002060002070002080002`.
- Trigger activation Level High: `W0901010000020000030000040000050000060000070000080000`.
- Trigger source TRG IN1: `W6501010000020000030000040000050000060000070000080000`.
- Trigger synchronization synchronous: `W8401010000020000030000040000050000060000070000080000`.
- Output delay 0 us: `W1301010000020000030000040000050000060000070000080000`.
- Lighting output value 1% / 10 of 1000 steps: `W1101010010020010030010040010050010060010070010080010`.
- Lighting output value 5% / 50 of 1000 steps: `W1101010050020050030050040050050050060050070050080050`.
- Asynchronous output OFF: `W8501010000020000030000040000050000060000070000080000`.
- Lighting output enable for trigger-controlled smoke: `W8601010001020001030001040001050001060001070001080001`.

Mark confirmed the current physical wiring uses Basler `CCB-M8IO`: black wire / pin `4` / Line2 to Leimac pin `2` / `TRG IN1`; pink/powder wire / pin `6` / GPIO ground to the 0 V WAGO; Mean Well red +24 V to Leimac pin `17` and Leimac pin `1` / `IN_COM`; Mean Well black 0 V to Leimac pin `19` and Basler GPIO ground. Unused Basler I/O wires (`brown`, `white`, `blue`, `grey`, and shield/drain) must remain individually insulated.

Mark also reported the ring light turns on when main power is turned on. That is not accepted synchronized behavior by itself. The first PR #36 hardware smoke must be supervised, must stop if the light remains continuously on after configuration, must run safe-off/all-off if available, and must not proceed to capture until Mark visually confirms the light is not stuck continuously on.

Local Dell supervised PR #36 smoke attempt on 2026-06-26 stopped before capture. Mark was present, wiring was confirmed, Leimac status was green, and the ring light was initially on. The implemented safe-off command returned ACK for `W86...0000`, `W85...0000`, and `W11...0000`; Mark confirmed the light turned off. Basler transient Line2 apply succeeded and read back `LineSelector=Line2`, `LineMode=Output`, `LineSource=ExposureActive`, and `LineInverter=false`, with no User Set save and no image capture. The Leimac low-duty trigger profile then returned ACK for `W09`, `W65`, `W84`, `W13`, `W11`, `W85`, and `W86`, but Mark confirmed the ring light was on continuously after profile application. The run was aborted before synchronized capture, safe-off was run again, and Mark confirmed the final light state was off.

This means safe-off is verified, but the first polarity assumption (`LineInverter=false` plus Leimac `LevelLow`) is not accepted for capture because the Leimac trigger input is active at idle on this wired rig. Do not run `basler-leimac-sync-smoke` until a supervised polarity sequence keeps the light off between exposures.

PR #36 now includes a supervised polarity diagnostic command. It defaults to a dry-run plan and caps diagnostics at `1%` duty by default and `5%` maximum. The supported candidates are tested one at a time, with safe-off before each candidate and safe-off after any idle-on failure:

- `line2-no-inverter-level-high`: Basler `LineInverter=false`, Leimac `TriggerActivation=LevelHigh`.
- `line2-inverter-level-low`: Basler `LineInverter=true`, Leimac `TriggerActivation=LevelLow`.
- `line2-no-inverter-level-low`: previously failed baseline, retained for manifest coverage.
- `line2-inverter-level-high`: final supported polarity combination.

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-leimac-polarity-smoke `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --candidate line2-no-inverter-level-high `
  --duty 1 `
  --exposure-us 5000

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-leimac-polarity-smoke `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --candidate line2-no-inverter-level-high `
  --duty 1 `
  --exposure-us 5000 `
  --apply `
  --confirm "RUN SUPERVISED BASLER LEIMAC POLARITY SMOKE" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-leimac-polarity-smoke `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --candidate line2-no-inverter-level-high `
  --output-dir C:\TenKings\capture-data\basler-leimac-sync `
  --duty 1 `
  --exposure-us 5000 `
  --apply `
  --confirm "RUN SUPERVISED BASLER LEIMAC POLARITY SMOKE" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off `
  --capture-confirmed
```

The polarity command applies exactly one candidate and then stops for visual confirmation. If Mark reports idle-on, run the same command with `--operator-reported-idle-on` for that candidate so it runs safe-off and records the failed candidate. Capture is allowed only after Mark confirms the light is off at idle. The capture path records the selected polarity, Basler Line2 readback including `LineStatus` / `LineStatusAll` when supported, Leimac frames, `safeOffBefore=true`, `safeOffAfter=true`, `isCalibrated=false`, and `evidenceClass=macro_sync_smoke_uncalibrated`.

The guarded synchronized smoke command requires an output directory outside the repo, `--apply`, exact confirmation text, Mark-present/wiring/status/light-state flags, and then captures one PNG outside git:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-leimac-sync-smoke `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\basler-leimac-sync `
  --duty 5 `
  --exposure-us 5000 `
  --apply `
  --confirm "RUN SUPERVISED BASLER LEIMAC SYNC SMOKE" `
  --mark-present `
  --unused-basler-wires-insulated `
  --leimac-status-green `
  --operator-confirmed-light-not-continuous
```

The sync-smoke manifest records image path, SHA-256, byte size, dimensions, exposure, gain, Basler Line2 settings, Leimac IP/unit-info/profile/duty/frames, `isCalibrated=false`, and `evidenceClass=macro_sync_smoke_uncalibrated`. It is not calibrated production macro evidence and is not a final grade, certificate, or certified grading output.

Local Dell supervised PR #36 pulse and image-stat smoke on 2026-06-29 accepted the `line2-inverter-level-low` polarity for transient sync foundation. The manual pulse command configured Leimac `LevelLow` at 3% duty, configured Basler Line2 as `UserOutput1` with `LineInverter=true`, pulsed `UserOutputValue=false -> true -> false` for 500 ms, and Mark visually confirmed the ring light turned on during the pulse. Basler readback changed `LineStatus=false`, `LineStatusAll=4` before pulse to `LineStatus=true`, `LineStatusAll=6` during pulse, then back to `LineStatus=false`, `LineStatusAll=4` after pulse. Safe-off ran before and after and ACKed.

The accepted image-stat smoke used Basler Line2 `ExposureActive`, `LineInverter=true`, Leimac `TriggerActivation=LevelLow`, Leimac duty `3%` / `30` of `1000` steps, exposure `50000 us`, gain `0`, and no persistent Basler or Leimac save. Dark control artifact: `C:\TenKings\capture-data\basler-leimac-sync\basler-leimac-dark-control-line2-inverter-level-low-20260629T041905743Z.png`, SHA-256 `19244c85339f15251529730076fa79656048e97a0e9064bb2ef8bfa1e6ff3179`, `151013` bytes, `2448x2048`, stats min `0`, max `8`, mean `0.1983`, brightFraction `0`. Synced artifact: `C:\TenKings\capture-data\basler-leimac-sync\basler-leimac-image-stat-sync-line2-inverter-level-low-20260629T041921325Z.png`, SHA-256 `61459596a5f22484518682d79c10bccbece0f5077159fc8940ddcccd4abd6c71`, `1356565` bytes, `2448x2048`, stats min `0`, max `255`, mean `27.6684`, brightFraction `0.18785`. The diagnostic comparison was materially brighter: mean delta `27.4701`, max delta `247`, `materiallyBrighter=true`. Safe-off ACKed after the smoke, and Mark later confirmed the final ring-light state was off.

Next steps after PR #36 are calibration, repeatability testing, lighting profile/channel mapping, UI/report integration, and a later acceptance pass for persistent camera/controller settings only after explicit operator approval.

PR #37 starts the local/offline full-rig smoke package path. The accepted PR #36 polarity (`line2-inverter-level-low`: Basler Line2 `ExposureActive` with `LineInverter=true`, Leimac `TriggerActivation=LevelLow`, `TRG IN1`) is now the default Basler/Leimac macro package profile:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-leimac-macro-package `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\full-rig-smoke `
  --profile line2-inverter-level-low `
  --duty 5 `
  --exposure-us 50000 `
  --include-dark-control `
  --apply `
  --confirm "RUN BASLER LEIMAC MACRO PACKAGE" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off
```

The macro package command safe-offs before and after, captures a dark-control PNG and a synchronized macro PNG outside the repo, computes image stats plus histogram buckets, and writes a local `manifest.json` and `preview-report.html` contact sheet. It records `lightingProfileId=line2-inverter-level-low-v0`, `cameraRole=macro_overview`, `isCalibrated=false`, and `evidenceClass=macro_sync_smoke_uncalibrated`. It does not save persistent Basler or Leimac settings and does not upload or write to a production database.

PR #37 also adds the combined local smoke command:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-full-rig-local-smoke `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\full-rig-smoke `
  --basler-duty 5 `
  --basler-exposure-us 50000 `
  --dinolite-plan experimental-card-grading `
  --bridge-exe <dnvideox-bridge.exe> `
  --adapter dnvideox `
  --device-index 0 `
  --apply `
  --confirm "RUN AI GRADER FULL RIG LOCAL SMOKE" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off
```

That command runs the Basler/Leimac macro package first, then launches the existing Dino-Lite `experimental-card-grading` operator workflow for detail captures. The unified local manifest/report separates Basler macro evidence from Dino-Lite detail evidence. Basler macro is recorded as the preferred macro/centering evidence source, but v0 experimental scoring is not rerouted to the Basler image yet; if the existing scorer cannot safely switch centering input, the manifest records the routing as not yet used rather than fabricating scores. The full-rig workflow remains local/offline and uncalibrated. Production upload, DB integration, calibrated macro evidence, final AI grade, certificate, and certified grading are future work.

Local Dell supervised PR #37 smoke on 2026-06-29 completed the Basler/Leimac macro package and one combined local full-rig workflow. The standalone macro package output was `C:\TenKings\capture-data\full-rig-smoke\basler-leimac-macro-package-2026-06-29T053038955Z`, with preview report `preview-report.html`; dark mean was `0.3807`, synced mean was `73.6150`, synced max was `255`, and `materiallyBrighter=true`. Mark reviewed that preview and noted the Basler macro card image was out of focus. That is recorded as an optical setup limitation for future calibration/readiness work, not as calibrated evidence.

The combined full-rig output was `C:\TenKings\capture-data\full-rig-smoke\ai-grader-full-rig-local-smoke-2026-06-29T053708147Z`, with unified `manifest.json` and `preview-report.html`. The Basler macro stage used the accepted `line2-inverter-level-low-v0` lighting profile at `5%` duty and `50000 us` exposure. Dark control PNG: `basler-basler-leimac-macro-dark-control-20260629T053714495Z.png`, SHA-256 `51098b8e7c2669583258dd9a5d6b541a36af4f1eca41d485f55138e669200450`, `226320` bytes, `2448x2048`, mean `0.3768`, max `8`. Synced macro PNG: `basler-basler-leimac-macro-synced-20260629T053730136Z.png`, SHA-256 `de486fc663ac3e9d5fb21c58c464756577b5de35d45e2dc3bc45db9886dfe83c`, `1624764` bytes, `2448x2048`, mean `73.6089`, max `255`. The comparison had mean delta `73.2321` and `materiallyBrighter=true`.

The same full-rig run captured 12 Dino-Lite detail JPGs through the `experimental-card-grading` operator workflow under `dinolite-detail\dinolite-operator-ai-grader-full-rig-local-smoke-2026-06-29T053708147Z-20260629T053732919Z`, then wrote Dino-Lite `manifest.json`, `analysis.json`, and `preview-report.html`. The unified manifest records Basler macro as `macroOverviewSource=basler_leimac`, Dino-Lite as `detailSource=dinolite`, `centeringInput=basler_preferred_not_routed_to_score_v0`, and `scoringStatus=existing_dinolite_experimental_analysis_preserved`. The package remains local/offline and uncalibrated.

PR #38 pivots the V1 product workflow to a fixed overhead Basler camera plus fixed Leimac synchronized lighting. Dobot/OpenBuilds/robotic-arm automation is V2 and is not required for V1 production. Dino-Lite remains available, but only as optional manual detail confirmation for flagged or operator-requested close-ups; V1 does not require Dino-Lite full-card tiling or moving the card to multiple corner/edge positions.

The V1 human flow is:

1. Place the raw card face-up in the fixed tray/position.
2. Start the AI-Grader fixed-rig workflow.
3. Capture front dark control and synced Basler macro with Leimac lighting.
4. Flip the card to the back side in the same fixed tray/position.
5. Capture back dark control and synced Basler macro with Leimac lighting.
6. Analyze macro evidence for focus/framing quality, boundary/ROI screening, and future centering/surface screening.
7. Suggest Dino-Lite close-up targets only when a real heuristic or later detector supports it.

Manual Basler focus/framing assist:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-fixed-rig-focus-assist `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-v1 `
  --duty 5 `
  --exposure-us 50000 `
  --apply `
  --confirm "RUN BASLER FIXED RIG FOCUS ASSIST" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off
```

This command is manual focus assist, not autofocus. It reuses the accepted `line2-inverter-level-low-v0` Basler/Leimac profile, safe-offs before and after capture, writes artifacts outside the repo, and reports mean/max brightness, clipped-pixel fraction, dark-pixel fraction, sharpness score, approximate card coverage/framing, and manual guidance. Operators should adjust camera focus/height and repeat until sharpness improves/stabilizes, then lock camera height, tray position, and focus before calibration work.

Fixed-rig V1 local workflow:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-fixed-rig-v1-local `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-v1 `
  --duty 5 `
  --exposure-us 50000 `
  --apply `
  --confirm "RUN AI GRADER FIXED RIG V1 LOCAL" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off `
  --operator-flip-confirmed `
  --operator-flip-delay-ms 30000
```

The fixed-rig V1 command captures front and back Basler macro packages, each with a dark control and synced macro PNG. `--operator-flip-delay-ms` is a supervised delay after the front capture; use it to give the operator time to flip the card before the back capture starts. It writes local `manifest.json`, `analysis.json`, and `preview-report.html` with `isCalibrated=false`, `evidenceClass=macro_fixed_rig_v1_uncalibrated`, `selectedLightingProfile=line2-inverter-level-low-v0`, front/back artifact metadata, quality warnings, approximate boundary/ROI metadata, and a Dino-Lite follow-up plan. If boundary detection or quality is not good enough, analysis reports `not_computed` with a warning rather than fabricating grades or defects.

Local Dell PR #38 supervised bracket/front-back smoke on 2026-06-29 selected `1.2%` Leimac duty and `45000 us` Basler exposure for the fixed-rig V1 smoke. Earlier bracket points showed the tradeoff: `1% / 25000 us` stayed low-saturation but did not show a measurable synced-light delta, `1.2% / 50000 us` showed synchronized lighting but clipped slightly above the soft target, and `1.2% / 45000 us` preserved synced-light evidence while keeping clipped pixels below `0.02`.

The final confirmed local package is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-local-confirmed-front-back-2026-06-29T092233414Z`, with `manifest.json`, `analysis.json`, and `preview-report.html`. The operator flip was managed as two explicit standalone macro-package captures because the single-command flip-delay prompt was not visible to the operator in chat. Final light state was confirmed off by Mark. Front synced PNG: SHA-256 `e156c3422e95f88d3772ec3ae347b9ed08157e7f2ab68a6bb73c25d748c8cf79`, `2068897` bytes, `2448x2048`, mean `93.9304`, clipped fraction `0.015041`, sharpness `25.8881`, `materiallyBrighter=true`. Back synced PNG: SHA-256 `0416b5e0e494548cb7ab48d2cd389d2459bee89914d64c5432bdd3bd59481675`, `2121355` bytes, `2448x2048`, mean `106.6844`, clipped fraction `0.01326`, sharpness `27.6626`, `materiallyBrighter=true`. Both sides remain uncalibrated, visually soft, and the current boundary heuristic still reports full-frame coverage, so ROI analysis remains warning/not-computed pending physical focus/framing and calibration work.

The dry-run `fixed-rig-lighting-profile-plan` command records future multi-light profiles only. Channel-to-physical-light mapping is not calibrated yet, so PR #38 does not apply directional or low-angle/surface-scratch profiles and does not invent segment mapping. Production DB/report integration, pixel-to-mm calibration, lens distortion calibration, lighting profile calibration, repeatability, and any persistent camera/controller settings are future PRs.

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
- quality diagnostics per target: card coverage heuristic, heuristic label/limitations, background risk, sharpness/blur risk, brightness mean, contrast range, over/underexposure risk, target alignment confidence, and warnings such as possible background interference, low card coverage, target may not be centered, image may be blurry, lighting may be uneven, and score confidence reduced
- quality warning impact policy: blur is directly represented in the existing close-up `blurPenalty` and centering confidence; exposure warnings are diagnostic-only in v0.1; coverage is an approximate heuristic, not a calibrated card mask or pass/fail framing result
- operator options metadata including `cornerProfile=sharp_90` and whether capture guides were enabled
- clearer surface low-score explanation translating surface speck/scratch/texture anomaly proxy metrics into plain English, with explicit caution that print texture, focus, lighting, or background can contribute and source images should be reviewed

The operator preview workflow now passes optional guide/profile metadata through the JSONL bridge protocol. The visible Windows operator panel shows guide text for each target class:

- full-card overview: fit as much of the card as possible, avoid background, keep card edges visible, and label it interim/not calibrated macro capture
- corner targets: place the corner tip at the center guide, include both edges, fill the frame mostly with card, avoid background, and use the `sharp_90` corner profile
- edge targets: align top/bottom edges with the horizontal guide and left/right edges with the vertical guide
- surface targets: fill the central patch with card surface only and avoid border/background

PR #33 follow-up added both an adjacent high-contrast visual guide diagram panel and an attempted in-preview transparent WinForms overlay window in the visible Windows operator workflow. The in-preview overlay is implemented as an owned borderless transparent WinForms window positioned over the DNVideoX ActiveX preview rectangle; it does not use DNVideoX `SetBitmapOverlay` or `SetTextOverlay`, so the guide is outside the video frame pipeline and should not be baked into `SaveFrameJPG` output. The side panel remains as a fallback/legend. The diagrams are target-specific:

- full-card overview: yellow card-framing rectangle
- `sharp_90` corner targets: yellow L-shaped corner guide oriented for top-left, top-right, bottom-right, or bottom-left
- edge targets: yellow horizontal or vertical line depending target orientation
- surface targets: yellow central patch box

PR #33 target-template follow-up keeps the accepted transparent in-preview overlay technique and changes the visual guide from generic shapes to capture templates:

- full-card overview: centered `2.5:3.5` card frame with safe margin and label `Fit full card inside this frame`; it remains interim and not calibrated macro capture
- `sharp_90` corners: close-up L template with crosshair at the corner tip; top-left opens down/right, top-right opens down/left, bottom-right opens up/left, and bottom-left opens up/right
- edges: horizontal strip for top/bottom edges and vertical strip for left/right edges, with the operator instructed to minimize background
- surfaces: centered patch box for card surface only, avoiding borders/background

Operator workflow manifests now record `guideTemplateKind`, `guideTemplateAspectRatio` for the full-card frame (`2.5:3.5`), and `guideTemplateScaleNote`. The experimental `analysis.json` and HTML report include a capture-template metadata section. These guide templates improve manual positioning consistency before GRBL stage automation, but physical scale remains uncalibrated until AMR/calibration workflow is finalized. The guide graphics are overlay UI only and are not intended to be baked into captured JPGs.

`--corner-profile sharp_90` is the only active corner profile in this slice. Unsupported values fail before spawning the bridge. `--capture-guides true|false` defaults to `true`; when enabled, guide text plus `guideVisualKind`, `guideVisualOrientation`, and `guideVisualLegend` metadata are recorded in the manifest and shown in the preview workflow. These changes are guidance and diagnostics only; they do not create fake/manual scores and do not retune analysis thresholds.

Local Dell supervised follow-up smoke on 2026-06-10 used `operator-smoke-single`, normal JPG only, and output outside git at `C:\TenKings\capture-data\dinolite-operator\dinolite-operator-report-diagnostics-guide-smoke-20260610T101537418Z`. The visible operator workflow completed with one `center-surface` target, `guideVisualKind=surface`, `guideVisualOrientation=center`, and `guideVisualLegend="Fill the yellow central patch with card surface only; avoid border and background."` It captured `01-center-surface-attempt-01-normal.jpg` (`sha256=52fb0f26eccb4ea05934dbdee599ba50adfe8359b671027ee5248fb90a3afb0e`, `byteSize=210536`), wrote `manifest.json` and `preview-report.html`, and cleanup succeeded with preview stopped, disconnected, host disposed. Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`.

Local Dell in-preview overlay smoke on 2026-06-10 used `operator-smoke-single`, normal JPG only, and output outside git at `C:\TenKings\capture-data\dinolite-operator\dinolite-operator-report-diagnostics-preview-overlay-smoke-20260610T165908190Z`. It captured `01-center-surface-attempt-01-normal.jpg` (`sha256=8147f31196c3b64ff42f2f8f6724ff0b57049e64a43fd7e5241cf8a09e23423c`, `byteSize=149798`), wrote `manifest.json` and `preview-report.html`, and cleanup succeeded. The saved JPG was visually inspected and contained no guide graphics. Mark confirmed the yellow visual guide appeared on top of the live Dino-Lite camera preview, so the current overlay technique is accepted technically.

Local Dell supervised PR #33 smoke on 2026-06-10 used `dinolite-experimental-grading-run --corner-profile sharp_90 --capture-guides true`, normal JPG only, and output outside git at `C:\TenKings\capture-data\dinolite-grading-runs\dinolite-operator-report-diagnostics-smoke-20260610T082201807Z`. It completed `status=completed` with 12 captured targets, `manifest.json`, `analysis.json`, and `preview-report.html`. The report includes score scale, perfect `10/10` definitions, "Why this score?" sections, and quality warning summary. Computed outputs were centering `10.00 / 10`, corners `6.49 / 10`, edges `2.17 / 10`, surface `1.00 / 10`, and overall `5.13 / 10` (`Needs Review`, confidence `0.71`). Quality diagnostics recorded warnings on 11 targets, mostly blur/underexposure risk. Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`.

Local Dell supervised PR #33 target-template smoke on 2026-06-10 used `dinolite-experimental-grading-run --corner-profile sharp_90 --capture-guides true`, normal JPG only, and output outside git at `C:\TenKings\capture-data\dinolite-grading-runs\dinolite-operator-report-diagnostics-template-smoke-20260610T183307867Z`. It completed `status=completed` with 12 captured targets, `manifest.json`, `analysis.json`, and `preview-report.html`. The manifest/analysis recorded `full_card_frame`, `sharp_90_corner_template`, `edge_strip_template`, and `surface_patch_template` metadata, including the full-card `2.5:3.5` aspect ratio and the physical-scale-uncalibrated note. Representative saved JPGs for full-card, corner, edge, and surface targets were visually inspected and contained no overlay graphics. Computed outputs were centering `10.00 / 10`, corners `2.24 / 10`, edges `3.59 / 10`, surface `1.00 / 10`, and overall `4.14 / 10` (confidence `0.71`). Quality diagnostics recorded warnings on all 12 targets, mostly blur/underexposure risk. Final explicit Mark confirmation that each target-specific template was visible/useful during the workflow is pending before treating PR #33 as ready to merge.

Local Dell supervised smoke on 2026-06-09/2026-06-10 used `operator-smoke-single` after fixing the child-process hidden-window spawn option. The operator window appeared as `Ten Kings Dino-Lite Operator Workflow`, Mark clicked `Capture / continue`, and the command completed with `status=completed`, `connectedDuringCommand=true`, `previewDuringCommand=true`, and cleanup `previewStopped=true`, `disconnected=true`, `hostDisposed=true`. Output folder: `C:\TenKings\capture-data\dinolite-operator\dinolite-operator-operator-smoke-single-20260610T034854043Z`. It contains `manifest.json`, `preview-report.html`, and `01-center-surface-attempt-01-normal.jpg` (`sha256=74016465bd7ee8a00c033f98ac72047abb3b302b40c33d7314f44baf42a9fd5f`, `byteSize=130542`). Device ID was present and is redacted from docs except USB VID/PID `vid_a168&pid_0990`. The optional `card-interim` run was deferred because the single-target supervised workflow proved the visible operator flow.

SDK binaries, OCX files, and DNVideoX DLLs must remain outside git. Do not run `regsvr32` from this repo flow.

### Basler pylon Macro Smoke

PR #34 adds a manual-only Basler/pylon macro camera path for readiness, GigE camera listing, and one uncalibrated still capture. The helper uses a small PowerShell bridge script under `packages/ai-grader-capture-helper/scripts/basler-pylon-bridge.ps1` and loads the locally installed pylon .NET assembly at runtime. No Basler SDK binaries, pylon DLLs, or vendor files are committed.

Default helper health, readiness, manifests, transport, and admin paths do not load the Basler client, load pylon, enumerate GigE devices, or open the camera. The Basler path is only used by explicit CLI commands:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-readiness `
  --pylon-timeout-ms 30000

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-list-cameras `
  --pylon-timeout-ms 30000

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-capture-still `
  --output-dir C:\TenKings\capture-data\basler-smoke `
  --label pr34-basler-macro-smoke `
  --format png `
  --pylon-timeout-ms 60000
```

Optional flags:

- `--pylon-root C:\Program Files\Basler\pylon`, or `TENKINGS_BASLER_PYLON_ROOT` / `AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT`
- `--camera-index 0`
- `--format png|tiff|jpg`; default is lossless PNG
- `--lens-model <label>`, or `TENKINGS_BASLER_LENS_MODEL` / `AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL`

The capture output directory must be outside the repo. The command saves the current camera output at native AOI/resolution, without enhancement, contrast stretching, denoising, resizing, Leimac control, Arduino control, stage motion, or network setting changes. PNG/TIFF are preferred for future calibration/macro evidence work; JPG is available only as an explicit smoke-output format.

Capture metadata includes `sha256`, byte size, MIME type, timestamp, camera model/name, image width/height, source pixel format, saved image format, exposure time, gain, transport, and calibration placeholders:

- `isCalibrated=false`
- `calibrationProfileId=null`
- `lensModel`, when supplied
- `cameraRole=macro_overview`
- `evidenceClass=macro_raw_smoke`
- `coordinateFrame=basler_sensor_pixels`

The captured image is labeled uncalibrated macro smoke only and is not production macro evidence or a final AI grade.

Local Dell PR #34 smoke on 2026-06-16 UTC used pylon 26.05.0.18278. Readiness/list detected one Basler GigE camera: model `a2A2448-23gmBAS`, transport `GEV`, device IP `169.254.68.71`, interface IP `169.254.215.165`, serial redacted in docs. The active adapter was `Realtek USB GbE Family Controller #2`, status `Up`, link speed `1 Gbps`.

Successful still smoke output:

- output file: `C:\TenKings\capture-data\basler-smoke\basler-pr34-basler-macro-smoke-ok-20260616T082253727Z.png`
- SHA-256: `3e07897f9af2028388e48c979c1a07f10fde04e4d751d3c290f5c4cfa7a7f8d2`
- byte size: `1533587`
- MIME type: `image/png`
- dimensions: `2448x2048`
- source pixel format: `Mono8`
- saved image format: `PNG`
- sharp metadata check: `space=b-w`, `channels=1`, `depth=uchar`, `hasAlpha=false`
- exposure time: `5000`
- gain: `0`
- calibration metadata: `isCalibrated=false`, `calibrationProfileId=null`, `lensModel=null`, `cameraRole=macro_overview`, `evidenceClass=macro_raw_smoke`, `coordinateFrame=basler_sensor_pixels`

Two earlier PR #34 capture attempts wrote PNG files outside the repo but failed to return metadata because PowerShell emitted a disposed pylon camera object into the JSON output stream. The bridge now suppresses pylon method outputs before metadata serialization. Those captured PNG files remain outside git and must not be committed.

## Simulator-First Limitation

This package defaults to simulator mode with the mock driver set and rejects any runnable backend other than simulator/mock. The exceptions are the explicit Arduino auxiliary LED and GRBL stage readiness command/paths described above, which perform only serial `PING` plus `LED ALL OFF` and GRBL `?` status query respectively, plus manual Leimac IDMU-P read-only Ethernet commands, manual Dino-Lite commands, and manual Basler commands that require explicit CLI invocation. The simulator path uses `@tenkings/ai-grader-simulator` to generate:

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

The implemented real-adjacent adapters are Arduino auxiliary LED readiness, GRBL stage status readiness, manual Leimac IDMU-P Ethernet read-only readiness/status, manual Dino-Lite DNVideoX enumeration/status/still JPG/package/operator workflow/experimental grading capture, and manual Basler pylon GigE readiness/list/still PNG/TIFF/JPG capture. They are not part of the runnable mock driver set and require explicit CLI/config/env before they can open serial, open a Leimac TCP socket to one explicit host/port, instantiate DNVideoX, load pylon, enumerate GigE cameras, or open the Basler camera.

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
- keep Leimac IDMU-P hardware writes limited to the PR #36 explicit-host, low-duty `<=5%`, allowlisted trigger-profile and safe-off paths until calibration, channel mapping, output limits, heat behavior, and repeatability are accepted
- keep Arduino LED readiness limited to `PING` and `LED ALL OFF`; Arduino is auxiliary for this rig's Leimac lighting path unless a later approved slice reassigns it to interlocks, buttons, sensors, emergency stop, or non-Leimac devices
- keep GRBL stage readiness limited to `?` status query until mechanical bounds and emergency stop behavior are defined
- keep Dino-Lite real DNVideoX work limited to manual enumerate/status/still JPG/demo package/operator workflow/experimental non-certified grading capture, including outside-git SDK runtime diagnostics for EDOF, until a later approved lens/focus/exposure/DPQ/certified-grading slice
- keep Basler pylon work limited to manual readiness/list/transient Line2 ExposureActive setup and uncalibrated still/sync smoke capture until a later approved calibration, lighting, persistent settings, and production macro evidence slice

### Fixed-Rig Calibration / Preview Foundation

PR #39 adds local/offline fixed-rig calibration foundation commands and report metadata only. It does not make the rig calibrated and does not add final grading, certificate, or certified-grading claims.

New command surfaces:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js basler-fixed-rig-operator-preview `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-calibration `
  --exposure-us 45000 `
  --gain 0 `
  --preview-refresh-ms 500 `
  --operator-mode `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off `
  --apply `
  --confirm "RUN BASLER FIXED RIG OPERATOR PREVIEW"

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js leimac-channel-characterization `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-calibration `
  --duty 1 `
  --exposure-us 45000 `
  --apply `
  --confirm "RUN LEIMAC CHANNEL CHARACTERIZATION" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off
```

The preview command opens a visible Windows Basler pylon live-stream operator window. It uses Basler pylon only after explicit `--apply`, confirmation, `--operator-mode`, and `--mark-present`. It can run ambient-only without Leimac; when `--leimac-host` is supplied, preview lighting controls are enabled only with `--wiring-confirmed`, `--leimac-status-green`, and `--operator-confirmed-light-idle-off`. The window uses pylon continuous acquisition with `GrabStrategy.LatestImages`, a compiled .NET frame-pump thread that calls `RetrieveResult`, newest-frame display, and stale-frame dropping so the UI does not queue old frames. The preview explicitly disables camera trigger mode for the operator view and leaves the grading capture profile separate. It displays measured FPS, frame age, and skipped stale frames, rotates the operator display into portrait orientation while leaving raw capture orientation unchanged, and shows the guide overlay plus basic frame metrics while the operator manually turns the lens focus ring, adjusts boom height, or moves the card. This is not autofocus. Saved PNG/HTML artifacts are diagnostic only and do not satisfy operator-preview acceptance by themselves.

The live preview sidebar includes frame/FPS/latency status, sharpness, mean, max, clipped/dark fractions, operator framing status, Accept/Start/Continue, Abort/Close, Safe Off, current preview lighting state, and the uncalibrated warning. Preview lighting controls are setup-only hardware controls and still do not save a persistent Leimac User Set, but an accepted operator preview setting now becomes the local software active fixed-rig lighting profile for later focus-assist, fixed-rig V1, and evidence-package commands unless a CLI override or Reset Default is used. The software profile is stored outside the repo as `fixed-rig-active-lighting-profile.json` near the fixed-rig capture-data root and records `selectedDutyPercent`, `actualLeimacPwmStep`, `selectedChannels`, `profileSource`, `acceptedAt`, and `resetToDefault`. The Preview Light On/Off control, brightness slider, numeric duty input, default V1 duty marker (`1.2%`), hard cap (`5%`), Reset to Default Preview Duty, all-on/all-off buttons, and 8-channel ring toggle UI send only low-duty allowlisted Leimac frames. Preview lighting uses a compiled .NET coalescing worker and the rig-proven `W11` low PWM plus `W86` lighting-output-enable path for continuous operator setup light; synchronized grading capture still applies transient ExposureActive-triggered settings and safe-offs on exit. The lighting writes are debounced at about 50 ms, run off the UI thread, coalesce rapid slider/channel changes, and report requested duty separately from ACKed applied PWM. If channels are unchanged and the preview light is already on, brightness-only changes send only a `W11` PWM update instead of safe-off plus re-enable, avoiding a bright flash. Status polling updates labels without repainting the 8-segment ring, so the ring UI does not flicker while requested channels are unchanged. The Leimac PWM command value is `0000-0999`; PR #39 rounds preview duty to the nearest supported 0.1% step, so `1.2%` displays/applies as PWM `0012`. Channel mapping remains `UNKNOWN/UNCALIBRATED` until characterization evidence is reviewed. Preview lighting safe-offs on Abort/Close and before the command returns.

Fixed-rig reports now carry a local `FixedRigCalibrationProfile` with `isCalibrated=false`, selected V1 setting metadata, card physical size defaults (`63.5mm x 88.9mm`), optional uncalibrated pixel/mm estimates when a boundary is detected, and calibration status such as `preview_assisted`, `focus_assisted`, `framing_assisted`, or `channel_characterized`. Lens distortion and lighting calibration remain false.

Report images now separate raw sensor evidence from operator/report display assets. Raw Basler evidence images remain in `basler_sensor_pixels` coordinates with original hashes unchanged. Derived report thumbnails, overlay debug images, and ROI crops use the `ai_grader_card_portrait_display` coordinate frame with metadata recording `displayTransform` (`none`, `rotate90cw`, `rotate90ccw`, or `rotate180`). Overlay/debug images are generated separately from raw evidence and are not baked into the raw capture. Overlays include a 2.5:3.5 placement guide, center crosshair, boundary guide when detected, and full-card/corner/edge/surface ROI rectangles.

Pixel/mm estimates are still uncalibrated, but they now account for raw/display orientation. If the detected card is landscape in raw Basler sensor space, raw width maps to the card long side (`88.9mm`) and raw height maps to the card short side (`63.5mm`). If the detected card is portrait in raw sensor space, raw width maps to `63.5mm` and raw height maps to `88.9mm`. Reports include the orientation used and a consistency status; if X/Y estimates diverge beyond tolerance, the profile remains `isCalibrated=false` and the report warns rather than claiming a calibrated scale.

Overlay alignment is auditable in manifests/reports. The same template and ROI geometry are used for live preview and report overlay debug images, and reports include `templateRect`, `detectedBoundaryRect`, `centerOffsetPx`, optional `centerOffsetMm`, margins, detected/expected aspect ratio, `orientationUsed`, and `overlayAlignmentStatus`. If the detected card touches the frame edge, is off-center, or has an unexpected aspect ratio, the report records a framing warning.

The Basler fixed rig remains fixed overhead full-frame capture. Basler does not zoom automatically. Corner, edge, and surface screening uses full-resolution image ROIs/crops and remains uncalibrated until a real calibration/repeatability workflow is implemented. Dino-Lite remains optional manual close-up confirmation for later flagged or operator-requested regions.

`leimac-channel-characterization` is a supervised low-duty diagnostic for future multi-light work. It labels channels numerically only, safe-offs before and after each channel, captures dark/all-on/per-channel Basler images, computes image and quadrant brightness stats, and records `channelToPhysicalMappingStatus=unknown` unless later reviewed evidence supports an explicit inferred/confirmed mapping. It does not save persistent Leimac settings and rejects duty above 5%. Multi-light surface screening is future work after channel mapping and quality review.

`ai-grader-fixed-rig-v1-evidence-package` is a supervised uncalibrated evidence acquisition command. For front and back it captures a dark control, all-on synced Basler image, accepted active lighting profile image, and Leimac channels `1-8`, then generates portrait display images, overlays, and ROI crops for full card, corners, edges, and surface regions. It uses `evidenceClass=macro_fixed_rig_v1_uncalibrated`, writes outputs outside the repo, safe-offs around lighting, and does not compute a final grade or mark evidence calibrated.

PR #39 also includes a ruler-based fixed-fixture calibration and repeatability foundation for Mark's operator-built fixed-position V1 fixture. This is local/offline diagnostic tooling only. The preferred reference is now `referenceType=fixed_metric_rulers`: the operator captures a calibration image with fixed metric rulers visible, enters horizontal and vertical ruler-span pixel coordinates plus the known physical span in millimeters, and the helper computes `pixelsPerMmX/Y` and `mmPerPixelX/Y` from those ruler spans. Standard card size remains a cross-check/reference fallback, not the primary production-candidate scale source. Non-certified references are marked `ruler_reference_unvalidated` or `rough_reference_unvalidated`, and `isCalibrated=false` remains mandatory. The profile records fixture label/id, reference type, ruler span coordinates/distances, calibration image path, raw/display coordinate frames, display transform, pixel/mm and mm/pixel estimates, X/Y consistency warnings, detected/expected aspect ratio, lighting profile used, exposure/gain/duty/channels, operator acceptance, and notes. Lens distortion and homography remain `not_computed`.

Fixture reports now include a strict framing/margin gate and a production-readiness summary. The card must be fully visible, have margin around all edges, avoid touching image borders, be close to expected card aspect ratio, and have passing overlay alignment before the setup can be treated as a `production_candidate` diagnostic fixture. If the card touches the frame edge, the framing gate fails and the report records exact blockers. A production-candidate summary also requires ruler calibration, passing repeatability, locked lighting profile metadata, and final ring-light-off confirmation; it is still not a final grade, certificate, or certified calibration claim.

New rough fixture/repeatability command surfaces:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js fixed-rig-fixture-calibration `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-calibration `
  --exposure-us 45000 `
  --reference-type fixed_metric_rulers `
  --horizontal-span-mm 50 `
  --horizontal-start-px 100,100 `
  --horizontal-end-px 1100,100 `
  --vertical-span-mm 50 `
  --vertical-start-px 100,100 `
  --vertical-end-px 100,1100 `
  --fixture-label fixed-v1-l-stop `
  --operator-accepted `
  --apply `
  --confirm "RUN FIXED RIG ROUGH FIXTURE CALIBRATION" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off

pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js fixed-rig-repeatability-test `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --output-dir C:\TenKings\capture-data\fixed-rig-calibration `
  --repeatability-phase no-touch `
  --capture-count 5 `
  --exposure-us 45000 `
  --apply `
  --confirm "RUN FIXED RIG REPEATABILITY TEST" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green `
  --operator-confirmed-light-idle-off
```

`fixed-rig-repeatability-test` uses the active preview lighting profile unless a CLI override/reset is supplied. It reports no-touch or remove/re-place diagnostic repeatability metrics: center offset mean/max, optional mm offsets from the ruler profile when supplied, boundary width/height variation, pixel/mm variation, sharpness variation, brightness/clipping stability, overlay alignment counts, and `repeatabilityStatus=pass|warn|fail`. Remove/re-place mode requires `--operator-replace-confirmed`; it now defaults to five placements/captures unless `--capture-count` is supplied. An optional `--operator-replace-delay-ms` can pause between captures so the operator can re-seat the card. Normal evidence package capture does not wait between lighting configurations; only the front/back flip is human-gated. Repeatability does not set calibrated/final status.

The fixed-rig evidence package analysis now includes preliminary diagnostic-only grading scaffolding and 8-channel surface-analysis evidence. Centering is computed only when boundary/margin evidence exists and is labeled diagnostic. Corner and edge sections report ROI-level proxy metrics only. Surface analysis records per-channel image stats and portrait display images under `preliminary_surface_anomaly_detector_v0`; robust defect candidates remain `not_computed` unless accepted later. Reports and `analysis.json` explicitly record `finalGradeComputed=false`, `certifiedClaim=false`, and no final/certified grade output.

### Fixed-Rig Provisional Diagnostic Grading

PR #40 starts the first fixed-rig provisional diagnostic grading workflow on top of the PR #39 ruler-calibrated fixture outputs. It still does not create a final grade, label, QR report, certificate, or certified grading claim. All element scores are labeled `provisional_diagnostic`.

The fixed-rig evidence package now emits a clearer provisional diagnostic report banner: `Provisional Diagnostic Only - Not Certified - No Final Grade`. The report shows the accepted lighting profile, front/back portrait evidence, overlay images, ROI crops, centering/corner/edge diagnostic status, 8-channel thumbnails, and surface candidate summary while keeping raw Basler evidence in `basler_sensor_pixels`.

Centering diagnostics require fixed-ruler scale consistency plus passing framing and overlay gates. If the fixed-ruler profile, framing gate, or overlay alignment is not passing, centering returns `insufficient_evidence` instead of a placeholder score. When gates pass, centering reports left/right/top/bottom margins in px and mm, horizontal/vertical centering percentages, imbalance in px/mm, expected card size, confidence, and a provisional diagnostic score.

Corner and edge diagnostics use the portrait ROI definitions from the fixed-rig evidence package and report simple proxy metrics: sharpness, clipped/dark fraction, edge roughness proxy, contrast/texture proxy, high-frequency defect proxy, and visible boundary completeness. These are conservative diagnostic proxies only, not production corner/edge grades.

`preliminary_surface_anomaly_detector_v0` now computes per-channel anomaly proxy metrics from Leimac channel images, assumes fixed-rig registration, drops no raw evidence changes into the capture files, and can emit provisional candidate boxes using the center-surface ROI when an 8-channel outlier is present. Candidates include side, candidate id, display/raw rect when available, source channels, anomaly proxy score, severity band, and Dino-Lite follow-up recommendation. The detector remains preliminary and must not be treated as a final surface grade.

#### Dell PR #40 Provisional Diagnostic Smoke

On 2026-06-30, Mark ran the supervised fixed-rig provisional diagnostic grading smoke. Live preview output: `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-operator-preview-2026-06-30T155924860Z`; report: `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-operator-preview-2026-06-30T155924860Z\preview-report.html`. The preview window was accepted, measured `20.49 FPS` with `0 ms` frame age, displayed overlays, and recorded accepted lighting profile duty `1.2%`, PWM `12`, channels `1-8`, source `operator_preview`. Preview overlay alignment passed, but readiness stayed `not_ready` because clipping was high (`0.099016`), so this remains provisional diagnostic evidence only.

Front evidence package output: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160133846Z`; report: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160133846Z\preview-report.html`. Back evidence package output: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160426641Z`; report: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160426641Z\preview-report.html`. Both sides used the accepted `1.2%` active lighting profile and the fixed-ruler reference from PR #39: `50.8mm` horizontal span from raw px `540,205` to `1620,205`, `50.8mm` vertical span from raw px `2295,145` to `2295,1218`, operator card boundary `285,349,1878,1350`, `mmPerPixelX=0.047037`, `mmPerPixelY=0.047344`, scale consistency `pass`, and framing gate `pass`.

Front all-on raw SHA-256 was `98ddd3cc57ae4ae3ac20b176ab6d8c045231f95695f12990b343e44df0e3bc95`, `2704744` bytes, `2448x2048`; metrics: mean `129.4267`, clipped `0.107932`, dark `0.000942`, sharpness `773.7366`, overlay `pass`. Back all-on raw SHA-256 was `6ad6abe2f686c8a35233f1d06fce6d33f5770b2520a6fbdd19634222f41fac49`, `2003771` bytes, `2448x2048`; metrics: mean `171.5005`, clipped `0.337672`, dark `0.000098`, sharpness `1012.4593`, overlay `pass`. Each side captured dark control, all-on, accepted-profile, and channels `1-8`, generated 8 portrait channel displays, and generated 12 ROI crops.

Provisional diagnostic analysis computed centering, corners, edges, and preliminary surface anomaly outputs on both sides. Centering was `computed_diagnostic` with score `10`, horizontal centering `50%`, and vertical centering `50%` on both sides because the fixed-ruler scale, framing, and overlay gates passed. All four corner diagnostics and all four edge diagnostics were `computed_diagnostic` on both sides, but their scores are provisional proxy metrics and are biased by clipping. Surface analysis was `computed_diagnostic` with one low-severity V0 candidate per side: `front-surface-candidate-001` anomaly proxy `5.1747`, and `back-surface-candidate-001` anomaly proxy `2.2556`. Both candidates require later review/Dino-Lite follow-up before any production use.

The PR #40 smoke remains `macro_fixed_rig_v1_uncalibrated`; `isCalibrated=false`; `finalGradeComputed=false`; `certifiedClaim=false`. The run passed the fixed-rig provisional diagnostic evidence-package flow, but lighting/exposure still needs per-card tuning because front clipping was about `10.8%` and back clipping was about `33.8%`. Mark confirmed the final physical Leimac ring light state was off after safe-off.

PR #40 now adds a software-only unified card report combiner so a single report can show both sides of one card. It does not contact Basler or Leimac, does not capture images, and does not change raw evidence. It reads an existing front evidence-package folder plus an existing back evidence-package folder and writes a new card-level report under the fixed-rig output root:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-fixed-rig-v1-card-report `
  --output-dir C:\TenKings\capture-data\fixed-rig-v1 `
  --front-dir C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160133846Z `
  --back-dir C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T160426641Z
```

The accepted PR #40 unified report output is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-06-30T174702051Z`; the report HTML is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-06-30T174702051Z\provisional-diagnostic-report.html`. The report uses a premium front+back structure: Ten Kings title, session ID, provisional status badge, `Diagnostic Grade Pending` hero, front portrait hero image, element callouts for Centering/Corners/Edges/Surface, plain-English summary, front/back evidence, overlays, ROI crops, 8-channel evidence, and a technical appendix. It records the accepted lighting profile (`1.2%`, PWM `12`, channels `1-8`), fixed-ruler profile, framing/overlay pass, front/back diagnostic sections, and explicit clipping warnings. It still states `isCalibrated=false`, `finalGradeComputed=false`, `certifiedClaim=false`, and no final grade/certificate/certified claim.

### AI Grader Station Operator Workflow

PR #41 starts the internal AI Grader Station operator workflow as a real local orchestrator on top of the fixed-rig V1 commands from PR #39/#40. Mock mode remains available for tests and dry software review, but `--apply` now runs the supervised station sequence instead of stopping at a mock-only harness. The software-only command is:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-station-operator-workflow `
  --output-dir C:\TenKings\capture-data\ai-grader-station `
  --mock-run `
  --duty 1.2 `
  --exposure-us 45000 `
  --front-clipped-fraction 0.107932 `
  --back-clipped-fraction 0.337672 `
  --calibration-profile-id fixed-ruler-pr39 `
  --framing-overlay-pass `
  --repeatability-pass `
  --front-dir <front-evidence-package-dir> `
  --back-dir <back-evidence-package-dir>
```

The supervised hardware-capable station command is:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-station-operator-workflow `
  --output-dir C:\TenKings\capture-data\ai-grader-station `
  --leimac-host 169.254.191.156 `
  --leimac-port 1000 `
  --exposure-us 45000 `
  --gain 0 `
  --reference-type fixed_metric_rulers `
  --horizontal-span-mm 50.8 `
  --horizontal-start-px 540,205 `
  --horizontal-end-px 1620,205 `
  --vertical-span-mm 50.8 `
  --vertical-start-px 2295,145 `
  --vertical-end-px 2295,1218 `
  --card-boundary-rect 285,349,1878,1350 `
  --apply `
  --confirm "RUN AI GRADER STATION OPERATOR WORKFLOW" `
  --mark-present `
  --wiring-confirmed `
  --leimac-status-green
```

The station workflow is Mark's guided local operator surface for the fixed-rig V1 flow. It models these states: Start New Card, Verify Fixture/Rulers, Live Preview / Focus / Framing, Lighting / Exposure Tune, Accept Capture Profile, Capture Front, Prompt Flip Card, Capture Back, Run Provisional Diagnostics, View Unified Report, Rerun If Warnings, Export/Open Report, and Safe Off / End Session. In supervised `--apply` mode it invokes the existing `basler-fixed-rig-operator-preview` live Windows pylon preview, captures front and back evidence packages, generates the unified provisional diagnostic card report, and runs Leimac safe-off. It does not duplicate capture logic. The station prompts in a visible terminal for physical ring-light idle/off and fixture/ruler visibility before opening preview, prompts for the front/back flip after front capture and before back capture, and prompts for final physical ring-light-off only after safe-off cleanup. The only human-gated pause in the capture sequence is the front/back flip; per-side lighting configurations run continuously through the existing evidence-package command.

The PR #41 station output includes a local `manifest.json`, `station-report.html`, `integration-contract.json`, and a software active lighting profile file. The station report shows session status, accepted lighting profile, fixed-ruler calibration profile summary, framing/overlay and repeatability gates, clipping/focus warning surfaces, next operator action, report open/export paths, command plan/results, front/back evidence package paths, unified report path, provisional diagnostic rule outputs, operator confirmation records, and guardrail status. In mock mode it does not contact Basler or Leimac. In supervised hardware mode it contacts Basler/Leimac only through the existing guarded commands, requires `--apply`, the exact confirmation phrase, Mark/wiring/status flags, staged ring-light/fixture/flip/final-light confirmations, and final physical ring-light-off confirmation. Preview acceptance happens in the visible Basler preview window; if the operator aborts or closes without accepting, the station fails closed and safe-offs. Explicit confirmation flags still exist for automation or staged Codex runs, but they must be supplied only after the corresponding operator action has actually occurred; the normal supervised station run should use the interactive prompts instead of pre-confirming future actions.

Lighting/exposure tuning is a software decision layer in PR #41. It evaluates mean/clipping/dark/sharpness metrics when supplied, recommends lower Leimac duty and/or exposure when clipping exceeds the soft threshold, rounds duty to the Leimac 0.1% PWM step scale, caps duty at 5%, and requires explicit operator warning acceptance when capture quality remains outside thresholds. Preview tuning remains a local software profile; no persistent Basler or Leimac User Set is saved.

The provisional diagnostic scoring rules V0 are an explicit rules layer for Centering, Corners, Edges, and Surface. Each element returns `provisional_diagnostic` or `insufficient_evidence`, confidence, primary metrics, warnings, evidence references, and explanation text. Rules are gated by fixed-ruler calibration, framing/overlay pass, repeatability, clipping/focus warnings, and front/back evidence completeness. `finalGradeComputed=false`, `certificateGenerated=false`, and `certifiedClaim=false` remain mandatory.

PR #41 also documents a future integration contract without database changes. Reserved fields include `gradingSessionId`, optional `cardAssetId`, `reportId`, `reportStatus`, provisional/final status, reserved grade fields, reserved label/QR fields, report storage/export fields, front/back evidence references, and calibration profile reference. This prepares a later integration PR without adding migrations or runtime DB writes.

Local Dell supervised PR #41 station smoke on 2026-07-01 used the real `ai-grader-station-operator-workflow --apply` path with Mark present and staged interactive confirmations. The station terminal recorded physical ring light idle/off before preview, fixture/rulers visible before preview, and flip complete after front capture. The final physical light-off confirmation was not entered inside the station terminal, so the station manifest honestly ended as `status=blocked`; after the station safe-off step, Codex ran an explicit `leimac-idmu-safe-off` and Mark confirmed in chat that the physical ring light was off. Treat this run as functionally proving preview/front/back capture/report/safe-off, but not as a perfectly closed station-manifest acceptance unless Mark accepts the external final-light-off closeout.

The station output folder is `C:\TenKings\capture-data\ai-grader-station\ai-grader-station-operator-workflow-2026-07-01T083502382Z`, with `manifest.json`, `station-report.html`, and `integration-contract.json`. The Basler live preview folder is `C:\TenKings\capture-data\ai-grader-station\basler-fixed-rig-operator-preview-2026-07-01T080519758Z`; it reported about `20.5 FPS`, `0 ms` frame age, portrait overlays/sidebar, and an accepted operator-preview profile of Leimac duty `1.3%`, PWM step `13`, channels `1-8`, exposure `45000 us`, gain `0`, Basler `LineInverter=true`, Leimac `TriggerActivation=LevelLow`.

The front evidence folder is `C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T082954516Z`; the back evidence folder is `C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T083251860Z`; the unified provisional diagnostic report is `C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T083500922Z\provisional-diagnostic-report.html`. Each side captured `11` raw Basler images, generated `8` portrait channel display images, and generated `12` ROI crops. The unified report records fixed-ruler spans of `50.8 mm` horizontally from `540,205` to `1620,205` and `50.8 mm` vertically from `2295,145` to `2295,1218`, with `mmPerPixelX=0.047037`, `mmPerPixelY=0.047344`, `pixelsPerMmX=21.2599`, `pixelsPerMmY=21.122`, scale consistency `pass`, `framingGateStatus=pass`, and `overlayAlignmentStatus=pass`.

The unified report status is `computed_diagnostic`, evidence class `macro_fixed_rig_v1_uncalibrated`, `isCalibrated=false`, `finalGradeComputed=false`, and `certifiedClaim=false`. It contains front/back evidence images, centering diagnostics, corner diagnostics, edge diagnostics, surface anomaly diagnostics, and no final grade or certificate/certified claim. Centering computed as provisional diagnostic score `10` on both sides. Front corners/edges computed as provisional diagnostic score `8.26` with a clipping warning; back corners/edges computed as `9.68`. Surface analysis used `preliminary_surface_anomaly_detector_v0` and produced one low-severity front candidate from channel `3` plus one low-severity back candidate from channels `3,4`. Front clipping remains above the soft target: all-on `0.033017`, accepted-profile `0.031747`. Back clipping was low: all-on `0.000656`, accepted-profile `0.00064`.

### Ten Kings Vision Lab V0

PR #42 extends the software-only `ai-grader-fixed-rig-v1-card-report` output with Ten Kings Vision Lab V0, an interactive local static HTML inspection widget inside the unified front/back provisional diagnostic report. Vision Lab is not a hardware command and does not contact Basler or Leimac. It reads existing front/back evidence package folders, writes a new report outside the repo, and preserves clean raw evidence images in `basler_sensor_pixels`.

Vision Lab V0 includes `True View`, `Surface Vision V0`, `Heatmap`, `Light Sweep Wheel`, `Measurement Overlay`, `Confidence Lens`, and `Evidence Replay` modes, plus front/back toggle, zoom/pan, severity filters, and Collector/Expert mode. The Light Sweep Wheel shows channels `1-8` numerically only; physical direction mapping remains pending until characterized and reviewed. Surface Vision V0 is labeled as directional light evidence visualization, not certified photometric stereo. Measurement overlay uses fixed-ruler calibration metadata when present and reports unavailable instead of guessing when calibration metadata is missing. Confidence Lens exposes clipping, focus/framing, missing-evidence, and low-confidence diagnostics so the report shows evidence strength as well as findings.

The Vision Lab data contract is embedded in `analysis.json` under `visionLab` and referenced from the report manifest. It includes front/back true-view image refs, overlay refs, channel image refs, heatmap/glare-mask refs when available, anomaly candidates, evidence replay metadata, measurement overlay calibration fields, and confidence warnings. The report keeps the top-level banner `Provisional Diagnostic - Not Certified - No Final Grade`; `isCalibrated=false`, `finalGradeComputed=false`, and `certifiedClaim=false` remain mandatory.

Sample PR #42 report generated from the accepted PR #41 station evidence without new hardware access:

```text
C:\TenKings\capture-data\vision-lab-pr42\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T092011021Z\provisional-diagnostic-report.html
```

Source evidence reused:

```text
Front: C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T082954516Z
Back:  C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T083251860Z
```

### Preliminary Surface Intelligence V0

PR #43 adds `preliminary_surface_intelligence_v0` to the existing software-only unified report path. It reads the front/back fixed-rig evidence packages already captured by PR #41, uses the portrait Leimac channel `1-8` display images, and generates derived report artifacts outside the repo. It does not contact Basler or Leimac, does not capture images, and does not alter raw evidence.

The V0 surface pipeline performs dark-aware directional response processing when matching inputs are available, normalizes the channel stack, creates clipping/glare and underexposure confidence masks, builds a combined anomaly response map, and restricts analysis to the full-card ROI when available. It writes per-side artifacts:

- `*-surface-intelligence-v0-heatmap.png`
- `*-surface-vision-v0.png`
- `*-glare-clipping-mask.png`
- `*-underexposure-mask.png`
- `*-surface-intelligence-v0.json`

Surface Vision remains labeled `Surface Vision V0 - directional light evidence visualization`; this is not certified photometric stereo. Candidate source attribution uses numeric Leimac channels only because physical direction mapping remains pending. Candidates include side, display rect, severity proxy/band, confidence, source channels, strongest channel, evidence refs, and `needsDinoLiteFollowUp`.

The PR #43 sample report was generated from existing PR #41 station evidence only:

```text
Report: C:\TenKings\capture-data\surface-intelligence-pr43\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T100837933Z\provisional-diagnostic-report.html
Front evidence: C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T082954516Z
Back evidence:  C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T083251860Z
```

Sample artifacts:

```text
Front heatmap: C:\TenKings\capture-data\surface-intelligence-pr43\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T100837933Z\surface-intelligence\front\front-surface-intelligence-v0-heatmap.png
Front Surface Vision: C:\TenKings\capture-data\surface-intelligence-pr43\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T100837933Z\surface-intelligence\front\front-surface-vision-v0.png
Back heatmap: C:\TenKings\capture-data\surface-intelligence-pr43\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T100837933Z\surface-intelligence\back\back-surface-intelligence-v0-heatmap.png
Back Surface Vision: C:\TenKings\capture-data\surface-intelligence-pr43\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T100837933Z\surface-intelligence\back\back-surface-vision-v0.png
```

The sample emitted `8` front candidates and `8` back candidates. Front confidence was `medium` because the V0 glare/clipping mask fraction was `0.068289`; back confidence was `high` with clipping mask fraction `0.001159`. Representative source-channel attribution used numeric channels such as front strongest channel `3`/`4` and back strongest channel `3`/`4`. Treat these as conservative preliminary evidence candidates only; no final surface grade, certificate, or certified claim is generated.

### Light Direction Calibration / Normal-Relief Proxy Prep

PR #44 adds a software-only light-direction calibration foundation to the existing unified fixed-rig report path. It does not contact Basler or Leimac, does not capture images, and does not save persistent Basler or Leimac User Sets. The report command reads existing front/back evidence package folders and writes derived artifacts outside the repo.

The light-direction profile records Leimac channel metadata for channels `1-8`, per-channel intensity balancing metrics, optional flat-field/reference normalization status, normal-map status, source evidence refs, warnings, and `isCertifiedPhotometricStereo=false`. Until a physical light-direction calibration target is run and reviewed, the channel direction model is `approximate_directional_model` only. Channel labels remain numeric `Channel 1` through `Channel 8`; no north/east/etc. physical direction labels are invented.

The PR #44 pipeline generates derived artifacts when the 8-channel portrait display stack is available:

- normalized per-channel images
- preliminary normal proxy map
- gradient magnitude proxy map
- surface relief proxy map
- confidence map
- light-direction profile JSON
- normal/relief proxy JSON

These artifacts are labeled `Preliminary normal/relief proxy - approximate directional model`. They are not certified photometric stereo, not a final surface grade, and not production certification. If no certified flat-field reference is supplied, the module uses fallback normalization from the current evidence and reports that warning explicitly. High clipping, glare, underexposure, missing channels, or fallback normalization reduce confidence.

Vision Lab now includes `Normal Proxy`, `Relief Proxy`, and `Confidence Map` views, plus expert `Channel Balance` and `Light Direction Status` panels. Missing artifacts render as an unavailable state rather than guessing.

The PR #44 sample report was generated from existing PR #41 station evidence only:

```text
Report: C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\provisional-diagnostic-report.html
Front evidence: C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T082954516Z
Back evidence:  C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T083251860Z
```

Sample normal/relief artifacts:

```text
Front normal proxy:     C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\front\front-preliminary-normal-proxy.png
Front relief proxy:     C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\front\front-surface-relief-proxy.png
Front confidence map:   C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\front\front-light-direction-confidence-map.png
Back normal proxy:      C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\back\back-preliminary-normal-proxy.png
Back relief proxy:      C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\back\back-surface-relief-proxy.png
Back confidence map:    C:\TenKings\capture-data\light-direction-pr44\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T105021412Z\light-direction\back\back-light-direction-confidence-map.png
```

Sample summary: physical direction mapping `approximate_directional_model`, intensity balancing `intensity_balanced`, flat-field status `unknown`, normal-map status `preliminary_normal_proxy`, front/back confidence `medium`. The sample still carries front clipping/glare warnings and fallback-normalization warnings.

### Provisional Grade Rules / Grade Story Engine

PR #45 adds the first controlled provisional grade calculation layer and Grade Story Engine to the existing unified fixed-rig report path. It is software-only by default: `ai-grader-fixed-rig-v1-card-report` reads existing front/back evidence folders, writes a derived report outside the repo, and does not contact Basler or Leimac.

The Grade Story Engine emits `provisional_diagnostic_grade` only when the required gates pass or are explicitly allowed as accepted diagnostic warnings. Required gates are fixed-ruler calibration, repeatability, framing/overlay, front evidence completeness, back evidence completeness, Surface Intelligence completeness, clipping threshold or accepted warning, and focus/sharpness threshold or accepted warning. If a hard gate fails, the story returns `insufficient_evidence`, explains the failed gate, and omits the provisional grade.

When allowed, the rules output:

- provisional overall grade on a `1_to_10` scale
- provisional element scores for centering, corners, edges, and surface
- confidence score/band and confidence warnings
- grade-impact candidates with evidence refs and source channels where available
- `Why Not 10?` reasons
- evidence-linked narrative claims for Story Mode
- formula metadata and cap rules

All PR #45 outputs remain non-certified. The report and JSON keep `certificationStatus=not_certified`, `finalGradeComputed=false`, `certifiedClaim=false`, `labelGenerated=false`, `qrGenerated=false`, and `certificateGenerated=false`. The report hero may show a provisional diagnostic grade, but it must also show `Not Certified - No Final Grade`.

The PR #45 sample report was generated from existing PR #41 station evidence only:

```text
Report: C:\TenKings\capture-data\provisional-grade-story-pr45\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T173733758Z\provisional-diagnostic-report.html
Front evidence: C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T082954516Z
Back evidence:  C:\TenKings\capture-data\ai-grader-station\ai-grader-fixed-rig-v1-evidence-package-2026-07-01T083251860Z
```

Sample PR #45 result: status `provisional_diagnostic_grade`, provisional overall grade `8.5`, confidence `low` (`0.361`). Element scores were centering `10`, corners `8.97`, edges `8.97`, and surface `5.5`. Gates passed for ruler calibration, framing/overlay, front evidence, back evidence, Surface Intelligence, and focus/sharpness; repeatability and clipping were accepted diagnostic warnings from the existing evidence artifacts. The strongest `Why Not 10?` reasons were high-severity back surface candidates from Surface Intelligence V0, especially source channels `3`, `1`, and `6`, plus accepted-warning clipping confidence reduction. This is a provisional diagnostic story only, not a final grade or certificate.

### Local Operator Station / Web Report Viewer V0

The local operator station web pass adds the first browser-facing station shell for the Dell capture node. The local operator page is available in the Next.js app at the fixed Dell dev URL:

```text
http://127.0.0.1:3020/ai-grader/station
```

The sample fixture-backed report viewer is:

```text
http://127.0.0.1:3020/ai-grader/reports/sample-pr45
```

It is intentionally local/no-login and shows Start New Card, fixture/ruler checklist, live preview launch/status, lighting/exposure tune status, accepted profile summary, Capture Front, Flip Card, Capture Back, Run Diagnostics, Open Report, Rerun, Safe Off, End Session, warnings, and report links. The Next.js route still has a safe contract/mock fallback for development, but PR #46 adds a real local Dell bridge path: the browser can call a loopback-only capture-helper service that orchestrates the existing PR #41 station command plan. The bridge is disabled by default, requires an explicit local station enable flag, requires a station token, only accepts loopback hosts, origin-checks browser calls, and requires the same Mark-present/wiring/status/apply flags before hardware mode is available. Public/shareable report pages never expose these hardware actions.

The local station API contract is exposed under:

```text
GET  /api/ai-grader/station/status
POST /api/ai-grader/station/start-session
POST /api/ai-grader/station/confirm-light-idle-off
POST /api/ai-grader/station/confirm-fixture-rulers
POST /api/ai-grader/station/launch-preview
POST /api/ai-grader/station/accept-profile
POST /api/ai-grader/station/capture-front
POST /api/ai-grader/station/confirm-flip
POST /api/ai-grader/station/capture-back
POST /api/ai-grader/station/run-diagnostics
POST /api/ai-grader/station/export-report-bundle
POST /api/ai-grader/station/safe-off
POST /api/ai-grader/station/end-session
GET  /api/ai-grader/station/latest-report
GET  /api/ai-grader/station/session-manifest
```

The API contract is safe for local development: `hardwareActionsEnabled=false`, `databaseConnected=false`, `databaseWrites=false`, `finalGradeComputed=false`, `certifiedClaim=false`, `labelGenerated=false`, `qrGenerated=false`, and `certificateGenerated=false`.

The production Dell operator workflow uses installed local station software. The browser still cannot directly control Basler/Leimac hardware; it talks to a loopback-only bridge on the Dell. The bridge should be installed once as a Windows Scheduled Task under the Dell operator user:

```powershell
.\scripts\ai-grader\install-local-station-bridge.ps1 -StartNow -CreateShortcut
```

Normal operator use after install:

1. Open the `Ten Kings AI Grader Station` desktop shortcut.
2. The shortcut starts/restarts the local Dell bridge, generates a short local pairing code, and opens Google Chrome directly with the dedicated AI Grader profile at `C:\TenKings\chrome-ai-grader-profile`.
3. First use in that dedicated Chrome profile requires the normal Ten Kings SMS sign-in with an approved AI Grader operator/admin account.
4. The page checks `http://127.0.0.1:47652/health`.
5. If this dedicated Chrome profile is already paired, it auto-connects with the locally saved browser token.
6. If pairing is needed, the desktop shortcut opens the station with the short local pairing code in the URL fragment; the page exchanges that code with `POST http://127.0.0.1:47652/pair` and stores the returned local bridge token in this Dell/browser `localStorage`.
7. Start New Card from the station UI.

Browsing directly to `https://collect.tenkings.co/ai-grader/station` is useful for checking production sign-in, but it may not use the same local bridge pairing state. The desktop shortcut is the normal operator entry point because it keeps Ten Kings sign-in and Dell bridge pairing in one stable Chrome profile. The shortcut must not print the pairing code, local station token, or production session token.

The local bridge config is stored outside git:

```text
C:\TenKings\config\ai-grader-local-bridge.json
```

The config contains the local bridge token and pairing code and should not be committed or pasted into logs. The installer attempts to lock file permissions to the current Windows user, Administrators, and SYSTEM. Status output redacts secrets and prints only non-secret fingerprints:

```powershell
.\scripts\ai-grader\status-local-station-bridge.ps1
```

Maintenance commands:

```powershell
.\scripts\ai-grader\open-local-station.ps1 -RestartBridge
.\scripts\ai-grader\stop-local-station-bridge.ps1 -KillProcess
.\scripts\ai-grader\rotate-local-station-bridge-token.ps1 -RestartBridge
.\scripts\ai-grader\uninstall-local-station-bridge.ps1 -KillProcess -RemoveShortcut
```

The Scheduled Task starts `scripts/ai-grader/start-local-station-bridge.ps1 -Real` at user logon. The script reads the local token from config and passes it to the bridge process through the child process environment, not through task/shortcut command-line arguments. It allows `https://collect.tenkings.co`, binds only to `127.0.0.1:47652`, uses output directories under `C:\TenKings\capture-data`, and carries the accepted fixed-ruler Dell rig defaults.

Mock bridge mode remains available for development and does not contact hardware:

```powershell
.\scripts\ai-grader\start-local-station-bridge.ps1 -NoLocalConfig
```

The supervised hardware-capable bridge mode remains local-only and guarded. Starting the bridge does not capture images or turn on lighting by itself. Hardware actions still require the production station UI, the local bridge token, and staged operator confirmations. Public/shareable report pages never expose bridge tokens, pairing codes, or hardware controls.

The bridge exposes public local `GET /health`, pairing `POST /pair`, token-gated `GET /status`, `GET /latest-report`, `GET /session-manifest`, and token-gated `POST /actions/<action>`. Actions are staged: `start-session`, `confirm-light-idle-off`, `confirm-fixture-rulers`, `launch-preview`, `accept-profile`, `capture-front`, `confirm-flip`, `capture-back`, `run-diagnostics`, `export-report-bundle`, `safe-off`, and `end-session`. The bridge writes station session manifests outside the repo and fails closed if required confirmations, side outputs, report outputs, or safe-off cleanup are missing.

A public/shareable report viewer foundation is available at:

```text
/ai-grader/reports/[reportId]
```

The route is read-only, has no hardware controls, performs no DB lookup/write, and shows provisional diagnostic report content with Vision Lab-style sections and graceful missing-asset states. The fixture/sample report remains `sample-pr45`, but generated Dell station report IDs can now resolve through the token-gated local bridge when the browser opened the report from the station page. The station page stores only the local bridge URL/token in Dell browser local storage; the report viewer uses that token to fetch `GET /reports/<reportId>/bundle` from the local bridge and displays the generated local `report-bundle.json` data. If the local bridge/token is missing, the report route shows an explicit local-bridge-needed state instead of pretending fixture data is the generated report. This is the foundation for a future `collect.tenkings.co/...` report viewer, not a QR/certificate flow.

PR #46 also adds read-only bridge report endpoints:

```text
GET /report-history
GET /reports/<reportId>/bundle
GET /reports/<reportId>/html
```

All three endpoints remain loopback-only, token-gated, and read-only. They do not expose hardware controls, do not write the database, and do not upload files. `/report-history` builds a local file-backed history index from station session manifests and report bundles under the local AI Grader output root. The browser station history panel uses that endpoint to show recent local card reports, list/tile views, basic all-time/month/week/day counts, provisional grade counts, and average provisional grade when available. Missing card category metadata is displayed as `Unknown`.

After a bridge restart, `GET /status` also promotes the newest existing local station report from `station-session.json` history into `latestReport` when no active in-memory session is loaded. This keeps the browser station `View Report` control usable for the most recent generated report even after restarting the Dell bridge. The 2026-07-02 PR #46 retest verified the generated report route `http://127.0.0.1:3020/ai-grader/reports/ai-grader-browser-station-session-2026-07-02T035658313Z-report` rendered the real generated bundle (`6.69`, `No Final Grade`) instead of the `sample-pr45` fallback when the station token was present, and Card History showed the generated local report path and provisional grade.

The station page has been redesigned into a cockpit-style local workflow. The first screen is a large camera workspace with a placement guide and right-side control sidebar. The sidebar surfaces Start New Card, Start Grading, lighting/exposure draft values, report readiness, Safe Off, local paths, preview status, and command timing. Start Grading acts as the operator's ready confirmation for light idle/off plus fixture/ruler visibility, accepts the current software profile, and captures the front. After front capture the page displays a red flip-card scrim; once the operator confirms the back is seated, the page captures the back, generates diagnostics, exports the local report bundle, and refreshes history. The only required operator pause in the browser flow is the front/back flip.

PR #57 adds the embedded browser preview foundation. The Dell loopback bridge now exposes token-gated, local-only `GET /preview/status` and `GET /preview/stream` endpoints. The stream is an MJPEG fetch stream from `127.0.0.1:47652`, requires the browser-local station token, and is allowed only from the configured station origin such as `https://collect.tenkings.co`. In real mode the Basler bridge opens a continuous pylon grab stream, rotates frames for portrait viewing, encodes JPEG frames in memory, and writes multipart frames to the browser. It does not command Leimac lighting, does not save persistent Basler/Leimac settings, does not use the production AI Grader service-account token, and is never exposed through public report routes. In mock mode the same stream contract emits synthetic local frames for tests and UI development only.

Preview and capture use an explicit camera ownership handoff. Live browser preview is for positioning, focus, lighting/exposure tuning, and advisory geometry detection. The bridge stops/releases the preview process before each full-forensic side capture so only one owner can access Basler. After the front raw package is safely captured, it releases the forensic hold and permits a fresh preview for flip/back positioning while front artifact processing continues. Before back capture, the preview is stopped again; the hold stays active through the back capture and synchronous report path, or is detached with the captured session when rapid mode safely queues background finalization. Preview never runs concurrently with a Basler capture action. Full forensic capture is not reduced: both sides still use dark control, all-on, accepted profile, channels `1-8`, ROI/display artifacts, Surface Intelligence, Vision Lab, and unified report generation.

If true live preview during capture is required later, it should be implemented as a single in-process hardware owner that streams and captures from the same Basler session. A separate MJPEG preview process and the warm forensic capture process must never own Basler at the same time.

PR #57 also adds timing instrumentation without implementing the warm runner yet. Bridge status/session manifests now carry a timing summary with command-level entries plus available nested timings for Basler open/configure/grab/save/hash/close-dispose, Leimac write/ack/safe-off, front and back package totals, report generation, preview start/first-frame, local report open, publish/upload placeholders, and phase breakdown fields. The current workflow still delegates to existing capture-helper commands; the next speed PR should build a warm-session runner to remove process startup and repeated hardware setup while preserving the complete evidence stack.

The capture-helper now includes a software-only report-bundle export command for converting an existing local unified report folder into a web-ready bundle:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js ai-grader-report-bundle `
  --report-dir C:\TenKings\capture-data\provisional-grade-story-pr45\ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-01T173733758Z `
  --output-dir C:\TenKings\capture-data\ai-grader-report-bundles `
  --report-id sample-pr45
```

The command writes `report-bundle.json`, `asset-manifest.json`, and `checksums.json` outside the repo. The bundle reserves future public storage, label, QR, certificate, slab photo, and eBay comps fields, but does not upload files, write the database, generate labels/QR/certificates, or claim a final/certified grade.

DB and storage integration remain intentionally deferred in PR #46. Existing Prisma AI Grader entities (`CaptureSession`, `CaptureManifest`, `GradeRun`, `EvidenceArtifact`, `CalibrationSnapshot`, and related reserved certificate/report shapes) are the likely production record home once migrations are approved. Existing storage/presign helpers are the likely upload path for bundle assets. PR #46 adds no migration, applies no migration, writes no runtime DB record, and performs no cloud upload; it keeps the file-backed report bundle and documents the future integration contract.

The first sample bundle from the PR #45 report was written to:

```text
C:\TenKings\capture-data\ai-grader-report-bundles\sample-pr45\report-bundle.json
C:\TenKings\capture-data\ai-grader-report-bundles\sample-pr45\asset-manifest.json
C:\TenKings\capture-data\ai-grader-report-bundles\sample-pr45\checksums.json
```

#### Dell PR #39 Rough Fixture Smoke

On 2026-06-30, Mark ran the rough fixed-fixture flow using the operator-built fixed-position V1 fixture. The accepted live preview folder is `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-operator-preview-2026-06-30T062619141Z`. The preview measured about `20.5 FPS` with `0 ms` frame age and accepted a software active profile of `1.4%` Leimac duty, PWM step `14`, channels `1-8`, source `operator_preview`. Preview/report display used `rotate90cw`; raw Basler sensor captures remained unchanged. The preview and later reports warned that the detected card boundary touched the frame edge, so the run remains rough/unvalidated and not calibrated.

The rough fixture calibration output is `C:\TenKings\capture-data\fixed-rig-calibration\fixed-rig-fixture-calibration-2026-06-30T063338472Z`. It used `referenceType=card_dimensions`, fixture label `fixed-v1-l-stop`, and the accepted `1.4%` active lighting profile. The resulting profile is `rough_reference_unvalidated` with `isCalibrated=false`, `mmPerPixelX=0.039025`, `mmPerPixelY=0.031006`, and pixel-scale consistency `warn`.

The no-touch repeatability output is `C:\TenKings\capture-data\fixed-rig-calibration\fixed-rig-repeatability-test-2026-06-30T063417135Z`. It captured five repeated synced images at the accepted `1.4%` profile and reported `repeatabilityStatus=warn`, `centerOffsetMeanPx=84.6015`, `boundaryWidthVariationPx=1`, `boundaryHeightVariationPx=0`, and `clippingMax=0.01448`. Remove/re-place repeatability was not run in this smoke because that optional diagnostic specifically requires operator re-seat pauses; normal evidence package capture should run continuously per side and only pause for front/back flip.

The fixed-rig V1 uncalibrated evidence package was captured for front and back. Front output is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T064206795Z`; back output is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T064843000Z`. Front used the accepted preview profile at `1.4%`; back was explicitly run with `--duty 1.4` after the back-positioning preview briefly accepted `1.2%`, so the back manifest records `profileSource=cli_override`. Each side captured 11 raw images: dark control, all-on, accepted-profile, and Leimac channels `1-8`; each also produced 8 portrait channel displays and 12 ROI crops. Front all-on raw SHA-256 is `3844fffbf4e0f52181608b13be9ebf8a8af26628c5e9cd523a9e023452399a72`, `2843916` bytes, `2448x2048`. Back all-on raw SHA-256 is `4a282671b0fba6f44505bc857a0651d3c6dcd8cdb2e431ca5255bf81613754f2`, `2680124` bytes, `2448x2048`.

This smoke verifies the rough fixture, preview profile carry-over, no-touch repeatability report, front/back raw evidence package, portrait display outputs, ROI crops, and per-channel surface-analysis evidence schema. It does not verify production calibration. The evidence class remains `macro_fixed_rig_v1_uncalibrated`; `isCalibrated=false`; preliminary diagnostic grading sections are labeled `computed_diagnostic`; surface analysis remains `not_computed` with no accepted robust defect candidates. Mark confirmed final physical Leimac ring light state off.

#### Dell PR #39 Fixed-Ruler Acceptance Smoke

Later on 2026-06-30, Mark aligned physical rulers in the fixed-position fixture using the live Basler preview and accepted the fixture/re-seat behavior as passed for production-candidate fixture positioning. The fixed-ruler calibration output is `C:\TenKings\capture-data\fixed-rig-calibration\fixed-rig-fixture-calibration-2026-06-30T075916276Z`. It used `referenceType=fixed_metric_rulers` with a `50.8mm` horizontal span from raw px `540,205` to `1620,205` and a `50.8mm` vertical span from raw px `2295,145` to `2295,1218`. The operator-entered raw card boundary override was `285,349,1878,1350`. The resulting scale is `pixelsPerMmX=21.2599`, `pixelsPerMmY=21.122`, `mmPerPixelX=0.047037`, and `mmPerPixelY=0.047344`, with X/Y consistency `pass` and relative difference `0.0065`. The framing gate and overlay alignment both passed; margins were `285px` left/right and `349px` top/bottom.

The guided remove/re-seat repeatability output is `C:\TenKings\capture-data\fixed-rig-calibration\fixed-rig-repeatability-test-2026-06-30T080625670Z`. It ran `5` remove/re-place captures and Mark accepted the geometry as passed for production fixture positioning. Geometry metrics were stable: center offset max `0.7071px` (`0.0334mm`), boundary width variation `0px`, boundary height variation `0px`, and overlay alignment passed for all runs. The manifest still reports `repeatabilityStatus=warn` because clipping reached `0.082032`; treat that as a per-card lighting/exposure tuning warning, not a fixture positioning failure.

The fixed-rig V1 uncalibrated evidence package was rerun with the fixed-ruler metadata and the same operator boundary. Front output is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T082102851Z`; back output is `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-30T082749115Z`. Each side captured dark control, all-on, accepted-profile, and Leimac channels `1-8`, then generated 8 portrait channel displays and 12 ROI crops. Front all-on raw SHA-256 is `5879d28284911cdd4e845276f3d37a9c99fee8690a4648e78e672c306be5b571`; back all-on raw SHA-256 is `cf27e1ff636fb67eb911a91091077308282a3293c1970660105b8adc72e36e38`. Reports use `displayTransform=rotate90cw` for portrait display while raw evidence remains unchanged in `basler_sensor_pixels`.

This fixed-ruler smoke clears the fixture-positioning/re-seat gate for diagnostic production-candidate use as accepted by Mark, but it is still not certified calibration. `isCalibrated=false` remains mandatory. Lighting/exposure stays per-card tunable; the `1.4%` duty evidence package still shows clipping warnings, especially on the back side. Channel physical mapping, robust surface anomaly candidates, and ring-glare mitigation remain future work. Mark confirmed the final physical Leimac ring light state was off.

#### Ring Reflection / Glare Limitation

During PR #39 preview review, Mark observed a circular ring reflection on the card. Treat this as an unresolved optical setup issue, not a software-calibrated condition. The likely cause is specular reflection from a glossy card, sleeve, or slab surface reflecting the ring/dome geometry into the fixed overhead Basler view. This can affect focus perception, clipping, surface anomaly screening, and later ROI measurements.

Near-term software-safe mitigations to evaluate without physical modification are lower exposure/duty, selective Leimac channel subsets, multi-light profiles that avoid known glare zones, dark hood/ambient-light control, and flagging glare-affected pixels/regions instead of treating them as surface defects. These do not solve the optical reflection by themselves and must be tested.

Physical mitigation candidates require explicit material/hardware review before use: cross-polarization with polarizing film over the light and an analyzer polarizer on the Basler lens, diffuser film/sheet between Leimac and card, dome/geometry changes, or changing ring height/angle. Tradeoffs include lower intensity, possible unevenness, heat/material compatibility, reduced contrast, and new calibration requirements. Cross-polarization is the strongest candidate for glossy specular glare, but it requires buying/placing polarizers and rotating the lens analyzer under supervision. Diffusion may soften the ring reflection but may also reduce intensity and require exposure/duty retuning. No PR #39 code or smoke may claim the ring reflection is solved until a controlled test proves it.

#### Dell PR #39 Supervised Smoke

On 2026-06-29, Mark accepted the fixed-rig operator preview after the Windows preview was changed to a pylon live stream and preview lighting controls were revised. The accepted preview artifact folder is `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-operator-preview-2026-06-29T210409349Z`. The preview displayed `4387` frames at about `20.44 FPS` with `2 ms` frame age, and Mark confirmed he could adjust physical Basler focus in real time while watching the PC window. Mark also confirmed the 8-section UI ring stopped flickering, the hardware brightness slider no longer caused a bright flash before settling, and the final Leimac ring light state was off. Preview lighting was safe-offed on exit; later PR #39 work changed accepted preview lighting from diagnostic-only to a local software active profile for subsequent fixed-rig commands, without saving persistent Leimac/Basler settings.

The enhanced focus/framing assistant was run at the selected V1 setting (`1.2%` Leimac duty, `45000 us` Basler exposure, gain `0`). Output folder: `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-focus-assist-2026-06-29T210908156Z`. Results: mean `45.3715`, clipped fraction `0.00007`, dark fraction `0.073087`, sharpness `206.7911`, detected card boundary coverage `0.84895`, and uncalibrated pixel/mm estimates `x=0.026392`, `y=0.050254`. ROI definitions were computed from the approximate detected boundary and overlays were saved separately from raw captures.

The Leimac 8-channel characterization was run at `1%` duty and `45000 us` exposure. Output folder: `C:\TenKings\capture-data\fixed-rig-calibration\leimac-channel-characterization-2026-06-29T211116513Z`. It captured dark control, all-on, and channels `1` through `8`, with safe-off before and after each channel. `channelToPhysicalMappingStatus` remains `unknown`; quadrant brightness did not support directional inference, so no physical mapping was invented. Mark confirmed the final physical ring light state was off. PR #39 remains calibration/preview foundation only: `isCalibrated=false`, manual focus, channel mapping unconfirmed, and no final/certified grading claim.

#### Dell PR #39 Active Profile / Evidence Package Follow-Up

Later on 2026-06-29, Mark accepted the active preview lighting profile at `1.3%` Leimac duty, PWM step `13`, channels `1-8`, `profileSource=operator_preview`. The profile was stored outside the repo at `C:\TenKings\capture-data\fixed-rig-active-lighting-profile.json`; no persistent Basler or Leimac User Set was saved. The focus/framing assistant was run without a CLI duty override and proved carry-over from the accepted profile: manifest selected duty `1.3%`, PWM `13`, source `operator_preview`, output `C:\TenKings\capture-data\fixed-rig-calibration\basler-fixed-rig-focus-assist-2026-06-29T224331062Z`, mean `54.3913`, clipped `0.001314`, dark `0.068241`, sharpness `402.9915`, display transform `rotate90cw`. Framing remained `warn` because the card was near the frame edge, and pixel/mm consistency remained `warn`.

The fixed-rig V1 uncalibrated evidence package was run side-by-side so Mark could use the live preview before the back capture. Front output: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-29T225500347Z`. Back output: `C:\TenKings\capture-data\fixed-rig-v1\ai-grader-fixed-rig-v1-evidence-package-2026-06-29T230849461Z`. Both used the accepted `1.3%` active profile and generated dark control, all-on, accepted-profile, channel `1-8`, portrait display, overlay, and 12 ROI crop artifacts. Front all-on metrics: mean `61.0675`, clipped `0.010289`, dark `0.025929`, sharpness `494.9914`, card coverage `0.940953`, overlay alignment `warn`. Back all-on metrics: mean `120.8304`, clipped `0.013025`, dark `0.053224`, sharpness `681.029`, card coverage `0.690135`, overlay alignment `pass`. Both reports use portrait display assets (`rotate90cw`) while raw Basler captures remain unchanged in sensor coordinates. Evidence class remains `macro_fixed_rig_v1_uncalibrated`; `isCalibrated=false`; no final grade, certificate, or certified grading claim was made. Mark confirmed the final physical ring light state was off.

#### AI Grader Production Release V0

The production release V0 helper adds the first software-side finalization/export layer on top of the local AI Grader report bundle. It does not run hardware and the standalone helper still does not write the production database, upload storage assets, or apply migrations. The command is:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec ai-grader-production-release --report-bundle-path <report-bundle.json> --output-dir C:\TenKings\capture-data\ai-grader-production-releases --operator-id <operator> --operator-accepted-warnings
```

The command writes local artifacts outside the repo: `production-release.json`, `label-data.json`, `publication-manifest.json`, and `integration-contract.json`. These artifacts contain the final AI-Grader Grade V0 calculation, element scores, confidence, gates, accepted warnings, operator finalization metadata, report/public URL placeholders, label-ready data, QR payload URL data, slabbed photo placeholders, eBay comps placeholders, and card/inventory linkage contracts.

PR #47 adds the reviewed production persistence/publication foundation, but keeps it disabled until an approved migration/storage rollout:

- Prisma models and a migration file are present for `AiGraderSession`, `AiGraderReport`, `AiGraderEvidenceAsset`, `AiGraderGrade`, `AiGraderLabel`, `AiGraderPublication`, and `AiGraderValuation`.
- The migration is committed for review only and was not applied by Codex. `RUN_DB_MIGRATIONS=true` must remain unset unless an explicit migration rollout is approved.
- The admin API route `/api/admin/ai-grader/production/[...action]` exposes `status`, `publish-init`, `publish-finalize`, and `history`; write/upload actions are disabled unless `AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true` and an approved operator/admin or scoped service account is present. `publish-init` and `publish-finalize` accept only small manifest JSON, and image/artifact bytes must upload directly to storage using presigned URLs.
- The public read-only API route `/api/ai-grader/reports/[reportId]` is disabled unless `AI_GRADER_PUBLIC_REPORT_DB_ENABLED=true`; it reads a persisted published report bundle from storage and never exposes hardware controls.
- The station page can send sanitized publish metadata to `publish-init`, upload the canonical report package and evidence assets directly to storage, send the upload manifest to `publish-finalize`, and then show DB persistence, storage upload, publication, public URL, QR URL, label, card linkage, and comps readiness status.
- The report viewer first attempts the persisted public report endpoint for generated report IDs, then falls back to the local Dell bridge when present for local operator views. Generated production report IDs must not substitute fixture/sample data when neither persisted storage nor the local bridge can resolve the report.
- The label preview route `/ai-grader/labels/[reportId]` renders print-ready label preview data from the report bundle. It is not a printer integration and does not create a certified certificate.

Production release V0 is an AI-Grader final report workflow, but it is not a certified Ten Kings grading/certificate process. It must keep `certifiedClaim=false`, `certificateGenerated=false`, and `physicalLabelPrinted=false` until a later certification/ops process is approved. The generated label data is JSON/preview data only; it does not print a physical label or create a QR certificate.

The PR #47 production integration continuation adds the live operator-facing pieces behind explicit admin/env gates:

- The station page can search/select existing Ten Kings `CardAsset` or `Item` records through `/api/admin/ai-grader/production/card-search`, or mark the report as a manual draft identity when no record exists yet.
- The selected `cardAssetId` and/or `itemId` are carried into the report bundle card identity and persisted by the production publication service.
- The station page can upload slabbed front/back color photos through `/api/admin/ai-grader/production/upload-slab-photo`; those uploads use the existing storage helper path, persist as `AiGraderEvidenceAsset` rows with `artifactClass=slabbed_photo`, and remain distinct from Basler monochrome evidence.
- The station page can run operator-triggered eBay comps through `/api/admin/ai-grader/production/run-comps`; readiness requires a final grade and card identity. Live SerpAPI/eBay execution is disabled unless `AI_GRADER_EBAY_COMPS_ENABLED=true` and the normal SerpAPI environment is configured. Tests use mocked comps execution only.
- The public read-only report API merges persisted production-release, label, slabbed-photo, and valuation/comps data when `AI_GRADER_PUBLIC_REPORT_DB_ENABLED=true`; public bundles must not include Dell local file paths or local bridge tokens.
- The label preview route can read the persisted public report bundle and render label-ready data from the stored report.

Production rollout remains gated. The review migration is `20260702120000_ai_grader_production_release_v0` and adds `AiGraderSession`, `AiGraderReport`, `AiGraderEvidenceAsset`, `AiGraderGrade`, `AiGraderLabel`, `AiGraderPublication`, and `AiGraderValuation`. Codex must not run the production migration or set `RUN_DB_MIGRATIONS=true`. A human migration rollout should review the migration, set an approved production `DATABASE_URL`, run the repo migration deploy command from the database package, regenerate Prisma clients as required by the runbook, and verify the new admin/public AI Grader endpoints with publish env gates still off before enabling writes.

Required production environment/configuration:

- Database: approved `DATABASE_URL`, existing admin auth/session config, and `AI_GRADER_PRODUCTION_TENANT_ID`.
- Publication gates: `AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true` only after migration/storage review, and `AI_GRADER_PUBLIC_REPORT_DB_ENABLED=true` only when published report reads are ready.
- Storage: existing storage mode/bucket/region/public-base-url/access-key configuration used by the Ten Kings storage helper.
- Local station: Dell bridge URL/token/origin config remains local and token-gated; hardware control stays in the loopback bridge, never in public report routes.
- Public reports: `AI_GRADER_PUBLIC_REPORT_BASE_URL` or equivalent deploy base URL for QR/public report URL generation.
- eBay comps: `AI_GRADER_EBAY_COMPS_ENABLED=true` plus SerpAPI/eBay env only when an operator intentionally runs comps for a finalized, identified card.

Credential exposure checkpoint: if the production `DATABASE_URL` is exposed in terminal output, logs, chat, screenshots, or other transcripts, stop the rollout before enabling publish/read gates or running storage/report smokes. Rotate the affected DigitalOcean managed PostgreSQL user password through the approved DigitalOcean cluster `Users & Databases` reset flow or an approved authenticated DigitalOcean database-user API path, then update every approved runtime env that carries `DATABASE_URL`. Verification must use redacted checks only, such as connection success, migration status, host/database match, length, or a non-secret fingerprint.

2026-07-03 production rollout exception: Mark explicitly accepted the temporary risk of continuing with the currently exposed production Postgres credential and deferred DigitalOcean credential rotation until after the AI Grader rollout. That exception allowed redacted DB/migration/table checks, droplet env-file gate edits, direct DB smoke publication, and one controlled SerpAPI/eBay smoke without printing secrets. It did not complete credential rotation. After the rollout, rotate the exposed DigitalOcean managed Postgres credential and update every approved runtime `DATABASE_URL` without logging or printing the value.

2026-07-03 Vercel env verification: the hosted production status endpoint confirmed the AI Grader publish, public read, and comps gates were active after Mark added Vercel Production env vars. The earlier direct-DB smoke report is not a valid hosted storage-backed proof because it was not published through the storage-upload API path. Public report rollout verification must use a fresh authenticated publish that calls `publish-init`, uploads `report-bundle.json`, `production-release.json`, `label-data.json`, `publication-manifest.json`, `integration-contract.json`, `asset-manifest.json`, `checksums.json`, and report evidence assets directly to production storage using presigned URLs, then calls `publish-finalize` to persist DB rows. Generated report URLs must not substitute sample/fixture data when persisted storage or the local bridge cannot resolve the report.

2026-07-03 permanent auth follow-up: PR #48 (`fix/ai-grader-public-report-missing-data`) was merged and deployed before the permanent-auth branch. AI Grader production endpoints now use permanent scoped auth instead of the compromised operator/API key path. Human production actions use existing bearer/session auth through `requireUserSession`, then require `AI_GRADER_OPERATOR_USER_IDS` / `AI_GRADER_OPERATOR_PHONES` or `AI_GRADER_ADMIN_USER_IDS` / `AI_GRADER_ADMIN_PHONES`; existing global admin allowlists remain an `ai_grader_admin` fallback. Service automation is scoped only to `publish`, `history`, `card-search`, `upload-slab-photo`, and `run-comps` through `x-ai-grader-service-token`, where Vercel stores `AI_GRADER_SERVICE_ACCOUNT_ID`, `AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256`, and `AI_GRADER_SERVICE_ACCOUNT_SCOPES=publish,history,card-search,upload-slab-photo,run-comps`. Mark must generate the plaintext service token locally and set only its SHA-256 hash; Codex must not print or log the token. The old operator/API key remains compromised and must not be reused. Public report routes stay unauthenticated, read-only, GET-only, and hardware-control-free. DigitalOcean Postgres credential rotation remains deferred by Mark until after rollout, and the fresh storage-backed hosted publish smoke remains pending until the permanent-auth PR is merged/deployed and the new Vercel auth env behavior is verified.

2026-07-03 production-live result: PR #49 permanent auth and PR #50 public-output security fix were merged and deployed to Vercel Production. A fresh hosted publish through the permanent service-account path succeeded for `reportId=ai-grader-prod-smoke-20260703T212555`, `certId=TK-AIG-6C033F43`, with public report URL `https://collect.tenkings.co/ai-grader/reports/ai-grader-prod-smoke-20260703T212555` and label preview URL `https://collect.tenkings.co/ai-grader/labels/ai-grader-prod-smoke-20260703T212555`. The publish uploaded and public-read verified `report-bundle.json`, `production-release.json`, `label-data.json`, `publication-manifest.json`, `integration-contract.json`, `asset-manifest.json`, and `label-preview.html`; persisted report/history/slab/comps data was verified through hosted API readback. Slabbed front/back fixture uploads persisted as `slabbed_photo` evidence, manual draft identity was used without modifying `CardAsset` or `Item`, one controlled live comps request completed and persisted with zero comp refs, and public output security scans found no secret markers, Dell local paths, bridge URLs/tokens, or hardware controls. AI Grader is production-live under the permanent auth model; DigitalOcean Postgres credential rotation remains the main deferred follow-up.

#### Two-Person Throughput Workflow

The July 2026 throughput workflow separates Dell capture from downstream finishing:

- Person 1 uses `/ai-grader/station` on the Dell for capture, grade review, Confirm Card, publication, and immediately starting the next grade. Confirm Card atomically links or creates the card/item, assigns the next label sheet slot, and queues the existing KingsReview/SerpAPI eBay sold-comps lookup. The station shows only the assigned sheet/slot and comps lifecycle status; downstream review controls live elsewhere.
- Person 2 uses `/ai-grader/finish` from a normal computer. This page uses normal Ten Kings SMS/operator/admin auth and has no bridge, pairing, station token, Basler, lighting, or local hardware dependency. Its chronological queue stages are Needs Comps Review, Needs Slab Photos, Ready for Inventory, and Complete.
- Person 2 or Mark uses `/ai-grader/labels/sheets` for the physical label queue. Sheets are 8.5in x 12in portrait with 16 slots in a 2-column by 8-row grid; each label is 2.73in x 0.83in. A partial sheet can be sealed and printed at any time. Mark Sheet Printed updates every label on that sheet atomically. The legacy per-label print-state mutation is retired; inventory readiness cannot bypass the sheet-level print transition.

Label sheet assignment, seal, slot, print audit, and confirmed card identity are stored in the existing `AiGraderLabel.payload` JSON. No schema change or migration is required. Tenant and report advisory locks serialize Confirm, publish, sheet printing, comp lifecycle, comp selection, and inventory transitions. Printable-content revisions cover grade, cert, QR/report URLs, and confirmed identity; changing printed content invalidates its printed status and requires a sheet reprint.

Background comps reuse `fetchKingsreviewEbaySoldCompPage` from the existing KingsReview pipeline. Provider URLs are sanitized before persistence and response. A human operator can select only candidates persisted for that report; the server uses the persisted prices and writes their rounded average to `AiGraderValuation`, `CardAsset`, and `Item`, with selected listings stored as `CardEvidenceItem` sold-comp evidence. Completed reviews cannot be reopened by Confirm retries or overlapping comp attempts. A stale running attempt becomes retryable after five minutes.

Slab front/back photos continue to use authenticated upload initialization followed by direct browser-to-storage `PUT` and a small finalize manifest. Vercel never receives image bodies. Add To Inventory runs in one transaction and requires a published report, sheet-printed label status, persisted front and back slab photos, and a positive completed selected-comp valuation.

Downstream API output is tenant-scoped and rejects local/private/link-local hosts, presigned or credential-bearing URLs, embedded image data, local paths, and local hardware/token fields. Comp failures preserve a useful retryable message while redacting secrets, local endpoints, and Windows or Unix runtime paths.

#### Capture-Speed, Geometry, Rapid Capture, and OCR Prefill

The post-PR #79 speed work preserves the two-person production architecture and adds an optional faster capture path inside `/ai-grader/station`. It does not move hardware control out of the Dell loopback bridge, weaken auth, change `/ai-grader/finish` or `/ai-grader/labels/sheets`, or send image bodies through Vercel.

Live front/back preview carries path-free card geometry alongside the token-gated MJPEG stream. The solid-plate V2 detector models the border background in color, closes small mask gaps, fills enclosed artwork holes, scores plausible components by card shape/coverage/contrast, and reports four ordered corners from an oriented outer-card rectangle plus `not_detected`, `adjust_card`, or `ready`. `ready` means the fresh, confident region is fully visible, occupies the fixed rig's expected `30%-85%` frame envelope (including the current 97%-height production guide), and can be normalized. Camera-frame center offset does not directly block capture. The `10°` skew value remains a preferred placement guide, while automatic capture remains available through a broader `35°` in-plane normalization envelope when the card still has safe edge clearance. `adjust_card` carries a path-free reason so the station can ask the operator to move fully inside frame, use the fixed plate scale, rotate printed top upward, expose the physical outer border, or improve border/plate contrast. The bridge analyzes only the newest frame at a 125 ms cadence, uses the MJPEG camera-capture timestamp rather than detector start time, rejects stale Ready geometry, and clears a prior Ready result after detector failure; the browser polls at 200 ms without overlapping requests and independently disables stale geometry.

The detected outer-card outline is the primary live guide, with geometry-aligned corner brackets, edge midpoints, and a center cue. The old fixed template fades while automatic detection is active and remains available for an explicit manual action. If automatic detection is not Ready, an operator may deliberately choose Manual Capture and confirm the displayed rectangle; auto capture cannot take this path. Geometry alone cannot distinguish printed top from bottom, so the operator must keep the printed top generally toward the top of the preview. Preview geometry contains only image-pixel coordinates, confidence, side, safe frame ID, and timestamp.

Each captured side keeps every original raw forensic frame and writes a canonical `1200x1680` portrait PNG when valid full-resolution geometry exists. The grading-resolution gate requires a source crop of at least `1000x1400` pixels and no more than `1.2x` upscaling; a small but card-shaped region therefore cannot become a successful grade input. PNG encoding is lossless, while metadata separately and honestly records geometric resampling, source crop size, scale, and whether pixels were upscaled. The all-on frame supplies the authoritative side transform; the same transform is applied to accepted-profile and channels `1-8`, and grading ROIs/diagnostics run in `normalized_card_portrait_pixels`. Dell raw landscape normalization chooses the semantic rotation branch that matches the operator preview's clockwise `90°` display, with asymmetric synthetic checks at `0°` and `±12°`. This corrects translation and in-plane rotation for the fixed overhead rig; it does not claim lens calibration, machine-verified 0°/180° content orientation, or a perspective homography. Raw camera-frame placement remains available only as acquisition diagnostics and is excluded from grade inputs. All 11 raw role files are re-hashed after processing.

Directional-light metadata follows the same authoritative side transform. Approximate Leimac vectors are rotated from `basler_sensor_pixels` into `normalized_card_portrait_pixels` by the recorded deskew angle before preliminary normal/relief calculations. Missing or mixed transform provenance fails closed by suppressing directional output, and an unregistered raw dark frame is not subtracted from normalized pixels. The current V0 path records intensity balancing and flat-field readiness but does not claim pixelwise flat-field correction.

Printed-design centering remains `not_computed`; camera placement is never substituted. Grade Story Engine/rules V0.2 evaluates both sides' normalized geometry provenance and keeps the existing pipeline usable by redistributing the missing centering weight only across computed corner, edge, and surface diagnostics, reducing confidence by `0.18`, and capping the provisional overall result at `9.0`. Explicit manual geometry on either side remains an accepted warning with its own confidence penalty; contradictory side provenance fails closed. This policy and its applied weights are persisted in the unified report.

Detection failure does not silently use a configured fixture boundary and does not generate a normalized geometry artifact. An explicit, operator-confirmed manual rectangle is recorded as `manual_capture` / `manual_override`, with `detectionUsed=false`, `confidence=0`, and a non-Ready placement state. The side manifest and analysis record front/back corners, bounding box, rotation/skew, confidence, source frame/image ID, timestamp, geometry source, normalized artifact hash/dimensions/resampling, coordinate-frame registration, and raw-source preservation evidence. The unified local report and report bundle include normalized artifact references while retaining all original evidence.

Bridge protocol `ai-grader-local-station-bridge-v0.5` makes this contract explicit. The production page rejects an older in-memory helper with an actionable update/restart message instead of sending an unknown action. Normal bridge startup rebuilds the checked-out capture helper unless the developer explicitly selects `-SkipBuild`, and a failed build stops startup rather than running stale compiled code.

Two station capture profiles are available:

- `full_forensic` is the previous stable and current default selection. It keeps the established lossless PNG raw evidence path and is never entered automatically after another profile fails.
- `production_fast` is an explicit opt-in station selection. It keeps the same 11 required raw roles per side (`dark_control`, `all_on`, `accepted_profile`, and channels `1-8`) but writes lossless TIFF raw frames to avoid expensive PNG encoding. It does not count as a five-second success until a supervised Dell comparison proves the target without evidence or grading-quality loss.

The warm runner is the production capture execution path. If it fails, capture stops, hardware is safe-offed, camera/lighting ownership and locks are released, the exact failure is persisted/displayed, and operator retry is required. There is no automatic warm-to-cold path switch. The cold command implementation can run only when an explicit developer/debug configuration disables the warm runner before the session; that mode rejects `production_fast` and can never contribute to production timing acceptance or five-seconds-per-side proof.

Timing is recorded as wall-clock workflow events and nested machine phases. The station/session package and report bundle preserve preview-ready, first edge-ready, operator/auto trigger, lighting/profile work, frame grab, file write, hash, crop/deskew, ROI/display generation, side processing, unified report generation, front-processing overlap with the flip/back-positioning window, front/back totals, and total-card timing. The station debug summary exposes the useful totals and target result without publishing local paths or hardware controls.

Front raw capture is committed before its artifact-processing promise begins. The preview hold is then released so the operator can flip and position the back while front crop/deskew, ROI/display, and analysis work continues. Jobs are keyed by immutable station session IDs; a global capture lock protects Basler/Leimac ownership, local JSON writes are atomic, and unified report workers are serialized so a later card cannot mutate an earlier report.

Rapid capture is optional and does not replace single-card mode. When enabled, a completed front/back pair can be placed in a persisted local queue as soon as both raw packages are safe and lighting/camera ownership is released. Report finalization continues on the captured session snapshot while the station creates a clean next-card session. Queue states are `front_captured`, `front_processing`, `back_positioning`, `back_captured`, `finalizing`, `report_ready_needs_confirm`, `confirmed_needs_publish`, `published`, and `failed`. Activating a ready queue item feeds it back into the existing Confirm Card and Publish flow; rapid mode never auto-confirms, auto-publishes, creates inventory, bypasses label sheets, or skips comps/slab/inventory finishing.

Confirm Card OCR prefill reuses the existing Ten Kings Google Vision document OCR, shared `extractCardAttributes`, set identification, and set/variant lookup helpers. The browser uploads only the normalized front/back artifacts directly to storage with presigned PUTs, then submits a small verified finalize manifest. Vercel does not receive image bodies or caller-provided image URLs. Results contain values, confidences, provenance, and per-field review flags for category, player/card name, year, manufacturer, product set, card number, parallel/insert/numbered, auto, and memorabilia. All results require human confirmation; low-confidence or missing values stay marked for review and no OCR guess can publish or create inventory.

The latest supervised Dell evidence remains the PR #58 control run: front capture `9442 ms`, back capture `9243 ms`, front processing `4229 ms` overlapped with the flip, back processing `3611 ms`, and unified report generation `14867 ms`. Across both sides, image writes consumed `11517.3 ms`, compared with `3156.2 ms` of frame grabs and about `454 ms` of Basler open/configure per side. Therefore five seconds per side is not yet proven. The next required action is a Mark-approved, supervised, same-card paired Dell run of `full_forensic` and `production_fast`, verifying all 11 raw roles and normalized outputs while comparing per-side timing and grading artifacts. No hardware run should be started merely to validate this software change.

Direct PUT plans bind the actual object bytes with the storage provider's SHA-256 checksum header, and finalize requires the storage-returned checksum plus exact byte size; caller-controlled object metadata is not an integrity proof. Production publication also treats browser timing as diagnostic rather than a hardware attestation: public/persisted output cannot claim five seconds per side, auto-confirmed OCR, inventory mutation, or OCR-triggered publication from caller-supplied flags. Embedded local/private endpoints, signed URLs, runtime paths, tokens, and hardware controls are rejected or removed even when they appear inside a longer warning string.

Exact supervised Dell proof procedure after Mark explicitly approves hardware:

1. Install the reviewed PR build through the normal Dell local-bridge update process, pair the production station browser, and confirm the accepted fixture, rulers, camera focus, lighting profile, exposure, gain, and physical light-idle/off state. Do not alter env vars or persistent Basler/Leimac settings for the comparison.
2. Use one known card and the same fixture seat for an A/B pair. In Station Settings select Single Card, Auto Capture off, and Full Forensic. Start New Card, wait for the front `Ready` state, manually capture front, flip/re-seat, wait for back `Ready`, and manually capture back. Complete the local report and record the report/session IDs.
3. Repeat immediately with the same card, orientation, lighting/exposure/gain, and operator actions, changing only Station Settings to Production Fast before Start New Card. Complete the local report and record the IDs. Confirm the physical Leimac light is off after each controlled pair.
4. For every side in both reports, verify raw roles are exactly dark control, all-on, accepted profile, and channels `1-8`; all 8 channel displays and expected ROI crops exist; raw evidence hashes/byte sizes are recorded; the raw format is PNG for the control and TIFF for the fast run; a lossless normalized PNG exists when automatic geometry was Ready or an explicit manual rectangle was confirmed; geometry identifies front/back plus `detected` or `manual_override`; and neither report claims certified/final evidence beyond the existing V0 rules.
5. Compare `captureTiming` rather than chat wall time: preview/edge-ready latency, trigger-to-raw-complete front/back totals, Basler open/configure, lighting write/ack, frame grab, file writes, hashes, crop/deskew, side processing, flip overlap, report generation, safe-queue/operator-cycle time, and report-ready total. If a side exceeds five seconds, name the largest measured phase; do not average it away or mark the target proven.
6. Inspect the PNG/TIFF-derived quality metrics, normalized dimensions, overlays, ROI crops, Surface Intelligence inputs, Vision Lab inputs, and provisional grade outputs for material differences. Any missing role, unreadable artifact, geometry regression, or grading-quality regression rejects `production_fast`; the operator must explicitly select Full Forensic for a later retry.
7. After the first safe A/B pair, repeat at least 10 paired cards spanning glossy, dark-border, light-border, and rotated/off-center placements. Keep per-card target flags, and report median and p95 front/back times. Operational acceptance should require complete evidence with no quality regression and p95 at or below five seconds per side; a mock/software run never satisfies this gate.
