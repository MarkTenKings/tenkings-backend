# ATLAS Grading rebuild 3 — fresh Astra Ultra lead

Prepared September 17, 2026, at Mark's explicit request. Start a fresh lead task
using **gpt-6-astra / ultra**, with **3–5 gpt-6-astra / xhigh specialists**.
This is continuation of the third rebuild. Preserve the implemented system;
do not start a fourth architecture or ask Mark to reconstruct this conversation.

## The status Mark needs first

**The core rebuilt workflow is implemented and committed, but is not deployed.
The next milestone is a working live grading route, followed by Mark's real-card
acceptance. There is currently no new live workspace for him to test.**

| Area | Completed source | Live/acceptance status |
| --- | --- | --- |
| Photo intake | Native iPhone originals, untouched HDR retention, qualified full-resolution SDR working images, Front/Back pairing and private access composition | New intake not activated; storage qualification remains blocked |
| Manual grading | Paired geometry, editable borders and defect traces, deterministic measurement/scoring, durable save/reload and recovery | Locally qualified; real sports/Pokémon acceptance not run |
| Recognition | Shared recognition V2 for new attempts; historical V1 preserved; human edits and explicit clears survive | Integrated locally, not deployed or live-qualified in ATLAS |
| Astra defect assistance | Human-requested gpt-6-astra/xhigh proposals; accept/correct/reject, manual additions and measured traces | Built and tested with synthetic provider replies; real model accuracy untested |
| Proprietary defect memory | Confirm findings publishes reviewed crop/trace/outcome lessons; fresh relevant retrieval has revision/selection provenance | Built and DB-tested; next-distinct-card live learning test not run |
| Reports | Computed drafts and separate exact-snapshot human approval | Local workflow built; genuine reviewer authority and live approval need verification |
| Recovery/accounting | Exact request records, single dispatch, raw response/usage retention, stale-result fencing, safe undispatched retirement | Local tests pass; deployed failure/restart/concurrency acceptance remains |
| Shared catalog/research | Frozen reviewed upstream contract available; catalog schema installed by Inventory lead | ATLAS adapter not adopted; catalog/V4/API features remain off; no live reciprocal reuse |

The old ATLAS website and backend are live. On September 17 this lead directly
observed `https://atlasgrading.com` HTTP200, `/admin/manual` HTTP404, and
`https://private.atlasgrading.com/health` HTTP200 reporting old release
**89c55d916130d914f6a989197538c8bbd31c9594**. Old health is not evidence of new
manual-service readiness. Do not send Mark to the old system as rebuild acceptance.
The direct probes are retained in
`docs/atlas/audits/2026-09-17/fresh-lead-status.json` (09:59 UTC).

## Exact source and ownership

- Application checkpoint: **a2a116476592a629214d30d0240152f81c606829**.
- Preceding Astra/memory implementation: **f16bbb7e49ebf46c09e32d30a9a441a947e75df3**.
- Source branch: `codex/atlas-connected-manual-release-20260912`.
- Old lead checkout: `/Users/markthomas/.codex/worktrees/2c75/ten-kings-mystery-packs-clean`.
- Shared Git repository: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`.
- This handoff and session-log entry are a subsequent documentation-only commit,
  supplied in the new task prompt. Use a fresh managed worktree starting at that
  commit/branch, then make your own `codex/` branch before changes. Do not reset,
  move or clean another task's checkout.

Read applicable AGENTS.md and its required context/runbooks, including the full
owner-approved blueprint. Then prioritize this handoff, the current rebuild plan,
the connected release runbook and the two implementation audits below. Earlier
handoffs are historical; their SAM-first recommendation and planning-only status
are superseded. Avoid loading old task transcripts and unrelated commerce history
unless a concrete unresolved dependency requires it.

## Preserve Mark's decisions

- Scope is **ATLAS Grading**, not packs, commerce, vault, buyback or shipping.
- Preserve untouched originals and full-resolution SDR working derivatives;
  don't import Inventory's convenience-photo downsizing as grading policy.
- Front left/Back right; manual tools work independently of the autonomous agent.
- Initial grading scope: standard-size sports and Pokémon, 63.5 × 88.9 mm.
  Borderless/full-bleed centering remains a product/accuracy decision.
- Preserve existing deterministic geometry, measurement, scoring, four subgrades,
  70/30 Front/Back weighting and rounding. Model claims are advisory, not measured
  areas, grades or human approvals.
- **Astra with reviewed defect memory first. SAM 3 is deferred.** Introduce a
  segmentation helper only if measured real-card gaps justify it.
- The deliberate **Confirm findings** action publishes reviewed lessons with the
  original authorized REVIEWER's provenance. Final certified report approval is
  separate. This is retrieval of proprietary examples, not online weight training.
- After acknowledged publication, the next relevant new request must receive
  the current lessons. Prove that separately from improved detection on a distinct
  held-out physical card; same-card/identical-photo reuse is excluded.
- No arbitrary one-card lifetime allowance. Failed/uncertain work must not block
  unrelated cards or independent manual continuation. No automatic paid retry of
  uncertain dispatched work.
- Reuse the reviewed identity/catalog/research interfaces; keep physical-copy
  defects, company inventory and financial records separate. Shared catalog review
  does not approve a grading report or a defect lesson.

## Release blockers and next work, in order

### 1. Resolve storage integrity without repeating the sealed canary

The exact two-header CORS change was authorized and applied; PUT/GET/HEAD
preflights passed. The separately authorized **65-byte canary ran once**. Spaces
accepted the intentionally wrong checksum with HTTP200. Result:
`FAILED_SAFE / CHECKSUM_REFUSAL_NOT_PROVEN`; one PUT, 12 HTTP requests, one DELETE;
cleanup verified HEAD/GET404. Collision/private-read checks later in the plan were
not reached. This is a concrete failed qualification, not a Docker sign-in issue.

**Never delete its execution intent or rerun the sealed canary.** Read the actual
adapter and retained request evidence, determine and implement/qualify the correct
integrity, immutable-write and private-read design. Do not weaken checks or call
this test a pass. Prepare any new live qualification as a distinct bounded action;
the old authorization is not an unused canary permission.

Evidence: `release-readiness/storage/canary-native-20260912/result.json`,
`requests.ndjson` and `execution.intent.json` under the external root below.
Storage bucket is `atlas-grading-private-20260910`; actual upload origin is
`https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com`.

### 2. Restore a usable build path and qualify current source

September 17 probe: Docker context `desktop-linux`; no socket at
`/Users/markthomas/.docker/run/docker.sock`; Docker server connection fails.
Local free disk approximately **2.29 GiB**. Signing into Docker did not restore its
engine. Previous Resume/preserving restart attempts did not establish recovery.
Do not repeat them indefinitely, reset/prune Docker, delete evidence, or remove
another task's dependencies. Assess safe local recovery and existing qualified
build/host alternatives. Existing native amd64 host inventory is available;
refresh it rather than infer that local Docker is the only possible build path.

The older manual-only Linux image has real qualification but lacks Astra/memory,
recognition V2 and later release changes. It cannot qualify the new release.
Current source packaging includes 554 verified files; manifest
`de90e0cf4ec7ab54acf129cfddcac53e9e3ab56ceb67e3e6702b624c3acf95e7`.
This is a source bundle, not a new built image. Build and check the exact current
Linux and dedicated staff artifacts, native workers, web boundary and deployment
transport. Run meaningful changed-source and required release checks.

### 3. Assemble and execute the coordinated ATLAS release

Use `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md`. Dedicated Vercel staff app
stays at `/admin`; native CPU/photo work stays in its private Linux service.
Existing ingress does not admit new manual routes and its old16KiB limit cannot
serve all manual requests. The prepared manual handler/body/long-response design
and signed ordinary-staff transport need exact hosted qualification.

Five additive **staff-ledger** migrations are pending:

1. `20260912190000_manual_workspace`
2. `20260912190100_manual_native_intake`
3. `20260912190200_manual_connected`
4. `20260912200000_defect_memory`
5. `20260912200100_defect_analysis`

Files live in `frontend/atlas-app/prisma/migrations/<name>/migration.sql`; all
five match their corresponding package `sql/proposal.sql` bytes. Apply through
the reviewed staff migration path, not raw proposals or public migrate-to-match.
Separate restricted manual grants and matched web/private configuration are
required. Runtime startup applies no SQL. Preserve existing staff roles.

Public DB has evolved separately: retained September16/17 postflight has **97
successful,13 rolled-back,zero unfinished** public migrations, including catalog
`20260916233000_set_catalog_evidence`. Preserve both this and the Inventory research
migration absent from the ATLAS branch. Prepared-evidence migration
`20260908010000_speedster_prepared_evidence_authority` is already applied; checksum
`2295497829bef571b4687f11ed493781e0a22e4151b7ae74a247a0f9793f891f` matches.
Compare successful non-rolled-back rows; don't mistake historical failed rows for
checksum drift. Refresh actual DB state before release; old fixture counts are
not today's live ledger.

Last direct staff-authority snapshot (September12) had one active reviewer and
zero current certified reviewers. Verify current genuine authority; do not seed
fixture certification to pass live report approval.

Carry forward existing authorization for local implementation, read-only checks
and qualified reversible work. Prepare consequential release actions concretely
and check existing authorization before any necessary final approval. Don't ask
Mark to approve vague plans or reconfirm work already authorized. Record planned
and observed deploy/restart/migration actions in SESSION_LOG. The handoff itself
does not execute a production release or authorize arbitrary paid experiments.

### 4. Give Mark one verified route and a short live checklist

Target route: `https://atlasgrading.com/admin/manual`, only after ordinary staff
access and actual backend/storage readiness are verified. The new service has no
generic `/health`; use artifact identity plus the signed authenticated intake
read and real workflow checks.

Start one fresh bordered sports card and one Pokémon card:

1. Native Front/Back upload on iPhone; inspect original/working detail, color,
   orientation, corners and fine wear on Mac.
2. Check automatic identity, correct fields/geometry, trace defects, save/reload,
   confirm both inspections and findings, review deterministic report, then make
   the separate eligible-human approval.
3. Replace only Front; verify Back work survives and previous approval remains
   historical rather than approving the new draft.
4. Run Astra, review misses/false positives/types/outlines and corrections; publish
   lessons and test a different relevant physical card. Lead retains exact memory
   retrieval/model usage evidence and measures quality, effort, latency and cost.

Lead/agents own infrastructure, multi-card, interrupted upload, expired session,
lost response, late result, restart and no-duplicate-charge testing. Mark judges
physical optical quality and usable grading behavior. Record PASS/FAIL/BLOCKED/
NOT RUN truthfully. Local fixtures do not supply human acceptance.

## Fresh specialists and lead responsibility

Use three specialists initially if the runtime permits only four active agents
including the lead; use waves for up to five distinct assignments. Explicitly set
`model:gpt-6-astra`, `reasoning_effort:xhigh` with fresh bounded prompts. Do not
create additional sidebar lead tasks for these subtasks or bypass concurrency.

| Specialist | First bounded deliverable |
| --- | --- |
| Storage/integrity | Diagnose the failed immutable-storage qualification, map exact adapter/provider semantics and deliver the narrow tested correction and new qualification plan; preserve sealed canary |
| Build/runtime | Establish viable exact-source build path, disk/runtime assessment and current Linux/staff packaging checks; coordinate shared host/cache use |
| Release/auth/DB | Refresh read-only schema/role/route facts and assemble the exact five-migration/grant/config/ingress release and rollback checklist |
| Live grading/Astra acceptance | In the next wave, prepare executable real-card/manual/Astra/memory acceptance with distinct specimens and clear owner steps |
| Independent release reviewer | In the next wave, audit integration, recovery, least privilege, source/image identity and evidence-to-claim limits before release |

Lead owns integration, code boundaries, release decisions and concise owner
updates. Make useful progress alongside specialists. Ask each for bounded results;
don't let them endlessly exchange Inventory status or turn this into another
planning-only exercise. Begin with an understandable status and next milestone.

## Remaining work after the first live grading milestone

- Tune Astra detection/tracing and lesson selection against human-reviewed,
  held-out cards. No accuracy percentage or universal speed claim exists yet.
- Shared catalog/variation/sold-comps ATLAS adapters and reciprocal real-card reuse.
  These must not delay the initial Astra/manual grading experiment.
- Full autonomous Astra workflow remains later. The owner's prerequisite to
  establish the previous operator timeout's initiating cause remains unresolved;
  this does **not** block the scoped human-requested defect experiment.
- Public approved-report/label integration and qualified Mac NFC printing,
  readback/permanent-lock/hosted completion and physical assembly. Existing
  primitives/packages are not proof of the complete Mac finishing workflow.
- Borderless centering policy and any category/size expansion beyond initial scope.

## Read these targeted evidence records

Repository:

- `docs/atlas/plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md` — owner direction and full scope.
- `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md` — release composition; read
  historical counts alongside the newer facts in this handoff.
- `docs/atlas/audits/2026-09-12/astra-defect-memory-implementation.md` —163 focused
  tests,16 DB groups,2,937-column/13-table privilege checks,8 actual connected CPU
  groups and independent review; synthetic provider responses, no live accuracy.
- `docs/atlas/audits/2026-09-16/recognition-v2-adoption.md` —79 checks, exact incoming
  version/source, request/receipt lineage, late-response regressions and limits.
- `docs/atlas/audits/2026-09-12/connected-manual-workflow.md` and
  `manual-owner-acceptance.md` — earlier manual/browser proof and owner checklist;
  route/approval acceptance never occurred. Later memory behavior supersedes old
  detector/learning-future wording.
- `docs/atlas/audits/2026-09-12/runtime-delivery-readiness.md` and
  `storage-database-readiness.md` — retained host access/read-only scripts and
  release seams. Date-specific snapshots need refresh; don't print credentials.

External evidence root (same Mac, don't copy the large trees):
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/`.

High-value children:

- `release-readiness/astra-defects/` — local/DB/role/CPU receipts and cleanup.
- `release-readiness/recognition-v2-20260916/adoption-receipt.json` — exact saved
  commit,21 changed-file hashes; suite/source-context and cleanup evidence nearby.
- `release-readiness/storage/canary-native-20260912/` — sealed failed canary.
- `release-readiness/runtime/` — read-only host inventory/scripts and old images.
- `release-readiness/shared-catalog-20260916/` — frozen incoming hashes, retained
  postflight and released coordination hold. No ATLAS adapter was adopted.
- `browser/FINAL_UI_REPORT.md` and `browser/ui-final-7/` — earlier manual UI proof.

## Adjacent task: consult only for a concrete shared dependency

Inventory coordinator task ID: **01a0a64a-40a0-7202-8539-fab7da07faa2**.
Canonical checkout: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`.
Its branch/source must not be merged wholesale into ATLAS.

- Reviewed catalog/service/optional V4 frozen handoff:
  `945812ca3a9d0c9e48f3a08d533e34919866d029`; contract at
  `docs/plans/2026-09-16-catalog-service-and-research-v4.md` in that commit.
- We independently reviewed/fixed publication coverage/pin and representative-image
  provenance gaps; neutral scope effect retains exact requests/raw replies and
  offers durable custom acknowledgement. Default Inventory receipt is process-only;
  ATLAS must supply its own durable admission/accounting and original/derivative
  lineage. No Inventory photo-key fabrication.
- Later upstream references, unadopted: proposal/lineage follow-up `a31c6863`,
  history reuse `12e13992`, reader internal paging `80e75b1e`; latest notified
  Inventory source `30243d5776406cbf74870a50e3e4a032af3c9a00`.
- Inventory reports a separately sealed1,200-save/120-warmup bounded pagination
  diagnostic pass (lease delta34.831ms versus50ms gate); four prior failures remain.
  This is not ATLAS throughput, phone acceptance or a general no-slowdown proof.
- Latest upstream catalog checklist request is UNSUBMITTED; no image rights,
  publication or real-card bidirectional acceptance follows from its preparation.
- Shared public catalog migration completed; all schema and benchmark/build quiet
  holds are **released**. No ATLAS workloads or old lead deploys are running.
- Coordinate before shared DB/host changes or deleting any shared cache. Qualified
  CLI/cache paths may belong to other tasks. Current low disk is material.

The new lead owns further ATLAS work and owner communication. Keep this task and
old evidence available; no archival, cleanup or background automation is requested.
