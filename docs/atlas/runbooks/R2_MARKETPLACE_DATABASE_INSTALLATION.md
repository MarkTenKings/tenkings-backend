# R2 dedicated marketplace database: operator preparation

Prepared October 24, 2026 from R2 composition `a02e5240`. **The dedicated database and protected catalog are installed; genuine direct-role catalog checks passed. Activation remains off because immutable bindings and runtime enrollment are not installed. Only the three new R2 role credentials were configured; existing credentials remain unchanged.** Canonical R1 installation is a later, distinct operation after the R1 cutover. The blocked probe and every existing UNKNOWN/retained operation remain untouched.

## Selected database and compatibility

Installed a **new database named `atlas_marketplace` on the same existing managed PostgreSQL cluster/verified endpoint as `atlas_grading`**, owned administratively by `doadmin`. This selects no new paid service. It does not reuse the `atlas_grading` database, schema, clients, staff/customer roles or application credentials. The exact endpoint and trust material remain in the existing private operator connection; they are intentionally absent here.

The separate-database topology is compatible with current R2 source. The original zero-membership profile cannot admit this managed cluster; the explicit real-installed managed profile below resolves that source incompatibility while preserving every serving-role restriction. `createPostgresStore` pins `expectedDatabase`, writer and function owner. The real protected intake/retention configuration accepts an explicitly named nonfixture database and a verified TLS hostname/CA. There is no separate-cluster requirement. The source still requires PG17, UTF8, durable PostgreSQL settings, exact fixed owner/functions/catalog, no unauthorized role memberships/settings, and narrowly restricted effective grants. Separate databases share the cluster administrator, compute, storage, connections, backups and failure domain; this is logical data separation, not independent resource or administrator isolation. The operator must reserve bounded pool capacity without changing R1 limits or increasing the service tier implicitly.

The actual production snapshot used only for metadata discovery is `atlas-r1-auth-after-label-prep-20261023/release-after-label-01/root-inputs/preflight/capture/snapshot.json` under the handoff directory; SHA256 `44b300ab42d312a5b4294bc937a60707b308411b784e9e5ecf67387f2d650381`. It records `atlas_grading` owned by `doadmin`, UTF8, `en_US.UTF-8` collation/ctype, and a non-superuser `doadmin` with CREATEDB/CREATEROLE. It contains no marketplace schema/base or any of the four proposed roles. Its captured database catalog does **not** establish that the proposed database name is absent cluster-wide. The later bounded preflight confirmed absence before the approved one-time creation below.

## Confirmed incompatibility of the default profile

Default protected catalog validation continues to reject **any** `pg_auth_members` edge touching `atlas_marketplace_owner`, `atlas_marketplace_writer`, `atlas_proof_retention_writer` or `atlas_proof_intake_writer`, in either direction. Incoming ADMIN-only membership is rejected even when INHERIT and SET are false. The saved managed-cluster metadata already shows `doadmin` has grantor-`postgres` ADMIN memberships on existing R1 managed roles, including `atlas_comp_curation_r1`.

PostgreSQL17 automatically grants a newly created role back to a non-superuser creator with ADMIN enabled, INHERIT/SET disabled, and the bootstrap superuser as grantor. The creator cannot remove or change that grant. ADMIN also permits the administrator to issue additional membership grants, so disabled inheritance/SET are accident safeguards rather than isolation from that administrator. See [PostgreSQL17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html). [DigitalOcean's privilege documentation](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/) confirms managed customers do not receive superuser access.

Consequently the proposed `doadmin` installation cannot meet the unchanged zero-membership contract. This is a supported incompatibility, not a hypothesis requiring a production role experiment. Do not run the prepared target preflight merely to rediscover it or attempt to revoke the bootstrap grant. The selected source profile below handles only these exact administrator edges; installation still requires the separately recorded operator action.

Non-superuser ownership transfer remains a separate installation detail if the managed option is selected. Any additional temporary SET-role membership or database CREATE grant used to transfer schema/functions/tables and set owner defaults must be removed afterward. The exact bootstrap ADMIN-only grants are the selected permanent exception; temporary INHERIT/SET grants are not included. The NOLOGIN function owner must not own the database or retain database CREATE/TEMP. Provider mandatory defaults or extra executable functions still must meet the existing fixed checks.

## Selected source profile and administrator trust boundary

| Choice | Security boundary | Implementation and operations |
| --- | --- | --- |
| Explicitly accept only the trusted installer's bootstrap ADMIN-only edge | The installation administrator is an explicit trusted principal; application writers gain no membership or direct table access. Compromise or misuse of that administrator can change grants/credentials and defeat serving-role restrictions. | Smallest source change: real-installed catalog identity/membership parsing and validation, plus the exact installation binding. Keep fixture/default behavior strict and every other catalog/privilege check intact. Existing cluster operations are retained. |
| Separate operator-owned database host | A controlled bootstrap superuser can create roles directly and retain the current zero-membership serving contract. The host operator/superuser remains trusted; this does not make SQL safe from host administration. Independent credentials/host resources can reduce shared-cluster exposure. | Additional database hosting, patching, backups, restore verification, monitoring, network/TLS and installation qualification. Do not place it on the qualified decoder target or reuse its resources/credentials as an incidental shortcut. Canonical R1 C0 access is still a separate dependency. |

**The selected implementation trusts the installation administrator explicitly and permits only the narrowly pinned administrative exception.** Only necessary dedicated R2 configuration is in scope; blanket replacement of existing credentials is not an activation prerequisite. It is smaller than operating a separate database host and matches the existing need for a trusted database installer. If the required boundary excludes this managed administrator from trust, choose the separate host instead; no membership whitelist can deliver that stronger boundary on the managed cluster.

The implemented selector is `configuration.installationProfile: "atlas-r2-doadmin-bootstrap-v1"` on **both real installed** intake and retention connections. It is accepted only for the exact `atlas_marketplace` database and a `VERIFIED_TLS` endpoint. Omission preserves the existing zero-membership behavior. Fixture, generic, retention-only and other database/profile configurations cannot select it. The public connection binding includes this selector and a distinct source-owned catalog closure hash; those fields remain UNQUALIFIED metadata and grant no operator, request, retention, key-custody or activation authority.

The additional fixed catalog query observes every incoming or outgoing membership touching the four protected roles, with a five-row limit so a fifth edge fails closed. It does not filter away unwanted members, grantors or flags. The audit requires exactly one row for each protected role, member `doadmin` (LOGIN, non-superuser, CREATEROLE), grantor `postgres` with bootstrap OID10 and superuser status, ADMIN=true, INHERIT=false, SET=false. `doadmin` and `postgres` names are pinned from the independent saved operator metadata and explicit trust decision; the bootstrap OID is pinned by [PostgreSQL17 catalog source](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/catalog/pg_authid.dat). No allowlist is learned from the live rows or supplied in configuration. Wrong identity, flag, grantor, duplicate, missing/extra row or any protected-role outgoing edge refuses.

Only after that comparison does the composed auditor remove the checked administrative subset for the original base audit. All current/session-role, NOLOGIN/elevation/inheritance, role/default-setting, durability, effective ACL, ownership, function, table, constraint, trigger and immutable-binding checks remain in place. Runtime sessions remain the restricted writers. The administrator is trusted: ADMIN can change credentials and grants, and false INHERIT/SET is **not** isolation from that administrator. No SQL guard, role grant, function body or fixture audit changed.

The affected source tests passed 22 checks (installed profile seven, intake ten, base retention five), including exact membership acceptance/refusals, downstream role/effective-ACL refusal, fixture/default separation and binding-hash separation. These deliberately constructed catalog/binding observations cannot create a private producer. They are not a full managed PostgreSQL installation result or operator-custody proof. Existing SQL receipts retain their original structural scope and were not replayed; the subsequent actual managed catalog/default/ownership-transfer checks are recorded below.

**Existing provider/API/database passwords remain unchanged.** The user explicitly rejected broad key replacement, and the release owner narrowed this work to necessary R2 setup. Only the three newly created marketplace serving roles received new dedicated credentials. Trusted administrator and storage/key custody remain real operational boundaries, but source installation does not impose blanket incident remediation or unrelated key rotation. Any separately established credential exposure needs its own specific scope.

## Operator packet and observed installation

Packet: `~/.codex/atlas-handoffs/atlas-r2-target-proposal-20261023/marketplace-db-install-plan-01/`.

It contains:

- `preflight-read-only.sql`: bounded READ ONLY transaction, catalog/role/SSL/connection-count metadata only, finishing with ROLLBACK. No database/role creation, business-row reads, credentials, private setting values or endpoint output.
- Four byte-identical copies of the existing base, role, retention and intake SQL sources, with SHA256s in `manifest.json`.
- `roles-atlas-marketplace.GUARDED.sql`: a concrete target-scoped copy of the existing role proposal. Its only changes are the three database literals from `atlas_marketplace_review_candidate` to `atlas_marketplace`. Its intentional `R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED` exception is retained.
- This plan. There is no executable orchestration runner, environment loader or new authority document.

The bounded `preflight-read-only.sql` ran once over verified TLS at 08:38:34 UTC and ended with ROLLBACK. It confirmed the exact database/operator/PG17/UTF8/locale, absence of the target and all four roles, no relevant role/database defaults, and 22 current connections of 50 (three superuser reserved). It observed `synchronous_commit=off` and `createrole_self_grant=inherit,set`; shared defaults were preserved. Installation locally set durable commits and disabled extra creator self-grants. The managed source connection now explicitly starts with `synchronous_commit=on`; all other profiles retain their prior options and the durability audit remains mandatory.

After the release owner's exact shared-production scope review, these effects were each dispatched once:

| Effect/evidence in the packet | Observed result |
| --- | --- |
| `create-atlas-marketplace.OPERATOR.sql`, SHA256 `c17203a522222145f80a7c04625b81e8c62bf09cd034e5e3e786293c9af56da9` | CREATE acknowledged08:48:50 UTC; new database connection limit 8 |
| `new-database-inspection-01.json` | Only ordinary public schema/PLpgSQL; no extra relations/functions/event triggers/default ACLs |
| `install-atlas-marketplace.OPERATOR.sql`, SHA256 `de5d7ad01b4e56106e1d3410050c1deaf58de6f345cd22cec008c4ff08fb8d7e` | COMMIT acknowledged08:49:59 UTC; 119 command results, 11 empty tables, 31 functions; temporary privileges removed |
| `new-role-credential-attempt-01.json` | COMMIT acknowledged08:53:33 UTC; only the three new LOGIN roles received SCRAM credentials; owner stays NOLOGIN |
| `direct-role-check-01.json` and the two role catalog snapshots | All three actual role logins/verified TLS passed; both full fixed installed catalog auditors passed; empty intake binding refused with P0002 |

Credentials were generated once in a 0700 private directory/0600 file and used only in memory; no value or verifier is in this document or the receipts. Private references are supplied to the runtime configuration owner separately. Existing operator/provider/database credentials were untouched. The actual source auditors checked all function bodies, owner/role/default/ACL/catalog constraints and exactly four bootstrap ADMIN-only edges. These are actual database/role observations, not fixture promotion. They establish installed plumbing, **not** genuine policy, request/decoder/publisher authority or activation readiness.

The original four source copies, guarded role copy and historical preparation/STOP notes are retained. The two exact operator effect copies resolve their exceptions only in the reviewed new-database scope and combine temporary grant/removal inside one transaction. Do not rerun them: the recorded database and roles now exist. Any later uncertainty requires exact read-only reconciliation, not replay or cleanup.

## Executed scope and remaining binding boundary

Steps 1–6 below describe the approved executed scope, including the new database connection limit 8 and PUBLIC CONNECT revocation. Step 7 remains the serving boundary. Original source files remain guarded; execution used only the exact reviewed copies above.

1. Record a fresh source/permission/capacity preflight and intended effect scope in SESSION_LOG. Freeze the exact operator effect text, source hashes and database identity. Preserve all existing database/role/default-ACL facts. Do not bundle canonical installation or activation into this packet.
2. Create only `atlas_marketplace` on the existing cluster, with administrative owner `doadmin`, from `template0`, UTF8 and the verified available `en_US.UTF-8` locale. Use a separate statement outside a transaction. Never clone `atlas_grading` or create a dump/restore containing canonical business data. Reconnect explicitly to `atlas_marketplace`; verify its exact name/owner/encoding and inspect any provider-created schemas/functions/default grants before installing. If template creation/locale/provider permissions disagree, stop rather than choosing another target or altering R1.
3. Install the pinned `proposal.sql` base in that new database only. It creates the six CAS/journal/projection tables and four fixed functions, with PUBLIC access revoked. It seeds no state. This is independent of the canonical staff/customer database.
4. Apply the target-scoped role proposal through the later exact approved operator effect packet. Preserve its fixed NOLOGIN owner and separate LOGIN generic writer, no elevated attributes, fixed schema ownership and the three SECURITY DEFINER gateway grants. The original proposal and the prepared guarded copy intentionally abort; **no source exception was removed**. The operator must explicitly resolve the guard in its separately recorded one-use effect text, not use an automated guard-stripping runner. Supply any necessary temporary ownership-transfer permissions only after their exact scope/removal has been established. No cluster-wide REASSIGN OWNED or change to existing canonical roles is included.
5. Apply the pinned `r1-proof-retention-installation.sql`, then `r1-proof-intake-installation.sql`, using the same explicit operator-guard discipline. These are the existing real/nonfixture installers, not fixture gateways. Retention protects the generic writer's proof maps and introduces its restricted writer. Intake adds protected CREATE/VALIDATE, accounted decoder transitions and its separate writer. Both source exceptions remain intact. Their three immutable singleton binding tables remain empty.
6. Remove only the exact temporary new-role installation permissions, if any. Confirm the exact explicitly selected membership contract (the four exact bootstrap ADMIN-only edges for the selected managed profile; zero edges remains the default), exact no-login/elevation/inheritance flags, NOLOGIN schema/function owner, no owner database CREATE/TEMP, and only the fixed writer EXECUTEs/schema USAGE with no direct table/column/sequence access. Reuse the existing fixed catalog queries/auditors for the later actual installation qualification; do not learn expected source hashes from the installed catalog. Preserve provider administration without inventing grants to serving roles. Any mismatch stays held.
7. Keep every serving feature disabled and credentials unmounted. Do not seed a marketplace environment, empty state, immutable policy/storage/accounting rows, reviewer configuration or key binding until the actual approved values and custody references exist. Missing bindings intentionally prevent startup. This plan supplies no fictional retention authority, reviewer, key, environment or capacity approval. Credential generation/delivery, exact state/binding seed and genuine combined qualification are later separately recorded actions.

A partial installation is not retried blindly. Inspect the original database/roles and exact transaction outcome; preserve partial evidence and leave activation disabled. No automatic DROP/cleanup is included.

## Source composition and later canonical boundary

| Order | Existing source in `packages/atlas-marketplace/sql/` | SHA256 |
| --- | --- | --- |
| 1 | `proposal.sql` | `44e8435935eb7b459a6b3c5d0c458f663f5b3a47921fd28e27577bc486b8bc30` |
| 2 | `r1-marketplace-role-proposal.sql` (three target literals scoped in the guarded packet copy) | `bff383a4c4354cb1d395ab2420333cc7d2f42ebba39deba1df866b4b13e52063` |
| 3 | `r1-proof-retention-installation.sql` | `531806417d9ee657bf13d5a2951ed69334f7d4ce48a1d02413739fa3859db12d` |
| 4 | `r1-proof-intake-installation.sql` | `76175dffef4a148eb2cb6c8dd4458b6ff77c452e662cd68cbee98042f269ecc7` |

The source profile is independently pinned below. The four SQL source hashes above remain unchanged. The source-owned managed connection now pins synchronous commits on without changing database or role defaults. Do not substitute the managed hash into a default-profile binding.

| Catalog profile | Closure SHA256 |
| --- | --- |
| Default real installed | `f6d15bdc1634248cef57436c4ba8e2c2f223a23d4cc2d14d0bdd78126911fa5f` |
| Managed real installed | `e543206b8071ad657b4963674bff420084f498d6214670d4ac1349f81c8c202c` |

| Source under `packages/atlas-marketplace/src/` | SHA256 |
| --- | --- |
| `proof-intake-protected-catalog.mjs` | `f0ebaa89d065120a3b34effb100b9c0b4752fe0c50d56ac9d6e827fe5ffbbe9b` |
| `proof-retention-postgres-connection.mjs` | `a0cd594bbcc323fa44864991625e1c351ec7abade8deea9f89fbbb7e0ede8d0d` |
| `proof-publication-retention.mjs` | `07b7b2d7f698bc8baa2b61fd6d6565c69f5cdc0e3f3ce34769b00be13c98e853` |

The subsequent canonical C0 schema/roles/writer hooks belong in `atlas_grading` as a **different** installation using `r1-proof-authority-proposal.sql` and `r1-proof-authority-role-installation.sql`, with fresh post-R1 source/role/control evidence. They are not copied into this execution packet and must not run in `atlas_marketplace`. No database extension, dblink, foreign-data wrapper or shared canonical table is needed for the separate database topology; the existing coordinator uses separately scoped connections and preserves original uncertain operations across stores.

Policy/storage/reviewer binding, genuine native enrollment, publisher ownership/recovery custody, combined canonical/decoder/publication/C1 qualification and the real pilot remain unresolved. The known pending REMOVE and every retained ledger/hold stay unchanged. Source preparation and metadata preflight do not satisfy any of those gates.
