# Exact-card storage and restock — bounded design audit

Read-only source audit of `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, HEAD `091ecba3`. No live stock, locations, bins, database reads/writes, migrations or deployment. This proposes the requested warehouse extension; it does not claim that extension exists. Holder dimensions, box/divider capacity and printer/scanner choice remain user-supplied.

## Recommended physical model

Use **one permanently identified card holder per fixed, numbered slot**, inside a category bin. Start with S = Sports and P = Pokémon. Example addresses below are illustrations, not proposed real inventory setup.

- Card/holder label: `TKI-<receipt sequence>-<unit ordinal>-<check digit>` (illustrative format), plus QR resolving the exact existing `unit_id`. The final small-label encoding must pass a physical print/scan test. Sequence + receipt ordinal can supply a unique readable alias without a label table. Never use the changing staff group ID, name, card number, category, or “Card 1” alone. Reprinting a damaged label retains the same identity. A replacement sleeve/toploader retains this card label; do not create another card or physical-holder inventory model.
- Bin identity: a stable ID and a readable code such as `S-03`. Slot identity is `(bin_id, slot_number)`, such as `S-03 / 027`. Number fixed pockets, trays, or anchored dividers; never renumber after a pick and never define a slot as the current position in a compressed stack.
- Bin address: existing Location plus optional area/rack/shelf. Moving the same bin to a different shelf changes its address, not every card label. Moving it between Locations also requires actual custody movements for its contents; it cannot silently rebind an existing custody ID.
- Keep location off the permanent card label. Show it in the app and, if useful, on a separate putaway ticket. Category correction never changes the card ID. A bin can keep its category policy until explicitly emptied/reconfigured.

| Physical arrangement | Exact-card finding | Tradeoff |
| --- | --- | --- |
| Fixed numbered single-holder pockets/dividers | Direct bin + slot lookup; gaps stay meaningful | Lower packing density; actual capacity depends on holder width |
| Loose box with unique labels only | Go to box, then search and scan labels until exact unit is found | Cheapest/densest; no reliable ordinal address or constant pick time |
| Small numbered compartments containing several holders | Finds a small group, then requires exact-label scan | Intermediate density, but it does not meet one-holder-per-slot behavior |

Ten identical cards have ten unit labels and ten slots. Search may group them visually, but the approved pick list specifies the exact labels. A same-looking card with a different unit ID is not an automatic substitute: its acquisition cost, grade/link, condition or reservation may differ.

## Operator flow

1. **Intake:** retain photos/OCR and manual cost/price. Propose the first free compatible slot in the current location/category/holder format. This is a read proposal, not proof of storage. On accepted Save, atomically create the unit and claim a still-free slot, returning its label and authoritative assignment with the receipt. Two staff can see the same suggestion; only one may claim it. The losing save preserves its draft and offers a new slot. Exact retry returns the original accepted unit/claim, not a new allocation.
2. **Putaway:** attach/read the unit label, scan the target bin/slot, and confirm placement. Only then mark it stored and pickable. A claim consumes capacity but does not assert the card is physically in the bin. Printer failure leaves saved inventory in a visible Needs label/putaway state; never repeat the receipt. Continuous capture requires an identified staging position or immediate labeling, so loose unlabeled cards cannot silently accumulate. Do not assume silent printing from an iPhone.
3. **Restock approval:** a proposed quantity/mix has no stock lock. Approval creates a stable plan ID/revision with exact unit IDs and explicit existing destination(s). Atomically exclude units already allocated to another active plan, on hold, not put away, or not actually held. Machine-bound stock must satisfy existing packing/product rules before dispatch/loading. Planned sales channel remains descriptive; it is not a reservation, address or sale.
4. **Pick list:** one section/tote per destination, sorted by physical source address. Each line shows bin/slot, immutable unit label, small photo/description, pack reference when present, and verification state. Remove-and-scan source slot + exact holder, then scan the destination tote. Persist progress after each verified line. A correct-looking but wrong-ID card, a duplicate scan, wrong tote, stale plan or stale placement does not advance the line. Release the source slot only after confirmed removal, not on approval or printing.
5. **Dispatch and receipt:** picking moves the card into a staging/tote position at the same HQ; it does not mean delivered. Dispatch records named transit custody. Destination receipt records actual arrival. Reuse `custody_moved` for store/kiosk/HQ receipt and `batch_loaded` for explicit machine/product/door delivery. Packing, approval, custody, actual sales and financial actuals remain separate.

## What the source already has

- `packages/database/src/staffInventoryV2.ts:51` creates `staff:<request UUID>:card:0001…` roster IDs. Identical cards already have separate IDs; cost and optional permanent-card links follow those IDs.
- `staffInventoryV2Read.ts:9` groups on lot, description, custody, stage, product, batch and price, and hashes that changing group as `item.id`. Its per-unit `number` is only the ordinal in that receipt. Neither is a standalone permanent label.
- `inventoryWorkflowV2State.ts:6` already derives unit custody, stage, pack, permanent-card link, reservation, possession and physical-state event. `:203` moves held units; `:222` loads an exact product/batch. Machine loading intentionally changes possession to `batch_identity_uncertain`: exact labels at loading do not prove which card later sold or remains.
- `cardPlatformV2.ts:1777` and `:1842` are the sole transactional writers, with shared PostgreSQL advisory locks, complete replay, actor-bound command hashes, exact retry and atomic composed staff saves.
- `lib/server/labels.ts` has PDFKit/QR rendering and a current 89×28 mm legacy template. Reuse rendering primitives after testing the chosen media, not the template dimensions as a hardware assumption.

## Gaps that must be implemented coherently

| Gap | Required contract |
| --- | --- |
| Bin/slot definition | Stable bin ID, existing Location, display code, actual slot count, category/holder-format policy, address, active/blocked state and configuration revision. No stored occupancy counter. |
| Physical placement | Unit → exact slot, claim versus confirmed putaway, expected previous placement/event, relocation/pick/release evidence. At most one active unit/claim per capacity-one slot and one active placement per unit. |
| Approved restock | Stable plan/revision, authenticated approval, exact unit/destination roster, cancellation/supersession, exclusive active allocations and persisted per-line pick/receipt evidence. |
| Label/scan reads | Authenticated exact-unit lookup, strict versioned unit/bin/tote token kinds and idempotent print/reprint. The current staff Save returns only request/outcome; it needs exact accepted unit/assignment references. |
| Concurrency | Validate current physical state, placement revision AND allocation revision under the writer lock. `state_event_id` alone is insufficient because reservation does not advance it. |

The existing `reserved` event (`inventoryWorkflowV2State.ts:210`) simply overwrites a destination. `available()` at `:43` checks only recorded possession/no machine batch, and existing moves do not enforce a reservation owner. It is therefore not yet an exclusive restock lock. New approval/allocation rules must also constrain the existing manual move, reservation, packing/correction and cancellation paths so an advanced route cannot bypass a plan.

The Prisma schema has no warehouse bin, storage slot or approved pick-plan model. `LocationRestock` (`schema.prisma:1645`) records counts/photo/notes, not a plan. Legacy `PackSlot` is pack membership, and `HumanGradeLabel.slot` is a position on a printing sheet. Neither is warehouse storage.

Legacy `QrCode`/`PackLabel` (`schema.prisma:2392/2420`) and packing scan routes bind/update V1 `Item`/`PackInstance` and public claim/kiosk URLs. Do not use them to create staff inventory labels. `normalizeQrInput` is permissive legacy token extraction; new operational scans need exact domain/type validation. The inspected staff/packing code has text scan entry but no established browser QR decoder; phone QR scanning is a bounded implementation/acceptance item, not already supplied by the photo camera.

## Smallest implementation path

Prefer extending the current typed workflow journal/replay with bounded bin-definition, placement and approved-plan/scan evidence; derive layout/occupancy/allocations as maps. A separate inventory, holder, counter, pick-line or label database is not required for the first controlled location. Fixed slots can be derived from the configured bin ID and slot range. If a reference table is later warranted, store bin configuration only and keep one stock authority; do not duplicate unit holdings. The existing journal envelope does not inherently require a SQL migration for additive event kinds, but all source/read/guard and consumer behavior must be reviewed and tested.

First ship unit labels + confirmed fixed-slot putaway. Then add approval + exclusive allocation + persisted scan picking, composing the existing custody/loading writer for dispatch/receipt. This is one small operational flow, not a second commerce/warehouse platform. No routing optimizer, replenishment forecasting, RFID, automatic vend identity or public card-claim behavior is needed.

Before new source events are emitted, update the canonical blueprint for this user-requested warehouse scope and the strict independent Financial Story parser/replay. Operational placement/approval must not create purchases, sales, cash or inventory valuation changes. Existing event bytes/hashes remain unchanged. Prove realistic 2,000-unit receipts and the current 30-second/10-MiB workspace limits; avoid treating unbounded full-history replay as a scalable indexed slot query without measurement.

## Exceptions and pilot acceptance

- Full/mismatched-format bin: offer another real compatible slot or explicit identified staging; never overfill or invent bins. Claimed/stored slots do not silently expire. Only a confirmed empty unused claim may be released automatically by a deliberate cancellation.
- Wrong/missing/damaged card: pause that line and mark an operational hold. Do not silently substitute, remove inventory, recognize loss, or mark a sale. The current journal excludes generic loss/shrinkage; any accounting adjustment needs its own sourced contract.
- Plan cancelled after picking: clear the allocation only with scan-confirmed return/putaway or an explicit reviewed reassignment. Do not pretend picked units returned to their former slots.
- Partial delivery: record only scanned received units; keep the remainder in named transit/staging. Retry/double scan must preserve the same result.
- Existing stock without trustworthy labels: verify and label each exact physical unit before slotting. Do not assign physical positions to a historical ambiguous machine roster or mint replacement purchases.

Pilot with one real configured bin of each needed category/holder format, ten identical cards with separate labels, two staff racing for the last free slot, wrong/duplicate scans, a missing-card exception, printer failure, interrupted putaway/picking and a partial receipt. Hardware/box dimensions determine slot counts and label layout only; they do not change the identity/custody separation above.
