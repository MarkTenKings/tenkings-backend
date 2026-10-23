# Decoder supervisor source experiment

This stage is **UNQUALIFIED**, default off, and local fixture only. It does not
create Docker containers, observe a Linux cgroup, verify IPC peer credentials,
run an independent watchdog service, or supply an accepted proof validator.
Existing physical intake/factory admission is unchanged. Caller hashes, synthetic
image/UID/resource profiles and fixture cleanup receipts are not target evidence.
No production adapter, promotion API or arbitrary executor callback is provided.

## Modules and ownership

- `proof-decoder-owned-operations.mjs` builds immutable, nonexecuting operation
  tokens from a validated plan and exact registry/job UUIDs, random owner nonce,
  pinned image/profile/epoch, registry-derived name and full container ID.
  Create, inspect, start, wait, fixed KILL and remove operations accept no caller
  commands, extra mounts, environment, credentials or arbitrary selectors.
- `proof-decoder-job-registry.mjs` opens a fresh owned private directory, or
  requires the exact explicit ownership receipt on clean reopen. SQLite uses
  DELETE journaling and EXTRA synchronization with readback. Durable intent/CAS
  records contain bounded original metadata and identities, never image bytes.
  The receipt token is an ownership check, not production qualification.
- `proof-decoder-fixture-executor.mjs` is the only shipped accepted executor.
  It is immutable and branded, has sealed scenarios, and starts only the fixed
  local PDW1 worker with the fixed Node arguments and five supplied environment
  keys. It models containers and cgroup observations in memory. A local child
  exit plus a simulated empty group is explicitly not whole-cgroup containment.
- `proof-decoder-watchdog.mjs` is a bounded local control loop. It acknowledges
  fresh reserved ownership before create; every cleanup checks exact identity.
  Concurrent requests share a single cleanup flight. Callers must inspect the
  requested durable row and retry one bounded flight when they joined another
  poll. This loop is not independent of the supervisor's process or event loop.
- `proof-decoder-supervisor.mjs` binds the plan's exact Unix socket in a fresh
  caller-owned 0700 directory, refuses an existing endpoint, and uses 0600 local
  socket permissions. These are fixture controls, not the reviewed production
  peer/UID/IPC qualification. Only branded registry/executor/watchdog ports fit.

All factories require `enabled: true`; absent/false returns null without I/O.
Typical explicit order is registry → executor → watchdog → supervisor; await
`supervisor.start()`. Close supervisor/watchdog/executor and then registry. Close
revokes local admissions, destroys owned sockets and joins bounded cleanup; it
preserves registry files for evidence/reopen. No background restart is attempted.

## Durable sequence and ambiguity

The normal sequence is RESERVED → CREATE_INTENT → CREATED → START_INTENT →
RUNNING → STOP_INTENT → CLEANUP_OBSERVED → FINALIZED. Only FINALIZED frees durable
capacity. Updates compare revision. The record binds cleanup to the exact job,
original identity, observed local process state and joined wait. Cleanup cannot
jump directly from QUARANTINED to FINALIZED. Pending child handles count as
running even before a start timestamp exists.

ACCEPT is sent only after the actual fixed worker starts and RUNNING is durable.
BUSY/NOT_STARTED is allowed only before reservation/create. Pre-ACCEPT create or
start uncertainty is reconciled privately and the connection closes; the client
quarantines its uncertain submission. REAPED is sent only after ACCEPT and after
the exact durable row is FINALIZED with joined local process exit. Setup failures,
worker failure/exit 2, timeout and containment uncertainty never become
INVALID_IMAGE. Only the worker's actual image result can classify an invalid
original. No financial or physical marketplace action is performed.

The same executor can resolve a committed create intent with a lost reply using
its exact retained identity. A fresh executor has no discovery authority over an
old live job: absent in-memory state means unknown, not confirmed absence.
Unknown/foreign identity causes quarantine and no kill/remove. A previously
committed CLEANUP_OBSERVED receipt can advance to FINALIZED after strict clean
reopen without inventing fresh executor discovery. A real Docker discovery and
independent restart reconciler remain future engineering.

Before SQLite open or any subsequent registry operation, the implementation
checks directory/file ownership, type, mode, inode and explicit receipt. It
refuses **any** `jobs.sqlite-*` sidecar before opening SQLite or changing journal
mode, including journal, WAL and SHM. Foreign/corrupt files remain unchanged.
There is no hot-journal adoption, automatic recovery or interrupted-SQLite-write
recovery claim. Qualification here covers committed intent/effect boundaries.
If the registry becomes unavailable after adoption, in-memory exact identities
still permit owned cleanup, but finalization/admission remain quarantined until
durable reconciliation. Private local filesystem checks do not qualify a hostile
same-UID file-replacement race or storage durability on a real target.

## Bounds and evidence limits

The original monotonic request deadline covers framing, hash, worker startup,
pipe writes, decode, cleanup acknowledgment and response/local socket closure.
Persisted wall timestamps are separate. A response cannot turn successful after
that deadline. Cleanup uses the lesser of remaining request time and its bounded
budget; the local watchdog can subsequently attempt safety cleanup with its own
bounded budget, without extending request success or releasing uncertain slots.
Worker spawn/pipe waits use the original deadline; kill/wait joins have bounded
cleanup deadlines. Transport loss does not assert worker death.

Protocol frames retain at most one admitted frame, DATA is 64 KiB except the final
frame, and each job admits at most 162 frames and the configured byte cap plus
bounded metadata. The supervisor defaults to 4 live connections (maximum 8),
128 total admissions (maximum 128), 30 seconds lifetime (maximum 60 seconds), and
500 ms cleanup budget (maximum 1 second). Profile concurrency is at most 2, no job
queue. Original timeout is at most 15 seconds. Registry retention defaults to 128
(maximum 1024) records and 16 MiB database; fixture executor retains at most 128
identities and a 512-entry event ring. Watchdog failures retain at most 64 entries.
No pruning invents absence or frees an unresolved durable slot.

Tests exercise real local worker pending-start/cancel/deadline cleanup, unknown
persisted identity refusal while the old real child remains alive, lost create
reply, uncertain/foreign cleanup, registry unavailability, concurrent cleanup,
committed cleanup/reopen, partial framing, half-open peers, startup/close races,
and rejection by the unchanged validator assertion. Root owns additional
registry file-boundary and client → supervisor → real worker join tests. Local
fake cleanup is never evidence that Docker/network/mount/cgroup/parent-death
containment passed. Real supervisor/watchdog services, Docker adapter, target OS
observations, image build, peer authorization and production capability join all
require a separately admitted stage.
