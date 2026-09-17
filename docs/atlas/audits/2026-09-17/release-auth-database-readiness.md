# Rebuild 3 release, database and human-authority readiness

Observed September 17, 2026, 10:10–10:12 UTC from handoff `567bafac` and
application checkpoint `a2a116476592a629214d30d0240152f81c606829`. This is a bounded
read-only release review, not activation. Root owns subsequent source sealing,
SESSION_LOG, authorization, release and acceptance. No database mutation,
credential provision, storage operation, model request, deploy or restart ran in
this review. Concurrent build/storage work is not qualified by this report.

## Fresh facts

Evidence root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/release-auth-database-20260917/`.

- [Database snapshot](/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/release-auth-database-20260917/database-inventory.json): 10:10:39 UTC, PostgreSQL17.11, `defaultdb`, TLS true and transaction read-only on.
- [Migration hashes and HTTP probes](/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/release-auth-database-20260917/schema-and-routes.json): 10:11:50 UTC.
- Reproducible DB-only reader: [manual-release-database-inventory.mjs](../../../../scripts/atlas/manual-release-database-inventory.mjs). It uses fixed verified SSH/DB targets, default read-only transactions, 8-second statements, 1-second lock timeout and rollback; credentials remain in process memory. It returns aggregate human-authority counts, never sessions, phone hashes or secret values. Supply a fresh absolute output directory; evidence writes use exclusive creation.

| Item | Current observation | Release consequence |
| --- | --- | --- |
| Public ledger | 110 rows: **97 applied**,13 rolled back,0 unfinished | Preserve both separately added Inventory migrations; do not deploy the public chain from this branch. |
| Staff ledger | **35 applied**,0 rolled back,0 unfinished; all applied checksums match branch | Exactly five new staff migrations remain pending; expected postflight40. |
| Public branch differences | `20260911180000_staff_inventory_research_v2`, `20260916233000_set_catalog_evidence` absent from this branch | These are known source omissions, not live checksum corruption. All other applied public migrations match. |
| New objects | No objects in `atlas_manual`, `atlas_manual_intake`, `atlas_manual_connected`, `atlas_defect_analysis`; no manual role | Migration and role provisioning remain required. |
| Existing ATLAS roles | Five logins; NOINHERIT, no memberships/elevated flags; each connection limit6 | Keep their definitions and grants unchanged. |
| Human certification | One active REVIEWER; certification is NULL; zero current or expired certified reviewers | **Separate final report approval prerequisite**; not a manual draft or reviewed-memory prerequisite. |
| Human operations | Zero unrevoked/unexpired operations grants | Existing roster operation cannot currently be invoked with legitimate operations authority. |
| StaffControl | Enabled, revision15, production, origin `https://atlasgrading.com`; I SHA `89c55d916130d914f6a989197538c8bbd31c9594`; deployment `atlas-grading-staff-fhhgiscxz-ten-kings.vercel.app` | New deployment/config requires coordinated binding, not just manual feature flags. |
| Connections | 13 client backends, including diagnostic; max25,3 superuser-reserved,0 additional reserved | Snapshot only. Recheck headroom immediately before starting bounded pools. Background processes are not client backends. |
| Public routes | Homepage200; `/admin/manual`404 | New workspace is not live. |
| Private routes | Old `/health`200 reports I; manual intake-list404 | Old health does not prove the new manual service. |

The saved StaffControl config hash is
`3cd62f0a9e82a6e27e3596888716d2e0c636ef3d26fc4be9433397bfc933df17`.
No actual current staff browser session was manufactured or tested here.

## Authorization and remaining decisions

Existing owner direction authorizes the local implementation, untouched HDR
original/full-resolution SDR policy, manual workflow, human-requested Astra
defect experiment, and deliberate Confirm findings publication under current
REVIEWER/card edit authority. It does not require another general build approval.
The old autonomous operator initiating-cause prerequisite remains separate from
this bounded experiment. No Inventory merge is needed.

The CORS change was already authorized/applied. The separately authorized
65-byte canary executed once and failed safely; its permission is consumed, not
an unused authorization for another test. Preserve its execution intent. A new
live storage qualification needs its own concrete bounded action and applicable
owner approval. This report makes no new provider/storage claim.

This assignment was expressly read-only. The existing connected release runbook
still describes a separately authorized production migration and concrete
matched release. Before execution the lead should resolve existing owner
authority against the exact final artifact, five-migration/grant action,
configuration/control changes, ingress reload and intended model activation.
Do all preparation first; do not ask for vague or redundant approval. Record
planned and observed actions in SESSION_LOG. No broad approval to seed
certification, resume canceled old cards or execute arbitrary paid experiments
is established here.

## Exact staff migration procedure

These five `frontend/atlas-app/prisma/migrations/<name>/migration.sql` files match
their package `sql/proposal.sql` bytes, verified in the saved receipt:

| Migration | Proposal package | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `20260912190000_manual_workspace` | `atlas-manual-service` | 5230 | `d3109c9196b80d8a847f82869d81a128e363a1137bf6ff22948169115d55683a` |
| `20260912190100_manual_native_intake` | `atlas-manual-intake` | 5511 | `ddb716395aa40301c6419462e27b666d0464dcb9d84e144d7cd260f43ad72273` |
| `20260912190200_manual_connected` | `atlas-connected-manual` | 4774 | `932b73c0275e7e4d48a6a80cf48bb386203372df8e9d16d70d28c736ed4b3835` |
| `20260912200000_defect_memory` | `atlas-defect-memory` | 5045 | `82058faef3e78516edf126951476cc729d6b78a8371fbbc16779804f2e4bd919` |
| `20260912200100_defect_analysis` | `atlas-defect-analysis` | 7636 | `982cdec503329094647974e417a3495a6d080bcada86e7b85c1f7663af8e40bb` |

1. Seal the final source/checks, verify branch/HEAD/remote parity, coordinate the
   shared database, capture current recovery-point evidence and repeat the
   read-only inventory. Reject unexpected pending migration names, unfinished
   ledger rows, changed applied hashes or untracked manual objects. Preserve the
   complete public ledger. Do not drop or baseline unexpected objects.
2. Privately supply the reviewed migration credential as `ATLAS_DATABASE_URL`
   targeting the exact existing host/25060/defaultdb, **schema=atlas_staff** and
   TLS. Do not install that credential into either serving environment. Run the
   pinned Prisma5.22 CLI from the qualified release environment, with a complete
   reviewed staff migrations directory. Preparation-only command sequence:

   ```sh
   cd frontend/atlas-app
   pnpm exec prisma migrate status --schema prisma/schema.prisma
   pnpm exec prisma migrate deploy --schema prisma/schema.prisma
   pnpm exec prisma migrate status --schema prisma/schema.prisma
   pnpm exec prisma migrate deploy --schema prisma/schema.prisma
   ```

3. Require the first deploy to apply only the five ordered names above; require
   the second to apply nothing. Read back40 successful staff rows, exact five
   checksums, zero unfinished entries, unchanged97 successful/13 rolled-back
   public rows and unchanged existing hashes. Check all new tables, constraints,
   append-only guards and definer ownership/search paths. Never execute raw
   proposals before/after the tracked chain. Recognition V2 adds no migration.
4. A partial/uncertain outcome calls for readback and diagnosis, never blindly
   rerunning proposal SQL, reset, rollback deletion or `migrate resolve`.

## Least-privilege role and configuration

Use the reviewed proposed role `atlas_manual_connected_20260912` only after
confirming it remains absent. Initially create NOLOGIN, NOINHERIT, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, CONNECTION LIMIT2. Generate
the grants from the final checked-out implementations; do not hand-maintain a
second broad grant set. This **offline** command prints only SQL, no credential:

```sh
node --input-type=module <<'JS'
import { manualGrantSQL } from './packages/atlas-manual-service/src/staff-auth.mjs';
import { intakeGrantSQL } from './packages/atlas-manual-intake/src/repository.mjs';
import { connectedGrantSQL } from './packages/atlas-connected-manual/src/details.mjs';
import { defectMemoryGrantSQL } from './packages/atlas-defect-memory/src/repository.mjs';
import { analysisGrantSQL, analysisReceiptGrantSQL } from './packages/atlas-defect-analysis/src/repository.mjs';
const role = 'atlas_manual_connected_20260912';
console.log([manualGrantSQL,intakeGrantSQL,connectedGrantSQL,defectMemoryGrantSQL,
  analysisGrantSQL,analysisReceiptGrantSQL].map(fn => fn(role)).join('\n'));
JS
```

Run this in the qualified dependency closure; it does not contact a database.
Review/apply the generated SQL with the authorized migration connection. The
footprint is13 manual/memory/analysis tables across four schemas, narrowly
selected update columns, immutable insert/select histories and four executable
functions: `atlas_manual.authenticate(text,text,jsonb,text[])`,
`atlas_manual.defect_memory_design(jsonb,text)`,
`atlas_manual_connected.append_receipt(uuid,text,text,text,text)`, and
`atlas_defect_analysis.append_receipt(uuid,text,text,text)`. Verify all catalog
columns/effective privileges, not only these function names. The connected
generator grants SELECT/INSERT on all currently existing tables in its own
schema, so unexpected objects must be rejected before applying it.

Require no ownership, membership, schema/database CREATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER, sequence rights, ACL changes, staff identity updates or
other application/public-schema access. Replay the grants and require unchanged
ACLs. Only after this passes, install a separately generated credential privately
and enable LOGIN. The manual role has cross-card table access; ordinary server
authentication and transactional card ACLs enforce user isolation. It is not a
browser or user SQL credential. Preserve all five existing ATLAS roles.

Private CPU bindings (actual values must be bound to the final artifact):

| Variable group | Exact requirement |
| --- | --- |
| Runtime | `NODE_ENV=production`, `ATLAS_MANUAL_RUNTIME=private-cpu`, `ATLAS_STAFF_RUNTIME=postgres`, `ATLAS_MANUAL_ENABLED=true` |
| Staff identity | `ATLAS_STAFF_ORIGIN=https://atlasgrading.com`, `ATLAS_STAFF_BASE_PATH=/admin`; `ATLAS_MANUAL_WEB_DEPLOYMENT` exact admitted `.vercel.app` hostname; `ATLAS_MANUAL_WEB_RELEASE_SHA` exact40-character SHA |
| Auth DB | `ATLAS_DATABASE_URL`: existing restricted staff role; proposed `connection_limit=1&pool_timeout=5&connect_timeout=8` |
| Manual DB | `ATLAS_MANUAL_DATABASE_URL`: new restricted role, identical DB host/port/name, `schema=atlas_manual&sslmode=require&connection_limit=2&pool_timeout=5&connect_timeout=8` |
| Staff keys | Same real ordinary staff session/phone/router/roster/Twilio bindings as matched web release; no SMS endpoint on private service |
| Transport | Dedicated canonical base64 32-byte `ATLAS_MANUAL_SERVICE_KEY`, distinct from all three staff keys |
| Storage | `ATLAS_MANUAL_STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com`; bucket `atlas-grading-private-20260910`, region `nyc3`; reviewed `ATLAS_MANUAL_STORAGE_PREFIX`, `ACCESS_KEY`, `SECRET_KEY` full-prefixed variables |
| Browser upload origin | `ATLAS_MANUAL_UPLOAD_ORIGIN=https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com` on both private and web; reverify against final storage design |
| Native | `ATLAS_MANUAL_PYTHON=/opt/atlas-python/bin/python`, `PORT=4319`; non-root image user, writable bounded `/tmp`, read-only root |
| Memory | `ATLAS_MANUAL_DEFECT_MEMORY_ENABLED=true` only after grants/schema readiness; original REVIEWER confirmer/current edit authority |
| Analysis | `ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED=true` only after memory/analysis readiness and concrete model activation; server-only `ATLAS_MANUAL_OPENAI_KEY`; gpt-6-astra/xhigh proposals |
| Identification | Explicit `ATLAS_MANUAL_IDENTIFICATION_ENABLED=true` only with approved provider activation; server-only OpenAI and `ATLAS_MANUAL_GOOGLE_VISION_KEY` |

Never set Vercel/lambda/fixture flags on the private service. Vercel receives only
the manual enabled flag, transport key, upload origin and
`ATLAS_MANUAL_SERVICE_ORIGIN=https://private.atlasgrading.com` plus its existing
staff configuration. Storage/model/manual-DB secrets remain on private CPU.

Rebuild the exact staff artifact and derive/rebind StaffControl and all affected
staff/SMS/workspace/source/grading/image/operator/identification consumers from
the final configuration. Capture old values and use their revision fences. Fence
old operator consumers explicitly; do not resurrect expired pilot authority or
canceled cards to make a binding pass. The old source/config hashes cannot be
copied into the new release. Staff sign-in after the coordinated binding is real
human work; deployment does not manufacture a fresh session.

## Signed ingress, body and long-response gate

Stage the reviewed private image in a separate release directory/container, with
no host-published port and one process. Use a separate internal ingress network
and outbound network, preserve shared Caddy default route and other services.
Bind current source/image readback and signed ordinary-authenticated intake-list
GET; this service has no generic `/health`.

Prepare a full Caddyfile diff against a fresh hash. Add only an exact matcher for
`/api/staff/(manual|manual-intake|manual-connected)/cards` and its allowed
descendants, routed to the new service on4319. Match the transport's route
grammar; do not proxy a general `/api/staff/*`. Give this handler a **2097152-byte**
request limit, no retry,5-second dial timeout and at least210-second response
allowance. Move the old **16384-byte** limit inside the old handler and preserve
its paths, I upstream and250-second timeout; all other private paths remain404.
Validate the complete proposed config with the existing proxy image, then use
only an authorized graceful reload of current Caddy, never shared Compose restart.

Before web activation require these observed results through the real gateway:

1. Current image/source identity, unsigned signature refusal, valid signed
   ordinary-session GET, replay refusal, wrong-origin refusal, revoked/expired
   staff denial and CSRF refusal. Test cross-card denial without inventing human
   authority. Signature alone must never authorize a staff operation.
2. Accepted manual body over16KiB within2MiB; oversized body denied; old path
   retains its original16KiB limit. Photos travel through the storage path,
   not a larger JSON upload exception.
3. Real hosted long POST past the prior120-second idle boundary receives the
  15-second whitespace keepalives and exact terminal envelope. HTTP200/keepalive
   alone is not success. All browser readers must decode terminal status/body;
   truncation/timeout retains the exact command journal and uncertain paid work.
   Private/proxy deadline is210seconds; Vercel duration alone is insufficient.
4. Recheck old I/preparation identities, public/customer routes, mounted staff
   assets, Caddy networks/default route and complete source bindings.

The default nonce store is process-local, with60-second allowed timestamp skew.
Do not overlap same-key replicas. A same-key replacement requires closing new
signing/traffic and allowing the complete120-second possible acceptance interval
to expire; a new key requires a coordinated web/private release.

## Genuine reviewer certification

Certification is needed only for the separate exact `APPROVE_REPORT` action.
Manual edits, inspection, measurements, draft reports and the accepted reviewed
memory publication can proceed under ordinary REVIEWER/card edit authority.
The manual service reauthenticates transactionally and requires current
`certificationUntil` plus card approval authority for final approval. It cannot
write its own reviewer authority.

Existing legitimate path: an owner-authorized human with a current separately
provisioned `StaffOperationsGrant` and fresh ordinary sign-in (no more than five
minutes old) uses `StaffOperations.updateRoster`. The exact operation supplies
`operationId`, reason, owner authorization evidence hash, target identity,
expected accessVersion, role/revoked state and explicit independently chosen
certification/trusted-learning expiries. It records the before/after authority
and increments accessVersion, invalidating stale access. Certification does not
implicitly grant trusted-learning or operations authority.

There is currently no unexpired operations grant and no dedicated operations
login among the observed ATLAS roles. The lead must prepare the existing
operations-role/grant provisioning path, obtain the actual owner certification
decision/evidence and exact expiry, then complete the normal authenticated roster
operation and readback. Do not invent a training event, future expiry, HUMAN
session/grant or direct SQL certificate just to pass acceptance. These missing
inputs must be settled before claiming final-report approval works; they need
not delay a clearly scoped manual draft/learning test.

Subsequent source review qualifies this roster procedure: its actor cannot
certify itself, because changing its own accessVersion invalidates its authority
before the final transaction check. With only one active reviewer, a new grant
for that same person is insufficient. The source also preserves separate offline
owner provisioning authority. The [prepared execution plan](release-execution-plan.md#legitimate-certification-paths-and-minimum-owner-decision)
records both legitimate routes and the required genuine owner decision,
expiry/provenance and independent review. Neither route permits fixture
certification or manufactured training. No certification action has been prepared
for execution or performed.

## Release and rollback checkpoints

Release order is: current-source/native/staff qualification and resolved storage
proof; exact authorized staff migration; complete new-role catalog validation;
matched private config/image startup and signed/authenticated acceptance; scoped
ingress reload; coordinated staff/control activation; actual owner cards and
separate eligible-human report approval. Stop at a failed gate and preserve its
evidence. Fresh bordered standard sports and Pokémon tests must establish optical
detail/color, geometry/trace/save/reload, single Confirm findings, separate report
approval and Front-only replacement preserving Back/history. Distinct-card Astra
lesson retrieval/quality/latency/cost acceptance is separate from deployment.

For rollback, first close new manual work at web/ingress while preserving exact
request readback/reconciliation. Capture in-flight connections and terminal or
unknown operation receipts; fixed delay is not proof of settlement. SIGTERM
closes the server; source calls `closeAllConnections()` at215seconds. Allow at
least240seconds container grace and record actual exit/OOM/kill status. Retain
uncertain dispatched IDs and never redispatch merely because sockets closed.

Restore the captured prior exact web/control binding and only the manual ingress
delta where compatible, recheck Caddy hash/network/default route and old HTTPS
identities, and stop only the new candidate after draining. Old I cannot process
new manual state. Preserve all four new schemas, originals, immutable actions,
approvals, reviewed lessons, request/response/accounting history and new role
provenance. Never drop/reset new data, restart canceled old cards, modify public
Inventory additions or restart shared infrastructure as rollback. Subsequent
manual releases need compatible persisted state and a matching web/private pair.
