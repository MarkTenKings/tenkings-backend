# Ten Kings AI Grader Dino-Lite Bridge

Windows-only bridge process for the future Dino-Lite DNVideoX microscope adapter.

## Architecture

- Process boundary: stdio JSON Lines.
- Runtime target: .NET Framework 4.8.
- Platform target: x86.
- Threading: STA entry point.
- Default adapter: fake.
- Real adapter: DNVideoX skeleton only, manual-only, no capture/control implementation.

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
- `exit`

## Fake Adapter

The fake adapter is the default and never uses COM. It returns deterministic AF7915MZTL-like device metadata and simulated support flags for still capture, AMR, FLC, EDR, and EDOF.

## Real DNVideoX Skeleton

The real adapter class documents the COM plan but does not instantiate `DNVideoX.ocx` during tests, CI, default bridge startup, fake mode, or normal health/capability commands.

Future manual enumeration must be added as a separate approved hardware slice. This PR does not control microscope LEDs, FLC, lens, focus, EDR, EDOF, or image capture.

SDK binaries, OCX files, and DLL files must stay outside git. Do not copy SDK binaries into this package.

## Validation

```powershell
dotnet build packages\ai-grader-dinolite-bridge\DinoLiteBridge.sln -p:Platform=x86 -p:Configuration=Release
dotnet test packages\ai-grader-dinolite-bridge\DinoLiteBridge.sln -p:Platform=x86
```
