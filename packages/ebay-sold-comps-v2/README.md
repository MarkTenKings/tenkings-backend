# eBay Sold Comps V2

Pure, server-only comparison-card engine for Ten Kings V2. It does not know about Prisma, HTTP routes, UI components, grading, or card lifecycle state.

## Locked behavior

- Makes exactly one synchronous SoldComps request to `/v1/scrape` with the visible authoritative `keyword`, `ebaySite=ebay.com`, `count=240`, and `page=1`, authenticated only by a server-side Bearer header.
- The legacy Ten Kings request default remains 240 for caller compatibility. The caller may supply `requestCount`; this is a requested page size, not a hard provider-response ceiling. The [provider documentation](https://sold-comps.com/docs), checked October 8, 2026, states sizes 60/120/240 with other values rounded up, and warns that the docs are being updated. The October 8 ATLAS investigation independently observed 60 returned rows for requests using 40. At most 240 returned rows are parsed and 60 safe candidates retained. No cookies, pagination, or Best Offer hydration are added.
- A 429 with the documented `quota_exceeded` body code maps to nonretryable `SOLDCOMPS_QUOTA_REACHED`; other 429 responses keep the existing temporary-unavailable code. Error bodies remain bounded and are never included in errors.
- Applies one 45-second deadline, never retries or polls, and retains at most 60 safe candidates. The UI shows 30 first and reveals the remaining retained rows locally without another provider request.
- Maps the Ten Kings decimal grade to the nearest whole PSA grade, with exact `.5` ties down, then orders candidates as PSA at that mapped grade, other PSA grades, BGS/SGC/CGC, then raw.
- Keeps uncertain and contradictory matches visible for human review; it never auto-selects a comp.
- Computes market value only from the unique candidate IDs selected by the admin.
- Uses sold price only. Provider shipping data is discarded recursively at the engine boundary and is never returned, stored, displayed, or included in the average.
- Emits only canonical numeric `https://www.ebay.com/itm/<id>` links and approved eBay image hosts.
- Uses only SoldComps `soldPrice`, `soldCurrency`, and `bestOfferAccepted` for selectability. Best Offer, non-USD, and unsafe prices remain visible but unselectable; a missing sold date stays `null`.
- Reads provider responses through a bounded stream and rejects oversized bodies before parsing.
- Returns `null` when no candidates are selected. It has no comps status field or boolean.
- Makes no database write and does not affect grading, inventory readiness, listing readiness, NFC, or any other workflow.

## Server-only usage

```ts
import {
  calculateEbaySoldCompsV2AverageCents,
  searchEbaySoldCompsV2,
  summarizeEbaySoldCompsV2Selection,
} from "@tenkings/ebay-sold-comps-v2";

const result = await searchEbaySoldCompsV2(identity, {
  apiKey: process.env.SOLDCOMPS_API_KEY!,
});

const marketValueCents = calculateEbaySoldCompsV2AverageCents(
  result.candidates,
  adminSelectedCandidateIds,
);

const snapshotMath = summarizeEbaySoldCompsV2Selection(
  result.candidates,
  adminSelectedCandidateIds,
);
```

The caller must read the credential from a server-only environment. Never put it in browser code, a request body, a log, or persisted comp evidence.

## Integration boundary

The S1/S3 integration owns authentication, persistence in the V2 card row, admin controls, and public display. This package owns only query construction, the single bounded provider retrieval, candidate parsing/ranking/deduplication, and selected-comp arithmetic. Do not import V1 KingsReview, Bytebot/Playwright, V1 comp persistence, or V1 inventory gates into this package.

## ATLAS identity and grade evidence

New ATLAS requests opt into `matchingPolicy: 'ATLAS_IDENTITY_V1'`. The existing
query, ranking groups and engine envelope remain compatible with saved Ten Kings
snapshots; the new policy is explicitly saved in the ATLAS request input. With no
policy, no new candidate fields are emitted. The two lexical corrections for
non-holo negation and Pokémon Black & White series context also apply to legacy
matching. No saved snapshot is rewritten.

The policy adds `variantEvidence` and `gradeEvidence` to each safe candidate. Its
`parallelMatch` uses the richer variant result. Missing target parallel stays
`UNKNOWN`, including when a listing names a holo, reverse holo or sports parallel.
An explicit Pokémon `Base` does not establish a non-holo finish. Missing language
also stays unknown. A complete title match is still only a marketplace claim;
this module neither inspects photographs nor certifies an exact printing.

The saved, human-approved `parallel` text can explicitly state language, edition,
finish, stamp, promo, sports serial denominator, autograph and memorabilia facts.
For example, `English First Edition Non-Holo` and `English Red Wave /99 Autograph`
retain separate dimensions. Optional `variantIdentity` can carry those same
facts as `language`, `edition`, `finish`, `stamp`, `promo`, `serialDenominator`,
`autograph` and `memorabilia`. The caller must bind that object to actual reviewed
evidence; null/omitted fields do not establish an absent feature. A sports `/99`
compares the print run, not whether the physical copy is `07/99` or `81/99`.
Pokémon `039/192` and `RC1/RC25` remain collector identities, never serial facts.

`variantEvidence` has `status`, bounded deterministic `reasonCodes`, and observed
arrays for language, edition, finish, stamp, serial denominators and parallel
signals, plus nullable autograph/memorabilia/promo flags. Non-holo, ordinary holo,
reverse holo, Cosmos and Poké Ball/Master Ball patterns are distinct. Costco is
not an alias for Cosmos. A generic holo description may be incomplete for a
specific named pattern. Sports colors and patterns are checked after removing
the saved player and product context; a Red Wave cannot match Blue Wave or Red
Prizm solely because some words overlap.

The observed seller phrases `Reverse Cosmos Holo` and `Cosmos Reverse Holo`
retain both finish signals; they do not collapse to ordinary holo. `Cosmo` is a
Cosmos alias, and `Game Stop Stamp`/`GameStop` retain retailer-stamp evidence.
Explicit `FR` is recognized as French only in Pokémon title/approved-parallel
scope, not sports initials. These listing claims never establish an unknown
physical card's language or printing. Generic picker, lot and multi-card titles
without either the target name or a collector-number anchor are excluded under
the ATLAS policy; a named single-card title with seller promotion text remains
reviewable.

The existing `card-research-core/decisions` title inspector remains responsible
for independent name/set/year/card-number/sport checks. The existing fast
identifier supplies photo-bound suggestions; its Pokémon prompt forbids assuming
Non-Holo/Standard from absent reflection. Its catalog/research engine already
supports positive printing diagnostics and photo-bound language/edition scope.
Those can inform the existing staff identity review, but this parser never
silently adopts them into an immutable approval. Unknown identity/variant sales
remain reviewable and must not be automatically published as exact matches.

`gradeEvidence` has `status: RAW | GRADED | UNRESOLVED`, `designation`, `groupKey`,
`label` and `reasonCodes`. Examples are `PSA_10`, `BGS_9_5`,
`BGS_10_BLACK_LABEL`, `BGS_10_PRISTINE`, `CGC_10_PRISTINE` and
`CGC_10_PERFECT`. Plain BGS/CGC 10 keeps a null designation; a claimed Gem Mint 10
has `STANDARD`. Historical CGC 9.5 is not converted to 10. Autograph-only grades,
unsupported graders, contradictory or predicted grades, and slabs without a
numeric grade are `UNRESOLVED`, with `raw: false`, `grader: null` and
`numericGrade: null`. Only `RAW` authorizes raw-sale display; the legacy `group`
field is a compatibility sort bucket and must not override this evidence.

## Reclassifying captured ATLAS evidence

`reclassifyEbaySoldCompsV2Result(input, savedResponse)` is a pure, offline helper
for an explicitly authorized new preview from retained normalized evidence. It
requires `ATLAS_IDENTITY_V1`, the existing engine/source and the exact query.
It clones the saved response, recomputes only title-derived grade, variant and
identity-match metadata, and preserves listing IDs/URLs, prices, sale caveats,
dates, relative order, pagination facts and the original `retrievedAt`. It does
not fetch, calculate a new capture time, convert a grade scale, or mutate an
existing preview. Freshness and admission remain the caller's responsibility.

Both fresh ATLAS searches and replay emit `classificationRevision` with
`EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION` (`atlas-title-evidence-v2`), plus
`classificationExcluded`, an array of `{ id, reason }` records whose sole reason
is `UNANCHORED_MULTI_CARD_LISTING`. Candidate and excluded IDs are unique,
disjoint, and together bounded to the original maximum 60 retained rows. These
counts describe the retained comparison set, not every raw provider row.
Reclassification is idempotent and cannot restore evidence absent from the saved
response. The integration must preserve the prior response/preview and record a
new request and response hash; a successful immutable preview is not a failed
job to retry. Legacy Ten Kings searches do not emit these fields.

Primary sources checked for category semantics:

- [Pokémon's Legendary Treasures description](https://www.pokemon.com/uk/pokemon-tcg/black-white-legendary-treasures) identifies Black & White as expansion context and Radiant Collection as a separately numbered subset with special foil treatment. That set fact does not resolve a photographed card's missing variant.
- [Official Rebel Clash checklist](https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/checklist/swsh2_web_cardlist_en.pdf) identifies Magikarp 039 and distinguishes standard and parallel printings.
- [Topps collecting guide](https://www.topps.com/pages/start-collecting-topps) distinguishes parallel colors/textures/patterns/materials and autograph/relic products.
- [CGC's grading scale](https://www.cgccards.com/card-grading/grading-scale/) distinguishes Gem Mint 10, Pristine 10 and the retired Perfect 10 designation. Listing text is not a verification of a certification number.
