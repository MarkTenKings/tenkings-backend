# Mounted customer collection and ownership history

Local source qualification, 2026-10-21. This slice is excluded from the isolated photo-recovery release. It adds no ownership/Grading mutation, schema, role, policy, credentials or production activation.

## Customer journey

`AccountWorkspace` now mounts `CollectionAccountWorkspace` on the existing `/account/collection` page. A compact current collection / ownership claim history switch mounts only the selected view. Collection comes exclusively from the independent current-title collection projection; a verified historical claim never creates a collection card. The history view retains current v2 state, replacement/withdrawal revisions and actual recorded transitions, including honest legacy gaps. An available authorized card links to its exact published report token/version; missing cards produce no link. No proof URL, upload, offer, preference or ownership action is exposed.

The existing default-off history runtime exposes only an additional `configuredForDisplay` boolean. The server page reads it after ingress admission and sends it only on the collection page. It says that configuration permits displaying the view; it does not qualify a database role or successful read. Absent/malformed configuration hides history. Every GET remains authoritative, independent of proof preparation policy. The current collection runtime reader is still unconfigured; this work does not turn its 503 into an empty collection.

## Access and interruption

A hub session binds both the bootstrap customer object and its captured account ID. Account changes remount its private views. Only the active view may read; leaving it cancels its requests. Logout, pagehide, HTTP 401/403 and account-mismatched successes close the shared view. READY toggles cannot revive a denied session. Collection reads now check current account/capability before and after awaits; stale buttons cannot cancel a new account's read. The narrow browser-client correction maps only collection parser account/owner mismatches to access-ended; other faults remain unavailable. A missing reader, a valid empty result and an ended session remain distinct.

Independent review caught a StrictMode setup→cleanup→setup lifetime error before browser sign-off. The corrected setup reopens only the mounted lifetime; denied/page-hidden access stays ended. Both child views reject stale controls after unmount. The added regression explicitly replays effects, exercises both views, rejects old Refresh / View recorded changes / Close changes handlers, and proves access denial stays latched. Qualification01 is retained as the superseded checkpoint.

## Changed source and qualification

Eight product files in `frontend/atlas-customer`: new `components/collection/CollectionAccountWorkspace.jsx` and `.module.css`; narrow `components/AccountWorkspace.jsx`, `components/collection/CollectionWorkspace.jsx`, `components/collection/OwnershipClaimsWorkspace.jsx`, `lib/collection-client.mjs`, `lib/server/ownership-history-runtime.mjs`, and `lib/server/page.mjs`. Six qualification files include a new nested JSX fixture and mounted-journey suite plus focused existing collection, claims and runtime regressions.

Node22: **54 tests passed, zero failed/skipped** across the new mounted journey, collection client/workspace/routing, claims workspace, history runtime and ingress security. The new journey runs actual account/hub/view JSX and existing HTTP/browser-reader/projector code with synthetic capabilities. It covers session→collection→exact report→history→recorded changes→collection, current-title versus historical verification, withdrawal/replacement/legacy/pagination, unavailable versus empty, inactive cancellation, account/object/ID replacement, shared denials, logout/pagehide and late replies. The hook fixture is not React DOM or database qualification. Initial test-harness issues (missing `useId` and an unrendered pending state) were corrected in the fixture; no production defect is inferred from them.

Scoped lint exits zero with no new warnings; three existing `AccountWorkspace` hook/image warnings remain. Source pins, actual logs and a plain synthetic browser-response fixture are retained at:

`/Users/markthomas/.codex/atlas-handoffs/atlas-collection-history-hub-20261021/qualification-02/qualification.json`

Receipt SHA-256: `fe62485c16ba3b86d7c41b0aadd68c8e29991f037c356fabb14cdaa0256a1d13`.

Actual browser layout/interaction and customer production build are root-owned and pending at this handoff; no visual pass is claimed from these tests. Independent source review passed against all 14 successor source pins and three evidence references, including the replay/stale-handler correction. The reviewer ran no tests or external calls. Real restricted-role/schema/client qualification, current collection runtime composition and real-session production activation remain separate prerequisites. Grading, report evidence, proof storage and customer policy are unchanged.

## Root mounted account build and browser qualification

Root exercised the actual AccountWorkspace, hub, both views and bounded browser readers under React.StrictMode, using synthetic in-memory GET replies and existing customer global styles. The first preview exposed dark-theme muted text on white. Root added only a signed-in collection page CSS-module class and scoped light tokens/white background; other account views and sign-in are outside that selector. Independent narrow source review passed. No auth/request/data behavior changed.

Final root qualification passed44 tests covering every changed test file, updated customer production build and browser-secret boundary with network denied. The specialist's54-pass predecessor receipt remains evidence for its exact prior bytes, including routing coverage; it is not relabeled as a rerun. Final source pins and build logs are retained at `~/.codex/atlas-handoffs/atlas-collection-account-20261021/qualification-01.json`, SHA256 `b8db37236d10a9f9b428f092e16aad9d6cf4d17df2aecd64a574af15d53b0ce7`.

Thirteen browser observations cover1440/1024/390/320px without horizontal overflow, separate collection and claim views,25→2 claim paging, current withdrawn revision alongside original submission/replacement history, exact published-report href, unavailable versus empty states, keyboard entry, shared403/account-mismatch clearing, disabled history and delayed inactive reply teardown. All fixture operations were GETs, zero writes and zero console warnings/errors. The final bundle pins155 inputs and13 fixture/asset files. This does not qualify physical-phone performance, real account sessions/roles, ownership, report navigation or database operations. Approved collection media/settings remain unfinished.

Both owned preview processes stopped cleanly on SIGTERM (exit143); the temporary browser tab closed and viewport override reset. Preview01 remains the observed styling failure, preview02 the corrected source. No production feature was enabled or deployed.
