# Task 17 Analysis: Cross-Set Card Identification

Date: `2026-03-31`
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch on entry: `main`
HEAD on entry: `891e0bc`

## 1. Actual Prisma model and field names for set checklists

The active taxonomy/checklist models are in [schema.prisma](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/packages/database/prisma/schema.prisma#L768):

- `SetTaxonomySource`
  - primary source record for a set import/checklist source
  - key fields: `id`, `setId`, `ingestionJobId`, `artifactType`, `sourceKind`, `sourceLabel`, `sourceUrl`
- `SetProgram`
  - program/insert grouping within a set
  - key fields: `setId`, `programId`, `label`
- `SetCard`
  - this is the checklist row model that matters for Task 17
  - key fields: `setId`, `programId`, `cardNumber`, `playerName`, `team`, `sourceId`
  - current indexes/constraints:
    - `@@unique([setId, programId, cardNumber])`
    - `@@index([setId, cardNumber])`

Relevant schema lines:
- [SetTaxonomySource](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/packages/database/prisma/schema.prisma#L768)
- [SetProgram](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/packages/database/prisma/schema.prisma#L799)
- [SetCard](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/packages/database/prisma/schema.prisma#L820)

## 2. Current Product Set resolution code location

There are two relevant layers.

Frontend Screen 1 auto-selection:
- [uploads.tsx:2442](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx#L2442)
  - `useEffect(...)` auto-populates `intakeOptional.productLine`
  - priority today is:
    1. `variantScopeSummary.selectedSetId`
    2. single-option scope
    3. `intakeSuggested.setName`
- [uploads.tsx:2669](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx#L2669)
  - `applySuggestions(...)` applies OCR suggestions into Screen 1 state, including `setName -> productLine`
- [uploads.tsx:2920](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx#L2920)
  - `fetchOcrSuggestions(...)` calls `/api/admin/cards/[cardId]/ocr-suggest`
- [uploads.tsx:3698](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx#L3698)
  - separate `useEffect(...)` calls `/api/admin/variants/options` and sets `variantScopeSummary.selectedSetId`

Backend set-card resolution inside OCR:
- [ocr-suggest.ts:929](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts#L929)
  - `resolveScopedSetCard(...)`
  - this already queries `SetCard`, but only within the scope returned by `loadVariantOptionPool(...)`
- [ocr-suggest.ts:3337](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts#L3337)
  - resolver is invoked and, if matched, writes back `fields.setName`

Current failure mode:
- the frontend still relies on `/api/admin/variants/options` scope narrowing from year/manufacturer/sport
- the backend resolver searches by `cardNumber`, but its tie-breaking is weak when multiple sets share the same card number and the OCR player-name normalization is imperfect
- there is no explicit Chrome/Optic tiebreaker today

## 3. Whether front-of-card OCR text is already available in state

Yes, it is already available.

Backend:
- [ocr-suggest.ts:3297](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts#L3297)
  - `photoTexts.FRONT`, `photoTexts.BACK`, `photoTexts.TILT` are already assembled during OCR processing
- [ocr-suggest.ts:3520](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts#L3520)
  - the audit payload persisted to `ocrSuggestionJson` includes `photoOcr`
- [ocr-suggest.ts:3533](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts#L3533)
  - the combined OCR text is stored as `ocrText`

Frontend:
- [uploads.tsx:3022](/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx#L3022)
  - `fetchOcrSuggestions(...)` stores the full `audit` object in `ocrAudit`
- `ocrAudit.photoOcr.FRONT.ocrText` is therefore already available in state after OCR completes
- `ocrAudit.ocrText` also contains the combined text

Conclusion:
- no OCR pipeline change is needed
- no new UI state is strictly required if the tiebreaker runs in the backend

## 4. Query plan for cross-set lookup

Recommended plan:

1. Keep the candidate set pool constrained by existing year/manufacturer/sport logic instead of scanning the entire taxonomy.
2. Replace the current scoped set-card scoring with a cross-set identity lookup that treats `cardNumber + normalizedPlayerName` as the primary key.
3. Query `SetCard` once for all candidate sets using:
   - `setId IN candidateSetIds`
   - exact `cardNumber`
   - published-source filter already used by `publishedTaxonomyWhereInput()`
4. Score or filter the returned rows in memory using normalized player name, then apply the Chrome/Optic tiebreaker using front OCR text.
5. Return:
   - chosen set
   - confidence/result reason
   - all candidates for UI fallback/debugging

Performance expectation:
- this should be performant because the query is still highly selective on `setId + cardNumber`
- `SetCard` already has `@@index([setId, cardNumber])`, which fits this access pattern
- candidate set count for a single `year + manufacturer + sport` slice should be modest relative to total taxonomy size
- fuzzy player-name comparison can stay in memory because the result set after exact `cardNumber` filtering should be small

Likely implementation shape:
- factor the resolver into a reusable helper under `frontend/nextjs-app/lib/server/`
- use it from:
  - `/api/admin/cards/[cardId]/ocr-suggest`
  - optional new endpoint `/api/admin/cards/identify-set`

That gives Add Cards an explicit endpoint while also fixing the existing OCR path.

## 5. Risks and edge cases beyond the prompt

Additional risks:

- `SetCard` uniqueness is per `setId + programId + cardNumber`, not per set only.
  - A single card number can appear under multiple `programId` rows within the same set.
  - The resolver should choose a set first, then pick the best program label, rather than over-weighting duplicate rows from one set.

- Current name normalization is too weak.
  - `normalizeLooseLookupKey()` currently tokenizes on `[a-z0-9]` only and does not strip accents explicitly.
  - That is likely why names like `González` vs `Gonzalez` can miss or downscore.

- OCR may not always surface the player name before Screen 1 auto-selection.
  - In those cases the resolver must cleanly fall back to the existing scope-based dropdown behavior instead of forcing a guess.

- Chrome/Optic keywords may appear in combined OCR text but not in the parsed `setName`.
  - The tiebreaker should inspect `photoOcr.FRONT.ocrText` first, then fall back to combined OCR text.

- Product Set auto-selection currently happens in two different places.
  - `variantScopeSummary.selectedSetId` can still override the intended choice if the new resolver result is not wired carefully.
  - The frontend should prefer explicit identify-set results over heuristic scope resolution.

- Existing Screen 2 prefetch behavior depends on `productLine` becoming stable.
  - Any resolver change must preserve the prefetch trigger path once a Product Set is chosen.

## Proposed implementation direction

- Add a reusable server helper for:
  - candidate-set loading
  - player-name normalization
  - cross-set `SetCard` lookup
  - Chrome/Optic tie-breaking
- Add `POST /api/admin/cards/identify-set`
- Update `uploads.tsx` to call the new endpoint once OCR has yielded:
  - `year`
  - `manufacturer`
  - `sport`
  - `cardNumber`
  - `playerName`
- If identify-set returns a match, write it into `intakeSuggested.setName` / `productLine` and let existing downstream Screen 2 prefetch continue unchanged.
- Preserve current fallback behavior when required inputs are missing or no exact/fuzzy match exists.
