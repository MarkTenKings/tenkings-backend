# Ten Kings AI Grader Dino-Lite Bridge

Windows-only bridge process for the future Dino-Lite DNVideoX microscope adapter.

## Architecture

- Process boundary: stdio JSON Lines.
- Runtime target: .NET Framework 4.8.
- Platform target: x86.
- Threading: STA entry point.
- Default adapter: fake.
- Real adapter: DNVideoX manual enumeration only, no connect/preview/capture/control implementation.

DNVideoX is registered on the workstation as a 32-bit ActiveX/COM control at:

```text
C:\Windows\SysWOW64\DNVideoX.ocx
```

The bridge is intentionally out-of-process from Node.js so the TypeScript capture helper can remain architecture-neutral while the COM/ActiveX process runs as x86 STA.

## Protocol

Each request is one JSON object per line:

```json
{"id":"1","command":"health"}
```

Each response is one JSON object per line:

```json
{"id":"1","ok":true,"result":{"status":"OK"}}
```

Supported commands:

- `health`
- `sdkInfo`
- `listDevices`
- `capabilities`
- `dinolite.enumerateDevices`
- `exit`

## Fake Adapter

The fake adapter is the default and never uses COM. It returns deterministic AF7915MZTL-like device metadata and simulated support flags for still capture, AMR, FLC, EDR, and EDOF. It also supports `dinolite.enumerateDevices` with a deterministic fake enumeration payload.

## Real DNVideoX Manual Enumeration

The real adapter does not instantiate `DNVideoX.ocx` during tests, CI, default bridge startup, fake mode, readiness, or normal health/capability commands.

The only approved real DNVideoX operation in this slice is explicit manual enumeration:

```json
{"id":"manual-1","command":"dinolite.enumerateDevices"}
```

Run it only with both explicit opt-ins:

```powershell
TenKings.AiGrader.DinoLiteBridge.exe --adapter dnvideox --manual-enumerate
```

The implementation creates the registered 32-bit ActiveX control with ProgID `VIDEOCAPX.VideoCapXCtrl.1` inside a hidden offscreen WinForms `AxHost`, calls `GetVideoDeviceCount`, then calls `GetVideoDeviceName` for each detected index. `GetVideoDeviceDesc` and `GetDeviceID` are optional fields; failures are returned in `optionalErrors` without failing enumeration if device count succeeds.

The hidden host is required because the vendor C#, VB6, HTML, and C++ samples all instantiate DNVideoX as an ActiveX UI control with a control site/window. Plain COM activation can instantiate the OCX and read its version, but on this Dell capture node it did not initialize enumeration correctly.

This slice does not set `Connected=True`, does not set `Preview=True`, and does not call capture/control methods for LEDs, FLC, lens, focus, exposure, EDR, EDOF, DPQ, or image acquisition.

SDK binaries, OCX files, and DLL files must stay outside git. Do not copy SDK binaries into this package.

## Validation

```powershell
dotnet build packages\ai-grader-dinolite-bridge\DinoLiteBridge.sln -p:Platform=x86 -p:Configuration=Release
dotnet test packages\ai-grader-dinolite-bridge\DinoLiteBridge.sln -p:Platform=x86
```
