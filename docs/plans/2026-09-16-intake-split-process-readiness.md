# Split-process intake diagnostic — completed; failed headroom gate retained

Updated 2026-09-16. The 48-save runtime preflight passed, and the one sealed **1,200-save measured diagnostic plus 120 warmups completed**. It **failed** the candidate loaded-minus-idle lease headroom gate: 79.320333 ms versus the frozen 50 ms margin. All A/B pooled and repetition comparisons pass, but do not override this failure. See [complete findings and limits](2026-09-16-intake-split-process-results.md). The original preparation and launch record below is retained as historical context. Both earlier failures, thresholds and application refs remain unchanged.

## Implementation and frozen workload

- `packages/database/scripts/benchmarkStaffIntakeSplitDisposable.mjs`: new disposable runner; preparation-only sealing; immutable source export only on later execution; original frozen Prisma client required; UTF8 PostgreSQL; unchanged second-migration ledger check; 30-minute cap and owned-process cleanup. Requires **2 GiB free** before setup and every block. Administrative DB connection is closed during seed/blocks. `HOME` is passed through unchanged only when present; task temporary paths use `TMPDIR` and explicit owned directories.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-driver.ts`: external three-session driver, with no Prisma, Sharp or application imports. Spawns separate intake, worker and observer processes and records IPC round trips separately from existing server metrics.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-role.ts`: actual source workspace POST/sole writer, actual research engine/claims/terminal writers, original synthetic response tapes, exact retry/rollback/history checks and third-lease admission proof. Pools remain **4 intake + 3 worker + 1 observer**, two workers. Failure cleanup retains partial role traces when possible; forced process termination can still lose buffered traces, which must make a run incomplete.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-ipc.ts`: bounded IPC, per-process monotonic spans and event-loop tracing. Only the untimed `seed` method permits 180 seconds; every other RPC, including `seed-terminal`, retains 60 seconds. The runner’s 30-minute cap is unchanged.
- `docs/plans/2026-09-16-intake-split-process-protocol.json`: preregistered workload, metrics, comparison rules, stop conditions and missing proof.
- `docs/plans/2026-09-16-intake-split-process-function-receipt.json`: allowlisted read-only deployment metadata.

A remains `60572cec895ad63d4ab826cd366f6475b04e725a`; B remains `31b8653559d8553208de8591f2d30c419642953a`. The intended diagnostic is three-session idle/thumbnail ABBA, five warmups and 50 measured saves/session/block: **1,200 measured + 120 warmups**. Initial units/jobs, images, 250 ms response tapes, actual queue-overlap barrier and original five gated metrics remain. Every pooled cell **and each repetition** must meet B−A ≤ `max(50 ms, 10% of A p95)`; candidate loaded-minus-idle uses the same margin.

`photo_verify_ms` remains the sum of both parallel metadata operations and remains gated. New individual Front/Back spans and their combined `photo_wall_ms` are recorded directly; the wall metric is an additional gate with the same margin. It cannot substitute for a failed summed metric. `legacy_timing_pass`, `photo_wall_pass` and combined diagnostic verdict are separate; release `pass` is always false for this subset. All samples are retained. No thresholds or exclusion rules depend on observed results.

## Deployment evidence and model limits

The normal installed Vercel CLI made only `GET /v11/deployments/dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj/builds`; no token or arbitrary environment was exported. Only the four requested paths and functionName/runtime/memorySize/timeout/deployedTo were retained.

| Endpoint | Function identity suffix | Runtime / region | Memory | Timeout |
| --- | --- | --- | ---: | ---: |
| Inventory photo | `d0faca2fb882f88b27851550947401d5cf` | nodejs22.x / iad1 | 2048 MB | 300 s |
| Inventory workspace | same as photo | nodejs22.x / iad1 | 2048 MB | 300 s |
| Inventory identify | `072638cb2437710232354a3396d2749932` | nodejs22.x / iad1 | 2048 MB | 45 s |
| Research cron | `4bb33f1ee98e7377d2c4fb491c0c11d0b9` | nodejs22.x / iad1 | 2048 MB | 300 s |

Four paths map to **three function identities**, not four established process boundaries. Separating the worker from workspace is a supported diagnostic model; the descriptor does not prove live invocation placement, instance concurrency, CPU isolation or whether this deployment enables Fluid compute. Vercel documents that Fluid can share a process across concurrent invocations, so one-function-per-request isolation must not be assumed. [Official Fluid compute documentation](https://vercel.com/docs/fluid-compute#isolation-boundaries-and-global-state).

The harness keeps all three intake requests in one intake process. Its synthetic recognition-capacity lease remains in that process to preserve the original workload and 4-connection intake budget; **the separate identify function is not modeled**. Actual photo upload, authentication, networking, Next/Vercel invocation routing, cold starts, production resource limits and phone UI are also absent. Shared host scheduling still exists across the separate local processes. These are explicit review issues, not silently claimed production equivalence.

## Completed runtime preflight audit

Read-only review of `/private/tmp/tenkings-intake-split-preflight-20260916-01` and its `.log` found:

- Eight ABBA blocks completed in **28.27 seconds**, with exactly **48 measured + 24 warmup saves**. Raw NDJSON equals each block report; every session/index occurs once.
- Every block has four distinct matching driver/intake/worker/observer PIDs and **18 bracketed monotonic clock probes**, 144 total. Per-role loop ticks and driver IPC round trips are present. Configured DB pools are **4/3/1**; sampled active connections did not exceed them. The observer records non-idle connections, so it is not a complete census of all idle pool connections.
- All 72 saves have lease/release/save transaction traces and Front/Back photo spans. Combined photo-wall arithmetic exactly matches the individual spans; original summed verification and all six gate metrics are present and finite.
- All eight retry/rollback/one-job/history/photo/admission invariant sets pass. Admission evidence is the executed source/RPC assertions and recorded results; timed `denied_at_three_leases` remains zero and is not represented as independently observed timed denial.
- Every loaded block independently observes an intake queue advisory waiter while a worker owns that lock: **1/2/2/1 observer samples** across A/B/B/A. Each has an observed controlled barrier, at most two running workers, four accepted claims, two completed jobs and two shutdown cancellations; no unexpected provider call occurred.
- All eight cancellations completed **0.58–0.67 ms after measurement end**; their terminal fail writes began **0.62–0.72 ms afterward**. They are the intended abort of the two remaining research attempts on teardown, not intake failures or failures during the measured interval.
- The log reports owned cluster/source-tree removal; root independently confirmed none of the recorded process PIDs remained alive. This proves the successful normal teardown path; forced termination/timeout cleanup was not exercised.
- Executed runner, role/driver/helper and protocol hashes match the preflight seal and then-current source. UTF8 PostgreSQL 17.9 was recorded. All smoke comparisons are descriptive only: `smoke:true`, release `pass:false`, `diagnostic_timing_pass:null` correctly prevent qualification.

### Seed deadline blocker and bounded correction

The audit caught one full-size launch blocker that the tiny preflight could not expose: the IPC helper used 60 seconds even for `seed`. Prior full-size seed receipts followed migration completion by **96.32 and 100.14 seconds**, versus **2.06 seconds** in the 40-unit preflight. Those intervals include seed-process/setup overhead rather than a direct seed-body span, but establish a concrete risk of the existing 60-second deadline aborting the 2,000-unit setup.

Only `method === 'seed'` now uses **180,000 ms**. `seed-terminal` and every ordinary RPC remain **60,000 ms**; the **1,800,000 ms global cap**, source refs, sample counts, database budgets, provider work, metrics and comparison thresholds are unchanged. No timed work occurs inside the seed method. The correction requires no source/runtime throttle change.

Observed verification: changed IPC file passed ESLint; the harness and imported dependency graph passed TypeScript with **zero diagnostics** and no emit. The earlier runner syntax check remains applicable because runner bytes are unchanged. New preparation-only sealing succeeded with **zero saves, no DB start and no source-tree export**. No runtime preflight or measured run was launched as part of this correction.

New preparation receipt: `/private/tmp/tenkings-intake-split-preparation-20260916-03`. Prior `...-01` and `...-02` receipts are preserved unchanged. Role/driver/runner hashes also remain unchanged; only the helper and preregistration hashes change. Root reported **2,553,737,216 bytes free** after its cleanup; the runner independently enforces the 2 GiB floor before setup and each block.

### Coordinated measured launch review

1. The coordinating agent reviews the seed-only deadline change and exact hashes below under **Mark’s existing execute authorization**. No additional permission request to Mark is required.
2. Verify disk remains above 2 GiB and reserve the quiet window. The 48-save runtime preflight already passed; no repeated smoke or measured run is needed merely to seek a better result. Full-size seed completion and forced-cleanup behavior remain unproven at this point.
3. Release exactly one sealed 1,200-save diagnostic. Preserve both prior failures; collect unchanged original gates plus the additional wall metric, all samples and process/DB traces. The topology limitations above remain; a diagnostic result cannot establish production or handset qualification.

The correction’s preparation-only command was:

```sh
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node packages/database/scripts/benchmarkStaffIntakeSplitDisposable.mjs --prepare-only --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 --out /private/tmp/tenkings-intake-split-preparation-20260916-03
```

For the coordinator-released measured run, replace `--prepare-only` with `--run-approved-split-diagnostic --ack-disposable-local-postgres` and supply a **new** output directory. Application/workload override flags remain rejected.

### SHA256 seals

| File | SHA256 |
| --- | --- |
| New runner | `7a00716b28afd14f206fb0bca971ae59940179f722033c9560bbad59053976f3` |
| Split driver | `064a9018d15ffd3c97bced10001a9c0541ee6d44a2313a83f3fac2f0108e5fb5` |
| Split role | `a708f12e817845806d62bceca4875b85178955c5a072e9bfc7447b8baaffc749` |
| IPC/tracing helper | `a44b60247437c6b333ba36469e3248452ebfb0b60249650cee819fbb628a1a7f` |
| Preregistered JSON | `7660959c8f40a9e81af38743946aa4b3c2f7fc31463f1ab075ca634588119538` |
| Function receipt | `b7bf941148f0d80e55fa6362934ae8e4ed76dd798752a2465f0f6abf074f3dff` |
| Prepared effective protocol | `b6ae398fd4f72490185990d03d64579503d6057912b98d1d493445fcc2a10263` |
