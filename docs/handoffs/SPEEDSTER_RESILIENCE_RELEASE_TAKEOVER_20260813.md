# Speedster resilience release takeover — 2026-08-13

This is the authoritative takeover snapshot for the three owner-approved releases begun on 2026-08-13. Runtime, database, provider, and current-code evidence still supersede this document. Correct this file and `SESSION_LOG.md` if later evidence differs.

## Copy/paste prompt for the next lead orchestrator

You are the new lead reviewer, implementation owner, investigator, deployment owner, and multi-agent orchestrator for Ten Kings Speedster Card Maps.

Repository: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`

Production: `https://collect.tenkings.co`

Current date/timezone: 2026-08-13, America/Los_Angeles.

Before acting, read completely:

- `AGENTS.md`
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`
- `docs/handoffs/SPEEDSTER_90_SECOND_WORKSTATION_HANDOFF.md`, if present
- `docs/ai-grader-v2-speedster-master-plan.md`
- `docs/handoffs/SPEEDSTER_RESILIENCE_SHARED_CONTRACT_20260813.md`
- `docs/handoffs/SPEEDSTER_RESILIENCE_RELEASE_TAKEOVER_20260813.md`

Trust runtime, database, provider, and current code over docs. Correct conflicting docs in the same session. Use separate clean worktrees and non-overlapping subagent ownership. Independently verify every subagent's work and tests.

Repeat this entire charter verbatim in every subagent assignment:

“You are working on Ten Kings Speedster, a production grading system. Preserve authoritative identity, physical-card geometry, human review, immutable evidence, auditability, exact Front/Back separation, and deterministic behavior. Do not change SAM models, detector thresholds, Memory thresholds, grading formulas, card identity authority, images, or unrelated workflows. Never guess or silently fall back when map integrity or registration fails. Preserve all raw Detector and Memory evidence. Smart Marks always remain. Existing completed cards, grades, labels, reports, images, and permanent-card records are immutable. Do not deploy, push, merge, migrate, mutate Production, or expand scope without the lead agent’s explicit assignment and the owner’s authority. Run focused tests and return exact commands, outputs, changed files, remaining risks, and commit hash. Do not claim success without evidence.”

Mark approved these releases in this strict order:

1. Detection resilience: preserve a successful side; retry only the side whose RunPod `/detect` request returned an actual HTTP 502, once; sequential Front then Back; visible and logged side/request/worker/timing; side-specific errors.
2. Registration robustness and human rescue: deterministic redundant feature tracking, RANSAC/score/reprojection gates, draggable failed anchors, server validation, all-or-none Front/Back map application, and immutable exact-revision/side registration lessons.
3. Card Maps-only library/list page, originally commit `61e90ab9`, after correction and revalidation.

Queued blueprint only—do not implement without new owner approval:

- Memory lesson location binding: side + normalized location + physical condition zone.
- Auto-Build Zones.

No model, image, detector threshold, Memory threshold, grading formula, PhotoRoom, identity-authority, or unrelated workflow change is authorized. Deploy each active release only when green through the normal protected PR, required CI, Vercel Preview, merge, and Production process. Do not bypass checks.

Continue from the exact state and evidence below. Do not redo completed release 1. Do not claim releases 2 or 3 are live until their exact web/schema/RunPod behavior is proved.

## Speedster principles and product contracts

- Card identity is authoritative and exact. Never fuzzy-match a map.
- Family key for Pokemon is Category + Year + Product/Set + Parallel. Name and card number are exact-source provenance only.
- Family key for Sports is Category + Year + Manufacturer + Product/Set + Insert + Parallel.
- One authoring save creates complete FAMILY and EXACT revisions atomically. Exact is a complete replacement over Family; maps never merge at runtime.
- Lookup is exact map, then family map, then normal human review.
- The current card always uses its own physical-card quad. Registration moves saved printed-design geometry to the current copy.
- A registration failure must never guess. Human correction is explicit and server-validated.
- Front and Back are exact, independent evidence surfaces. Neither rescued side applies until both sides validate against one immutable map revision.
- Detector and Memory run first. Raw candidates and provenance remain immutable and auditable.
- Card Map filtering removes only qualifying already-detected findings from normal review. It never prevents detection.
- Partial overlap remains. Smart Marks always remain. Removed findings remain restorable.
- Existing completed cards, grades, labels, reports, images, permanent-card records, identities, maps, and immutable revisions must not be rewritten.
- Hash authority is server-owned canonical content. Evidence, revisions, lessons, and deployment images must be exact and verifiable.
- Failed saves, scans, registration, and lesson persistence must preserve operator work.
- The 50-card calibration replay may be waived only where the owner explicitly did so; never relabel an inconclusive replay as PASS.

## Release 1 — detection resilience — LIVE

Worktree: `/Users/markthomas/tenkings/.codex-worktrees/speedster-detect-502-resilience-20260813`

Branch: `codex/speedster-detect-502-resilience-20260813`

Reviewed implementation: `efab3142e6484c4b742437793990cb7a3ef639dd`

PR: `https://github.com/MarkTenKings/tenkings-backend/pull/327`

Merge commit on protected main: `5feca1c408cdad0c90ac60ae27c0f5c25d15dd3d`

Production Vercel deployment: `dpl_9cWTWqRHDg6woXusSPbeisCBEoM5`

Evidence:

- 12/12 PR checks passed.
- Two independent reviewers returned GO.
- Full relevant suite passed 363/363; focused suites passed 100/100 and 96/96.
- Full `RUN_DB_MIGRATIONS=false pnpm vercel:build` generated 77/77 pages.
- Post-merge CI run `31683099152` passed build, disposable migration validation, and all eight image builds.
- Signed-in Production displayed sequential Front-then-Back scanning and request-ID/RunPod retry copy.
- No synthetic 502 was induced in Production and no card was mutated.

Behavior now live:

- Front runs before Back.
- Only an exact upstream RunPod HTTP 502 retries, on that same side, once.
- A successful side is not rescanned.
- Network errors, timeout, 500/503/504, malformed evidence, wrong side, or other errors do not retry.
- Attempt logs bind side, request ID, attempt, status, worker identity when available, and timing.

An unmerged documentation-only commit `98fef3816f9327ff3572ce5cbc4e2d506741fa53` records release-1 Production evidence. Reconcile its two documentation files into the next release; do not cherry-pick blindly if `SESSION_LOG.md` conflicts.

## Release 2 — registration robustness/rescue — IMPLEMENTED AND LOCALLY GREEN, NOT LIVE

Worktree: `/Users/markthomas/tenkings/.codex-worktrees/speedster-registration-rescue-20260813`

Branch: `codex/speedster-registration-rescue-20260813`

Original agent commit: `9b97d2191e35212d3063b02f44b006a21c1be1d0`

Rebased implementation commit over current `origin/main`: `51ef48a3`.

Migration proof commit: `f6315e71`.

Orientation/foldover correction: `7cfcb3d3b0e0d517d7bccfc21fb41455b9e35d30`.

Final authority/provider/pointer hardening: `a63742ec8a8f7050e6cf3e13b23e0d1b68426623`.

The branch was clean after the rebase except for this takeover document and any later follow-up commit listed by `git log`. Always inspect `git status`, `git log`, and `git diff origin/main...HEAD` first.

Implemented surfaces:

- Backend registration algorithm `opencv-redundant-ransac-registration-v2`.
- Bounded Shi-Tomasi features around each human landmark, forward/back LK scoring, deterministic RANSAC.
- Shared acceptance policy `speedster-map-registration-acceptance-v2` with per-anchor support, inlier count/fraction, score, reprojection, transform, in-card, boundary, and zone checks.
- Safe 422 diagnostics containing tracked/failed/off-card anchors and no applicable transform.
- Human rescue overlay showing global failure, expected/tracked anchors, per-anchor confidence, and draggable handles.
- Front/Back remain provisional and apply all-or-none only after both validate against the same revision.
- Rescue requests bind exact side, active revision, current evidence hash, physical quad hash, and ordered candidate/reference hashes.
- Current prepared evidence is copied to a private, attempt-specific, write-once, hash-verified object before it can become lesson authority.
- Bounded 55-second map-registration upstream request; no automatic registration retry; late upstream results cannot persist a lesson.
- Serializable idempotent lesson persistence with same-attempt conflict verification.
- At most three exact revision/side lessons are eligible later as hash-verified reference candidates.
- Additive append-only registration-lesson table, constraints, FKs, canonical hash, and UPDATE/DELETE rejection trigger.
- Legacy v1 registration remains parse-compatible in the new web.

Agent validation before rebase:

- Focused frontend/session/lesson/capture: 60/60 passed.
- Backend full: 98/98 passed.
- Backend registration: 9/9 passed.
- Changed-file ESLint passed.
- `git diff --check` passed.

Lead blockers already fixed by that commit:

- active-pointer/evidence/candidate drift rejection;
- immutable snapshot rather than mutable prepared key;
- P2002/P2034 concurrent attempt handling;
- server timeout/late completion containment;
- global failure UI and LOW_CONFIDENCE region diagnostics.

Independent review held the first candidate and the following corrections are now present on the stable head:

- DigitalOcean Spaces-compatible content-addressed immutable evidence with bounded reads, exact pre/post hashes, checksum PUT, no unsupported `If-None-Match`, and concurrent identical-byte convergence.
- Shared Python and authenticated Next orientation checks reject reflection, crossed anchors, card-domain poles/folds, and inconsistent signed orientation.
- The lesson transaction locks/rechecks the selected current revision; FAMILY rescue also proves no EXACT map became applicable before insert.
- Every new v1/v2 registration requires a dedicated server-only HMAC receipt bound to operator, session, revision, side, evidence, physical quad, and exact finite-number registration. The proxy verifies the exact candidate roster before signing. Human and lesson-based automatic results reverify immutable database/evidence authority at final capture. Capture persistence is canonical and strips receipts/unknown browser fields.
- The migration is explicitly transactional and the disposable PostgreSQL fixture proves catalog, valid insert, FK/CHECK rejection, UPDATE/DELETE rejection, rollback, zero rows, ledger stability, and second-deploy no-op.

Final local evidence on stable head: focused authority/capture/lesson tests `56/56`; relevant AI Grader/Speedster tests `389/389`; backend registration `15/15`; full backend `104/104`; changed-file ESLint and diff-check green; Production build green with all `77/77` pages; disposable migration chain green through all `87` migrations and second-deploy no-op.

One independent receipt/security reviewer returned GO on the stable implementation. Do not deploy release 2 until two independent exact-head implementation/deployment reviews return GO, the PR and all required CI checks are green, and the dedicated Vercel Production receipt secret/key ID have been provisioned without exposing the secret.

### Required safe deployment order for release 2

The new RunPod service is not backward-compatible with the old Production web request/parser. Never deploy the service first.

1. Inspect Production read-only: migration ledger has no failed/unfinished migration; new table/function/trigger are absent; lesson count is necessarily absent/zero.
2. Prove the final migration on disposable PostgreSQL, including second-deploy no-op and DB-level immutability fixture.
3. Build and push a Linux/amd64 GHCR Speedster image from the exact reviewed PR head, record tag, OCI digest, platform, Dockerfile, and source SHA. Do not activate it yet.
4. Set Production-only `RUN_DB_MIGRATIONS=true` for the one reviewed Vercel deployment and record the planned action in `SESSION_LOG.md` first.
5. Merge only after all normal checks and Preview are green. The Vercel build must apply the additive migration and then make the new web live. New web accepts old v1 service responses.
6. Verify exact Vercel merge/deployment and new schema/table/function/trigger/ledger, then immediately restore `RUN_DB_MIGRATIONS=false` and verify it.
7. Confirm RunPod has zero jobs in progress/waiting. Update only endpoint `we730z8vl8o3tm` to the exact reviewed image. Preserve all endpoint configuration and models.
8. Verify current workers use the exact image/digest and `/ping` plus `/health` are healthy.
9. Verify signed-in Production page/bundle and read-only API behavior. Do not manufacture a lesson or mutate a card. Mark performs the natural real-card rescue test afterward.

Rollback order:

- Service rollback to the old image is compatible with the new web.
- If web rollback is necessary after service v2 is active, roll the service back first, then web.
- Leave the additive schema in place and inert. Do not drop the table/function/trigger or delete lessons as rollback.

RunPod read-only baseline captured before this release:

- Endpoint `we730z8vl8o3tm`, `ten-kings-speedster-sam3-lb-d2bc4b5b`.
- Release 15.
- Image `ghcr.io/marktenkings/tenkings-backend/ai-grader-speedster-service:a67ae0fa...`.
- Two running workers and zero jobs at the captured baseline; additional workers could initialize/throttle and must be rechecked at cutover.
- Balance observed: $11.82.

Vercel baseline:

- Project `tenkings-backend-nextjs-app`, ID `prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI`.
- CLI authentication works as `mark-1842` through `npx --yes vercel@latest`.
- `RUN_DB_MIGRATIONS` exists as a sensitive Production variable; its value cannot be read through `env pull` because Vercel redacts it. Treat current value as unknown and explicitly set/reset it during the reviewed deploy.
- Current Production deployment before release 2 is `dpl_9cWTWqRHDg6woXusSPbeisCBEoM5`.
- The release requires newly generated server-only `SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY` and `SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID` values. Never reuse or expose the workstation Card Format Authority key. Record only presence/format and key ID, never the secret.

## Release 3 — Card Maps-only list — IMPLEMENTED AND INDEPENDENTLY GREEN, NOT LIVE

Worktree: `/Users/markthomas/tenkings/.codex-worktrees/card-maps-library-20260812`

Branch: `codex/card-maps-library-20260812`

Original list commit: `61e90ab93a4bf74d981bc90f5f76aa797b022f8c`

Rebased list commits: `fc128ed3`, `31cdef89`.

Authenticated-transition privacy fix: `44e41242`.

Clean server-side review results:

- Admin-only, GET-only list.
- `no-store` on success and failure/auth paths.
- Creator-only CAPTURED-source visibility.
- COMPLETED map-source visibility for admins.
- Fail-closed revision/hash/source identity/provenance validation.
- Explicit FAMILY/EXACT current state per row.
- Authoritative edit navigation.
- No mutation of completed cards or maps while listing.

The authenticated-transition privacy race is fixed: rows clear immediately when admin identity/token changes, requests are aborted and generation-bound, and a late prior-admin response cannot overwrite the current view. Independent reviewer returned GO after focused `10/10`, relevant `96/96`, full Speedster `378/378`, clean lint/diff, and Production build `77/77`. Rebase and re-run exact-head checks only after release 2 is fully live; deploy release 3 afterward through a separate normal PR.

## Blueprint-only result — Memory location binding

No code or runtime state changed.

Finding: Memory V2 is spatially blind. It strips side from source views; lessons retain no side, normalized location, physical condition zone, evidence hash, or trace hash; matching is defect type + view type + cosine similarity; Smart-Mark lesson search spans the whole card.

Recommended V3 eligibility requires exact match on side, defect type, source view, anchor condition zone, replay-selected physical distance, and the unchanged cosine policy. Bind canonical 1270x1778 frame, normalized anchor, inclusive bounds, physical zone, fingerprints, provenance, source/session/trace hashes, and lesson hash. No missing-field fallback or global search. Keep V2 active while V3 is shadow-only; rebuild from completed authoritative findings rather than V2's location-stripped cache.

Mandatory replay corpus:

- Corpus SHA-256 `255e3b81adf97562920e1b9da766c568d156aea210aeda21f9920261df125ad5`.
- 50 cards, 2,292 human outcomes, 508 human-kept real, 1,784 human-removed fake.
- Replay chronologically using only earlier lessons.
- Select physical radius by a predeclared grid; do not guess.
- Activation requires zero hidden kept defects, zero suppressed Smart Marks, deterministic reruns, complete evidence, and owner review.
- Existing corpus lacks exact image hashes and raw pre-veto proposals, so full proposal-generation certification is currently `INSUFFICIENT_EVIDENCE`; prospective shadow instrumentation must capture it.

## Blueprint-only result — Auto-Build Zones

No code or runtime state changed.

Recommended design is a versioned deterministic server proposal engine over exact hash-bound rectified evidence, with a narrowly named Pokémon layout template, bounded grayscale/Sobel snapping, deterministic tie-breaking, weak-evidence `REVIEW_REQUIRED`, local dashed preview, full operator accept/edit/remove review, whole-map undo, and no persistence until the existing atomic Family + Exact save.

Keep content type, semantic type, filter authority, and authority source independent. Content labels such as artwork/header never themselves enable filtering. Auto-Build changes zones only, never anchors or printed boundary. Compatible-map copy requires an explicit immutable layout compatibility key and exact operator-selected source revision; no fuzzy inference.

Mandatory Auto-Build gate is 50 held-out compatible cards excluding the template card, 100/100 Front/Back registration success, complete raw Detector/Memory evidence, zero hidden human-kept defects, 100% Smart Marks retained, and a canonical hash-bound report. Missing evidence is `INCONCLUSIVE`; one hidden real defect is FAIL.

Unresolved owner decision before implementation: the exact first Pokémon layout included by the template. Existing Category/Year/Set/Parallel cannot safely distinguish standard Pokémon, Trainer, Energy, and full-art layouts.

## Current orchestration state

- Registration implementation is committed at exact head `a63742ec8a8f7050e6cf3e13b23e0d1b68426623`; the takeover-document commit follows without runtime code changes.
- Fresh exact-head implementation and deployment re-reviews are the next gate.
- Lead then provisions the dedicated receipt authority, opens the normal PR, enforces all CI, deploys schema/web/backend in the documented compatibility order, and records read-only and signed-in evidence.
- Only after release 2 is fully live and verified may release 3 be rebased/retested/reviewed and deployed.

Always run `collaboration.list_agents` and collect all pending final reports before taking over their files.

## Completion evidence still required

Release 2:

- Final commit(s) after migration follow-up.
- Two independent GO reviews on exact rebased candidate.
- Focused suites, backend full suite, relevant full frontend suite, lint, typecheck, full Production build, disposable migration twice, and DB-level fixture.
- PR URL, 12/12 checks, merge SHA, Vercel deployment ID/commit.
- Production migration ledger, table/function/trigger, zero lesson baseline, flag reset false.
- Exact GHCR image tag/OCI digest/platform/source, RunPod release/workers, `/ping` and `/health`.
- Signed-in Production UI/API proof and natural operator test handoff.
- Geometry timing from the next natural card; never fabricate it.

Release 3:

- Auth-transition race fix commit and regression test.
- Rebase onto then-current main.
- Independent GO, full test/build/CI evidence.
- PR, merge, Vercel Production exact commit.
- Signed-in `/card-maps` proof showing only card-mapped cards, explicit FAMILY/EXACT state, and working edit links.

Final report must clearly distinguish what is live from what is implemented/not live, list every remaining risk, and never claim success from deployment alone.
