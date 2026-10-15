# Upload-bound background removal

## Release status — October 14, 2026

The owner approved continuation and release after the full-photo/corner comparison. This Photoroom Plus HD candidate is locally qualified and awaits independent release review/build/cutover. It is not deployed at this checkpoint. Current main includes the separately released half-grade label fix at9f68dc29; worker/web remainee560be2 and schema004. Fresh runtime observations, not historical release actions, govern cutover.

Four actual3024×4032 sports/Pokémon Front/Back PNG responses pass the owner-approved bounded edge rule, with exact dimensions, ICC and every fully opaque RGB sample. The19,166,170-byte Mewtwo Front and25,238,449-byte Jordan Back were uploaded without downsampling. Visible changed pixels range from0.118881% to0.143374%, exclusively fractional-alpha channels decreasing by1. No enclosed alpha holes were found. Independent corner inspection found no obvious lost artwork or white wear. Fractional alpha softens the displayed fringe; exact physical material boundaries and vendor internals are not proven. Source/response bytes are untouched. Original strict-v1 rejection receipts remain truthful historical evidence.

## Provider contract

Only `POST https://image-api.photoroom.com/v2/edit` is executable. Dedicated server-side `ATLAS_PHOTOROOM_API_KEY` supplies `x-api-key`; header `pr-hd-background-removal: auto` is mandatory. Other OpenAI features and shared credentials remain separate.

The exact normalized full-resolution RGB8 working PNG is uploaded as `imageFile`, with only:

- `removeBackground=true`
- `referenceBox=originalImage`
- `padding=0`
- `outputSize=<source width>x<source height>`
- `export.format=png`
- `colorSpace=original`

No background generation, crop, resize, enhancement, relighting or Basic parameter is sent. Input admission rejects encoded bytes over30,000,000, dimensions over5,000 or pixels over25,000,000 before durable dispatch and again before the single HTTP POST. It never downsamples. Output is bounded to101MiB, RGBA8 PNG, with identical dimensions/ICC. Nonempty unsupported-attributes responses fail closed. Provider rejection is terminal; ambiguous responses remain UNKNOWN and cannot authorize another POST.

Recipe `atlas-photoroom-plus-hd-v2` validates all alpha255 RGB exactly. Fractional-alpha channel deltas may only be−1 or0; changed pixels must be≤0.2% of visible pixels, with≥98% visible pixels fully opaque. Fractional pixels must connect to the exterior through four-neighbor nonopaque regions and lie within Manhattan distance16 of alpha0. Separate transparent-region flooding rejects enclosed transparent holes. All measured counts, deltas and topology are recorded in strict schema4 provenance. Public metadata truthfully distinguishes exact opaque RGB from bounded fractional-edge RGB. The returned PNG is never recolored, repaired or rewritten.

Contract sources verified during this request: [Plus OpenAPI](https://docs.photoroom.com/getting-started/api-reference-openapi), [HD removal](https://docs.photoroom.com/image-editing-api-plus-plan/hd-background-removal), [Plus limits and original color](https://docs.photoroom.com/image-editing-api-plus-plan/file-size-resolution-and-format). Actual-response validation remains mandatory for every result.

## Preserved workflow and cutover

Each upload retains immutable card/side/original/source hashes, exact recipe/cache identity, receipt and selected grading frame. Historical schema3 OpenAI images remain readable without OpenAI dispatch capability. FAILED/UNKNOWN without an output selects the saved verified original. Mixed original/cleaned pairs continue through identification, Astra/xhigh geometry, preparation, defects, thumbnails and human review.

Migration005 is locally qualified but unapplied at this checkpoint. It forbids old-provider admission/dispatch/late result adoption and new same-upload retries. Exact historical retry receipts remain readable. The worker terminalizes own-mode old-provider QUEUED/RUNNING jobs as FAILED and REQUESTED as UNKNOWN, retains bindings/audits and never creates another job for that upload. Late receipts may append evidence but cannot replace selected pixels. Historical READY images, reports and approvals remain unchanged. Removal-enabled startup verifies exact005 function bodies/attributes, enabled guards and origin replication mode before serving or dispatching.

Cutover requires a fresh census, graceful stop/drain of the exact current native pair, qualified schema/runtime/web artifacts and005 before new runtime admission. Recovery must pause removal or use originals; never restore the old removal adapter. Existing consumed deployment actions must not be replayed. No historical reprocessing, regrading, grade approval or printing is authorized by this release.

Staff full images continue through verified direct storage access. Photoroom public presentation uses a bounded16KiB access response with a120-second exact immutable storage grant, current publication check and hash/size/dimension bindings. The public browser verifies the exact full-resolution bytes. Historical raw presentation retains its4MiB bridge bound. The native→bridge→public route→browser chain is tested with a25MiB synthetic PNG payload.

## Evidence

Exactly four standalone Plus calls were made, one per side/category, with no retries or production image writes. Sources, responses, receipts, native-sample analysis, corner figures, runtime census and disposable schema qualification are retained privately under `/Users/markthomas/.codex/atlas-handoffs/atlas-photoroom-plus-20261014`. The secret remains outside Git with0600 permissions and must never enter logs or public configuration. SESSION_LOG records qualification and planned/observed release actions. Mark will upload fresh cards after deployment for authenticated production acceptance; existing graded cards will not be replayed.
