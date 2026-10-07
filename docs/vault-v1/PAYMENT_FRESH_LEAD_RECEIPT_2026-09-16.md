# Payment receipt for the fresh Astra Ultra lead — September 16, 2026

Marshall's durable software boundary is implemented and fixture-tested. **The real Nayax integration is not implemented or qualified.** This receipt records the payment lane; use the main fresh-lead handoff for current SER, controller, deployment and aggregate-test status.

## Authority and latest owner fact

Work is in `/Users/markthomas/.codex/worktrees/9bb0/ten-kings-mystery-packs-clean`, branch `codex/vault-integration-20260916-5601c0`. Payment files are uncommitted/untracked; preserve them. No commit, deployment, payment, vendor message or terminal operation was performed by this lane. Preserved sources `3c63` and `24e6` were read, not edited.

This agent read the full approved V2 blueprint and mandatory context/runbooks at session start. The fresh lead must independently read the full `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md` plus the AGENTS-required context and handoff files before beginning work. Blueprint authority does not establish implemented/runtime behavior.

Mark reported Nayax technical support expects **“API access later today.”** Nothing received has been verified. He wants non-Nayax systems completed/tested while waiting, then Nayax integrated. Do not send another vendor request automatically. The existing [SDK request](NAYAX_SDK_REQUEST_2026-09-16.md) and [integration note](MARSHALL_INTEGRATION_2026-09-16.md) contain prior research and exact intake details.

“API access” is ambiguous: [Lynx/Core credentials](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/security) authenticate the management API; [Marshall onboarding](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process) separately supplies the terminal SDK and configured transaction flow. Inspect the delivered product/download identity, SDK version/hash and actual Linux headers/library/sample, intended terminal/test setup, and callback/reconciliation/vend definitions. Keep credentials and device identities out of logs/source control. A backend token alone does not establish Marshall readiness.

## Final modules and their limits

All following paths are under `packages/vault-machine/`:

| File | Implemented behavior |
| --- | --- |
| `src/marshall-contract.ts` | Strict Ten Kings IPC; exact sale, integer USD amount, line/door/profile/mapping/controller linkage; bounded normalized events. This is not a Nayax protocol or ABI. |
| `src/marshall-journal.ts` | SQLite WAL/FULL, exclusive writer and machine identity, immutable request, single consumed dispatch, unique provider session/transaction IDs, atomic event persistence, quarantine, restart preservation and delivery ACK. |
| `src/marshall-bridge.ts` | Non-shell child supervision, limited environment, nonce handshake, bounded streams/backpressure, heartbeat and confirmed shutdown; no automatic replacement process. Only UNAVAILABLE or explicitly injected TEST_FIXTURE peers are accepted. |
| `src/marshall-adapter.ts` | `UnavailableMarshallNayaxAdapter`: `OFFICIAL_TEST`, `ready=false`, SDK null and purchase limits zero. Start/cancel fail; reconciliation throws rather than asserting absence; vend reporting fails. Constructor/close open no resources. |
| `native/marshall/unavailable-bridge.mjs` and `README.md` | Hardware-free diagnostic process and integration constraints. No vendor runtime, serial/network connection or financial command. |

`VAULT_PAYMENT_ADAPTER=MARSHALL` explicitly composes the unavailable adapter in shared `src/adapter-runtime.ts`; no flag or fixture handshake upgrades it, and no mock fallback exists. Shared machine/contracts preserve provider transaction identity, quarantine cross-sale identity reuse, bind new non-mock requests to immutable sale-item fulfillment, and reconstruct original legacy request bytes for recovery. Root owns those shared files.

## Recorded validation

Node20 machine TypeScript build and **21 payment tests passed**: `tests/marshall-payment.test.js` (15) and `tests/marshall-machine.test.js` (6). They cover immutable linkage; duplicate/late/unknown/conflicting callbacks; consumed-dispatch restart rejection; session/transaction uniqueness; authorization/settlement ordering; child death/framing/heartbeat; persistence before ACK; transaction preservation; legacy digests; and unavailable composition. These are fixtures, not official Nayax tests. Do not rerun merely to reconstruct this receipt; root records final aggregate validation.

Independent review also left `tests/marshall-controller-review.test.js` passing after the controller owner fixed idle-helper-death readiness, and seven kiosk tests in `frontend/vault-kiosk/tests/portrait-integration-review.test.ts`. Together with four portrait-profile tests, **11 kiosk tests passed** after root fixed paid recovery/support labels and production/certification checkout copy. No further findings remained in those reviewed scopes. Fake serial and DOM tests do not qualify physical hardware.

## Outstanding implementation and completion evidence

1. Receive and inspect the actual Marshall C SDK package. Verify Linux x86_64/Omarchy compatibility and build its supplied sample without starting a device transaction. Public documentation snippets do not define the installed ABI.
2. Implement the native SDK host under `native/marshall/` from those exact headers: serial ownership, independent SDK servicing, shutdown and verified callback correlation. Extend `MarshallBridgeProcess` with a reviewed real handshake and command/reply path; neither exists today.
3. Implement the real adapter. Persist `prepare` and `consumeDispatch` before the first payment-request byte. A timeout, crash or empty local record must never trigger an automatic replacement payment.
4. Add the absent durable callback delivery pump: `pendingEvents` → `VaultProviderCallbackSchema` → `VaultMachine.handleProviderCallback` → `acknowledgeDelivery`. Freeze converted callback ID, sequence, timestamp and content before first delivery; coordinate sequence with machine-synthesized session-result callbacks; replay the identical envelope after restart.
5. Implement supported cancellation, authoritative reconciliation and settlement from actual supplied semantics. Keep unsupported paths unavailable. No approved no-sensor vend policy exists: relay acceptance/OFF readback, collection artwork and actual retrieval are distinct observations; none may fabricate vend success.
6. Record SDK version/build evidence, confirmed terminal firmware/harness/test configuration, vendor-confirmed non-money transaction results, exact amount/door/session/transaction linkage, and failure/restart/reconciliation results with real callbacks. Complete the vendor-required certification and production setup before claiming live readiness. Preserve all fixture regressions and add SDK-to-machine delivery/recovery tests. Hardware qualification remains independently required.

The receipt ends this lane's edits. Root owns the main handoff and `docs/handoffs/SESSION_LOG.md`; no further files were changed for this receipt and no tests were rerun.
