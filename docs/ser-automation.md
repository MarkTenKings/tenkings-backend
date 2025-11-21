# SER Automation Playbook

This guide turns any SER mini PC into a production-ready kiosk node that follows the Live Rip
Automation Master Plan. Every SER ends up identical: it boots, launches the kiosk display,
connects to OBS locally, keeps sessions synced through the kiosk agent, and reports issues via
observable logs.

## 1. Prerequisites

- Windows 10/11 on the SER (administrator rights for Task Scheduler + PowerShell execution).
- OBS Studio installed with the Ten Kings scene collection and obs-websocket enabled (port 4455 by
  default).
- Git + pnpm installed.
- Location metadata: `locationSlug` (and optional `locationId`), `NEXT_PUBLIC_KIOSK_API_SECRET`,
  OBS IP/port/password, and the per-location Mux stream already stored in the backend.
- Production database URL (SER kiosk display talks to prod APIs/DB).

## 2. Folder Layout

Clone the repo to `C:\Users\Mark Thomas\tenkings-backend` on every SER:

```powershell
cd $env:USERPROFILE
git clone https://github.com/tenkings/ten-kings-mystery-packs.git tenkings-backend
cd tenkings-backend
pnpm install
```

All scripts/docs below assume this path. Adjust `-RepoPath` arguments if you choose a custom
location.

## 3. Environment Files

Each SER needs two `.env.local` files:

1. `frontend/nextjs-app/.env.local` – powers the kiosk display + helper overlay.
2. `packages/kiosk-agent/.env.local` – configures the kiosk-agent watchdog that drives OBS scenes
   and (optionally) the USB scanner automation.

To make provisioning consistent, use `scripts/ser/setup-ser.ps1`. Example:

```powershell
cd C:\Users\Mark Thomas\tenkings-backend
powershell -ExecutionPolicy Bypass -File scripts\ser\setup-ser.ps1 \
  -LocationSlug "north-premium-outlet-mall" \
  -KioskSecret "<NEXT_PUBLIC_KIOSK_API_SECRET>" \
  -DatabaseUrl "postgresql://...defaultdb?sslmode=require" \
  -ObsAddress "ws://192.168.1.31:4455" \
  -ObsPassword "changeme" \
  -DisplaySlug "north-premium-outlet-mall"
```

Options:

- `-LocationId <uuid>` – stored in kiosk-agent env if you prefer IDs over slugs.
- `-BaseUrl <https://collect.tenkings.co>` – override kiosk-agent polling target for staging.
- `-CountdownSeconds` / `-LiveSeconds` – per-location overrides for future tuning.
- `-SkipKioskDisplayEnv` / `-SkipKioskAgentEnv` flags if you only want to regenerate one file.

The script overwrites existing files after backing them up to `*.bak` once so you can diff changes.

## 4. Auto-Start Services

Use `scripts/ser/start-services.ps1` as the canonical launcher. It:

- (Optionally) launches OBS (`-LaunchObs`).
- Starts `pnpm --filter @tenkings/nextjs-app dev` (unless `-SkipNext`).
- Starts `pnpm --filter @tenkings/kiosk-agent start` (unless `-SkipAgent`).
- Opens Chrome fullscreen on `/kiosk` and `/kiosk/display?slug=...` (unless `-SkipChrome`).

Recommended Task Scheduler entry (run with highest privileges):

1. Trigger: `At log on` of the kiosk operator account.
2. Action: `Program/script`: `powershell.exe`.
   - Arguments:
     ```
     -ExecutionPolicy Bypass -File "C:\Users\Mark Thomas\tenkings-backend\scripts\ser\start-services.ps1" `
       -RepoPath "C:\Users\Mark Thomas\tenkings-backend" `
       -DisplaySlug "north-premium-outlet-mall" `
       -LaunchObs
     ```
3. Conditions: disable “Start the task only if the computer is on AC power” if needed.
4. Settings: enable “Restart if the task fails” and set retry interval (e.g., 1 minute, 3 attempts).

## 5. OBS Watchdog + Kiosk Agent

`packages/kiosk-agent` already polls `/api/kiosk/display` and mirrors stage transitions to OBS.
Ensure:

- OBS is running before the agent starts (Task Scheduler can launch OBS or add a PowerShell pre-step
  in `start-services.ps1`).
- `OBS_AUTO_START_STREAM=true` if you want the agent to call `StartStream` whenever COUNTDOWN kicks
  in.
- `KIOSK_AGENT_SCANNER_ENABLED=true` only when the USB scanner is attached to that SER.

Future enhancements (Phase 1+):

- Extend the agent with a heartbeat endpoint so the backend can track `lastScene`, `lastScan`, and
  `obsConnected` per location.
- Add a lightweight OBS watchdog PowerShell script that ensures OBS.exe is running and restarts it if
  the process dies.

## 6. Verification Checklist

1. Run `pnpm --filter @tenkings/nextjs-app dev` – confirm it boots with production env values.
2. Load `http://localhost:3000/kiosk/display?slug=<location>` and watch for helper banner messages:
   - “Connecting to OBS…” followed by “Connected to OBS.”
   - Countdown/live/reveal timers matching `.env.local` values.
3. In OBS, confirm `Tools → WebSocket Server Settings` shows connections when the page loads.
4. Start `pnpm --filter @tenkings/kiosk-agent dev` and verify console logs for stage transitions and
   scene switches.
5. Scan a pack + card: confirm `/api/kiosk/start` and `/reveal` succeed and the Insta360 source shows
   on Live/Reveal scenes.
6. Reboot the SER and ensure Task Scheduler relaunches everything automatically.

## 7. Rolling Out New SERs

- Run Windows Update + driver updates, especially for Insta360 and GPU drivers.
- Clone repo, run `pnpm install`, execute `setup-ser.ps1` with the location’s slug/secret, configure
  OBS scenes, and set the Task Scheduler entry.
- Optional: export/import the Task Scheduler XML once so new installs can load the same job with a
  single command.
- Keep the repo up to date via `git pull` during scheduled maintenance windows; the kiosk-agent and
  Next.js dev server will pick up the latest production behaviour automatically.

With this process, every location shares the same automation baseline while letting you grow into the
remaining Master Plan phases (Mux archival, overlays, metrics, partner portal) without re-imaging the
hardware.
