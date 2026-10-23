# One-worker target Engine broker

This source slice is UNQUALIFIED and default off. Explicit enablement with genuine
target controller, registry and guard objects can perform Engine effects. It does
not grant production admission, proof-validation or publication authority. No
fixture executor, cleanup receipt or JSON guard message can supply those objects.

The privileged broker owns both concrete Engine effects and the target ledger.
The separate kernel guard supervises the broker's peer and BOOTTIME deadline.
Engine receipts stay in the broker process; guard IPC carries no Engine receipt.

The new modules are:

- proof-decoder-engine-target-endpoint.mjs: fixed protected Docker socket and
  concrete root peer lifetime, with no caller connector or observer callback.
- proof-decoder-engine-target-binding.mjs: a sealed encoding-only choice for
  exactly atlasdecoder.slice, bound to the launch profile. It has no kernel or
  execution authority and accepts no parent override.
- proof-decoder-engine-owned-cleanup.mjs: owns the actual decode effect session,
  private effect/exit/cleanup receipt brands, and a separate bounded cleanup
  channel. No public function mints a receipt from supplied observations.
- proof-decoder-engine-target-executor.mjs: one active job, no queue/replay,
  same-process durable intents and an independently guarded lease.

createProofDecoderTargetEngineExecutor({enabled,plan,targetRegistry,
parentController,targetBinding,guardClient,linuxObserver,socketPath,apiVersion,
headerTimeoutMs?}) requires concrete target ledger/controller/client and Linux
observer brands. Target mode accepts only /run/docker.sock and API 1.47. One
protected root-owned socket inode and its protected ancestors are retained per
observer for both decode and cleanup; replacement refuses every later boundary.
Each connection is withheld from HTTP until the actual root UID/GID peer is
captured with the native atomic peer-pidfd primitive. Its lifetime is checked
before input writes and while reading replies. Connects have a 500 ms bound and
are cancelled with their owning request/session. The observed peer may be PID 1
for systemd socket activation; this is not dockerd identity or qualification.
The unjoined transport may still use a synthetic Unix path. Each registry can
have only one executor instance. Root owns all concrete ports and their lifetime.

run({jobId,originalBytes,seccompBytes,signal?}) accepts an exact RESERVED row.
Original and seccomp buffers are copied and hashed before the first asynchronous
guard-adoption boundary. The broker adopts the row's exact initial identity and
absolute BOOTTIME deadline before CREATE. CREATE and START intent, operation ID
and the hash of the whole compiled HTTP request are committed before sending.
Actual socket responses mint private receipts consumed directly by the ledger.

The CREATE compiler changes only HostConfig.CgroupParent when given the sealed
encoding. The transcript hashes those actual changed bytes. Actual inspect must
report the exact parent before attachment/start. Before sending any original,
the native controller checks the reported PID's actual membership in the retained
parent and exact docker-<full-id>.scope; the PID is only a read selector. Every
effect and input-write boundary checks the genuine live guard lease and native
BOOTTIME. The existing bounded buffers, half-close, multiplexing and output rules
remain in force. The unjoined executor's interface and all fixture brands remain
unchanged.

Normal cleanup requires all of the following, with admission closed:

- A completed actual same-process decode session, known WAIT, and durable settled
  CREATE/START with no pending effect.
- Exact owned terminal inspect. WAIT/exit/OOM evidence is recorded durably before
  any removal. OOM or contradictory state refuses normal cleanup.
- A genuine whole-parent empty observation, durable REMOVE intent, exact full-ID
  non-force REMOVE204, then a reported absence and fresh genuine empty token.
  A standalone 404, socket close or temporarily empty parent never suffices.
- Private Engine cleanup receipt plus the fresh native token accepted by the
  sole-writer ledger, then a successful guard settlement.

The cleanup HTTP channel accepts only internally compiled INSPECT and REMOVE;
there is no arbitrary selector or public operation callback. It uses one socket,
8 KiB/32-field headers, one 256 KiB body accumulator, at most the fixed three normal
requests, a 500 ms header deadline and at most one second within the original
deadline. Raw response bodies are zeroed, not persisted. Config.Env is never
returned or logged. Engine KILL is unnecessary for this conservative slice:
stopKnownJob poisons the epoch and invokes actual whole-parent native freeze
and kill. It does not append a competing intent over unknown CREATE/START.

Unknown effect, timeout, disconnect, store failure, parent/lease mismatch or
uncertain cleanup poisons the whole epoch. Pending intents remain intact. The
parent is frozen/killed with no automatic thaw, retry, force removal or capacity
release. A late operation must remain contained by the same permanently held
parent; actual target qualification must demonstrate that behavior. Losing the
guard settlement after ledger finalization still poisons the epoch and prevents
new work; the result does not claim successful cleanup.

All Engine fields remain daemon reports. Kernel emptiness, peer liveness and
membership are separate observations. Protected daemon identity, effective full
configuration, late-effect freeze inheritance, native closure, decoder behavior,
guard/systemd failure behavior and the full qualification matrix remain target
gates. Neither this source nor a synthetic test closes them.

Local evidence covers pure fixed-parent grammar, transcript accounting and
pre-start mismatch refusal, forged runtime/receipt rejection, and the affected
unjoined transport smoke path. No positive target factory is tested with a
substitute kernel, guard or ledger brand. Root alone runs genuine target tests.

