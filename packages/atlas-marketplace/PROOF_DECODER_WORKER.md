# One-shot proof decoder worker — local qualification only

The PDW1 worker performs the existing full PNG/JPEG decode in a separate process.
It is not an accepted marketplace validator, container supervisor, or qualified
Linux runtime. No factory, intake, validator brand, proof key or manifest format
changes. The former source/container/raster functions are moved unchanged into
`src/proof-image-decode.mjs`; the legacy child adapter keeps its exports,
arguments, environment, JSON/base64 transport and result DTO.

## Fixed launch and dependency closure

The new entrypoint is `src/proof-decoder-worker.mjs`. It runs only as its exact
canonical main file. Importing it does not start a worker. The launcher uses an
absolute Node executable and exactly:

```
node --max-old-space-size=128 /canonical/path/proof-decoder-worker.mjs
```

No additional runtime options or script arguments are accepted. The launcher
constructs the five environment entries from the existing profile:
HOME=/nonexistent, HOSTNAME=atlas-proof-decoder,
PATH=/opt/atlas-proof-decoder/bin, UV_THREADPOOL_SIZE=1 and VIPS_CONCURRENCY=1.
Unknown names or changed values refuse. The launcher must exclude NODE_OPTIONS,
loader/preload settings and inherited credentials before starting Node; a
JavaScript check cannot undo code loaded before the entrypoint.

Local Darwin qualification observed Node adding __CF_USER_TEXT_ENCODING even
when the launcher supplied only those five entries. Darwin permits only the
observed UID-derived value `0x<uppercase hexadecimal getuid()>:0x0:0x0`; a changed
realized value refuses. This is an explicit local OS exception. Linux still requires
exactly the five profile names and values. No image or Linux observation is
implied.

The code closure is the worker, worker protocol, shared decode module, existing
proof-decoder-protocol and contract modules. The existing exact sharp 0.33.5
dependency and libvips 8.15.3 runtime check remain. Future image work must retain
a complete code/dependency/native-library/Node hash manifest and qualify the
matching Linux architecture, libc and realized environment. No Dockerfile,
image, build, container run or target admission is produced here.

## PDW1 wire contract

One process receives one original through stdin and writes one result to stdout.
Each direction begins with the ASCII magic PDW1 followed by an unsigned
big-endian 32-bit metadata byte length. Metadata is exact canonical UTF-8 JSON,
with depth at most four and unknown/duplicate keys (including escaped aliases)
refused.

Request metadata is at most 1024 bytes and contains exactly:
`{schema,requestId,plan,limits,limitsHash}`.
Schema is atlas-proof-decoder-worker-request-v1; requestId is a lowercase UUIDv4.
Plan is exactly byteCount, sha256 and declaredType. Limits contains all four
resolved decoder limit fields and its canonical SHA-256 must match limitsHash.
The maxima remain 10 MiB, 16 million pixels, 15 seconds and two externally
scheduled jobs; a single worker handles one job. No actor, order, credential,
filesystem path, endpoint or executable is an input.

Exactly plan.byteCount raw bytes follow the request metadata, then stdin EOF.
The parser allocates only after bounded metadata validation, owns one original
buffer, verifies its digest and refuses missing or trailing bytes. No decode or
image verdict occurs before complete original input and EOF.

Result metadata is at most 4096 bytes with no binary body:
`{schema,requestId,outcome,validation}`.
Schema is atlas-proof-decoder-worker-result-v1. Outcomes are SUCCESS,
INVALID_IMAGE or DECODER_FAILURE. Only SUCCESS includes validation; the other
two use null. Validation has the unchanged atlas-marketplace-proof-image-v1
fields: schema, decoder, contentType, byteCount, sha256, width, height.

Worker output carries no epoch, qualification, process-exit, REAPED or cgroup
assertion. The receiver must bind requestId, original digest/count/MIME and
dimension budget, require exact output EOF and independently inspect process
exit. A forged worker output is still untrusted.

## Failure, deadline and ownership

SUCCESS and INVALID_IMAGE use exit code 0. DECODER_FAILURE, setup, malformed
input and other availability failures use exit code 2; an unavailable worker may
exit with no complete result. Known container/pixel errors and a small explicit
set of corrupt-image decoder messages map to INVALID_IMAGE. Missing dependencies,
wrong decoder versions, OOM/resource errors, timeouts and unrecognized native
errors map to availability. Native error text is not exposed in the result.

The worker's monotonic deadline starts at main entry, is never extended, and
includes input framing, source hashing, decode and output completion. A request
may shorten the compiled 15-second limit. The internal timer cannot contain a
hung native thread or descendants. The independent launcher deadline must start
before spawn and include process cleanup; if cleanup is uncertain, it must
retain capacity and quarantine the job.

Cancellation is external termination of the owned process/job, not a cooperative
native callback or a second stdin command. The worker emits no cleanup receipt.
Local tests join the actual child close event and observe the owned PID gone;
this does not demonstrate Linux cgroup emptiness, supervisor-death cleanup,
network denial, native RSS bounds or target containment.

## Exported protocol helpers and local evidence

The codec exports encodeProofDecoderWorkerRequestHeader for bounded streaming,
encodeProofDecoderWorkerRequest for complete local fixtures,
createProofDecoderWorkerRequestReader, encodeProofDecoderWorkerResult,
createProofDecoderWorkerResultReader and assertProofDecoderWorkerResult.
Readers expose feed, end, dispose and status. end returns the value and invokes
any supplied completion callback only after EOF validation. dispose zeros owned
buffers. Request onHeader is for early deadline shortening, never image approval.

Focused tests cover actual PNG/JPEG parity with the legacy validator, corrupt
compressed pixels, truncation/appended content, MIME/pixel bounds, missing
dependency, conservative availability classification, exact launch refusal,
partial-input deadline, external cancellation and strict framing/original
binding. The five existing proof-image regressions remain part of the focused
run. Native OOM and target containment are not claimed from synthetic error
classification or owned local child termination.
