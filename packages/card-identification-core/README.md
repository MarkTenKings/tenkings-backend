# Shared card identification

Package 0.2.0 adds the explicit `@tenkings/card-identification-core/v2` entry
point described below. The root entry point and every V1 runtime/type/fixture
file remain byte-identical to package 0.1.0. Installing this package alone does
not select V2 in either application.

`@tenkings/card-identification-core` extracts the eight-field Google Vision +
Astra identifier from reviewed collect application commit
`a319904273d4b4e4e81d721b699d3a2990975eda`. It has no default network, credentials,
storage, database, inventory, catalog, grading, or account effects.

```ts
import { identifyCard } from '@tenkings/card-identification-core';

const result = await identifyCard({
  subject: { id: subjectId, revision: currentRevision },
  photos: {
    front: { ref: frontDerivativeRef, sha256: frontSha256, byteCount: frontSize },
    back: { ref: backDerivativeRef, sha256: backSha256, byteCount: backSize },
  },
}, {
  readPhoto: authorizedReadPhoto, // (photo, context) => Promise<Uint8Array>
  ocr: callGoogleVision,         // (request, context) => raw JSON Uint8Array
  model: callAstra,              // (request, context) => raw JSON Uint8Array
}, { signal });
```

The subject and photo references are opaque, bounded identifiers. They carry no
inventory ID, photo-key naming, or storage-provider requirements, and are never
included in provider requests. Both references and SHA256 values must differ.
The entry point snapshots its input, verifies each returned byte count and
SHA256, and accepts the same single-page JPEG interpretation derivatives as the
source: at most 3 MiB and 1400 × 1400 pixels. It does not resize, rotate, crop,
re-encode or accept HEIC originals. An application's derivative pipeline must
retain the binding to the untouched original photos separately; a derivative is
not the grading original.

Both photo reads overlap, followed by both Google Vision
`DOCUMENT_TEXT_DETECTION` calls, then one `gpt-6-astra` Responses request at low
reasoning effort, high image detail, 2400 output tokens, `store: false`, and the
source strict JSON schema. The source instructions and serialized schema are
retained exactly, including the historical schema name
`staff_inventory_card_details`. OCR supplies at most 6000 characters per side;
unavailable or empty OCR retains the source photo-only behavior and warnings.
The source deadlines are 6 seconds per photo read, 8 seconds per OCR call,
25 seconds for the model, and 40 seconds overall. `timeoutMs` can shorten these
bounds. There is no automatic retry or model fallback.

The result contains `suggestions`, `warnings`, and `provenance`. Suggestions
retain source ordering and the closed eight-field contract:

| Field | Maximum characters |
| --- | ---: |
| `name` | 160 |
| `category` | 80 |
| `manufacturer` | 160 |
| `card_number` | 80 |
| `year` | 20 |
| `set_name` | 160 |
| `variant` | 160 |
| `card_type` | 160 |

Each suggestion has `value`, `confidence`, and `evidence`. Unknown means exactly
`{ value: null, confidence: 'unknown', evidence: null }`. Supported values retain
high/medium/low confidence and evidence up to 240 characters. Invalid or unsafe
provider content fails; it is not trimmed, truncated, repaired or adopted.
All three source categories remain supported: Sports cards, Pokémon, and Other
trading cards. A consuming application's narrower fields, such as ATLAS's
40-character card number, need explicit adapter validation without changing
this shared 80-character result.

Provenance adds a separately versioned neutral envelope: exact subject revision
and photo descriptors, source commit, engine version, timings, OCR statuses,
and SHA256 hashes of the validated input, serialized model request and raw model
response bytes. The input hash uses recursively sorted JSON object keys; provider
request hashes use the exact `JSON.stringify(request)` bytes. Source suggestion
serialization and hashes remain compatible. The new envelope does not migrate
or rewrite old inventory event hashes. `parseCardIdentificationResult(result,
expectedInput)` checks the bounded schema and subject/photo/input-hash binding.
It does not authenticate a receipt or recreate provider hashes without their
original bytes. Results from `identifyCard` and all effect requests are frozen.

Adapters own authorization of each subject/reference, original-to-derivative
binding, exact bounded storage reads, provider credentials and HTTP status,
redirect rejection, response-stream cancellation and a 256 KiB body limit.
The core independently checks the returned body size. Each effect receives an
abort signal and subject/input binding; OCR/model contexts include the exact
request hash so adapters can record dispatch and usage receipts. Adapters must
honor cancellation and retain unknown-outcome receipts for work that a provider
may complete after timeout. The core returns no late result and performs no
persistence, compensation, usage accounting or retry. Consuming applications
own attempt IDs, durable idempotency, stale-result fencing and explicit adoption.

The reviewed identifier does not load shared knowledge. Omit `knowledge`, or
pass `null`, to keep the unchanged request. Other values fail before effects
with `unsupported_knowledge`; no account history, private asset reference,
learned-reference lookup or new knowledge prompt is silently added. Variant
research and SoldComps remain a separate subsequent module.

Run `pnpm --filter @tenkings/card-identification-core test`, or
`node --test packages/card-identification-core/test/*.test.mjs` from the repo.
Fixtures use synthetic JPEGs and stubbed provider JSON, never live inference.
The golden fixture is generated from immutable source after checking the file
SHA256s in `source-manifest.json`; ordinary tests need no old app imports or git.
To deliberately regenerate it with the source commit available locally, run
`node packages/card-identification-core/scripts/generate-source-fixtures.mjs`.
This proves request/parser parity and boundary behavior, not recognition
accuracy or production latency.

## Opt-in V2: September 15 Inventory recognition fixes

Import `identifyCardV2`, `parseCardIdentificationInputV2` and
`parseCardIdentificationResultV2` from `@tenkings/card-identification-core/v2`.
Input photo/subject descriptors and suggestion validation are unchanged. V2
wraps the retained V1 orchestration, including the same deadlines, provider
limits, one attempt, cancellation and photo verification. No root app adapter
is connected in this package handoff.

**The OCR effect contract changes intentionally.** V2 calls
`ocr({ body, responseFields }, context)`. Send `body` as the Google Vision JSON
body and `responseFields` as its `fields` query parameter:

```js
const endpoint = new URL('https://vision.googleapis.com/v1/images:annotate');
endpoint.searchParams.set('fields', request.responseFields);
// Existing authenticated, bounded transport sends request.body to endpoint.
```

The exact mask is
`responses(fullTextAnnotation/text,textAnnotations/description,error)`. It
avoids transferring unused polygons through the existing 256 KiB response
reader. `context.requestHash` covers `JSON.stringify({body,responseFields})`,
including the mask and excluding credentials. Each OCR hash and the mask are
retained in V2 result provenance. Do not pass this envelope to a V1 transport
that sends its whole argument as Google's body. A real adapter must verify the
URL, serialized body, limits and durable request/response accounting.

The sports model request remains byte-identical to V1. When bounded OCR on
either side contains a Pokémon hint, the same single model request receives
Inventory's exact Pokémon-only field instructions plus one lossless PNG of
the lower half of the verified Front JPEG. The model must still confirm the
game from the photos. This internal Sharp transform uses encoded JPEG pixel
coordinates, `top=floor(height/2)`, full width and the remaining height. It
performs no rotation, resize or detail invention. Originals remain untouched.
No caller-supplied detail image, new photo, crop effect or image URL is accepted.
The crop is checked as a single-page PNG under the 3 MiB limit; its parent side
and SHA256, source dimensions, exact region, MIME type, bytes and hash appear in
`provenance.pokemon_detail` and the model context. The crop is part of the model
deadline and request hash. OCR-empty/unavailable behavior remains photo-only.

V2 result provenance declares `card-identification-v2` and source commit
`60572cec895ad63d4ab826cd366f6475b04e725a`. Its input hash is SHA256 of the exact
`JSON.stringify({engine_version:'card-identification-v2',input_sha256:V1InputHash})`
bytes. Its model request hash still covers the exact final request bytes. V1
and V2 parsers reject each other's envelopes. Keep saved V1 receipts, parsers,
hash interpretation and retries under V1; choose the correct parser from a
server-owned stored version for new attempts. A version tag is not a receipt
signature. Parsing checks structure/input/parent binding; reconstructing OCR,
model or PNG hashes requires the retained original request/response/image bytes.

Both consumer adapters still own original-to-interpretation-image binding,
authorization, cancellation/unknown provider outcomes, stale-pair fencing,
field-length/category mapping and protection of staff edits. Persisting a
machine result does not authorize adoption over a human edit. Atlas must retain
its full-resolution grading originals; this crop is identity evidence only.
No new catalog knowledge, research call, grading authority or storage write is
introduced. Do not switch production intake until both adapters are verified.

`node --test packages/card-identification-core/test/*.test.mjs` runs both
versions offline. `scripts/generate-source-fixtures-v2.mjs` deliberately creates
goldens by executing the request builder/parser extracted from hash-checked
immutable Inventory source, with synthetic JPEGs. It requires Node 22.23.2's
TypeScript stripping API and makes no provider call. Ordinary tests need no
source commit or app initialization. `scripts/verify-handoff.mjs` checks the
result hash ledger. See the dated recognition handoff in `docs/plans` for the
qualified source, recorded validation and required adapter acceptance.
