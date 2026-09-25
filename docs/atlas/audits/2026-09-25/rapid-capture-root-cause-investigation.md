# Rapid capture: failure investigation and scalable recovery design

Investigation date: 2026-09-25 UTC. Status: evidence-backed diagnosis and implementation proposal; no recovery, grading, deletion, or application changes performed by this investigation.

## Finding

Photography is producing retained images, but the current system does not reliably carry every captured pair through upload, preparation, machine grading, and review. The evidence establishes several different stopping points. They require different recovery actions; one generic error and one Resume button cannot represent them accurately.

The latest owner diagnostic contains 23 pairs. The first 15 have completed the browser's upload/preparation/enqueue workflow. That does **not** mean they have machine grades. Three further pairs have server cards and partially advanced uploads; five more pairs have no committed server card as of the final scoped database check. Separately, saved grading jobs are held by identity/geometry gates, two earlier processing errors, and one confirmed failure to advance after an analysis result arrived successfully.

The strongest confirmed orchestration defect is Card 7: its existing paid analysis produced a READY receipt, but its batch job remained NEEDS_ATTENTION after `ECONNRESET`. Nothing automatically reconnects that receipt to the stopped batch job. A second confirmed architecture gap is that the batch worker cannot discover persisted work after restart without a browser-supplied authenticated owner. Neither mechanism meets unattended, durable processing.

Provider request logs independently confirm HTTP 503s on upload completion, preparation, card creation, queue reads, Resume, and session reads before the design deployment, and further 503s after it. Thus the latest blocked uploads are not merely a misleading visual state or a slow model. The request failure can be narrowed to its application boundary, but its underlying server exception cannot honestly be named from the present diagnostic/logs: the API catch discards it. The generic `TEMPORARILY_UNAVAILABLE` errors cannot be labeled a decoder failure or a storage outage.

## Scope and evidence quality

The approved V2 blueprint was read in full. Its continuous capture, original preservation, automatic processing, and human final review requirements govern the proposal. Code, database, immutable artifacts, and runtime inspection establish implemented behavior.

Read-only evidence collected:

- Repeatable-read, read-only SQL snapshots before and after the unrelated design deployment. SQL sessions enforced `default_transaction_read_only=on`; no application queue-list API was used because it wakes workers.
- Exact object HEAD/GET, full byte-count and SHA-256 comparisons for selected unfinished original uploads; exact saved identification artifacts and image inputs.
- Source traces from capture through importer, upload reconciliation, preparation, batch worker, model receipts, and presentation.
- Four offline source-import probes with stubbed effects: transient failure plus later READY receipt, restart without owners, rejected concurrency 20 configuration, and a retained partial Front continuing into Back.
- Two offline replays of actual stored unfinished originals through the current photo runtime on Darwin ARM. These test the current decoder against those exact bytes; they are not production Linux throughput or end-to-end acceptance tests.
- The owner's current diagnostic export, SHA-256 `03f793167d5dfbb9234de0c7abc068bf3860a72d76ab706e8be145350bfa0028`.
- Independent source and image review by two other investigators; separate capacity/dispatch review.

Private identifiers, images, credentials, and diagnostic bodies remain outside Git. Evidence resides under `/Users/markthomas/.codex/atlas-handoffs/atlas-rapid-investigation-20260925`. The investigator's collectors performed no model requests, upload retries, job wakes, SMS, database writes, or deletion. The coordinating agent separately made one anonymous session GET; that normal endpoint can create anonymous browser/rate bookkeeping and is not a strictly read-only database probe. It did not act on a card or authenticated owner's queue.

Runtime chronology matters. The original complaint predates the design cutover. The before snapshot at 05:26:36 UTC inspected application source `e4a75df58d0f8c54423b845f1e5e4ffc4d8995bb`; the after snapshot at 05:28:25 inspected `47dffea96b4731395a336b796918d7ca73b41ac0`. Capture/grading logic is unchanged between these releases. The design control-binding and public promotion transition was approximately 05:27–05:30:35 UTC. The diagnostic has no failure timestamps, so a latest generic error could overlap that transition; this is not proof that deployment caused the earlier failures. No OOM or process restart loop was observed. The private runtime allocation is one CPU and 3 GiB memory.

## What actually completed

These states are distinct and must remain distinct in both UI and telemetry:

| State | What proves it | What it does not prove |
| --- | --- | --- |
| Captured locally | A durable local photo record exists | Its backing bytes are still readable, or anything reached the server |
| Object bytes present | Exact object exists in storage | Server verification or source preparation completed |
| Original verified | Stored full byte count and SHA-256 match the upload intent | Decoder/preparation, identity, or grading succeeded |
| Source prepared | Stored source and derivative receipts exist for the current original | A valid pair or a usable identity was established |
| Identified | Identification operation has a terminal result | Required identity fields are known; COMPLETE may contain unknowns |
| Admitted to grading | A durable job exists for the exact pair/source revision | A worker is running it, or a model result is available |
| Analysis ready | Immutable result receipt projects effective READY | Machine report measurement or human review completed |
| Machine report ready | Exact source-bound report exists in REVIEW | Certification/approval occurred |
| Reviewed/approved | Authorized human review and approval receipt | Nothing should infer this from a machine result |

The owner's `done` flag means browser preparation/enqueue finished. It is not a grade or approval flag. The current browser presentation mostly compresses the upload states into “Saved for upload,” “Uploading originals,” or one error, which hides substantial completed work.

### Latest owner export and storage reconciliation

“Card” numbers below are diagnostic ordinals, not public identifiers. Database/object observations are point-in-time snapshots, not promises about later owner actions.

| Cards | Verified observation | Interpretation and confidence |
| --- | --- | --- |
| 1–15 | Diagnostic `done=true`; both originals verified and prepared; corresponding saved batch jobs remain in attention states | Uploading these pairs succeeded. Their remaining problems are later stages. High confidence |
| 16 | Front verified/prepared; Back has a saved plan but exact object was absent. Latest error `TEMPORARILY_UNAVAILABLE`, `RESUME_FRONT_UPLOAD`, `Error` | Resume failed within the existing Front upload journal's multi-step operation; the error label does not mean the Front bytes were never uploaded. High confidence on state; underlying exception unresolved |
| 17 | Front original verified, not prepared; exact object bytes match saved count/hash. Back planned but object absent. Same diagnostic error as Card 16 | Front bytes are safe remotely; preparation/continuation remains incomplete. High confidence |
| 18 | Front object exists and matches count/hash but no verification receipt; Back object absent. Latest error `BATCH_IMPORT_INTERRUPTED`, `RESUME_FRONT_UPLOAD`, `TypeError` | An upload can reach storage before acknowledgment/verification completes. The existing intent must reconcile those exact bytes. High confidence |
| 19–23 | Diagnostic has no server card ID, no saved hashes, and `BATCH_IMPORT_INTERRUPTED`, `CREATE_CARD`, `TypeError`; scoped SQL at 05:40:23 UTC found none of their five exact persisted create-request IDs | No committed intake card existed for these five at that snapshot. They failed before hashing/preparation/grading. High confidence |

All eight unfinished pairs retain local Blob descriptors with nominal sizes totaling 93,146,864 bytes. The diagnostic's `saved=true` checks Blob identity and `.size`, and `hashSaved=true` checks a stored hash. Neither freshly reads the backing bytes. It would overstate the evidence to say all 16 pending local originals were independently proven readable. Cards 19–23 have not reached the importer's first hashing step.

The unfinished stored Fronts for Cards 17 and 18 were independently downloaded and hash-checked. Both decoded successfully through current photo code, retaining their original bytes, 4032×3024 encoded dimensions, orientation 6, and Apple HDR auxiliary data. The approved SDR-base working derivative was 3024×4032. This disproves a blanket claim that those originals are inherently undecodable by current code. It does not prove the same operations completed on the live Linux service.

### Actual later-stage blockers among Cards 1–15

| Cards | Saved blocker | Meaning |
| --- | --- | --- |
| 1, 3 | `BATCH_IDENTITY_NEEDS_REVIEW` | Identification finished but required identity information, including set name, remained incomplete |
| 2, 4, 6, 8, 9, 10, 12 | `BATCH_GEOMETRY_NEEDS_REVIEW` | The saved geometry gate requires review; retrying unchanged input does not remove it |
| 5 | `DEFECT_ANALYSIS_ACTION_CONFLICT` | Earlier action-binding failure remains on the saved job; the prior source fix did not itself resume this historical job |
| 7 | `ECONNRESET` at ANALYZE, followed by a successful READY analysis receipt | Confirmed disconnected job/result progression; recover the existing action, not a replacement paid analysis |
| 11 | `PHOTO_STORAGE_UNAVAILABLE` at PREPARE | Historical saved failure remains despite currently prepared sources; no automatic recovery of that attention job occurred |
| 13–15 | `BATCH_IDENTITY_NEEDS_REVIEW`; completed identification results contain unknown/null identity fields | Exact saved image inputs show wrong orientation, mismatched cards, or incomplete framing; details below |

The total database snapshot has 28 intake cards, 55 upload intents, 16 batch jobs, 22 identification operations, and 5 analysis runs. These are historical totals, not the latest 23-card local sequence and not a count of concurrent work. All 16 saved batch jobs were NEEDS_ATTENTION. The “13 active-work counters are zero” release census therefore does not mean the historical work succeeded or was absent.

## Verified mechanisms

### 1. Upload failure reporting loses the evidence needed to diagnose the request

`CREATE_CARD` wraps session acquisition, the create POST, response decoding, and extraction of the returned card. `RESUME_FRONT_UPLOAD` wraps an existing local intake journal's complete → optional sign/PUT → complete → prepare sequence. The importer retains only a safe error code, coarse phase, and exception name. Front/Back execute together, but only one failure is retained; a Front failure does not establish that Back succeeded.

The exact error namespaces matter:

- `TEMPORARILY_UNAVAILABLE` comes from the outer staff HTTP handler's catch for an untyped exception. Runtime construction, ingress checks, ordinary authentication, and session bootstrap are within this boundary. Normal private intake errors are caught as `INTAKE_TEMPORARILY_UNAVAILABLE`; private proxy/network errors normally become `MANUAL_SERVICE_*`.
- `BATCH_IMPORT_INTERRUPTED` is the importer's fallback when the thrown value has no acceptable code. `TypeError` is consistent with browser fetch/body-read or another JavaScript failure; it does not identify a specific network, server, or Safari defect.
- Direct object PUT exceptions are caught inside the upload client when the importer has not supplied an abort signal, and exact server completion is attempted afterwards. A raw PUT TypeError therefore is not normally the escaping TypeError in this diagnostic. Native byte-read failures are normally converted to `PHOTO_BYTES_UNREADABLE`, which is absent here.
- The UI has no mapping for exact `TEMPORARILY_UNAVAILABLE`, so it shows the generic saved-work/retry message. This is a presentation defect independent of the underlying exception.

Source anchors: [importer](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/batch-import.mjs:192), [request/session wrapper](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/components/BatchImport.jsx:30), [outer catch](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/http.mjs:186), [frontend proxy admission](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/manual-frontend-runtime.mjs:36), [proxy error handling](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-connected-manual/src/transport.mjs:244), [upload reconciliation](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-manual-intake/src/client.mjs:73).

**Certainty limit:** The responsible outer boundary is strongly supported by source. A specific Prisma exception, expired session, service binding mismatch, network loss, or iOS backing-file failure is not established by this export. The brief deployment transition is a confound for untimestamped latest errors. Do not invent a single cause to cover all eight pending pairs.

Existing Vercel logs provide additional, independent evidence. Historical CLI output repeated each page when requested with limit 500; records were deduplicated by request ID, including overlap between files. The four-file sample contains **149 distinct requests: 113 HTTP 503, 33 HTTP 200, and 3 HTTP 409**. These are sampled/truncated windows, not incident-wide totals; 409 is not automatically a failure because upload-absence reconciliation can use it. The inspected intervals include:

- Successful intake operations interleaved with 503s at 05:03–05:04 UTC.
- Multiple intake completion/preparation failures and five create POSTs returning 503 at 05:13:59–05:14:00, well before the design cutover.
- Batch Resume POSTs returning 503 at 05:14:13 and 05:16:20; queue reads and a session GET also returned 503. The stable three-second queue polling continues reporting errors rather than repairing them.
- Eleven distinct 503 requests on the new release at 05:34:49–05:35:06: five batch reads, three upload completions, one upload signing request, and two session reads. These occurred after deployment/promotion verification, so the full incident cannot be explained by the brief transition.

Those API request logs contain no exception message or nested error event. They establish actual failing endpoints/statuses, not the exception or the exact browser failure correspondence. The current owner export still has no timestamps or build identity with which to join each row conclusively.

A read-only check found a fresh, unrevoked session issued at 05:34:41, expiring at 06:04:41, with the current control/access revisions; its browser relation and expiry also pass the current validity predicates. Expected authentication schema columns exist and identity dates are finite. The actual staff DB role has SELECT plus UPDATE on the allowed identity columns, sufficient for PostgreSQL's `FOR SHARE` requirement; missing row-lock privilege is not supported. An anonymous session GET returned 200, but it bypasses the authenticated session lookup/identity-lock branch. A raw Prisma/SQL/transaction failure in this shared authentication path is a plausible category, not a proven diagnosis. Ordinary expiry yields null/401, control mismatch yields a named refusal, and neither by itself explains this generic error. No owner session was impersonated to reach that conclusion.

A direct generated-Prisma read of the latest session with its identity/browser relations also passed at 05:54:50 UTC in an explicitly read-only transaction on the matching private image and actual staff role, taking about 279 ms. No actor was minted and no authentication function or row-lock query ran. This further rules out a deterministic current row/schema/ORM-decoding failure in that environment; it does not reproduce Vercel's pool, runtime cache, or contemporaneous authentication-gate contention.

### 2. Existing upload reconciliation is sound in intent, but too opaque and browser-dependent

On retry, an existing upload ID first attempts server completion against its exact object. The server reuses a committed verification or performs object HEAD plus version/ETag-bound GET, full byte-count and SHA-256 verification. Only an explicit `INTAKE_UPLOAD_ABSENT` permits obtaining a new signed PUT for that same intent. A local fallback is accepted only after matching its count and hash.

This is the correct recovery path for Card 18's already-present original; replacing the card or blindly creating another upload would lose the clean idempotent path. Signed URLs last 300 seconds; the native PUT timeout is 90 seconds. An expired or rejected PUT can be recovered by fresh signing after exact absence reconciliation. However, PUT response status is currently ignored and thrown PUT failures are swallowed before completion. Integrity remains protected by server verification, but HTTP 403/expiry/CORS/network evidence disappears.

Preparation still depends on a browser request after original verification. Source persistence already records a durable early-geometry intent in the same transaction; that useful mechanism should be retained. Pair enqueue, however, occurs in a later source-prepared callback and is not atomic with source persistence. A crash or disconnected request can leave verified bytes without preparation, or prepared sources without a recovered pair-admission trigger. Persisting upload bytes alone does not cause a fully autonomous server pickup chain.

A separate conditional recovery gap exists when the intake journal is missing but the batch journal and a server plan remain: the importer calls `prepareSaved()`; if the object is absent, that branch does not reuse the retained batch bytes. This is **not** the current Cards 16–18 path, because their phase confirms an existing intake journal.

### 3. Pair integrity is not guaranteed by completing two shutters

Exact identification input artifacts were checked against their stored references and visually inspected by two investigators:

- Card 13: Front is a Keshad Johnson basketball card face; Back is a Charcadet card face. These are different cards and games.
- Card 14: Front is a Pokémon reverse; Back is a Magikarp face, with another card at the edge.
- Card 15: Front is a Pokémon reverse; Back is mostly the mat with clipped Pokémon reverses at the edges.

The model's unknown identities for these records are not proof of an identification-provider outage. Their source inputs cannot support a trustworthy normal Front/Back identity. A generic Pokémon reverse also cannot establish which physical card it belongs to.

The UI chooses the next capture side from whether a retained partial Front exists. A recovered Front silently makes the next shutter Back; there is no explicit resumed-pair confirmation or discard/reset control in the camera flow. An offline probe reproduces how an old Front can combine with a newly photographed card. This is a **confirmed possible mechanism**, not proof of the owner's exact shutter sequence. No evidence supports blaming the owner or automatically re-pairing these images.

Use a persistent Front thumbnail and clear “Back of this card” cue, visible recovery of an unfinished pair, side-specific retake, and a safe discard-current-pair action. Detect obvious wrong side, no card, multiple cards, or game mismatch before expensive grading; uncertain cases must ask for correction without destroying the originals. A source-bound pair revision should be immutable once admitted.

Source: [automatic next-side selection](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/components/BatchImport.jsx:100).

### 4. Resume has two different meanings, neither of which repairs every blocker

“Resume saved uploads” runs the local importer again, using persisted create/upload/enqueue IDs. Cards process serially, with two sides concurrent inside each card. It skips `done` pairs. Generic temporary and TypeError failures are saved and are not continually retried automatically; only `MANUAL_PROCESSING_BUSY` has a short bounded automatic retry path. A repeated manual pass can encounter the same error and look unchanged.

“Resume saved processing” operates on an existing server batch job. It cannot finish local upload failures that have not been admitted to that queue. It preserves the existing stage, evidence, and analysis action, clears the attention code, and requeues the same job. That is appropriate for resumable transient work. It does not fix missing identity fields or geometry. PREPARE reads the cached COMPLETE identification and unchanged geometry, so it immediately returns the same attention gate. The button can appear to do nothing while the request actually succeeded and the job failed the same gate again.

For the actual observed Resume POSTs at 05:14:13 and 05:16:20, the provider logs record HTTP 503, so request failure is an additional direct explanation of the owner's no-progress observation. Do not claim that those particular clicks successfully requeued the jobs; the unchanged-gate behavior above is a separately proven code mechanism.

The batch UI also replaces unmapped attention codes such as `ECONNRESET` with stage text such as “ATLAS grading.” It hides the difference between “fix these edges,” “reconnect to an existing result,” and “upload has not finished.”

Source: [resume eligibility](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/repository.mjs:36), [resume mutation](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/repository.mjs:196), [unchanged gates](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-connected-manual/src/batch-preparation.mjs:83), [hidden error text](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/components/BatchGrading.jsx:200).

### 5. A successful analysis receipt does not automatically revive a stopped batch job

Card 7's analysis dispatched at 04:55:52.895901 UTC. Its batch job entered NEEDS_ATTENTION/ANALYZE with `ECONNRESET` at 04:56:38.701446. The existing analysis produced an immutable READY RESPONSE receipt at 04:58:42.085331, 169.18943 seconds after dispatch. The analysis run's raw DISPATCHED column remains unchanged by design; effective status projects READY from the receipt. The background result collector worked.

The batch worker's broad catch converted this exception to ATTENTION. Its claim query only selects queued or expired running work; it does not select NEEDS_ATTENTION. The later receipt does not schedule a job transition. An offline source probe reproduces that lack of re-entry. The origin of the socket reset is not logged and is not needed to establish the missing recovery transition.

This is not a current capacity-reservation leak: the claim query clears a reservation when a terminal RESPONSE exists. It is a progression defect. Recovery must reconcile the existing action/receipt under current source and manual-revision fences, then continue the report stage. Do not create another paid analysis merely because a browser or worker lost a response.

Source: [worker error classification](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/index.mjs:63), [claim and receipt reconciliation](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/repository.mjs:142), [analysis projection](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-defect-analysis/src/repository.mjs:179).

### 6. Persisted batch jobs still depend on browser/session state

The worker keeps an in-memory map of authenticated owners. Enqueue, list, and Resume populate that map. A two-second timer drains only if it is nonempty. Restart clears it; a new process cannot discover all eligible persisted jobs by itself. An offline probe confirmed zero claims after restart without an owner wake. Ordinary staff sessions expire after 30 minutes and are reauthenticated on claims/renewals/completion.

This preserves staff authority but does not provide durable machine execution independent of an open browser session. The solution is an explicitly scoped machine-job authority granted at intake/admission, with ongoing revocation and source/revision checks. It must not synthesize a human session or bypass human approval. A durable queue can survive process/browser restarts while still enforcing the approved authority model.

Source: [owners and polling](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/index.mjs:37), [wake entry points](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-batch-grading/src/index.mjs:122), [session lifetime](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/auth.mjs:215).

### 7. Authentication has a global serialization point

Every `StaffDatabase.transaction()` performs a catalog privilege audit and acquires the same `atlas-staff-access-v1` advisory transaction lock, with Prisma acquisition wait of five seconds and transaction timeout of ten seconds. Parallel session, thumbnail, upload, and other authenticated requests consequently compete for one global authentication gate. This is a verified scalability constraint, not proof that lock contention caused the observed 503s.

The frontend releases that authentication transaction before proxying to the private service. Inspected private intake/identification/batch repositories also keep object reads, decoders, provider calls, and artifact writes outside their transaction callbacks. The private manual boundary uses its separate short transaction and SQL SHARE locks; it does not reuse the global advisory gate for every repository operation. No external model/image operation held inside the shared frontend gate was found in this path.

Measure pool wait, privilege-audit duration, advisory-lock wait, session lookup, identity-lock wait, transaction duration and timeout codes under capture plus thumbnail/polling load. Replace global serialization with narrowly scoped shared control/identity checks and per-owner/per-operation locks where correctness permits, preserving revocation, rate-budget, and write serialization. Do not remove the gate or cache authorization indefinitely merely to increase throughput. Reduce redundant polling/thumbnail requests and back off repeated service failures so the UI does not amplify an outage.

Source: [staff transaction](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/server/access/database.mjs:7), [private transaction boundary](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-manual-service/src/staff-auth.mjs:16), [intake effect separation](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/packages/atlas-manual-intake/src/service.mjs:38).

## Recommended implementation

Retain the existing PostgreSQL, original storage, native preparation, background model integration, and human review flow. Complete their durable handoffs instead of adding another upload product or replacing the grading engine.

The product experience should be: capture Front and Back; immediately see that pair saved locally; each side shows uploading then verified remotely; the server automatically prepares, identifies, measures, and grades every eligible card; ready reports arrive independently for human review. A card needing correction shows the exact correction and does not stop the other cards. The user can safely move a mistake out of the active queue and undo that choice.

1. **Durable capture and truthful progress.** Store immutable original bytes once, with a stable pair ID and side revision. Keep metadata small; read only the bytes needed by bounded upload tasks. Avoid cloning/reloading all pending originals on every status update. Display local saved, remote verified, prepared, grading, ready for review, and actionable attention separately. Show per-side transfer progress when measurable; never invent a percentage. Retain originals until exact remote verification and local retention policy permit cleanup.
2. **Reliable upload recovery.** Keep same-intent completion-before-reupload semantics. Record safe request stage, status, timestamp, attempt, correlation, and deployed build. Preserve PUT status/expiry diagnostics without recording signed URLs. Classify retryable network/service interruptions, use bounded backoff with jitter, and show authentication recovery explicitly. Resolve a stale or absent intake journal from the exact server plan and retained matching bytes. Reconciliation must precede any new PUT and must never substitute different bytes under the same intent.
3. **Automatic preparation and admission.** Commit a durable preparation intent with original verification, and a pair/job intent with the transition to two current prepared sources. Use a transactional outbox or equivalent idempotent database transition. Workers discover due work at startup and periodically. The browser may notify/wake as an optimization; correctness cannot depend on it. Upload-only local bytes still require a live device to transmit—closing iOS cannot be promised to upload unsent originals—but processing of verified remote pairs must continue without that device.
4. **Recovery that follows actual outcomes.** Separate retryable operational failures, unresolved paid dispatch, and human correction requirements. An accepted-result collector must reconcile the exact original analysis action and advance its job, even after an intermediate network exception. Unknown dispatch remains quarantined and accounted for; it is not blindly resent. Preserve terminal receipts and recover them before any state change. Unchanged identity/geometry gates show “Review details/photo pair/edges” instead of an ineffective Resume. Requeue only after a relevant revision change or genuinely resumable operational condition.
5. **Independent concurrency controls.** Keep a small measured native decode/measurement pool; maintain a separate count of remote model requests in flight; independently bound identification, request construction, and receipt polling. Release large image/request buffers after accepted dispatch. Use global database leases and fairness across owners. The target is at least 20 overlapping model operations when measured resource and provider limits support them, with an elastic queue rather than an arbitrary product card-count ceiling.
6. **Safe discard/archive.** Implement an explicit reversible disposition for partial local pairs, local-only complete pairs, uploaded cards, and machine jobs. Remove them from the default active queue while preserving originals, upload IDs, receipts, ownership, history, and Undo. A discard transition must fence new dispatch and handle a concurrent capture/upload/claim with compare-and-swap semantics. Already accepted model work must still be collected and accounted for. Hard deletion remains a separate explicit operation with impact preview and required confirmation; no existing owner data should be deleted by this implementation or audit.

The current local journal garbage-collects photo records omitted from active items/drafts. Therefore reversible discard cannot simply remove an item: archived records must remain in the retained-reference set or a dedicated archive store. Current `clearSelection()` deletes unstarted local items and is unsuitable. Server records have no discard/archive state; do not repurpose `SUPERSEDED`, which means source replacement. Long-term local storage management needs visible export/cleanup choices, not silent deletion of unverified originals.

Source: [local byte-reference retention](/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean/frontend/atlas-app/lib/batch-import.mjs:140).

## What 20-card concurrency actually requires

Current limits are two batch workers, two shared native operations, and two concurrent geometry jobs. The worker constructor accepts at most eight; setting it to 20 currently fails validation. A 50-card request limit means 50 accepted references, not 50 workers. The accepted-analysis collector currently processes up to five responses per pass serially, with individual GET timeout up to 30 seconds and a five-second pause. That collector also needs bounded concurrent polling and fair due-time scheduling at higher volume.

Twenty simultaneous native image pipelines on the present one-CPU/3-GiB host is not supported by evidence. A 4032×3024 RGB raster alone is about 36.6 MB before copies, decoder buffers, derivatives, and model encoding. Exact replayed working files were about 22 MB each. The model request permits up to 46 MiB serialized data; twenty maximum-size request buffers would be 920 MiB before copies or native work. The scalable pattern is a small bounded local preparation/request-building pool feeding many asynchronous remote model operations, then scale native workers/host resources when measured queue time requires it.

### Latency definition and budget

Define the stage-1 target from **the time all 20 correct original pairs have been durably verified remotely** to **all 20 source-bound machine reports being ready for human review**. Report capture-to-upload latency separately. Also record each individual card's own verified-to-ready latency so pipelining is visible. Keep final human review outside the automated latency metric.

For card `i`, post-verification time consists of preparation/identity/geometry queue and execution time, dispatch queue time, provider latency, collection delay, and report measurement. With enough provider capacity, batch completion follows the slowest of those 20 paths; it does not become the median one-card time. Real capture is pipelined: earlier cards may already be running or finished when the last pair verifies. Its remaining time after the last verification is therefore a residual-work metric.

Use a separate synchronized-release benchmark to expose serialization: all 20 eligible cards become available for analysis together. With only `C` provider slots and equal dispatch-to-result latency `L`, its analysis path is approximately `ceil(20/C) × L`, before remaining work. That formula is not a lower bound on the real capture residual metric.

| Synchronized-release illustration using Card 7's observed dispatch-to-READY-receipt interval | Two remote slots | Twenty remote slots |
| --- | --- | --- |
| One analysis | 169.2 seconds | 169.2 seconds |
| Twenty equal analyses, ideal analysis-path completion | 1,691.9 seconds / 28.2 minutes | 169.2 seconds / 2.82 minutes |
| Ideal sustained analysis-path throughput | 0.71 card/minute | 7.09 cards/minute |

This is arithmetic, not a benchmark or promise. The 169-second observation includes collection/receipt persistence; the evidence does not isolate pure provider generation time. Other saved completed analysis paths took about 266, 274, and 505 seconds. Twenty parallel calls can have longer tails than one call; assuming independent latencies, the chance all 20 are below the individual p95 is only `0.95^20 ≈ 36%`. Compare the batch distribution and slowest-card latency to a single-card baseline, and show progress as each card finishes. Sustaining ten newly captured cards per minute would imply mean concurrency of about 28.2–84.1 at the observed 169–505-second intervals, requiring at least 29–85 integer slots before headroom, plus sufficient provider throughput and local preparation capacity. A 20-card burst is a different target from continuous capture at that rate.

Upload cannot be made free by concurrency. The latest pending originals are around 5.1–6.2 MB each: an illustrative 20-card batch at 12 MB per pair is about 240 MB. Its ideal transfer floor is approximately 192 seconds at a sustained 10 Mbps upload rate, or 38.4 seconds at 50 Mbps, before protocol overhead, retransmits, verification, and camera time. One equivalent pair has floors of 9.6 and 1.92 seconds. Concurrent PUTs share the same uplink. Start uploads while the user continues capture, but do not promise that 20 cards finish in the same wall-clock time measured from the first shutter.

### Provider limits and cost

The current defect analysis uses `gpt-6-astra`, xhigh reasoning, asynchronous background requests, `store:false`, and up to 32,768 output tokens. Identification is another provider workload. The account's actual request/token limits and available capacity have not been measured. A successful two-card workload or absence of a 429 proves neither permission nor capacity for 20. Capture rate-limit and `Retry-After` headers, apply shared admission budgets, and measure under the actual organization/project. [Official rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits).

Card 7's receipt records 16,147 input and 7,559 output tokens; the 6,725 reasoning tokens are part of the output count, not an additional charge category. Twenty equivalent analyses would use about 322,940 input and 151,180 output tokens. At the currently published Standard short-context rates of $10/M input and $50/M output, with no cache adjustment, that illustration is about $0.54 per analysis or $10.79 for twenty. This is not a measured bill: identity calls, actual service tier/cache usage, storage, native computation, and unresolved accepted-request liabilities must be included in real cost accounting. [Official pricing](https://developers.openai.com/api/docs/pricing).

Background mode with `store:false` temporarily retains results for roughly ten minutes according to current provider documentation. The application must collect and durably store terminal results promptly; an application's 30-minute polling window cannot extend the documented provider retention window. Polling fairness, restart recovery, and alerting on overdue accepted calls are correctness work as well as latency work. [Official background-mode documentation](https://developers.openai.com/api/docs/guides/background).

## Bounded delivery and validation plan

Implement in coherent increments, preserving originals and human approval at every step:

1. Add read-only diagnostics and per-stage presentation; distinguish the two Resume actions; add safe pair preview/retake/reversible discard. This makes the current failure inspectable and prevents avoidable pair mistakes while retaining existing data.
2. Make original verification → preparation → pair admission durable and self-discovering. Reconcile same upload/create IDs, classify transient retries, and add startup recovery with scoped machine authority.
3. Connect accepted analysis receipts back to batch progression; test interruption at every handoff, unchanged correction gates, source changes, owner revocation, session expiry, and duplicate wake/delivery. Preserve accepted-request accounting and exact action IDs.
4. Separate native, dispatch, outstanding-provider, and collector limits. Measure and raise capacity through 1, 5, 10, and 20 eligible pairs; size native compute from observed preparation/measurement queue time rather than raising every constant.

Required correctness tests must cover failures after every durable write and before its acknowledgment; expired signed PUT; HTTP error PUT with an object already present; absent object with retained same-hash bytes; missing local intake journal; lost create acknowledgment; session/browser restart; worker restart; temporary provider refusal; uncertain accepted dispatch; READY receipt after an intermediate exception; source/manual changes; and archive racing a claim. All must keep stable identities, avoid duplicate paid analysis, and retain full originals.

For stage-1 performance acceptance, use a fixed representative set of 20 correctly paired full-resolution originals and a repeated single-card baseline under the same model/policy. Proposed pass criteria, to be confirmed against the measured baseline:

- Every eligible pair progresses automatically after remote verification without a browser/session wake or Resume click.
- At least 20 accepted remote analyses demonstrably overlap when provider capacity is available; local native work remains within a measured safe limit. No card-count ceiling is presented as product capacity.
- No silent failure, lost original, duplicate card/upload, duplicate paid dispatch, or fabricated approval; affected cards show actionable states and do not stall unrelated cards.
- Measure p50/p95 per-card verified-to-review latency, full-batch time to last ready report, dispatch spread, preparation queue wait, collection lag, provider tails, 429/503 rates, CPU/RSS, and cost. A useful initial engineering target is batch completion no more than single-card p95 plus measured dispatch spread and an explicitly agreed tail allowance; do not label it achieved until measured. A stricter “approximately one-card latency” ratio must specify its percentile and tolerated provider tail.
- Predeclare baseline repetitions, batch repetitions, percentile computation, and the latency allowance. One successful 20-card run establishes a functional smoke result, not a reliable p95 or sustained-capacity claim. Measure both synchronized release and normal capture/upload pipelining, without mixing their clocks.
- Repeat on the actual iPhone browser/profile in camera and photo-library modes: capture 20 pairs, background/return during capture, resume a partial pair, lose connectivity, expire a signed URL, reload, restart server workers, and safely discard/undo a mistake. No live destructive cleanup is part of this acceptance.

## Remaining evidence needed for the exact latest request failure

The current device export cannot reconstruct information it never recorded. The priority for explaining the confirmed API 503s is sanitized exception/correlation telemetry at the shared frontend/authentication boundary. Reuse the existing page-access logger's allowlisted error-code approach for API handling: record route/phase, elapsed time, error class, permitted Prisma/SQLSTATE code, opaque reference, and release. A future failed ordinary authenticated read can then identify the exception without triggering an upload or model retry. An exact request-ID/expanded provider-log read of the failed new-release session request still returned no exception detail.

Independently, a read-only local byte-read/hash check on the eight unfinished pairs can establish whether retained originals are currently readable. Read one side at a time and report only pair/side, expected/observed count/hash, and a safe read-error name. It must not clear or rewrite journals, upload, prepare, enqueue, or grade. This distinguishes intact descriptors from readable bytes without asking the user to recapture; it cannot itself explain a server 503.

For browser requests, retain the exact failed subrequest's time, endpoint class, HTTP status, exception name, request correlation, and frontend/backend release. Do not record cookies, signed URLs, credentials, image contents, or raw stack traces in an export. Existing request logs narrow the boundary; swallowed unlogged exceptions cannot be recovered retroactively. If reproduction is required, instrument first and make any state-changing retry a separately controlled recovery step, not an invisible diagnostic side effect.

Current configuration was qualified by the separate design-release constructor and preservation checks. This investigation did not impersonate a staff session or call an authenticated mutating route to “test” it. Configuration qualification is not proof that the owner's exact request succeeded.

## Evidence receipts

| Evidence | SHA-256 |
| --- | --- |
| Before-cutover census | `1f2f9ac550b0f3678d338b02b442b186cf0d786a80431e9dfb13edd50078dadd` |
| After-cutover census | `1130eb94574c771141ce7f6ea201c423a9d847fa68cf77a0f5f51deb196cd299` |
| Exact selected object reads | `8ec19bd53853ec88ac3c8df188faa4f6ce84ea13deff671d6bfa9e22d023d1fd` |
| Exact identification image reads | `00962f18b73a1cad123394cb8db8d0f46847f12f7df1ef9354f54958d2c4e2aa` |
| Current owner diagnostic | `03f793167d5dfbb9234de0c7abc068bf3860a72d76ab706e8be145350bfa0028` |
| Scoped uncommitted-create check, 05:40:23 UTC | `a85be6201852b06eed77371fbd6371dfe073afc3c1c242ba6a59f7c4040aba15` |
| Authentication schema/session-shape check, 05:46:54 UTC | `9ef8c8410a08c0a67acd38eff255cc26ab99600595fff9176da233acbf762a70` |
| Effective staff-role privilege/session check, 05:48:50 UTC | `5544990a96b5a8a114898073e9c2feb112c310304c31ceca59e4983bbf128f7d` |
| Read-only generated-Prisma session include, 05:54:50 UTC | `498095e977edd9b034591329b28a1204c0438568df84f1f93d8836fe160ab785` |
| Four-file deduplicated provider request-log manifest | `9c7702bf532aa5aa70c2dd6686e4f95dff5ef2b47a4992120901f8db8f8158f9` |

The four offline probes passed with zero network/database/provider effects. Both selected original decode replays passed on Darwin ARM. No 20-card live benchmark was run, and no physical-iPhone byte-read or end-to-end recovery result is claimed.
