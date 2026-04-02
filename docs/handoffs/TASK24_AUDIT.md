# Task 24 Audit: Add Cards Capture-to-OCR-Queue Pipeline

- Repo: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
- Branch: `main`
- HEAD audited: `4b9dee6`
- Scope: current HEAD only. No history, no DB queries, no deploy/restart/migration.
- Primary client file: `frontend/nextjs-app/pages/admin/uploads.tsx`

## 1. Step-by-Step Flow Trace

### Phase 1: Front Photo Capture and Upload

1. User clicks `Add Card`.
   - UI entry point: `onClick={() => void openIntakeCapture("front")}` at `uploads.tsx:5434-5440`.
   - `openIntakeCapture("front")` sets `intakeCaptureTarget`, clears `intakeError`, and awaits `openCamera()` at `uploads.tsx:1803-1808`.

2. Camera capture callback runs.
   - `handleCapture()` is the live camera callback at `uploads.tsx:3634-3680`.
   - It draws the current video frame to canvas, turns it into a JPEG blob, vibrates, flashes, and then checks `intakeCaptureTarget` at `uploads.tsx:3651-3673`.
   - Because intake capture always sets `intakeCaptureTarget`, `handleCapture()` immediately calls `confirmIntakeCapture(intakeCaptureTarget, blob)` at `uploads.tsx:3671-3673`.
   - `handleConfirmCapture()` exists at `uploads.tsx:3682-3701`, but for the Add Cards intake path it also just forwards to `confirmIntakeCapture(...)` whenever `intakeCaptureTarget` is set.

3. Front blob handling starts in `confirmIntakeCapture("front", blob)`.
   - Front path: `uploads.tsx:3546-3578`.
   - It:
     - clears `pendingBackBlob` and `pendingTiltBlob` at `uploads.tsx:3547-3548`
     - sets `intakePhotoBusy=true` at `uploads.tsx:3549`
     - sets `intakeFrontPreview` from `URL.createObjectURL(blob)` at `uploads.tsx:3550`
     - clears front CDN URLs at `uploads.tsx:3551-3552`
     - advances `intakeStep` to `"back"` at `uploads.tsx:3553`
     - retargets camera capture to `"back"` at `uploads.tsx:3554`
     - creates `frontUploadPromise = uploadCardAsset(file)` and stores it in `activeFrontUploadRef.current` at `uploads.tsx:3555-3558`

4. `uploadCardAsset()` is the front-image upload pipeline.
   - Definition: `uploads.tsx:1923-2024`.
   - Step by step:
     - requires `session?.token` at `uploads.tsx:1925-1928`
     - POSTs `/api/admin/uploads/presign` with `fileName`, `size`, `mimeType`, and `reviewStage: "READY_FOR_HUMAN_REVIEW"` at `uploads.tsx:1931-1944`
     - expects `assetId`, `batchId`, `uploadUrl`, `publicUrl`, `storageMode`, and optional `acl` at `uploads.tsx:1951-1959`
     - validates `storageMode` at `uploads.tsx:1961-1967`
     - PUTs the file to the returned `uploadUrl` at `uploads.tsx:1978-1985`
     - on PUT failure, throws an `IntakeFrontUploadError` carrying `assetId`, `batchId`, and `stage: "upload"` at `uploads.tsx:1987-1994`
     - POSTs `/api/admin/uploads/complete` with `assetId`, file metadata, and the same review stage at `uploads.tsx:1996-2010`
     - on complete failure, throws an `IntakeFrontUploadError` carrying `assetId`, `batchId`, and `stage: "complete"` at `uploads.tsx:2012-2019`
     - returns the presign payload at `uploads.tsx:2021`

5. Front upload success state.
   - The detached async block inside `confirmIntakeCapture("front", ...)` awaits `frontUploadPromise` at `uploads.tsx:3559-3566`.
   - On success it sets:
     - `intakeCardId = presign.assetId` at `uploads.tsx:3565`
     - `intakeBatchId = presign.batchId` at `uploads.tsx:3566`
   - Note the UI had already advanced to `back` before the upload finished at `uploads.tsx:3553-3554`.

6. Front upload failure behavior.
   - In the same async block, front upload failure sets `intakeError` at `uploads.tsx:3567-3573`.
   - `intakePhotoBusy` is cleared in `finally` at `uploads.tsx:3574-3576`.
   - The UI does not revert to `front`; it stays on `back`, because step/target were advanced before the upload resolved at `uploads.tsx:3553-3554`.
   - Recovery later depends on the thrown error shape:
     - upload/complete failures include `assetId` and are partially recoverable
     - a pure presign failure has no `assetId`, so background recovery cannot reconstruct a card id later

7. Front upload API behavior.
   - `/api/admin/uploads/presign` creates the `CardAsset` row immediately with:
     - `status = UPLOADING`
     - `imageUrl = publicUrlFor(storageKey)`
     - no `reviewStage` assignment yet
     - file: `frontend/nextjs-app/pages/api/admin/uploads/presign.ts:95-147`
   - `/api/admin/uploads/complete` is what actually:
     - validates storage readability
     - generates thumbnail/CDN variants
     - sets `status = READY`
     - sets `reviewStage = resolvedReviewStage`
     - file: `frontend/nextjs-app/pages/api/admin/uploads/complete.ts:127-178`
   - If storage is still unreadable, `/complete` resets the asset to `status = UPLOADING`, clears `reviewStage`, and returns `409` at `frontend/nextjs-app/pages/api/admin/uploads/complete.ts:137-151`.

### Phase 2: Back and Tilt Capture

8. After front capture, the camera does not explicitly close and reopen for BACK.
   - Normal flow is still inside the same open camera session.
   - What changes is `intakeStep="back"` and `intakeCaptureTarget="back"` at `uploads.tsx:3553-3554`.
   - Because `confirmIntakeCapture("front", ...)` does not call `closeCamera()`, the next `handleCapture()` run is automatically treated as the BACK capture.

9. BACK capture stores the blob; it does not upload immediately.
   - BACK path: `uploads.tsx:3579-3585`.
   - It:
     - sets `intakeBackPreview` from the blob at `uploads.tsx:3580`
     - clears back CDN URLs at `uploads.tsx:3581-3582`
     - stores the raw blob in `pendingBackBlob` at `uploads.tsx:3583`
     - advances `intakeStep` to `"tilt"` at `uploads.tsx:3584`
     - retargets the next camera capture to `"tilt"` at `uploads.tsx:3585`
   - There is no upload call in the BACK branch.

10. TILT capture runs `confirmIntakeCapture("tilt", blob)`.
   - Trigger path: `handleCapture()` -> `confirmIntakeCapture(intakeCaptureTarget, blob)` at `uploads.tsx:3671-3673`.
   - Tilt branch: `uploads.tsx:3586-3612`.

11. `confirmIntakeCapture("tilt", ...)` line-by-line.
   - `setIntakeTiltPreview(...)` at `uploads.tsx:3587`
   - clear tilt CDN URLs at `uploads.tsx:3588-3589`
   - `setPendingTiltBlob(blob)` at `uploads.tsx:3590`
   - `setIntakeCaptureTarget(null)` at `uploads.tsx:3591`
   - snapshot current state into local variables:
     - `backgroundCardId = intakeCardId` at `uploads.tsx:3592`
     - `backgroundFrontUploadPromise = activeFrontUploadRef.current` at `uploads.tsx:3593`
     - `backgroundBackBlob = pendingBackBlob` at `uploads.tsx:3594`
   - enqueue background finalization with those snapshots plus the current tilt blob at `uploads.tsx:3595-3600`
   - immediately clear active intake state at `uploads.tsx:3601`
   - immediately close the camera at `uploads.tsx:3602`
   - then, in a detached async block:
     - wait for the front upload promise to settle at `uploads.tsx:3603-3607`
     - reopen front capture via `openIntakeCapture("front")` at `uploads.tsx:3608`
     - only log a warning if reopen fails at `uploads.tsx:3609-3611`

### Phase 3: Background Finalization

12. `enqueueCapturedCardFinalize` and `backgroundFinalizeQueueRef`.
   - `backgroundFinalizeQueueRef` is declared as `useRef<Promise<void>>(Promise.resolve())` at `uploads.tsx:862`.
   - `enqueueCapturedCardFinalize()` is at `uploads.tsx:3518-3534`.
   - Serialization behavior:
     - it takes the current promise in `backgroundFinalizeQueueRef.current`
     - ignores prior errors with `.catch(() => undefined)`
     - waits for that promise to settle
     - then runs `finalizeCapturedCardInBackground(params)` at `uploads.tsx:3525-3527`
     - stores the new chained promise back into `backgroundFinalizeQueueRef.current` at `uploads.tsx:3528-3530`
   - This serializes background finalization jobs with each other only.
   - It does not serialize new front captures or new front uploads.

13. `uploadQueuedPhoto()` is the helper used by background finalization.
   - Definition: `uploads.tsx:3391-3452`.
   - It:
     - resolves `targetCardId` from `cardIdOverride ?? intakeCardId` at `uploads.tsx:3402-3406`
     - fails early if there is no card id at `uploads.tsx:3406-3410`
     - converts the blob into a `File` at `uploads.tsx:3412-3416`
     - optionally sets `intakePhotoBusy` at `uploads.tsx:3417-3419`
     - calls `uploadCardPhoto(file, kind, targetCardId)` at `uploads.tsx:3422`
     - optionally writes `intakeBackPhotoId` or `intakeTiltPhotoId` when `updateIntakeState=true` at `uploads.tsx:3423-3428`
     - on failure, either sets `intakeError` or logs a background warning depending on `updateIntakeState` at `uploads.tsx:3431-3437`
     - if upload succeeded and `triggerOcr=true`, waits 300 ms and then calls `startOcrForCard(targetCardId)` at `uploads.tsx:3442-3447`

14. `uploadCardPhoto()` is the BACK/TILT upload pipeline.
   - Definition: `uploads.tsx:2085-2174`.
   - Step by step:
     - requires `session?.token` and a target card id at `uploads.tsx:2087-2094`
     - POSTs `/api/admin/kingsreview/photos/presign` with `cardAssetId`, `kind`, and file metadata at `uploads.tsx:2097-2111`
     - expects `photoId`, `uploadUrl`, `publicUrl`, `storageMode`, and optional `acl` at `uploads.tsx:2118-2124`
     - validates `storageMode` at `uploads.tsx:2126-2132`
     - PUTs the file to the returned upload URL at `uploads.tsx:2143-2150`
     - after the PUT, best-effort POSTs `/api/admin/kingsreview/photos/process?mode=thumbnail` with `photoId` at `uploads.tsx:2157-2166`
     - returns the presign payload at `uploads.tsx:2171`

15. `finalizeCapturedCardInBackground()` step-by-step.
   - Definition: `uploads.tsx:3455-3515`.
   - Card id resolution:
     - starts from `existingCardId` at `uploads.tsx:3462-3464`
     - if missing, it requires `frontUploadPromise` or fails with `setIntakeError("Front upload did not start...")` at `uploads.tsx:3464-3467`
     - if the front upload promise resolves, it takes `frontUpload.assetId` at `uploads.tsx:3469-3472`
     - if the front upload promise rejects with an `assetId`, it uses that `assetId` and retries `/api/admin/uploads/complete` through `ensureFrontAssetQueued(assetId)` at `uploads.tsx:3473-3479`
     - if the error has no `assetId`, it sets `intakeError` and aborts at `uploads.tsx:3481-3485`
   - BACK photo upload:
     - if `backBlob` exists, it calls `uploadQueuedPhoto(backBlob, "BACK", targetCardId, { updateIntakeState:false, setBusyState:false, triggerOcr:false })` at `uploads.tsx:3489-3494`
     - if that returns `false`, it sets `intakeError("A captured card back photo failed in background upload.")` and aborts at `uploads.tsx:3495-3497`
   - TILT photo upload:
     - always calls `uploadQueuedPhoto(tiltBlob, "TILT", targetCardId, { updateIntakeState:false, setBusyState:false, triggerOcr:false })` at `uploads.tsx:3501-3505`
     - if that returns `false`, it sets `intakeError("A captured card tilt photo failed in background upload.")` and aborts at `uploads.tsx:3506-3508`
   - After both uploads succeed:
     - locally appends `targetCardId` to `queuedReviewCardIds` at `uploads.tsx:3511`
     - calls `warmOcrSuggestionsInBackground(targetCardId)` at `uploads.tsx:3512`
     - calls `refreshQueuedReviewCards()` at `uploads.tsx:3513`

16. Failure behavior inside background finalization.
   - BACK failure aborts before tilt upload at `uploads.tsx:3495-3497`.
   - TILT failure aborts after back upload but before queue append/warm/refresh at `uploads.tsx:3506-3508`.
   - A front upload error without `assetId` aborts the entire card at `uploads.tsx:3481-3485`.
   - A front upload error with `assetId` but failed `ensureFrontAssetQueued()` does not abort; it logs user-facing error text, then continues with BACK/TILT uploads at `uploads.tsx:3476-3480`.

### Phase 4: Next Card Capture

17. After tilt confirmation, the next card path is reopened from inside `confirmIntakeCapture("tilt", ...)`.
   - State is cleared immediately at `uploads.tsx:3601`.
   - Camera is closed immediately at `uploads.tsx:3602`.
   - A detached async block then:
     - waits for the front upload promise to settle at `uploads.tsx:3605-3607`
     - calls `openIntakeCapture("front")` at `uploads.tsx:3608`

18. There is an `await`, but only for the front upload promise.
   - There is no fixed delay.
   - There is no `await` for the full background finalization queue.
   - Relevant lines: `uploads.tsx:3603-3608`.

19. Overlap behavior.
   - The next card's front upload can overlap with the previous card's BACK/TILT background finalization.
   - What it cannot overlap with is the previous card's still-unsettled front upload, because camera reopen waits for `backgroundFrontUploadPromise.catch(...)` first at `uploads.tsx:3605-3607`.
   - Background job serialization comes only from `backgroundFinalizeQueueRef`; new `uploadCardAsset()` calls are outside that chain at `uploads.tsx:3518-3530` and `uploads.tsx:3557`.

### Phase 5: OCR Queue Visibility

20. `/api/admin/uploads/ocr-queue` requirements for a card to appear.
   - Route: `frontend/nextjs-app/pages/api/admin/uploads/ocr-queue.ts:21-69`.
   - Required:
     - current admin must own the batch at `ocr-queue.ts:35`
     - `reviewStage = READY_FOR_HUMAN_REVIEW` at `ocr-queue.ts:36`
     - `bytebotLiteJobs: { none: {} }` at `ocr-queue.ts:37`
     - at least one BACK photo row at `ocr-queue.ts:39`
     - at least one TILT photo row at `ocr-queue.ts:40`
   - Not required:
     - no specific `status` value is filtered; the route only returns `status` at `ocr-queue.ts:46-48`
     - no image-url or storage-readability check is performed; photo row existence is enough

21. When each queue condition becomes true in the Add Cards flow.
   - Admin ownership:
     - front asset and batch are created under the current admin during `/api/admin/uploads/presign` at `uploads/presign.ts:95-147`
   - `reviewStage = READY_FOR_HUMAN_REVIEW`:
     - normally becomes true only after `/api/admin/uploads/complete` succeeds at `uploads/complete.ts:168-176`
   - BACK and TILT photo presence:
     - each `CardPhoto` row is created immediately during `/api/admin/kingsreview/photos/presign` at `kingsreview/photos/presign.ts:82-108`
     - this happens before the binary PUT upload finishes
   - no `bytebotLiteJobs`:
     - remains true until some later enqueue path creates one, such as `handleSendToKingsReview()` posting `/api/admin/kingsreview/enqueue` at `uploads.tsx:5027-5040`

22. Queue refresh and local visibility.
   - Client queue state is restored from `localStorage` on mount at `uploads.tsx:941-961`.
   - It is persisted back to `localStorage` on every change at `uploads.tsx:1022-1027`.
   - The authoritative server refresh is `refreshQueuedReviewCards()` at `uploads.tsx:2050-2076`, called on session load at `uploads.tsx:2078-2083` and after background finalize at `uploads.tsx:3513`.

23. Timing windows.
   - Newly queueable cards can be absent from the local queue UI until `refreshQueuedReviewCards()` finishes.
   - Stale queue ids can be shown from `localStorage` until the first server refresh overwrites them.
   - Because `/api/admin/kingsreview/photos/presign` creates BACK/TILT rows before the upload body is fully stored, server-side queue eligibility can be satisfied before those images are actually proven readable.
   - `finalizeCapturedCardInBackground()` locally appends the card id before the server refresh returns at `uploads.tsx:3511-3513`, so there is a brief client/server divergence window either way.

### Phase 6: OCR and Identify-Set Timing

24. Queue interaction to start review.
   - Selecting a radio button only runs `setSelectedQueueCardId(id)` at `uploads.tsx:5464-5468`.
   - The actual load call is the `OCR Review ->` button, which runs `loadQueuedCardForReview(selectedQueueCardId)` at `uploads.tsx:5442-5449`.

25. `loadQueuedCardForReview()` review load flow.
   - Definition: `uploads.tsx:2281-2427`.
   - It:
     - GETs `/api/admin/cards/[cardId]` at `uploads.tsx:2287-2293`
     - reads `payload.photos`, locates BACK and TILT, and computes `hasRequiredIntakePhotos = Boolean(backPhoto?.imageUrl) && Boolean(tiltPhoto?.imageUrl)` at `uploads.tsx:2296-2300`
     - hydrates `intakeCardId`, `intakeBatchId`, previews, CDN URLs, photo ids, required fields, optional fields, teach-region state, and OCR suggestion state at `uploads.tsx:2310-2408`
     - decides whether to auto-run OCR:
       - `shouldRefreshExistingOcr` uses `shouldRefreshLoadedOcrSuggestions(...)` at `uploads.tsx:2409-2417`
       - helper definition: `uploads.tsx:568-593`
       - `shouldAutoRunOcr = hasRequiredIntakePhotos && (!hasExistingOcrSuggestions || shouldRefreshExistingOcr)` at `uploads.tsx:2418`
     - sets `ocrStatus`:
       - `"pending"` when auto-OCR should run
       - `"ready"` when existing OCR will be reused
       - `"empty"` when there is no OCR and no auto-run
       - lines: `uploads.tsx:2418-2419`
     - clears error/applied/mode state and switches to review mode at `uploads.tsx:2420-2425`
     - sets `pendingAutoOcrCardId = cardId` when auto-OCR should run at `uploads.tsx:2426`

26. `pendingAutoOcrCardId` and OCR trigger behavior.
   - Declared at `uploads.tsx:799`.
   - Auto-OCR effect: `uploads.tsx:3259-3271`.
   - It only fires OCR when:
     - `pendingAutoOcrCardId` is set
     - `intakeCardId` matches
     - `ocrStatus` is not `"running"` or `"pending"`
   - This matters because `loadQueuedCardForReview()` itself sets `ocrStatus("pending")` before setting `pendingAutoOcrCardId` at `uploads.tsx:2418-2426`.
   - Result: on the first render after queue load, the pending-auto-OCR effect returns early at `uploads.tsx:3266-3268` and does not start OCR.

27. `ocrStatus` values at HEAD.
   - Declared union: `null | "idle" | "running" | "pending" | "ready" | "empty" | "error"` at `uploads.tsx:796-798`.
   - Actual current writers:
     - `null`: reset path at `uploads.tsx:1662-1669`
     - `"pending"`: queue-load scheduling at `uploads.tsx:2418-2419`; server-pending responses at `uploads.tsx:3152-3168`
     - `"running"`: start of `fetchOcrSuggestions()` at `uploads.tsx:3080-3085`
     - `"ready"`: OCR suggestions available at `uploads.tsx:3192-3196`; low-confidence manual apply at `uploads.tsx:3727-3733`
     - `"empty"`: no OCR suggestions at `uploads.tsx:3196-3200`; queue-load no-auto-run at `uploads.tsx:2419`
     - `"error"`: auth/card-id/request failures at `uploads.tsx:3049-3068`, `uploads.tsx:3127-3145`, `uploads.tsx:3208-3224`, `uploads.tsx:3379-3382`, `uploads.tsx:3738-3740`
   - `"idle"` is never assigned anywhere at HEAD.

28. Identify-set `useEffect` guards.
   - Effect: `uploads.tsx:4065-4146`.
   - It is blocked unless all of these are true:
     - `session?.token` exists at `uploads.tsx:4074`
     - `isAdmin` is true at `uploads.tsx:4074`
     - category is `"sport"` at `uploads.tsx:4074`
     - `ocrStatus` is neither `"running"` nor `"pending"` at `uploads.tsx:4080-4082`
     - `identifySetRequestKey` exists, which itself requires:
       - year
       - manufacturer
       - sport
       - resolved card number
       - player name
       - lines: `uploads.tsx:4041-4063`
     - duplicate request keys are suppressed at `uploads.tsx:4091-4094`

29. Product Set auto-selection effect.
   - Effect: `uploads.tsx:2514-2572`.
   - It can auto-fill `intakeOptional.productLine` from:
     - `identifiedSetMatch.setId`
     - `variantScopeSummary.selectedSetId`
     - a single available `productLineOptions[0]`
     - OCR `setName` heuristic via `pickBestCandidate(...)`
   - Guards:
     - sport category only
     - `productLineOptions.length > 0`
     - not in manual mode
     - `intakeOptionalTouched.productLine` must be false

30. Screen 2 prefetch effect.
   - Effect: `uploads.tsx:3285-3365`.
   - It only runs when:
     - `intakeCardId` exists
     - category is `"sport"`
     - `intakeStep` is `"required"` or `"optional"`
     - `scopedScreen2ProductSetId` exists, which is `intakeOptional.productLine || variantScopeSummary?.selectedSetId` at `uploads.tsx:3273-3275`
   - When it fires, it:
     - clears untouched `insertSet` and `parallel` values at `uploads.tsx:3328-3340`
     - clears corresponding OCR suggestions at `uploads.tsx:3341-3353`
     - calls `fetchOcrSuggestions(..., { purpose: "product_set_prefetch", hintProductLine, hintCardNumber })` at `uploads.tsx:3354-3358`

31. Effect order after a queue load.
   - Declaration order is:
     1. Product Set auto-selection effect: `uploads.tsx:2514-2572`
     2. pending-auto-OCR effect: `uploads.tsx:3259-3271`
     3. Screen 2 prefetch effect: `uploads.tsx:3285-3365`
     4. identify-set effect: `uploads.tsx:4065-4146`
   - Practical behavior is more nuanced because `productLineOptions` and `variantScopeSummary` are fetched asynchronously by a separate effect at `uploads.tsx:3836-3923`.
   - In the first render after `loadQueuedCardForReview()`:
     - Product Set auto-selection often has no options yet and does nothing.
     - pending-auto-OCR sees `ocrStatus === "pending"` and returns.
     - Screen 2 prefetch only runs if a scoped Product Set is already available.
     - identify-set is blocked because `ocrStatus === "pending"`.
   - On later renders, if Product Set scope becomes available, Screen 2 prefetch can be the path that finally kicks OCR.

## 2. State Variable Reference Table

| State | Declared | Set by | Read by | Valid values / notes |
| --- | --- | --- | --- | --- |
| `intakeCardId` | `uploads.tsx:743` | Draft restore `976-977`; clear/reset `1725`; queue load `2310`; front upload success `3565` | Draft persistence `1033-1055`; photo upload target `2091-2094`; metadata save `2182-2256`; validation `2443-2475`; pending-auto-OCR `3263-3270`; Screen 2 prefetch `3278-3358`; send-to-review `4997-5009` | `string \| null`. Normal value is the front `CardAsset.id`. |
| `ocrStatus` | `uploads.tsx:796-798` | Reset `1663`; queue load `2418-2419`; OCR fetch `3049-3210`; manual low-conf/apply path `3727-3740`; auth fail in `startOcrForCard` `3379-3382` | pending-auto-OCR guard `3266-3268`; identify-set guard `4080-4082`; UI labels/button states `5738-5769` | `null`, `"idle"`, `"running"`, `"pending"`, `"ready"`, `"empty"`, `"error"`. `"idle"` is declared but unused at HEAD. |
| `pendingAutoOcrCardId` | `uploads.tsx:799` | Reset `1664`; queue load `2426`; effect clears it `3269` | pending-auto-OCR effect `3259-3271` | `string \| null`. Intended to trigger OCR after queue load. |
| `identifiedSetMatch` | `uploads.tsx:804` | Reset `1669`, `1747`; identify-set effect clears/sets `4077`, `4087`, `4112`, `4123` | Product Set auto-selection effect `2515-2571`; UI/render consumers downstream | `IdentifySetPayload \| null`. Payload confidence is `"exact"`, `"fuzzy"`, or `"none"` from `uploads.tsx:134-150`. |
| `intakeOptional.productLine` | `uploads.tsx:725-742` | Reset `1707-1724`; queue load `2351-2374`; manual edits `1904-1908`, `5618-5679`; OCR apply `2815-2843`; Product Set auto-selection `2560-2561` | Save metadata `2191-2208`; validation `2458-2460`; infer sport effect `2488-2497`; product-line manual mode effect `2499-2512`; variants/options fetch `3836-3923`; Screen 2 prefetch scope `3273-3358`; identify-set supporting reads `4154+` | Freeform `string`. In practice this is either a known Product Set id from `productLineOptions` or a manually typed fallback. |
| `productLineOptions` | `uploads.tsx:780` | Cleared on reset/fetch failures `1761`, `3839`, `3850`, `3916`; populated from `/api/admin/variants/options` at `3903` | Product Set auto-selection `2517-2552`; selected option memo `2574-2584`; OCR constraint logic `2832-2839`; Product Set UI `5608-5683` | `string[]`. Set ids returned by `/api/admin/variants/options`. |
| `variantScopeSummary` | `uploads.tsx:785-789` | Cleared on reset/fetch failures `1765`, `3843`, `3854`, `3920`; populated from `/api/admin/variants/options` at `3907-3913` | Product Set auto-selection `2541-2544`; Screen 2 scope `3273-3275`; summary UI `4357-4366`; resolved-scope flag `4432-4433` | `null` or `{ approvedSetCount, variantCount, selectedSetId }`. |
| `queuedReviewCardIds` | `uploads.tsx:715` | LocalStorage restore `954-957`; reset intake `1799`; server refresh `2065-2072`; background finalize append `3511`; send-to-review remove `5062-5063` | LocalStorage persist `1022-1027`; selected queue sync `1066-1074`; queue UI `5432-5477`; next-review routing after send `5062-5067` | `string[]`. Deduped by `dedupeQueueCardIds()` at `uploads.tsx:341-352`. |
| `backgroundFinalizeQueueRef` | `uploads.tsx:862` | Initialized with `Promise.resolve()`; updated in `enqueueCapturedCardFinalize()` at `3525-3530` | Only read/written by `enqueueCapturedCardFinalize()` | `Promise<void>` chain used to serialize background finalization work across captured cards. |

## 3. API Call Reference Table

| Endpoint | Caller | When | Request / expectation | Response / downstream use |
| --- | --- | --- | --- | --- |
| `POST /api/admin/uploads/presign` | `uploadCardAsset()` at `uploads.tsx:1931-1944` | Front capture starts | Requires admin session plus `fileName`, `size`, `mimeType`; client also sends `reviewStage: "READY_FOR_HUMAN_REVIEW"` | Returns `assetId`, `batchId`, `uploadUrl`, `publicUrl`, `storageMode`, `acl` from `uploads/presign.ts:139-147`. Server creates `CardAsset(status=UPLOADING)` immediately at `uploads/presign.ts:114-132`. |
| `POST /api/admin/uploads/complete` | `uploadCardAsset()` at `uploads.tsx:1996-2010`; `ensureFrontAssetQueued()` at `uploads.tsx:2033-2041` | After front PUT upload, or during recovery | Requires admin session and `assetId`; optional file metadata and `reviewStage` | On success, server sets `status=READY` and `reviewStage` at `uploads/complete.ts:168-176`. On unreadable storage object, server resets to `UPLOADING`, clears `reviewStage`, and returns `409` at `uploads/complete.ts:137-151`. |
| `POST /api/admin/kingsreview/photos/presign` | `uploadCardPhoto()` at `uploads.tsx:2097-2111` | BACK or TILT upload begins | Requires admin session plus `cardAssetId`, `kind`, `fileName`, `size`, `mimeType` | Returns `photoId`, `uploadUrl`, `publicUrl`, `storageMode`, `acl` from `kingsreview/photos/presign.ts:101-108`. Server creates the `CardPhoto` row immediately at `kingsreview/photos/presign.ts:82-94`. |
| `GET /api/admin/uploads/ocr-queue` | `refreshQueuedReviewCards()` at `uploads.tsx:2056-2072` | On session load and after background finalization | Requires admin session; optional `limit` query | Returns ordered queue card ids/status/review stage from `uploads/ocr-queue.ts:33-62`. Eligibility is `reviewStage=READY_FOR_HUMAN_REVIEW`, no `bytebotLiteJobs`, and both BACK and TILT photo rows. |
| `GET /api/admin/cards/[cardId]/ocr-suggest` | `warmOcrSuggestionsInBackground()` at `uploads.tsx:2986-3003`; `fetchOcrSuggestions()` at `uploads.tsx:3115-3123`; Screen 2 prefetch at `uploads.tsx:3354-3358` | Background warm, manual OCR, queued auto OCR, or Product Set prefetch | Requires admin session. Optional query hints: `year`, `manufacturer`, `sport`, `game`, `productLine`, `setId`, `cardNumber`, `layoutClass`, `purpose` from `ocr-suggest.ts:2920-2928` | Returns `{ suggestions, threshold, audit, status }`. `status` is `"pending"` when required images or OCR results are not ready at `ocr-suggest.ts:3071-3131`; returns `"ok"` after OCR completes and persists `ocrText` / `ocrSuggestionJson` at `ocr-suggest.ts:3704-3718`. |
| `POST /api/admin/cards/identify-set` | `fetchIdentifiedSetMatch()` at `uploads.tsx:3026-3039` | After enough review fields are loaded and OCR is not pending/running | Requires admin session plus body fields `year`, `manufacturer`, `sport`, `cardNumber`, `playerName`, and optional `teamName`, `insertSet`, `frontCardText`, `combinedText` from `cards/identify-set.ts:33-63` | Returns `IdentifySetPayload` with `setId`, `confidence`, `reason`, candidate sets, tiebreaker, and text source from `cards/identify-set.ts:13-30`. |
| `GET /api/admin/cards/[cardId]` | `loadQueuedCardForReview()` at `uploads.tsx:2287-2293` | When the operator actually starts OCR review | Requires admin session | Returns front asset, BACK/TILT photos, stored OCR suggestion snapshot, normalized classification, previews, and metadata from `cards/[cardId].ts:780-1001`. This is the payload that seeds all Screen 1 review state. |

## 4. Bugs, Race Conditions, and Fragile Timing Observed

1. Queue-loaded auto-OCR is internally blocked by the current state transitions.
   - `loadQueuedCardForReview()` sets `ocrStatus("pending")` and `pendingAutoOcrCardId(cardId)` at `uploads.tsx:2418-2426`.
   - The only consumer of `pendingAutoOcrCardId` refuses to run while `ocrStatus === "pending"` at `uploads.tsx:3266-3268`.
   - There is no separate effect that clears `"pending"` before calling `fetchOcrSuggestions()`.
   - Result: queue-loaded cards can sit in `"pending"` until some other path triggers OCR, usually Screen 2 prefetch or a manual OCR click.

2. Server queue eligibility is based on photo row existence, not file readiness.
   - `/api/admin/kingsreview/photos/presign` creates BACK/TILT `CardPhoto` rows before the upload body finishes at `kingsreview/photos/presign.ts:82-94`.
   - `/api/admin/uploads/ocr-queue` only checks `photos: { some: { kind: BACK/TILT } }` at `uploads/ocr-queue.ts:38-41`.
   - This means a card can satisfy queue filters before those photo objects are actually readable.

3. `loadQueuedCardForReview()` also uses optimistic photo readiness.
   - It decides `hasRequiredIntakePhotos` by checking whether `backPhoto?.imageUrl` and `tiltPhoto?.imageUrl` are truthy at `uploads.tsx:2296-2300`.
   - Because photo presign writes `imageUrl` immediately, this can overstate readiness and schedule OCR too early.

4. Front capture advances the operator to BACK before the front upload succeeds.
   - `confirmIntakeCapture("front", ...)` sets `intakeStep("back")` and `intakeCaptureTarget("back")` before the upload promise resolves at `uploads.tsx:3553-3558`.
   - If front presign fails outright, the operator can still capture BACK/TILT, but background finalization later has no recoverable `assetId` and aborts the card at `uploads.tsx:3481-3485`.

5. Local queue state can temporarily disagree with the server queue.
   - Background finalize appends `targetCardId` locally at `uploads.tsx:3511` before it refreshes the server queue at `uploads.tsx:3513`.
   - On mount, local queue ids are restored from `localStorage` at `uploads.tsx:941-961` before the server refresh runs at `uploads.tsx:2078-2083`.
   - This creates both stale-positive and stale-negative windows in the client UI.

6. Background finalization recovery continues even if front queue-finalize retry fails.
   - In `finalizeCapturedCardInBackground()`, a recoverable front upload failure with `assetId` calls `ensureFrontAssetQueued(assetId)` at `uploads.tsx:3476`.
   - If that retry returns `false`, the function only sets `intakeError`; it does not abort at `uploads.tsx:3477-3480`.
   - BACK/TILT uploads still continue, and the card id is still appended locally later if they succeed at `uploads.tsx:3511`.

7. Background finalization is serialized, but new front uploads are not.
   - `backgroundFinalizeQueueRef` serializes only the finalize jobs at `uploads.tsx:3525-3530`.
   - The next card's front upload starts independently once reopen happens, so the system allows front uploads to overlap with the prior card's BACK/TILT uploads.
   - This is intentional behavior, but it is a fragile timing boundary under network stress.

8. Queue review selection is a two-step UI, not a direct tap-to-load flow.
   - Radio selection only sets `selectedQueueCardId` at `uploads.tsx:5464-5468`.
   - The separate OCR Review button actually calls `loadQueuedCardForReview()` at `uploads.tsx:5442-5449`.
   - If an operator expects row tap == load, the current UX can look unresponsive.

## 5. Potential Issues

1. `ocrStatus` includes `"idle"` in the type union, but no code path sets it at HEAD.

2. `pendingTiltBlob` is set during tilt confirmation at `uploads.tsx:3590`, but the background finalizer uses the local `blob` argument directly and `clearActiveIntakeState()` immediately clears the state at `uploads.tsx:3601`. The state write looks redundant.

3. `uploadCardPhoto()` treats thumbnail processing as best-effort only.
   - The POST to `/api/admin/kingsreview/photos/process?mode=thumbnail` is wrapped in a warning-only `try/catch` at `uploads.tsx:2157-2168`.
   - BACK/TILT upload is still treated as successful even if thumbnail generation failed.

4. `/api/admin/uploads/ocr-queue` does not filter on `CardAsset.status`.
   - Normal flow should produce `status=READY` via `/api/admin/uploads/complete`, but the route itself never enforces that.
   - Any future inconsistency that leaves `reviewStage=READY_FOR_HUMAN_REVIEW` on a non-ready card would still surface in the queue.

5. `/api/admin/kingsreview/photos/presign` accepts `kind` as a generic string and writes `kind as any` at `kingsreview/photos/presign.ts:82-93`.
   - The client only sends `"BACK"` or `"TILT"`, but the route itself does not validate against the enum before insert.
