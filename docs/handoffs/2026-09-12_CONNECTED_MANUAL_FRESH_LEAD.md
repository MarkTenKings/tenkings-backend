# Connected manual workflow — fresh Astra lead handoff

Prepared September 12, 2026 at Mark's explicit request to transfer the completed
build to a fresh Astra Extra High lead with four or five fresh Astra Extra High
specialists. This document is the compact entry point; it does not replace the
approved blueprint or runtime evidence.

## Start here

1. Read the repository's mandatory context files: `docs/context/MASTER_PRODUCT_CONTEXT.md`,
   the **entire** `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`,
   `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`,
   `docs/HANDOFF_SET_OPS.md`, and `docs/handoffs/SESSION_LOG.md`.
2. Read `docs/atlas/audits/2026-09-12/connected-manual-workflow.md` and
   `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md`.
3. Verify the source baseline and compact evidence below. The saved project's
   main checkout is an unrelated older branch; use this handoff's branch/state.
   Do not restart the previous implementation from that main checkout.
4. Take ownership of the next release-readiness work. Confirm the handoff has
   loaded, assign the fresh specialist team, and begin independent useful work.
   Do not wait for Mark to repeat the task or reapprove decisions already made.

## Source and local evidence

- Previous task: `01a093c8-2b37-7ee0-aab5-db7589e43fc1`.
- Previous checkout: `/Users/markthomas/.codex/worktrees/9676/ten-kings-mystery-packs-clean`.
- Source branch: `codex/atlas-speedster-astra-lead-20260911`.
- Implementation commit: `fded034dc27eca7e43be9afe1cdc06a2affb2f33`.
- Final qualification/test-fix commit: `b44dc485d5651fcb3ba5b2418d52335e9f712d43`.
  The subsequent handoff commit contains documentation only.
- Shared evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/`.
- Start with `root-final-verification.json` in that evidence root. Its current
  status is `dockerFinalRebuild: PASS`, 251 passing Linux tests, and no remaining
  owned containers. Earlier disk-blocked reports are superseded by this record.
- Final local image: `atlas-connected-manual:final-verified-20260912`.
- Final image digest: `sha256:b6eaf704a8241afd470d9da81b4402cbd8f16184ecd6c608c99b5396f6ae48f1`.
- Final 497-file source manifest: `final-source-context/source-manifest.json`,
  SHA256 `b4f41db57f95ad1177f46f036e6a259f4e700c7599e669f356d4d1164e02e8bf`.
  Every entry was checked against the checkout and actual final image.

No production deployment, live migration, paid model request or live storage
write was made for this connected milestone. The three schema proposals and
feature activation remain inactive outside disposable fixtures. Local success
does not establish current live DB/config/provider/target-host behavior.

## Accepted product decisions

- First usable build supports standard-size sports and Pokémon cards. Other
  sizes remain outside this first geometry scope.
- Keep untouched native iPhone HDR originals. Derive full-resolution SDR working
  images from the qualified base image for inspection; no spatial resampling.
- Mark liked the paired manual geometry interaction. Do not infer that his
  exploratory Front edge adjustment proved an optical defect.
- After inspecting and correcting both sides, one **Confirm findings** button
  accepts the corrected findings list. Separate trained-human report approval
  remains a different action; do not require one confirmation per finding.
- Keep the dedicated Vercel staff app at `/admin`. CPU/native work belongs in a
  separate private Linux service, with ordinary staff authentication preserved.
- Use the existing extracted Google Vision/Astra eight-field identification
  request, prompt, field meanings and model settings. No replacement grading
  operator, automatic defect pipeline or new scoring math was approved here.
- Mark wants autonomous progress and clear short updates. Prepare concrete work
  before asking for any approval that is actually required.

## What is built

- Actual feature-gated staff card list, independent Front/Back native uploads,
  durable upload/retry journals, private original storage, verification and
  preparation, shared identification, durable partial identity corrections,
  paired geometry, defect review, measured manual traces and approved reports.
- `packages/atlas-manual-intake`: upload plans, per-side versions, verification,
  exact replay, source lifecycle and additive SQL.
- `packages/atlas-connected-manual`: details/identification claims, immutable
  provider-effect evidence, current-pair guards, workflow composition, exact
  signed transport and the private CPU entry point.
- `frontend/atlas-app/components/ManualCards.jsx`, manual pages, signed frontend
  proxy and private runtime composition. Large images use direct private object
  GET grants with full browser byte-count/SHA256 verification before decoding.
- Qualified Apple P3 HDR-gain-map input is admitted only under explicit
  `retain-hdr-use-sdr-base`. Original/rich-primary/SDR/prepared objects remain
  distinct and immutable. Unsupported input still fails closed.
- Physical/print edits, CPU preparation and defect measurements preserve the
  unchanged side. Source/detail authority is checked again at actual commit;
  a replaced photo cannot receive approval for the previous pair.
- Expired image grants renew without replacing editable state. Navigation
  rechecks current unsaved work after awaited reads. Concurrent recovery clients
  clear only the exact journaled command they finished. Lost approval replies
  recover without a duplicate approval dispatch.
- Existing card geometry/scoring remains intact. Human confirmation does not
  create learning, publishing, inventory or physical-finishing authority.

## Verification to preserve

| Evidence | Result and limits |
| --- | --- |
| `combined-tests-final-races.log` | 486 local app/intake/service/workflow tests pass, no skips |
| `linux-runtime/tests-final-corrected.log` | 251 expanded Node20.20.2 Linux/amd64 checks pass, no failures/skips |
| `linux-runtime/final-source-and-boundary.log` | All 497 source hashes match; staff boundary passes 26 browser chunks, 12 traces, 2,058 entries and Debian Prisma engine |
| `browser/FINAL_UI_REPORT.md`, `browser/ui-final-7/browser-results.json` | 11 real Next browser scenario groups pass, including mobile, delayed-navigation trace preservation, private image renewal and lost approval reply |
| `linux-runtime/retained-photos-final.json` | Both original iPhone sides produce exact Mac/Linux rich-primary and SDR RGB pixels at 3024×4032 |
| `intake/`, `connected-tests/`, `connected-review/` | Native owned PostgreSQL, separate roles, exact replay, expiry, immutable receipts and source-race checks |
| `final-container-cleanup.json` | All owned qualification containers removed; Docker healthy |

PostgreSQL fixtures applied 95 public and 35 staff migrations plus three additive
proposals. Those counts are fixture observations, not a statement about the live
database. All specialist databases and eight root preview/database fixtures are
stopped with retained cleanup receipts. Synthetic SMS/model/storage fixtures
were used; there were no paid provider calls or owner approvals manufactured.

Two provenance details matter:

1. The final full serving/native/web build is parent image
   `sha256:af9cfcabe22dfa43d9e14b10baa819bf78b653670d753531aeb34d244bc1b74c`.
   Its retained-photo proof is final for unchanged serving/native source. The
   final image adds one corrected **test file** only. A reused PID file could
   briefly read empty and become PID0, producing a false cancellation failure.
   Root reproduced it and a fresh Astra xhigh reviewer independently checked the
   fix: atomic publication, separate cancellation file, positive/live readiness,
   guaranteed abort/cleanup and ESRCH. See `linux-final-test-overlay.json` and
   `linux-runtime/cancellation-review.json`. Do not rerun expensive unchanged
   builds merely to erase this correctly retained provenance.
2. Original specialist seals remain historical. The intake client seal was
   superseded by reviewed upload-recovery work. `color-oracle.mjs` lost one extra
   EOF newline during staged whitespace review. The final source manifest and
   root verification record include those documented deltas.

The retained native originals are under
`/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/heic-20260910/validation/photo-intake-ui-1789059282711/`
as `FRONT-original-download.HEIC` and `BACK-original-download.HEIC`. Preserve them
and the evidence; do not duplicate the large evidence tree into a fresh worktree.

## Next work and suggested five-specialist team

Use fresh `gpt-6-astra` agents with `reasoning_effort: xhigh` and bounded tasks.
Honor the actual concurrency cap. The outgoing environment allows four active
agents including the lead, so five specialists may need two waves (three, then
two). Do not create five user-owned tasks instead of subagents. Do not silently
substitute models if the requested model or slots are unavailable.

1. **Runtime and build delivery:** inspect existing CI/private Linux options and
   current deployment identities read-only. Prepare a practical remote-build and
   private-service candidate path, exact image/config/health checks and rollback.
   Confirm target-host native startup separately from local amd64 emulation.
2. **Storage and database:** inspect current migration/role/CORS/bucket state
   read-only where access exists. Produce the exact additive schema/least-privilege
   release plan and provider acceptance steps. Prepare a unique harmless live
   canary for review; its write/delete requires the separate authorization stated
   in DEPLOY_RUNBOOK. Do not repurpose a real card object.
3. **Web and staff authentication:** verify the dedicated staff release candidate,
   ordinary auth/CSRF, exact web deployment/release binding, signed private
   transport, image origins and coordinated activation/rollback. Feature remains
   off until the private service, storage and DB are qualified.
4. **Fresh-card acceptance:** prepare the shortest owner-facing sports/Pokémon
   checklist and an available candidate route after release prerequisites are
   ready. Actual physical detail/color, phone optics and Mark's human approval
   cannot be supplied by fixture tests. Avoid another broad product questionnaire.
5. **Independent release review:** review the integrated candidate and first-wave
   findings for missed release blockers, auth/source/recovery failures and
   documentation drift. Give prioritized evidence-based findings, not a repeat
   of already-passed tests.

Lead integrates the specialists, fixes concrete in-scope gaps, and makes the next
release action reviewable. Existing build authorization covers preparation,
reviews and ordinary fixes. This transfer itself is not approval to spend on a
new cloud service, migrate production, activate traffic or issue paid provider
work. Apply the actual runbook/session authorization rules to concrete actions;
do not invent approval requirements for harmless preparation.

Later product milestones remain automatic defect assistance, learned corrections,
variation/comps research, public report publication, integrated Mac NFC/labels/
physical finishing and the replacement Astra grading operator. The historical
serving-I issue and unresolved initiating-cause prerequisite for that replacement
operator are not closed by this manual candidate. Do not reopen canceled old-card
recovery or change existing serving infrastructure as a shortcut.

## Mac disk and operating constraints

Mark authorized easy cleanup. Eleven already-installed app DMGs, twelve old
unused pnpm tool-cache entries and pip HTTP download caches were removed after
ownership, mounted-image and open-file checks. Measured free-space increase was
5.864 GB. No source, photo, evidence, installed app, Docker image or volume was
deleted. Final build/test use left roughly 3 GB available; recheck actual free
space before doing heavy local work. Avoid broad installs or duplicate images.

Docker's disk occupied about 83 GiB. After recovery, Docker reported zero
containers and local volumes; its image/cache totals overlap and must not be
summed as physical disk use. Mark discussed cloud builds and agreed to easy
cleanup first. Remote builds were recommended, but no cloud builder was created
or storage migration authorized. Do not move Docker.raw into iCloud or delete it.
Further cleanup should be scoped to verified disposable items and current user
authorization, preserving application data and evidence.

Append SESSION_LOG for commit-worthy changes and planned/observed deploy,
restart or migration actions. Trust code/runtime/DB evidence over stale docs and
update conflicting docs in the same session. Keep this old checkout and its
committed history available; the fresh lead should own its new task/worktree.
