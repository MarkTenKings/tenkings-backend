# Enrolled decoder restart reconciliation

This source is default off and **UNQUALIFIED**. It adds automatic resource
reconciliation for one explicitly enrolled epoch. It supplies no intake,
publication, ownership, admission or runtime qualification grant. Existing
grading and Ten Kings behavior is preserved.

`openProofDecoderEnrolledTargetRegistry({enabled, plan, controller, epoch,
addonPath, addonSha256})` returns `{registry, status}`. `registry` is the genuine
target registry, with the existing interface and receipt brands. The factory
requires the real root Linux controller, an empty unfrozen fixed parent, and
maxConcurrent1. It creates only the fixed protected
`/var/lib/atlas-r2-decoder-recovery` tree, which must not already exist. The first
installation must separately establish that legacy brokers have stopped and
their resources/uncertainty have been preserved. Legacy brokers did not retain
this native lock; their death cannot be inferred from an old token or PID.

The additive native `captureRecoveryLock` obtains nonblocking exclusive `flock`
on the existing zero-byte, root-owned0600 `owner.lock` in that root-owned0700
directory. It retains the descriptor and directory identity. The private native
handle has no pathname, PID, unlock or admission argument. The JavaScript owner
retains it for process lifetime, including factory failure and clean close.
The fixed catalog includes the exact lock inode, metadata and hash, boot,
fixed-parent identity, addon hash, epoch and full launch plan. Replacing the
lock cannot establish old-owner death. A live owner makes a second acquisition
refuse. Closing a socket or the JavaScript registry does not release this lock.

The catalog is fsynced before creating its one `ledger` directory. A separate
immutable enrollment record binds the genuine registry ID, binding hash,
manifest identity/hash, ledger directory and database inode before the factory
returns. The registry accepts only the private enrollment object, checks it at
reads/transactions and status boundaries, and retains all existing checks.
Frequent checks compare the original full file identities including nanosecond
ctime/mtime, plus the retained native lock and parent binding; expected values
are never refreshed. Startup/recovery reads also verify bytes and hashes.
Once the fixed gate exists, this source refuses unenrolled registry opens and
effects, including attempts to switch directories. This does not claim to fence
an old binary which predates enrollment, or a malicious root administrator.

`reconcileProofDecoderRestart({enabled, controller, linuxObserver, addonPath,
addonSha256})` is the separate restart entry point. It accepts genuine producers,
not callbacks or JSON receipts. It never creates a replacement catalog or
adopts a legacy ledger. Without the fixed gate it reports
`LEGACY_UNENROLLED_HOLD`. Missing/corrupt enrollment, stale SQLite sidecars,
foreign files, changed boot/addon/parent, changed lock or changed ledger refuse.
Cross-boot migration and automatic rollback recovery are outside this tranche.

After obtaining the retained owner lock and validating the catalog binding,
recovery freezes/kills the whole owned parent, even if later ledger validation
refuses. It never thaws or starts a guard/broker. The original database is opened
read-only after rejecting sidecars; all original manifest/database/lock bytes
and identities are preserved. Closed historical rows, request identity, phases,
event chain, operation IDs, canonical JSON and poison/barrier relationships are
validated. Historical observations remain data, with no reconstructed private
Engine or kernel brands. CREATE/START/KILL/REMOVE request hashes are recompiled
against the pinned plan and fixed public seccomp artifact before any resource
operation. Neither Config.Env nor credentials are inspected or reported.

The recovery journal is append-only with exclusive creates and fsync. It pins
the initial full ledger snapshot and files. Each process makes one bounded
attempt: at most128 historical rows, 16attempts total, a 30second recovery
budget, one-second parent-empty wait and one-second/500ms request/header bounds.
These are separate safety-cleanup bounds; original job deadlines never change.
The Engine endpoint remains exactly `/run/docker.sock`, protected and pinned,
with the genuine root kernel peer/pidfd check and API1.47. A systemd PID1 peer is
an endpoint lifetime fact, not proof of dockerd identity or qualification.

For each row:

- No recorded CREATE produces a held no-effect result without an Engine request.
- A known container ID is inspected exactly. Unknown CREATE is looked up only by
  its generated name, with exact registry/job/nonce/profile/epoch labels, image
  reference and fixed CgroupParent required. Absence is an observation, not a
  settled CREATE/START result or permission to free capacity.
- A resource reported for an already FINALIZED row is a contradiction and is
  retained. No new DELETE is authorized by that old successful row.
- Either an original REMOVE intent or a prior recovery DELETE intent permits
  lookup only. A lost DELETE response is never retransmitted.
- Otherwise a discovered exact-owned terminal resource, whole-parent frozen
  and empty, is a candidate for one non-force `DELETE ...?force=0&v=0`. Its
  separate durable intent precedes the request. Only an actual204 is stored as
  that response, followed by a new exact-ID absence observation. A failure
  leaves the intent and the original hold intact. Future restart may observe
  absence, but cannot convert it into the missing response.

Journal records and returned summaries are **not** normal cleanup receipts.
Recovery does not call the registry's recordExit/observeEffect/finalize methods,
remove its writer lock, mutate original rows/events, restore a publisher handle,
clear UNKNOWN, release capacity, reset the epoch or authorize a new directory.
Pending late CREATE/START effects remain uncertain even after a current absence
observation. The held frozen parent prevents a later child from running; future
bounded lookup may discover its resource. No automatic new epoch is implemented.

The broker composer must use the enrolled factory's genuine registry and the
matching source/native closure. `proof-decoder-target-broker.mjs` is unchanged
by this tranche. The fixed catalog remains a permanent gate after clean close
as well as failure. Root owns enrollment installation, deployment/service
composition, explicit reconciliation of old legacy epochs, and all target runs.

Local focused evidence is six passing tests for default-off/forgery refusal,
closed historical snapshots and history tamper refusal, immutable unresolved
CREATE, accessor rejection, and no-retry/no-capacity resource decisions. These
tests contain synthetic historical data only and do not load native code or
open sockets. Existing unchanged suites were not replayed.

Native compilation and positive target behavior remain **NOT_RUN**. Required
target checks include retained-lock exclusion and owned-process death, exact
inode/path replacement refusal, enrolled broker effects, killed owner with
pending CREATE/START, late resource appearance, sidecar/partial enrollment
refusal, known finalized absence/contradiction, and crash/lost response between
DELETE intent and response. They must verify original ledger and publisher holds
byte-for-byte and the frozen parent independently. Current source and pure tests
do not set `restartReconcilesOwned: true`.
