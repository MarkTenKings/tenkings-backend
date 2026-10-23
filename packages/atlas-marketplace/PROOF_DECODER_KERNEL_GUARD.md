# Independent target guard — UNQUALIFIED

The privileged broker owns the SQLite ledger, Engine effects and private
receipt brands. `src/proof-decoder-kernel-guard.mjs` runs its guard in a separate
root process. The guard has no Engine connection, ledger writer or receipt
constructor. Protocol JSON never becomes cleanup or admission authority.

The fixed control socket is `/run/atlas-r2-decoder-guard/control.sock` in a
protected root-owned 0700 directory, with a 0600 socket. Both sides capture
actual AF_UNIX peer credentials and atomic peer pidfds. Same-process peers are
refused. The client binds the current protected socket inode, controller boot
and parent binding, target-ledger binding, epoch and profile. No transport,
clock, peer or observation callback can replace these concrete objects.

The guard accepts one broker connection for its lifetime, one active lease,
at most 128 jobs and 256 request/acknowledgement operations. Every job is adopted
before an Engine effect. The original absolute BOOTTIME deadline is never
extended. Framing is bounded duplicate-aware JSON, with exact message fields,
request sequencing and random server/lease nonces. PULSE messages arrive every
50 ms; the broker rejects observations older than 250 ms using the actual
shared kernel clock. Connection and acknowledgement waits are bounded at
500 ms. These messages are reports of a live channel, not qualification tokens.

Only the broker's genuine finalized ledger row permits its client to settle a
lease; the guard also requires current parent emptiness. Idle parent population,
peer death/disconnect, deadline expiry, stale heartbeats, malformed messages,
controller changes or protocol uncertainty poison the channel and freeze/kill
the entire fixed parent. The broker retains the durable hold. A lost guard
also poisons the broker and invokes the broker's independent parent controller.

`deploy/atlas-r2-decoder-guard.service` supplies the additional failure boundary:
systemd's 500 ms watchdog kills a stalled guard, and `ExecStopPost` executes a
separate quarantine helper. The helper writes/fsyncs a persistent root-owned
quarantine latch and freezes/kills the parent. Startup refuses a retained latch;
Restart is `no`. No runtime thaw or automatic crash recovery exists. The service
entry point accepts only `start` or `quarantine`, reads one protected source-only
configuration, and uses only the named non-secret systemd notification variables.
It never discovers credentials or accepts an arbitrary notification destination.

The unit currently contains explicit isolated qualification-host paths. It is
not a deployment authorization or production configuration. The runtime still
requires complete worker/profile/IPC/cleanup qualification and the application's
authoritative admission/publication boundary.

Actual evidence in `atlas-r2-target-proposal-20261023/ops/guard-watchdog-01`:
the service reached READY; a genuine separate broker reserved/adopted a test
lease; both broker and guard were stopped; systemd's watchdog killed the guard
and the separate post-stop helper killed the owned worker helper in 0.787 s.
The parent became recursively empty and remained frozen, the old writer lock
remained, and the quarantine latch existed. This uses a structural test profile
and an owned helper, not the decoder image or an applied worker security profile.

The source review of guard/service/unit and ledger join is recorded in
`target-engine-01/independent-guard-ledger-review-01.json`. A subsequent narrow
idle-parent empty check was separately reviewed and is included in the target
fault probes. Failed harness attempts and explicit fixture recovery are retained
separately; no failure is rewritten into acceptance.

`ops/guard-faults-settled-03` additionally passed actual broker death, absolute
lease expiry with the broker stopped, and unexpected idle parent population.
Each ended with SIGKILL, recursive empty, frozen parent, persistent latch and
retained metadata holds where a reservation existed. Elapsed times through the
terminal service state were 0.445 s, 0.842 s and 0.379 s respectively; these
include post-stop completion and are not measurements of the exact kill instant.
The first broker-death attempt had already passed kill/empty checks but checked
the service state before its post-stop helper finished. Its failed receipt and
read-only final-state evidence are retained; only that failed case was repeated
with a corrected wait, followed by the two previously unreached cases.

Service semantics were checked against
[systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
and [sd_notify](https://www.freedesktop.org/software/systemd/man/latest/sd_notify.html).
Actual installed systemd observations, rather than documentation alone, support
the primitive evidence above.
