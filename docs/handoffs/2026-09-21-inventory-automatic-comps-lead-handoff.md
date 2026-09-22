# Fresh ASTRA ULTRA Inventory lead — automatic comps correction

Owner direction: **Every card must automatically get eBay research and comp retrieval. Staff review exceptions and correct mistakes; they do not research each card manually. Missing internal catalog records must not block searches.** Apply this to existing and future cards. Mark requested a fresh lead with short context; `/root/inventory_lead_ultra` was started as `gpt-6-astra`, effort `ultra`, without inherited conversation history. It owns implementation and verification. Phone and website acceptance are already complete.

## Where to work

- Authoritative checkout: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, branch `codex/staff-inventory-release-20260910`, pre-handoff HEAD `9f90d50cc0ac5b2cf98dd0725392ec1d493eba1b`.
- Main release sibling: `/Users/markthomas/tenkings/codex-main-site-release-20260916`, sparse branch `codex/main-site-release-20260916`. Use exact Git-connected deployment; never source-upload the sparse checkout.
- Default attached worktree `3a02` is unrelated ATLAS, not Inventory authority. Preserve the untracked `docs/plans/2026-09-10-atlas-staff-intake-reuse-update.md`.
- Required project docs and full approved blueprint still apply. The newest owner correction is appended to that blueprint. Earlier handoff files contain superseded deployment and phone-acceptance states.

## Verified problem

The original 92 current completed jobs have no qualified estimate and no selected comps. They nevertheless retain 1,500 returned listing candidates from earlier searches. Those candidates are not all correct matches or verified prices. Recovery assessed 98 individual cards, but made **zero new sold-search attempts** and produced **zero new estimates**. Its source finder retrieves possible catalog links, not usable checklist facts.

Two different gates are involved:

1. Recovery requires an approved catalog reference and diagnostic before it queues research. With recovery enabled, this also blocks newly queued first searches. See `staffInventoryResearchRecoveryIdentity.ts`, the shared recovery schema, `staffInventoryResearchRecoveryV2.ts`, and `staffInventoryResearchV2.ts`.
2. The research engine/shared result schema separately require published catalog identity before selecting comps for a value. The engine already can fetch and retain candidates without a catalog entry. Do not confuse search eligibility with value eligibility or simply remove every price/match check.

Start with automatic candidate retrieval independent of internal catalog coverage; retain real evidence and clearly label uncertainty. Inspect the separate private matching/value path, sold-price detail integration, and UI handling of failed/partial research. No invented catalog records or seller-title-only identity proof. Preserve wrong-card/printing/grade checks, unknown Best Offer prices, distinct-image evidence, arithmetic mean of selected verified prices, staff corrections, history, bounded work and intake responsiveness. Show actual useful comp outcomes before declaring recovery complete.

## Live state and coordination

Production source `9e8a9c1d99cce0b4b8a4a5dbde241fc916cdb439`, deployment `dpl_6GK1WtpAY19dBQh5csQbZCR6qP8B`; main website and Inventory are live. `STAFF_INVENTORY_RESEARCH_RECOVERY_ENABLED=true`; optional catalog, sale-detail and full-resolution integrations remain off. One existing minute cron owns research. Live DB has 99 active migrations and 13 retained rolled-back entries. No migration or deployment accompanies this handoff.

ATLAS task `01a0c70b-0130-7d70-8d8c-610000b78a06` currently holds shared host/schema/grant/lifecycle mutations during its own cutover. Normal Inventory cron writes and bounded read-only audits are allowed. Root promised no Inventory release during the cutover; wait for its explicit release. Do not deploy ATLAS or edit its checkout.

Private evidence root: `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations`. Current audits are `20260921-recovery-outcome-audit`; deployment tools/receipts are `20260921-recovery-source-fix-release` and `20260921-recovery-source-fix-qualification`. The prior lifecycle agent is preparing a bounded Eddy Curry read-only audit in `20260921-eddy-comp-diagnosis`; its screenshot may represent one of four failed jobs rather than one of the 92 completed jobs, so verify before claiming.

Communicate plainly and briefly. The owner does not need another report of passing tests while cards still have no usable comps. Preserve actual evidence and be clear about what is built, live, and still unproven.
