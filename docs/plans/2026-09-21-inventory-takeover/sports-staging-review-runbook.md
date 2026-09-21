# Sports source-bound staging and review

September 21, 2026. This is the next operator sequence for the three-card Big Kahuna pilot. It neither publishes evidence nor records human approval. Root owns the actual qualified release, catalog activation, normal authenticated staging and final readback. The existing [sports audit](sports-pilot.md) retains the transaction, replay, image and preservation constraints.

## Target and source packet

Use `/admin/set-ops-review` on the root-qualified specialist origin containing selection repair `de6fa5b6` and any combined Pokémon release required for this operation. Production and main Preview are now `9a12cd35`, but the main website and configured main Preview intentionally hide this specialist route. **Inventory Preview is not staging-ready: root's fresh metadata shows no branch `DATABASE_URL` record.** Collect Production has working DB/current sports selection repair; root decides the smallest supported operational origin after the qualified combined release. Ordinary human sign-in is required: `reviewer` for preparation and `approver` for publication. No token copying, static operator key or service identity substitutes for that session.

Root first qualifies `SET_CATALOG_EVIDENCE_ENABLED=true`, current compatible schema and the immutable catalog audit trigger on the exact target. Optional research/catalog-consumer flags are independent. Coordinate against direct card/program maintenance, set import/replacement and seeding during the narrow preparation transaction. No new cron owner is needed.

## Live read-only preflight and origin decision — September 21

The supported read path is the existing documented `root@104.131.27.245` SSH connection, streaming bounded JavaScript to `docker exec -i infra-bytebot-lite-service-1 node -`. Instantiate only its installed `@prisma/client`, which consumes the service's normal managed environment internally. First statement of each Repeatable Read transaction is `SET TRANSACTION READ ONLY`; use `SET LOCAL statement_timeout='5000ms'`, `lock_timeout='500ms'` and a bounded interactive-transaction timeout. Select only schema/ledger metadata and the exact two set rosters. Do not source/echo/export credentials, invoke a writer, run migrate/generate, restart containers or use the local qualification database as live authority.

Actual read at **21:04:32 UTC** confirms PG 17.11, read-only isolation, 97 completed active migrations, 13 historical rolled-back rows, zero unfinished migration, no missing/checksum-different local migration, and the clean catalog migration. Eight enabled catalog triggers, including `SetAuditEvent_catalog_immutable`, and both catalog tables' validated constraints are present. At **21:08:02 UTC**, all six live catalog trigger-function bodies also match the checked-in migration. [The sports packet](sports-pilot.md#fresh-operational-preflight--september-21) records exact roster counts, pins and scoped Pokémon absence. There is no demonstrated schema migration needed for this admin capability.

**Environment boundary, from root's fresh normal provider metadata:**

- Inventory branch `codex/staff-inventory-release-20260910` has no `DATABASE_URL` record. Its catalog flag `eZV4k2f9nPp0VGdZ` is false; diagnostic flag is also false. A READY build alone cannot establish its authenticated database readiness.
- Main Preview alone has sensitive branch database override `gLJ9eaLdmnj0jfPV`; Production has existing record `063dBe3leaOSNxMc`. This records metadata IDs, not credential values. Main Preview's specialist-route exclusion remains intentional. The diagnostic qualification host is separately restricted to the existing main branch.
- Storage and OpenAI/SoldComps key metadata target Preview/Production already exists; metadata presence is not photo-byte access, provider success, billing approval or permission to execute a diagnostic.

Root chooses and qualifies the stable specialist origin and exact combined artifact, verifies normal human DB reads there, and only then applies the scoped **admin catalog** flag/build change. Keep `STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE`, `STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED`, sale details/full-resolution and diagnostic execution disabled. Keep `RUN_DB_MIGRATIONS=false`, existing Production/Preview settings outside the chosen delta, and the sole cron owner. The current read does not turn a service credential into a human publication session.

Mutations left undone: environment changes, combined deployment, admin-flag activation, source uploads, preparation writes, Pokémon import, draft approval and catalog publication. Preparation remains unreviewed until the actual human factual/applicability/publication decision; image reuse permission remains separately required. Repeat the service's own bounded plan/snapshot immediately before the authorized preparation, since this observation does not reserve the tables.

The exact set key is `2023_Bowman_University_Chrome_Football`. Existing draft/version are `2e8b2265-edcb-4910-922f-40a6e926ac38` / `52de475c-ee6a-4abf-b148-fffde0ec93af` (version 6, legacy hash `48314036838b6a481e87633c1b659541ca0a158ae91d7145e675fc5fb8292a1b`). Preserve the 379-card, ten-program and six-version rosters.

The source files are already local and unchanged:

| File under `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-catalog-pilot-sources` | Exact bytes | SHA-256 | Human review focus |
| --- | ---: | --- | --- |
| `sports-checklist.pdf` | 529104 | `bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca` | Full original, especially page 10, THE BIG KAHUNA heading and first three rows |
| `sports-odds-round2.pdf` | 265208 | `72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5` | Full original, especially page 2 and the `NumberedTo` column |

Checklist page 10 lists TBK-1 Caleb Williams, TBK-2 Drake Maye and TBK-3 JJ McCarthy. Odds page 2 names THE BIG KAHUNA with no stated denominator, its ORANGE REFRACTOR row numbered to 25 and its SUPERFRACTOR row numbered to 1. These are program vocabulary/denominators. Format pack/box odds, autograph rows and missing cells do not establish any of the nine selected card/printing relationships. Schools are not proposed publication fields. The rest of the product is omitted, not excluded.

This lane rehashed the PDFs and visually inspected both complete cited pages. Its byte-check receipt is `/private/tmp/tenkings-sports-review-preparation-20260921-01/source-bytes-verification.json`. Those checks do not perform Mark's actual source review.

## Normal UI and API sequence

1. Select the existing exact set. Expand **Reviewed shared catalog evidence** and verify the visible catalog target. Do not build or replace its draft.
2. Under **Stage source / image files**, select only the two pinned PDFs. Browser limit is 3 MiB per file, so both fit. The ordinary POST `/api/admin/set-ops/catalog/media` carries `{sha256, bytesBase64}` and returns each `catalog:sha256:<hash>` reference. Both refs must match the table above. This stores private source bytes only.
3. Click **Preview missing mappings**. GET `/api/admin/set-ops/catalog/sports-preparation` takes **no query parameters**. The server checks the stored PDF bytes and exact live baseline. Expect two pending jobs, two sources, three parallels and three scopes. The proposal hash must be `4484129eabafbad247c8be01bde777b389ee2071cc28e64de4834e1b8796db04`; preserve the returned `snapshotSha256`.
4. Click **Prepare pending mappings** once. The UI creates and retains the request before POST. The API body is `{action:"stage",request:{schemaVersion:"setops-sports-additive-preparation-request/v1",idempotencyKey,expectedSnapshotSha256,proposalSha256,acknowledgement:"PREPARE PENDING SPORTS CATALOG MAPPINGS"}}`. Download **Download preparation receipt**. Expect `outcome=recorded` (or exact replay), a `setops-sports-additive-preparation-receipt/v1` receipt, ten distinct created UUIDs and a receipt hash. No card/program/version/image/applicability/publication write is part of this action.
5. For uncertainty, use **Retry same preparation** with the same reviewer and exact retained request. Do not clear storage or create another key. Only the typed exact-key/hash `SPORTS_PREPARATION_SNAPSHOT_STALE` response permits the UI's fresh manual preview path. An occupied target, row drift or other conflict requires reconciliation. Newly created jobs stay `REVIEW_REQUIRED`, `draftId=null`, `parsedAt=null`, `reviewedAt=null`; do not use legacy **Approve** or **Build Draft** on them.
6. Click **Download taxonomy mapping** after stage. The exact read-only path is:

   ```text
   GET /api/admin/set-ops/catalog/taxonomy?setId=2023_Bowman_University_Chrome_Football
   ```

   The normal UI already supplies its authenticated bearer session. The response is `setops-catalog-taxonomy-export/v1`, `authority=unreviewed_taxonomy_snapshot`, with canonical `snapshotSha256`. The exporter uses a Repeatable Read, read-only transaction and rejects oversized/partial exports. Save the genuine download unchanged outside Git as `setops-catalog-taxonomy.json`. A custom SQL observation is not this compiler input. The API is not an unauthenticated browser-address download.
7. Save the stage download as `sports-catalog-preparation-receipt.json` in the same new private operation directory. Check current draft/version, zero blockers and no publication against the export. Check 379 cards and ten programs, and reconcile the complete preserved card/program IDs with the retained baseline. Preparation itself checks all six versions; the taxonomy export includes only the latest version and cannot independently prove the entire six-version roster.

## Fill only genuine mappings

Copy [sports-selection.pending-mapping.template.json](sports-selection.pending-mapping.template.json) into a new private operation directory. It contains these existing IDs, which must still match the fresh export:

| Input key | Existing exact ID |
| --- | --- |
| `programRowId` | `0f33785b-11d2-4abe-abb8-ad567a1a63ab` (`programId=the-big-kahuna`) |
| `cards.TBK-1` | `e5d38533-201e-4e4e-9d9b-11bc368050a7` |
| `cards.TBK-2` | `aa34c51c-adee-4272-bea0-d8f7ca3ab8a1` |
| `cards.TBK-3` | `d6dde801-2673-46e1-8830-5d810b0c9ade` |

The eight null values require the actual stage receipt and export. In the receipt, `receipt.ids.sources` follows `[sports-checklist, sports-odds-round2]`; `receipt.ids.parallels` and `receipt.ids.scopes` follow `[ordinary, orange, superfractor]`. This order is verified in `creationRows` and the fixed preparation plan. Each selected ID must also appear in the genuine export with the following exact meaning; never accept an array position alone:

| Selection | Fresh row identity |
| --- | --- |
| `sources.sports-checklist` | Exact checklist URL from source manifest; `OFFICIAL_CHECKLIST`, `CHECKLIST` |
| `sources.sports-odds-round2` | Exact Round2 URL from source manifest; `OFFICIAL_ODDS`, `ODDS` |
| `printings.ordinary.parallelRowId` | `parallelId=the-big-kahuna`, label THE BIG KAHUNA, denominator null |
| `printings.orange.parallelRowId` | `parallelId=orange-refractor`, label Orange Refractor, denominator 25 |
| `printings.superfractor.parallelRowId` | `parallelId=superfractor`, label Superfractor, denominator 1 |
| Each corresponding `scopeRowId` | Same parallel key, `programId=the-big-kahuna`, `variationId=null`, `formatKey=null`, `channelKey=null` |

Every new parallel/scope `sourceId` must equal the newly created Round2 source UUID. The taxonomy exporter intentionally excludes ingestion-job bindings: use the stage receipt/server replay and root's scoped readback for those bindings rather than pretending this export proves them. Do not borrow a similarly named printing from another program or replace any existing source row. A null remains unresolved until its real row exists.

## Create-new local inputs and compile

From the authoritative repository, create the private input directory and exact template copies once. If this directory already exists, preserve it and choose a different unused suffix; do not overwrite it. This command performs no database or network operation.

```sh
cd /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --input-type=module <<'NODE'
import { mkdir, copyFile, constants } from 'node:fs/promises';
const out = '/private/tmp/tenkings-sports-publication-inputs-20260921-01';
await mkdir(out, { mode: 0o700 });
await copyFile('docs/plans/2026-09-21-inventory-takeover/sports-selection.pending-mapping.template.json', `${out}/selection.pending-mapping.json`, constants.COPYFILE_EXCL);
await copyFile('docs/plans/catalog-pilot-20260916/sports-source-fact-use.proposed.json', `${out}/source-fact-use.proposed.json`, constants.COPYFILE_EXCL);
console.log(out);
NODE
```

Save both genuine downloads there, then fill the eight null fields as above and save a separate `selection.exact.json`. The source-fact-use file is an **unreviewed proposal**, version `setops-catalog-source-fact-use-proposal/v1`; it binds both exact source hashes, `purpose=catalog_facts`, the limited factual scope and consumers `inventory`/`atlas`. No manufacturer ownership/license or image permission is asserted. If the human wants a scope change, edit a new local copy and recompile/revalidate it.

Run the existing offline compiler into another unused output directory:

```sh
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node \
  docs/plans/catalog-pilot-20260916/prepare-pilot.mjs \
  --pilot sports \
  --taxonomy /private/tmp/tenkings-sports-publication-inputs-20260921-01/setops-catalog-taxonomy.json \
  --selection /private/tmp/tenkings-sports-publication-inputs-20260921-01/selection.exact.json \
  --source-fact-use /private/tmp/tenkings-sports-publication-inputs-20260921-01/source-fact-use.proposed.json \
  --out /private/tmp/tenkings-sports-publication-compiled-20260921-01
```

The compiler verifies the exact three source files in the unchanged source manifest, including the retained Pokémon PDF; it includes only the two sports sources in this packet. It independently verifies the taxonomy checksum, all chosen IDs and their identities/classifications, latest approved clean draft, and printing scopes. No placeholder taxonomy should be fabricated to make it run before staging. It writes members with create-new `wx` semantics. Expected outputs are `preparation.json`, `candidate-manifest.unreviewed.json` and `review-packet.unreviewed.json`. Expected console state is `manifestPrepared=true`, `reviewPacketPrepared=true`, `DRAFT_REQUIRES_HUMAN_REVIEW` with the remaining human-review blocker. That blocker is intentional.

## Concrete human review and publication

Load `review-packet.unreviewed.json` using **Load review packet JSON**, then **Validate and prepare full review**. POST `/api/admin/set-ops/catalog/preview` receives the exact `{manifest,reviewEvidence}` packet and makes no publication. The host verifies staged bytes, canonical IDs, latest clean version, source-fact-use V2, current/history pins and complete hashes.

The exact proposed review is one set, one program, three cards, three printings, nine `unknown` applicability entries, two sources, no aliases and no images. Text/applicability coverage stays partial; images stay unknown. All language/edition/format/channel values are null. No physical finish, excluded alternative, full-set completeness, visual diagnostic, image grant or accuracy improvement is claimed.

The actual human approver reviews the complete original PDFs through **Download full source**, the complete manifest sections and **Source classification, fact use and image reuse grants**, including the intended app consumers. Downloads currently use `.bin` filenames; opening the same downloaded bytes as a PDF does not alter evidence. The human then selects the real review acknowledgement in the UI. Automation must not check it or claim the judgment occurred.

**Publish reviewed catalog evidence** is the separate human action. It posts `action=publish`, the full manifest/review evidence, preview `manifestSha256`, `verificationSha256`, `expectedCurrent`, `expectedHistory`, and `PUBLISH REVIEWED CATALOG EVIDENCE` acknowledgement to `/api/admin/set-ops/catalog/publication`. Preserve packet, preview and response privately. The UI does not persist a pending publish request over reload: after an uncertain result, first **Load current publication** and reconcile the exact revision/hashes; do not invent another revision or force old pins current.

Finally, GET `/api/admin/set-ops/catalog/publication?setId=2023_Bowman_University_Chrome_Football` reads the current publication. A read-only POST `/api/admin/set-ops/catalog/lookup` takes its exact `publication` pin and query `{category:"SPORTS",setId:"2023_Bowman_University_Chrome_Football",programId:"the-big-kahuna",cardNumber:"TBK-2"}`. Require the three intended printing candidates, unknown effective applicability, empty images and no exclusion by omission. Root records exact publication/hash readback, preserved source/card/program/version records and isolated pending jobs in SESSION_LOG. Inventory-enabled research behavior and ATLAS's separately owned adapter/different-card acceptance remain distinct work.
