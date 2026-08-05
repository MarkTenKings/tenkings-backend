# Speedster Measurement Accuracy — Frozen-Spec Addendum

**Status: APPROVED FROZEN ADDENDUM**

This document records the approved measurement-accuracy contract. Mark
explicitly approved this exact addendum after the Section 6, Section 8, and
Section 10 edits recorded here. The current frozen SAM Memory V2 blueprint
remains authoritative except for the exact conflicts superseded in Section 9.

## 1. Purpose and incident boundary

The completed Cubone investigation proved that correct arithmetic can still
produce an incorrect Corner result when the mask supplied to that arithmetic is
substantially larger than the visible defect. This is a measurement-authority
problem, not a reason to change the published score curve.

This addendum defines one direct correction path:

`human highlight intent -> existing SAM 3 point prompt -> editable final trace -> physical-material clipping -> one measurement pass`

The human stroke records what the reviewer meant. The final visible trace
records which physical card pixels are damaged. Only the final trace has grading
authority.

## 2. Foundation contract

All Speedster Foundation Principles remain binding:

- use the fewest practical files, dependencies, abstractions, calls, UI actions,
  and maintained lines;
- keep one direct Production path;
- use the existing SAM 3 model, existing OpenCV geometry, existing canonical
  card map, existing review flow, and existing measurement engine;
- add no model, detector, ensemble, fallback, queue, worker, retry process,
  retraining path, confidence gate, approval gate, confirmation step, or
  defensive workflow blocker;
- preserve existing admin access, ownership, non-destructive data handling,
  deterministic tests, and pre-deployment verification without adding operator
  steps;
- do not alter Centering, the scoring curve, historical reports, or SAM Memory
  proposal generation.

No rectangle, brush footprint, prompt, or model response may silently become a
second measurement authority.

## 3. Authority and provenance

### 3.1 Human intent

The current drag-box Smart-Mark is removed from the active review path. A
Smart-Mark begins with a draw-highlight stroke in the one enlarged zoom panel.
The persisted intent record contains:

- the ordered stroke points in canonical-card coordinates;
- the displayed stroke width in canonical physical units;
- Front or Back, the canonical crop-transform version, and the source evidence
  view;
- the Smart-Mark finding identity and selected defect type; and
- the final saved-trace identity/hash needed to prove which trace resulted from
  that intent.

The stroke is provenance. Its painted width and covered pixels are not measured
as damage.

### 3.2 SAM proposal

The same pinned SAM 3 model receives one point prompt when the reviewer ends a
highlight stroke:

- positive points follow the ordered stroke path;
- automatic negative points may be sampled only from deterministic candidates
  that are inside canonical physical material and outside the
  highlighted corridor, every existing saved trace, every current anomaly
  residual, and the expected boundary/arc response; and
- exterior inspection-frame pixels, non-material pixels, expected cut-boundary
  pixels, and the highlighted corridor can never become automatic negatives.

Geometry alone proves only whether a pixel is physical material; it does not
prove that the material pixel is clean. A pixel is eligible as an automatic
negative only when it satisfies every exclusion above.

The complete human stroke is persisted even if the prompt uses a deterministic
bounded subset of its points. Point sampling must be stable for identical
stroke bytes and the same canonical crop transform. If no valid automatic
negative set exists, SAM produces no proposal. The existing editable trace
remains on screen, the same visible non-blocking prompt error appears, and the
reviewer may continue editing that one trace with the plain brush and eraser.
Save remains available only when that one visible trace is valid. The system
does not switch to a positive-only prompt, box prompt, or another segmentation
path.

SAM proposes a trace exactly once at stroke-end. There is no automatic retry,
box retry, alternate prompt, alternate detector, or background job. The SAM
proposal is editable evidence, not grading authority until it is the trace
visible when the reviewer saves.

### 3.3 Final trace

The final trace visible on the drawing surface at Save is the sole measurement
authority, whether it came from SAM, human brush edits, or both. Save performs
only deterministic canonical mapping and physical-material clipping. The saved
trace must be reproducible as the same binary pixels on the `1270 x 1778`
canonical card grid.

- `measure_defects` receives the saved final trace, never the intent stroke's
  bounds and never a rectangle.
- Measurement clips the trace to the approved physical-card material mask, then
  applies the existing Corner/Edge/Surface zones and defect multiplier.
- The source trace remains immutable provenance. The separate overlap
  aggregation may determine which type wins a scoring pixel, but it may not
  rewrite or discard the saved source trace.
- Type correction may change the applicable defect type and multiplier through
  the existing review action. It may not alter the saved trace geometry.
- No completion, SAM Memory, proposal, deduplication, report, or learning process
  may alter a human-saved trace after Save.

The active implementation must use the smallest deterministic trace
serialization that reproduces those exact canonical pixels. The existing JSON
`reviewedDefects` persistence is the intended storage seam; no schema migration
or new object store is expected. The exact serialization format choice is an
approval boundary: implementation must name and show Mark the proposed format
in the first code review and stop for his approval before persisting it. If the
existing seam cannot preserve the trace and stroke exactly, implementation must
stop for approval of any migration or storage change rather than introduce an
unapproved storage system.

### 3.4 Approved trace serialization

Mark approved `TK_SPEEDSTER_TRACE_RLE_V1` on 2026-08-04. It is the sole
persisted final-trace serialization approved by this addendum:

- grid: `1270 x 1778` binary pixels;
- origin and order: `TOP_LEFT`, `ROW_MAJOR_Y_X`;
- `runs`: alternating maximal zero/one run lengths, beginning with the zero
  run; `runs[0]` may be zero, every later run is positive, and the exact sum is
  `2,258,060`;
- fields: `format`, `width`, `height`, `origin`, `order`, `runs`, and `sha256`,
  with no additional fields; and
- SHA-256 preimage: the six metadata lines (`format`, `width`, `height`,
  `origin`, `order`, initial value `0`), followed by the comma-joined runs, all
  LF-terminated including the final line.

The cross-language golden trace has one set pixel at row-major index
`1,129,665`, runs `[1129665,1,1128394]`, and SHA-256
`928e33389ba8eb03acf1325532e93cfb615cf1527099bd53dbecd7e769cc6ed0`.
This approval does not authorize a second persisted trace format, a schema
migration, or a new storage system.

### 3.5 Approved bitmap transport and finding shape

Mark approved `TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1` on 2026-08-04 as a
transport-only representation. It never becomes persisted or grading
authority. The server deterministically converts it to and from the approved
`TK_SPEEDSTER_TRACE_RLE_V1` source trace.

- grid, origin, and order: `1270 x 1778`, `TOP_LEFT`, `ROW_MAJOR_Y_X`;
- bit packing: one bit per canonical pixel, `MSB_FIRST` in each byte;
- exact byte length: `282,258`; the low four padding bits of the final byte are
  zero;
- exact base64 length: `376,344` characters; and
- exact fields: `format`, `width`, `height`, `origin`, `order`, `bitOrder`,
  `byteLength`, `dataBase64`, and `rleSha256`.

`rleSha256` must equal the SHA-256 of the deterministic approved RLE produced
from the transported pixels. Ordinary session, report, and action responses do
not embed aggregate RLE bodies. An authenticated review client or a published
report may fetch one trace at a time, and that response uses only the approved
bitmap wire. Persisted JSON continues to contain only RLE.

One saved exact trace is represented as one stable source finding. Its original
finding ID, origin, review result, source views, fingerprint, Memory provenance,
trace provenance, and RLE occur once at source level. It has no top-level zone,
contour, or measurement. Its ordered `measurementRegions` children contain only
the non-empty disjoint `CORNERS`, `EDGES`, and `SURFACE` partitions with each
partition's derived contour and measurement. The integer child pixel counts
must sum exactly to the material-clipped pixels attributed to that source, and
overlap ownership may count each scoring pixel only once. Historical
contour-era findings remain flat and read-only compatible.

### 3.6 One server-owned review-action path

Smart-Mark Save, Remove, Undo, and Change Type use one authenticated
server-owned action path. The server loads the current persisted capture and
findings, accepts only the changed action and at most one bitmap-wire trace,
performs one measurement pass, recalculates the grade, and persists the RLE,
source/measurement-region findings, and grade together. The generic session
update path cannot write reviewed findings or grade reports.

Remove stores the exact prior review result as server-private action state.
Undo accepts only the finding ID, restores that state, and removes the private
marker in the same persistence operation. No private marker, trace body, or
client-supplied restored finding may appear in public/report/service payloads.
Completion accepts no client findings or grade, rereads the server-owned state,
and applies the existing completion dispositions and grade calculation there.

## 4. One review interaction

There is one drawing surface: the enlarged zoom panel. There is no drawing on
the full-card map and no second editor.

### New missed defect

1. The reviewer selects Smart-Mark and clicks the missed-defect location on the
   existing master card map.
2. That click opens the enlarged zoom panel centered on the selected canonical
   location; it does not create or measure a finding.
3. The reviewer draws the highlight stroke in the panel.
4. At stroke-end, SAM re-proposes once from the point prompt.
5. The reviewer may leave the proposal unchanged, refine it with another
   highlighter stroke, directly paint with the plain brush, or remove pixels
   with the eraser. Each completed highlighter stroke may cause one new SAM
   proposal; brush and eraser edits never call SAM.
6. Save persists the on-screen final trace and its stroke provenance, then the
   existing defect-type action remains available.

### Existing finding

Clicking an existing pin opens the same enlarged zoom panel with that finding's
saved trace. Highlighter refinement may re-propose once at stroke-end. Plain
brush and eraser edit the visible trace directly. The reviewer may ignore the
latest SAM proposal; whatever trace is visible at Save is authoritative.

### Coordinate contract

The panel and card share one affine crop transform on the canonical map:

- the panel crop is a canonical-card rectangle;
- panel pointer coordinates map directly through that one affine transform to
  canonical pixels;
- the inverse of the same transform renders the canonical trace in the panel;
- no source-image, CSS-layout, report-image, or second transform may participate
  in measurement; and
- identical crop bytes plus identical panel points must produce identical
  canonical points.

## 5. Exact failure behavior

A valid trace is a finite, non-empty canonical binary mask after clipping to
physical card material. There is no minimum-area, maximum-area, area-ratio,
confidence, or grade-effect requirement.

When a new Smart-Mark has no valid final trace at Save:

- create no finding;
- change no grade or measurement;
- write no Smart-Mark lesson;
- show one visible non-blocking error in the existing review workspace; and
- keep the card workflow usable, including review of other findings and grade
  completion.

When an edit of an existing finding has no valid final trace at Save:

- do not replace the previously saved trace;
- change no finding, measurement, grade, or learning provenance;
- show the same visible non-blocking error; and
- keep the workflow usable. The existing Remove action remains the intentional
  way to remove a finding.

If SAM, evidence loading, point prompting, trace decoding, or mapping fails, no
rectangle is created or measured. The visible panel keeps any human-painted
trace already present. A reviewer may save that trace if it is valid; otherwise
the no-valid-trace behavior above applies. This is one human-editable trace path,
not a fallback measurement path.

The error clears on the reviewer's next successful trace operation or existing
explicit navigation. It never disables Complete Grade, adds a confirmation, or
sends work to a queue.

## 6. Proposal geometry subtraction

Before OpenCV components become SAM prompt cores, the anomaly residual must
remove the expected physical cut-boundary response. For rounded cards, the
boundary model follows the approved `3.18 mm` corner arc.

This subtraction is narrowly defined:

- it applies only to proposal residual/core generation;
- it subtracts boundary-aligned response within the `3.18 mm` rounded-corner arc
  band instead of masking the whole corner region;
- residual that departs from the expected boundary, extends materially inward,
  or crosses the boundary normal remains eligible evidence;
- it does not change the physical material mask, canonical zones, SAM model,
  final trace, measurement, scoring, or Memory bank; and
- it introduces no alternate proposal path.

The immutable Cubone Back top-right reproduction is the required fixture. Its
current approximately `80 x 73 px` candidate core must no longer occupy most of
the corner. After subtraction, the candidate core must have area below a
fixture-derived bound of approximately `30%` of the corner zone and must
intersect the stored rim region. The fixture must store that rim region and the
derivation of the bound so this is a deterministic area-and-intersection
assertion, not a visual-only or pixel-exact rim-confinement claim.

## 7. Conditional material-boundary wedge rejection

Wedge rejection is not authorized merely by approval of this addendum. After
the proposal-boundary subtraction above is implemented and its Cubone fixtures
are run, inspect the resulting masks:

- If the two known oversized Cubone masks already fail acceptance, add no wedge
  rejection code.
- If either still passes, add one deterministic acceptance rule based only on
  the fraction of the final mask perimeter that coincides with the expected
  physical material boundary.

The one threshold must be derived from only these immutable Cubone outcomes:

- the large Front Memory mask (`12.2425 mm²`) must fail;
- the large Back detector mask (`9.5975 mm²`) must fail; and
- the small Front sliver (`1.4375 mm²`, approximately `1.44 mm²`) must pass.

The chosen metric, boundary distance, and single threshold must be asserted and
documented with those fixtures. No other area-ratio rule, zone cap, score-aware
cap, smallest-mask preference, or mask-size heuristic is permitted.

This is a rejection rule inside the existing detector acceptance path. It does
not create an operator gate, alternate detector, or fallback.

## 8. Acceptance contract

Acceptance is read-only with respect to every completed report and card.

### Cubone

Re-run the completed Cubone evidence using reviewer-corrected traces without
writing the session, report, label, learning bank, image, or historical grade.

- Front Corner weighted damage must fall from the verified published baseline
  `20.903165735568%` to less than `5%`. This is a one-time read-only
  release-validation check on the known
  Cubone fixture only. It does not run in Production, is not a grading rule,
  and places no limit on how much Corner damage any real card may have.
- The corrected visible traces must match Mark's visual judgment of the physical
  damage.
- The calculation must use the unchanged denominator, multipliers, thresholds,
  front/back weighting, and scoring curve.
- The output must identify the before/after trace areas and weighted Corner
  percentages so the result is reproducible.

### Unrelated control

Re-run one immutable unrelated control card. Excluding version/diagnostic
metadata, its canonical proposals, finding origins/types, measured areas,
subgrades, and overall grade must be identical to the pre-change fixture. No
historical row or report is rewritten.

The Cubone and control runs are release-validation evidence, not new steps in
the ordinary grading workflow.

## 9. Exact conflicts this addendum supersedes

This approved addendum supersedes only the following Smart-Mark measurement
clauses in `docs/ai-grader-v2-sam-memory-v2-frozen-blueprint.md`; it does not
edit that frozen file or change SAM Memory proposal generation:

| Current frozen clause | Approved replacement |
| --- | --- |
| The human rectangle remains grading authority. | The persisted human stroke is intent; the saved final trace is sole grading authority. |
| SAM receives a box prompt. | The same SAM 3 receives positive points along the stroke plus geometry-derived known-clean negative points. |
| A SAM trace is visual/fingerprint support only. | The trace visible at Save is the exact measured geometry. |
| An invalid trace pools features over the human box. | Human-box pooling is removed from the active Smart-Mark path; an invalid trace creates no new finding or grade mutation. |
| A hard fingerprint failure saves and measures the Smart-Mark rectangle. | No rectangle fallback exists; a valid human-painted trace may still save, otherwise no finding is created. |
| The review overlay is the clipped human rectangle. | The review and report overlay is the saved final trace. |
| Trace/fingerprint branches must leave human geometry, measurement, grade, and completion identical. | The final trace intentionally determines geometry and measurement; failure leaves state unchanged and remains non-blocking. |

The following existing tests encode the current behavior and must be replaced,
not weakened or retained as a second path, under the mandatory sequencing below:

- `frontend/nextjs-app/tests/aiGraderV2Review.test.ts` — **Smart-Mark
  fingerprint branches cannot change geometry, measurement, grade, or
  completion**;
- `frontend/nextjs-app/tests/aiGraderV2InspectionFrame.test.ts` — **Smart-Mark
  boxes may use the context but measurement receives only card intersection**;
- `backend/ai-grader-speedster-service/test_sam3_detector.py` — **invalid trace
  pools the on-card human box at an edge**;
- the same Python file — **hard failure keeps human geometry measurement and
  completion data**;
- the same Python file — **legacy measurement never loads SAM without
  evidence**; and
- the same Python file — **measure endpoint survives evidence image load
  failure**, where survival currently means measuring the rectangle.

Replacement sequencing is mandatory and does not change the normative behavior
above: write each replacement test and observe it failing before changing the
behavior; keep the Lane 2 provenance regression green both before and after the
change; and do not delete any existing contract test until its replacement
exists.

Historical completed findings remain readable under their stored historical
geometry and grade. Compatibility is read-only; no old rectangle is remeasured,
rewritten, or relabeled as a trace.

## 10. Minimal implementation plan

Implementation remains subject to the format and migration/storage approval
boundaries in Section 3.3 and Step 1.

1. **Contract and regressions.** Add the minimal stroke/final-trace provenance
   fields to the existing Speedster finding JSON contract. In the first code
   review, name and show Mark the exact proposed trace serialization format and
   stop for his approval of that format before persistence work. Write failing
   tests for trace-only authority, no-valid-trace behavior, affine mapping,
   immutable post-save trace, historical parsing, and the current Cubone/control
   fixtures. Do not add a database migration unless evidence proves the existing
   JSON seam cannot preserve the contract; stop for approval if that occurs.
2. **Single zoom drawing surface.** Replace drag-box interaction with a master-map
   anchor that opens the existing enlarged evidence area as the only drawing
   panel. Add highlighter, plain brush, and eraser to that surface. Reuse the
   existing defect pin, type pills, Remove, grade display, and workflow; add no
   screen, modal confirmation, queue, or completion blocker.
3. **One SAM point-prompt path.** In the existing Speedster service, map the
   canonical stroke to positive points, derive only permitted known-clean
   negative points, request one SAM proposal per highlighter stroke-end, and
   return the trace for on-screen editing. Remove active human-box pooling and
   rectangle-measurement behavior. Preserve the existing model, endpoint,
   feature space, and Memory provenance rules.
4. **Trace persistence and measurement.** Save the exact on-screen trace and
   stroke provenance through the existing finding/session JSON. Route the saved
   trace through the Lane 2 single measurement/overlap pass. Preserve finding
   identity, origin, review state, fingerprints, Memory provenance, and source
   trace bytes; never append a separately remeasured Smart-Mark region.
5. **Boundary subtraction.** Modify only the existing anomaly-residual/core
   formation to subtract the expected material-boundary and rounded-arc
   response. Freeze the Cubone approximately `80 x 73 px` pre-change core and
   assert that the post-subtraction core is below the fixture-derived bound of
   approximately `30%` of the Corner zone and intersects the stored rim region.
6. **Conditional wedge decision.** Run the three Cubone mask fixtures. Add the
   single boundary-coincidence rule only if either oversized mask still passes;
   otherwise add no code. Assert two fails and the `1.44 mm²` sliver passes.
7. **Read-only validation.** Run focused frontend/service/measurement suites,
   the completed Cubone replay, and the unrelated control replay. Produce the
   exact before/after evidence for Mark without mutating Production or any
   published report.

Integration must begin only after the approved Geometry and Overlap lanes are
reviewed so this work consumes their final geometry/measurement contracts rather
than creating parallel implementations.

## 11. Explicitly out of scope

- No score-curve or threshold changes.
- No Centering zero/miscut work.
- No new models, detectors, fallback systems, queues, or retraining.
- No new screens beyond the enlarged zoom panel; no new reviewer gates or
  confirmation steps.
- No mutation of historical published reports.
- No changes to SAM Memory proposal generation or the frozen Memory blueprint.

## 12. Language discipline

Better prompting and corrected final traces can improve measurement accuracy
immediately. SAM Memory gains are compounding because approved human evidence
accumulates over completed cards. Documentation, UI, tests, and release notes
must never claim that SAM learns instantly from a stroke or that one correction
retrained the model.
