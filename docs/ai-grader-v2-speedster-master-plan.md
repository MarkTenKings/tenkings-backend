# Ten Kings AI Grader V2 Speedster — Master Plan

Date: 2026-07-31  
Status: Approved and actively being implemented; one-detector provider selection pending  
Purpose: Source of truth for the smallest production-ready Speedster architecture

## 1. Mission

Build a premium, extremely fast Ten Kings grader that turns one front image and one back image into a transparent, measurable grade with minimal human work.

V1 remains active and untouched. The existing Human Grade workflow also remains active and is the default behavior on `/admin/human-grade`. V2 uses its own admin route, grading sessions, evidence, rules, and detector boundary while intentionally reusing the proven Human Grade identity editor and 16-label printing system. It does not depend on the V1 local helper, Basler, Leimac, Dino-Lite, OCR, or 72-image workflow.

## 2. One-Sentence Architecture

Every image is straightened onto the same physical card grid, scanned independently, and merged into one master defect map; the human only fixes mistakes, deterministic Ten Kings math produces the grade, and the reviewed evidence improves the next card.

## 3. Speedster Workflow

1. **Create card** — Human clicks **New Speedster Card** inside `/admin/ai-grader-v2`. The first Speedster step displays the same proven Sports/Pokemon identity editor and live label preview as Human Grade, without navigating to another page.
2. **Upload** — One original front image and one original back image are required. Extra evidence views are optional.
3. **Set geometry** — OpenCV proposes the four physical card corners. Human moves only incorrect points and confirms the card shape/radius.
4. **Rectify** — Every image is mapped onto the same known-dimension card grid and receives a saved raw-to-grid transform.
5. **Measure centering** — Human confirms the design-border geometry; deterministic code calculates front and back centering.
6. **Scan views independently** — The detector returns precise defect masks, suggested defect types, confidence, and source-view IDs for each image.
7. **Fuse onto one card map** — Masks that overlap within geometric tolerance become one canonical defect with multiple supporting views. They are never double-counted.
8. **Human review** — The original color image is the master review image. Hovering or tapping a marker opens the best evidence close-up and its measurements.
9. **Grade and report** — Deterministic rules calculate all four sub-grades and generate the premium interactive report.
10. **Learn** — Reviewed masks and patches enter one structured Ten Kings learning bank and improve retrieval for the next card.

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
| Private object storage | Original evidence, generated views, masks, and report assets | Required |
| OpenCV | Corner proposal, rectification, canonical grid, zones, filters, measurements | Required |
| Python and PyTorch detector service | Replaceable execution boundary for vision models | Required capability |
| SAM 3.1 | Bootstrap primary mask generator while reviewed Ten Kings masks are accumulated | Initial active detector |
| DINOv3 embeddings | Similar-example retrieval across the single learning bank | Required for the moat; backbone replaceable |
| YOLO26 segmentation | Trainable specialist that detects, classifies, and precisely masks Ten Kings defects at high speed | Integrate the adapter and training-ready data path from the beginning; activate only after trained, then replace SAM rather than run beside it |

Vision LLMs, PatchCore, detector ensembles, and automated fallback detectors are not part of the Speedster architecture.

## 9. One Structured Learning Bank

There is one logical Ten Kings learning system, not separate models or databases for each view or lighting setup.

Each example stores automatically available context:

- reviewed patch and canonical mask
- accepted, removed, Smart-Marked, or type-corrected result
- defect type
- source view type
- card side and zone derived by the system
- card profile/finish when available
- capture, transform, detector, filter, and rule versions

### Immediate learning

After review completion:

- accepted and Smart-Marked patches become positive retrieval examples
- removed detections become hard-negative examples
- corrected types become better labeled examples
- DINOv3 retrieval uses the most relevant examples on the very next card

This is database/index learning, not unsafe per-card neural-weight updates.

### Controlled model learning

- Save reviewed masks in a YOLO26-ready segmentation format from the first completed card.
- Train or retrain YOLO26 periodically, not after every card.
- Test every candidate against an immutable golden set.
- Evaluate candidates offline, outside the Speedster grading workflow.
- Activate YOLO26 only when recall, false positives, mask accuracy, measurement error, review time, and latency beat the active SAM-based detector.
- When promoted, YOLO26 replaces SAM as the one active detector; there is no runtime fallback between them.
- Version prior models, thresholds, memory-bank snapshots, and grading rules for historical reproducibility. Changing the active detector is always one explicit offline-approved replacement, never an automatic fallback.

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

- original front/back master images
- canonical defect markers and masks
- tap/hover evidence close-up from the best source view
- defect type and exact location
- dimensions, area in mm², eligible-zone percentage, multiplier, and score effect
- centering measurements and ratios
- four sub-grades, 70/30 side math, overall 25% weighting, and full calculation trail

Public viewers can explore evidence but cannot edit it.

## 12. NFC-Ready Report Identity

NFC is explicitly planned but is not part of the initial Speedster build.

- Every completed Speedster card receives one stable certificate identity and one permanent Ten Kings public report URL.
- The future NFC chip sealed into the slab label will open that exact report URL.
- The future NFC label layout will use the same physical label dimensions and 16-up sheet geometry.
- Before NFC implementation, audit the existing V1 hosted registration, report-link, NFC helper, reader, write, verification, and chip-profile code.
- Reuse only clean, compatible contracts and components; do not copy V1 grading/capture baggage into Speedster.
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

### Parallel lanes

1. **Scoring lane** — Implement the deterministic Blueprint engine and exhaustive known-answer tests in isolated V2 library/test files.
2. **Vision lane** — Implement canonical-grid geometry, the one-detector contract, SAM bootstrap service, reviewed-mask export, DINO retrieval, and inactive YOLO training/evaluation tooling in the isolated V2 vision service.
3. **Experience lane** — Implement the defect review/evidence component and its read-only public-report mode against fixed contracts in isolated V2 UI files.
4. **Primary integration lane** — Extract the shared label editor, build the Speedster shell/upload/data flow, connect all lanes, perform end-to-end verification, and deploy.

The primary agent reviews and integrates every lane. Agents do not edit the same files concurrently. Schema migrations, the shared Human Grade refactor, model promotion, and production deployment remain single-owner operations. No Speedster agent touches Human Grade files until the current Human Grade agent has completed and its result has been inspected.

This strategy uses parallel agents for speed without creating competing architectures or merge baggage. Most product workflow work stays lightweight through reuse and shared contracts; production-quality geometry, defect detection, and golden-set evaluation remain the substantive technical work.

## 14. Build Order

1. Integrate and verify the completed Human Grade equal-weighting branch before touching shared editor files. **Completed.**
2. Create the isolated V2 namespace, core contracts, and versioned deterministic scoring tests.
3. Extract the Human Grade label composer into one shared component without changing the existing Human Grade behavior.
4. Render that shared component as Step 1 inside `/admin/ai-grader-v2`; **Continue to Photos** creates the V2 draft without navigating to `/admin/human-grade`.
5. Build front/back upload, optional view-type selection, and private evidence storage. Do not consume a label slot yet.
6. Complete automatic corner proposal, human geometry assist, rectification, and canonical zones.
7. Complete centering geometry and deterministic centering scoring.
8. Implement the one-active-detector contract using test masks first.
9. Integrate SAM 3.1 as the bootstrap active detector and DINOv3 retrieval.
10. Add the YOLO26 adapter, reviewed-mask export, offline training command, evaluation command, and versioned model package from the beginning; do not add it to the live path until trained.
11. Implement independent per-view scanning and canonical mask fusion/deduplication.
12. Complete the master-map review UI, magnifier, evidence close-up, type pills, Remove, and Smart-Mark.
13. Complete measurements, shared weighted-area engine, sub-grades, and overall grade.
14. Build the interactive report from the same read-only evidence component.
15. Finalize the completed Speedster label through the existing 16-up queue using the selected layout and V2 Blueprint grades.
16. Persist the structured learning bank, version snapshots, golden-set metrics, and offline model-promotion controls.
17. Deploy the completed V2 admin-only route, run end-to-end cards, then give Mark the production test URL.

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

## 16. Explicitly Excluded or Deferred

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
- NFC programming and the NFC-specific inner label layout until the core Speedster workflow is proven

## 17. Moat Path After Speedster Proof

1. Accumulate proprietary reviewed masks, hard negatives, measurements, view provenance, and clean references.
2. Learn both what defects look like and which evidence view exposes each defect best.
3. Add controlled directional/polarized captures later only where they prove measurable value.
4. Train the proprietary specialist detector from Ten Kings data.
5. Keep images, masks, retrieval bank, capture recipes, evaluation sets, and detector weights private while keeping scoring rules transparent.

The commercial AI models are replaceable components. The compounding Ten Kings evidence, review corrections, physical measurements, evaluation discipline, and reveal knowledge are the moat.
