# Task 23 Diagnostic: Product Set Auto-Selection Regression

Date: `2026-04-02`
Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
Branch: `main`
Working baseline: `6bc33fe`
Current HEAD at diagnostic start: `2eeb20e`
Pull status: `git pull --ff-only origin main` -> `Already up to date.`

## Executive Summary

Task 22 did **not** directly change the identify-set algorithm, the Product Set auto-selection effect, `applySuggestions`, `productLineOptions`, `variantScopeSummary`, or the Screen 2 prefetch logic.

What it **did** change was the intake/upload timing:

1. it added network retry wrappers around front/back upload requests
2. it moved review-stage completion to `/api/admin/uploads/complete`
3. it serialized `finalizeCapturedCardInBackground(...)` with `backgroundFinalizeQueueRef`
4. it delayed `openIntakeCapture("front")` until the prior card’s `frontUploadPromise` settled

Those timing changes make it much more likely that a queued card is opened for OCR review **before** `warmOcrSuggestionsInBackground(...)` has produced saved OCR suggestions.

That exposes an existing race in `uploads.tsx`:

- `loadQueuedCardForReview(...)` hydrates the form from coarse `classification` / `normalized` data and sets:
  - `ocrStatus = "empty"`
  - `pendingAutoOcrCardId = cardId`
- on the next effect flush, the pending-auto-OCR effect and the identify-set effect both run from the same render
- the pending-auto-OCR effect starts OCR, but the identify-set effect still sees render-time `ocrStatus === "empty"` and can fire once using the weaker pre-OCR inputs
- when that early identify call returns a wrong but non-`none` set, the Product Set auto-selection effect gives it highest priority and writes `intakeOptional.productLine`
- later OCR suggestions do **not** overwrite that field because `applySuggestions(...)` only fills `productLine` when it is still blank

That is the most specific cause of the regression observed after Task 22.

## Step 1: Diff Review of `uploads.tsx`

Command run:

```bash
git diff 6bc33fe..2eeb20e -- frontend/nextjs-app/pages/admin/uploads.tsx
```

### Relevant diff hunk 1: new module-scope retry helper

```diff
+const RETRYABLE_REQUEST_ERROR_PATTERN = /load failed|failed to fetch|network request failed/i;
+const isRetryableRequestError = (error: unknown): error is Error =>
+  error instanceof Error && RETRYABLE_REQUEST_ERROR_PATTERN.test(error.message);
+const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
+const fetchWithNetworkRetry = async (url: string, init: RequestInit, label: string) => {
+  for (let attempt = 0; attempt < 2; attempt += 1) {
+    try {
+      return await fetch(url, init);
+    } catch (error) {
+      if (!isRetryableRequestError(error) || attempt === 1) {
+        throw error;
+      }
+      await waitFor(350 * (attempt + 1));
+    }
+  }
+  throw new Error(`${label} failed`);
+};
```

Impact on identify/auto-selection flow:

- This does **not** touch `identifiedSetMatch`, `productLineOptions`, `variantScopeSummary`, `applySuggestions`, or any Product Set selection logic.
- Moving this helper to module scope does **not** change any React closure captures. It only depends on `url`, `init`, `label`, and global `fetch`.
- It **can** add front-upload / photo-upload latency on transient failures, which increases the chance that OCR warm-up is still missing when the operator opens a queued card.
- Conclusion: secondary timing amplifier, not the direct logic change.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:595-620`

### Relevant diff hunk 2: new background finalize queue ref

```diff
+  const backgroundFinalizeQueueRef = useRef<Promise<void>>(Promise.resolve());
```

Impact:

- This is the first structural change that can affect OCR readiness timing.
- It does not directly set Product Set state, but it introduces serialized background finalization for captured cards.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:862`

### Relevant diff hunk 3: front upload flow now uses retry helper and sends `reviewStage` on complete

```diff
-      const presignRes = await fetch(resolveApiUrl("/api/admin/uploads/presign"), {
+      const presignRes = await fetchWithNetworkRetry(resolveApiUrl("/api/admin/uploads/presign"), {
...
          reviewStage: ADD_CARD_INTAKE_REVIEW_STAGE,
...
-      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
+      const uploadRes = await fetchWithNetworkRetry(resolveApiUrl(presignPayload.uploadUrl), {
...
-      const completeRes = await fetch(resolveApiUrl("/api/admin/uploads/complete"), {
+      const completeRes = await fetchWithNetworkRetry(resolveApiUrl("/api/admin/uploads/complete"), {
...
+          reviewStage: ADD_CARD_INTAKE_REVIEW_STAGE,
```

Impact:

- `uploadCardAsset(...)` still resolves only after presign, PUT upload, and `complete` all succeed.
- `confirmIntakeCapture("front", ...)` still sets `intakeCardId` only after that promise resolves.
- No identify-set inputs are changed here directly.
- This can delay `frontUploadPromise` settlement and therefore affect downstream background-finalization timing.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:1931-2021`

### Relevant diff hunk 4: `ensureFrontAssetQueued(...)` now retries and passes `reviewStage`

```diff
-          body: JSON.stringify({ assetId }),
+          body: JSON.stringify({ assetId, reviewStage: ADD_CARD_INTAKE_REVIEW_STAGE }),
```

Impact:

- This only runs on the recovery path when `frontUploadPromise` rejects with a recoverable `assetId`.
- It does not feed any identify-set or Product Set selection state on the client.
- No direct auto-selection effect.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2026-2048`

### Relevant diff hunk 5: back/tilt upload path now uses retry helper

```diff
-      const presignRes = await fetch(resolveApiUrl("/api/admin/kingsreview/photos/presign"), {
+      const presignRes = await fetchWithNetworkRetry(resolveApiUrl("/api/admin/kingsreview/photos/presign"), {
...
-      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
+      const uploadRes = await fetchWithNetworkRetry(resolveApiUrl(presignPayload.uploadUrl), {
```

Impact:

- No direct identify-set logic change.
- Can delay `BACK` / `TILT` readiness and therefore delay when `warmOcrSuggestionsInBackground(...)` starts producing persisted OCR suggestions.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2097-2148`

### Relevant diff hunk 6: serialized background finalize

```diff
+  const enqueueCapturedCardFinalize = useCallback(
+    (params) => {
+      const next = backgroundFinalizeQueueRef.current
+        .catch(() => undefined)
+        .then(() => finalizeCapturedCardInBackground(params));
+      backgroundFinalizeQueueRef.current = next.catch((error) => {
+        console.warn("[admin/uploads] Background finalize queue failed", error);
+      });
+      return next;
+    },
+    [finalizeCapturedCardInBackground]
+  );
```

Impact:

- This is the main Task 22 change that affects Product Set correctness indirectly.
- Before Task 22, each captured card’s background finalize started immediately.
- After Task 22, card N+1 cannot begin its background finalize until card N’s finalize promise resolves.
- Since `finalizeCapturedCardInBackground(...)` performs:
  - back upload
  - tilt upload
  - queue insertion
  - `warmOcrSuggestionsInBackground(targetCardId)`
- later cards reach OCR review with missing saved OCR suggestions much more often.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3519-3535`

### Relevant diff hunk 7: `confirmIntakeCapture(...)` changed

```diff
-          void finalizeCapturedCardInBackground({
+          void enqueueCapturedCardFinalize({
...
-          void openIntakeCapture("front");
+          void (async () => {
+            try {
+              if (backgroundFrontUploadPromise) {
+                await backgroundFrontUploadPromise.catch(() => undefined);
+              }
+              await openIntakeCapture("front");
+            } catch (error) {
+              console.warn("[admin/uploads] Failed to reopen intake capture after background finalize", error);
+            }
+          })();
```

Impact:

- `clearActiveIntakeState()` still runs immediately, so this does **not** create a new stale Product Set state leak by itself.
- It **does** reduce overlap between the current card’s teardown and the next card’s camera startup.
- Combined with the serialized finalize queue, it stretches the time window in which later cards may exist in the queue without warmed OCR suggestions.

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3593-3613`

### Explicitly unchanged between `6bc33fe` and `2eeb20e`

There is **no diff** in the following `uploads.tsx` logic between the working and broken commits:

1. `identifiedSetMatch` state declaration
2. the identify-set `useEffect(...)` that calls `fetchIdentifiedSetMatch(...)`
3. the Product Set auto-selection `useEffect(...)`
4. `productLineOptions` state and its options-loading effect
5. `variantScopeSummary` resolution
6. `applySuggestions(...)`, including the `constrainedProductLine` block
7. `ocrStatus` transitions inside `fetchOcrSuggestions(...)`
8. the Screen 2 prefetch trigger that uses `scopedScreen2ProductSetId`

This means the regression is not from a direct code edit to the selection logic itself.

## Step 2: `reviewStage` Timing Check

### Frontend usage

`uploads.tsx` only **writes** `reviewStage` into request bodies:

- front presign request: `uploads.tsx:1938-1944`
- front complete request: `uploads.tsx:2003-2010`
- recovery complete request: `uploads.tsx:2033-2042`

The frontend does **not** read `reviewStage` from:

- the presign response
- the complete response
- any React state
- any `useEffect(...)` dependency

### Server changes

Task 22 changed:

- `pages/api/admin/uploads/presign.ts` so the new `CardAsset` is created without `reviewStage`
- `pages/api/admin/uploads/complete.ts` so `reviewStage` is assigned only on successful completion

Relevant server lines now:

- `frontend/nextjs-app/pages/api/admin/uploads/presign.ts:114-126`
- `frontend/nextjs-app/pages/api/admin/uploads/complete.ts:67-85`
- `frontend/nextjs-app/pages/api/admin/uploads/complete.ts:138-175`

Conclusion:

- `reviewStage` timing does **not** directly affect Screen 1 Product Set auto-selection.
- It changes queue visibility and upload finalization semantics, but there is no frontend `reviewStage` dependency in the identify-set path.

## Step 3: Background Finalization Serialization Check

### What `finalizeCapturedCardInBackground(...)` actually does

Current code:

- waits for or recovers the front asset id
- uploads `BACK`
- uploads `TILT`
- adds the card id to `queuedReviewCardIds`
- fires `warmOcrSuggestionsInBackground(targetCardId)`
- refreshes OCR queue ids

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3456-3516`

What it does **not** do:

- it does not set `identifiedSetMatch`
- it does not set `intakeOptional.productLine`
- it does not set `productLineOptions`
- it does not set `variantScopeSummary`
- it does not directly set `ocrStatus`

### Why it still matters

It controls **when** a card becomes OCR-ready.

Before Task 22:

- every tilt confirm kicked off `finalizeCapturedCardInBackground(...)` immediately
- multiple cards could finalize in overlapping background work

After Task 22:

- `enqueueCapturedCardFinalize(...)` forces these finalizations to run one after another
- later cards wait longer before:
  - `BACK`/`TILT` are uploaded
  - `warmOcrSuggestionsInBackground(...)` starts
  - persisted OCR suggestions exist

That is the timing change that exposes the identify-set race.

## Step 4: `confirmIntakeCapture(...)` Check

### What changed

Task 22 changed only the tilt-complete branch:

- `finalizeCapturedCardInBackground(...)` -> `enqueueCapturedCardFinalize(...)`
- `openIntakeCapture("front")` is now deferred until `backgroundFrontUploadPromise` settles

### What did not change

- `intakeCardId` for the active card is still set only when `frontUploadPromise` resolves:
  - `uploads.tsx:3560-3567`
- `clearActiveIntakeState()` still wipes:
  - OCR state
  - `identifiedSetMatch`
  - `intakeOptional.productLine`
  - `productLineOptions`
  - `variantScopeSummary`

### Diagnostic conclusion

- This change does **not** alter the Product Set auto-selection effect directly.
- It does affect pacing:
  - later cards start their next capture later
  - later cards also finalize later because the finalize queue is serialized
- The meaningful regression is therefore not “new stale state from `confirmIntakeCapture`”, but “different OCR readiness timing before review load.”

## Step 5: `fetchWithNetworkRetry` Scope Change

### Closure check

Moving `fetchWithNetworkRetry(...)` to module scope does **not** change captured values because the helper does not close over component state.

It takes everything it needs as arguments:

- `url`
- `init`
- `label`

So there is no closure regression such as reading stale `session`, stale `intakeOptional.productLine`, or stale `resolveApiUrl`.

### Real effect

The real effect is timing:

- presign/upload/complete can now take longer when a retry happens
- later background work can begin later

Conclusion:

- no closure bug
- only a secondary latency contributor

## Additional Verification: Server Identify/OCR Code Did Not Change

There are **no file changes** between `6bc33fe` and `2eeb20e` in:

- `frontend/nextjs-app/pages/api/admin/cards/identify-set.ts`
- `frontend/nextjs-app/lib/server/cardSetIdentification.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`

That confirms the server-side identify-set / OCR logic was not rewritten by Task 22.

## Step 6: Exact Execution Flow Comparison

## Before Task 22 (`6bc33fe`) - working behavior

### Capture and upload flow

1. Camera capture completes for `front`.
2. `confirmIntakeCapture("front", ...)` starts `uploadCardAsset(file)`.
3. `uploadCardAsset(...)` does:
   - `/api/admin/uploads/presign`
   - front PUT upload
   - `/api/admin/uploads/complete`
4. When `frontUploadPromise` resolves, `setIntakeCardId(presign.assetId)` and `setIntakeBatchId(...)` run.
5. Camera capture completes for `back`, then `tilt`.
6. On `tilt`, `confirmIntakeCapture("tilt", ...)` immediately fires `finalizeCapturedCardInBackground(...)`, then clears intake state, closes camera, and immediately reopens front capture for the next card.
7. `finalizeCapturedCardInBackground(...)` uploads `BACK` and `TILT`, adds the card to `queuedReviewCardIds`, and fires `warmOcrSuggestionsInBackground(targetCardId)`.

### Review/OCR/identify flow

8. Operator opens OCR review for a queued card.
9. `loadQueuedCardForReview(...)` hydrates form state. In the working path, persisted OCR suggestions are often already present, so:
   - `existingOcrAudit` exists
   - `ocrStatus` becomes `"ready"`
   - fields are hydrated from OCR-backed values, not just coarse normalized/classification fallbacks
10. The identify-set effect runs with OCR-backed `year`, `manufacturer`, `sport`, `playerName`, and `cardNumber`.
11. The Product Set auto-selection effect prefers `identifiedSetMatch` first, then scope/single-option/OCR heuristic. Because identify inputs are already grounded, the selected Product Set is usually correct.
12. Screen 2 prefetch uses the resolved Product Set.

## After Task 22 (`2eeb20e`) - broken behavior

### Capture and upload flow

1. Camera capture completes for `front`.
2. `confirmIntakeCapture("front", ...)` starts `uploadCardAsset(file)`.
3. `uploadCardAsset(...)` still does presign -> PUT -> complete, but now:
   - uses `fetchWithNetworkRetry(...)`
   - includes `reviewStage` in the complete request
4. `setIntakeCardId(...)` still waits for `frontUploadPromise` resolution.
5. Camera capture completes for `back`, then `tilt`.
6. On `tilt`, `confirmIntakeCapture("tilt", ...)` now:
   - calls `enqueueCapturedCardFinalize(...)`
   - clears intake state
   - closes camera
   - waits for `backgroundFrontUploadPromise` before reopening front capture
7. Because `enqueueCapturedCardFinalize(...)` serializes work, later cards wait longer before:
   - `BACK` / `TILT` upload
   - queue insertion
   - `warmOcrSuggestionsInBackground(...)`

### Review/OCR/identify flow

8. Operator opens OCR review for a queued card more often **before** persisted OCR suggestions exist.
9. `loadQueuedCardForReview(...)` hydrates:
   - `playerName`, `sport`, `manufacturer`, `year`, `cardNumber` from `ocrFields ?? classification ?? normalized`
   - `productLine` from `resolveHydratedProductLine(...)`
   - `ocrStatus = "empty"` when `existingOcrAudit` is missing
   - `pendingAutoOcrCardId = cardId`
10. On the next effect flush:
    - the pending-auto-OCR effect at `uploads.tsx:3260-3272` starts OCR
    - the identify-set effect at `uploads.tsx:4066-4132` still sees the render-time `ocrStatus === "empty"` and can fire **before OCR-backed corrections land**
11. That identify call uses weaker pre-OCR inputs and can return:
    - wrong high-confidence set
    - or low-confidence / `none`
12. The Product Set auto-selection effect at `uploads.tsx:2515-2573` gives that `identifiedSetMatch` highest priority and writes `intakeOptional.productLine`.
13. Later OCR suggestions do not dislodge the wrong set because:
    - `applySuggestions(...)` only writes `productLine` when `prev.productLine` is blank
    - see `uploads.tsx:2832-2844`
14. Once `productLine` is filled with a known option, the auto-selection effect returns early on `matchedCurrent`, so the wrong set tends to stick.
15. Screen 2 prefetch then runs using the wrong Product Set id.

## Why the Wrong Value Sticks

Two unchanged pieces of logic explain persistence once the early identify-set result is wrong:

1. `applySuggestions(...)` only sets `productLine` when the field is still empty:

```ts
if (constrainedProductLine && !intakeOptionalTouched.productLine && !prev.productLine.trim()) {
  next.productLine = constrainedProductLine;
}
```

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2832-2844`

2. The Product Set auto-selection effect returns if the current `productLine` already matches a known option:

```ts
} else if (matchedCurrent) {
  return;
}
```

Current location:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2527-2556`

So once a wrong identify-set result fills `productLine`, later OCR-corrected values have a very hard time replacing it.

## Conclusion

### Most likely specific regression cause

The regression was caused by **Task 22’s background-finalization timing changes**, especially:

1. `backgroundFinalizeQueueRef` + `enqueueCapturedCardFinalize(...)`
2. the new delayed reopen path in `confirmIntakeCapture(...)`
3. secondarily, added retry latency around presign/upload/complete

These changes did **not** break the identify-set logic itself. They changed when OCR is likely to be ready relative to when the operator opens a queued card.

That timing change exposed an existing race:

- queued card loads with `ocrStatus = "empty"`
- auto OCR is scheduled
- identify-set still runs once in the same effect flush using weaker pre-OCR values
- wrong identify result wins the auto-selection priority chain
- later OCR cannot overwrite a now-populated `productLine`

### Why this matches the reported symptoms

- Rick Barry resolving to `2024-25_Topps_Chrome_Basketball` instead of `2025-26` is consistent with identify-set firing before OCR-corrected year/set grounding is applied.
- Noah Clowney resolving to an unrelated Overtime Elite set is consistent with the same early identify-set request using weaker normalized/classification inputs.
- Devin Vassell staying `Unknown: low confidence` is also consistent with the early identify-set call happening before stronger OCR-backed context is available.

## Recommended Fix Approach (describe only, do not implement)

### Primary fix

Prevent the identify-set effect from firing on queue-loaded cards until the queued auto-OCR cycle has settled.

Practical options:

1. In `loadQueuedCardForReview(...)`, when `pendingAutoOcrCardId` is set, initialize `ocrStatus` as `"pending"` instead of `"empty"`.
   - That would make the identify-set effect’s existing guard (`ocrStatus === "running" || "pending"`) block the early request.

2. Or explicitly gate the identify-set effect on `pendingAutoOcrCardId`.
   - If the active card still has pending auto OCR, do not issue identify-set yet.

3. Or gate identify-set on presence of OCR-backed inputs for the active card rather than only the field tuple.
   - This is stricter, but conceptually safer.

### Secondary hardening

1. Allow OCR-backed suggestions to replace an auto-filled `productLine` when the current value came from identify-set and has not been manually touched.
2. Record the source of the current Product Set value (`ocr`, `identify`, `manual`, `scope`) so later higher-quality sources can replace lower-quality automatic ones.
3. Consider warming OCR as early as possible for just-finished cards even if later background finalizers are queued.

### What not to change first

- Do not start by rewriting `identify-set.ts` or `cardSetIdentification.ts`.
- Do not start by changing `productLineOptions` or `variantScopeSummary`.
- Those paths are unchanged across the working and broken commits and are not the primary regression source.
