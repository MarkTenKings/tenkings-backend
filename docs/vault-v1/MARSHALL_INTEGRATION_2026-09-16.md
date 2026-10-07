# Marshall integration — September 16, 2026

The payment lane now has a supervised local process boundary, a durable transaction-binding journal and an explicit unavailable adapter for service composition. Real Marshall dispatch is blocked. No payment, native SDK, serial device, firmware setup, vendor message or physical vend was performed. Software fixture results are not official Nayax test results.

## SDK acquisition and existing evidence

Nayax's [Get Started page](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-get-started) says SDK access follows onboarding. Its [integration process](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process) assigns an integration engineer, configures the terminal/backend for the intended flow, and supplies the SDK/resources in the welcome email. No public downloadable C SDK archive was verified. The precise owner-ready request is [NAYAX_SDK_REQUEST_2026-09-16.md](NAYAX_SDK_REQUEST_2026-09-16.md).

The pending technical dependency is **the official Marshall C SDK integration package for Linux x86_64 and this VPOS Touch's non-money test configuration from the assigned Nayax integration engineer**. The package must include actual headers/source or supported runtime, Linux sample/build instructions and version; the engineer must identify the correct test flow/card configuration. After receipt, its callback/reconciliation/vend definitions supply the remaining implementation facts rather than guessed APIs.

### Latest owner update and SDK intake

On September 16 the owner reported speaking with Nayax technical support, which expects to provide **“API access later today.”** Access is expected, not yet received or verified in this checkout. The owner wants the non-Nayax systems completed and tested while waiting, then Nayax integrated. No further vendor contact is requested by this note and no external message was sent.

The access type remains unknown. Nayax describes [Lynx as its management API](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/lynx-overview) for Core machines, devices and inventory. Its current [Security & Token guide](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/security) calls a Core User Token an API key/API token. Marshall SDK delivery and device transaction-flow setup are documented separately in the [integration process](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process). Therefore a backend token alone would not establish that the terminal SDK or test configuration has arrived. This is a distinction between documented products, not a claim about what support has promised to send.

Inspect the incoming materials once, recording only non-secret metadata:

| Receipt check | Record or verify |
| --- | --- |
| Access identity | Product name and official documentation/download location: Marshall SDK, Lynx/Core access, or another explicitly named integration. Never log a token value. |
| SDK artifact | Package version and SHA-256; actual headers/source or supported library; Linux sample/build instructions; supported architecture/dependencies and redistribution terms. Check against the intended Omarchy/Linux x86_64 appliance; do not assume binary compatibility. |
| Terminal test setup | Intended VPOS Touch and firmware, Marshall host connection, configured transaction flow, and vendor-confirmed non-money test method/card configuration. Keep device/account identifiers outside the repository. |
| Transaction semantics | Supplied definitions for authorization, stable session/transaction correlation, cancellation, restart/reconciliation, settlement and vend reporting for this flow, including what can be reported without a retrieval sensor. |

A link/token without the SDK is recorded as partial access. A received SDK allows header/sample review and an offline build; it does not by itself authorize a test charge, prove the harness, or make `OFFICIAL_TEST` ready. Resolve any actual gap from the received package before drafting a single specific follow-up; do not send the earlier request again automatically.

Read-only targeted filename searches of the imported project, Downloads and supplied handoff directory found no Marshall/Nayax SDK headers, sample or runtime package. The generic `WELCOME LETTER - Ten Kings.docx/.pdf` files exist in Downloads; a DOCX text-keyword check found no Nayax, Marshall, SDK, Linux, RS232 or test-mode reference. This narrow check does not claim the package is absent from email or another folder. No credentials, terminal serial, SIM identity or card data was printed or searched on the web.

The September 11 [bench source](../../../../24e6/ten-kings-mystery-packs-clean/docs/vault-v1/BENCH_SETUP_2026-09-11.md) and its `outputs/vault-bench-2026-09-11/nayax-review/NAYAX_TEST_INTEGRATION.md` were read without modification. Owner reports all ordered equipment received, and September 16 confirms equipment is present but disconnected. Harness identity, SDK, terminal/test-card configuration and first real transaction remain unverified. The existing September 11 connection review remains applicable; no replacement shopping list or new wiring scheme is introduced.

The official [C SDK guide](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration) documents Linux reference code, serial platform functions, a 5–10 ms background tick and increasing millisecond clock. Those public declarations do not establish an installed ABI. The owned VPOS Touch uses the approved COM2/Marshall cable for host control; its Ethernet is for terminal networking, not Marshall control. [Nayax installation steps](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps).

## Implemented boundary

| File | Behavior |
| --- | --- |
| `packages/vault-machine/src/marshall-contract.ts` | Strict bounded Ten Kings IPC shapes. Requires complete immutable sale, USD integer total, line membership, exact door IDs, mapping version, profile digest and endpoint/channel binding. Rejects arbitrary SDK/cardholder fields. |
| `packages/vault-machine/src/marshall-journal.ts` | Independent SQLite WAL/FULL journal with exclusive writer lock and machine/schema identity. Immutable request, one consumed dispatch per intent, unique provider session/transaction binding, atomic callback receipt, conflict quarantine, restart preservation and separate machine-delivery ACK. |
| `packages/vault-machine/src/marshall-bridge.ts` | Non-shell child supervision; no inherited app secrets; nonce handshake, bounded stdout/stderr/backpressure and heartbeat; graceful then forced stop; no auto restart. Only unavailable and explicitly injected test-fixture peers accepted. |
| `packages/vault-machine/src/marshall-adapter.ts` | `UnavailableMarshallNayaxAdapter`: `OFFICIAL_TEST`, `ready=false`, zero unverified purchase limits. Every financial operation fails closed; missing local/provider evidence never returns affirmative absence. |
| `packages/vault-machine/native/marshall/unavailable-bridge.mjs` | Hardware-free process diagnostic with heartbeat. It does not load a vendor runtime or open a terminal. |

The journal is a transport record, not sale/inventory authority. `prepare` binds the exact request; `consumeDispatch` commits before any eventual native dispatch byte and can never be reset/reused. Without a definitive normalized callback, the intent remains unknown and cannot be automatically resent. An unknown/open-session response is not proof that a terminal never charged. Callback conflict, late/out-of-order, wrong amount/request/sale/session/transaction and unknown intent cannot authorize fulfillment. A definitive authorization requires a transaction ID; settlement requires prior authorization. No late decline/cancel reverses an authorization.

There is no approved no-sensor vend policy. Relay ACCEPTED, OFF readback, an animation and customer retrieval are different observations; all vend reporting on the unavailable adapter is rejected. The existing `SIMULATOR_ONLY` policy remains a mock boundary. The IPC contract does not claim vendor callback names, ordering, signatures, endpoints, firmware limits or monetary absence semantics.

### Implementation entry points after receipt

1. Keep the vendor package outside source control and inventory its version/hash. Read its actual headers and Linux sample before writing native calls. Build the supplied sample without starting it against a device; the [public C SDK guide](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration) is supporting guidance, not the installed ABI.
2. Add the native SDK host under `packages/vault-machine/native/marshall/`. Implement SDK servicing, serial ownership, shutdown and callback normalization from the received package. The existing `unavailable-bridge.mjs` is a diagnostic, not an SDK host to enable with a flag.
3. Extend `MarshallBridgeProcess` in `src/marshall-bridge.ts` with an explicitly reviewed real-peer handshake and command/reply transport. It currently rejects real readiness and has no financial dispatch method. Preserve bounded framing, heartbeat, secret isolation and terminal process-failure behavior.
4. Implement a real `NayaxAdapter` alongside `UnavailableMarshallNayaxAdapter` in `src/marshall-adapter.ts`. Use `normalizeMarshallRequest` plus `MarshallPaymentJournal.prepare` for immutable linkage; commit `consumeDispatch` before the first native payment-request byte. Match verified SDK correlation to that intent before `normalizeMarshallEvent`/`acceptEvent`. Add the currently absent delivery pump from `pendingEvents` through `VaultProviderCallbackSchema` to `VaultMachine.handleProviderCallback`: durably freeze the converted callback ID, sequence, timestamp and content before first delivery, coordinate its sequence with the machine's synthesized session-result callbacks, and replay that exact envelope. Call `acknowledgeDelivery` only after the machine's durable callback commit. Never turn local absence or timeout into a new payment attempt.
5. Implement only the supplied, verified semantics behind `startSession`, `cancelSession`, `reconcile`, `reconcileRequest` and `reportVendResult`. Preserve provider transaction identity through the existing shared result/callback contract. Unsupported reconciliation and vend policy remain explicit failures. Extend `src/adapter-runtime.ts` composition and lifecycle only after these paths and real readiness checks exist; `VAULT_PAYMENT_ADAPTER=MARSHALL` currently constructs the unavailable adapter and never falls back to the mock.

These are next implementation steps, not completed real integration. Native callback field meanings, ID scope, protocol frames, provider endpoints and no-sensor vend decisions remain unspecified until the supplied material establishes them.

## Validation

Node20 TypeScript machine build and 21 dedicated hardware-free tests passed September 16 (15 journal/process tests plus 6 independent machine integration tests). Tests exercise immutable door/amount/mapping linkage; restart and consumed-dispatch replay rejection; duplicate callback delivery; session/transaction cross-sale conflicts; unknown and late callbacks; settlement without authorization; writer ownership; packaged unavailable handshake; callback persist-before-ACK; malformed/oversized frames; false readiness/nonce; stderr redaction/limit; heartbeat timeout and process death. Machine tests additionally prove transaction identity preservation through start/reconcile/cancel/vend/settlement, exact profile/address binding, legacy request-byte recovery across an adapter-mode change, and explicit unavailable composition with no mock fallback. No installed SER/Linux or terminal qualification is claimed.

Run from the repository with Node20: `pnpm --filter @tenkings/vault-machine build`, then `node --test packages/vault-machine/tests/marshall-payment.test.js packages/vault-machine/tests/marshall-machine.test.js`. The normal machine test discovery also includes both files. The root session log records shared integration and aggregate validation.

### Work that can finish while Nayax access is pending

Existing fixture tests provide the claimed software evidence without waiting for credentials:

| Evidence already recorded September 16 | What it establishes |
| --- | --- |
| 21 Marshall journal/process/machine tests above | Durable immutable binding, duplicate/restart/conflict handling and unavailable composition. They remain reusable regressions for the future SDK adapter; they do not test Nayax behavior. |
| `packages/vault-machine/tests/marshall-controller-review.test.js` passed | The production helper process/IPC boundary, with fake serial transport, invalidates readiness and preserves a halt after observed idle helper death. No relay hardware was exercised by this test. |
| 11 focused kiosk tests: `portrait-profile.test.ts` and `portrait-integration-review.test.ts` passed | Exact shuffled door selection/labels, no qualified-profile truncation, legacy synthetic gate, durable paid recovery presentation and accurate production/certification checkout copy. |

Controller, appliance, profile and kiosk work can continue under their own acceptance evidence. Software fixture results do not replace physical wiring/output/power-loss qualification; root integration owns that bring-up. No extra broad build or test run was performed for this documentation-only intake update.

SDK-dependent checks still pending: compile/link against the received artifact and appliance; terminal initialization and serial timing with the actual harness; vendor-confirmed non-money authorization/decline/cancel cases; real callback and transaction correlation under duplicate, late, timeout and restart conditions; authoritative reconciliation; and approved vend/settlement behavior. Nayax's [integration process](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process) places certification and production setup after development/testing. Existing `OFFICIAL_TEST` naming and passing fixture tests do not satisfy those steps.

### Fresh bench continuation review — September 16, 2026

Read-only code review in the imported `59f4` worktree, branch `codex/vault-integration-20260916-8137f7` at base `c4f04006d9302445e2a68b01dcc316def3b4eb73`, confirms the following delivery gaps. These are requirements for the future adapter, not newly implemented behavior. The unavailable adapter still fails closed; no code, tests, native/device operations or vendor calls were performed for this review.

- **Frozen delivery envelope:** `pendingEvents` retains normalized Marshall events, but no pump converts them into machine callbacks. Persist the converted callback ID, sequence, timestamp and complete payload before first delivery and replay those exact bytes after interruption. A new timestamp under the same callback ID conflicts with the machine's persisted payload digest.
- **Sequence ownership:** the journal's event sequence is separate from the machine's synthesized start/recovery sequence `0` and reconciliation/cancellation/vend sequence `+1`. Copying the journal sequence directly can quarantine a valid callback. Root must decide the shared durable ordering and conversion boundary before runtime wiring; an independent counter or a fresh read of the last applied sequence does not by itself reserve crash-safe delivery order.
- **Startup ordering:** `VaultMachine.initialize()` currently recovers adapter results before any delivery pump exists. The journal's latest result must not overtake retained events: returning `SETTLED` before delivery of its queued `AUTHORIZED` event violates authorization-before-settlement. Root owns the startup/recovery ordering decision; preserve every retained event and do not replace them with the latest-state projection.
- **Quarantined duplicates:** `handleProviderCallback` returns `DUPLICATE` for a previously stored callback even when its original disposition was quarantine. Delivery handling must retain or consult that original disposition, distinguish durable quarantine from successful application, and acknowledge only after the machine's durable receipt. A duplicate is not independent evidence that fulfillment was authorized.
- **Maintenance and snapshots:** runtime pause/shutdown must cover the pump's admission and in-flight delivery; maintenance must account for pending delivery and unresolved payment transport state. `deploy/vault-linux/appliance.py` currently snapshots only machine, mock-provider and controller SQLite databases. The eventual composed Marshall journal needs explicit snapshot inclusion and protected configuration once its path/lifecycle are settled.

Proposed work independent of the vendor ABI is immutable delivery-envelope persistence plus a serialized pump with an injected machine sink and focused crash/replay fixtures. Acceptance should cover interruption before delivery, machine commit before journal ACK, identical replay, quarantined duplicates, callbacks concurrent with start/reconcile/cancel, ordered authorization then settlement, and maintenance/shutdown with pending delivery. This slice remains proposed; it must not enable real readiness, change `SIMULATOR_ONLY` vend policy, or infer any missing SDK semantics.

Payment ownership remains the Marshall modules/native directory, dedicated payment tests and payment documents. Root owns shared contracts, machine sequencing/recovery, runtime/composition/CLI, maintenance integration and shared handoffs; the appliance lane owns protected deployment configuration and snapshot integration. The official package and verified terminal test setup remain outstanding, and the sequence/startup design is open with root.
