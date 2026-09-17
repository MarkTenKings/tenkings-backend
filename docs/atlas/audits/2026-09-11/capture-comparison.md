# ATLAS capture, upload, identity, and image preparation versus Ten Kings

Read-only architecture audit, 2026-09-11. Source checkout: `bd6ff5d058cb4a53c542025d4b4715a5f934ad08`, documentation above deployed `89c55d916130d914f6a989197538c8bbd31c9594`. No application source changes, production mutations, or provider requests were made by this subtask. The offline codec experiment read retained local evidence and saved only numeric results.

## Findings that explain the experience

1. **The photographed HEIC pair really became 30.10 MB of PNG in production.** The matching retained original HEIC pair is 3.18 MB. Conversion preserved the 3024 × 4032 pixel dimensions but increased encoded bytes 9.48 times. This is a byte amplification measurement, not a measured speed ratio. Native JPEG capture already avoids this conversion, and the first failed live card was native JPEG; PNG inflation therefore cannot explain the entire current grading failure.
2. **ATLAS postpones every first upload until both sides are prepared, then holds one browser-wide network lock through upload, verification, identification, and queueing.** Two object PUTs overlap. Their planning and completion APIs do not. The next card can be photographed and prepared but cannot begin its upload pipeline during the preceding card's OCR/model wait. This is an explicit implementation bottleneck, not a network hypothesis. [C1], [C2]
3. **The browser is not doing all HEIC work on its main thread, and it is not rewriting every photograph on every progress update.** HEIC decode/PNG encode uses a dedicated worker and OffscreenCanvas. IndexedDB v2 writes each immutable Blob once and rewrites a smaller manifest. Remaining risks are the initial durable save before releasing the shutter, a single manifest write chain, repeated full-resolution preview decoding, source hashing, memory pressure, and camera fallback work. [C3], [C4], [C5], [C6]
4. **Large originals make several trips before even reaching the separate MAX grading operator.** Upload verification downloads and hashes each original; identity reads it again through the private service and relays it to the staff app, where 1400-pixel JPEGs are derived. The displayed OCR timer starts after these reads and derivation. CSS-sized previews also fetch full originals after the local upload files are released. [C7], [C8], [C9], [C10]
5. **Current Ten Kings Speedster has a materially shorter control path into deterministic geometry.** Its Front and Back pipelines each do upload → verify → geometry independently, in parallel. Its iPhone capture route plans both sides in one API and completes both in another; already-uploaded iPhone references bypass another desktop upload. This is distinct from the main Add Inventory page, which captures JPEG and begins Front upload while the human takes Back/Tilt. Neither should be conflated with an independently proven fast Astra/MAX operator. [C11], [C12], [C13], [C14]
6. **The shared image mathematics are not the chief architectural difference.** The current shared engine rectifies to 1270 × 1778, produces four expanded 1350 × 1858 views, and writes WebP quality 92. ATLAS wraps that core in additional capture decisions, authority checks, a repeated source freeze, and repeated full-manifest reads. Original retention alone does not make the downstream pipeline lossless. [C15], [C16], [C17]

The recommendation is a smaller pipeline: accept one grading-useful source per side, start each side's transfer immediately, verify and derive near storage once, pass immutable references between services, run deterministic geometry directly, and invoke the model for identity and genuinely ambiguous grading decisions. Keep durable operation identities, exact source-to-result binding, calibrated measurement, and human approval. Remove repeated byte transport and make recoverable ownership independent of a frozen automation screen.

## Evidence and measurements

The live metadata receipt is [live-catalog-1789153377362.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-catalog-1789153377362.json), observed `2026-09-11T19:02:57.139063+00:00`. Only safe metadata was inspected. It confirms:

| Live card | Front | Back | Pair bytes |
|---|---:|---:|---:|
| First failed card `b56f75a9-0483-433e-801f-d139f7716fe9`, native JPEG | 7,348,508 | 7,648,653 | **14,997,161** |
| Second waiting card `9684574e-bd74-4228-8c82-ad40b78aa7e2`, `IMG_9474.HEIC.png` / `IMG_9475.HEIC.png` | 16,010,165 | 14,086,359 | **30,096,524** |

The second pair's production PNG sizes exactly match the retained Sept 10 browser conversion proof. The source HEIC sizes below come from that **local Sept 10 proof**, not from a claim that production received or retained HEIC. Local receipts: [browser-proof.json](/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/heic-20260910/validation/browser-proof.json), [decode-validation.json](/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/heic-20260910/validation/decode-validation.json), and [isolated intake result](/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/heic-20260910/validation/photo-intake-ui-1789059282711/result.json). The original files remained local; only PNG was uploaded in that proof.

| Representation of the retained same pair | Front bytes | Back bytes | Pair bytes | PNG divided by representation |
|---|---:|---:|---:|---:|
| Original HEIC | 1,860,194 | 1,316,083 | 3,176,277 | 9.48× |
| Browser Display P3 PNG; same sizes now live | 16,010,165 | 14,086,359 | 30,096,524 | 1.00× |
| Offline JPEG quality 95, 4:4:4, full dimensions | 4,010,763 | 3,344,074 | 7,354,837 | 4.09× |
| Offline JPEG quality 98, 4:4:4, full dimensions | 5,539,097 | 4,556,267 | 10,095,364 | 2.98× |
| Offline lossless WebP of transformed sRGB pixels | 7,480,248 | 6,123,362 | 13,603,610 | 2.21× |

The offline experiment is [capture-codec-experiment.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/capture-codec-experiment.json). It used Sharp 0.33.5/libvips 8.15.3, explicit orientation and sRGB conversion, full 3024 × 4032 dimensions, and in-memory outputs. JPEG 95 encode took 140.3/125.3 ms; JPEG 98 took 142.4/136.0 ms; lossless WebP took 4636.9/4572.9 ms on this local runtime. These are **native local encode measurements**, not phone/browser/service latency predictions. The earlier browser proof measured approximately 1.85/1.79 seconds for full HEIC-to-PNG conversion in its local Chromium environment.

The JPEG 95 pair has mean absolute per-channel error 0.857/0.687 and PSNR 46.31/47.91 dB relative to the corresponding oriented sRGB reference; JPEG 98 has MAE 0.551/0.480 and PSNR 49.47/50.35 dB. Lossless WebP matches that transformed reference exactly, not necessarily the original Display P3 values. Neither dimensions nor whole-image PSNR prove preservation of the small edge/surface findings that affect grading. Test those findings before adopting a lossy conversion policy. This experiment is evidence for a practical candidate, not a quality sign-off.

Each 3024 × 4032 image has 12,192,768 pixels and a 48,771,072-byte RGBA raster, about 46.51 MiB. Two concurrent conversions can therefore have over 93 MiB in just two decoded rasters before compressed files, WASM heap, canvas backing, copies, previews, and browser overhead. The Sept 10 native validation recorded a 91,357,184-byte WASM heap and much higher process RSS, but that process RSS must not be presented as measured iPhone memory. The implementation caps conversion concurrency at two; actual browser memory/GC impact remains unprofiled. [C2], [C4]

### What the screenshot's 35.3 seconds includes

| Displayed metric supplied with the incident | Observed | Actual scope in code |
|---|---:|---|
| Front preparation | 1.4 s | Selection preparation/hash and intervening waits up to the metadata timestamp; does not include every final IDB write |
| Back preparation | 0.6 s | Same; may overlap Front and human activity |
| Upload + verification | 16.5 s | Entire `uploadRapidIntakeEntry`: create, hashes if required, plans, PUTs, local durable transitions, serialized verification APIs |
| OCR + identification | 6.4 s | Provider function: two concurrent OCR requests followed by one low-effort Astra request; excludes source download/relay, JPEG derivation, and surrounding DB transactions |
| Queue confirmation | 0.8 s | Queue-side client work and confirmation before final persistence finishes |
| First photo to queue | 35.3 s | Wall time from first selection, including human time between photos, preparation, serialized waits, access refresh, identity work outside the provider timer, and interruptions |

These values are not an additive profiler. The first four rows can overlap or omit work; subtracting them from 35.3 seconds does not isolate a trustworthy "overhead" measurement. The 16.5-second segment is the largest shown automatic segment, but its internal upload, verification, and DB contributions need separate spans. [C1], [C2], [C9]

## Exact ATLAS sequence and if-then behavior

### Capture and local durability

- The camera requests the rear-facing camera with ideal 4032 × 3024 settings and no resize mode. If native `ImageCapture.takePhoto` works, it requests the capability's maximum dimensions and keeps the returned supported JPEG/PNG/WebP Blob. Native capture is not guaranteed to return JPEG on every device. If ImageCapture is unavailable or reports `NotSupportedError`, it draws the actual video frame into a same-size canvas and encodes PNG. Other native errors do not silently fall back. No explicit deadline is installed around `getPhotoCapabilities`/`takePhoto`. [C3]
- The shutter sets `busy`, captures the photo, then awaits `onCapture`. That callback persists the selected file in IndexedDB before returning. The shutter can therefore display "Saving photograph" while the initial durable save or camera operation is outstanding. It does **not** await full upload, OCR, or queueing. The camera component remains mounted across successive cards. Hiding the page stops the stream and resumption requires reopening it. [C5]
- `selectFile` refuses changes to an entry with a pending operation, active run, or non-editable state. After Back is durably selected, it creates the next blank entry if fewer than ten entries exist. Preparations run independently with a global limit of two. Non-HEIC JPEG/PNG/WebP is accepted unchanged; HEIC uses a dedicated worker, preserves dimensions and supported color interpretation, emits PNG, hashes both source and imported bytes, and retains the HEIC in local `sourceFiles`. [C2], [C4]
- IndexedDB uses staff ID as its draft key, without a cohort key. Blob identity is stable and only newly referenced Blobs are written; progress updates rewrite the manifest. A single promise chain serializes all manifest saves. The draft loader retrieves all retained referenced Blobs. There is no IDB timeout; an unresolved database open/transaction can leave storage readiness or an initial shutter save unresolved. This is a plausible stall mechanism requiring browser traces, not proof of the observed failure. [C6]
- Both prepared files or already-verified sides must exist, pair confirmation must be true, and no selection may remain pending before automatic upload starts. There is no early upload of a prepared Front while Back is still being taken/prepared. [C1], [C2]

### Upload, verification, identification, queue

Fresh successful path, without retries or human identity edits:

```text
one global client run lock acquired
  await queued local saves
  GET fresh staff session
  POST create card
  describe/hash both sides in parallel (reuse HEIC import hash)
  POST Front upload plan
  start Front object PUT ──────────────┐
  POST Back upload plan               │ overlap
  start Back object PUT ───────────────┘
  await both PUTs; persist outcomes
  POST Front upload completion → server HEAD + full GET + SHA + decode
  POST Back upload completion  → server HEAD + full GET + SHA + decode
  sync any edited identity
  POST identify
    read both originals via private service in parallel
    relay full bytes to staff app; derive 1400 px JPEGs there
    reserve exact identity attempt
    Google OCR Front || Google OCR Back
    one Astra low-effort identity request
    commit suggestions and timing
  POST queue
  release global run lock; next card's network pipeline may begin
```

This is **10 browser HTTP requests** on the stated fresh path: session + card creation + two plans + two PUTs + two completion calls + identify + queue. Eight are application APIs; two carry large source images. Browser page/activity/readiness/preview traffic, edits, retries, and later grading are additional. Plans and completions are serial because each uses the card's current revision. A lost response is resumed with its retained original operation; the code does not invent a fresh upload in that case. One automatic client retry is allowed for an eligible retained operation after 1.5 seconds, excluding sign-in/CSRF failures. [C1], [C2]

Each plan binds the operation inside a staff transaction, requests the private upload grant outside that transaction, then rechecks/projects inside a second transaction. Each completion similarly binds inside a transaction, verifies the object outside it, and commits/project inside another. Private service authorization also happens before and after its storage action. This yields at least nine staff transaction invocations for create plus the four planning/completion APIs, before identity's three transaction phases and queueing; it is not a count of SQL statements or a measured DB latency total. [C7], [C8], [C18]

Identity is a separate `gpt-6-astra`, reasoning `low`, default-tier, 2400-output-token request. It is not the MAX grading operator. Both OCR requests overlap; Astra waits for both OCR results or OCR fallback. The code has OCR, model, and overall deadlines and preserves an uncertain attempt instead of automatically billing a replacement. The source JPEGs are derived at maximum edge 1400, quality 90, 4:4:4; that is specifically the identity image path, not the preserved grading source. [C9]

For a pair of original encoded size **B**, a successful initial intake/identification performs these full-image network legs before previews or MAX grading:

| Leg | Bytes across that leg |
|---|---:|
| Browser → object storage PUT | B |
| Object storage → private service, upload verification GET | B |
| Object storage → private service, identity source GET | B |
| Private service → staff app, identity source response | B |
| **Aggregate transferred across these legs** | **4B** |

That entails two S3 PUTs, two HEADs, and four GETs, plus six private storage calls (two grants, two verifications, two reads). For the live PNG pair, the code-derived leg budget is **120,386,096 bytes**, before derived-provider inputs, image previews, and grading. This is a transfer-accounting model, not a packet capture or 120 MB uploaded from the phone.

After queueing, the client clears `files.FRONT/BACK` but retains HEIC `sourceFiles`. `PhotoPreview` then switches from local object URLs to authenticated **original-image** endpoints. Each loaded full pair can add storage → private service → staff app → browser, another 3B of transfer across legs, despite thumbnail-sized CSS. If all these loads occur without reuse, the combined budget is 7B = 210,675,668 bytes for this pair. Actual cache reuse, browser request behavior, and concurrency require observation; do not report 7B as measured traffic. All visible entries render and there is no thumbnail derivative or lazy-image attribute in this component. [C2], [C10]

If the identity derivative pair totals D bytes, Google receives approximately 4D/3 in base64 and Astra receives another 4D/3, plus JSON/text. This is much smaller than sending the original PNG if D is appropriately bounded. The avoidable part is moving the large source to the staff app to make those derivatives.

### Copies and repeated hashing

The identity READ_ORIGINAL path hashes the same original at least six times in the current layers: private `readExact`, private response signature, staff signature verification, returned transport digest, staff read wrapper, and identity derivation. Private reads buffer chunks then concatenate; the bridge bounded reader owns/copies chunks then concatenates; the staff wrapper copies already-buffered data again; Sharp allocates decode/encode data. These operations preserve bindings, but identical immutable bytes are repeatedly processed. Exact peak concurrent allocations cannot be inferred simply by multiplying these copies because buffer lifetimes and garbage collection differ. [C8], [C9], [C19]

Upload verification unconditionally HEADs **and downloads the entire object**, even if a checksum header exists, then hashes and fully decodes it. This deliberate distrust has supporting local evidence from the earlier storage probe: the provider did not reliably enforce the supplied checksum header. Do not replace this with blind HEAD trust. Instead verify once near storage and propagate a signed immutable receipt to downstream consumers. [C8]

The browser's normal API timeout is 15 seconds, whereas private calls may allow 60 seconds and storage verification has individual HEAD/GET deadlines. Consequently a completion operation can outlive the browser's request window. Retained operation handling makes resumption possible but the UI can appear interrupted. This timeout mismatch is source-confirmed; whether it caused this incident needs request spans. [C20]

## What the Ten Kings comparisons actually show

### Speedster desktop

`PhotoUploadPair` represents either a local File or an already-uploaded iPhone storage reference. The accepted local formats are JPEG, PNG, and WebP, without ATLAS's HEIC worker conversion. It creates local preview object URLs and does not use ATLAS's durable draft machinery. `uploadSpeedsterOriginal` hashes the unchanged File, plans a direct upload, PUTs it, and verifies it. No implicit browser downsize occurs in that helper. [C11], [C12]

When the human starts geometry with both sides selected, `CaptureWorkspace` launches two whole side pipelines in a `Promise.all`: Front upload/verify → Front physical COLOR geometry; Back upload/verify → Back physical COLOR geometry. A side can proceed when its own verification completes. An iPhone reference skips upload and uses its existing storage key/read URL. This short path is a concrete architectural contrast to ATLAS's pair-level global orchestration; it is not evidence that the current source candidate is the exact historical production release associated with the user's fastest observation. The serving SHA/timing trace of that original fast run was not established in this subtask. [C11]

The general Ten Kings storage integrity function can finish after HEAD when a valid native checksum exists, otherwise it streams a GET and hashes. It does not perform ATLAS's full raster validation at that upload step. This can reduce work, but its suitability depends on actual storage-provider checksum guarantees. It cannot be copied blindly into ATLAS after the negative checksum-enforcement probe. [C21]

### Speedster iPhone route

The documented iPhone Shortcut converts images to maximum-quality JPEG. Its Worker receives the pair in one multipart POST, hashes both sides in parallel, calls one pair PLAN API, uploads both objects in parallel, then calls one pair COMPLETE API. The plan and completion server paths operate on both sides concurrently. Desktop then consumes the resulting immutable references. [C13]

There are still two large transfer hops here—phone → Worker and Worker → object storage—so "already uploaded" does not mean zero upload cost. Its main improvements are a standard compatible source format, pair APIs, concurrent work, and avoiding an extra desktop reupload. This audit did not inspect a live Shortcut execution or measure current iPhone throughput.

### Main Ten Kings Add Inventory page: a separate baseline

At this checkout, the native page uses Front → Back → Tilt. Shutter canvas output is JPEG at quality 0.92 using delivered video dimensions, and a 250 ms shutter lock limits double taps. Front upload begins immediately while the human moves to Back/Tilt. Finalization waits for Front, then uploads Back and Tilt; OCR warming is fire-and-forget after the upload work rather than a prerequisite for taking the next photograph. The upload helper currently assigns `optimizedFile = file`; the reviewed path does **not** implement a 1400-pixel browser resize. [C14]

This explains much of the apparent capture responsiveness without assuming superior backend grading speed. It has different durability, image format, number-of-photos, and automation guarantees. Describe it as a useful pipeline/UI pattern, not a drop-in reproduction of ATLAS's exact product promises.

## Source freezing and deterministic image preparation

The shared CPU preparation core takes a source image and physical quad, rectifies to 1270 × 1778, produces an expanded 1350 × 1858 inspection frame plus reveal variants, and writes five quality-92 WebP artifacts in parallel. Reveal transforms include CLAHE, small-feature enhancement, and edge processing. ATLAS and the current Speedster preparation service share this code; there is no evidence here that ATLAS uses a fundamentally more capable image engine merely because it retains PNG. [C15]

Current source-storage preparation performs substantial validation and copying:

1. `freezeSpeedsterPreparationSource` reads the original, hashes it, fully decodes it with Sharp `stats()`, then creates a separate frozen source object. The freeze helper probes for an existing object and reads back any new object to verify it.
2. The worker reads the frozen source and creates five staging outputs.
3. Adoption rereads the source plus all five staging outputs, fully decodes the five outputs, checks shape/hash/manifest, and creates five accepted artifact objects. Each newly created accepted artifact is read back.
4. Returning an adopted result verifies the source plus all five accepted outputs again—six object GETs.
5. ATLAS's adapter calls source freeze once before physical geometry and then invokes the shared preparation service, which freezes the source again. ATLAS subsequently calls its status projection, which verifies the adopted six-object manifest again, even though the shared service already did so before returning. [C16], [C17], [C22]

For a normal new side this architecture can retain twelve logical image objects: the original, the frozen source, five staging outputs, and five accepted outputs. Some work is parallel and reuse/idempotent retries alter GET counts. The repeated source freeze plus extra six-object verification are directly supported costs; this report intentionally does not turn every conditional GET into a false measured serial latency total.

The authority boundary has value: the source, side, quad, calibration, worker release, artifact hashes, and accepted attempt must be bound together. The expensive implementation choice is using multiple complete object copies and rereads to restate that same proof. A receipt and immutable content identity can carry the proof without using the pixels as a control-plane message.

## Why capture and manual controls can look stuck

There are several different gates, and changing only a button's disabled property would not resolve their server-side conditions.

| Symptom | Code condition | Interpretation |
|---|---|---|
| Camera "Saving photograph" | Busy until native capture and initial `selectFile` durable save finish | Camera operation/IDB can stall shutter; upload/model work is not itself the camera busy condition |
| Camera has no next target | All visible entries already have selected pairs, are pending/non-editable/resolved, or ten slots are occupied | Slot/entry lifecycle issue; the long-running network lock does not directly disable the camera |
| Replace Front/Back disabled | Same entry is queued, pending, or in `running` | Exact pair is locked while its operation is unresolved |
| Next card remains local | Any card holds `running.current` | Global pipeline lock includes preceding OCR/model/queue wait |
| "Grade this card" disabled | Card not claimable under server `humanClaim`: WAITING, reviewer role, no claim, policy/capacity available | A shared distinct-card processing limit can block the second human card, not only another Astra run |
| Manual preparation/identity forms unavailable | Card still has an ASTRA claim | UI displays `AstraStageView`; manual actions require current user's exact HUMAN claim/fence |
| Take over disabled during uncertain work | Pending dispatched/received/unknown attempt, active/unknown source permit, or result not yet projected | Deliberate ownership hold prevents concurrent grading changes; paid/result settlement must be reconciled or old authority fenced |
| Take over unavailable on a terminal run | SQL sets `active` only for QUEUED/RUNNING/WAITING_TOOL/UNKNOWN/PREPARATION_READY | FAILED/NEEDS_RECAPTURE/NEEDS_EXPERT may display needs attention while `canTakeOver=false`, even if no held work remains |

Sources: [C2], [C5], [C6], [C7], [C23], [C24], [C25]. The terminal-state takeover condition is a specific code-level recovery gap to compare against the root incident's actual run/claim state. It is not proof that every failure matches it. No blanket "CAPTURE_REVIEW can never be manual" rule was found; the actual locks are ownership, stage capability, unresolved source/result state, and policy. A separate literal `captureBlocked` label, if present in another projection, should be reconciled against root's runtime evidence.

Manual source actions further require reviewer ownership of the exact HUMAN claim, no pending workspace action, no existing specimen, valid policy/source readiness, and the prior stage data. Identity must precede boundary/preparation. Takeover changes the claim fence only after the control result says TAKEN_OVER, settled, and zero pending. The screen is reflecting durable control rules rather than just a stale spinner. [C24], [C25]

## Concrete replacement design and keep/simplify/delete decisions

### Priority 1: make the capture loop independent of identity and grading

**Keep:** the always-mounted camera, captured image dimensions, clear Front/Back identity, local selected-file durability, immutable operation IDs, and safe resumption.

**Simplify:** per-side states `LOCAL → UPLOADING → VERIFIED`, and per-card states `PAIR_READY → IDENTIFYING → QUEUED`. Start Front upload as soon as its source is prepared, while the human takes Back. Use a bounded transfer queue (initially two concurrent objects) and a separate identity queue. Each card needs its own retained operation state; the whole browser must not lock behind another card's model call. Release the shutter after the selected photo is safely stored and the next capture target is available. Bound and surface local-storage/camera waits with explicit recoverable errors.

**Delete:** the single `running.current.size` admission gate spanning upload through identity for every card. Replace it with per-card exclusion and bounded stage concurrency. This changes the scheduler, not the requirement to keep exact operations and pairs consistent. Do not simply turn every card loose in unconstrained `Promise.all`.

**Tradeoff:** concurrent transfers can contend on poor uplinks. Start with two objects and measure; do not promise a speed multiplier. Keeping local durability may still impose an initial save pause, but it must be measured separately and must not wait for network/model work.

### Priority 2: choose the source for grading usefulness, not its file extension

**Keep native supported JPEG bytes unchanged.** This path already exists and avoids browser HEIC decode/PNG expansion. Do not upscale a video fallback and claim native resolution.

**For HEIC, evaluate full-dimension quality-95/98 4:4:4 JPEG as the standard compatible source**, with explicit orientation/color treatment. The offline pair falls from 30.10 MB to 7.35–10.10 MB. Do not resize to 1400 pixels for grading. Validate the actual small defects, edge traces, measurements, color interpretation, and scores against approved references before changing source policy. If lossy parity fails for relevant defects, test a better codec setting or a lossless format; full-resolution lossless WebP reduced bytes here but took substantially more local CPU.

**Simplify original retention after policy approval:** retain one accepted grading source, its hash/dimensions/color/codec lineage, and sufficient replacement/review evidence. The current approved blueprint explicitly preserves original HEIC locally and untouched grading sources; changing that is an owner-approved policy correction, not something this audit silently implements. During codec validation retain the originals. Permanent redundant HEIC + PNG retention is not an end in itself once the owner accepts a grading-useful source policy.

**Delete:** automatic full PNG as the only HEIC-compatible outcome if a validated compact representation meets the grading requirements. Also add explicit lifecycle/expiry controls for queued local drafts; current staff-only IDB scope leaves old HEIC source references retained after queueing and across cohorts.

### Priority 3: reduce the upload API and byte path

**Simplify pair APIs:** create/bind the card and two immutable upload IDs with one pair plan; PUT each side as soon as available; confirm both with one pair completion that verifies sides concurrently and atomically adopts the exact pair. A per-side early plan or preallocated capture slot can permit Front to start before Back exists. Avoid making "one pair request" a new reason to wait for Back. Use upload IDs/hash bindings instead of serially revising the entire card for each side's bookkeeping.

**Verify once near storage:** a colocated verifier downloads/hashes/decodes once, produces a signed immutable source receipt, and derives identity JPEGs and preview thumbnails in the same pass. Subsequent services validate the receipt/binding instead of repeating full source transfer and hashing. Keep source integrity checks strong, including the proven need not to trust this provider's checksum header alone.

**Delete:** the full-original private→staff relay merely to make 1400px identity JPEGs, duplicate hash passes for unchanged trusted transport buffers, and full-resolution original fetches for thumbnail UI. Give preview endpoints bounded derivatives (for example 512–800 pixels), render lazily, and use an explicit private cache policy. Original zoom remains a deliberate full-resolution fetch.

**Tradeoff:** a durable verifier/derivative receipt becomes an important trust boundary. It must bind object version/create-only identity, hash, source dimensions/color, and derived encoder version. Do not introduce an unsupported "verified" flag without those fields.

### Priority 4: reduce preparation to one source and one accepted artifact set

**Keep:** deterministic physical/printed COLOR geometry, owner-approved calibration, source/quad/side binding, CPU release identity, canonical inspection dimensions, exact derived artifact hashes, and human override/review.

**Simplify:** reuse the source receipt from intake; call deterministic physical geometry directly; submit one bound preparation job per side. A model can inspect a low-cost overview and handle ambiguous geometry or capture quality, but routine full-pair and corner exchanges should not be a mandatory prerequisite for a deterministic worker that can evaluate the same image itself. This is a proposed architecture change to be reconciled with the operator report and blueprint, not a claim this subtask already removed those calls.

**Delete:** ATLAS's outer repeated freeze before the shared service freezes again; the extra full-manifest reads performed simply to return a status already verified during adoption; and full original source duplication where immutable versioned object references supply the same binding. Have the trusted worker write final create-only attempt objects, verify/adopt them once, and reference the accepted set from its manifest. Retain a separate staging copy only where it establishes a concrete trust or transactional requirement that cannot be met by immutable attempt objects.

**Tradeoff:** eliminating redundant copies needs an explicit lifetime/version policy and garbage collection. Do not overwrite live source aliases or accepted artifacts. The goal is fewer object movements with the same proof, not weaker lineage.

### Priority 5: make manual continuation a normal path

**Keep:** one editor at a time, exact source-pair ownership, human grade approval, and honest accounting of uncertain paid work.

**Simplify:** offer a clear takeover/continue-manually state for settled terminal failures. For an unresolved external request, fence the old run's ability to mutate the card separately from retaining its unresolved billing record, then reconcile late results against that old fence. This requires root's incident/ledger analysis; blindly clearing pending rows or enabling buttons would be unsafe and would not solve server ownership.

**Delete:** the terminal-run dead end where the UI keeps an ASTRA claim but the active-state predicate prevents takeover forever. Show the exact blocker and a concrete recovery action rather than only a generic capture/attention label. Capacity policy should distinguish automatic workload limits from a human's ability to inspect/recover an existing card; changing the owner-approved live cohort limit is a separate authorized action.

## Measurements needed before declaring success

- **Browser spans:** shutter click → native Blob; initial IndexedDB enqueue/start/commit; worker startup/decode/encode/hash; first upload start; each PUT start/end/bytes; each plan/complete API; source read/derivation; OCR; identity model; queue commit; second-card upload start. Record card/side/operation identifiers, not image bodies.
- **Responsiveness:** long tasks, frame drops, peak memory where available, preview decodes, garbage collection, IDB queue depth/bytes retained, and behavior when the page hides/resumes. Run on the actual iPhone/browser and network. The HEIC worker means a generic claim of main-thread PNG encode is the wrong diagnosis.
- **Server spans:** separate authentication, transaction/DB queue, grant, HEAD, GET, hash, full decode, derivative encode, private relay, provider, source geometry, CPU worker, manifest adoption and result projection. Record each full-image byte count and object GET/PUT count.
- **Matched comparison:** test the same Front/Back originals and actual capture device against ATLAS, the known serving Speedster release, and the relevant Add Inventory route. Capture the serving SHA and full chronology. Use several representative cards/networks and p50/p95; 35.3 seconds for one pair is not a baseline distribution.
- **Image quality:** use approved cards containing tiny edge chips, whitening, corner wear, scratches, foil/color variation, and printed borders. Compare raw findings and deterministic measurements, not only aggregate PSNR or final grade. Retain a lossless reference during this evaluation.
- **Recovery:** exercise a completed upload with lost response, browser close after Front, timed-out verification, known terminal grading failure, and an uncertain paid request with late response. Confirm no duplicate provider request and that a human can safely continue once old mutation authority is fenced or settled.

No factor-of-10 or factor-of-100 latency improvement was measured. The report establishes concrete redundant work, byte amplification, serialization, and a smaller replacement design. It does not assert that a codec change alone repairs the active operator incident.

## Source citations

All file links below target the audited checkout. Line ranges in labels describe the relevant span; links open at the first line.

[C1]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/rapid-intake.mjs:18
[C2]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/PhotoIntake.jsx:99
[C3]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/rapid-camera.mjs:3
[C4]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/workspace-client.mjs:105
[C5]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/RapidCardCamera.jsx:38
[C6]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/workspace-drafts.mjs:15
[C7]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-intake.mjs:134
[C8]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSourceStorage.ts:63
[C9]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-identification-provider.mjs:33
[C10]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/WorkspaceShared.jsx:20
[C11]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/components/ai-grader-v2/CaptureWorkspace.tsx:1457
[C12]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/ai-grader-v2/image-service.ts:672
[C13]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/workers/speedster-iphone-capture/src/index.mjs:14
[C14]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx:3642
[C15]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/backend/ai-grader-speedster-service/preparation_core.py:153
[C16]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/speedsterPreparationStorage.ts:75
[C17]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSource.ts:388
[C18]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSourceHost.ts:179
[C19]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/packages/atlas-service-bridge/src/workspace.mjs:62
[C20]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/client-request.mjs:3
[C21]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/storage.ts:204
[C22]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/speedsterPreparationService.ts:89
[C23]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/CardGradingWorkspace.jsx:87
[C24]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-manual.mjs:84
[C25]: /Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/prisma/migrations/20260911070000_workspace_capture_readiness/migration.sql:54

Additional precise spans for review:

| Source | Relevant lines |
|---|---|
| [PhotoIntake selection/preparation and persistence](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/PhotoIntake.jsx:51) | 51–65 serialized persistence; 99–147 selection/preparation; 195–220 queue and file release; 223–263 global lock; 266–324 target, controls, timings |
| [HEIC worker wrapper](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/heic-import.mjs:10) | 10–53 per-photo worker, 90-second deadline, termination, File handoff |
| [HEIC worker](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/heic-import.worker.mjs:23) | 23–43 decode, OffscreenCanvas, ImageData, color space, PNG encode |
| [Client source preparation/upload](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/workspace-client.mjs:87) | 87–90 session; 105–143 HEIC import and original retention; 160–165 SHA; 169–188 PUT |
| [Draft storage](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/workspace-drafts.mjs:67) | 67–104 manifest writes and Blob deduplication/removal |
| [Intake authority/protocol](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-intake.mjs:212) | 134–178 claim projection; 212–232 original read; 235–259 creation; 267–316 plan; 319–370 completion; 373–378 pair binding |
| [Production verification](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSourceStorage.ts:119) | 119–134 HEAD, full GET, SHA/checksum and decode |
| [Private host response signing](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSourceHost.ts:184) | 184–199 before/after authority; 215–216 binary signed response |
| [Bridge bounded byte copies](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/packages/atlas-service-bridge/src/transport.mjs:3) | 3–14 chunk ownership and concatenation |
| [Staff source read wrapper](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-intake-storage.mjs:12) | 12–69 bounded read/copy/hash |
| [Identity orchestration](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-identification.mjs:88) | 88–114 validation; 117–121 parallel source read/derive; 122–153 reservation; 155 provider; 162–194 result transaction |
| [Identity derivative and provider](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-identification-provider.mjs:138) | 33–55 1400px JPEG; 89–106 low-effort request; 138–177 OCR/model order and provider-only timing |
| [Speedster local/iPhone representations](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/components/ai-grader-v2/PhotoUploadPair.tsx:7) | 7–14 source variants; 45–64 preview/accepted formats |
| [Speedster independent side pipelines](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/components/ai-grader-v2/CaptureWorkspace.tsx:1583) | 1457–1486 source handling; 1487–1529 geometry; 1583–1598 pair concurrency |
| [iPhone pair APIs](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/api/ai-grader-v2/iphone-capture.ts:136) | 136–149 parallel completion; 155–174 pair planning |
| [iPhone Shortcut format](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/docs/runbooks/AI_GRADER_V2_IPHONE_CAPTURE.md:28) | 28–31 documented JPEG maximum-quality conversion |
| [Inventory unchanged upload input](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx:2010) | 2010–2124 optimizedFile=file and direct upload |
| [Inventory background finalization](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx:3561) | 3561–3638 Front/Back/Tilt drain and fire-and-forget OCR |
| [Inventory shutter](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/pages/admin/uploads.tsx:3743) | 3743–3789 250 ms lock and JPEG 0.92 |
| [Shared full decode/artifact verification](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/speedsterPreparationStorage.ts:56) | 56–72 stats decode; 93–107 freeze; 111–155 five-artifact adoption; 159–168 six-object verification |
| [Shared adopted response](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/speedsterPreparationService.ts:33) | 33–45 manifest reread; 114 source freeze; 126–159 worker/adoption |
| [ATLAS status/geometry](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/nextjs-app/lib/server/atlasWorkspaceSource.ts:325) | 227–266 physical geometry; 325–375 status manifest verification; 388–425 duplicate freeze/shared service/status |
| [CPU codec/geometry](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/backend/ai-grader-speedster-service/preparation_core.py:93) | 93–126 warp/reveals/WebP92; 153–233 source read, dimensions, five concurrent output writes |
| [Takeover control projection/mutation](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/workspace-operator.mjs:195) | 195–196 settled requirement; 317–324 zero-pending takeover and new HUMAN claim fence |
| [Takeover button](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/components/WorkspaceActivity.jsx:116) | 116 disabled-state conditions |
| [Takeover SQL](/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean/frontend/atlas-app/prisma/migrations/20260910060000_workspace_capture_claim/migration.sql:201) | 201–202 unresolved-work refusal |
