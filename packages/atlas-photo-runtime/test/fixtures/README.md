# HEIC refusal fixtures

The two tiny HEVC-encoded color fixtures are unchanged files from
[libheif source 08075aebcc0d9bf7d35f900c36114b1b6e90ed7d](https://github.com/strukturag/libheif/tree/08075aebcc0d9bf7d35f900c36114b1b6e90ed7d/fuzzing/data/corpus).
Upstream's COPYING is retained as `LIBHEIF-COPYING`. Their SHA-256 values are fixed
in `heic-boundary.test.mjs`. One has a thumbnail; it is not a browser-converted
JPEG/PNG stand-in. Local libheif-js 1.23.2 investigation decoded these actual
fixtures, but the runtime deliberately refuses HEIC pending the full primary,
transform, color and bit-depth adapter. These fixture tests prove the refusal
boundary and original-byte retention only, not HEIC support or optical quality.

`process-fixture.mjs` is original test code that deliberately blocks its own
event loop or produces invalid output so the parent termination path is real.
