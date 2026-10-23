# Native control probe source

This is **PROBE_ONLY** source and a pure wire parser. It is neither the decoder
nor an execution permit, qualified report or publication capability. Root must
review, compile, build and run it on the dedicated target. This lane performs
no native compilation, execution, target operation or production worker change.
A successful source/protocol check proves no kernel control.

The root-built probe image must have a distinct immutable repository digest.
Starting from the exact reviewed decoder rootfs, replace only
`/opt/atlas-proof-decoder/bin/node` with the compiled probe ELF. Preserve every
other file, its metadata, the empty image ENV, no image volumes, and the original
fixed argv shape. Record a complete comparison against the approved inventory,
the changed executable's source/ELF hashes, compiler/linker/version/options,
ELF interpreter/needed-library closure, resulting image manifest/config hashes,
and the actual imported digest. No unknown digest is supplied by these sources.
Do not overwrite, retag, rebuild or modify the production worker image. A probe
image is not the exact functional worker even when its security policy is equal.
The three argv strings required by the probe are exactly:

```text
/opt/atlas-proof-decoder/bin/node
--max-old-space-size=128
/opt/atlas-proof-decoder/worker.mjs
```

The ELF does not interpret Node switches or execute worker.mjs. It recognizes
only that closed initial shape. Before reading a challenge it requires real and
effective uid/gid 65532, NNP 1 and seccomp mode 2. These checks are defense against
accidental use, not proof of the correct filter, image, cgroup or independent
guard. Never execute this ELF on the host. Root must establish the exact owned
probe container and independent guard before submitting any bytes. The same
memory/CPU/task/fd/tmpfs limits and named AppArmor/seccomp policies apply. No
permission may be widened to accommodate a probe; a refusal is retained evidence.
The actual broker and guard artifact identities remain separate observations.

A possible target compiler invocation uses the target's reviewed compiler with
C11, `-O2 -Wall -Wextra -Werror -pthread -fPIE -pie
-fstack-protector-strong -D_FORTIFY_SOURCE=2
-Wl,-z,relro,-z,now,-z,noexecstack`. This is a proposal, not a build result.
Root must verify actual interpreter/dependencies against the existing closure
and record any additional build/runtime requirements before proceeding. No build
or arbitrary-command launcher is included here.

`encodeProofDecoderControlProbeInput({mode, nonce})` returns exactly 48 bytes:
ASCII `ATR2P001`, a one-byte mode ID 1–9, seven zero reserved bytes, and a 32-byte
nonce encoded from exactly 64 lowercase hex characters. Root generates the fresh
nonce and sends this frame followed by EOF. No filename, syscall number, command,
loop count, resource size, caller deadline, credential or environment value is
accepted. Input must reach clean EOF within a cooperative one-second poll/read
budget. Extra, missing or malformed bytes refuse without running a mode.

`createProofDecoderControlProbeOutputReader({expectedMode, expectedNonce})`
provides `feed(Buffer)`, `end()`, `snapshot()`, `status()` and `close()`. There is
no callback or execution interface. It accepts at most two newline-delimited JSON
records, each at most 4096 bytes, totaling at most 8192. BEGIN and FINAL use a
distinct `atlas-proof-decoder-control-probe-v1` schema, `UNVERIFIED` and
`PROBE_ONLY`, and all execution/publication/qualification booleans are false.
Records bind mode/nonce, the claimed PID and BOOTTIME start; FINAL preserves those
fields and adds finish time, COMPLETE/STOPPED, a finite reason and bounded
ordered observations. Values are public numeric syscall results/counters; no
file contents, paths from input, environment values or secrets are emitted.
Every error is a numeric errno, never an unbounded diagnostic string.

The C program writes at most one BEGIN and one FINAL using nonblocking stdout
with bounded partial-write/poll handling. It never writes a worker PDW1 record.
COMPLETE means the finite native program reached its final step; it is not PASS
and does not establish why a syscall failed. Errnos such as EPERM, EACCES, ENOSYS,
EAFNOSUPPORT and EROFS must be distinguished. Root must independently observe the
actual controls and decide what each result establishes. STOPPED reports limited
coverage and a finite failure reason. Unexpected successful security operations
stop further probing; any newly created descriptor is closed first.

Missing FINAL is **incomplete**, including an expected-looking OOM or guard kill.
`end()` refuses incomplete output; `snapshot()` retains the inert BEGIN claim for
external correlation. A native memory/deadline probe can never report COMPLETE.
Partial, duplicated, trailing, changed identity or malformed output fails closed
and cannot be resumed. No parser output becomes an Engine, guard or kernel receipt.

| Mode (ID) | Fixed actions and bounds | Required external observation |
| --- | --- | --- |
| NETWORK (1) | Nine socket-creation attempts: IPv4/IPv6 stream and raw, Unix, packet, algorithm, vsock and netlink. No connect, bind, listen, address or packet transmission. Any unexpected socket is immediately closed. | Exact filter/profile and network namespace/interface/port state. Unsupported protocol errors alone are not policy denial. |
| PRIVILEGE (2) | uid/gid and NNP/seccomp claims, then root UID/GID, CAP_SYS_ADMIN capset, user/mount unshare, a 4KiB tmpfs mount at fixed private /tmp, TRACEME, one-entry BPF map, userfaultfd, one-entry io_uring and noncreating thread-keyring ID call. No key contents or foreign PID are read. Stop on first unexpected success. | Actual uid/gid, CapEff, NNP/seccomp/AppArmor enforcement, private namespaces, kernel support and exact operation errors. No BPF program, IO request, ptrace attach or key creation is performed. |
| READONLY (3) | Two nonblocking write-open attempts on fixed image Node and worker paths; never write, truncate, rename, link or chmod them. | Root/code mount readonly flags and immutable inventory. DAC/AppArmor may explain denied opens; this alone cannot attribute denial to the read-only mount. |
| TMPFS (4) | Fresh O_EXCL, O_NOFOLLOW 0600 canaries at fixed /tmp and /dev/shm paths; each writes at most9MiB, attempts a 4KiB executable mapping, then unlinks only the exact fresh owned regular inode. No instruction is executed from the mapping. | Actual8MiB mount sizes/flags, charge, ENOSPC and executable-map denial. No stale file deletion; an unexpected inode or existing name stops. |
| PIDS (5) | At most40 pthread attempts, a750ms hold and joined owned threads; no fork or process clone. | pids.max32, current/peak/events deltas, actual thread count and expected EAGAIN. The outer guard covers any blocked create/join. |
| FD (6) | Read RLIMIT_NOFILE; at most80 opens of fixed /dev/null, then close owned descriptors. | Actual soft/hard64 and fd inventory, EMFILE and no descriptor leakage. Initial fd count matters. |
| MEMORY_OOM (7) | At most80 anonymous8MiB regions, touched every4KiB, total640MiB. Any surviving mapped regions are released if execution returns. No FINAL after death is promoted to success. | memory.max512MiB, swap.max0, memory.events oom/oom_kill deltas, actual terminal/WAIT/OOM and whole-parent cleanup/held poison. Allocation failure alone is not a native OOM-kill proof. |
| CPU_QUOTA (8) | Four busy pthreads for2s, then stop/join and report process CPU nanoseconds. | cpu.max150000/100000 and cpu.stat throttling deltas under sufficient actual CPU availability. No source assumption that the host can exceed the quota. |
| CPU_DEADLINE (9) | Four busy pthreads until a20s cooperative bound, deliberately exceeding the separate15s guard deadline. Reaching the local bound is LIMIT_NOT_REACHED. | Original absolute BOOTTIME deadline, independent guard kill/freeze, peer lifetime, cgroup emptiness and irreversible epoch hold. It does not ignore TERM or claim native blocked-call coverage. |

All ordinary modes have a five-second cooperative clock/iteration budget; input
and output each have a one-second budget. These bounds cannot interrupt a blocked
kernel call, page fault, pthread creation or join. The independent kernel guard
and bounded parent resources remain mandatory. Every attempted resource and path
is fixed in source. Work must stop after the current finite mode. There is no
retry, dynamic mode switching, automatic thaw or new-epoch recovery.

Root must bind collected output to the exact owned container, immutable nonce,
image/profile/source pins, actual boot/epoch/parent identity and effect-operation
history. PID in the JSON is only a claim, never kill authority. The root harness
must preserve start/WAIT/kill/remove ambiguity and normal cleanup requirements;
an Engine 404 or temporary empty parent cannot release uncertain holds. OOM,
deadline and unexpected outcomes poison the epoch until explicit reviewed operator
reconciliation. No automatic cleanup that frees unknown holds is implemented.
The production executor is expected to refuse this distinct output. Do not feed
it a forged worker response or treat a production-executor refusal as successful
probe cleanup. Any separate effect harness must keep real ownership/guard and
receipt provenance; manual probe effects do not silently qualify that integration.

The existing direct-worker bootstrap and an incidental monitor are not an
independent pre-input controls barrier. Such a barrier must actually join all
required kernel controls before original input for worker qualification. This
probe source does not implement it. Actual AppArmor compilation/load can be
referenced at its exact recorded hash, but it does not establish worker execution,
seccomp enforcement or any hostile mode outcome.

The nine modes cover only portions of the 22-case design. No case is marked PASS:

| Qualification case | Still uncovered by this source |
| --- | --- |
| VALID_PNG / VALID_JPEG | All exact production worker functionality, raster parity, native dynamic closure, original-byte binding and cleanup. |
| INPUT_AND_PIXEL_BOUNDS / CORRUPT_TRUNCATED_APPENDED | All image corpus boundary/corruption and failure-taxonomy behavior. |
| FORGED_DUPLICATE_OR_TRAILING_OUTPUT | Malicious PDW1 worker behavior, early stdout and floods; this is a distinct bounded protocol. |
| EXTERNAL_NETWORK_DENIED | Endpoint operations/connect behavior and actual kernel observations; only socket creation is attempted here. |
| HOST_SECRET_PROOF_DOCKER_ACCESS_DENIED | Dedicated nonsecret canaries, Docker/guard/broker-path probes and actual mount reachability; no host paths or credentials are accessed here. |
| ROOT_AND_CODE_READONLY | Rename/link/chmod and complete root mount evidence; this source only tests two write-open paths and tmp executable mapping. |
| PRIVILEGE_AND_NAMESPACE_DENIED | Other namespace flags, setns, process fork/clone, foreign ptrace targets and all independent effective-control observations. |
| CROSS_JOB_ACCESS_DENIED | Sequential-job residue, stale identity/token/output refusal and cross-namespace reach. |
| NATIVE_MEMORY_OOM | Actual events, terminal state, descendant cleanup and permanent hold must be joined externally. |
| CPU_AND_WALL_DEADLINE | Blocked native calls, delayed upload/headers and original broker deadline handling remain external. |
| PID_THREAD_FD_LIMITS | Independent kernel limits/events and actual worker's legitimate thread needs remain external. |
| TMPFS_SHM_LIMITS | mmap-touch/SIGBUS boundary, shared residue and actual mount/cgroup facts remain external. |
| CANCEL_IGNORED_TERM_AND_DESCENDANTS | Ignored TERM, cancellation, fork denial and separately owned descendant control remain unimplemented. |
| APP_DISCONNECT_AND_DEATH / SUPERVISOR_DEATH_WATCHDOG | Real broker/app/guard death or stall and systemd behavior remain external. |
| RESTART_RECONCILIATION / UNKNOWN_CLEANUP_QUARANTINE | No restart, recovery, lost-effect or cleanup-authority mechanism is implemented here. |
| EPOCH_PROFILE_TAMPER_REFUSED / CONCURRENCY_AND_NO_QUEUE / IPC_PEER_AND_DIRECTORY_INTEGRITY | Actual branded joins, tamper/fault/concurrency/peer-path tests remain external. |

Local tests exercise only the pure finite challenge/claim protocol, fragmentation,
bounds, nonce/identity and no-authority checks. They never compile or execute this
C source. Root's reviewed target compile and actual controlled runs are separate
required evidence before any result can count toward the qualification matrix.
