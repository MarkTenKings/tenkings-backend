# Unqualified proof decoder protocol client

This is a local source-stage protocol experiment. It does not implement a decoder,
Docker supervisor, peer authentication, attestation verification, or production
admission. Every client status and successful result is marked UNQUALIFIED.
The existing proof validator assertion, physical factory, intake, object keys,
and historical retained objects are unchanged.

## API

createProofDecoderClient accepts enabled, socketPath, expectedQualificationHash,
expectedEpoch, and limits. It is inert unless enabled is exactly true; disabled
construction does not inspect endpoint inputs. socketPath is an absolute Unix
socket path of at most 100 bytes. The expected qualification hash and epoch are
caller expectations, not authority.

validate({ bytes, plan, signal }) returns an object containing classification:
UNQUALIFIED, validation: the existing v1 DTO, and reportedCleanup: REAPED.
status() reports local state. close() cancels pending work and joins local sockets.

The plan contains exactly byteCount, sha256, and declaredType. The client checks
source length before copying, then snapshots bytes, plan and limits before
asynchronous work. It hashes its owned copy. MIME is PNG or JPEG; these checks do
not decode the image. Only fake peers supply image results in this stage's tests.

Limits default to and cannot exceed 10 MiB, 16 million pixels, 15 seconds, and two
concurrent operations per client. Explicit null limits are refused; absent or
undefined values use the default. There is no queue or automatic retry. The
absolute monotonic deadline includes hashing, connection, framing, input writes,
output reads and response EOF. Socket construction happens only on validate.

## Wire grammar

Each frame has an eight-byte header: unsigned big-endian 32-bit payload length,
version byte 1, type byte, and two zero reserved bytes. Metadata payloads must
be exact canonical UTF-8 JSON: object keys sorted, no insignificant whitespace,
and the serialization produced by the repository's canonicalJSON. Ordinary
JSON with different ordering or whitespace is refused. Round-trip byte equality
rejects duplicate keys, including escaped aliases, and invalid UTF-8. The parser
also enforces nesting depth at most four and exact allowed fields at every level.

| Type | Number | Maximum payload | Exact metadata fields |
| --- | ---: | ---: | --- |
| HELLO | 1 | 4096 bytes | schema, qualificationHash, epoch, limitsHash |
| START | 2 | 1024 bytes | schema, requestId, qualificationHash, epoch, limitsHash, plan |
| ACCEPT | 3 | 512 bytes | requestId, qualificationHash, epoch |
| DATA | 4 | 65536 bytes | Raw binary bytes |
| CANCEL | 5 | 128 bytes | requestId |
| TERMINAL | 6 | 4096 bytes | requestId, qualificationHash, epoch, outcome, workerState, validation |

The protocol schema is atlas-proof-decoder-protocol-v1. Request IDs are random
UUIDv4 nonces. Epochs are opaque ASCII identifiers of 1–128 characters;
qualification and limits hashes are lowercase SHA-256. The limits hash is the
canonical hash of the four resolved limit fields. None of these confer authority.

One job uses one connection: peer HELLO, client START, peer ACCEPT, client DATA,
peer TERMINAL, then peer EOF. DATA sent by the client is 64 KiB except its final
frame. CANCEL can follow START at a frame boundary. The response parser accepts
only HELLO, ACCEPT and TERMINAL, at most three frames and 10000 total bytes; it
allocates at most one admitted metadata frame. The send loop waits for each
write callback and therefore does not queue the entire image on the socket.

TERMINAL outcomes are SUCCESS, INVALID_IMAGE, BUSY, CANCELLED, TIMEOUT and
CONTAINMENT_FAILURE. Worker states are NOT_STARTED, REAPED and UNKNOWN.
NOT_STARTED is allowed only before ACCEPT; REAPED requires ACCEPT. BUSY requires
NOT_STARTED. UNKNOWN requires CONTAINMENT_FAILURE. SUCCESS and INVALID_IMAGE
require ACCEPT, all input write callbacks completed, and REAPED. The peer's
REAPED statement is unverified; it is not evidence that any process exited.

Only SUCCESS contains a non-null validation object. It has exactly the old
atlas-marketplace-proof-image-v1 fields: schema, decoder, contentType, byteCount,
sha256, width and height. Decoder is sharp-0.33.5/libvips-8.15.3. The client
matches digest, count and MIME to its original plan and checks positive integer
dimensions and the pixel budget. It checks the terminal request ID, epoch and
qualification hash independently of that DTO. Success is never returned before
EOF: duplicates, trailing bytes and truncated frames are refused.

## Cleanup and limits of the experiment

Cancellation ignores late success and waits only within the original deadline.
A terminal cleanup report plus EOF permits protocol capacity reuse. Missing,
contradictory or unknown cleanup retains an occupied slot and quarantines the
client; subsequent calls fail. Containment failure is distinct from invalid
image data. A disconnect before START cannot have submitted this client's job.

status() separates active local operations, occupied slots, quarantine and
cleanup uncertainty. close() cancels active operations and joins local socket
closure; its returned cleanup acknowledgment is a peer report, never a claim of
verified remote containment. Quarantine has no reset or promotion API. Creating
a different unqualified client is not reconciliation or target qualification.

Actual peer identity, global service capacity, native memory/CPU/PID bounds,
container/cgroup termination, supervisor death cleanup and restart reconciliation
remain unimplemented and unqualified. Production admission must be separate and
must not trust this client, its expected hashes, its fake-peer tests, or a readiness
boolean as target evidence. No Docker build, container run, deployment, network
provider, or existing proof data migration occurs in this stage.
