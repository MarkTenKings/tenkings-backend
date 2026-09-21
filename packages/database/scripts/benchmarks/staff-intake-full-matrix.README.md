# Complete split-process intake matrix — preparation

Status: **preparation succeeded; no measured run**. No new benchmark, database, source export, provider call, build, installation or Linux activity was performed. The coordinating agent selected candidate `134c9df34a18f35aab720d57ca6bcf89245f8428`. The reusable template deliberately fails validation while `refs.B` is `null`; the private configuration and receipt below bind the actual candidate.

## Scope and fixed gates

Compare A `60572cec895ad63d4ab826cd366f6475b04e725a` (the serving application equivalent of `38c95335`) with the explicit reviewed B. A predates the V3 matching repairs; historical A `12e13992` already contained them, so the passing reader-only subset cannot establish this live-source comparison. All four prior failed studies and the latest 1,200-save passing subset remain separate retained evidence.

| Dimension | Frozen workload |
| --- | --- |
| Sessions | 1 and 3, sequential requests per session |
| Scenarios | idle, thumbnail, provider timeout, provider 429 (`rate-limit`) |
| Pairing | A/B/B/A for every cell; two repetitions, 32 blocks |
| Samples | 5 warmups + 50 measured saves per session per block; **3,200 measured + 320 warmups** |
| Seed | 2,000 units; 256 pending + 16 terminal research jobs |
| Processes/pools | external driver; intake 4, worker 3, observer 1 connections; two workers |
| Photos/tapes | unchanged original 1200×1680 intake photos; six 1000×1400 listing photos; fixed 250 ms transport; unchanged timeout/429 and cancellation behavior |
| Gates | original five metrics plus direct photo-wall metric, each nearest-rank p95; pooled and both A/B repetitions; B loaded-minus-idle for all three loaded scenarios |
| Margins | unchanged `max(50 ms, 10% of baseline p95)`; headroom uses B idle p95 |
| Budgets | 90 minutes total, work stops at 89m30s; final 30 seconds for cleanup; seed RPC 180 seconds, other RPC 60 seconds |
| Disk | launch ≥2 GiB + 300 MiB; ≥2 GiB before setup/each block, checked on output **and** temporary filesystems |

The new runner imports the new pure protocol helper. It verifies the exact prior protocol bytes and the unchanged split driver/role/IPC bytes. No preflight, smaller workload, source override, feature activation, threshold override or automatic retry mode exists.

Matching repairs are source changes, not a feature flag. Catalog, contribution, sale-detail and full-resolution activation remain off. The source engine receives explicit `FULL_RES_IMAGES=false`; other optional flags are absent from clean process environments. The legacy summed photo metric is retained alongside direct photo wall; camera, upload, recognition and browser latency are not measured.

### Evidence and source binding

Preparation resolves only exact 40-character commit pins, requires the source/migration artifacts, audits conservative literal import closure, and seals its source hashes. Every imported `@tenkings` package must have an explicit owned-tree alias; unsupported new package imports fail before database startup. Installed external dependencies are shared, with versions sealed; their entire trees are not content-addressed. The original Prisma client file ledger must match exactly; no generation occurs.

A lacks the later catalog schema. Both arms therefore use the **candidate's additive migration chain**. Preparation requires A's migration ledger to be an unchanged prefix of B's and exact normalized compatibility of the four exercised Prisma models against the original frozen client. It records each schema, migration, writer and reader hash and the entire exported runtime diff. The coordinating agent must inspect added migrations for changes to exercised behavior; the prefix/model check alone does not prove arbitrary SQL harmless. The run applies the candidate chain to the owned template and verifies a second deploy is an exact no-op. This tests source changes on the same candidate schema, not production migration rollout.

Each block must retain matching report/NDJSON samples, four distinct role PIDs, 4/3/1 pools, 18 bracketed clock probes, all source integrity invariants, exact accepted-save job cardinality, untimed third-lease denial/resume proof, completed/failed terminal accounting, and actual observed worker/save queue overlap in loaded cells. Independent observer NDJSON counts and per-block SHA256 receipts are retained. After validating each block, the parent keeps only its sample rows for comparison; complete parsed trace trees remain on disk instead of accumulating in parent memory. Cleanup separately records stopped groups/PostgreSQL and removal of owned temporary data; a cleanup error fails the process and retains evidence. SIGINT/SIGTERM use the previously reviewed shared-abort/supervision pattern. This new runner's signal/failure paths have static coverage only; no runtime fault injection occurred.

### The separate functional gate

This matrix calls the actual source worker loop, source engine and durable claim/complete/fail writers with injected dependencies. It **does not exercise the default worker dependency object or authenticated cron route**. Accordingly `functional_integration_pass`, `full_release_pass` and `pass` remain false even when `controlled_timing_pass` is true.

The finite wiring fixture still required is: authenticated cron handler → default worker dependencies → actual engine, on owned PostgreSQL, substituting only external provider/photo/reference/archive transports. Verify successful claim/result persistence and replay, bounded failure/cancellation and lease behavior, and no catalog/contribution/detail calls while optional flags are off. The existing 62 PostgreSQL checks establish writer/read/queue integrity; they do not substitute for that end-to-end default wiring fixture or timing. A default-worker transport seam may need implementation and review before the fixture can run.

Hosted request/instance behavior, representative simultaneous staff iPhones and real camera/upload/recognition/provider variability remain separate operational evidence. Independent all-card accuracy is a separate product acceptance gate, not a prerequisite for interpreting these source/DB timings. The synthetic identify lease still runs in the intake process, although deployed identify and workspace function names differ. Function descriptors do not establish physical instance or CPU placement.

The optional sale-detail stage is outside this matrix. A later stage-on qualification needs explicit off/on paired inputs on the same candidate and eligible missing/null-best-offer tapes with `/v1/item` responses; the frozen current tapes mark every item `bestOfferAccepted:false` and would activate zero detail requests. Passing this matrix cannot approve that stage, catalog or full-resolution activation.

## Preparation receipt

The single authorized preparation-only invocation exited 0:

- Output: `/private/tmp/tenkings-intake-full-matrix-prepared-20260917-01`; raw log at the sibling `.log` path.
- Launch seal SHA256: `c16fc72f1f686538fb35d3d606883d56d334fbd60dc96b4aa23b7cd8b2757f8a`.
- Strict configuration SHA256: `4d129328c4d564717b9726d267ca90c6bb264eb09f559700e9ce59fd03937ba1`.
- A/B conservative source closure: **68/81 files**, migrations **95/96**, unchanged baseline prefix and four compatible active Prisma models. B's catalog import has an explicit owned-tree alias. No closure/schema/seal failure was encountered or bypassed.
- `database_started=false`, `source_trees_exported=false`, measured saves **0**. Fifteen receipt files total **288,594 bytes**.
- Disk sample **3,789,877,248 bytes**, above the **2,462,056,448-byte** launch threshold; `launch_disk_ready=true` at collection. Launch must check again.
- Host: Darwin arm64, Apple M4 Pro, 12 logical CPUs; Node22.23.2, Prisma5.22.0, Sharp0.33.5, tsx4.21.0, TypeScript5.5.4, pg8.16.3. The wrapper is embedded-postgres17.9.0-beta.16; its installed Darwin native package is17.9.0-beta.17, recorded separately. PostgreSQL itself was not started or probed during preparation.

Frozen new implementation SHA256 values:

| File under `packages/database/scripts` | SHA256 |
| --- | --- |
| `benchmarkStaffIntakeFullMatrixDisposable.mjs` | `76d3291a52676d16aec7e0035b74adb865bf0d97e013ec1770533b86e6b15792` |
| `lib/staffIntakeFullMatrixProtocol.mjs` | `13fbbc1be57f02586e7436a5e441773450e77647679aa5beec0be49d6dc1350c` |
| `tests/staffIntakeFullMatrixProtocol.test.mjs` | `742b3758e8b5cfa6ef805b63d1c687aa41d451332608e47345aba6488647c567` |
| `benchmarks/staff-intake-full-matrix.config.template.json` | `e6df61fa057e3fe56351a70f1bcabddb96219759e361e3b82b1dc2f4e256bda4` |

## Reproducible commands

Configuration creation and preparation below were executed once with the exact paths shown. Those paths now exist and intentionally cannot be overwritten. The measured command **has not run**. Choose fresh paths only if a reviewed change requires new preparation; do not repeat an unchanged measured study.

Run from `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`. Use new output paths for each preparation; never overwrite a receipt or old study.

First substitute the exact final reviewed candidate supplied by the coordinating agent, then create a private configuration:

```sh
TK_BENCH_NODE=/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node
TK_BENCH_CANDIDATE=134c9df34a18f35aab720d57ca6bcf89245f8428
"$TK_BENCH_NODE" --input-type=module - "$TK_BENCH_CANDIDATE" /private/tmp/tenkings-intake-full-matrix-20260917.config.json <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { parseFullMatrixConfig } from './packages/database/scripts/lib/staffIntakeFullMatrixProtocol.mjs';
const config = JSON.parse(await readFile('packages/database/scripts/benchmarks/staff-intake-full-matrix.config.template.json', 'utf8'));
config.refs.B = process.argv[2];
parseFullMatrixConfig(config);
await writeFile(process.argv[3], JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
JS
```

Preparation reads and hashes only; it is permitted to report insufficient launch disk without starting a database or exporting source trees:

```sh
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
"$TK_BENCH_NODE" packages/database/scripts/benchmarkStaffIntakeFullMatrixDisposable.mjs \
  --prepare-only \
  --protocol /private/tmp/tenkings-intake-full-matrix-20260917.config.json \
  --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 \
  --out /private/tmp/tenkings-intake-full-matrix-prepared-20260917-01 \
  > /private/tmp/tenkings-intake-full-matrix-prepared-20260917-01.log 2>&1
```

After coordinating-agent review of source compatibility, protocol and **exact launch-seal SHA256**, fresh disk proof and an explicitly released quiet window, run once:

```sh
TK_BENCH_SEAL=REPLACE_WITH_REVIEWED_64_CHARACTER_LAUNCH_SEAL_SHA256
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
"$TK_BENCH_NODE" packages/database/scripts/benchmarkStaffIntakeFullMatrixDisposable.mjs \
  --run-approved-full-matrix --ack-disposable-local-postgres \
  --protocol /private/tmp/tenkings-intake-full-matrix-20260917.config.json \
  --prepared-receipt /private/tmp/tenkings-intake-full-matrix-prepared-20260917-01/launch-seal.json \
  --prepared-seal-sha256 "$TK_BENCH_SEAL" \
  --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 \
  --out /private/tmp/tenkings-intake-full-matrix-20260917-01 \
  > /private/tmp/tenkings-intake-full-matrix-20260917-01.log 2>&1
```

The run recomputes the same seal before source export/DB and rejects changed configuration bytes, code, client, source audit or host/version metadata. Review is coordination under existing execution authorization, not an additional request to Mark. No launch is authorized by this README alone.

## Readiness and resources

- [x] New helper/runner syntax checked; 13 pure offline tests pass. They use synthetic numeric samples, not fabricated performance evidence.
- [x] Validator accepted two retained real prior blocks (idle + loaded, 165 samples each), read-only. No old report, gate or raw file changed.
- [x] Old driver/roles/IPC and photos/tapes remain byte-for-byte frozen.
- [x] Final reviewed B supplied; strict config created; preparation source audit and launch seal generated.
- [ ] Coordinating-agent review of the exact protocol/source audit/launch seal, followed by one launch release.
- [x] A/B source closure and active models validated; no missing imported package, model mismatch or mutable workspace fallback found.
- [ ] Fresh free-space proof on both filesystems, quiet window and no competing build/test/DB load.
- [ ] One run only; verify all 32 blocks/3,520 samples, source/clock/raw evidence and normal cleanup; retain failures and partial output.
- [ ] Separate default-worker integration fixture and operational/device acceptance.

Plan approximately 30–60 minutes, bounded by 90 minutes. Latest 8-block candidate comparison took 7.05 minutes; the old complete single-process study took 50.47 minutes. These are estimates, not comparable timing claims. Latest subset artifacts occupied about 74 MB; allow roughly 300–600 MiB for full-matrix raw traces plus about 100–200 MiB for owned setup. End-of-block role RSS in the last study totaled about 1.5 GB plus PostgreSQL; that is not a peak bound. Prefer at least 3 GiB free at launch for practical margin; the unchanged enforced minimum is 2 GiB + 300 MiB.

This implementation intentionally accepts **Darwin arm64 only**. A later Linux option requires its own native PostgreSQL17, Node22, Sharp and Prisma bindings/client ledger, source seal and safe coordinated resource window. Run the complete paired matrix on one host; never splice Darwin A and Linux B. Host capacity metadata or an Atlas quiet-window notification is not execution authorization.

Offline validation logs: `/private/tmp/tenkings-intake-full-matrix-offline-20260917-01.log` and `/private/tmp/tenkings-intake-full-matrix-retained-evidence-20260917-01.log`. Reproduce pure checks with:

```sh
"$TK_BENCH_NODE" --check packages/database/scripts/benchmarkStaffIntakeFullMatrixDisposable.mjs
"$TK_BENCH_NODE" --test packages/database/scripts/tests/staffIntakeFullMatrixProtocol.test.mjs
```
