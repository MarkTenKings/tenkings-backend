# Optional staff comp curation: inactive application adapters

This increment adds a standalone HTTP adapter, browser parser/client and per-account controller for the existing saved-evidence `createCompCurationService`. It is **local, unregistered and disabled without explicit composition/transport**. No page, shared route, runtime, package export, migration, service, report, grading workflow or production configuration changed. It does not make curation operational or complete R1 or master requirements13–15/26.

## Exact scope and authority

New source is `frontend/atlas-app/lib/server/staff-comp-curation-http.mjs`, `lib/staff-comp-curation-client.mjs` and `lib/staff-comp-curation-controller.mjs`. Three matching `.test.mjs` files and `test/staff-comp-curation-fixture.mjs` provide offline qualification. The fixture uses the actual existing curation service/publication/projector with synthetic in-memory transaction and artifact adapters; it is not an actual database, HTTP server, staff session or browser acceptance run.

The standalone handler proposes exactly two mappings, neither registered:

- `GET /api/staff/comp-curation/cards/:cardId?approvalActionId=<UUID>&previewId=<UUID|none>` calls only `service.read`.
- `POST /api/staff/comp-curation/cards/:cardId/decision` calls only `service.decide` with the existing exact decision contract. An existing authenticated reviewer, the unchanged service's current manual/intake access checks, a same-origin JSON request and genuine session CSRF are required by eventual composition.

Captured trusted auth/service/ingress references cannot drift. The synchronous staff ingress guard must throw on refusal and return `undefined`; predicate and Promise returns are refused before auth or service work. It runs before and after the service call and again after the awaited final authentication. Cookie authentication also runs before/after; the response envelope binds the exact staff ID, reviewer role and mode. Private/no-store headers cover failures as well as success. Inputs cannot supply actor authority, comp facts/prices, a clock or policy. Reads accept the actual empty Next body forms but reject payload/framing and extra/duplicate query keys. The response parser checks the exact card/approval/source/policy shapes, private proposal status, bounded evidence and guidance arithmetic; unknown sold amounts remain null.

The existing service retains latest-publication, saved-artifact, approval/report/source and selection-revision checks. Its only mutation is the existing immutable private curation receipt. A newer pending/failed publication refuses read/decision/replay. This adapter neither changes those rules nor writes published reports, asking prices, listings, grades or approvals. No acquisition/provider interface is supplied.

## Honest recovery and lifecycle

The service has only `read` and `decide`; it has **no historical request-status reader**. Reconciliation is the same GET and creates no decision. It confirms an uncertain request only if the latest stored receipt matches that original request ID, authenticated actor, expected next selection revision, exact immutable approval/source/policy, outcome, selected IDs and selected facts. A matching-looking decision under a different request, no current receipt, a later decision, changed authority/source or a failed read proves neither success nor failure of the pending request. The controller remains `UNRESOLVED` and refuses a new changed decision.

One deliberate retry resends the original immutable input through the service's existing idempotent `decide`; this can return an older exact receipt after reauthorization. It is not automatic and is not described as a read. HTTP failures, malformed replies and timeouts never claim confirmed rollback, including an auth failure after a committed decision. A confirmed receipt describes the original outcome, not the newest selection; a subsequent read obtains current state.

The controller is account-object scoped, serializes work, clears private state on access loss/disposal, and aborts pending requests. Future component wiring must synchronously call `assertScope`/`dispose` for account/access/config replacement, logout, pagehide and unmount. No local/session storage is used. The client settles stalled transport/body reads on timeout or abort, cancels active/late bodies and rejects a foreign staff response. Access teardown necessarily discards the private in-memory pending input; this is not evidence that a save failed. Historical GET recovery after a newer decision or lost context remains a backend capability gap, intentionally not invented here.

## Qualification and corrections

Node22.16.0 passed **35/35 tests, zero skips**:22 new adapter/client/controller groups plus13 unchanged existing curation-service groups. Actual signed staff ingress checks are included without credentials, network or database connections. Meaningful cases cover exact private read/selection/Skip/No suitable; immutable publication/market/packet preservation; bounded inputs; CSRF/origin and signed method/path/deployment enforcement; malformed/predicate/Promise guards; post-commit account refusal; lost reply followed by GET-only confirmation; a later equal-looking decision remaining unresolved; exact same-request replay without another insert; altered receipt bindings; pending publication/ACL refusal; cancellation, stalled streams and timeout; and disabled defaults.

The actual current saved v2 projector is exercised through the service→HTTP→browser parser. Its graded rows retain `designation:null`, `eligible:false` and `GRADE_DESIGNATION_UNCONFIRMED`; they cannot dispatch a controller selection. A separately identified raw row remains its own raw/unverified-condition group. No `STANDARD` designation is inferred. Other synthetic service fixtures explicitly label their synthetic known-designation evidence; they do not establish current saved pools have that evidence.

The first development run had18/19 passing groups and a fixture assertion incorrectly expecting8 authentication calls for3 requests; corrected to6. Qualification01 then passed32 groups. Root source review found the ingress guard contract admitted predicate/Promise returns; the narrow synchronous-void correction and two real guard regressions produced qualification02. Independent ownership review then found a final-authentication await gap: captured configuration could drift during that last await. A final synchronous admission/configuration check and observed deferred-auth regression now refuse changed origin, guard, service, auth or auth method before returning private data. Qualification03 passes35 groups; earlier evidence is retained.

Private evidence directory: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/qualification-03/`.

| Evidence/source | SHA256 |
| --- | --- |
| `result.json` | `544124017570842966075e052d3cd039afa7fd0e457750a49c93c0f6745a6013` |
| `tests.log` | `cddd84643f5182b220b2efe65d50be7c7c37abe7b211bc01eb6b179b7e0074fb` |
| New HTTP adapter | `579b6599efe12d4ea5aee0c6a61ee68e5d3a4f47252dd04d48d296ec5eff4a67` |
| New browser client/parser | `02657d09ee543db5ea9560af61815abe14870da8b08c697b87cb60ffda0f248f` |
| New controller | `5e955927e63fb0bb02b6dc24834f634568083144cb672e34af13a34c1c0a6996` |
| Retained existing curation service | `954de40f0f4cd0a9e4ed4795cb8b52fedff295e6396808b7186342277299a422` |
| Retained existing server contract | `3a27a8b0344ed8607da1d521ff71ab42d9567b08e274ceb7d5fd140b05eb491b` |

All seven new code/test pins and retained service/contract pins are in the receipt. No PostgreSQL cluster, production/provider/storage request, grading run, browser server or release was started for this increment. Independent ownership-lane source review PASS on the final qualification03 pins: all10 source/retained-service/contract/log references verified, the observed final-auth await correction closes its sole finding, and no remaining concrete blocker was identified. The reviewer did not rerun tests or perform effects. Scoped ESLint passed all seven new code/test files before the final two-file correction and passed the final changed pair afterward from the app directory; an intervening repo-root lint invocation failed only to resolve the app-local next/babel preset and required no source/package change.

## Remaining integration and decision boundaries

1. Compose the actual service with its reviewed restricted capability and existing staff auth/ingress in the proper trusted runtime. Any native signed-transport allowlist/proxy, route registration and schema/grant deployment are separate work. Importing this adapter does none of them.
2. Attach an optional post-grade view to an exact authorized approval and saved preview ID; supply explicit same-origin cookie/CSRF transport. Wire account/access teardown and actual-component recovery/browser checks. It must not enter or gate the existing grading review.
3. Retain `LOCAL_PROPOSAL`/`PRIVATE_INTERNAL`, `UNRESOLVED` rights and human-set asking price. Operational data rights, recency and valuation-method approval remain product decisions. Unknown graded designation is a missing evidence contract, not permission to invent one. Skip and No suitable can remain honest null-guidance outcomes.
4. If read-only historical recovery after subsequent decisions or context loss is required, design a separately authorized exact request reader. This increment does not extend the service or claim its latest state supplies that capability.

These are optional staff curation foundations. They do not activate customer ownership, My Collection, public market values, R2 fixed-price commerce or R3 offers/notifications.
