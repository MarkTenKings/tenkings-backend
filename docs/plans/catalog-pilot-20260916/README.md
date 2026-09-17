# Real-source pilot preparation

This directory contains small manufacturer-backed discovery records and an **offline preparation compiler**. It does not submit an import, stage bytes, authenticate a reviewer, grant usage rights or publish anything.

## Current concrete result

Source PDFs remain outside Git at `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-catalog-pilot-sources`. Their original hashes are pinned in `source-manifest.draft.json` and in the compiler's narrow source recipe. The recipe covers three Big Kahuna card identities and four English Legendary Treasures entries. It deliberately leaves sports card/parallel combinations unknown. Pokémon relationships describe literal checklist markers, with unresolved physical finish and scope.

`prepared-sports-implementation/preparation.json` and `prepared-pokemon-implementation/preparation.json` in that external directory were generated from verified **real source bytes**. They contain source/page/hash facts, proposed card/printing rows and per-card supported/unknown markers without fabricated database IDs. No loadable publication packet was generated.

On September 16, a bounded transaction with `transaction_read_only=on` inspected the documented Ten Kings managed PostgreSQL target through its existing service runtime. No credential was printed, copied or stored. This is a managed-database observation; fresh parity with the currently serving frontend was not established by this lane.

- Exact sports set `2023_Bowman_University_Chrome_Football` exists, with an active APPROVED draft and latest clean version 6. The Big Kahuna program and `TBK-1`, `TBK-2`, `TBK-3` rows match the manufacturer names/numbers.
- That sports set has **no SetParallel rows**. Its six source rows are `TRUSTED_SECONDARY` with null source URLs. None satisfies the new host's required official source classification and exact URL for these PDFs.
- Family-name searches found no Legendary Treasures draft or card rows. This does not rule out every possible historical alias.
- The scoped IDs and observations are retained in external `managed-db-observation.json`. No production taxonomy change occurred.

These are specific prerequisites for normal clean import/reconciliation. Do not relabel an old secondary source as official, create source IDs in JSON, or substitute Sapphire's draft merely to make a manifest validate. The original source artifact, URL/classification, card/program/parallel/scope rows, clean draft/version and human review must genuinely agree.

## Prepare now without database access

From the repository root, use an unused output directory outside Git:

```sh
node docs/plans/catalog-pilot-20260916/prepare-pilot.mjs \
  --pilot sports --out /absolute/private/unused-sports-output

node docs/plans/catalog-pilot-20260916/prepare-pilot.mjs \
  --pilot pokemon --out /absolute/private/unused-pokemon-output
```

The compiler verifies the exact three local PDF byte streams against pinned URLs, sizes and SHA-256 values. It emits unreviewed source facts, explicit row relationships and missing prerequisites. Files are create-new, mode 0600; it refuses to overwrite an earlier preparation. Source files are not copied into the output or repository.

## Real taxonomy and reviewer workflow

The new **Download taxonomy mapping** button in the shared-evidence panel calls `GET /api/admin/set-ops/catalog/taxonomy?setId=...` with the ordinary human session. It requires the reviewer role and enabled catalog feature. This endpoint reads one repeatable, read-only database snapshot with explicit field selects. It exports exact current draft/version, latest publication identity, canonical source URLs/classifications and program/card/parallel/variation/scope IDs. Credential-bearing, query/fragment and non-HTTPS source URLs are withheld with an explicit status. It includes preparation blockers, excludes raw source/media payloads and actor data, and refuses collections over 5,000 rows or snapshots over 2 MiB rather than silently truncating them. It is **not** catalog approval or a rights grant.

The previous draft reader exposes cleaned draft rows rather than the entire required taxonomy, and the live browser check was signed out. No session token or hidden browser state was inspected. After qualified deployment and ordinary sign-in, an operator can download this mapping for the exact existing set.

1. Complete the missing clean SetOps source/taxonomy preparation through the existing workflow. Sports needs official checklist/odds source rows with the exact URLs in the source manifest and the explicitly scoped printing vocabulary. Legendary Treasures needs its exact source-backed set/program/card/printing structure. Review applicability separately; never seed every possible card/parallel combination as supported.
2. Download the new taxonomy export. Run the compiler with `--taxonomy /path/to/export.json`. Once the draft is active, approved and clean, it emits `selection.template.json` containing null slots to fill with exact exported IDs. There is no fuzzy automatic row choice.
3. Supply `--selection /path/to/completed-selection.json`. This yields `candidate-manifest.unreviewed.json` only when every exact row and source mapping agrees. The narrow recipe expects its documented program/printing labels and unknown format/channel dimensions; incompatible existing taxonomy stops for explicit reconciliation. It preserves the actual draft version/hash and next revision/predecessor.
4. Supply a separate `--grants /path/to/actual-grants.json` only when each source's actual reuse basis is documented. Its top-level keys are the source IDs; each value contains `basis` (`licensed` or `permission`), a specific `detail` describing rights holder/evidence/scope, and the permitted `consumers` (`inventory`, `atlas`, or both). No example grant is provided because none was established. Public accessibility and downloading the manufacturer PDF are not an `owned_original` grant under this host contract.
5. Only with the complete mapping and supplied grant roster does the compiler emit `review-packet.unreviewed.json` in the exact UI shape `{manifest, reviewEvidence}`. Stage the three referenced original PDF files as needed in the authenticated review UI. The compiler already names each one as `catalog:sha256:<exact-byte-hash>`; it performs no upload itself. These files fit the host's 4 MiB per-artifact limit.
6. Load that packet and validate in the UI. The server independently rechecks staged bytes, exact taxonomy URLs/classifications/IDs, eligibility, revision and permissions. The human must inspect the original PDFs, full proposed rows, source/page notes, unknown scope/applicability and actual grant evidence. Only that human review can issue the separate publication action. This tool never emits its acknowledgement or calls publication APIs.

A checksum on the downloaded export catches damage; it is not a signature or proof of live authority. The compiler's structural validation also cannot prove a supplied permission statement is true. Both are independently rechecked at the host/human boundary.

## Applicability and image limits

- Sports: the odds sheet provides program vocabulary and serial-denominator facts. All nine selected card/printing relations remain `unknown`; channel/format/edition/language are unresolved. No serial `VARIOUS` row is assigned a made-up denominator.
- Pokémon: `6` and `7` carry standard/parallel-set markers; `RC1` and `RC2` carry the standard-set marker. Parallel-set applicability for the RC rows remains `unknown`, not excluded. These source markers do not establish the physical card's finish. No `6/113` or `RC1/RC25` alias is invented from a checklist that does not print those denominators.
- All images are absent, and image coverage is `unknown`. There is no eligible source image or demonstrated image grant. Scope fields remain null where evidence is missing, so the actual shared lookup continues to return effective applicability `unknown` even where a literal source-row relationship is recorded as supported.
- No synthetic fixture reviewer or host row from tests is written to a real review packet. Real two-way Inventory/Atlas reuse, image acceptance and accuracy acceptance remain separate.

## Validation

```sh
node --test docs/plans/catalog-pilot-20260916/prepare-pilot.test.mjs
cd frontend/nextjs-app
node node_modules/tsx/dist/cli.mjs --test tests/setCatalogTaxonomyExport.test.ts
```

Observed: compiler **9/9** tests pass; taxonomy exporter **1/1** test passes; scoped lint passes. Tests exercise the actual shared manifest/lookup contract using clearly synthetic taxonomy IDs, source-pinned factual recipes, damaged bytes, forged source classifications, wrong product/number/scope, exact history, unknown relationships and missing grants. The exporter test checks read-only transaction order, exact field selection, bounds, hash, disabled/static-session denial. These are not production or real-human-publication tests. No heavy DB writer run was added during the concurrent intake benchmark; root owns integrated release qualification.
