# ATLAS test 3: retained source resolution

Completed September 28, 2026: six accepted requests, six completed responses, zero POST retries. The results do **not** support making this source-resolution policy the production default. Snivy retains grade 10; Magikarp loses score eligibility because four contours exceed the saved physical boundary. Abomasnow remains invalid, Mosaic remains blocked on printed geometry, and the two Threads cards remain diagnostic because their back outlines are unavailable. The six-call published-rate estimate is **$8.83018**. Production history, images, approvals and runtime are unchanged.

This is the bounded experiment authorized in [the handoff](../../../handoffs/ATLAS_ASTRA_FULL_RESOLUTION_TEST_HANDOFF_2026-09-28.md), using the exact same saved captures as the current lossless baseline. Experimental findings are machine proposals. They do not replace production analyses, reviewer decisions, approved reports or published images.

## Results

“Mapped” means structurally valid against saved geometry, not human-accepted. A single invalid contour withholds the complete experimental score. No partial grade is calculated from the surviving findings.

| Card | Same-capture lossless baseline | Full-resolution result | Experimental grade |
| --- | --- | --- | --- |
| 38 · Snivy | 11 findings; grade 10 | 18 mapped, all measured | **10**, unchanged |
| 39 · Abomasnow | 14 raw; whole response refused, five outside boundaries | 21 raw: 10 mapped, 11 outside boundaries | Withheld |
| 40 · Stormfront Magikarp | 9 findings; grade 9.5 | 14 raw: 10 mapped, 4 outside boundaries | Withheld; saved 9.5 unchanged |
| 41 · Mosaic Center Stage Dart | 2 findings; printed geometry unresolved | 2 mapped, both measured; same geometry blocker | Unavailable |
| 42 · Threads Maye | Back outline failed before ASTRA | 5 raw: 3 front mapped, 2 back unmappable | Diagnostic only |
| 43 · Threads Dart | Back outline failed before ASTRA | 5 raw: 4 front mapped, 1 back unmappable | Diagnostic only |

Only Snivy has a complete numeric pair. Its raw grade remains 9.775 and subgrades remain centering 10, corners 9.4, edges 9.7, surface 10. Back weighted corner damage changes from 1.2351% to 1.6527%, and edge damage from 0.4966% to 0.6937%, without crossing the existing score thresholds. There is no experimental Magikarp subgrade set: the baseline remains centering 9.8721, corners 9.1, edges 9.7, surface 10. No grade is invented for the other four cards.

### Localization, types and uncertainty

- **Snivy:** 3 scuffs + 8 whitening proposals become 4 scuffs + 7 whitening + 6 exposed-stock chips + 1 print-coating-loss proposal. The front mark near the Growth text changes from suspected superficial scuff to suspected coating loss but retains HIGH uncertainty and possible debris. Several lower-edge whitening regions become chips, with additional right-edge/corner and border marks. LOW/MEDIUM/HIGH counts change 6/4/1 → 6/11/1; more detail did not create generally higher model confidence.
- **Abomasnow:** all 21 proposals are on the back. Types change 10 whitening + 4 scuffs → 12 whitening + 9 scuffs. The baseline regions appear retained with similar classes, with splitting and additional candidates. Eleven contours exceed the saved physical quadrilateral: five bottom, three top, two left and one right. Maximum excursion is 5.842 canonical pixels, equivalent to 11.293 source pixels perpendicular to the corresponding edge. The baseline's five failures were bottom-only, each 3 canonical pixels. These are boundary violations against frozen machine geometry; neither the experiment nor this audit determines whether the physical outline or the proposed mark boundary is closer to ground truth.
- **Magikarp:** 6 whitening + 3 scuffs become 11 whitening + 3 scuffs, with one front and thirteen back proposals. Seven baseline regions appear retained; the faint curved upper-border scratch and a small top-edge whitening candidate have no clear new counterpart. Four new BACK whitening contours exceed the right physical boundary by 2.686–4.378 canonical pixels (5.144–8.365 source pixels perpendicular to that edge). Two lie wholly outside the saved outline. All four are preserved and block scoring. This is not proof that the proposed defects are false; it demonstrates incompatibility with the frozen measurement geometry.
- **Mosaic Dart:** the front gray patch changes from suspected scuff to faint color variation; the back streak remains a scuff. Both are HIGH uncertainty in the experiment, compared with HIGH/MEDIUM previously. The same printed-frame evidence remains missing. Additional source pixels supply neither a centering reference nor a numeric grade.
- **Threads Maye:** three front proposals cover two suspected scuffs and top-edge whitening. The back has a possible upper-right paper burr/fraying and right-edge scuff, both HIGH uncertainty and unmappable. There is no same-capture ASTRA baseline to compare.
- **Threads Dart:** four front proposals cover three suspected scuffs and lower-right whitening; the back has one suspected upper-left stripe scuff. That back proposal is unmappable. There is no same-capture ASTRA baseline to compare.

These are single stochastic runs, not an accuracy benchmark. Additional candidates, splitting/merging, changed classes and tighter or looser contours must be checked by a reviewer. Glare, focus softness, possible debris and one lighting angle persist in the model limitations. The diagnostic Threads requests also bypass the normal pre-analysis preparation gate solely for this isolated experiment, so they cannot be compared as completed grading workflows.

## Time, usage and cost

All ten measured response envelopes (four saved baseline, six experimental) report the `default` service tier. All have zero cache-read tokens. New usage below includes cache-write tokens; output includes the listed reasoning tokens.

| Card | Baseline provider s | Full provider s | Baseline input / output | Full input / output | Full cache writes | Full reasoning | Baseline USD | Full USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 38 | 245 | 328 | 16,157 / 11,056 | 58,428 / 15,713 | 58,425 | 12,035 | $0.7548 | $1.5160 |
| 39 | 311 | 366 | 35,574 / 14,200 | 77,865 / 17,948 | 77,862 | 12,398 | $1.1547 | $1.8707 |
| 40 | 337 | 351 | 16,206 / 15,050 | 58,302 / 16,290 | 58,299 | 12,948 | $0.9551 | $1.5433 |
| 41 | 150 | 166 | 16,197 / 6,678 | 59,581 / 7,049 | 59,578 | 6,214 | $0.5364 | $1.0972 |
| 42 | — | 269 | — | 75,244 / 11,616 | 75,241 | 10,338 | — | $1.5213 |
| 43 | — | 158 | — | 75,282 / 6,813 | 75,279 | 5,557 | — | $1.2817 |

The four comparable model requests cost $3.400845 before versus $6.02717 in the experiment, about **77% more**, with mean provider time 260.75 → 302.75 seconds, about **16% longer**. These averages describe these four requests only. The two additional diagnostic Threads calls bring the new spend estimate to $8.83018. Measured POST-start-to-observed-result times were 371.48, 408.68, 386.04, 258.22, 277.75 and 178.14 seconds respectively; polling cadence adds delay, especially for Mosaic, and these are not direct processing-speed comparisons.

## Input policy and controls

`atlas-source-resolution-experiment-v1` supplies each retained 3024 × 4032 working PNG and four overlapping, unresampled source crops per side: ten current-card images per request. All twelve full images retain their exact saved bytes. Every crop's decoded RGB samples match the corresponding working-image rows. These are the retained color-managed 8-bit working images at original spatial resolution, not untouched camera HDR values.

The production baseline uses the same photographs after geometric normalization to a 1350 × 1858 lossless inspection image, containing a 1270 × 1778 card. The experiment changes spatial detail and perspective/context supplied to the model; it is not an encoding-only comparison. Its source-space crops cover the existing canonical crop footprints, including surround, through inverse perspective mapping. The two Threads backs lack a supported physical transform and instead use four overlapping whole-source quadrants for diagnostic findings only.

Both arms use `gpt-6-astra`, `xhigh`, original image detail, background Responses API, the same 32,768 output-token cap and unchanged system prompt (SHA256 `ffdf36dd06afbaba89c29c8cf7c849047206c8662b3bceeb6af3fcee88212241`). The output schema changes only the local contour maxima to source-pixel limits, x3023/y4031. Per-image metadata identifies crop offsets, dimensions and physical boundaries in source coordinates. Exact image, request, schema, geometry, reviewed-example and response hashes are retained privately.

The four existing baseline requests are restored byte-for-byte and their lesson content is frozen: Snivy 0, Abomasnow 12, Magikarp 0, Mosaic 0. Threads has no completed lossless ASTRA baseline; its diagnostic requests use the seven relevant reviewed examples retrieved from the current generation-7 bank. Those example crops and traces are hash-verified and rendered through the unchanged production overlay path. No lesson or human approval is created by this test.

Local source coordinates are translated by the crop offset and transformed by the saved source-to-rectified homography, then normalized by 1269/1777 for the existing measurement engine. Native physical-quad coordinates use x×width/y×height. No clamping or silent deletion is allowed. Invalid polygons remain explicit and block a complete grade; missing physical geometry also blocks scoring. Existing centering and deterministic grading rules remain unchanged.

## Provider resolution and cost method

OpenAI documents that Astra's `original` detail preserves spatial dimensions up to 65,535 pixels per side and rejects images above 30,000 32-pixel patches rather than shrinking them to fit. A 3024 × 4032 image uses 11,970 patches and is below that limit. Each request also stays below the documented 512 MB total image payload and 1,500-image limits. All current images explicitly request `original`; a larger compressed file alone is not the evidence for higher resolution. See [Images and vision](https://developers.openai.com/api/docs/guides/images-vision).

Dollar amounts below are estimates calculated from actual response usage at the published standard short-context rates verified on September 28, 2026: $10/M ordinary input, $1/M cache reads, $12.50/M cache writes and $50/M output. They are not invoice reconciliation. Cache-write tokens replace ordinary-input pricing for those tokens; they are not an additive surcharge. Reasoning tokens are already included in output. The four baseline raw response envelopes were retrieved and hash-verified because the production normalized usage record omits cache-write tokens. See [API pricing](https://developers.openai.com/api/docs/pricing), [Astra pricing notes](https://developers.openai.com/api/docs/models/gpt-6-astra) and [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Provider latency uses each response's `completed_at − created_at` for both arms. It excludes local upload and polling delay. Private receipts also retain provider POST start, acceptance, polling and observed terminal times; those are not phone end-to-end timings.

## Evidence and implementation

Harness source: `scripts/atlas/full-resolution-experiment/`; initial commit `ff1c20df`, frozen-input scoring verification `ee748b90`. Preparation has no provider or database write path. The provider helper allows one bounded POST or a GET of its accepted response. Exclusive local and remote dispatch intents prevent accidental redispatch; unknown transport outcomes are preserved for recovery, not retried. Provider credentials remain in the existing private runtime. Requests and receipts are stored outside production grading tables.

Local provenance qualification confirms all crop samples, source/side bindings, geometry corner mappings and round trips. Maximum tested round-trip error is under 2×10⁻¹² pixels; saved corner/inspection transforms agree within 5×10⁻⁶ pixels. Replaying the existing production scoring function reproduces all three saved completed lossless reports exactly: Snivy 10, Magikarp 9.5, and Mosaic with no overall grade. **19/19 tests pass, zero skips**, including a read-only integration pass over all six actual frozen requests/acceptance receipts and rejection of substituted source, geometry, card, request, evidence and response identities. Offline scoring independently recomputes and verifies those bindings before measurement.

Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-full-resolution-test3-20260928`. It contains the frozen input manifest, exact twelve working images, four restored baseline requests and responses, lesson artifacts, per-card request/evidence/dispatch/response/interpretation/report files, comparison and preservation receipts. Remote one-shot dispatch ledger: `/opt/atlas/full-resolution-test3-20260928`. Neither directory is a production grade store. Do not replay consumed POST intents.

The private `review.html` compares both sets of raw contours over the exact working images, with side/card selection and click-to-enlarge findings. Refused baseline contours are labeled; absent Threads baselines remain absent. It is a local read-only inspection aid, not an approval screen. Keep it next to the retained PNG files. The comparison data includes all 65 experimental and 36 baseline raw proposals.

| Card | Experiment analysis ID | Provider response ID |
| --- | --- | --- |
| 38 | `1d693b20-da8f-4109-bd53-ee1110152aee` | `resp_06d7e04d05e26f0a006ab9ef4506f887d2bc9d25dcdc2924a6` |
| 39 | `349101af-5058-4bee-a7df-6439fb06962d` | `resp_0c9aa1bf35fc55ea006ab9f0f61bc887d2ad80935852665522` |
| 40 | `f6e65c38-fe38-4639-bc86-2fda1725bb0a` | `resp_0dfe943fc2675dad006ab9f142a47c87d2a68ed5ad3b488fc2` |
| 41 | `1a4b8bb7-c73d-4d9d-8a4b-4e48621fcaeb` | `resp_0235360bbedd5872006ab9f18c97e487d2abd55f8618364945` |
| 42 | `0314e2b5-f8db-4d20-8598-523c83dc4d2a` | `resp_05655529fc3aa41e006ab9f1b00c1887d288ac3d3395df8d5d` |
| 43 | `b574f624-85b4-4774-9305-e889acbacfd4` | `resp_08b382434be9da10006ab9f1dd3d5c87d285865d4bec24cec6` |

Preservation check at **2026-09-28 04:54:10 UTC** matches the pre-test census exactly for all 23 grading-history tables, 57 jobs, controls and both release ledgers. Active/unsettled production work is zero. Private runtime remains container `d3d99b4f7c7df96abc7d16f2ba14faf2aa58080740bc6873706b92d366cbf252`, image `sha256:7c0d812d0ea7dff9b22d88432a46f74e3657947e2cad458c834b2ee80d1ccfeb`, with unchanged protected-config hash, start time and zero restarts. No deployment, migration, schema change, production analysis, photo replacement, memory publication or human approval occurred.

Recommended next work is local inspection of the saved outlines/contours and the already documented geometry failures before any wider source-resolution rollout. Do not clamp invalid contours, score only surviving proposals, or repeat paid runs just to obtain complete comparison pairs. No new capture is needed to inspect this experiment.
