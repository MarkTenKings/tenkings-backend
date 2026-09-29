# ATLAS review design release — September 29, 2026

Status: deployed and independently verified on 2026-09-29 at 09:56 UTC, including live public browser checks. Physical authenticated reviewer acceptance remains with the owner.

The independent ATLAS Design Lead owns visual design and public integration. Engineering owns release evidence and SESSION_LOG. Application source was frozen collectively and committed as 29e9192080d7d7a95644316a417dc6171eef3bbb, tree 8d2c337a2d57ceef439d8955e9a010726b661a99, before final qualification and deployment.

## Approved behavior

- Staff review presents one large side at a time, with physical and printed outlines together, thin controls and a magnifier. One green Approve saves and advances; ordinary stage browsing never approves.
- Findings provide a focused marked photograph beside a clean synchronized view, clear Add/Edit/Reject tools, and bounded navigation. Unsaved edits and stale responses cannot silently advance or approve.
- Completion makes label, NFC, comps and report next steps visible using their actual saved status. It does not claim unconnected hardware or unstarted paid work is complete.
- The customer report shows individual findings by default, simpler navigation and an evidence-derived gold fingerprint. Fingerprint motion is entered explicitly, supports reduced motion, and is a reproducible rendering of approved evidence, not a proven unique identity or authentication claim.

## Fresh pre-release baseline

Read-only checks at 09:31–09:32 UTC confirm staff/public web source1e08f0ae, private source 47559353 and existing224e41e9 immutable Linux image. Current runtime a55025d6 verifies all1,049 source files and16 native artifacts. Database has32 tracked history fingerprints, 68 jobs and zero active batch, ingestion, geometry, identification, display, learning or customer work, with zero unsettled accepted provider requests. Controls remain Staff48/STAFFSMS46/Public28; customer15/13. Migration ledgers remain61/112. Customer d4a deployment and public aliases match the baseline.

Initial Vercel read returned403 for an expired OAuth access token. The hash-checked existing CLI59.15.1 refreshed the ordinary login via whoami; the subsequent exact provider snapshot passed. No provider configuration changed.

Private evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-design-release-20260929/release/{provider-before.json,runtime-baseline.json,database-before.private.json}`. These are fresh records; historical intents must never be replayed.

## Qualification and current limits

Prior local staff proof covers actual physical/printed edits on both sides, save/prepare/reproject/remeasure, reload retention and progression through findings to a calculated draft. The demo cannot certify a card. Native demo qualification uses disclosed local OpenCV4.10/Python3.12 rather than claiming equivalence to retained Linux runtime artifacts.

Final source-bound tests, production web builds, source compatibility proof, signed transport and canonical/deployment checks pass. Read-only public browser checks also pass; physical staff acceptance is distinct. Passing synthetic or component tests does not constitute a real human grading approval. No model requests, real approvals or learning candidate activation are authorized by these checks.

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

## Production result

- Staff deployment: `dpl_7AhSNcqfCqhozbgxhye8zLAtTcQK` (`atlas-grading-staff-j6hff2x8z-ten-kings.vercel.app`).
- Public deployment: `dpl_6gV79X9xHVQUznt24fkToTnZQhEE` (`atlas-grading-public-nvosksm4u-ten-kings.vercel.app`); all four aliases promoted once.
- Runtime: `6870ef0601360fc521e4e45542f7d66309064bc45fdd82d0fefb5a287274f788`; same private source 475 and 224e image, 125-second boot protection, same isolation/resources/native artifacts, zero restarts.
- Protected environment: `/opt/atlas/design-review-release-20260929/candidate.docker.env`, hash `1abd54cad5bebf2fd4c72457283784d1705fc48c61567cb9697cdfd247f62019`. Only ATLAS_MANUAL_WEB_RELEASE_SHA and ATLAS_MANUAL_WEB_DEPLOYMENT changed.
- Controls Staff 49 / STAFF SMS 47 / Public 29. Customer controls/deployment unchanged. All 32 history fingerprints, 68 jobs and 61/112 ledgers preserved. No migration or real card approval.
- Final tests 1,614/1,614, zero skips: staff 763, workspace 234, manual-server 522, public/customer/router 95. Both source-bound production builds pass. Native image qualification is retained separately and its exact 1,049 source / 16 native bytes reverified live.
- New helper qualification: 7 offline guard tests, 11 Python syntax checks, 2 Node checks. The cutover CAS completed with 115,638ms of conservative boot-fence allowance remaining; nanosecond Docker timestamps are parsed safely and deadline authority uses host monotonic time.
- Signed TLS read results: staff without session 401, unknown report 404, unchanged customer directory 200. Canonical homepage exactly matches frozen bytes; sign-in and new reviewer/fingerprint bundles load, approved Abomasnow v1 report 200.

Production proof files under the private release directory: `runtime-helper-offline-verification.json`, `runtime-prepared.json`, `runtime-started.json`, `database-cutover-result.json`, `database-cutover-fence.json`, `signed-probes.json`, `promotion.result.json`, `canonical.result.json`, `final-result.json`, `final-runtime-readonly.json`, and `final-database.private.json`.

No measured grading accuracy improvement is claimed by a presentation release. Existing lossless grading and baseline-only learning remain active. Normal staff sign-in may be needed after control revision changes.


## Live public browser acceptance

A fresh anonymous in-app browser passed at 09:56 UTC against the canonical approved Abomasnow v1 report. It verified all 13 individual Back findings, a white report surface, photograph verification gates, the exact ATLAS gold fingerprint, reversal to the same photograph and all labels, synchronized marked/clean views, and saved centering measurements. Desktop 1280px and phone-sized 390px layouts had no horizontal overflow; browser warnings and errors were empty. The viewport override was reset afterward.

Receipt: `/Users/markthomas/.codex/atlas-handoffs/atlas-design-preview-20260928/fingerprint-production-browser-qualification-20260929.json`, SHA-256 `05c5610b1882e7502cd2bd93b50710d1fe5ad958ed5c6c598d65103532d6d8db`. Desktop and phone-sized screenshots are recorded in that receipt. These were read-only public checks, not physical iPhone performance or authenticated staff approval tests. The owner's existing Chrome tabs were untouched.

Live staff queue: https://atlasgrading.com/admin/batch?tab=REVIEW

Live sample report: https://atlasgrading.com/reports/ar_x01RP8d3VZS0Gk9rREW0DwkR?v=1

The final handoff is documentation only. Deployed application source stays `29e9192080d7d7a95644316a417dc6171eef3bbb`; no rebuild or further production mutation is required.
