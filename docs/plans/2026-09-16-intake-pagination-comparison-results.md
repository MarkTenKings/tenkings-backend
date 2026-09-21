# Internal pagination comparison — diagnostic timing PASS

Date: 2026-09-16. Read-only verification of `/private/tmp/tenkings-intake-pagination-comparison-20260916-01`; its path may resolve to the immutable archive. Only this report was written. No run, profile, test, database or application change occurred during review.

## Verdict and scope

**This single frozen diagnostic passes every timing and integrity gate. It is not release qualification.** Collection completed in **422,891 ms / 7.05 minutes**, with **1,200 measured saves and 120 warmups**. Raw-sample recalculation reproduces all **12 pooled A/B comparisons, 24 repetition comparisons and six candidate headroom checks**. `legacy_timing_pass`, `photo_wall_pass` and `diagnostic_timing_pass` are true; the intentionally separate `pass` flag remains **false**, and `complete_matrix` remains false.

A is `12e13992cd341eeea96dbe0955cc4dbfba67bc1d`; B is `80e75b1e26753117b5a0bd1feefa0ee181695454`. Both include invocation-local history reuse. Their only exported runtime difference is the internal history page limit **1,000 → 250** in `inventoryWorkflowV2Read.ts`. Public export maximum/shape, validation, byte bounds, writer locks and replay code are unchanged.

| Three-session p95, ms | A idle | B idle | A thumbnail | B thumbnail |
| --- | ---: | ---: | ---: | ---: |
| Lease | 1.826542 | 1.668792 | 3.383083 | 36.499584 |
| Save acknowledgment | 667.065167 | 671.758875 | 653.933209 | 664.416708 |
| Save transaction | 666.664875 | 671.425625 | 653.665250 | 664.107250 |
| Photo verification sum | 1.072000 | 0.992876 | 0.913792 | 0.962292 |
| Direct photo wall | 0.592167 | 0.554375 | 0.517500 | 0.517542 |
| Save queue-lock call | 0.269958 | 0.335167 | 0.391333 | 0.421167 |

B's loaded-minus-idle lease increase is **34.830792 ms**, below the unchanged **50 ms** allowance. Its save acknowledgment p95 is **4.693708 ms higher idle / 10.483499 ms higher loaded**, within the original A-based margins of 66.706517 / 65.393321 ms. Both parallel-photo sum and direct wall metrics remain included; neither replaced the other.

## Variation matters

**B is not uniformly faster than A.** Loaded lease p95 by repetition is:

| Repetition | A, ms | B, ms | Frozen comparison |
| --- | ---: | ---: | --- |
| 1 | 79.083083 | 35.175000 | Pass |
| 2 | 2.580209 | 36.974167 | Pass |

A has ten leases over 50 ms in its first loaded block and two in its second; B has zero and one. Thus A's pooled p95 is only 3.383083 ms despite one slow repetition. B's pooled lease p95 is higher than A's by 33.116501 ms, still within the registered margin. All samples remain included. No cross-study pooling, uniform superiority claim, threshold change or rerun-until-pass inference is warranted.

Loaded intake event-loop histogram p95 is **73.79–80.02 ms in A / 39.65–39.78 ms in B**, consistent with shorter synchronous batches. This is an observation from the existing instrumentation, not a CPU profile or a bound on individual large events or replays. Additional page queries may trade responsiveness against throughput; the save comparison above reports that tradeoff within this workload.

## Independent collection and integrity checks

- All **1,320 NDJSON sample records** equal the block reports, with complete unique session/index/warmup keys: three sessions, five warmups and 50 measured saves per session in each of eight idle/thumbnail ABBA blocks.
- Every block has four distinct role PIDs, the frozen **4/3/1 DB pools**, matching source refs and all **144 clock probes bracketed** by driver timestamps. Executed runner, driver, role, IPC, preregistration, effective protocol, client ledger and source-compatibility receipt are byte-identical to sealed preparation 01.
- All eight blocks report passing hard gates, source invariants and deterministic admission checks: prior journal/fixture hashes preserved, one job per accepted save, rollback without an event/job, and exact retry without duplication. Each advances from **1,092 events / 272 jobs to 1,756 / 438**.
- All four loaded blocks observe the required actual worker/save overlap and a maximum of two workers. There are **318 completed attempts and eight shutdown cancellations**, all cancellation spans ending after the last save sample. Unexpected provider calls are zero. Timed three-lease denial remains unobserved; the independent untimed admission assertions pass.
- The source audit retains the same frozen client and 96-migration schema, explicitly pinned workspace imports and disabled catalog/V4/contribution flags. Full-resolution images remain false; fixture size, synthetic provider tapes/delays, photos and all six metric boundaries are unchanged.
- Cleanup reports PostgreSQL and owned command groups stopped, temporary trees removed, no error, no interrupt and no retained temporary root. Root separately confirmed runner PID **4783** and PostgreSQL PID **4959** absent and the owned directory removed. Normal completion does not establish forced-signal cleanup behavior.

## Evidence and limits

| Artifact | SHA-256 |
| --- | --- |
| `summary.json` | `700321b7eb5b08c92feea6c243398cd552e126b30d4316dcfd5e328960eac032` |
| `protocol.json` | `311c257e4cb5834adf4bb246592256c21ef58e28fc36e0bb7883243648847d0f` |
| `cleanup.json` | `84b36a78d21961f88d1711a1936996ba764ef9a59aa2c4cf0ced687f082b8a83` |
| `migration-ledger.json` | `eebea16dfdd1cb390a797f901a1c293b25615cbfdc00caca8b79a7b1da263219` |

The [sealed readiness](2026-09-16-intake-pagination-comparison-readiness.md) retains all source/client/harness seals. **All four earlier failed studies remain preserved:** original source benchmark, scheduling diagnostic, split-process diagnostic and [history-reuse comparison](2026-09-16-intake-history-reuse-comparison-results.md). This passing changed-source subset does not rewrite their results.

The synthetic identify lease still shares the workspace/intake process, whereas the deployment receipt gives identify a separate function identity. Actual Vercel instance placement, routing, CPU allocation and production latency remain unqualified. This local PostgreSQL source/DB result also lacks the full one/three-session timeout/429 matrix, real-provider variance, physical-phone camera/upload/recognition evidence and independent all-card accuracy. Catalog/V4 and larger images were disabled. Preserve these limits before any later release decision; no additional experiment is launched by this report.
