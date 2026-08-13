# Speedster Detection and Card Map Recovery Contract — 2026-08-13

## Scope and release order

Three separately reviewable releases are authorized, in this order:

1. RunPod HTTP 502 detection resilience.
2. Card Map registration robustness and explicit human anchor rescue.
3. The existing Card Maps-only library from commit `61e90ab93a4bf74d981bc90f5f76aa797b022f8c`.

Each release must start from the then-current protected `origin/main`, pass focused and relevant full validation, use the normal PR/check/merge/Vercel Production path, and receive signed-in Production verification before the next release is deployed. Memory lesson location-binding and Auto-Build Zones remain blueprint-only and must not be implemented in these releases.

No release may change SAM models or images, Detector thresholds, Memory thresholds, grading formulas, PhotoRoom, identity authority, existing completed evidence, or unrelated workflows.

## Detection-resilience contract

- Front and Back remain independent evidence and are dispatched sequentially for reliability.
- A successful side result is retained in memory and is never rescanned merely because the other side receives an upstream HTTP `502`.
- Exactly one automatic retry is permitted only when the RunPod `/detect` response status is exactly HTTP `502`. Network errors, timeouts, HTTP `500`, `503`, `504`, validation failures, and all other failures are not retryable under this exception.
- The retry reuses byte-identical side, image, Memory-bank, session, and detector inputs while using a distinct bounded attempt/request trace identifier.
- Both original and retry attempts record operator-safe structured evidence: side, request/trace ID, attempt number, upstream status, worker identity when supplied by the service/platform, and client/server/service durations. Missing worker identity is recorded explicitly as unavailable; it is never guessed.
- The UI visibly identifies the side being scanned and, after a retry, that a one-time RunPod 502 retry occurred. A terminal error names the failed side and request ID without exposing credentials or private object-storage URLs.
- No partial detector result is committed as reviewed evidence, grading input, or learning authority until both sides succeed. A final failure preserves the capture and the successful transient side result only for the bounded in-flight operation; it does not fabricate a completed scan.
- Existing Detector and Memory evidence semantics, raw provenance, Smart Marks, thresholds, models, measurements, grading, and map filtering are unchanged.

## Registration and human-rescue contract

- Runtime lookup remains exact map, then family map, then normal human review. Exact and family maps never merge.
- The current copy's own physical-card quad remains authoritative. Saved printed boundaries and zones are projected only through a validated current-copy registration.
- Automatic registration must use meaningful redundant correspondences before applying RANSAC; invoking RANSAC on only four homography points is not acceptable coverage or implementation.
- Acceptance is server-owned and deterministic. It must include explicit per-anchor/feature scores, minimum inlier count/fraction, bounded reprojection error, finite/in-card geometry, non-degenerate transform, and coherent projected boundary/zones. Thresholds are registration-only and must be versioned and tested; Detector and Memory thresholds remain unchanged.
- Automatic failure returns bounded diagnostics and the tracked anchor proposals, including failed/low-confidence status. It never returns an applicable transform and never silently guesses.
- Front and Back remain all-or-none for map application. A safely registered side may remain provisional while the failed side is corrected, but neither map side is applied to grading/filtering until both sides have a validated registration for the same immutable revision.
- The human-rescue UI overlays expected and tracked anchors on the current copy, clearly marks failed/low-confidence anchors, and permits the operator to drag anchors to the intended landmarks. It must preserve the original images, physical quads, map revision, and all existing authoring evidence.
- Human confirmation is submitted to the server, where the corrected four-anchor transform and projected geometry are recomputed and validated. The browser cannot author the final transform, confidence, or acceptance decision.
- A confirmed correction is persisted as a new immutable, hash-verified registration lesson bound to tenant/operator, immutable map revision, side, exact current evidence key/hash, original expected anchors, automatic proposals/scores/failure reason, human-corrected anchors, validated transform/result, algorithm/policy version, and timestamp.
- Lesson creation and the returned rescued registration are atomic. A persistence/hash failure keeps the rescue UI and work intact and applies no lesson or map.
- Future registration may consider the original reference and compatible lessons in deterministic order. Every candidate retains provenance and must independently pass the same acceptance gates. If none passes, the system returns to human rescue or normal review; it never guesses or selects an unrelated lesson.
- Lessons never rewrite a Card Map revision, source image, completed card, grade, report, label, permanent-card record, identity, or prior registration evidence. Revision restore creates/restores map revisions under the existing immutable contract and does not mutate lesson history.

## Card Maps library contract

- Revalidate commit `61e90ab93a4bf74d981bc90f5f76aa797b022f8c` against the then-current `origin/main`; do not deploy it by bypassing the first two releases.
- `/card-maps` receives a dedicated searchable list containing only coherent, current Card Map source cards. It must not reuse the general completed-card list.
- Every row shows enough canonical identity and FAMILY/EXACT revision state to identify the map and links directly to append-only editing through the authoritative source session.
- Listing is admin-protected, no-store, read-only, hash/integrity checked, and fail-closed. It must not create, activate, restore, or mutate any map or card merely by loading.

## Required verification

- Focused unit/integration/UI tests must cover every bullet above, including exact 502-only retry boundaries, side-result preservation, side-aware messages, meaningful RANSAC redundancy, acceptance/rejection gates, rescue drag/confirm, lesson atomicity/hash/provenance, future lesson-assisted success, fail-closed lesson rejection, Front/Back all-or-none behavior, legacy map compatibility, and library integrity filtering.
- Run relevant full suites, changed-file lint, type checks, Production build, migration validation if and only if an additive lesson schema is required, and an independent adversarial review.
- Before every deployment or migration append the planned action to `docs/handoffs/SESSION_LOG.md`; afterward append exact PR, commit, deployment, API/UI/database/runtime evidence and remaining risks.
