# Ownership to My Collection — local integrated qualification

One new finite fixture qualifies existing services together in an owned PostgreSQL17 database. No product implementation, SQL, route, runtime composition, policy configuration or production deployment changed. The ownership and collection features remain disabled and unregistered. This is evidence for part of R1, not completion of R1 or the marketplace.

Source: `packages/atlas-connected-manual/test/fixtures/ownership-collection-journey-postgres.mjs`, SHA256 `77c38f0e81494dd59a58f271874a33014da5146a9b0d80be60718adc9d4ca88a`. All25 exercised source files are copied and hashed in the private evidence packet; current bytes matched those pins after the run.

## Actual combined path

The fixture uses existing CustomerAuth and durable StaffAuth with local verification providers, distinct restricted lifecycle customer/reviewer/ingestor clients, the lifecycle reader, the collection reader and the participating-transfer service. It seeds only two synthetic card identities and published reports; one also has a newer pending publication. It invokes no grading workflow or provider.

Six groups passed:

1. Unknown title, staff intake access, retained evidence, a pending claim and a withdrawn claim do not put a card in My Collection.
2. Original reservation, trusted synthetic retention, submission, evidence replacement and an independent authenticated v2 reviewer verification produce one actual synthetic ownership title. The restricted collection reader returns that card only to the verified owner. Earlier bundles/transitions and the original submission receipt remain unchanged.
3. Collection and lifecycle readers identify the same latest **PUBLISHED** approval/report despite a newer PENDING publication. The collection defaults to PRIVATE and OPEN_TO_OFFERS while delivery remains unavailable and physical custody unknown. Neither intake ACL nor a historical review decision supplies custody or offer delivery.
4. Proposing a transfer does not move the card. The recipient's authenticated acceptance moves My Collection from A to B. A's earlier claim remains VERIFIED but `currentlyOwnedByYou` becomes false, and the private historical projection discloses no competing owner identity. Exact accepted-transfer replay adds no new event.
5. The real collection GET handler, private/no-store response headers, bounded Response reader and browser parser consume actual restricted-reader output through an in-process bridge. The bridge supplies a synthetic outer request hook; it is not a live HTTP router or production gateway. A valid empty collection returns200, missing configuration returns503, a foreign-account result is refused and an absent session returns401/access-ended.
6. A deliberately revoked synthetic recipient account loses collection and lifecycle access. The actual handler/client translate the refused read into access-ended. This is sequential revocation qualification, not an additional concurrent lock-wait or expiry experiment.

## Preservation and cleanup

The fixture inventories all **130 installed atlas application tables** and compares full ordered JSON contents without omitting fields. All **11 read phases** preserve every table exactly. All **17 mutation phases** match explicit table names and exact row additions/removals. Existing rows in append-only tables remain byte-equivalent.

The complete journey changes only:

| Table | Expected net change |
|---|---|
| `atlas_ownership.event` | Five append-only events |
| `atlas_ownership_lifecycle.transition` | Five append-only transitions |
| `atlas_ownership_proof.bundle` | Three append-only bundles |
| `atlas_ownership_proof.object` | Three append-only object manifests |
| `atlas_ownership_proof.upload_lease` | Three append-only leases |
| `atlas_ownership_proof.retained` | Three append-only trusted observations |
| `atlas_ownership_proof.consumption` | Three append-only consumption records |
| `atlas_customer.CustomerAccount` | One explicitly targeted synthetic recipient `revokedAt` update; the row census records one old/new row pair, not an account deletion |

All other grading, reports, publications, media, market/provider, auth, commerce, evidence-policy and reviewer-authority table contents match the post-setup baseline. Synthetic policies/grants/card records are installed before that baseline and are never described as operational choices. Each phase retains per-table row counts and hashes.

Node22.16.0/PostgreSQL17 qualification PG01 exited zero with six passing groups. Exact owned cluster `/private/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/atlas-staff-db-ccAyhV` stopped in `finally`; `stoppedVerified:true`, retained shutdown logs and absence of the owned data directory/postmaster PID corroborate cleanup. There were no failed attempts or reruns for this fixture.

Private evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-collection-journey-pg-01/`.

| Evidence | SHA256 |
|---|---|
| `postgres-result.json` | `55e35919a223a1229aaeafa349852d126e86c173f87792af7ea65ebfb17403e0` |
| `cleanup.json` | `02a8aa070313546d40726de50d42b2b170591cc83624a3386185df1bf84b665c` |
| `validation.log` | `3990299176a4c48ed8c8c659934587a0b3d05be4aa171c6b1d741bfc0815bdca` |
| `postgres.log` | `95784d49b8be180449d9d26e73593fdf3a1e856203a1ebab5c14e6f74ebcd623` |

Independent source and receipt review passed: all25 current/retained source pins match, the reviewer traced actual service/SQL and HTTP/client assertions, verified all11 read phases and17 mutation phases, and confirmed eight changed versus122 unchanged tables over the complete journey. Exact owned-cluster shutdown logs and absent postmaster PID were checked. The reviewer made no test reruns, connections or external effects and found no concrete blocker.

## Limits

Retained observations are explicitly trusted synthetic fixtures. This does not qualify real uploaded proof, authenticity, private storage/CORS/version semantics, decoder isolation, evidence delivery/deletion, or operational proof/retention/reviewer policy. The in-process bridge does not activate or qualify production customer routing, trusted runtime composition, actual browser usability or live customer ownership. No production queries, paid providers, storage, notification, financial or grading-workflow effects occurred. Current exact-approved customer media joins, privacy/settings writes, customer provenance and authenticated curation integration remain separate R1 work.
