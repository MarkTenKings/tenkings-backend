# ATLAS checked manual measurement runtime

`measureDefectWorkspaceEdit({ workspace, side, pythonExecutable, limits, signal })`
runs a pending defect edit in an isolated Python process and returns the exact
result accepted by `applyDefectMeasurement`. Limits require positive integer
`maxInputBytes`, `maxOutputBytes`, `maxFindings` and `timeoutMs`. The Python path
must be absolute and contain the qualified NumPy/OpenCV dependencies.

The action layer reuses `remeasureSpeedsterReviewAction`; the child reuses
`measure_manual_side`. Type, removal, undo and exact trace edits remeasure the
whole affected side, preserving overlap ownership and deterministic scoring.
No SAM, model request, detector initialization, image decoding or fingerprinting
runs. This measures supplied canonical masks. The host must establish the
authentic current prepared-image/frame descriptors independently.

The in-memory state and pending action are snapshotted before awaits. Parent and
child verify actual CPU source hashes against `engine-source.json`. Large input
and output JSON use private task-owned temporary files. Only small path/hash
metadata uses stdin/stdout, and only hashes, sizes and observed engine versions
remain in the returned receipt. The parent verifies actual output bytes and the
core action layer reconciles the expected finding/trace/source identities.

Timeout/cancellation terminates and reaps the child before temporary cleanup and
resolution. Input/output bounds do not establish an outer native-memory limit;
deployment must provide its actual process/resource policy. The child deadline
does not include parent filesystem work. The qualified local environment is
Python3.9.6, NumPy1.26.4, OpenCV4.10.0 on macOS. No Linux/provider deployment or
real-card image-detail acceptance is implied.

Persist the complete defect workspace as a verified immutable artifact, with
only its storage key, SHA256, byte count, draft revision and necessary stage
metadata in the compact database record. The authenticated host owns CAS and
actor authority; neither a browser-provided `receipt` nor these pure action
bases is an authenticated measurement. Keep failed candidates available for
retry or explicit discard. Final report approval and learning publication remain
separate and are never created by this runtime.

Tests use actual CPU measurements on synthetic masks plus child-process
timeout/cancellation and input/output/source-drift refusals:

```sh
ATLAS_MEASUREMENT_PYTHON=/absolute/pinned/venv/bin/python node --test packages/atlas-measurement-runtime/test/*.test.mjs
```
