# Task 19 Analysis: Screen 2 Insert/Parallel Prefetch Timeout

Date: 2026-04-01
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch: `main`

## Scope
- Investigate why Add Cards Screen 2 insert/parallel suggestions stay stuck on `Loading...`
- Use the exact reported runtime inputs:
  - `cardId`: `0c16cb4fa6474147b9bb290a42d52842`
  - `productSetId`: `2025-26_Topps_Chrome_Basketball`
  - `cardNumber`: `TC-HG`

## Findings

### 1. Screen 2 prefetch calls the full `/ocr-suggest` route
- Frontend path:
  - `frontend/nextjs-app/pages/admin/uploads.tsx`
  - `useEffect` at `3316-3443` computes `scopedProductSetId`, sets `screen2PrefetchStatus("loading")`, starts a `5000ms` timeout, clears untouched `insertSet` / `parallel`, then calls `fetchOcrSuggestions(...)`
  - `fetchOcrSuggestions(...)` at `3093-3278` calls:
    - `GET /api/admin/cards/:cardId/ocr-suggest`
    - query params include `year`, `manufacturer`, `sport`, `productLine`, `setId`, `cardNumber`, `layoutClass`
- Timeout behavior:
  - client timeout is hard-coded to `5000ms` in `uploads.tsx:3395-3405`
  - when it fires, it changes `screen2PrefetchStatus` from `loading` to `error`
  - UI message switches to `Insert suggestion unavailable` / `Parallel suggestion unavailable`

### 2. Live production `/ocr-suggest` is too slow for the 5s client timeout
- Live production call executed against:
  - `https://collect.tenkings.co/api/admin/cards/0c16cb4fa6474147b9bb290a42d52842/ocr-suggest?productLine=2025-26_Topps_Chrome_Basketball&setId=2025-26_Topps_Chrome_Basketball&cardNumber=TC-HG&year=2025-26&manufacturer=Topps&sport=Basketball`
- Observed result:
  - `HTTP 200`
  - `time_total=13.928036`
- Returned payload summary:
  - `status: "ok"`
  - `suggestions.setName: "2025-26_Topps_Chrome_Basketball"`
  - `suggestions.insertSet: "BASE"`
  - `suggestions.parallel: null`
  - `audit.setCardResolution.reason: "card_number_not_found_in_scope"`
  - `audit.variantMatch.ok: false`
  - `audit.variantMatch.message: "No confident variant match"`
- Conclusion:
  - the prefetch path is not failing at transport level
  - it is exceeding the frontend timeout because it runs too much work before responding

### 3. The backend re-runs the expensive OCR pipeline even when OCR data already exists
- Handler:
  - `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- Card data loaded in the route:
  - `ocrText`
  - front image URL
  - back/tilt related photos
- Current behavior:
  - once images are present, the route always runs `runGoogleVisionOcr(images)`
  - then it runs LLM parsing, memory passes, region-template passes, OCR grounding, set-card resolution, variant match, and taxonomy constraints
- Persisted data already available on the task card:
  - `ocrTextLength: 1008`
  - three intake images are present
  - `ocrSuggestionJson` already exists
- Persisted OCR suggestion payload already contains:
  - `fields.setName = "2025-26_Topps_Chrome_Basketball"`
  - `fields.insertSet = "BASE"`
  - `fields.cardNumber = "TC-HG"`
  - `fields.playerName = "Hugo González"`
  - `fields.parallel = null`
- Conclusion:
  - Screen 2 prefetch is paying the cost of a full OCR/LLM pass even though the card already has persisted OCR suggestions that can be reused for scoped set/program/parallel refresh

### 4. `TC-HG` does not exist in the selected set scope
- Production DB query results:
  - `SetCard` rows for `setId = 2025-26_Topps_Chrome_Basketball` and `cardNumber = TC-HG`: `0`
  - `CardVariant` rows for `setId = 2025-26_Topps_Chrome_Basketball` and `cardNumber = TC-HG`: `0`
- Broader production DB query:
  - exact `CardVariant.cardNumber = TC-HG` exists in:
    - `2025-26 Topps Basketball`
    - `2025-26_Topps_Basketball`
  - program:
    - `1980-81-topps-chrome-basketball`
- Conclusion:
  - the selected Product Set scope is real, but the card number does not ground inside that scope
  - this explains `card_number_not_found_in_scope` and why `parallel` remains unavailable
  - this is not the immediate timeout root cause, but it explains why the final payload still lacks a confident parallel

### 5. The reference-image preview effect has a cache-miss loop
- Frontend effect:
  - `uploads.tsx:4012-4076`
- Current pending filter:
  - `const pending = candidates.filter((option) => !optionPreviewUrls[option]);`
- Problem:
  - the effect stores `""` for options with no preview image
  - `!optionPreviewUrls[option]` treats `""` as still missing
  - those options are fetched again on the next render
  - because `optionPreviewUrls` is in the dependency list, the effect repeats indefinitely for all empty-preview options
- Result:
  - repeated `/api/admin/variants/reference?...` calls
  - explains the reported thousands of requests much better than the Screen 2 prefetch itself

## Root Cause

Primary root cause:
- Screen 2 prefetch uses the full `/ocr-suggest` pipeline, which takes about `14s` in production for the reported card and is incompatible with the frontend’s `5s` timeout.

Secondary root cause:
- the preview-image effect treats empty-string previews as uncached and re-requests them forever, causing the observed request flood and likely adding extra browser/server pressure.

Data note:
- for the reported card, `TC-HG` is not present in `2025-26_Topps_Chrome_Basketball`, so even a fast scoped refresh should be expected to return `insertSet = BASE` and `parallel = unavailable` rather than a confident parallel match.

## Fix Direction

1. Add a lightweight `product_set_prefetch` fast path in `/ocr-suggest`
- Reuse persisted `ocrSuggestionJson` / `ocrText`
- Skip Google Vision + LLM for this path
- Re-run only the scoped set/program/parallel logic that depends on the chosen Product Set

2. Pass the prefetch purpose from the frontend
- so the route can choose the lightweight path for Screen 2 prefetch

3. Fix the preview-image cache miss loop
- treat `""` as a cached terminal result
- do not re-fetch preview URLs for options already present in `optionPreviewUrls`

4. Remove temporary `[T17-DEBUG]` logs from `uploads.tsx`

## Implemented Fix

- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
  - added `purpose` parsing and included `ocrSuggestionJson` in the card lookup
  - added a `product_set_prefetch` fast path that reuses persisted OCR suggestion state instead of re-running Google Vision + LLM
  - the fast path now re-runs only:
    - scoped set-card resolution
    - variant match
    - taxonomy constraints
  - persisted the refreshed audit back to `ocrSuggestionJson` so subsequent prefetches reuse the scoped result
- `frontend/nextjs-app/pages/admin/uploads.tsx`
  - now sends `purpose=product_set_prefetch` for the Screen 2 prefetch request
  - fixed the option preview cache check to use property presence instead of truthiness, so `""` is treated as a cached terminal result
  - removed all temporary `[T17-DEBUG]` instrumentation

## Expected Runtime Result

- Product Set selection still follows the existing Screen 1 logic from Task 17.
- Once Screen 1 selects a Product Set, Screen 2 prefetch now hits the lightweight stored-suggestion path instead of the full OCR/LLM path.
- For the reported card:
  - `insertSet` should resolve quickly to the stored/scoped result (`BASE`)
  - `parallel` is still expected to remain unavailable because `TC-HG` does not exist inside `2025-26_Topps_Chrome_Basketball`
- The repeated `/api/admin/variants/reference?...` flood should stop because empty-preview results are no longer re-queued forever.

## Validation After Fix

- `pnpm --filter @tenkings/nextjs-app exec next lint --file pages/admin/uploads.tsx --file 'pages/api/admin/cards/[cardId]/ocr-suggest.ts'`
  - pass with the existing `uploads.tsx` `<img>` warnings only
- `pnpm --filter @tenkings/nextjs-app exec tsc -p tsconfig.json --noEmit`
  - pass
- `git diff --check`
  - pass
