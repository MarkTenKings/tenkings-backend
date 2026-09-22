# First clean Speedster foundation

September 11 Pacific / September 12 UTC, 2026. Work starts from `ae0339ad` on `codex/atlas-speedster-astra-lead-20260911`. Mark directed the lead to work through the remaining list with fresh Astra Extra High specialists and selected **standard-size sports and Pokémon first**. The [rebuild plan](../../plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md) stays canonical. Existing 63.5 × 88.9 mm grading geometry and scoring remain unchanged.

Four fresh `gpt-6-astra` / `xhigh` specialists completed implementation or independent review in this batch. Up to three ran alongside root. A fifth fresh assignment was rejected by the tool's task-tree limit; it did not start, and no extra sidebar task or concurrency workaround was created. Root implemented the manual report preview, integrated the changes and recorded owner decisions. No shared identity/research engine extraction was implemented in this batch.

## What is implemented locally

| Boundary | Code and behavior | Verification |
| --- | --- | --- |
| Native photo contracts | [`@atlas/photo-core`](../../../../packages/atlas-photo-core/README.md): immutable original, separately decoded raster and derived-view descriptors; all eight orientation/mirror transforms; source/side/pair hashes; same-upload reconciliation and selective replacement invalidation | 17 synthetic contract tests; no decoder, upload endpoint or storage implementation |
| CPU manual measurement | [`manual_measurement.py`](../../../../backend/ai-grader-speedster-service/manual_measurement.py): checked one-side action boundary, existing exact trace/mask reconciliation, unchanged measurement helpers, exact 40-pixel inspection crop and optional injected fingerprinting | 30 tests: 14 new plus 11 existing math and five existing RLE tests; raw masks/zone ownership/measurements and full old/new outputs compared |
| Truthful manual draft | [`manual-report.ts`](../../../../packages/atlas-grading-core/src/manual-report.ts): declares HUMAN inspection without a detector result; calculates through unchanged identity, centering, finding and scoring functions | 12 grading-core tests, including seven manual-report tests; strict TypeScript check; all ten original extraction hashes unchanged |
| Native runtime diagnostic | External split app/PostgreSQL harness with fixture TLS, ownership checks, phase/pending-query/backend/resource/syslog tracing and bounded cleanup | Three tracing and six lifecycle tests, TLS certificate checks and 17 syntax checks; native build/integration remains unexecuted |

The application foundation suites total **59 passing tests**. They establish local contracts and deterministic extraction parity, not live grading accuracy or workflow acceptance. JavaScript checks use the available Node25.6.1; CPU checks use isolated Python3.9.6 with NumPy1.26.4/OpenCV4.10.0.84. Pillow11.3.0 is needed only for the legacy comparison module. Production runtime behavior has not been tested by these suites.

The new photo package has no dependencies. Root added its empty pnpm workspace-lock entry. Grading-core used local read-only links to existing pinned esbuild0.27.7/zod4.1.11 dependencies; the older checkout was not changed. The 13-entry grading-core build retains its closed dependency check and reports zero ambient effect dependencies. Existing production report/detector call sites and the operator are unchanged.

## Exact behavioral boundaries

**Photos:** validators check declared observations; the future server must actually verify object bytes/MIME, retain originals and enforce immutable writes. An original receipt with unknown metadata stays immutable; later observations belong to its decode plan. The package does not decode HEIC or prove iPhone color/detail parity. It represents primary-still HEIC after real codec inspection, with explicit orientation and integer crop; complex/fractional container transforms require verified adapter support. Image sequences, arbitrary HEIF codecs and RAW/DNG are not silently admitted. Decoder allocation limits are resource controls, not card/spending allowances.

**Measurement:** the checked `measure_manual_side` rejects invalid inputs and requested marks absent from the reconciled output. The separate low-level `measure_marks` preserves legacy behavior for exact comparison, including omissions/traceErrors that must never become action success. Optional fingerprint failure preserves measurements and removes stale edited fingerprints. The caller owns action/frame validity, active findings and removed-finding history; an empty measured side is not proof that someone inspected it. No SAM/model startup is required on the new CPU import path.

**Manual reports:** each side's HUMAN inspection is bound to its current inspection-image hash and authoritative finding revision. The current report has a separate draft revision. Identity or printed-border edits can recompute the report while preserving valid defect inspection; a Front finding/type/trace/removal/review/undo change invalidates Front inspection without requiring Back to be repeated. The future authenticated adapter must enforce those revision changes and truthful inspector evidence. The pure preview grants no report approval, certificate, label, shared lesson or publication authority and preserves unreviewed states. Borderless centering retains the existing unmeasurable-geometry rejection while its owner rule/release timing is unresolved.

The independent reviewer identified the first draft's unnecessarily broad inspection invalidation. Root corrected it before integration and added a regression covering identity/border changes, independent Back preservation and undo back to equal content. The reviewer independently ran the foundation suites and checked an external Python-to-TypeScript roundtrip: square/rounded outputs for both sides plus actual `TRACE_SAVE` detector-to-trace conversion, nine findings accepted by the existing grading-core parser. These are synthetic contract checks, not a deployed service call or physical-card result.

## Runtime limitation remains

The fresh read-only host census at06:08:09 UTC found four shared CPUs, 14 running containers, load1.81 and no isolated CPU or container cpuset reservation. Approximately5.68GB available memory is not evidence of reserved CPU capacity. No already-available isolated native target was found through reviewed configured access. No remote test resources, local VM, paid inference, application deployment, database migration, restart or old-card replay ran in this batch.

The external [native report](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/native-runtime/REPORT.md) and [reproduction instructions](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/native-runtime/RUN.md) now provide executable preparation rather than only a narrative plan. A future reviewed dedicated Linux-x86 target must supply separate app1 CPU/2GiB and PG1 CPU/1GiB capacity, existing access, free disk and no competing host workloads. Root must record the concrete lifecycle and exact plan/source/harness hashes before execution. The current serving host fails this harness's dedicated-target guard.

Local guard/certificate tests do not prove Docker, PostgreSQL or Prisma integration. The candidate still models the final retained continuation, not the earlier two-applied-step incident state; same-host TLS is not the managed network/storage/syslog sink. If both native cases eventually pass, retain that negative evidence and stop escalating artificial load. The initiating-cause prerequisite remains **OPEN**, and serving I remains at failed real-card acceptance.

## Next integration work

1. Finish the combined physical-edge/printed-border stage review, including borderless release treatment and real-image detail acceptance. A task-local screen concept uses sample outlines and has no grading or persistence connection.
2. Implement bounded real server decoding and exact-object verification, then test actual iPhone originals through native intake. Wire the checked CPU measurement/report boundaries into the reviewed manual path with authoritative per-side revisions and current report approval.
3. Connect the reviewed current Ten Kings identifier/research, shared knowledge publication and detector comparisons through their separate adapters. Preserve the stage order and all remaining acceptance gates in the canonical plan.
4. Execute the native diagnostic when an appropriate target is available; preserve the owner's initiating-cause requirement before replacement operator implementation. No production rollout follows from this foundation checkpoint.

## Retained evidence

Evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/`. Root verified all462 native manifest members, all four photo package files, all eight CPU source/test files and the three CPU report artifacts, with zero hash or byte-count mismatches. The [independent review](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/independent-review/REVIEW.md) binds 19 reviewed source files and retains the nine-finding cross-language check; root verified the final reviewed source hashes as well.

| Evidence | SHA-256 |
| --- | --- |
| [CPU report](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/cpu-measurement/REPORT.md) | `b22bcaa65fa432ee82a224d42fbf30de515736e4f77d4fde14653f56d05ca31a` |
| [CPU artifact manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/cpu-measurement/artifact-manifest.json) | `e38b6c0751727a4ad05375f1570c88bd128b97727287428536fe5be6aa87feb5` |
| [Photo report](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/photo-intake/REPORT.md) | `8282c2d7195fccd82c7046517c38fe20f58d607dec83c31503e5c2266727bf9b` |
| [Photo manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/photo-intake/manifest.json) | `38bde3a7f33aa636f616a55357fc20b1e0e01f34e42e9b898f61cafb0becb32c` |
| [Native harness manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/native-runtime/artifact-manifest.json) | `e5ffd0c02d978cf14d74faa2aecabe111d2a00fec53526f6425e39bee816ca0a` |
| [Independent review](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/independent-review/REVIEW.md) | `65f491771e9096241d2db8f3a0d8c096dc18262cd9d0cba69407ee693264d3aa` |
| [Reviewed source manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/independent-review/reviewed-source-manifest.json) | `3035f89263f4581397c784a3c11698b7b818e50fb32a08ef08b205a3768136d1` |
