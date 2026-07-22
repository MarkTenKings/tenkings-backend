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

## One-Time Stale Invalid Rapid-Review Archive Gate

The incident-bound command `tk-ai-grader-archive-stale-invalid-reviews` may remove only these two unpublished legacy test entries from the active local Rapid queue:

- `ai-grader-browser-station-session-2026-07-21T042424764Z-session-rapid-card` / session `ai-grader-browser-station-session-2026-07-21T042424764Z-session` / report `ai-grader-browser-station-session-2026-07-21T042424764Z-report`;
- `ai-grader-browser-station-session-2026-07-21T035440224Z-session-rapid-card` / session `ai-grader-browser-station-session-2026-07-21T035440224Z-session` / report `ai-grader-browser-station-session-2026-07-21T035440224Z-report`.

This is not a general queue/FSM action. It is hard-bound to queue SHA-256 `3bdb4118245ee92406280f74bb45ed43c56e279f5d2cad37c2c6b444d256e05f`, exactly five entries, exactly those two unfinished items, and exactly three retained terminal failed items. It refuses unless each target still has succeeded OCR, `findingValidation=invalid`, `16` source candidates, `0` published findings, `32` issues, local upload not performed, no production DB write, and no CardAsset/Item linkage. It hashes every referenced local report/manifest/artifact, preserves those files in place, writes exact before/after queue bytes plus both complete removed entries into a content-addressed archive, and records reason `owner_removed_stale_invalid_finding_review_v1` with owner `Mark / Ten Kings`. It atomically replaces only `rapid-capture-queue.json` and installs a canonical non-active archive pointer that lets the orphan-manifest startup guard verify those two unchanged session manifests against the complete archive; the three retained terminal entries must reproduce unchanged. A canonical journal/backup provides bounded restore or idempotent completion after interruption.

Execution remains separately authorized. Capture a fresh token-gated helper status response outside the station output root and hash it. It must prove `start_new_card`, no active session, preview stopped/not-started, camera idle/released, no transition or capture lock, and all worker queues empty. The normal path also requires a no-more-than-five-minute-old bridge-native `safe_off_verified` physical lighting state.

Only for this fixed 2026-07-22 incident, bridge `physicalState=unverified` may instead be composed with one separately authorized, out-of-process `leimac-idmu-safe-off` receipt. Both optional receipt arguments are required together. The receipt must be exact canonical JSON with its caller-supplied SHA-256; bind this incident and owner authorization; reproduce the exact configured `169.254.191.156:1000` controller, unit-one `W86`/`W85`/`W11` zero frames, successful `W86ACK0`/`W85ACK0`/`W11ACK0` responses, all eight output/asynchronous-output/PWM channels at zero, `lightsCommanded=false`, and `persistentSaved=false`; and precede the fresh status capture and transaction by no more than five minutes. The authenticated status must remain otherwise idle and must contain no post-command lighting apply, safety event, persistent controller session, or conflicting state. A native `safe_off_verified` status never accepts the exception receipt. The verified receipt bytes, identity, timing, controller, ACKs, zero-channel summary, and safety result become immutable archive-ledger and transaction-receipt members.

Then stop only the old capture helper through the approved maintenance lifecycle and prove `127.0.0.1:47652` is released before running the command; do not stop NFC. Use one new archive root outside the station output directory. The following is the exact exceptional one-time sequence after the hotfix is independently reviewed, merged, installed, and a new exact hardware authorization is obtained. It issues exactly one hardware command: the guarded `leimac-idmu-safe-off` invocation.

```powershell
$queueOutput = 'C:\TenKings\capture-data\ai-grader-station'
$archiveRoot = 'C:\TenKings\capture-data\ai-grader-queue-quarantine\owner-removed-stale-invalid-review-20260722-v1'
$idleStatus = 'C:\TenKings\acceptance-evidence\ai-grader-queue-maintenance\idle-status.json'
$externalSafeOffReceipt = 'C:\TenKings\acceptance-evidence\ai-grader-queue-maintenance\external-safe-off-receipt.json'
$installedRepo = 'C:\TenKings\repos\tenkings-rip-it-live'
$config = Get-Content -LiteralPath 'C:\TenKings\config\ai-grader-local-bridge.json' -Raw | ConvertFrom-Json
$configuredLeimacHost = [string]$config.leimacHost
$configuredLeimacPort = [int]$config.leimacPort
if ($configuredLeimacHost -ne '169.254.191.156' -or $configuredLeimacPort -ne 1000) {
  throw 'Configured Leimac controller does not match the fixed incident endpoint; do not issue a hardware command.'
}
if (Test-Path -LiteralPath $externalSafeOffReceipt) {
  throw 'External safe-off receipt path already exists; preserve it and stop rather than replacing evidence.'
}
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $externalSafeOffReceipt)) | Out-Null

# Exactly one bounded hardware command. A fresh explicit Mark authorization is required before this invocation.
Push-Location $installedRepo
try {
  $safeOffOutput = & node packages\ai-grader-capture-helper\dist\cli.js leimac-idmu-safe-off `
    --host $configuredLeimacHost --port $configuredLeimacPort --timeout-ms 1500 --unit 1 `
    --apply --confirm 'APPLY LEIMAC SAFE OFF'
  if ($LASTEXITCODE -ne 0) { throw 'Guarded Leimac safe-off command failed; preserve output and stop.' }
} finally {
  Pop-Location
}
$safeOffOperation = ($safeOffOutput -join [Environment]::NewLine) | ConvertFrom-Json
$safeOffEnvelope = [ordered]@{
  schemaVersion = 'ten-kings-ai-grader-stale-invalid-review-external-safe-off-receipt-v1'
  incidentId = 'ten-kings-stale-invalid-review-removal-20260722-v1'
  purpose = 'stale_invalid_review_archive_preflight'
  authorization = [ordered]@{
    owner = 'Mark / Ten Kings'
    source = 'explicit_product_owner_instruction_2026-07-22'
  }
  operation = $safeOffOperation
}
$canonicalizer = 'const fs=require("fs");let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const k=v=>Array.isArray(v)?v.map(k):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(x=>[x,k(v[x])])):v;fs.writeFileSync(process.argv[1],JSON.stringify(k(JSON.parse(s)))+"\n",{encoding:"utf8",flag:"wx"});});'
$safeOffEnvelope | ConvertTo-Json -Depth 100 -Compress | & node -e $canonicalizer $externalSafeOffReceipt
if ($LASTEXITCODE -ne 0) { throw 'Canonical safe-off receipt creation failed; preserve command output and stop.' }
$externalSafeOffReceiptSha = (Get-FileHash -LiteralPath $externalSafeOffReceipt -Algorithm SHA256).Hash.ToLowerInvariant()

# Capture authenticated idle status after the acknowledged command; its file identity/time binds command ordering.
$headers = @{ 'x-ai-grader-station-token' = [string]$config.stationToken }
$status = (Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:47652/status' -Headers $headers).result
$statusJson = ($status | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $idleStatus)) | Out-Null
[System.IO.File]::WriteAllText($idleStatus, $statusJson, $utf8NoBom)
Remove-Variable headers, config, status, statusJson, safeOffOperation, safeOffEnvelope, safeOffOutput
$idleStatusSha = (Get-FileHash -LiteralPath $idleStatus -Algorithm SHA256).Hash.ToLowerInvariant()

# Run from the installed/current checkout so the approved stop script targets the installed helper.
& 'C:\TenKings\repos\tenkings-rip-it-live\scripts\ai-grader\stop-local-station-bridge.ps1' -KillProcess
if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 47652 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Production helper port 47652 is still listening; do not run the archive transaction.'
}

node "$installedRepo\packages\ai-grader-capture-helper\dist\staleInvalidRapidCaptureQueueArchivalCli.js" `
  --output-dir $queueOutput `
  --archive-root $archiveRoot `
  --idle-status-path $idleStatus `
  --idle-status-sha256 $idleStatusSha `
  --external-safe-off-receipt-path $externalSafeOffReceipt `
  --external-safe-off-receipt-sha256 $externalSafeOffReceiptSha
```

If the fresh status already proves native `safe_off_verified`, omit both external-receipt arguments and do not issue another safe-off command. Never reuse an earlier receipt, replace an existing receipt path, or run the exceptional command for a different queue, incident, controller, or archive.

After success, hash and parse the active queue again. It must contain exactly the original three terminal failed items, zero unfinished items, and the command-reported after SHA/counts. Verify the archive pointer, archive ledger, exact before queue hash/bytes, receipt, removed-entry identities, and every referenced file hash before any helper restart. The pointer continues to authenticate those immutable incident records and rejects either removed target ID or exact session/report triple if it is ever reintroduced, while the ordinary Rapid queue schema/integrity guards remain authoritative for legitimate later queue updates and new cards. The archived entries remain visible through the pointer/archive/receipt but no longer block maintenance; any genuinely unfinished future active queue item still blocks. Never raw-edit the queue, delete report/session/evidence files, publish or link either report, invent findings, change OCR/grades, or reuse this command for another queue/hash/item.
