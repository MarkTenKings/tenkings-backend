# Split-process intake diagnostic — prepared, not run

Prepared 2026-09-16. **No database, runtime preflight or measured benchmark was launched.** The two previous failed studies, their thresholds, application refs and reports are unchanged. This preparation adds test/protocol files only.

## Implementation and frozen workload

- `packages/database/scripts/benchmarkStaffIntakeSplitDisposable.mjs`: new disposable runner; preparation-only sealing; immutable source export only on later execution; original frozen Prisma client required; UTF8 PostgreSQL; unchanged second-migration ledger check; 30-minute cap and owned-process cleanup. Requires **2 GiB free** before setup and every block. Administrative DB connection is closed during seed/blocks. `HOME` is passed through unchanged only when present; task temporary paths use `TMPDIR` and explicit owned directories.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-driver.ts`: external three-session driver, with no Prisma, Sharp or application imports. Spawns separate intake, worker and observer processes and records IPC round trips separately from existing server metrics.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-role.ts`: actual source workspace POST/sole writer, actual research engine/claims/terminal writers, original synthetic response tapes, exact retry/rollback/history checks and third-lease admission proof. Pools remain **4 intake + 3 worker + 1 observer**, two workers. Failure cleanup retains partial role traces when possible; forced process termination can still lose buffered traces, which must make a run incomplete.
- `frontend/nextjs-app/scripts/benchmark-staff-intake-split-ipc.ts`: bounded IPC, per-process monotonic spans and event-loop tracing.
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

## Verification and launch review

Observed preparation checks: new runner Node syntax check passed; all three TypeScript files passed scoped ESLint; TypeScript checked those files and their imported dependency graph with no emit. Preparation-only sealing succeeded with **zero saves, no DB start and no source-tree export**. Exact role IPC, forced-cleanup behavior, frozen A/B import resolution and real DB assertions remain **runtime-unverified** until the coordinating agent reviews the sealed protocol/hashes and releases the small preflight under Mark's existing execute authorization.

Prepared receipt directory: `/private/tmp/tenkings-intake-split-preparation-20260916-02`. This new receipt supersedes the preparation seal only; the original `...-01` receipt is unchanged. It contains only small code/protocol/hash receipts; no dependency/client/tree copies were made. At preparation, only approximately 788 MiB was free; no DB execution is permitted at that capacity.

Review before any execution:

1. Review these exact hashes and the identify/instance-placement approximation. Decide whether this bounded separation experiment answers the intended mechanism question; it cannot qualify deployed topology by itself.
2. Free at least 2 GiB, then have the coordinating agent release **preflight only** after protocol/hash review under Mark's existing execute authorization. The preflight is 48 tiny-fixture saves and always nonqualifying; verify four distinct process IDs, clock brackets, role pools, actual worker/admission/barrier paths, complete samples and cleanup before coordinating a measured quiet window.
3. If preflight passes, seal any necessary harness correction under new hashes before the coordinating agent releases the single 1,200-save diagnostic into a quiet window. Preserve both previous failures. No repeated run-until-pass, new runtime throttle, or release claim follows automatically.

The preparation command used was:

```sh
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node packages/database/scripts/benchmarkStaffIntakeSplitDisposable.mjs --prepare-only --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 --out /private/tmp/tenkings-intake-split-preparation-20260916-02
```

Later modes, **not launched**: replace `--prepare-only` with `--preflight --ack-disposable-local-postgres` for the coordinator-reviewed smoke; use `--run-approved-split-diagnostic --ack-disposable-local-postgres` only after coordinating-agent protocol/hash review and quiet-window release under Mark's existing execute authorization. No additional permission request to Mark is required. Always supply a new output directory. Application/workload override flags are rejected.

### SHA256 seals

| File | SHA256 |
| --- | --- |
| New runner | `7a00716b28afd14f206fb0bca971ae59940179f722033c9560bbad59053976f3` |
| Split driver | `064a9018d15ffd3c97bced10001a9c0541ee6d44a2313a83f3fac2f0108e5fb5` |
| Split role | `a708f12e817845806d62bceca4875b85178955c5a072e9bfc7447b8baaffc749` |
| IPC/tracing helper | `08703701e51fd70f2a3e25ade607d975665057405739a7b0b30a4320335ea4a7` |
| Preregistered JSON | `b7038e9ad6ee22fae74f658ff3ea3de8a3bd691d22c3ecc92f6329a4b844019b` |
| Function receipt | `b7bf941148f0d80e55fa6362934ae8e4ed76dd798752a2465f0f6abf074f3dff` |
| Prepared effective protocol | `48e09b114da5e957f3e741ffdbea9e62a401d98061b4f71f8723712cb9972196` |
