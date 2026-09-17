# Intake source profile — repeated history work confirmed

Date: 2026-09-16. Read-only analysis of `/private/tmp/tenkings-intake-source-profile-20260916-01`; only this findings document was written. No application edit, additional run, database, build or test was performed during analysis.

## Finding and decision

**Repeated verified-history reading is the largest measured source cost in both frozen arms.** Page verification/parsing plus replay occupies **84.88% / 85.15%** of A/B capture wall time. The narrow next implementation is to reuse verified history privately within one staff-writer invocation, while preserving every existing lock and before/after replay. Do not remove integrity checks, change canonicalization, introduce shared caches, or claim a passing performance gate.

The profile completed normally in **110,463 ms**, with exactly **12 additional saves**, six per arm. Setup used the disclosed **273 inventory-writer calls plus 16 claim/fail pairs** to construct the same 2,000-unit fixture. A remains `60572cec895ad63d4ab826cd366f6475b04e725a`; B remains `31b8653559d8553208de8591f2d30c419642953a`. Instrumented reader/writer/state source is byte-identical between them. The two captures reproduce a shared source cost; they do not establish an A/B regression or improvement. **All three previous failed studies and their gates remain unchanged; `release_pass` is false.**

## Collection integrity

Executed protocol bytes equal preparation seal 02. Each arm records six unique saves, 624 uniquely identified closed spans, zero open spans, six successful four-event/one-job outcomes, unchanged prior event IDs/content hashes, and one job per new unit. State advances from **1,092 events / 272 jobs to 1,116 / 278**.

Per arm there are **30 history reads, 60 pages, 54 replays and 33,120 row verifications**. Page rows account for 33,096 checks; the remaining 24 are persisted-event readback checks. Six history reads initialize staff commands; the other 24 occur inside the four component writers per save. Those repeated component reads occupy **2,080.385 / 2,087.128 ms** of inclusive read wall time.

The cleanup receipt reports owned PostgreSQL stopped, owned temporary trees removed, no errors and no interrupt. This successful run does not exercise forced interruption. The 117 disk observations have a minimum of **2,502,475,776 bytes**, above the unchanged 2 GiB operational floor. Root owns the independent PID and archive receipt.

## Wall spans: use interval union, not nested sums

Intervals use each child's performance clock, cross-checked against recorded monotonic anchors. Quantiles below use nearest rank; event-loop histogram values are labeled separately. Overlapping intervals are merged before computing occupied capture time. No SQL or asynchronous parent span is added to its descendants.

| Per-arm source measure | A, ms | B, ms |
| --- | ---: | ---: |
| Capture wall | 3,534.209 | 3,587.724 |
| History reads, inclusive union | 2,627.705 | 2,646.844 |
| Synchronous page verification/parsing union | 2,196.693 | 2,215.399 |
| Synchronous replay union | 803.226 | 839.716 |
| Page + replay combined union | 2,999.919 | 3,055.116 |
| Page span p95, all 60 pages | 69.464 | 69.963 |
| Page span maximum | 98.614 | 98.284 |
| Replay span p95, all 54 replays | 17.665 | 22.202 |
| Recorded event-loop histogram p95 | 79.692 | 81.002 |

The 60 pages comprise 30 full 1,000-row pages and 30 smaller pages. Full-page p95 is **72.481 / 73.859 ms**. Every tick gap over 50 ms—**30 in A, 31 in B**—overlaps more than 20 ms of page/replay work. The largest gaps, **106.975 / 107.473 ms**, overlap **98.614 / 98.284 ms** of that synchronous work.

The six whole-writer spans overlap while callers wait for the serialized journal: their sums are **8,637.684 / 8,775.458 ms**, versus unions of **3,532.723 / 3,586.163 ms**. Likewise, the 450 SQL-await spans per arm sum to **5,620.433 / 5,702.284 ms**. Those spans include actual lock waits and callback delivery delay; this profile has no independent PostgreSQL wait observer. They are not database service-time totals and must not be added to synchronous time.

## CPU attribution: self versus descendants

For each V8 sample, assign its recorded `timeDelta` to the sampled leaf frame. Follow the node-parent chain for inclusive attribution, counting each named ancestor once per sample to avoid recursion double-counting. The following disjoint categories select page descendants, then replay descendants, with GC/idle and remaining samples separate.

These are **timeDelta-weighted sample shares**, including idle and GC, not percentages of total process CPU service time. The sample denominators are **3,560.917 / 3,612.542 ms** across **2,869 / 2,912 samples**. Profiler start/stop surrounds the explicit capture, adding approximately 27 / 25 ms. Its timestamp epoch differs from the span clock, so no unsupported absolute sample-to-span alignment is assumed.

| Disjoint sampled work category | A | B |
| --- | ---: | ---: |
| History-page function and descendants | 56.68% | 56.59% |
| Replay function and descendants | 20.65% | 21.48% |
| Garbage collector | 7.61% | 7.19% |
| Idle | 9.34% | 9.14% |
| Other | 5.71% | 5.61% |

Leaf-only attribution provides a different view: `cardInventoryV2.ts` canonical/hash module **36.16% / 36.49%**; Zod engine **14.19% / 13.90%**; workflow schema/refinement module **7.56% / 8.27%**; reader module **5.43% / 5.75%**; replay module **2.80% / 2.34%**; crypto frames **2.80% / 2.80%**; Prisma JavaScript **2.58% / 3.01%**. Remaining leaf samples include GC, idle, regular expressions, anonymous/native frames and probes.

In particular, `canonical` itself has **23.75% / 24.58% self** versus **35.99% / 36.32% inclusive** share; `verifyWorkflowRowV2` has **5.03% / 5.42% self** versus **50.65% / 51.01% inclusive**; replay has only **0.39% / 0.48% function self** versus **20.65% / 21.48% inclusive**. Zod-inclusive share is **29.31% / 29.47%**. These ancestor percentages overlap and are not additive: replay itself parses events, and verification calls schema validation, canonicalization and hashing. The data supports avoiding repeated work, not bypassing any of those checks.

Identified profiler/probe leaf frames account for **0.96% / 0.84%**, but this does not bound instrumentation overhead or native-engine CPU. Process CPU accounting includes other threads, and there is no uninstrumented control.

## GC contributes, but does not explain the long gaps alone

GC observer totals are **237.061 / 231.644 ms** across **510 / 511 entries**. A has 504 minor, three incremental and three major entries; B has 503 minor, four incremental and four major entries. The longest individual observed GC pause is only **3.469 / 3.117 ms**. Approximately **223.459 / 217.278 ms** of GC overlaps page/replay spans. These durations are already inside the wall spans, so they must not be added again. Allocation and collection contribute to the repeated work, but a single large GC pause is not the observed approximately 80–107 ms loop-delay mechanism.

## Follow-on source slice — implemented, qualification pending

After this profile analysis was saved, root separately dispatched the narrow implementation and approved the same-transaction continuity guard below. Only `packages/database/src/cardPlatformV2.ts` changed. This follow-on source change was not part of either profile capture.

Limit the change to the sole-writer implementation in `packages/database/src/cardPlatformV2.ts`:

1. In the fresh-save path of `recordStaffInventoryV2`, retain both advisory locks in their current order. After both locks and existing-request handling, obtain the same fully verified history once with the existing reader. Use it to build commands as today.
2. Keep that history in a private, one-invocation context passed only to an internal component-writing helper. Do not export a trusted-history option, use a transaction-keyed/global cache, or retain context between calls. Consecutive staff/public calls start fresh. Before each component reuses private history, check journal `COUNT/MAX`: noncontiguous history fails integrity; a changed length triggers the unchanged full verifier. Both journal locks are reentrant in one transaction, so this guard preserves freshness when public writes interleave between staff components.
3. Preserve all component lock calls, input/actor/request-hash checks, clocks, sequence derivation, location/exact-card checks, canonical storage and event-size bounds. Preserve **every existing before/after replay**, including the effective-time filter and whole-history replay that protects later facts against backdated commands.
4. Append only the exact inserted event after its persisted readback passes the existing verification and canonical comparison. Retain research synchronization and append before a subsequent component can execute; a failed component aborts the invocation and discards its context. Never publish or reuse partially advanced state.
5. Leave the complete staff retry/original-prefix verification branch and the public single-event/preview API behavior unchanged. Public calls obtain fresh verified history. Leave reader/exporter, schemas, replay implementation, worker, admission, Atlas and every non-inventory operation byte-unchanged.

For this fixture, the structural target is **five full-history reads to one per fresh save**, retaining four persisted-row readbacks, all nine replays and four cheap continuity queries. That would avoid 24 repeated full reads across these six saves; it is not a measured speedup or release prediction. Root and Atlas reviewed these ownership constraints.

The source handoff SHA-256 is `20305bc3152618c3817ef6b06b8a7a32c69c4f12a9497bd0f809640744da05fb`. Byte comparisons confirm the entire prefix preceding `recordInventoryWorkflowEventV2` and suffix beginning at the human-requested research function are unchanged. All seven matching journal advisory-lock call sites and six replay call sites remain. Diff whitespace validation passed; root owns compilation and focused database qualification. No source test, build, deployment or commit was run by this agent.

Before timing any changed source, root's focused real-transaction fixtures should cover corrupt history failing before mutation; component failure rolling back all events/jobs; exact retries after later changes and actor/content conflicts; backdated causal rejection; one research job; unchanged public preview/single-event behavior; and fresh behavior across consecutive/interleaved same-transaction calls. These verify the critical semantics of invocation-local reuse. No test was added or run here.

## Limits and evidence seals

This was a cold, instrumented, local source profile with three callers and no warmups, worker/provider load, HTTP/photo path, identify lease, camera or real Vercel concurrency. It cannot establish production latency, identify responsiveness, independent all-card accuracy or a passing admission gate. It used a synthetic 2,000-unit fixture and later integrated application changes were not part of the frozen refs. A bounded post-change diagnostic requires its own agreed source/protocol; no full matrix or automatic rerun follows from this report.

| Evidence | SHA-256 |
| --- | --- |
| `summary.json` | `653670136cbbd9ac36a0951e317828957281bb35139b188a5f5ae60ed4810d19` |
| `protocol.json` | `59244f77a6d3959be71f00255188380a9fe6abfaaa71dbc08a076c4e71dcc3cb` |
| `profile-A.json` | `f6dcaed5e1f7a832a72d999cdf3c097dce27bec4890fe8dd9d21c21e473fd1dc` |
| `profile-A.json.cpuprofile` | `5bb7a2fec85838ebe3ce8e9fb623eade8b9f010ba057959358939785a4cf8c1e` |
| `profile-B.json` | `6faaf5e88df4141bafbca0464f69a65252f2335579f20fe418423459716fd75f` |
| `profile-B.json.cpuprofile` | `0590e05c31be7619c33fabcf8a5d4c9e9d311e4ff363ebeff7969cf1424eefb3` |
| `cleanup.json` | `8341738871f9bee1e3ccda9a27d51f618410d4fbf20fcce342e06457acdbcc23` |

Preparation and source-overlay hashes remain in the [readiness record](2026-09-16-intake-source-profile-readiness.md); the [split diagnostic failure](2026-09-16-intake-split-process-results.md) remains authoritative for its unchanged gates.
