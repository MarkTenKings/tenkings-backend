# Task 17b Analysis

Date: `2026-03-31`
Branch: `main`
HEAD at analysis start: `0f78d42`

## 1. What `loadVariantOptionPool().scopedSetIds` actually contains

Code path:
- `frontend/nextjs-app/lib/server/variantOptionPool.ts:706-824`
- `frontend/nextjs-app/lib/server/variantSetScope.ts:1-160`

Finding:
- `scopedSetIds` are product-line set ID strings, not `SetTaxonomySource.id` UUIDs.
- The scope path is:
  - approved/reviewable `SetDraft.setId`
  - narrowed through `resolveVariantSetIdsForScope(...)`
  - filtered by year/manufacturer/sport identity
  - returned as `scopedSetIds`
- `selectedSetId` is also in that same string set-ID domain.

DB-backed sample from `loadVariantOptionPool({ year: "2025-26", manufacturer: "Topps", sport: "Basketball" })`:

```json
{
  "selectedSetId": null,
  "scopedSetIds": [
    "2025-26 Topps Basketball",
    "2025-26_Topps_Basketball",
    "2025-26_Topps_Chrome_Basketball",
    "2025-26_Topps_Chrome_Basketball_Sapphire",
    "2025-26_Topps_Finest_Basketball",
    "2025-26_Topps_Holiday_Basketball",
    "2025-26_Topps_Midnight_Basketball",
    "2025-26_Topps_Three_Basketball"
  ],
  "approvedSetCount": 229,
  "variantCount": 5000
}
```

Conclusion:
- The Task 17b prompt's `SetTaxonomySource.id` mismatch theory is not correct in this repo.
- `identifySetByCardIdentity()` is already querying `SetCard.setId` with the right ID domain.

## 2. What `SetCard.setId` actually contains

Schema trace:
- `packages/database/prisma/schema.prisma:820-838`

Relevant schema facts:
- `SetCard.setId` is a string product-line key.
- `SetCard` relates to `SetProgram` on `[setId, programId]`.
- `SetCard.sourceId` is the nullable FK to `SetTaxonomySource.id`.
- `SetCard` does **not** use `SetTaxonomySource.id` as its `setId`.

```prisma
model SetCard {
  setId      String
  programId  String
  cardNumber String
  sourceId   String?

  program SetProgram @relation(fields: [setId, programId], references: [setId, programId], onDelete: Cascade)
  source  SetTaxonomySource? @relation(fields: [sourceId], references: [id], onDelete: SetNull)

  @@unique([setId, programId, cardNumber])
}
```

Runtime evidence from the current DB:

```json
{
  "setDraftCount": 242,
  "setProgramCount": 4027,
  "setCardCount": 0,
  "sourceCount": 1120
}
```

Implication:
- Production-style data currently has `SetProgram` and `SetTaxonomySource` rows, but **zero `SetCard` rows**.
- Any Task 17 logic that depends only on `prisma.setCard.findMany(...)` will fail for every card, regardless of ID mapping.

## 3. How `resolveScopedSetCard()` bridges the working path

Working code:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:775-926`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:929-1115`

Actual working pattern:
1. Build `candidateSetIds` from `loadVariantOptionPool(...)`.
2. Query `SetCard` with `setId in candidateSetIds` and `cardNumber`.
3. If `SetCard` has no rows, fall back to `resolveScopedLegacyVariantCard(...)`.
4. `resolveScopedLegacyVariantCard(...)` queries `CardVariant.groupBy({ by: ["setId", "programId", "cardNumber"] ... })` in the **same set-ID domain**.
5. It scores rows using:
   - `selectedSetId`
   - OCR insert/program hint
   - OCR set-name hint
   - row frequency
6. The calling resolver returns either:
   - taxonomy-backed set-card match, or
   - legacy variant match, or
   - `none`

This is the key gap in Task 17:
- `frontend/nextjs-app/lib/server/cardSetIdentification.ts:278-340` loads `candidateSetIds` correctly, but if `SetCard` returns zero rows it immediately returns `reason: "card_number_not_found_in_scope"`.
- It never executes the legacy `CardVariant` fallback that the existing OCR path depends on.

Live confirmation of the failure mode:
- Running `identifySetByCardIdentity(...)` for `TC-HG / Hugo Gonzalez / 2025-26 Topps Basketball` returns:
  - `confidence: "none"`
  - `reason: "card_number_not_found_in_scope"`
- That is consistent with `SetCard` row count `0`.

## 4. Fix plan for `identifySetByCardIdentity()`

Plan:
1. Keep the existing `SetCard` path intact for future taxonomy-backed checklist data.
2. Add a legacy fallback inside `frontend/nextjs-app/lib/server/cardSetIdentification.ts` that mirrors `resolveScopedLegacyVariantCard(...)`.
3. Trigger that fallback when:
   - `SetCard` has zero rows, or
   - `SetCard` rows exist but player-name scoring produces no winning set.
4. Use the fallback only as a compatibility path:
   - matched legacy result => return exact/fuzzy-compatible identify-set candidate
   - ambiguous legacy result => keep `confidence: "none"` so UI fallbacks/manual override can take over
5. Keep set IDs human-readable in results:
   - `setId` and `setName` should stay in the product-line string domain
   - do not swap to `SetTaxonomySource.id`

Important nuance from live data:
- Example legacy `CardVariant` rows for the failing cards are present even though `SetCard` is empty:

```json
[
  { "setId": "2025-26 Topps Basketball", "programId": "1980-81-topps-chrome-basketball", "cardNumber": "TC-HG" },
  { "setId": "2025-26_Topps_Basketball", "programId": "1980-81-topps-chrome-basketball", "cardNumber": "TC-HG" },
  { "setId": "2025-26 Topps Basketball", "programId": "new-school", "cardNumber": "NS-27" },
  { "setId": "2025-26_Topps_Basketball", "programId": "new-school", "cardNumber": "NS-27" },
  { "setId": "2025-26_Topps_Midnight_Basketball", "programId": "night-shade", "cardNumber": "NS-27" }
]
```

That confirms the fallback must query `CardVariant`, not only `SetCard`.

## 5. Deleted fallback paths to restore in `uploads.tsx`

Current Task 17 regression points:

### Product Set auto-selection effect
- Current location: `frontend/nextjs-app/pages/admin/uploads.tsx:2480-2513`
- Current behavior: only accepts `identifiedSetMatch`
- Restore:
  - keep identify-set as primary
  - if identify-set is `none`, fall back to:
    - existing valid current value
    - `variantScopeSummary?.selectedSetId`
    - single-option auto-pick
    - `intakeSuggested.setName` via `pickBestCandidate(...)`

### OCR applySuggestions productLine constraint
- Current location: `frontend/nextjs-app/pages/admin/uploads.tsx:2691-2815`
- Restore the removed `constrainedProductLine` block before insert/parallel constraint handling so OCR can still suggest a scoped product line.

### Screen 2 prefetch trigger
- Current location: `frontend/nextjs-app/pages/admin/uploads.tsx:3181-3200`
- Current behavior: gates only on `intakeOptional.productLine`
- Restore the old dual-trigger behavior:
  - `intakeOptional.productLine`
  - or `variantScopeSummary?.selectedSetId`

## Additional note: front-card OCR text is already available

Current Screen 1 state already surfaces the tie-break text needed by Task 17:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3901-3966`

It derives:
- `identifiedFrontCardText` from `typedOcrAudit.photoOcr.FRONT.ocrText`
- `identifiedCombinedOcrText` from `FRONT + BACK + TILT`
- and already sends both to `POST /api/admin/cards/identify-set`

So Task 17b does **not** need any OCR pipeline or state-shaping work.
