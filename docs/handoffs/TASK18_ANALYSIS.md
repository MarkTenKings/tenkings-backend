# Task 18 Analysis: Precise eBay Sold Comps

Date: 2026-03-31
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch: `main`

## 1. Live SerpApi data shape for eBay sold listings

Live SerpApi checks were run against the eBay sold engine using the existing KingsReview search pattern.

Observed top-level keys from `engine=ebay` sold search:
- `search_metadata`
- `search_parameters`
- `search_information`
- `categories`
- `organic_results`
- `related_searches`
- `pagination`
- `serpapi_pagination`

Observed sold-listing fields on `organic_results[n]`:
- `title`
- `link`
- `serpapi_link`
- `product_id`
- `epid`
- `condition`
- `price`
- `shipping`
- `location`
- `returns`
- `thumbnail`
- `seller`
- `sold_date`

Important runtime finding:
- The sold-search payload does **not** currently expose populated item specifics / about-this-item fields directly in `organic_results`.
- A follow-up `engine=ebay_product` request does expose `product_results.specifications` as a field on the product payload.
- In the sampled sold listings I checked, `product_results.specifications` existed but was empty across the tested results.

Observed `engine=ebay_product` payload shape:
- top-level: `search_metadata`, `search_parameters`, `product_results`, `seller_results`, `related_products`
- `product_results` fields:
  - `product_id`
  - `product_link`
  - `title`
  - `short_description`
  - `full_description_link`
  - `buy`
  - `shipping`
  - `returns`
  - `payment_methods`
  - `media`
  - `specifications`
  - `categories`
  - `condition`

Implementation implication:
- We can use `condition`, `product_id`, and `epid` from sold search immediately.
- We should treat structured item specifics as **best effort** only.
- Title parsing must be the primary fallback because real sold samples did not provide populated `specifications`.

## 2. KingsReview card fields already available vs missing

Current KingsReview card detail flow:
- UI page: `frontend/nextjs-app/pages/admin/kingsreview.tsx`
- Card detail API: `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- Enqueue API: `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`

Already available on the card detail response:
- `resolvedPlayerName`
- `classification` = parsed `classificationJson.attributes`
- `classificationNormalized` = parsed `classificationJson.normalized`
- `variantId`
- `variantDecision`
- `customTitle`
- `customDetails`

Available from `classification.attributes` today:
- `playerName`
- `year`
- `brand`
- `setName`
- `variantKeywords` (current best parallel token source)
- `numbered`
- `autograph`
- `memorabilia`
- `gradeCompany`
- `gradeValue`

Available from `classification.normalized` today:
- `cardNumber`
- `setName`
- `setCode`
- `year`
- `company`
- `sport.gradeCompany`
- `sport.grade`
- `sport.graded`

Not currently exposed as a single KingsReview-ready comp-match object:
- canonical set label from variant taxonomy when `variantId` is already known
- canonical parallel label from variant taxonomy when `variantId` is already known
- explicit graded boolean normalized for comp scoring
- a unified comp-match context passed into load-more and the Bytebot worker

Implementation recommendation:
- add a derived `compMatchContext` object rather than scattering more ad hoc fields through the UI
- persist that same context in the Bytebot job payload at enqueue time so the worker can score initial comps without re-deriving context

## 3. Actual Prisma/schema field locations for requested card attributes

There are only a few direct Prisma columns for this problem on `CardAsset`.

Direct Prisma columns on `CardAsset`:
- `variantId`
- `resolvedPlayerName`
- `resolvedTeamName`
- `classificationJson`

Most requested fields are **not** first-class `CardAsset` columns. They live inside `classificationJson`.

Field mapping:
- `parallel`
  - primary current source: `classificationJson.attributes.variantKeywords[0]`
  - possible normalized/taxonomy-related sources: `variantId`, `CardVariant.parallelId`, `CardVariantTaxonomyMap.parallelId`, `SetParallel.label`
- `insert`
  - current source: `classificationJson.normalized.setCode`
  - alternate OCR/feedback field naming in code: `insertSet`
- `graded`
  - derived from `classificationJson.normalized.sport.graded`
  - or inferred from `classificationJson.attributes.gradeCompany` / `gradeValue`
- `gradingCompany`
  - `classificationJson.attributes.gradeCompany`
  - normalized sport/comics variants also exist: `classificationJson.normalized.sport.gradeCompany`, `classificationJson.normalized.comics.gradeCompany`
- `gradeScore`
  - current raw attribute field: `classificationJson.attributes.gradeValue`
  - normalized sport/comics variants also exist: `classificationJson.normalized.sport.grade`, `classificationJson.normalized.comics.grade`
- `autograph`
  - `classificationJson.attributes.autograph`
  - normalized sport variant also exists: `classificationJson.normalized.sport.autograph`
- `memorabilia`
  - `classificationJson.attributes.memorabilia`
- `numbered`
  - `classificationJson.attributes.numbered`

Related taxonomy models that matter if `variantId` is present:
- `CardVariant`
  - `setId`
  - `programId`
  - `cardNumber`
  - `parallelId`
- `CardVariantTaxonomyMap`
  - `setId`
  - `programId`
  - `cardNumber`
  - `variationId`
  - `parallelId`
- `SetProgram.label`
- `SetVariation.label`
- `SetParallel.label`

## 4. Existing string-similarity / fuzzy-match packages

No directly declared fuzzy-match dependency is currently installed in:
- repo root `package.json`
- `frontend/nextjs-app/package.json`
- `packages/shared/package.json`
- `backend/bytebot-lite-service/package.json`

The lockfile does include transitive packages:
- `damerau-levenshtein`
- `fast-levenshtein`
- `natural-compare`

Recommendation:
- do **not** add a new external dependency for this task
- implement a small local Levenshtein function in shared code
- reuse existing player-name normalization from `packages/shared/src/cardIdentity.ts`

Reason:
- the matcher needed here is simple, deterministic, and narrow in scope
- avoiding a new dependency keeps workspace churn smaller and makes backend + frontend reuse easier

## 5. Scoring threshold recommendation from real SerpApi sampling

Live sampling conclusions:
- sold-search response has good title coverage
- `condition` is present and usable
- structured `specifications` were empty in the sampled sold listings, including graded examples
- because of that, title parsing and condition parsing need to carry most of the signal

Recommended thresholds:
- `exact`: score `>= 80`
- `close`: score `55-79`
- `weak`: score `< 55`

Reasoning:
- `80+` leaves room for exact player + set + card number + year + parallel matches even when some seller formatting is noisy
- `55-79` captures same-card-but-different-market cases such as raw vs graded, or correct card with missing serial text
- below `55` should still be shown for operator context, but clearly demoted

Recommended weighting emphasis:
- required gate: player match
- highest penalties:
  - wrong graded/raw universe
  - wrong parallel/base universe
  - conflicting serial denominator when both sides expose one
- strongest positive signals:
  - card number
  - set token overlap
  - parallel token overlap
  - title grader/grade parse when the card is slabbed

## Summary

Best implementation path:
1. Build a reusable shared scorer for eBay sold comps.
2. Use search-response structured fields immediately (`condition`, `product_id`, `epid`, `sold_date`, `seller`, etc.).
3. Parse the title as the primary signal for player, set, card number, parallel, grading, and serial denominator.
4. Treat `ebay_product.product_results.specifications` as optional future enrichment, not a required dependency, because sampled sold listings returned it empty.
