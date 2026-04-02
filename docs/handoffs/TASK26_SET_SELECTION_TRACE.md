# Task 26 Set Selection Trace

Read-only trace on `main` at `5047226`.

Scope:
- No source code changed.
- No DB queries run.
- No deploy/restart/migration run.
- This traces the actual code path from OCR completion to `intakeOptional.productLine`.

## Short Answer

There is no code in this pipeline that converts OCR year `"2025"` into season `"2024-25"`.

The wrong set can only be selected if a wrong set ID is already present in one of these upstream sources:
- `identifiedSetMatch.setId`
- `variantScopeSummary.selectedSetId`
- `productLineOptions` plus an OCR heuristic match

From the traced code, the strongest client-side reason a wrong Product Set can stick is:
- the Product Set auto-selection effect gives absolute priority to `identifiedSetMatch.setId` over every other path
- the identify-set effect does not include `teamName`, `insertSet`, `frontCardText`, or `combinedText` in its request key, even though the server uses those as tie-break inputs
- the server-side `identifySetByCardIdentity()` normal path still returns a winner even when the top two candidates are still tied after tiebreaking; in that case it falls back to lexical `setId` order and returns `reason: "ambiguous_post_tiebreak_first_candidate"`

So the exact bug pattern is:
- a stale or under-informed identify-set result can become authoritative
- later OCR evidence that would break the tie does not necessarily trigger a new identify-set request
- once `identifiedSetMatch.setId` exists, the UI prefers it over current value, scope fallback, single-option, and OCR heuristic paths

## End-to-End Flow

1. `/api/admin/cards/[cardId]/ocr-suggest` builds `fields` and `confidence`, constrains `fields.setName` against the variant option pool, then returns `suggestions = collectSuggestions(fields, confidence)`.
   - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:2524-2594`
   - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:400-409`
   - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:3652-3660`

2. `fetchOcrSuggestions()` receives that payload, copies `payload.audit` into `ocrAudit`, and calls `applySuggestions(payload.suggestions, audit.confidence)`.
   - File: `frontend/nextjs-app/pages/admin/uploads.tsx:3043-3207`

3. `applySuggestions()` may set `intakeOptional.productLine` immediately if `suggestions.setName` is actionable and `pickBestCandidate(...)` finds a Product Set option score `>= 1.1`.
   - File: `frontend/nextjs-app/pages/admin/uploads.tsx:2750-2914`

4. Independently, the variant-option loader fetches `/api/admin/variants/options?year=...&manufacturer=...&sport=...`.
   - It populates:
     - `productLineOptions`
     - `insertSetOptions`
     - `parallelOptions`
     - `variantScopeSummary.selectedSetId`
   - File: `frontend/nextjs-app/pages/admin/uploads.tsx:3836-3923`

5. Independently, the identify-set effect posts to `/api/admin/cards/identify-set` once `year + manufacturer + sport + cardNumber + playerName` are all available.
   - File: `frontend/nextjs-app/pages/admin/uploads.tsx:4041-4146`
   - File: `frontend/nextjs-app/pages/api/admin/cards/identify-set.ts:33-64`
   - File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:339-744`

6. The Product Set auto-selection effect then decides whether to set `intakeOptional.productLine`.
   - File: `frontend/nextjs-app/pages/admin/uploads.tsx:2514-2562`

## Part 1A: Path A, `applySuggestions()` OCR Suggestion Path

### Entry point

- `fetchOcrSuggestions()` calls:
  - `applySuggestions(suggestions, suggestionConfidence)`
  - File: `frontend/nextjs-app/pages/admin/uploads.tsx:3183-3194`

### What `suggestions` contains

- Server-side `collectSuggestions()` only includes fields where:
  - `value` exists
  - `confidence[key] != null`
  - `confidence[key] >= fieldThreshold(key)`
- For `setName`, `insertSet`, and `parallel`, `fieldThreshold(key)` is `0.8`.
  - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:131-135`
  - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:342-347`
  - File: `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:400-409`

### `applySuggestions()` Product Set logic

Exact Product Set branch:

```ts
const rawSuggestedProductLine = sanitizeNullableText(suggestions.setName);
const suggestedProductLine = isActionableProductLineHint(rawSuggestedProductLine)
  ? rawSuggestedProductLine
  : "";

const constrainedProductLine =
  suggestedProductLine && productLineOptions.length > 0
    ? pickBestCandidate(productLineOptions, [
        suggestedProductLine,
        `${sanitizeNullableText(intakeRequired.year)} ${sanitizeNullableText(intakeRequired.manufacturer)} ${sanitizeNullableText(
          intakeRequired.sport
        )}`.trim(),
      ], 1.1)
    : null;

if (constrainedProductLine && !intakeOptionalTouched.productLine) {
  next.productLine = constrainedProductLine;
}
```

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:2825-2843`

### OCR fields used as input

`applySuggestions()` uses:
- `suggestions.setName`
- `intakeRequired.year`
- `intakeRequired.manufacturer`
- `intakeRequired.sport`
- `productLineOptions`
- `intakeOptionalTouched.productLine`

It does not use:
- `identifiedSetMatch`
- `variantScopeSummary.selectedSetId`
- `teamName`
- `insertSet`
- `cardNumber`

### `productLineOptions` at this point

- They come from the `/api/admin/variants/options` effect, not from OCR.
- File: `frontend/nextjs-app/pages/admin/uploads.tsx:3836-3923`

### `pickBestCandidate()` matching algorithm

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:632-677`

Scoring rules per hint:
- `+1.5` if `hintLower === optionLower`
- `+1.2` if `normalizeVariantLabelKey(hint) === normalizeVariantLabelKey(option)`
- `+0.9` if `optionLower.includes(hintLower)` or `hintLower.includes(optionLower)`
- `+0.25` for each token from the hint that appears in the option token set

Selection rule:
- keep the highest score only when `score > bestScore`
- return that option only if `bestScore >= minScore`
- otherwise return `null`

Tie behavior:
- exact ties do not replace the earlier winner because the code uses `>` not `>=`
- that means input order matters when scores tie

### Concrete example for Path A

Assume:
- OCR year: `2025`
- OCR manufacturer: `Topps`
- OCR sport: `Basketball`
- OCR setName: `2025 Topps Chrome Basketball`
- `productLineOptions = [`
  - `2024-25_Topps_Chrome_Basketball`
  - `2025-26_Topps_Chrome_Basketball`
  - `2025-26_Topps_Basketball`
  - `]`

`applySuggestions()` sends these hints into `pickBestCandidate(...)`:
- `2025 Topps Chrome Basketball`
- `2025 Topps Basketball`

Using the exact scoring formula above, the scores are:
- `2024-25_Topps_Chrome_Basketball` => `1.25`
- `2025-26_Topps_Chrome_Basketball` => `1.75`
- `2025-26_Topps_Basketball` => `1.50`

Result:
- `pickBestCandidate(...)` returns `2025-26_Topps_Chrome_Basketball`
- reason: it gets the highest token-overlap score and clears the `1.1` threshold

Conclusion for Path A:
- with a real `2025` year hint and a `Chrome Basketball` OCR set hint, this branch should prefer `2025-26_Topps_Chrome_Basketball`, not `2024-25_Topps_Chrome_Basketball`

## Part 1B: Path B, `identifiedSetMatch` via `/api/admin/cards/identify-set`

### Client request inputs

The identify-set effect builds and posts this payload:
- `year`
- `manufacturer`
- `sport`
- `cardNumber`
- `playerName`
- `teamName`
- `insertSet`
- `frontCardText`
- `combinedText`

Code:
- `year = sanitizeNullableText(intakeRequired.year)`
- `manufacturer = sanitizeNullableText(intakeRequired.manufacturer)`
- `sport = sanitizeNullableText(intakeRequired.sport)`
- `cardNumber = resolvedOcrCardNumber`
- `playerName = sanitizeNullableText(intakeRequired.playerName)`
- `teamName = sanitizeNullableText(intakeOptional.teamName)`
- `insertSet = sanitizeNullableText(intakeOptional.insertSet)`
- `frontCardText = identifiedFrontCardText`
- `combinedText = identifiedCombinedOcrText`

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:4066-4107`

### Important request-key detail

The request key is only:
- `year`
- `manufacturer`
- `sport`
- `cardNumber`
- `playerName`

Code:
- File: `frontend/nextjs-app/pages/admin/uploads.tsx:4041-4056`

This means changes in:
- `teamName`
- `insertSet`
- `frontCardText`
- `combinedText`

do not create a new request key.

The effect still depends on those values, but it exits early if:

```ts
if (identifySetRequestKeyRef.current === identifySetRequestKey) {
  return;
}
```

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:4091-4094`

That is the first major sticky-state risk in this pipeline.

### Server-side entry

- API route validates the payload and calls:
  - `identifySetByCardIdentity(...)`
- File: `frontend/nextjs-app/pages/api/admin/cards/identify-set.ts:33-64`

### Server-side scope build

`identifySetByCardIdentity()` first normalizes:
- `year = sanitizeText(params.year || "")`
- `manufacturer = sanitizeText(params.manufacturer || "")`
- `sport = sanitizeText(params.sport || "") || null`
- `normalizedCardNumber = normalizeTaxonomyCardNumber(params.cardNumber)`
- `normalizedPlayerName = normalizeIdentityTextBase(params.playerName)`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:340-345`

Early exits:
- missing year/manufacturer => `confidence: "none", reason: "missing_scope_hints"`
- missing/`ALL` card number => `confidence: "none", reason: "missing_card_number"`
- missing player name => `confidence: "none", reason: "missing_player_name"`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:346-404`

Then it loads the variant option pool with no explicit set:

```ts
const pool = await loadVariantOptionPool({
  year,
  manufacturer,
  sport,
  productLine: null,
  setId: null,
});
```

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:406-412`

Candidate set universe:
- `candidateSetIds = Array.from(new Set(pool.scopedSetIds.filter(Boolean)))`
- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:414-433`

### Main `SetCard` query

It queries:

```ts
const rows = await prisma.setCard.findMany({
  where: {
    setId: { in: candidateSetIds },
    cardNumber: normalizedCardNumber,
    ...publishedSetCardWhereInput(),
  },
  select: {
    setId: true,
    programId: true,
    cardNumber: true,
    playerName: true,
    team: true,
  },
  take: 200,
});
```

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:435-449`

### Player-name scoring

`comparePlayerNames()` returns:
- `matched: true, matchType: "exact", score: 100` if normalized full names match exactly
- `matched: true, matchType: "exact", score: 98` if normalized base names match exactly
- `matched: true, matchType: "fuzzy", score: 84 + overlap` if one normalized base contains the other
- `matched: true, matchType: "fuzzy", score: 80 + overlap` if overlap is at least `max(2, minTokenCount - 1)`
- `matched: true, matchType: "fuzzy", score: 74 + overlap` if overlap is at least `2`
- otherwise not matched

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:130-173`

### Main candidate score

For each `SetCard` row that passes player-name matching:
- start with `score = playerMatch.score`
- `+4` if `teamName` exactly matches after normalization
- `+3` if normalized `insertSet` exactly matches normalized program label/program ID

Code:
- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:552-587`

The server keeps only the best candidate per `setId`.

### Tiebreak signal

If there is more than one candidate set, `detectTiebreakSignal(...)` checks OCR text:
- front text contains `chrome` => `tiebreaker = "chrome", textSource = "front"`
- front text contains `optic` => `tiebreaker = "optic", textSource = "front"`
- else combined text contains `chrome` => `tiebreaker = "chrome", textSource = "combined"`
- else combined text contains `optic` => `tiebreaker = "optic", textSource = "combined"`
- else `tiebreaker = "default"`
- if there is only one candidate, `tiebreaker = "none"`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:175-201`

### Tiebreak ranking

`rankCandidateByTiebreak(setId, tiebreaker)`:
- `chrome`:
  - set ID contains `chrome` => `3`
  - set ID contains `optic` => `0`
  - otherwise => `1`
- `optic`:
  - set ID contains `optic` => `3`
  - set ID contains `chrome` => `0`
  - otherwise => `1`
- `default`:
  - neither `chrome` nor `optic` => `2`
  - otherwise => `1`
- `none` => `0`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:203-218`

### Final ranking order

Candidates are sorted by:
1. `score` descending
2. `tieBreakRank` descending
3. `setId.localeCompare(...)` ascending
4. `programId.localeCompare(...)` ascending

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:678-689`

### What determines `confidence`

On the main `SetCard` path:
- final `confidence` is just `best.matchType`
- that is `exact` or `fuzzy` from player-name matching only
- it is not reduced when the result is still ambiguous after tiebreaking

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:720-744`

### Critical ambiguity behavior

If the top two candidates are still tied after score and tiebreak:

```ts
const ambiguousAfterTiebreak = Boolean(
  runnerUp &&
    runnerUp.setId !== best.setId &&
    runnerUp.score === best.score &&
    runnerUp.tieBreakRank === best.tieBreakRank
);
```

The function still returns `best`:
- `setId = best.setId`
- `confidence = best.matchType`
- `reason = "ambiguous_post_tiebreak_first_candidate"`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:713-737`

This is the second major sticky-state risk:
- ambiguous ties do not return `confidence: "none"`
- they return a real set ID
- the lexical `setId` winner becomes authoritative on the client

### Legacy `CardVariant` fallback

Legacy fallback runs when:
- `SetCard` finds no rows
- or player-name matching leaves no candidates

Legacy query:

```ts
prisma.cardVariant.groupBy({
  by: ["setId", "programId", "cardNumber"],
  where: {
    setId: { in: candidateSetIds },
    cardNumber: normalizedCardNumber,
    ...(programId ? { programId } : {}),
  },
})
```

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:251-337`

Legacy score:
- base `3` if `selectedSetId` matches the row set, else `1`
- `+4` for exact normalized insert-set/program match
- `+2` for substring match between normalized insert-set/program keys
- `+ up to 1.2` from row count bonus

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:300-312`

Legacy path ambiguity handling is stricter:
- if best is not decisive, it returns `confidence: "none"`
- decisive means:
  - no runner-up
  - or score gap `>= 1.2`
  - or better `tieBreakRank`

- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:499-540`
- File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:610-651`

### How the client uses identify-set result

When the result comes back:
- `setIdentifiedSetMatch(result)`
- if `result.confidence !== "none"` and `result.setId` exists:
  - `setIntakeSuggested((prev) => ({ ...prev, setName: resolvedSetId }))`

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:4108-4116`

Then the Product Set auto-select effect gives this result top priority.

## Part 1C: Path C, `variantScopeSummary.selectedSetId` Scope Fallback

### Where `variantScopeSummary` comes from

- Client useEffect fetches `/api/admin/variants/options`
- File: `frontend/nextjs-app/pages/admin/uploads.tsx:3836-3923`

### API route

- Route: `GET /api/admin/variants/options`
- File: `frontend/nextjs-app/pages/api/admin/variants/options.ts:49-91`

Request params:
- required:
  - `year`
  - `manufacturer`
- optional:
  - `sport`
  - `productLine`
  - `setId`

Client sends:
- always `year`, `manufacturer`, `limit=5000`
- `sport` if present
- `productLine` and `setId` only if `intakeOptional.productLine` is already populated

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:3861-3873`

### How `selectedSetId` is determined on the server

Server function:
- `loadVariantOptionPool(...)`
- File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:706-964`

It does this:

1. Load scope-eligible sets:
   - approved `SetDraft.setId`
   - optionally review-required sets with live legacy variants
   - File: `frontend/nextjs-app/lib/server/variantSetScope.ts:167-218`

2. Resolve those scope set IDs into actual variant set IDs:
   - `resolveVariantSetIdsForScope(scopeSetIds.scopeSetIds)`
   - File: `frontend/nextjs-app/lib/server/variantSetScope.ts:145-165`

3. Filter those variant set IDs by year/manufacturer/sport:
   - `filterScopedSetIds(...)`
   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:259-294`
   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:770-778`

4. If an explicit set candidate exists (`setId || productLine`):
   - first try `resolveSetIdByIdentity(scopedSetIds, explicitSetCandidate)`
   - then `resolveCanonicalOption(scopedSetIds, explicitSetCandidate, 1.1)`
   - if not found in scoped set IDs, try the same against all scope variant set IDs
   - if found globally, set:
     - `selectedSetId = globalResolved`
     - `scopedSetIds = [globalResolved]`

   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:779-794`

5. If still no `selectedSetId` and `scopedSetIds.length === 1`:
   - `selectedSetId = scopedSetIds[0]`
   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:796-798`

6. If `scopedSetIds.length < 1`:
   - broaden scope to all scope variant set IDs
   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:800-803`

7. After the broadening step, if still no `selectedSetId` but explicit candidate exists:
   - try resolving again against the broadened `scopedSetIds`
   - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:812-814`

### `resolveSetIdByIdentity()` matching algorithm

- File: `frontend/nextjs-app/lib/server/variantSetScope.ts:60-107`

Priority:
1. exact case-insensitive string equality
2. exact `normalizeSetIdentityKey(...)` equality
3. token overlap match, only if:
   - input has at least 2 tokens
   - overlap is at least 2
   - `score = coverage * 1.4 + precision * 1.0 + lexicalBonus`
   - return best only if `bestScore >= 1.45`

Important:
- it normalizes underscores to spaces
- it removes stop words like `checklist`, `odds`, `draft`, `review`, `version`

### When Path C wins on the client

In the Product Set auto-select effect, scope fallback is only used when:
- category is `sport`
- `productLineOptions.length > 0`
- `productLineManualMode === false`
- `intakeOptionalTouched.productLine === false`
- no `identifiedSetId`
- current value is not already a known option
- `variantScopeSummary.selectedSetId` is truthy

Code:
- File: `frontend/nextjs-app/pages/admin/uploads.tsx:2514-2562`

Exact branch:

```ts
if (identifiedSetId) {
  candidate = resolveKnownProductLine(identifiedSetId);
} else if (matchedCurrent) {
  return;
} else {
  const resolvedScopedSetId = sanitizeNullableText(variantScopeSummary?.selectedSetId);
  if (resolvedScopedSetId) {
    candidate = resolveKnownProductLine(resolvedScopedSetId);
  }
  ...
}
```

## Part 1D: Path D, single-option auto-select

Client branch:

```ts
else if (!current && productLineOptions.length === 1) {
  candidate = productLineOptions[0] ?? "";
}
```

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:2544-2545`

This only runs when:
- no identified-set winner
- current productLine is empty
- no scope fallback winner
- exactly one `productLineOptions` entry exists

Server also has a related single-scope shortcut:

```ts
if (!selectedSetId && scopedSetIds.length === 1) {
  selectedSetId = scopedSetIds[0] ?? null;
}
```

- File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:796-798`

So single-option behavior exists both:
- client-side as an explicit fallback
- server-side as `scope.selectedSetId`

## Part 1E: Path E, OCR `setName` heuristic

### What `intakeSuggested.setName` is

It is not a single-source field. It can come from:
- OCR audit fields loaded from an existing queued card
  - File: `frontend/nextjs-app/pages/admin/uploads.tsx:2394-2402`
- live `applySuggestions(suggestions)` from `/ocr-suggest`
  - File: `frontend/nextjs-app/pages/admin/uploads.tsx:2762`
- identify-set result, when confidence is not `none`
  - File: `frontend/nextjs-app/pages/admin/uploads.tsx:4113-4116`

So `intakeSuggested.setName` may be:
- raw OCR set text
- a taxonomy-constrained canonical set ID
- or an identify-set chosen set ID

### Heuristic branch in Product Set auto-select effect

Code:

```ts
else if (!current) {
  const suggestedSetName = sanitizeNullableText(intakeSuggested.setName);
  const actionableSuggestedSetName = isActionableProductLineHint(suggestedSetName) ? suggestedSetName : "";
  if (!actionableSuggestedSetName) {
    return;
  }
  candidate = pickBestCandidate(productLineOptions, [actionableSuggestedSetName], 1.1) ?? "";
}
```

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:2546-2552`

Important difference from Path A:
- this branch uses only `[actionableSuggestedSetName]`
- it does not include the extra `year manufacturer sport` hint that `applySuggestions()` uses

That makes Path E weaker than Path A when the OCR set text is vague.

## Part 2: Exact Product Set Priority Chain

File:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2514-2562`

Preconditions before any selection happens:

```ts
if (intakeRequired.category !== "sport" || productLineOptions.length === 0) {
  return;
}
if (productLineManualMode) {
  return;
}
if (intakeOptionalTouched.productLine) {
  return;
}
```

Then:

```ts
const current = sanitizeNullableText(intakeOptional.productLine);
const matchedCurrent = current
  ? productLineOptions.find((option) => option.toLowerCase() === current.toLowerCase()) ?? ""
  : "";
const identifiedSetId =
  identifiedSetMatchConfidence && identifiedSetMatchConfidence !== "none" ? identifiedSetMatchSetId : "";

let candidate = "";
if (identifiedSetId) {
  candidate = resolveKnownProductLine(identifiedSetId);
} else if (matchedCurrent) {
  return;
} else {
  const resolvedScopedSetId = sanitizeNullableText(variantScopeSummary?.selectedSetId);
  if (resolvedScopedSetId) {
    candidate = resolveKnownProductLine(resolvedScopedSetId);
  } else if (!current && productLineOptions.length === 1) {
    candidate = productLineOptions[0] ?? "";
  } else if (!current) {
    const suggestedSetName = sanitizeNullableText(intakeSuggested.setName);
    const actionableSuggestedSetName = isActionableProductLineHint(suggestedSetName) ? suggestedSetName : "";
    if (!actionableSuggestedSetName) {
      return;
    }
    candidate = pickBestCandidate(productLineOptions, [actionableSuggestedSetName], 1.1) ?? "";
  } else {
    return;
  }
}
if (!candidate || (current && current.toLowerCase() === candidate.toLowerCase())) {
  return;
}
setIntakeOptional((prev) => ({ ...prev, productLine: candidate }));
setIntakeSuggested((prev) => ({ ...prev, setName: candidate }));
```

Actual priority order:

1. `identifiedSetMatch.setId` if `identifiedSetMatch.confidence !== "none"`
2. keep current value if current case-insensitive matches an existing option
3. `variantScopeSummary.selectedSetId`
4. single-option fallback when `productLineOptions.length === 1`
5. OCR `setName` heuristic via `pickBestCandidate(productLineOptions, [intakeSuggested.setName], 1.1)`
6. otherwise do nothing

Important:
- `identifiedSetId` beats `matchedCurrent`
- so a non-`none` identify-set result can overwrite an already-selected known option

## Part 3: `productLineOptions`, where they come from

### Client fetch

Client fetches:

```ts
fetch(`/api/admin/variants/options?${params.toString()}`)
```

Params:
- always:
  - `year`
  - `manufacturer`
  - `limit=5000`
- optional:
  - `sport`
  - `productLine`
  - `setId`

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:3861-3876`

### Server response shape

The route returns:
- `variants`
- `sets`
- `insertOptions`
- `parallelOptions`
- `source`
- `scope`

- File: `frontend/nextjs-app/pages/api/admin/variants/options.ts:5-47`
- File: `frontend/nextjs-app/pages/api/admin/variants/options.ts:72-91`

### How the client builds `productLineOptions`

```ts
const sets = Array.isArray(payload?.sets)
  ? payload.sets
      .map((entry: { setId?: string }) => sanitizeNullableText(entry?.setId))
      .filter(Boolean)
  : [];

setProductLineOptions(sets);
```

- File: `frontend/nextjs-app/pages/admin/uploads.tsx:3881-3904`

No additional normalization happens on the client beyond trimming and dropping empty values.

### Option format

The format is whatever `pool.sets[].setId` already is on the server:
- in taxonomy-backed mode, `setId` comes from taxonomy rows
- in legacy mode, `setId` comes from `CardVariant.setId`

So `productLineOptions` can legitimately contain values like:
- `2025-26 Topps Basketball`
- `2025-26_Topps_Chrome_Basketball`

The client does not convert between those formats.

## Part 4: The year mapping problem

### Where year scoping happens

Year scoping is in `loadVariantOptionPool(...)`.
- File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:706-964`

Specifically:
- `buildYearHints(year)`
  - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:188-210`
- `setMatchesYear(setId, yearHints, required)`
  - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:225-246`
- `filterScopedSetIds(...)`
  - File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:259-294`

### Exact year-hint logic

If input year is `"2025"`:
- `buildYearHints("2025")` returns `["2025"]`

If input year is `"2025-26"`:
- `buildYearHints("2025-26")` returns hints including:
  - `2025-26`
  - `2025`

### Exact set-year match logic

`setMatchesYear(setId, yearHints, true)` returns true if any year hint passes:

1. `lowerSet.includes(normalizedHint)`
2. if the hint is a 4-digit year, regex match:
   - `new RegExp(`${normalizedHint}\\s*[-/]\\s*\\d{2,4}`)`

- File: `frontend/nextjs-app/lib/server/variantOptionPool.ts:232-245`

### What this means for `2025`

For example, with year input `"2025"`:
- `2024-25_Topps_Chrome_Basketball` => does not contain `2025`, regex does not match => excluded
- `2025-26_Topps_Chrome_Basketball` => contains `2025` => included
- `2025-26_Topps_Basketball` => contains `2025` => included

So there is no code here that maps:
- `"2025"` -> `"2024-25"`

There is only:
- literal substring matching
- 4-digit-year season-prefix regex matching

### Where year mapping does not happen

There is no season-year conversion in:
- `pickBestCandidate()` in `uploads.tsx`
  - File: `frontend/nextjs-app/pages/admin/uploads.tsx:632-677`
- `identifySetByCardIdentity()`
  - File: `frontend/nextjs-app/lib/server/cardSetIdentification.ts:339-744`
- `resolveSetIdByIdentity()`
  - File: `frontend/nextjs-app/lib/server/variantSetScope.ts:60-107`

Conclusion:
- if a `2024-25...` set survives to the final selection while the visible year input is `2025`, that wrong-year set was not produced by a year-conversion helper
- it must have survived in the candidate pool or arrived through a stale/ambiguous upstream set-selection result

## Part 5: `pickBestCandidate()` algorithm

### Definition

- Client copy:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:632-677`
- Server copy:
  - `frontend/nextjs-app/lib/server/variantOptionPool.ts:118-169`

The client and server implementations are the same algorithm.

### Inputs

- `options: string[]`
- `hints: string[]`
- `minScore = 0.8` by default

### Output

- returns the single best option string
- returns `null` if the best score is below `minScore`

### Scoring algorithm

For each option and each hint:
- exact case-insensitive full-string match => `+1.5`
- exact normalized token-key match => `+1.2`
- substring containment either direction => `+0.9`
- each shared token => `+0.25`

Normalization helper:
- `normalizeVariantLabelKey(...)`
- lowercases, tokenizes, removes `"the"`, rejoins tokens

### Threshold use in Product Set selection

Product Set calls use:
- `1.1` in `applySuggestions()`
- `1.1` in the auto-selection OCR heuristic branch

Insert/parallel calls use:
- `0.6`

### Concrete walkthrough

Example:
- options:
  - `2024-25_Topps_Chrome_Basketball`
  - `2025-26_Topps_Chrome_Basketball`
  - `2025-26_Topps_Basketball`
- hint:
  - `Topps Chrome Basketball`

Per-option behavior:
- both Chrome options share `topps`, `chrome`, `basketball`
- both get the same token-overlap score from that single weak hint
- there is no year bonus unless the hint itself includes a year
- if scores tie, the algorithm keeps whichever option appeared first in the input array

So:
- weak hints depend heavily on the order of `productLineOptions`
- strong hints with year tokens reduce that risk

## Why the Wrong Set Gets Selected

Based on the traced code, the wrong Product Set is not most likely caused by `pickBestCandidate()` itself.

Code-based conclusion:

1. `applySuggestions()` is relatively safe for Product Set when it has:
   - `suggestions.setName`
   - `year`
   - `manufacturer`
   - `sport`
   - a loaded `productLineOptions` list

2. The later OCR heuristic fallback is weaker than `applySuggestions()` because it only uses:
   - `pickBestCandidate(productLineOptions, [intakeSuggested.setName], 1.1)`
   - no extra year/manufacturer/sport hint

3. The Product Set auto-selection effect gives absolute priority to `identifiedSetMatch.setId`.
   - If identify-set returns a set, that branch runs before:
     - keeping current value
     - scope fallback
     - single-option
     - OCR heuristic

4. The identify-set request key omits:
   - `teamName`
   - `insertSet`
   - `frontCardText`
   - `combinedText`

   But the server uses those fields to score/tiebreak candidates.

5. The server-side normal `SetCard` identify-set path does not fail closed on unresolved ties.
   - It still returns a winning set with:
     - `confidence: "exact"` or `"fuzzy"`
     - `reason: "ambiguous_post_tiebreak_first_candidate"`
   - In that tie case, sort order falls through to lexical `setId` order.

6. Therefore the exact failure mode is:
   - identify-set can make an early or under-informed choice
   - later OCR evidence that should break the tie may not trigger a re-request
   - the UI treats that identify-set answer as authoritative and writes it into `intakeOptional.productLine`

High-confidence conclusion:
- the most dangerous branch is Path B, not Path A
- there is no code that maps visible year `2025` to season `2024-25`
- if `2024-25_Topps_Chrome_Basketball` is winning over `2025-26_Topps_Chrome_Basketball`, the wrong-year set is already surviving into the identify-set or option-pool candidate set, and once `identifiedSetMatch.setId` exists, the UI will prefer it over everything else

## Files traced

- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/identify-set.ts`
- `frontend/nextjs-app/lib/server/cardSetIdentification.ts`
- `frontend/nextjs-app/pages/api/admin/variants/options.ts`
- `frontend/nextjs-app/lib/server/variantOptionPool.ts`
- `frontend/nextjs-app/lib/server/variantSetScope.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
