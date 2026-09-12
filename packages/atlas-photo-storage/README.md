# Atlas immutable photo storage

Server-side S3/Spaces adapter for `@atlas/photo-core` and `@atlas/photo-runtime`.
This package uses an injected AWS SDK client and performs only exact-key HEAD,
GET and conditional PUT operations. It does not construct credentials, fetch a
remote image URL, persist card records, delete objects or provide an endpoint.

```js
const storage = createPhotoStorage({
  client, bucket: 'private-photo-bucket', keyPrefix: 'atlas',
  limits: { maxObjectBytes: 32 * 1024 * 1024, timeoutMs: 30_000 },
});
// The host first durably claims this unique plan and authorizes its card/side.
const stored = await storage.writeOriginal({ uploadPlan, bytes, signal });
const decoded = await storage.decodeOriginal({
  uploadPlan, object: stored.object, decodeLimits, signal,
});
const frame = await storage.writeDecodedFrame(decoded, {
  id: frameId, key: `atlas/derived/${frameKey}`, signal,
});
```

The example limits are allocation/deadline examples, not product upload or card
allowances. The host chooses operational bounds and concurrency independently.
`decodeLimits` uses the photo-runtime's five explicit bounds: `maxInputBytes`,
`maxPixels`, `maxRasterBytes`, `maxOutputBytes`, and `timeoutMs`.

## API and byte authority

- `createOriginalUpload({ uploadPlan, expiresIn, signal })` locally signs a
  conditional direct PUT and returns `{ uploadId, object, method, url, headers,
  byteCount }`. Send every returned header and exactly the selected file bytes.
  The signature binds Content-Length; browsers set it themselves. No multipart
  form, conversion or replacement image is accepted under the same plan.
- `writeOriginal({ uploadPlan, bytes, signal })` snapshots owned bytes and returns
  verified `{ object, byteCount, sha256, contentType, bytes, disposition }`.
  `disposition` is `CREATED`, `EXISTING`, or `RECONCILED` after an ambiguous PUT.
- `readOriginal({ uploadPlan, object?, signal })` returns the same verified
  observation without disposition. Persist and provide the observed version
  whenever one exists; omission reads and pins the current version.
- `decodeOriginal({ uploadPlan, object?, decodeLimits, existingOriginal?, signal })`
  reads verified original bytes and invokes the bounded photo-runtime decoder.
  Its return contract is the runtime's original/decode-plan/raster result.
- `writeDecodedFrame(decoded, { id, key, signal })` writes the actual runtime PNG
  and returns a core frame descriptor bound to the observed storage version.
- `readDecodedFrame({ frame, original, decodePlan, signal })` verifies stored
  bytes against the complete source-bound frame descriptor.
- `writeDerivative({ descriptor, frame, original, decodePlan, bytes, signal })`
  writes a planned derivative whose destination `versionId` is null, verifies it,
  and returns its descriptor with the observed version. The actual generator
  supplies truthful MIME, dimensions, transform and encoder provenance.
- `readDerivative({ descriptor, frame, original, decodePlan, signal })` verifies
  the corresponding exact derivative object and bytes.

Original keys must be under `<keyPrefix>/originals/`; frame and derivative keys
must be under `<keyPrefix>/derived/`. A plan's destination key is permanent.
Every write uses `If-None-Match: *` and an expected SHA-256 checksum. Binding
metadata captures the complete upload plan, or the complete derived descriptor
with its destination version normalized to null. Same bytes under a different
upload, side, pair, original, frame, transform or encoder plan conflict.

The adapter does not trust metadata or an ETag as byte integrity. It compares
HEAD and GET headers, pins GET to the observed VersionId (or uses If-Match with
the HEAD ETag for an unversioned object), and hashes every actual streamed byte.
It rejects version/header races, wrong length, MIME, binding, range or encoding,
and unexpected provider checksums. Provider checksums are supplemental; absent
checksums still require the full source SHA-256 and exact length.

Originals remain `application/octet-stream` in storage. MIME and decoded metadata
are observed by the decoder; upload claims never invent them. The immutable core
completion receipt is separate from this stored-byte observation. A receipt with
`metadata: null` stays unchanged after later decoding/header observations.
Decode failure leaves the original object available for diagnosis or a later
supported decoder. No derivative is written by `decodeOriginal`.

## Recovery, bounds and host responsibilities

A repeat first verifies the existing object. A new write performs at most one
conditional PUT, then verifies the same key/version through readback. A lost
successful reply can therefore reconcile without another PUT or a new key.
`PHOTO_STORAGE_CONFLICT` means observed bytes/lineage or a precondition changed.
`PHOTO_WRITE_UNKNOWN` means a dispatched PUT could have succeeded but its
readback was unavailable or cancelled; retain the original plan and reconcile
through `readOriginal` or retry that same plan. It does not authorize a new key.
Known unsupported/refused writes are `PHOTO_STORAGE_WRITE_REJECTED`; required
conditions/checksums are never removed to get provider acceptance.

Each network phase has an abortable deadline; ambiguous-write readback receives
a separate bounded phase. Streams are counted before copying chunks, hashed in
order and destroyed on completion, overflow, cancellation or timeout. Late
transport response streams are also destroyed. `maxObjectBytes` bounds a single
object, not total process heap: owned input, streamed chunks, concatenated output
and decoder allocations can coexist. Concurrency and process memory limits are
host responsibilities. The transport must use the Node SDK stream interface.

The host owns authentication, unique durable upload plans/keys, side replacement
versions, atomic card adoption, receipts and recovery scheduling. It also owns
the client endpoint/region, credentials, retries, timeouts, private bucket/prefix
policy and browser CORS. No public ACL is requested, but this package cannot
establish a bucket's privacy or prevent other principals overwriting objects.
Use restricted credentials and a client retry policy consistent with explicit
reconciliation (for example `maxAttempts: 1`). Never log signed URLs. Temporary
credential expiry can shorten the requested signing lifetime.

## Evidence and pending provider acceptance

Run `node --test packages/atlas-photo-storage/test/*.test.mjs` from the workspace.
The 22 tests use actual bytes and injected in-memory SDK command transport,
including real photo-runtime PNG decoding, mutations, version races, wrong
provenance, lost replies, resource limits and stream teardown. One test uses the
real locked AWS presigner with synthetic credentials and an `.invalid` endpoint;
it makes no network request. These tests do not prove live-provider behavior.

The SDK primitive semantics are documented in the AWS
[PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html),
[HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html), and
[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
references. DigitalOcean documents its supported subset in
[Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/).
Conditional PUT, checksum/header behavior, private access, versioning and CORS
still require explicit acceptance against the intended provider. No live bucket
was accessed, no real browser upload was accepted, and no real iPhone evidence
or production integration is claimed here. Format decoding support is defined
by photo-runtime and remains independent of grading-category support.
