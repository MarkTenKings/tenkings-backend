# ATLAS CPU preparation runtime

An isolated Node adapter for the existing CPU physical-edge, card warp,
inspection, reveal and printed-border engines. It uses no model, GPU, network,
database or old operator. Connected manual intake uses this package for automatic
geometry and explicit manual preparation.

`prepareGeometry` takes the saved geometry workspace, side, verified photo-core
original/decode-plan/frame descriptors, exact decoded `Uint8Array` bytes,
explicit resource limits and an absolute `pythonExecutable`. Optional `signal`
must be a real AbortSignal. Input state, limits and bytes are copied before any
asynchronous work. The frame must match the saved card, side, photo version,
original hash, decoded hash and dimensions.

```js
const result = await prepareGeometry({
  workspace: savedGeometry,
  side: 'FRONT',
  source: { original, decodePlan, frame, bytes: decodedPng },
  limits: {
    maxInputBytes: 64 * 1024 * 1024,
    maxPixels: 24_000_000,
    maxOutputBytes: 32 * 1024 * 1024,
    timeoutMs: 15_000,
  },
  pythonExecutable: configuredPython,
  signal,
});
```

The current engine accepts **opaque sRGB RGB8 PNG**. Alpha, higher bit depth and
unmanaged color are explicitly unsupported here; the retained native original
and decoded frame are not flattened or overwritten. Native HEIC decoding alone
therefore does not establish that every decoded iPhone image can use this
preparation pipeline. Actual original/inspection fine-defect acceptance remains
required before selecting broader color or depth treatment.

The Python child verifies the actual PNG bytes and decoded array, uses the retained
geometry algorithms, and by default creates five real WebP92 images:
1270×1778 `rectified`, and 1350×1858 `inspection`, `normalized`, `microDefect` and
`directional`. Inspection card bounds remain `(40,40,1270,1778)`. The extracted
reveal and encoding function bodies match `preparation_core.py` exactly; the
source manifest is `backend/ai-grader-speedster-service/preparation-pixels-extraction.json`.
Returned output hashes, byte counts, dimensions and transforms are verified.
Library versions and engine source hashes accompany the result. A genuine
printed-border proposal or engine abstention is returned, without human approval.

## Automatic core and deferred reveal contracts

`preparePhotoGeometry({ ...input, outputContract: PREPARATION_CORE_V1 })` uses
`atlas-preparation-core-v1`: only `rectified` and `inspection` are generated.
Physical/printed detection, source resolution, two warps, WebP quality 92,
transforms and proposal gates are identical to full preparation. Optional reveal
pixels are not computed or encoded. Results retain `outputContract` and the exact
`sourceQuad`; the contract is part of the preparation identifier and automatic
geometry engine/cache key. An old unversioned five-image cache cannot satisfy a
new core request.

Omitting `outputContract` preserves the full five-output API, explicitly returned
as `atlas-preparation-full-v1`. `prepareGeometry`, including manual re-preparation,
continues to produce all five outputs. Historical manifests without a contract
remain full manifests. Unsupported or malformed contract values are rejected.

Automatic `PREPARED_IMAGES` manifests retain the verified working PNG descriptor
and core preparation metadata under `deferredReveals`. No original or working
PNG is removed. A future authorized lazy consumer can use
`prepareDeferredPhotoReveals({ source, prepared, matColor, engine, limits,
pythonExecutable, signal })`, where `source` contains the freshly verified
working PNG and `prepared` is that saved core metadata. This API deliberately
recomputes from the working PNG with the saved quad, verifies exact original core
hashes, transforms and complete printed proposal, then returns only normalized,
microDefect and directional outputs under `atlas-preparation-reveals-v1`. It
retains the parent preparation ID and original prepared frame. It does not write
storage, alter the parent manifest, replace a frame, or rebind an analysis.
Recomputation occurs only on explicit demand, outside automatic capture→ASTRA;
there is no new lazy UI route. A lossy prepared WebP is never a valid source.

RGB8 Lab normalization uses an exhaustive float32 byte lookup with identical
values; other supported source types retain the previous operations. Printed
detection samples rotation views instead of copying entire Lab rasters. Tests
compare all byte values, noncontiguous inputs and complete proposal/quality
results against the previous operations.

`proposePhysicalGeometry` runs the existing physical-edge proposal against that
same verified source and returns its current geometry dependency base. It does
not adopt or confirm a proposed outline.

Persist and verify every required output before calling
`adoptGeometryPreparation(currentWorkspace, result)`, also exported from
`@atlas/manual-workspace/preparation-result` for browser hosts. This pure action
rejects stale photo/physical/preparation bases. A changed mat/corner setting can
keep the valid warp while discarding the outdated printed proposal. Consume its
affected-side/report invalidations atomically with the host's saved state.
`describePreparationDerivative` validates actual output bytes and creates a
source-bound descriptor for a caller-observed destination; it does not write an
object or authenticate a storage receipt. Authentication, compare-and-set saves,
history, durable retries and dependent grading state remain host responsibilities.

## Runtime and verification

The worker starts with Python isolated mode, a reduced environment, one OpenCV
thread and bounded diagnostics. Cancellation/deadline kills and reaps the actual
child before temporary-file cleanup or resolution. Input/pixel/output limits do
not impose a hard native-memory ceiling; the deployment needs an outer process
resource policy. The deadline covers the child, not all parent filesystem work.

The retained local parity environment is Python 3.9.6, NumPy 1.26.4 and OpenCV
4.10.0.84 (`cv2.__version__ == '4.10.0'`). This worker needs only those two pinned
CPU libraries from the service dependencies. The adapter records observed versions;
it does not qualify arbitrary replacement libraries. Package deployment must
include the fixed backend worker and its CPU modules at their repository paths.

Set `ATLAS_PREPARATION_PYTHON` to the absolute pinned Python executable, then run
`npm test --workspace @atlas/preparation-runtime`. Focused checks cover all
five legacy byte hashes, genuine proposals, selective invalidation, stale
results, exact derivative lineage, input/output limits, caller mutation and real
blocked-child kill/reap. Local synthetic parity is not production-runtime or
real-card optical acceptance.
