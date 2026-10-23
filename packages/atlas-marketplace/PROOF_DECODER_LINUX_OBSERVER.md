# Linux peer and clock observations

This new primitive is **UNQUALIFIED and unwired**. It does not enable admission,
authenticate a service epoch, prove its executable, qualify a decoder or supervise
a cgroup. It supplies actual Linux observations needed by that later integration.

`native/proof-decoder-linux-peer.c` is a Node-API8 addon, compiled against the
official checksum-verified Node22.16.0 Linux x64 headers. It requires Linux headers
with `SO_PEERPIDFD`; there is no fallback from a PID number to `pidfd_open`. Capture
accepts only a connected AF_UNIX stream descriptor, records `SO_PEERCRED`, obtains
the peer's pidfd atomically from that socket, and checks the socket inode did not
change. The addon retains only the pidfd, never a duplicate connection descriptor.
It neither signals nor waits for the peer. A zero-time poll observes process exit;
failure or any ready condition cannot report a live process. A socket descriptor
must still refer to the captured inode. This is not proof that its peer is healthy
or still reading the connection; the transport must handle EOF, errors and bounds.

Peer handles use Node-API object type tags and finalizers. Explicit close is
idempotent; process-wide native capacity is128 handles, and each JavaScript
observer permits32. `CLOCK_BOOTTIME` provides a monotonic nanosecond value that
includes Linux suspend time; the clock does not itself schedule or enforce a
deadline. Consumers must compare it at every effect boundary and use independently
surviving watchdog enforcement. No environment, process command line or credential
file is read.

`src/proof-decoder-linux-observer.mjs` defaults off. Explicit enablement requires
Linux x64, Node22.16.0, an absolute addon path and its exact SHA256. All artifact
ancestors must be real root-owned directories without group/world write access;
the addon must be a root-owned, nonlinked regular file without setid or unsafe
write bits. Loading uses the verified open inode through `/proc/self/fd`, retaining
one descriptor for the process lifetime to prevent path reuse. Additional factory
calls must bind that same artifact. This policy assumes the root operator and
loaded native code are trusted; an operator-supplied hash is not independent
attestation. Client code supplies the expected UID/GID and optionally PID, and the
wrapper compares them to kernel observations. The wrapper uses the pinned Node
version's internal `socket._handle.fd`; this dependency requires requalification
if Node changes. Object branding only prevents accidental substitute objects.
The harness and observer share `loadProofDecoderLinuxPrimitives`; neither loads
an ordinary path before these checks. Input open is nonblocking so a FIFO refuses
before reading, and the artifact read has a fixed1MiB ceiling. The raw native
methods exposed by this explicit loader are testable primitives, not authority.

`scripts/qualify-decoder-linux-peer.mjs ADDON_PATH ADDON_SHA256` is an explicit
root-only target harness. It creates its own finite Unix socket and root/nobody
child processes in a fresh `/run` directory and removes only those owned fixtures.
It has no Docker access, worker execution, target discovery or production effects.
The2026-10-23 isolated R2 VM run passed5 cases: default-off/forged authority and
wrong artifact hash; invalid native values/non-sockets; clock/close behavior; and
actual root and nobody peer credentials/process-death observation. Compilation
passed `-Wall -Wextra -Werror -Wformat=2`. Receipt:
`atlas-r2-target-proposal-20261023/ops/native-peer-build-01/receipt.json`.
Independent review corrected the harness's initial unpinned native load. The
shared-loader revision passed6 cases, including no native initialization for an
invalid hash, symlink or FIFO, and separately refused an invalid CLI hash before
bootstrap. It reused the unchanged compiled addon; see
`ops/native-peer-test-02/receipt.json` and
`ops/native-peer-independent-review-02.json` in the same packet.
These primitive cases do not substitute for the22 full decoder qualification
cases, directory integrity checks, independent watchdog, cgroup cleanup or durable
proof-intake publication fencing. Docker's socket on this target reports PID1
because systemd created it; that peer PID must not be described as dockerd's PID.

References: [Node22.16 Node-API](https://nodejs.org/download/release/v22.16.0/docs/api/n-api.html),
[Linux Unix sockets](https://man7.org/linux/man-pages/man7/unix.7.html),
[Linux clocks](https://www.man7.org/linux/man-pages/man2/clock_gettime.2.html).
