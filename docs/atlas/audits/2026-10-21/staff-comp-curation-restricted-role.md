# Restricted native comp-curation database proposal

This is local, inactive and unregistered. It supplies an explicitly injected
database capability for the existing native curation composition. No production
role, credential, migration, environment, route, private proxy or UI is enabled.
Existing grading/authentication/curation services and baseline/migrations are
unchanged. Root owns any later installation and activation.

## Exact source boundary

New files only:

- `packages/atlas-connected-manual/src/comp-curation-database.mjs`
- `packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql`
- `packages/atlas-connected-manual/test/comp-curation-database.test.mjs`
- `packages/atlas-connected-manual/test/fixtures/comp-curation-restricted-role-postgres.mjs`

`createCompCurationDatabase({client,role,schemaOwner,schemaSha256})` accepts a
separate caller-owned client and an independently reviewed exact schema pin. It
returns only `$transaction` and `close`; construction/import opens nothing.
`createDurableStaffBoundary` receives this wrapper as its manual client and keeps
using the actual DurableStaffAuth private actor handle and existing live SQL
authentication. The wrapper checks captured options/client identity and exact
privileges/schema before and after transaction work. Closing does not disconnect
a caller-owned client or claim that a previously committed operation rolled back.

The grant proposal requires an explicit identifier parameter and does not create
a role, password, schema or table. The serving capability has:

| Capability | Exact scope |
| --- | --- |
| SELECT | `atlas_manual.card`, `action`, `approval`, `publication`, `public_report_identity`, `presentation_market`, `comp_curation`; `atlas_manual_intake.card`, `discarded_card` |
| INSERT | `atlas_manual.comp_curation` only |
| UPDATE | `id` only on the two card tables, for PostgreSQL row-lock admission |
| USAGE | `atlas_manual`, `atlas_manual_intake`; existing public-schema usage is checked, not added |
| Custom routine EXECUTE | `atlas_manual.authenticate(text,text,jsonb,text[])` only; inherited non-definer uuid-ossp extension functions retain the existing narrow exception |

The checker refuses additional effective table/column/sequence/custom-routine
privileges, schema creation or additional schema access, database CREATE/TEMP,
role membership in either direction, SET ROLE impersonation, elevated role
attributes, and object ownership. Catalog qualification includes all nine tables'
columns/defaults/constraints/indexes/enabled trigger graph and the functions
behind those triggers, plus authentication. Five critical source-body hashes are
also fixed from the unchanged baseline/curation proposal. A supplied schema pin
cannot bless a changed immutable-card or authentication guard body.

`inspectCompCurationSchema` reads catalog metadata for qualification; the serving
factory never calls it to learn its own trusted baseline. Its reviewed normalized
hash omits installation-owner names, which are independently checked against the
explicit migration owner. All other recorded metadata is pinned.

## Authority and policy limits

The role is a trusted native-service credential, **not per-staff SQL row-level
security**. Raw SELECT can read the nine granted tables; direct INSERT is still
constrained by the append/source/receipt trigger, but that trigger does not itself
authenticate the human or verify retained artifacts. Actual staff/ACL/session and
saved artifact authority remains the unchanged DurableStaffBoundary, curation
service, finishing loader and intake validator. The private proxy is a separately
reviewed boundary. Do not expose this client or its credentials to a browser or
serverless frontend.

The existing native composition fixes `policy:null`. No rights/recency/valuation
policy is selected here; SELECTED/guidance remains unavailable. Private Skip/No
suitable receipts do not change report snapshots, grading, asking prices or
listings. No provider, payment, notification, device or storage write is added.

## Qualification

Evidence root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/`.

Sixteen focused units passed under OS network denial. They cover inert
construction, exact privilege failures, source-pin rejection, before/after
transaction validation, capability drift across an explicitly observed await,
close/lifetime semantics and the exact non-provisioning grant proposal.

Each owned PostgreSQL attempt first wrote an exclusive plan with exact directory,
loopback port and nonce, saved source bytes and was logged before launch. Unix
sockets were disabled; inherited database configuration and existing data/intent
were rejected. Only a fresh synthetic database installed the existing baseline
and registered002–009 plus the unregistered comp table. That database's PUBLIC
TEMP privilege was revoked solely for qualification; this does not authorize a
production-wide privilege change.

- PG01 failed during fixture-only staff seeding because the Prisma schema was
  incorrectly `atlas_manual`; no qualification group ran. Exact owned cluster
  stopped and its data was removed; original evidence is retained.
- PG02 passed eight groups and all114-table comparisons. Its auxiliary expiry
  predicate mixed a timestamp without time zone with the cluster PDT clock.
  Actual existing authentication used UTC and its observed lock/refusal sequence
  remained useful, but the auxiliary boolean was not valid independent UTC proof.
  `restricted-role-pg-02/interpretation-01.json` records this limit without rewriting
  the original receipt. Root authorized a fixture-only successor.
- PG03 adds explicit UTC stored-expiry readback and database clock observations
  both while the exact transaction is blocked and after expiry before releasing
  the blocker. Eight groups pass. Receipt
  `7f47f59b8ce4ec9a5af088b45ecb1705ad1e57e152bcf3138b32a58e37d2d036`
  records waiter56040 blocked by56099: database observation08:33:45.721UTC,
  stored expiry08:33:46.775UTC, and database expired observation08:33:46.803UTC
  before COMMIT. The actual unchanged service returned SIGN_IN_REQUIRED without
  insertion. ACL and newer-pending source waits also produced their exact
  expected refusals. Final cleanup
  `b25660e556faef808be2146e560a53ec6170c3e806ec0ceb0bd3bf362e48e3f6`
  and shutdown08:33:47.118UTC verify stopped/data absent. Detail independently
  verified actual source/25 saved pins/receipts/timing/cleanup: PASS, no rerun.

The eight groups exercise actual restricted-login SHARE/UPDATE locks; signed
HTTP through the real native composition/service with null-policy receipt and
same-ID replay; changed-ID and `id=id` rejection on both cards; denied content,
revision, report, publication, saved-provider and customer writes; eight real
privilege/trigger drifts and a grant change before final transaction validation;
and observed session-expiry, ACL-revocation and newer-pending-publication waits.

Full row values are compared across every phase. Final assertions permit exactly
one curation append, one synthetic ACL-only card replacement and three explicitly
seeded pending-publication rows. The remaining109 tables, both retained local
artifacts and ledger9 are unchanged. The complete card replacement must be only
`approvers=[]` and `revision+1`. Schema009 and all old schema/service bytes remain
source-pinned. No actual browser, production proxy or live credential is qualified
by this fixture.

Final source pins: database module
`571d124650a0682ea07cac432f4accd8326322e0382163043b951d9ee1a27c1a`,
role proposal `f7378ae825f6629eec5c3911adec4a344e1fa834170f398efb9920d2376a3d92`,
units `666aef6d9bee574c8117d4383bf805a19585c1f66fe1e598819658bac3ddf55c`,
fixture `088e57e218e2827ce178b5ec3d76714fdd70d193b232555ecba717e1b2491449`.
The owned schema envelope is
`edd44ee56cc7c55e77b0442c756406ea4652c92e01ff2e02a1f403f41d3b62ba`;
normalized reviewed schema pin is
`a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7`.
`restricted-role-qualification-01/qualification.json` joins all final source,
unit/PG/cleanup/schema and retained failed/limited attempts. Prior evidence is
immutable; the fixture timing correction did not alter product source or grants.
Its SHA256 is
`0a109655fb345d1009509512a018f4eb045d79022c7449be08f07b64df1cbf6b`.

## Remaining installation gates

1. Review a separately registered additive installation for the existing comp
   table/guards. Never modify/replay SQL009 or silently install an untracked
   production schema. Current release controls and ledger stay unchanged.
2. Choose the native role name, migration owner, secret owner/rotation and bounded
   connection lifecycle. Inspect inherited PUBLIC privileges first: a role grant
   cannot subtract inherited TEMP or other rights. The checker must refuse any
   incompatible live posture; do not broaden it or revoke global privileges
   without a separately reviewed impact plan.
3. Bind the exact reviewed schema hash and dedicated client into the inactive
   native composition, then qualify the separately reviewed private proxy and
   actual mounted Response transport. No broader manual/staff role is a fallback.
4. Decide whether trusted native-service SELECT/INSERT is the intended boundary.
   A requirement for database-enforced per-user ACL/artifact authority would need
   a separate gateway design, not a claim that this role already supplies it.

These engineering gates do not select a pricing policy. Operational rights and
valuation choices remain separate from qualifying private null-policy actions.
