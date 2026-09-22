# ATLAS CPU preparation runtime

An isolated Node adapter for the existing CPU physical-edge, card warp,
inspection, reveal and printed-border engines. It uses no model, GPU, network,
database or old operator. No production application imports this package yet.

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

The Python child verifies the actual PNG bytes and decoded array, uses unchanged
`card_geometry.py` and `color_geometry.py`, and creates five real WebP92 images:
1270×1778 `rectified`, and 1350×1858 `inspection`, `normalized`, `microDefect` and
`directional`. Inspection card bounds remain `(40,40,1270,1778)`. The extracted
reveal and encoding function bodies match `preparation_core.py` exactly; the
source manifest is `backend/ai-grader-speedster-service/preparation-pixels-extraction.json`.
Returned output hashes, byte counts, dimensions and transforms are verified.
Library versions and engine source hashes accompany the result. A genuine
printed-border proposal or engine abstention is returned, without human approval.

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
`npm test --workspace @atlas/preparation-runtime`. Nine focused checks cover all
five legacy byte hashes, genuine proposals, selective invalidation, stale
results, exact derivative lineage, input/output limits, caller mutation and real
blocked-child kill/reap. Local synthetic parity is not production-runtime or
real-card optical acceptance.
