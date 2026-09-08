# Speedster prepared evidence: authority and storage proposal

Status: **DESIGN ONLY — not implemented or operationally approved.**

This is the separate third safeguard slice, based on source at `1a764beebd4606c26f4fd5fe1fea23a3c27bafc7`. The lead selected typed per-side preparation heads, attempts, and immutable adopted manifests as the preferred future storage design. The lead will coordinate the schema boundary with the Vault owner. No Prisma schema, runtime route, worker, storage object, provider setting, or deployed system changes in this slice. This proposal does not amend the owner-approved V2 master blueprint.

The prior centering and detector-admission commits remain separate. Signed image provenance and matching reported runtime fields do not prove an actual GPU execution, image correctness, or prepared-byte provenance. The existing initialized-session history is not automatically current-release evidence for ATLAS.

## Problem and required result

Two preparations of the same original currently receive the same five output keys even when their physical corners differ. A slow first request can finish after the second request, or after capture is committed, and overwrite those objects through still-valid upload URLs. A final database CAS cannot revoke an already-issued storage grant. Giving each attempt a new key prevents inter-attempt collisions but does not prevent a repeated PUT from changing that attempt's already accepted objects.

New captures must instead adopt an exact, server-verified set of bytes from the current per-side preparation attempt. A delayed or repeated worker write must be confined to staging. Final capture must load the adopted manifests from durable server authority, bind them to the operator-confirmed physical geometry, and freeze their references atomically. Originals, prior attempts, historical captures, and issued reports remain preserved.

## Observed authority trace

Paths and line numbers refer to the inspected source, not proposed implementation.

| Boundary | Current evidence | Consequence |
| --- | --- | --- |
| Session creation | `frontend/nextjs-app/pages/api/admin/ai-grader-v2/sessions/index.ts:70` creates owned DRAFT with `capture: {}`. | No preparation attempt is created. |
| Physical storage model | `packages/database/prisma/schema.prisma:3576` stores session JSON and `updatedAt`; `:3644` stores uniquely keyed instrumentation. | General durable storage exists; no current per-side preparation head, attempt, or manifest relation exists. |
| Browser output planning | `frontend/nextjs-app/lib/ai-grader-v2/image-service.ts:725`; `frontend/nextjs-app/pages/api/admin/ai-grader-v2/upload-plan.ts:117`. PREPARED plans read URLs from source generation. | Planning records no durable attempt, physical-quad hash, or adoption. |
| Output names | `frontend/nextjs-app/lib/server/aiGraderV2IphoneCapture.ts:70` derives five names from user/session/side and optional original generation. | A changed physical quad against the same original reuses the names. |
| Worker dispatch | `frontend/nextjs-app/pages/api/admin/ai-grader-v2/image/[action].ts:701` reads owned DRAFT; `:823` derives outputs and signs writes. Its session projection at `:265` omits capture and revision. | There is no transactionally recorded begin/supersede identity before write grants are issued. |
| Storage grants | `frontend/nextjs-app/lib/server/storage.ts:723` issues ten-minute private PUT grants; prepare supplies no expected output checksums. | The grant remains usable independently of session workflow changes. Private ACL controls readership, not overwrite identity. |
| Worker writes | `backend/ai-grader-speedster-service/app.py:680` prepares images; `:734` uploads the five roles concurrently before returning transform/frame/Color data. | Partial or late writes can occur even if the web request is abandoned. Cancellation is not an overwrite fence. |
| Prepare response | `frontend/nextjs-app/pages/api/admin/ai-grader-v2/image/[action].ts:400` checks printed Color consistency; `:1395` issues its receipt. | No durable attempt adoption, post-response DRAFT check, five-artifact manifest, or immutable destination is established. |
| Browser installation | `frontend/nextjs-app/components/ai-grader-v2/CaptureWorkspace.tsx:1768` plans outputs before prepare and installs those keys with the returned transform/frame. | Browser request-controller identity protects that tab's display, not storage or another tab. |
| Draft recovery | `frontend/nextjs-app/lib/ai-grader-v2/capture-registration-draft.ts:778` serializes into browser `Storage`. | A saved draft/receipt cannot serve as durable server adoption authority. |
| Final capture | `frontend/nextjs-app/pages/api/admin/ai-grader-v2/sessions/[sessionId].ts:346` updates DRAFT with `updatedAt` CAS and Color evidence in a transaction. `:428` canonicalizes only known capture fields plus map authority. | It protects that database mutation, but neither compares an active preparation attempt nor retains an added manifest automatically. |
| Existing server authority examples | `frontend/nextjs-app/pages/api/admin/ai-grader-v2/sessions/[sessionId]/map-authority.ts:98` uses owned DRAFT JSON/CAS. `frontend/nextjs-app/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts:354` locks the owned session. `frontend/nextjs-app/lib/server/aiGraderV2Instrumentation.ts:809` inserts immutable events with exact duplicate/conflict checking. | These are reusable transaction primitives, not an already implemented preparation protocol. |
| Original upload counter | `packages/database/prisma/schema.prisma:3670` has a per-user capture device with pair upload versions/manifests. | It is neither per-side nor a stable preparation identity across sessions. Do not repurpose it. |
| Immutable snapshot precedent | `frontend/nextjs-app/lib/server/speedsterMapRegistrationLessons.ts:172` reads exact bytes, verifies their hash, uploads to an isolated checksum-bound key, and verifies again. | Useful finalization pattern; it does not currently cover prepared artifacts. |

Current detector recovery hashes source/prepared objects when building checkpoints. That can detect later drift on recovery; it does not stop a late upload from changing bytes referenced by an already completed report. Color receipts bind original source and physical geometry; they do not establish a complete prepared-byte manifest.

## Logical authority contract

These record names are proposed design names, not new Prisma models in this commit. The typed representation is the lead's chosen default.

| Record | Minimal data and constraints |
| --- | --- |
| Side preparation head | Owned `sessionId` and `side`; monotonic side revision; active attempt ID; active adopted-manifest ID or null. Unique `(sessionId, side)`. The head must reference an attempt with the same session/side, enforced by composite relationship or equivalent transaction validation. |
| Preparation attempt | Server UUID; session/creator/side; side revision; stable request idempotency key and canonical request hash; expected prior side revision/attempt; immutable input binding; creation time; write-once terminal outcome. Unique `(sessionId, side, sideRevision)` and `(sessionId, side, idempotencyKey)`. The immutable input includes original key/hash, frozen source key/hash, decoder/orientation contract, dimensions, physical quad/hash, mat, preparation contract/release identity, and staging roles. |
| Adopted manifest | Immutable ID; attempt/session/side/revision; canonical manifest version/body/hash; verified original/source snapshot identity; exactly five artifact roles with final key, SHA-256, byte count, decoded dimensions/type; verified transform and inspection frame; preparation identity; validation version and completion time. Unique attempt adoption: at most one manifest per attempt. A repeated identical finalize returns it; a differing one conflicts. |
| Audit transitions | Server-only begin, supersede, verified/adopted, failed, and capture-frozen records, committed with the relevant state transition. Existing conflict-detected instrumentation may be the append-only audit substrate. Browser instrumentation endpoints must never accept those authority event types or their reserved keys. |

An attempt header and adopted manifest are immutable. Supersession changes the head and appends a transition; it does not rewrite earlier inputs/manifests. The terminal outcome must be written at most once. Timestamp order, provider request IDs, matching image bytes, a browser UUID, or a valid signature do not identify which attempt is active.

Every mutation carries the exact session, creator, side, attempt, and expected side revision. A stable idempotency key is scoped to that owned session/side and compared with the complete request hash. Reusing it with changed input is a conflict. Repeating an old key returns its historical/superseded state; it never reactivates the attempt or dispatches new work.

The schema coordinator must decide exact field types, foreign keys, and migration sequencing. No new relation may couple preparation lifecycle to mutable financial/Vault inventory state. Session and side scoping must be checked inside each transaction even when IDs are globally unique.

## Storage isolation and manifest formation

Use separate server-derived namespaces, for example:

```text
ai-grader-v2/<owner>/<session>/prepare-staging/<side>/<attempt>/<role>.webp
ai-grader-v2/<owner>/<session>/prepared-evidence/<side>/<attempt>/<role>-<sha256>.webp
ai-grader-v2/<owner>/<session>/source-evidence/<sha256>.<verified-format>
```

These are proposed namespaces. They must use existing segment validation plus exact role/hash validation; clients cannot choose paths. Existing prepared-key parsers do not accept this new format and must be deliberately extended, rather than loosened to arbitrary prefixes.

Only staging keys receive worker PUT grants. The browser receives attempt/state and signed reads of accepted artifacts. Neither browser upload planning nor worker grants can address the accepted or frozen-source namespaces. Provider credentials stay server-side. All application write entry points must enforce this separation; a cache header or key name alone is not immutability.

Read the original into a bounded buffer, compute its SHA-256, decode with the specified orientation/dimension contract, and verify any checksum encoded in its current generation. Preserve the original. Freeze that exact buffer to a server-owned content-bound source key before the worker reads it. The worker receives a read of that frozen source, avoiding a hash-then-read race against a still-writable legacy original. Reuse an existing frozen object only after verifying the same bytes; do not relabel mutable legacy data as immutable.

After worker success, read each staging object into bounded server-owned bytes. Verify all five roles are present, decode successfully as the required format, and match dimensions/frame semantics from the approved preparation contract. Compute SHA-256 from the bytes; ETag, metadata, HTTP 200, and worker-supplied checksums are not substitutes. Validate transform shape, finite/projective behavior, coordinate convention and physical-corner mapping against the frozen source and approved rectification implementation. Bind mat, relevant Color result/receipt identity, inspection frame, and exact source physical quad. The later human-confirmed printed centering quad may differ from the proposal; it does not change which physical warp generated the artifacts. Both Color receipts must identify the same owned session/side, original alias and mat, with `receipt.sourceImageSha256 == manifest.originalSha256 == manifest.frozenSourceSha256`. The printed receipt's physical-quad hash must equal the attempt's stored physical-quad hash. A valid receipt checked only against the current live original is insufficient: that object could change from A to B during preparation and back to A before capture. Geometry recovery for an adopted attempt must read its frozen source, and new captured/public original-image reads must resolve that frozen source instead of following a mutable original alias.

Upload **the same buffers that were hashed** to final keys derived from their hashes and the immutable attempt. Do not hash a staging key and later issue an unversioned server-side copy of that key: it could change between operations. Verify final hashes before admission. `readStorageBufferBounded` and `uploadPrivateChecksumBuffer` provide useful existing byte/size/checksum primitives; the latter does not validate a preparation namespace or implement conditional create-only writes by itself. Add a preparation-specific wrapper that derives keys and refuses any expected-key/bytes mismatch.

If a final object already exists, matching bytes permit idempotent reuse; different bytes are an integrity conflict and are never overwritten or adopted. Same-attempt concurrent finalizers must converge on one write-once manifest; different valid outputs may create unadopted immutable objects but cannot replace the accepted manifest. The head/attempt transaction resolves which result is authoritative.

This establishes application-enforced content identity: replayed worker grants cannot write accepted bytes. It does not claim provider Object Lock or immunity to a privileged bucket administrator. Any later hash mismatch fails verification and requires investigation; it cannot silently replace evidence or trigger a historical regrade. Verify provider checksum/read behavior through an approved adapter test before deployment; no bucket policy, versioning, lifecycle, or deletion change is included here.

Preparation identity must state what this operation actually executes, including source/image and decoder/rectification/reveal/encoding versions. The detector's CUDA/GPU declaration is not proof of a CPU image-preparation operation. Worker-contract changes require a new exact build and reviewed admission evidence; do not silently accept an image because a tag or desired endpoint configuration matches. The currently pinned detector release remains unchanged by this design.

## Transactions and failure behavior

All preparation transitions and final capture acquire the same owned session lock before locking heads in fixed FRONT/BACK order. Read current workflow/ownership inside that transaction. Do not hold a database lock while calling storage or the worker.

1. **Begin/supersede.** Verify/freeze requested input bytes, then lock owned DRAFT and the side head. Compare the expected prior side revision/attempt. Insert the server-generated attempt and begin/supersession audit; advance only that head and clear its current-adoption pointer. Commit before issuing staging grants or dispatching. A delayed begin request with an obsolete expected revision conflicts instead of superseding newer work. An unused source snapshot after a failed CAS remains unadopted evidence.
2. **Execute.** Grant exact staging roles to the attempt and a read of its frozen source. Bind dispatch and response to the stored attempt/request hash. The browser cannot submit substitute output metadata or URLs. Timeout/transport uncertainty leaves an unresolved attempt; resumption first loads durable state. No automatic duplicate provider work or fresh grants are inferred from a timeout.
3. **Verify/finalize.** Load the stored attempt and validate its input binding before storage reads. Freeze/verify all five output buffers and construct the full manifest. Missing, partial, malformed or conflicting evidence produces no adoption. A malformed transform or old preparation contract is a failure even when the output objects exist.
4. **Adopt.** Lock owned session/head again. Require DRAFT, exact active attempt/revision, matching input binding, and no conflicting terminal/adoption record. Atomically insert the immutable manifest, terminal success and audit, then set the head's adopted pointer. A superseded or completed-session result cannot adopt. Repeated identical adoption returns the stored manifest without rewriting bytes. Failure after storage writes but before DB commit leaves unadopted objects, not a partial capture.
5. **Preflight and freeze capture.** Before taking locks, load both adopted manifests and perform bounded immutable-storage verification plus Color/map evidence validation. Require both Color receipt source hashes to equal the manifest original/frozen-source hash and the printed receipt physical-quad hash to equal the stored attempt quad; do not rehash the live original as authority. Produce a canonical validation binding containing the exact owned session/input identity, both side revisions/attempt IDs/manifest hashes, receipt identities, and the session map-authority/revision and registration-evidence hashes used for validation. Then lock owned DRAFT and both heads, reload the server manifests and compare that entire binding against current durable state. Lock or atomically fence any mutable map-selection record on which authorization depends; a separate unlocked read is insufficient. Pure receipt expiry/signature checks may run again inside the transaction, but no storage/provider call occurs while locks are held. Only an exact match atomically persists canonical capture with the server-loaded manifest references/bodies, Color evidence and final head/freeze audit. Preserve map-authority history. Supersession, a map-authority change or any other binding change between preflight and commit produces a conflict rather than mixed generations.

A failed newer attempt never silently restores an older head. An explicit operator recovery may create a new revision referencing verified prior immutable evidence under the same source/geometry contract, with an audit trail. It cannot modify prior attempts or borrow a sibling/session identity. Read-only recovery can always show preserved historical state without authorizing a new capture or provider call.

If response delivery fails after adoption or capture commits, a reload returns the exact stored result. If a worker writes after timeout, supersession or completion, only that attempt's staging can change. Do not delete those artifacts in the request path. Retention/cleanup is a separately approved operation and must preserve adopted, referenced and unresolved evidence.

```mermaid
sequenceDiagram
    participant UI as Human capture UI
    participant API as Ten Kings server
    participant DB as Session and preparation records
    participant W as Image worker
    participant S as Private storage
    UI->>API: Begin with expected side revision and confirmed physical input
    API->>S: Freeze exact source bytes
    API->>DB: Lock DRAFT; begin/supersede exact side attempt
    DB-->>API: Durable attempt
    API->>W: Frozen source read and attempt staging writes
    W->>S: Write five staging roles
    W-->>API: Preparation result
    API->>S: Read, validate and hash exact buffers; finalize accepted objects
    API->>DB: Lock; adopt only if attempt is still active
    DB-->>API: Immutable manifest or conflict
    API-->>UI: Stored attempt state and accepted reads
    UI->>API: Save confirmed Front and Back manifest references
    API->>DB: Load immutable manifests and validation state
    API->>S: Preflight exact source and artifact hashes
    API->>DB: Lock; recheck validation binding; freeze pair with CAPTURED
```

## Required integration changes

| Location | Required implementation and compatibility rule |
| --- | --- |
| Future schema/transaction module | Implement the typed heads/attempts/manifests and scoping/uniqueness above. Lead coordinates shared schema ownership. Transactions must be exercised against fixture PostgreSQL before runtime enablement. |
| `image/[action].ts` prepare | Replace direct accepted-key grants with durable begin/execute/finalize/adopt. Keep private authority bindings out of browser and upstream payloads as appropriate. Recheck workflow/current attempt at adoption. |
| `storage.ts` and preparation-specific adapter | Add exact namespace separation, bounded decoded-byte verification, deterministic final-key derivation, same-buffer checksum PUT and final verification. No generic presigner may issue grants into accepted/source-evidence namespaces. |
| `upload-plan.ts` PREPARED and `image-service.ts` | Remove precomputed authority from the browser plan. The server returns accepted outputs from the adopted manifest. Read refresh uses exact manifest roles; it cannot mint adoption or preparation writes. |
| `CaptureWorkspace.tsx`, capture contracts and draft recovery | Carry server attempt/revision/manifest references through both sides. Local draft is a cache; refresh durable state before resume/save. Version the browser draft format, preserve/export old drafts, and explicitly require new preparation for an old DRAFT that lacks this authority. No automatic paid rerun on reload. |
| Session capture PATCH/canonicalizer | Preflight storage/Color/map evidence against immutable source/manifests, then recheck the exact validation binding under the transaction locks. Preserve both server-loaded manifests; never persist a browser-submitted manifest as authority. Keep issued/historical capture reads compatible. |
| `aiGraderV2IphoneCapture.ts`, map-source and review parsers | Add explicit versioned accepted-manifest key support and original/source/attempt binding. Existing original-generation equality is insufficient for the new namespace. Preserve legacy parsing for historical evidence. |
| `original-image`, `prepared-image`, `review-images`, geometry recovery, map registration and detector checkpoints | Resolve the frozen source and authorized adopted roles for new captures; bind Color/map/reference/checkpoint hashes to the same immutable bytes. Do not upgrade old evidence solely because its key parses. |
| Map-authority/capture writers | Coordinate with the session lock and preserve the active preparation records/references. They cannot erase, reactivate or supersede preparation indirectly through whole-capture replacement. |
| Completion/public historical readers | Continue to return old issued records unchanged. Newly adopted captures carry exact manifest references through completion. Integrity failures are explicit; no silent historical substitution/regrading. |

Do not partially enable the UI, accepted-key parser or capture requirement ahead of durable begin/adoption and storage finalization. A staging-only or signed-receipt-only patch does not meet this design.

## JSON/event alternative, not the selected default

A migration is not physically unavoidable: `AiGraderV2Session.capture` JSONB, the existing owned-session row-lock pattern, and conflict-detected event inserts could implement a **new explicit** protocol with a reserved strictly parsed server-only preparation namespace and immutable attempt/manifest events. That would require the same per-side revisions, exact scoping, atomicity, retention and audit guarantees as the typed design.

Every DRAFT JSON writer would have to read and merge the latest locked row, and final canonicalization would have to preserve the server-authoritative preparation state deliberately. Browser instrumentation cannot write authority events. The existing whole-session `updatedAt` CAS plus event-key uniqueness is not that protocol. The lead selected typed records to make these ownership and persistence constraints explicit; generic JSON/event reuse remains an integration alternative requiring equivalent proof, not an assumed shortcut.

## Acceptance and adapter test matrix

These are **required future tests**, not tests reported as run in this design slice. Use synthetic originals and local provider/DB adapters; any provider/storage test beyond that needs operational authorization.

| Scenario | Required observable result |
| --- | --- |
| Same-side A then B; A completes last | B remains active/adopted. A cannot change B's keys, head or capture. Preserve A's evidence/state. |
| Replay A PUT after A or B is captured | Only A staging can change. Accepted artifact bytes and report reads remain exact. |
| Delayed begin based on an older side revision | Conflict before new grants/worker dispatch; newer head is preserved. |
| Concurrent Front/Back and concurrent map decision | Both side transitions preserve the sibling and map history; no whole-JSON lost update. |
| Supersession racing final capture | Exactly one ordered outcome: capture freezes the validated pair, or capture conflicts. No mixed generation. |
| Idempotent begin/finalize; response lost after commit | Exact stored attempt/manifest returned; no duplicate worker invocation, second adoption or byte rewrite. Changed payload with the same idempotency key conflicts. |
| Same bytes/manifest hash under another session/side/attempt | Ownership and attempt/revision mismatch reject; hash equality never bypasses scope. |
| Partial uploads; malformed WebP; wrong dimensions/frame/transform | No side adoption or capture. Existing accepted evidence remains intact. |
| Source overwritten between original lookup and worker read | Worker reads the frozen verified source. A mismatching original checksum fails before dispatch. |
| Live original changes A → B for prepare → A for capture | Both Color receipt source hashes must equal the manifest/frozen-source hash; mismatched A receipts cannot authorize B artifacts. New original-image reads use the frozen source. |
| Head/manifest or map authority changes after storage preflight | Transactional validation-binding comparison conflicts; no storage/provider call occurs while locks are held and no stale validation is committed. |
| Staging overwritten between hash and finalization | Final writes use the exact already-hashed buffers, never a later unversioned copy. |
| Conflicting existing final key or final re-read hash | Controlled integrity failure; never overwrite/adopt conflicting bytes or delete evidence. |
| Forged client manifest/paths/hash/receipt; replayed old valid receipt | Server store and current head control adoption. Reject before capture mutation. |
| Missing manifest after refresh or old saved DRAFT | Preserve/export old draft and originals; explain required preparation. No automatic paid run or hidden upgrade. |
| New attempt fails or times out while older manifest exists | Head cannot silently fall back. Unresolved work stays identifiable; manual recovery is a new audited revision. |
| Capture commits while worker remains alive | Late work cannot adopt or write accepted namespaces; completed read branch stays unchanged. |
| Fixture PostgreSQL concurrent begin/adopt/capture | Unique constraints, session/head locks and exact scope predicates enforce one active revision/one adoption. Include transaction rollback and response-loss cases, not only in-memory mocks. |
| Object-storage adapter | Prove private ACL, no accepted-key write grants, bounded reads, checksum header behavior and exact read-back. Record unsupported conditional/version behavior instead of assuming it. |

Rollout acceptance must also verify the new preparation release/protocol and detector-admission policy are compatible. Preserve the distinction between signed artifact provenance, reported runtime identity, synthetic adapter validation, and actual authorized execution. No production scan is a prerequisite for writing this design, and none was performed.

## Review outcome and handoff

The local repair pass delivers this design for lead/schema-owner coordination. The exact missing application primitive is the typed per-side active attempt and atomic adoption/supersession contract; storage needs accepted-byte finalization with no replayable grants into the accepted namespace. Existing substrate can help implement them but does not already supply them.

Implementation is intentionally deferred under the lead's explicit scope decision. Current mutable prepared-key behavior remains a known unfixed runtime limitation. Keep the centering and release-admission commits independently reviewable. A rollback of future preparation work must preserve adopted manifests and historical objects; pause new preparations/capture commits if the complete boundary cannot be maintained. Do not restore direct worker writes to accepted evidence or erase old keys to conceal conflicts.
