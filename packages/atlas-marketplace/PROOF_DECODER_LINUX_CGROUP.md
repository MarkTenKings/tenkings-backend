# Actual Linux parent controller — UNQUALIFIED

`src/proof-decoder-linux-cgroup.mjs` uses the protected native artifact loader
from the Linux peer observer. It captures only
`/sys/fs/cgroup/atlasdecoder.slice`. The native module walks protected root-owned
directories, requires cgroup2/domain mode, retains directory/control-file
descriptors, and checks the current path against the retained device/inode on
every operation. Callers cannot select another path or provide observations.

The public factory is default off. It requires the exact boot ID and native
artifact SHA256. `status()` is a bounded kernel projection, not qualification.
`boottimeNanoseconds()` reads actual `CLOCK_BOOTTIME`; it remains available after
quarantine for durable cleanup-intent timing, but refuses after close.

`assertMember({pid,containerId})` captures a pidfd before reading the process's
cgroup membership. It requires the exact fixed-parent systemd Docker scope and
a live process after observation. The PID is a read selector, never signalling
authority. This establishes current membership, not container ownership or a
future lifetime guarantee.

`freezeAndKill()` irrevocably quarantines this controller, writes the retained
parent's `cgroup.freeze` and `cgroup.kill`, and never thaws. Kill is attempted
even if freeze fails. Any uncertainty stays a failure. Whole-parent recursive
`populated` state covers descendants; a transient empty group never establishes
that an outstanding Engine CREATE or START has settled.

`observeEmpty()` produces an immutable private-brand token only for the current
healthy, empty, unfrozen held parent. The verifier requires the same controller,
rechecks current identity/state, and rejects tokens older than one second of
BOOTTIME. JSON copies, other controllers, closed handles and quarantined handles
cannot release a job. The target ledger also requires genuine settled Engine
cleanup receipts; native emptiness alone is insufficient.

The target-only harness `scripts/qualify-decoder-linux-cgroup.mjs` takes explicit
addon path/hash/boot ID. It uses one owned fixture scope and owned child plus
descendant, then checks real membership, freeze/kill, recursive empty, and
permanent controller quarantine. Its explicit operator fixture recovery verifies
the parent/scope identity and empty state before thaw/removal. This recovery is
absent from the runtime controller and is not a general unknown-effect reset.

Actual isolated-target evidence is in
`atlas-r2-target-proposal-20261023/ops/native-cgroup-ledger-02`: six kernel cases
passed with addon
`aff15fa824b62773cca4542a0e47c7f0c1b590aff12682fa0edcf799dd4c7076`.
The earlier five-case run predates the narrow systemd notification primitive;
the six-case run includes its closed-message/context refusal. Independent review
`ops/native-cgroup-independent-review-01.json` matches these source pins and
found no actionable defects. These are primitive checks, not the required
22-case worker containment acceptance or admission authority.

Semantics were checked against the
[kernel cgroup v2 documentation](https://docs.kernel.org/6.0/admin-guide/cgroup-v2.html).
Actual target observations remain authoritative for the installed kernel.
