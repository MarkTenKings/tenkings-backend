# Two-set catalog pilot: real manufacturer source packet

Date: September 16, 2026. Preparation base: Inventory `ece8223b`. **Draft source discovery only; no approval, publication, import, or physical-card identity confirmation.**

## Recommended bounded pilot

| Product | Actual demand basis | What this pilot can demonstrate |
| --- | --- | --- |
| **2023 Bowman University Chrome Football** | The [reviewed improvement plan](2026-09-15-variant-and-sold-comps-improvement.md#1-catalog-coverage-is-the-first-structural-blocker) records encountered Drake Maye `TBK-2` and a candidate catalog row in this exact product. This is an existing investigation finding, not a newly verified physical-card identity. | Manufacturer-backed program/number lookup, retained number prefixes, program-specific parallel vocabulary and explicit unresolved applicability. |
| **2013 English Pokémon Black & White—Legendary Treasures** | The same plan explicitly identifies the existing Snivy case and links the official checklist. No private photo or business snapshot was opened for this preparation. | Separate same-name card entries and numbering schemes, source-row finish markers, and honest ambiguity when a number/finish is missing. |

This sports choice combines documented exact demand with accessible checklist **and** odds evidence. It does not optimize coverage of the entire current population: the recorded snapshot has 53 Panini cards among 79 completed jobs. Panini remains the next demand-priority acquisition family. Its [manufacturer checklist index](https://www.paniniamerica.net/checklist.html) was reachable, but no exact demanded Panini product/checklist pair was independently established in this bounded pass. Do not substitute an arbitrary popular Prizm year. Select that next product from a sanitized exact-year/product demand tally and verify its manufacturer material first.

The user-mentioned Psyduck `24/114` is another demand signal; it is **not** identified or added to this pilot. Snivy's documented set link supports the present choice without interpreting a screenshot or inventing an expansion, collector-number denominator, or finish.

## Acquired sources and integrity

All three complete PDF byte streams were retrieved from public manufacturer-controlled locations on September 16. The two Shopify URLs were followed directly from Topps' own [checklist index](https://www.topps.com/pages/checklists) and [odds index](https://www.topps.com/pages/odds). They are manufacturer-linked source artifacts, not third-party checklist summaries.

| ID | Attributed source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `sports-checklist` | [Topps: 2023 Bowman University Chrome Football checklist](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf) | 529,104 | `bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca` |
| `sports-odds-round2` | [Topps: 2023 Bowman U Chrome Football Round 2 odds](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFootballRound2Odds.pdf) | 265,208 | `72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5` |
| `pokemon-checklist` | [Pokémon: English Legendary Treasures checklist](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/bw11_web_cardlist_en.pdf) | 2,227,474 | `d597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923` |

Raw PDFs are retained outside Git in `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-catalog-pilot-sources` (directory 0700, files 0600). Only small metadata/examples belong in the repository:

- [Draft source manifest](catalog-pilot-20260916/source-manifest.draft.json), including exact acquisition timestamps, URLs, content types, local evidence paths and hashes.
- [Manifest byte hash](catalog-pilot-20260916/source-manifest.draft.sha256).
- [Small factual examples](catalog-pilot-20260916/factual-examples.draft.json), bound to that manifest hash.

These are discovery artifacts. Their schema is deliberately **not** the shared package's publication schema. They contain no fabricated SetOps IDs, reviewer, current-publication pointer, or approval claim. A hash verifies bytes, not identity, permission, source completeness, or human approval. Changed downloaded bytes require a new acquisition record and review; the URL alone is not an immutable source pin.

## Sports: supported examples and limits

The checklist's PDF page 10 identifies Drake Maye `TBK-2` under The Big Kahuna, alongside Caleb Williams `TBK-1` and JJ McCarthy `TBK-3`. This supplies a real program/name/number example; it does not certify that the encountered physical card belongs to that product. Preserve `TBK-2` intact. Do not collapse it to `2`, join by player name alone, or conflate the autograph program with the ordinary insert. [Manufacturer checklist](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf)

The Round 2 odds PDF, page 2, separately lists the ordinary Big Kahuna program, Orange Refractor numbered to 25, Superfractor numbered to 1, autograph entries, and an autograph quantity labeled “VARIOUS.” Columns distinguish product codes `5324` Hobby, `5325` VB SE and `5573` Delight Hobby Breaker. Its blank/dash cells are source observations, not universal nonexistence proof. These rows establish program vocabulary and distribution context, **not** every player/parallel combination. [Manufacturer odds](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFootballRound2Odds.pdf)

Preparation decisions:

- Start with the demanded program and retain the full original source for subsequent clean import. No complete text normalization was performed here.
- Record card-level parallel relationships as **unknown** unless additional reviewed evidence establishes the exact combination. Do not multiply every card by every set-level parallel.
- Keep the odds source's Round 2 scope. Do not silently treat it as every release/channel or infer a physical card's channel from its appearance.
- Hold short-print/image-variation numbering out of the initial approved slice until it is independently reconciled; manufacturer membership data alone is not a visual discriminant.
- Source acquisition is partial at the product level. The checklist has 18 PDF pages, of which local extraction found text on 12; only the relevant membership page was visually inspected. Page count or successful extraction is not a full-import QA result.

## Pokémon: supported examples and limits

The one-page English checklist contains two distinct Snivy entries: `6` and `RC1`. In the rendered source, row `6` has the standard-set square and parallel-set hexagon; `RC1` has the standard-set square. The legend separately distinguishes standard set, standard set foil and parallel set. Preserve those literal source meanings. Do not translate the RC1 marker into a universal “non-holo” claim, or assign a photographed finish from the checklist alone. Collector-number denominators are not printed in these rows and must come from separate reviewed evidence. [Manufacturer checklist](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/bw11_web_cardlist_en.pdf)

Preparation decisions:

- Retain `6` and `RC1` as separate candidate identities. A name-only Snivy lookup must not select one automatically.
- English applicability only. Other languages, region/edition differences, promotional variants, missing checklist entries and exact visual finish names remain outside this draft's authority.
- Treat the row markers as scoped positive source facts. Missing symbols do not establish exhaustive exclusions of every possible later/special printing.
- Text coverage is **partial preparation**, applicability is **partial**, and reference-image coverage is **none**. An “all alternatives eliminated” conclusion is unavailable.

## Candidate image acquisition approach

No card image has been downloaded, promoted, or approved in this packet. The PDF header artwork is not a card-reference example.

1. Prefer an authorized Ten Kings physical example whose exact identity can be reviewed against manufacturer text. Keep original Inventory/Atlas captures under their existing owners and permissions; acquire a permitted derived identity-reference image only through the agreed contribution contract. Preserve original/parent hashes and the actual depicted physical-card origin.
2. Pokémon's [official card database](https://www.pokemon.com/us/pokemon-tcg/pokemon-cards) is a legitimate source-discovery starting point. Direct candidate Snivy routes returned only an iframe to this text browser, so neither image availability, resolution, finish fidelity nor reuse permission was verified. Do not invent an asset URL or treat the source as acquired.
3. For sports, a permitted manufacturer image or separately reviewed owned-card example is preferable. An actual seller/listing image may be considered later through the authorized provider workflow, with usage rights and source lineage checked. This preparation made no paid provider call and does not revive SerpAPI.
4. Review the useful closest comparisons: ordinary versus numbered/other treatment within the same sports program; the two Snivy identities and any separately evidenced finish alternatives. Distinguish the actual depicted identity from the finish/program it can represent. Color or shine alone is insufficient; record visible number, serial denominator, artwork/pattern/detail and image-quality limits.
5. Images remain internal until their own access grants permit otherwise. A seller photo, grading completion, model agreement or comp selection is not catalog-reference approval. A guessed target/listing pair cannot later corroborate itself. Precision grading references and public grading-comp approval remain separate authorities.

## Next build acceptance, without expanding this packet's authority

Use the [shared SetOps contract](2026-09-16-shared-catalog-contract.md), including the real durable review/publication boundary, to turn reviewed source-backed rows into a candidate manifest. Existing IDs must be resolved through the coordinator's authorized host; this source pass performs no DB lookup. Keep unsupported dimensions unknown instead of inventing SetOps identifiers, language aliases, treatment relationships or reviewer authority.

The minimum functional acceptance is: exact set/program/name/number lookup returns the intended **reviewed** rows; Snivy ambiguity and unsupported sports combinations remain unresolved; the full source/applicability/image payload and revision are bound to real review; a later different physical card consumes that exact publication with its own originals and decisions intact. Actual Atlas adoption is owned by Atlas and is not proven by these examples. No all-card accuracy, market-value, no-slowdown, or two-way live reuse result is claimed.

Preparation checks: complete source-byte hashes verified; relevant sports checklist page, sports odds page and Pokémon checklist visually inspected using the PDF workflow; source manifest and example JSON parsed; no repository PDF/private imagery retained. No application code, credential, provider paid request, DB operation, approval, publication, deployment, commit, or Atlas checkout change occurred. The coordinator owns any common handoff/session-log update.
