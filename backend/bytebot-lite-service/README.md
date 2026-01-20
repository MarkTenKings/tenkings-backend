# Bytebot-Lite Service

Purpose-built worker that collects sold comps from eBay and market comps from TCGplayer.

## Required env

```
DATABASE_URL=postgresql://...

SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
SPACES_REGION=nyc3
SPACES_BUCKET=tenkings-evidence
SPACES_ACCESS_KEY_ID=...
SPACES_SECRET_ACCESS_KEY=...
SPACES_BASE_URL=https://tenkings-evidence.nyc3.digitaloceanspaces.com
SPACES_PREFIX=bytebot-lite
```

Optional:

```
BYTEBOT_LITE_CONCURRENCY=1
BYTEBOT_LITE_POLL_INTERVAL_MS=3000
BYTEBOT_LITE_HEADLESS=true
BYTEBOT_LITE_VIEWPORT_WIDTH=1280
BYTEBOT_LITE_VIEWPORT_HEIGHT=720
```

## Install browser deps

```
pnpm --filter @tenkings/bytebot-lite-service exec playwright install --with-deps chromium
```

## Enqueue a job

```
pnpm --filter @tenkings/bytebot-lite-service run enqueue -- \
  --query "2017 Panini Donruss Optic Patrick Mahomes #177" \
  --sources ebay_sold,tcgplayer
```

## Run the worker

```
pnpm --filter @tenkings/bytebot-lite-service run dev
```
