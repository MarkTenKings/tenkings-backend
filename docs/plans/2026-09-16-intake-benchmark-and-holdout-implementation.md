# Intake source benchmark and independent holdout tooling

Date: 2026-09-16. Implemented under Mark's continuation to finish the approved work. This lane changes test tooling and this report only; root owns the catalog adapter/result versioning. No production database, credential, paid provider, Atlas checkout, runtime intake/save/worker, shared schema, deployment or commit was changed by this lane.

## Implemented source benchmark

- `packages/database/scripts/benchmarkStaffIntakeDisposable.mjs` creates its own PostgreSQL 17 cluster on a random loopback port, copies immutable A/B source trees from Git, uses an explicit frozen Prisma client, migrates the owned template twice and checks the unchanged ledger. It never accepts a configured application database. Child environments are allowlisted and all external fetches fail unless handled by the synthetic provider transport.
- `frontend/nextjs-app/scripts/benchmark-staff-intake.ts` seeds actual inventory through `recordStaffInventoryV2`, clones equal histories per ABBA block, calls the existing workspace POST handler/sole writer, and runs the actual research worker/engine with external response tapes. It records real lease acquisition, photo-byte verification, save acknowledgment, transaction and queue-lock timing. `pg_stat_activity` must observe an actual intake advisory-lock wait while a worker owns the queue lock. No artificial delay substitutes for that database contention.
- Before measurement each block proves an interrupted save leaves no event/job and concurrent exact retries create one job. Afterward each accepted individual save has exactly one job, prior journal hashes remain unchanged, fixture photo hashes remain unchanged and worker concurrency never exceeds two. Per-save samples append continuously so a stopped or failed run retains evidence.

The first delivered benchmark scope is deliberately **source/database timing**. It uses synthetic verified JPEGs and a 250 ms simulated recognition-transport interval to exercise actual capacity leases. It does not run the recognition model/handler, browser photo upload, camera, Cost-focus transition or next-camera paint. The photo verification metric sums the two in-memory verification operations; it is not upload or device latency. Missing browser/iPhone/provider proof remains visible even if every source comparison passes.

### Frozen qualification workload

- A: `60572cec895ad63d4ab826cd366f6475b04e725a`, application-equivalent to the serving pre-v3 source.
- B: `31b8653559d8553208de8591f2d30c419642953a`, reviewed images-off v3 repairs. Neither arm includes the later catalog adapter.
- Node 22.23.2; Sharp 0.33.5; Prisma 5.22.0; 8 database connections split 4 intake / 3 worker / 1 observer. Original generated Prisma client and engine copied before the parallel catalog generation; full member hashes are retained.
- 2,000 initial described units; 256 pending jobs and 16 terminal history entries; equal template clones. Actual seed produces 1,092 journal events and 272 jobs.
- One and three intake sessions × idle/thumbnail/timeout/429 scenarios; each cell ABBA with five warmups and 50 measured saves per session per block. Total required: 3,200 measured saves. Larger images and catalog integration are separate later gates.
- Every segment/cell/repetition must keep candidate p95 increase ≤ `max(50 ms, 10% of baseline p95)`. Candidate loaded-versus-idle headroom uses the same margin. Full matrix and hard invariants are required; smoke/subset execution cannot qualify. Original 90-minute cap is unchanged.
- Synthetic source/model/image calls use the actual response parser, image decoding, checksums, bounded orchestration and persistence. Timeout tapes honor real stage aborts; 429 tapes produce the actual provider error path. Intentional shutdown cancellations are separately counted, not intake failures.

### Invocation

Use a newly created absolute output directory. `--prisma-client-root` contains `node_modules/@prisma/client` and its matching `node_modules/.prisma` copied before concurrent generation; retain that exact member ledger. The isolated tool directory was provisioned by root and contains embedded PostgreSQL 17 and pg; no PostgreSQL tooling was added to application dependencies.

```sh
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node packages/database/scripts/benchmarkStaffIntakeDisposable.mjs --ack-disposable-local-postgres --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 --out /absolute/new/private-run-directory
```

`--smoke --sessions 1 --scenarios idle,thumbnail` exercises the harness with deliberately insufficient samples and always reports nonqualification. Baseline/candidate overrides resolve exact Git commits; source and tool/client hashes are sealed before samples. Full source output includes protocol, source/client member ledgers, migration ledger, seed proof, raw NDJSON samples, block reports and the final comparison report.

### Observed results

**Frozen source timing verdict: FAIL.** The complete images-off matrix finished in **50.47 minutes**, with **3,200 measured saves plus 320 warmups** and no dropped samples. All 32 blocks passed exact-save/job, concurrent retry, rollback, prior-history, original-photo and worker-concurrency invariants; every one of the 24 loaded blocks observed the real worker/save queue-lock overlap. All 30 candidate loaded-versus-idle comparisons pass. Of 40 metric/cell comparisons, 39 pass; 79 of the 80 individual repetition comparisons pass. The failed repetition prevents qualification even though all pooled comparisons pass.

The failure is **three sessions / thumbnail / intake lease, repetition 2**: A p95 **4.62 ms**, B p95 **79.92 ms**, increase **75.30 ms** against the frozen **50 ms** margin. The opposite repetition is A **81.35 ms** / B **6.68 ms**; pooled A/B is **78.22/7.75 ms**. Neither pooling nor the passing save-ack results below supersedes the failed lease gate.

| Sessions | Scenario | A save-ack p95 (ms) | B save-ack p95 (ms) | Save-ack gate |
| --- | --- | ---: | ---: | --- |
| 1 | idle | 655.6 | 646.6 | Pass, both repetitions |
| 1 | thumbnail | 659.3 | 662.3 | Pass, both repetitions |
| 1 | timeout | 641.9 | 655.7 | Pass, both repetitions |
| 1 | rate-limit | 652.8 | 658.2 | Pass, both repetitions |
| 3 | idle | 2127.1 | 2103.8 | Pass, both repetitions |
| 3 | thumbnail | 2171.2 | 2142.6 | Pass, both repetitions |
| 3 | timeout | 2183.5 | 2157.9 | Pass, both repetitions |
| 3 | rate-limit | 2223.4 | 2111.9 | Pass, both repetitions |

The actual worker completed 1,029 research attempts. Prescribed failures were 72 timeouts, 3,478 provider errors and 43 separately counted shutdown cancellations. No prescribed research failure became an intake failure. No timed block observed a denied claim at three simultaneous leases; this admission clause is therefore unobserved in the frozen timing run.

A separate **UTF8 admission smoke** then passed eight A/B blocks, 16 measured saves and every deterministic preflight: acquire two actual research claims, hold three intake leases, allow an existing terminal write, deny a new claim with a free worker slot, release one lease and admit a new claim. Its small samples cannot qualify performance and are never pooled into the original matrix. Both owned clusters and temporary source trees were removed successfully. PostgreSQL reports version 17.9 built for x86_64 on this arm64 Node host; these are local comparative measurements, not production absolute-latency estimates.

#### Lease-tail diagnosis and next discriminating check

The A/B files `staffInventoryResearchV2.ts`, `cardPlatformV2.ts` and `staffInventoryResearchWorker.ts` are byte-identical. Across the four affected 150-sample blocks, leases over 50 ms number **12, 5, 8 and 4**. Eight tail samples are sufficient to place nearest-rank p95 in the approximately 80 ms mode. Every affected block also has aggregate event-loop p95 near 80 ms. All slow lease samples occur at indices ≥1; the deliberate first-save barrier runs after that first lease and releases before the next save can finish, so it cannot account for these later slow leases.

Shared-process scheduling and synchronous journal/research work are plausible contributors. The frozen raw logs do **not** contain absolute operation spans or separate lease-lock timings, so they cannot distinguish a database wait from delayed Node callbacks or establish a causal schedule. The failure remains open; no runtime change or scheduling adjustment is justified yet.

The bounded next diagnostic is three-session **idle + thumbnail ABBA only**, the same five warmups and 50 measured saves per session/block (**1,200 measured saves**, 30-minute cap), exact same application commits and unchanged margins. Before collecting it, freeze monotonic lease/transaction/queue-lock/claim/terminal spans, event-loop lag timestamps and owned-PostgreSQL lock-wait evidence. Record the new instrumentation/UTF8/preflight differences. Preserve this failed run, do not change scheduling before identifying the cause, and do not claim whole-matrix qualification from the subset. This diagnostic has **not** been launched.

#### Evidence archive and harness verification

Durable private archive: `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-intake-source-benchmark`. Its **186 members / 60,099,371 bytes** include raw samples, all block/summary reports, exact executed source bytes, source/client ledgers, frozen Prisma client, setup/pause/concurrent-work notes, lease-tail diagnosis and development/final smokes. All member hashes were read back and verified. Directory/file access is restricted to the owner.

- Archive `manifest.json` SHA256: `9075bba6ad6aa5aaa58b5a4f4b0a201d304312d1ed38961579bcb381fdd7fc49`.
- Frozen `full/summary.json` SHA256: `8cb1b12e5eeda4a6831f8d0df4b13cb5c55df14a268a1011548e4a03eaf09a64`.
- Supplemental server identity explicitly records **UTF8**. The original timed runner did not record encoding and used only ASCII descriptions. A separate catalog test exposed SQL_ASCII defaults; Unicode/production-encoding timing qualification is not established by this frozen run.

One development smoke failed on an omitted source-tree `constants` dependency; the exporter was corrected and owned-cluster cleanup succeeded. The reusable runner subsequently gained process-group timeout cleanup, complete-matrix verdict guards, explicit UTF8 initialization, the untimed admission preflight and research-duration logging. The original run retains its exact earlier runner/child bytes; the later smoke has its own hashes. A coordinated untimed pause after block 13 allowed catalog PostgreSQL qualification. Brief source tests/linters/type checks on the shared host are recorded; there was no concurrent large build or separate DB workload during timed blocks. Scoped child ESLint and Node syntax checks passed.

## Independent holdout tooling

`frontend/nextjs-app/scripts/evaluate-staff-comp-holdout.mjs` and `staff-comp-holdout.schema.json` provide a bounded offline corpus contract and deterministic scorer. They create no real card, provider response, independent label or reviewer authority. `frontend/nextjs-app/tests/staffCompHoldout.test.mjs` contains explicitly synthetic behavioral cases; their passing scores are not a card-accuracy result.

The corpus requires ≥200 unique physical cards/inputs, equal Sports/Pokémon × known/new-set strata with ≥50 each, independent exact/partial/unknown identity and condition truth, original Front/Back image hashes, provenance roots disjoint from the reference bank and each other, a fixed 180-day market window, labels sealed before unblinding, two declared independent reviewers and source/build/model-parameter/package/guide/reference/provider-tape/result hashes. The current mapper pins `StaffInventoryResearchPanel.tsx` SHA256 `880cc1e51d7d22061fdd5b283795052b87b1425e391d41bf19438c86f274759e` and accepts V1–V3 research results only. A new UI/result version requires explicit mapper review; the tool refuses silent V4 reinterpretation.

The scorer audits selected comps **and** persisted `matched` research comparisons. Correct matched sold evidence can count without an estimate. One wrong confident identity/condition assertion or false sold/verified-price assertion fails card coverage. A correctly labeled active match is not sold coverage. Unknown offers stay unknown. All failure, no-sale and unknown-availability cards remain in the all-card denominator. Verified-value coverage additionally needs distinct independent sales and independently established final USD amounts, with the displayed mean, range and count checked against those human-labeled amounts; relisted copies do not supply extra sales. Estimated-value correctness is scored separately from correct-comp coverage. A source-reported or sold assertion is not itself human truth.

Output contains overall and stratum counts, assertion/sold precision, raw/graded/rarity/look-alike representation by category, separate variant/value/market-available diagnostics, Wilson intervals and a seeded 10,000-resample family bootstrap. Broad >90% qualification requires the conservative lower bound above 90%, observed assertion precision ≥98%, at least 20 independent families, raw/graded plus ordinary/rare/numbered and look-alike representation within both categories, and a nonsynthetic corpus. Declared reviewers/seals are not authenticated by this offline file; actual independent review must be supplied and audited separately. The scorer's canonical JSON hash is explicitly its local corpus/result seal, not a replacement for an application's persisted historical hash. Paired mode requires identical physical inputs, ground truth, strata, frozen bank, provider tape and model settings; it reports gains/losses without claiming a superiority test. Fresh-provider studies remain separately labeled evaluations.

```sh
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node frontend/nextjs-app/scripts/evaluate-staff-comp-holdout.mjs /absolute/sealed-corpus.json /absolute/new-scorecard.json
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node frontend/nextjs-app/scripts/evaluate-staff-comp-holdout.mjs --paired /absolute/baseline-corpus.json /absolute/candidate-corpus.json /absolute/new-paired-scorecard.json
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --test frontend/nextjs-app/tests/staffCompHoldout.test.mjs
```

Observed focused scorer tests: 12/12 passing, including matched-without-estimate coverage, wrong confident comparison, active match, unknown accepted amount, failed-card denominator, version rejection, relisted-sale value exclusion, independently checked estimate arithmetic, all 200 synthetic failures remaining in the denominator, leakage/independence rejection, the frozen market window and paired-input identity. No real corpus is included; all-card accuracy remains unmeasured.

## Completed scheduling diagnostic — retained FAIL

This dated addendum supersedes the earlier statement that the diagnostic had not launched; it leaves the original failed matrix and its sealed evidence intact. Root approved one discriminating run and reserved a local build/DB/headless-browser quiet window. Collection finished in **17.28 minutes**, with the frozen **1,200 measured saves plus 120 warmups**, unchanged A/B application commits and unchanged margins. **Diagnostic timing verdict: FAIL.** The subset also cannot supply full-matrix qualification.

All eight blocks passed the save/job/retry/rollback/history/photo/concurrency invariants and deterministic admission preflight; all four loaded blocks observed the required controlled DB overlap. All five loaded-versus-idle headroom comparisons passed. Lease, save acknowledgment, save transaction and save queue-lock comparisons passed, but two photo-verification comparisons failed:

| Scenario | Pooled A/B photo sum p95 (ms) | Failed repetition | Repetition A/B p95 (ms) | Increase / margin (ms) |
| --- | ---: | --- | ---: | ---: |
| Three-session idle | 1.50 / 58.37 | 1 | 0.79 / 58.90 | 58.11 / 50 |
| Three-session thumbnail | 2.34 / 58.63 | 2 | 1.43 / 60.70 | 59.27 / 50 |

### What the independent traces establish

The observer ran in a separate Node process using the existing observer connection; the total connection budget stayed **4 intake + 3 worker + 1 observer**. Its observed polling intervals had p95 **11.5–12.5 ms**. Absolute transaction/SQL spans and main-process event-loop ticks distinguish observable PostgreSQL waiting from elapsed application callbacks; database samples remain discrete observations, not continuous wait-duration measurements.

The four thumbnail blocks A/B/B/A contained **6/3/9/15** leases over 50 ms: **33 total**, A 21 and B 12; idle had none. All 33 overlap more than 20 ms of late main-loop time. Of these, **24** have queue-query elapsed spans over 50 ms. Within each of those actual query spans, independent PostgreSQL samples observe a worker completion transaction holding the queue lock while waiting on **ClientRead**, meaning PostgreSQL is waiting for its client. The remaining nine slow leases have more than 50 ms after the queue query, through transaction completion. Overall, 27 slow leases have at least one independently observed advisory wait. Both arms exhibit the pattern; the previously audited lease/queue/worker source files remain byte-identical.

A representative B case is block 06, session 0, sample 11, lease trace 210: **79.19 ms total**, **78.05 ms queue query**, and **69.83 ms late-loop overlap**. During that interval the observer repeatedly sees the lease waiting on the advisory lock, worker completion trace 209 holding it in `idle in transaction / ClientRead`, another intake transaction at its journal read, and a further intake awaiting an advisory lock. The controlled first-save barrier cannot explain sample 11. Exact spans and sampled rows are preserved in `supplemental-validation.json`.

These observations establish **real harness DB lock waits together with delayed shared-process callbacks**. They support shared-process scheduling as a contributor to lock duration; they do not identify a specific synchronous function or assign all elapsed time to CPU versus PostgreSQL. No CPU stack profile was collected. Journal replay/validation work is a possible contributor, not a demonstrated cause. The approximately 80 ms event-loop tail exists in idle and loaded blocks. Small changes in how many leases enter that tail can move nearest-rank p95 sharply: eight of 150 samples suffice. A deterministic periodic schedule has not been established.

### Why photo verification has an idle tail too

The frozen handler verifies Front and Back with `Promise.all`; the harness metric **adds the two parallel elapsed metadata operations**. Shared callback delay therefore contributes to both terms. Among 68 samples whose photo sum exceeds 50 ms, typical sums of **58–62 ms** fit within **29–31 ms** from recognition-lease release to save-transaction request, alongside late main-loop ticks. That enclosing interval includes request setup/validation, so it is a conservative wall-time bound rather than a direct photo-stage measurement. None of these slow photo samples is the controlled first-save barrier sample. The tail also occurs with research workers idle, so background worker queue contention does not explain it by itself.

The summed metric was frozen before collection and its failed gate stands. It cannot now be replaced with a wall metric to declare a pass. Direct photo start/end spans were not collected; `photo-tail-bounds.json` preserves the supplemental bounds without changing analysis thresholds.

### Limits, archive and smallest next proof

The harness **co-locates simulated clients, intake writer, metadata verification and research-worker callback work in one Node process**. Actual deployed Vercel route/function isolation and per-instance concurrency have not been qualified here. These traces establish local harness behavior in both A/B arms, **not a production regression or a passing release gate**. No runtime throttle or source change is justified solely by this evidence.

Compared with the original matrix, this run adds explicit UTF8, three untimed admission jobs, one backend-PID query per observed transaction, an independent observer replacing the original observer, 10 ms event-loop ticks and buffered absolute spans. These changes and analysis rules were sealed before sampling; their overhead was not separately quantified. Neither run qualifies physical-camera/upload/recognition latency, real-provider variance, larger images, later catalog/V4 integration or real-card accuracy.

New durable private archive: `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-intake-scheduling-diagnostic`. **78 members / 91,017,723 bytes**, all hashes verified by readback, owner-only access. It contains the complete diagnostic and preflight, exact executed code, preregistration and frozen analyzer, raw samples/observer records, all reports and supplemental trace validation. Every raw sample matches its block report; all 1,200 measured leases have matching traces. Both runs cleaned up their owned clusters and temporary source trees. The original archive is unchanged.

- New archive `manifest.json` SHA256: `b45ea375293ac326463215155ad845942e1987e24a0c454b72a7b959a9597109`.
- Diagnostic `summary.json` SHA256: `11ce23665b3703abb7bff95a353d863912b39203672accc8faf294e263f5fbb1`.
- Frozen runner / child SHA256: `776f92ba23a714378cb7304435920b861046f529f3d2743038279690c6cbfeac` / `76a55776ac436a5460d93353fac4efed70a6bfd8d3fad3116063fc06f701050c`.

**Recommended next proof, not launched:** first establish the deployed route/function boundaries and instance concurrency. Then preregister one three-session idle/thumbnail ABBA diagnostic with an external load-driver process, an intake-route process and a separate research-worker process, modeling the verified intake-instance arrangement. Keep source refs, work, 4+3+1 connections, margins and original metrics fixed; add direct Front/Back and combined photo wall spans plus event-loop spans for each process. Separating intake and worker execution is necessary to test whether the shared-process coupling explains these tails; it is not sufficient to reproduce Vercel automatically. Preserve both failures, compare mechanisms, and require the full matrix plus device/provider proof before any release claim. No additional benchmark was launched or runtime source altered after this diagnostic.
