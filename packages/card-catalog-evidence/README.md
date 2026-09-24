# Shared catalog evidence contract

Dependency-free, server-side JavaScript for the September 16 SetOps contract. This package validates data and performs deterministic lookup. It does not publish a catalog, authenticate a reviewer, fetch a provider/image, write a database, or change an application's card identity.

```sh
node --test packages/card-catalog-evidence/tests/*.test.mjs
```

The executable sports/Pokémon fixtures are **synthetic protocol examples**. They do not establish real-source, image, review, production or Atlas acceptance.

## API

| Function | Contract |
| --- | --- |
| `validateManifest(value)` | Strict v1 validation; returns a detached, deeply frozen snapshot. Unknown fields fail. |
| `canonicalJson(value)` | Sorted object keys; array order and exact strings retained; safe integers only; no omitted values or `toJSON` hooks. |
| `hashManifest(value)` | SHA-256 of UTF-8 canonical JSON for the complete validated manifest. Includes identity, scope, sources, images, aliases, coverage and supersession. |
| `printingIdentityId(category, setId, printing)` | Stable full-hash identity from existing SetOps program/parallel/variation keys and language/edition/format/channel. |
| `lookupManifestCandidates(manifest, query)` | Pure **unreviewed** preview; cannot establish publication authority. |
| `createPublishedCatalogReader({ loadAuthorizedPublication })` | Server-composed reader with an authorized durable-publication loader. Every call checks the exact caller pin, current state, full hash and draft/review binding. |
| `compareEvidenceLineage(manifest, left, right)` | Follows source and image ancestry, origin keys and byte hashes. Reports shared lineage or distinct declared roots; the latter does not prove independent real-world events. |
| `prepareObservationProposal(value)` | Strict unreviewed proposal plus full payload hash and producer/observation/input-revision idempotency key. |
| `observationRetryDisposition(existingReceipt, proposal)` | `new`, exact `replay`, or conflict. The host must enforce durable uniqueness atomically. |

Types are provided in `src/index.d.ts`. Fixtures show complete wire values. Contract schema versions, not package semver alone, select parsers. Existing SetOps and research hashes retain their original meanings.

## Published reader boundary

```js
const reader = createPublishedCatalogReader({
  // Created inside the authorized server adapter. This function must read actual
  // immutable records, the current publication pointer and authenticated access.
  loadAuthorizedPublication: pin => host.readAuthorizedSetOpsPublication(pin),
});
const result = await reader.lookup({
  publication: { publicationId, setId, revision, manifestSha256 },
  query: { category: 'POKEMON', setId, programId, cardNumber: '001/165',
    language: 'en', edition: 'standard', printingLabel: 'Reverse Holo' },
});
```

There is no production loader in this package. An application must not supply that loader from a request, return caller-provided authority JSON from it, or treat a serialized response's `authority` string as authentication. For internal HTTP, the server owns this composition; authenticate the requesting app and preserve the exact pin/version over the authorized transport. An out-of-process cache must never turn a copied record into its own publication writer.

The loader verifies source rows, explicit authorized human review of the full manifest and media grants, supersession linkage, and current/non-archived availability. This library validates the resulting binding; it cannot prove database facts or human review on its own. A legacy `SetApproval` or retained-image flag alone is insufficient. See the [storage/approval design](../../docs/plans/2026-09-16-shared-catalog-contract.md).

## Identity, scope and uncertainty

- `setId`, program keys/row IDs, card IDs and parallel/variation/scope row IDs refer to the existing SetOps identity. The synthetic printing key does not create a new editable identity table.
- Sports uses `manufacturer`; Pokémon uses `publisher`. The other field is null. Adapters map these deliberately into their own category-specific identity fields.
- Card numbers retain prefixes, punctuation, leading zeroes and denominators. Text lookup uses Unicode NFC, case and whitespace normalization; accent/punctuation changes need explicit source-backed aliases. Collisions produce multiple candidates, including when the response limit is one.
- Aliases bind category, set, program and, where relevant, language. No fuzzy matching or global alias is performed. A language-scoped alias is ineligible when the query has no language.
- Each applicability record binds one card to one printing: `supported`, `excluded` or `unknown`. Missing records are unknown. No source or output truncation can imply a negative. v1 never reasons by elimination, even if a reviewer marks coverage complete.
- Printing dimensions are exact, case-sensitive scope identifiers. Null is unknown. `not_applicable` means the reviewed source establishes that dimension is inapplicable; it is not an all-values wildcard. Other strings are exact values. If a dimension is unknown or the query omits an applicable dimension, effective applicability is unknown and images are withheld.
- `coverage.text`, `.applicability` and `.images` independently retain complete/partial/truncated/unknown status. `truncated` on the lookup result separately describes response pagination. Counts and ambiguity are calculated before pagination.
- One candidate is still a candidate. `identityDecision` always remains `consumer_review_required`. Positive diagnostic evidence may be used by an authorized app's research logic; this package performs no image analysis or physical identity certification.

## Sources, images and proposals

Canonical facts and aliases require official or approved-secondary source ancestry. Listing titles, physical observations and model-derived guesses cannot become canonical authority through a derived wrapper. The host must verify a source's classification and exact original bytes; a manifest's classification is not self-authenticating.

`originKeys` preserve source identities across wrappers (for example `listing:ebay:123`, `physical:atlas:opaque-id`). Copying, cropping or syndication preserves parent links and original roots. The library rejects cycles and flags shared roots; unknown/unrecorded real-world lineage remains a host review limitation.

Images bind exact bytes/dimensions/side, source and parent images. `depicted` records the actual card/printing. `representsPrintingIds` separately records the reviewed finish scope; applicability remains required for each target card. The same picture can be an exact depicted identity for one card and a representative finish for another. This is identity comparison evidence, never a precision centering or defect reference.

`mediaRef` is an opaque reference, not a URL, path, bearer capability or public grant. Each app must authorize and resolve it through existing private storage. The host must verify bytes, dimensions, usage rights and visible diagnostic claims before publication. This package neither copies images nor generates signed URLs.

Observation images are merely proposed evidence. The server binds `producer`, physical-card reference, observation ID and input revision to its authenticated app/record. Original inputs remain unchanged. A retry with the same key and different bytes is a conflict, not an update. A later input revision is a new observation; neither operation promotes images or updates grades, saved descriptions, costs, comps or market values.

All operations are bounded: 4 MiB canonical manifest/proposal, 5,000 rows per ordinary collection, 20,000 explicit applicability rows, depth/lineage depth 48 and at most 100 returned candidates. Larger data requires explicit partitioning/versioning; silent truncation is prohibited. The package has no background job, crawler or cache.
