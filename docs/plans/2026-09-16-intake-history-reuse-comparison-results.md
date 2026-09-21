# History-reuse comparison — faster saves, lease gate still fails

Date: 2026-09-16. Read-only analysis of `/private/tmp/tenkings-intake-history-reuse-comparison-20260916-01`. Only this report was written; no new run, profile, database, test, build or application edit occurred. The raw path may resolve to root's immutable archive.

## Result and retained failure

**Invocation-local history reuse reduces save p95 by about 68.5%, but this diagnostic remains FAIL.** All 12 pooled A/B comparisons, all 24 repetition comparisons and all source/admission invariants pass. Candidate loaded-minus-idle lease p95 is **81.648208 − 1.743167 = 79.905041 ms**, exceeding the unchanged **50 ms** margin. The other five candidate headroom comparisons pass, including direct photo wall. No passing comparison overrides this failure or the three preceding failed studies.

A is `882e40a20bac3f3a276e03c1cbe9f823785d42a1`; B is `12e13992cd341eeea96dbe0955cc4dbfba67bc1d`. Their exported runtime difference is only `packages/database/src/cardPlatformV2.ts`. Catalog/V4, contributions and larger images remain off. The frozen driver, roles, IPC, workload, pools, photos, provider tapes and thresholds are unchanged.

| Three-session p95, ms | A idle | B idle | A thumbnail | B thumbnail |
| --- | ---: | ---: | ---: | ---: |
| Lease | 1.902500 | 1.743167 | 84.171750 | 81.648208 |
| Save acknowledgment | 2,185.867666 | 689.775916 | 2,172.773292 | 684.191208 |
| Save transaction | 2,185.517833 | 689.345334 | 2,172.482667 | 683.357167 |
| Photo verification sum | 18.415542 | 0.942501 | 1.886126 | 0.949667 |
| Direct photo wall | 9.252500 | 0.511167 | 1.038250 | 0.505958 |
| Save queue-lock call | 0.226667 | 0.412958 | 0.243208 | 0.348083 |

Save acknowledgment improves **68.4438% idle / 68.5107% loaded**. Baseline also has an approximately 82.27 ms loaded-minus-idle lease increase. This is continuing sensitivity of the shared source/topology, not evidence that history reuse introduced a lease regression.

## Collection checks

Collection completes in **791,814 ms / 13.20 minutes**: **1,200 measured saves plus 120 warmups**. Independent checks confirm all 1,320 raw NDJSON records equal their block samples, unique session/index/warmup keys, four distinct role PIDs per block, 4/3/1 pools and **144 valid clock brackets**. All eight blocks preserve prior journal hashes, fixture hashes, one job per accepted save, rollback and exact-retry guarantees, and deterministic admission assertions.

All four loaded blocks observe the intended first-save worker overlap and a maximum of two workers. There are **582 completed attempts and six intended shutdown cancellations**; all six cancellation spans end after the last save sample. No unexpected provider call occurs. Timed three-lease denial is unobserved; the separate admission proof passes. Each block advances from 1,092 events / 272 jobs to 1,756 / 438. Cleanup reports PostgreSQL stopped, all owned command groups stopped, owned temporary trees removed, no errors or interrupt; root independently checked PID absence. Normal cleanup does not prove forced-signal behavior.

## Remaining lease tails: callback delay after lock ownership

Descriptive analysis retains every measured sample. A slow lease is over 50 ms. Late-loop overlap means more than 20 ms overlaps the interval after a scheduled 10 ms tick. Database evidence below uses observer query brackets wholly inside the cited span; sampled ownership is not a continuous wait-duration measurement.

| Loaded block | Arm | Slow leases / 150 | Queue call over 50 ms | Post-queue over 50 ms |
| --- | --- | ---: | ---: | ---: |
| 04 | A | 21 | 21 | 0 |
| 05 | B | 10 | 9 | 1 |
| 06 | B | 6 | 6 | 0 |
| 07 | A | 25 | 23 | 2 |

- **All 62 slow leases** overlap intake-process loop lateness and the first-history-page SQL gap in another save. None overlaps more than 20 ms of worker, driver or observer loop lateness; none intersects the deliberate first-save barrier.
- **59/62** are observed owning the queue lock in `ClientRead` while their queue-call elapsed span remains open; **61/62** have observed ownership somewhere in the lease transaction. Only **28/62** have any sampled advisory wait. Short genuine waits exist, but the approximately 80 ms elapsed calls cannot be treated as 80 ms worker-held lock waits.
- For candidate B, **15/16** slow leases already own the queue lock during the queue-call span; first sampled ownership occurs within **13.970375 ms maximum**. All 16 also overlap a concurrent save observed in `idle in transaction / ClientRead` after a journal query. The remaining candidate tail has a 2.463167 ms queue call and a **78.883125 ms fourth SQL call**, demonstrating that the delayed callback can occur after lock acquisition too.
- Loaded intake loop histogram p95 is **82.90–83.03 ms in A / 73.86–74.58 ms in B**; separate worker/driver p95 is about 11.08–11.09 ms and observer p95 11.59–11.60 ms. Worker queue-call p95 is **81.209375 ms**, whereas post-queue callback through transaction completion p95 is **3.685708 ms**. Workers can be the waiters behind an intake-owned lock.

Candidate tails fall from **53/300 in the preceding split study to 16/300 here**; the new baseline has 46/300 versus the preceding baseline's 45/300. These are descriptive cross-study counts, not a pooled gate. B block 05 has ten tails and lease p95 **83.149708 ms**; block 06 has six tails and p95 **2.639458 ms**. The combined 16/300 remains just over 5%, so the frozen nearest-rank p95 still lands in the slow group. No sample is excluded.

### Reproducible dynamic span

In B block 06, intake OS PID 1590:

- Lease `intake:186`, session 0 / sample 15, backend 1593, has **84.108541 ms transaction span** and **82.275791 ms queue-call span** (`121219191467250` → `121219273743041`, monotonic ns). It is already observed owning the queue lock in `ClientRead` by `121219199683166`, **8.215916 ms** after query start.
- Concurrent save `intake:184`, backend 1595, finishes SQL call 7 at `121219204376041` and starts call 8 at `121219273647750`: **69.271709 ms between calls**. The lease callback completes only **0.095291 ms** after that gap ends. The intake tick gap is **74.411792 ms**.
- An observer bracket at `121219232874083` → `121219233287250` shows the lease owning the queue lock in `ClientRead`, the save in journal `ClientRead`, both worker backends waiting on the queue advisory lock, and another intake save waiting on a different advisory lock.

This establishes real client-side callback delay alongside real database waits. It does not assign every millisecond to a CPU function or turn sampled rows into exact PostgreSQL service time.

## What changed, and what remains synchronous

Every one of the **660 A saves has 75 traced source SQL calls; every one of the 660 B saves has 51**. This matches five full-history reads becoming one: four six-query page-read sequences are removed, while cheap continuity checks, persisted readbacks, all locks and all nine replay calls remain. Source inspection and observed query counts support the intended optimization; no post-change CPU profile was collected.

The longest remaining common source interval is unchanged: **call 7 → 8** is the first history-page SELECT returning through `rows.map(verifyWorkflowRowV2)` and `WorkflowPageInputV2.parse`, before the next page's watermark query. Across all saves including warmups, its median/p95 is **68.851/72.129 ms in A** and **68.674/71.073 ms in B**. All candidate slow leases intersect this interval. The four analogous repeated first-page gaps in A disappear in B, but the initial gap does not shrink.

Other retained B intervals are also substantial:

| Source interval, 660 saves including warmups | Median, ms | p95, ms |
| --- | ---: | ---: |
| SQL 10 → 11: second-page verification, initial replay and command construction | 40.172 | 58.374 |
| SQL 15 → 16: receipt before/after replay and event construction | 34.819 | 40.251 |
| SQL 24 → 25: cost before/after replay and event construction | 34.761 | 40.168 |
| SQL 33 → 34: description before/after replay and event construction | 34.778 | 40.529 |
| SQL 47 → 48: price before/after replay and event construction | 34.809 | 40.274 |

These are dynamic inter-query wall spans mapped to frozen source order, not newly measured individual function spans. Do not sum overlapping transaction waits or infer CPU self-time from them.

The [earlier CPU/GC profile](2026-09-16-intake-source-profile-results.md) directly established verification/canonicalization/schema work and replay as major costs, with individual GC pauses only about 3 ms. Its exact percentages belong to the pre-fix refs and cannot be reused as B's current CPU shares. The fixture still starts with a **1,728-unit bulk receipt** (`2000 − 256 − 16`) and its cost, description and price events. These large events sit in the first page and are revisited by each replay. Existing captures do not separate their per-event cost from the other first-page rows or final page parse; blaming the bulk event alone would exceed the evidence.

## Smallest next source experiment — not implemented or launched

**Reducing only the internal `readWorkflowHistoryV2` page limit from 1,000 to 250 is supported as a narrow experiment; another CPU profile is not a prerequisite.** Keep the public exporter's maximum, schema, byte bounds and wire shape unchanged. Smaller internally verified pages introduce natural query awaits between batches without artificial sleeps or a trusted cache. They add watermark/coverage queries, so throughput and callback responsiveness must both be measured; a pass is not predicted.

Existing explicit profile spans support a substantial batch-size component: each pre-fix arm has 30 full 1,000-row pages with monotonic-duration medians **66.149 / 66.682 ms**, compared with 30 partial 92–115-row pages with medians **5.269 / 5.245 ms**. Median time per row is approximately **0.0662 / 0.0667 ms full** versus **0.0502 / 0.0502 ms partial**. This is descriptive, not a controlled page-size comparison: every full page also contains the bulk events, the small pages have different contents, and warm/cache effects can differ. It supports testing a smaller batch but neither establishes bulk-event dominance nor rules out its contribution. Chunking does not bound a single permitted 2 MiB event, final page parsing or a whole replay.

Scope the proposed source change to the internal page-limit argument in `packages/database/src/inventoryWorkflowV2Read.ts`, after root/Atlas review. Retain fixed snapshot/cursor coverage, every row's canonical/hash/schema verification, full page parsing, invocation-private history, reentrant continuity checks, both locks, persisted readback, exact retries, all nine replays, backdated checks and atomic research synchronization. Focus qualification on multi-page history completeness, corruption/sequence failures at page boundaries, unchanged public export behavior and existing writer regressions. A subsequent changed-source comparison needs its own seal; all four performance failures stay on record.

If the reduced batch still exposes an indivisible stall, per-event size/timing plus separate final page-parse/replay spans is the next discriminating capture. Do not skip validation, remove replays, add a cross-request trusted cache, throttle workers, change the bulk fixture or alter thresholds to obtain a pass. Another unchanged full matrix adds little evidence.

**Deployment limit:** synthetic identify leases still share the workspace/intake process. The production receipt gives identify a different function identity; actual instance placement, concurrent routing and CPU allocation remain unqualified. This fixture demonstrates a real synchronous source cost, but the resulting lease tail is not proof of deployed identify latency or physical-camera responsiveness. Any separate-identify topology study needs its own reviewed protocol and unchanged total connection budget; it cannot erase this failure.

## Evidence seals

| Artifact | SHA-256 |
| --- | --- |
| `summary.json` | `51c3fd450fc130b1fbf349d9d4c32a7091ceb6159c8aa0ef2ad793f3c65dc9d5` |
| `protocol.json` | `efe4396cb681d3a60a1e589d84a305343e743bf02ab0931a02d93cf8cb6829b1` |
| `cleanup.json` | `8ec0a0a92107a5b00533a4758b906e8d61b83bd065968ac64929fdd6e3b0b757` |
| B block 05 | `ff25ecd1eca7d59ba1aa827e7946255505a44d1426d885f4c92dfc1520208930` |
| B block 06 | `f51c5553eafdb6290f6618d036fdd503387786f1b5b0f8c555c0750218565cef` |

The [sealed readiness](2026-09-16-intake-history-reuse-comparison-readiness.md) records source/client/harness hashes; the [preceding split failure](2026-09-16-intake-split-process-results.md) remains preserved. This local UTF8 PostgreSQL 17.9 source/DB subset does not qualify the full one/three-session timeout/429 matrix, real providers, catalog/V4, larger images, physical phones/uploads/recognition or independent all-card accuracy. `release_pass` remains false.
