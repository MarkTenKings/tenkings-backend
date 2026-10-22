# Workspace photograph read recovery

## Evidence and scope

This is a local photo-read recovery correction, not a grading-engine or finding-detection correction. The root investigation retained the Njoku card at manual revision 4: `BEGIN_FINAL_REVIEW`, the human Back printed-outline edit, and geometry confirmation were saved. The exact batch report, adopted final review and defect artifact contain zero measured findings and zero proposals. The “03” in the progress navigation identifies the Findings step. No card reset, inference request, finding decision or approval was needed for this investigation.

Root subsequently reproduced a failed Front photograph after Back→Front navigation. Marked said “Photograph unavailable”, Clean incorrectly said “Verifying photograph”, and the existing explicit photograph retry failed again. The existing Review options → Reload images GET restored the photograph and controls without a manual command. Evidence is retained under `~/.codex/atlas-handoffs/atlas-workspace-njoku-20261021/{read-01,browser-01}`. The exact failed production HTTP status/grant lifetime was not captured, so expiry remains a supported explanation rather than a proven production cause.

## Narrow correction

Only two serving files change:

- `packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx`: both panes, status and action-footer wording distinguish missing, failed and loading photographs. Existing explicit **Retry photograph** can first ask the host for refreshed descriptors. It checks the unchanged pixel/content key and frame/finding binding, waits for the host to publish the exact returned URL, then invokes the existing verifier. One gesture stays in flight; disabled state, changed scope, side unmount, access teardown and refresh refusal do not fall back to the captured old URL.
- `frontend/atlas-app/components/ManualCards.jsx`: the retry uses the existing image-view GET. Its current owner, manual revision/hash and pending-command checks fence the returned images. A save/refresh obligation arising during the read prevents publication. Refresh failures identify a photograph read rather than implying an unconfirmed grading mutation. Authentication and stale-source messages remain distinct. The parent retains the child’s actual photo status in the footer.

There is no new endpoint, automatic retry loop, grant-TTL/cache change, image transformation, source/hash bypass, command/journal change, startup change, review-step change, scoring change, prompt/provider change or approval change. A refreshed descriptor does not itself enable approval: verification and both correctly sized current-side image loads are still required. Legacy hosts without the optional callback retain the existing explicit verifier retry.

## Local qualification

Five focused Node 22 suites passed **137 tests, zero failures, zero skips**:

- Changed `packages/atlas-manual-workspace/test/astra-review-component.test.mjs`: actual JSX plus the real byte-verification hook/loader; failed/loading/missing panes and footer; same-length wrong-hash refusal; explicit renewal; waiting for parent publication; same-URL success; duplicate-click, source/length/frame, pending/access/side/unmount refusals; approval remains blocked until both image loads; no grading calls or saved-state mutation.
- Changed `frontend/atlas-app/test/manual-defect-workspace-integration.test.mjs`: actual parent JSX; explicit/periodic/navigation GET failure wording; zero commands and unchanged saved work; parent renewal return fences; stale/foreign response, access loss, pending-before/after and unmount; footer state preserved.
- Changed `frontend/atlas-app/test/grading-image-runtime.test.mjs`: actual extracted signing-cache callback and actual shared-pool lifecycle under a synthetic clock. A 239-second-old cached 300-second grant has 61 seconds remaining, while the new workspace refresh is 240 seconds away. After the unused image’s 60-second idle eviction, the old grant can fail; an explicit descriptor refresh restores the same pixel identity. Storage authorization and bytes in this timing test are synthetic; it makes no live-provider claim.
- Unchanged `verified-image.test.mjs` and `verified-image-pool.test.mjs` retain the independent byte, cancellation, authorization-pool and cache tests.

The actual JSX recovery test uses synthetic header-bearing bytes and controlled `onLoad` events; it does not qualify browser image decoding. Root owns the separate actual-component browser preview and any later serving build/deployment. The first preview exposed the remaining footer copy, which was corrected and included in the final 137-test run.

ESLint completed with zero errors and the same 16 warnings as the HEAD versions (11 parent, 5 Findings); message/rule/severity comparison confirms no additional warning. `git diff --check` passed. Earlier red tests, fixture-only repairs and the initial outside-project lint invocation failure remain retained in the evidence folder.

Final local receipt: `~/.codex/atlas-handoffs/atlas-workspace-njoku-20261021/qualification/photo-read-ux-01/qualification.json`. Final test log: `focused-final-03.tap`. The receipt pins the exact five changed source/test files and evidence bytes. No production action, commit or deployment was performed by this lane. This audit does not claim the transient production failure’s cause or deployed resolution is established.

Independent ownership-contracts source review passed on the exact final two serving files and three tests, including the footer follow-up and the 137-pass log. The reviewer found no concrete GET/source/pending/async/verifier blocker and ran no additional tests or effects. Real-browser/build acceptance remains separate.


## Root actual-component browser qualification

The final source passed the actual DefectReviewWorkspace, image verifier and CSS preview at1440×1000 and320×900. Synthetic expired403 image reads fail visibly in both panes/footer; one explicit link-renewal callback plus one exact verified image GET restores both decoded1350×1858 panes and ordinary readiness. A refused renewal makes no new image request, remains unavailable and keeps approval disabled. Missing photographs show an unavailable state without a false spinner. Zero grading commands, no console warnings/errors and no horizontal overflow. The host/image transport is synthetic; actual ManualCards GET/revision/pending behavior is covered by the separate integration tests, not claimed as a full browser backend run.

Private successor preview02 receipt `~/.codex/atlas-handoffs/atlas-workspace-njoku-20261021/preview-02/browser-result.json` SHA256 `324f943564cfac11bae679a239edaadb4d1c561fc07b22df77b2dffe938f09c4` pins all45 exact current source inputs and8 fixture files, five DOM checks and screenshots. Preview01 is retained: it exposed the remaining terminal footer wording before the final correction. Both exact owned preview servers exited143 after SIGTERM; the temporary viewport was reset and preview/agent-only Njoku tab closed. The user's Queue tab was untouched.

This is local source/browser qualification. The first isolated release attempt is held; no production runtime, control, grant or migration was changed by this work. Original failing HTTP status remains uncaptured.

## Held staging attempt and test correction

The isolated source `e38c1beedba49757dd5052603e5e3e554bb63a58` contains exactly two serving files and three tests over `f9742346`. Its native image built successfully, but qualification stopped at136/137 tests. The failed assertion checked verified Blob publication after eight fixed event-loop turns. Descriptor renewal and both same-URL GET assertions had already passed; this evidence does not establish a serving-code defect. The original Linux log and failed receipt remain retained under `~/.codex/atlas-handoffs/atlas-photo-recovery-20261021/native-build-01/`.

The successor test waits for observed failed-photo, real SHA-256 entry, and verified Blob/two-image publication. A deliberately held digest additionally proves unverified bytes cannot publish or enable approval. One refresh/two GETs/one digest remain required. Only the test changed; both serving JSX hashes remain unchanged. Focused1/1 and full137/137 tests pass locally under denied network access, with independent review. Receipt `qualification/photo-test-waiter-01/qualification.json` SHA256 `d8118848d43ae90f3bf353d40fcc679fdae9f30be921f0e95488edde422472e3` pins the corrected test `d1e737788cb9dc3e8cd88a8ba06a5600cef013269d88f3b958aa4ea0d9f43835`. A successor Linux qualification is still required.

Staff candidate `dpl_HhWukhLoPYKRaaeRt1ZbTWAuu9Um` reached READY, but final qualification correctly refused concurrent project-alias drift to the separately authorized corner-scoring release. No public candidate, holder, native activation, control write or promotion was performed here. Mark explicitly authorized coordination with **Investigate card grading scores**; that chat owns the live release first. This photo correction must be rebuilt on its completed serving source using fresh observations and a fresh release packet. The held `e38c1bee` source must not overwrite the scoring change. Consumed build/upload/create intents remain evidence and must not be replayed.

## Coordinated successor qualification

The separate scoring release completed713573fc and explicitly released its admission holder. Fresh isolated photof0fd4f15 is its direct child, preserving every713 serving byte except the exact two photo files above. The test-only8dff finding-impact expectation overlay is separately attributed. New native image045ed35c passes137 photo,199 corner-lineage and668 broad checks, zero failures/skips, with all53 pre-existing container projections and322 image IDs retained. These suites overlap. Independent decoded qualificationf4eca8bc and raw collection4c58a39a are retained under `~/.codex/atlas-handoffs/atlas-photo-after-corners-20261021/native-build-01/`.

Staffdpl_BuJUQjbxL54NZeL3QhDpDz7ijv7k and publicdpl_EQtu3jE4kmtnmVwXJkRaRwZPg6rM are READY and fully source/build/protected-served qualified, receipts3ace9f43 and90504c51. Both preserve2,678 exact source paths, with only the two authorized changed-byte readbacks; public binds the exact new staff and unchanged customer. They are staged with custom-domain autoassignment disabled. Runtime/control/canonical cutover and real signed-in production photo acceptance remain pending at this checkpoint. No historical held intent was replayed.

## Actual coordinated technical release

The f0fd successor was activated on native maincefc6d81/worker16a855f2, image045ed35c, exact qualified staffBuJUQjbx and publicEQtu3jE4. Three control bindings advanced to141/103/109; customer83/35/sourcec68e9ea7, SQL009/ledger9 and37 business-table commitments remain exact. Both old processes exited cleanly; no forced kill, old-container/image deletion, gateway/secret change, business write or grading action occurred.

Canonical35 checks PASSaabecfb3; four historical reports and eight approved photos PASSa4ddf490; nativepostflight93fa19c8 and finalpreservation61a9c700 PASS. Releaseproofe3bc15a8 binds the actual native/data/web/canonical evidence. The original admission holder explicitly released08:01:12.847Z, released712a81da; absenceee8cca4d proves original transaction/locks/replacement holder absent. Packet: `~/.codex/atlas-handoffs/atlas-photo-after-corners-20261021/`.

This is technical release completion. A fresh signed-in real Njoku photo/recovery check is pending; user sign-in was requested after release closure. The original failed HTTP response remains uncaptured; no production root-cause or staff grading decision is invented. Future release source must retain both713 corner policy andf0fd photo correction.


## Fresh signed-in production read acceptance

Fresh owner sign-in and live Workspace → existing David Njoku read acceptance pass at08:14–08:19UTC: Front/Back marked and clean photographs decode1350×1858, Front revisit and explicit existing Reload images complete. Read-only before/after snapshots preserve entire card/job/action/approval rows, revision4 and zero approvals. No grading command, initialization, reset or human decision was invoked; user Review Queue tab untouched and agent-only tab closed. This session did not reproduce the transient failure or exercise the failed-image Retry branch; controlled retry tests remain separate, and the original HTTP failure cause remains unknown. Evidence `~/.codex/atlas-handoffs/atlas-photo-after-corners-20261021/signed-in-01/acceptance.json` SHA256 `806da8a8ad60faa3278b443be90457d70a22a804c6936af0ed3f07f1bb41796f`.
