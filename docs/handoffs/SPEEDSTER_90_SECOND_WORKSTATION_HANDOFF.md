# Speedster TRAIN, Full-Auto Filter, and 90-Second Workstation Handoff

**Status:** historical 2026-08-10 foundation handoff; the 2026-08-11 Card Map correction below supersedes its exact-only creation language

**Prepared:** 2026-08-10 PDT

**Base:** exact `origin/main` commit `f44ff89be83f9d98a23dde5835a8801bace9d6ff`

**Integration branch:** `codex/speedster-train-full-auto-integration-20260810`

**Integration worktree:** `/Users/markthomas/tenkings/.codex-worktrees/speedster-train-full-auto-integration-20260810`

This is the self-contained implementation and evidence handoff for the owner-approved Speedster TRAIN/map foundation, full-auto map filter/audit/restore/replay system, simultaneous Front/Back SAM lane, and cycle instrumentation. It does not authorize a push, merge, deploy, migration, Production mutation, provider change, hardware change, or scope expansion.

## 2026-08-11 Card Map correction (superseding creation contract)

- A single human-authored save now creates both a complete FAMILY revision and a complete EXACT source revision atomically. There is no FAMILY-versus-EXACT creation choice. The exact-only key discussion later in this historical handoff describes the original foundation and does not override this correction.
- FAMILY keys omit subject/card name and card number: Pokémon uses Category + Year + Product/Set + Parallel; Sports uses Category + Year + Manufacturer + Product/Set + Insert + Parallel. EXACT keys retain the legacy category-aware full identity.
- EXACT wins over FAMILY and is a full replacement, never a merge. Missing EXACT falls through to FAMILY. Missing both, failed registration, or malformed/hash-invalid evidence remains in normal human review without guessing.
- Both revisions retain the complete source imagery, evidence hashes, Front/Back geometry, identity, and provenance. Server-normalized persisted bytes are independently hashed and read-back verified before either pointer moves in one transaction.
- Failed saves preserve the editor state and provide Retry plus Draft Export. Import validates and restores the complete source-bound Front/Back draft without saving automatically.
- The approved content-zone/filter-authority split remains a blueprint only. The known 50-card deterministic calibration replay is a mandatory zero-write gate with zero hidden real defects before filter-safety acceptance.

## 1. Locked target and timing boundary

The target is 90 seconds of real wall-clock time from the operator's first physical interaction with an ungraded card through durable grade completion and a truthful workstation-ready-for-next-card state.

The timed cycle still includes identity entry, Front/Back placement and capture, geometry correction, SAM 3 and `GLOBAL` Memory work, human review of every finding that reaches the review screen, false-finding removal, Smart-Mark work, retyping and other grade-relevant edits, final measurement, deterministic grading, durable completion, and truthful Next Card readiness. Required grading work was not moved beyond the stop boundary.

Browser instrumentation begins at the first observable pointer or key interaction on the Speedster identity surface. It records `FIRST_SPEEDSTER_INTERACTION` as a lower bound; it cannot truthfully observe physical handling that occurs before the first UI interaction. Exact handle-to-ready proof therefore still requires a physical operator run with an external or separately approved physical-start observation.

PhotoRoom presentation now starts through one separate automatic authenticated post-cycle request after durable completion. That request has no retry or fallback and cannot delay or change the successful grading response or Next Card. Existing comps and NFC work also remain post-cycle and outside physical-grade authority. NFC remains off unless separately commissioned.

## 2. Locked owner decisions preserved

- TRAIN has no shadow phase, confirm phase, activation gate, operator approval gate, confidence gate, image-quality gate, calibration gate, or device gate.
- A valid TRAIN save or edit creates an immutable revision and makes it current immediately. Restoring an older revision creates a new immutable revision and makes that revision current immediately.
- Full-auto filtering runs after the unchanged Detector plus one shared `GLOBAL` Memory result and before ordinary review.
- A Detector or Memory finding fully contained by a classified human map zone is absent from normal review. A partially contained finding remains in review. Smart-Marks bypass the filter.
- Every finding that remains on the review screen remains human-reviewed inside the 90-second timer.
- Backend filter evidence is permanent and immutable. Audit restore is the correction loop; it does not silently rewrite the original decision.
- Active-session restore remeasures and regrades through existing authority, then atomically appends its calibration event. Completed-session restore is append-only calibration evidence and cannot rewrite the completed session, label, permanent card, grade/report, findings, public slug, or timestamps.
- Filter decisions cannot become negative `GLOBAL` Memory lessons.
- A restore on an active session follows the existing completion-harvested Memory path. A completed-session restore cannot enter the current `GLOBAL` Memory path without rewriting completed history or adding a second learning system, so it remains append-only calibration evidence for human TRAIN correction and replay.
- The existing current-copy physical centering contract remains authoritative and untouchable. TRAIN reuses only human-authored design boundaries and anchors, never an old card's physical centering result.
- Front and Back verification work runs simultaneously against the same captured Memory snapshot. Results remain deterministically Front then Back, failures wait for the sibling request to settle, and mismatched detector versions reject the pair before persistence.
- SAM 3 remains the only detector. Detector and Memory thresholds, grade formulas, measurement behavior, capture/calibration, and the `GLOBAL` Memory bank were not changed.

## 3. Implemented direct production path

### TRAIN and map foundation

- Added category-aware exact map identity with Unicode NFKC, trim, case-fold, and repeated-whitespace normalization only. Punctuation is significant; lookup has no fuzzy, neighboring, or fallback selection.
- Sports keys include category, year, manufacturer, product set, insert, parallel, player/card name, and card number. Pokemon keys include category, year, product set, parallel, card name, and card number without invented manufacturer/insert fields.
- The read-only 50-card corpus audit produced 34 exact keys and nine repeat-card groups. Omitting subject/card name or card number caused unsafe collisions, so both remain in the key.
- Added captured-card and immutable completed-card TRAIN entry points for human Front/Back design boundaries, four anchors, and classified print/context zones.
- Added immediate save/edit/restore-as-new activation, immutable revision history, current-revision pointer, captured-session revision pinning, and completed-source map-only writes.
- Current-copy OpenCV registration locates only saved human anchors, transforms the human-authored boundary/zones, binds registration to the submitted physical quad and authoritative inspection hashes, and feeds the existing centering correction/formula path.
- Every capture save now resolves the exact active map server-side. An active map cannot be bypassed by omitting the client binding; the unchanged no-map path remains available only after the exact lookup returns no map.
- Captured TRAIN save/restore row-locks and reloads the session and can repin it only while reviewed findings, grade report, and filter decisions remain pristine. Completed sources retain their separate map-only behavior.
- Boundaries, anchors, and zones reject collapsed, self-intersecting, or singular geometry. Existing coordinates are prefilled only when their immutable reference image and physical-quad hash match the selected source; a sibling copy starts from that current copy rather than transplanting old coordinates.

### Full-auto filtering, audit, restore, and replay

- Added the frozen `human-zone-full-contour-containment-v1` rule under `speedster-map-filter-containment-v1` using exact pinned map/revision/policy/registration geometry. Its versioned overlap evidence uses contour-segment containment, so a concave-zone edge crossing remains in review even when every contour vertex is inside; boundary contact remains contained.
- Initialization writes active review findings, the recalculated grade, and complete immutable filter decisions in one serializable transaction.
- Each filter decision retains the original finding snapshot, Detector/Memory provenance, available generating exemplar, supporting views, map/revision/zone, overlap geometry, exact policy inputs, detector version, and filter time.
- The private audit separates `HUMAN_REMOVED` and `FILTER_REMOVED`, supports the approved provenance filters/grouping, renders owned crop/evidence and rationale, and exposes the one-click correction path.
- Added a zero-write replay engine and local JSON CLI that separate contaminated training cards from held-out cards and report coverage, retention, grade effects, centering/boundary comparisons, exact decisions, and immediate alerts for any filtered real finding.

### Simultaneous Front/Back and instrumentation

- Front and Back scanning use `Promise.allSettled` with the same one Memory snapshot. The lane preserves payloads, exact outputs, deterministic ordering, failure semantics, and no-overlap retry behavior.
- Client timing covers first observable interaction, capture/geometry, review actions, completion, truthful Next-ready, and separate post-cycle work.
- Backend timing covers image/view stages, localization, SAM and Memory, measurement, service time, completion authority, and post-cycle presentation.
- Per-finding fusion provenance survives into telemetry and immutable filter evidence while being stripped from active browser/persistence payloads that do not own it.
- Telemetry is fail-open only after authoritative review/restore writes. Forced telemetry failures in tests cannot change grading or restore success.
- Completion telemetry distinguishes final dispositions, grade calculation, durable completion, Memory readiness, truthful Next-ready, and post-cycle presentation.

## 4. Verification evidence

All verification used Node `20.20.1` where applicable.

| Evidence | Result |
|---|---:|
| TRAIN/contracts/session/geometry/mounted UI | `48/48` passed |
| Related inspection/post-grade | `22/22` passed |
| Map-integrity correction path | `30/30` passed |
| Full-auto filter/replay/restore/audit/review | `53/53` passed |
| Completion/presentation/instrumentation/review/restore focus | `44/44` passed |
| Critic-blocker capture/map/geometry/containment regressions | `50/50` passed |
| Complete Speedster backend suite | `93/93` passed |
| Complete AI Grader V2/TRAIN/filter frontend suite | `284/284` passed |
| Fresh independent exact-commit re-review | GO; no actionable findings |
| Exact changed-file ESLint | clean |
| Production build with `RUN_DB_MIGRATIONS=false` | passed; `76/76` pages |
| Disposable PostgreSQL migration chain | all `86` migrations passed twice; second deploy no-op |
| Whole database package baseline audit | `174/187` passed; `13` unrelated baseline contract-fixture failures |

The disposable validator also passed the retained NFC, Mathematical V1, Card Platform V2, publication, Label V1, comps, inventory, rollback, locking, identity/concurrency, and append-only lifecycle checks. It destroyed its isolated PostgreSQL container and storage; no validation container remained.

An additional whole-package `@tenkings/database` test run built successfully and then reported `174/187` tests passing. The one advisory-lock inventory failure and twelve Mathematical V1 fixture/contract failures are not caused by this branch: `packages/database/src`, `packages/database/tests`, `packages/shared`, and `frontend/nextjs-app/lib/server/aiGraderProductionApi.ts` are byte-identical to base `f44ff89b`. The first stale assertion expects five production API advisory locks although the base already has seven; the other twelve use stale Mathematical V1 contour fixtures. These unrelated baseline failures were recorded rather than repaired outside the approved Speedster scope.

The deterministic local simulated-detector benchmark used two warmups and 20 measured pairs per strategy. Sequential pair p95 was `45.735 ms`; concurrent pair p95 was `25.439 ms`, with zero failures and exact finding/order/provenance/measurement and grade equivalence. This is local implementation evidence, not a live RunPod performance claim.

The optimized production build passed Prisma generation, required workspace builds, Next lint/type validation, compilation, all `76/76` static pages, the new TRAIN/filter/audit/restore/instrumentation/presentation routes, and the Sharp trace verifier. Standalone TypeScript reported only known unrelated workspace/test-fixture baseline errors and no changed Speedster-path error.

Local read-only browser QA reached both `/admin/ai-grader-v2` and `/admin/ai-grader-v2/removed-findings`, but neither local browser had an authenticated Speedster session. Both correctly stopped at `Sign in to Speedster`. No credential, cookie/storage manipulation, authentication bypass, map save, restore, grade, provider call, or other mutation occurred. Mounted component behavior is covered by the executable frontend suite, but authenticated visual acceptance remains outstanding.

A fresh independent read-only critic re-reviewed exact implementation commit `35df8e494b09a79c2b3f9d71574bca9b4edc1e69` after the root corrections and returned GO with no actionable findings. Its independent evidence passed the complete relevant frontend suite `284/284`, complete backend suite `93/93`, focused regression subset `54/54`, registration subset `4/4`, changed-file ESLint, diff checks, and additional geometry/multiple-contour probes. The GO is for owner handoff only; it does not authorize deploy, push, merge, migration, or Production mutation.

## 5. Evidence still required

**defect filter verification: PENDING**

No trained map set or owner-reviewed 50-card truth/replay input currently exists. The frozen corpus manifest identifies the 50 cards, but it does not contain map revision IDs or ground-truth finding labels. No replay result, false-finding reduction percentage, real-finding retention rate, or filter acceptance claim was fabricated.

The following also remain unproven:

- a complete physical, authenticated, instrumented handle-to-ready run;
- the actual 90-second result, including every required review action;
- a predeclared consecutive real-card acceptance set and its p50/p90/maximum;
- live RunPod endpoint/image/worker/queue behavior and warm-pair p95;
- physical iPhone/camera transfer timing;
- authenticated TRAIN editor and removed-findings audit visual screenshots; and
- owner acceptance of the trained maps, replay evidence, and complete workstation.

Therefore the current program conclusion is **NOT YET PROVEN** as a 90-second workstation and **not release-authorized**. Implementation verification is ready for owner review; operational acceptance is not.

## 6. Smallest safe next owner decisions

1. Decide whether to authorize a local or separately controlled authenticated TRAIN session to create the initial maps and collect visual evidence. This would mutate the explicitly selected non-Production environment and is not authorized by this handoff.
2. Provide or approve the exact 50-card map-revision and truth labels needed for zero-write replay. Until the replay passes the owner's retention and contamination criteria, keep `defect filter verification: PENDING`.
3. After filter acceptance, separately authorize a release and any database migration through the deployment runbook.
4. After release, predeclare the physical acceptance-set size/pass criterion and measure every consecutive run from physical handling through durable grade and truthful Next-ready. Do not exclude slow, failed, or retried cycles.

No deploy, push, merge, Production mutation, provider/RunPod change, camera/NFC/Dell action, ambient database access, Memory cleanup, destructive operation, or scope expansion was performed for this implementation.
