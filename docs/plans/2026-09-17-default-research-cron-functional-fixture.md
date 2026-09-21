# Default research cron functional fixture — observed functional pass

This finite fixture qualifies the ordinary authenticated cron route and its default worker wiring on a new owned loopback PostgreSQL cluster. It is separate from the intake timing matrix, which injects worker dependencies. A pass here cannot replace a failed timing gate, authorize an optional feature, or establish a full release pass.

**Current status:** the coordinating agent reviewed the exact preparation seal and authorized one owned PostgreSQL run after the sports fixture's cleanup. That run exited 0: **1/1 non-skipped default-cron fixture passed**, with total supervisor time **22.444 seconds**. Its full 96-migration chain and second-deploy no-op passed; all owned groups and PostgreSQL stopped and the temporary cluster was removed. This observed result supersedes the earlier preparation-only/unrun status. No production source change, runtime seam, dependency install, build or real provider request was needed. Closeout on 2026-09-20 verified retained evidence and hashes only; it did not rerun preparation or the fixture.

## Observed run 01

Evidence: `/private/tmp/tenkings-research-cron-run-20260917-01`, with the parent command log at the sibling `.log` path.

| Check | Observed result |
| --- | --- |
| Default route and worker | Actual authenticated cron default export, default worker dependency object, real source engine/Prisma/writers; TAP **1 pass, 0 failures, 0 skipped, 0 cancelled** |
| Durable work | Three quantity-one saves and jobs; four actual claims; two durable result completions |
| Replay/integrity | Exact save/cron replay added no work; canonical persisted result/readback/hash agreed; research left each source history byte-identical |
| Controlled 429 | Sanitized durable failure, cleared lease, real retry schedule, no immediate reclaim, then completion with a fresh token; stale-token completion/failure rejected |
| Controlled timeout | Actual unchanged 20-second source deadline produced durable TIMEOUT and a queued retry; the fixture asserted 19–30 seconds without a fake clock or shortened deadline |
| Optional work | All optional flags absent/default OFF; V3 results, thumbnails only, zero catalog proposals/publications and zero unexpected transports |
| Transport counts | Four synthetic search calls, two synthetic model calls, four image reads and four archive calls; **zero real provider calls** |
| Database | Owned `127.0.0.1` database `tenkings_research_cron_disposable`; PostgreSQL 17.9, UTF8; **96 migrations**, exact second-deploy ledger no-op |
| Source seal | Preparation/run receipt bytes identical; final source/dependency comparison passed with SHA-256 `7e3d80f70530e24e2793c409f340b2e6bf08e77eb415a0f0e5eed869c9a7c505` |
| Disk at launch | 3,381,972,992 free bytes on both checked filesystems, above the 2 GiB + 256 MiB reserve |
| Duration | TAP subtest 20,441.858 ms; supervisor including setup and cleanup **22,444 ms** |
| Cleanup | Owned groups `42907`, `42917`, `42925`, `42931`, `42936` stopped; PostgreSQL PID `42917` stopped; temporary directory removed; no errors or retained cluster |

The sole fixture scheduling adjustment advanced only the second owned job's `nextAttemptAt`, after verifying its genuine retry schedule. It did not change source evidence, attempt history, engine deadlines or worker configuration. Success was asserted through the actual durable writers and readers, not inferred solely from a 200 response.

`summary.json` records `complete: true` and `functional_integration_pass: true`; `performance_pass` and `release_pass` remain **false**. The retained TAP, database/migration ledger, matching launch seal, disk receipt and cleanup receipt establish this finite functional result. On 2026-09-20, a read-only recheck found **zero differences across 413 sealed source files, 13 generated-client files and eight native/dependency metadata files**. The fixture and runner still match their tested hashes below.

## Exact new files

- `frontend/nextjs-app/tests/staffInventoryResearchCronPostgres.test.ts`
- `packages/database/scripts/testStaffInventoryResearchCronDisposable.mjs`
- This document.

The coordinating agent owns source commits and the session-log entry. Existing benchmark protocols, receipts, failed studies, thresholds and release gates remain authoritative.

## What the fixture exercises

The test imports the actual default export from `pages/api/cron/inventory-research.ts`. It invokes that handler with a synthetic valid bearer capability and normal GET/no-query request. It also rejects wrong authentication, POST and query parameters before a claim. It does not call the handler factory with an injected `run`, replace the worker dependency object, or inject research dependencies.

The actual default worker uses the actual source Prisma singleton, `claimStaffInventoryResearchV2`, `researchStaffInventoryCard`, `completeStaffInventoryResearchV2` and `failStaffInventoryResearchV2`. Real `recordStaffInventoryV2` transactions save three independent quantity-one inputs. The fixture resolves the database, cron, worker and engine to their source paths and checks that those modules are not substituted.

Only external I/O is replaced before importing the application:

- Storage HEAD/read/upload transports use synthetic JPEG bytes with exact SHA-256 keys. Real photo checksum/format validation and private archive-key validation still run.
- The existing reference-loading transport supplies one synthetic exact published-reference receipt. This tests consumption and wiring; it does not qualify the real reference service or catalog publication authority.
- Global fetch returns fixed SoldComps search, Responses API and eBay image bytes. Unexpected fetch URLs, detail requests, full-resolution image requests and non-fetch HTTP/TLS transports fail closed. JavaScript socket connections permit only the owned PostgreSQL address/port. The native Prisma engine receives only the runner-created loopback URL.

The first saved input must produce one durable job and one result, with the expected two-sale estimate and privately archived image hashes. Stored canonical result bytes, parsed readback and result hash must agree. Exact source-save replay and another ordinary cron invocation must add no job, result, attempt, source event or transport call.

The second input receives a controlled provider 429. The real failure writer must clear the lease, retain no result, record a sanitized error/failed attempt, and schedule the real 30-second retry. Immediate cron polling must claim nothing. After checking that schedule, the fixture advances **only this owned job's `nextAttemptAt`** so the retry can run without a 30-second sleep. The second claim must have a new lease token and complete durably. Completion/failure using the first token must be rejected without changing that result.

The third input receives a search transport that waits for the actual abort signal. The unchanged 20-second source deadline must cause a durable TIMEOUT, cleared lease and queued retry. There is no shortened engine deadline or fake clock. The timeout check allows normal scheduling overhead but fails at 30 seconds. Every source history remains byte-identical across its research invocation.

Success therefore requires **three real saves, four actual claims, two durable completions, one controlled provider failure and one real source timeout**. All optional catalog, contribution, sale-detail and full-resolution flags are absent/default OFF. Results must remain V3; only thumbnail URLs may be read; catalog proposal/publication tables remain empty. The fixture checks exact transport counts rather than treating a completed cron response alone as success.

## Supervisor and launch boundary

The new runner supports only `--prepare-only` or `--run-approved --ack-disposable-local-postgres`. There is no configurable fixture, source override, workload size, installed-client generation, dependency installation, app build, live endpoint or external database URL. It rejects inherited database URLs and supplies a fresh allowlisted child environment, preserving HOME. Provider values and the cron secret are synthetic. Optional feature variables are absent.

Preparation reads and seals current source/library trees, the cron route/fixture/runner, schema/migrations, package and lock files, generated client files, installed dependency versions/package metadata and the native initdb/postgres binaries. It compares the exercised Location/workflow/research-job/intake-lease model blocks with the already installed generated client. It starts no database and imports no application modules. This is active-model compatibility only; optional catalog paths and unrelated models are not qualified. External dependency trees are reused; package metadata is sealed rather than every dependency byte.

Launch requires a reviewed exact preparation-receipt SHA-256 and recomputes the seal. Any source, runner, client or sealed dependency change requires a new preparation receipt and review. The runner uses the current sealed workspace directly; it does not export or modify an application source tree. A final seal comparison rejects source changes during the fixture.

Launch requires at least **2 GiB + 256 MiB free** on the output and temporary filesystems, with a **2 GiB floor** before database setup, migrations and test execution. Direct installed native binaries create only a random owned temporary cluster, listen on `127.0.0.1`, require a random local password, and use UTF8. The database name is fixed to `tenkings_research_cron_disposable`. A private ownership receipt binds its URL hash, process ID, user ID and nonce; the child refuses to import application code without this guard.

The complete current published Prisma migration tree is copied into the owned temporary directory. Migrate deploy runs from that directory with a clean environment so checkout `.env` files are not loaded. The runner verifies the actual server/database/encoding and requires the second deploy to leave the migration ledger exactly unchanged. It never generates a client.

There is a **10-minute total cap**, with work stopped at **9m30s** and the final **30 seconds reserved for cleanup**. Startup, administration and child execution have shorter bounds. Detached command/PostgreSQL groups stay registered until absence is confirmed. SIGINT/SIGTERM and failures abort new work, enter cleanup, and escalate owned TERM/INT to KILL if needed. Temporary data is removed only after owned groups stop; a cleanup error fails the run and retains data. Logs and receipts are private and redact the owned URL/password. SIGKILL/OS loss cannot be trapped. Normal completion cleanup was observed in run 01. Forced-signal and supervisor-failure cleanup paths remain source-reviewed; they were not separately fault-injected.

## Verified preparation and historical commands

Evidence directory: `/private/tmp/tenkings-default-cron-validation-20260917-XogLD2`. Its `verification.md` records every exact command and working directory; original and fixed raw logs remain intact. The initial checks found a Next-reserved local variable name and a nullable image assertion in the new fixture. Those two fixture-only issues were corrected; final lint and type import-closure checks exit 0 with zero diagnostics. Runner `node --check` exits 0. No dependency was installed or generated.

Preparation receipt: `/private/tmp/tenkings-research-cron-prepared-20260917-01`. This earlier preparation-only receipt correctly reports `database_started: false`, zero measured saves, no owned processes, no PostgreSQL PID, no temporary cluster and no cleanup errors. Active-model/client comparison and the complete source/dependency seal passed. These historical preparation fields are superseded for execution status by the successful run 01 receipts above. Fresh launch disk headroom was checked and recorded by that run.

| Artifact | SHA-256 |
| --- | --- |
| `launch-seal.json` | `7e3d80f70530e24e2793c409f340b2e6bf08e77eb415a0f0e5eed869c9a7c505` |
| Fixture | `96ae984f7d5e543172fc29dc66f13ad5411697ac321ef6f9dd1b00a364c4f54b` |
| Runner | `c5410b2862819f16e4914f6e3893813b80c2e5a7acc1ef5873176ebeaf126a64` |

The following preparation was already executed once using the existing qualified Node22/dependencies. Do not repeat it or overwrite the receipt. A source change requires a newly reviewed preparation and fresh output path.

```sh
cd /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
TK_CRON_NODE=/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node
env -i HOME="$HOME" PATH="$(dirname "$TK_CRON_NODE"):/usr/bin:/bin" \
  INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
  "$TK_CRON_NODE" packages/database/scripts/testStaffInventoryResearchCronDisposable.mjs \
  --prepare-only --out /private/tmp/tenkings-research-cron-prepared-20260917-01 \
  > /private/tmp/tenkings-default-cron-validation-20260917-XogLD2/prepare.log 2>&1
```

After reviewing that exact preparation receipt and the sports fixture's completed cleanup, the coordinating agent explicitly authorized the following **single completed invocation**. It is retained for reproducibility, not as an instruction to rerun:

```sh
umask 077
set -C
env -i HOME="$HOME" PATH="/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin:/usr/bin:/bin" \
  INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
  "/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node" \
  packages/database/scripts/testStaffInventoryResearchCronDisposable.mjs \
  --run-approved --ack-disposable-local-postgres \
  --prepared-receipt /private/tmp/tenkings-research-cron-prepared-20260917-01/launch-seal.json \
  --prepared-seal-sha256 7e3d80f70530e24e2793c409f340b2e6bf08e77eb415a0f0e5eed869c9a7c505 \
  --out /private/tmp/tenkings-research-cron-run-20260917-01 \
  > /private/tmp/tenkings-research-cron-run-20260917-01.log 2>&1
```

The acknowledgement covered cleanup only of the cluster this runner created. It did not permit destructive source operations or deleting old evidence. These historical commands do not authorize another run.

## Acceptance and limits

Run 01 met the required zero exit code, passing non-skipped TAP fixture, exact second-deploy ledger, unchanged final source seal, `functional_integration_pass: true`, stopped groups and removed owned temporary data. An incomplete or cleanup-failed result would be a failure. `performance_pass` and `release_pass` remain false by design.

This proves only default cron/worker functional wiring on controlled local source, transports and PostgreSQL. It does not measure intake headroom, hosted request/instance behavior, real providers, remote storage/references, browser/camera/upload/recognition, simultaneous staff phones, optional-feature activation or card-accuracy acceptance. The independent matrix and all previous failed timing gates remain separate. A live release still needs its existing source, hosted and operational checks.
