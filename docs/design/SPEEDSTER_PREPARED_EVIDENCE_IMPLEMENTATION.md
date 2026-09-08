# Speedster prepared evidence implementation

Status: implemented and validated locally on `codex/atlas-prepared-evidence-implementation-20260907`, based on reviewed design `db899e953226563bafc156da6bec3710fe5e65b8`. No deployment or live migration is authorized. The owner-approved V2 blueprint is unchanged.

## Implemented boundary

- `speedsterPreparationService.ts` freezes exact original bytes, records a geometry/mat/release-bound attempt, consumes its single dispatch claim, and grants only five private staging destinations. It verifies worker identity, observed source bytes/decoder/dimensions, transform/frame and all five images before creating accepted artifacts from the same hashed buffers. Generic writers and upload presigners reject accepted/source evidence namespaces, including local path aliases.
- Three new preparation models and migration `20260908010000_speedster_prepared_evidence_authority` provide scoped heads, attempts and manifests. Session/head locks, compare-and-swap, immutable inputs, write-once dispatch/terminal outcome, atomic adoption and append-only audit prevent superseded attempts becoming current. Canonical TEXT preserves exact JSON numbers; JSONB is a checked projection. Prisma's deferred-COMMIT error behavior is handled by forcing adoption constraints inside its transaction callback.
- Capture PATCH requires both current adopted references, verifies all frozen bytes outside locks, binds source/physical geometry/transform/frame/artifacts from server manifests, derives centering from human-confirmed printed geometry, and validates four genuine Color receipts against the frozen source. Under session/head and FAMILY→EXACT map locks, it repeats time-sensitive receipt and mutable selection checks and saves capture, Color rows and audits atomically. Mapless capture clears stale map columns.
- A canonical capture envelope preserves exact numeric evidence through later ordinary Prisma JSON reads. Server readers bind its side objects privately; browser JSON markers cannot authorize new keys. Later report-image metadata and current TRAIN map columns remain current. Browser response-loss reconciliation can use the exact historical capture registration without changing those current columns.
- Browser preparation journals persist photos, handles, mat choice, physical learning evidence, request ID and expected head before POST. Reload/status is read-only; it neither dispatches preparation nor renews receipts. Unresolved/superseded work requires an explicit new attempt with the current server head. Malformed or superseded local journals have an explicit discard action that preserves all server history. Existing V1/V2 registration drafts remain readable; absent preparation authority requires explicit work before new capture.
- Preparation-only worker evidence adds bounded single-frame source decoding and exact reported CPU release/decoder identity. Synthetic pixels verify JPEG/PNG EXIF orientations 1–8. Oriented WebP is rejected on server and worker because observed OpenCV decoding ignores that orientation; the original remains preserved. Detector admission and the existing signed detector pin are unchanged.

## Local evidence

Commands use an empty environment plus fixture-only variables. No `.env`, real credentials, provider adapters or live database are loaded.

| Check | Result and scope |
| --- | --- |
| Full frontend grading suite | 758/758, including 80 browser lifecycle tests; `/tmp/atlas-preparation-broad.tap` |
| Changed source/test ESLint | 37 files, no warnings/errors; `/tmp/atlas-preparation-lint.log` |
| CPU preparation worker | 7/7; `/tmp/atlas-preparation-worker.log`; temporary CPU Python runtime, no detector model/GPU |
| Disposable PostgreSQL 16.14 | `/private/tmp/atlas-preparation-db-RnhFWW/result.json` and `validation.log`; 18 grouped checks, second deploy NO_OP, owned cluster stopped |
| TypeScript | Test-inclusive check has unrelated baseline workspace/test diagnostics; no changed-file diagnostics after fixture typing fixes. No full Production build is claimed. |

Frontend regression files: `speedsterPreparationAuthority.test.ts`, `speedsterPreparationStorage.test.ts`, `speedsterPreparationService.test.ts`, `speedsterPreparationCapture.test.ts`, `aiGraderV2CaptureWorkspaceLifecycle.test.tsx`, `aiGraderV2Sessions.test.ts`, `aiGraderV2Instrumentation.test.ts`. The lifecycle suite covers lost response, unresolved reload, explicit new CAS attempt, local-storage failure before dispatch, full-draft plus journal recapture, and delayed status/expired-registration blocker responses across a map-binding change.

The dedicated SQL harness is `packages/database/scripts/runSpeedsterPreparationValidation.mjs`; its runtime proof is `frontend/nextjs-app/scripts/validate-speedster-preparation-postgres.ts`. It refuses inherited DATABASE_URL and requires an explicit fixture acknowledgment, fresh owned directory/sentinel/UID, matching data directory and loopback binding. Logs/data are retained and only its own cluster is stopped.

Its declared chain is a synthetic baseline generated from exact `db899e95`, the existing append-only audit migration, and the exact preparation migration. Ten unrelated preexisting Location UUID/TEXT foreign keys are omitted only from the generated fixture baseline and enumerated in result.json. This is **not** the complete historical or combined ATLAS/Vault migration chain. Storage/worker bytes in this SQL run use fixtures; genuine Color HMACs, actual capture persistence, database constraints and actual map publisher/reader are exercised. The lock regression asserts the actual first FAMILY publisher lock key before concurrent completion; it does not claim to observe a waiting pg_locks row. The stale NO_MAP test injects a stale preflight selection and proves locked mismatch rollback, not a naturally interleaved production lookup.

## Remaining release/integration gates

1. Lead integrates exact local commit(s) into its combined ATLAS base and validates the full combined migration chain. The unrelated baseline FK omissions remain explicit; the scoped proof cannot waive that gate.
2. Separately approve, build, sign and verify a compatible preparation worker release, including source/tree/image/build and observed CPU contract. `approvedPreparationRelease` is intentionally null and rejects fresh preparations. Environment variables or a moving tag cannot activate it. Existing detector release admission stays independent; a new shared worker release also needs coordinated detector admission validation.
3. Verify real object-storage private access, checksum behavior and conditional create support. Local/S3 command fixtures are not provider proof; unsupported conditional PUTs must fail closed or receive a separately reviewed immutable adapter. Worker/browser grants must never reach accepted evidence.
4. Deployment, migration, restart, paid/provider/GPU execution and a real card acceptance run require their own operational authorization. No such operation was performed here.

Preserve all originals, attempts, manifests, receipts, reports and rejected evidence. Rollback keeps centering/release safeguards and pauses new preparation/capture if the complete evidence boundary cannot be maintained. Never restore worker writes to accepted keys or erase historical evidence to hide a conflict.
