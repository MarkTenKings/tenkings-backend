# Complete intake source/DB matrix — controlled timing PASS

Date: 2026-09-17. One authorized local run; no repeat, threshold change, production database/provider call, deployment or application edit by this lane. **The complete controlled performance matrix passes. Default-worker functional integration and full release remain explicitly false.** Earlier failures remain retained separately.

## Frozen scope and result

- A: `60572cec895ad63d4ab826cd366f6475b04e725a`, the serving application equivalent of pre-repair `38c95335`.
- B: `134c9df34a18f35aab720d57ca6bcf89245f8428`, the reviewed integrated candidate. Matching repairs are source changes; optional sale details, catalog/contributions and full-resolution processing stay off. Later canonical edits were excluded by exact Git exports.
- Harness/planned-action commit: `3c88c0a9a2c557fadaba5e3621c52f688ddee269`. Reviewed launch seal: `c16fc72f1f686538fb35d3d606883d56d334fbd60dc96b4aa23b7cd8b2757f8a`; run-time recomputation matched before source export/DB startup.
- Exact matrix: **32 blocks**, one/three sessions × idle/thumbnail/timeout/429 × A/B/B/A; **3,200 measured saves + 320 warmups**, no dropped samples. All **48 pooled metric/cell comparisons, 96 repetition checks and 36 candidate loaded-minus-idle checks pass**. Every block passes its hard integrity gates.
- Original nearest-rank p95 rule preserved: candidate minus baseline ≤ `max(50 ms, 10% of baseline p95)` for pooled cells and each repetition; candidate loaded headroom uses candidate idle p95. Both the legacy photo-verification sum and direct photo wall remain gates.
- Exit **0**. Summary elapsed **2,158,815 ms**; including normal cleanup **2,159,014 ms (35m59.014s)**. These elapsed values include setup; they are not an individual request latency. Original 90-minute global cap and final 30-second cleanup reserve remained enforced.

### All pooled p95 metrics

Milliseconds, **A → B**, rounded to three decimals here; full-precision p50/p95/max, sample counts and both repetitions are retained in [summary.json](/private/tmp/tenkings-intake-full-matrix-20260917-01/summary.json). Every cell below passes both repetitions and its pooled comparison.

| Sessions / scenario | Lease | Save acknowledgment | Save transaction | Save queue lock | Photo verification sum | Direct photo wall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / idle | 1.405 → 1.327 | 633.077 → 270.239 | 632.342 → 269.354 | 0.172 → 0.253 | 1.771 → 1.619 | 1.132 → 1.014 |
| 1 / thumbnail | 5.134 → 1.510 | 639.112 → 271.000 | 638.218 → 270.197 | 0.432 → 0.488 | 1.447 → 1.580 | 0.921 → 1.010 |
| 1 / timeout | 3.487 → 1.442 | 633.441 → 269.853 | 632.727 → 268.904 | 0.176 → 0.438 | 1.887 → 1.763 | 1.118 → 1.017 |
| 1 / rate-limit | 3.743 → 2.821 | 631.934 → 268.905 | 631.147 → 267.959 | 0.227 → 0.493 | 2.025 → 1.331 | 1.170 → 0.789 |
| 3 / idle | 1.805 → 1.714 | 2014.599 → 645.993 | 2014.266 → 645.660 | 0.181 → 0.260 | 1.364 → 0.821 | 0.721 → 0.478 |
| 3 / thumbnail | 75.993 → 35.122 | 2015.254 → 641.861 | 2014.985 → 641.583 | 0.255 → 0.460 | 1.184 → 0.731 | 0.629 → 0.426 |
| 3 / timeout | 2.064 → 1.780 | 2095.991 → 674.463 | 2095.479 → 674.138 | 0.250 → 0.434 | 57.613 → 0.880 | 28.837 → 0.521 |
| 3 / rate-limit | 79.238 → 38.292 | 2045.402 → 655.988 | 2045.026 → 655.558 | 0.564 → 0.283 | 0.900 → 0.865 | 0.489 → 0.508 |

Three-session candidate lease p95 is **1.714000 ms idle**, **35.122333 ms thumbnail**, **1.779542 ms timeout**, **38.292459 ms 429**. Loaded-minus-idle increases are **33.408333 / 0.065542 / 36.578459 ms**, each below **50 ms**. The largest candidate save-ack headroom increase is timeout **28.470292 ms**, below its **64.599283 ms** allowance.

This does not establish uniform superiority: thumbnail lease repetition 1 is **A3.283125 → B35.971792 ms**, an increase within the unchanged 50 ms margin. Repetition 2 is **A77.545959 → B34.386666 ms**. The complete candidate includes matching repairs plus writer-history reuse and smaller internal read pages; this A/B comparison does not isolate the contribution of each change or support pooling gains across older studies.

## Source, workload and independent checks

Preparation audited **68/81** A/B imported source files, snapshot-local workspace aliases, the original frozen Prisma client and exact compatibility of the four exercised models. A's **95 migrations** are an unchanged prefix of B's **96**. Both arms used the candidate template schema; migration96 affects catalog tables/triggers, not those four models. The full chain applied on owned PostgreSQL and a second deploy preserved the exact migration ledger.

Both arms used 2,000 seed units, 256 pending and 16 terminal jobs, equal cloned histories, unchanged photos/provider tapes, separate external driver/intake/worker/observer processes, pools **4/3/1**, and two research workers. Administrative connections were absent during blocks. The saved seed proof records the actual setup. Four distinct process IDs per block, **576 bracketed clock probes**, all **24 loaded overlap barriers**, and **172,577 independent database observer samples** were verified.

Independent read-only recomputation from every report and raw sample NDJSON reproduced all summary gates and verified per-block report/sample/observer hashes, complete sample indices, exact accepted-save job cardinality, rollback/no-job, concurrent exact retry/one-job, preserved journal/photo hashes, admission denial at three leases and resume after release. No failed intake or missing sample was excluded.

Worker totals: **3,937 accepted = 811 completed + 3,126 terminal failures**, with **zero claimed jobs lacking a terminal outcome** at completed-block teardown. Failures were prescribed 429 provider errors **3,028**, timeouts **56**, and shutdown cancellations **42**. Thumbnail cells had only shutdown cancellations. Synthetic transports recorded 3,935 sold requests, 4,932 image fetches and 815 model calls; **unexpected transport calls: 0**. Background completion counts vary with each arm's elapsed time under the same two-worker load; they are not an equal-count throughput experiment.

## Environment and cleanup

Darwin arm64/Apple M4 Pro, 12 logical CPUs, 24 GiB RAM; Node22.23.2, Prisma5.22.0, Sharp0.33.5, tsx4.21.0. PostgreSQL reports **17.9, UTF8, x86_64 build** on this arm64 Node host, matching the installed local tools; these are comparative local measurements. No dependency installation, generation or build occurred. Child environments were credential-clean; inherited HOME/TMPDIR values were preserved. External network fetches were fail-closed except injected mock transports.

Fresh launch checks found **3,761,180,672 bytes** free on both relevant filesystems, **51% system-wide memory free**, matching code/seal hashes and no active build/test/PostgreSQL workload. Other agents held local tests/builds/DB work through the timed window. Only small read-only progress inspections ran during collection. The enforced disk minimum remained 2 GiB + 300 MiB at launch and 2 GiB before setup/each block; post-cleanup free space was **3,451,879,424 bytes**.

Cleanup reports `stopped=true`, `process_groups_stopped=true`, `removed=true`, no errors and no interrupt. Independent process checks confirmed runner **37165** and PostgreSQL **37540** absent; owned temporary root `/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/tk-intake-split-benchmark-JMtOJj` was absent. The quiet window was then released. No follow-on run occurred.

## Evidence and limits

Durable archive: [20260917-intake-full-matrix](</Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260917-intake-full-matrix>). Its `raw` directory retains **151 files / 333,041,464 bytes**. The complete archive preserves **172 evidence files / 333,338,993 bytes**, excluding the manifest itself: raw collection, preparation receipts, configuration, process logs, independent recomputation and offline-validation logs. Preservation used same-filesystem renames, with no duplicate copy or deletion; all **eight original paths** remain valid symlinks. Frozen runtime, Prisma client and tool directories were untouched.

The move was already complete when work resumed on **2026-09-20**. A read-only verification on that date matched every archived file's size/SHA256 and all eight symlink destinations against the unchanged manifest. No new benchmark or move occurred during this verification. Existing links remain usable: [raw results](/private/tmp/tenkings-intake-full-matrix-20260917-01) and [preparation receipt](/private/tmp/tenkings-intake-full-matrix-prepared-20260917-01). Reproduction commands and frozen source/client/tool hashes are in the [harness README](../../packages/database/scripts/benchmarks/staff-intake-full-matrix.README.md).

| Evidence | SHA256 |
| --- | --- |
| [Archive manifest](</Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260917-intake-full-matrix/manifest.json>) | `a05c1ab2e4d8812c6a3a934684cb8e48b90148798e58c980e13032a51d2ddeef` |
| [Summary](/private/tmp/tenkings-intake-full-matrix-20260917-01/summary.json) | `e26becea4877495eeba24dec4cb1659586a0e5d7408365406340a1165e04167c` |
| [Cleanup](/private/tmp/tenkings-intake-full-matrix-20260917-01/cleanup.json) | `a1586f958259e1d4d0b9a3ef00a42d585962505ce10f595bd76906d29b1c2791` |
| [Raw process log](/private/tmp/tenkings-intake-full-matrix-20260917-01.log) | `5dfe15a905571a49d7ca05fbfd8cc0e46add9230007c2543d837cf2fce1c17e9` |
| [Independent recomputation](/private/tmp/tenkings-intake-full-matrix-20260917-01.verification.json) | `613234237e6b83f57c0c99cfbdd7f12677cd734454e6fed486af256864b3da63` |

`controlled_timing_pass`, `legacy_timing_pass`, `photo_wall_pass` and `complete_matrix` are true. **`functional_integration_pass`, `full_release_pass` and `pass` remain false.** The benchmark invokes actual source worker/engine and durable writers with injected dependencies; it does not establish authenticated cron/default-dependency wiring. That requires the separately reviewed transport-substituted default-worker fixture. Existing 62 PostgreSQL checks establish database correctness, not this missing end-to-end wiring or handset latency.

Synthetic identify acquisition remains co-located with the intake role. Function descriptors do not prove actual hosted instance/CPU placement. Camera/upload/recognition, representative simultaneous staff phones, real-provider variability and hosted cold starts are not measured. Sale-detail/catalog/full-resolution activation and independent all-card accuracy remain separate product gates. This result alone does not authorize their activation or production release.

Earlier failed [original full matrix and scheduling diagnostic](2026-09-16-intake-benchmark-and-holdout-implementation.md), [split-process diagnostic](2026-09-16-intake-split-process-results.md), and [history-reuse comparison](2026-09-16-intake-history-reuse-comparison-results.md) remain intact. The [passing pagination subset](2026-09-16-intake-pagination-comparison-results.md) remains a different, narrower study. No old failure or threshold was replaced by this report.
