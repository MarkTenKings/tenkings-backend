# Ten Kings Kiosk Agent

A lightweight Node service that runs on each SER mini PC to keep OBS in sync with the kiosk state.
It polls `/api/kiosk/display` for a specific location and automatically:

- switches OBS scenes when the kiosk enters COUNTDOWN / LIVE / REVEAL / standby
- starts the OBS stream (and optional recording) when a session begins
- returns to the attract loop scene and stops streaming when the session finishes or goes idle

## Setup

1. Install dependencies from the monorepo root:

```bash
pnpm install
```

2. Copy the sample env file and update it with your location + OBS details (run on the SER):

```powershell
cd C:\Users\Mark Thomas\tenkings-backend
copy packages\kiosk-agent\.env.example packages\kiosk-agent\.env.local
```

Edit `.env.local` and set at least `KIOSK_AGENT_LOCATION_SLUG`, `OBS_ADDRESS`, `OBS_PASSWORD`, and the correct scene names.

3. Build the agent (optional in dev, required for `pnpm start`):

```bash
pnpm --filter @tenkings/kiosk-agent build
```

4. Run the agent (during development you can use `dev` to auto-restart):

```bash
pnpm --filter @tenkings/kiosk-agent dev   # ts-node-dev with hot reload
# or
pnpm --filter @tenkings/kiosk-agent start # runs compiled JS from dist
```

## Suggested OBS Scene Layout

| Stage      | Scene name (default) |
|------------|----------------------|
| Standby    | `Attract Loop`       |
| Countdown  | `Countdown`          |
| Live       | `Live Rip`           |
| Reveal     | `Highlight`          |

You can rename scenes in OBS, just make sure the `.env.local` matches the actual scene names exactly.

## Windows Auto-Start

Once you verify the agent works, create a Scheduled Task on the SER that launches:

```powershell
pnpm --filter @tenkings/kiosk-agent start
```

with `Start in` set to `C:\Users\Mark Thomas\tenkings-backend`. Configure the task to run at logon and restart on failure so the agent stays alive after reboots.

