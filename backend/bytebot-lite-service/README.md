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

## Reference-processing containment

The reference loop is separate from sold-comps jobs and the Teach HTTP service.
Without a nonblank `VARIANT_EMBEDDING_URL`, it performs no database query, claim,
image download, provider call or crop upload. It logs the missing prerequisite
once and keeps polling. Configuring a provider is a separate operational decision.

With a provider configured, a pass attempts at most eight references. Trusted or
owned references keep their existing priority, then remaining slots take backlog
rows; each selection orders by oldest `updatedAt` then ID. Every pass sleeps at least 15 seconds; the optional
`BYTEBOT_REFERENCE_POLL_INTERVAL_MS` is clamped to 15–300 seconds. A conditional
`updatedAt` write claims a row and delays another attempt for five minutes, even
if the provider returns empty output, an operation fails, or the worker restarts.
New or edited references also wait five minutes. The final database write checks
the claim timestamp and original URL so an intervening reference edit is retained.
This deliberately uses existing columns and requires no schema migration.

The original image is downloaded at most once per attempt and shared by quality
scoring and local preview crops. An empty or malformed embedding response causes
no original download or crop upload. Saved usable embeddings and quality are
reused; completed references leave the queue. Null and empty-array embeddings
remain eligible after cooldown. Existing malformed nonempty JSON is not swept or
rewritten by this patch.

Requests have a 15-second deadline covering headers and streamed bodies. Originals
are capped at 8 MiB, embedding JSON at 1 MiB, and optional corner-normalization JSON
at 8 MiB. An attempt has a 90-second external-work cancellation signal, including
storage uploads; image operations limit inputs to 32 million pixels and each Sharp
pipeline to 10 seconds. Database requests are outside that cancellation boundary.
Embedding responses must contain 1–16 entries, each with a nonempty crop URL of
at most 4,096 characters and a nonzero finite numeric vector of 1–8,192 elements.
Provider compatibility with these bounds must be verified before enabling one.

This is bounded retry containment, not a replacement job platform: it does not
add persistent error reasons, exponential retry, an attempt ceiling, model-version
completion markers, or a storage transaction. Existing stable crop keys remain
unchanged; uploads completed before cancellation or a concurrent edit can remain
even when the final database write is rejected. Original references, historical
jobs, evidence and playbooks are retained. Nothing here retires the service or
changes SAM/Speedster learning.

## Local reference regression checks

With workspace dependencies installed and the Prisma client generated locally:

```
pnpm --filter @tenkings/bytebot-lite-service... run build
pnpm --filter @tenkings/bytebot-lite-service run test:reference
```

Run with a scrubbed environment. These tests use synthetic in-memory database and
provider/storage boundaries, real Sharp image processing, and loopback-only HTTP
servers that close after the tests. They do not start the worker entrypoint or
contact a real database, embedding service, bucket, Teach session or comps source.
Database concurrency behavior is modeled; this is not a live PostgreSQL lease or
provider acceptance test.
