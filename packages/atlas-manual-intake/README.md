# Native photo intake for the manual workspace

`@atlas/manual-intake` creates a staff-owned grading card before photographs,
retains a separate native Front and Back, and supplies immutable rich and SDR
working frames to the clean manual workflow. It uses the existing
`DurableStaffAuth`/`createDurableStaffBoundary` opaque session boundary. There is
no alternate login, operator ledger, cohort, card allowance, model dispatcher,
public access, company inventory, certificate or grading decision here.

```js
const repository = createIntakeRepository({ boundary, keyPrefix: 'atlas-manual',
  maxOriginalBytes: 64 * 1024 * 1024 });
const processPhoto = createPhotoProcessor({ storage, keyPrefix: 'atlas-manual',
  decodeLimits: { maxInputBytes: 96 * 1024 * 1024, maxPixels: 50_000_000,
    maxRasterBytes: 400_000_000, maxOutputBytes: 96 * 1024 * 1024,
    timeoutMs: 60_000 } });
const intake = createManualIntake({ repository, storage, artifacts, processPhoto });
```

`storage` is `@atlas/photo-storage` configured with an injected S3/Spaces SDK
client, private bucket/prefix, exact endpoint/region and independently bounded
requests. It must permit the larger full-size decoded/working artifacts; its
per-object limit is separate from `maxOriginalBytes`. `artifacts` is the existing
`createManualArtifactStore` with a private immutable artifact transport. No SDK
credential discovery, environment mutation or production connection is provided.
The example resource limits are per-image allocation bounds, not a product card
allowance or optical qualification for every camera/format.

The processor explicitly requests the owner's selected
`retain-hdr-use-sdr-base` HEIC policy. It keeps the exact uploaded native bytes,
writes the richer primary PNG, then derives a separate full-size sRGB RGB8 PNG
with transformation provenance. It does not resize, replace the native source,
or claim the SDR working image contains the HDR gain map. Qualified codecs,
profiles and metadata are defined by `@atlas/photo-runtime`; an unsupported
original remains durably verified while preparation returns its refusal.

## Durable contract

- `create(staff,{requestId,label})` creates `{card}` with server-minted card and
  pair IDs. A retained UUID request returns the same card after a lost reply.
- `list(staff,{limit,cursor})` and `read(staff,cardId)` return only the current
  staff member's cards. Pagination limits reads, not creation or processing.
- `plan(staff,cardId,{requestId,side,expectedVersion,sha256,byteCount})` durably
  selects the next independently versioned side before signing. Replaying the
  exact request returns its exact plan even after newer photos; changed payloads
  under the same ID conflict. Separate Front and Back plans can advance together.
- `sign(staff,cardId,uploadId)` returns the real photo-storage conditional PUT
  descriptor, or `state:'VERIFIED'`. Every returned header and exact selected file
  byte must be sent. An old side selection cannot receive a new signed URL.
- `complete(staff,cardId,uploadId)` reads and hashes every exact stored byte,
  verifies complete lineage, and saves `{object,sha256,byteCount,contentType}`.
  It never trusts browser success, MIME, file name, ETag or metadata alone. A
  missing object returns `INTAKE_UPLOAD_ABSENT`; retain and retry that same plan.
  A saved receipt always returns the original accepted provider version.
- `prepare(staff,cardId,uploadId)` first retains that verification, then performs
  native decoding, rich/working storage, and full descriptor artifact storage
  outside transactions. It records only a compact reference afterward. Original
  or working preparation failures preserve prior originals and side history.
- `readSource(staff,cardId,uploadId)` returns `{upload,photo}` with hash-verified
  `photo={original,decodePlan,decodedFrame,workingFrame}`. Working schema-v2
  provenance must match the exact rich frame. Read image bytes through storage's
  `readDecodedFrame` with those exact descriptors; no user URL is accepted.
- `verifiedPair(staff,cardId)` returns `{cardId,pairId,sourceHash,principal,
  sides:{FRONT:{upload,photo},BACK:{upload,photo}}}` only for the current fully
  prepared pair. This is a server integration API, not a public authority claim.

The card DTO is `{cardId,pairId,label,revision,createdAt,sides,ready,sourceHash}`.
Each side is `{version,upload}`; an empty side starts at version0 with `upload:null`.
An upload contains its `uploadId`, `requestId`, `side`, `version`, exact `plan`,
nullable `verification`, and nullable `source:{photoSourceHash,ref}`. The source
hash is null until both current photos are prepared. Choosing a replacement
immediately makes the previous pair unavailable for new manual work. Late old
completion/preparation may add immutable historical evidence but cannot select
itself or disturb the other side.

Host manual provision, source replacement and every grading commit must call
`repository.assertCurrentPair(tx,principal,{cardId,sourceHash})` inside the **same
authenticated database transaction** as their commit. It acquires a SHARE lock
on the intake card; photo selection/completion uses UPDATE on that row. Checking
outside the transaction does not fence a concurrent photo replacement.
`authorizeInTransaction(tx,principal,cardId,{edit,lock})` supplies the same
ownership boundary for connected metadata. The host must refresh existing
authentication after waiting for locks and before returning the transaction, as
the existing durable staff boundary does. No CPU, storage or provider work may
run in these callbacks.

## HTTP and browser

`createIntakeHandler({service,boundary,origin,assertRequest})` mounts under
`/api/staff/manual-intake/cards`. GET/POST collection means list/create; GET card
reads it; POST `/:cardId/uploads` plans; GET `/:cardId/uploads/:uploadId` reads
status. POST `/:cardId/uploads/:uploadId/{sign,complete,prepare}` takes `{}`.
GET the corresponding `/source` returns the authorized descriptors. The host
applies its real deployment/router assertion and bounds JSON to8KiB before
parsing. POST requires exact origin, JSON, ordinary staff cookies and current
CSRF. All responses are private/no-store. Photo bytes bypass JSON/PostgreSQL.

`createIntakeClient({request,journal})` accepts the host's current authenticated
JSON client and staff-scoped journal. `createBrowserIntakeJournal({staffId})`
uses IndexedDB to retain the native Blob and exact request ID/plan through phone
reload. `pending()` and `resume(id)` restore interrupted work. Missing/uncertain
PUT responses always reconcile the same plan before another conditional PUT;
the browser response itself is never integrity proof. Preparation failure keeps
the pending source retryable. Once verification is durable, another replacement
can be selected without waiting for the old decoder; `forgetVerified(id)` removes
only its local pending record after a fresh server confirmation of retained
original bytes. The server keeps all original and historical artifacts.

No storage policy, CORS configuration or intended-provider capability is inferred
from these APIs. Before live use, independently verify private access, exact
conditional create/checksum/HEAD/GET/version semantics and browser PUT preflight
for every signed header. Configure bounded SDK deadlines and aggregate worker
capacity outside the database; the package does not create a scheduler or paid
model retry mechanism. A compromised serving database credential is not isolated
by row-level security: ordinary application ownership checks plus restricted
SQL grants are the intended boundary.

## SQL and local evidence

`sql/proposal.sql` is an inactive additive proposal outside automatic migrations.
It requires the existing staff schema and manual-auth proposal, adds two compact
intake tables and immutability/version guards, and changes no old records or role.
`intakeGrantSQL(role)` adds only SELECT/INSERT and named-column UPDATE on these
new tables to a separately reviewed manual role. That role cannot delete evidence
or change owners/plans. Operational activation remains separate.

Run `node --test packages/atlas-manual-intake/test/*.test.mjs` for browser recovery,
HTTP and actual decoder/storage adapter tests. The native runner takes the same
ownership-checked disposable PostgreSQL arguments as manual-service and requires
an absolute `ATLAS_INTAKE_EVIDENCE` output directory. It refuses inherited database
URLs, applies95 existing public and35 staff migrations only in a fresh owned
cluster with both no-op checks, then adds the manual and intake proposals there.
It uses real existing staff authentication with explicitly synthetic SMS and
synthetic bytes behind an injected SDK fixture. It validates side races, ACL,
hash/version conflicts, retained originals, artifacts, source fences, reload and
logout during processing. The owned fixture is always stopped afterward.

These tests do not prove live SMS, actual phone IndexedDB/browser uploads,
intended S3/Spaces behavior, deployment-runtime compatibility, retained real-card
optical quality, automatic identification or complete manual-app acceptance.
Those belong to the connected host's separately recorded integration evidence.
