# Connected manual release

Updated September 20 Pacific / September 21 UTC, 2026. The manual release's
database, restricted login, private service, ingress and staff controls are now
activated. Public promotion and readback passed: all four public aliases and the
production target select the new deployment, with the www-to-apex HTTP308 redirect preserved.
The ordinary staff sign-in page renders at `https://atlasgrading.com/admin`;
unauthenticated public/staff/customer routes and all32 observed assets passed.
Owner login and real-card acceptance have not yet passed. The dedicated
Vercel staff app remains behind the public `/admin` gateway; native work runs in
the separate private service. Old operator history and private routes are retained.

Current application source `30dbea77c484e61de56da522d67a841cb9df25ee` produced
image `sha256:50ffd1e6ab8a0967a7dbbb214788a9b134ae20625aac9ba9a85cf5967635b2f4`,
555-file manifest `decf72799a6b479ac29dbd8f0a6cba2a635da3f1728bc3d98dbb6fab905b59b3`.
Native/source/boundary checks,379 package tests,42 actual Next15.5.25 staff/manual
tests, four disposable PostgreSQL validators and all14 required CI jobs pass.
See the [current qualification](../audits/2026-09-17/native-release-qualification.md)
and [concrete execution plan](../audits/2026-09-17/release-execution-plan.md).
Actual application storage qualification passes with complete-byte SHA256 checks
before decode/adoption; provider-native checksum refusal remains unqualified.
Five staff migrations are applied and the ledger has 40 successful entries; the
public ledger is unchanged. The restricted manual role passed actual TLS login
and complete privilege checks. Staff deployment
`dpl_D2d5usjWgiRMxJ3yLhY3XU4NRoNo` at
`atlas-grading-staff-5cnmp4jnf-ten-kings.vercel.app` and public deployment
`dpl_8SLu6tEzN9EXhG1sVbHvcLBVrK5C` at
`atlas-grading-public-mzh92wy4i-ten-kings.vercel.app` are actual READY builds of
source30d. StaffControl revision16 and STAFF SMS revision14 use the new staff
binding; six legacy controls are disabled and unrelated/customer rows are unchanged.

The native service is running on image50ffd with no published ports. Corrected
isolated Caddy validation passed, the exact reviewed ingress was applied while
preserving inode282983, and all existing containers remained unchanged. The first
validator could not execute Caddy's file-capability binary with every capability
dropped; its failed intent remains retained. The separate successful validator
added only NET_BIND_SERVICE in its nonroot/network-none container. Serving
container privileges and the proposed Caddy bytes were unchanged.

Direct private TLS returned HTTP401 for an unsigned request, HTTP404 for an absent
route and HTTP400 for an actual application proxy's signed malformed command
before authentication or business effects.
That proof used no human session. Still required: a fresh ordinary owner sign-in,
authenticated manual access through the apex, the hosted 130-second terminal
response check, and fresh physical-card upload, optical/manual grading and
human-requested Astra acceptance. Report approval additionally needs genuine
reviewer certification; no certification was created by this release. Autonomous
operation and slab finishing follow this milestone; SAM remains deferred unless
real testing establishes a need.

See the [current milestone record](../audits/2026-09-20/live-manual-milestone.md)
for observed receipts and remaining acceptance. The earlier images/counts and
preparation below are historical or reusable instructions, not actions to replay.

## Earlier September 12 manual-only checkpoint

Fresh-lead release preparation is recorded in the
[current readiness review](../audits/2026-09-12/connected-manual-release-readiness.md).
It adds photo/details and workflow recovery corrections, long-response transport
support and tracked publication of the unchanged SQL proposals. The changed
Linux/amd64 image is
`sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc`.
All 505 source files match manifest
`e29d8da5a5a0d949d398918a9b109ad6f583d1ab9102264370b66866c219c1f7`;
the rebuilt staff artifact boundary and all 265 Linux tests pass. The earlier
497-file image, 486 local tests and eleven browser groups remain baseline
evidence; they are not fresh hosted or owner acceptance of this delta.
The September12 live metadata was96 successful public/35 staff migrations, no manual
schemas/role, and zero currently certified reviewers. Never infer activation
from local fixture counts.

## Current Astra-first build status

The earlier image/hash/counts above describe the manual-only candidate. The
September17 image at the top includes reviewed memory, Astra and recognitionV2.
Its new source closure is sealed and qualified offline. The packages use the
existing workspace dependency traversal; no new native dependency was needed.

The previously approved one-key storage canary ran once: Spaces accepted an
incorrect checksum with HTTP200. It stopped with FAILED_SAFE /
CHECKSUM_REFUSAL_NOT_PROVEN, deleted only its65-byte object, and verified HEAD and
GET404. Evidence is in the ATLAS handoff `release-readiness/storage/canary-native-20260912`.
The sealed execution intent exists; never rerun it. Conditional collision/privacy
checks later in the plan were not reached. Resolve provider upload-integrity and
immutable-write behavior before live intake; do not relabel this result a pass.
The build now uses a qualified isolated native Linux path; local Docker Desktop
recovery is no longer a prerequisite. The distinct September17 qualification also
failed safely and remains sealed. The September20 application-level qualification
passed under Mark's live-milestone direction: full SHA256 verification rejects
altered bytes before decode/adoption, actual artifact reads verify content and
lineage, conditional writes return412 with unchanged bytes, and cleanup is
confirmed. Native checksum refusal remains unqualified. Preserve all earlier
failures; see the [current result](../audits/2026-09-20/live-manual-milestone.md).

September 16 recognition adoption adds the reviewed shared identifier V2 for new
attempts while preserving saved V1 inputs/results. The immutable input envelope
uses the existing connected schema; it adds no migration or dependency upgrade.
The September17 artifacts include the new V2 runtime files and updated manual page.
See [recognition adoption and its acceptance limits](../audits/2026-09-16/recognition-v2-adoption.md).
That local recognition update alone did not qualify or activate a hosted release;
the subsequent deployment state is recorded above.

## Prepare and bind the candidate

1. Pin the reviewed Git revision and use a clean dependency closure. Reuse the
   retained native/dependency image for a reviewed small source overlay when
   those inputs are unchanged; record every changed file, rebuild affected web
   output and verify the entire resulting source closure. Do not repeat native
   compilation or duplicate the evidence tree unnecessarily. For a full build run
   `node frontend/atlas-app/scripts/package-manual-container.mjs OUTPUT VENDOR`
   with a fresh directory outside the checkout. VENDOR holds the official
   libheif1.23.2 and libde2651.1.1 archives. The Dockerfile verifies their SHA-256
   and pins the Node20 image digest. Build that context for Linux/amd64, retaining
   the source manifest, full build output and resulting image digest.
2. Run the photo/core/storage/workspace/CPU/service tests in the candidate with
   read-only source, no network and writable bounded `/tmp`. Pin Python NumPy
   1.26.4 and OpenCV4.10.0.84 as the Dockerfile does. Qualify the actual target
   host separately; local Docker/amd64 emulation is not a target-host readback.
3. Build the dedicated staff artifact and run its boundary check. It must retain
   `/admin`, generated staff Prisma runtime and ordinary auth, with no browser
   secrets or native CPU/old orchestration imports in the new web path. Run all
   repository-required checks on the exact PR head before any merge/release.
4. Inventory actual DB migrations and role privileges read-only. The September17
   disposable proof used95 public/40 staff migrations with exact no-op replays;
   the pre-release live inventory had97 successful public/35 staff. The current
   staff ledger has40 successful migrations after the five-file release. Two installed public
   Inventory/catalog migrations are outside this branch; preserve them and do not
   run public migrations as part of this five-file staff-only schema addition.

## Database and service configuration

The candidate adds `atlas_manual`, `atlas_manual_intake` and
`atlas_manual_connected`, reviewed memory in `atlas_manual`, and
`atlas_defect_analysis`. No code applies these schemas at startup. Their
reviewed immutable proposal bytes are retained at:

- `packages/atlas-manual-service/sql/proposal.sql`
- `packages/atlas-manual-intake/sql/proposal.sql`
- `packages/atlas-connected-manual/sql/proposal.sql`
- `packages/atlas-defect-memory/sql/proposal.sql`
- `packages/atlas-defect-analysis/sql/proposal.sql`

Apply them through the existing **staff Prisma migration ledger**, in this order:

- `frontend/atlas-app/prisma/migrations/20260912190000_manual_workspace/migration.sql`
- `frontend/atlas-app/prisma/migrations/20260912190100_manual_native_intake/migration.sql`
- `frontend/atlas-app/prisma/migrations/20260912190200_manual_connected/migration.sql`
- `frontend/atlas-app/prisma/migrations/20260912200000_defect_memory/migration.sql`
- `frontend/atlas-app/prisma/migrations/20260912200100_defect_analysis/migration.sql`

Each migration must match its proposal byte-for-byte. The proposals themselves
are not idempotent and must not be run manually before or after the tracked
chain. This release's five migrations are already applied and the second deploy
was a verified no-op; preserve those receipts. For a future separately authorized
target installation, use the reviewed migration
credential targeting the same database with `schema=atlas_staff`, inspect status,
then run the staff app's `prisma migrate deploy --schema prisma/schema.prisma`.
Verify all five names/checksums, no unfinished rows and a second deploy that
applies nothing. Keep migration credentials out of both serving environments.
If a target already contains untracked manual objects, stop and reconcile their
exact provenance; do not drop them or blindly baseline a ledger entry.

Create one separate least-privilege login and grant only the SQL generated by
`manualGrantSQL`, `intakeGrantSQL`, `connectedGrantSQL`, `defectMemoryGrantSQL`,
`analysisGrantSQL`, and `analysisReceiptGrantSQL` for that exact role.
Keep the existing staff role unchanged. Verify complete role ownership,
inheritance and privileges, append-only history, a second no-op application,
ordinary authenticated access and cross-card denial before enabling intake.
The new manual role must not own schemas/tables, delete history, change ACLs or
train reviewers. Do not seed a human approval or certification to pass acceptance.

Private CPU configuration:

| Binding | Required value/meaning |
| --- | --- |
| `NODE_ENV` / `ATLAS_MANUAL_RUNTIME` | `production` / `private-cpu` |
| `ATLAS_MANUAL_ENABLED` / `ATLAS_STAFF_RUNTIME` | `true` / `postgres` |
| `ATLAS_STAFF_ORIGIN` / `ATLAS_STAFF_BASE_PATH` | `https://atlasgrading.com` / `/admin` |
| `ATLAS_MANUAL_WEB_DEPLOYMENT` | Exact admitted staff deployment hostname ending `.vercel.app` |
| `ATLAS_MANUAL_WEB_RELEASE_SHA` | Exact admitted40-character staff release SHA |
| `ATLAS_DATABASE_URL` | Existing restricted staff DB connection |
| `ATLAS_MANUAL_DATABASE_URL` | Separate credentialed manual role, same DB host/port/name, `schema=atlas_manual&sslmode=require` |
| Existing staff auth settings | Same session/phone/router keys, admitted phone roster and Twilio account/service bindings as the actual staff deployment; private service exposes no SMS endpoint |
| `ATLAS_MANUAL_SERVICE_KEY` | Dedicated canonical base64-encoded32-byte secret, distinct from all three staff keys |
| `ATLAS_MANUAL_STORAGE_ENDPOINT` | Exact private S3/Spaces HTTPS endpoint |
| `ATLAS_MANUAL_UPLOAD_ORIGIN` | Exact HTTPS origin produced by signed PUT and GET grants |
| `ATLAS_MANUAL_STORAGE_BUCKET`, `REGION`, `PREFIX` | Actual dedicated private bucket/region and scoped key prefix; use the full `ATLAS_MANUAL_STORAGE_` prefix for each variable |
| `ATLAS_MANUAL_STORAGE_ACCESS_KEY`, `SECRET_KEY` | Scoped object credentials; the full variable names both begin `ATLAS_MANUAL_STORAGE_` |
| `ATLAS_MANUAL_PYTHON` | `/opt/atlas-python/bin/python` in the built image |
| `ATLAS_MANUAL_DEFECT_MEMORY_ENABLED` | `true` after memory migration/grants: publish from the authenticated original REVIEWER confirmer with card edit authority |
| `ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED` | `true` additionally requires memory, analysis migration/grants and the server-only OpenAI key; exact gpt-6-astra/xhigh, human-requested proposals |
| `ATLAS_MANUAL_IDENTIFICATION_ENABLED` | Explicit `true` only for approved actual shared identification; otherwise manual details remain usable |
| `ATLAS_MANUAL_OPENAI_KEY`, `ATLAS_MANUAL_GOOGLE_VISION_KEY` | Server-only credentials required when identification is activated |
| `PORT` | Private HTTP listen port; default4319, reachable only via admitted TLS ingress |

Bound the new private process's Prisma pools explicitly: proposed initial values
are `connection_limit=1` for its staff-auth connection and `connection_limit=2`
for its manual role, with reviewed pool timeouts. Recheck actual client-backend
counts and role/database limits before startup; total `pg_stat_activity` rows
include background processes and are not all client connections. These are
finite resource settings, not product card allowances.

For the inspected existing NYC3 bucket, this candidate's S3 client signs the
virtual-host origin
`https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com`. Bind that
actual origin on both private and web; do not copy I's path-style origin
`https://nyc3.digitaloceanspaces.com`. Verify the actual signed PUT/GET origin
again for the selected bucket/configuration.

Do not set `VERCEL`, `VERCEL_ENV`, lambda or local-fixture flags on the private
service. Its auth config mirrors the real web binding explicitly. The process
runs as the image's non-root node user. Allow bounded writable `/tmp` for native
workers, retain at least215seconds for graceful request draining, and keep the
private container isolated from unrelated services. The default nonce store is
for one process. A shared atomic nonce store is required before adding replicas.

On Vercel set `ATLAS_MANUAL_ENABLED=true`, the same `ATLAS_MANUAL_SERVICE_KEY`,
the exact `ATLAS_MANUAL_UPLOAD_ORIGIN`, and `ATLAS_MANUAL_SERVICE_ORIGIN` pointing
to the reviewed private HTTPS subdomain of `atlasgrading.com`. Vercel retains its
existing environment/auth/deployment bindings. Storage/model/manual-role secrets
belong on the private CPU host, not the web app. Leave the feature disabled until
the private service, DB, storage and matched auth binding are independently ready.
A future staff release must coordinate its changed release/deployment auth binding
with the private service; mismatches fail closed.

## Provider and activation evidence

Verify private bucket access, create-only PUT, checksum/byte-size headers, exact
readback, versioned or unversioned behavior, and signed-URL origins on the actual
provider. CORS must allow the exact staff origin for PUT, GET and HEAD, with
successful OPTIONS preflights,
with Content-Type, If-None-Match, x-amz-checksum-sha256,
x-amz-meta-atlas-kind and x-amz-meta-atlas-binding-sha256. Confirm full-size GET
returns the actual content type and correct bytes; public unauthenticated reads
must fail. Provider-native checksum refusal is not an alternative to the actual
adapter's complete-byte integrity check: the approved fallback permits bounded
SHA256 verification when native checksum is absent. Prove rejection before
decode/adoption, including an altered-byte object, and keep create-only protection.
The retained local SDK fixture alone does not establish Spaces semantics.

The separately approved September12 additive CORS change installed the two
previously missing PUT headers, `x-amz-meta-atlas-kind` and
`x-amz-meta-atlas-binding-sha256`; preflights passed. Preserve that change and
its before/after evidence. The new qualification checks actual browser CORS
without changing configuration. Do not infer bucket policy or ACL from a scoped
credential's403 configuration-read response.

A live storage canary requires the separate authorization specified in
`docs/runbooks/DEPLOY_RUNBOOK.md`; prepare its exact unique harmless object and
cleanup/readback steps before requesting that approval. Do not repurpose a card
object. Append planned and observed migration/deploy/restart actions to
`docs/handoffs/SESSION_LOG.md` with exact identities and rollback evidence.

Before routing staff traffic, verify private TLS identity, unsigned/replayed/
foreign-origin denials and ordinary current staff access, plus revocation and
CSRF refusal. Exercise a fresh native upload, exact completion recovery, both
image grants, real CPU work and the matched shared identification adapter. Record
actual provider requests/usage and unknown outcomes; do not redispatch uncertain
paid work. Rollback disables new web intake and restores the prior exact route
and matching config. Retain originals, manual history and approvals; rollback
must not drop the new schemas or reset old cards.

Use the existing `private.atlasgrading.com` host only with the reviewed separate
manual cards-path handler and 2 MiB body limit. Its current I handler accepts
only old paths and caps them at 16 KiB; preserve that old limit and routing.
Native manual readiness is an exact image/source readback plus a signed,
ordinary-authenticated intake-list GET, not the old operator's `/health`.
See the [actual runtime plan](../audits/2026-09-12/runtime-delivery-readiness.md)
for isolation, single-process nonce retention, request draining and rollback.

Verify streamed long POST replies through the actual Vercel rewrite. A whitespace
keepalive has no completion meaning; the terminal envelope carries the real
status/body, and all matched browser readers must decode it before treating a
save as successful. A function duration setting alone does not prove CDN behavior.
The new staff deployment/SHA also changes ordinary staff configuration hashes
and release controls. Rebind them together and explicitly fence old operator
consumers; changing only the new manual flags cannot preserve old auth bindings.

## Owner acceptance

Use one fresh standard sports card and one fresh Pokémon card. On the intended
phone/browser, upload untouched Front and Back, compare the physical card with
full-resolution edge/print/corner views, and confirm orientation and useful
visible detail. Review/correct identity, adjust one outline, save and reload,
inspect both sides, add/correct a finding, and use the single Confirm findings
button. Review the computed report and perform the separate human approval.
Replace only Front and check unchanged Back work and prior approval history.
Record quality concerns before expanding the cohort. These human observations
are not supplied by fixture tests or cross-platform pixel equality.

The [short owner checklist](../audits/2026-09-12/manual-owner-acceptance.md)
records the actual controls and separates route, optical and report-approval
results. Zero currently certified reviewers is a real approval prerequisite;
obtain genuine reviewer authority through the existing process rather than
creating fixture certification to pass this check.
