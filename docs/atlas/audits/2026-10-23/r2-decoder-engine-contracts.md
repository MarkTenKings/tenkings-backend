# R2 decoder Engine contracts and outcome review

This checkpoint adds inert source for the next decoder implementation stage.
It does not complete R2, qualify a real target, replace the current physical
validator or authorize a production release. Master ID27 remains open.

## Implemented

- A fixed-operation Engine API 1.47 reference compiler, with separately supplied
  hash-verified seccomp bytes. No filesystem discovery, arbitrary endpoint,
  executable, environment, mount or caller request body is accepted. JSON
  compaction preserves numeric/string lexemes in the supplied artifact.
- Bounded duplicate-aware Engine JSON/status projection. Benign extra fields are
  discarded; raw inspect bodies, Config.Env and diagnostic messages are never
  included in review results. 404 is an unverified report, not proven absence.
- Strict non-TTY 101 upgrade and multiplex parsing, bounded per stream and record
  count, including fragmented headers and a first-byte stdout timing flag.
- A pure transcript reducer covering image/create/inspect/attach/start,
  original-byte input, separate input/output EOF, wait, uncertainty and refusal.
  Observed start precedes wait, terminal state forbids more input/restarts, and
  container identities and exit reports must agree. Early partial stdout cannot
  evade ordering checks by completing after input EOF. Unknown effects and
  cleanup retain a hold.
- An unwired outcome/publication review model preserving legacy counters,
  original keys, existing manifests and historical reads. Operational failures
  are separate from hypothetical image-invalid accounting; replay is idempotent,
  unknown effects are absorbing, and uncertain publication reconciles the same
  original only. A caller-supplied fence or cleanup claim confers no authority.

All emitted review envelopes remain UNQUALIFIED and executionAllowed:false.
No socket opener, Docker dependency, native helper, child worker, filesystem/DB
writer, accepted validator brand, runtime discovery or live capability was added.
All 195 prior executable/UI/test/SQL/package hashes from 2d9394a4 are preserved.
Existing physical-runtime/intake and proof storage/keys are unchanged.

## Verification and independent review

Evidence is retained in
`/Users/markthomas/.codex/atlas-handoffs/atlas-r2-engine-contracts-20261023`.
Exactly two Astra xHigh specialists were used, with no additional/nested agents.
The lead reviewed the new source; specialists independently reviewed the outcome
model and transcript sequencing. Findings about identity mixing, input after
terminal exit, conflicting exit states, caller coercion and fragmented early
stdout were corrected and covered by focused regressions.

| Evidence | Actual scope and result |
| --- | --- |
| target-lane/receipt.json + run-02.tap | 13/13 request/response tests at that earlier source; retained unchanged request/JSON evidence |
| target-lane/receipt-03.json + run-03.tap | Final changed response/multiplex tests 9/9; first-byte timing regression included |
| transcript-lane/run-03-receipt.json + run-03.tap | Final transcript tests 13/13; dependency hashes stable through run; all195 prior pins unchanged |
| proof-lane/qualification-01.json | Outcome/publication model 12/12; unchanged source hashes independently rechecked, no duplicate replay |

All runs used pinned Node22.16.0 and report zero failures/cancellations/skips.
Results overlap where a changed test file was rerun; counts are not an aggregate
acceptance claim. Tests used synthetic in-memory bytes/reports. No actual image
decode, container, daemon, worker, socket, database, provider or financial action
was performed by this slice. Prior32/32 local worker/SQLite/socket qualification
and retained financial/Stripe/SCA/PG/browser evidence were not replayed.

The incoming transfer correctly recorded review in progress. The fresh lead later
received R1's independent baseline composition98f16b4c85e34ce11691b64418c936df677330c0,
treefae71e9e14e0939f07910189cedf6c96ad7fc159, with receipt
`atlas-r1-successor-master-20261023/r2-compose-01.json`. That accepts the previous
19-path source composition only; it does not accept this new delta or establish
target/runtime qualification. The new delta requires its own milestone handoff.

## Remaining implementation and launch gates

1. Select and evidence an actual Linux target: host/boot, architecture/libc/kernel,
   Engine/API/containerd/runc/daemon, user mapping/cgroup driver and delegated
   owned non-threaded parent, service identities, protected socket and paths.
   Reference API1.47 and fixture values are not target selection.
2. Build and pin the worker image/native dependency closure and actual enforced
   MAC/seccomp/resources/filesystem. Implement the target transport, observed
   half-close, peer/boot-clock verification, independently surviving watchdog,
   sole registry writer and exact descendant cleanup/restart recovery. Interrupted
   SQLite-write recovery remains unsupported. Test the existing22 containment
   cases plus transport, daemon/watchdog, lease and crash boundaries on that target.
3. Implement authoritative live admission/revocation and durable lease-bound
   accounting, then join the qualified capability to intake/factory/upload/recover.
   Preserve original v1 bindings and historical reads; cover legacy VALIDATED
   publication, storage uncertainty and revocation after storage but before retain.
   Cached snapshots and callbacks returning true cannot supply this authority.
4. Qualify genuine marketplace carrier/account/service/coverage, actual packed
   measurements, tax records, custody/title/consignment, staff reviewers and
   private retention/key/backup recovery. Complete the authorized joined physical
   pilot. Recorded fees/returns/origin/shipping-package guidance remains settled;
   planning estimates do not become measured weight or insurance evidence.
5. R1 coordinates shared host/gateway/role/TLS/webhook/recovery/alert configuration,
   production credential work, release/rollback and activation. Current shared
   host/provider/credential exclusion remains in force. This checkpoint proposes
   no shared runtime or production effects and performs no consumed-action replay.

The owner explicitly resumed R2 after freeing disk space themselves. No cleanup
deletion occurred here. R2 reports directly to the owner; contact R1 only at
integration-ready milestones, cross-lane blockers or before shared changes.
Ownership claims/history and pricing guidance remain OFF. Fingerprint plus
genuine ownership authority remains required; decoder or report facts cannot
substitute. Grading and Ten Kings remain preserved.
