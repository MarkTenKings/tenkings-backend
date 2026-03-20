# Task 16 Analysis: Add Cards Screen 2 Stuck Prefetch + KingsReview Send Failure

Date: 2026-03-20

Scope:
- code-trace analysis only
- based on current `main`
- no deploy/restart/migration/runtime mutation performed before this write-up

## Files Read First
- `AGENTS.md`
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`
- `frontend/nextjs-app/pages/admin/uploads.tsx`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts`
- `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`
- `frontend/nextjs-app/lib/server/cors.ts`

## Answers Before Coding

### 1. Does the pre-fetch API call actually fire when Product Set is selected?

Yes, in current code the intended trigger exists.

Client effect:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3069-3144`
- It watches:
  - `intakeCardId`
  - `variantScopeSummary?.selectedSetId`
  - `intakeOptional.productLine`
  - `intakeOptional.cardNumber`
  - required intake taxonomy inputs
  - `teachLayoutClass`
- When a scoped Product Set is available it:
  - builds a stable `prefetchKey`
  - clears untouched `insertSet` / `parallel`
  - sets `screen2PrefetchStatus = "loading"`
  - calls `fetchOcrSuggestions(intakeCardId, { purpose: "product_set_prefetch", hintProductLine, hintCardNumber })`

Conclusion:
- the effect is present and should fire
- the bug is not “missing trigger code”
- the more likely failure is transport/state handling after the trigger

### 2. What endpoint and params does the pre-fetch call use?

Client caller:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2907-3053`

Current request path:
- `/api/admin/cards/${cardId}/ocr-suggest?...`

Current query params:
- `year`
- `manufacturer`
- `sport`
- `productLine`
- `setId`
- `cardNumber`
- `layoutClass`

Server handler:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts:2674-3565`

Current response shape:
- success: `{ suggestions, threshold, audit, status: "ok" }`
- pending: `{ suggestions: {}, threshold, audit, status: "pending" }`
- error: `{ message }`

### 3. What does the pre-fetch currently return/do, and why can Loading get stuck forever?

The current client retry/state logic is incomplete.

Observed client behavior:
- `fetchOcrSuggestions(...)` sets `screen2PrefetchStatus = "loading"` for product-set prefetch
- if the API returns `status: "pending"`, it retries up to 6 times
- after the last retry, it simply returns without clearing `screen2PrefetchStatus`

Relevant code:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2940-3002`

That means:
- if `/ocr-suggest` keeps returning `pending` because OCR/LLM/photo readiness is not done yet
- or if the route is unreachable from the current admin origin path
- Screen 2 stays on:
  - `Loading insert suggestion...`
  - `Loading parallel suggestion...`
  forever

UI evidence in code:
- `frontend/nextjs-app/pages/admin/uploads.tsx:5543-5603`
- only `screen2PrefetchStatus === "error"` shows:
  - `Insert suggestion unavailable`
  - `Parallel suggestion unavailable`
- there is no exhausted-pending timeout fallback state

### 4. What transport/API problems exist in the current pre-fetch path?

There are two concrete issues in the current code path.

Issue A:
- `fetchOcrSuggestions(...)` does not use `resolveApiUrl(...)`
- unlike the rest of the remote-admin API calls in `uploads.tsx`, it fetches a raw relative path
- current code:
  - `frontend/nextjs-app/pages/admin/uploads.tsx:2969-2974`

Issue B:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId]/ocr-suggest.ts` is not wrapped with `withAdminCors(...)`
- unlike:
  - `pages/api/admin/cards/[cardId].ts`
  - `pages/api/admin/kingsreview/enqueue.ts`
  - `pages/api/admin/cards/[cardId]/photoroom.ts`

Why that matters:
- remote/mobile admin use can send `Authorization` cross-origin
- a cross-origin GET with `Authorization` requires valid CORS handling
- without `withAdminCors(...)`, the browser can fail the request before the route runs

Conclusion:
- Bug A is explained by a combination of:
  - raw relative request path instead of `resolveApiUrl(...)`
  - missing CORS wrapper on `/ocr-suggest`
  - no fallback when `pending` never settles

### 5. Does the pre-fetch response map into the Screen 2 fields?

Yes, that mapping exists already.

Client application path:
- `syncOptionalFieldsFromOcrAudit(...)`
- `applySuggestions(...)`
- both are called from `fetchOcrSuggestions(...)`

Relevant section:
- `frontend/nextjs-app/pages/admin/uploads.tsx:3003-3028`

Conclusion:
- the missing piece is not field mapping
- it is transport reliability and terminal-state handling

### 6. What endpoint does “Send to KingsReview AI” call? What payload?

The client does two important network calls in sequence:

First:
- `PATCH /api/admin/cards/${intakeCardId}`
- called by `saveIntakeMetadata(true, recordOcrFeedback)`
- payload:
  - `classificationUpdates.attributes`
  - `classificationUpdates.normalized`
  - `recordOcrFeedback`

Relevant code:
- `frontend/nextjs-app/pages/admin/uploads.tsx:2094-2187`

Second:
- `POST /api/admin/kingsreview/enqueue`
- payload:
  - `cardAssetId`
  - `query`
  - `sources`
  - `categoryType`

Relevant code:
- `frontend/nextjs-app/pages/admin/uploads.tsx:4650-4671`

### 7. What does the send endpoint return when called?

From server code:

`PATCH /api/admin/cards/[cardId]`
- `200` with updated card JSON
- `400` if no fields or bad stage/valuation state
- `404` if card not found
- `405` if wrong method
- wrapped with `withAdminCors(...)`

`POST /api/admin/kingsreview/enqueue`
- `200` with `{ job }`
- `400` if `query` missing or required photos missing
- `404` if card missing
- `405` if wrong method
- wrapped with `withAdminCors(...)`

Relevant files:
- `frontend/nextjs-app/pages/api/admin/cards/[cardId].ts`
- `frontend/nextjs-app/pages/api/admin/kingsreview/enqueue.ts`

Important implication:
- the red banner text `Network request to the admin API failed...` only appears when the browser throws before a usable HTTP response is processed
- that is transport failure, not a normal server JSON error

### 8. What is the strongest current explanation for the KingsReview send failure?

The strongest code-based explanation is transport contention around the fire-and-forget PhotoRoom request, not a broken enqueue payload shape.

Current send order:
1. save metadata
2. start `triggerPhotoroomForCard(sendingCardId)` immediately
3. then call `POST /api/admin/kingsreview/enqueue`

Relevant code:
- `frontend/nextjs-app/pages/admin/uploads.tsx:4639-4671`

Existing handoff evidence already points here:
- `docs/handoffs/SESSION_LOG.md:10888-10906`
- prior note says the likely remaining source of transient network failures is PhotoRoom request duration/resource pressure, not an uncaught exception in enqueue

Why this is credible:
- `pages/api/admin/cards/[cardId].ts` already has CORS
- `pages/api/admin/kingsreview/enqueue.ts` already has CORS
- `handleSendToKingsReview(...)` still starts a second heavy admin API request immediately before enqueue
- that creates unnecessary transport/serverless contention in the critical user path

Conclusion:
- the safe fix is to stop competing with the enqueue request
- enqueue should remain the critical path
- PhotoRoom should be deferred until after enqueue succeeds

## Planned Fix

### Bug A
- update `fetchOcrSuggestions(...)` to use `resolveApiUrl(...)`
- set `mode: isRemoteApi ? "cors" : "same-origin"` on OCR suggest fetches
- wrap `pages/api/admin/cards/[cardId]/ocr-suggest.ts` with `withAdminCors(...)`
- add terminal fallback when the prefetch remains `pending` after retries / timeout
- log scoped prefetch failures to console for future debugging

### Bug B
- keep the current save + enqueue API contract
- preserve KingsReview and intake metadata behavior
- move the background PhotoRoom trigger off the critical path so it starts only after enqueue succeeds
- add clearer console logging around send-stage transport failures

## Constraints Preserved
- do not undo Task 10 Screen 1 Product Set speed improvement
- do not remove Task 10b scoped prefetch architecture
- do not change KingsReview queue logic itself
- do not change photo capture/upload flow
- do not touch pack recipes or assigned locations code
- do not remove variant explainability
