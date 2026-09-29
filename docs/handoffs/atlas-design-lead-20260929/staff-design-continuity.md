# ATLAS staff design continuity

Written 2026-09-29 by the independent staff design/implementation subagent `/root/staff_scale_design_review` for the fresh design lead requested by Mark. This handoff records this agent’s retained context and work. It does not establish the current deployment state; the root lead owns integration, commits, release evidence, and the session log.

## Read this first

- Mark approved the revised mockups and authorized integration and deployment, as explicitly relayed by the root lead. Do not restart design approval for decisions already accepted.
- The latest accepted reviewer attention treatment is **B: always use neon `#ff2444` for the full Your review panel border and its heading, including routine review**. Status and blocker semantics must be stated in words. Do not resume arguing for neutral routine treatment.
- The photograph must remain the large, usable centerpiece. A tall observation banner that shrinks the image was the concrete problem to solve.
- Human approval, source image verification, draft preservation, preparation, measurement, and report approval remain real gates. No mockup timers, fixture values, simulated acknowledgments, or invented measurements belong in production.
- This agent’s staff source was handed to root ready to freeze. After that, no further application edits were made by this agent. This document is the only output of the fresh-lead continuity request.

## Provenance: independent designer role and persona

**Exact retained facts:** Mark explicitly requested a true independent subagent and described the desired design critic as a “legendary designer alter ego of Johnny Ives.” This agent’s actual task identity is `/root/staff_scale_design_review`. Root repeatedly used it for independent staff layout advice, interaction critiques, and QA, and later assigned the staff implementation. It is a separate AI subagent, not Jony Ive or a real-world designer.

The retained task messages show that root asked this agent to review: card scale at laptop height; routine versus correction guidance; stable task panel hierarchy; magnifier placement; original observation safety; direct tool activation; truthful approval/save states; color semantics; and later customer-report ideas. They also show root requesting the separate attention-color comparison and then relaying Mark’s selection of B.

**Limit of retained evidence:** Earlier independent critique response text is not fully present in the current retained history. Do not invent verbatim recommendations, a named fictional persona, or a model/effort setting for those earlier turns. The user’s broader “the separate designer agreed/loved it” messages are user reports of earlier interactions, not a license to manufacture a quote. The exact root relay is stronger evidence for the accepted B treatment than a reconstruction of the original color debate.

**Reconstructed design lens, consistent with the work:** prioritize the evidence photograph, reduce competing chrome, keep one stable place for the next human task, use precision visuals only when supported by saved data, and make motion explain changes of location or state. This is a practical summary of the work, not a recovered quotation from an earlier critique.

## User preferences and approved decisions

### Directly visible user context

- White means pure white, not green-tinted white. Mark’s reference is Apple’s visual clarity, images, fluid motion, and calm presentation.
- Staff review should keep useful information on one screen without clutter or confusion.
- His screenshot of production rapid Front geometry showed the card too small. He asked for a mockup of that exact screen **before** editing and deployment.
- He specifically praised the zoomed-in layer that appears while moving geometry because it helps him place it precisely.
- Earlier staff feedback said the design direction was good but the functionality had not allowed him beyond the first review. Thus actual progression matters as much as appearance.

### Approvals relayed by the root lead during this subtask

- Large-card layout approved: the card takes the available workspace height; the inspector is narrow and separate.
- A consistent **Your review** box should be present for both routine human confirmation and processing exceptions.
- Routine and correction are distinct states, but their location stays the same.
- The final selected color treatment is B: red border and red heading in all states.
- The precision magnifier belongs below the task panel so it cannot obscure the instruction.
- Original observations without a measured trace must remain reachable without consuming the image’s vertical space.
- User approved all revised mockups and asked to integrate/deploy. This agent was told to implement staff only, with no commits/deployments/log edits; root owns those operations.

### Adjacent customer-report context; not owned by this agent

Root messages relay approval of the gold fingerprint treatment, a desire for all individual findings without groupings, paired Front/Back desktop views, edge/corner/centering inspection, and an animated grade explanation. This agent did not implement those production components. Read the public/grade agents’ handoffs for exact current behavior and validation. Do not derive their release status from this staff handoff.

## Design artifacts

Approved interactive guidance mockup:

`/Users/markthomas/.codex/visualizations/2026/09/29/01a0eba4-cb58-7bf0-9065-92ec50274d2a/atlas-guided-review.html`

Separate attention-color comparison:

`/Users/markthomas/.codex/visualizations/2026/09/29/01a0eba4-cb58-7bf0-9065-92ec50274d2a/atlas-review-attention.html`

The comparison was a design preview only. The guided mockup’s scenario switch, simulated save/recheck, and synthetic interactions are not implementation authority. Production must use actual component state and server callbacks.

## Implementation location and ownership

Shared worktree used for the implementation:

`/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean`

Branch assigned by root:

`codex/atlas-independent-lead-20260925`

Exact staff file roster handed to root:

1. `frontend/atlas-app/components/ManualCards.jsx`
2. `frontend/atlas-app/components/BatchGrading.module.css`
3. `frontend/atlas-app/test/manual-defect-workspace-integration.test.mjs`
4. `packages/atlas-manual-workspace/src/FocusedGeometryWorkspace.jsx`
5. `packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx`
6. `packages/atlas-manual-workspace/src/focused-geometry.css`
7. `packages/atlas-manual-workspace/src/defects.css`
8. `packages/atlas-manual-workspace/test/focused-geometry-component.test.mjs`
9. `packages/atlas-manual-workspace/test/astra-review-component.test.mjs`

No backend files, report/public components, root session log, or release settings were changed by this agent. Root and the other agents concurrently changed other files in the same worktree; their changes must not be overwritten or attributed to this staff work.

Applicable repository instructions were read for implementation, including the full master blueprint. For a fresh lead, read the current AGENTS.md and required context/runbooks again as that lead’s instructions require; do not treat this handoff as a replacement for release rules.

## Implemented behavior

### Geometry

- `FocusedGeometryWorkspace` has a full-height `.fg-body` with photograph stage and a 280px `.fg-inspector` on desktop; smaller widths use a narrower rail or a stacked, scrollable layout.
- The existing source-coordinate camera, physical/printed outlines, verified original image, live centering calculations, and adjacent top/right/bottom/left millimeter labels remain authoritative.
- A compact Front/Back geometry label lives in the image stage. The previous full-width heading and instrument row no longer reduce the image height.
- The persistent `.atlas-review-task` uses a white background, full 2px neon `#ff2444` border, and red heading. Task copy derives from actual loading, saving, error, missing outline, invalid centering, printed-border-absent, draft, or routine state.
- Normal heading is `Confirm Front geometry` or `Confirm Back geometry`. Missing geometry says `Place the physical edge` or `Place the printed border`. Invalid centering says `Correct the printed border`.
- The precision view is below the task, outside the photograph stage. It appears on pointer dragging or keyboard handle focus, using the actual photograph with the selected source point centered under its crosshair.
- Fit card, Snap, explicit No printed border, and Discard unsaved adjustments remain real controls. Live ratios and the line legend sit in the inspector.
- At suitable desktop heights the task stays sticky at the top of the inspector; the remaining inspector content can scroll independently. Short/mobile layouts remain scrollable rather than trapping controls under an oversized sticky box.

### Missing-outline correctness fix

The existing pure helper creates fallback guide quads when a stored outline is missing. Previously, valid-looking fallback geometry could enable approval immediately. The implementation now tracks the four actually positioned corners for each missing outline.

- Until all four corners of each required missing outline have been moved via the actual handle interaction, approval is disabled and its handler refuses dispatch.
- Placeholder outlines are explicitly called placement guides. Their numbers are not displayed as live measured centering.
- A physical outline is always required. Explicitly marking the printed border absent can bypass printed placement only; it cannot bypass a missing physical outline.
- Existing absent-border semantics remain: centering/final grade are unavailable and need attention. No fake substitute border is created.
- This is local completion gating for real edits, not an assertion that the chosen locations are objectively correct. Final human responsibility and server validation remain.

### Findings

- Focused rapid review defaults to one large photograph. The earlier automatic desktop split comparison was removed; the real Compare button still opens the clean photograph alongside the marked view with the exact same camera and verified image.
- A permanent task panel appears first in the right inspector, using the same red treatment. It distinguishes verifying, saving/checking, stale or failed work, pending measurement, unsaved trace, routine finding review, and unresolved original observations.
- The existing Add finding, Edit trace, Reject/Restore finding, type controls, actual brush/eraser, undo/cancel, measurement retry, and pending-change recovery remain wired to real callbacks.
- The selected finding measurements remain labeled as saved while an edit or measurement is pending; no recalculated values are invented locally.
- In focused mode, the optional image-only magnifier is in the inspector below the task instead of covering the photograph. Ordinary non-focused review retains its prior stage magnifier behavior.
- Approval saves/measures the actual trace before recording a finding decision. Source verification, both-image readiness, pending/stale work, nonempty trace, and existing review gates remain enforced.
- If no finding is selected and original observations remain unresolved, empty finding approval is blocked. Drawing does not silently reject or resolve an observation.

### Host integration

- `ManualCards` leaves the old full-width observation notice for ordinary review, but rapid mode renders compact original-observation details inside the inspector.
- The details show all original observations, the number still unresolved, current-side observations first, actual reviewed status, and explicit action buttons. They do not group or erase originals.
- From geometry, Review Front/Back findings navigates to the actual findings workspace when it is available. From the active findings side, Trace visible damage activates the actual local editor.
- Reject original observation still sends the exact existing `REJECT_FINAL_OBSERVATION` action with the original report hash/proposal id and explicit reviewed flag.
- Unsaved work disables observation navigation/decisions. Side selection now also checks the host’s navigation guard.
- Geometry recovery guidance and its real Restore previous outline callback are inside the rapid inspector.
- Existing Front → Back → Findings → Grade order, durable geometry checkpoints, failed-save retry, final report authority, and green approval control remain intact.

## Known limitation: original observations with no measurable pixels

This is an existing server contract limitation, not a new UI success state:

- The backend exposes `REJECT_FINAL_OBSERVATION` for original proposals whose reason is `NO_IN_CARD_RASTER_PIXELS`.
- It records an explicit REJECT in assistance reviews, with original proposal/base, reviewer, and timestamp, and invalidates findings confirmation.
- Adding a new manual trace for real damage does **not** associate that trace with, or resolve, the retained original observation.
- Thus a true observation may still block final confirmation after its visible damage has been traced. A reviewer must not be encouraged to record a false rejection just to proceed.

I reported this to root. Root explicitly directed: **keep the existing server contract unchanged in this design release**, clarify the copy, preserve the blocker, and make no further backend changes.

Current compact-panel copy explicitly says a new trace keeps the original observation pending and to reject it only if false. The dedicated task copy says it stays pending until a supported review decision is recorded. Regression tests verify that drawing neither invents a reviewed observation nor clears the empty-review blocker after canceling.

A later complete correction path needs an explicit, audited association/decision backed by the server and current image/frame validation. This handoff does not authorize inventing it client-side or silently reusing an old proposal polygon on a changed frame.

## QA completed by this agent

### Component and workflow tests

- **146 / 146 passed, zero skips** across the focused geometry component, focused/ordinary defects component, pure geometry focus, rapid review sequence, staff host integration, and recovery suites.
- After the final truthful observation wording change, reran the two affected suites: **85 / 85 passed, zero skips**.
- `git diff --check` passed.

Evidence:

- `/tmp/atlas-staff-card-first-20260929/targeted-tests.tap`
- `/tmp/atlas-staff-card-first-20260929/final-copy-tests.tap`

Meaningful cases included: failed/intermediate geometry save preserves the exact combined draft and base; double approval cannot double-save; missing/incorrect image dimensions disable edits; all missing-border corners are required; absent-border cannot bypass physical placement; keyboard magnifier remains outside image evidence; unmeasured observation tracing invokes the actual editor; empty trace cannot approve; original-observation identities are preserved; draft work blocks navigation; real trace save must finish before review; comparison camera/image bindings match exactly.

### Actual React browser exercise

Used the repository’s existing `packages/atlas-manual-workspace/scripts/rapid-workflow-browser.mjs`. It renders actual `ManualWorkspace`, shared rapid shell, real geometry/defect reducers, and local CPU preparation/measurement behind an isolated synthetic transport. This is stronger than a screenshot mockup but is not production authentication or a production data test.

Run inputs:

- Node: `/opt/homebrew/opt/node@20/bin/node`
- `ATLAS_FIXTURE_PYTHON=/Users/markthomas/.codex/atlas-handoffs/atlas-review-interaction-20260928/preview-cpu/bin/python`
- `ATLAS_BROWSER_EVIDENCE=/tmp/atlas-staff-card-first-20260929`

Final result: **passed**, seven viewport checks, **zero page JavaScript errors**. Front → Back → Findings → Grade progressed, including an injected failed geometry save and retry, add/edit/cancel finding tools, and no implicit final report approval.

| Screen | Viewport | Stage width × height | Stage bottom / approval dock top |
| --- | --- | --- | --- |
| Geometry | 1440 × 900 | 1090 × 692 | 814 / 824 |
| Geometry | 1280 × 720 | 930 × 512 | 634 / 644 |
| Geometry | 390 × 844 | 360 × 458 | 566 / 756 |
| Geometry | 844 × 390 | 514 × 224 | 319 / 329 |
| Findings | 1440 × 900 | 1070 × 533 | 803 / 824 |
| Findings | 390 × 844 | 338 × 414 | 666.3 / 756 |
| Findings | 844 × 390 | 540 × 117 | 308 / 329 |

At 1440 × 900 the actual synthetic card is approximately 576px tall in its geometry stage. This is a measured browser result for that fixture, not a claim that all original images have identical dimensions.

The first browser run caught a mobile specificity conflict that limited the stage to 100px. The rapid mobile stage override was corrected, then the full browser run passed. Magnifiers were retained on mobile rather than hidden.

Primary proof and screenshots:

- `/tmp/atlas-staff-card-first-20260929/rapid-workflow-proof.json`
- `/tmp/atlas-staff-card-first-20260929/rapid-geometry-1440.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-geometry-1280.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-geometry-390.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-geometry-844.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-findings-1440.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-findings-390.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-findings-844.png`
- `/tmp/atlas-staff-card-first-20260929/rapid-final-grade.png`

I visually inspected desktop geometry, desktop findings, and mobile geometry screenshots. A transient Unsaved changes label is visible in the desktop findings screenshot captured immediately after add/cancel; the full browser sequence continued successfully. I did not independently prove a persistent bug from that one intermediate screenshot. If it remains visible after React settles in live testing, investigate the existing editor activity propagation rather than assuming the task panel itself is authoritative.

## Next acceptance for the fresh lead

1. Read root’s latest release handoff/session log and determine the exact integrated commit and deployment state. This staff agent did not commit, deploy, restart, or validate production.
2. Confirm the nine owned files remain integrated alongside the separate public report/grade changes. Root may have made later QA adjustments; compare actual current source rather than blindly reapplying this handoff.
3. Complete root’s required full build/test/release process and record its evidence. The targeted results above do not substitute for integration qualification.
4. Inspect an actual staff card with a small card region inside a large original photo, like Mark’s Danny Wolf screenshot. Confirm the source-quad camera makes the card large, all four mm labels remain visible, and the task panel does not reduce stage height.
5. On the existing authorized testing surface, check Front and Back, keyboard/pointer geometry adjustments, magnifier location, a failed save/retry, Add/Edit/Cancel/Reject/Restore findings, next-finding navigation, and final report entry. Any mutation of a real customer card must be intentional and within the user’s already authorized testing scope.
6. Check the missing printed-border correction state with an appropriate test card/fixture. No placeholder measurement or early approval should appear; explicit absent-border must remain honest about unavailable centering/grade.
7. Verify unresolved original observations remain visible and accurately blocked. Do not describe manual tracing as resolving them under the current backend contract.
8. Present Mark the actual integrated experience and a precise production status. Carry forward his approved B treatment and large-card preference; reopen only a concrete newly discovered issue, not the old design debate.

