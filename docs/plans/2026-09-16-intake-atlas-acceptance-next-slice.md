# Intake, shared adapters and accuracy: next acceptance slice

Date: 2026-09-16. Source inspected: Inventory `ece8223b277ffa272ed87037b8044f17804a8dcb`; Atlas read-only baseline `f16bbb7e49ebf46c09e32d30a9a441a947e75df3`. **Execution packet; no benchmark, integration, deployment or accuracy result is claimed.** This assignment changed only this document and did not open a database, call providers, inspect credentials, modify Atlas or run a cluster.

Authority: the full [approved blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md), [implementation record](2026-09-16-inventory-research-implementation.md), [shared contract](2026-09-16-shared-catalog-contract.md), [recognition handoff](2026-09-16-recognition-package-handoff.md), and [next publication slice](2026-09-16-catalog-persistence-next-slice.md). The recognition handoff's preparation header is historical: the session log records delivery commit `b89cb020bde7e538142b26e69198fb992c526f36` and Atlas's independently verified receipt/26 passing tests. Receipt is not adoption; its V2 adapter remains unreleased.

## 1. Start these three concrete deliverables

1. **Build and run the local responsiveness benchmark** below before adding background catalog load. No live provider or production DB is necessary. Deliver frozen protocol, raw samples, baseline/candidate hashes and a pass/fail report.
2. **Add the Inventory after-save catalog adapter** after the publication writer and loader contract are fixed. Deliver one real reviewed sports publication and one Pokémon publication consumed by an exact existing research attempt, with stale/revoked behavior. Keep fast recognition unchanged. Atlas adoption stays on its lead's timetable after its current grading acceptance; this packet does not reprioritize that work.
3. **Prepare, seal and independently label the 200-card holdout now; execute only after the pilot/provider prerequisites pass.** The two-card functional pilot permits no broad accuracy claim. The 200-card experiment is its own acceptance gate, not a reason to delay bounded safe fixes.

The lead owns integration, common session records, exact package delivery and Atlas communication. This lane owns benchmark instrumentation/reporting, Inventory adapter tests and the acceptance scorecard. No new worker, queue, stock writer, grading authority or duplicate editable catalog is needed.

## 2. Protected intake boundary

Read-only diff against `60572cec895ad63d4ab826cd366f6475b04e725a` found no change in these ten inspected paths:

- `frontend/nextjs-app/components/admin/StaffInventoryCardCapture.tsx`
- `frontend/nextjs-app/components/admin/StaffInventoryWorkspace.tsx`
- `frontend/nextjs-app/lib/inventoryPhotoUpload.ts`
- `frontend/nextjs-app/lib/server/staffInventoryIdentification.ts`
- `frontend/nextjs-app/pages/api/v2/admin/inventory/{identify,photo,workspace}.ts`
- `frontend/nextjs-app/lib/server/staffInventoryResearchWorker.ts`
- `packages/database/src/cardPlatformV2.ts`
- `packages/database/src/staffInventoryResearchV2.ts`

Keep Photos → immediate Cost focus → Sales channel → explicit Add inventory → next camera. Preserve original captured files, exact photo pair/revision/hashes, bounded same-upload retry, in-flight human edits and explicit clears, sports request bytes, historical saved prices/channels and exact pending-save replay. No catalog fetch, image acquisition, review button or extra provider call joins capture, recognition or save. `recordStaffInventoryV2` must still atomically persist inventory and enqueue research; a background promise cannot replace its transaction.

Existing evidence explains why timing still matters: identification awaits an optional intake lease transaction (`maxWait=1000`, `timeout=1500` ms); database research uses advisory lock `(20260911,4202)`; research admission permits two running jobs and pauses at three active intake leases. That pause stops new claims, not already running work. `runStaffInventoryResearchWorker` already bounds claims, deadlines and completion reserves. Do not adjust those limits merely to make the benchmark pass.

Existing behavioral suites to retain: `staffInventoryCardCapture.test.tsx`, `staffInventoryWorkspace.test.tsx`, `staffInventorySaveValidation.test.tsx`, `inventoryPhotoUpload.test.ts`, `staffInventoryIdentification.test.ts`, `staffInventoryApi.test.ts`, `staffInventoryResearchWorker.test.ts`, `staffInventoryResearchCompatibility.test.ts`, plus database `staffInventoryV2Postgres.test.js` and `staffInventoryResearchV2Postgres.test.js`. Add only missing observable scenarios: real lock contention/timings and catalog pin outcomes. Do not add tests that merely repeat code constants.

## 3. Frozen local responsiveness experiment

### Harness and prerequisites

Extend `packages/database/scripts/testCardInventoryV2Disposable.mjs` with an explicit benchmark mode and a test-only child runner, proposed `frontend/nextjs-app/scripts/benchmark-staff-intake.ts`. Reuse its owned temporary cluster, random loopback port/password, copied complete migration chain, second-deploy unchanged-ledger check and owned-cluster cleanup. Do not accept an externally supplied application database. Use a child-environment allowlist; the existing runner spreads `process.env`, so benchmark launch must not inherit application secrets or external provider endpoints.

Read-only tool preflight found:

| Tool | Observed availability |
| --- | --- |
| Existing disposable runner and DB/DOM tests | Present |
| Frontend `tsx` and `jsdom` | Installed local links present |
| `/private/tmp/tenkings-inventory-test-tools-20260907` | **Absent**; therefore embedded PostgreSQL/pg at that recorded location unavailable |
| Ambient `node` | `v25.6.1`; not the previously qualified Node 22.23.2 |
| `/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node` | Lead rechecked: **v22.23.2 available**; use this exact existing runtime |
| `/opt/homebrew/opt/node@22/bin/node`, `/opt/homebrew/opt/postgresql@17/bin/postgres` | Absent at these exact paths |
| Frontend-local `playwright`/`@playwright/test` | Absent at those exact paths; no claim about tools elsewhere |

Use the available pinned Node 22 path and provision isolated PostgreSQL 17 test tools outside application dependencies, or locate an already installed equivalent and record versions. Do not substitute productionDB. No cluster is required in this planning turn. DOM tests cannot establish camera/paint latency; provide a test-only real-browser runner for a loopback application with deterministic media/provider transport, then separately verify actual iPhone behavior.

### Protocol to hash before collecting candidate results

- Use the correct baseline for each delivery. For the first private-comp repair, A is the serving `38c95335` application (documentation-only successor `60572cec` is application-equivalent) and B is the exact reviewed v3 candidate, with larger images off in both. For subsequent catalog-adapter work, A may be the qualified images-off v3 source (`ece8223b` contains that local source) with catalog integration disabled and B its exact integration candidate. Never use `ece8223b` as a pre-v3 baseline, since it already contains the repairs. Same machine, Node, build mode, browser, DB pool size, CPU availability, source history, photo bytes and deterministic provider tapes. Record every configuration/hash. Use isolated equivalent databases or fresh owned databases for each block; never delete live history.
- Seed through the real sole writer: 2,000 test-only described units, equal existing research history, and 256 pending eligible individual-card jobs. Fix the seed/IDs/description shapes. Ensure no seed writes occur during measurement. This is a local workload size, not an assertion about production stock.
- For each cell run **ABBA**, five warmups per session per block, then 50 measured saves per session per block. Thus each arm has 100 saves per session per cell. The complete image/catalog qualification has ten cells: 1 and 3 simultaneous intake sessions, each under idle, ordinary-thumbnail load, enabled larger-primary load, provider timeout, and provider 429/backoff load. Maximum measured saves: 4,000 across both arms/all cells. The first images-off repair release uses the eight applicable idle/thumbnail/timeout/429 cells (3,200 saves); record the two larger-image cells as deferred to their separate feature gate, never as passed. Fixed cell order and seed; no dropping slow samples. Stop at a predeclared 90-minute total execution cap and report incomplete rather than weakening sample size.
- Idle: pending backlog exists but workers are not invoked. Loaded cells: two ordinary workers obtain real DB claims before intake begins; actual claim/complete/fail transactions and the real research orchestration run. Stub only external transport with recorded/synthetic bounded bytes and deterministic delays. Successful calls return after 250 ms; timeout transport respects the real request abort; 429 tape has explicit rate-limit outcomes. Large-image tape exercises actual download/decode/checksum work within current limits (12 listing images, four concurrent downloads, 2 MiB bodies, 16 million pixels, 6-second per-image/18-second round limits). No arbitrary sleeps stand in for DB contention or image work.
- Reinvoke bounded worker runs while eligible backlog remains. At three intake leases, observe admission pausing and existing workers completing; record running-worker occupancy and denied claims. Do not bypass the pause to manufacture constant saturation. Include one barrier-controlled save/worker-completion overlap per measured block so shared-lock competition is observed. If overlap never occurs, the relevant cell is invalid.
- Instrument test-side monotonic timestamps around real handler/dependency boundaries. Separate photo prepare/upload/verify, recognition total and external wait, optional lease acquisition, save transaction/queue-lock wait, durable save acknowledgment, back-shutter-to-Cost-focus and acknowledgment-to-next-camera-ready. Measure lock acquisition around the real advisory-lock query through a test wrapper or SQL observation; do not subtract unrelated timers and label the remainder a lock measurement. Record browser event/paint readiness separately from server and DOM timing.
- Persist per-save samples keyed by test unit/session/block, outcome/retry count, queue cardinality, hash checks, provider-call counts, worker occupancy, research latency and process CPU/RSS/event-loop delay. Store safe JSON/CSV plus report under a new private run directory; omit signed URLs, credentials and real photographs.

### Release thresholds (fixed here, before measurements)

For **each** timing segment and scenario/session count, candidate p95 minus baseline p95 must be **≤ max(50 ms, 10% of baseline p95)**. Report p50/p95/max and both individual ABBA repetitions; a pooled pass cannot hide a failed repetition. Compare B loaded against B idle as a separate headroom diagnostic and apply the same margin to intake segments; baseline existing contention is not permission to worsen the user experience. No invalid/missing cell can pass.

Hard gates: zero extra intake provider calls/mandatory steps; zero new intake errors or automatic retries against identical injected conditions; exactly one research job for every accepted individual save; no job/event on failed save; idempotent retry creates no duplicate; no staff edits/cost/channel/original changes; no lost accepted work; deadline/lease bounds honored. Prescribed research failures in timeout/429 cells are recorded separately and must not become intake failures.

If a cell fails, change only demonstrated background admission/concurrency/resource use, keep save enqueue atomic, and repeat that cell plus its paired idle control with a new exact candidate/hash. Never raise margins after seeing results. Finish with representative iPhone captures and simultaneous staff acceptance using the same segment definitions; local stubs cannot prove mobile/network/provider performance. Real-card writes/provider spend belong to the later explicitly scoped acceptance execution, not this packet.

## 4. Exact adapter ownership and pin contract

| Surface | Owner and implementation paths |
| --- | --- |
| Shared recognition | `packages/card-identification-core`; opt-in `/v2`, V1 bytes/readers retained. No catalog input is accepted by this recognition package. |
| Publication writer/media | Persistence lane: `lib/server/setCatalogEvidence.ts`, `setCatalogEvidenceMedia.ts`, schema/migration/review APIs per the publication packet. |
| Authorized host loader | Persistence lane: distinct exported discovery/load/revalidation functions in `frontend/nextjs-app/lib/server/setCatalogEvidence.ts`, separate from the pure package and consumer adapter. Freeze that interface before adapter edits. |
| Inventory catalog adapter | This lane: `frontend/nextjs-app/lib/server/staffInventoryResearchReferences.ts`, after-save integration in `staffInventoryResearch.ts`/`staffInventoryResearchWorker.ts`, and compatible attempt/result schema in `packages/shared/src/staffInventoryResearch.ts` plus sole research writer `packages/database/src/staffInventoryResearchV2.ts` where required. Do not edit capture/save/initial recognition. |
| Inventory quick-recognition adoption | Later deliberate substitution in `lib/server/staffInventoryIdentification.ts` and existing identify adapter; unnecessary for the first catalog pilot because current Inventory already contains the fixes. |
| Atlas recognition/adoption | Atlas lead only: `packages/atlas-connected-manual/src/identification.mjs`, `details.mjs`, `frontend/atlas-app/components/ManualCards.jsx`, existing `frontend/atlas-app/test/workspace-identification.test.mjs`. Actual source still imports V1. |
| Atlas catalog/research | Atlas lead chooses its package adapter and authenticated transport after its acceptance gate; propose `packages/atlas-connected-manual/src/catalog-evidence.mjs` within its existing package, not a Ten Kings checkout edit. No transport/accounting contract exists yet. |

Freeze a narrow loader interface before wiring: exact set → current publication pin or unavailable; exact pin + authenticated consumer scope → detached immutable authorized snapshot; exact pin → still-current/available verdict. The pin binds publication ID, set/draft/version, revision, complete manifest SHA and verification SHA/approval binding. Caller JSON cannot establish approval. Publication writer checks **both expected current pin and latest historical pin**, including null-current-after-revocation cases, per the new persistence packet.

Current reference schemas are strict and current saved results carry V1/V2/V3 semantics. Introduce an explicitly versioned catalog-bearing attempt/result envelope; do not squeeze new authority into legacy `catalog_id` text or reinterpret old `published_catalog` labels. At claim/research start, select one exact current pin, bind it to that immutable attempt and retain its hash; all reads in that attempt use it. Unknown/absent evidence remains unresolved. Recheck eligibility before accepting new catalog-derived output. Revoked/superseded work may remain historical evidence, never current authority. Do not automatically repeat already-estimated/exhausted attempts, alter descriptions or reset budgets to force refresh.

Atlas V2 needs a real adapter change: OCR envelope `body` becomes request JSON and `responseFields` becomes Google `fields`; preserve request/status/paid-work receipts, historical parser dispatch, exact original→interpretation JPEG→crop lineage, stale-pair fencing and touched/cleared fields. Pokémon descriptive publisher is not the prohibited manufacturer field in Pokémon grading identity. Both applications retain originals, private permissions, accounting and final grade/description authority.

### Minimum real two-way reuse proof

Use **four separately captured physical cards**, two direction pairs, with unrelated input hashes and no donor/recipient photo/listing leakage:

1. **Inventory → Atlas, sports:** Inventory observation of sports donor S1 enters the unreviewed proposal inbox. Human SetOps review publishes only source-supported reusable facts/diagnostics. Atlas recipient S2 is a different physical card in the explicitly supported printing scope. Its actual adapter consumes that exact publication and yields the supported suggestion. Record before/after evidence without changing the grade, originals or human edits.
2. **Atlas → Inventory, Pokémon:** Atlas donor P1 contributes an authenticated proposal with its own input revision. Separate human review publishes precise set/language/edition/applicability and depicted-versus-representative image facts. Inventory recipient P2 is a different physical card; an ordinary after-save research attempt pins and uses it. A neighboring excluded/unknown printing must remain unresolved.

Each case records donor/recipient safe IDs and image hashes, publication/current/history pins, human review receipt, consumer attempt/version, evidence lineage, suggestion/result and unchanged originals/grade/cost/description hashes. Exact producer replay is idempotent; changed payload conflicts. Revoke then stale-consume fails; a later publication does not relabel the earlier attempt. Synthetic cross-package fixtures remain useful preflight but cannot satisfy these real adapter/physical-card gates. If Atlas is not ready, report Inventory pilot pass and cross-app acceptance pending; do not pressure a new Atlas release.

## 5. Independent 200-card all-card scorecard

Freeze the sampling/labeling guide, corpus manifest, source bank, provider date window and build/model/package/manifest hashes before candidate evaluation. Default study: **200 unique physical cards, 50 in each Sports/Pokémon × known-family/new-set stratum**, sampled without selecting for available sales. This supports the stated balanced study population, not an undisclosed production-wide mix. Publish natural intake proportions separately if making a population-weighted estimate. Ensure raw/graded, ordinary/rare/numbered finishes and look-alikes occur within both categories; disclose counts and do not quietly replace hard cards.

An independent reviewer who did not tune the candidate labels exact identity, language/edition, variant, grader/grade or raw-condition compatibility and independently searches the same frozen **180-day sold-market window**. A second reviewer adjudicates uncertainty before unblinding outputs. Same physical card, listing/image roots, certificates and relisted photographs cannot be both reference-preparation and held-out evidence or multiple independent sales. Unknown availability stays in the corpus. New-set acquisition uses only independent sources; freeze that cohort's reviewed bank before scoring its recipient cards. Report acquisition/review effort separately.

Freeze attachment semantics against the actual saved UI before evaluation: `StaffInventoryResearchPanel.tsx` displays both estimate selections and persisted `comparison_assessments.classification === 'matched'` research matches. Therefore **`selected_candidate_ids` alone is not the headline attachment measure**; it would confuse price-estimate coverage with the requested useful sold comparisons. Audit the union of those confident identity assertions, maximum 24 candidates per card; tentative/possible candidates do not count. Record separately which assertions claim a supported sale and which claim a verified amount. Do not truncate assertions after errors are discovered.

Covered card = at least one persisted, independently correct same-variant comparison with supported and independently verified sold-event evidence, **zero incorrect confident identity/condition assertions**, and no false sold/price assertion. Wrong player/set/printing/language/grade or incompatible raw condition fails that card. A correctly labeled active/unknown-sale research match cannot count as sold coverage; it is not a false sold assertion merely because it remains visibly labeled research outside the estimate. An active/unproven event represented as a supported sale does fail. Unknown condition cannot be presumed compatible merely because both cards are raw. Final-price verification and estimated value remain separate; unknown offers remain unknown and do not become verified amounts. Verified-value coverage additionally requires the existing two independent eligible comps and exact final amounts. Bind this evaluator mapping to the actual UI/result version and independently review it before sealing the corpus.

| Frozen report field | Denominator / rule |
| --- | --- |
| Headline correct attachment coverage | Covered cards / **all 200**, including no sale, ambiguity, timeout, provider error, failed image, abstention and unknown availability |
| Confident assertion precision | Independently correct identity/condition assertions / every confident identity assertion; also report sold-assertion precision separately. Target **≥98% observed**, with interval and count |
| Variant correctness and coverage | Correct, incorrect, unresolved counts / all cards; no abstention counted correct |
| Verified-value coverage | Cards with eligible verified estimate / all cards; no price uncertainty converted to zero or a success |
| Market-available diagnostic | Correct covered cards / independently market-available subset; publish unknown/unavailable counts; never replace headline denominator |
| Responsiveness/cost | Intake and background p50/p95, failures/retries, search/model/image calls and cost per correct covered card |
| Strata | All metrics by Sports/Pokémon, known/new family and raw/graded, with sample sizes |

Report paired A/B outcomes for the same sealed card inputs and provider tapes, plus a separately labeled fresh-provider study if later authorized. For a broad **>90%** claim require observed coverage above 90% and a predeclared 95% lower bound above 90%; calculate Wilson for the card count and a seeded family-cluster bootstrap (10,000 resamples) and use the more conservative lower bound. Too few independent families, or a bound crossing 90%, is inconclusive. `190/200` is approximately 95% observed with a 91% Wilson lower bound; correlation can lower the family-aware bound. Do not expand or tune on this holdout after seeing a miss; fixes require a new held-out evaluation.

## 6. Completion and blockers now

Ready now: benchmark implementation, pinned-runtime/tool provisioning, scoped regression checks, adapter contract fixtures and sealed corpus preparation. The benchmark/test files proposed above do not yet exist; this packet is not a claim those commands ran.

Blocked dependencies, each confined to its own gate:

- Local measurement: missing recorded disposable PostgreSQL tools; the qualified Node22 runtime is available at the verified path above. Real-browser runner/device proof still needed.
- Real Inventory catalog proof: publication storage/loader, explicit human review, actual pilot taxonomy/source/media permission and versioned result/attempt binding.
- Real provider/accuracy study: qualified SoldComps semantics/images, authorized provider access/run budget and independent corpus labels. No credential workaround.
- Cross-app activation: Atlas-owned V2/catalog adapter, authenticated contribution/lookup transport and its existing grading/release acceptance. Verified package receipt removes neither dependency.

Pass the local regression and small functional gates before release; preserve historical hashes and current feature-off behavior on failure. Catalog revocation/disable does not delete publication history. The original >90% all-card objective and measured mobile no-slowdown claim remain pending until their own evidence is recorded.
