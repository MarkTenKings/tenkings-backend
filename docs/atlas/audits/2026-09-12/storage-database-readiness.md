# Connected manual storage and database readiness

September 12, 2026. Fresh storage/database specialist review on the connected
manual release branch. Live evidence is read-only; no production schema, role,
object, policy, provider inference or serving configuration was changed.

Evidence directory:
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/`.
The original 497-file handoff evidence is preserved separately. This review adds
three published migration copies and adjusts four local fixtures; the original
candidate image does not include this release-preparation delta.

## Observed live state

| Resource | Actual observation | Consequence |
| --- | --- | --- |
| Managed database | PostgreSQL 17.11, `defaultdb`, port 25060; TLS and transaction read-only verified at 22:02:45 UTC | This is the current target, not the fixture version. |
| Public migrations | 96 applied; 109 ledger rows include 13 historical rolled-back attempts; zero unfinished | The earlier 95 count is historical. |
| Staff migrations | 35 applied, all checksums match this branch; zero unfinished | The new three migrations have not run live. |
| Public source difference | Only applied migration `20260911180000_staff_inventory_research_v2` is absent locally; all other applied public checksums match | Record/preserve the additional live migration; do not migrate or reset public schema to fit this branch. |
| Manual database | None of `atlas_manual`, `atlas_manual_intake`, `atlas_manual_connected` exists; no manual login exists | Role/schema activation remains required. |
| Existing ATLAS roles | Five logins, each NOINHERIT, no memberships, no superuser/create-role/create-database/replication/bypass-RLS; connection limit 6 | Preserve these role definitions and grants. |
| Human reviewer | One active reviewer, zero currently certified reviewers | Real report approval remains blocked until legitimate certification authority exists; never seed training to pass a test. |
| Current private container | `atlas-workspace-private-i-20260911`; no `ATLAS_MANUAL_*` environment keys | Manual configuration is not installed on serving I. |
| Existing grading bucket | `atlas-grading-private-20260910`, NYC3; authenticated HeadBucket 200; GetBucketVersioning 200 with empty status | Qualify the current unversioned provider behavior explicitly. |
| Bucket configuration API | CORS, ACL, policy and PublicAccessBlock reads return 403 with the current object key | The key does not establish these configuration values; no broader key was created. |
| Public access | Anonymous bounded bucket listing returns 403 | This proves listing denial only; existing-object privacy still needs the approved harmless canary. |

Use `database-summary.json` for migration counts. The first
`database-inventory.json.localMigrationParity` projection included rolled-back
attempts when comparing checksums. Its retained raw rows are correct; the summary
and corrected inventory script compare only finished, non-rolled-back rows.
No applied historical migration checksum mismatch was found.

## Concrete storage blockers and binding

The actual candidate S3 client generates virtual-host URLs. An offline SDK
presign with dummy credentials and zero network requests establishes the origin:

`https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com`

Use that exact `ATLAS_MANUAL_UPLOAD_ORIGIN` on both the private service and Vercel
if this existing bucket is selected. Serving I currently declares
`https://nyc3.digitaloceanspaces.com`; copying that old value would fail the new
runtime's origin checks. Keep the storage endpoint itself
`https://nyc3.digitaloceanspaces.com` and region `nyc3`.

Actual OPTIONS preflights were made against a uniquely named, **never-created**
diagnostic key, first with path-style URLs and then the exact virtual-host origin.
Both yield PUT 403 with the complete candidate header set; GET and HEAD return
200 with `Access-Control-Allow-Origin: https://atlasgrading.com`.

The per-header PUT matrix identifies the missing entries precisely:

| Request header | Current PUT preflight |
| --- | --- |
| `content-type` | 200 |
| `if-none-match` | 200 |
| `x-amz-checksum-sha256` | 200 |
| `x-amz-acl` | 200 |
| `x-amz-meta-atlas-kind` | **403** |
| `x-amz-meta-atlas-binding-sha256` | **403** |

The smallest proposed correction is to add those two exact metadata headers to
the existing staff-origin rule, preserving every current rule, origin, method,
exposed header and max-age value. Obtain the complete current rule before making
that change. The API read is denied; the released DigitalOcean browser tab showed
an expired-session modal, so this review could not inspect the full console rule.
It did not reauthenticate, submit a form or change settings.

### Restored console session — September 12 follow-up

After Mark restored the DigitalOcean session, the lead read the existing bucket
Settings page and opened its CORS editor without saving. There is exactly one
visible rule: origin `https://atlasgrading.com`; methods GET, PUT and HEAD;
allowed headers `Content-Type`, `If-None-Match`, `x-amz-acl` and
`x-amz-checksum-sha256`; max age 5 seconds. The reviewed change appends only
`x-amz-meta-atlas-kind` and `x-amz-meta-atlas-binding-sha256` to that rule.
The origin, three methods, four existing headers and max age are preserved.

Six fresh OPTIONS requests at 22:39:22 UTC reproduce the boundary: the existing
four-header PUT passes, the candidate header set and each missing metadata
header return 403, and GET/HEAD pass. No exposed response header is returned for
the matched rule. The console cannot show `ExposeHeader`, as documented in the
[official CORS procedure](https://docs.digitalocean.com/products/spaces/how-to/configure-cors/);
the saved UI fields are not presented as a complete raw XML export. No exposed
header or XML setting is proposed for modification.

The same page shows versioning, CDN and access logs disabled, file listing
restricted, and the existing bucket's named key labeled **Read/Write/Delete**.
Its secret was not revealed. This establishes the visible permission tier;
actual conditional writes, object privacy and exact cleanup still require the
separately authorized canary. No key, setting or object was changed. The editor
was canceled, and the bucket Settings tab is retained for the next step.

Evidence: `console-resumed-20260912/visible-cors-change-plan.json` and
`console-resumed-20260912/cors-preflight-before.json` under the storage evidence
directory. The login blocker is resolved. The exact CORS update and harmless
canary remain prepared, not executed.

Configure GET, PUT and HEAD as allowed methods; OPTIONS is the preflight request
handled by the service, not an additional allowed-method value in the CORS rule.
DigitalOcean documents the valid methods in its [CORS configuration reference](https://docs.digitalocean.com/reference/terraform/reference/resources/spaces_bucket_cors_configuration/).

The adapter is create-only, but that does not prove the credential is create-only
or restricted to one prefix. DigitalOcean's documented object read/write tier
also includes deletion; bucket configuration uses a separate broader tier.
Require actual credential/policy evidence before claiming a narrower provider
capability. Keep the broader configuration credential out of the runtime.
See the [Spaces permission and API reference](https://docs.digitalocean.com/reference/api/spaces/).

## Published additive migrations and qualification

Raw proposals use unconditional CREATE statements and cannot be rerun as SQL.
The original fixture's second-deploy no-op covered the old Prisma chains, while
the three proposals were applied directly once. This review fixes the release
path by copying their **exact bytes** into the existing staff Prisma ledger:

| Staff migration | Proposal source | SHA-256 |
| --- | --- | --- |
| `20260912190000_manual_workspace` | `packages/atlas-manual-service/sql/proposal.sql` | `d3109c9196b80d8a847f82869d81a128e363a1137bf6ff22948169115d55683a` |
| `20260912190100_manual_native_intake` | `packages/atlas-manual-intake/sql/proposal.sql` | `ddb716395aa40301c6419462e27b666d0464dcb9d84e144d7cd260f43ad72273` |
| `20260912190200_manual_connected` | `packages/atlas-connected-manual/sql/proposal.sql` | `932b73c0275e7e4d48a6a80cf48bb386203372df8e9d16d70d28c736ed4b3835` |

Their byte counts are 5,230, 5,511 and 4,774. The proposal files and their
historical INACTIVE comments remain unchanged; the new migration directories
are now the publication authority. Nothing applies migrations at runtime startup.
Do not run the raw proposal files after deploying the migration chain.

Removed direct proposal application from `owned-fixture.mjs`, both intake and
connected `validate-postgres.mjs` files, and `local-browser.mjs`. These fixtures
now receive all manual schemas from the ordinary migration template. Their
existing separate-role grant calls remain.

Final local proof uses Node 20.20.1 and native ARM PostgreSQL 17.10. It applies
95 public plus **38 staff** migrations, then proves both second deploys report
no pending migrations and leave their entire ledgers unchanged. It checks 2,899
columns across all application schemas against the exact manual allowlist,
verifies all nine manual tables, two non-trigger executable functions, schema
usage, absent ownership/CREATE/membership/elevated rights, and unchanged ACLs
after replaying the generated grants. All eight actual connected workflow groups
pass, including ordinary auth, source replacement, separate report approval and
immutable history. SMS, object storage and identification effects are synthetic;
CPU preparation/measurement and PostgreSQL are real local processes.

Evidence: `node20-migration-privileges/privilege-catalog.json`, `ledgers.json`,
`validation.log`, `connected-result.json` and `database-cleanup.json`. The owned
cluster is stopped and its data directory removed. An earlier default Node 25
pass and one pre-start missing-dependency refusal are preserved. Existing local
dependencies were reused through recorded links; no package installation or
mutation of the prior worktree occurred.

## Least-privilege release order

1. Pin the final source and exact three SQL hashes. Read live migration ledgers,
   actual role ownership/default ACLs, current clients and a current provider
   recovery point. Preserve the known extra public migration. Record the planned
   action before the separately authorized production migration.
2. Through the existing staff Prisma migration command and reviewed owner
   connection with `schema=atlas_staff`, apply only these three appended
   migrations. Expect 38 staff and unchanged 96 applied public migrations in the
   observed current target. Read back the new hashes, schemas, tables, constraints,
   triggers, SECURITY DEFINER ownership/search paths and all existing-role ACLs.
   Replaying the same migration deploy must be a ledger no-op. Do not run a public
   deploy to reconcile the different source baseline.
3. Create a new initially NOLOGIN role, proposed exact name
   `atlas_manual_connected_20260912`, with NOINHERIT, NOSUPERUSER, NOCREATEDB,
   NOCREATEROLE, NOREPLICATION, NOBYPASSRLS and CONNECTION LIMIT 2. Apply only the
   current `manualGrantSQL`, `intakeGrantSQL` and `connectedGrantSQL` output for
   that name. The role must own no schemas, tables or definer functions and gain
   no membership, DELETE, TRUNCATE, REFERENCES, trigger-creation or ACL privileges.
   Verify the complete footprint against the tested allowlist before enabling
   its login and privately installing a newly generated credential.
4. Preserve the existing staff credential and role. Bind the manual credential
   to the same host/port/database, `schema=atlas_manual`, `sslmode=require` and
   the bounded pool options below. Install secrets only on the private CPU host;
   Vercel needs the transport key and origins, not object/model/manual-DB keys.
5. Obtain the full current bucket CORS/policy/key scope through normal authorized
   account access. Prepare and review the additive two-header change, verify
   exact-origin preflights, then request the separate exact canary approval.
   Execute no object operation until that approval exists.
6. Qualify the private service, current staff auth/revocation/CSRF and actual
   provider semantics before switching the web feature on. Keep identification
   explicitly disabled until its real provider use is separately authorized.
   Preserve actual certification policy; tests do not certify the live reviewer.
7. Rollback disables the new manual traffic and preserves all new schemas,
   original objects, actions, accounting and approvals. It never drops schemas,
   deletes history, resets old cards or resumes canceled recovery.

The three schemas have no cross-card row-level security policy. Application
transactions reauthenticate the ordinary staff session and enforce card
ownership; direct SQL access by the manual credential spans the manual tables.
Treat it as a private service credential, never a user credential. The tested
definer functions grant only reauthentication and exact-dispatch receipt append.
Late receipts cannot authorize a new request or report approval.

## Connection capacity

At 22:08:11 UTC the read-only snapshot has **11 client backends**, including this
diagnostic, plus one provider walsender and eight background processes. The
database exposes `max_connections=25`, three superuser-reserved slots and zero
additional reserved slots. Counting every `pg_stat_activity` row as an ordinary
client would overstate current use; PostgreSQL distinguishes these backend types
in its [statistics documentation](https://www.postgresql.org/docs/17/monitoring-stats.html).

The current I URLs explicitly cap source/coordinator/operator pools at 3/2/1;
their pool/connect timeouts are 5/8 seconds. The observed client counts were two
source, two coordinator, six doadmin (including this diagnostic), and one
postgres; no staff or operator client appeared in that instant. This is a
snapshot, not peak demand or a basis for stopping another service.

For the initial one-process private manual service, recommend an explicit
`connection_limit=1&pool_timeout=5&connect_timeout=8` on its existing staff-auth
connection and `connection_limit=2&pool_timeout=5&connect_timeout=8` on its separate
manual connection. This budgets at most three new application connections and
retains two short manual transactions for independent card work. Existing Vercel
and I pools remain separate and unchanged. Verify ordinary headroom again before
start, including real provider/internal reservations and concurrent web clients.
Do not use CPU-derived Prisma defaults or multiply this process into replicas
without capacity and shared-nonce-store qualification. These infrastructure pool
bounds are not product card/spend allowances.

## Prepared harmless canary — not executed

The offline-only plan builder is `scripts/atlas/manual-release-storage-canary-plan.mjs`.
It has no network, credential or live execution mode. The concrete artifact is
`canary/plan.json`, with exact harmless payloads alongside it. The selected
diagnostic object key is:

`atlas-connected-manual-v1/release-canaries/5ca59572-bcc3-4fb3-88c2-5bc42c2e466d/probe.bin`

The payload is the following UTF-8 text with one final newline, **65 bytes**:

```text
ATLAS connected manual release canary: no card or customer data.
```

SHA-256: `64f4ff4b4e3f1204c2e35908c0bd9e51ad015b45b92d41d0db4c351ee3ab3c35`.
The second 65-byte local payload changes only the first byte from A to X, for an
explicit overwrite-refusal probe. There is one possible object key, at most
three PUT attempts totaling 195 upload bytes, at most two exact-key cleanup
DELETE attempts, at most 30 HTTP requests, 4 KiB maximum per GET body, ten seconds
per request and a five-minute total deadline. No object has been created.

The plan requires initial 404, checksum refusal, one correct conditional upload,
exact HEAD/streamed GET hash verification, signed browser GET/CORS, anonymous
existing-object denial, collision PUT 412, wrong If-Match GET 412, unchanged-byte
readback, immediate finally cleanup and authenticated HEAD/GET 404. A present
native checksum must match; its absence requires the actual bounded stream hash.
No ETag or user metadata is promoted to byte-integrity authority. Unexpected
versioning stops before the first PUT; any unexpectedly returned version is
preserved for exact-version cleanup rather than leaving a delete marker.

An initial preexisting key is never deletion authority. Unknown PUTs reconcile
only the same key; they do not generate another key or a paid request. Failed or
uncertain cleanup is reported with retained exact identity. No wildcard listing
or deletion is permitted. Approve the exact artifact only after CORS and provider
access are ready, as required by the [Deploy Runbook](../../../runbooks/DEPLOY_RUNBOOK.md#ai-grader-direct-upload-cors-gate).


## Exact-plan executor prepared and tested offline

`scripts/atlas/manual-release-storage-canary.mjs` now provides the bounded operator
executor for the existing sealed plan. Its source SHA-256 is
`fd40101110716a8291fa87cdb9100e50689b219d2422ac51d5322d757c163bac`.
The adjacent focused test file SHA-256 is
`d3f7f1512a4f5971d34697061939c8774d7daeee54dd15471e48546ebdc9dddf`.
Neither file changes serving source, SDK dependencies, the sealed key, plan or
payloads. The original plan remains SHA-256
`008366069923b18feb75140c697ad192b9fd55bba5a8bd1f0b99f1b193efe35b`.

Importing the executor is offline. Its CLI requires exactly the execution flag,
that full approved plan hash and an absolute create-new evidence directory. It
accepts credentials only through explicit `ATLAS_CANARY_ACCESS_KEY_ID` and
`ATLAS_CANARY_SECRET_ACCESS_KEY` environment variables; it never prints a secret,
signed URL, raw provider response or raw exception. The existing bucket key's
console-verified Read/Write/Delete capability permits that same explicitly
supplied credential to perform exact cleanup; no new credential is needed.
The runner requires the qualified SDK versions (client-s3 3.914.0 and presigner
3.982.0), resolved relative to the repository's photo-storage package. It does
not search other worktrees or install dependencies.

The intended CLI shape below is preparation only and has **not** been invoked:

```text
node scripts/atlas/manual-release-storage-canary.mjs --execute-live-canary --approved-plan-sha256=008366069923b18feb75140c697ad192b9fd55bba5a8bd1f0b99f1b193efe35b --evidence-dir=/absolute/create-new-evidence-directory
```

The fixed plan path is the original handoff `storage/canary/plan.json`; a
qualified-image invocation must mount that exact path and the executor, provide
the two explicit runtime environment variables, and give the new evidence
directory writable storage. The runner creates `canary/execution.intent.json`
with create-new semantics before any request, then retains normalized request
intent/outcome events and a final result. An existing intent blocks another run.
An interrupted run requires exact-key reconciliation with its journal; deleting
the lock and rerunning is not an authorized recovery procedure.

The executable reserves ten requests and 90 seconds for cleanup within the
sealed 30-request/five-minute bounds. All fetches prohibit redirects and have
abortable ten-second deadlines. The SDK is used only for presigning with the
candidate's PUT header options, so it performs no hidden HTTP retry. Server GET
uses the observed If-Match; browser GetObject input omits If-Match and ChecksumMode
like candidate `createRead`. The pinned SDK adds its checksum-mode query default
to that browser signed URL. GET bytes are streamed with a 4 KiB cap; anonymous
bodies are canceled immediately. Only the fixed key and sealed payloads are
available to the orchestration.

Cleanup requires initial confirmed absence, a payload actually dispatched by
this run, exact metadata and the bounded observed byte hash. A payload merely
present in the sealed input set does not grant deletion authority. Transport
errors, returned 5xx and any otherwise unproven PUT refusal remain uncertain.
An uncertain PUT followed by 404 is unresolved because a late write could still
arrive. An uncertain collision that still exposes the original payload is also
unresolved, so cleanup does not delete the original and open a race for that
collision. Observing the exact uncertain dispatched payload resolves that write
for immediate cleanup. No uncertain PUT is sent again.

Malformed version IDs and conflicting versions stop deletion and retain an
operator reconciliation requirement. A single valid unexpected version stops
qualification and permits only its exact-version cleanup, followed by both
version-specific and current-key absence checks. Malformed/truncated versioning
XML fails before any PUT. Two failed cleanup attempts, forbidden readback,
exhausted bounds or an unproven outcome cannot produce a pass. Evidence-write
failure before PUT intent prevents that PUT from being dispatched.

At 22:56:54 UTC, the final focused run passed **24/24 tests** using qualified image
`sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc`
(Node 20.20.2), with `--network none`, `--pull never`, a read-only filesystem,
1 CPU, 512 MiB RAM, 128 PIDs and a 32 MiB temporary filesystem. Only the two new
scripts and sealed inputs were mounted read-only. The successful fake-provider
path used 23 HTTP operations, three PUT attempts totaling 195 bytes and one
DELETE; all tests remained within the sealed limits. Adversarial cases covered
approval gates, preexisting objects, CORS/versioning refusal, checksum refusal,
unknown and returned-5xx writes, late collision uncertainty, ownership conflicts,
InvalidDigest syntax refusal (which cannot satisfy the sealed BadDigest requirement),
cleanup failures/lost replies, deadlines, oversized streams and version ambiguity.
Real pinned SDK presigning was exercised against an injected fake fetch.

Evidence is under handoff `storage/canary-executor/`: `offline-tests-4.tap` and
`offline-tests-4-receipt.json` record the final pass and source hashes. The first
run's failed checksum-default test assertion is retained; the test was corrected
to match candidate/SDK behavior. The second launch's misplaced Docker platform
argument is also retained: it failed before container creation, and Docker's
attempted image lookup downloaded nothing. The final corrected invocation used
`--pull never`. Container absence was verified after every launch. The live
execution intent remains absent, and no live object or CORS operation was made
by this executor. The separate owner approval gate remains in force.


Latest storage follow-up, September 12 Pacific / September 13 UTC: Mark approved the exact two-header CORS update and bounded 65-byte canary. The CORS update is saved; actual PUT/GET/HEAD preflights returned 200 at 2026-09-13T02:19:17 UTC, preserving the origin, methods and 5-second max age. No canary intent or diagnostic object exists. Local ENOSPC errors and a 12-second Docker server timeout block the canary. No runtime restart or broader deployment occurred. Approval persists. Evidence: release-readiness/storage/console-resumed-20260912/cors-preflight-after.json and runtime-blocker.json. This supersedes the earlier pending-CORS statements.
