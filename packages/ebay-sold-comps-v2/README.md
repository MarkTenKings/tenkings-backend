# eBay Sold Comps V2

Pure, server-only comparison-card engine for Ten Kings V2. It does not know about Prisma, HTTP routes, UI components, grading, or card lifecycle state.

## Locked behavior

- Searches eBay sold results through SerpAPI with one visible deterministic query or an explicit admin override.
- Returns at most 30 candidates per request. Pass the returned `nextOffset` to fetch the next 30, then merge with `mergeEbaySoldCompsV2Candidates`.
- Orders candidates as PSA at the target numeric grade, other PSA grades, BGS/SGC/CGC, then raw.
- Keeps uncertain and contradictory matches visible for human review; it never auto-selects a comp.
- Computes market value only from the unique candidate IDs selected by the admin.
- Uses sold price only. Provider shipping data is discarded recursively at the engine boundary and is never returned, stored, displayed, or included in the average.
- Emits only canonical numeric `https://www.ebay.com/itm/<id>` links and approved eBay image hosts.
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
  apiKey: process.env.SERPAPI_KEY!,
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

The future S1/S3 integration owns authentication, persistence in the V2 card row, admin controls, and public display. This package owns only query construction, provider retrieval, candidate parsing/ranking, 30+30 pagination, merge/dedupe, and selected-comp arithmetic. Do not import V1 KingsReview, Bytebot/Playwright, V1 comp persistence, or V1 inventory gates into this package.
