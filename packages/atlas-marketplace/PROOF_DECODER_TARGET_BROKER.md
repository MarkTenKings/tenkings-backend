# Target broker transport

This separate transport is **UNQUALIFIED** and default off. It does not connect
to physical proof intake, mint publication authority, promote existing brands or
complete the 22-case qualification contract. Its successful result is an inert
report with `executionAllowed: false` and `freshPublicationAllowed: false`.

The root broker process owns the concrete target registry, Engine executor and
its private receipt brands. The separate kernel guard supervises that process.
Root composes those objects and calls `startProofDecoderTargetBroker` with
`plan`, `targetRegistry`, `parentController`, `observer`, `executor` and the exact
`seccompBytes`. Only genuine same-process controller/observer/registry/executor
objects fit. The executor already contains its concrete guard client and uses
its authenticated fixed `/run/docker.sock` endpoint. No effect callback, fixture
executor, receipt deserialization or arbitrary endpoint is accepted here.

The sole application endpoint is `/run/atlas-r2-decoder/broker.sock`. Root must
create its directory as 0750, owned by root and the profile's client group. All
ancestors must be canonical root-owned directories without group/world write
permission. The root listener creates a 0660 socket owned by root:clientGid and
pins directory/socket device and inode. Existing endpoints refuse startup; there
is no stale removal or automatic restart. Closing uses Node's normal closure of
its own listener. Root controls the service and any later recovery.

The nonroot process calls `createProofDecoderTargetBrokerClient` with the plan,
genuine Linux observer and explicit expected boot ID, epoch and ledger binding
hash. Its UID/GID must match the profile's client identity. Root installs readable
pinned code, Node and the native addon separately; this module discovers nothing
from environment variables. Both sides require the exact opposite UID/GID and a
distinct PID, capture the atomic peer pidfd, and keep checking its lifetime,
socket descriptor identity and protected filesystem identity.

Version 2 uses an eight-byte header, bounded canonical JSON metadata and raw
DATA frames of at most 65536 bytes. It does not reuse v1's qualificationHash.
HELLO binds boot, epoch, profile, limits, ledger and a fresh connection nonce.
START adds the original byte count/hash/type, request UUID and absolute decimal
CLOCK_BOOTTIME deadline. ACCEPT follows durable reservation of that exact
deadline. The registry's existing durationMs form remains available; exactly one
of durationMs and deadlineBootNs is required. No conversion extends the deadline
while SQLite is busy.

The client copies and hashes the original before opening a socket. The broker
collects only the admitted bounded bytes in memory and verifies count/hash before
INPUT_END starts the concrete executor. Data chunks have exact prescribed sizes.
Only matching CANCEL is legal after INPUT_END. Partial or pending input prevents
a successful terminal report. There is one active authenticated connection/job,
no application queue, at most 128 requests per client/listener, a bounded native
connection count and a 500 ms pre-START handshake limit. The profile deadline
covers snapshot/hash, connection, transfer, execution, cleanup and terminal EOF.
Each write is awaited, and blocked I/O is subject to peer/deadline checks.

After reservation, cancellation, app disconnect/death, protocol failure or time
expiration aborts execution, permanently poisons the epoch and requests whole-
parent freeze/kill. It does not infer successful cleanup or release holds. Before
reservation, an unauthorized or malformed connection creates no job. Once START
has been submitted, the client conservatively retains uncertainty after any
failure and does not retry. Its close method joins its local connection.

A successful terminal report requires the executor's actual completed cleanup,
FINALIZED ledger row, settled guard lease and unchanged original DTO binding.
The client requires exactly one terminal and clean EOF. Late cancellation,
duplicate/trailing output, partial output, changed endpoint or stale peer cannot
become a success. Engine and kernel receipt brands never leave the broker.
No proof bytes are written to files, SQLite or logs; owned buffers are cleared.

The local test file covers pure framing, canonical/closed metadata, byte
collection, bounds, unqualified markers and factory refusals. It creates no
socket, fixture worker or positive runtime receipt. Nine tests passed in the
initial local run; the packet records that direct tool observation. The listener
and client lifecycle still require root's genuine cross-process target runs,
including peer identity/death, cancellation, blocked I/O, path tampering,
concurrency, real PNG/JPEG cleanup and failure injection. Those tests and the
remaining qualification cases must precede any production authority decision.
