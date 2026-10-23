# R2 owned host bootstrap and release-input inspection

Date: 2026-10-22. Base: `5f9f71f6574b2427a475ac5175de8de848b464f7`, isolated `codex/atlas-r2-marketplace-pilot`. This is an engineering completion packet for the explicit owned-host composition lane. It is not deployment, activation, title authority, carrier coverage, tax approval or a new provider qualification receipt.

## Concrete change

The existing `routes-r1.mjs` already joined the canonical R1 auth host, original raw Node requests, marketplace routes and hosted finance. Its caller previously had to assemble preflight, listeners, rollback and shutdown separately. `src/host-bootstrap.mjs` now owns that lifecycle and directly imports `createR1MarketplaceRouteComposition`. There is no replaceable core host factory, configuration-module loader, environment lookup, secret discovery or shared route registration.

`createMarketplaceHostBootstrap(options)` is disabled unless `enabled === true`. Its enabled inputs are:

- `manifest`: the closed, nonsecret release contract below.
- `host`: the existing approved `createR1MarketplaceHost` options, including real canonical R1 states, the dedicated pool, actual provider and branded `createCommercePorts` plus matching `commerceConfig`. The root-owned host constructs the commerce bundle only after it owns the store; destinations, checkout quotes and tax lifecycle share that exact store.
- `finance`: the existing approved `createHostedFinance` options, without foreign store/service/provider overrides. Durable scoped ingress, recovery settlement capability and a qualified alert sender are required by this complete-runtime composition. Concrete commerce also requires `config.taxReporting: {enabled: true, maxItems, approvalRef}`, with an explicitly approved nonsecret reference and integer `maxItems` 1–50.
- `existingHandlers: {public, customer, staff}`: the actual pre-existing raw Node handlers. The exact request, URI, headers, socket and body stream are forwarded to them for unrelated routes. They are not reconstructed from claimed actors or parsed request bodies.
- `assertReleaseReady(binding)`: an independent server-only synchronous gate returning exactly `true`. It receives the immutable operation/environment/platform/source/manifest and configuration hashes. Promises are refused and their rejection is consumed. This is additional to the existing host, marketplace, settlement, finance, commerce and alert gates.

The returned object has only `prepare()`, `start()`, `stop()`, `status()` and `health()`:

1. Construction performs structural checks only; it opens no listener, database connection, timer or provider transport.
2. `prepare()` invokes the actual canonical composition and a finance snapshot through the actual PostgreSQL store adapter. The read checks current identity, effective grants, gateway functions, state format/hash and immutable journal. It starts no scheduler, financial action, provider GET or alert delivery. Preparation is not a claim that every external provider/account/policy is qualified.
3. `start()` prepares once, binds the three explicitly approved owned listeners, and starts the existing durable finance scheduler once. All listeners refuse requests until the group is ready. No source file is imported that calls the existing private runtime's `listen()` or starts grading workers.
4. A failed bind closes the listeners created by this instance. It never kills, replaces or attaches to the process occupying a port. Port 8070 is explicitly refused because it belongs to the shared R1 runtime.
5. `stop()` revokes new admission, stops the scheduler, closes the owned servers and joins outstanding handlers and store work. A finite network grace destroys remaining sockets, including incomplete webhook uploads. It never abandons a reducer/DB promise by racing it against a timeout. Handler completion can therefore extend shutdown beyond the network grace within the underlying transport/database limits. The caller retains ownership of the pool and R1 states.

Startup and shutdown are idempotent during concurrent calls. A stopped or failed instance cannot silently restart; a new explicitly approved instance is required. Manifest, top-level capability identities and configuration hashes are pinned. Marketplace readiness revocation does not change unrelated R1 fallback handlers. No process signal handler is registered; the host owner explicitly calls `stop()` from its existing shutdown path.

Starting this complete composition authorizes the separately approved tax-reporting stage of future scheduled runs. That stage can create the original Stripe tax transaction for an already confirmed sale; it is **not GET-only money recovery** and is never run by `prepare()` or by `settleRecoveredPayments()`. Its explicit enablement, bounded item count and approval reference are bound by `financeConfigHash`; the branded commerce factory additionally requires its independent tax-lifecycle approval. Refund tax reversals remain an explicitly reviewed operator action. The hosted finalization signal reaches the tax transport, whose capacity remains occupied until any ignored underlying request settles. No new money payment/refund/transfer/payout is created by this reporting stage.

## Manifest and offline check

`src/release-readiness.mjs` exports `MARKETPLACE_RELEASE_SCHEMA`, `MARKETPLACE_EXTERNAL_GATES`, `inspectMarketplaceReleaseManifest(manifest)` and `inspectMarketplaceHostInputs(options)`.

The manifest has exactly these fields:

| Field | Contract |
| --- | --- |
| `schema` | `atlas-marketplace-owned-host-v1` |
| `environment` | `PROVIDER_SANDBOX` or `PRODUCTION`, exact match throughout the runtime |
| `origin` | `https://atlasgrading.com` |
| `platformAccountId` | Exact approved Stripe platform ID |
| `sourceRevision` | Full 40- or 64-character lowercase hexadecimal revision; independently checked by the release gate |
| `releaseRef`, `bootstrapApprovalRef`, `networkApprovalRef` | Explicit nonsecret references; none supplied by this implementation |
| `hostConfigHash`, `financeConfigHash` | Canonical hashes of the exact existing host and hosted-finance configurations |
| `commerceConfigHash` | Canonical hash of the exact branded commerce factory configuration |
| `marketplaceBindingHash` | Canonical hash of `host.marketplace.runtimeApproval.binding`, including marketplace policy and context bindings |
| `listeners` | Exactly `public`, `customer`, `staff`, each `{host, port}`. Host is an explicit IP; no hostname resolution. Ports are distinct, unprivileged, not 8070. Port zero is allowed only for sandbox loopback qualification. |
| `limits` | `maxConcurrent` 1–100; `maxConnections` 1–10,000 per listener; `requestTimeoutMs` 1,000–300,000; `headersTimeoutMs` 1,000–60,000 and no greater than request timeout; `keepAliveTimeoutMs` 100–60,000; `shutdownGraceMs` 100–300,000. All are explicit integers. |
| `externalEvidence` | Exactly `routing`, `canonicalAuth`, `database`, `provider`, `webhook`, `recovery`, `alerts`, `authority`, `policy`, `fulfillment`, `activation`. Each is a nonsecret reference or `null`. A reference never changes the inspection result into verified evidence. |

There are no approved fee, timing, carrier, tax, key, address, listener or authority defaults in this manifest. Code that builds it may compute configuration hashes from independently approved objects, but must not create approval references or affirmative evidence from an empty answer.

Run the offline check with the package's qualified Node 22 runtime:

```sh
node packages/atlas-marketplace/scripts/check-marketplace-release.mjs /absolute/path/to/nonsecret-release-manifest.json
```

It opens only that explicit regular JSON file, refuses symlinks, limits input to 256 KiB, never imports executable configuration, never discovers environment or keys, and prints only fixed diagnostic paths/codes and nonsecret digest/status fields. Exit 0 means structurally complete metadata; exit 2 means missing or invalid metadata. Runtime capability instances cannot be checked by an offline JSON CLI. The in-process inspection reports missing server ports, and `prepare()` checks the actual composition and database. Every inspection remains `productionReady: false` and `saleAuthorityAvailable: false`; every external gate remains `EXTERNAL_VERIFICATION_REQUIRED`, even when a reference is present.

Minimal server-owner sequence, using already constructed approved values:

```js
const inspection = inspectMarketplaceHostInputs(options);
if (!inspection.configurationComplete) return inspection; // redacted missing inputs
const host = createMarketplaceHostBootstrap(options);
await host.prepare(); // no provider action, listener or schedule
await host.start();   // explicit owned listeners and schedule
// Existing host lifecycle later calls: await host.stop();
```

Do not put credentials, encryption keys, provider objects, raw payloads, source code or arbitrary error messages in the manifest, status endpoint or audit packet. `health()` is a server-only read of retained finance state; this module registers no public health route.

## Qualification performed

Command:

```sh
/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node --test packages/atlas-marketplace/test/host-bootstrap.test.mjs
```

Result: **6/6 focused groups pass**. Tests use actual canonical R1 auth classes, the actual PostgreSQL store adapter and actual marketplace/commerce/finance composition with isolated database boundary doubles, synthetic credentials, disabled provider transports and captured scheduler timers. Real loopback HTTP sockets are used. No real database grant change, provider call, alert message or production action occurred.

Covered risks: disabled inputs are not inspected; missing fields and invalid/secret-like references stay redacted; async and revoked approval gates fail before I/O; PostgreSQL privilege drift fails before listeners; preparation starts no recovery/provider work; concurrent starts create one listener set and one schedule; canonical customer auth receives the original request; valid raw signed webhook bytes commit to the durable inbox before ACK, duplicates retain the original and invalid signatures do not reach the store; revoked marketplace readiness preserves unrelated handlers; occupied ports roll back owned listeners; stop during preflight joins the read; a partial raw upload is terminated within the network grace without inbox or financial effects.

The prior 164-test baseline and actual standard Stripe sandbox financial/SCA receipts remain historical evidence. This lane does not relabel them as current production, hosted webhook, instant payout, shipping, tax or physical fulfillment qualification. New combined qualification is retained by the lead.

## R1 handoff and remaining gates

The lead supplied and read-only verified the current R1 production lineage during this lane: staff/public/native `8070c5f`, customer `a537`; receipt `/Users/markthomas/.codex/atlas-handoffs/atlas-r1-optional-comps-20261022/release-01/acceptance/technical-release-ready.json`, SHA-256 `bad3660e9ce027d7eb357770e990151f7b90b77e0b1ea9224a8fb8d14bb3597d`. No additional R1 polling or production inspection was performed by this specialist. This is distinct from the R2 base revision above.

The read-only R1 composition inspection found that `packages/atlas-connected-manual/scripts/serve.mjs` reads environment and starts the shared private runtime and many grading workers at module scope. It must not be imported as a marketplace bootstrap helper. Its private server's manual-service HMAC dispatch is not interchangeable with the original staff/customer canonical session boundary. This implementation does not attach a listener to 8070, modify that server, install gateway rewrites or register production schedulers.

| Remaining item | Category and exact action |
| --- | --- |
| Existing production app entrypoints | **Deployment-owner integration code:** select and review the actual gateway registration/wrapping locations for the independently deployed public, customer and staff apps, retaining raw Node request bytes and canonical namespaces. This new owned-host entrypoint is executable, but it does not assert those deployed apps have been mounted or converted to one process. R1 owns those changes. |
| TLS/proxy and raw webhook transport | **External runtime qualification:** preserve the exact URI, Host and raw body, configure platform/connected endpoint secrets server-side, then retain hosted signed delivery and bad-signature/duplicate receipts. CLI-forwarded historical events do not prove the hosted route. |
| Dedicated database and auth gateway | **External runtime qualification:** provision approved isolated roles/schema, verify current grants and canonical session gateway availability, and retain restart/backup/restore proof. This lane's adapter tests use boundary doubles. |
| Provider, connected account, bank, instant, tax and shipping | **External provider/policy qualification:** supply approved exact credentials/configuration and perform separately authorized actual checks. No metadata field or generic readiness callback may stand in for evidence. |
| Sale/title/custody/Fingerprint authority | **Blocked authority interface:** the R1 compatibility adapter still deliberately reports unavailable. No collection, holder label, configuration reference or fee preview changes that. |
| Commercial and legal policies | **Partially owner-approved:** 8% card-price fee including ordinary processing, zero listing fee/buyer premium/standard withdrawal percentage, and 24-hour delivery window plus staff-reviewed release are approved and encoded. Return reasons/payer are selected (severe damage or wrong product, buyer proof, ATLAS initially pays and staff reviews final responsibility); actual tax/coverage/funding/operating records remain pending. Bootstrap refuses an explicitly incomplete commercial-policy marker. |
| Physical inventory and delivery | **Physical facts:** custody, measurements, packing, carrier scan, delivery and return evidence must exist. A passing local checkout cannot create these facts. |
| Recovery and alerts | **External operational qualification:** explicitly start the scheduler under the approved manifest, observe restart/retry and account reports, and verify the actual alert sender/lookup destination. No test sends external alerts. |
| Production activation | **R1-owned decision:** independently approve and verify the exact deployment/revision/configuration after all applicable evidence; production remains off here. |

The new code closes the owned runtime bootstrap/preflight/lifecycle gap. It intentionally leaves honest, actionable deployment-owner code integration and external acceptance work visible instead of claiming R2 is fully active or sale-ready.
