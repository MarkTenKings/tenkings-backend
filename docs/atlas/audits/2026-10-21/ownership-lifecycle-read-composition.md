# Inert customer ownership history read composition

Status: local source only; no route is registered and no runtime activates it. The factory requires explicit trusted server state and a separately restricted reader client. It performs no I/O during import or construction. Independent source and final test review passed on the exact bytes below.

## New source boundary

| File | SHA-256 |
| --- | --- |
| `frontend/atlas-customer/lib/server/ownership-lifecycle-read-composition.mjs` | `86524290713edb0a5fdba9e4660039c03e6371513d882d7498d6a2b8857ffd1b` |
| `frontend/atlas-customer/test/ownership-lifecycle-read-composition.test.mjs` | `3c69392de94a0c0c4406a941adc39d80cf5925657cabb533d7eb767653af8d29` |

`createOwnershipLifecycleReadComposition({customerState, readerClient})` returns a frozen object containing only `handler`. `customerState` supplies the already constructed real `CustomerAuth`, its same configuration object, and its existing synchronous request guard. `readerClient` must be explicitly supplied and cannot be the generic customer auth database/client object. The factory neither creates nor opens a connection, and it does not establish the client's database privileges.

The factory directly constructs the qualified `createCardOwnershipLifecycleReadService` with `uiConfig:null`, then retains only its `readAccess`, `listClaims`, `readClaim` and `listHistory` methods for the existing inactive HTTP adapter. It does not export a generic `read` method, capability object, writer, proof client, grant function or environment-derived configuration. The outer handler admits only these GET paths:

- `/api/customer/ownership/claims` with the existing closed page selectors.
- `/api/customer/ownership/claim` with one claim ID.
- `/api/customer/ownership/history` with the existing closed claim/revision/page selectors.

Other methods are refused with 405 before database dispatch; other paths are refused with 404. Configuration, certificate target resolution, request recovery, bundle reads, proof operations and mutations remain outside this composition. Existing writer-capable fields in `customerState` are not copied or inherited. No fallback to `runtime()`, the generic customer database or the old workflow reader exists.

## Authority and integrity

- The composition uses the actual `CustomerAuth` class and its known `authority` method. Cookies produce only session/browser hashes; the qualified SQL reader establishes the live account. An account ID supplied by a browser is never authority.
- It pins state/auth/config identity, all five deployment bindings, the matching `config.binding`, both cookie names, the request-guard function and the transaction method. It checks these before dispatch and before/after every reader call, refusing changed boundaries rather than silently adopting new authority during a pending response.
- The existing ingress guard runs with its original receiver. Its contract is synchronous and returns void. A Promise or boolean predicate is refused, so an unfinished/failed asynchronous guard cannot be mistaken for successful admission by the existing synchronous HTTP adapter.
- The qualified reader still checks its exact database role on every transaction, uses bounded lock/statement/transaction timeouts and invokes only `atlas_ownership_lifecycle_reader.customer_read`. It refuses broad table/sequence privileges, inherited/elevated roles, writer/legacy/helper execution, ownership of the routine or an altered security configuration. The composition does not replace or weaken those checks.
- The existing HTTP adapter still performs independent live access reads before and after the requested projection, binds the result to that account and returns private/no-store headers. Final access loss or foreign-account output discloses only a sanitized refusal. Cookie parsing alone does not establish ownership or an account.
- List/current/history reads require no proof-preparation configuration. `uiConfig:null` is deliberate, and the composition never invokes configuration or target reads. Missing or disabled proof preparation does not turn a valid management history into an empty result or enable uploads. Original immutable request receipts remain a separate service path and are not offered by this read-only handler.

## Qualification

Node 22 command:

```sh
node --test frontend/atlas-customer/test/ownership-lifecycle-read-composition.test.mjs
```

Twelve focused groups passed, zero failed/skipped. Customer-app ESLint and `git diff --check` passed. An initial local test attempt failed before any group because the new direct module import had one excess parent segment; the path was corrected to the actual qualified service. No existing product source was changed for that correction.

The tests invoke the actual configuration builder, CustomerAuth, new composition, existing HTTP handler, qualified reader service/projector and browser read transport. Transaction responses and request fixtures are synthetic; no PostgreSQL connection or network is used. Coverage includes inert explicit construction, absent/malformed composition, refusal of the generic customer client, exact GET paths, no copied writer/proof capability, cookie/origin/body/selectors, per-read role checks and drift, foreign account output, final live-access revocation, state/config/cookie/client drift during reads, Promise/predicate ingress refusal, and management history without proof preparation. Current withdrawn revision 3 and the historical pending revision-1 submission remain distinct.

The final two groups add actual `signRoute`/`acceptsSiteRequest` verification with synthetic keys and production-shaped configuration: an exact signed customer GET succeeds, while missing/tampered proof, changed signed query and foreign forwarded host are refused before any transaction query. The final group explicitly observes a synthetic `list_claims` result awaiting release, changes pinned auth/configuration, cookie names or ingress guard, then releases the result. All three cases return only a sanitized 503 with no final account query or private payload. This is an observed JavaScript await boundary, not a PostgreSQL waiter qualification.

This qualification proves the local composition and interface behavior. It does not re-prove PostgreSQL lock behavior or real role grants, establish a deployed ingress signature, provision a real customer reader, or enable a live policy. The previously qualified reader's SQL/service/tests and the existing handler/UI files remain byte-identical. No visual change was made, so no new browser session was needed.

Independent `detail_media` review traced the actual auth/handler/reader chain, captured state and binding checks, synchronous ingress admission, live account checks and exact restricted role boundary, with no concrete blocker. A final narrow review checked the signed-ingress and observed deferred-read additions at the final test hash above. The reviewer performed no test reruns, DB connections, network calls or effects; the review does not expand the synthetic qualification into deployed acceptance.

## Remaining work before use

Root must separately register/review the SQL and provision a dedicated serving role/client, supply the existing trusted ingress/auth state, integrate only the intended GET handler, and qualify the real deployed role/session/configuration boundary. Real own/foreign claim access, revocation/expiry and current/history behavior still need end-to-end acceptance after that explicit integration. This factory is not imported by an application route or runtime.

Practical proof policy, private storage/decoder qualification, retention/deletion policy and named reviewer provisioning remain independent decisions and activation work. No such decision is inferred from making history readable. No DB connection, migration, grant, default environment, provider/storage request, operational notification, grading import/change, runtime activation or commit occurred in this increment.
