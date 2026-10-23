# Default-off Engine transport and executor

These new modules perform concrete Unix-socket I/O only when explicitly enabled.
`enabled:true` is not a dry run: a harness can create and start a container.
Their `UNQUALIFIED`, `executionAllowed:false` markers mean the results cannot
grant production execution, validator, admission or publication authority. They
are separately branded and remain unwired from the fixture supervisor/watchdog,
physical factory and accepted image-validator capability.

`createProofDecoderEngineExecutor({enabled,plan,registry,socketPath,apiVersion,
epoch,headerTimeoutMs?})` requires the existing branded durable registry, an
explicit absolute Unix socket path and service epoch. There is no endpoint,
Docker environment/context, credential, image or target-platform discovery.
API `1.47` must be supplied explicitly because it is the existing fixed wire
contract. The lead's observed version-endpoint compatibility does not qualify
create/attach behavior, image execution, ownership or containment.

`executor.run({jobId,originalBytes,seccompBytes,signal?})` reads the exact RESERVED
row itself and checks its epoch. Before any connection, the transport copies the
caller buffers, verifies the original byte count/hash and validates the pinned
seccomp bytes. It uses the fixed compiler for image inspection, create, identity
inspection, attachment, start, running-state inspection, bounded original input,
write-side EOF, wait and output EOF. It sends no arbitrary command, HTTP path,
query, headers, mounts or environment. KILL and REMOVE are unavailable in this
layer; future owned cleanup needs independent evidence and a separate design.

CREATE_INTENT and START_INTENT are committed before their respective requests.
A lost reply never triggers a retry, name replacement or inferred no-effect
result. Those exact durable intent rows retain the original identity, nonce,
request plan and any learned full container ID. On an uncertain create/start
reply their phase remains the intent phase, with capacity still occupied. A
reopened executor sees unfinished non-RESERVED rows and starts quarantined.
Other finished/failed jobs transition to QUARANTINED. Every completed run also
quarantines this executor and cancels other active runs. No cleanup receipt,
FINALIZED transition or capacity-release operation is implemented.

The underlying `createProofDecoderEngineTransport` binds one exact initial job,
launch plan, original plan, copied bytes, seccomp artifact, monotonic deadline
and optional AbortSignal. Its request method accepts only the seven fixed
operations listed above, with LOOKUP available as a constrained structural
operation; the executor does not retry or perform unknown-create recovery.
The existing transcript reviewer checks request order before any request is
sent. CREATE updates only that session's reported container ID. Response
projection validates exact labels, image and job identity; this establishes
structural agreement, not authenticated daemon ownership.

Bounds and stream behavior are explicit:

- At most two pending HTTP requests plus one upgraded attachment, with no
  unbounded queue or pooled connection across jobs; at most 24 requests and 512
  transcript events. Each executor admits at most the plan's concurrent jobs
  and remembers at most 128 distinct jobs; it never replays a job.
- HTTP headers are at most 8 KiB and 32 fields. Bodies use one bounded 256 KiB
  accumulator, regardless of fragmentation. Duplicate headers, compression,
  trailers, malformed JSON, unexpected informational/upgrade responses and
  incomplete bodies refuse. Body content and raw errors are never returned or
  logged. Private in-memory transcript buffers are bounded and zeroed on close.
- A header timer defaults to one second and may be explicitly set from 1 ms to
  five seconds. The monotonic overall deadline includes body reads, input
  backpressure, half-close, output draining and wait; it cannot exceed the
  launch-plan timeout or the durable row's remaining deadline. Cancellation,
  deadline or uncertainty destroys this session's sockets without asserting
  that any container stopped.
- PDW1 header and original are written sequentially in chunks no larger than
  64 KiB, awaiting both the write callback and drain when required. Input EOF
  is recorded after the socket's write-side finish callback. The read side
  remains open to drain output. Caller buffer mutation after `run` starts cannot
  change the private original or seccomp copy.
- HTTP101 buffered bytes are fed exactly once. Docker multiplexing, stdout
  prefix timing, worker result binding and output EOF remain mandatory. Output
  is at most 10,248 bytes, including bounded stderr and record headers. Raw
  stderr is discarded; it never becomes a verdict or evidence text.

Run results contain a closed unverified transcript review, the structurally
checked worker report, safe local I/O counters, and registry hold status.
`localWriteAcceptedBytes` counts callbacks accepted by the local socket library;
it is not independent proof of remote input receipt. A 404, zero wait exit code,
worker SUCCESS, socket EOF, or successful socket destruction never proves
absence, whole-cgroup cleanup or released capacity. `registryHeld:false` means
the durable hold could not be confirmed; the result still requires quarantine.

Actual daemon/boot/service identity, independent surviving supervision,
authoritative admission, peer credentials/pidfd binding, cgroup ownership and
whole-job cleanup are external unimplemented joins. In particular, the new
target's Docker socket peer may be PID 1 through systemd socket activation;
this transport does not equate socket peer PID with dockerd PID. The fixed
compiler still has no target-owned CgroupParent mapping. No real image decode
or target qualification has been performed by these source tests. Ownership
claims/history and pricing remain disabled pending Fingerprint plus genuine
title, consignment or custody authority.

Focused tests use only a temporary fake Unix HTTP peer and local private SQLite
registry. They cover caller mutation, partial writes/backpressure, half-close,
upgrade-head fragments, early stdout, exact ownership, lost create/start replies,
no retries, header/body/deadline bounds, cancellation and retained capacity. They
do not contact Docker, the VM/provider, or credential material, and do not run an
image or decoder. Existing passing baseline tests need not be replayed for this
additive slice.
