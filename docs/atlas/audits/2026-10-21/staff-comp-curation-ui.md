# Private staff comp-selection UI — local foundation

Date: 2026-10-21. Status: **locally qualified; default disabled; no production activation**. This is an optional post-grade staff interface for the existing unregistered private comp-curation proposal. R1 and the complete 30-item marketplace plan remain open.

## Scope and composition

New files only in this lane:

- `frontend/atlas-app/components/StaffCompCuration.jsx` and `StaffCompCuration.module.css`
- `frontend/atlas-app/lib/staff-comp-curation-entry.mjs`
- `frontend/atlas-app/test/staff-comp-curation-entry.test.mjs`, `staff-comp-curation-ui.test.mjs`, and `staff-comp-curation-ui-fixture.mjs`

The component accepts `{ staff, card, enabled=false, accessState='READY', request, onAccessLost }`. `card` is an already authorized Card History snapshot with a PUBLISHED report and exact card ID, approval ID, token, version and public hash. Optional source revision/hash, report hash and mode are also pinned. `request({method,path,body?,signal})` must be an explicitly composed same-origin transport returning a **Response**, with actual cookies/CSRF supplied by its trusted host. It has no global-fetch fallback. CardHistory's existing `api(path, options)` returns parsed JSON and is not this transport. Root owns the separate default-off CardHistory composition and its tests; those are outside this lane's qualification receipt.

The entry reader performs only GET `/api/staff/session`, GET `/api/staff/manual-connected/cards/:cardId/presentation/market`, then GET `/api/staff/session`. It accepts a saved READY pool only for the exact approval and published report binding. NOT_REQUESTED remains explicit; pending, unknown and unavailable saved jobs never become an empty ready result. Raw status prices, titles, URLs and acquisition data are discarded. The existing curation service independently re-reads the exact preview and supplies the actor/source/policy-bound display projection. No market search, refresh, presentation selection, provider, grading, approval, report, listing or asking-price writer is added.

The component uses the retained private controller/client/HTTP adapter unchanged. It supports explicit review of 1–5 eligible sales, one grade group and currency, local pages of 20 saved rows, Skip and No suitable comps. The latter two remain possible with no saved pool or review policy. Every new decision uses one fresh request ID. Unknown outcomes prevent editing or a new decision; a GET can reconcile only the exact original receipt, and explicit retry sends the same immutable request. A later equal-looking selection does not prove an earlier outcome. There is no invented request-status endpoint or automatic mutation retry.

## Authority and display limits

Each mounted context captures the staff object and ID/role/mode, card object and approval/source/report fingerprint, transport capability and access state. Rendering and old event handlers check that context before effects; asynchronous replies check it again. Account or source change, logout/access loss, pagehide and unmount abort/dispose private state. React StrictMode effect cleanup/replay creates a fresh controller instead of leaving a closed context. 401/403 and foreign-account responses clear private data and notify the host. Hosts must set `accessState='ENDED'` immediately when logout starts, before network completion.

Reads require private/no-store JSON, a 2 MiB stream bound and a 25-second timeout. Abort settles a noncompliant request or stalled stream and cancels/discards its body. No pending decision, sale data or credentials are persisted in browser storage.

Published report comparables, this private decision and a human asking price remain separate. The UI does not display a calculated guidance amount while data rights and operational pricing policy are unresolved. Individual recorded sale amounts remain evidence; unknown or undisclosed accepted-offer amounts stay unavailable. The current real saved-v2 slab projector's null designation remains ineligible; it is never converted to STANDARD. Raw evidence is a separate group. Synthetic eligible graded fixtures do not establish that current saved production graded pools are eligible.

The white/emerald interface follows the `atlas-design-director` evidence/interaction and qualification guidance: clear reading/saving/unknown/confirmed states, native checkbox and button controls, focus outlines, 44px targets and bounded wrapping. No manufactured card image or copied remote listing image is used. Source tests are **not** browser, responsive-layout, visual-quality or physical-card acceptance.

## Observed qualification

Node 22.16.0: **39 tests pass, 0 failures, 0 skips**, comprising 17 new entry/mounted-component groups and 22 retained adapter/controller groups. Scoped Next lint exits 0 with no ESLint warnings/errors. Both commands ran with macOS `sandbox-exec` denying network access.

Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/ui-qualification-02/qualification.json`, SHA-256 `21c2ad075b79ec0806908146b6cb39bd3f51a15771b67109ff2bcaa66065aa03`. The receipt pins 13 direct source/fixture dependencies, a fresh 39-test log and retained lint log for unchanged product source. It preserves qualification-01 and corrects one test-only gap found by independent review: the noncompliant-request timeout test now observes exactly one actual dispatch before advancing time, then confirms refusal with no extra dispatch. JSX SHA-256 `f6ca2147a3b673b362b471e7b2aaca8d5fb32a669d3976cbc50a18595803884d`; entry SHA-256 `78ea6951480ef58c9de9e512e5548a3527d5a25380473ad7cbb79dbdb10aa4a0`.

The mounted tests execute the actual JSX with a hook/lifecycle harness, the existing controller/browser parser, the actual saved-market status service, and actual curation service/HTTP adapter. Only the boundary, database-shaped rows and artifacts are synthetic/in-memory. They establish exact GET-only entry, report/pool byte preservation, bounded selection, mixed-group/currency and duplicate alias refusal, current-v2 designation refusal, explicit unknown-price handling, missing-vs-pending-vs-failed states, exact uncertain recovery/retry, pre-effect stale-handler rejection, observed deferred read/save access and source changes, unmount cleanup and StrictMode replay. The tests make no real DB, authenticated-browser, provider, storage or deployment claim.

Independent ownership-lane source/receipt review passed on qualification-02 and all 15 source/log references, including the observed timeout correction. The reviewer reran no tests and made no connections or effects. Root browser/build acceptance remains separate. The operational rights, designation acquisition, recency/method policy and production registration decisions remain unresolved. There is no deployed migration/runtime/HTTP registration, live saved decision, seller asking-price action or marketplace-completion claim in this increment.


### 2026-10-22 — Root private curation integration and qualification

Mounted the optional private selection panel only inside Card Detail → Sold comps with explicit enablement and a separate authorized Response transport. Defaults remain off; published report comparables remain separate. Active child access denial clears the entire private parent card/media, while replaced actor, transport, source or departed-tab callbacks cannot clear a new context. No grading command, policy, report, provider acquisition or price writer changed.

Root final qualification passes64 focused tests, staff production build and secret-boundary check under network denial. Actual React StrictMode/CardHistory/Shell/global CSS browser checks pass1440/1024/390/320 layouts without horizontal overflow; keyboard/native18px checkbox/44px target, one synthetic private save, preserved published evidence, disabled feature, late inactive response and explicit403 parent clearing are verified. Supporting standalone checks cover five-item/group/currency bounds, paging and exact uncertain-save recovery. The only styling correction is the panel-specific checkbox reset; two independent reviews pass. Preview03 fixture stylesheet-order failure remains recorded; preview04 follows actual global-before-page order. A dropdown-only403 attempt did not reset the fixture; the explicit reset scenario was subsequently verified and both observations retained.

Root receipt: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/root-qualification-01.json`, SHA b8a6e4c996dcac0e8649314dcddb6100f7d1d754707c777115a06d341f4bd73c, pins8 changed source files and165 browser source/helper/assets plus13 observations. Temporary previews03/04 stopped (PIDs36707/37090), ports58623/58624 closed, browser tabs closed and viewport reset. These are synthetic local checks, not real roles/customer/media/policy acceptance. Runtime/schema/transport registration and policy remain required; no production activation.
