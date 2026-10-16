# Human-review performance qualification — 2026-10-16

Status: implementation committed as `3949e104b07d664675f246a39a04abffa6937ad4` and integrated by the release lead as `50b59900fd9527bd177dab4f694d99d5aa3033ca`. Controlled qualification is complete; no deployment was performed by this effort. Release integration and production qualification belong to the repeated-card reliability lead. This document does not establish production click latency or authenticated operator acceptance.

Release-lead update: the combined source is now live following native-first cutover, 52 canonical checks and postflight. This changes deployment status only; the measurement limitations and absence of fresh authenticated operator acceptance below remain unchanged. See [the reliability release audit](repeated-card-reliability.md).

## Source and scope

The runtime was checked read-only at 19:33:24 UTC: both native services identified source `cfa40e80101cfeb60da3e4ab02f220a1c6a0a28a`, native image `sha256:1b0c100e0b20350b7b6d827abdfac568db29750feef7fa64e0adbe55a7bb69d0`, and zero restarts. Canonical staff HTML identified deployment `dpl_EG6gfSS239v55sUD3KbQ1HTv8LoU`. Implementation is on `codex/atlas-review-performance`, based on `ac0a88bf5f3cce47d26fc81f7dd561f9249659df`; intervening changes concern documentation and the legacy web preview, not the relevant manual-review source.

Changes are restricted to the human-review UI, manual save client, optional response contract, and necessary private transport support. No Astra model, reasoning effort, prompt, grading execution, geometry algorithm, measurement, scoring, photograph processing or quality setting changed. Variant decisions, reference scheduling, automatic sold comps, separate human decisions, final approval and publication remain on their existing paths.

## Implementation

1. The mounted manual workspace now owns the initial recovery and exact batch-report adoption. Removing the temporary parent client avoids the second workspace read and preserves one command journal owner; it does not initialize a coordinator from cached state. Fresh batch adoption, authorization, pending-save reconciliation and owner/card changes retain their checks.
2. Once Front geometry is verified and decoded, the existing bounded authenticated image pool prepares one exact Back PHYSICAL descriptor. The Back view must still verify its own readiness. Image hashes, bindings, resolution and pixels are unchanged.
3. Five findings actions can return a complete authoritative workspace with their committed receipt: `DEFECT_EDIT`, `TRACE_SAVE`, `MEASURE_SIDE`, `INSPECT_SIDE`, and `CONFIRM_FINDINGS`. The existing full GET assembler hydrates the exact committed artifact references and includes metadata, image grants, assistance and final review. A final source/access/revision check rejects stale enrichment. The client replaces the complete view only when the receipt, card, revision, hash, scope and required contents match; incomplete or uncertain replies use the existing full read. The state-only response is never substituted for the full workspace.
4. A proven commit followed by refresh failure stays **Saved; refreshing**. Further mutations remain blocked until an authoritative read succeeds. A retained revision/hash floor prevents stale recovery; uncertain saves still reconcile or replay only their original journaled action. Read ordering, repeated recovery clicks and geometry sequence resumption are guarded without discarding unsaved coordinates.

The optional workspace gets at most five seconds, shortened by time already spent within a 200-second response budget, with the existing 2 MiB transport limit. This does not change the action's existing execution deadline. On timeout, failure, stale state or oversize output, the server returns the committed receipt and the client performs a full read. Underlying optional hydration is not canceled by the response timeout and may finish later; that late result cannot replace the returned receipt or browser state. Slow fallback cases can therefore retain or add waiting. The successful-path request reduction does not imply removal of required server hydration work.

The new `x-atlas-workspace` header is valid only on exact manual-card action POSTs, is signed and forwarded by the private proxy, and is rejected if duplicated or tampered with. Calls without the header retain the previous signature bytes.

## Measurement method and evidence

The reusable harness and reproduction instructions are in [`human-review-performance.md`](../../../../packages/atlas-manual-workspace/scripts/human-review-performance.md). Evidence is retained locally at `/Users/markthomas/.codex/atlas-handoffs/atlas-review-performance-20261016/benchmark`.

The browser uses actual BatchGrading, ManualWorkspace, save client, workflow HTTP handler, deterministic reducers and native CPU finding measurement with controlled in-memory persistence. Only loopback HTTP is allowed. Synthetic, distinct full-resolution Front/Back images are used. No customer card is approved and no provider is called. Entry and Next-card fixtures already contain an adopted machine report; fresh `BEGIN_FINAL_REVIEW` adoption is functionally tested but excluded from these timings. The final-approved fixture used to expose **Next card** is seeded outside the measured interval; publication is not dispatched.

Timing starts at the actual click/change event and ends after the correct hash-verified, decoded image, required geometry preparation and enabled controls are ready, plus two paint frames. The report requires both correct inspection photographs. Ten trials per source/profile/cache combination report median and observed maximum; these are not production p95 values.

Runs share this Mac with other work and are not hardware-isolated. The full baseline began at 19:48:46 UTC, after the lead's earlier broad suite. A disclosed disposable PostgreSQL fixture at 20:02:42.259–20:02:44.578 UTC overlaps after-run desktop/warm trial 3. That entire trial was replaced by one predesignated complete flow, with its original raw evidence retained. Its fresh-process 647 ms entry maximum is retained. An unrelated slow native-measurement sample at 20:00:33.738 UTC is retained; a slower observed maximum is not discarded merely because typical performance improved.

An additional shared-host incident began around 20:04:54 UTC: phone measurements, fixed timers, gradient preparation and independent lightweight filesystem commands all slowed. Process observation found an unrelated TypeScript process and high desktop-app/rendering activity; neither implementation team was building or running broad suites. No unrelated process was interrupted. One bounded repeat was performed. All ten cold-phone flows completed and replaced that entire original cell, including originally healthy samples. Warm trial 0 completed, then warm trial 1 failed during an untimed seeded-completion page reload (30-second load timeout; cause not established). No further repeat was attempted. All ten original warm-phone observations remain in the table but are timing-inconclusive. Raw observations, excluded rows, failure and replacement provenance are retained. A metadata-only deterministic rebuild matched the original source and browser bundle exactly; it reconstructed the missing manifest for completed repeat rows without another timing attempt.

Desktop uses 1440×1000 and 25 Mbps with a declared 60 ms API roundtrip delay. Phone uses 390×844 and 10 Mbps with 140 ms API delay on desktop Chrome; this is not a physical-phone measurement. Cold starts with an empty verified pool and keeps ordinary prefetch enabled. Warm leases the exact images through that same pool before timing. Initial page setup precedes bandwidth shaping, so setup inspection-image prefetch can begin unshaped in both versions. Timed Front geometry and Next-card image work begin after shaping. Cold labels describe initially empty cache, not a forced uncached image at every subsequent step. A fixed 1.5-second review pause follows entry, then 250 ms between gestures.

Storage/save/post-commit/preview delays are declared synthetic inputs, not estimates of production. Both versions pay hydration: the full GET includes 30 ms card read plus 190 ms hydration; the embedded view includes 190 ms hydration plus 60 ms for two freshness reads. Save adds 80 ms before actual reducer/native work, confirmation adds 200 ms after commit, and preview adds 120 ms before actual report work. Raw phase measurements distinguish these inputs from native CPU time, image download, verification, decoding and geometry preparation.

Production's reported 8–10 seconds has not been reproduced or attributed by this fixture. Unchanged confirmation follow-up work, storage/network latency, preview generation, final publication, cold image work, and optional-response fallback remain possible bottlenecks. The 200 ms synthetic confirmation delay does not establish that learning/memory work dominates production.

Source inspection distinguishes the post-confirmation paths: `workflow.service.execute` awaits the existing `afterConfirm` hook after the durable commit. Connected assistance wakes the learning worker when enabled, otherwise awaits memory publication, and then reads memory status. These paths and their existing deadline are unchanged. Final `APPROVE_REPORT` still awaits publication, whose existing `finally` wakes the market and label workers. No work was moved off either response path by this release.

## Measured click-to-usable results

All values are **median / observed maximum in milliseconds**, ten trials per column and source. These are the controlled fixtures described above. **Phone warm is inconclusive** and is shown for disclosure only. Slower samples are retained.

| Transition | Desktop cold: before → after | Desktop warm: before → after | Phone cold: before → after | Phone warm: before → after (inconclusive) |
|---|---:|---:|---:|---:|
| Open retained review | 980/1117 → 696/812 | 798/815 → 513/647 | 1555/1595 → 1236/1294 | 1049/1064 → 698/1593 |
| Approve Front geometry | 265/280 → 81/81 | 81/115 → 81/82 | 564/566 → 80/81 | 82/148 → 82/363 |
| Approve Back geometry | 498/514 → 499/514 | 499/500 → 499/514 | 665/682 → 681/697 | 665/682 → 682/711 |
| Save finding type + remeasure | 1378/1410 → 1316/1558 | 1393/1460 → 1314/1328 | 1719/1794 → 1489/1540 | 1760/1877 → 1496/2029 |
| Approve Front findings | 482/499 → 449/465 | 483/509 → 449/465 | 664/682 → 549/564 | 649/665 → 549/1034 |
| Approve Back findings → preview | 1330/1397 → 1264/1266 | 1328/1398 → 1257/1282 | 1749/1775 → 1547/1564 | 1749/1765 → 1547/1673 |
| Next card | 1039/1082 → 748/764 | 849/1002 → 549/564 | 1682/1698 → 1480/1482 | 1182/1199 → 815/915 |

The largest demonstrated gains are initial workspace recovery and preparing the exact next geometry image during the existing review dwell. Findings approval gains are smaller. Back geometry requests are unchanged; its cold-phone median increased by 16 ms. The desktop cold finding-save maximum increased from 1410 to 1558 ms while its median improved; the slower native-measurement sample remains included. No uniform or production speed guarantee follows.

## Requests and phase evidence

| Successful path | Before | After | Change |
|---|---:|---:|---|
| Finding type save + remeasure | 4 | 2 | Both existing POST actions remain; two workspace GETs removed |
| Front findings approval | 2 | 1 | Inspection POST remains; one workspace GET removed |
| Back findings approval → preview | 5 | 3 | Inspection POST, confirmation POST and preview GET remain |
| Open retained review | 2 workspace GETs | 1 workspace GET | Connected-card lookup remains |
| Next card | 2 workspace GETs | 1 workspace GET | Queue and connected-card lookups remain |

Background queue polling is retained and can add an overlapping request. Missing/incomplete/stale/oversize/timed-out enriched responses retain full GET fallback.

Selected desktop-cold phase medians (milliseconds):

| Step and task | Before | After |
|---|---:|---:|
| Finding save: save/commit total | 620.5 | 621.9 |
| Finding save: native measurement beyond injected commit delay (subset above) | 458.0 | 459.6 |
| Finding save: full hydration | 382.3 | 382.0 |
| Finding save: new freshness fence | 0.0 | 122.9 |
| Back findings: save/commit total | 163.0 | 163.1 |
| Back findings: post-commit work (declared synthetic input) | 200.9 | 200.6 |
| Back findings: preview generation | 122.2 | 121.8 |
| Front → Back: image transfer tasks after click | 196.2 | 0.0 |
| Front → Back: image hash tasks after click | 0.3 | 0.0 |
| Front → Back: image decode tasks | 3.3 | 4.8 |
| Front → Back: gradient preparation | 15.0 | 15.9 |
| Next card: full hydration | 381.5 | 190.8 |

These are summed task durations in each click interval, not additive critical-path segments: tasks overlap, and prefetch moves image work before the click. Full before/after median and maximum phase data for all profiles are in the comparison JSON. Save/commit includes synthetic persistence delay and real reducers/native execution, not a production database transaction measurement.

The selected comparison passes all 40 paired flows: identical report-content hashes, saved finding/geometry hashes at every step, revisions and action-type sequences. The same assertions also pass the entire original noisy matrix. A separate 52-file fingerprint comparison confirms unchanged grading/reducer/native sources and grading-core outputs. This proves the fixture results, not all possible production cards.

Evidence directory: `/Users/markthomas/.codex/atlas-handoffs/atlas-review-performance-20261016/benchmark`. Key files are `comparison.json`, `before-final-result.json`, `after-final-result.json`, `after-final-result.raw.json`, `after-phone-bounded-repeat-failure.json`, `host-noise-observations.json`, and `fixture-grading-source-integrity.json`. Source/selection hashes are recorded in the JSON; all 12 application-source fingerprints bind to commit `3949e104`.

## Correctness and build qualification

- Staff app: 727/727 tests passed, no skips.
- Manual workflow and workspace: 382/382 passed, no skips, with the compatible native Python enabled.
- Connected manual: 795 passed in the full run; the two initially skipped native tests then passed in a targeted run with the compatible Python runtime. All 797 cases exercised successfully, zero failures.
- Production staff build: PASS on Node22.23.2. Browser/server boundary: 27 chunks, 13 traces, 1,748 traced files; no private server dependency leaked into browser output.
- Focused cases cover double clicks, concurrent changes, late/stale reads, incomplete envelopes, committed-save connection loss, exact journal recovery, reload recovery, expired authentication, changed image bindings, access/source rechecks, unsaved edits, timeout/size fallback and exact geometry checkpoint resumption.
- Independent UI/contract/transport and integration-lead source reviews found no remaining concrete blocker.

All 1,906 cases passed across the three package groups. Full logs and source/browser binding are in sibling `qualification/`: `staff-build.log`, `staff-tests.log`, `manual-suites.log`, `connected-suites.log`, `connected-native-tests.log`, and `source-and-browser-assets.json`. Local built chunk `895-940bd9d77a4cd9d1.js` has SHA256 `e8a4dd00b13bd46627b2db5ca145cd7d4e18819d2eefe3a150b60ba711899eed` and contains `x-atlas-workspace`, `atlas-manual-action-workspace-v1`, and `Refresh saved review`. Combined release qualification must bind its own exact built and served bytes.

## Integration and release

The reliability lead in chat **Investigate Atlas card grading** (`01a1424a-3593-7b01-abb9-3d2814b38679`) owns the single integrated qualification and deployment. This branch does not change variant/market workers, scheduling, publication or schema. The lead's separate reliability changes include migration 006; it is not required by this performance feature.

Deploy and verify the compatible native verifier before promoting the web proxy that forwards the new signed header. Existing web clients continue to work without it. For rollback to an older native verifier, restore the older web proxy first. Do not independently restart shared services from this branch. The integration lead reviewed the transport, response contract, client, startup and recovery UI read-only and reported no additional concrete blocker. Final combined source, tests, release receipts and production health belong in that lead's handoff and session log.
