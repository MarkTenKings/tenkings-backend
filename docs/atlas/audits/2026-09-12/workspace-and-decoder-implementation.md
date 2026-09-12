# Paired geometry and raster decoder checkpoint

September 12 UTC, branch `codex/atlas-speedster-astra-lead-20260911`, following
foundation commit `6d2e588bad3ce13ed0121fd7c77a9735fe90031f`.

Mark approved the sample combined Front/Back geometry layout: “yes, it feels
great.” His experimental Front physical-edge adjustment was not a real-card
correction. The blueprint and canonical plan now record the layout approval;
borderless grading, actual image detail, defect/learning approval and automatic
Astra continuation remain separate decisions.

Two fresh `gpt-6-astra` / `xhigh` specialists implemented isolated geometry actions
and raster decoding while root built and checked the controlled screen. An
additional fresh extraction assignment was rejected by actual tool-tree capacity;
no extra sidebar task or limit workaround was created. The geometry specialist
also independently reviewed the root UI and decoder. All changes are local.

## Implemented

[`@atlas/manual-workspace`](../../../../packages/atlas-manual-workspace/README.md)
contains the controlled paired React screen, pure versioned geometry actions and
an unchanged extraction of existing gradient snapping. Physical and printed
outlines share one screen; printed corners project onto the original using the
saved homography. Precise dragging, zoom/pan and pixel nudges buffer local edits
until save. Rejected saves retain the draft. Newer same-side state fences an
unsaved adjustment without replacing it. Tool changes and confirmation wait for
pending edits. Both current image bindings must load at their verified dimensions
before geometry confirmation becomes available.

The action module validates actual-source descriptors, canonical 1270×1778 warp
geometry, 1350×1858 inspection frame and exact 40-pixel card bounds. Front physical
edits invalidate only dependent Front work and the report; printed changes reuse
prepared pixels and current defect inspection while recomputing existing
centering. Back work survives. Monotonic revisions fence stale proposals,
preparations, edits/undo and later human review. Confirm-both is one checked human
geometry action with no final report or automatic Astra approval authority.
Existing scoring and the unmeasurable-borderless outcome are unchanged.

The host still must provide authenticated atomic saves/readback, durable source
and action storage, exact URL-to-byte verification, dependent-state invalidation
and real preparation. Without a current prepared image the screen truthfully
shows **Needs preparation**. No production route imports this package. The
separate development sample has browser-local persistence only, explicitly
synthetic outlines/images and no live preparation endpoint or detector result.

[`@atlas/photo-runtime`](../../../../packages/atlas-photo-runtime/README.md)
checks an owned exact-byte snapshot against photo-core upload/source bindings and
decodes supported JPEG/PNG/WebP in a disposable child. It returns a full-size,
once-oriented, separately hashed sRGB PNG; 16-bit PNG retains 16-bit samples and
alpha survives. Source bytes are untouched. Previously accepted original
metadata remains immutable; later observations belong to the decode plan.
Stored-frame descriptors are produced only from caller-observed destinations;
this module does not upload or authenticate storage.

Required input/pixel/raster/output limits produce explicit failures rather than
downsampling. Timeout or cancellation kills and reaps the child before cleanup.
Child diagnostics are bounded and application credentials are not inherited.
Native codec temporary allocations still require an outer server resource policy;
the package does not claim a hard native-memory ceiling on this Mac. Dynamic
range stays unknown unless already independently known, and the sRGB conversion
is not proof of HDR/wide-gamut or fine-defect fidelity. Unsupported multi-frame
and explicit PQ/HLG containers fail rather than silently selecting a first frame.

**HEIC is still explicitly unsupported in the public runtime.** A separate real
libheif probe confirmed usable HEVC decoding and proved the primary image can be
the second top-level image. It also found the existing display API uses RGBA8 and
already applies container transformations. The full primary-item, crop/orientation,
ICC/NCLX and greater-than-8-bit interpretation is not implemented together.
Refusal preserves originals for the future adapter. Native iPhone intake is not
complete, and browser-converted samples are not claimed as HEIC acceptance.

## Validation and corrections

Root ran 22 geometry/snapping tests and 50 photo-runtime tests: all pass, zero
skips. The geometry suite checks selective validity, exact math/projection,
stale/reload/undo behavior and atomic current-side confirmation. Snapping retains
every implementation byte of the reviewed source after the type-only import
change. The package build records zero old-operator/application dependencies.

The decoder suite uses actual encoded files: all eight EXIF orientations across
three formats, independent pixel permutations,3024×4032 dimensions, 16-bit detail,
ICC/alpha observations, exact original reconciliation, corrupt/multi-frame inputs
and real blocked-child kill/reap checks. Independent review passed 67 combined
runtime/photo-core tests after correcting two edge cases: malformed cancellation
setup could return before its child exited, and a new unknown dynamic-range
observation incorrectly conflicted with a previously known source value. Both
now have regressions and independently verified corrections.

The UI review corrected unavailable-photo confirmation, misleading preparation
progress and load-readiness behavior for equal-byte frame revisions. Root then
ran seven browser scenarios on Chrome 152.0.7977.83, with zero page errors:

- Missing, wrong-hash, failed and wrong-dimension photos block confirmation and
  recover when the exact view is restored.
- Equal-byte preparation with the same URL and a new revision restores readiness.
- A one-pixel printed edit survives a rejected save and subsequently saves/reloads;
  Back and prepared pixels remain identical.
- A newer same-side edit retains and fences the local unsaved draft.
- A zoomed/panned drag maps correctly to source coordinates; a physical save
  invalidates only Front preparation and prevents confirmation.
- Confirm-both updates both current geometry reviews and prevents duplicate review.
- A 390-pixel viewport stacks Front then Back without overflow or image distortion.

Root inspected desktop/mobile screenshots. Six synthetic PNGs were actually
generated and prepared through the existing CPU warp; their hashes/transforms
were used by the sample. The first drag test attempted an offscreen handle after
insufficient pan and timed out; the harness was corrected to pan the handle into
view, then all scenarios passed. No application coordinate defect was inferred
from that test setup mistake.

Tests ran on local Node 25.6.1/macOS arm64 with pinned React 18.3.1,
esbuild 0.27.7, Playwright 1.57.0 and Sharp 0.33.5/libvips 8.15.3. Root added only the
two new workspace lock importers, using existing locked dependency versions and
read-only dependency links to the prior checkout for local execution. No global
dependency upgrade, earlier-worktree write or unrelated test suite was needed.
These results are not production Node/Linux or optical grading acceptance.

The loopback-only preview was started under the recorded plan, used for synthetic
browser checks and stopped. The cleanup receipt verifies owned PID 52359 exited
and port 4179 has no listener. Generated artifacts remain ignored/local.

## Evidence and remaining work

Evidence root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-workspace-20260912/`.
It contains `geometry-actions/REPORT.md`, the UI/decoder independent reviews,
`photo-runtime/REPORT.md`, sealed source manifests, encoded/HEIC investigation
receipts, root test outputs, `browser/browser-results.json`, desktop/mobile
screenshots and `preview-cleanup.json`. Root's `integration-manifest.json` binds
the final package source, lock and retained verification artifacts.

Next integration needs native HEIC interpretation and real iPhone color/detail
acceptance; immutable storage and authenticated persistence; real automatic
preparation/detector proposals; the shared identifier/research engine; defect
editing/measurement and deliberate review/learning; manual report/finishing;
and the unresolved runtime diagnostic on an appropriate native-x86 target.
The isolated UI and raster adapter do not satisfy those remaining steps.

Serving I and failed real-card acceptance remain unchanged. No production
data/configuration, provider inference, remote runtime resource, deployment,
migration, old-card recovery, final report approval or physical finishing occurred.
The initiating-cause prerequisite remains OPEN.
