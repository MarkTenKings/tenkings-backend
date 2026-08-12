# Ten Kings AI Grader V2 Speedster — Master Plan

Date: 2026-08-02
Status: Core workflow, native-iPhone capture, completed-card workspace, multi-admin isolation, V1 reviewed-defect memory, two-worker SAM 3 capacity, aligned Worker source, and post-grade PhotoRoom report presentation are live. Multiple complete user-run Production grading tests, including PhotoRoom Front/Back output, passed on 2026-08-02. The 2 mm inspection frame is built and under release validation; the approved SAM Memory V2 follows it.
Purpose: Source of truth for the smallest production-ready Speedster architecture

## 2026-08-11 Card Map authority supplement

- One reviewed authoring action creates both FAMILY and EXACT immutable Card Map revisions in one database transaction; the UI must not ask the human to choose a creation scope.
- Pokémon FAMILY keys are Category + Year + Product/Set + Parallel. Sports FAMILY keys are Category + Year + Manufacturer + Product/Set + Insert + Parallel. Subject/card name and card number belong only to exact identity and source provenance.
- The runtime order is EXACT, then FAMILY, then normal human review. A selected map is complete and never merges with another. Malformed/hash-invalid maps or registration failure never guess or transplant the source card's physical quad.
- The current copy always uses its own physical-card geometry. Human registration anchors transform the saved design boundary and zones onto that copy.
- Both revisions retain exact source imagery and provenance. One deterministic server-owned persisted-content payload controls hashing; both read-back verifications and current-pointer moves are atomic and revision history remains append-only.
- Failed saves retain the full draft and offer Retry and Export; Import restores the source-bound draft without saving automatically.
- The v2 content/filter split and deterministic `0.6 mm` physical-card dilation are implemented. Text/logo/border defaults On; artwork/foil/other defaults Off; each remains adjustable. Historical v1 revisions remain byte-compatible and restorable. The known 50-card audit is still `INCONCLUSIVE`, not a pass: 2,292 human outcomes exist, but there are zero compatible MEW-family cards, zero compatible registrations/revision bindings, and no exact evidence hashes. On 2026-08-12 Mark explicitly waived that replay gate for v2 activation, accepting sole-grader review plus the removed-findings audit as the safety net. This owner waiver authorizes activation; it does not convert the replay status into a pass.

## 1. Mission

Build a premium, extremely fast Ten Kings grader that turns one front image and one back image into a transparent, measurable grade with minimal human work.

V1 remains active and untouched. The existing Human Grade workflow also remains active and is the default behavior on `/admin/human-grade`. V2 uses its own admin route, grading sessions, evidence, rules, and detector boundary while intentionally reusing the proven Human Grade identity editor and 16-label printing system. It does not depend on the V1 local helper, Basler, Leimac, Dino-Lite, OCR, or 72-image workflow.

## 2. One-Sentence Architecture

Every image yields one exact physical grading grid plus one aligned inspection frame with 2 mm of original-photo context, inspection views are scanned independently and merged back onto the grading grid, the human fixes mistakes, deterministic Ten Kings math produces the grade, and reviewed evidence improves the next card.

## 3. Speedster Workflow

1. **Create card** — Human clicks **New Speedster Card** inside `/admin/ai-grader-v2`. The first Speedster step displays the same proven Sports/Pokemon identity editor and live label preview as Human Grade, without navigating to another page.
2. **Capture** — The mounted iPhone native Camera sends the newest Front/Back pair through one permanently paired Shortcut. The page shows both thumbnails with Retake and Swap before geometry. Manual upload remains only as the initial test path.
3. **Set geometry** — OpenCV proposes the four physical card corners. Human moves only incorrect points and confirms the card shape/radius.
4. **Prepare aligned maps** — Every image produces the unchanged `1270x1778` known-dimension card grid plus a `1350x1858` inspection map with exactly 2 mm of original-photo context on every side. Both come from the same approved four source corners.
5. **Measure centering** — Human confirms the design-border geometry; deterministic code calculates front and back centering.
6. **Scan inspection views independently** — OpenCV and SAM 3 inspect the expanded original/reveal views. Candidate prompts may see exterior context, but masks are clipped to physical card material and converted back to the canonical grid before measurement.
7. **Fuse onto one card map** — Masks that overlap within geometric tolerance become one canonical defect with multiple supporting views. They are never double-counted.
8. **Human review** — The expanded original-color inspection image is the master review image. Canonical markers map through one shared frame contract; magnification, Smart-Mark, and evidence close-ups can reach every edge and corner without changing grading coordinates.
9. **Grade, label, and learn** — Deterministic rules calculate all four sub-grades, durably complete the report and label, and update the compact reviewed-example learning bank.
10. **Create report presentation images** — Only after durable grading completion, one isolated PhotoRoom adapter removes the backgrounds from the expanded Front and Back inspection images and stores separate transparent presentation PNGs on the same canvas. Canonical rectified evidence remains immutable grading authority; PhotoRoom output never enters detection, measurement, scoring, or learning.

## 4. Human Grade and Label-System Reuse

The existing `/admin/human-grade` page remains the Human Grade entry point and the home of label-sheet operations. Speedster reuses its underlying editor and printing components without sending the operator into the Human Grade route.

### Existing Human Grade path

- **Add New Graded Card** remains the default action and preserves its present behavior.
- Existing human-graded records, certificate numbering, calculations, label layout, queue, editing, deletion, PDF generation, and 16-up pages remain usable.
- Speedster changes must not block or alter this workflow.

### Speedster path

- The operator remains inside `/admin/ai-grader-v2` for the complete Speedster workflow.
- Clicking **New Speedster Card** opens the reused Sports/Pokemon selector, identity fields, clean label-composer UI, and live preview as Speedster Step 1.
- In Speedster mode, sub-grades are not entered manually and the primary action becomes **Continue to Photos**.
- **Continue to Photos** creates the V2 grading draft and advances directly to Speedster Step 2 on the same page/workspace.
- A draft does **not** consume a printable label slot.
- After the Speedster grade and report are completed, the authoritative V2 sub-grades automatically populate the label and add it to the existing 16-label queue.

### Strict reuse boundary

Extract the existing identity composer into one shared label-editor component used by both `/admin/human-grade` and `/admin/ai-grader-v2`. Reuse the label dimensions, sheet geometry, queue behavior, PDF/printing foundation, and visual assets.

This is component and service reuse, not an iframe, copied code, or page-to-page bouncing. There is one maintained label-editor source of truth. Human Grade and Speedster remain separate operator experiences that render the shared component with different workflow configuration:

- Human Grade supplies manually entered sub-grades and its normal save action.
- Speedster hides manual sub-grade entry, supplies **Continue to Photos**, and later injects the calculated V2 grades.
- Both use the same identity fields, preview, physical dimensions, renderer foundation, and 16-label queue.

Keep grading math outside the shared label editor. Speedster must use its own approved, versioned equal-25% Blueprint engine and must not depend on `calculateHumanGrade` or `HUMAN_GRADE_WEIGHTS`, even after Human Grade also moves to equal weighting. This prevents a future Human Grade change from silently changing a historical Speedster report.

The dedicated Human Grade equal-weighting work is complete and integrated. Its versioned legacy/equal formulas and saved labels must remain intact while the shared editor is extracted. Preserve existing saved labels and printable pages exactly.

### Label layouts

- Add a small label-layout selector using the existing pill-button pattern.
- Every layout keeps the current physical label size and the exact 16-label page geometry.
- The renderer changes only the inner label content for the selected layout.
- Existing records default to the current Human Grade layout so old pages remain unchanged.
- The Speedster/NFC layout can be added later without rebuilding the editor, queue, or sheet renderer.

## 5. Minimum Human Input

| Data | How it is captured |
|---|---|
| Card side | Automatic from the Front or Back upload slot |
| Zone | Automatic from canonical defect coordinates |
| Finish | Optional card-level field later; never required per image or defect |
| View type | Original views default automatically; optional uploaded views require one tap; generated filters are labeled automatically |
| Defect type | Detector preselects it; human changes it only when wrong |
| Reviewer result | Automatic from the review action |

### Review actions

- **Leave untouched** — Accepted automatically when the reviewer completes the card.
- **Remove** — Saved as a false detection/hard negative.
- **Smart-Mark** — Saved as a human-added missed defect.
- **Change type pill** — Saves the corrected defect type.

Initial type pills:

`Whitening/Wear` · `Scratch/Scuff` · `Dent/Indentation` · `Stain/Color` · `Print/Coating` · `Other`

The normal workflow for a correct detection requires zero human actions.

## 6. Geometry and Inspection Zones

- Known physical card dimensions convert pixels into millimeters and square millimeters.
- The canonical grading map remains exactly `1270x1778` at 20 px/mm. It alone owns centering, zones, defect measurement, and grade math.
- The inspection map is exactly `1350x1858`: the same card map inset by 40 px/2.0 mm on every side. It adds visibility, not grading area.
- OpenCV candidates are limited to the inset physical-material mask. SAM prompt padding may extend into context, after which the mask is intersected with card material and cropped to canonical coordinates.
- **Corners:** four fixed 5 mm × 5 mm zones. Only actual card material counts; empty space outside a rounded corner does not.
- **Edges:** the outer 2 mm of card material, excluding the corner zones.
- **Surface:** all remaining card area.
- The three condition zones never overlap.
- Multiple defect masks are unioned before area calculation. If classifications overlap, the highest applicable multiplier is used at each pixel; multipliers are never added together.

## 7. Detection and View Fusion

### Canonical detector output

Every detector implementation returns the same small contract:

- canonical mask
- suggested defect type
- confidence
- source image/view ID
- source-to-card transform version
- optional supporting-filter ID

Exactly one detector provider is active in the production workflow. Speedster contains no backup detector, fallback detector, detector voting, or alternate detector execution path. The human reviewer is the single universal correction layer.

### Fusion rules

- Images are processed one at a time; the workflow accepts two images or many without architectural changes.
- Spatial overlap/proximity on the canonical grid creates one defect with multiple evidence views.
- The best evidence view is chosen for the review close-up, but every supporting view remains accessible.
- Filtered copies derived from the same original are supporting evidence, not independent confidence votes.
- The original color image remains the visible record of the card; source evidence remains linked for auditability.

### Optional software reveal views

Start with no more than three inexpensive OpenCV views:

1. color/contrast normalization for faint color changes
2. bright/dark micro-defect response for whitening and spots
3. directional/high-frequency response for scratches and edge damage

They are generated and labeled automatically. Keep only views that measurably improve defect recall or human-review speed. They do not create new optical information.

## 8. Technology Stack

| Technology | Speedster job | Decision |
|---|---|---|
| Next.js, React, TypeScript | Upload, geometry, review, report, APIs, deterministic grading | Required |
| PostgreSQL and Prisma | Cards, views, transforms, canonical defects, review state, measurements, versions | Required |
| Private object storage | Original photos, canonical rectified evidence, expanded inspection/reveal views, masks, and report assets | Required |
| OpenCV | Corner proposal, rectification, canonical grid, zones, filters, measurements | Required |
| Python and PyTorch detector service | Replaceable execution boundary for vision models | Required capability |
| SAM 3 | Sole production detector and precise mask generator across every canonical evidence view | Required and active |
| Existing SAM 3 encoder features | Zero-extra-inference fingerprint for immediate reviewed-example similarity | Required and active in the learning loop |

Vision LLMs, PatchCore, detector ensembles, and automated fallback detectors are not part of the Speedster architecture.

## 9. One Structured Learning Bank

There is one logical Ten Kings learning system, not separate models or databases
for each view or lighting setup. The current centroid-based V1 is live but
Production evidence proves its `+/-0.06` adjustment cannot suppress the observed
high-confidence text false positives, and Smart-Marks do not yet fingerprint.

The approved replacement is frozen in
`docs/ai-grader-v2-sam-memory-v2-frozen-blueprint.md`:

- completed-session history is the mathematical source of truth and the single
  PostgreSQL JSON row is a derived cache;
- bounded, session-tagged exemplars replace centroids, with capacity 50 per
  defect type/polarity;
- explicit remove, relabel, and Smart-Mark actions teach fully; untouched accepts
  admit at most three stable-order, deduplicated lessons per type/card;
- a strong same-type negative exemplar may veto a candidate only when no
  comparable positive exemplar protects it;
- V2 is veto-only: no lowered SAM threshold and no positive promotion;
- ordinary completion applies the same pure harvest/prune functions incrementally
  and a required equivalence test proves it equals full chronological rebuild;
- calibration is read-only, and the Articuno session correction requires a
  reconstruct/verify/exclude dry-run plus Mark's typed approval.

SAM 3 remains the sole detector. V2 adds no neural-weight update, OCR, vector DB,
second model, learned proposal path, queue, fallback, or reviewer step.

## 10. Ten Kings Scoring Blueprint

### Overall grade

`Overall = (Centering + Corners + Edges + Surface) / 4`

- Each sub-grade contributes 25%.
- Display to the nearest tenth; store full precision.
- No hidden deductions, secret weighting, or subjective override.

### Front/back weighting

Each sub-grade uses:

`Final sub-grade = Front score × 70% + Back score × 30%`

### Centering

- Calculate left/right and top/bottom balance independently.
- Use the direction farthest from 50/50.
- Linearly interpolate decimal scores between boundaries.

| Centering score | Worst centering measurement |
|---:|---:|
| 10 | 55/45 or better |
| 9 | Worse than 55/45 through 60/40 |
| 8 | Worse than 60/40 through 65/35 |
| 7 | Worse than 65/35 through 70/30 |
| 6 | Worse than 70/30 through 75/25 |
| 5 | Worse than 75/25 through 80/20 |
| 4 | Worse than 80/20 through 85/15 |
| 3 | Worse than 85/15 through 90/10 |
| 2 | Worse than 90/10 through 95/5 |
| 1 | Worse than 95/5 or visibly miscut |

### Corners, Edges, and Surface

All three share one weighted-area engine:

`Weighted damage % = sum(non-overlapping damaged area × applicable multiplier) / eligible zone area × 100`

Shared score boundaries:

| Score | Weighted damage percentage |
|---:|---:|
| 10 | 0% through 0.2% |
| 9 | More than 0.2% through 1.0% |
| 8 | More than 1.0% through 2.0% |
| 7 | More than 2.0% through 3.5% |
| 6 | More than 3.5% but less than 5.0% |
| 5 | 5.0% but less than 6.0% |
| 4 | 6.0% but less than 7.0% |
| 3 | 7.0% but less than 8.0% |
| 2 | 8.0% but less than 10.0% |
| 1 | 10.0% or more |

Multipliers remain category-specific as defined in the approved grading blueprint:

- **Corners/Edges:** faint color change 0.5; visible whitening 1.0; fraying 1.25; chipping/exposed stock 1.5; lifting/deformation 2.0.
- **Surface:** faint print/color variation 0.5; light scratch/scuff 1.0; visible scratch/print line/coating loss 1.25; dent/material damage 1.5; peeling/heavy damage 2.0.

## 11. Report Experience

The public report reuses the review visualization in read-only mode:

- PhotoRoom-cleaned expanded Front/Back master presentation images when present
- immutable expanded inspection evidence for magnification and source close-ups, with canonical rectified Front/Back retained as grading evidence
- automatic canonical rectified fallback for reports created before the inspection-frame release
- canonical defect markers and masks
- tap/hover evidence close-up from the best source view
- defect type and exact location
- dimensions, area in mm², eligible-zone percentage, multiplier, and score effect
- centering measurements and ratios
- four sub-grades, 70/30 side math, overall 25% weighting, and full calculation trail

Public viewers can explore evidence but cannot edit it.

## 12. Post-Grading Tool Boundary

NFC, comps, and inventory are finishing tools and never run inside the grading path.

- Every completed Speedster card receives one stable certificate identity and one permanent Ten Kings public report URL.
- The future NFC chip sealed into the slab label will open that exact report URL.
- The future NFC label layout will use the same physical label dimensions and 16-up sheet geometry.
- The existing V1/Dell NFC path was audited. It requires V1 `AiGraderReport`, `CardAsset`, `Item`, `AiGraderLabel`, `AiGraderNfcTag`, reservation, attestation, and the exact `/nfc/<publicTagId>` URL; a Speedster session/report URL cannot truthfully call it yet.
- Existing KingsReview and Inventory were audited. Both are `CardAsset`-backed; KingsReview also requires a TILT image while Speedster intentionally captures only Front and Back.
- Do not add dead generic links, title searches, copied/fake TILT images, manual Done buttons, duplicate records, or false status writes.
- A later bridge must first define one exact Speedster-to-`CardAsset`/`Item` ownership/linkage contract and the no-TILT comps input. That bridge is a separately approved data/workflow change.
- NFC programming remains a finishing action after the report is complete and published.

## 13. Codex Build Strategy

The primary Codex agent owns the architecture, V2 contracts, database design, shared Human Grade extraction, integration, production verification, and final deployment. Supporting Codex agents accelerate bounded work only after the primary agent establishes the V2 namespace and file boundaries.

### Mandatory Speedster agent charter

The primary agent must include and repeat this charter in every assignment, follow-up, or correction sent to a supporting Codex agent:

- Build only the exact approved Master Plan scope. No scope creep.
- Use the fewest practical files, dependencies, abstractions, API calls, database operations, UI actions, and lines of maintained code.
- Minimize CPU/GPU demand, memory, storage, network transfer, and execution latency.
- Implement one direct production path. Do not add backup systems, fallback behavior, parallel detectors, detector voting, ensembles, or speculative alternatives.
- Do not add operator approval gates, confidence gates, image-quality gates, device gates, calibration gates, extra confirmations, or defensive workflow steps that Mark did not approve.
- Do not add “future-proofing,” generalized frameworks, optional features, extra settings, or adjacent improvements outside the plan.
- If an agent believes a deviation is unavoidable, it must stop and report it to the primary agent. It is not authorized to implement the deviation.

Existing admin authentication/access control, non-destructive handling of production data, V1 isolation, deterministic tests, and pre-deployment verification remain mandatory platform responsibilities. They must be implemented with the smallest existing mechanisms and must not create new operator steps, alternate grading paths, or product complexity.

### Build lanes

1. **Capture and grading flow** — Shared label editor, native-iPhone pair, geometry, SAM review, deterministic grading, report, and one-level Undo.
2. **Capacity and storage** — Admin-owned active drafts, one direct load-balanced SAM endpoint with identical workers, stable evidence keys, and the shared label-slot transaction lock.
3. **Learning** — Replace the insufficient centroid cache with the frozen bounded-exemplar, negative-veto-only SAM Memory V2 after the inspection frame is stable in Production.
4. **Post grading** — Shared completed-card list, exact public report, sealed-slab photos, and independently scoped NFC/comps/inventory bridges only when their exact record contracts exist.

The primary agent reviews and integrates each bounded lane and owns schema order, production rollout, and compatibility decisions. Agents do not create alternate architectures or edit the same files concurrently.

## 14. Build Order

1. Integrate and verify the completed Human Grade equal-weighting branch before touching shared editor files. **Completed.**
2. Create the isolated V2 namespace, core contracts, and versioned deterministic scoring tests.
3. Extract the Human Grade label composer into one shared component without changing the existing Human Grade behavior.
4. Render that shared component as Step 1 inside `/admin/ai-grader-v2`; **Continue to Photos** creates the V2 draft without navigating to `/admin/human-grade`.
5. Build front/back upload, optional view-type selection, and private evidence storage. Do not consume a label slot yet.
6. Complete automatic corner proposal, human geometry assist, rectification, and canonical zones.
7. Complete centering geometry and deterministic centering scoring.
8. Implement the one-active-detector contract using test masks first.
9. Integrate SAM 3 as the sole active detector. **Completed and live.** Reuse its already-computed encoder features for immediate learning; do not add DINO or another model.
10. Implement independent per-view scanning and canonical mask fusion/deduplication. **Completed locally.**
11. Complete the master-map review UI, magnifier, evidence close-up, type pills, Remove, and Smart-Mark. **Completed locally.**
12. Complete measurements, shared weighted-area engine, sub-grades, and overall grade. **Completed locally.**
13. Build the interactive report from the same read-only evidence component. **Completed locally.**
14. Finalize the completed Speedster label through the existing 16-up queue using the selected layout and V2 Blueprint grades. **Completed locally.**
15. Persist the compact reviewed-example bank and apply deterministic cosine re-ranking on the next card. **In the approved release branch.**
16. Add the shared completed-card workspace, sealed-slab photos, native-iPhone capture, Next Card rhythm, and multi-admin isolation. **Completed locally.**
17. Deploy the migration-bearing release, move SAM traffic to one 2-warm-plus-flex load-balanced endpoint, and run Production acceptance. **Completed and live.**
18. Merge the deployed Cloudflare Worker runtime correction into `main` so source and Production match. **Completed in PR #268.**
19. Complete the isolated post-grade PhotoRoom presentation-image release, preserve rectified report compatibility, and remove obsolete nested iPhone PLAN fields. **Deployed in PR #269; multiple new-card PhotoRoom tests passed.**
20. Add and Production-validate the isolated 2 mm inspection frame while preserving the exact canonical grading grid. **Built locally; release validation in progress.**
21. Implement and calibrate the frozen SAM Memory V2, then dry-run the Articuno exclusion before any approved cache swap.
22. Define and build one idempotent Speedster-to-`CardAsset` permanent-record bridge.
23. Connect the permanent Speedster card to the existing `Item` and inventory workflow without duplicate records.
24. Add physical NFC write/read-back verification against the permanent card/report identity.
25. Add Speedster eBay comps without a fabricated TILT image or any effect on grading.
26. Run the simultaneous multi-admin Production acceptance test when a second human operator is available. This is intentionally last in the current order; implemented session isolation and label locking remain unchanged meanwhile.

## 15. Production Definition of Done

- V1 behavior and routes are unchanged.
- Existing `/admin/human-grade` creation, editing, deletion, grading, PDF rendering, and 16-up printing remain unchanged and usable.
- A Speedster draft does not consume a printable slot; only a completed grade does.
- The shared label editor contains no grading formula. Speedster labels use the versioned equal-25% Blueprint engine regardless of future Human Grade changes.
- One front and one back image can complete the entire workflow without local software or hardware.
- Every view maps reproducibly to the same physical card grid.
- No overlapping defect area is double-counted.
- Known synthetic measurements and scores match exact expected results.
- Leaving, removing, type-correcting, and Smart-Marking each produce the correct automatic learning result.
- A completed report can be recreated exactly from stored evidence and versioned rules.
- The public report is read-only and matches the admin evidence visualization.
- Detector accuracy, false markers per card, mask-area error, review time, latency, and cost are recorded on the Ten Kings golden set.
- Production access remains admin-only until Mark approves broader exposure.

## 16. Production Runtime

The original launch described below completed successfully. Production uses the
load-balanced SAM endpoint and the superseded normal Pod is stopped. A read-only
runtime audit on 2026-08-11 found endpoint `we730z8vl8o3tm` on Release 15 with
Active 2 / Max 4, zero queued or in-progress jobs, and four release-homogeneous
workers. The two active workers were heterogeneous (one RTX 4090 and one A40),
with two idle RTX 4090 workers. This supersedes the earlier runtime claim that
both warm workers were RTX 4090s; the required architecture below is unchanged,
but its homogeneous-GPU timing condition is not currently proven. The live
release used image tag
`ghcr.io/marktenkings/tenkings-backend/ai-grader-speedster-service:a67ae0fa3e3e8ab3c199ed2be18ddbe775fba1c4`.
The service pins SAM package commit `96914d2425f90a64f45ca977c2b5165418099543`,
but the runtime downloads `sam3.pt` without a pinned repository revision or a
recorded checkpoint digest, so exact live checkpoint bytes cannot be claimed
from the available evidence. No detector request was sent during this audit.
Consequently, Front/Back worker overlap and warm homogeneous-RTX-4090 p95 remain
timing-blocked pending an approved equivalent benchmark.

### Required services

1. The existing Vercel Next.js application for the admin UI, authenticated APIs, completion transaction, and public report.
2. The existing Production PostgreSQL database.
3. The existing S3-compatible card object storage and its Production-origin direct-PUT CORS rule.
4. One RunPod load-balanced CUDA endpoint running identical copies of `backend/ai-grader-speedster-service/Dockerfile`. Each worker loads exactly one SAM 3 model and handles one detector request at a time. Start with two active RTX 4090 PRO workers and allow flex overflow up to four total workers. There is no application queue, named-worker selection, alternate detector, or fallback.

The load-balanced endpoint is the sole live detector target. There is no normal-Pod fallback or alternate detector.

### Exact additive migration order

1. `20260731183000_human_grade_formula_version`
2. `20260731210000_ai_grader_v2_speedster_sessions`
3. `20260731223000_ai_grader_v2_label_source`
4. `20260801173000_ai_grader_v2_post_grade`
5. `20260801180000_ai_grader_v2_iphone_capture`
6. `20260801190000_ai_grader_v2_learning_bank`

All migrations are additive. Existing Human Grade rows receive `LEGACY_30_25_25_20` and `HUMAN` through column defaults, with no row-level grade/page rewrite. The new Speedster migrations add only V2 post-grade/capture/learning state.

The Human Grade formula-version migration is already live from the first Speedster rollout. The application must not serve the three newer post-grade, capture, and learning schemas before their migrations are applied.

### Runtime environment

New Vercel server variable:

- `AI_GRADER_SPEEDSTER_SERVICE_URL` — HTTPS base URL of the one SAM 3 endpoint.
- `AI_GRADER_SPEEDSTER_SERVICE_API_KEY` — optional server-only bearer key when that endpoint requires RunPod authentication.

Existing Vercel variables reused without changing their values or credentials:

- `DATABASE_URL`
- the existing admin-session/auth-service configuration
- `CARD_STORAGE_MODE=s3`
- `CARD_STORAGE_BUCKET`
- `CARD_STORAGE_REGION`
- `CARD_STORAGE_ENDPOINT`
- `CARD_STORAGE_ACCESS_KEY_ID`
- `CARD_STORAGE_SECRET_ACCESS_KEY`
- `CARD_STORAGE_FORCE_PATH_STYLE`
- `CARD_STORAGE_ACL`

GPU service variables for the selected direct checkpoint-download path:

- `HF_TOKEN` — authenticated access to the available `facebook/sam3` `sam3.pt` checkpoint.
- `PORT` — the host-assigned HTTP port; the container defaults to `8080`.

The pinned service downloads that one official SAM 3 checkpoint at startup through `HF_TOKEN` and reuses the loaded model in memory. There is no alternate checkpoint path or second detector in the current plan.

The service exposes `/ping` for direct worker readiness on `PORT_HEALTH`. RunPod receives one GPU type only, two active workers, four maximum workers, and request-count scaling for flex overflow. Multiple admins remain isolated by the existing admin identity on each active Speedster session. Shared 16-label sheet create/delete/slot assignment uses one short PostgreSQL transaction advisory lock; there is no application work queue or manual worker selection.

Temporary deployment variable from the existing deploy runbook:

- `RUN_DB_MIGRATIONS=true` only for the explicitly approved migration-bearing Vercel deploy; remove/reset it after that deploy.

### Original direct launch order (completed)

1. Build and push the pinned Speedster Docker image. Create one private RunPod load-balanced template with `HF_TOKEN`, `HF_HOME`, `PORT=8080`, `PORT_HEALTH=8080`, and HTTP port `8080`.
2. Create one RTX 4090 PRO endpoint with two active workers, four maximum workers, and no secondary GPU type. Confirm `/ping` and `/health`, then invoke one real `/detect` request on non-Production sample images.
3. Verify the existing object-storage settings and Production-origin direct PUT/read behavior without rotating credentials or changing V1 storage behavior.
4. Set `AI_GRADER_SPEEDSTER_SERVICE_URL` in Vercel and set `RUN_DB_MIGRATIONS=true` for the one approved release.
5. Merge the protected Speedster PR after required checks; let the Production build apply the additive migrations in order and deploy the Next.js application.
6. Remove/reset `RUN_DB_MIGRATIONS` after the migration-bearing deploy.
7. Read-only verify the serving commit, `/admin/ai-grader-v2` authentication boundary, GPU `/health`, and one authenticated image action.
8. Mark performs the first Production iPhone-capture card and a simultaneous-admin acceptance run. After acceptance, stop the old normal GPU Pod and retain only the load-balanced endpoint.

The current contents or occupancy of the Human Grade queue are not a launch dependency. If an OPEN page exists, the completed Speedster label takes its next slot; otherwise the existing queue creates a page. A draft never consumes a slot. V1/Dell, local helpers, camera hardware, and NFC are not involved.

## 17. Explicitly Excluded or Deferred

- V1 local helper or hardware integration
- Basler/Leimac active lighting and capture recipes
- Dino-Lite microscopy
- OCR or automatic card labeling
- 72-image capture packages
- mandatory camera calibration gates
- per-card neural-weight training
- Vision LLMs, PatchCore, backup detectors, fallback detectors, and detector ensembles
- multiple learning databases or separate models per lighting/view type
- public report editing
- NFC/comps/inventory launch bridges until the exact shared `CardAsset`/`Item` identity and no-TILT comps contract are approved

## 18. Moat Path After Speedster Proof

1. Accumulate proprietary reviewed masks, hard negatives, measurements, view provenance, and clean references.
2. Learn both what defects look like and which evidence view exposes each defect best.
3. Add controlled directional/polarized captures later only where they prove measurable value.
4. Train the proprietary specialist detector from Ten Kings data.
5. Keep images, masks, retrieval bank, capture recipes, evaluation sets, and detector weights private while keeping scoring rules transparent.

The commercial AI models are replaceable components. The compounding Ten Kings evidence, review corrections, physical measurements, evaluation discipline, and reveal knowledge are the moat.
