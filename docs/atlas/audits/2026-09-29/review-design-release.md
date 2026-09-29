# ATLAS review design release — September 29, 2026

Status: owner-authorized integration and release preparation; no production deployment of this redesign yet.

The independent ATLAS Design Lead owns visual design and public integration. Engineering owns release evidence and SESSION_LOG. Application source will be frozen collectively before commit-bound final qualification and deployment.

## Approved behavior

- Staff review presents one large side at a time, with physical and printed outlines together, thin controls and a magnifier. One green Approve saves and advances; ordinary stage browsing never approves.
- Findings provide a focused marked photograph beside a clean synchronized view, clear Add/Edit/Reject tools, and bounded navigation. Unsaved edits and stale responses cannot silently advance or approve.
- Completion makes label, NFC, comps and report next steps visible using their actual saved status. It does not claim unconnected hardware or unstarted paid work is complete.
- The customer report shows individual findings by default, simpler navigation and an evidence-derived gold fingerprint. Fingerprint motion is entered explicitly, supports reduced motion, and is a reproducible rendering of approved evidence, not a proven unique identity or authentication claim.

## Fresh pre-release baseline

Read-only checks at 09:31–09:32 UTC confirm staff/public web source1e08f0ae, private source47559353 and existing224e41e9 immutable Linux image. Current runtime a55025d6 verifies all1,049 source files and16 native artifacts. Database has32 tracked history fingerprints,68 jobs and zero active batch, ingestion, geometry, identification, display, learning or customer work, with zero unsettled accepted provider requests. Controls remain Staff48/STAFFSMS46/Public28; customer15/13. Migration ledgers remain61/112. Customer d4a deployment and public aliases match the baseline.

Initial Vercel read returned403 for an expired OAuth access token. The hash-checked existing CLI59.15.1 refreshed the ordinary login via whoami; the subsequent exact provider snapshot passed. No provider configuration changed.

Private evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-design-release-20260929/release/{provider-before.json,runtime-baseline.json,database-before.private.json}`. These are fresh records; historical intents must never be replayed.

## Qualification and current limits

Prior local staff proof covers actual physical/printed edits on both sides, save/prepare/reproject/remeasure, reload retention and progression through findings to a calculated draft. The demo cannot certify a card. Native demo qualification uses disclosed local OpenCV4.10/Python3.12 rather than claiming equivalence to retained Linux runtime artifacts.

Final code tests, production web builds, source compatibility proof, real public browser proof and deployment checks are in progress. Passing synthetic or component tests does not constitute a real human grading approval. No model requests, real approvals or learning candidate activation are authorized by these checks.

The qualification agent reproduced an Add finding selection mismatch and fixed controlled focus reconciliation after editor closure. Its JSX regression failed before and passed after. The native demo test now opts in explicitly through ATLAS_FIXTURE_PYTHON so default package CI does not require a machine-specific path. Final source-bound counts supersede interim counts in SESSION_LOG.

## Release gates

1. Collective source freeze and committed source/tree; no application changes during final tests/builds.
2. Exact browser-only source compatibility proof: unchanged private runtime dependencies, schemas, native code and grading/image/learning contracts; unchanged customer and frozen homepage. Browser exports are additive and existing server exports remain identical.
3. Source-bound final tests and strictly sequential staff/public production builds, with boundary checks. Disk is limited; no broad cleanup or duplicate builds.
4. Standalone exact-source upload copy; guarded CLI dry manifest and read-only preflight before any staged upload.
5. New staged staff/public candidates with unchanged customer origin. Same private image with only staff web release/deployment binding changes; fresh network-none constructors.
6. Immediately fresh provider and quiescent database checks; retained predecessor; new exclusive cutover intent;125-second boot fence; exact three-row CAS with history/jobs/ledgers preserved.
7. Signed read-only private probes before public promotion; canonical homepage/sign-in/report and final runtime/database preservation proofs.
8. Honest handoff distinguishes live release checks from physical reviewer acceptance and does not claim measured accuracy improvement.

A recovery must be a new guarded transition with matching runtime/web/control identities and forward-moving control revisions. On an ambiguous mutation result, reconcile read-only; never retry a consumed intent.
