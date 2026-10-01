# Approved-report presentation images

This optional pipeline runs generative OpenAI background editing after a report is durably published. It automatically discovers both sides of every eligible publication and recovers discovery after process restart. It uses the existing deployment-authenticated manual machine boundary, PostgreSQL work leases, immutable photo storage, and private public-reader bridge. It does not change photographs, geometry, masks, grades, approval snapshots, public packet hashes, or staff authority.

## Processing and authority

- `report_image_binding` pins a publication/action/side/manifest to a cache job. Its rows are immutable.
- `report_image_job` deduplicates the exact source raster SHA and canonical model/prompt/output recipe SHA across publications. READY bytes and result are immutable. Changing a recipe affects subsequently bound publications; it does not rewrite an existing publication's selected presentation.
- Discovery uses the exact published inspection raster, rather than a mutable intake upload. Provider inputs are verified private bytes in a multipart upload, never public or presigned URLs.
- A deployment-authenticated worker takes a PostgreSQL advisory capacity lock, claims with `SKIP LOCKED`, and renews a 300-second lease every 30 seconds. Default concurrency is two, configurable from one to eight, and is enforced across worker processes. API timeout is 180 seconds.
- Workers claim only their exact recipe hash and recheck recipe equality before source reads or paid dispatch. Older queued recipes remain queued for a compatible worker; they cannot be silently edited using a newer model/prompt. The original photograph remains the fallback. Paid response receipts must match the claimed model/prompt/recipe/source/request/output before adoption; mismatches retain their receipt and terminate without storing a result.
- A durable REQUESTED marker precedes each paid POST. A network failure, timeout, server error, or expired REQUESTED lease becomes UNKNOWN. Images edits have no asserted idempotency guarantee; `X-Client-Request-Id` is audit correlation only. UNKNOWN never automatically purchases a replacement edit.
- Explicit HTTP 429 rejections and pre-dispatch operational failures retry with capped backoff, at most six attempts. Deterministic invalid output is terminal. Late response/usage receipts remain appendable to the actual dispatched request even after publication retirement or lease loss; late bytes cannot be adopted through lost authority.
- Outputs must fully decode as PNG, have actual fully transparent and fully opaque pixels, remain within 8,294,400 pixels and 4 MiB, and fit the shared public descriptor bounds. No drawn-checkerboard or all-opaque/all-empty output qualifies. An alpha check does not prove that generated card details are unchanged.
- Provider base64 is length-bounded and validated by canonical decode/encode equality, avoiding recursive regular-expression failure on large valid images. Invalid success payloads retain request correlation and any returned usage in the failure receipt.
- Stored derivatives use purpose `reveal`, with explicitly approximate frame alignment. Originals remain every measurement and detail-inspection authority. The generation may alter printed pixels, framing, and dimensions.
- Public REPORT and REPORT_IMAGE reads never enqueue or call a provider. Optional manifest failure cannot hide the original report. Every PNG read is authorized by the current exact publication and requested output hash; the reader rechecks publication authority before returning. Bucket objects remain private.
- The optional REPORT lookup reads both sides together with 150 ms pool acquisition, 350 ms SQL statement and 500 ms transaction limits. It runs alongside other presentation reads and is omitted after a 750 ms total wait. A timeout advertises no ready derivative; original evidence and the final publication authorization check remain mandatory.

## Runtime and schema

The feature defaults off. Apply and record the additive staff migration `20260930170000_report_presentation_images` through the release owner's normal exact-source process. Apply only `reportImageGrantSQL(actual_manual_serving_role)` from `src/report-image-store.mjs`; it gives the existing scoped manual role SELECT/INSERT on the two new tables, narrowly selected job-state/receipt UPDATE columns, and publication SELECT. It gives no deletion or source/recipe mutation capability.

Configure the private manual service:

```text
ATLAS_MANUAL_REPORT_IMAGES_ENABLED=true
ATLAS_MANUAL_REPORT_IMAGES_CONCURRENCY=2
ATLAS_MANUAL_REPORT_IMAGES_OPENAI_KEY=<private report-image credential>
```

`ATLAS_MANUAL_REPORT_IMAGES_OPENAI_KEY` takes precedence for this pipeline and the isolated canary. If absent, they retain compatibility with `ATLAS_MANUAL_OPENAI_KEY`; an explicitly configured empty/invalid dedicated value fails configuration rather than falling back. Identification, defect analysis, research and customer credential selection are unchanged. Configure the dedicated key only on the private service.

The model is pinned in source to `gpt-image-2.5-sunburst-2026-09-08`, with `xhigh` quality, PNG, transparent background, `1104x1520`, and one output. Recipe `atlas-background-extraction-api-v2` explicitly requests alpha 0 outside the physical edge, opaque printed borders and defects, unchanged framing, and no colored background, gradient, shadow or checkerboard. Prompt and full recipe are recorded in each job. The existing private lifecycle starts/stops the worker; construction remains cold. The public Vercel app receives no OpenAI or bucket credential.

Before wide activation, validate actual account model access and a small representative canary set using the exact recipe, inspect the results, and record observed latency/token usage. Unit/SQL tests provide no API throughput or visual-quality evidence. The release owner found the existing shared runtime credential returned HTTP 401 and selected a separate report-image credential without rotating unrelated consumers. No key value is logged or copied into source.

One explicitly paid local canary, with that scoped credential supplied securely by the release owner:

```sh
node packages/atlas-connected-manual/scripts/report-image-canary.mjs \
  --ack-paid-image-edit --source /absolute/approved-source.webp \
  --source-sha256 <verified-source-sha> --content-type image/webp \
  --output /absolute/private-canary-output
```

The canary saves an intent, output, safe receipt, and real-alpha validation. Its IMAGE_BYTES_QUALIFIED status still requires visual acceptance. Do not rerun an UNKNOWN request as though it were a confirmed rejection.

## Approved prototype import

`connected.reportImages.seed(publicationRow, side, pngBytes, evidence)` is a release-only method with no HTTP route. Use a cold runtime and import before starting the worker. Evidence must contain `execution: 'OPENAI_BUILT_IN'`, `model: null`, exact side/source SHA/report hash/report version/output SHA/dimensions, `promptVersion`, and the retained actual `prompt`. It verifies the private approved source and true-alpha output, writes through immutable photo storage, then atomically pins the new job/binding. A conflicting existing publication binding is explicitly refused. This preserves the real provenance of the owner-selected prototype; it never labels a built-in output as an API canary or as a known model.

## Public contract and validation

The separate `reportImages` response envelope uses `parseReportImages(value, {packet, publicHash})` from `@atlas/report-view/report-images-contract`. Its descriptor includes the exact public token/version/hash, side, original source SHA, output SHA/bytes/dimensions, relative image URL, execution/model/prompt version, and explicit presentation-only/approximate-alignment flags. It exposes no bucket key, source descriptor, API key, or provider response body. Existing `packet.images` is unchanged.

Run focused provider/worker/alpha/binding and bridge tests with:

```sh
node --test packages/atlas-connected-manual/test/report-images.test.mjs \
  packages/atlas-connected-manual/test/publication-reader.test.mjs \
  packages/atlas-service-bridge/test/manual-public.test.mjs
```

`scripts/validate-report-images-postgres.mjs` uses the existing finite owned PostgreSQL harness and real staff/machine authentication. It verifies cross-publication deduplication, concurrency, leases, retry exhaustion, late paid receipts, retirement, seed conflict, narrow grants, and immutable publication preservation. Its explicit fixture arguments are required; it refuses ambient database URLs. The release owner controls remote fixture execution and production changes.

Official API references checked September 30, 2026: [Images edit](https://developers.openai.com/api/reference/resources/images/methods/edit), [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), and [image generation](https://developers.openai.com/api/docs/guides/image-generation). These establish request parameters and model naming, not account access or per-card visual accuracy.
