# Target broker ledger

This separate SQLite ledger is **UNQUALIFIED**. It does not enable proof intake,
publication or production execution. The privileged broker owns its file writes
and concrete Engine effects. A separate root kernel guard enforces the broker's
lifetime and deadline. The fixture registry and its cleanup brands are unchanged.

`openProofDecoderTargetRegistry` accepts an explicit directory, launch plan,
epoch, and genuine Linux parent controller. It captures boot, profile, image and
the controller's retained `atlasdecoder.slice` binding. Reservation and effect
timestamps use the controller's actual CLOCK_BOOTTIME, with decimal uint64
nanoseconds on disk. There is one occupied slot, no queue and no deadline extension.
Reservation accepts exactly one of durationMs or deadlineBootNs. The absolute
form is checked against the current kernel clock and profile timeout, then stored
unchanged; SQLite work never resets it.

The directory and its ancestors must be protected and owned by the broker UID.
Files are private, regular, nonlinked and bounded; input opens are nonblocking.
An exclusive, fsynced `writer.lock` excludes another process. The ledger uses
SQLite DELETE journals, synchronous EXTRA, bounded busy waits and transactions.
Intents commit before acknowledgement. It keeps up to 128 jobs, four distinct
effects per job, 64 revisions per job and a 16 MiB database; it never prunes history.
These limits and SQLite settings do not establish storage hardware durability.

`reserve` fixes the original request and generated identity. `beginEffect` admits
only CREATE, START, KILL and REMOVE, once each, preserving the exact request hash
and operation ID. `observeEffect` accepts only the concrete Engine producer's
private receipt. An exact repeated observation is inert; contradictory evidence
poisons the epoch. No acknowledgement authorizes resubmitting an uncertain effect.

`enterCleanupBarrier` durably closes the job's admission barrier. `recordExit`
persists genuine terminal Engine state, OOM and WAIT evidence before REMOVE.
`finalize` requires the concrete settled Engine cleanup receipt and a genuine,
fresh, current empty-parent token from the stored controller. The token must
follow removal and post-removal absence, under the same boot, epoch, barrier and
parent. The ledger also requires every submitted effect settled and the deadline
unexpired. It stores closed historical projections, never reconstructed brands.

`quarantineEpoch` is permanent and preserves pending effects and occupied slots.
A later 404, successful response or empty snapshot cannot clear poison. Exact-owned
safety cleanup may record additional times while the controller remains frozen;
it cannot release capacity. The guard, not this metadata module, owns freeze/kill.
Failure to persist poison still closes the local ledger, and the independent
guard must cover broker death or stalled I/O. Those service guarantees require
actual target tests.

Clean close removes only the exact owned lock when there are no holds or poison.
An unfinished or poisoned ledger keeps its lock. Restart with a stale lock or any
SQLite sidecar refuses before writable recovery; there is no PID-based unlock,
automatic new directory, migration, epoch reset or parent thaw. A clean empty
reopen additionally requires its exact ownership receipt and immutable binding.

The new test file runs only default-off/forgery checks without arguments. Root may
run its explicit metadata harness on the isolated target:

```text
node test/proof-decoder-target-registry.test.mjs ADDON_PATH ADDON_SHA256 BOOT_ID NEW_PRIVATE_DIRECTORY
```

That harness uses a genuine controller and actual BOOTTIME, creates only fresh
metadata fixtures and retains them for inspection. It performs no Engine call,
worker execution or cgroup mutation and never fabricates receipt brands. Positive
finalization remains for the concrete Engine/native integration test; synthetic
fixtures cannot establish it.

On 2026-10-23, root ran this harness on the dedicated Linux target with the genuine
controller: eight tests passed (two refusal checks and six kernel/SQLite metadata
cases). The source and test hashes were respectively
`5ab85fad1c17cd2732f6acecef368e55ff0d8c4165655535a04ddd9726b210ea` and
`1d6a74d40d07b023a5e21fa1cc48ef43aad238623fef9342f4e35e68585e7624`.
The retained target-proposal packet contains `ops/native-cgroup-ledger-02` and
`native-cgroup-02/source-before-build.json`; metadata fixtures remain on that
isolated target. The same operation passed six native primitive tests using addon
`aff15fa824b62773cca4542a0e47c7f0c1b590aff12682fa0edcf799dd4c7076`.
This evidence does not cover positive Engine finalization, guard/broker failure
handling, storage power-loss durability or containment acceptance.
