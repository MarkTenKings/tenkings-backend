# Pokémon source binding decision — unsubmitted

## Decision and scope

Prepare **a new SetOps key** `Black & White-Legendary Treasures`, retaining **Black & White—Legendary Treasures** as the source/display label. Use one parent program labeled `Black & White-Legendary Treasures`; the existing normalizer derives `black-white-legendary-treasures`. This is a proposed identity for a future normal import, not an existing database row. No draft ID, program row ID, card row ID, import, alias, review or publication was created here.

The root-executed managed metadata audit completed at `2026-09-17T04:10:36.594Z` in 2.489 seconds, using an explicitly read-only RepeatableRead transaction. Its complete distinct-key roster contained **242/242** keys, with no cap, field or output truncation and no missing tables/columns. Inspection of the entire roster found sports products and no equivalent Pokémon identity or proposed exact key. Relevant draft, ingestion, source, card, legacy variant, reference-pair and published-alias queries returned zero rows. All 34 broad program matches were sports uses of Legendary/Treasures/Black & White. These are scoped database observations, not a universal semantic absence claim.

- Managed receipt: `/private/tmp/tk-pokemon-canonical-audit-20260916.AeI6FZ/managed-report.json`; SHA-256 `9c1a77a7993b8fd49f360e7d4ea82285845a83d80cd03ae5f102c22d70c55495`.
- The earlier auth-service-database receipt at `report.json` is explicitly incomplete because tables were missing. It is not evidence for this decision. Root reran against the documented managed connection through `infra-bytebot-lite-service-1`, without exporting credentials.
- Full metadata remains outside Git; this document contains the mapping conclusion and receipt pin only. Root executed the audit; preparation of this source change made no database call.

## Exact source and generated request

The unchanged source transcription is `pokemon-complete-checklist.unreviewed.json`, SHA-256 **`e318dad8f283abb15c8d0a65736c81f1744a9d681c9bc3375836481c4d6345c1`**. Its pinned English checklist PDF remains SHA-256 `d597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923`, 2,227,474 bytes. The new preparation function requires those exact transcription bytes; it does not reacquire or attest the PDF bytes.

`pokemon-complete-import.unreviewed.json` is a generated **unsubmitted API request wrapper**, SHA-256 `a36171566277e391764aae473df273a3c5fe26e54d4faa53d7802c2843d65a21`. Only its `requestDraft` member has the shape of the existing `POST /api/admin/set-ops/ingestion` request. The wrapper is not an import command or authorization. It contains all **138 printed rows**, 1–113 and RC1–RC25, under the one parent program. `setId`, `sourceFetchMeta.setId`, raw-payload set identity and compiler recipe use the same normalized key. The em dash remains in display/source text. There are no fabricated database UUIDs.

Regenerate only the new wrapper by reading the unchanged transcription bytes and calling the exported pure `prepareCompletePokemonChecklist` function in `prepare-pilot.mjs`. The generated artifact is tested for exact equality with that function's result. Existing four-card import/preparation artifacts remain historical and unmodified; their old em-dash set key is not the new canonical binding.

## Evidence that stays unresolved

The source page has no separately named RC program, so this preparation creates none. RC prefixes, every printed name, checklist symbol and rarity label are retained literally, including RC11's `rare` label. Physical finish, collector denominators, edition, format, channel and odds are not inferred. The adapter returns card/program identities only, with no parallels, scopes, variations or odds rows. Source pins remain provenance checks, not transcription verification, source-byte attestation, reuse permission or human review.

The shared publication compiler continues to select only `6`, `7`, `RC1`, `RC2`; the complete worksheet does not enlarge that publication selection. Its recipe now matches the normalized SetOps set/program spelling while preserving the original display label. Real taxonomy IDs, appropriate printing/scope evidence, manufacturer reuse grants and authenticated human review/publication remain separate prerequisites. No quality threshold or original-input guard was weakened.

## Qualification

Focused Node 22 checks cover all 138 rows through the existing normalization, quality evaluator, original-input validation and adapter, plus rejected wrong set/provenance. Compiler checks cover normalized-key acceptance, display preservation, wrong-key/program rejection, immutable transcription bytes and exact generated artifact. Raw logs are under `/private/tmp/tk-pokemon-binding-20260916-5x73rsv0/`. No broad test suite, typecheck, build, installation, deployment or import was run for this source-only change.
