# ATLAS manual grading workspace

The current staff review uses `FocusedGeometryWorkspace` for one source photo
at a time and `DefectReviewWorkspace` for its measured findings. Both preserve
canonical photo/frame lineage and explicit human approval. Final report
approval stays separate.

```jsx
import { FocusedGeometryWorkspace } from '@atlas/manual-workspace/focused-geometry';
import '@atlas/manual-workspace/focused-geometry.css';

<FocusedGeometryWorkspace
  workspace={savedGeometry}
  images={verifiedImageDescriptors}
  side={currentSide}
  onApproveSide={saveAndApproveCurrentSide}
  onEditingChange={setEditing}
/>
```

The editor shows physical edges and projected printed borders together on the
oriented source photo. Pointer and keyboard adjustments remain local until
**Approve** submits both outlines. A rejected save retains that exact draft.
The host resolves callbacks only after authoritative save/readback and protects
pending work when navigating away. Authentication, atomic revision comparisons,
preparation, measurement, and final report approval belong to the host.

`images` has independent `FRONT`/`BACK` entries containing original and prepared
image descriptors. The shared loader verifies bounded image bytes and the
editor checks intrinsic dimensions before enabling handles. Context previews
never unlock editing. A verified lossless display transport preserves the
canonical geometry source hash.

The package root exports only `geometryImage`, `geometryImageBinding`,
`reviewImageDisplay`, and `reviewImagePreview` from `src/geometry-image.mjs`.
The retired paired editor has no component or package export.

Import findings review from `@atlas/manual-workspace/defects`, image-cache scope
from `@atlas/manual-workspace/image-cache`, and final report review from
`@atlas/manual-workspace/report-review`. Saved defect traces preserve canonical
masks, source provenance, and actual CPU measurements. Unmeasurable observations
remain excluded evidence; current measured findings receive human review.

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
@atlas/manual-workspace` builds and runs the geometry, review, image verification,
and snapping tests. The build also removes the retired generated paired entry.

The current loopback review fixture is `scripts/unified-review-fixture.mjs`.
`geometry-display-browser.mjs` checks preview/full-image verification with the
focused editor; `review-performance-browser.mjs` measures Front and Back as
individual focused screens and verifies warm image-cache reuse. Their synthetic
or retained test images do not establish real-card grading accuracy.

The old paired-editor preview apps and browser drivers are removed. The shared
`scripts/generate-preview.py` remains for CPU preparation and connected tests.
