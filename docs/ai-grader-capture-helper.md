# AI Grader capture helper

## Current production boundary

The Dell capture helper is the only local owner of the Basler/Pylon camera and Leimac controller during an AI Grader session. The production capture workflow for each card is exactly:

1. **Start New Card**
2. **Capture Front**
3. Flip the card and **Capture Back**

After Back is durably queued, those three capture actions may be repeated to photograph a batch without waiting for older cards. Later, the operator selects one ready exact item from the local **Finish / Review Queue** and uses **Approve & Publish** for that item only.

There are no routine safety/recovery clicks, fixture/ruler confirmations, per-card lighting-profile acceptance steps, flip confirmations, manual capture paths, or separate Confirm and Publish screens. **Add To Inventory** is intentionally retained as a later Finish business action after NFC/slab/valuation/label readiness; it is outside grading. The browser does not own physical shutdown and does not maintain a shadow hardware-safety state.

**Start New Card** always creates one `production_fast` session and automatically applies the configured production positioning-light profile through the existing bounded Leimac path. The session becomes Capture Front lighting-ready only after every expected controller acknowledgement is complete. A completed Back handoff returns to a sessionless **Start New Card** state; it never auto-creates the next session. A failed Start New Card application returns one explicit error and never claims readiness.

An operator-approved provisional geometry-only artifact may be enabled only as a paired protected local configuration (`provisionalGeometryArtifactPath` plus its exact lowercase SHA-256). This does not add a capture road or weaken Mathematical V1/V1.1 readiness. After each immutable sensor capture, the helper verifies the artifact, camera identity, image size, exposure, gain, accepted maximum residual, and independent-view improvement before creating separate undistorted processing derivatives. Original sensor files and hashes remain the raw authority and the report remains `isCalibrated=false`, provisional diagnostic only, with the current Production normalization retained as the rollback path. A missing, partial, changed, mismatched, or certified-claiming artifact stops processing; it is never treated as a finalized calibration bundle and supplies no photometric correction.

## Retained physical invariants

The bridge retains only these physical controls:

- Leimac commands are fixed, allowlisted, bounded to the controller range, and require exact controller acknowledgements. The former fixed 5% ceiling is removed. A duty-requiring operation must receive an explicit duty or use the already-selected production lighting profile; omitted duty never means maximum brightness.
- One bridge-owned lighting watchdog owns fatal-failure protection.
- The bridge automatically sends its existing bounded all-off sequence only on fatal bridge failure, cancellation, or completed session.
- One capture lock and one serialized hardware-operation gate prevent overlapping capture/lighting work.
- One bridge process owns the Basler/Pylon camera. Orphan cleanup is scoped to the dedicated preview/capture processes.
- Camera and lighting values originate from the protected bridge configuration and fixed command definitions, never browser-supplied hardware values.

An incomplete controller acknowledgement is reported truthfully as a command failure. It does not create a global browser interlock or a manual Safe Off recovery workflow. Initial bridge startup does not require a prior physical-state acknowledgement.

## Retained capture and publication invariants

Every capture binds the exact station session, report, card, side, preview epoch, and frame identity. The bridge rejects crossed identities, stale frames, duplicate frames, wrong-side frames, and non-current geometry. Failed automatic geometry has no manual or fixture fallback.

The browser submits only an exact match assertion. The bridge owns the current frame and capture authority, acquires the capture lock, serializes the operation, and uses the single Basler/Pylon implementation. There is no cold/debug production capture, warm-to-cold recovery, alternate capture implementation, manual overlay, browser cleanup owner, compatibility flip route, or broad reconnect/retry ladder.

Rapid is the sole production capture path and the existing persisted throughput queue, not a capture alternative. The operator still explicitly performs Front and Back. A successful **Capture Back** first persists immutable lossless TIFF and hashes, accepts the exact Front and Back side-processing jobs, and atomically persists the exact queue item. Only after that durable commit does the bridge release capture, camera, and session ownership to clean `start_new_card`; it does not auto-create a session. Queue-persistence failure belongs to that exact card, rejects Back success, and cannot claim capture release.

The browser can immediately select **Start New Card** after durable enqueue while the one serialized background worker processes older cards. Its pending representation accepts twenty side jobs for ten cards, but active side processing and physical capture ownership remain concurrency one. The complete captured-side pipeline, including immutable-source validation, geometry authority, TIFF-to-PNG normalization, and output validation, runs inside that existing one-at-a-time killable worker. One bounded timeout covers the complete side attempt; timeout terminates that worker attempt and advances to later pending jobs after termination, without a second worker, queue, normalization implementation, or retry. Each side converts from TIFF to its exact normalized PNG once. A failed item persists one exact error and the worker advances; processing, OCR, grading, reporting, review, publication, or Finish work for any older item never becomes a camera busy condition.

Both exact normalized `1200x1680` PNGs must pass path-containment, identity, MIME, dimension, byte-size, and SHA-256 verification before the item becomes OCR-eligible. The station obtains fresh hosted Production authorization before asking the helper to consume the one OCR attempt; failed or expired authorization leaves the eligible item unclaimed. The existing Google Vision path then runs once for the exact `queueItemId`, `gradingSessionId`, and `reportId` through token-gated loopback bodies. The claim durably binds one safe mounted-station-page `attemptOwnerId` and holds an origin-scoped exclusive Web Lock while that page is mounted. Reload, back-forward, and same-tab route return reuse a persisted owner only when its exact lock is available; a duplicated live tab that inherited the same browser storage instead atomically claims one fresh locked owner. A page observing a foreign in-flight owner queues one abortable exclusive waiter. It cannot acquire or mutate while the live owner holds the lock; after release it refreshes the helper status under the acquired lock and terminal-fails only if the exact queue/session/report/owner is still in flight. Cleanup releases pending or acquired recovery ownership. Only the exact owner may complete or fail its attempt. If Web Locks, secure owner creation, or session persistence are unavailable, initialization fails explicitly and the eligible item remains unclaimed without consuming an attempt. One safe suggestion result or terminal failure is persisted in the existing JSON manifest/queue. Reload does not rerun success; no automatic retry, second provider, or manual OCR substitute exists. Review hydration merges suggestions only into untouched fields and never confirms, publishes, or mutates inventory.

The persisted local queue is presented as the **Finish / Review Queue** and owns all unpublished evidence. A completed queue item may be activated only after its exact background artifacts are ready and only for the same selected **Approve & Publish** authority. The bridge exposes the activated review bundle with that exact item's finalized `productionRelease` embedded inside the report bundle, which is the complete shape required by hosted publication; it does not substitute the separately displayed release or another card. Hosted Finish receives that same report only after atomic publication. Queue status exposes no local path; automatic shutter triggering, approval, publication, and inventory mutation remain absent.

Front and back immutable evidence, normalized derivatives, checksums, findings, and report identity stay linked to the same session and report. **Approve & Publish** is the one human publication authority. Durable exact report/card/publication/Label linkage executes atomically; partial publication is not permitted. Inventory remains a later hosted Finish action and is not part of publication. Existing Label V1 authority remains unchanged.

Direct-upload integrity uses one server-side verifier for OCR, publication assets, and slab photos. OCR init, both uploads, finalize, provider input/result, and local persistence carry and verify the exact queue/session/report triple. Finalization binds the exact planned storage key, expected byte size, compatible content type, and browser-provided SHA-256. A valid provider-native SHA-256 is accepted; if the provider omits it, the server streams the same object through bounded in-memory SHA-256 calculation without writing verification bytes to disk. The stream is capped at the existing `50 MiB` per-object limit and the exact expected length; oversized, overrun, truncated, mismatched, malformed, crossed, or failed reads stop before OCR or persistence. ETag, user metadata, filenames, caller URLs, and image bytes are never integrity authority or log evidence.

## Persisted Rapid queue compatibility

The authoritative `rapid-capture-queue.json` schema is `ten-kings-ai-grader-rapid-capture-queue-v2`. Version 2 adds the exact accepted Front and Back side-processing job identities and the durable queued-OCR lifecycle required by the one-road handoff. No database migration or second state store is involved.

An absent queue or a recognized version 1 queue with `items: []` initializes safely as an empty version 2 queue. A nonempty recognized version 1 queue cannot be converted safely because its items do not contain the exact accepted side-processing job identities. The helper therefore stops before parsing or rewriting any such item and leaves the queue bytes unchanged. This is an explicit rollout compatibility failure, not an item migration, fallback, or recovery route.

Before updating or restarting the Dell capture helper with this version, a separately authorized operator must perform a read-only preflight of the installed helper's configured output directory and verify that `rapid-capture-queue.json` is absent or is recognized queue JSON with an empty `items` array. If the file is malformed, uses an unrecognized schema, or contains any item, stop the helper rollout and report the preserved queue; do not start the new helper, move or rewrite the file, migrate an item, acknowledge a failure, or retry work. Source validation does not authorize access to the Dell or its hardware.

## Security boundary

The station bridge:

- binds only to loopback;
- requires the dedicated station token and one-time browser pairing;
- accepts only the approved production Origin and authenticated operator flow;
- validates method, Host, content type, request size, expiration, replay identity, and exact protocol contracts;
- exposes no public hardware route;
- redacts secrets, paths, hardware addresses, and device details;
- uses protected workstation ACLs.

The browser cannot send arbitrary Leimac frames, controller addresses, camera paths, image bodies, physical-state assertions, or lighting profiles.

## Preview and geometry

Preview uses one bounded MJPEG path. Frames carry exact session, report, side, epoch, frame ID, and capture timestamp. Only a fresh current frame with current detected geometry may authorize capture. Stale, crossed, clipped, low-confidence, or wrong-aspect geometry remains unavailable; no prior result is reused and no manual boundary may substitute for it.

The full-resolution captured-evidence detector remains isolated in its bounded worker. Source paths, hashes, sizes, dimensions, roles, side, request identity, and output containment are revalidated. A worker timeout, crash, malformed response, identity mismatch, hash mismatch, or failed acknowledgement terminates that processing attempt without another implementation.

## Lighting behavior

The bridge uses the reviewed Basler Line2/Leimac command definitions and exact response validation. PWM conversion remains bounded to the controller's `0..999` step range (`0..99.9%`). Values at zero and the valid maximum are accepted only when explicit (or already selected in the production profile). Missing duty is rejected rather than silently becoming `99.9%`. The bridge does not silently substitute a different controller, channel set, camera, or lighting profile.

The automatic all-off sequence is bridge-owned and limited to fatal bridge failure, cancellation, and completed session. Page close, preview loss, and capture start do not independently command Safe Off. There is no manual Safe Off / End Session control or separate final-light confirmation.

### Ring Reflection / Glare Limitation

The circular specular reflection remains an unresolved optical setup issue. Candidate physical mitigations include cross-polarization, a diffuser, ambient-light control, and reviewed lighting geometry changes. No PR #39 code or smoke may claim the ring reflection is solved, calibrated, or certified without controlled optical evidence.

Mathematical Calibration V1 does not claim that the optical reflection has disappeared. It changes how calibrated evidence is interpreted: per-channel dark/flat-field correction separates common-mode/calibrated illumination response from directional residuals; clipping, specular response, low confidence, and insufficient channel coverage create visible evidence-quality masks; and physical candidates may deduct only from adequate valid multi-channel evidence. Alternate non-glare channels may recover a partly obscured region. A region obscured in every usable channel is insufficient evidence, never a physical defect and never a false `10.00`.

The redacted immutable replay for the historical Surface `5.50` report proves the old V0 path treated sixteen fixed-grid, channel-selective illumination candidates as high-severity surface damage: nominal deduction `22.40`, cap `4.50`, result `5.50`. The V1 regression retains those exact candidate identities as zero-deduction illumination limitations while independently proving that a directional scratch still deducts, including when alternate channels support the portion crossing glare. This is an algorithmic classification correction; physical target/test-card evidence is still required before rollout.

## Mathematical Calibration V1 candidate boundary

Mathematical V1 is fail-closed and separate from historical V0. It requires one complete finalized calibration bundle, the exact frozen threshold-set hash, real printed-design centering on both sides, all eight visible corner observations, all eight visible edge observations, calibrated surface evidence, measurement U95, and complete finding disposition. Missing calibration, intended-design authority, valid pixels, channels, measurements, or review produces explicit insufficient evidence. It never redistributes a missing element, invokes the legacy image-quality proxy scorer, uses a manual/historical grade, or silently switches camera/capture/reference paths.

Before capture, the operator supplies the exact card/set/program/variant identity and chooses `printed_border_v1` or `registered_design_template_v1` per side. Registered-template capture is available only after the authenticated server resolves one exact APPROVED design artifact and the browser and bridge independently verify its MIME type, dimensions, identity, version, bytes, and SHA-256. The browser cannot author a hash, private storage key, registration transform, residual, confidence, certificate, report URL, or score.

Admins import one controlled PNG or JPEG per exact front/back identity through `/admin/ai-grader-design-references`. The browser computes a preliminary SHA-256 and requests an identity/version-scoped PUT whose dedicated presigner always signs `x-amz-acl: private` and never consults the global public-asset ACL. The server returns a short-lived authenticated-encrypted receipt, not the raw private storage key as draft authority. That receipt binds the complete identity, side, profile, version, file name, content type, exact byte size, SHA-256, generated storage key, authenticated admin, issue time, and expiry. Draft creation accepts only that exact receipt contract, rejects expired, changed, cross-identity, raw-key, and already-used version bindings, then rereads the receipt-bound object and independently confirms the supported raster type, dimensions, byte bounds, and SHA-256 before persistence. `AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET` is required server-side and must contain at least 32 bytes; there is no storage-secret fallback. The imported version remains inactive until a separate explicit APPROVED transition. Drafts and approved references are revoked/retired, and approval of a newer exact side supersedes the prior active version; neither the API nor UI exposes overwrite or delete authority.

The import preview shows the exact raster, intended-design contour/mask, numbered pixel landmarks, printed-top orientation, and an operator-readable pixel-to-card-millimeter map. Runtime registration, rather than import, derives expected-to-observed landmark residuals and inliers. The immutable centering overlay publishes those vectors, the transformed approved-design orientation, mask, measured contours/margins, calibrated 10 mm axes, and the exact reference ID/version/hash. No web/marketplace image, camera-frame margin, or normalized-frame symmetry can become centering authority; a missing reliable detected printed border or missing exact APPROVED template hard-fails as insufficient evidence.

Ordinary and Rapid Capture use the same exact Mathematical authority and serialized bridge pipeline. Processing states are explicit: `processing`, `finding_review_required`, `completed`, or `insufficient_evidence`; `v0FallbackUsed` remains false. Finding review exposes hash-verified True View, eight directional channels, ROI, segmentation, confidence, and illumination evidence. The operator records one disposition per exact finding; evidence-derived confidence and score math remain immutable. The existing single **Approve & Publish** authority completes review and then enters the protected publication boundary only for a strict completed V1 package.

The physical calibration workflow is documented in `docs/runbooks/AI_GRADER_MATHEMATICAL_CALIBRATION_V1_RUNBOOK.md`. It uses a clearly non-production target, exactly 102 captures and 78 measurement records, pinned offline analysis, and a create-new 12-member finalized bundle. It never installs over the Dell helper and has no Production, database-trust, report-publication, label-printing, inventory, NFC, deployment, or merge authority.

## Build and hardware-free validation

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper build
pnpm --filter @tenkings/ai-grader-capture-helper test
```

The full suite uses injected fake boundaries and must report zero real camera, lighting, controller, or external-network access. It covers loopback/origin enforcement, exact acknowledgements, automatic configured-light application, atomic TIFF/queue ordering before release, explicit next-session creation, two- and ten-card backlog capture, twenty pending side jobs with concurrency one, full-pipeline worker timeout advancement, once-only normalization and OCR, fresh Production authorization before OCR claim, durable owner-bound reload/route-return behavior, live-owner exclusion and exact orphan recovery, exact identity rejection, nonempty-v1 byte preservation, empty-v1 version 2 initialization, failed-item advancement, selected-only publication with embedded production release, serialized final-grade/release/label preparation, watchdog ownership, serialized capture, capture lock, camera ownership, scoped orphan cleanup, exact frame identity, fresh/stale handling, and the absence of removed routes and fallbacks.

Generic simulator/readiness commands remain hardware-free:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js health
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js capabilities
```

Real hardware operation requires the protected installed bridge and normal station UI. Production-installed sacrificial/debug capture modes are not part of the supported workflow.

## Failure behavior

A failed capture or processing operation returns one exact terminal error and releases only work whose physical outcome is definite. An ambiguous in-flight physical operation remains owned by the bridge until it terminates; no overlapping retry is allowed. A terminal background failure stays on its exact queue item and does not block a new clean card/session or later queued work.

If configured positioning-light application fails during **Start New Card**, the browser refreshes the authoritative bridge state, shows that single error, and leaves **Start New Card** available for a later explicit attempt. The visible Live/Off control is derived from complete returned acknowledgement state, not a stale browser draft.

No failure may silently publish partial data, reuse an old report, substitute sample/public-report data, or activate inventory.
