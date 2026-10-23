# Decoder outcome and publication review model

This additive module is **UNQUALIFIED** and unwired. It is a pure model for reviewing future intake integration, not a validator, authority verifier, persistence adapter or migration. It opens no socket, starts no process, reads no original, writes no database/file and changes no accepted capability. Every result has executionAllowed:false and authority:NOT_IMPLEMENTED. A caller-supplied claim, callback, unexpired snapshot or fence-shaped object cannot grant publication authority.

The existing 195 executable/UI/test/SQL/package source pins are unchanged, including proof-intake.mjs, physical-runtime.mjs, the legacy image-validator brand, storage, worker, client, registry and supervisor. Existing physical construction still uses the legacy direct child; this model does not fix or qualify that runtime join. No real target descriptor, independently authenticated peer, independent watchdog, authoritative admission fence or genuine whole-job cleanup has been supplied.

## Attempt review

modelProofDecoderAttemptAccounting accepts exactly original, legacy, maxOperationalAttempts and transcript. original contains the unchanged uploadId/objectKey and exact byteCount/sha256/declaredType plan. legacy contains status, attempts and manifestHash (required for VALIDATED/RETAINED). The model snapshots these inputs and never changes them.

maxOperationalAttempts must be explicit, between 1 and 16. That is a source-model ceiling, not a selected operational policy. The transcript is bounded to 64 entries. BEGIN binds a UUIDv4 lease and request to hash(original); OUTCOME repeats that binding and supplies a closed outcome, effect observation and input observation. Exact repeated BEGIN/OUTCOME entries count once. Changed use of a lease/request or original conflicts. An unresolved open attempt excludes another modeled begin. These are deterministic hypothetical accounting rules; durable compare-and-set, restart ownership and replay protection are NOT implemented.

The simulated counters are separate from legacy attempts. startedOperations increments once per modeled BEGIN. contentRejections increments only in the hypothetical INVALID_IMAGE + COMPLETE_CLAIM + CLEANUP_CLAIM case. That case still emits unmet requirements for exact original/worker-result provenance and independent whole-job cleanup; it is not a verified invalid-image decision. Availability never consumes the modeled content counter.

| Reported outcome and modeled effect | Review result |
| --- | --- |
| Any outcome with UNKNOWN effect/cleanup, including success or invalid | Absorbing unresolved-effect hold; no replacement or capacity-release inference |
| CONTAINMENT_FAILURE | Absorbing hold even if a cleanup claim was also supplied |
| SUCCESS or INVALID_IMAGE without complete original and cleanup claim | Contradictory-result hold; no content rejection |
| SUCCESS with complete input and cleanup claims | Validation review required, then separately verified fresh publication fence |
| INVALID_IMAGE with complete input and cleanup claims | One hypothetical content rejection; actual image-invalid evidence still required |
| Busy, cancellation, timeout, setup, resource, transport or protocol failure with no-effect/cleanup claim | Separately bounded operational retry review; evidence still unverified |
| Admission expired/revoked | Fresh admission review; no retry from a cached snapshot |
| Source mismatch | Original-binding hold; no changed bytes/key |
| Unrecognized outcome or peer REAPED/NOT_STARTED as an effect observation | Refused closed input; no automatic classification |

NO_EFFECT_CLAIM and CLEANUP_CLAIM name hypothetical review inputs. A peer NOT_STARTED/REAPED string does not qualify either. Raw error codes are insufficient: the same timeout can occur before submission or after uncertain launch. Unknown effect/cleanup dominates a favorable worker result. Holds are absorbing inside this model; it has no clearing, migration or promotion operation. Exact historical replay remains inspectable without clearing the hold.

For legacy PREPARED attempts 0–2, the model conservatively keeps the old ceiling as legacy attempts plus new hypothetical content rejections, without claiming the old attempts were content failures. Legacy attempts >=3, REJECTED and unresolved VALIDATING rows cannot start fresh work. A separately reviewed legacy policy would be needed; there is no decrement/reset/cause inference. Existing VALIDATED rows are handled by publication review, and RETAINED rows stay historical. The transcript does not rewrite legacy audit events, intake counters or physical/financial holds.

## Publication and historical compatibility

assessProofDecoderPublicationReview accepts original, legacy, operation, objectObservation and admissionObservation. Operations are HISTORICAL_READ, UPLOAD, RECOVER and BEFORE_RETAIN. Object facts are explicitly unverified absent/matching/unknown/mismatch claims. Admission observations are MISSING, CACHED_UNEXPIRED, FENCE_SHAPED_CLAIM, REVOKED, EXPIRED or UNAVAILABLE. None is verified or accepted as authority; publicationAllowed and historyMutationAllowed are always false.

Retained originals remain on the existing actor/policy/storage/manifest checks without a decoder liveness requirement. The model grants no read itself and does not weaken those checks. Old VALIDATED originals absent from storage need fresh isolated validation review before publication, covering both upload and recover; attempts already exhausted require legacy review. A matching already-published original goes only to same-key reconciliation. Unknown publication means exact-original lookup, never absence, overwrite, deletion or a new key. A conflicting original is a hold. Revocation after storage publication but before retention is still same-original reconciliation, not rollback or replacement.

No decoder hash, epoch or receipt is added to the retained v1 intake binding, manifest or object-key input. Future decoder audit evidence belongs separately and must bind the lease, original and manifest. Existing reviews/historical reads must not require history rewrites when decoder epochs change.

Before any runtime join, implement and independently qualify an authoritative revision/fence at each fresh decode/publication/retention boundary, or obtain explicit acceptance of a bounded revocation-delay policy. An unexpired cached snapshot cannot prove no later revocation. This module selects neither a trust anchor nor a distributed atomicity mechanism. It claims no atomic transaction across authority, filesystem and marketplace store. All existing actor authorization, policy, upload/return expiry and storage checks still apply.

## Focused qualification and remaining work

The focused test file covers unknown-effect dominance, contradictory results, source mismatch, separately bounded counters, exact replay/conflict, unresolved leases, legacy exhausted/rejected rows, original-key/manifest preservation, old VALIDATED upload/recovery, post-publication revocation, historical decoder outage and rejection by the existing validator/factory assertions. Inputs are synthetic in-memory claims only; no worker, database, Docker, provider or network operation is run.

Run only this new test with the pinned Node22.16.0 runtime. The retained 32/32 local worker/SQLite/socket checkpoint, earlier protocol/profile tests and financial/Stripe/PG/browser evidence remain evidence for their own unchanged source. Do not sum overlapping counts or rerun money/provider operations to qualify this pure model.

Actual target adapter/image/native closure, peer/clock/cgroup observations, independent watchdog/restart recovery, authority/revocation and qualified intake/factory integration remain engineering and qualification work. Claims, ownership history and pricing guidance remain OFF. Fingerprint plus genuine title/consignment/custody authority is still required; no decoder outcome supplies it. Grading and Ten Kings are unchanged.
