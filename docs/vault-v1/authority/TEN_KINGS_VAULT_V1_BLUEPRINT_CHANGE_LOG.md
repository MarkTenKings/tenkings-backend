# Ten Kings Vault V1 — Blueprint Change Log

**From:** Master Blueprint Draft 2  
**To:** Final Master Blueprint Draft 3  
**Date:** August 16, 2026

## Preserved owner decisions

- 150-door `X K I N G S` by `01–25` map.
- Sports and Pokémon at $25/$50/$100/$250.
- Guest, mixed-product, multi-door cart and one Nayax payment flow.
- Sales tax at checkout.
- Configurable product content and price.
- No door sensors, QR scanning, customer close-door step, substitution, or remote unlock.
- One customer-triggered retry, now clarified as one `OPEN DOORS` group action that reissues commands only to the original paid doors.
- Windows mini PC, portrait black/gold touchscreen, local-first operation.
- Staff/restock and certification modes.

## Material revisions

| ID | Draft 2 issue | Draft 3 revision | Reason |
|---|---|---|---|
| C-01 | The initial engineering review incorrectly applied the Card Platform V2 sequence to Vault. | Removed the sequencing gate and recorded the owner correction that Vault is independent and may be built now on a clean branch. | Speedster-first applies only inside Card Platform V2; only a future Vault-to-V2 identity bridge remains deferred. |
| C-02 | Pack/card relationship was ambiguous. | Explicitly prohibits Vault V1 writes to legacy pack/item/wallet/kiosk and V2 card/ownership records. | Vault does not identify the physical pack or cards. |
| C-03 | “Payment approved/charged” was treated as one boundary. | Added separate authorization, fulfillment commit, vend result, settlement, and reconciliation states. | Nayax authorizes vending before final vend result/settlement. |
| C-04 | Controller ACK risked being interpreted as a successful opening. | ACK is command evidence only; customer copy cannot claim physical opening. | No sensors exist. |
| C-05 | Partial multi-vend behavior was under-specified. | Provider limit enforcement and an owner/Nayax-approved no-sensor vend-result policy are mandatory. | Item limits vary; software cannot infer partial physical delivery. |
| C-06 | Local durability was described but not fully contracted. | Defined one local Windows authority, SQLite WAL/`FULL`, append-only events, deterministic command intents, and transactional outbox. | Needed for cloud loss, restart, and idempotency. |
| C-07 | Existing Ten Kings pack/vending reuse was too broad. | Restricted reuse to infrastructure, admin identity, UI/media patterns, CI, and local helper precedents. | Existing flows have different domain/security/concurrency semantics. |
| C-08 | Local and cloud authority could conflict. | Added fact-by-fact source-of-truth table and safe config activation rule. | Prevents cloud overwrite and mid-session mutation. |
| C-09 | Cloud schema was larger and less bounded. | Consolidated into Vault-specific machine, product, door, config, sale/item, event, restock, and staff access concepts. | Smallest safe independent domain; no mutable inventory counter. |
| C-10 | Tax was assumed available. | Added G-03 and a signed/versioned machine tax snapshot. Owner later selected manual Admin entry of city, state, and percentage with basis-point storage and half-up subtotal rounding. | No validated tax provider exists in the current repo; the owner chose a controlled manual process. |
| C-11 | Nayax could be implemented directly in TypeScript from assumptions. | Requires official SDK; permits a minimal C# bridge behind an adapter after G-01. | Official SDK availability and timing constraints. |
| C-12 | Hardware BOM claims were too certain. | Elo 1304L is a candidate; QWORK/controller/electrical claims remain bench-gated. | Datasheet supports paper fit, not installed-system proof. |
| C-13 | Controller API allowed ambiguous physical outcomes. | Added serialized local authorization, deterministic command IDs, safe startup, fixed pulse profiles, and no public batch/remote unlock. | Prevents unpaid or uncontrolled actuation. |
| C-14 | Customer state inventory omitted ambiguity/recovery. | Added dependency, provider-limit, payment-unknown, command-unknown, retry, support, and service-lock states. | Customer must not repay or misunderstand success. |
| C-15 | Full 25-row map was assumed to fit one screen. | Keeps invariant map but adds sticky headers and a dedicated scroll region; tests multiple effective viewports/scales. | 25 rows exceed practical fixed-area height under common Windows scaling. |
| C-16 | Idle behavior could affect payment/recovery. | Unpaid browse only; payment, reconciliation, unlock, retry, and support never idle-timeout. | Protects payment and fulfillment integrity. |
| C-17 | “Pick for me” implementation was visual. | Local service persists an unbiased secure selection before animation. | Animation cannot be authority. |
| C-18 | Staff PIN used generic admin assumptions. | Added individual machine/role-scoped verifier snapshots, rate limit/backoff, revocation, service lock, and safe exit. | Existing environment allowlists/operator key do not satisfy local offline access. |
| C-19 | Restock could overstate inventory. | Requires per-door `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`; only `FILLED` restores availability. | No sensors and short stock make bulk assumptions unsafe. |
| C-20 | Certification thresholds were not reconciled. | Clarified 750 purchase-door cycles, 300 restock-door cycles, and separate 500 session minimum with deterministic coverage scheduling. | Random selection cannot prove every-door quotas. |
| C-21 | Test and production isolation was mainly UI-based. | Every sale/event has immutable mode; reports exclude tests by default; certificate binds versions/evidence. | Prevents test revenue/inventory leakage. |
| C-22 | “Real-time” cloud reporting implied online authority. | Fleet shows freshness and sales-ready reasons; local remains immediate authority. | Offline machines cannot provide truly current cloud state. |
| C-23 | Build prompt could run through unresolved gates. | Build Prompt V2 contains gate ledger, phase stop conditions, clean-worktree discipline, independent review, and no implicit deployment authority. | Prevents speculative or unsafe implementation. |
| C-24 | “One retry” did not define multi-door behavior. | Added one transaction-level `OPEN DOORS` action that sends one second command to every original paid door and cannot target any other door. | Owner explicitly selected an all-paid-doors retry. |
| C-25 | Customer escalation remained undecided. | After the group retry, show a Ten Kings support page/QR; no automatic substitute, store credit, or refund. | Matches the owner-selected customer remedy and preserves reviewed financial resolution. |
| C-26 | Support destination was generic. | Requires a Ten Kings support page with email, text-message, and phone-call choices. | Owner selected three customer contact channels. |
| C-27 | Role names lacked a reviewable permission matrix. | Added detailed allowed/prohibited actions for Restocker, Technician, and Admin. | Owner requested the role list for review and confirmation. |
| C-28 | Certification and enrollment owners were unspecified. | Technician or Admin may approve pre-field certification; Mark/Admin owns enrollment and security keys. | Owner supplied the responsible roles. |
| C-29 | Cloud outage was conflated with local door control. | Clarified that active/authorized fulfillment and retry are local and locked fail-closed new checkout during Ten Kings cloud loss. | Door actuation does not require the Ten Kings cloud; the owner approved no new checkout during cloud loss. |
| C-30 | Four final owner confirmations remained. | Mark approved the role matrix, fail-closed new checkout during Ten Kings cloud loss, service-life-plus-three-years certification retention, and Admin-supplied support deployment values. | Closes every remaining owner-policy decision and makes Draft 3 the final Codex build contract. |

## Simplifications

- No separate local microservice fleet; one machine service and optional minimal SDK bridge.
- No Electron and no Docker on the vending PC.
- No generic sensor framework for V1.
- No cloud remote-unlock capability.
- No direct dual-write to V1 or V2 sales/ownership systems.
- No mutable product-level inventory counter.
- No speculative raw Marshall implementation.
- No automatic command repeat after unknown serial outcome.

## New explicit evidence requirements

- Owner correction that Vault is independent from Speedster and may be built now; retained as a resolved decision, not an evidence gate.
- Actual Nayax kit/SDK/flow/certification and no-sensor vend-result approval.
- Controller protocol, firmware, channel map, electrical/power/thermal/EMI/safety evidence.
- Per-machine city/state/tax-rate review and calculation tests; the manual tax policy and rounding algorithm are now locked.
- Final screen, Windows scaling, assigned access, enclosure, and touch evidence.
- Implement and test the approved fail-closed new-checkout rule during Ten Kings cloud-only loss.
- Implement the approved staff matrix; Admin supplies production support URL/contact values before activation.
- Implement service-life-plus-three-years certification retention and complete invalidation/release-signing evidence; Technician/Admin approval authority is locked.
