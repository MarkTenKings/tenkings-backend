# Split-process intake diagnostic — FAIL retained

Date: 2026-09-16. Independent read-only review of `/private/tmp/tenkings-intake-split-diagnostic-20260916-01` and its `.log`. Only this findings document was written. No rerun, gate change, database, build, test or application change was performed during this review.

## Verdict and integrity

**The diagnostic fails the candidate loaded-versus-idle lease gate.** Collection completed in **1,048,122 ms / 17.47 minutes**, with **1,200 measured saves and 120 warmups**. All 12 pooled A/B metric/cell comparisons and all 24 individual repetition comparisons pass. Five of six candidate headroom comparisons pass; direct photo-wall comparisons pass. These passing comparisons do not override the failed headroom gate or either earlier failed study.

| Three-session metric | A idle p95 | A thumbnail p95 | B idle p95 | B thumbnail p95 |
| --- | ---: | ---: | ---: | ---: |
| Intake lease, ms | 1.823334 | 80.957458 | 1.789250 | 81.109583 |
| Photo verification sum, ms | 60.575167 | 61.697583 | 61.047126 | 61.100958 |
| Combined photo wall, ms | 30.318000 | 30.892708 | 30.561625 | 30.579041 |
| Save acknowledgment, ms | 2100.971625 | 2078.037042 | 2086.538042 | 2081.900625 |

B's lease increase is **79.320333 ms**, exceeding the frozen **50 ms** margin. A has essentially the same descriptive increase, **79.134124 ms**. The loaded A/B lease p95 difference is only **0.152125 ms**. This identifies a shared workload/topology problem, not evidence that the candidate introduced the lease implementation regression.

All eight blocks pass source invariants and untimed admission assertions. Raw NDJSON equals the block reports, with all expected session/index pairs present. Each block has four distinct role PIDs, 4/3/1 configured DB pools and 18 valid monotonic clock brackets, 144 total. Each loaded block observes the controlled worker/save lock overlap and a maximum of two workers. There are **796 completed research attempts and eight intended shutdown cancellations**, all cancellations finishing after measurement end. No unexpected provider call occurred. Timed third-lease denial remains unobserved; the separate deterministic admission assertions establish that clause.

Every block starts with 1,092 events / 272 jobs and finishes with 1,756 events / 438 jobs, consistent with 165 saves plus one retry-proof job. The full seed completed approximately **101.88 seconds after the migration receipt**, within the corrected 180-second seed deadline. The log reports owned cluster/source-tree removal; root independently confirmed recorded PIDs were absent. Neither this normal cleanup nor the successful seed proves forced-termination cleanup.

## What the slow leases actually wait for

Descriptive slices retain every measured sample: slow lease means over 50 ms; late-loop overlap means more than 20 ms beyond the scheduled 10 ms tick. PostgreSQL observations are discrete samples, not continuous lock-duration measurements.

| Thumbnail block | Arm | Leases over 50 ms / 150 | Queue-call elapsed over 50 ms | Post-queue elapsed over 50 ms |
| --- | --- | ---: | ---: | ---: |
| 04 | A | 20 | 19 | 1 |
| 05 | B | 24 | 22 | 2 |
| 06 | B | 29 | 29 | 0 |
| 07 | A | 25 | 25 | 0 |

There are **98 slow loaded leases: A 45, B 53**; idle has none. All 98 overlap more than 20 ms of **intake-process** loop lateness. None overlap that much lateness in the separate worker, driver or observer process. Intake loop p95 is **80.81–81.59 ms**, including idle blocks; worker/driver p95 is approximately **11.08–12.08 ms** and observer p95 **11.58–12.53 ms**. None of the 98 slow leases intersects the deliberate first-save barrier; their sample indices are at least one.

Although 95 leases have queue-call elapsed spans over 50 ms, **95 are independently observed already owning the queue lock and waiting in `ClientRead` within that queue-call span**. First observed ownership occurs within **15.49 ms at p95**, maximum **17.42 ms**, of query start. Thus that observed bound is far shorter than their roughly 80 ms application elapsed time. The median span between first and last such ownership samples is **60.06 ms**. Across the entire lease transaction, 97/98 are observed owning the lock; only 38/98 have any sampled advisory wait. Short genuine waits can occur before acquisition and sampling can miss them, but these traces do not support interpreting the whole queue-call duration as a worker-held database wait.

The worker's post-queue-callback-to-transaction-end p95 is **3.33 ms**. Its queue-call p95 is **107.83 ms**, consistent with workers themselves sometimes waiting for intake-owned locks. The controlled first-save overlap produces larger terminal spans and must not be mistaken for ordinary terminal-write cost.

## Concrete source hot path

**All 98 slow leases overlap a greater-than-20-ms interval between SQL calls in another intake save.** In 95, independent observations also show that save in `idle in transaction / ClientRead` after a journal query. This places the dominant observed delay on the intake client side, after PostgreSQL has returned data or granted the lock.

One reproducible example is B block 06:

- Lease `intake:76`, session 1 / sample 3, backend PID 91090: **79.405375 ms transaction span**, **78.047500 ms queue-call span**. First sampled ownership is only **7.320728 ms** after queue-call start.
- Concurrent save `intake:72`, session 0 / sample 2, backend PID 91094: its seventh source SQL call finishes at monotonic `115413573418458`; its eighth starts at `115413639735041`, a **66.316583 ms gap**.
- During that gap, PostgreSQL repeatedly shows the lease already owning the queue lock in `ClientRead`, the save waiting on its client after a journal read, and both worker backends waiting for the queue lock. The lease's queue-call callback finishes at `115413639854500`, immediately after that source gap ends.

The frozen source order maps that seventh query to the first history-page SELECT in `exportInventoryWorkflowPageV2`. Between it and the next page query, the code synchronously maps rows through `verifyWorkflowRowV2` and parses the complete page with `WorkflowPageInputV2.parse`. This includes canonicalization, hashing, schema parsing and integrity checks. `readWorkflowHistoryV2` performs these page reads, and `recordStaffInventoryV2` reads/replays history initially and calls the workflow writer for each of four component events. This fixture therefore reads/verifies the history **five times per save**, with further before/after state replays inside the component writer.

Relevant frozen paths:

- `packages/database/src/inventoryWorkflowV2Read.ts`: `verifyWorkflowRowV2`, `readWorkflowHistoryV2`, `exportInventoryWorkflowPageV2`.
- `packages/database/src/cardPlatformV2.ts`: `recordStaffInventoryV2`, `recordInventoryWorkflowEventV2`.
- `packages/database/src/staffInventoryV2.ts`: receipt, cost, description and price command sequence.

These files, `inventoryWorkflowV2State.ts` and `staffInventoryResearchV2.ts` are all byte-identical between the frozen A/B commits. This is concrete evidence for a shared synchronous journal-verification/replay hot path. It does **not** attribute every millisecond to a particular function: a CPU/GC profile was not collected, and source parsing, Prisma result handling, garbage collection and host scheduling can contribute to the observed client-side gaps.

## Harness versus deployed behavior

Moving the worker and external driver to separate processes did not eliminate the intake stall. Their responsive loops and the direct source inter-query spans argue against shared worker/driver callback work as the dominant remaining cause. IPC round trips are recorded separately and excluded from the original server-side lease metric; large trace serialization happens after measurement. The added SQL proxies, timestamps and PID queries remain unquantified overhead, so this is not an uninstrumented production latency estimate.

**The synthetic identify-capacity lease still runs in the same process as workspace saves.** The deployment receipt gives identify a different function identity from workspace/photo. The remaining co-location exposes the lease to source journal work in a way not established for deployed identify requests. Real function-instance routing, concurrency and CPU allocation remain unknown. The source hot path is real in this workload; the observed lease symptom cannot automatically be called a production identify regression. The reported photo sum of roughly 61 ms versus direct wall time around 31 ms also confirms that summing parallel callbacks amplifies their shared delay; neither metric was replaced or dropped.

## Narrow next step — not launched

Perform **one bounded source-profile investigation**, not a full matrix: the same 2,000-unit disposable seed, at most 12 saves, and CPU/GC plus explicit verification/page-parse/replay spans. Target the source reader/writer above. This should distinguish repeated verification, replay, Prisma handling and allocation costs before any runtime change is proposed. If repeated history work dominates, design transaction-scoped reuse of already verified history/state while preserving journal locks, atomic four-event writes, exact retries, integrity checks, backdated causal replay and one research job per accepted card. Do not bypass verification or relax the admission gate.

Before any future result is interpreted as deployed identify responsiveness, separately review a model that places identify/lease work outside the workspace process and explicitly partitions the unchanged connection budget. That is a topology correction requiring its own preregistration, not a way to erase this failure. No worker throttling, lock removal, repeated run-until-pass, or production release follows from these results.

## Evidence seals and remaining scope

Frozen A: `60572cec895ad63d4ab826cd366f6475b04e725a`; B: `31b8653559d8553208de8591f2d30c419642953a`. Executed code and preregistration hashes match the sealed preparation. The evidence directory contains the exact code, source ledgers, raw samples, per-process spans and independent PostgreSQL observations.

- `summary.json` SHA256: `f172d9a4359c622ddbd1525a421d82a766c80f7aa13d6c156e44b8e4eac7f0f2`.
- `protocol.json` SHA256: `b6ae398fd4f72490185990d03d64579503d6057912b98d1d493445fcc2a10263`.
- Frozen A/B `inventoryWorkflowV2Read.ts` SHA256: `532a1b4e14cf8bcc3e433dc4149283c4b1fc7990f42554e910f3ebd60a3f8b1f`.

This remains a UTF8 PostgreSQL 17.9 local source/DB subset with synthetic providers, not the full one/three-session timeout/429 matrix. It does not qualify later catalog/V4 integration, larger images, real providers, physical-camera/upload/recognition behavior, iPhone concurrency or independent all-card accuracy. Both earlier failures and this failed diagnostic remain in force.
