# ATLAS report design continuity — 2026-09-29

This is the public-report/evidence contributor's handoff, based on the approved mockups, current source and recorded release receipts. The same independent design collaborator is `/root/independent_design_critic`; preserve that agent/persona and its separate continuity contribution. This author (`/root/report_mockup_assets`) extracted evidence, reviewed mockups and implemented the public evidence UI; it was not the independent design critic.

## Current checkpoint

- Worktree: `/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean`, branch `codex/atlas-independent-lead-20260925`. Clean when inventoried.
- Deployed application commit: `0989b13bd6234118587f3909bfbcf1508a143fb2` (paired evidence reports and card-first rapid review). Local HEAD: `445b14c6` (documentation-only verified release closure). Earlier app `29e91920` is historical.
- Mark approved the final interactive mockups and explicitly authorized integration and deployment; that deployment is complete, not pending.
- Live example: https://atlasgrading.com/reports/ar_x01RP8d3VZS0Gk9rREW0DwkR?v=1 . Staff: https://atlasgrading.com/admin/batch?tab=REVIEW . Real authenticated/physical staff acceptance remains Mark's test.
- Source/release authority: `/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-09-29/paired-report-and-review-release.md` and `docs/handoffs/SESSION_LOG.md` in that worktree.
- Recorded live browser evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-paired-design-release-20260929/release/live-browser-proof.json`, `live-report-desktop.png`, `live-report-mobile.png`. Full provider/runtime receipts are in that release directory. Do not replay consumed deployment intents. Task-owned local QA helper 4176 was stopped after release; localhost previews are not evidence of production state.

## Owner decisions to preserve

1. Pure white, clear typography, large real card imagery, restrained gold branding. Motion should explain position, evidence and calculation with smooth acceleration/deceleration, then become still. The reference is Apple's visual clarity and grace, not a generic neon dashboard.
2. **Every individual defect remains visible in Whole card. No area grouping, grouped dots or mandatory expansion to discover defects.** Mark overruled the grouped design explicitly and repeatedly; the independent designer agreed. Category views are optional evidence filters, not a replacement for the complete overview.
3. Desktop shows Front on the left and Back on the right, with their own outboard labels. Mobile shows one side at a time and retains every individual finding. Detail shows marked and clean views of the same pixels/camera; switching defects pulls back to orient the customer before approaching the next finding.
4. Red defect shapes come from actual saved traces. Overview makes them easier to see and click; close-up uses exact trace size. Labels include original side number and defect name. Keep leaders short and continuous; emphasize one active connection. Never shift the red evidence merely to resolve label collisions.
5. Fingerprint gold matches the ATLAS logo (`#cda955`), grows from the saved defect shapes/sizes/positions, and retains the real card photo behind it. The user's tide idea is central to the brand direction.
6. Centering shows distinct physical and printed outlines, nearby millimeter readouts/rulers, saved ratios and an interactive emphasis state. Corners and Edges are dedicated views; Surface completes the four grading categories.
7. The grade calculation story should be sequential and scientific but understandable: category scores/weights/deductions, unrounded result, a perceptible pause at that result, then application of the saved rounding rule to the final award.
8. Staff layout: card is the centerpiece, large adjustable geometry with loupe, compact inspector and a permanent **Your review** task box. Mark selected **B: neon-red border and heading even for routine confirmation**. Keep explicit task/status copy so red does not imply every card failed. The independent designer's initial semantic-color preference was superseded by this owner selection.

## Approved private artifacts and inventory

All names in this section are relative to the exact visualization directory:
`/Users/markthomas/.codex/visualizations/2026/09/29/01a0eba4-cb58-7bf0-9065-92ec50274d2a`.

| Artifact | Role / authority |
| --- | --- |
| `atlas-in-motion.html` | Earlier overall visual/motion concept. Historical reference. |
| `atlas-evidence-in-motion.html` | Earlier evidence/measurement interaction study, with the saved report assets. Historical reference. |
| `atlas-fingerprint-tide.html` | Original deterministic gold contour/tide study. Earlier version can omit the photo; latest approved direction explicitly retains it. |
| **`atlas-paired-report.html` (640,632 bytes)** | Final approved public mockup: paired desktop, mobile side toggle, all 13 findings, fingerprint/photo, exact detail, category views, centering and seven-second grade story. Primary visual reference. |
| `atlas-card-first-review.html` | Owner-approved large-card staff layout proposal, before task-box refinement. Screenshot-derived reference image, not original grading pixels. |
| **`atlas-guided-review.html` (322,817 bytes)** | Final approved staff mockup, including owner-selected B task border/heading, routine/correction/original-observation scenarios and loupe. |
| `atlas-review-attention.html` | A/B color comparison; owner chose B. Do not reopen the color decision by default. |
| `*-qa.html`, `*-rendered.html`, `*-check.js` | Generated direct-document wrappers and syntax/QA copies for the corresponding fragment; edit the primary fragment, not these duplicates. |
| `atlas-paired-report-overview.png`, `atlas-grade-raw-stop.png`, `atlas-grade-final.png` | Public mockup visual proof. |
| `atlas-card-first-proposal.png`, `atlas-card-first-magnifier.png`, `atlas-guided-review-routine.png`, `atlas-guided-review-correction.png`, `atlas-guided-review-b.png`, `atlas-review-attention-correction.png` | Staff mockup visual proof; B is the final selected treatment. |
| `report-dual-assets.json`, `report-fingerprint-renderer.js` | Exact saved Abomasnow assets/trace extraction and contour renderer for private mockup use. No invented Front findings. |
| `report-category-enhancement.txt`, `report-centering-upgrade.js`, `report-grade-motion.js`, `report-motion-upgrade.css` | Intermediate patch/helper material already integrated in the final mockup. Do not apply again. |
| `ae-front-asset.webp`, `ae-back-asset.webp`, `report-back-preview.webp`, `danny-wolf-reference-crop.png` | Private visual reference assets. Never embed these/mockup data URLs into production. Production loads the approved hash-bound image descriptors. |

The private calculation example **9.35 → 9.5 is explicitly illustrative**. It was never Abomasnow's actual grade and must not migrate into live component defaults, marketing factual claims or production scoring policy.

## Current production implementation map

Paths below are relative to the worktree, under `packages/atlas-manual-workspace/src/` unless stated otherwise.

| File(s) | Contract / behavior to preserve |
| --- | --- |
| `PublicEvidenceExplorer.jsx` | Desktop paired overview at widths above 980px; mobile side navigation; Whole/Findings/Centering/Corners/Edges/Surface/Fingerprint/Grade science; all entries; category-scoped previous/next and return context; independent zoom side; finite arrival and tour; grade render hook. Both verified viewers remain mounted across modes/print. |
| `ReportInspectionImage.jsx` | Hash/dimension readiness, canonical image camera, actual direct shape targets, 1.8× display-only overview silhouette expansion around each saved box center, exact detail/print masks, synchronized clean pane, spatial category guides. No data or measurements are modified by enlargement. |
| `ReportSpatialOverlay.jsx`, `report-spatial.css` | Individual 136px outboard label rails with 14px gap and at least 44px between labels; one active continuous connector. All numbered labels remain. On-card number tags appear only on hover/focus to avoid overlapping tags 5/6; actual red traces never move. Legacy grouping helper remains internally but the public explorer uses `density="all"`. |
| `ReportPrecisionOverlay.jsx` | Nearby true border rulers and millimeter buttons; hover/focus/click emphasizes the corresponding instrument. Uses saved geometry, no inferred borders. |
| `inspection-viewport.mjs`, `report-review-ui.mjs` | Public centering's 64px instrument gutter agrees with fit/pan/pinch/minimap math; existing callers default to 16px. Saved coordinates/calibration remain unchanged. |
| `report-spatial-navigation.mjs` | Category filtering uses actual saved membership and preserves finding identity/side numbering. No grouping or renumbering in category views. |
| `ReportFingerprint.jsx`, `report-fingerprint.mjs`, `report-fingerprint.css` | Deterministic gold field over retained photograph; original native trace union drives the field; enlarged red markers are display only. Verification/cancellation and empty-state honesty retained. |
| `GradeCalculationStory.jsx`, `grade-calculation-story.mjs`, `grade-calculation-story.css` | Root-authored validated real-explanation display model, finite 7s timeline, pause/resume/restart/result and reduced-motion support. Replay sequence counter is necessary to restart while already playing without an RAF stall. |
| `FinalReportReview.jsx` | Root-authored production integration and category callback. Grade science's View category measurements selects that public mode and scrolls the evidence header into view. Existing printable calculations remain authoritative and complete. |
| `public-evidence.css`, `report-review.css` | Paired/mobile layout, category guides, pure-white report presentation, hover/focus tags, print rules and grade CSS import. |
| `FocusedGeometryWorkspace.jsx`, `DefectReviewWorkspace.jsx`, `focused-geometry.css`, `defects.css`; `frontend/atlas-app/components/ManualCards.jsx`, `BatchGrading.module.css` | Staff agent's large-card, inspector, B task-box and loupe implementation. Consult staff continuity for reducer/approval details. |

## Evidence, motion and factual limits

- Saved public fixture source is `docs/atlas/design/first-look/reports/approved.json` in the worktree. Abomasnow has **Front 0, Back 13** included findings. Category memberships are **Corners 2, Edges 11, Surface 8**; memberships overlap and therefore do not sum to the finding count. Corners contains original Back findings 10 and 13. Never invent Front damage to make a balanced illustration.
- Canonical card coordinates are 1270×1778 within verified 1350×1858 inspection photographs, offset by 40 pixels. The physical extent calibration is 20px/mm. Rendering and hit-testing must keep this mapping, exact saved spans, holes/disconnected components, source hashes, removed/excluded semantics and original IDs. There is no half-pixel correction.
- Fingerprint art uses the included final saved trace union on each side, exact native squared-distance field and fixed 24px contour spacing/orientation. It does not seed on card ID, grade, identity, random values or the other side. Identical traces produce identical artwork. Missing/empty traces stay honestly empty; no decorative fake defects. It is an evidence-derived **visual signature**, not a demonstrated physical-card identifier, biometric fingerprint or authentication test. The user's uniqueness hypothesis is a product research direction, not a validated claim.
- Current production automatic arrival is a finite roughly 1.1s lift/fade into stillness. **It is not an automatic tide.** Fingerprint Reveal/Play tide remains an explicit separate action. Do not report automatic arrival tide as implemented merely because the designer recommended it in the mockup discussion.
- Finding camera motion is retreat → locate → approach; reduced motion goes directly to the saved target. The explicit evidence tour visits Centering → Corners → Edges → Surface (2.4s each), then Whole. Manual navigation, finding selection, photograph gestures, measurement selection, resize/printing and reduced-motion changes interrupt relevant motion. Detail always has a clear return to its originating category/whole context.
- Grade story is 7s: category rows first, calculation, decelerating approach to actual raw value, raw pause, saved rounding transition, final stillness. Up, down and unchanged/historical awards are handled. Production displays actual saved explanations, including their 70/30 side and 25% category weights, rather than establishing a new formula. Abomasnow is **9.85 → 10**, Maye **9.662651939031448 → 9.5**, Dart **9.978571428571435 → 10**. Individual finding marginal effects are not additive; category deductions are.
- Print retains whole-card exact evidence and complete calculations; no enlarged display silhouettes, motion, fingerprint decoration or staff action can change approval eligibility. Staff original-observation limitation remains: adding a trace does not resolve an unmeasurable original observation; reject only a false observation. This release did not broaden that backend contract.

## Verification and continuation

Initial contributor run passed 72/72 targeted cases and 243 workspace cases with six environment skips. These are **superseded by final source-bound qualification**: staff 764/764, workspace 249/249, manual server 522/522, public/customer/router 95/95: **1,630 tests, zero failures/cancellations/skips**, plus both production web builds and boundary guards.

Core relevant tests: `packages/atlas-manual-workspace/test/final-report-component.test.mjs`, `inspection-viewport.test.mjs`, `report-spatial-navigation.test.mjs`, `report-fingerprint.test.mjs`, `grade-calculation-story.test.mjs`. Added actual JSX coverage checks desktop both views, all 13 directly selectable shapes, independent zoom, noncolliding labels, real category memberships and return scope, saved grade/weights/deductions, and replay → restart midflight → pause → resume → actual final, including reduced motion. Existing tests retain image-hash/dimension gates, exact geometry, camera/detail/clean alignment and print identity.

Recorded canonical browser acceptance covers desktop paired/all 13, direct on-card detail and Next, category counts, Back millimeters 3.80/3.20/3.65/3.35, photo-backed gold fingerprint, actual 9.85→10 grade animation, visible keyboard focus and 390px layout with no horizontal overflow; no console errors/warnings. Staff real reducer/transport synthetic workflow reached Front→Back→Findings→Grade with failed-save retention/retry; physical authenticated real-card acceptance was deliberately left to Mark. Use latest source and live receipts as implemented truth; use approved primary mockups as the design reference.
