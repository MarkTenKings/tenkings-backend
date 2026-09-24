# ATLAS manual grading workspace

An isolated controlled React component and pure geometry actions for the approved
Front-left/Back-right layout. It uses the existing standard-size sports/Pokémon
geometry and scoring. No production application imports this package yet.

The package now also exports `DefectReviewWorkspace` from `./defects`, its
`./defects.css` stylesheet, and pure actions from `./defect-actions`. The paired
inspection view supports selection, type correction, removal/restore, manual
brush/eraser traces, stroke undo, Fit/2×/4×/8× zoom and pan. Its card display crops
the exact40-pixel inspection margin; it does not substitute rectified pixels.
Saved traces preserve existing canonical masks/crop/source provenance and actual
CPU measurements. Pending candidates stay visible and expose retry/discard.

Both current image descriptors must load at the exact inspection dimensions.
After per-side inspection, one **Confirm findings** action accepts the corrected
list. Final report approval stays separate. Async callbacks must durably save
and read back state; `onEditingChange` on either component lets a host protect
unsaved work during navigation. The authenticated server/client composition and
actual PostgreSQL/CPU browser fixture live in `@atlas/manual-workflow`.

The component displays physical edges and projected printed borders together.
Physical editing uses the already oriented source; printed editing uses the exact
current rectified image. It offers existing gradient snapping, Fit/2×/4× zoom,
pan controls, pointer handles and one-source-pixel keyboard nudges (Shift: ten).
Snapping retains the existing 1,000-pixel-long-edge map and corner/tool options;
`snapping-extraction.json` records the unchanged engine source.

Adjustments stay local until **Save outline**. Rejected saves retain the draft.
A newer same-side version fences the draft without overwriting it; the user can
discard it to adopt the latest saved state. Tool changes and confirmation wait
for unsaved work. Both current image bindings must actually load with matching
dimensions before **Confirm both sides** is available. This is geometry review,
not final report approval. No borderless or automatic Astra approval rule is
introduced.

```jsx
import { PairedGeometryWorkspace } from '@atlas/manual-workspace';
import '@atlas/manual-workspace/styles.css';

<PairedGeometryWorkspace
  workspace={savedGeometry}
  images={verifiedImageUrls}
  onEdit={saveGeometryAction}
  onPrepare={prepareSavedSide}
  onConfirm={confirmCurrentGeometry}
  saveStatus={actualSaveStatus}
  preparingSides={actualPreparationStatus}
/>
```

`images` has independent `FRONT`/`BACK` entries containing `original` and
`rectified` descriptors, each `{url, sha256}`. URLs must resolve to the immutable
bytes identified by the current frame hashes. The browser compares descriptors
and intrinsic dimensions; it cannot authenticate storage or prove matching
content from the URL alone. The host supplies a verified decoded/oriented
original, not untransformed camera bytes.

Async callbacks resolve only after authoritative save/readback and must update
`workspace`; rejection means the action was not confirmed saved. The host owns
authentication, atomic version comparisons, original/frame storage, action
history and all dependent invalidations. It must recover ambiguous successful
saves by reading the current operation result. It must protect pending edits
when navigating away or switching cards. This component is not a durable
unsaved-draft store. An unfinished adjustment may need repeating after reload.

`onPrepare` is optional. When missing, a saved physical edit truthfully shows
**Needs preparation** and cannot confirm. A real host should run deterministic
preparation automatically after a saved physical edit, keeping manual retry
available. `preparingSides` reflects actual in-flight work independently for
Front and Back. The reusable component has no production preparation endpoint,
defect detector, upload control, defect stage, queue, learning publication or
finishing authority. The separate synthetic harness below now exercises the
CPU preparation adapter.

## Geometry actions

Import from `@atlas/manual-workspace/geometry-actions`. The API creates a paired
workspace; issues current dependency bases; applies physical/printed edits and
verified prepared frames; changes photos/settings; projects borders between
frames; confirms both reviewed sides atomically; and validates serialized state.

Every mutation returns `{state, invalidated}`. Consume its affected-side and
report invalidations atomically with the host's defect/inspection/report state.
Physical edits invalidate that side's preparation and dependent work; printed
edits recompute only centering and preserve prepared pixels/defect inspection.
Back work survives Front edits. Monotonic revisions fence late proposals and
edit-and-undo, including newer human review or dependent output changes.

The geometry convention remains source `x*width`, `y*height`, mapping physical
corners to canonical pixel centers `[0,0]` through `[1269,1777]`. Inspection is
1350×1858 with card bounds at `(40,40)` of size 1270×1778. Homographies must map
the actual saved source quad to those corners. Do not substitute snapping's
width-minus-one raster normalization or rotate an already oriented image again.
Descriptors and dependency bases are consistency checks, not authentication.

## Local verification

Build `@atlas/grading-core` before this package. `npm test --workspace
@atlas/manual-workspace` runs the build, pure geometry cases and snapping parity.
The exported browser bundle checks that it imports no old operator/app services.

For the separate synthetic browser harness, set `ATLAS_FIXTURE_PYTHON` to an
environment containing the service's NumPy/OpenCV dependencies and run
`npm run dev --workspace @atlas/manual-workspace`. It binds only 127.0.0.1:4179,
generates six PNGs using the existing CPU warp, and labels every card synthetic.
Initial known fixture outlines are explicitly sample geometry. The harness
verifies and decodes the actual PNG originals once using `@atlas/photo-runtime`.
After a physical save it runs `@atlas/preparation-runtime`, adopts a current
engine printed-border proposal and loads its actual immutable WebP. The same
Python environment must contain the pinned NumPy 1.26.4/OpenCV 4.10.0.84 versions
used for parity. Preparation currently accepts opaque sRGB RGB8 decoded PNGs.

The loopback `/prepare` endpoint accepts only the generated fixture sides,
bounded same-origin JSON and at most two active synthetic CPU jobs. It cancels
superseded requests and fences late results against the current saved geometry.
Generated files stay in ignored `dist/preview`; state persists only in the
sample's browser-local key. This is not authenticated durable application
persistence. `?autoPrepare=0` is a test hook for manual-retry/error scenarios.
**Reset sample** restores the known fixture. Stop with Ctrl-C; shutdown aborts
and reaps active preparation children.

With Chrome available, set `ATLAS_BROWSER_EVIDENCE` to a task-owned output
directory and run `npm run test:browser --workspace @atlas/manual-workspace`.
This checks load failures, save/reload and stale-edit recovery, equal-byte
preparation revisions, zoom/pan dragging, both-side confirmation, mobile fit and
physical save → actual CPU preparation → verified derivative reload.
The test hooks and sample app are excluded from the exported package build.
Synthetic browser checks do not establish optical grading or real-card acceptance.
