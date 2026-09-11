# Manual grading first; Astra uses the same tools

Planning discussion, September 11, 2026. No application code, deployed controls or provider settings change in this discussion. Owner authority is recorded in the [canonical blueprint](../../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md#owner-direction--quality-parallel-grading-and-step-by-step-design-september-11-2026).

## Owner instructions and current decisions

- Preserve high-quality grading photographs. Speed improvements should remove redundant uploads, reads, copying and waiting. The preceding audit's compact JPEG experiment is not approval to lower image quality or adopt a lossy conversion policy.
- Support many human graders and many Astra-operated cards concurrently. Remove application-imposed card allowances, spend ceilings and arbitrary one-card execution limits. One failed card must not prevent other cards or graders from working. External provider limits and finite hardware still exist; there is no established ten-card timing guarantee.
- The boundary and printed-border engines find the lines first. Astra reviews their results and adjusts them when needed, using the same precise tools available to a human.
- Discuss each grading stage and Astra's actions before building. Manual-first implementation is the current recommendation under discussion, not a completed build or a separately approved detailed implementation.
- Prefer resume from saved progress, provided it remains lightweight. The owner would choose a simpler restart behavior over another bloated recovery framework. This is a design tradeoff, not an instruction to discard existing cards or results.

## Image quality and resolution

The owner's displayed HEIC-imported originals are 3024 × 4032, or 12,192,768 pixels per image. PNG conversion retained those dimensions; its larger file size did not create additional resolution. Existing supported JPEG/PNG/WebP intake preserves the selected file bytes. HEIC conversion changes the representation, so matching dimensions alone do not prove full native color/processing equivalence.

The in-browser camera requests ideal 4032 × 3024 video and uses maximum advertised native still dimensions when `ImageCapture.takePhoto` is supported. Its fallback captures the actual delivered video frame. Requested dimensions are not a guarantee, and a video-frame capture is not automatically equivalent to the iPhone native Camera app. Use native still/original camera-roll quality as the comparison baseline; verify actual capture dimensions and small-detail quality on the owner's phone before accepting parity.

The existing preparation engine also creates standardized 1270 × 1778 rectified working images and 1350 × 1858 inspection views. These are derived working assets, not evidence that all downstream operations consume the entire original pixel grid. Source-quality and derived-view quality should be reviewed separately during stage design. No resolution policy is changed here.

Target: one source upload per side. Engines read that source when required and create useful derived assets on the server. Editing outlines sends coordinates, not another original photograph. One screen versus several screens is a user-interaction decision; neither should imply repeated original uploads.

## Proposed first review screen

Desktop: Front and Back visible together, with physical boundary and printed border distinguishable on each image. Both start with engine-generated proposals. Retain accurate zoom and an original/prepared view as needed. On a phone, keep the same review step but stack or enlarge images rather than squeezing away useful detail. Layout, controls and confirmation behavior remain discussion items.

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

1. Agree the capture and combined boundary/border review behavior.
2. Rebuild the manual path using the existing engines, shared precise tools and small progress records; measure it against the relevant Ten Kings flow.
3. Prove one full manual card, simultaneous graders, interruptions and subsequent cards without global blockage.
4. Connect Astra to those exact actions, designing and checking its behavior stage by stage. Avoid a second independent grading workflow.

Next design work should remain focused on the first review screen, followed by centering, defect inspection/correction, report and final human review. The exact screen layout, model input/output per stage, automatic confirmation rules, ambiguous geometry behavior and working-image quality acceptance are not yet finalized.
