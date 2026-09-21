# Rebuild 3 prepared execution plan

## September20 Pacific / September21 UTC execution supersession

The September17 plan below is historical. Its successor actions have now applied
the five staff migrations (40 successful staff entries; public unchanged),
provisioned and proved the restricted manual LOGIN role, installed the actual
staff/private configuration, and started native image
`sha256:50ffd1e6ab8a0967a7dbbb214788a9b134ae20625aac9ba9a85cf5967635b2f4`
from application source `30dbea77c484e61de56da522d67a841cb9df25ee`.

Actual READY staff deployment is `dpl_D2d5usjWgiRMxJ3yLhY3XU4NRoNo` /
`atlas-grading-staff-5cnmp4jnf-ten-kings.vercel.app`; actual READY public deployment
is `dpl_8SLu6tEzN9EXhG1sVbHvcLBVrK5C` /
`atlas-grading-public-mzh92wy4i-ten-kings.vercel.app`. The eight-row control
transaction passed exact-delta readback: StaffControl revision16 and STAFF SMS
revision14 select the new staff binding, six legacy controls are disabled, and
customer/unchanged rows are preserved. Public promotion and final readback passed:
all four public aliases and the production target select the new deployment,
with the www-to-apex HTTP308 redirect preserved. Readback receipt
`0f0e32a575710b6283814d858f72584a02983aa975cc8f13bad65006ac625499`
records `PUBLIC_ALIAS_PROMOTION_VERIFIED`. The ordinary staff sign-in page renders
at `https://atlasgrading.com/admin`. Unauthenticated public/staff/customer routes
and all32 observed assets also passed; this does not prove a signed-in owner session.

The separate corrected Caddy validator passed with the unchanged proposal,
receipt `7452ffab6177b78f431173cf7c7a84ca6d7259834dc8fac2d468405a2c0056ef`.
The original failed validator/intent remains preserved: Caddy's executable has
`cap_net_bind_service=ep`, so the isolated replacement validator added only
NET_BIND_SERVICE to its nonroot/network-none capability set and read the root444
proposal through a read-only mount. This did not change serving privileges.
Apply receipt `104676a25437f8a901cbea6c29eeb6f8e6efc2515ea86a2228aa3c112eca7db0`
proves exactf826 ingress, inode282983 and unchanged containers. Direct TLS receipt
`9fad5fd65553648bba643ca008d8178ad5d86b5de11c01ce9507076b2117bc47`
returned HTTP401 for an unsigned request, HTTP404 for an absent route and HTTP400
for an actual-proxy signed malformed command before authentication/business effects.
Application storage qualification also passed;
all earlier native-checksum failures remain retained and unrelabeled.

Still pending are fresh ordinary owner login and authenticated manual access,
the actual hosted 130-second terminal response, and fresh physical-card optical,
manual workflow and human-requested Astra acceptance. The transport proof used
no human session or real card. Final report approval still needs genuine reviewer
certification. Autonomous operation and slab finishing follow the manual milestone;
SAM remains deferred unless actual testing demonstrates a need.

The [live milestone record](../2026-09-20/live-manual-milestone.md) and SESSION_LOG
own current execution evidence. Preserve all original sealed packages and consumed
intents; the null inputs, uncreated paths and non-executed commands below describe
September17 preparation and must not be treated as current state or replayed.

## Original September17 preparation

Prepared September17,2026 from source `2b3c3c0d2203cee0609f58984b67013a932774c9`,
with subsequent qualified application source `30dbea77c484e61de56da522d67a841cb9df25ee`.
This was a non-executed release package. The final native image and its bundled
staff build passed the [offline qualification](native-release-qualification.md).
At preparation time, actual hosted staff deployment, constructor/control bindings
and live storage qualification remained required inputs. No production database write, secret change,
role provision, deployment, model call, network attachment or Caddy reload occurred
in this preparation. Read-only provider requests use existing credential custody.

The [fresh DB/auth report](release-auth-database-readiness.md) owns the five
unchanged migration hashes and grant procedure. This plan adds concrete ingress,
container/configuration paths, cutover ordering and the certification caveat
found in the existing source. Root owns SESSION_LOG, final review and approval.

## Prepared files and September17 ingress facts

All prepared files are under:
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/release-auth-database-20260917/prepared/`.

| File | Meaning / SHA-256 |
| --- | --- |
| `Caddyfile.before` | Exact fresh1932-byte host file; `3db7ed4c051130971f03d76013c96ca1c70ecf3049b93469346aba5fbdc8c7ab` |
| `Caddyfile.proposed` | Full2714-byte replacement, only private ATLAS block changed; `f826afafcb24802b7765d4666f264f2d6e217cb545979460852cfda9c5941205` |
| `Caddyfile.diff` | Exact1364-byte unified diff; `ab25babb6504eaa6554dd6b9805def8ba29bb0780b435467c9e8bc0b02094450` |
| `caddy-adapt.stdout.json` | Actual Caddy2.10.2 adaptation; `7f3eecaa1415e748378d79c016b72f10aaccaf240d36ea9aa996537f6820bf10` |
| `ingress-plan.json` | Timestamp, current image/path and hashes; no activation |
| `route-grammar-check.json` | 53 representative cases agree with actual application predicate; no hosted HTTP claim |
| `compose.proposed.yaml` | Separate manual container proposal; mandatory immutable image input; references future private env file, contains no secrets |
| `release-inputs.json` | Explicit unfilled final identities/receipts; status `PREPARED_NOT_AUTHORIZED_OR_EXECUTED` |
| `release-inputs-qualified-offline.json` | Later snapshot binding source30dbea77/image50ffd, exact source/native/staff/tests/CI receipts and grant SQL; SHA256 `99cb572ac3a659f28605f4dd3c1c45c210a927f5dfef1d0859724b8831d1d650`. Live deployment/control/storage inputs remain null; original prepared snapshot is preserved. |

Read-only inspection at10:33UTC confirms `infra-caddy-1` uses Caddy2.10.2,
image ID `sha256:572a72cdc384a6f6b8c1d99f569290cee6606bec3cca68812feba43bfda45028`.
The source `/root/tenkings-backend/infra/Caddyfile` is a read-only **file bind** to
`/etc/caddy/Caddyfile`. Existing networks are `infra_default` with gateway priority0
and `atlas-workspace-private-20260910` with priority−1/no gateway. Preserve them.
The old release directory exists at `/opt/atlas/workspace-fresh-start-i-20260911/`,
with `compose.yaml` and `release.env`; their secret contents were not read.

The proposed complete file was fed through stdin to the actual serving binary's
`caddy adapt --adapter caddyfile --config /dev/stdin --pretty` and parsed with
exit0. It emitted only a formatting warning inherited from existing formatting.
Adaptation did not reload/configure the server, provision modules or prove TLS,
network routing or actual HTTP behavior. Full module validation is a later gate.

The18:32UTC provider readback still identifies the recorded I staff/public
deployments. Both projects have no Git link and checked-in Git deployments are
disabled, but provider `gitProviderOptions.createDeployments` is enabled; do not
misstate that setting. At18:51UTC the actual cached Vercel59.15.1 staff dry run
passed from a clean standalone30dbea77 checkout:2,511 files/167,899,247 bytes,
manifest `7163ad729ff958804249d658e372de2f6bbccd361aa44382a37146da5ab1d2ed`.
Source bytes/modes and actual CLI Git metadata match the authentic Git tree.
The three metadata GETs changed no credential/configuration/provider state.
Evidence and the exact cached tool/source paths are in
`provider-readonly-1820/STAFF_DRY_QUALIFICATION.md` below the prepared directory.
No upload or new hosted build identity exists. A later `--prod --skip-domain`
upload can advance autogenerated staff aliases, so include that effect and
complete alias readback in its concrete authorization; custom-domain skipping
is not a promise that every alias remains unchanged.

## Exact routing and body behavior

The real frontend path is `frontend/atlas-app/pages/api/staff/[...path].js`;
this checkout has no `frontend/atlas-app/src` directory. Staff frontend code strips
the `/admin` mount only after checking the admitted gateway request, then forwards
the original normalized path/query under the manual signature.

`packages/atlas-connected-manual/src/transport.mjs:isManualServicePath` accepts
only `/api/staff/(manual|manual-intake|manual-connected)/cards`, followed by zero
or more slash-separated `[A-Za-z0-9-]+` segments, plus its unchanged query. It
rejects encoded path characters, noncanonical URL normalization, fragments,
whitespace, backslashes, absolute URLs and strings longer than4096. Signatures
bind method, exact path/query, body hash, cookie/CSRF hashes, origin, content type,
timestamp and nonce. Ordinary staff authentication/card authority remains a
separate check after signature verification.

The proposal ANDs the same anchored path grammar with a raw-URI matcher. The
second matcher prevents Caddy's decoded path matching from admitting encoded
path aliases. The application still owns the complete URL/header/signature
checks; 53 cases are a bounded regression matrix, not exhaustive equivalence.
Transport source hash for that check:
`c258026a8bf1105ebe2d248ac58feb2a560ae395d6ba7b6fa65b66fb7f07369a`.

The only new upstream is `atlas-manual-connected-20260917:4319`, with2097152-byte
body bound,215-second response-header timeout,5-second dial timeout and explicit
zero retry duration. I retains its exact four paths, upstream
`atlas-workspace-private-i-20260911:8091`,16384-byte body bound and250-second
response-header timeout. All other private paths still return404. Other host
blocks, including CPU preparation, are byte-preserved. Caddy's matcher and retry
semantics were checked against its [official matcher documentation](https://caddyserver.com/docs/caddyfile/matchers)
and [reverse-proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

**Parser correction qualified offline:** initial inspection found a1MiB Next parser limit.
Root's `b061dda0` now declares `bodyParser.sizeLimit:'2mb'`, retains
`maxDuration:240` and the existing smaller route-handler bounds. The committed
file was read back directly. The final native image passes the actual Next15.5.25
parser/proxy regressions within its42 staff/manual tests. This qualifies the
artifact, not the eventual hosted2MiB path. The proposed ingress bound is unchanged.

Long requests require actual hosted evidence beyond120seconds: browser receives
15-second whitespace keepalives, then decodes the terminal status/body envelope.
An HTTP200 or keepalive alone is never completion. The private proxy deadline is
210seconds. Failed/truncated/uncertain responses retain exact action/request IDs,
especially after paid dispatch; no automatic new paid request is justified.

## Fill these final inputs without asking Mark to supply technical facts

The original `release-inputs.json` deliberately leaves missing values null. The
subsequent `release-inputs-qualified-offline.json` fills actual source/image/build/
test/grant identities and preserves missing live values. Root resolves those from
actual qualification and provider readback, then records a digest of the complete
action package:

1. Final reviewed application commit, source manifest and source/package hashes;
   all required final-head checks, including actual2MiB Next parser regression.
2. Final native image identity/config/rootfs/source closure and native target
   qualification, resource and cleanup receipts. Do not substitute intermediate
   build or old manual-only image identities.
3. Dedicated staff production artifact/build receipt, actual deployment ID/host,
   platform-supplied production mode/SHA and exact constructor config hash.
4. Public gateway project/deployment identity and old alias snapshot. Historical I
   staff is `dpl_V8k7yMUQQhKDaqYsyFSpgArh5A6L` /
   `atlas-grading-staff-fhhgiscxz-ten-kings.vercel.app`; public I is
   `dpl_BCAwpEVqZRkTNgaVD5boqkBELCi3` /
   `atlas-grading-public-306sltg50-ten-kings.vercel.app`. Refresh actual aliases;
   historical IDs are comparison inputs, not proof nothing changed.
5. Fresh35-staff/97-public ledger, full current controls/revisions and unchanged
   Inventory checksums; exact new role/grant SQL digest and complete effective
   privilege readback. Current manual migrations total five, in the prior report.
6. Actual storage qualification receipt, final signed upload origin/prefix and
   credential custody/presence receipts without values. The previous failed
   canary remains sealed; any newly approved storage action is distinct.
7. Before/after configuration and revision-fenced control plan derived with final
   source constructors. Preserve customer/legacy/public-reader state unless its
   actual new deployment binding requires a coordinated update. The gateway
   staff destination must become the exact immutable new staff origin.
8. Exact new release directory/container/network names below confirmed absent;
   fresh host memory/disk/connections; complete Caddy/alias rollback snapshots.
9. The owner's already-existing or final explicit authority mapped to the exact
   package and intended identification/Astra activation. Never use fixture
   approval evidence hashes as real authority.

Actual owner inputs remain narrow: genuine reviewer certification decision and
expiry/provenance (only before final approval), an alternate real operations
human if that route is chosen, real card/optical acceptance, and any concrete
consequential action still lacking authorization after final preparation. Existing
phone/provider access, approved manual design and general build permission do
not need to be requested again. Technical deployment IDs, hashes, project IDs,
network names, pools and source-derived controls are root-resolvable facts.

## Prepared container and private configuration

New paths/names reserved by this proposal, **not created on host**:

```text
/opt/atlas/manual-connected-20260917/
  compose.yaml              <- reviewed compose.proposed.yaml
  release.image.env         <- ATLAS_RELEASE_IMAGE only, final immutable identity
  private.env               <- privately provisioned runtime values, never output
  Caddyfile.before          <- retained exact pre-cutover file
  Caddyfile.proposed        <- exact reviewed candidate
container/project: atlas-manual-connected-20260917
internal ingress: atlas-manual-ingress-20260917
outbound bridge: atlas-manual-egress-20260917
```

Compose has `pull_policy:never`, original node user, read-only root, one CPU,
3GiB memory/no additional swap,1GiB `/tmp`, pids256, all capabilities dropped,
no-new-privileges, no published ports, restart `no`, and240-second stop grace.
These are inputs to resource qualification; successful existing build alone
does not establish serving sufficiency. The service uses one process and the
image's checked default command, not I's entrypoint. The external ingress network
is internal; the independent egress network owns the manual default route.
Caddy joins only new ingress with gateway priority−1.

Install only the source-validated variables listed in the prior report. Private
CPU must mirror staff auth/roster/Twilio/session/router values and exact new web
host/SHA, with no VERCEL/lambda/fixture flags. Use separate staff-auth/manual DB
pools1/2, TLS and same actual DB; new manual credential never goes to Vercel.
Object/model secrets stay on CPU. The dedicated32-byte transport secret must be
distinct from staff keys and matched only across web/private. No secret values
are present in these artifacts.

Web receives `ATLAS_MANUAL_ENABLED=true`, exact private service origin, signed
upload origin and transport key. Public gateway receives the new immutable
`ATLAS_STAFF_DEPLOYMENT_ORIGIN`; customer origin/keys and public content are
preserved. `productionAccessConfig` and `privateManualAccessConfig` must yield
the same admitted staff host/SHA/config hash. `makeAccessConfig` is the authority
for that hash; do not reconstruct it in SQL.

For a manual-first release, explicitly turn off unqualified optional old
workspace/machine/operator/finishing dispatch consumers instead of rebinding
their canceled pilot into activity. Preserve their evidence and capture actual
before/after flags/controls. Decide the exact flag set from current runtime
constructors; there is no generic "enable all" step. When an enabled reader or
SMS control compares deployment/SHA, rebind its real new identity transactionally
with an increasing revision. Do not alter existing customer policy/allowlists,
public Inventory schema, accounting or expired pilot authority.

The legacy grading bridge needs an explicit configuration decision:
`frontend/atlas-app/lib/server/runtime.mjs:56` creates it whenever both
`ATLAS_GRADING_BRIDGE_ORIGIN` and `ATLAS_GRADING_BRIDGE_KEY` are present, independently
of `ATLAS_WORKSPACE_ENABLED`. The new manual-only staff configuration must omit
those bridge bindings unless a separately reviewed retained use requires them.
Verify the resulting disabled bridge and all other old consumers through their
actual constructors. Preserve the old deployment's bindings for rollback.

## Historical non-executed command sequence

These commands are run only by the lead after final artifacts, dependencies,
coordination and applicable exact approval. They are not a complete unattended
script; the named readback gates between steps must pass. Never replay historical
I/H one-shot rebind/promotion helpers against this new release.

1. **Prepare and record.** Print branch/HEAD, verify exact remote parity and
   required checks, recheck source hashes, final artifact identities, backup,
   quiet state and the fresh control/ledger/Caddy/aliases snapshot. Record the
   plan in SESSION_LOG. Preserve the unlinked dedicated projects, their checked-in
   Git deployment holds and the existing legacy branch hold. The provider's
   createDeployments setting remains enabled; no setting change is implied.
2. **Migrate exactly five staff files.** Use the prior report's status/deploy/
   status/no-op commands and independently verify35→40 staff, unchanged public
   ledger, exact checksums and no unfinished rows. Privately provision only the
   reviewed manual role/grants; require complete catalog/ACL replay validation.
3. **Stage final artifacts/config.** Transfer only final sealed non-secret files
   to the new directory. Provision secrets through the existing authorized
   custody path without displaying them. If the final image is already on the
   native build host, inspect/use its exact ID; do not redundantly save/load it.
   Otherwise use the build specialist's exact qualified transfer method. Check
   image/source/config before creating the container.
4. **Create isolated networks and candidate after name/capacity checks.** On the
   host, with the final files installed, the concrete command forms are:

   ```sh
   docker network create --internal atlas-manual-ingress-20260917
   docker compose --project-name atlas-manual-connected-20260917 \
     --env-file /opt/atlas/manual-connected-20260917/release.image.env \
     -f /opt/atlas/manual-connected-20260917/compose.yaml config --quiet
   docker compose --project-name atlas-manual-connected-20260917 \
     --env-file /opt/atlas/manual-connected-20260917/release.image.env \
     -f /opt/atlas/manual-connected-20260917/compose.yaml up -d --no-build --pull never manual
   docker network connect --gw-priority -1 atlas-manual-ingress-20260917 infra-caddy-1
   ```

   `config --quiet` is intentional: normal rendered config would print env-file
   values. Inspect actual image, limits, mounts, default routes, startup identity
   and bounded native behavior. Do not recreate Caddy or change existing networks.
   Candidate ordinary authentication cannot pass until StaffControl matches the
   final web identity; listening/unsigned denial is only pre-admission evidence.
5. **Validate staged full ingress before reload.** Hash comparison must still
   equal the prepared baseline. The staged file should be visible only after
   final module validation against the existing Caddy image. A read-only parser
   command, already exercised during preparation, is:

   ```sh
   docker exec -i infra-caddy-1 caddy adapt --adapter caddyfile \
     --config /dev/stdin --pretty < /opt/atlas/manual-connected-20260917/Caddyfile.proposed
   ```

   For full validation, run `caddy validate --adapter caddyfile --config
   /dev/stdin` under the separately reviewed staging procedure. It must not be
   mistaken for a reload or actual signed route test.

   **File-bind detail:** do not atomically rename a new host file over the bound
   `Caddyfile` and assume the container sees it. Preserve its inode: after guarded
   before-hash comparison and backup, write reviewed bytes into the existing
   file, flush/fsync, then verify both host and container hashes equal
   `f826afaf…`. Only then execute:

   ```sh
   docker exec infra-caddy-1 caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile
   ```

   Record command result and independent effective route/TLS readback. An
   uncertain stdout result requires readback before any repeat action.
6. **Coordinate web/control gateway cutover.** Build/create actual production
   staff deployment and matching public gateway with controls/admissions closed
   until all dependencies are ready. Capture platform identity, rebuild current
   hashes through actual constructors and prepare a reviewed CAS control update.
   Publish only the exact prepared control/flag changes and gateway alias target,
   preserving customer destination/keys, legacy projects and unrelated controls.
   Use existing provider deployment/promotion tools with the actual returned IDs;
   IDs are currently null, so an executable promotion call is intentionally not
   fabricated. Record full before/after control receipts and alias readback.
7. **Prove before announcing the route.** Through the real apex and private TLS:
   exact new staff/native identities, ordinary login, signed manual intake-list,
   unsigned/replay/wrong-origin/revoked-session/CSRF denials, cross-card denial,
   actual body bounds and120-second-plus terminal response. Recheck I/preparation,
   public/customer routes and staff assets. Then perform approved real native
   intake/manual save/reload and individually authorized identification/Astra
   work, retaining exact requests, replies, usages and uncertain outcomes.

The root still needs to produce the final constructor-derived control SQL/CAS
receipt from actual identities. An old rebind script or a hand-entered new hash
is not an executable substitute. This is a technical completion item, not an
information request to Mark.

## Legitimate certification paths and minimum owner decision

Final `APPROVE_REPORT` requires current REVIEWER certification and card approval
authority. Manual drafts and Confirm findings memory publication do not require
certification. Fresh10:10UTC metadata remains one active reviewer with NULL
certification and zero unexpired operations grants.

Existing human-operated path:

- `frontend/atlas-app/lib/server/access/operations-authority.mjs` supplies
  `operationsGrantSQL`, its complete privilege validator and current human grant
  checks. Hosting uses `ATLAS_OPERATIONS_ENABLED=true` plus a separate restricted
  `ATLAS_OPERATIONS_DATABASE_URL`; the service cannot provision its own grants.
- Migration `20260908090000_operations_authority` owns immutable
  `atlas_staff."StaffOperationsGrant"` and one-way revocation. An authorized
  offline owner provisioner binds the real actor's ID/accessVersion, current
  StaffControl revision/mode/origin/deployment/SHA/config, genuine authorization
  evidence hash and deliberate created/expiry times. No fixture helper is a
  production provisioning command.
- The real actor signs in within five minutes, opens `/admin/operations`, reads
  the actual roster and POSTs `/admin/api/staff/operations/roster/update` with
  operationId, reason, authorizationEvidenceHash, target identity, expected
  accessVersion, role/revoked state, certificationUntil and trustedLearningUntil.
  `StaffOperations.updateRoster` records exact before/after evidence and
  increments accessVersion. An uncertain reply uses the same operation ID.

**The actor cannot certify itself through this path.** Its accessVersion update
invalidates its own session/grant before the final authority check; the existing
operations fixture explicitly verifies this refusal. With only one active
reviewer, giving that same reviewer an operations grant alone does not solve the
problem. Do not invent a second staff person or weaken the check.

The source also explicitly preserves a separate **offline owner provisioning**
authority in `operations_change_guard`, and the website deployment runbook calls
for owner installation of genuine identity/training. If Mark is the only real
operator, the lead can prepare a distinct, explicitly owner-authorized limited
provisioning transaction, binding the verified current identity/accessVersion,
the genuine owner certification decision, chosen expiry and immutable owner
provenance. It must not pretend to be `STAFF_ROSTER_UPDATED` under a fabricated
HUMAN session/grant, or run automatically with migrations. Exact SQL/provenance
and postflight require independent review before execution. No production-ready
certification/provisioning CLI was found; only runtime authority and synthetic
fixture provisioners exist in the examined repository paths.

Minimum owner decision is the genuine reviewer certification authorization and
expiry/evidence, and whether an already-real different operations human should
perform the normal roster action. IDs, versions, control bindings and evidence
hash computation are agent work. Trusted-learning authority remains independently
unchanged unless explicitly requested. A current operations grant is required
only for the ordinary human roster route, not for the separate offline owner
provisioning authority. This qualifies the earlier readiness report's roster-only
recommendation; neither path may manufacture training or approval.

## Bounded rollback

Close new manual signing/admission first, retaining exact readback/reconciliation
and all request identities. Capture real in-flight/terminal/unknown effects.
The single-process nonce store requires no same-key overlap; wait out the full
120-second possible signed timestamp acceptance interval before a replacement
process can accept that key. SIGTERM drains; source closes sockets at215seconds,
container allows240seconds. Socket closure is not proof a paid effect settled.

Stop only `atlas-manual-connected-20260917` after bounded drain; preserve the
container/image/config/evidence. Restore captured compatible staff/public/control
bindings with increasing revisions, not stale revision rollback. Restore the
exact old Caddy bytes into the existing file inode, verify host/container baseline
hash, and gracefully reload only after checking the full change. Verify I's old
upstream/health, CPU, public/customer paths, alias targets and Caddy default route.
Disconnect the added manual network only after routes no longer reference it;
leave original networks and all unrelated containers untouched.

Keep all four new schemas, original objects, manual history, approvals, reviewed
lessons, paid attempt/receipt/accounting records and owner authority provenance.
Do not run public migrations, drop/reset data, restart canceled cards, or let I
process new manual state. Record actual outcomes and unresolved operations in
SESSION_LOG. A route rollback cannot revoke or erase a genuine historical report
approval, certification decision or paid request.
