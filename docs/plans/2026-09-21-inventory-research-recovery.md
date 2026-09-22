# Inventory research recovery — September 21, 2026

This investigation answers Mark's follow-up about why 92 completed jobs have no estimate, whether new cards repeat that outcome, and how existing inventory can recover. It authorizes no fabricated catalog review, guessed identity/price, synthetic stock, destructive operation or blind bulk rerun. The existing approved delivery authority covers implementation and qualified operational work.

## Why the result is unknown

The research contract requires an exact supplied catalog reference and a distinguishing feature visible in the original photos before any priced selection. The model prompt, server validator and shared legacy-compatible schema enforce this separately from whether a returned listing visually matches. No references means unresolved research identity, an empty selected set and an unknown value. Recognized intake text remains useful descriptive data; the unknown state does not establish that Astra failed to read the card's name.

The active legacy lookup is a read-only SetOps database query. It requires year, manufacturer, set and card number; exact matching card/parallel/scope rows; approved ingestion/draft provenance and reviewed source timestamps. It does not browse for or create a missing reference. Its caught failures also leave references empty. The first aggregate alone did not distinguish missing records, missing input fields, aliases/number mismatch, approval gaps or lookup errors per card.

Twenty of the 92 jobs retained at least two visually matched candidates. That does not establish two independently imaged, condition-correct listings with eligible verified prices. The catalog gate prevented selection regardless; sale/visual evidence remains a separate check afterward.

## New cards and current deployment

Fresh normal Vercel reads at 01:56–01:58 UTC September 22 confirm tenkings.co still serves bc92b102 / dpl_FXLDCapouMhB7WtULnCTb45QXG31 and all five optional catalog-consumer/admin, sale-detail, full-resolution and contribution flags are absent in Production. New jobs therefore use the current V3 default engine with legacy references. The historical 92 results are V2, but both versions retain the same catalog-backed identity requirement. New individual-card intake/save/enqueue works; a new card without a usable reference can still finish research with no value. The UI release did not solve this coverage dependency or rerun historical work.

## Current affected inventory and retry budget

The 02:00:20 UTC read-only audit verified the complete canonical workflow hashes and replay before counting current cards. All **92 complete/unknown jobs are 92 distinct current, on-hand, individually received cards**, with matching latest description/input and no newer research job. They are not stale or cancelled historical duplicates. Eighteen miss at least one legacy lookup field; 74 have all four required fields. Missing fields overlap: year 16, set 8, card number 4 and manufacturer 4.

Ninety currently qualify for the supported Research again action. Two have used both explicit retries; they have not reached nine lifetime attempts. Both have all four required fields, so a missing-field edit is not currently evidenced for either. A genuine description correction still follows the existing new-input path. For an otherwise unchanged exhausted input, the current UI cannot grant a third explicit retry. Recovery needs a supported audited refresh extension tied to a meaningful evidence/engine update, preserving attempt history and bounded work. An actual verified description correction can use the normal new-input path; no ad hoc SQL reset or invented edit is appropriate.

The 99 visible Inventory groups represent 109 current units: 92 unknown individual cards, four failed individual cards, two individual cards without a current job, and one bulk group containing 11 units. Automatic per-card research intentionally excludes that bulk receipt. The broader recovery should also account for the four failed and two unresearched individual cards without conflating them with the 92.

A separate bounded current count confirms the legacy catalog is not globally empty: 72,017 card rows, 6,853 parallels and 43,878 scopes exist. Approved card/parallel/scope joins before exact identity filters total 998,152 rows, which are combinations rather than unique useful references. These counts do not prove coverage for the 92 target cards. The 02:02:22 UTC exact legacy lookup audit then found **zero set-alias hits for all 74 complete descriptions**, before card-number, parallel/scope and approval filters. Thus the immediate cause is missing usable exact catalog bindings under this path, not an empty global catalog. A bounded public-product-label diagnostic covering five frequent product labels (12 jobs) found no close same-year/manufacturer/product-token setId hit, but it does not prove missing catalog data for every card; maker-omitting IDs or other naming differences can evade that diagnostic too. Never use fuzzy similarity as approved identity authority. Map genuine equivalent identities or acquire the missing facts for the actual encountered sets.

## Smallest useful recovery

1. Identify distinct current individual cards and remaining retry budgets; separate genuine description issues, missing catalog coverage, inadequate sold evidence and failed jobs. Preserve all receipts/history and financial fields.
2. Correct only genuinely wrong/missing descriptive fields using existing Edit details & price controls. A genuine change queues its exact new input; do not fabricate edits to escape retry limits or treat typed variant text as catalog authority.
3. Prepare narrow factual catalog coverage for the actual encountered cards/printings, backed by appropriate sources and useful visible diagnostics. Reviewed supported positive evidence in a partial catalog is sufficient; a complete set or image library is unnecessary. A reference image is optional where source-backed text and the saved photos establish the feature. When reused images are needed, their image-use permission, depicted identity and applicability remain separately reviewed. Current sports unknown relationships and Pokémon literal marker recipes must not be represented as useful supported physical-finish evidence merely because they can be published.
4. Qualify and activate the existing shared-catalog consumer against useful approved records. Publishing records without enabling the consumer, or enabling empty catalogs, does not resolve this problem. Qualify sale-detail/image enrichment only for its separately exercised evidence and load effects.
5. Demonstrate one small current-card cohort end to end, then deliberately rerun the other eligible affected inputs in bounded groups. Research again already accepts complete/unknown or failed jobs with fewer than two explicit retries and nine lifetime attempts, binding the exact job/input/description/attempt. Each explicit retry can permit up to three attempts. The current result can update while prior attempt evidence remains retained. Do not bypass limits or overwrite history.
6. Review actual new selections side by side. Report a value only with exact identity, compatible condition and at least two eligible distinct-image sold comparisons. Some rare or unverifiable cards can remain honestly unvalued; neither reference publication nor a retry guarantees 92 prices.

## Source evidence

- `frontend/nextjs-app/lib/server/staffInventoryResearch.ts`: model instructions, validateAnalysis and reference loading.
- `frontend/nextjs-app/lib/server/staffInventoryResearchReferences.ts`: exact legacy lookup and approved-source joins.
- `frontend/nextjs-app/lib/server/staffInventoryResearchCatalog.ts`: positive partial catalog and text-only reference support.
- `frontend/nextjs-app/lib/server/staffInventoryResearchWorker.ts`: feature-gated reference loader.
- `packages/shared/src/staffInventoryResearch.ts`: default V3 and catalog V4 identifiers; compatible identity/result rules.
- `packages/database/src/staffInventoryResearchV2.ts`: retry eligibility, current-result update and immutable attempt history.
- Private read-only receipts: `investigations/20260921-research-unknown-aggregate` and `investigations/20260921-research-recovery-audit` under the existing TenKingsInventory application-support directory.

No provider research, staff decision, catalog publication, activation or business-data mutation was performed for this explanation. Production/source behavior and reusable recovery controls were inspected rather than inferred from tests.
