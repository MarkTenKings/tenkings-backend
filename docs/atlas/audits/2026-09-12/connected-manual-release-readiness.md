# Connected manual release readiness — fresh lead

September 12, 2026. The connected manual workflow remains a local candidate.
Fresh read-only production inventory and release corrections follow the sealed
handoff; no production migration, deployment, restart, object write or paid
provider request has occurred in this task.

## Source and evidence

The new lead uses
`/Users/markthomas/.codex/worktrees/2c75/ten-kings-mystery-packs-clean`, branch
`codex/atlas-connected-manual-release-20260912`, based on handoff
`aeb8e68dd6ea007d2bc11ccf568f771375a52af2`. All ten handoff seal members and all
497 source files matched on entry. The implementation and qualification commits
remain `fded034d` and `b44dc485`.

The retained image
`sha256:b6eaf704a8241afd470d9da81b4402cbd8f16184ecd6c608c99b5396f6ae48f1`
is present locally. Its 486 local tests, 251 Linux checks, eleven browser groups
and unchanged native-photo evidence remain the **handoff baseline**. Corrections
below require their own changed-source qualification. Do not label that old image
as containing this task's changes.

Small current evidence lives under the original handoff root's
`release-readiness/`; originals and large historical evidence stay in place.
See `lead/handoff-readback.json` for the independently checked source and image.

## What the actual target shows

| Boundary | Fresh observation | Work before activation |
| --- | --- | --- |
| Existing Linux host | Native amd64, four CPUs, about 5.69 GB available RAM and 68.81 GB disk free; shared workloads active | Qualify the exact changed candidate under finite resources; available capacity is not measured throughput |
| Private ingress | Existing I and CPU A2 remain running; private hostname rejects new manual paths and caps requests at 16 KiB | Review a separate manual path handler with a 2 MiB limit, preserving old routes and their existing cap |
| Database | PostgreSQL 17.11; 96 successful public and 35 staff migrations; no manual schemas or manual role | Apply only the three reviewed staff migrations and a separate least-privilege role after release authorization; preserve the live public research migration absent from this branch |
| Object storage | Restored console session confirms the single exact staff-origin rule, four existing allowed headers and 5-second max age; candidate PUT preflight still returns 403 | Apply the reviewed addition of two metadata headers, then qualify conditional writes, checksums, private reads and cleanup through the separately authorized canary |
| Staff web | Current I staff deployment remains READY; Node 20.x and Fluid Compute observed | Build and stage the changed staff artifact, verify actual timeout/proxy behavior and bind its exact deployment/SHA to private auth and release controls |
| Source publication | The team's repository dialog lists one connected legacy project, rooted at `frontend/nextjs-app`; unprotected previews inherit provider credentials | Added only this branch's exact `git.deploymentEnabled: false` exclusion locally; verify provider skip evidence on publication before proceeding to exact-head CI/release |
| Staff approval | One active reviewer, zero currently certified reviewers | Obtain a real reviewer certification/authorization through the existing operator process before final report acceptance; never seed fixture authority |
| Identification | Existing eight-field engine is unchanged; new manual provider activation untested | Verify actual server-only provider configuration and authorized request/usage evidence before enabling automatic identification |

The existing host permits a practical direct image-delivery path without a new
builder, registry dependency or local image archive. No remote image has been
loaded or run. The new service has no `/health`; its readiness must combine exact
container/image/source readback with an ordinary-authenticated, signed manual
intake-list GET. Old I's health cannot prove the new service ready.

## Corrections prepared during this review

1. The actual photo/details component could erase a newer uncertain command
   after a slower reply to an older command. Both the success and refusal races
   failed before the fix. Exact serialized-command comparison now protects the
   journal and displays the remaining pending request; stale rendered recovery
   buttons cannot redispatch a replaced command. Four component tests pass.
2. The three SQL proposals were applied directly once by fixtures. Prior no-op
   evidence covered the existing Prisma chain, not a second execution of those
   raw proposals. Publish their identical bytes as three ordered staff Prisma
   migrations, with the fixtures using that same chain and no-op replay.
3. The manual proxy buffered long replies. Its 210-second deadline and the
   staff/public 240-second limits did not prevent the separate 120-second CDN
   idle timeout. Added authenticated JSON whitespace keepalives and an explicit
   terminal status/body envelope, preserving real refusals and exact recovery.
4. Workflow dispatch could overwrite a different client's uncertain command
   recorded during awaited view/trace work. Both reproduced cases now pass with
   a final journal check immediately before recording and dispatching.
5. Next's new response-module trace includes workspace symlink metadata. The
   boundary admits only the two exact package links whose canonical targets
   match this checkout; actual files remain restricted to the browser-safe
   response module and its package manifest.

The published SQL chain passes on Node 20.20.1 and owned PostgreSQL 17.10:
95 public/38 staff migrations, both second-deploy no-ops, eight connected groups
and 2,899 checked column privileges. Owned database cleanup is verified.
The streaming/readers pass 32 focused Node 20 checks; ten workflow tests cover
both new admission races. Independent review passes the scoped corrections.
The changed Linux Next build passes with 26 browser chunks, 12 server traces and
2,093 checked entries. All **265 tests pass** on Node 20.20.2/Linux amd64 without
failures or skips, including the actual compiled component, streaming/readers,
recovery and real native CPU paths. All 505 image source files match the checkout.

Current local image:
`sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc`
(`atlas-connected-manual:release-readiness-20260912`, 638,275,824 reported bytes).
Manifest SHA-256:
`e29d8da5a5a0d949d398918a9b109ad6f583d1ab9102264370b66866c219c1f7`.
Evidence is `lead/linux-overlay-2/{overlay.json,source-manifest.json,build.log,
build-result.json,source-readback.json,source-readback.log,tests-result.json,tests.log}`.
The overlay copied only 20 changed files (141,213 bytes) onto the original
immutable native/dependency image. No native source, package lock or third-party
dependency changed. The first compile/trace failure is retained in
`lead/linux-overlay-1`; its exact symlink correction passed independent review.
All local qualification containers are removed. All 43 task-created dependency
links were removed after matching their recorded targets; target files remain.

The retained-photo full-resolution equality proof remains bound to unchanged
native code. The eleven browser groups are the earlier baseline, while current
UI recovery and transport checks are the focused tests described above. Actual
Vercel streaming, native target startup and fresh optical acceptance remain open.

## Concrete release order

1. Preserve the completed local source/image, staff boundary, focused tests and
   tracked disposable migration/no-op evidence above. Recheck those exact
   identities before delivery; retain the native-photo proof only for unchanged
   native code.
2. Preserve the verified source-publication correction in
   `frontend/nextjs-app/vercel.json`: only
   `codex/atlas-connected-manual-release-20260912: false` was added, retaining
   all eight prior exclusions. The actual connected project reads this root,
   and current Vercel documentation confirms the exact-branch rule. Recheck
   linked projects before publication and retain the actual provider skip
   result. Existing required exact-head checks remain required; no push, PR,
   main merge or hosted build has occurred in this task.
3. Review the exact CORS/storage canary plan, credentials, prefix, payload and
   cleanup. The canary has separate owner authorization under `DEPLOY_RUNBOOK`.
   A local SDK fixture does not prove Spaces behavior.
4. Under the concrete authorized release, install the three staff migrations and
   separate manual role, checking grants and connection-pool headroom against
   the actual database. Preserve all existing public/staff ledger history.
5. Deliver and qualify the private candidate without staff traffic or paid
   identification; stage the exact compatible Vercel artifact. Configure their
   dedicated manual key, storage origin, staff auth and exact release bindings.
6. Review and apply only the new ingress handler and matched web/control changes.
   Prove unsigned/replay/origin/CSRF/revocation denial, signed ordinary staff
   access, actual full-size image delivery and the long rewritten response.
   Preserve current public/customer/preparation/old operator boundaries.
7. After real provider and reviewer admission, run Mark's fresh sports/Pokémon
   optical and manual-workflow acceptance. One findings confirmation and a
   separate final human report approval remain distinct. No fixture substitutes
   for physical detail, color or that human approval.

Rollback closes new manual work and restores the exact previous compatible
routes/configuration. It retains originals, uncertain provider requests, manual
history, approvals and additive schemas. New manual state is never sent through
the old operator. The complete runtime report explains request draining and the
single-process nonce-store restart boundary.

## Specialist records

- [Runtime delivery and actual host inventory](runtime-delivery-readiness.md)
- [Storage, migration and privilege evidence](storage-database-readiness.md)
- [Web, staff authentication and streaming evidence](web-staff-auth-readiness.md)
- [Fresh sports/Pokémon owner acceptance](manual-owner-acceptance.md)
- [Independent release review](independent-manual-release-review.md)

The approved Vercel `/admin` and private Linux split, native-original/full-size
SDR policy, unchanged shared identification and deterministic grading remain
fixed. Automatic defect assistance, research/learning, public report publication,
physical finishing and the later replacement Astra operator remain separate
milestones; the old operator's initiating-cause prerequisite is still open.
