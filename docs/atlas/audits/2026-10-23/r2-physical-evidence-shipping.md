# R2 successor: private proof and original carrier integration

This checkpoint continues verified `aff4470cb5e7b1e46bd0116c83c043430219e7bd` with exactly two Astra/xHigh specialists: private proof intake and shipping qualification. Root owns authentication, service, HTTP, UI and host integration. The recreated isolated checkout is `/Users/markthomas/.codex/worktrees/atlas-r2-successor/ten-kings-mystery-packs-clean`, branch `codex/atlas-r2-successor`. The old clean checkout disappeared before edits; its commit/tree and 34 transfer/document/evidence hashes were verified before continuing. No cause for the disappearance is asserted.

Exact frozen source/tree, commands, hashes, changed-source mapping, additive package and selective apply results are in `/Users/markthomas/.codex/atlas-handoffs/atlas-r2-successor-20261023/`. This is independent engineering qualification, not live marketplace acceptance. Master ID27 remains open.

## Implemented behavior

- Private buyer/staff image preparation, bounded binary submission, encrypted create-only original retention, full PNG/JPEG raster validation and private exact-byte retrieval. Object IDs bind order, card, actor, purpose, hash and policy. Separate reviewer authority approves artifact suitability; an upload cannot approve its own return or establish title.
- Original-record recovery covers interrupted validation/publication/finalization. Encrypted bytes already published under valid authority remain for authorized recovery if later finalization is denied. No public object URL, replacement upload or automatic repeated provider action is created.
- Independent business validation remains mandatory in nonlocal environments for return decisions, refund allocations, case resolution and proceeds release. Refund and tax reconciliation, existing finance holds and non-return appeals are preserved.
- ShipStation/ShipEngine v1 fixed-origin GET verification for one already-issued exact label, shipment, account and carrier tracking. Original identity, addresses, parcel measurements, selected service/confirmation, declared value, coverage evidence and costs must match independently approved records. No purchase, void or provider webhook registration exists in this adapter.
- Staff explicitly records carrier-derived acceptance and actual delivery. Observation time never extends the owner's 24-hour return window. Missing-scan cues, provider uncertainty, returned-to-sender facts, conflicting timestamps and later tracking regression remain separate from money decisions. Persistent carrier attention blocks release and original transfer preparation/dispatch claim, including after awaited account reads.
- Approved returns retain their own original shipment, tied to the open approved case with ATLAS as initial payer. Delivery of a return is not inspection of the card/holder or reconciliation of its refund.
- Authenticated screens support original photos, separate artifact review, selection of a buyer return photo, recovery, original shipment lookup, explicit carrier milestones and missing-scan follow-up. Pending browser work pins actor, role and CSRF identity and does not repeat uncertain operations.

See [proof contract](../../../../packages/atlas-marketplace/PROOF_INTAKE.md) and [shipping contract/runbook](../../../../packages/atlas-marketplace/SHIPPING_LIFECYCLE_READINESS.md).

## Review corrections and durable boundaries

Independent review found and corrected three issues before freezing:

1. A reconstructed service must not evade retained physical requirements by omitting a port. Proof/shipping bindings are retained from reservation, checked at payment claim, and retained on physical transitions. Existing proof/shipping rows also impose their requirements, including for older orders. Missing/changed ports fail closed before physical transitions or transfer claims.
2. New proof operations must not commit solely under a role-shaped actor after a request expires. A request-local capability now preserves the canonical original principal, request/body hash, expiry, abort and configuration pins. Async refresh rereads canonical authority around decoding/publication/review; synchronous guards run at transaction/publication boundaries after waits. No R1 row lock is held during decoding/provider work. Shipping issuance/tracking commits also refresh request authority after provider reads. This does not claim an atomic cross-database transaction or rollback of previously committed effects.
3. Original external shipment ID is optional and blank UI input becomes `null`; an externally issued label without one remains representable.

The canonical binary body pin uses exact length and SHA256 rather than JSON-expanding the entire Buffer. Canonical session/gateway behavior was rerun locally because this source changed. The direct body limit remains 16 KiB for JSON, 10 MiB only for exact proof upload routes, and the existing separate webhook limit is unchanged.

## Host composition and preservation

`createMarketplacePhysicalFactory` is disabled by default. It accepts explicit immutable configuration, marketplace-only keys, independent approval callbacks, current proof/reviewer authorization, an exact shipment resolver and issuance/coverage validation. It creates encrypted storage, a decoder and both branded ports against the host's newly owned marketplace store. It never discovers credentials, creates a directory, buys a label or opens a listener.

The owned-host v2 manifest requires `physicalConfigHash` and the branded same-store physical factory; direct/ambiguous ports are refused. The existing v1 contract remains valid only without physical ports. Closing the host drains owned work and awaits decoder shutdown before closing owned storage. Caller-owned canonical R1 states and pool remain owned by the caller.

| Boundary | This increment |
| --- | --- |
| Grading, reports, slabs, labels, photos, Ten Kings | No application source changes. |
| Canonical auth/gateways | Uses existing imported R1 classes; no gateway SQL registration or shared auth change. R2 request wrapper changed and was qualified. |
| Database/roles | No SQL or schema change; additive JSON state maps through unchanged dedicated store gateways. New encrypted proof files require an independently qualified private durable volume/key lifecycle. |
| Webhooks/recovery/money | Existing finance implementations and prior real sandbox evidence retained; no financial replay, hosted endpoint change or new money operation. |
| Shipping | Read-only exact-original adapter, locally mocked; no actual API account/coverage qualification, label purchase or webhook setup. |
| Dependency | R2 alone declares existing lockfile version `sharp@0.33.5`; no existing resolution changes. Selectively add its importer rather than replacing the accepted shared lockfile. |
| Claims/history/guidance | Claims and ownership history remain OFF; genuine eligibility remains unavailable. Pricing guidance stays disabled. Fingerprint alone does not supply title/consignment/custody authority. |

## Owner-directed packing research

The owner says orders vary by card count/customer and requested FedEx small-box presets plus Whatnot research. Staff now has published FedEx Extra Small (7.25 × 4.6875 × 2.5 in), Small flat (12.375 × 10.875 × 1.5 in), Small deeper (11.25 × 8.75 × 2.625 in) and FedEx Office plain 8-inch-cube comparison presets. Weight is explicitly entered per comparison; no default slab weight or card-count capacity is invented. FedEx branded packaging requires the appropriate FedEx service/packaging code and is not generic UPS/Ground packaging. [FedEx One Rate](https://www.fedex.com/en-us/shipping/one-rate.html), [FedEx boxes](https://www.fedex.com/en-us/shipping/packing/supplies/boxes.html).

Whatnot's eligible 0–1 oz card profile adds 0.5 oz per bundled item. This is shown as a platform-specific reference, not a measured packed slab/box. All cards, slab protection, padding and the sealed parcel must be weighed. [Whatnot Smart Bundling](https://help.whatnot.com/hc/en-us/articles/16285911553677-How-Smart-Bundling-works).

The first origin remains **3280 Ramos Circle, Sacramento, CA95827**. The prior 8×6×4-in/1-lb parcel and dashboard rate examples remain historical unmeasured comparisons. Buyer shipping remains the qualified ShipStation rate plus **$3 per order**, disclosed upfront; observed label/insurance costs are not contribution profit.

## Qualification and remaining acceptance

Final affected **150/150 tests across30 files (136 top-level groups), with zero failures/cancellations/skips**, cover real local Node22, SQLite, encrypted filesystem, full sharp decoding and loopback HTTP, with explicit synthetic authority/finance and mocked provider responses. They cover exact-byte readback, corrupt/oversized/tampered images, restart and uncertain original recovery, scoped reviewer grants, request expiry/revocation, durable missing-port refusal, actual-delivery timing, return/refund/release/appeal joins, v1/v2 host composition and private UI state. Exact count and source hashes are in `final-test-command.json` and `final-affected-qualification.tap`; historical counts overlap and must not be summed. No new live-browser, physical-device, provider or physical-card acceptance is claimed for these new controls.

Prior real Stripe standard payment/transfer/refund/reversal/paid test-bank payout, actual SCA challenge and isolated PostgreSQL role/restart evidence were hash-verified and reused. Their unchanged low-level provider, ledger, persistence and SQL sources are listed in `qualification.json`. New request/service/host joins have fresh evidence; prior live outcomes do not certify these new physical interfaces.

The accepted serving baseline reported by master is R1 `03b075f94191030856f029a4f6ec6e5fdcad402b`. Label candidate `ce3e2de0bb50b86abbfe6622e1ebe6bc930cfc09` was supplied for read-only selective apply qualification, **not** represented as accepted or deployed. Only the additive R2 package, R2-owned audit/handoff documents and narrowly scoped lockfile importer belong in that check. Shared master/session documents require reconciliation, not wholesale replacement. The master owns R1 → label → selective R2 release order and will provide the final accepted baseline.

Remaining genuine gates:

- Exact marketplace carrier/API mode/account, supported service/signature/coverage for graded cards, actual measurements/fit and one original issuance. No credential file was supplied in this session.
- Actual tax entity, registrations/codes/funding and operating records; new quote/reporting adapters remain locally mocked.
- Independent proof retention/reviewer policy, key lifecycle/backups/restore and decoder OS/network/native-memory containment. The killable bounded subprocess is not an OS sandbox.
- Master-owned target gateways, dedicated roles/storage, TLS/proxy, raw signed webhooks, restart/schedules/alerts, rollback and signed-in acceptance. Tracking polling/freshness must be separately approved; no automatic scheduler was added.
- Genuine title/consignment/custody and Fingerprint authority, then a real packing/dispatch/delivery/return and joined marketplace pilot. Claims/history remain disabled pending those facts.

There were no destructive operations or shared production effects. These remaining facts cannot be manufactured by a flag, reference string or passing local test.
