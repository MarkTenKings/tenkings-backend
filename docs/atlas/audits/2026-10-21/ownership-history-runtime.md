# Default-off customer ownership history runtime and GET integration

This increment wires the existing qualified history composition into the existing customer catch-all **in local source only**. Production is unchanged. No history environment values or credentials were provisioned, no connection was opened, no role or migration was installed, no UI was mounted, and proof operations remain outside the integration. The ownership SQL remains unregistered. Base source inspected: `4c5b471c26a228973f26c541d710996938c116f2`.

## Exact source boundary

| File | SHA-256 |
| --- | --- |
| `frontend/atlas-customer/lib/server/ownership-history-runtime.mjs` | `d9b99a64ac1ee821b69817cc750ac48cf01637f3dd738ee606083b693f600566` |
| `frontend/atlas-customer/lib/server/runtime.mjs` | `329890837622b960702b605bcd2b74765c5152c152a820f3fc314c8f6fe9bb47` |
| `frontend/atlas-customer/lib/server/http.mjs` | `7a7cfeec451b7ab040c92c92d06838fd1744a9e495ac4fb75780ded8e2c05968` |
| `frontend/atlas-customer/test/ownership-history-runtime.test.mjs` | `c99a4197f1469e52a29760bd1123261d48f8ef4ec0c3ca2012b1be46deb09ff0` |
| `frontend/atlas-customer/test/ownership-history-routing.test.mjs` | `9a43109a59cbd33dee94c8886b452ba173c15092ca607b6cf654340eeaf2034f` |
| `frontend/atlas-customer/scripts/check-boundary.mjs` | `797122052636621fd7c8e468fecab39d04f28f87d85505ef24d2726e773fa5c2` |
| `frontend/atlas-customer/test/customer-build-boundary.test.mjs` | `7c881829a4bc8986d893d5241d89f0f78c654992ce809ff3a32f64c8b61ac0ee` |

The only existing product edits are a lazy factory hook in `runtime.mjs` and exact history dispatch in `http.mjs`. The qualified composition, reader's five files, current handler, pages, UI, package/lock files, SQL and migration registry are unchanged. No Grading runtime or workflow was imported or changed.

## Configuration and authority

The new server-only settings are `ATLAS_CUSTOMER_OWNERSHIP_HISTORY` and `ATLAS_CUSTOMER_OWNERSHIP_HISTORY_DATABASE_URL`. Absent/empty switch or `0`, with no URL, leaves history disabled. Only exact `1` plus a valid separate URL selects the reader. A stray URL, malformed setting or invalid URL leaves history unavailable without affecting ordinary customer routes. No value is populated by this change.

The reader URL must use the same database host, port and database name as the trusted customer configuration, with a distinct decoded role name **and password**, fixed `atlas_ownership_lifecycle_reader` schema and no arbitrary connection options. Production requires the existing non-loopback TLS endpoint with `sslmode=require`. Local fixture mode accepts only the matching loopback database. The additional pool is bounded to two connections, three-second pool wait and five-second connection timeout. These limits are per runtime instance, not a global service quota.

URL validation does not establish role safety. Every actual transaction still passes the unchanged reader's live privilege check: only the exact `customer_read(text,text,jsonb,text,jsonb)` security-definer entrypoint, fixed search path and non-owned function, with no direct table/sequence access, role membership, elevated role attributes, schema creation or mutator/helper EXECUTE. The ordinary CustomerDatabase client cannot be substituted for the separately owned reader client.

The hook reuses the same real CustomerAuth/configuration/request guard. The existing composition pins these identities, five binding fields, cookie names and transaction method before and after asynchronous reads. The catch-all sends exactly GET `claims`, `claim` and `history` to that composition; it does not call an unchecked ingress predicate first. The composition performs synchronous signed ingress admission, cookie parsing and live account checks before and after projection. Writes to the three paths return405; other ownership endpoints remain404. Neither proof policy configuration nor storage availability is needed to read history.

## Client lifetime

Import, configuration parsing and factory construction perform no I/O and create no reader client. The first admitted read starts a single shared client-construction promise. Concurrent reads use that same owned client; a failed construction stays failed for that runtime instance instead of being automatically retried. The production callback constructs a separate instance of the existing generated Prisma client, never the general customer's instance. No explicit connect/probe/grant runs.

The frozen server object exposes only `handler` and `close`. Explicit `close()` refuses new reads, waits for already active transactions and any started construction, then disconnects the owned client exactly once. It never disconnects the general client or invokes a replaced disposal method. A swapped client method fails closed. A warm runtime retains its bounded pool until explicit close or host process disposal; this change adds no process hooks or automatic restart. Closing during a multi-transaction request may make its next access check unavailable; private results are not fabricated.

If the factory returns a malformed newly owned client with a disposal method, that client is disconnected before refusal, once only, including when disposal throws. A substituted general client is never disposed. A return lacking disposal is never queried; the production factory is explicitly a non-connecting Prisma constructor, so no connection pool has opened at this point. An injected factory must preserve this fresh/lazy ownership contract and clean up any resources it creates before throwing rather than returning them. The wrapper cannot recover an undisclosed resource from an arbitrary faulty factory.

## Local qualification

Node22 command:

```sh
node --test frontend/atlas-customer/test/ownership-history-runtime.test.mjs frontend/atlas-customer/test/ownership-history-routing.test.mjs frontend/atlas-customer/test/customer-build-boundary.test.mjs frontend/atlas-customer/test/collection-routing.test.mjs frontend/atlas-customer/test/current-customer-boundary.test.mjs frontend/atlas-customer/test/security.test.mjs
```

All **27 final groups passed**, zero failed/skipped: 16 new runtime/routing/build-boundary groups plus11 existing collection/current-route/customer-security regressions. ESLint on all seven changed/new source/test/script files and `git diff --check` passed. The initial24-group suite passed. The subsequently added boundary fixture initially failed its two groups because macOS `/var` and `/private/var` produced unequal absolute trace paths; canonicalizing only the owned fixture root fixed that setup error. Its actual-script secret-refusal cases and the final integrated27-group run passed; owned temporary directories are removed in finally.

The tests execute the actual catch-all handler, route signer/verifier, CustomerAuth, existing history composition, restricted-reader service and projector. Transaction results, credentials, account/card values and request/response objects are synthetic; no database, network, provider or storage is contacted. The ordinary session test uses actual CustomerAuth bootstrap with a synthetic database response, preserves its cookie/CSRF behavior, and proves missing/malformed history settings do not break session or notification reads. Unsigned ordinary access remains refused.

Other assertions cover exact three-action dispatch, no client creation for bad ingress/cookies/queries/bodies or writes, foreign account and final session revocation, live role refusal, disabled configuration, credential/schema/TLS/options constraints, single-flight construction, observed pending construction/transaction before close, draining/disconnect once, sticky failure and general-client/method replacement refusal. These synthetic await tests do not claim PostgreSQL lock-wait, real pool behavior, deployed role provisioning or production acceptance.

Root additionally authorized the narrow browser-secret regex extension and actual customer build. The existing pure grading-core compilation prerequisite, Prisma generation using the build script's synthetic loopback-port1 URL, Next production build and actual boundary script all exited0. Every stage ran under macOS `sandbox-exec` with `deny network*`, a cleared environment, telemetry disabled and no `.env` files. No packages were installed or pulled. Generated outputs are ignored. The build retained unrelated existing UI lint/CSS warnings; this increment does not repair those components.

The build's expected route manifest and packaged schema/native database engine passed. The new credential marker appears in built server code and is absent from scanned browser chunks. The boundary test executes the actual script against an owned synthetic build tree, proving both clean acceptance and rejection of the new history URL marker and existing authority markers.

Private evidence root: `~/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-history-runtime-build-01/`. `result.json` SHA256 `5e2a48bc147a445860f6139e103d3a5b05e34e11a7a1fbc1011ed8e1e15a3fcf` pins all four build logs and seven source files. Final `qualification-01.json` SHA256 `ed4c62a7871b6611f72de58bb09e86153c1931a92d013d506d5869960a8820da` pins the27-group log, build receipt, manifests/trace/build ID and server feature chunks. All exact source copies are retained. This is a local Mac build, not a deployed/runtime database qualification.

Independent collection-lane review passed on the exact seven source pins and all19 referenced source/log/build artifact hashes in `qualification-01.json`. The reviewer traced actual CustomerAuth/signed ingress, the three GET operations, disabled/malformed preservation, distinct bounded lazy single-flight client, live role validation, close/drain and malformed-owned cleanup. No concrete blocker was found; the reviewer inspected the27-pass log and build/boundary results without reruns, database connections or external effects. No UI change was made, so no new browser session was started.

## Remaining gates

Before production use, root must review/package the six SQL dependencies with disabled policies and no reviewer grants, provision the sole-function reader role/credential separately, and qualify the actual role and same CustomerControl deployment binding. The local build and extended secret-boundary gate are complete; exact deployment source/build/runtime qualification remains required.

The future customer/public-router deployment must preserve ordinary auth and exact signed ingress, then verify own/foreign/current/history/expiry/refusal behavior with real sessions. UI mounting remains a separate bounded task. Operational claim submission/review still needs accepted-proof, retention versus deletion, storage/decoder and named reviewer decisions. History integration does not select these policies or establish legal ownership from submission, staff ACL, custody or NFC.
