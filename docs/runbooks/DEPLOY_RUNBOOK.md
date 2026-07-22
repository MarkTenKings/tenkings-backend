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

This is not a general queue/FSM action. It is hard-bound to queue SHA-256 `3bdb4118245ee92406280f74bb45ed43c56e279f5d2cad37c2c6b444d256e05f`, exactly five entries, exactly those two unfinished items, and exactly three retained terminal failed items. It also pins, in target order, manifest/report-bundle/production-release SHA-256 triples `0fe9a33bb0057fa4b57aa184df099711609b504ad56ccc641ec4cb4ca7638979` / `2cc1ba76cb854c68359000ecf95f42718c90de2a4d4a5b8d8dce5f73c0eb331d` / `b124003d436b3a7e0e2b4963a7f00656f1c17ae31ed5ea96c2aafbffe611d3c5` and `5d5b21bf1b2d3d419114f5e9374d54b418828964d3af1344610061ec998a4003` / `8d6fefee97bc3ecd53be35f71555d1c940b22dd3fe3f04bfd1cb9dc248e0dc70` / `46016f6a4ed4f72e9869128fa31a051c0788358ae177f42c5e7b3ec9c512d70f`. Only those exact legacy bundles may represent zero materialized findings by omitting `visionLab.defectFindings`; the immutable ledger and receipt record `absent`. The ordinary explicit `[]` representation remains accepted when its incident authority and evidence hashes match. Null, object, nonempty, wrong-hash, or wrong-counter representations fail closed. Every other guard remains: succeeded OCR, `findingValidation=invalid`, `16` source candidates, `0` published findings, `32` issues, local upload not performed, no production DB write, and no CardAsset/Item linkage. The command hashes every referenced local report/manifest/artifact, preserves those files in place, writes exact before/after queue bytes plus both complete removed entries into a content-addressed archive, and records reason `owner_removed_stale_invalid_finding_review_v1` with owner `Mark / Ten Kings`. It atomically replaces only `rapid-capture-queue.json` and installs a canonical non-active archive pointer that lets the orphan-manifest startup guard verify those two unchanged session manifests against the complete archive; the three retained terminal entries must reproduce unchanged. A canonical journal/backup provides bounded restore or idempotent completion after interruption.

Execution remains separately authorized. Capture a fresh token-gated helper status response outside the station output root and hash it. It must prove `start_new_card`, no active session, preview stopped/not-started, camera idle/released, no transition or capture lock, and all worker queues empty. The normal path also requires a no-more-than-five-minute-old bridge-native `safe_off_verified` physical lighting state.

Only for this fixed 2026-07-22 incident, bridge `physicalState=unverified` may instead be composed with one separately authorized, out-of-process `leimac-idmu-safe-off` receipt. Both optional receipt arguments are required together. The receipt must be exact canonical JSON with its caller-supplied SHA-256; bind this incident and owner authorization; reproduce the exact configured `169.254.191.156:1000` controller, unit-one `W86`/`W85`/`W11` zero frames, successful `W86ACK0`/`W85ACK0`/`W11ACK0` responses, all eight output/asynchronous-output/PWM channels at zero, `lightsCommanded=false`, and `persistentSaved=false`; and precede the fresh status capture and transaction by no more than five minutes. The authenticated status must remain otherwise idle and must contain no post-command lighting apply, safety event, persistent controller session, or conflicting state. A native `safe_off_verified` status never accepts the exception receipt. The verified receipt bytes, identity, timing, controller, ACKs, zero-channel summary, and safety result become immutable archive-ledger and transaction-receipt members.

Receipt creation must use the incident-only `tk-ai-grader-capture-stale-review-safe-off-receipt` executable. Its `capture` mode requires the exact fixed confirmation and may spawn at most one guarded `leimac-idmu-safe-off` child. Before interpreting the child result, it writes the exact raw stdout, raw stderr, and canonical child exit/timing/argv/file-identity evidence to fixed create-new files. It then uses the same verifier as the archive transaction to atomically create the canonical receipt and SHA file. Its `regenerate` mode never spawns a child and recreates only the derived receipt/SHA from exact preserved raw evidence. If capture post-processing fails after raw evidence exists, run only `regenerate`; never repeat the hardware command merely because parsing, canonicalization, receipt installation, or SHA installation failed.

The successful first capture under `external-safe-off-receipt-capture-v1` is immutable evidence of the failed pre-transaction attempt. Preserve and reverify it only with hardware-free `regenerate`; never delete, replace, or select it as fresh transaction authority after its five-minute window. A later separately authorized safety capture, if still required, uses the create-new `external-safe-off-receipt-capture-v2` root. That is a new physical-state recency gate, not a retry for receipt post-processing. Never issue it automatically. The live archive root may already exist empty because the prior validator stopped before archive creation. Preserve that directory; the transaction accepts the proven empty root and creates its first content-addressed member inside it. Any unexpected existing member stops for review.

Then stop only the old capture helper through the approved maintenance lifecycle and prove `127.0.0.1:47652` is released before running the archive command; do not stop NFC. Use the one fixed incident archive root outside the station output directory; an already-existing empty directory from the failed pre-transaction validation is the expected next state and must not be deleted or replaced. The following is the exact exceptional one-time sequence after the executable is independently reviewed, merged, installed, and a new exact hardware authorization is obtained. Only the executable's `capture` mode can issue hardware I/O, and it issues at most one guarded safe-off child.

```powershell
$queueOutput = 'C:\TenKings\capture-data\ai-grader-station'
$archiveRoot = 'C:\TenKings\capture-data\ai-grader-queue-quarantine\owner-removed-stale-invalid-review-20260722-v1'
$idleStatus = 'C:\TenKings\acceptance-evidence\ai-grader-queue-maintenance\idle-status.json'
$preservedReceiptCaptureRoot = 'C:\TenKings\acceptance-evidence\ai-grader-queue-maintenance\external-safe-off-receipt-capture-v1'
$receiptCaptureRoot = 'C:\TenKings\acceptance-evidence\ai-grader-queue-maintenance\external-safe-off-receipt-capture-v2'
$externalSafeOffReceipt = Join-Path $receiptCaptureRoot 'external-safe-off-receipt.json'
$externalSafeOffReceiptShaFile = Join-Path $receiptCaptureRoot 'external-safe-off-receipt.sha256'
$rawReceiptMembers = @(
  (Join-Path $receiptCaptureRoot 'safe-off-child.stdout.json'),
  (Join-Path $receiptCaptureRoot 'safe-off-child.stderr.txt'),
  (Join-Path $receiptCaptureRoot 'safe-off-child-execution.json')
)
$installedRepo = 'C:\TenKings\repos\tenkings-rip-it-live'
$configPath = 'C:\TenKings\config\ai-grader-local-bridge.json'
$receiptTool = Join-Path $installedRepo 'packages\ai-grader-capture-helper\dist\staleInvalidRapidCaptureSafeOffReceiptCli.js'
$preservedRawReceiptMembers = @(
  (Join-Path $preservedReceiptCaptureRoot 'safe-off-child.stdout.json'),
  (Join-Path $preservedReceiptCaptureRoot 'safe-off-child.stderr.txt'),
  (Join-Path $preservedReceiptCaptureRoot 'safe-off-child-execution.json')
)
if (@($preservedRawReceiptMembers | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -ne 0) {
  throw 'Preserved v1 safe-off evidence is incomplete; stop without hardware.'
}
$preservedReceiptResultText = & node $receiptTool regenerate --output-dir $preservedReceiptCaptureRoot
if ($LASTEXITCODE -ne 0) { throw 'Preserved v1 safe-off evidence failed hardware-free verification; do not repeat safe-off.' }
Remove-Variable preservedReceiptResultText

if (Test-Path -LiteralPath $archiveRoot) {
  $unexpectedArchiveMembers = @(Get-ChildItem -LiteralPath $archiveRoot -Force)
  if ($unexpectedArchiveMembers.Count -ne 0) {
    throw 'The pre-transaction live archive root is not empty; preserve every member and stop for review.'
  }
}

$configText = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
if ($configText.StartsWith([char]0xFEFF)) { $configText = $configText.Substring(1) }
if ($configText.Contains([char]0xFEFF)) { throw 'Configured bridge JSON contains an unexpected additional BOM.' }
$config = $configText | ConvertFrom-Json
Remove-Variable configText
$configuredLeimacHost = [string]$config.leimacHost
$configuredLeimacPort = [int]$config.leimacPort
if ($configuredLeimacHost -ne '169.254.191.156' -or $configuredLeimacPort -ne 1000) {
  throw 'Configured Leimac controller does not match the fixed incident endpoint; do not issue a hardware command.'
}
$existingReceiptMembers = @($rawReceiptMembers + $externalSafeOffReceipt + $externalSafeOffReceiptShaFile | Where-Object { Test-Path -LiteralPath $_ })
if ($existingReceiptMembers.Count -gt 0) {
  if (@($rawReceiptMembers | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -ne 0) {
    throw 'Partial pre-existing receipt evidence is missing one raw member; preserve all files and stop without hardware.'
  }
  # Hardware-free recovery only. This mode has no child-process boundary.
  $receiptResultText = & node $receiptTool regenerate --output-dir $receiptCaptureRoot
  if ($LASTEXITCODE -ne 0) { throw 'Hardware-free receipt regeneration failed; preserve raw evidence and do not repeat safe-off.' }
} else {
  # Requires fresh exact Mark authorization. Capture mode spawns at most one guarded safe-off child.
  $receiptResultText = & node $receiptTool capture `
    --output-dir $receiptCaptureRoot `
    --config-path $configPath `
    --confirm 'CAPTURE TEN KINGS STALE REVIEW SAFE OFF RECEIPT'
  $captureExit = $LASTEXITCODE
  if ($captureExit -ne 0) {
    if (@($rawReceiptMembers | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -ne 0) {
      throw 'Capture did not preserve the complete raw evidence set; stop and do not repeat safe-off.'
    }
    # The child already ran. Regenerate from raw evidence without spawning any child.
    $receiptResultText = & node $receiptTool regenerate --output-dir $receiptCaptureRoot
    if ($LASTEXITCODE -ne 0) { throw 'Hardware-free receipt regeneration failed; preserve raw evidence and do not repeat safe-off.' }
  }
}
$receiptResult = ($receiptResultText -join [Environment]::NewLine) | ConvertFrom-Json
$externalSafeOffReceiptSha = (Get-Content -LiteralPath $externalSafeOffReceiptShaFile -Raw).Trim().ToLowerInvariant()
if ($externalSafeOffReceiptSha -notmatch '^[a-f0-9]{64}$') { throw 'Receipt SHA file is malformed.' }
$rehashedExternalSafeOffReceipt = (Get-FileHash -LiteralPath $externalSafeOffReceipt -Algorithm SHA256).Hash.ToLowerInvariant()
if ($rehashedExternalSafeOffReceipt -ne $externalSafeOffReceiptSha -or $receiptResult.receiptSha256 -ne $externalSafeOffReceiptSha) {
  throw 'Executable result, SHA file, and canonical receipt bytes do not agree exactly.'
}

# Capture authenticated idle status after the acknowledged command; its file identity/time binds command ordering.
$headers = @{ 'x-ai-grader-station-token' = [string]$config.stationToken }
$status = (Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:47652/status' -Headers $headers).result
$statusJson = ($status | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $idleStatus)) | Out-Null
[System.IO.File]::WriteAllText($idleStatus, $statusJson, $utf8NoBom)
Remove-Variable headers, config, status, statusJson, receiptResult, receiptResultText
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
