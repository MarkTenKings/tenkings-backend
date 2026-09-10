# V2 acquisition-cost assignment preview

## Authority and plan

Mark's September 8, 2026 continuation establishes two acquisition cases: individual cards with documented purchase prices and bulk purchases of approximately 500–2,000 cards with one paid total. A bulk total must be retained before the per-card cost is assigned. Allocation choices must be explicit; valuation, intended selling price, expected margin and observed sales do not determine acquisition cost. The coordinating plan is the financial repository's `docs/plans/2026-09-08-inventory-completion.md`.

This bounded implementation adds a pure, validated preview in `packages/database/src/cardAcquisitionCostV2.ts` and focused tests. It does not capture an actual purchase, create a card identity, write inventory or ownership, change the schema, export source events, introduce a V1-to-V2 migration, or activate any service. The existing sole source writer remains `cardPlatformV2.ts`. The September 7 source still begins with completed permanent V2 cards; admitting purchased stock before grading needs the separately coordinated writer/schema extension.

Implementation sequence:

1. Define a strict USD lot contract containing stable lot/acquisition identities, positive quantity, exact nonnegative safe-integer total cents and purchase evidence. Accept only caller-supplied exact unit identities; do not derive them from images, names or position in an array.
2. Require an explicit assignment method and basis. `unassigned` preserves unknown unit costs. `documented_unit` retains individually documented amounts. `equal_card` and `explicit_per_card` remain labelled `allocated_acquisition` and require their assignment evidence.
3. Require the complete unique unit roster for any known-cost assignment. An unassigned purchase may have a partial or empty roster. Reject duplicate, excess, missing or unrelated unit assignments, unsafe numbers and any allocation that does not conserve the full documented total. This initial preview does not accept partial known-cost allocation.
4. For explicitly selected equal allocation, divide integer cents using `BigInt`. Assign each residual cent once, to the first units in ascending exact JavaScript UTF-16 code-unit order (`ascending_unit_id_utf16_v1`), independent of caller array order or machine locale. Record the algorithm version and residual rule in the preview. Never select this method automatically.
5. Return exact inventory-compatible acquisition components plus aggregate assigned/unassigned totals. Preserve unknown versus documented zero. Carry optional intended selling price in a separate nullable field; it is never a cost input or evidence of realized revenue.
6. Build with the existing TypeScript tooling under Node 20 and run focused tests for individual and bulk purchases, cents conservation, stable residual identities, unknowns, zero, malformed/missing evidence, duplicate/overassignment, overflow, strict input validation and price independence. Do not install dependencies or access real data/services.

## Integration boundary

The preview verifies the shape and arithmetic of supplied evidence, not its authenticity or whether a purchase was paid. It has no database, clock, environment, network, recording actor or side effects. Stable unit IDs are supplied authority, not IDs minted or validated against stored cards by this module.

A later sole-writer integration must bind the exact purchase and authoritative unit roster, reject repeated or concurrent allocation of the same acquisition, persist the method/version/evidence with the accepted amounts, and preserve an append-only correction history. Re-running this pure function does not reserve stock or authorize rewriting already accepted acquisition components. Intended price needs separate lifecycle/persistence rules. Aggregate machine/product sales and loading-batch sell-through are outside this assignment preview; it never selects sold cards or introduces FIFO.

Shared blueprint/handoff/session-log updates are owned by the coordinating agent to avoid concurrent document edits. This new specification recorded the plan before code.

## Implemented interface

`previewCardAcquisitionCostV2(value: unknown): CardAcquisitionCostPreviewV2` performs strict input validation and returns a detached deterministic preview. `CardAcquisitionCostAssignmentInputV2` exposes the same complete schema, including roster and total-conservation checks; invalid input throws `CardAcquisitionCostErrorV2` with code `INVALID_INPUT`. Input/output types and the unit-limit and residual-rule constants are exported from this module. The package index has deliberately not been changed in this bounded task.

Input is exactly:

- `schema_version: 1` for this preview format, not an inventory event page.
- `lot`: `lot_id`, `acquisition_cycle_id`, `acquisition_event_id`, `quantity`, `total_cost_cents`, `currency: USD`, `evidence_ref`, and nullable `purchase_ledger_line_id`. These fields are all required; the lot total must be documented, including when it is zero.
- `units`: records containing `unit_id` and optional nullable `intended_sale_price_cents`. An omitted intended price returns null. A supplied zero remains zero. Identities are exact, unique, limited to 200 characters, and are never silently trimmed or derived from media.
- `assignment`, using one of the following explicit contracts:

| Method | Required basis | Other required fields | Cost treatment |
| --- | --- | --- | --- |
| `unassigned` | `unknown` | `unknown_reason` | No per-unit amount assigned, including for a zero-total lot; partial or absent roster allowed |
| `documented_unit` | `documented_unit` | `costs`, with one `unit_id`, `cost_cents`, `evidence_ref` per unit | Preserve each individually documented amount; all amounts must sum to the purchase total |
| `equal_card` | `allocated_acquisition` | `evidence_ref` for the explicit allocation selection/calculation | Integer division plus stable residual cents, over the complete roster |
| `explicit_per_card` | `allocated_acquisition` | `evidence_ref` and `costs`, with one `unit_id` and `cost_cents` per unit | Preserve each chosen allocation; all amounts must sum to the purchase total |

Known-cost methods require every unit in the purchase. There is no automatic remainder redistribution, partial known allocation or fallback method. This intentionally prevents allocating an entire bulk total only to the cards already processed. For a line-item-priced purchase, `documented_unit` can retain differing individually documented prices on a complete invoice roster; a single purchased card is the quantity-one case.

The preview is explicitly marked `preview_only: true`. It retains the purchase evidence, chosen method/basis, version (`unassigned_v1`, `documented_unit_v1`, `equal_card_v1`, or `explicit_per_card_v1`), allocation evidence, unknown reason and the exact residual-cent recipient IDs. Unit rows contain a separate intended selling price and an inventory-compatible component with quantity one. Known unit evidence points to the individual purchase line or supplied allocation evidence; unknown unit evidence points to the documented lot total and retains the reason no unit cost is assigned.

Totals separately report purchase, represented/unrepresented and assigned/unassigned quantities, plus purchase, assigned and unassigned cents. Unassigned cents are the documented purchase total awaiting assignment; they are not a known cost for any individual unit or selected subset. Known amounts are integer cents up to `Number.MAX_SAFE_INTEGER`; sums and division use `BigInt`. Purchase quantity and roster/cost arrays are bounded to 10,000. USD only is accepted. Evidence and reasons are nonblank exact strings up to 2,000 characters. Unknown fields, floating-point/coerced money, invalid identities, missing basis/evidence, duplicate/excess/unrelated assignments, incomplete known rosters and both over- and under-assigned totals fail validation.

The eventual writer must persist an immutable allocation record identifying the exact source lot, complete roster, chosen method/version, amounts and supporting purchase/allocation evidence before those components are treated as accepted acquisition evidence. The pure preview itself does not create that authority. A component's supplied allocation reference must resolve to the corresponding accepted calculation; merely possessing this preview is not a paid-purchase or financial-reconciliation claim.

## Validation and handoff

Executed with existing tools under Node `20.20.1` in the isolated platform worktree:

```text
PATH=/opt/homebrew/opt/node@20/bin:$PATH pnpm --filter @tenkings/database build
/opt/homebrew/opt/node@20/bin/node --test packages/database/tests/cardAcquisitionCostV2.test.js
```

The database TypeScript build passes and the new focused suite passes **18/18**. Tests cover individual and line-item costs; partial/empty unknown rosters; unknown versus explicit zero; stable residual identity under reordered inputs; exact UTF-16 rather than locale/numeric sorting; 500- and 2,000-card totals; maximum-safe-cent arithmetic; conservation across 240 additional quantity/amount combinations; unequal explicit allocations; component compatibility; required method/basis/evidence; duplicate/excess/missing/unrelated assignments; total under/over-assignment and summed overflow; invalid/coerced numbers; intended-price independence; strict unknown-field rejection; deterministic replay; and input immutability/detached output. These are in-memory test facts, not real acquisition entries or a full database regression claim.

Scoped self-review confirms one source writer remains unchanged, no default allocation policy, no cost derived from valuation/price, no invented unit identity, no actual purchase capture, and no new mutation path. Only this specification, the pure module and its focused test file were added. No dependency installation, database access, live API/service request, schema change, deploy, restart, commit or push occurred. The coordinating agent owns the subsequent blueprint/session/handoff update and writer/UI integration.
