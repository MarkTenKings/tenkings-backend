# Big Kahuna additive taxonomy preparation — unsubmitted

Prepared 2026-09-17 from the existing pinned PDFs and the completed read-only metadata export. No database/API call, import, upload, approval, publication, grant or runtime change was performed by this preparation. The original 550-row transcription, source PDFs, reconciliation and selected-pilot packet are unchanged.

## Decision

The three-card sports publication pilot can continue without resolving the 171 unnumbered source rows or replacing the 379-card catalog. The missing identity mappings are a small additive change: **two official source rows, three parallel rows and three program-scope rows**. The nine selected card/printing relations stay **unknown**.

There is no existing authenticated endpoint that safely performs only those eight creates. The deliverable is therefore a **pure preparation planner and an unsubmitted operation proposal**, not a request accepted by an existing API. `executable` is false, `request` and `writer` are null, and no new database row ID is invented.

### Why the existing import is unsuitable

Actual source behavior takes precedence over a generic suggestion to import the three-row recipe:

- `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts` queues an ingestion job and upserts the set draft. It does not create taxonomy source/parallel/scope mappings by itself.
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts` invokes taxonomy ingestion, creates another `SetDraftVersion`, changes the draft to `REVIEW_REQUIRED` and updates the ingestion job. This is not a source-only route.
- `frontend/nextjs-app/lib/server/taxonomyV2Core.ts`, `ingestTaxonomyV2FromIngestionJob`, creates a source and runs program, card, parallel and scope upserts for adapter output; approved/no-job ingestions may also materialize legacy bridges. The pinned checklist adapter currently emits programs/cards and no parallel/scope/odds rows. The legacy backfill also creates cards/programs and classifies its source as secondary.
- `setCatalogEvidence.ts` validates existing canonical mappings during publication. It does not create the missing source/parallel/scope rows.

No existing ingest path was invoked or mocked as if it provided a narrower guarantee.

## Exact proposed mappings

Existing set: `2023_Bowman_University_Chrome_Football`.

Existing program: `THE BIG KAHUNA`, key `the-big-kahuna`, row `0f33785b-11d2-4abe-abb8-ad567a1a63ab`.

| Selected card | Existing canonical card ID |
| --- | --- |
| TBK-1 Caleb Williams | `e5d38533-201e-4e4e-9d9b-11bc368050a7` |
| TBK-2 Drake Maye | `aa34c51c-adee-4272-bea0-d8f7ca3ab8a1` |
| TBK-3 JJ McCarthy | `d6dde801-2673-46e1-8830-5d810b0c9ade` |

| New source mapping | Exact source URL | Taxonomy kind / artifact |
| --- | --- | --- |
| sports-checklist | https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf | `OFFICIAL_CHECKLIST` / `CHECKLIST` |
| sports-odds-round2 | https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFootballRound2Odds.pdf | `OFFICIAL_ODDS` / `ODDS` |

The manifest continues to classify the odds PDF as `OFFICIAL_PRODUCT`; the current publication validator explicitly accepts `OFFICIAL_ODDS` as its taxonomy mapping. These are proposed new official rows; none of the six existing URL-less secondary rows is relabeled.

| Printing vocabulary | Proposed `parallelId` | Denominator | Proposed `scopeKey` |
| --- | --- | --- | --- |
| THE BIG KAHUNA | `the-big-kahuna` | null | `the-big-kahuna::the-big-kahuna::none::any::any` |
| Orange Refractor | `orange-refractor` | 25 | `the-big-kahuna::orange-refractor::none::any::any` |
| Superfractor | `superfractor` | 1 | `the-big-kahuna::superfractor::none::any::any` |

These ASCII keys follow the existing `normalizeParallelId` and `upsertScope` conventions. The helper's ASCII conversion is deliberately limited to the three immutable labels; it is not a general normalization replacement. The actual existing compiler accepts these labels and denominators.

Every scope uses the existing Big Kahuna program, with null variation/format/channel. `none` and `any` are the existing scope-key sentinels; they do not establish universal applicability. Language and edition remain null in the subsequent publication mapping. Parallel `serialText`, `finishFamily` and `visualCuesJson` remain null. No `SetOddsByFormat` rows, per-format odds, image diagnostics, finish facts or card-level applicability are inferred.

The literal checklist page-10 rows and odds page-2 lines are carried in source metadata. Checklist evidence supplies the three existing identities. Odds evidence supplies program vocabulary and the printed 25/1 denominators only. All three-card × three-printing relations retain `status: unknown`, `printingId: null` and `sourceIds: []` until actual publication IDs and separately reviewed evidence exist.

## Lifecycle gap that must be handled before a writer

`taxonomyV2Core.ts` treats `SetTaxonomySource.ingestionJobId = null` as published; a non-null source is visible through those readers when its ingestion job is `APPROVED`. Thus null is not a harmless unreviewed staging value.

The proposal leaves two explicit, required pending-ingestion bindings unresolved. They must identify distinct real pending jobs for these exact source URLs, set and byte pins. Existing secondary or approved ingestion jobs cannot be borrowed. Their IDs are neither fabricated nor included in source scalar data. The `source:*`, `parallel:*`, `scope:*` and `pending-ingestion:*` strings are **document-local operation references**, never canonical database IDs. The operation `data` fields must not be submitted directly to Prisma: required bindings and lifecycle review are part of the proposal, not optional fields.

There is a second concrete constraint: `pages/api/admin/set-ops/approval.ts` bulk-approves pending jobs attached to a draft. An unrelated generic draft approval must not accidentally release these source mappings. Creating pending jobs alone does not resolve that lifecycle coupling. The future additive integration needs deliberate exact-source-job review/isolation; no staging job or approval API is invoked here.

## Planner guarantees and limits

`sports-additive-taxonomy-preparation.mjs` imports only Node hashing and the existing pure canonical-JSON helper. It has no database client, network, filesystem reader, environment access, authorization logic or executor.

It:

- Requires the exact previously prepared selected-pilot packet bytes and verifies both local source byte hashes/sizes.
- Requires the exact-set read-only snapshot envelope and complete count-accounted sections. Missing, truncated, withheld or miscounted rows produce conflicts with zero operations.
- Checks the current proposal's existing draft/version, selected program/card IDs, numbers and names; a changed baseline or active seed/replacement work returns zero operations.
- Preserves metadata digests/counts for every observed section, including all 379 cards, ten programs and six draft versions. Those digests concern the exported metadata, not unread raw draft `dataJson`.
- Proposes only `create` on `SetTaxonomySource`, `SetParallel` and `SetParallelScope`. No card/program/variation/draft/version/bridge/odds/publication operation exists.
- Rejects an already occupied exact source URL regardless of classification, an occupied parallel key/normalized ASCII label, or an occupied scope key/tuple. Apparent compatibility is not permission to update, silently reuse or reclassify it. Reconcile an occupied target separately and prepare a new reviewed proposal.
- Leaves grants/reviewer absent, human approval false, server staging unverified and all nine applicability relations unknown.

This is preparation from a dated observation, not a race-safe writer, rights determination or publication approval. It cannot protect against concurrent database changes by itself. The snapshot's absence result is exact to its enumerated set and time; it says nothing about semantically equivalent rows in other sets. It is not converted into a fabricated authenticated `setops-catalog-taxonomy-export/v1` file.

## Smallest next integration

1. Add a narrowly scoped human-authenticated SetOps composition path for this source/printing mapping, using the existing current-human role checks and audit conventions. Keep this preparer offline; do not route the proposal through generic draft/build or backfill.
2. At actual preparation/review, reread the exact set and target keys in a bounded transaction; revalidate selected IDs, source bytes, lifecycle bindings and all relevant baseline guards. Resolve pending-job isolation and exact-source review explicitly before persisting anything. A concurrent occupied key must abort/replan, not invoke an upsert. Source URL lacks a database unique constraint, so future integration also needs a per-set serialization/locking strategy before source creates.
3. When that integration is reviewed, persist only the approved additive mapping and retain the created row IDs. Leave all existing card/program/source rows, draft versions and legacy history untouched; return an audit receipt and a fresh normal authenticated taxonomy export. No database execution is authorized by this file alone.
4. Feed the real new source/parallel/scope IDs into the three-card compiler selection. Verify staged pinned source bytes through the current review path and supply actual reviewer evidence. The current compiler/media contract also requires a source-grant field; that implementation constraint needs a separate factual-source versus image-rights audit and is not evidence of an owner requirement to obtain a manufacturer license for card names/numbers. Do not fabricate a grant. Use the existing human preview/publication lifecycle with fresh version/revision guards. No image coverage is claimed. All nine relations may remain unknown; they are not a prerequisite for partial text publication.

Resolving the other 376 numbered cards or assigning numbers to any of the 171 unnumbered rows is not required for this bounded pilot.

## Inputs and verification

The raw managed snapshot remains outside Git at `/private/tmp/tk-sports-reconciliation-20260917.PGawem/managed-snapshot.json`, SHA-256 `c042a3fd5b1c5fb25c8bc218f7125663fca49ab29382d8a97d4fdce9b0523bdc`, observed `2026-09-17T10:21:53.256Z`. It contains six sources, zero parallels and zero scopes for this exact set. Its byte hash was verified before generation; the proposal also records a separate canonical-JSON snapshot digest and per-section metadata digests.

Protected input pins:

- Selected packet: `3b27da05143c281ca3bf1905b22d19bb4c57e306caeefdea7582fb6be07c6664`.
- Checklist PDF, 529,104 bytes: `bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca`.
- Odds PDF, 265,208 bytes: `72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5`.
- Complete transcription: `f952b5d5c236c61921eebc2b13bfaead71c15867e3ba2f083fc0cac15ce5fdbf`.

Run only the focused pure suite with the qualified Node 22 binary:

```sh
env -i PATH=/usr/bin:/bin /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --test docs/plans/catalog-pilot-20260916/sports-additive-taxonomy-preparation.test.mjs
```

The nine tests cover create-only models/actions, input preservation, unresolved lifecycle bindings, source/printing conflicts, complete-count guards, wrong IDs/pins, unknown applicability and the generated actual proposal. Synthetic ancillary fixture IDs are explicitly labeled; the generated proposal uses the real managed snapshot. Scoped ESLint checks `no-undef`, `no-unused-vars` and `no-unreachable` for the two new modules. Raw logs are outside Git in `/private/tmp/tk-sports-reconciliation-20260917.PGawem/` as `additive-preparation-tests-final.log` and `additive-preparation-lint.log`.

Prepared artifact hashes:

- Helper: `7dd8b7982de06b4998248ab610597966c3ab462d721ce23d7e9c00ebaa51661e`.
- Tests: `e8bb7d60b25be3d363531578ddcb1fe882e47315f95f94ba433cd26da2355efc`.
- Unsubmitted proposal: `4484129eabafbad247c8be01bde777b389ee2071cc28e64de4834e1b8796db04`.
