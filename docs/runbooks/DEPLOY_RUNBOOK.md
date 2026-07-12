# Deploy Runbook (Source of Truth for Commands)

last_verified_at: 2026-03-02
owner: Mark

## Rules
- Always print branch + HEAD before deploy
- Always confirm remote parity before restart/migrate
- Record every deploy/restart/migrate in `docs/handoffs/SESSION_LOG.md`

## Vercel Migration Gate
- Vercel production builds do not run Prisma migrations by default.
- `scripts/vercel-build.sh` runs `pnpm --filter @tenkings/database run migrate:deploy` only when `RUN_DB_MIGRATIONS=true`.
- If `VERCEL_ENV=production` and `RUN_DB_MIGRATIONS` is not `true`, the build logs that migrations are skipped and continues.
- To intentionally apply migrations through Vercel, set `RUN_DB_MIGRATIONS=true` for the approved deploy, verify migration readiness first, then remove or reset the flag after the deploy.

## Workstation Deploy Flow
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
git status -sb
git branch --show-current
git fetch --all --prune
git log --oneline -n 10
git push origin <branch>
```

## Droplet Sync Flow
```bash
ssh root@104.131.27.245
cd /root/tenkings-backend
git status -sb
git branch --show-current
git pull --ff-only
git log --oneline -n 10
```

## Droplet App Restart Flow
```bash
cd /root/tenkings-backend/infra
docker compose restart
docker compose ps
```

If rebuild/recreate is required:
```bash
cd /root/tenkings-backend/infra
docker compose up -d --build --force-recreate
docker compose ps
```

## DB Migration Flow (When Needed)
```bash
cd /root/tenkings-backend
export DATABASE_URL='<prod-db-url>'
pnpm --filter @tenkings/database migrate:deploy
pnpm --filter @tenkings/database generate
```

If DB URL is sourced from running service env:
```bash
cd /root/tenkings-backend
export DATABASE_URL="$(cd infra && docker compose exec -T bytebot-lite-service sh -lc 'echo -n "$DATABASE_URL"')"
echo "DATABASE_URL length: ${#DATABASE_URL}"
```

## Post-Deploy Checks
- Confirm expected commit hash in serving environment
- Hit target API endpoint and verify response shape
- Verify affected admin UI screen after hard refresh

## AI Grader Direct-Upload CORS Gate

Any AI Grader release that makes x-amz-checksum-sha256 a required signed browser PUT header must remain unmerged and undeployed until Mark separately approves the additive DigitalOcean Spaces CORS rule documented in docs/ai-grader-capture-helper.md. Preserve the existing CORS rules, verify production-origin PUT and HEAD preflights for Content-Type, x-amz-acl, and x-amz-checksum-sha256, and stop before merge if either verification fails. Preflight is necessary but not sufficient: before merge, require Mark's separate authorization for the documented production-origin canary or probe-only precursor and its temporary non-card object create/delete. Pin that runtime to the reviewed PR head, use the existing protected Vercel storage configuration without reading or copying it, originate the browser PUT from exactly `https://collect.tenkings.co`, then require `HeadObject` with `ChecksumMode=ENABLED` to return the exact native SHA-256, byte size, and content type. A Vercel preview, current-main adapter, server-only PUT, or Dell process with unverified storage credentials does not satisfy the gate. The repository currently has no safe one-shot probe surface, so this gate is not executable under ordinary preview access and must not be claimed as passed. Never accept ETag or mutable metadata, and never record the object key, signed URL, credentials, headers, or provider identifiers.
