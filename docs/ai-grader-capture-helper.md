# AI Grader capture helper

## Current production boundary

The Dell capture helper is the only local owner of the Basler/Pylon camera and Leimac controller during an AI Grader session. The production operator workflow is exactly:

1. **Start New Card**
2. **Capture Front**
3. Flip the card and **Capture Back**
4. **Approve & Publish**

There are no routine safety/recovery clicks, fixture/ruler confirmations, per-card lighting-profile acceptance steps, flip confirmations, manual capture paths, or separate Confirm and Publish screens. **Add To Inventory** is intentionally retained as a later Finish business action after NFC/slab/valuation/label readiness; it is outside grading. The browser does not own physical shutdown and does not maintain a shadow hardware-safety state.

**Start New Card** automatically applies the configured production positioning-light profile through the existing bounded Leimac path. The session becomes Capture Front lighting-ready only after every expected controller acknowledgement is complete. Rapid continuation applies the same profile to the exact newly created next-card session. A failed application returns one explicit retryable Start New Card error and never claims readiness.

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

Rapid Capture is the retained production throughput path, not a capture alternative. The operator still performs the same four actions for every card. After **Capture Back**, the bridge durably detaches the exact session/report manifest and front/back packages, records the queue item, runs diagnostics/report-bundle generation plus final-grade, finalized-release, and label-data preparation through one serialized background worker, and starts a clean next-card session without cancelling the detached card's processing. A completed queue item may be opened only after those exact artifacts are ready and only for the same **Approve & Publish** authority. Queue status exposes no local manifest path; automatic shutter triggering, approval, publication, and inventory mutation remain absent. A failed item is isolated to its exact queue identity and does not take capture readiness away from the next session.

Front and back immutable evidence, normalized derivatives, checksums, findings, and report identity stay linked to the same session and report. **Approve & Publish** is the one human publication authority. Durable card/report/label/inventory persistence executes atomically; partial publication is not permitted. Existing Label V1 authority remains unchanged.

Direct-upload integrity uses one server-side verifier for OCR, publication assets, and slab photos. Finalization binds the exact planned storage key, expected byte size, compatible content type, and browser-provided SHA-256. A valid provider-native SHA-256 is accepted; if the provider omits it, the server streams the same object through bounded in-memory SHA-256 calculation without writing verification bytes to disk. The stream is capped at the existing `50 MiB` per-object limit and the exact expected length; oversized, overrun, truncated, mismatched, malformed, or failed reads stop before OCR or persistence. ETag, user metadata, filenames, caller URLs, and image bytes are never integrity authority or log evidence.

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

## Build and hardware-free validation

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper build
pnpm --filter @tenkings/ai-grader-capture-helper test
```

The full suite uses injected fake boundaries and must report zero real camera, lighting, controller, or external-network access. It covers loopback/origin enforcement, exact acknowledgements, automatic configured-light application and retry, Rapid next-session readiness, serialized final-grade/release/label preparation, watchdog ownership, serialized capture, capture lock, camera ownership, scoped orphan cleanup, exact frame identity, fresh/stale handling, and the absence of removed routes and fallbacks.

Generic simulator/readiness commands remain hardware-free:

```powershell
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js health
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js readiness
pnpm --filter @tenkings/ai-grader-capture-helper exec node dist/cli.js capabilities
```

Real hardware operation requires the protected installed bridge and normal station UI. Production-installed sacrificial/debug capture modes are not part of the supported workflow.

## Failure behavior

A failed capture or processing operation returns one exact terminal error and releases only work whose physical outcome is definite. An ambiguous in-flight physical operation remains owned by the bridge until it terminates; no overlapping retry is allowed. The UI must allow a new clean card/session after terminal cleanup rather than entering a permanently wedged browser state.

If configured positioning-light application fails during Start New Card or Rapid continuation, the browser refreshes the authoritative bridge state, shows that single error, and leaves **Start New Card** available for retry. The visible Live/Off control is derived from complete returned acknowledgement state, not a stale browser draft.

No failure may silently publish partial data, reuse an old report, substitute sample/public-report data, or activate inventory.
