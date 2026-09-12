# Engine inspection before the clean manual build

September 11, 2026, local time. Source inspected at `fd766f0a`; live metadata observed September 12 at 01:44 UTC. This is a source/dependency review with read-only database counts, not a GPU benchmark, accuracy certification or implemented optimization.

## Recommendation

Keep the combined Front-left/Back-right workspace direction. Start its implementation from selected engines and small new adapters. Separate three decisions: retaining the SAM model, retaining the ability to learn after reviewed cards, and importing historical lessons/maps. The owner is willing to omit historical data if that accelerates cleanup; no deletion or reset has been requested as an immediate operation.

Do not make old-session/history migration a prerequisite for the new build. The existing active Memory bank is small enough that importing its compatible snapshot may be easier than recreating the knowledge. Prove a baseline path with no Memory/maps, then integrate learning and optional maps deliberately. A first baseline test without Memory is not acceptance of a finished product that lacks the requested next-card learning.

The previously failed Astra run stopped before source preparation/detection/map processing. Resetting these lessons or maps cannot fix that particular operator reservation failure. Its initiating SQL/wait remains unresolved in the earlier audit.

## What the database actually contains

| Item | Read-only observation |
| --- | --- |
| Active `GLOBAL` Memory bank | Version 2, CALIBRATED; 559 examples from 48 source cards |
| Active bank JSON size | 535,358 bytes, approximately 0.54 MB |
| Calibration | tau 0.80, margin 0.10 |
| Bank last updated | August 21, 2026, 22:19:42.725 UTC |
| Card maps | 4 maps, all with a current revision; 18 revisions total |

These counts describe the stored bank, not proof that a particular scan used it. The last-update date alone does not prove that learning failed; completed-card activity and the application path would also need checking. The owner's estimate of about 50 lessons appears closer to the count of source cards than individual examples.

Receipt: `/Users/markthomas/.codex/atlas-handoffs/atlas-engine-review-20260911/memory-map-summary.json`, SHA256 `0d394a400329b4973cbfdccb96600333a8e12244cdcce37e8e2d5427db940964`. Only summary metadata was retrieved; no lesson bank, card photograph or map export was performed.

## What each engine does

| Engine | Actual role | Extraction decision |
| --- | --- | --- |
| Physical boundary | Finds the outside edges/corners of the card | Keep CPU geometry functions and human snapping |
| Preparation and printed border | Straightens from the physical corners, creates inspection views, finds the printed frame | Keep computation; replace surrounding workflow/I/O adapters |
| SAM 3 detector | Segments candidate areas into masks; those masks support defect measurement | Keep pinned model/runtime; assess candidate selection and correction latency |
| Memory V2 | Compares 32-number visual fingerprints with positive/negative examples; can veto familiar false positives, protect explicit positive matches and propose areas resembling human Smart-Marks | Keep learning capability; historical-bank import is separable |
| Card maps | Align known card-design reference geometry and help distinguish printed design from apparent damage | Keep optional engine; old-map migration need not block the build |
| Grading math | Measures defects and calculates centering/subgrades/final grade with existing rules | Keep deterministic core; do not change scoring for speed |

SAM's base model weights are not retrained after each card in this implementation. The user's corrections update the separate Memory example bank. Dropping that bank loses remembered examples, not SAM's general segmentation capability.

Physical/printed geometry and preparation do not require card maps. They can operate on a previously unseen card. Map-assisted results for a known design may differ from no-map results, so compare both on the mapped cards before choosing default behavior.

Map filtering runs after detection: it can remove eligible machine findings inside aligned design zones, while preserving human Smart-Marks. Omitting maps skips registration/filtering but does not remove the initial SAM inference and may increase manual false-positive review. Retaining a map means its required reference images and geometry as well as its JSON record; a four-record table copy alone is not a complete import.

## What “learn on the next card” currently means

The Ten Kings completion route harvests reviewed findings after durable card completion. It records removed detector findings as negatives, corrected types as negative/positive pairs, and qualifying Smart-Marks/trace corrections as positives. It also admits selected untouched detector acceptances; untouched Memory-origin acceptance does not teach itself again.

Follow-up source finding during consolidated planning: a corrected type's positive lesson does not itself relabel subsequent candidates. `sam_memory_v2.py:402` retrieves examples for the candidate's already-proposed type; `smart_mark_proposal_seeds_v2:332` admits only `SMART_MARK_POSITIVE` as new proposal sources. The harvest's `DETECTOR_RELABELED_POSITIVE` at `learning-harvest-v2.ts:268` is not such a source. Thus changing a finding to a type outside the ordinary four heuristic types does not by itself make that type appear on the next card. This is a concrete learning-path limitation, not a claim that SAM cannot be trained or that Astra has already solved it. The [consolidated plan](../../plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md) includes a targeted candidate/type/next-card comparison.

The V2 catch-up path locks the global label/completion key, reads completed labels after the bank cursor, loads their sessions and updates the bank. Detection repeats that catch-up check before reading the bank. This is intended to make newly completed lessons available to the next detection. A catch-up failure can fall back to the last validated bank, so “instant every time” is not an unconditional guarantee. This describes the legacy completion path; ATLAS's separate trusted-learning code generates candidates and does not itself write the active bank.

The current TypeScript detection wrapper requires a calibrated V2 bank. The Python engine supports `learning_bank=None`, but rejects a supplied incompatible/uncalibrated bank. Therefore simply deleting the current database bank is not a functioning reset strategy. The clean adapter needs an explicit no-Memory baseline path and a defined transition to learning.

Proposed simpler behavior: publish the small updated Memory version when a reviewed card completes; each newly starting scan uses the latest committed version. In-flight cards keep their starting version. This avoids restarting work or rebuilding all historical sessions before each scan, while keeping the next-card learning requirement explicit. Exact implementation and interruption behavior remain to be designed.

## Opportunities ranked for evaluation

| Priority | Observed behavior | Proposed improvement | Evidence needed before claiming improvement |
| --- | --- | --- | --- |
| 1 | CPU `/geometry` and `/map-registration` run in `app.py`, whose startup loads SAM; the existing CPU-only service exposes `/prepare` | Host CPU geometry/preparation separately from GPU model startup | Cold/warm stage timings; matching geometry outputs |
| 2 | Normal scan reuses one SAM image state per view, but Smart-Mark strokes and saved-trace fingerprint calls repeat `set_image`; saving several marks calls it for each mark | Reuse one image state per unchanged evidence image across corrections, or batch saved-mark fingerprints | Identical masks/fingerprints, invalidation when pixels change, GPU memory bounds, correction latency |
| 3 | Completion and pre-detection Memory catch-up use a shared label lock and old session/history reads | Update a small versioned bank at completion; separate learning publication from label workflows | Next scan sees the completed lesson; simultaneous graders do not block on historical replay |
| 4 | Initial anomaly selection defaults to eight candidates per view, excludes large/long regions, and assigns four heuristic defect types before SAM segments them | Evaluate candidate coverage before changing thresholds, caps or classification | Human-labeled cases covering faint, large, long and different defect types; recall, false positives and runtime |
| 5 | Original files can exceed 12 MP, but standardized rectified/inspection views are smaller | Evaluate original-resolution crops for tiny defects where useful | Better detail detection without unacceptable scan latency; do not assume a larger upload means every engine uses every original pixel |

Existing efficient behavior should remain: model loading is reused within a worker; normal side scanning embeds each view once and reuses that state for its prompts; CPU preparation can operate without SAM. Removing already effective reuse would make the rebuild worse.

Additional profiling target: each view transfers a 256 × 72 × 72 float32 feature tensor to CPU (5,308,416 bytes), prompts transfer masks/scores, and defect fusion compares full-grid masks. These are identifiable costs, not measured bottleneck rankings. Current `samMemoryMs` combines several activities; separate image load, lock wait, encoding, prompt inference, Memory matching, transfers, fusion and serialization timings before choosing lower-level optimizations.

No measured speedup is claimed for these proposals. Model/state caching must not mix two cards or stale images. Detection coverage changes can affect grading outcomes and require different validation from harmless removal of repeated computation.

## Migration choice

| Choice | Effort implication | Result |
| --- | --- | --- |
| Import active compatible Memory snapshot only | Small data transfer plus compatibility verification; avoids reconstructing old completion history | Retains remembered examples |
| Start without historical Memory examples | Skips snapshot import, but still requires explicit startup/calibration behavior and new-learning integration | SAM baseline remains; prior human corrections are forgotten |
| Recreate maps as needed | Avoids old map/reference-asset migration | Known printed designs initially receive no map assistance |
| Import current maps | Must bring required reference geometry/images and replace old repository coupling | Retains assistance for those designs |

Recommended tradeoff: no historical migration project. Keep the learning engine. Import the small active bank if it is a direct compatible transfer; otherwise do not block the clean baseline on it. Treat the four existing maps as optional imports. Do not erase source data to achieve a clean dependency graph.

## Source references

- [CPU preparation](../../../../backend/ai-grader-speedster-service/preparation_core.py:153), [service startup](../../../../backend/ai-grader-speedster-service/app.py:59).
- [Side-wide image-state reuse](../../../../backend/ai-grader-speedster-service/sam3_detector.py:1490), [Smart-Mark embedding](../../../../backend/ai-grader-speedster-service/sam3_detector.py:1089), [trace embedding](../../../../backend/ai-grader-speedster-service/sam3_detector.py:1171), [per-mark loop](../../../../backend/ai-grader-speedster-service/sam3_detector.py:2355).
- [Candidate selection](../../../../backend/ai-grader-speedster-service/card_geometry.py:1245), [Memory preparation and decisions](../../../../backend/ai-grader-speedster-service/sam_memory_v2.py:158).
- [Memory catch-up/next-detect path](../../../../frontend/nextjs-app/lib/server/aiGraderV2LearningBank.ts:135), [harvesting](../../../../frontend/nextjs-app/lib/ai-grader-v2/learning-harvest-v2.ts:135), [calibrated-bank requirement](../../../../frontend/nextjs-app/lib/server/aiGraderV2ReviewAction.ts:725).
- [ATLAS candidate-only learning adapter](../../../../frontend/nextjs-app/lib/server/atlasTrustedLearning.ts:87), [map storage contract](../../../../packages/database/prisma/schema.prisma:3832), [grading core boundary](../../../../packages/atlas-grading-core/scripts/build.mjs:7).
