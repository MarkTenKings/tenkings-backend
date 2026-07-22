# AI Grader Mathematical Calibration Activation Registry V1

Status: implementation candidate on `feature/ai-grader-calibration-activation-registry`, based only on frozen integration SHA `e7673c1a4f1799a594d09279ad392982ac028205`.

This contract adds activation authority without changing the evidentiary role of `CalibrationSnapshot`. Snapshots and bundle bytes remain immutable. Selecting a calibration creates append-only activation history; it never edits an old calibration or changes a historical report binding.

## Hosted schema

The additive migration is `20260721183000_ai_grader_calibration_activation_registry`.

- `MathematicalCalibrationActivation` is the immutable activation root. It binds rig, snapshot, canonical operating context, exact bundle/member/runtime/rig-characterization hashes, human request, idempotency hash, reason, request kind, expiry, and optional prior activation.
- `MathematicalCalibrationActivationEvent` is an append-only, hash-chained event ledger with `PENDING_CREATED`, `LOCAL_VERIFIED`, `ACTIVATED`, `FAILED`, `EXPIRED`, `SUPERSEDED`, and `REVOKED`.
- `MathematicalCalibrationActivePointer` has primary key `rigId`, so at most one hosted ACTIVE pointer can exist for a rig.
- `MathematicalCalibrationPendingPointer` also has primary key `rigId`.
- Database triggers reject simultaneous pending and active pointers for a rig and validate that every pointer matches an exact trusted snapshot and activation event.
- Database triggers reject update/delete of activation roots/events and reject changes to a snapshot's activation context hashes.
- `AiGraderSession.calibrationActivationId` and `AiGraderReport.calibrationActivationId` are delete-restricted historical links. Once non-null, database triggers make them immutable. A report activation must reference the same immutable `CalibrationSnapshot` as the report.
- Existing pre-migration snapshots remain preserved. Their context check is added `NOT VALID`; an incomplete legacy snapshot is listed as ineligible and is never inferred or backfilled.

No migration in this branch has been applied to Production.

## Canonical operatingContextV1

`ten-kings-ai-grader-operating-context-v1` is closed and canonically hashed. It contains:

- tenant, rig, rig version, location ID, and location identity;
- camera serial/model;
- lens and mount identities;
- controller identity, wiring-map identity, and ordered channel map 1-8;
- lighting configuration, ordered selected channels, and duty;
- exposure, gain, pixel format, width, and height;
- target, rig-characterization, bundle-manifest, source-capture, member-ledger, and all twelve member hashes;
- capture profile, calibration/analysis algorithms, threshold set/hash, helper identity, and helper version.

`runtimeContextHash` is derived from the same contract with calibration identity omitted. Both operating and runtime hashes must reproduce exactly.

## Hosted authority authenticity

The browser is transport only; it is never authority. Hosted owns a P-256 PKCS#8 signing key configured only through `AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNING_KEY_PKCS8_BASE64`. Its key ID is the SHA-256 of the corresponding DER-SPKI public key.

Both `AiGraderCalibrationPendingAuthorityV1` and `AiGraderCalibrationActivationAuthorityV1` are closed signed envelopes. Their canonical statements bind the schema, explicit `PENDING` or `ACTIVE` phase, activation ID/hash/revision, snapshot/rig, every bundle/member/runtime/rig-characterization/operating-context hash, hosted key ID/algorithm/issue time, phase timestamps/expiry, exact operating context for PENDING, and exact workstation receipt hash for ACTIVE. The signature is ECDSA P-256/SHA-256 with IEEE-P1363 encoding.

The workstation has only a rig-scoped public-key allowlist supplied by `AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_PUBLIC_KEYS_JSON`. It recomputes each key ID from exact DER-SPKI bytes and verifies phase, rig, clock window, canonical statement, and signature before writing PENDING, before changing the pointer to ACTIVE, and on every Start. Unknown keys, unsigned legacy values, malformed/wrong-phase envelopes, tampering, expired pending or Start envelopes, and replay/cross-rig/cross-activation attempts fail with no fallback.

ACTIVE envelopes are short-lived Start credentials. Once a fresh envelope has authorized Start and is bound into the session, later processing may recheck that same signed envelope after its Start window expires; it still requires the exact ACTIVE pointer, receipt, bundle, and live context. This prevents expiry from interrupting an existing card while ensuring every new card needs fresh hosted authority.

## State machine and no fallback

1. A fresh human admin selects an exact trusted, non-revoked snapshot using an optimistic registry revision and idempotency key.
2. Hosted appends a new activation root plus `PENDING_CREATED` and returns a canonical server-signed PENDING envelope.
3. Starting a pending selection first removes the prior active pointer and appends `SUPERSEDED` to that old activation. Replacing another pending activation appends `FAILED`.
4. Local helper atomically writes the new PENDING pointer before byte/context verification. This immediately prevents continued use of the old profile.
5. Local first verifies the hosted PENDING phase, pinned signing key, canonical signature, exact rig, and expiry; only then may it write PENDING and verify idle state, content-addressed bundle/member bytes, and live operating/runtime context.
6. Local signs the canonical workstation receipt using allowlisted P-256/SHA-256 IEEE-P1363 authority and stores it immutably.
7. Hosted re-locks the rig, re-verifies snapshot bytes and the exact receipt, appends `LOCAL_VERIFIED` then `ACTIVATED`, deletes pending, and creates the sole ACTIVE pointer.
8. Local verifies the hosted ACTIVE signature before accepting it, requires exact pending-pointer and immutable-receipt agreement, then atomically changes the pointer to ACTIVE.

A failed activation leaves no active pointer. There is no automatic rollback, newest/previous/closest selection, or last-known-good path. If any activation root for the exact rig/snapshot ever contains `ACTIVATED`, every later attempt must use the explicit `reactivate` route and reference an exact prior activated ID, even when the latest reactivation attempt failed. Revoked snapshots cannot activate. Revocation appends `REVOKED` audit events and deletes matching active/pending pointers; the Start gate independently rechecks snapshot trust.

## Hosted routes and exported DTOs

All routes are POST-only. The route selects the action; authenticated server state supplies the actor. Browser bodies cannot declare action, actor, state, activation IDs/hashes generated by the service, storage keys, or secrets.

| Action | Route | Request DTO | Response DTO |
| --- | --- | --- | --- |
| list | `/api/admin/ai-grader/calibration-activations/list` | `AiGraderCalibrationActivationListRequestV1` | `AiGraderCalibrationActivationListResponseV1` |
| status | `/api/admin/ai-grader/calibration-activations/status` | `AiGraderCalibrationActivationStatusRequestV1` | `AiGraderCalibrationActivationStatusResponseV1` |
| activate | `/api/admin/ai-grader/calibration-activations/activate` | `AiGraderCalibrationActivateRequestV1` | `AiGraderCalibrationActivationPendingResponseV1` |
| reactivate | `/api/admin/ai-grader/calibration-activations/reactivate` | `AiGraderCalibrationReactivateRequestV1` | `AiGraderCalibrationActivationPendingResponseV1` |
| complete | `/api/admin/ai-grader/calibration-activations/complete` | `AiGraderCalibrationCompleteActivationRequestV1` | `AiGraderCalibrationCompleteActivationResponseV1` |
| fail | `/api/admin/ai-grader/calibration-activations/fail` | `AiGraderCalibrationFailActivationRequestV1` | `AiGraderCalibrationFailActivationResponseV1` |
| Start authority | `/api/ai-grader/calibration-activation/status` | `AiGraderCalibrationStartAuthorityRequestV1` | `AiGraderCalibrationStartAuthorityResponseV1` |

The route constants are exported as `AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1`. Route names and exported DTO names are unchanged. Pending responses contain the server-built and server-signed `AiGraderCalibrationPendingAuthorityV1`, including the exact operating context. Complete and Start responses contain a signed ACTIVE envelope. Complete accepts only the workstation receipt plus exact activation/revision/idempotency identifiers; it does not accept a browser-declared pending or ACTIVE authority.

List/status projections carry stable activation ID, activation hash, event revision, state, snapshot/rig IDs, all exact hashes, receipt hash, pending expiry, requested/local/active/terminal timestamps, prior activation, and successor linkage. Incomplete legacy snapshots are explicitly projected as ineligible.

List/status use the existing admin session. Trust, activate, reactivate, complete, fail, revoke, and supersede require `requireFreshHumanAdminSession`: a currently stored human session no older than 15 minutes. Static operator keys and service accounts are rejected. The Start authority route permits only a human Production actor.

## Local registry and helper integration

The trusted local finalizer optionally receives `--registry-staging-root <fixed-root>`. Only after it has verified the certified analysis and finalized the exact bundle does it atomically write:

`<finalizer-staging-root>/<bundleManifestSha256>/`

That directory contains the manifest, all twelve exact members, and `mathematical-calibration-finalizer-handoff-v1.json`. The handoff binds finalizer authority, rig/profile/version/finalized time, source-analysis hash, and bundle hash. The loopback action `ingest-finalized-calibration-bundle` accepts only the bundle SHA-256. It cannot accept a caller or browser path and resolves the exact fixed staging directory itself.

The registry verifies that handoff and every bundle/member byte before copying them immutably beneath:

`<registry-root>/bundles/sha256/<bundleManifestSha256>/`

Existing content-addressed bundles are never overwritten. Hosted operating contexts are stored immutably per activation. Receipts are immutable at `receipts/<activationId>.json`. The only mutable local file is the atomically replaced `active-pointer-v1.json`.

Ordinary selection uses the loopback/token-protected helper actions:

- `ingest-finalized-calibration-bundle`
- `prepare-calibration-activation`
- `confirm-calibration-activation`

No config edit or helper restart is required. Production startup configuration supplies registry/key/inventory plumbing:

- `AI_GRADER_CALIBRATION_WORKSTATION_PRIVATE_KEY_PATH`
- `AI_GRADER_CALIBRATION_WORKSTATION_KEY_ID`
- `AI_GRADER_CALIBRATION_RIG_INVENTORY_PATH`
- `AI_GRADER_CALIBRATION_RIG_INVENTORY_SHA256`
- `AI_GRADER_CALIBRATION_FINALIZER_STAGING_ROOT`
- `AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_PUBLIC_KEYS_JSON`
- optional `AI_GRADER_CALIBRATION_ACTIVATION_REGISTRY_DIR`
- optional `AI_GRADER_CALIBRATION_HELPER_INSTANCE_ID`

The SHA-pinned inventory binds rig/location, camera, optics, controller transport/wiring, lighting configuration, pixel format/resolution, and helper identity. On prepare, confirm, and every Start, the real helper opens Basler/Pylon at the exact requested exposure/gain, proves the observed serial/model/pixel format/resolution, writes the exact Leimac channel/duty frames, requires every controller acknowledgement, and cross-checks those observations against both the protected inventory and hosted context.

`AI_GRADER_CALIBRATION_LIVE_OPERATING_CONTEXT_PATH` is prohibited in real mode. Editable JSON may be used only through explicit test/mock dependency injection and can never be Production authority. The private key and protected inventory remain workstation-local and are not returned by hosted APIs.

## Start New Card and historical reports

Before Start New Card, the browser obtains one exact fresh server-signed hosted ACTIVE authority for the exact tenant/rig. The browser cannot alter or create that authority. The local helper then requires:

- a valid rig-pinned hosted signature, ACTIVE phase, and Start time window;
- the exact local ACTIVE pointer;
- matching activation ID/hash/revision;
- matching snapshot, bundle, member-ledger, runtime, rig-characterization, and operating-context hashes;
- matching immutable receipt bytes/hash;
- reverified content-addressed bundle bytes;
- matching live operating/runtime context.

Any absent, unsigned, unknown-key, wrong-phase, pending, expired, revoked, replayed, cross-rig, cross-activation, ambiguous, corrupt, tampered, or mismatched condition hard-fails.

The exact activation authority is bound into the local session manifest, rechecked before mathematical processing, propagated into newly generated Mathematical V1 reports, server-verified against the append-only activation/event record during persistence, and stored on both hosted session and report. Every new Mathematical V1 persistence without that exact authority, or with a mismatched/cross-snapshot authority, fails before mutation. The V0.3 read schema stays optional only so older stored reports remain readable without fabricated activation history. Later activation or revocation does not rewrite an existing non-null historical binding.

## Validation status

Corrective hardware-free validation passed on 2026-07-21: shared/database/helper builds; Next.js typecheck; Prisma schema validation; database activation/snapshot/production tests `67/67`; serialized helper station/report/orchestrator/registry/runtime selection `29/29`; trusted finalizer tests `3/3`; and hosted activation/snapshot API tests `6/6`.

The coverage includes snapshot immutability, activation/event update/delete database guards, immutable historical session/report bindings, two-phase activation, concurrent completion, failed activation with no fallback, ACTIVE -> failed reactivation -> plain-activate rejection, exact prior-active reactivation, SHA-pinned inventory, opened Basler/acknowledged Leimac mismatch rejection, editable-context-file rejection, content-addressed finalizer handoff ingestion, signed receipt verification, server-signed hosted pending/ACTIVE authority, pinned-key/phase/tamper/expiry/replay rejection, hosted/local completion agreement, mandatory new-write activation binding, historical read compatibility, revocation, route anti-spoofing, fresh-human auth, and Start authority gating.

The migration and validator sources also have a hardware-free regression test. It verifies the append-only triggers, single-rig pointer key, delete-restricted history, explicit failed-activation/no-rollback assertion, and absence of destructive table-drop/truncate statements.

The guarded disposable PostgreSQL runner and activation SQL validator are included. On 2026-07-21 the runner stopped before creating a database because `docker.exe` was unavailable (`spawnSync docker.exe ENOENT`). No database was created or mutated. A machine with a local Docker engine must run:

`pnpm --filter @tenkings/database run validate:nfc:migration:disposable -- --ack-disposable-local-postgres`

That guarded procedure publishes PostgreSQL only on loopback, validates the full migration chain and second-deploy no-op, then destroys the container and storage. Production migration/deploy remains separately prohibited.
