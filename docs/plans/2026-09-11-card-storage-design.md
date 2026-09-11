# A simple system for finding and picking the exact card

Give every card holder a permanent Ten Kings inventory label. Store each holder in a fixed numbered position, for example **S03–047**: Sports bin 03, slot 047. Pokémon bins use P. Removing a card leaves an empty slot; the other positions never shift.

The holder label identifies **which card**. The address identifies **where it is now**. Moving a card changes its recorded address, not its label. Moving an entire bin to a different shelf changes the bin’s address, not every card label. A replacement holder or damaged label receives the same card identity. The system already has immutable unit IDs, including separate IDs for ten identical cards; it needs to expose them as usable labels and scans.

## The physical choice

| Choice | What staff can do | Tradeoff |
| --- | --- | --- |
| Fixed single-holder pockets or anchored dividers | Go directly to S03–047 and scan the exact card | Most reliable; capacity depends on holder width |
| Loose labeled cards in a box | Go to S03, then search/scan within the box | Cheaper and denser, but cannot promise exact position |

I recommend fixed positions for the requested exact-card picking. Do not label the “47th card in the stack” as slot 047: removing another card would make the address wrong. Actual boxes, holder dimensions and dividers determine capacity. Register the real bins and slot counts after that equipment is confirmed; no guessed capacity or stock is needed now.

## Fast intake and putaway

Keep the working photo/OCR and cost entry. The app proposes a free compatible slot at the current location. Save atomically claims it and returns the permanent card label and confirmed address. Two people may see the same suggestion, but only one can claim that slot.

Printing and physical handling need one explicit choice after hardware is known:

- **Immediate label and putaway:** attach the label, scan the holder and slot, then put it away.
- **Rapid capture with later putaway:** keep each saved card in its own numbered intake-tray position; print/attach labels and scan putaway from that queue. Never accumulate an unlabeled loose pile whose order is the only identity.

A printer failure leaves the saved card waiting for its label; it must not create another inventory entry. A claimed slot is reserved capacity, but the card is not shown as physically stored/pickable until putaway is confirmed. Do not assume an iPhone can print silently.

## Faster option: print holder labels ahead of time

For sustained phone intake, the strongest speed option to prototype is a roll or sheet of preprinted unique holder labels. Print them ahead of the session, attach one to the sleeve, and read its QR as part of intake. This avoids a printer dialog for every card. The label starts unused; it does not create inventory until a confirmed save atomically binds it to exactly one existing workflow unit. The permanent unit ID remains the business identity; the printed token is a unique, immutable alias.

Use exact barcode decoding and issued-token validation, not OCR/Astra guesses or the next number on a roll. A duplicate claim must fail clearly. Bind the decoded label to the same persisted front/back draft and exact retry request. Matching holder tokens visible in both frames can verify that token across the pair; otherwise an explicit operator confirmation is required and the system must not claim automatic back-photo linkage. A damaged label can be reprinted for the same unit. Labels must remain outside the visible card face.

This is an optional implementation path, pending actual equipment and label-layout testing. On-demand labels are simpler to derive directly from the saved unit but introduce printer handling; a mapped, numbered intake tray is the fallback when labeling is deferred. No label token, binding or warehouse event has been implemented or issued in this release.

## Approved restocking

A proposed restock has no inventory lock. Approval assigns exact card IDs to an identified destination and reserves those units exclusively. Staff receive a pick list grouped by destination and ordered by source bin/slot, with the holder code and thumbnail on each line.

Pick and scan the exact holder from its source slot into that destination’s tote. A different copy of the same card does not count. Duplicate scans, wrong cards/totes and stale plans fail clearly. Picking frees the original slot only after confirmed removal. Dispatch and destination receipt are separate steps; receiving fewer cards leaves the remainder in transit rather than pretending the delivery is complete.

## Small implementation scope

1. **Labels and storage:** permanent unit labels, actual bin configuration, free-slot proposals, atomic claims, scan-confirmed putaway, relocation and clear Needs label/putaway queues.
2. **Approval and picking:** exact-unit restock plans with revisions, exclusive allocations, per-destination pick lists, persisted scan progress, cancellation and exceptions.
3. **Delivery:** compose the existing custody and machine-loading events for dispatch/receipt; preserve actual destination/product/door evidence.

Reuse the current inventory unit IDs, staff authentication, single transactional writer, immutable journal and PDF/QR rendering primitives. Do not create another card or inventory-counter system. The smallest source design can add typed bin/placement/plan events to the existing journal and derive occupancy; fixed slots do not require a row per slot. This is a proposed design, not functionality already present.

The important existing gaps are real: planned moves currently overwrite a destination and do not provide an exclusive plan lock; there is no bin/slot or approved pick-plan contract; current legacy label APIs write V1 cards/packs and are unsuitable for these units. New event types require a matching Financial Story reader before release. The separately shipping planned sales channel remains a preference, not physical custody, an approved restock or a sale.

For missing/damaged cards, pause the pick and hold that unit for review—never silently substitute, invent a sale/loss or create a replacement purchase. A cancelled pick requires an actual return/putaway step. Machine loading history still cannot establish which individual card later sold without additional physical evidence.

First physical acceptance should cover ten identical cards, two staff competing for one free slot, a wrong/duplicate scan, interrupted printing/putaway, and a partial delivery. Hardware answers affect label layout, slot count and intake handling; they do not change the identity/address design.

*Read-only audit: release checkout HEAD 091ecba3; no warehouse implementation, live stock/bin setup or migration. Detailed source references: [audit note](/Users/markthomas/tenkings/codex-staff-inventory-release-20260910/docs/plans/2026-09-11-card-storage-audit.md).*
