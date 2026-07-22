# Deploy Runbook (Source of Truth for Commands)

last_verified_at: 2026-07-22
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

Any AI Grader release that makes `x-amz-checksum-sha256` a required signed browser PUT header must preserve the additive DigitalOcean Spaces CORS rule documented in `docs/ai-grader-capture-helper.md`. Verify production-origin PUT and HEAD preflights for `Content-Type`, `x-amz-acl`, and `x-amz-checksum-sha256`, and stop before rollout if either fails. Finalization must HEAD the exact planned object and require the exact expected byte size and compatible content type. It uses a valid provider-native SHA-256 when one is returned; when the provider returns no native checksum, it must stream that same exact object through the reviewed bounded server-side SHA-256 verifier, enforce the existing per-object upload limit and expected length, and compare the result to the browser-provided digest before OCR, publication, or slab-photo persistence. Oversized, truncated, mismatched, malformed, or failed reads stop finalization. Never accept ETag, mutable metadata, filename, or a caller URL as integrity evidence, and never write verification bytes to disk. A production-storage canary remains an exceptional separately authorized action: use only a uniquely named harmless non-card object, record normalized results only, delete it immediately, and verify deletion.

## Mathematical Calibration V1 Rollout Gate

Mathematical Calibration V1 must remain unavailable until all of these identities agree exactly:

- the reviewed source commit and centralized threshold-manifest SHA-256;
- one exact eligible calibration bundle and complete ledger: normally the physically and mathematically accepted 12-member finalized bundle, or only for session `math-cal-v1-20260722-4cfa410c-01` the exact 13-member owner-operational bundle with its unchanged rejected profile and owner authority;
- one current `TRUSTED` hosted `CalibrationSnapshot` for the same rig, profile, version, artifact, source-capture manifest, bundle manifest, member ledger, and threshold set;
- the strict V0.3 report and Mathematical V1 release envelope; and
- the exact Label V1 report/certificate/grade/link authority.

Never create or trust a snapshot merely to unlock measurements. Under the normal Mathematical V1 contract, a rejected or incomplete physical run may retain its evidence and acceptance record, but it must not produce or use a finalized/trusted bundle. The centralized thresholds and formulas remain authoritative, and ordinary accepted V1.2 calibration remains the exact 12-member `status=finalized` / `isCalibrated=true` path. Historical V0 reports remain readable; a V1 session with missing calibration/reference/review/evidence authority stops explicitly and never falls back automatically to V0 or a manual score. A source-bound, authenticated admin adjudication of a persisted failed report is a separate human-reviewed completion authority and must never be represented as a successful machine-V1 result.

The sole policy exception is the separately versioned product-owner operational acceptance for exact session `math-cal-v1-20260722-4cfa410c-01`. Its profile and mathematical acceptance remain `status=rejected` and `isCalibrated=false`, with the original measurements and all 36 rejection issues unchanged. Its transparent 13-member bundle may become operationally usable only when the exact owner authority, loader result, registry identity, bundle manifest, member ledger, runtime context, rig characterization, rig ID, and operating context all verify, followed by a fresh-human-admin ECDSA-signed `ACTIVE` activation that binds those exact identities. The content-addressed owner record is decision metadata; it is not independently authenticated and cannot replace the signed activation. Owner-accepted reports require that activation and must display the rejected status, owner/reason/timestamp, every exception, and signature/bundle provenance. A browser boolean, caller-authored hash, threshold-pass label, cross-session replay, fallback, newest/closest/LKG selection, or automatic rollback is prohibited. Revocation and supersession are explicit and append-only. This exception neither changes the normal 12-member V1.2 mathematical-acceptance gate nor authorizes another rejected calibration.

Before any protected rollout, require the complete disposable PostgreSQL migration chain plus second-deploy no-op, all normal GitHub/Docker/Vercel checks, and the separately required independent Mac architecture/calibration review. Apply the additive migration, import/trust a real bundle, install/update a Dell helper, deploy, or enable V1 only under a separately authorized rollout; none is an ordinary consequence of merging the implementation PR.
