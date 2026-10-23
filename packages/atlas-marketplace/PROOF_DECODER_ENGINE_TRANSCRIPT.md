# Decoder Engine transcript review

`reviewProofDecoderEngineTranscript({plan,job,original,seccompBytes,events})`
reviews explicitly supplied, synthetic in-memory events. It opens no socket,
starts no process and reads or writes no filesystem/database. The API 1.47 wire
compiler is a reference contract, not an identified or authorized target.
Every result is **UNQUALIFIED**, `executionAllowed:false`, `cleanup:UNKNOWN`,
`capacityHeld:true` and `freshPublicationAllowed:false`.

The initial owned job has no container ID. The original is the unchanged
byteCount/SHA-256/declaredType plan. Supplied seccomp bytes are checked against the
launch plan before review. No caller endpoint, executable, credentials or
transport callback is accepted. Arrays are dense, contain at most 512 events,
and use own data properties. Event discriminants are strings; coercion hooks
and accessors are not invoked.

## Closed event grammar

Every event has `type`, `atMs` and `epoch`. atMs is an explicitly supplied,
nondecreasing integer below the profile timeout; it is **not** a Linux boot-clock
observation. Epoch equality is structural and grants no service identity.

| Type | Additional fields | Meaning |
| --- | --- | --- |
| REQUEST | operation | Review one fixed wire operation, never execute it |
| RESPONSE | operation, statusCode, headers, body, upgradeHead | Bounded Engine report; body and upgradeHead are Buffers |
| INPUT | bytes | Exact PDW1 header followed by original bytes, up to 64 KiB per event |
| INPUT_EOF | none | Claimed write-side half-close after complete matching original |
| OUTPUT | bytes | Bounded Docker multiplex records, up to 10,248 bytes per event |
| OUTPUT_EOF | none | Claimed read-side EOF, validating both multiplex and PDW1 completion |
| UNCERTAIN | operation | Absorbing uncertainty; later events are not processed |
| CLEANUP_CLAIM | none | Refused: this model cannot authenticate whole-job cleanup |

IMAGE_INSPECT precedes CREATE. The successful CREATE report supplies the full
container ID; a matching created-state inspection precedes ATTACH and START.
LOOKUP cannot overlap CREATE or adopt a different container. ATTACH requires the
reference 101 upgrade; buffered upgradeHead is consumed once, separately from
the empty HTTP body. START acknowledgment and a consistent running-state report
precede INPUT and WAIT. A pending request cannot be duplicated. Only INSPECT and
LOOKUP may repeat, at most eight times each.

INPUT_EOF verifies header, exact byte count and original digest. A stdout record
that begins before that boundary remains early even if its payload completes
afterward. Partial header/payload fragmentation cannot hide early output. stderr
is bounded and discarded; it never supplies an image verdict or raw log entry.
The model preserves separate write-side and read-side EOF events. It does not
establish actual transport half-close behavior.

Terminal WAIT or exited-state observations forbid subsequent input or renewed
running reports. Already-buffered output may still drain after terminal exit.
Repeated running observations must preserve PID and start timestamp. Inspect and
wait exit codes must agree, as must the final worker outcome: SUCCESS and
INVALID_IMAGE report exit 0; DECODER_FAILURE reports exit 2. A failure may be
observed before complete input, but cannot become image-invalid or publication
permission. A stream that ends before launch cannot later permit START.

Missing EOF or response leaves INCOMPLETE. A complete consistent worker report
and wait yield DECODE_REPORTED_CLEANUP_UNVERIFIED. Malformed replies, wrong
identity, stale epoch, deadlines, create/start response loss, contradictory
state, unknown effects or cleanup requests yield RECONCILIATION_REQUIRED.
Refusal is a closed code; raw Engine/worker diagnostics are never returned.
Unprocessed events cannot clear the hold. Even an empty transcript retains
unknown cleanup and grants no capacity-release decision.

## Qualification boundary

Focused tests use invented original bytes and Engine/worker reports. They do not
decode an image, launch a worker, contact Docker, exercise a native helper or
prove containment. Tests cover both EOF boundaries, fragmented upgrade/output,
original/result binding, late/stale results, identity races, terminal-before-input,
PID/start changes, inconsistent exits, lost replies, malformed/trailing records,
overflow, and fabricated cleanup. Earlier real local worker/SQLite/socket and
Stripe/PG/browser evidence remains valid only within its unchanged source scope.

A real adapter still requires an identified target and daemon, pinned image and
native dependency closure, a qualified peer/boot clock, an independently
surviving watchdog, exact owned non-threaded cgroup mapping and descendant
cleanup, and authoritative admission/revocation. A separately implemented and
qualified intake/factory join must preserve original keys and historical reads.
The [outcome model](PROOF_DECODER_OUTCOME_POLICY.md) does not supply those gates.
Ownership claims/history/pricing remain disabled; Fingerprint and genuine
ownership authority are separate requirements. Grading and Ten Kings are unchanged.
