# Bounded intake source profile — completed; attribution only

Completed2026-09-16: one sealed run finished12profiled saves plus273fixture setup calls in110463ms. Source/save invariants and normal cleanup pass. See [attribution, limits and next implementation](2026-09-16-intake-source-profile-results.md). The preparation and launch requirements below are retained as historical evidence; this profile does not change any prior failed timing gate.

## Decision and scope

Prepare one CPU/GC investigation of **12 additional actual saves**: A then B, six saves per arm, three concurrent sessions with two sequential saves each. This follows the [split-process findings](2026-09-16-intake-split-process-results.md), where synchronous intake work delayed callbacks in both arms. It tests the specific hypothesis that repeated verified-history reads and replay dominate that work. It does not rerun a benchmark or change any prior failure, threshold, application source, or release decision.

Frozen refs remain A `60572cec895ad63d4ab826cd366f6475b04e725a` and B `31b8653559d8553208de8591f2d30c419642953a`. All three instrumented source files are byte-identical between those refs. A/B captures establish repeatability of source attribution; six saves per arm cannot establish superiority or a passing latency gate. `release_pass` is always false.

New files only:

- [Disposable runner](../../packages/database/scripts/profileStaffIntakeSourceDisposable.mjs)
- [Profile child](../../frontend/nextjs-app/scripts/profile-staff-intake-source.ts)
- [Preregistered protocol](2026-09-16-intake-source-profile-protocol.json)
- This readiness record.

## Exact work and probes

The unchanged seed harness constructs the frozen 2,000-unit fixture once: one 1,728-unit receipt plus 272 individual receipts, **273 setup calls to the sole inventory writer**, and 16 original claim/fail pairs creating terminal research history. Setup is outside CPU capture. Each arm clones the same 1,092-event/272-job state. There are no warmups, extra retry/admission saves, worker/provider load, HTTP routes, synthetic identify leases, metadata verification, or camera work in the profile. Each arm uses one intake process with pool capacity four; the administrative connection is closed before capture.

AST-positioned, insertion-only probes operate on owned source snapshots. Original source statements are retained in order. No canonical application file changes. The preparation receipt retains exact original and instrumented bytes for review.

| Source boundary | Capture |
| --- | --- |
| `recordStaffInventoryV2` | Whole writer span, correlated to save |
| `recordInventoryWorkflowEventV2` | Component span and event kind |
| `readWorkflowHistoryV2` | Inclusive read span, including SQL |
| `exportInventoryWorkflowPageV2` | Synchronous span beginning before `rows.map`, ending after complete `WorkflowPageInputV2.parse`; row count/cursor |
| `verifyWorkflowRowV2` | Counter only, avoiding per-row timing spans |
| `replayWorkflowEventsV2` | Synchronous replay span and event count |
| Actual raw SQL awaits | Callback wall span and query class; no SQL payload export |

Each arm produces a V8 CPU profile at 1 ms sampling, GC observer entries, 10 ms loop-gap samples, monotonic/performance-time anchors, source spans, and actual transaction outcomes. Buffers are written after capture. Interpret nested inclusive spans separately; do not add them together. CPU samples must distinguish schema parsing, canonicalization/hashing, row verification, replay, Prisma, GC, and probe costs. The probes, SQL proxy, AsyncLocalStorage and profiler perturb execution; overhead is unquantified and GC is not forced.

Per arm, fail closed unless six saves commit, four events and one job are added per save, prior event IDs/content hashes remain identical, each saved unit has exactly one research job, and source span/call invariants hold. Existing studies retain their broader retry/admission proofs; this small profile does not claim to repeat them.

On the first save rejection or outcome assertion failure, a shared flag prevents every session from starting another transaction. Already-started transactions settle before capture closes; partial samples are retained and the arm fails. Skipped saves are never replaced, and B is not started after an A failure.

## Bounds, disk and cleanup

Global cap: **10 minutes**, including a 30-second cleanup reserve; new work stops at 9.5 minutes. Seed cap remains 180 seconds. Launch requires **2,415,919,104 available bytes** (2 GiB plus 256 MiB reserve). The operational floor remains **2,147,483,648 bytes**, checked at stages and every second by the separate runner. A floor breach aborts owned work. Polling cannot promise zero overshoot between samples; the launch reserve accounts for uncertainty.

Source trees total 10,292,330 logical bytes across 774 files. Each temporary archive is removed immediately after sealing its ledger. No client/dependency copies or installs; only one cloned DB exists at a time. Using the prior approximately 109 MB setup footprint, estimated peak is **120–140 MiB**, not a guaranteed upper bound. The latest preparation check observed 2,422,513,664 available bytes, just 6,594,560 bytes above the launch requirement; the runner must recheck immediately before setup. Do not infer later headroom from this snapshot.

The runner directly supervises the already-installed `initdb` and `postgres` binaries in owned process groups. PostgreSQL binds only `127.0.0.1`; credentials are generated for that cluster, and its mode-0600 password file is removed after initialization. Children receive a narrow environment; existing `HOME` is preserved unchanged. External fetch fails closed. No production credentials, provider traffic, new dependencies, or application migrations are involved; migrations apply only inside this disposable cluster.

On success/failure/deadline the runner terminates its child groups, interrupts its PostgreSQL group, escalates only those owned processes if needed, and removes owned trees/data after confirmed shutdown. `SIGINT` and `SIGTERM` invoke the same owned abort and `finally` cleanup; unresponsive command groups receive `SIGKILL` after five seconds. The runner records the incoming signal and does not call `process.exit` before cleanup. A failed stop retains the directory and records recovery details. Disk, process identity, migrations, tool hashes, incomplete-state and cleanup receipts remain in the output. Untrappable `SIGKILL` and OS/filesystem failures can prevent a clean shutdown; inspect the receipt and recorded PIDs rather than assuming cleanup from exit status.

## Preparation evidence and seals

Current preparation-only receipt: `/private/tmp/tenkings-intake-source-profile-preparation-20260916-02`. Receipt `...-01` remains unchanged. Revision 02 addresses the two static-review blockers: signal-driven cleanup for detached groups and shared stop-on-save-failure admission. It changes neither source overlays, workload/count limits, refs, metrics nor prior gates.

Observed for revision 02: zero profile saves, no PostgreSQL startup, no exported source trees. Runner syntax passed; scoped child ESLint passed; TypeScript checked the child and imported source with **zero diagnostics**, no emit. Preparation verified the frozen client/seed/source hashes and transpiled all six instrumented snapshots without syntax errors. This is static preparation, not a runtime preflight; live signal/failure injection was not executed.

| Artifact | SHA-256 |
| --- | --- |
| Runner | `253989ea85eeb42fce153ab2775c043aecf755250d2d89e1b9b8f04205381728` |
| Child | `1cecefcad5112b44c40698f947a04a0cff8ee8d462c1314356423d62522c0f21` |
| Preregistration | `f62a8400ae9deaa7969c855a3c6a9b1667ccb0091b30c160f0e7d41378e262bf` |
| Effective protocol receipt | `59244f77a6d3959be71f00255188380a9fe6abfaaa71dbc08a076c4e71dcc3cb` |
| Frozen Prisma client ledger | `e1a91c8dee8d08a561083f4976312f6d3b0faedaf3842489cda739b769db6345` |
| Original seed child | `76a55776ac436a5460d93353fac4efed70a6bfd8d3fad3116063fc06f701050c` |
| Instrumented `cardPlatformV2.ts`, either arm | `0d412fcc163012a9de3b7df49ea5cf77de941ea549c3a4a8a6a94dc8d997c9a1` |
| Instrumented `inventoryWorkflowV2Read.ts`, either arm | `2447fd97de85a76739d6afc5ed6e06f6908d80da947fa044c8c4f1e29be335bf` |
| Instrumented `inventoryWorkflowV2State.ts`, either arm | `33ddde9894e91518b9eb9467d7302283a8960bc4fc8226091230db7cdd4828ae` |

## Coordinated launch, not yet authorized for this prepared run

The coordinating agent must review these hashes, inspect the insertion-only overlays, verify fresh disk headroom, and release this one run under Mark's existing execution authorization. This is agent coordination, **not another permission request to Mark**. Do not run until that release. Use a fresh output path; never overwrite a receipt.

```sh
cd /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node \
  packages/database/scripts/profileStaffIntakeSourceDisposable.mjs \
  --run-coordinated-profile --ack-disposable-local-postgres \
  --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 \
  --out /private/tmp/tenkings-intake-source-profile-20260916-01
```

Review source attribution and GC/loop overlap before proposing an optimization. Any later writer change requires coordinating-agent/Atlas review of lock ordering, atomic component events, journal verification, backdated replay, exact retries and one-job semantics. No full matrix or source-writer change is part of this profile.
