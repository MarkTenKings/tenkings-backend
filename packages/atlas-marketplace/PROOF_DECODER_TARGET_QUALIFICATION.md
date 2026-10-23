# Target worker security artifacts and qualification design

The renderer's returned artifacts are **PROPOSED_UNAPPLIED_UNQUALIFIED**. They
grant no execution or publication authority and are not loaded by this module. A source
check, successful AppArmor parse, loaded profile, functional decode, hostile
control probe and completed qualification are distinct evidence.

Actual isolated-target evidence is retained separately in
`/Users/markthomas/.codex/atlas-handoffs/atlas-r2-target-proposal-20261023`.
`ops/security-profile-apply-01` records exact AppArmor compilation and enforcing
load. Initial worker/IPC diagnostics and a damaged-PNG diagnostic retain their
limited scope. `ops/input-barrier-02` records the actual mandatory native
pre-input barrier and successful4000×4000RGBA PNG decode with genuine finalized
cleanup. A separate pidfd-owned stopped observation after input hashed all11
mapped native files, including sharp/libvips, against the inventory; tasks and
mappings were stable. The failed preceding guard/addon mismatch remains retained.
The genuine prepared-client broker runs subsequently completed small and alpha
PNGs (`ops/functional-corpus-01`) and the 16-million-pixel PNG plus baseline,
progressive and orientation-bearing JPEGs (`ops/functional-corpus-02`). Each of
these six successful submissions has original-bound completion and finalized
cleanup. Both batches nevertheless failed: the first retained an unknown REMOVE
outcome, and the second stopped before worker creation during a 10 MiB upload
when a guard pulse was 322,425,232 ns old against its 250 ms limit. The first
exited container was separately removed through a reviewed exact-owner operation;
its original failed ledger was not repaired or finalized. All failed evidence is
retained. Runtime05's six genuine native cache checks passed in
`ops/functional-corpus-03`, including changed bytes, identities, revisions and
invalid extra rows. The 10 MiB upload then reached known CREATE/START, but the
subsequent worker-input transfer failed with a 250,638,952 ns stale guard pulse.
That RUNNING revision4 job remains held; its exited container was removed by a
separate exact-owner operation without changing the original ledger. Runtime06's
explicit poll boundaries let the next 10 MiB original reach worker SUCCESS, but
`ops/functional-corpus-04` failed during cleanup with a 267,486,195 ns stale pulse.
This new job remains held at CLEANUP revision5 with no persisted exit/REMOVE or
finalized cleanup. The stopped guard and empty/frozen parent contain it; its
exited container remains pending separate reconciliation. The cleanup handoff
now has explicit poll boundaries followed by the same lease/ownership/original
and cleanup deadline checks, plus bounded phase timing diagnostics. This repair's
target verification is pending. Successful observations retain their
original source/profile scope; they do not qualify the changed runtime wholesale.
The remaining broker corpus/fault variants and hostile probes below remain open.
These partial observations do not constitute qualification or publication
permission. The separately pinned probe image is cached but has not executed.

The candidate binds the imported linux/amd64 image
`127.0.0.1:5001/atlas-r2-proof@sha256:2b497d3724e65ca2ae449072dada74b3197247649eaa2a8349b7d02d79609ac6`,
Node 22.16.0, sharp 0.33.5 and libvips 8.15.3. It uses the held
`atlasdecoder.slice` parent and uid/gid 65532. The resource proposal is 512 MiB
memory, zero swap, CPU 150000/100000, 32 tasks, 64 file descriptors, 8 MiB each
for tmpfs and shm, 10 MiB input, 16 million pixels, one active job and a 15-second
absolute BOOTTIME deadline covering transfer, execution and settled cleanup.
The parent has separate observed limits; those do not replace child checks.
The exact existing Node/worker command and five fixed runtime environment
entries remain unchanged. Image ENV must remain empty; no raw Config.Env or host
environment contents belong in a receipt.

`renderProofDecoderSecurityArtifacts({inventoryBytes, abiBytes})` is an inert
renderer. Both arguments are Buffers of exact public metadata, checked against
fixed length and SHA256 before parsing. It reads only its three fixed local
source assets through bounded regular-file opens, checks their committed pins,
and returns owned `seccompBytes`, `apparmorBytes`, `abiBytes`, `limitsBytes`, an
immutable limits object and an immutable candidate receipt. It opens no socket,
loads no policy and creates no runtime capability. Returned Buffers are public
caller-owned copies; root must rehash the exact bytes immediately before staging,
compilation and use. The renderer accepts no arbitrary paths, callback, labels,
command or permissive mode. It has no execution CLI.

The approved inventory is 32877 bytes, SHA256
`01a90b96ce11e1914cc8c2888160b10c4f59734aba48320cdf5c481a3067d74f`.
Its 145 regular files and empty symlink list produce exact read rules, needed
ancestor directory reads, twelve executable-map paths and one executable path:
Node. No wildcard execute or map rule is generated. Inventory metadata is a
reviewed input, not a new observation of the target root filesystem. Native
static provenance does not prove the complete runtime dlopen closure. Root must
observe/hash loaded native mappings against the inventory during functional runs.

The seccomp JSON is canonical and x86_64-only, default EPERM. Its bounded candidate
allowlist uses the exact glibc 2.39 pthread clone mask `0x3d0f00`; clone3 returns
ENOSYS so glibc can fall back to the filtered clone call. ioctl and prctl have
explicit numeric comparisons. New sockets, process/namespace creation, mount,
ptrace, capability/UID mutation, BPF, keyring, io_uring and userfaultfd are omitted.
The runtime-spec and glibc sources explain these interfaces; they do not prove
this candidate functional on the target. Existing-descriptor I/O remains allowed,
so root must independently check inherited descriptor closure. Anonymous executable
memory remains available to ordinary V8; no W^X or JIT-less guarantee is claimed.

The AppArmor template uses enforce semantics with `mediate_deleted`, no host
abstractions and no `attach_disconnected`. Its only include is the exact ABI 4.0
file: 2205 bytes, SHA256
`e510bb8f6788b45e48de2f859a6f94a7b8416cbac5a1051814cfce925fa911bd`.
Root observed parser 4.0.1 and unconfined labels for the operator, PID1/systemd
and dockerd in `ops/security-profile-facts-01`; actual broker and worker labels
still require observation. The candidate permits signal reception and read-only
process observation from that host label, and same-profile thread signals. It
permits only selected proc/sys reads and temporary writes; capability, mount and
network permissions are denied. AppArmor parsing and all inherited-stdio behavior
remain target gates. A denial must remain a recorded failure until a bounded
policy revision is reviewed; no automatic fallback to an unconfined/default profile.

The profile name is `atlas_r2_decoder_` plus SHA256 of the expanded policy with
`@@NAME@@` still present. This binds the exact generated rules through the existing
`mac.name` field without a self-hashing cycle. The receipt separately pins source
template, expanded template, rendered policy, ABI and seccomp bytes. It expects
parser 4.0.1 but does not attest the parser executable. Root must pin its actual
binary/package, compiler options, kernel feature selection, private staged ABI
include and compiled blob, then observe the loaded named profile in enforcing
mode. Do not compile against an unchecked mutable host include. These checks do
not defend against a hostile root or turn Docker reports into kernel evidence.

Before original input, root's actual harness must join the exact owned container,
profile/image/epoch, guard lease and cgroup membership, and independently observe
uid/gid, capabilities, NNP/seccomp, AppArmor label, namespaces, mounts, effective
cgroup limits, resource counters and descriptor inventory. These public kernel
facts are separate from Engine configuration claims. Normal cleanup still needs
known WAIT, closed admission barrier, whole parent empty, exact non-force REMOVE,
post-removal absence and a fresh empty observation. Unknown effects retain their
durable intent and poison the entire epoch. No automatic thaw, retry, forced
removal that frees holds, stale-lock unlock or new-directory recovery is allowed.

Local pure checks use the pinned Node runtime and two explicitly supplied public
metadata files:

```text
node packages/atlas-marketplace/test/proof-decoder-security-artifacts.test.mjs INVENTORY_JSON ABI_4_0
```

Without those arguments only the five source/refusal checks run. With both,
two positive deterministic rendering and tamper checks also run. These checks
make no container, daemon, policy or qualification claim. The source artifacts
are canonical candidates; only root performs target compilation, load or runs.

The qualification harness must record four separate kinds:
`PROPOSED_ARTIFACT`, `KERNEL_APPLIED_OBSERVATION`, `FUNCTIONAL_WORKER_RUN`, and
`INDEPENDENT_HOSTILE_CONTROL_PROBE`. Each has exact boot/epoch, profile and source
pins, original/corpus hash where relevant, monotonic timestamps, operation IDs
and bounded nonsecret observations. Functional runs use the immutable worker
through the genuine broker and its private in-process Engine/kernel receipts.
The first direct-executor bootstrap is diagnostic evidence, not broker acceptance.

Hostile behavior requires a separately pinned **PROBE_ONLY** image/program,
root-only bounded harness and explicit changed-file/image provenance. A native
probe may occupy the same executable path in that distinct image with the same
security controls, but emits a different bounded report and never worker
validation. The production command must not be widened to fit probes. Root must
approve probe implementation and effects separately. Use disposable nonsecret
canaries and owned local listeners; never read actual secrets or contact external
services. ENOENT proves absence, not a policy denial. Unmounted host canaries and
kernel mount evidence complement explicit EACCES/EPERM probes. No added probe
mount may be reported as a production worker mount observation.

Every subvariant below must pass under the bound artifacts for its case to PASS.
Pure tests and old helper primitives do not fill gaps. Each fault epoch ends in
preserved evidence and explicit root/operator reconciliation before any new run.
The current stale-lock refusal demonstrates a held uncertainty; it does not
justify `restartReconcilesOwned: true`. Any missing required reconciliation path
keeps that case incomplete. Even an all-PASS document remains UNVERIFIED under
`assessProofDecoderTargetEvidence`; it is not an execution or publication grant.
Physical intake, grading/Ten Kings, ownership claims/history and pricing remain
outside this lane and disabled pending Fingerprint PLUS genuine ownership authority.

| Case ID | Evidence lane and required variants | Status |
| --- | --- | --- |
| `VALID_PNG` | FUNCTIONAL_WORKER_RUN: Valid small, alpha and boundary-size PNG corpus; exact source hash/dimensions, expected decoder versions, EOF/WAIT and genuine settled cleanup. Also observe effective kernel profile/resources before input. | INCOMPLETE: small/alpha/16M genuine broker submissions completed under their original pins; byte-boundary and final-runtime qualification pending |
| `VALID_JPEG` | FUNCTIONAL_WORKER_RUN: Baseline/progressive/orientation-bearing bounded JPEG corpus; full raster parity, exact original and cleanup. Native dynamic library maps are independently hashed against actual inventory. | INCOMPLETE: three genuine broker submissions completed in corpus02; full variant/evidence binding to final runtime pending |
| `INPUT_AND_PIXEL_BOUNDS` | FUNCTIONAL_WORKER_RUN: 10 MiB exact and +1 byte, 16,000,000 exact and +1 pixel, mismatched declared count/hash, MIME and bounded dimensions. Availability failure must not become INVALID_IMAGE. | INCOMPLETE: 16M accepted; latest 10 MiB decoded successfully but cleanup failed; remaining bounds not yet completed |
| `CORRUPT_TRUNCATED_APPENDED` | FUNCTIONAL_WORKER_RUN: Corrupt compressed pixels, chunk/segment lengths, CRC, missing EOI/IEND, appended image and bytes, APNG/multi-page. Exact failure taxonomy and cleanup. | INCOMPLETE: prior invalid-CRC diagnostic retained; remaining prepared-client corpus not yet completed |
| `FORGED_DUPLICATE_OR_TRAILING_OUTPUT` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Distinct malicious-output probe emits wrong request/hash, early one-byte stdout prefix, duplicate/trailing/oversize/partial PDW1 and stderr flood. Actual broker refusal/hold; never claim this is normal worker output. | NOT_RUN |
| `EXTERNAL_NETWORK_DENIED` | INDEPENDENT_HOSTILE_CONTROL_PROBE: AF_INET/INET6, raw, AF_PACKET, AF_ALG, VSOCK and AF_UNIX socket attempts; seccomp/AA denial and net namespace lo-only/no ports. No external packets need be transmitted. | NOT_RUN |
| `HOST_SECRET_PROOF_DOCKER_ACCESS_DENIED` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Dedicated nonsecret absent/unmounted canaries and exact Docker/guard/broker path open attempts; kernel mount/namespace evidence. No real secrets enumerated/read; distinguish ENOENT absence from policy EACCES/EPERM. | NOT_RUN |
| `ROOT_AND_CODE_READONLY` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Attempt code/root write, rename, link, chmod, executable mapping of writable tmpfs; compare actual production mount flags and inventory. Probe image differences recorded. | NOT_RUN |
| `PRIVILEGE_AND_NAMESPACE_DENIED` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Native setuid/capset, namespace clone/unshare/setns, mount, ptrace, bpf, keyring and io_uring syscalls deny; actual uid/gid, CapEff zero, NNP and seccomp mode plus AppArmor enforcing. | NOT_RUN |
| `CROSS_JOB_ACCESS_DENIED` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Two sequential jobs: previous tmpfs marker absent, stale identities/tokens/output rejected, no PID/IPC/proc-root reach outside private namespaces. MaxConcurrent1 means no simultaneous production workers are created for this probe. | NOT_RUN |
| `NATIVE_MEMORY_OOM` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Bounded native touched allocation beyond 512 MiB; independently observe exact child cgroup memory.max/swap.max, memory.events oom/oom_kill, terminal status, held poison and no parent leak. Do not fabricate native OOM using a JS error. | NOT_RUN |
| `CPU_AND_WALL_DEADLINE` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Native busy loop and blocked native call, partial-upload delay, transport header stall and wall deadline; child cpu.max 150000/100000 + cpu.stat throttling, original BOOTTIME deadline, independent guard kill. Do not extend deadline for setup/cleanup. | NOT_RUN |
| `PID_THREAD_FD_LIMITS` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Native pthread growth and pids.events with pids.max32; process fork denied separately. FD opening to RLIMIT_NOFILE64 and EMFILE. Positive ordinary worker thread needs must still pass. | NOT_RUN |
| `TMPFS_SHM_LIMITS` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Bounded touch/write past each 8 MiB tmpfs/shm limit and map/exec attempts; actual mount size/flags and ENOSPC or bounded fault, memory charge, no shared residue. | NOT_RUN |
| `CANCEL_IGNORED_TERM_AND_DESCENDANTS` | INDEPENDENT_HOSTILE_CONTROL_PROBE: Running loop ignores TERM, application cancels; kernel guard freezes/kills and observes all threads/descendants empty. Fork denial under production profile is tested separately. An independently root-created owned descendant containment test is separate control evidence, not permission added to worker seccomp. | NOT_RUN |
| `APP_DISCONNECT_AND_DEATH` | FUNCTIONAL_WORKER_RUN + CONTROL_FAULT: Close/half-close or kill authenticated app peer before/after reservation, during upload and run; actual peer pidfd lifetime, immutable hold and native whole-parent quarantine. | NOT_RUN |
| `SUPERVISOR_DEATH_WATCHDOG` | CONTROL_FAULT: SIGKILL/SIGSTOP broker, then independent guard death/stall including systemd watchdog; observed parent freeze/kill and latch. Root's prior guard tests may be referenced only for exact unchanged artifacts and covered scenarios. | NOT_RUN |
| `RESTART_RECONCILIATION` | CONTROL_FAULT: Restart with known finalized row, pending CREATE/START, stale writer lock, sidecar and late effect. Exact ownership inventory retained, no receipt JSON rebranding/new registry bypass. Current conservative stale-lock refusal is a hold result, not proof of automated reconciliation. | NOT_RUN |
| `UNKNOWN_CLEANUP_QUARANTINE` | CONTROL_FAULT: Lost create/start/remove response, absent report without known remove, freeze with delayed daemon effect; pending operation ID/hash survives, epoch permanently poisoned, no free slot from 404/temporary empty. Fault injector stays outside fixed production command. | NOT_RUN |
| `EPOCH_PROFILE_TAMPER_REFUSED` | CONTROL_FAULT: Changed image/seccomp/template/compiler artifact, parent identity, boot/epoch, deadline, job or output identity; refuse before effects when possible, otherwise poison and hold. Hash only named nonsecret artifacts. | NOT_RUN |
| `CONCURRENCY_AND_NO_QUEUE` | FUNCTIONAL_WORKER_RUN + CONTROL_FAULT: Simultaneous client requests at capacity1; exactly one reservation/worker, second busy before accepted input, no queue, replay refused, finalized release only after known cleanup/guard settle. | NOT_RUN |
| `IPC_PEER_AND_DIRECTORY_INTEGRITY` | CONTROL_FAULT: Wrong UID/GID, peer exit/PID reuse, replaced/symlink/insecure directories and sockets, stale guard frames, target Engine fixed inode replacement; actual native pidfd and protected-path refusal. No fake observer/controller brands. | NOT_RUN |

The controls were designed against primary interface documentation:
[Docker seccomp](https://docs.docker.com/engine/security/seccomp/),
[Docker AppArmor](https://docs.docker.com/engine/security/apparmor/),
[OCI runtime specification v1.2.1](https://raw.githubusercontent.com/opencontainers/runtime-spec/v1.2.1/config-linux.md),
[glibc 2.39 pthread flags](https://raw.githubusercontent.com/bminor/glibc/glibc-2.39/nptl/pthread_create.c),
[glibc clone fallback](https://raw.githubusercontent.com/bminor/glibc/glibc-2.39/sysdeps/unix/sysv/linux/clone-internal.c),
[runc 1.5.2 initialization](https://raw.githubusercontent.com/opencontainers/runc/v1.5.2/libcontainer/standard_init_linux.go), and
[AppArmor policy syntax](https://raw.githubusercontent.com/apparmor/apparmor/master/parser/apparmor.d.pod).
The actual target receipts, not these references, must establish applied behavior.
