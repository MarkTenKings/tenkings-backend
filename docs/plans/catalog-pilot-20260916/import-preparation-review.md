# Two-pilot import preparation and observed parser gaps

September 16, 2026. Read-only application review at `12e13992cd341eeea96dbe0955cc4dbfba67bc1d`; exact inspected source hashes are in the parser report. **Unsubmitted drafts only. No import, database write, grant, image acquisition, approval or publication occurred.** This continuation preserves the [source packet](../2026-09-16-catalog-pilot-source-packet.md) and [offline compiler](README.md); it does not change their recipes or expand their evidence.

## Prepared artifacts

| File | Concrete contents | SHA-256 |
| --- | --- | --- |
| [Import draft](import-preparation.unreviewed.json) | Four nested request drafts: three Big Kahuna identities, three sports printing labels, four Legendary Treasures identities, two literal Pokémon checklist markers. Every draft retains the exact manufacturer URL, complete PDF hash/size, page, source-manifest hash, narrow coverage and unresolved dimensions. | `b4a011058e0d63e30f5a7aabd911757021dfe46f3122d4677b2aeec6028e3e17` |
| [Parser report](import-parser-report.json) | Actual pure ingestion-adaptation → normalization → quality → taxonomy-projection → eligible-adapter results, plus exact source/code hashes. | `7be2c26ea78cc151b7ba4529f146806312b1d5daf4a54e3ffe304d457c7be3c8` |
| [Mapping reconciliation](mapping-reconciliation.unreviewed.json) | Existing bounded managed-DB observation, its byte hash/time/query limits, historically observed sports IDs, and explicit null slots for missing mappings. | `04694eea13e35f257030712b87764beaf254dc05f7245e1cf8ddd2f7162a3264` |

The import file is a review wrapper, **not** an API request or publication packet. Its `requestDraft` members describe the existing ingestion contract for review; the wrapper remains `BLOCKED_DO_NOT_SUBMIT`. The Pokémon set label is proposed source-derived text, not a fabricated existing set ID. Historical sports IDs are reconciliation leads, not a fresh authenticated taxonomy export.

All three original PDFs were rehashed against the existing compiler pins. They remain outside Git; no source bytes were recopied. No network, provider, database, build, browser or heavy test operation was performed. A single 0.22-second pure-function probe produced the report without importing or invoking the database writer. Importing the existing database package for enums did not call a query.

## Actual path results

| Draft | Rows | Blocking normalization errors | Quality | Canonical adapter result |
| --- | ---: | ---: | --- | --- |
| Sports checklist | 3 | 0 | 76.92, WARN | No eligible adapter: manufacturer eligibility explicitly rejects `PLAYER_WORKSHEET`. |
| Sports printing vocabulary | 3 | 0 | 64.10, REJECT | Counterfactual adapter probe retains Orange Refractor and Superfractor; ordinary Big Kahuna is lost. Normal build stops at quality rejection first. |
| Pokémon checklist | 4 | 0 | 76.92, WARN | No eligible adapter: worksheet exclusion and no registered Pokémon adapter. |
| Pokémon marker vocabulary | 2 | 0 | 53.85, REJECT | No eligible Pokémon adapter; normal build also stops at quality rejection. |

The quality threshold is 70. None was changed, forged or bypassed. A WARN for the selected checklist rows is not proof that these rows form a complete replacement for an existing set.

### 1. Checklist taxonomy currently cannot use the normal adapter path

`frontend/nextjs-app/lib/server/taxonomyV2ManufacturerAdapter.ts`, `canRunManufacturerAdapter`, immediately returns false for `PLAYER_WORKSHEET`. All three registered manufacturer adapters use that helper. Thus even the genuine Topps checklist request—with accurate `sourceProvider: "Topps"` and its manufacturer-linked Shopify URL—cannot create the required official checklist/card taxonomy through `drafts/build`.

`frontend/nextjs-app/lib/server/taxonomyV2Core.ts`, `createAdapterOutput`, registers only Topps, Panini and Upper Deck. On no eligible adapter, the writer would create an `adapter-missing` **TRUSTED_SECONDARY** source and ambiguity; it does not create the required official rows. This branch was inspected, not executed. Do not mislabel Pokémon as another provider, use a dummy parallel dataset, or relabel an old secondary source to force acceptance.

### 2. Unnumbered printing vocabulary is lost during projection

`frontend/nextjs-app/lib/server/setOpsDrafts.ts`, `normalizeDraftRows`, correctly retains a no-odds/no-serial row carrying `parallelCatalog: true`. However, `buildTaxonomyIngestRows` omits that flag. `buildManufacturerTaxonomyAdapterOutput` then drops an ordinary `PARALLEL_DB` row without odds/serial/catalog signal. The prepared sports input has three labels; its projected eligible adapter output has two.

The probe deliberately supplies no invented odds, denominator, format or channel. Serial `/25` and `/1` remain serial facts. Existing adapter output also carries those literal serial strings in its odds-row representation; they must not be presented as published pack odds. The new shared-catalog recipe uses printing vocabulary/serial evidence and leaves sports per-card applicability unknown.

### 3. Existing odds-oriented quality rules reject these small catalogs

`frontend/nextjs-app/lib/server/setOpsCsvContract.ts`, `evaluateDraftQuality`, measures card count, published odds/serial coverage and program coverage. The three sports labels score 64.10; the two Pokémon markers score 53.85. The sparse-catalog adjustment requires at least 15 rows and at least one published-odds/serial row. Replicating labels across cards to inflate row count or inventing odds would corrupt the evidence and is not a remedy.

Partial **evidence-publication coverage** is approved, but this does not override existing full SetOps import/approval guards. These draft examples are therefore useful parser fixtures and a human review packet, not an executable full-set import.

## Smallest implementation needed before an authorized import

No application changes are included in this packet. A bounded follow-up should:

1. Preserve the explicit catalog-only signal through `SetOpsTaxonomyIngestRow` and `buildTaxonomyIngestRows`. Verify a source-backed ordinary row survives with null odds/serial/format/channel, while a signal-free row remains rejected.
2. Add a genuine checklist ingestion route through the existing adapter contract, removing the blanket worksheet exclusion only with explicit source/manufacturer qualification and tests. Add a Pokémon adapter to the existing registry for the exact official source family. Do not permit provider text alone to manufacture official authority; preserve the recorded source URL, artifact hash, ingestion linkage and human review.
3. Decide how source-backed **marker/printing catalogs without published odds** enter canonical taxonomy under a documented quality contract. Keep the existing 70 threshold and legacy full-set path intact. If a separate bounded catalog-preparation route is chosen, it must validate exact immutable sources and selected rows, remain unreviewed, preserve the existing approved full-set version, and require the same authorized final publication review. Do not quietly treat this report as authorization to introduce that new route or weaken the existing one.

Focused acceptance should replay these exact four drafts, assert zero invented rows/IDs/dimensions, preserve `TBK-` and `RC` numbers and duplicate-name separation, retain all provenance metadata and ordinary vocabulary, reject an unrelated/secondary source, and keep unknown applicability intact. Writer/API qualification must then show what changes before approval and that no catalog publication follows from a draft build. Root owns that implementation decision and qualification.

## Full-source alternative within the same two products

Preparing the full official checklist is a legitimate alternative to treating isolated examples as a full SetOps draft, but does **not** fix missing adapters by itself.

- **Sports:** the complete 18-page checklist and Round 2 odds PDF are already pinned. A full source-preserving transcription can retain all checklist programs/cards and each actually published odds column. Earlier extraction found text on only 12 checklist pages, so all 18 pages need visual coverage review; six pages cannot be silently omitted. Keep Hobby/VB SE/Delight columns and Round 2 scope explicit, and leave `VARIOUS` serial counts unresolved. Reconcile against the current approved sports version instead of replacing it with three cards. Actual full-input normalization/quality must be measured before submission; this pass did not perform that broader parsing or claim a pass.
- **Pokémon:** the one-page official English checklist makes a complete manual transcription practical. Preserve every printed number, duplicate name and the three separate legend symbols; do not derive denominators or physical finishes. This supplies complete source-row membership, not completeness across languages/editions/later printings. It still needs a genuine Pokémon/checklist adapter and a legitimate no-odds marker-catalog path. More card rows cannot cure an unsupported manufacturer or justify padding the two printing labels.

Once a complete clean draft is actually reviewed, the shared evidence manifest may still intentionally publish only the bounded selected identities with `coverage: partial`. Full SetOps preparation and partial shared evidence are separate decisions.

## Exact remaining host and review inputs

1. A qualified host exposing `GET /api/admin/set-ops/catalog/taxonomy?setId=...`, with the catalog feature enabled for the authorized ordinary human reviewer. The main-only site preview is not evidence that catalog APIs are deployed/enabled. Root owns host qualification and normal sign-in; no session or credential was accessed here.
2. The exact current sports export for `2023_Bowman_University_Chrome_Football`, including full source/program/card/parallel/scope rosters, clean active approved latest version/hash, publication predecessor and any active seed/replacement blockers. The historical observation found no parallels and six secondary URL-less sources; it is not the export format and must not be converted into a fake one.
3. Exact alias/set reconciliation for Legendary Treasures, followed by genuine canonical rows and an approved clean draft. The earlier bounded family-name search found zero matches, which is not proof that no alias exists.
4. Actual documented permission/license for each manufacturer PDF and intended consumer. No reuse grant has been supplied. Human review of the complete identity/source/scope packet remains required. Images are absent and have no grant; image-reference acquisition/review and later two-app reuse acceptance remain separate.

After these inputs exist, use the unchanged `prepare-pilot.mjs` workflow: exact taxonomy export → explicit real-row selection → candidate manifest → actual grant roster → loadable unreviewed packet → authenticated human review/publication. Preserve all nine sports card/printing relations as unknown; Pokémon positive relations describe only literal checklist markers. Missing RC parallel markers are unknown, not exclusion.

## Mutation boundary

`POST /api/admin/set-ops/ingestion` creates a draft/job. `POST /api/admin/set-ops/drafts/build` may create canonical taxonomy before approval; it creates a latest draft version from that job's rows and sets the existing draft to `REVIEW_REQUIRED`. A rejected build still updates the job/audit. The batch tool's “preflight” is therefore not a read-only preview of these artifacts. None was called. Do not submit the three-card sports draft casually against the existing approved full set or use it as a replacement/seed payload.

Only the four new files in this directory are this lane's deliverable. Parent owns the canonical handoff/log update and any next implementation or live action.


## Subsequent implementation — 2026-09-16

The observations above are preserved as the initial12e13992 parser evidence. A later source-only slice now carries the catalog signal through projection and adds a bounded adapter for the exact pinned sports checklist. Pokémon binding remains disabled pending canonical-set reconciliation. Every original row is validated before legacy deduplication, and the central writer independently requires original input and recomputes the projected rows before opening its transaction. Alternate-entry and forged-validation-marker bypasses are rejected.

Twelve focused tests and scoped lint pass, including rejected API input with zero writer calls and a valid build through an in-memory transaction; independent static review passes. These checks do not qualify an actual managed-database import. No source row, approval, reuse grant, image or publication has been written. The complete138-entry Pokémon printed roster is separately prepared in `pokemon-complete-checklist.unreviewed.json`, with no canonical IDs or finish inference. Full sports source review, current canonical exports, source/rights review and actual import acceptance remain open.

A later complete managed metadata audit and [mapping decision](pokemon-mapping-decision.unreviewed.md) now replace the temporary disabled-Pokémon binding described above. The source-only adapter and compiler agree on the new normalized key;22 focused checks pass. The138-row request remains unsubmitted, with no actual taxonomy/import/approval/publication. Original parser observations and four small import drafts remain historical.
