# Manual grading first; Astra uses the same tools

Planning discussion, September 11, 2026. No application code, deployed controls or provider settings change in this discussion. Owner authority is recorded in the [canonical blueprint](../../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md#owner-direction--quality-parallel-grading-and-step-by-step-design-september-11-2026).

## Owner instructions and current decisions

- Preserve high-quality grading photographs. Speed improvements should remove redundant uploads, reads, copying and waiting. The preceding audit's compact JPEG experiment is not approval to lower image quality or adopt a lossy conversion policy.
- Confirmed intake: native iPhone Camera now, then upload the selected originals from the phone. Future high-end camera integration should deliver originals through the same intake contract. Retaining the old browser-capture implementation in its existing app does not require importing that UI into the new shell.
- Confirmed desktop layout: Front left, Back right, with successive grading tools in the same workspace. One source upload per side; server reads and useful derived images are separate from reuploading originals.
- Support many human graders and many Astra-operated cards concurrently. Remove application-imposed card allowances, spend ceilings and arbitrary one-card execution limits. One failed card must not prevent other cards or graders from working. External provider limits and finite hardware still exist; there is no established ten-card timing guarantee.
- The boundary and printed-border engines find the lines first. Astra reviews their results and adjusts them when needed, using the same precise tools available to a human.
- Discuss each grading stage and Astra's actions before building. Manual-first implementation is the current recommendation under discussion, not a completed build or a separately approved detailed implementation.
- Prefer resume from saved progress, provided it remains lightweight. The owner would choose a simpler restart behavior over another bloated recovery framework. This is a design tradeoff, not an instruction to discard existing cards or results.
- Subsequent owner direction: inspect/evaluate engines before optimizing them. Historical SAM Memory lessons and card maps may be omitted if that materially accelerates the clean build; this does not request deleting the current data or removing the ability to learn from new reviewed cards. The [engine inspection](../audits/2026-09-11/engine-review.md) distinguishes stored lessons, model weights, learning functionality and migration effort.

## Image quality and resolution

The owner's displayed HEIC-imported originals are 3024 × 4032, or 12,192,768 pixels per image. PNG conversion retained those dimensions; its larger file size did not create additional resolution. Existing supported JPEG/PNG/WebP intake preserves the selected file bytes. HEIC conversion changes the representation, so matching dimensions alone do not prove full native color/processing equivalence.

The in-browser camera requests ideal 4032 × 3024 video and uses maximum advertised native still dimensions when `ImageCapture.takePhoto` is supported. Its fallback captures the actual delivered video frame. Requested dimensions are not a guarantee, and a video-frame capture is not automatically equivalent to the iPhone native Camera app. Use native still/original camera-roll quality as the comparison baseline; verify actual capture dimensions and small-detail quality on the owner's phone before accepting parity.

The existing preparation engine also creates standardized 1270 × 1778 rectified working images and 1350 × 1858 inspection views. These are derived working assets, not evidence that all downstream operations consume the entire original pixel grid. Source-quality and derived-view quality should be reviewed separately during stage design. No resolution policy is changed here.

Target: one source upload per side. Engines read that source when required and create useful derived assets on the server. Editing outlines sends coordinates, not another original photograph. One screen versus several screens is a user-interaction decision; neither should imply repeated original uploads.

## Proposed first review screen

Desktop: Front left and Back right, visible together, with physical boundary and printed border distinguishable on each image. Both start with engine-generated proposals. Retain accurate zoom and an original/prepared view as needed. On a phone, keep the same review step but stack or enlarge images rather than squeezing away useful detail. The desktop side order is confirmed; mobile layout, controls and confirmation behavior remain discussion items.

| Step | Engine work | Manual reviewer | Astra reviewer, later |
| --- | --- | --- | --- |
| Source received | Retain the full-quality source once per side | Capture or select Front and Back | Receives the same source references |
| Outside edge | Detect physical boundary for both sides | Inspect proposed lines | Inspect engine proposals with image overlays |
| Working view | Straighten the card using its physical boundary | No separate administrative submission | No model call just to authorize bookkeeping |
| Printed border | Detect the printed frame in the straightened image | Inspect and adjust if needed | Confirm or request a precise adjustment |
| Correction | Apply coordinates/candidate line through shared snapping and geometric validation | Drag a handle or line | Select a candidate edge or provide a target point through a tool |
| Check result | Return updated coordinates and visual overlay | See the result immediately | Inspect the returned result when verification is needed |
| Continue | Save confirmed coordinates and advance the same card | Proposed single confirm-both action | Continue automatically when the agreed stage conditions are satisfied |

The printed-border engine currently depends on a rectified image. A changed physical boundary may require recalculating the affected side's working view and border. A combined screen removes navigation and redundant handling; it does not remove that mathematical dependency. Do not recalculate the unaffected side or discard unchanged accepted work.

"Preparation" currently means creating the straightened card and specialized inspection images, then finding the printed frame. These operations have a real grading purpose. The added operator currently requires a saved capture-preparation selection before the source runner begins them. The proposed flow runs the engines first and presents their results for review; it should not require Astra to propose all geometry from scratch or make a paid request merely to unlock engine work.

## Snapping: source evidence and planned parity

Ten Kings `GeometryAssist.tsx` and `CenteringAssist.tsx` call `snapSpeedsterPoint` from `frontend/nextjs-app/lib/ai-grader-v2/gradient-snap.ts`. The current ATLAS `ImageQuadEditor` in `frontend/atlas-app/components/WorkspaceGeometry.jsx` only maps/clamps drag coordinates; it does not call that snapping helper.

Reuse the underlying snapping behavior for manual ATLAS edits. Expose the same coordinate/line operation as a machine tool. Astra should not need to imitate a mouse drag through browser automation. Its suggested location is input to the precise image tool, not an unquestioned measurement. Coordinate spaces must be explicit when mapping original images, rectified images, zoomed previews and normalized points.

## Parallel work and failures

A separate job record per card should isolate its stage, ownership and next action. Many cards can proceed together; a problem with one job must not take a global lock on every grader. Protect a particular card from conflicting edits without imposing a system-wide one-card limit.

Ten cards can finish in a similar elapsed window to one only if model capacity, workers, database and network can sustain that parallel workload. The current single-card policy, one-job host and shared resources cannot establish that result. OpenAI also enforces project/organization request and token limits; these are distinct from ATLAS's removable product restrictions. [Official rate-limit documentation](https://developers.openai.com/api/docs/guides/rate-limits#how-do-these-rate-limits-work).

The audit observed failures in the added operator database path and identified shared staff/operator overhead and a terminal-state recovery defect. It did not establish a PostgreSQL server crash, nor isolate the exact SQL/wait/serialization cost behind the latest P2028. Manual-first must use the simplified shared workflow, not merely hide Astra while retaining the same expensive coordination path. Capture query/lock/transfer/processing timings during its implementation.

Resume needs small stage/coordinate/action records and retained completed results; it does not require loading the entire image conversation on each update. After a disconnect, read the last committed action and continue from the next unfinished one. If the reply to an action was lost, look up that action before repeating it. An adjustment never saved may need repeating; completed grading should not restart. No system can guarantee that a phone, network or database will never fail, so make ordinary interruption inexpensive to handle.

## Proposed build order, still under discussion

Owner clarification: identify the operator failure's initiating cause before designing/building the replacement Astra layer. The audit proves the failing subsystem and the subsequent terminal-state defect, but its retained logs do not identify the exact SQL statement, lock wait or application processing that exhausted the latest reservation transaction. The isolated earlier benchmark passed, so it cannot establish a production root-cause fix. A timed reproduction must cover reservation with representative image history and concurrent staff reads, separating connection acquisition, lock waiting, SQL, payload transfer and application processing. Provider transport can remain disabled. Merely forcing a timeout proves failure handling, not the historical initiating cause.

### Clean extraction approach

Start a separate minimal grading shell alongside the current app and explicitly import only the required engine modules, runtime dependencies and model/calibration assets. Do not copy the old application and then strip it down. This supersedes the audit's earlier in-place replacement recommendation as the proposed implementation approach; the audit's source observations remain historical evidence.

| Bring into the clean build | Leave outside its dependency graph |
| --- | --- |
| Existing `@atlas/grading-core` calculations, geometry, trace/review and report content | `@atlas/operator`, its run/attempt ledger and dispatch controls |
| CPU boundary, printed-border, rectification and defect-measurement functions | Existing `atlasWorkspace*` orchestration, enrollment and global staff locking |
| Existing snapping math and reusable geometry controls | The old all-purpose capture/workflow components and route handlers |
| Required detector checkpoint, pinned runtime, calibration, approved Memory and card-map data | Wholesale copies of the old database schema, triggers and application migrations |

`@atlas/grading-core` already has an extraction manifest and an enforced import boundary: its own modules plus `zod`, with no ambient database/provider/storage client. That package alone is not the full detector. Python geometry/measurement and SAM runtime dependencies must also be included. Where an engine mixes image I/O with computation, give it a small new input/output adapter rather than importing the old orchestration chain. Essential map/calibration data is an engine dependency, not a reason to copy all workflow tables.

Before connecting a UI, run the same fixtures through the existing engine and its clean entry point; compare geometry, measured defects and grades, and record timings. Deterministic outputs should match; model-backed operations require agreed tolerances. Use those checks to catch missing dependencies, coordinate changes and accidental scoring changes. This establishes extraction parity, not full grading accuracy or production readiness. The new manual path is then tested from originals to reviewed report, including independent concurrent cards, before Astra is connected to those shared actions.

### OpenAI integration comparison: checked source

Subsequent source correction: this subsection describes the older CardAsset OCR handler. The owner's current refined flow is the newer collect physical-inventory identifier and background research in release `bb10f235d5bddd2ca30ba19e5389e80d43cd2fec`. Use the [consulted shared-engine source and plan](SHARED_CARD_ENGINES_DISCUSSION.md), not the old handler, for extraction.

Both the inventory identification handler and ATLAS operator call `https://api.openai.com/v1/responses`. ATLAS is the application name; its operator explicitly selects `gpt-6-astra`. The checked inventory flow performs Google Vision OCR, structured text extraction, optional image-URL extraction and a `CardAsset` suggestion update, including compatibility/fallback behavior. It does not import the ATLAS per-tool run/attempt/image-delivery ledger. Its deployment can override source model defaults; the effective deployed inventory model was not checked in this follow-up, so identical Astra/MAX settings are not established.

The distinction is the surrounding workflow, not a different OpenAI endpoint. ATLAS retains a growing image-filled conversation and repeatedly checks it inside its own database transactions. The latest recorded reservation failure preceded the next provider dispatch. That establishes the failing subsystem and rules out the next OpenAI response as the cause of that particular failure; it does not isolate the exact initiating database wait or statement. Upload conversion overhead is a separate pre-operator issue.

Source entry points: [operator endpoint/model](../../../packages/atlas-operator/src/responses.mjs), [operator transactions and reservation](../../../packages/atlas-operator/src/ledger.mjs), [inventory OCR handler](../../../frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts), [core dependency boundary](../../../packages/atlas-grading-core/scripts/build.mjs), [CPU preparation](../../../backend/ai-grader-speedster-service/preparation_core.py), and [legacy snapping](../../../frontend/nextjs-app/lib/ai-grader-v2/gradient-snap.ts).

### Sequence after the discussion

1. Agree the capture and combined boundary/border review behavior.
2. Rebuild the manual path using the existing engines, shared precise tools and small progress records; measure it against the relevant Ten Kings flow.
3. Prove one full manual card, simultaneous graders, interruptions and subsequent cards without global blockage.
4. Connect Astra to those exact actions, designing and checking its behavior stage by stage. Avoid a second independent grading workflow.

Next design work should remain focused on the first review screen, followed by centering, defect inspection/correction, report and final human review. The exact screen layout, model input/output per stage, automatic confirmation rules, ambiguous geometry behavior and working-image quality acceptance are not yet finalized.
