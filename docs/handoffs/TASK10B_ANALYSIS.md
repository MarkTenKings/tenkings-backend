# Task 10b Analysis: Add Cards Screen 2 Pre-Fetch

Date: 2026-03-17

Scope:
- implementation planning for Task 10b
- based on current `main`
- no runtime deploy/restart/migration work

## Answers to the 5 Key Questions

### 1. Where does the current `/ocr-suggest` call happen for Screen 2?

Primary client caller:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2771`
  - `const fetchOcrSuggestions = useCallback(async (cardId: string) => { ... })`

Current automatic trigger:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2872-2883`
  - effect watching `pendingAutoOcrCardId`
  - this fires after `loadQueuedCardForReview()` if the existing OCR audit is missing or incomplete

Manual trigger:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3204-3223`
  - `toggleOcrSuggestions()`

Important detail:
- Screen 2 does not make a separate API call on mount.
- Screen 2 reads the same shared intake state that `fetchOcrSuggestions()` mutates via `applySuggestions()`.
- The race is that the user can reach `intakeStep === "optional"` before that shared OCR refresh finishes.

### 2. What inputs does the current `/ocr-suggest` call use?

Current query params are built in:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2787-2805`

Current inputs sent:
- `year`
- `manufacturer`
- `sport`
- `productLine`
- `setId` (same value as `productLine` when present)
- `layoutClass`

Current route:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`

It does not currently send `cardNumber` as a query hint.

### 3. Where are Insert / Parallel values resolved?

Server-side resolution is already in `/ocr-suggest`:

- card-number grounding:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:461`
  - `groundScopedCardNumberFromOcr(...)`

- scoped set-card resolution:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:927`
  - `resolveScopedSetCard(...)`
  - can write:
    - `fields.setName`
    - `fields.insertSet`
    - `fields.cardNumber`

- variant image matching:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:3384`
  - `runVariantMatch(...)`
  - can write:
    - `fields.parallel`

- taxonomy constraint pass:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:2430`
  - `constrainTaxonomyFields(...)`

Client-side application path:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2522`
  - `applySuggestions(...)`
- insert auto-pick effect:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2456-2488`
- parallel auto-pick effect:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2490-2519`

Conclusion:
- Insert / Parallel are already resolved through the existing `/ocr-suggest` path.
- Reusing that path is lower-risk than inventing a new parallel lookup.

### 4. How does the Product Set selection trigger state changes on Screen 1?

Primary Product Set state:
- `intakeOptional.productLine`

Manual user selection:
- `frontend/nextjs-app/pages/admin/uploads.tsx:4972-5000`
  - `setIntakeOptional((prev) => ({ ...prev, productLine: nextValue }))`
  - also marks `intakeOptionalTouched.productLine = true`

Task 10 fast auto-selection:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2396-2449`
  - when `variantScopeSummary.selectedSetId` is available, client auto-writes `intakeOptional.productLine`

Upstream source of `variantScopeSummary.selectedSetId`:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3340-3401`
  - `GET /api/admin/variants/options`
- `frontend/nextjs-app/lib/server/variantOptionPool.ts:796-797`
  - Task 10 single-scope `selectedSetId` auto-resolution

### 5. Where are Track B fields first available?

Track B fields:
- `cardNumber`
- `numbered`
- `autograph`
- `memorabilia`
- `graded`

They first become available through the existing OCR audit / OCR suggest path, not through Product Set selection.

Client load path:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2214-2260`
  - `loadQueuedCardForReview()` seeds:
    - `cardNumber` from `ocrFields.cardNumber ?? normalized.cardNumber`
    - `numbered` from `ocrFields.numbered ?? attributes.numbered`
    - `autograph` from `attributes.autograph`
    - `memorabilia` from `attributes.memorabilia`
    - `graded` from OCR graded flag / grade fields

Server OCR path:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:2862-2878`
  - raw OCR heuristics seed all of these fields
- later in same route:
  - `fields.numbered` can be grounded/cleared
  - `fields.cardNumber` can be grounded
  - booleans can be reinforced by OCR heuristics

Conclusion:
- Track B is already independent of Product Set.
- The problem is timing and application order, not missing data sources.

## Option Chosen

Chosen option: `B`

Reason:
- `/ocr-suggest` already contains the authoritative logic for:
  - set-card resolution
  - card-number grounding
  - variant image matching
  - taxonomy scoping
- Reusing that path is lower-risk than creating a second insert/parallel resolver.
- Task 10b can be implemented by:
  - firing a scoped `/ocr-suggest` prefetch as soon as Product Set is available or changed
  - keeping the existing initial OCR refresh for Track B
  - applying the scoped prefetch primarily to the set-dependent fields needed by Screen 2 before the user taps `Next`

Implementation landed:
- Track B stays on the early load-time OCR refresh and is now synchronized from OCR audit truth before Screen 2
- Track A is a product-set-driven scoped `/ocr-suggest` prefetch that fires on Product Set selection/change and passes `cardNumber`
- Screen 2 reads shared state and shows a narrow Insert / Parallel loading label while the scoped prefetch is still in flight
- stale Insert / Parallel values are cleared on Product Set changes unless the operator already touched those fields

## Exact Files and Line Numbers Modified

Primary client file:
- `frontend/nextjs-app/pages/admin/uploads.tsx`
  - existing OCR hydration now respects OCR booleans at `2269-2286`
  - OCR-truth sync helper for Screen 2 fields at `2554-2658`
  - `fetchOcrSuggestions(...)` now accepts scoped prefetch hints at `2907-3053`
  - `pendingAutoOcrCardId` trigger effect remains at `3055-3067`
  - product-set-driven Screen 2 prefetch effect added at `3069-3144`
  - optional-screen Insert / Parallel loading labels at `5537-5605`

Primary server file:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - taxonomy audit query-hint typing updated at `216-224`
  - scoped set-card resolver now accepts `cardNumber` hint at `932-945`
  - taxonomy constraint query-hint typing updated at `2432-2443`
  - handler query parsing now accepts `cardNumber` at `2688-2696`
  - hinted `cardNumber` is seeded into scoped OCR resolution at `3288-3292`
  - variant match now falls back to hinted `cardNumber` at `3389-3398`

Possible support updates:
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

## Risks / Edge Cases

1. Double-fetch overlap
- load-time Track B refresh and product-set-driven Track A refresh can overlap
- client request ordering must prevent stale responses from overwriting newer scoped responses

2. Product Set auto-selection loop
- Task 10 already auto-writes `productLine`
- new Track A prefetch must key on a stable request signature so it does not refire continuously

3. Manual Product Set changes
- when operator changes Product Set manually, Track A must refire
- prior Track A results must not remain visible as if they still match the new set

4. User taps `Next` immediately after changing Product Set
- do not block navigation
- only Insert / Parallel should show a loading state on Screen 2
- Track B fields should still be visible

5. Sticky boolean behavior
- `applySuggestions()` still only auto-checks boolean `true`
- to avoid stale heuristic checks on Screen 2, the landed fix adds an OCR-audit sync pass that clears untouched `autograph`, `memorabilia`, `graded`, `gradeCompany`, `gradeValue`, and `numbered` when the completed OCR audit does not support them

6. Line-number drift
- current line numbers above are based on `main` at analysis time and will shift once the patch is applied
