# Independent connected manual release review

September 12, 2026. Fresh Astra/xhigh independent review of the in-progress
candidate on `codex/atlas-connected-manual-release-20260912`, based on handoff
`aeb8e68dd6ea007d2bc11ccf568f771375a52af2`. The entire approved blueprint and the
mandatory context/runbook/handoff material were read before source review.

**Bounded verdict: reviewed source corrections and final local artifact
qualification pass; production activation is not established.** One additional recoverability defect was reproduced, reported
to the lead, fixed by the lead and independently verified. No further actionable
source defect was found in the reviewed recovery/streaming/migration delta.
The final follow-up below independently matches the saved Linux image/build/test
receipts to the current source. The old sealed image remains the unchanged native
base, not the changed final artifact. The operational prerequisites below remain open.

## Findings and dispositions

1. **P1, corrected: a slow trace could overwrite another uncertain command.**
   `createManualClient.editDefect()` checked its journal before awaiting the
   trace response; `send()` then overwrote the journal unconditionally. A second
   client could record an uncertain command during that await, losing its exact
   recovery identity when the first trace completed. Initial view loading had
   the same admission gap. The independent Node20 reproduction recorded the
   newer command replaced and one additional action dispatch. The lead added a
   final pending check in `send()` after snapshotting the action and before
   writing or dispatching, outside the reconciliation catch. The same independent
   trace reproduction now retains the newer bytes exactly and records zero
   additional dispatches. Lead regression coverage also covers the initial-view
   case; ten focused client checks pass. The original failing receipt is retained.
2. **P2, corrected: release procedure still described raw proposals.**
   At initial review `CONNECTED_MANUAL_RELEASE.md` instructed operators
   to apply the three raw proposal files and described a 95-public/35-staff
   fixture. The current candidate publishes their identical bytes as three
   ordered staff Prisma migrations and the new fixture proves 95-public/38-staff
   with both no-op replays. The lead updated the procedure to the exact ordered
   staff ledger, same-byte checks, no raw replay and second-deploy readback. This
   reviewer checked that final diff, including updated pool/origin/CORS and
   stream/auth release requirements. The original workflow audit now explicitly
   limits its old no-op claim to the old chain. Historical proposal-only evidence
   remains historical.
   Live inventory is independently 96-public/35-staff; preserve its extra public
   research migration instead of making the live ledger match the fixture.

The lead's earlier `ManualCards.jsx` correction was also reviewed. It snapshots
the exact dispatched command, rejects a stale rendered retry and clears only
matching journal bytes. Late success or definite refusal updates the displayed
pending command from the remaining journal. Its four tests compile the actual
current component rather than importing an old generated component.

## Authentication, stream and source review

- The frontend wrapper checks admitted ingress, method, write origin/fetch
  policy, CSRF and ordinary staff authentication before invoking the heartbeat
  proxy. The private side still binds method/path/body/cookie/CSRF/origin and
  one-use nonce, then independently authenticates staff. No browser-supplied
  actor, reviewer certification or paid-work authority was added.
- Slow authenticated POSTs emit whitespace only. The terminal envelope carries
  actual status/body; both browser consumers use the same browser-safe decoder.
  Truncated JSON, missing/wrong envelope protocol and malformed status remain
  uncertain outcomes rather than successful saves or definite refusals.
- The 210-second bound, 2 MiB JSON limit, 4 MiB fallback-image limit, fixed HTTPS
  origin and redirect refusal remain. Independent probes after the first
  heartbeat verified oversized JSON, redirects and array-shaped terminal JSON:
  each produces terminal 502, aborts its upstream transport and removes event
  listeners. Disconnect/timeout does not claim cancellation of an already-started
  private operation.
- The server artifact allowlist expands only for the manual-service package
  metadata and browser-safe response module, plus two exact Next trace symlink
  records: the connected-manual and manual-workflow packages' local
  `node_modules/@atlas/manual-service` links. Independent follow-up checked that
  each exception requires an actual symbolic link whose canonical target equals
  the current checkout's `packages/atlas-manual-service`. It admits no directory
  prefix, backend file or old/external checkout. The first offline Next compile
  passed but its trace check exposed these missing metadata records. The affected
  build subsequently passed with this narrow correction, including the actual
  browser/server artifact boundaries described below. The specialist's loader
  and this review's explicit current-source imports avoid the borrowed workspace
  symlinks; no old generated package was substituted for these probes.
- This delta does not alter source-pair commit checks, native SDR derivation,
  deterministic measurement, human certification or the immutable approval
  writer. Prior unchanged-source tests are baseline evidence for those areas,
  not a claim of fresh optical or full hosted acceptance.

The web specialist's loopback HTTP proof establishes first-byte delivery locally.
Actual chunk delivery through the Vercel `/admin` rewrite, including a response
lasting beyond 120 seconds and a terminal refusal, is still required before
claiming the CDN idle boundary is qualified. Proxy and both readers must ship in
one matched staff artifact.

## Additive database review

All three published migration files independently match their original proposals:

| Staff migration | SHA-256 |
| --- | --- |
| `20260912190000_manual_workspace` | `d3109c9196b80d8a847f82869d81a128e363a1137bf6ff22948169115d55683a` |
| `20260912190100_manual_native_intake` | `ddb716395aa40301c6419462e27b666d0464dcb9d84e144d7cd260f43ad72273` |
| `20260912190200_manual_connected` | `932b73c0275e7e4d48a6a80cf48bb386203372df8e9d16d70d28c736ed4b3835` |

The four fixture paths no longer apply raw proposals. The ordinary disposable
Prisma harness inventories exact source checksums, verifies each ledger member,
requires both second deployments to report no pending migration and compares
unchanged complete ledgers. Retained Node20.20.1 evidence really contains 95
public and 38 staff applied migrations, with these exact last-three checksums.

The separate manual-role catalog checks 2,899 columns across the database, nine
manual tables, restricted update columns, no table/schema ownership, dangerous
role flags, membership, create/delete/truncate/trigger or unrelated table access.
Only the two intended non-trigger functions are callable in the atlas schemas;
their security-definer owners/search paths are checked. Grant replay records
`NO_CHANGE`. Eight connected assertion groups and owned cleanup are retained.
No new SQL defect was found; none of this is a live migration or role grant.

## Final local artifact disposition

At the final September 12 follow-up, this reviewer read the existing
`release-readiness/lead/linux-overlay-2/` receipts and checked every current
checkout file against the full manifest. No build, container or test was rerun.

- Final Linux/amd64 image:
  `sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc`.
- Final manifest SHA-256:
  `e29d8da5a5a0d949d398918a9b109ad6f583d1ab9102264370b66866c219c1f7`.
  All 505 unique paths match current checkout byte counts and SHA-256 values.
  The saved image readback verifies those same 505 entries inside that image.
- The 20-file delta matches the overlay receipt exactly, with no deleted source
  entry. Native decoder, preparation and measurement sources remain unchanged.
  The build log resolves the retained base to exact image
  `sha256:b6eaf704a8241afd470d9da81b4402cbd8f16184ecd6c608c99b5396f6ae48f1`;
  the offline build recompiles affected staff output without native/dependency
  reinstallation. Retained native-photo evidence keeps its original provenance.
- The real staff build and repeated image boundary check pass: `/admin`, 26
  browser chunks, 12 server traces, 2,093 checked entries and the generated
  Debian OpenSSL3 Prisma engine. The expanded Node20.20.2 Linux suite passes
  all 265 tests with zero failures, cancellations or skips.
- Source-readback and test receipts select the same final image and use
  `--network none`, read-only root and `--rm`. All 43 task-owned dependency links
  listed in the cleanup receipt are absent; each target still exists. This
  verifier did not reinstall links or remove any target.

The original `linux-overlay-1/build.log` remains as evidence of the first
successful compile followed by the trace-metadata refusal. It is not replaced
by the final passing build. The independent compact disposition and receipt
hashes are `release-readiness/review/final-artifact-disposition.json`.

## Release limits and evidence

The current readiness, runtime, storage, web and owner-acceptance reports retain
these unresolved boundaries: current I/CPU A2 remain serving; new manual ingress
is absent and the old path has a 16 KiB cap; production has no manual schemas or
role; exact-origin PUT CORS fails; actual storage conditional-write/read semantics
need their separately authorized canary; native target startup, finite capacity,
matched staff/private/control binding and applicable final-head release checks
remain required. Final local artifact qualification above is now complete.
There is one active reviewer and zero currently certified reviewers in the
recorded inventory. Physical sports/Pokémon acceptance is NOT RUN and final
approval is BLOCKED until genuine certification exists. Fixture authority cannot
resolve it.

Small independent evidence is under the original handoff root's
`release-readiness/review/`: `trace-journal-race.json` preserves the failure,
`trace-journal-corrected.json` records the verified correction, and
`transport-bounds.json` records the three additional transport probes. The
corrected workflow client SHA-256 is
`f34bca4d4b7627f0da9b950e4d5dd7a89603c7f01cbfb25dc6fe78080e63fae2`;
the reviewed transport SHA-256 is
`c258026a8bf1105ebe2d248ac58feb2a560ae395d6ba7b6fa65b66fb7f07369a`.
Scripts use Node20.20.1 and explicit current source. Original evidence stays in
place; no broad suite or retained native-photo proof was repeated by this review.

This reviewer made no live write, deployment, restart, migration, provider call,
SMS, cloud provisioning or application-source edit. The replacement Astra
operator's initiating-cause prerequisite remains open. The lead must append
the actual hosted/native-target/provider and owner dispositions before claiming
production release readiness. Both source and documentation findings from this
independent review are resolved, and final local artifact qualification is complete.
