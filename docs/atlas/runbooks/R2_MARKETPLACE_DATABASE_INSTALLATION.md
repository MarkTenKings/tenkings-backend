# R2 dedicated marketplace database: operator preparation

Prepared October 24, 2026 from R2 composition `a02e5240`. **Local plan only: no SQL, connection, provisioning, credential, enrollment or activation action has run.** Canonical R1 installation is a later, distinct operation after the R1 cutover. The blocked probe and every existing UNKNOWN/retained operation remain untouched.

## Candidate and compatibility

Use a **new database named `atlas_marketplace` on the same existing managed PostgreSQL cluster/verified endpoint as `atlas_grading`**, owned administratively by `doadmin`. This selects no new paid service. It does not reuse the `atlas_grading` database, schema, clients, staff/customer roles or application credentials. The exact endpoint and trust material remain in the existing private operator connection; they are intentionally absent here.

This is compatible with current R2 source. `createPostgresStore` pins `expectedDatabase`, writer and function owner. The real protected intake/retention configuration accepts an explicitly named nonfixture database and a verified TLS hostname/CA. There is no separate-cluster requirement. The source still requires PG17, UTF8, durable PostgreSQL settings, exact fixed owner/functions/catalog, no unauthorized role memberships/settings, and narrowly restricted effective grants. Separate databases share the cluster administrator, compute, storage, connections, backups and failure domain; this is logical data separation, not independent resource or administrator isolation. The operator must reserve bounded pool capacity without changing R1 limits or increasing the service tier implicitly.

The actual production snapshot used only for metadata discovery is `atlas-r1-auth-after-label-prep-20261023/release-after-label-01/root-inputs/preflight/capture/snapshot.json` under the handoff directory; SHA256 `44b300ab42d312a5b4294bc937a60707b308411b784e9e5ecf67387f2d650381`. It records `atlas_grading` owned by `doadmin`, UTF8, `en_US.UTF-8` collation/ctype, and a non-superuser `doadmin` with CREATEDB/CREATEROLE. It contains no marketplace schema/base or any of the four proposed roles. Its captured database catalog does **not** establish that the proposed database name is absent cluster-wide. That needs the explicit preflight below.

## Concrete managed-role gate

Current protected catalog validation rejects **any** `pg_auth_members` edge touching `atlas_marketplace_owner`, `atlas_marketplace_writer`, `atlas_proof_retention_writer` or `atlas_proof_intake_writer`, in either direction. Incoming ADMIN-only membership is rejected even when INHERIT and SET are false. The saved managed-cluster metadata shows `doadmin` has grantor-`postgres` ADMIN memberships on existing R1 managed roles, including `atlas_comp_curation_r1`.

Therefore this target is **conditionally compatible, not yet install-ready**. Establish whether new role creation on this provider introduces such memberships and whether the operator can remove them completely. Do not infer removability from CREATEDB/CREATEROLE, silently weaken the fixed audit, remove memberships on existing R1 roles, or create production role probes to discover the answer during cutover. If provider-enforced membership cannot be removed, this cluster cannot satisfy the present protected-role contract; stop before provisioning and resolve that actual compatibility issue separately.

Non-superuser ownership transfer is another exact prerequisite: the operator must be able to transfer the new schema/functions/tables to the NOLOGIN owner and set owner default privileges. Any temporary SET-role membership or database CREATE grant used for that transfer must be scoped only to these new roles/new database and removed before the catalog audit. The NOLOGIN function owner must **not** own the database or retain database CREATE/TEMP, and none of the four roles may retain role/database defaults or membership edges. Do not substitute `doadmin` for the fixed function owner. Provider mandatory defaults or extra executable extension functions that cannot meet the fixed catalog/privilege checks are stop conditions, not reasons to broaden the runtime contract.

## Prepared operator packet and read-only first action

Packet: `~/.codex/atlas-handoffs/atlas-r2-target-proposal-20261023/marketplace-db-install-plan-01/`.

It contains:

- `preflight-read-only.sql`: bounded READ ONLY transaction, catalog/role/SSL/connection-count metadata only, finishing with ROLLBACK. No database/role creation, business-row reads, credentials, private setting values or endpoint output.
- Four byte-identical copies of the existing base, role, retention and intake SQL sources, with SHA256s in `manifest.json`.
- `roles-atlas-marketplace.GUARDED.sql`: a concrete target-scoped copy of the existing role proposal. Its only changes are the three database literals from `atlas_marketplace_review_candidate` to `atlas_marketplace`. Its intentional `R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED` exception is retained.
- This plan. There is no executable orchestration runner, environment loader or new authority document.

After R1 is complete, the first executable action is to run **only `preflight-read-only.sql`** through the already verified private administrative connection to `atlas_grading`. Use the ordinary operator SQL client with stop-on-error; do not place its connection URI/password into commands, receipts or logs. Save the metadata result beside this packet. This preparation did not run that query.

Proceed only if the expected source database/operator/verified TLS and PG17/UTF8/durability checks agree; `atlas_marketplace` is absent; all four fixed role names are absent; applicable all-role/database defaults are absent; resource headroom is explicitly accepted; and the managed membership/ownership-transfer gate is resolved. Existing database/role names are collisions: inspect and reconcile separately, never use IF NOT EXISTS, overwrite, reset or adopt them. A read-only preflight cannot prove future provider role behavior or act as a positive runtime qualification.

## Concrete later execution order

This section describes future effects. It authorizes none during preparation and does not make the guarded files executable.

1. Record a fresh source/permission/capacity preflight and intended effect scope in SESSION_LOG. Freeze the exact operator effect text, source hashes and database identity. Preserve all existing database/role/default-ACL facts. Do not bundle canonical installation or activation into this packet.
2. Create only `atlas_marketplace` on the existing cluster, with administrative owner `doadmin`, from `template0`, UTF8 and the verified available `en_US.UTF-8` locale. Use a separate statement outside a transaction. Never clone `atlas_grading` or create a dump/restore containing canonical business data. Reconnect explicitly to `atlas_marketplace`; verify its exact name/owner/encoding and inspect any provider-created schemas/functions/default grants before installing. If template creation/locale/provider permissions disagree, stop rather than choosing another target or altering R1.
3. Install the pinned `proposal.sql` base in that new database only. It creates the six CAS/journal/projection tables and four fixed functions, with PUBLIC access revoked. It seeds no state. This is independent of the canonical staff/customer database.
4. Apply the target-scoped role proposal through the later exact approved operator effect packet. Preserve its fixed NOLOGIN owner and separate LOGIN generic writer, no elevated attributes, fixed schema ownership and the three SECURITY DEFINER gateway grants. The original proposal and the prepared guarded copy intentionally abort; **no source exception was removed**. The operator must explicitly resolve the guard in its separately recorded one-use effect text, not use an automated guard-stripping runner. Supply any necessary temporary ownership-transfer permissions only after their exact scope/removal has been established. No cluster-wide REASSIGN OWNED or change to existing canonical roles is included.
5. Apply the pinned `r1-proof-retention-installation.sql`, then `r1-proof-intake-installation.sql`, using the same explicit operator-guard discipline. These are the existing real/nonfixture installers, not fixture gateways. Retention protects the generic writer's proof maps and introduces its restricted writer. Intake adds protected CREATE/VALIDATE, accounted decoder transitions and its separate writer. Both source exceptions remain intact. Their three immutable singleton binding tables remain empty.
6. Remove only the exact temporary new-role installation permissions, if any. Confirm zero membership edges for all four roles, exact no-login/elevation/inheritance flags, NOLOGIN schema/function owner, no owner database CREATE/TEMP, and only the fixed writer EXECUTEs/schema USAGE with no direct table/column/sequence access. Reuse the existing fixed catalog queries/auditors for the later actual installation qualification; do not learn expected source hashes from the installed catalog. Preserve provider administration without inventing grants to serving roles. Any mismatch stays held.
7. Keep every serving feature disabled and credentials unmounted. Do not seed a marketplace environment, empty state, immutable policy/storage/accounting rows, reviewer configuration or key binding until the actual approved values and custody references exist. Missing bindings intentionally prevent startup. This plan supplies no fictional retention authority, reviewer, key, environment or capacity approval. Credential generation/delivery, exact state/binding seed and genuine combined qualification are later separately recorded actions.

A partial installation is not retried blindly. Inspect the original database/roles and exact transaction outcome; preserve partial evidence and leave activation disabled. No automatic DROP/cleanup is included.

## Source composition and later canonical boundary

| Order | Existing source in `packages/atlas-marketplace/sql/` | SHA256 |
| --- | --- | --- |
| 1 | `proposal.sql` | `44e8435935eb7b459a6b3c5d0c458f663f5b3a47921fd28e27577bc486b8bc30` |
| 2 | `r1-marketplace-role-proposal.sql` (three target literals scoped in the guarded packet copy) | `bff383a4c4354cb1d395ab2420333cc7d2f42ebba39deba1df866b4b13e52063` |
| 3 | `r1-proof-retention-installation.sql` | `531806417d9ee657bf13d5a2951ed69334f7d4ce48a1d02413739fa3859db12d` |
| 4 | `r1-proof-intake-installation.sql` | `76175dffef4a148eb2cb6c8dd4458b6ff77c452e662cd68cbee98042f269ecc7` |

The subsequent canonical C0 schema/roles/writer hooks belong in `atlas_grading` as a **different** installation using `r1-proof-authority-proposal.sql` and `r1-proof-authority-role-installation.sql`, with fresh post-R1 source/role/control evidence. They are not copied into this execution packet and must not run in `atlas_marketplace`. No database extension, dblink, foreign-data wrapper or shared canonical table is needed for the separate database topology; the existing coordinator uses separately scoped connections and preserves original uncertain operations across stores.

Policy/storage/reviewer binding, genuine native enrollment, publisher ownership/recovery custody, combined canonical/decoder/publication/C1 qualification and the real pilot remain unresolved. The known pending REMOVE and every retained ledger/hold stay unchanged. Source preparation and metadata preflight do not satisfy any of those gates.
