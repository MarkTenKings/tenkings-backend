# ATLAS R1 lead takeover — October 22, 2026

> Successor checkpoint: disk capacity is resolved; exact a0f local three-web and native Linux builds plus150 focused tests pass. No activation. Preserve the separately approved slab-release successor before R1 cutover. See [resumed qualification](r1-resumed-qualification.md). The takeover narrative below records the earlier pre-build checkpoint.

The replacement lead read the complete transfer and master plan, retained all 30 requirements, and continued R1 release preparation in the designated foundation worktree. This is a source/preparation milestone, not an activation. Claims remain disabled until Fingerprint is ready; readiness will still require an explicit title-authority policy. Grading, finishing, Ten Kings and Set Ops were not changed.

## Reconciled production checkpoint

Read-only observations at 16:52–17:03 UTC supersede the transfer's photo-only checkpoint. Native, staff and public now use approved-labels source `cf5fcefa1273e5a661691b0d4f877e224d48104a`. Preserve this successor's approved B labels, media, homepage, export transport and package metadata when composing R1. Do not deploy the whole foundation branch over it.

| Surface | Observed identity |
| --- | --- |
| Native image | `sha256:5336fca9c4ef1d8ba7462d120ab226a401e9e63b4750aa4000f77a335be7d478` |
| Main | `ffcbbfcf94891357c3f7d07c2c1302e0402e996f6580d33e5c4d90468d044a93`, started 11:49:29.781 UTC, running, zero restarts |
| Worker | `a138a9ff7275429e3a7ba09b1afb95dde3af3ad61c4ef96e91ad7cbb4c144fc7`, started 11:49:31.643 UTC, running, zero restarts |
| Staff | `dpl_89Wbq9hBih53SpwsKV7zXpgpbwct`, `atlas-grading-staff-ik6z5sizh-ten-kings.vercel.app`, READY |
| Public | `dpl_8j6wpzFdViSDX9EuKaCVvreunMsR`, `atlas-grading-public-ifz81mkm1-ten-kings.vercel.app`, READY |
| Customer | Source `c68e9ea7c77b35fc53cab6ee162e063dfb02b0fe`; `dpl_2aW7K6CTUftYNKaWanBouvgUaDS5`, `atlas-grading-customer-3pykjnz60-ten-kings.vercel.app`, retained |
| Controls | Staff 142, Public 104, STAFF SMS 110; Customer 83, CUSTOMER SMS 35 |
| Database | PostgreSQL 17.11, `atlas_grading`; baseline plus 002–009, nine matching ledger rows; no 010/011 objects |

Database inspection used TLS verification and a repeatable-read, read-only transaction with rollback. No collection/preferences/proof/lifecycle schemas, comp-curation table or new restricted roles exist. No release advisory locks were present. The prior labels release has retained technical proof `6ec862f3…`, explicit holder release `381d708e…` and absence `0c8cb77d…` at 12:06:33 UTC, followed by refreshed absence `84c27a4b…`. Those completed release actions must never be replayed.

Both current gateway path predicates match the comp read and decision aliases under `/api/staff/manual-connected/cards/:id/comp-curation`. Outer live-admin config and inner read-only adapted mounted file were observed; the inner admin API is disabled. File hashes are outer `23d08cb750f9d19425f119bd74cfd5ed2e93de394f2ca1c639232f6a984d8584`, inner `e8f0543569b1ce882e18f01b718312573c1c3a9a0a76a2eba6ec68d8bc395e70`. This supports retaining both gateways. It does not replace signed end-to-end method/query/body/nonce acceptance.

## Isolated release candidate

Branch `codex/atlas-r1-activation-20261022`, candidate `a0f4951fb7adc34a92ea1cd67d6bd6d4271cb3e1`, tree `0730910b546cdbfb412eb153072a1376d5e36bae`. Its parent source-preparation commit `01f22aaa2b8685c30ca7332321ba05bf8d28be42` is based directly on production `cf5fcefa`. It selects the R1 collection/preferences/display and staff saved-comp serving closure from foundation `7a2e5873be221873fcc4068dcd789d648143f716`, plus registered additive schema, test and qualification support.

All 71 serving copies match the foundation source. The candidate preserves 108 production-successor paths and all eight protected grading/finishing prefixes. The packager retains approved B assets and adds only the `comp-runtime` script. No environment flag, role, credential, control or server state changed. Claims, history and selected-sale guidance remain off; native policy remains null. Claim submission/proof-writing workflows are excluded; inert read contracts required by static imports remain present.

One targeted independent review checked 339 files in relative-import closure and literal dynamic test-source reads. It found a missing `PriceEvidence.jsx` read by the included collection UI test. The additive correction copies the exact foundation test-support component (`c64bab1657a08e5cfcfae9955a1bf2c0ac30b5fd32015011be9e95b87397a6ab`); it introduces no serving import or activation. Generated clients/build outputs remain normal build prerequisites. The foundation checkout and original dirty checkout were not switched or overwritten.

## Verification reused and still required

Six retained envelopes and their saved source snapshots were checked against the initial candidate; the correction adds only the missing test support and documentation. No broad suite was rerun.

| Retained envelope | Source matches | Reuse limit |
| --- | --- | --- |
| Account composition `52055875…` | 17/17 | Preserves local component/browser evidence; new combined build is still required |
| SQL010 `fd359467…` | 33/46 | Exact 010 bytes retained; excluded claim fixtures and later 011 fixture/manifest changes prevent whole-envelope equivalence |
| SQL011 `d23f832f…` | 66/67 | Production label transport is newer; recheck signed comp integration on candidate |
| Staff integration `9659dd72…` | 14/14 | Retain local integration evidence; qualify actual combined staff build |
| Native host `9bdd5134…` | 8/9 | Packager includes approved B source plus comp-runtime; qualify actual Linux package |
| Native runtime `57d24e7b…` | 24/25 | Production label transport is newer; recheck candidate transport |

This comparison verifies envelope bytes and retained snapshots, not every nested result or the new combined release. Existing SQL rehearsals/preservation evidence remain valid for their exact sources. Native Linux and all three web build/asset/secret-boundary checks remain outstanding. Do not label this candidate build-qualified or release-ready.

The Mac had 463 MiB free at the latest capacity check. No build was started and no unrelated caches, artifacts or worktrees were deleted. Additional local space or a separate build host is needed. The owner then confirmed an immediate Mac shutdown/restart to resolve capacity; work stopped after saving this checkpoint. Resume with a disk/source freshness check. Three separate database roles and a separately scoped native GET-only saved-artifact credential also remain unprovisioned. See [activation preparation](r1-activation-plan.md) for exact gates and order.

## Evidence and continuation

Root: `/Users/markthomas/.codex/atlas-handoffs/atlas-r1-activation-20261022/takeover-01/`.

| Receipt | SHA256 |
| --- | --- |
| `native.json` | `f515cca3c3e19add0db14a8f7cc06320934e1e5bee0c405a237857b2e663bbf4` |
| `database.json` | `83e9e4168626656cbc6b45638eebd744f032669610e29019edb7c99b0cb400b4` |
| `privilege-prerequisites.json` | `cee9d8720ea0e200ea7c7b965d1e318bcd6891631a67e6e1807696e6376d93ea` |
| `vercel.json` | `3411e2f56834ed355145609e2785c698555266e8f5328fe8c42a7300fd6eeb9e` |
| `gateways.json` | `ae6e6cd3ab313f4edeb1e8c433ac13e77ecfa56d6d08731323b6ae1d676ad23a` |
| `candidate.json` | `dbfd278312fe8a057f2e75308dcf5486eca37247431d0f22b39c3a06c6a338c6` |
| `candidate-review.json` | `d85d87b902ce7c088545a50ef3637a01995afe1f96f583a8097b6da1ccc31705` |
| `evidence-reuse.json` | `c67d478c42d1a1ab0c50738e681b955d440a5a67c3ef35b7d05ee6198b2efc09` |

Continue from this candidate after capacity is resolved, refreshing production source first because independent slab-preview work is active in another chat. Its latest observed work is local; do not overwrite or duplicate it. Then qualify exact builds and prepare fresh bounded live effects. No production writes, migrations, grants, restarts, deployments, grading actions, paid provider calls, notifications, prints or money movement occurred in this takeover. All 30 master-plan items remain in scope; this is a usable R1 subset only.
