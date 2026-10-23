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

The client now separates preparation from submission. The synchronous
`prepareRequest({bytes,plan,signal})` copies and hashes the original, generates
one request UUID and fixes its absolute BOOTTIME deadline. It opens no socket
and does not inspect an endpoint. It returns a frozen opaque handle whose only
property, `report`, is frozen metadata: schema/unqualified markers, requestId,
deadlineBootNs, original plan, bootId, epoch, bindingHash, profileHash and
limitsHash. The original copy is private. The future publisher must durably
commit that exact report as its submission intent before calling
`submitPrepared(handle)`. The client does not itself create that journal or
claim that intent exists. Handles cannot be reconstructed from reports/JSON,
transferred between clients, submitted twice, renewed or supplied caller IDs.

`discardPrepared(handle)` consumes a prepared handle without a socket and
returns a private-origin discard report. Abort, expiry, discard and close wipe
the private original. One prepared or active handle occupies the single slot;
there is no queue. A maximum of 128 preparations includes discarded handles.
An automatically expired/aborted/closed handle can be consumed once by submit
or discard, which throws its original privately recorded no-submission error.
All later uses refuse. `request(options)` delegates prepare then submit.
`close()` discards a prepared handle or cancels and joins an active request.
`status().retainedOriginalBytes` is bounded buffer accounting, not evidence
of decoder admission or process memory erasure.

`lookupDisposition(actualResultOrError)` accepts only an exact object produced
by this same client and returns frozen UNQUALIFIED metadata. Its disposition is
`COMPLETE_CLEAN` only after the authenticated matching terminal plus clean EOF;
`KNOWN_NO_START_SENT` only from a local branch before START submission; or
`UNKNOWN` after START may have been submitted and a conclusive terminal was not
obtained. The observation includes the exact prepared report, or null for a
preparation refusal before a handle exists. A null request must not be applied
to any earlier request. Error codes/text and caller objects do not determine or
mint a disposition. Forged, foreign and replayed handle refusals are deliberately
unbranded: they cannot relabel an earlier submission as never sent. Results,
lookup metadata and serialized copies grant no publication/customer authority.

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

The new local `proof-decoder-prepared-submission.test.mjs` covers only default-off,
closed-option and shaped-observer refusals. The operator script
`scripts/qualify-proof-decoder-prepared-submission.mjs CONFIG` requires actual
Linux/amd64 Node22.16, a protected pinned addon and the profile's real client
UID/GID. Config is a root-owned protected JSON file with exactly mode, plan,
addonPath, addonSha256, expectedBootId, expectedEpoch, expectedBindingHash,
originalPath and expectedOutcome. No environment variables are read.

Mode `handles` uses synthetic in-memory bytes, originalPath/expectedOutcome null,
and no socket method. It checks private snapshot/identity ownership, capacity,
closed options, no caller-error branding, discard, cancellation, close and real
BOOTTIME expiry. Private-byte wiping is observed through buffer accounting and
source review; the harness has no byte-inspection hook. Its five cases take at
most one configured timeout plus a short timer margin.

Modes `before-start`, `unknown`, `complete`, `cancel` and `close-active` require a
fresh root-owned originalPath and root's separately operated genuine broker or
deliberately absent/refusing endpoint. They emit PREPARED and wait for literal
`SUBMIT\n` on stdin within the original deadline. Root can inspect the actual
registry before allowing submission; the harness does not create fake peers or
receipt brands. `complete` requires expectedOutcome SUCCESS or INVALID_IMAGE;
other modes require null. `cancel`/`close-active` additionally wait for literal
`CANCEL\n`/`CLOSE\n`, which root must send only after independently observing the
exact real START. The `unknown` fault is also supplied externally by root.
These modes assert private dispositions, original request/deadline binding,
single use and wiping; they perform no reset, registry mutation or Engine
cleanup directly. Root must bound the outer process and preserve actual broker,
registry and guard evidence. No target run is implied by adding this harness.


Actual isolated target evidence (2026-10-23): prepared-handles-01 passed five genuine native-observer handle cases plus absent-endpoint KNOWN_NO_START_SENT as publisher UID/GID65530. functional-corpus-01 completed two original-bound PNG requests with private COMPLETE_CLEAN and FINALIZED before the next request. The overall batch FAILED on third-job cleanup: known exit0/noOOM, unresolved REMOVE intent, GUARD_LEASE quarantine. It is not a complete functional/containment acceptance. Unknown/cancel/active-close modes and unvisited corpus cases remain unrun; all outputs remain UNQUALIFIED. Frozen receipts and exact runtime03 source pins are in the R2 target proposal packet.
