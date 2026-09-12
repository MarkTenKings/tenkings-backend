# Fresh Astra lead — source and runtime review

September 11 Pacific / September 12 UTC, 2026. Investigation and planning from handoff `d5f523167704ced57250a12f56228dd075e1d02a`, on the new lead's own `codex/atlas-speedster-astra-lead-20260911` branch. The [Speedster rebuild plan](../../plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md) remains canonical. This review does not change the serving I application or declare real-card acceptance passed.

Mark requested five fresh GPT-6 Astra Extra High specialists. All five completed in batches within the three-child limit: representative runtime failure; manual workspace/intake; engine accuracy/learning; shared Ten Kings engines; independent simplicity/recovery. Root read their reports, independently checked material source findings and integrated them into the plan/session records.

## Runtime evidence boundary

The initiating failure remains OPEN. Earlier exact-size/current-guard Mac fixtures passed; the forced parameter-logging sample established volume amplification, not the historical ten-second cause. The [provider-reply review](../2026-09-11/provider-reply-review.md) remains the prior diagnostic checkpoint. Mark's DigitalOcean sign-in and returned AI reply are complete; neither is a pending user task.

Root independently checked the actual runner sequence. Reservation precedes its external-work heartbeat. The heartbeat surrounds provider dispatch **and receipt persistence**, so those latter operations can overlap. An outer timeout does not cancel the underlying database promise; failure cleanup can encounter outstanding work. These are source-confirmed paths to measure, not proof of the initiating historical wait. See [runner](../../../../packages/atlas-operator/src/runner.mjs:153), [ledger transaction](../../../../packages/atlas-operator/src/ledger.mjs:321) and [staff transaction](../../../../frontend/atlas-app/lib/server/access/database.mjs:7).

The new isolated Linux diagnostic uses a stub provider, synthetic records, current guards, unchanged transaction/pool deadlines and real periodic renewal. Its projected read-only policy probe found a 30-second production lease, 180-second provider timeout and 8,000 maximum output tokens; the prior fixture used 60 seconds, 10 seconds and 2,000 tokens respectively. Matching policy and observing periodic renewals adds missing coverage; it does not make a local test identical to managed production.

Local environment lifecycle and any setup discrepancies are recorded before/after actions in [SESSION_LOG](../../../handoffs/SESSION_LOG.md). No paid inference, production data/configuration change, old-card rescue or replacement-operator implementation follows from this test.

Both Linux cases passed with 95 public/35 staff migrations, exact 12,207,165-byte continuation, pool one, PostgreSQL 17.11 and Node 22.23.2. Each ran one stub response after three seeded applied steps and observed two real periodic renewals. A 25-second stub produced a 27.948-second runner loop and 547 ms reserve. Completing the stub on the second periodic-renewal boundary produced a 23.253-second loop, 498 ms reserve, 289 ms renewal and 682 ms receipt persistence including 287 ms acquisition/BEGIN delay. The second schedule deliberately tests a valid overlap; it does not reconstruct the incident's schedule.

No ten-second failure or naturally qualifying one-second statement occurred. The isolated syslog consumer received 3,717 lifecycle/checkpoint bytes, with no parameter headers. Native ARM and a shared local app/DB container with loopback transport still differ from separate production x86 application/managed shared-vCPU resources and the provider sink. The task-owned container, volume and VM were stopped/removed and original Docker context preserved. These measurements narrow the missing evidence; they supply no causal correction.

The [next native-x86 arrangement](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/runtime/NEXT_NATIVE_X86.md) is prepared, not executed: separate test app1 CPU/2 GiB and PG1 CPU/1 GiB containers, owned internal network/volume, fixture TLS, original deadlines and no production credentials. A bounded read-only host census found approximately 5.64 GB available memory on the existing four-CPU host, but load2.07 and14 running containers. Memory fits that snapshot; spare CPU is not reserved. Do not start a test on this serving host merely because the memory fits. A reviewed native target is still needed. Same-host TLS would still not reproduce the managed network/sink. If it also passes, stop escalating artificial load and preserve the cause boundary.

The syslog reader's raw 212,992-byte receive-buffer field was hardcoded, not measured. The final summary flags it; only observed packets/bytes/timings are used here. No inferred buffer value supports a causal claim.

## Concrete extraction corrections

| Area | Source finding | Required plan treatment |
| --- | --- | --- |
| Native originals | Current upload/storage/evidence contracts as well as the decoder admit JPEG/PNG/WebP only | Separate immutable native-original descriptors from oriented decoded/prepared assets; bind derivatives to the original with hashes and transforms. A decoder alone is insufficient. |
| Manual operation | `measure_marks` contains trace validation/reconciliation inside the detector module; optional fingerprint work invokes SAM | Extract the complete CPU measurement entry point and inject optional fingerprinting. Keep manual edits usable without GPU assistance. |
| Manual report | The current report adapter requires a saved detector version; existing initialization depends on detection | Add truthful manual-inspection provenance and initialization, preserving deterministic recalculation. Never supply fake empty SAM output. |
| Snapping | Existing browser gradient maps use a raster capped at 1000 pixels | Bind human/Astra actions to the same named snap raster, coordinate rules and options. Native-resolution sampling is a separate behavior change. |
| Geometry inputs | Capture mat color and material corner shape affect proposals, clipping, measurements and snap options | Include them in the relevant action fingerprint; preserve unchanged pixels and the other side. An ACCEPTED proposal can still carry ambiguity. |
| Measurement geometry | Inspection adds a 40-pixel margin on each edge | Crop exactly to the canonical grid; preserve RLE holes/disconnected pixels, per-zone ownership and raw scores. Rounded-grade equality alone is insufficient. |
| Mask fusion | Direct overlap and precise cross-view dilation/overlap rules determine groups and pixel ownership | Preserve the 9 × 9 ellipse, half-smaller-mask threshold, transitive grouping and tie order. Dilation pixels never become damage. |
| Late maps | Map filtering exempts SMART_MARK origin; human edits retain DETECTOR/MEMORY origin | Adopt only still-applicable machine results and preserve human-reviewed/edited findings. Origin alone is insufficient. |
| Learning evaluation | Stored corrected-type positives cannot all originate new candidates; current matching is type/view based | Test actual next-card proposal/classification with held-out physical cards and acknowledged knowledge versions, separately from storing a lesson. |
| Full manual recovery | Old save/approval/finishing wrappers and SQL interlocks count UNKNOWN work without new-draft applicability | Preserve superseded attempt accounting while allowing the human's current inspected draft through save, approval and finishing. Fence late application and release scheduling capacity. |
| Lost result pointer | A stored result can survive even if the database link/reply is lost | Derive its object location from the recorded action/attempt, verify its binding/hash, then reconcile the same result. Lease expiry alone never permits a duplicate uncertain dispatch. |

Root directly verified snapping, manual report requirements, CPU measurement/fingerprint boundaries, map protection and type-correction behavior. The accuracy review verified all ten grading-core extraction hashes and passed the 14 pure Memory tests. System Python lacked NumPy/OpenCV for the existing math/RLE suites; those suites are not claimed passed. No GPU benchmark or grading-accuracy acceptance occurred.

Source anchors: [snapping](../../../../frontend/nextjs-app/lib/ai-grader-v2/gradient-snap.ts:47), [manual measurement](../../../../backend/ai-grader-speedster-service/sam3_detector.py:2244), [report calculation](../../../../packages/atlas-grading-core/src/report.ts:26), [inspection crop](../../../../backend/ai-grader-speedster-service/card_geometry.py:394), [fusion](../../../../backend/ai-grader-speedster-service/defect_math.py:89), [map filtering](../../../../frontend/nextjs-app/lib/ai-grader-v2/map-filter.ts:491), [human type correction](../../../../packages/atlas-grading-core/src/review.ts:512).

Root also verified the existing [approval blocker](../../../../frontend/atlas-app/lib/server/access/reports.mjs:34), [finishing blocker](../../../../frontend/atlas-app/lib/server/access/finishing.mjs:72), and [database interlock](../../../../frontend/atlas-app/prisma/migrations/20260908070000_operator_ledger/migration.sql:377). The clean persistence boundary must implement the new applicability rule alongside the UI; these old wrappers/guards must not be copied unchanged.

## Current Ten Kings source correction

The shared specialist independently verified READY production collect deployment `dpl_9tnY8SKGgrrzJWg9hcWoGLgSsZEG`, application `a319904273d4b4e4e81d721b699d3a2990975eda`, at04:15:40 UTC. Nine inspected source modules match that deployed snapshot despite a later documentation-only checkout commit. The identifier is unchanged; research v2 adds up to three validated searches within150s, per-search result evidence, verified accepted-offer amounts and separate visual-comparison classifications. Retain the v1/v2-compatible reader and old canonical hashes. The adjacent task reports five completed jobs at54.2–82.4s with all five estimates unknown; this is separate from our independent deployment check and not ATLAS performance evidence.

The [shared-engine record](../../plans/SHARED_CARD_ENGINES_DISCUSSION.md) and canonical plan now use this reviewed source. Required adapter details: neutral photo/subject descriptors instead of inventory IDs/JPEG key assumptions; Pokémon catalog lookup without an invented manufacturer; a separate catalog-linked private reference descriptor; 80-character source card-number suggestions retained when ATLAS's40-character mapping cannot adopt them; actual research-subcall receipts; and visual presentation from `comparison_assessments`, since old `rejections` means unselected, not necessarily wrong. Shared knowledge remains distinct from official catalog authority and private inventory/financial facts. No new source-team consultation or inference was needed.

## Decisions and acceptance still outstanding

These findings make the existing recommendation more precise; they do not approve unsettled grading rules. Continue the owner's stage-by-stage discussion with the combined physical-edge/printed-border workspace, then defects and final review. Borderless centering, supported size/category scope, inspection-detail acceptance, Astra continuation criteria, deliberate grading-lesson publication and detector selection remain the material topics already identified in the plan.

Routine decoder, adapter, cache and diagnostic implementation choices do not need a new owner approval ceremony. The owner's initiating-cause prerequisite still applies to the replacement operator. Manual extraction/planning can advance independently within the discussed scope; a full rebuild or deployment is not authorized by a passing fixture.

## External review artifacts

The task's reports and diagnostic receipts are retained under `/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/`. Root verified all470 runtime manifest entries and all nine shared-engine modules against deployed a319 bytes, with zero mismatches.

- [Engine accuracy and learning review](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/engine/REVIEW.md).
- [Manual workspace contract review and fourteen proposed acceptance fixtures](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/manual/MANUAL_WORKSPACE_CONTRACT_REVIEW.md).
- [Shared-engine review and nine proposed extraction fixtures](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/shared/FINDINGS.md).
- [Independent simplicity/recovery review](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/recovery/REVIEW.md).
- [Linux runtime report](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/runtime/REPORT.md), [summary](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/runtime/summary.json), [full manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-astra-20260912/runtime/artifact-manifest.json).

| Artifact relative to that evidence root | SHA-256 |
| --- | --- |
| `manual/MANUAL_WORKSPACE_CONTRACT_REVIEW.md` | `dc53cf75c03b7c63fda5ff38ae91c752664d70c167fe651f5151083f15a3d0db` |
| `engine/REVIEW.md` | `b79998f06ec87e59420079bd0a723e39046596f11fe1cd1cfa33988443d90c40` |
| `shared/FINDINGS.md` | `85aeb712772b7442f0ce12178e41d673ce679073deb904f8aa06f3535dbaa152` |
| `shared/deployment-readback.json` | `14761b163da6a1029246201f0f84dd6d08c823a1d5ec2f8f4d5ace70eb8b86d2` |
| `shared/source-manifest.json` | `ed1b068bbdcb301b4ab16908a15a4b035d923845a3ec0086a6517a42fe8153e6` |
| `recovery/REVIEW.md` | `74021b2ba34b17230e864cb98381433b39f79149129e94d302ae9da655660daf` |
| `runtime/REPORT.md` | `974e4bf46c7156eddb8dc8d75254407890beedd8abc8c3c9257c6451e19b1629` |
| `runtime/summary.json` | `cfcbee62b991a20f6d1b3ece0fcaad4c19a3e699192f8318b3bd07a073c6cabe` |
| `runtime/artifact-manifest.json` | `01ff6cc11cc6b6ae382cf18358e77aedc8c720ea0ce1b4badf37c4411562aa0b` |
| `runtime/NEXT_NATIVE_X86.md` | `bcb13f1119e6ac4667cd9bf32d422b7ec2c154fe36c9057584e27fc588a9ee4d` |
