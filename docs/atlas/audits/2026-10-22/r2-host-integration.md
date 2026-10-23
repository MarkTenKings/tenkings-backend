# Successor route composition

`src/routes-r1.mjs` now provides unregistered, lazy, default-off wrappers for the actual raw Node request boundary around the existing public/customer/staff handler. Fixed mounts retain the exact signed URI/body/socket/cookies; unrelated traffic falls through unchanged. No frontend route, rewrite, pool, environment or scheduler is automatically registered. The new commerce policy/instant fee ports and ingress configuration are pinned by the host. See `r2-completion-engineering.md`.

# R2 default-off R1 host integration candidate

This lane extends isolated R2 commit `70f1c1ab`; it does not register routes, import an R1 runtime, change shared roles/grants/environment, deploy, contact a provider, or activate title, claims or history. R1's released `a537f922` remains the production reference; the later local optional-comps commit `cf3f563f` is separate R1 work. Current canonical source paths were inspected read-only rather than copied from the older R2 checkout.

## Planned owned PostgreSQL qualification

Before starting any database: initialize one fresh mode-0700 `/private/tmp/atlas-r2-host-qa-*` data/socket tree with PostgreSQL 17, owned `r2_host_qa_admin`, TCP disabled, port 65433. Create only `atlas_marketplace_review_candidate` inside that disposable cluster. Apply the existing storage schema proposal and qualify the new role proposal with its unconditional guard removed **only in memory for this owned test**. Record exact source hashes and the guard removal in a redacted external receipt. Seed the canonical empty `PROVIDER_SANDBOX` state. Check the distinct NOLOGIN owner, exact three SECURITY DEFINER gateways, direct read/write refusal and the real Postgres store. Close all pools and stop the owned cluster. No R1/shared database or passive-session SQL will be touched. Existing restart and 17 privilege-drift receipts are reused.

Observed: **passed** in `/private/tmp/atlas-r2-host-qa-1slnjL`, Unix socket mode 0700, `SHOW listen_addresses` empty, port 65433. The unchanged role proposal first raised its intentional refusal; only the recorded in-memory copy then executed. Exact three SECURITY DEFINER gateways owned by the distinct NOLOGIN role, `search_path=pg_catalog`, no role membership, direct state SELECT/UPDATE/journal DELETE/helper execution/public-schema CREATE refusals, effective runtime privilege checks, durable commit/read, and no PUBLIC EXECUTE on a later owner-created function all passed. No financial journals were created. All pools closed; `pg_ctl status` returned 3 after controlled shutdown. No shared/session SQL was applied.

Receipt: `/Users/markthomas/.codex/atlas-handoffs/atlas-r2-parallel-lead-20261022/continuation/r2-host-role-proposal-receipt.json`.

| Retained item | SHA-256 |
| --- | --- |
| Qualification script | `321d0cbe85e6009b7182a5d9c437f117c2beb33f17cae5167b9cd8b7565c3089` |
| Existing storage proposal | `44e8435935eb7b459a6b3c5d0c458f663f5b3a47921fd28e27577bc486b8bc30` |
| Guarded new role proposal | `bff383a4c4354cb1d395ab2420333cc7d2f42ebba39deba1df866b4b13e52063` |
| Exact tested body with guard removed | `854796d988174b70dd0fc653412c21a839bd7381bcc5ae701d0a7df8e71e0dcb` |
| Final owned state | `ff31b11f49ba4542ee247f08c958e827b3be5777f07806b31baff260cdf11459` |

The existing storage restart/17-drift evidence remains applicable to unchanged store SQL and runtime queries; this first run qualifies only the newly proposed ownership/grant body. Both proposal files remain guarded/unregistered. `sql/r1-session-access-proposal.sql` now uses only `search_path=pg_catalog`; all its referenced objects are already schema-qualified. The separate owned qualification of that passive customer gateway follows.

### Planned additional passive-session qualification

Before a second owned start: create a fresh mode-0700 `/private/tmp/atlas-r2-session-qa-*` PostgreSQL 17 cluster, TCP disabled, port 65434. Read the exact canonical R1 standalone baseline and its manifest read-only; load into one disposable database under a NOLOGIN schema owner. Later registered migrations do not redefine the customer session/control/current-account/gateway interfaces exercised here. Seed only isolated control/account/browser/challenge/session rows. Grant the serving role only the canonical `customer_call` gateway. Prove the unchanged proposal guard refuses, then remove only that guard in memory and record all source hashes. Exercise actual canonical CustomerDatabase/CustomerAuth plus the new passive gateway: exact closed hash/binding response, prior action delegation, no session/profile/rate writes on reads, expiry/revocation/access-version refusals, old-wrapper privilege removal and conservative small-clock-lead handling. Close pools and stop the owned cluster. No shared migration, real account, provider, route, claims or history activation is authorized by this check.

Observed: **passed** in `/private/tmp/atlas-r2-session-qa-ODIxD4`, TCP disabled, port 65434. The exact canonical baseline loaded under the NOLOGIN owner; the proposal's guard refused before its in-memory-only removal. The restricted serving role retained exactly one executable application function, `atlas_customer.customer_call`, with `search_path=pg_catalog`; direct session table access and the renamed earlier gateway were refused. Closed output and exact deployment/hash-only input checks, prior unknown-action delegation, session/account revocation, access-version drift, browser/session expiry, actual canonical CustomerDatabase/CustomerAuth, 500 ms database lead with an explicit 1000 ms tolerance, and zero-tolerance refusal passed. A before/after hash of every control/account/browser/challenge/session/rate row remained identical. Pools closed; controlled shutdown completed and `pg_ctl status` returned 3.

The first fresh attempt `/private/tmp/atlas-r2-session-qa-0GdZhd` stopped before executing the proposal because the canonical SMS trigger refused a fixture release hash that did not satisfy its existing local-fixture exemption. The retry used that exact exemption (`LOCAL_FIXTURE`, loopback origin, all-zero release hash). No trigger was weakened, SMS sent or provider called. The stopped first-attempt receipt is retained as `r2-host-session-proposal-first-refusal.json` beside the successful `r2-host-session-proposal-receipt.json` in the external continuation directory.

| Retained passive-session item | SHA-256 |
| --- | --- |
| Qualification script | `5032fed7f9e05fe9ae0167d01cc71e63d74e42835b64b582f99d91a7f1c14f4b` |
| Exact canonical R1 baseline | `68afb04dff6bb81a4b42a9de1412fc8322c6b0696d94e833df03e3183dadde8f` |
| Guarded session proposal | `7a925b42d7392d932f770282f8d1ad2b2be6b5d5090dd06dae8efda578810282` |
| Exact tested body with guard removed | `3df1246d85e03d78b0067656456dc2e1094a24d22d88d06d787ea3e1bed9444c` |
| Unchanged before/after row snapshot | `055abb75310693d26284026789fa57464257488134792adbc46c6498f7a8f30b` |

This qualifies the candidate's syntax and behavior against the retained canonical customer interfaces in an owned database. It does not qualify a shared deployed wrapper chain, approve its role policy or register a migration. R1 must compare current source/schema/owner/ACL bindings before any separate deployment.

## Candidate interfaces and activation boundary

`src/host-r1.mjs` exports `loadR1CanonicalAuth()` and asynchronous `createR1MarketplaceHost(options)`. Disabled construction returns only disabled status/close, performs no optional canonical imports and creates no pool/client/service/listener. Enabled construction loads known class modules, not either R1 `runtime()`:

```js
const host = await createR1MarketplaceHost({
  enabled, config, r1, database, marketplace,
  assertRuntimeReady, assertSettlementReady, clock,
});
// Server-only capabilities, never returned to a browser:
const finance = createHostedFinance({
  enabled, store: host.store, provider: host.provider, service: host.service,
  settlementCapability: host.settlementCapability,
  config: approvedFinanceConfig, assertRuntimeReady: assertFinanceReady,
});
const handlers = await host.createHandlers({ finance });
// A separately approved R1 entry point may mount handlers.listener.
// No listen(), route registration or finance.start() happens above.
```

Required `config` fields are `approved:true`, a real `approvalRef`, `environment` (`PROVIDER_SANDBOX` or `PRODUCTION`), exact `origin:https://atlasgrading.com`, approved `authPolicy`, and `routes`. Optional `requestTtlMs` defaults to 30000; `maxDatabaseClockSkewMs` defaults to zero. Optional `settlement:{enabled:true,approvalRef}` requires a distinct `assertSettlementReady` approval. Absent/disabled settlement remains absent; the host does not mint a STAFF actor.

Routes contain `public:{mountPath,catalogPath}` under `/marketplace/`, `buyer:{mountPath,apiPath}` and `seller:{mountPath,apiPath}` under `/account/`, and `staff:{mountPath,apiPath}` under canonical `STAFF_BASE_PATH` (`/admin`). Each API path stays within its fixed mount. The public handoff uses the configured buyer mount. Customer BUYER and SELLER roles are selected by fixed server routes and explicit role policy; request data cannot select roles. STAFF is REVIEWER-only and rejects OBSERVER even if put in a configuration allowlist.

`r1` supplies **existing canonical** `staffState`, `customerState`, canonical public `publicConfig`, the separately qualified `manualClient`, and explicit `admitRequest` / `admitPublicRequest` ports. The host constructs canonical `createDurableStaffBoundary` itself. It does not decode cookies into identity, rotate cookies, bootstrap sessions, issue login tokens or extend expiry. The passive customer `marketplace_session_access` gateway is required and remains unavailable in current R1 until R1 separately approves its additive SQL. Required admission ports must be bound to the host's approved rate/admission implementation; absence never means accept. No shared cookie Path changes are proposed.

Private API requests reach the bridge with the original `IncomingMessage`, mounted URL, signed headers, socket, cookies and collected exact `rawBody`; nothing rewrites those capabilities. Private static GET shells also use canonical signed-ingress admission. Every API operation resolves/revalidates current session authority and requires admission; POST verifies CSRF before dispatch. Staff service/provider work occurs between short genuine authority transactions, outside R1 row locks. Revocation after an effect suppresses its response without claiming rollback or authorizing another create.

The public origin remains exact. Additional accepted Host values come only from the pinned canonical staff `deploymentId`, customer `deploymentHost`, or public `deploymentId`. No forwarded header chooses host/origin trust. Auth/config/class methods, auth clients and guards, policy contents, context, provider, quote/seller/evidence/onboarding ports, runtime approval, webhook endpoints/secrets and dedicated database settings are pinned against drift. Secret integrity pins remain private and are never emitted in host bindings. Host readiness and marketplace readiness are independent required synchronous checks; references alone establish no approval.

`database` supplies an already configured dedicated `pool`, `expectedRole`, `expectedDatabase`, and distinct `expectedFunctionOwner`. Its database name must differ from both R1 auth databases, and its client must differ from R1 auth/manual clients. Each actual acquisition still runs the existing exhaustive effective privilege checks. The host does not open an environment URL, create a pool, seed the database, run SQL, alter grants, or own the caller's pool lifecycle. `close()` closes handler/store capabilities and joins an attached finance host's stop; the caller closes its pool.

`marketplace` supplies the existing service's trusted policies, context, provider, quote, seller-account, onboarding and evidence ports plus matching `runtimeApproval` and `assertRuntimeReady`. This candidate deliberately installs the existing unavailable R1 sale-authority adapter, regardless of an injected eligibility field. It cannot activate listing/title/custody/Fingerprint from configuration or current collection display labels. Claims/history remain disabled. Existing retained orders may be read/recovered only under their independently qualified service and server settlement boundaries.

Finance composition must share the **identical** store, provider, service and branded settlement capability. `createHandlers` checks `assertHostedFinanceBinding`; plain copies or a host from another composition fail. The staff API's `/provider/webhook` receives exact raw bytes and signature with no cookie authentication fiction; the finance host performs scoped platform/connected signature admission and original-object reconciliation. Current finance config additionally requires `finalizationBudgetMs`; lease >= recovery maximum duration + finalization budget + 1000 ms. `getHostedWebhookBinding()` pins redacted endpoint IDs/scopes/configuration hash; no secret is returned. No timer starts until separately approved `finance.start()`.

## Exact approved evidence reader

`src/evidence-r1.mjs` exports `loadR1CanonicalEvidenceBindings()` and default-off `createR1ApprovedEvidenceReader({enabled,mode,approvalRef,assertReady,request,parseReport,verifyImage})`. Deployment uses canonical `parsePublicManualReport` and `verifyDisplayWebp` from the loader. `request` defaults to fetch but makes no request on construction. Test transport/parser seams are explicitly synthetic contract evidence, not approval of real content.

`readReport(binding,{signal})` and `readImage(binding,'FRONT'|'BACK',{signal})` require an exact independent saved binding `{publicToken,version,publicHash,reportHash,certificateNumber}`. The only remote origin is `https://atlasgrading.com`; the only API selectors are `/api/reports/{token}?v={version}` and `/api/reports/{token}/images/{FRONT|BACK}?v={version}`. No arbitrary URL, cookies, authorization header, storage key, redirects or credentials are sent. The report response is exact `{packet,publicHash}` and the canonical packet must retain the exact token, version, certificate and mode.

`publicHash` is SHA256 of `JSON.stringify` of the exact canonical public packet. `packet.reportHash` is the separately retained original approval/report hash and must match binding `reportHash`; it is not recomputed from the public packet. `readReport` returns verified `reportPath:/reports/{token}?v={version}` alongside packet/publicHash. This is the existing R1 browser report route; no PDF is fabricated. A future qualified approved-card mapping must explicitly pin `/reports/` in its authority context as well as the image evidence route. The current no-real-card host fixture does not do so. Reader output does not manufacture an approved card, media object ID, current owner or sale assertion.

Images must match the approved packet's exact original-side hash, byte count, WebP format and actual header dimensions; the canonical contract currently records 1350×1858, which is validated rather than inferred or synthesized. Approved packet reread after image retrieval prevents a retired/replaced publication from serving stale bytes. Limits: 8 MiB report envelope, 2 MiB original image, 20-second total deadline, two concurrent reads. Both declared lengths and streamed bytes are bounded. Canceled transport retains its capacity until underlying I/O settles, preventing unlimited abandoned fetches. Missing, oversized, changed, malformed or unqualified evidence is unavailable. This reader never consumes optional comps/derivative presentation as immutable approval evidence.

## Clock-skew correction

The auth bridge accepts only an explicit integer `maxDatabaseClockSkewMs` in 0–2000. Default remains zero. A DB observation ahead by more than that bound is refused. Freshness uses `hostNow - observedAt + skew`, the oldest plausible observation. Effective session expiry is `databaseExpiresAt - skew`, the earliest plausible expiry, additionally capped by the request deadline. Neither tolerance nor future observation extends session authority. Host-clock rollback, deadline jumps and current revocation refuse access. The option is pinned across the request.

## Focused verification and reuse

- Auth: 7 groups, including prior opaque STAFF/canonical gateway behavior and new skew boundaries, conservative expiry/freshness, rollback/deadline and revocation checks.
- Host: 4 groups, including canonical CustomerAuth/CustomerDatabase through actual loopback HTTP, original mounted request/socket/cookie preservation, no bootstrap fallback, no composition-time provider/database I/O, independent readiness/dedicated storage, config drift and actual joined finance-brand acceptance/refusal.
- Evidence: 3 groups covering exact report/Front/Back selectors and hashes, wrong mode/identity/hash/dimensions, response caps/origin/redirect/content handling, changed publication, revoked readiness, abort/retained concurrency. No live public evidence requests or real image-decoder acceptance is claimed.
- Actual PostgreSQL: separately invoked `test/r1-role-proposal.integration.mjs` and `test/r1-session-proposal.integration.mjs` passed and stopped their owned clusters as recorded above. No shared migrations or database grants were applied.

Root owns final aggregate TAP and SESSION_LOG; no broad unchanged suite or provider/browser scenario was repeated by this lane. Earlier 163-test/137-group qualification, PostgreSQL restart/drift receipts, and real sandbox finance/SCA receipts retain their original scope. These changes do not qualify a hosted production endpoint, actual shared auth deployment, physical fulfillment, title/custody, data-rights/pricing policy, or a real sale.

## Current canonical source pins

Read-only R1 worktree HEAD observed `cf3f563f`; production remains `a537f922`. All seven directly loaded canonical sources below have identical hashes in the current isolated R2 tree and inspected current R1 tree; the lead independently compared them. Imports resolve in the eventual integrated tree; none imports the old checkout by absolute path. R1 must compare these hashes again when applying the additive candidate, preserving later grading/slab and optional-comps work.

| Canonical source | SHA-256 |
| --- | --- |
| `frontend/atlas-app/lib/server/access/auth.mjs` | `87a031d401e020f5b4d4b8d292764b4b541450270db8f9672c53638db735aae7` |
| `frontend/atlas-customer/lib/server/auth.mjs` | `bb921415ba2dff47f4608502bc79b157336b7cc124a108dca0cd55d7e29fd175` |
| `frontend/atlas-customer/lib/server/database.mjs` | `7c6418bad236cad279ae92a79b01e2356234bebf2f8df042c6c3f022dd731672` |
| `packages/atlas-manual-service/src/staff-auth.mjs` | `7e367a5778e5151c2b36b5cac92fa725dd0767ad7e76b16c417f2e514146a015` |
| `packages/atlas-report-view/src/manual-public-contract.mjs` | `e5d839a2a3cf74a97a0678809b049ade4e7b146cbd1ec3c99e120ea7d9990dc2` |
| `frontend/atlas-app/lib/routes.mjs` | `ab50c1003b041cb723ef6d5bc1666abead5da54843f26663af33d493e4eea7cb` |
| `frontend/atlas-customer/lib/collection-display-contract.mjs` | `e2c62a10777a60ecd9dd210843affcd75fc5d3279405469591620845e95db0ef` |

Additional inspected current R1 boundary references: staff runtime `48d7b472e8a2b7ba2682ab2efb63d11a5e8093a033c9d3895e50577432d91588`; customer runtime `b970830e316d9221f30a7f115d8818054d726ea047349a8a8294c2d4470f6bba`; public reader `58dc7d3e87c093ac06a8b9b719ddc57d26f2307f25d1233d7da135f874a52bb5`; approved-report HTTP `6be428394070ce8cc1288c23e4d89480e54716ff3159551a4a78a423ad4c9ccc`; approved-media HTTP `d8548fc3f479ecd3734f8f13a0cb86076f4957fccad54a832c22624eb5142b4e`; report page `f441d548a0711b48f7e963a8b18482f0f0bf739c5f42a964e9d90d899e93fb60`.
