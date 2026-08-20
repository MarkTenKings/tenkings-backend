# Speedster correction retention and latency audit — 2026-08-20

## Scope and safety

- Baseline: `origin/main` `972c34ded9ccb0c8993e996311b40d191236357d` (PR #356 merge).
- Candidate branch: `codex/speedster-correction-retention-latency-20260820`.
- Production inspection was read-only. Every database transaction issued `SET TRANSACTION READ ONLY`; no session was retried and no database, storage, Card Map, Memory, RunPod, Vercel, or policy state was mutated.
- Public report and permanent-card pages were inspected without changing state.
- No model, threshold, grading rule, Card Map rule, Memory rule, or geometry policy was changed.

## Exact back-to-back Charmander pair

| Evidence | First completion | Second completion |
| --- | --- | --- |
| Session | `cmt16hft30000ecx5adt926tv` | `cmt1qwdz90000v0su7zj881za` |
| Created / completed | `2026-08-20T07:07:35.368Z` / `2026-08-20T07:12:49.341Z` | `2026-08-20T16:39:05.157Z` / `2026-08-20T16:51:43.185Z` |
| Identity | 2023 CHARMANDER, REVERSE HOLO, 004/165, POKEMON, MEW EN | Exact match |
| Front original SHA-256 | `a2ab820bcf97af66f4778c4956f8ae1462aff5b2630390d8cea0c628df0b8f23` | Exact match |
| Back original SHA-256 | `2f6195e7869b3ac0f01abba013580145116b884a7985fdb52f058ec36a97f358` | Exact match |
| Card Map revision | `cmswxnbnl0003w6b8zqeb3s8d` | Exact match |
| Map filter | `speedster-map-filter-authority-padding-v2`, hash `9525555e…` | Exact match |
| Applied registration lessons | Front `cmt0m8sma000anbkd5x88etpf`; Back `cmt0m923b000dnbkdb28mjnqz` | Exact match |
| New registration lessons sourced from run | None | None |
| Report / label / card | `speedster-cmt16hft30000ecx5adt926tv`; TKH-001429; `cmt16o4bi000cecx5qr3myooz` | `speedster-cmt1qwdz90000v0su7zj881za`; TKH-001430; `cmt1rcl420008m6sp7ls6grlx` |

## Geometry comparison and verdict

Point order is TL, TR, BR, BL. Values below are the exact persisted normalized coordinates.

### Front physical outer

Both runs proposed and confirmed the same quad, with `proposalChanged=false`:

`[(0.07360609246309473,0.08737354429941328),(0.8760000561910962,0.08073852175757998),(0.8760000561910962,0.9200000460185702),(0.09551168371129919,0.9200000460185702)]`

### Front printed frame

Both runs proposed and confirmed the same quad, with `proposalChanged=false`:

`[(0.03858267716535433,0.03037120359955005),(0.962992125984252,0.03037120359955005),(0.962992125984252,0.9718785151856018),(0.03858267716535433,0.9718785151856018)]`

### Back physical outer

Both runs produced the byte-identical proposal:

`[(0.07770520669442636,0.06365363560025654),(0.9019739060174852,0.06118964770483592),(0.8978375631665426,0.9168158031645275),(0.09189559290648769,0.9028265211317275)]`

The first human confirmation changed it to:

`[(0.07770520669442636,0.06365363560025654),(0.9019739060174852,0.06118964770483592),(0.8975091805866471,0.9142311099232191),(0.09340637511500473,0.9007746063290645)]`

The second run did not reuse that correction and required a new human change:

`[(0.07770520669442636,0.06365363560025654),(0.9019739060174852,0.06118964770483592),(0.8969358123596055,0.9091767616418833),(0.09303888951259111,0.9005323910610871)]`

Both rows have `proposalChanged=true`.

### Back printed frame

- First proposal/confirmation, `proposalChanged=false`: `[(0.05039370078740157,0.04499437570303712),(0.9433070866141732,0.04499437570303712),(0.9433070866141732,0.9595050618672666),(0.05039370078740157,0.9595050618672666)]`.
- Second proposal/confirmation, `proposalChanged=false`: `[(0.04960629921259842,0.04555680539932509),(0.9433070866141732,0.04555680539932509),(0.9433070866141732,0.9623172103487064),(0.04960629921259842,0.9623172103487064)]`.

### Geometry conclusion

Geometry correction learning is **disproven for this exact pair**. The same Back source hash produced the same physical proposal after the first human correction, and the second operator had to edit it again. The four Color Geometry evidence rows per session are persisted scoring/monitoring evidence; current proposal generation does not consume earlier Color Geometry confirmations. Neither session created a registration lesson. The changed, untouched Back printed-frame proposal is therefore upstream proposal variation, not evidence that the first run taught the second.

## Defect corrections and learning

All listed edited findings have three-way SHA equality: `finalTrace.sha256 == traceProvenance.finalTraceSha256 == featureFingerprintTraceSha256`.

### Completion 1429

| Correction | Final persisted evidence |
| --- | --- |
| Edited existing Memory mask `FRONT:sam3-front-e29bd0df56303606:CORNERS` | CHIPPING_EXPOSED_STOCK; SHA-256 `8ea37f1a67467122ba29af19c600d112a85a57fde11acca688b8bf4aeece821e`; CORNERS 1,314 px / 3.285 mm² |
| Edited existing Memory mask `FRONT:sam3-front-39c9a6a20b7525c3:CORNERS` | DENT_MATERIAL_DAMAGE; SHA-256 `93dfdb26333bd2d5f28630846ec8846e3848dbab19a04662c77cc50422ea569d`; CORNERS 2,171 px / 5.4275 mm² plus EDGES 2,318 px / 5.795 mm² |
| Smart Mark `BACK:smart-b9b5722a-3830-4e10-ac98-7ae92190ae60` | FAINT_COLOR_VARIATION; SHA-256 `d12f19059624f71ef729b6ee060deac0d954ed34322e6876b5c0237f79ee303f`; CORNERS/EDGES/SURFACE regions |

Persisted result: 33 findings (28 Memory, 4 Detector, 1 Smart Mark); 21 Removed, 11 Accepted, 1 SmartMarked. Instrumentation records 25 review events and 10 server review requests. Completion harvested 24 lessons: 21 `DETECTOR_REMOVED`, 2 `HUMAN_TRACE_CORRECTION_POSITIVE`, and 1 `SMART_MARK_POSITIVE`; nine untouched Memory acceptances were correctly skipped. Catch-up completed as `V2_UPDATED` before the next detection.

### Completion 1430

| Correction | Final persisted evidence |
| --- | --- |
| Smart Mark `FRONT:smart-aaa4db4e-c097-4605-b741-f1d135b6cf41`, created as FAINT_COLOR_VARIATION then retyped | Final VISIBLE_WHITENING / `TYPE_CORRECTED`; SHA-256 `63e39414a485069e732a31d084734fa3da6f16f8092cfa52b2d636c7a9dd70b9`; CORNERS 220 px / 0.55 mm² plus EDGES 1,922 px / 4.805 mm² |
| Edited Memory mask learned from completion 1429, `BACK:sam3-back-9f3e11b4cf253647:EDGES` | FAINT_COLOR_VARIATION; SHA-256 `96bf9580dfee084026e1ce7b2d2a0e1eb8528d086f9a73c9aee9cb38819f628d`; proposal points to session 1429, completion 1429, proposal 28, lesson 23, similarity 0.938935 |
| Edited Memory mask `BACK:sam3-back-1fd5fbd5cacb90e6:SURFACE` | FRAYING; SHA-256 `a3ba7357425f171c8278c18ac38c49ab3cc0d957645fc83f9dc977c302cac797` |
| Edited Memory mask `BACK:sam3-back-1c505b8a618986cf:CORNERS` | CHIPPING_EXPOSED_STOCK; SHA-256 `94003dbe29b9cfc4f3a34aca6e81b8dd57b017ce77e3b1e82e2771ed4fd26554` |

Persisted result: 25 findings (21 Memory, 3 Detector, 1 Smart Mark); 11 Removed, 13 Accepted, 1 TypeCorrected. Instrumentation records 20 final review events, including six edits and one retype, across 12 server actions. Completion harvested 16 lessons: 11 removed negatives, 1 untouched Detector positive, 3 human-trace positives, and 1 Smart-Mark positive using only the final VISIBLE_WHITENING type; nine untouched Memory acceptances were correctly skipped.

### Learning verdict

The global calibrated v2 bank advanced immediately through completion 1430 (`tau=0.8`, margin `0.1`, capacity `50`, 552 exemplars, replay cursor digest `2822255a…`). Entries 512–535 came from completion 1429 and entries 536–551 from 1430.

- **Smart Mark storage/activation/application: pass.** Completion 1429 proposal 28 / lesson 23 became a Memory proposal in the next exact scan. Two split Back findings point to the exact source session/completion with similarity `0.938935`; one remained untouched and `BACK:sam3-back-9f3e11b4cf253647:EDGES` was subsequently edited.
- **Edited Memory-mask storage/activation: pass.** Both first-run edits were harvested as positive, hash-bound lessons and inserted into the bank before the next scan.
- **Edited Memory-mask next-scan application: not observed.** No second-run proposal names either first-run edited lesson. This is not promoted to a failure claim because the changed Back inspection artifact and similarity/gating can legitimately prevent a match; it is an explicit evidence gap.
- **Geometry learning: fail for this pair.** Geometry evidence is retained, but it is not a proposal-learning input.

## Human-correction survival chain

| Boundary | Evidence | Result |
| --- | --- | --- |
| UI → API | Review controls await the server result and replace client state from it; a synchronous in-flight guard prevents racing actions. Production instrumentation records the actual review actions. | Pass |
| API → persisted review | Review actions run in a SERIALIZABLE transaction with revision guard. Trace save removes obsolete detector-mask authority, installs the new trace, and remeasures. Exact final hashes/types/statuses above are in `reviewedDefects`. | Pass |
| Review → completion | `complete-label` recomputes from persisted `reviewedDefects`, then atomically stores COMPLETED state, reviewed findings, grade report, label, and card before awaiting bank catch-up. | Pass |
| Completion → report | Public V2 output removes only private undo/hydration state and intentionally filters Removed findings; it preserves active final trace/provenance/type/origin from the same completed session. | Pass |
| Report → label | Labels intentionally snapshot grade/subgrades/identity, not per-defect geometry. TKH-001429 stores 7.1 (10/1/7.3/10); TKH-001430 stores 7.5 (10/1/9.3/9.7), matching their grade reports. | Pass for the label contract |
| Report → permanent card | Each `CollectibleCardV2` resolves its exact completed session; the permanent card renders that session's public report rather than maintaining a divergent defect copy. | Pass |

Observed public UI matches persisted active findings exactly: completion 1429 is grade 7.1 with Front 05 / Back 07 on both report and permanent card; completion 1430 is grade 7.5 with Front 06 / Back 08 on both. Removed findings remain in the immutable completed-session/audit evidence and are intentionally absent from collector-facing output.

## Production timing evidence

Durations below are measured persisted/client instrumentation. Operator-inclusive stages are not presented as service latency.

| Stage | Completion 1429 | Completion 1430 | Interpretation |
| --- | ---: | ---: | --- |
| Draft created | 32.129 s | 18.199 s | Lower-bound/operator-inclusive |
| Photos ready | 24.137 s | 32.102 s | Operator/device inclusive |
| Geometry proposed | 13.134 s | 6.087 s | Code-owned Front then Back serial path in deployed source |
| Map registration, Front / Back | 1.883 / 3.480 s | 3.455 / 7.824 s | Service timings |
| Geometry confirmed, Front / Back | 9.320 / 24.370 s | 11.447 / 41.582 s | Operator-inclusive |
| Centering, Front / Back | 8.897 / 9.049 s | 28.208 / 34.459 s | Operator-inclusive |
| Capture save | 0.619 s | 0.850 s | Server-visible |
| Initial review | 16.514 s server / 17.894 s client | 66.271 s server / 67.142 s client | Second run includes one recorded Front RunPod 502 (33.336 s) followed by allowed retry success (22.459 s); Back was 8.897 s |
| Review action average / maximum, server | 0.650 / 0.864 s | 0.780 / 1.211 s | Persisted actions |
| Review action average / maximum, client | 1.205 / 1.730 s | 1.675 / 2.708 s | UI round trip |
| Durable completion / readiness / response | 0.546 / 0.298 / 1.215 s | 0.489 / 0.354 / 1.048 s | Completion path |
| Full cycle | 344.282 s | 774.329 s | Operator-inclusive; not a pure performance metric |

Front/Back detection and prepared-image work are already parallel. The clearest independent serial wait was the initial `CaptureWorkspace.beginGeometry` path: it awaited Front upload+proposal before starting Back upload+proposal.

## Surgical latency change

- Initial Front and Back upload→geometry pipelines now start together with `Promise.all`; ordering within a side remains upload before proposal.
- The pair remains atomic at the UI boundary: no geometry state or stage transition is committed until both sides succeed. Targeted single-side recapture is unchanged.
- `GEOMETRY_PROPOSED` now records `geometryExecutionMode=PARALLEL_SIDE_PIPELINES_V1` plus bounded Front/Back upload and geometry durations, enabling exact Production before/after attribution after an approved release.
- Controlled deterministic comparison: two equal 5,000 ms geometry calls require 10,000 ms under the prior serial awaits and produce a 5,000 ms `GEOMETRY_PROPOSED` duration in the candidate, a 50% transition reduction. This is a controlled code-path result, not a claimed Production post-deploy measurement.

## Validation and release boundary

- Node `20.20.1`: changed-file ESLint passed.
- Node `20.20.1`: complete `aiGraderV2|speedster` suite passed `565/565`.
- Node `20.20.1`: `VERCEL_ENV=production RUN_DB_MIGRATIONS=false pnpm vercel:build` explicitly skipped migrations, passed dependency builds plus Next lint/type checks, and generated `77/77` pages. Only previously known unrelated image/hook/browser-data/local optional-Sharp warnings appeared.
- `git diff --check` passed.
- No deploy, merge, migration, Production retry, or Production mutation was performed. Exact Production after-timing remains pending owner approval and a natural post-release card; the new instrumentation is the measurement boundary.
