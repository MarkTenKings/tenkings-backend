# Deploy Runbook (Source of Truth for Commands)

last_verified_at: 2026-08-15
owner: Mark

## Capability-Scoped Operator Authority
- Static operator authority is not an admin-session substitute. General admin routes accept only ordinary signed-in bearer sessions.
- The only current static capability is `OPERATOR_API_CAPABILITIES=set-ops:batch-import`, accepted only by the five Set Ops batch CLI dependencies: set lookup, ingestion creation, draft build, draft read, and approval.
- Configure server-only `OPERATOR_API_KEY` (32–512 characters) and one exact `OPERATOR_USER_ID` that still resolves to an admin. Do not expose the key in browser configuration. Prefer `SET_OPS_BEARER_TOKEN` for interactive/human operation.

## Speedster Detector Checkpoint Authority Gate
- Before enabling Speedster detection, configure `AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID`, a random `AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET` of at least 32 characters, and `AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1=true`.
- During key rotation, `AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON` must be a JSON object mapping retained key IDs to secrets of at least 32 characters; use `{}` when no old key is retained. `AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS` must match the reviewed request budget (repository default `55000`).
- Missing or malformed authority must fail before storage reads, Memory loading, or a detector request. Production proof must exercise that fail-closed path and then record a successful Front/Back run whose signed checkpoint receipts and detector release identities validate under the deployed configuration.

## Speedster Exact-Artifact Release Gate
- The release workflow must pass Install & Build, the protected Speedster frontend/adversarial suite, and the complete disposable PostgreSQL chain before publishing the Speedster image. Never deploy a PR-only image or an image from a skipped/failed dependency.
- Use the run-specific tag only to locate the artifact. Record and deploy `ghcr.io/marktenkings/tenkings-backend/ai-grader-speedster-service@sha256:<digest>`. Verify its keyless cosign signature, SPDX attestation, and GitHub provenance against `.github/workflows/ci.yml@refs/heads/main` before provider mutation.
- RunPod must receive that same digest as both the deployed image reference and `SPEEDSTER_OCI_IMAGE_DIGEST`. Preserve `HF_TOKEN`; startup must fetch official `facebook/sam3` revision `3c879f39826c281e95690f02c7821c4de09afae7` and verify checkpoint SHA-256 `9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e` before readiness.
- Before changing RunPod, require zero jobs in progress and zero jobs waiting, record the prior exact digest, and change no GPU, capacity, port, scaling, secret, or unrelated setting. Afterward, require identical complete `/health` release/model identity on at least two workers plus repeated known-corpus `/detect` success without deterministic-operation errors. Provider "ready" alone is insufficient.
- Apply migrations `20260818153000_speedster_audit_evidence_append_only` and `20260818191500_speedster_iphone_capture_integrity_manifest` before serving the new capture protocol. Release the Vercel iPhone API and Cloudflare iPhone worker together because PLAN/COMPLETE now require byte-size/checksum manifests and private checksum headers.
- The normal order is: quiescence/read-only baseline; pre-deploy log entry; configure new server-only web authority; one exact migration-bearing web deploy; verify the ledger and triggers; return `RUN_DB_MIGRATIONS=false`; publish/verify the main-branch image; zero-queue RunPod digest rollout; multi-worker health/detect proof; signed-in natural-card acceptance.
- Rollback boundary: before a new capture manifest or detector checkpoint is written, the prior exact Vercel deployment and prior RunPod digest may be restored independently. After new content-addressed capture/checkpoint evidence exists, roll forward with the reviewed runtime. Never roll back the additive audit triggers, delete manifests/checkpoints, route identity-required web traffic to an identity-incapable detector, or rewrite completed evidence.

## Rules
- Always print branch + HEAD before deploy
- Always confirm remote parity before restart/migrate
- Record every deploy/restart/migrate in `docs/handoffs/SESSION_LOG.md`

## Vercel Migration Gate
- Vercel production builds do not run Prisma migrations by default.
- `scripts/vercel-build.sh` runs `pnpm --filter @tenkings/database run migrate:deploy` only when `RUN_DB_MIGRATIONS=true`.
- If `VERCEL_ENV=production` and `RUN_DB_MIGRATIONS` is not `true`, the build logs that migrations are skipped and continues.
- To intentionally apply migrations through Vercel, set `RUN_DB_MIGRATIONS=true` for the approved deploy, verify migration readiness first, then remove or reset the flag after the deploy.

## Speedster Map Registration Receipt Gate
- Any release that requires server-authoritative Card Map registration receipts must provision dedicated, server-only `SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY` and `SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID` values in the Vercel Production environment before activation.
- Any future release that explicitly activates the owner-directed, currently undeployed Color Geometry proposer must first provision dedicated, server-only `SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY` and `SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID` values. Never reuse the Card Map receipt key. Its thresholds/results remain not-live-calibrated offline estimates, and this repository change does not authorize deployment, migration, or Production activation without separate explicit Phase 2 deploy approval.
- The receipt key must be a new random secret used only for registration receipts; never reuse the Card Format Authority key or expose this key to a browser, local capture helper, RunPod worker, log, or committed file.
- Record only the key ID and successful presence/format check in `docs/handoffs/SESSION_LOG.md`; never print or record the secret. Missing or invalid authority fails registration closed.

## Speedster Pokémon Layout Key V2 Cutover Gate

- Phase 0 no longer blocks candidate reconstruction. Read-only evidence proves completed card `TKH-001259` pinned FAMILY r9 `cmssbc8fi0002jfswkc7ra2rl`; its Front used human correction. Mark's ongoing Production grading continues independently and must never wait for this release. This evidence is not deploy approval.
- Mark's Aug 13 dual save created intended rescue FAMILY r9 and paired EXACT r5 `cmssbc8hf0004jfswua36k5bf` atomically from identical Front/Back map bodies. The exact-first editor therefore exposes content-equivalent geometry even though the two revisions have different authority metadata and hashes. FAMILY r8 remains immutable history. See `docs/context/SPEEDSTER_LAYOUT_KEY_V2_ADDENDUM_2026-08-15.md`.
- No migration or web cutover begins without Mark's separate explicit approval for this exact Phase 1 candidate. Deploy phases remain one at a time even though candidate reconstruction and review proceed in parallel.
- Before approval, run a read-only inventory for every non-completed session that is pinned to a legacy Pokémon FAMILY revision or has persisted filter decisions derived from one. Stop if any row exists; record exact counts and obtain an explicit owner disposition. Never rewrite those sessions or decisions automatically.
- Run a read-only identity preflight across existing sessions. Any present `layoutType` must be exactly `POKEMON`, `TRAINER`, or `ENERGY`, and it may appear only on a Pokémon identity. Historical Pokémon identities with no layout remain valid and must remain byte-unchanged.
- Validate the exact final commit through the contained, loopback-only disposable PostgreSQL full migration chain. Require the new constraint/table/index/foreign-key/append-only-trigger catalog, unchanged pre-existing identity bytes, valid and invalid layout fixtures, UPDATE/DELETE rejection, one-authority-per-source rejection, rollback cleanup, a second migration deploy that is an explicit no-op, and an unchanged migration ledger. Preserve the validator artifact/output in the deployment evidence.
- Quiesce Speedster before cutover: prohibit new captures, Card Map save/restore/promotion, and completed-identity correction; drain every old web request and verify no old instance can still accept traffic. Apply the additive migration, deploy the reviewed web commit, and then reopen Speedster only after exact-source/version and signed-in read-only checks pass.
- The safety boundary is the first V2 identity or legacy-source layout-authority write. After that boundary, an old web instance is not a valid rollback target because it does not enforce layout-scoped FAMILY authority. Roll forward with the reviewed V2 runtime; do not route traffic back to old instances.
- A legacy source's first layout selection is irreversible and has no edit/correction path. The operator must verify the physical card layout before saving. If the selection is wrong, stop and obtain owner direction; never mutate or delete the authority row, rewrite the completed session, or guess another layout from image content.
- Postflight must prove: legacy Pokémon FAMILY revisions remain historical-only; legacy identities without authority resolve EXACT only; an authority-bearing legacy source reloads the normal same-layout V2 FAMILY hash; a new Pokémon sibling resolves only a same-layout V2 FAMILY; and a Trainer/Energy sibling cannot resolve a Pokémon-layout FAMILY. These checks are read-only until the owner separately authorizes the deliberate Squirtle re-save.

## Workstation Deploy Flow
```bash
cd /Users/markthomas/tenkings/ten-kings-mystery-packs-clean
git status -sb
git branch --show-current
git fetch --all --prune
git log --oneline -n 10
git push origin <branch>
```

Live verification on 2026-08-05 found no GitHub branch-protection object and no repository ruleset for `main`. Until protection is restored, the complete PR check set is an operator-enforced release policy: verify the exact head and every required result immediately before merge, never use an admin bypass, and do not describe the checks as mechanically protected.

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

Before any rollout, require the complete disposable PostgreSQL migration chain plus second-deploy no-op, all normal GitHub/Docker/Vercel checks, and the separately required independent Mac architecture/calibration review. If GitHub is not mechanically enforcing branch protection, verify and enforce that policy set manually on the exact PR head immediately before merge. Apply the additive migration, import/trust a real bundle, install/update a Dell helper, deploy, or enable V1 only under a separately authorized rollout; none is an ordinary consequence of merging the implementation PR.

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
