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

This is local source/browser qualification. A new isolated release is being prepared; no new production source, runtime, control, grant or migration has been applied. Original failing HTTP status remains uncaptured.
