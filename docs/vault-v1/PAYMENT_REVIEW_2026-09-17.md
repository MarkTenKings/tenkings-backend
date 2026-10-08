# Vault payment review — September 17, 2026

Status: reviewed proposal, not an implemented callback pump or Nayax acceptance. Scope is the imported `df09` checkout, branch `codex/vault-integration-20260917-9ddb13`, base `c4f04006d9302445e2a68b01dcc316def3b4eb73`. Accepted Portrait B is unchanged. The lead owns shared contracts, machine/runtime/CLI, maintenance, source authority and the session log. This lane owns only this new review document for this turn.

The reviewer read all 1,638 lines of the owner-approved V2 blueprint, the product context, both required runbooks, current/relevant HANDOFF_SET_OPS and SESSION_LOG entries, and the September 17 START_HERE. These documents provide context; this review does not expand Vault into the V2 platform.

## Verified delivery evidence

The scoped native directory contains only `README.md` and `unavailable-bridge.mjs`. The imported handoff manifest lists the TypeScript boundary, those diagnostic files, payment fixture tests and the September 11/16 integration reviews. No official vendor header, SDK library/source archive, Linux sample, SDK version/hash receipt, configured terminal test receipt or actual payment result was found in that scoped inventory. The manifest's 29 tracked and 127 untracked entries and 247 artifact paths were inspected for SDK/payment members. This does not establish absence from email, other folders or an account: those were not searched. No credential contents were read.

Mark already called Nayax on September 16 and reported expected “API access later today.” Delivery and product identity remain unverified. A backend API credential would not itself establish the native Marshall ABI, Linux compatibility or terminal test setup. Existing official-source research is preserved in [MARSHALL_INTEGRATION_2026-09-16.md](MARSHALL_INTEGRATION_2026-09-16.md); no new vendor contact or request to call again is needed for this software review.

Current local evidence:

| Source | What it establishes |
| --- | --- |
| `packages/vault-machine/src/marshall-adapter.ts:6` | The only Marshall adapter reports `OFFICIAL_TEST`, `ready=false`, no SDK version and zero purchase limits. Every financial operation fails. |
| `packages/vault-machine/src/adapter-runtime.ts:36` | Explicit MARSHALL selection composes that unavailable adapter. It opens no Marshall journal or bridge and never falls back to mock. |
| `packages/vault-machine/src/marshall-bridge.ts:116` | Only unavailable and explicitly injected fixture handshakes are accepted; no real readiness or financial dispatch is implemented. |
| `packages/vault-machine/native/marshall/README.md:3` | The native artifact is a hardware-free process diagnostic, not the SDK host. |
| `packages/vault-machine/tests/marshall-payment.test.js:30` and `marshall-machine.test.js:22` | Fifteen journal/process tests and six machine integration tests exist. Their September 16 pass is recorded evidence, not a new run or official Nayax test. |

## Current correctness gaps and exact boundaries

1. **There is no durable incoming delivery pump.** Journal `pendingEvents()` returns accepted source events in row insertion order; `acknowledgeDelivery()` only flips `delivered` after an event ID/digest check (`marshall-journal.ts:131`). No caller converts those events into machine callbacks. The bridge's ACK at `marshall-bridge.ts:128` follows journal persistence only; it is not machine application or fulfillment acknowledgement.
2. **Two sequence authorities would collide.** The journal validates its normalizer sequence at `marshall-journal.ts:122`; its meaning is explicitly local normalizer ordering (`marshall-contract.ts:17`). Machine start and recovery synthesize sequence zero (`machine.ts:400`, `machine.ts:949`); reconciliation, cancellation and mock vend use a derived next sequence (`machine.ts:470`, `machine.ts:508`, `machine.ts:540`). A pump must not copy source sequence into that mixed stream or allocate it by reading the last applied sequence outside the committing transaction.
3. **Startup can apply a later projection first.** `machine.initialize()` recovers sales at `machine.ts:112`, and CLI runs it before runtime construction (`cli.ts:47`). `marshall-journal.ts:146` projects the latest accepted state. If AUTHORIZE then SETTLE are retained, returning the latest SETTLED from recovery before delivering AUTHORIZE loses the required progression. `vaultPaymentTransitionAllowed` correctly rejects settlement without committed authorization (`packages/vault-contracts/src/domain.ts:118`).
4. **Duplicate is not a disposition.** The callback ledger already stores the original disposition, but `machine.ts:409` returns only `DUPLICATE` for matching content at line 415. An originally quarantined callback must remain quarantined on replay. A source delivery receipt needs that original result, not an inference from the current sale screen.
5. **Application acknowledgement is coupled to effects.** Callback persistence and fulfillment intent commit finish before `await drainCommands()` (`machine.ts:458`–`machine.ts:460`), but the handler returns afterward. A lost response or effect error must replay the durable callback receipt without allocating another sequence or command. Startup should be able to persist ordered callbacks before controller dispatch is allowed.
6. **Maintenance has no payment-transport boundary yet.** Runtime pause waits only local/cloud work (`runtime.ts:47`); CLI quiescence covers HTTP, runtime and command draining (`cli.ts:49`). Maintenance queries machine state and controller identity (`maintenance.ts:28`) but not pending Marshall deliveries, quarantine, native process state or unresolved consumed intents. `consumedIntents` is a lifetime count (`marshall-journal.ts:140`), so it must not be used as the unresolved count.
7. **Snapshots omit an eventual Marshall journal.** `deploy/vault-linux/appliance.py:283` snapshots only the machine, mock-provider and controller databases. The service is stopped before backup (`appliance.py:358`), which is useful only when a future native child and pump are included in confirmed shutdown.

## Proposed smallest shared contract

The lead reviewed this direction on September 17. The following names are proposed Ten Kings application interfaces, not SDK symbols or a vendor ABI.

Keep the existing externally supplied `VaultProviderCallback` path separate. `POST /api/v1/internal/provider-callback` currently accepts an authenticated, already sequenced envelope (`http-service.ts:130`); its payload digest, exact replay, stale-sequence, sequence-conflict and transition checks stay intact. **Never renumber an externally supplied stale callback.** Its first durable disposition must also be available to an internal receipt reader.

For trusted in-process adapter observations, use one machine-owned ingress:

```ts
type InternalPaymentObservation = {
  source: "MARSHALL_JOURNAL_V1" | "MACHINE_ADAPTER_RESULT_V1";
  observationId: string;        // stable within this namespace
  observationDigest: string;    // digest of normalized fields excluding itself
  saleId: string;
  originalRequestDigest: string;
  providerSessionId: string;
  providerTransactionId?: string;
  state: VaultPaymentState;
  sourceEventDigest?: string;   // exact accepted Marshall source-event digest
  sourceSequence?: number;      // evidence only; never machine sequence
};

type DurablePaymentReceipt = {
  source: InternalPaymentObservation["source"];
  observationId: string;
  observationDigest: string;
  callback: VaultProviderCallback; // original canonical envelope
  callbackDigest: string;
  originalDisposition: string;    // APPLIED or exact stored quarantine reason
  duplicate: boolean;
};

interface InternalPaymentSink {
  ingest(observation: InternalPaymentObservation): DurablePaymentReceipt;
}
```

`ingest` is synchronous through one SQLite transaction. Before mutation, independently validate the sale/request/session/transaction linkage and reconstruct/recompute the normalized digest. For Marshall, derive the observation from the accepted event plus the journal's immutable request; preserve event ID, source digest and source sequence in bounded allowlisted evidence. Validate the resulting envelope through `VaultProviderCallbackSchema`, including its stricter UUID sale requirement; `safeMarshallId` alone does not meet that requirement.

On first receipt, derive a bounded namespaced callback ID deterministically, assign the machine sequence inside the committing transaction, set the first local receipt timestamp once, and persist callback, disposition, event and any fulfillment intent atomically. Use a next value greater than both the sale's applied sequence and existing callback sequences for that sale, including quarantined rows; do not use an independent pump counter. The source sequence remains immutable evidence. The timestamp is local receipt time, not a fabricated SDK occurrence time.

The existing append-only `payment_callback` columns contain the canonical envelope fields and disposition (`migrations.ts:110`, immutable triggers at line 315). Prefer reusing that ledger with strictly allowlisted evidence over adding a second sequence-reservation queue. Evidence must be safe and canonical before hashing, so persisted redaction cannot change the replay reconstruction. Reconstruct and verify the stored digest before returning an old envelope. A matching namespace/ID with changed content fails closed; it is never assigned a fresh ID/sequence to get it accepted.

This refines the September 16 proposal: the **machine transaction** freezes the canonical callback while applying it, rather than reserving a sequence in one database and later applying it from another. The journal already durably holds the immutable source observation. There is no half-reserved sequence across two stores. On replay, ingress recognizes source identity before considering the current timestamp or next sequence and returns the original committed envelope and disposition.

All machine-generated start/recovery/reconcile/cancel/mock-vend observations must use this same internal ingress instead of assembling callbacks separately. Give each source operation a stable, bounded identity; a repeated read observation is not authority to repeat a payment command. Preserve legacy rows/digests; do not rewrite existing historical callbacks into the new namespace. The external callback handler continues validating caller-supplied sequences against the same durable ledger and never passes external input through sequence reassignment.

For the future real adapter, asynchronous SDK events and synchronous operation results must enter the same journaled chronology before the adapter exposes a latest-state projection. Drain older journal observations before consuming a method result. Where both represent the same provider fact, preserve the same verified source identity; do not invent correlation or synthesize an extra authorization. The exact SDK mapping remains a delivered-package task.

## Proposed payment-only pump and receipts

An isolated `MarshallDeliveryPump` can be implemented after the shared sink contract is accepted, using only the journal and an injected sink. It opens no terminal and makes no provider call. One drain operation at a time reads a bounded `pendingEvents()` batch in persisted order. It constructs the normalized observation, calls the synchronous ingress, verifies the returned envelope/source binding and digest, and only then persists an immutable delivery receipt plus the delivered bit in one journal transaction.

Extend `acknowledgeDelivery(eventId, eventDigest, receipt)` so a bare ID/digest cannot represent machine application. Repeated ACK of the exact receipt is a no-op; changed receipt content fails. Add an explicit journal schema migration for receipt persistence with old request/event bytes and consumed bits unchanged. No database migration or production composition change is authorized by this review.

For a durably quarantined callback, persist the original quarantine receipt as delivered-to-machine and halt further processing. The internal ingress must latch the machine recovery blocker in the same transaction as the quarantine so a crash before journal ACK cannot erase that blocker. “Delivered” means the machine recorded a disposition; it never means authorized. A duplicate quarantine remains the same quarantine. Do not silently skip the bad item and report a healthy drained payment path. Unexpected exceptions, digest mismatch or absent receipt leave the source event pending and report failure without hot-looping or starting a new native process/payment.

The receipt must be returned after the callback transaction and before physical command dispatch. Normal callers/runtime may then drain already committed command intents using the existing command idempotency boundary. This separation makes machine commit before journal ACK replayable without reissuing a physical effect.

## Startup, maintenance and snapshots

Startup keeps checkout admission, runtime recovery ticks and controller dispatch closed while stores/configuration are checked. Split or hook `initialize()` after local integrity, prior-dispatch uncertainty and mapping checks, but before `recoverSale()` and command draining. Open/validate the Marshall transport journal read-only with respect to terminal effects; drain retained observations into the machine in order. Only then run recovery/latest-state reconciliation. Recovery operations must themselves drain earlier journal observations before returning projected results. An unresolved or quarantined backlog blocks normal startup readiness; it is never discarded to allow boot. Existing qualified mapping, physical OFF and unknown-command gates remain mandatory before any effect.

The pump provides a synchronous admission pause followed by awaiting its active drain. Runtime stop/maintenance includes that pause. Native receipt ingestion may continue only while it can durably journal incoming events; do not discard callbacks because the machine sink is paused. Maintenance success requires a stable end state: no pending machine deliveries, no unresolved transport effect/receipt, no unhandled quarantine, no active adapter operation, and confirmed child shutdown or a vendor-proven quiescent state. Recheck after quiescence; resume the existing authorities on an unsuccessful maintenance entry. No such native quiescence semantics are claimed today.

Before composing a real Marshall journal, agree one protected persistent path with the appliance owner, preferably alongside the existing machine database. Add that exact database to stopped-service snapshots and the manifest; require its presence when a composed Marshall adapter requires it, rather than silently skipping it. Preserve journal WAL commits via SQLite backup, machine/schema identity and matching source-state inventory. Checkpoint/backup is not payment reconciliation. Do not snapshot only one side or restore either database independently; retain the existing no-automatic-restore policy.

## Failure and replay acceptance for the new slice

| Interruption or contradiction | Required result |
| --- | --- |
| Native receipt before journal commit | No transport ACK; no machine callback or assumption of no charge. |
| Journal committed, pump not called | Exact source event remains pending across restart. |
| Machine transaction rolls back | No receipt/ACK; retry the same observation after resolving failure. |
| Machine commits, process stops before journal ACK | Replay returns identical canonical envelope/sequence/timestamp/digest and original disposition; one fulfillment intent only. |
| Journal receipt/ACK commits, response is lost | Exact repeat is a no-op; no redelivery with a new ID. |
| Same source ID, altered amount/sale/session/transaction/content | Quarantine/fail closed, preserve both evidence references, no payment resend. |
| Original machine quarantine, then duplicate | Original quarantine is returned and persisted; no claim of authorization. |
| Retained AUTHORIZED then SETTLED at boot | Apply in durable source order before latest-state recovery; no settlement invents authorization. |
| Internal start/reconcile/cancel callback arrives during pump work | Atomic shared sequence authority; no separately allocated zero/+1 collision. |
| External HTTP callback arrives stale | Existing supplied sequence is rejected/quarantined; it is never renumbered. |
| Pause/shutdown during receipt or ACK | Await the active drain; retain unacknowledged events; confirmed shutdown precedes paired snapshots. |

Run focused new crash/reopen, ordering, duplicate/quarantine, internal/external sequence-boundary and maintenance tests on the actual SER once native dependencies are available. Existing September 16 fixture suites were not rerun merely for this review. No Mac dependency install/build, serial operation, payment, remote mutation or credential read occurred.

## SDK delivery checklist and next ownership

The remaining delivered facts are: official product/download identity; SDK version and archive SHA-256; actual C headers/source or supported library, Linux x86_64 sample/build instructions, dependencies and redistribution terms; terminal firmware and approved host harness identity; configured transaction flow and vendor-confirmed non-money test method/card pairing; stable callback/session/transaction identity and ordering; authoritative cancellation/reconciliation/absence semantics; and the approved vend/settlement policy where retrieval is not sensed. Record only non-secret metadata. Package receipt enables offline build review, not a real charge or LIVE readiness.

The feasible next code step is the lead-owned shared internal ingress and receipt boundary plus a payment-owned pump/journal receipt extension with focused tests. The lead explicitly deferred speculative runtime changes in this turn until tests/native dependencies are available. No payment code ownership extension is requested now: the identified gaps cross shared sequencing/startup boundaries and are not safe isolated payment-file fixes. Appliance snapshot integration follows the selected journal path/lifecycle. Native host implementation follows the actual SDK; LIVE remains blocked (`machine.ts:558`).
