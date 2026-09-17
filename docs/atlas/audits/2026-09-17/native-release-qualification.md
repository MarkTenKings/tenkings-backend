# ATLAS rebuild 3 native release qualification — September 17, 2026

The reviewed manual/Astra candidate builds and passes its offline native,
staff and disposable PostgreSQL checks. **It is not deployed or accepted on real
cards.** The required CI checks pass for application source `30dbea77`.
Live storage integrity remains unqualified, with the distinct sealed test
awaiting owner approval. Hosted staff/control activation and human acceptance
remain subsequent work under the [release execution plan](release-execution-plan.md).

## Qualified source and image

| Identity | Value |
| --- | --- |
| Application commit | `30dbea77c484e61de56da522d67a841cb9df25ee` |
| Git tree | `e4d5138402f66f5d381fffc4eaab8d3874e67fbd` |
| Native image ID | `sha256:50ffd1e6ab8a0967a7dbbb214788a9b134ae20625aac9ba9a85cf5967635b2f4` |
| Source manifest SHA256 | `decf72799a6b479ac29dbd8f0a6cba2a635da3f1728bc3d98dbb6fab905b59b3` |
| Packaged source | 555 files, 6,857,292 bytes |
| Build completed | September 17, 18:38:46 UTC |
| Target | Native Linux amd64, Node20.20.2, Next15.5.25 |

The complete canonical Dockerfile build used the isolated task-owned builder on
the existing Linux host, capped at one CPU and3GiB with no additional swap. The
image retains the pinned Node base, libheif1.23.2/libde2651.1.1 archives, Python
NumPy1.26.4/OpenCV4.10.0.84 dependencies, and actual generated staff Prisma engine.
Its inspected command runs `packages/atlas-connected-manual/scripts/serve.mjs`
as `node` from `/workspace`. It does not start the old grading operator.

Both lead and independent reviewer compared every packaged file with the current
checkout. Image source readback also passed. The preceding parser image
`2819fdf7…` differs only in the reviewed identification concurrency test; the
final image includes its deterministic correction. Production identification
code did not change. Earlier build images and the failed378/379 test receipt are
retained as historical evidence, not substituted for the final candidate.

## Exact-image qualification

All groups ran in separate task-owned, nonroot containers with no network,
read-only root, one CPU,3GiB memory/no extra swap, a1GiB temporary filesystem,
256-process limit, dropped capabilities and no additional privileges.

| Check | Observed result |
| --- | --- |
| Source readback | All555 file lengths and hashes match |
| Production staff boundary | PASS;26 browser chunks,12 server traces,2,093 traced files, `/admin` mount and Debian OpenSSL3 Prisma engine |
| Native retained Front/Back photos | PASS; primary and SDR working images each retain3024×4032 dimensions and exactly match the Mac oracle's raw pixel hashes |
| Package suite | 379/379 pass; zero skipped/canceled;156.1seconds;313,229,312-byte peak cgroup memory |
| Staff/manual suite | 42/42 pass with actual Next15.5.25; zero skipped/canceled;9.8seconds;121,090,048-byte peak memory |

The native photo run retained both originals' exact hashes/byte lengths and used
312,012,800 peak bytes. These retained images establish compatibility with their
qualified profiles; they do not prove every iPhone format or fresh optical
detail/color acceptance against physical cards.

The actual Next parser tests accept valid whitespace-padded JSON through2MiB and
refuse2MiB+1 before runtime. Smaller action/legacy limits remain enforced. Other
tests cover paired manual recovery, reviewed findings/memory, recognition replay,
human-requested defect analysis and terminal streamed-response decoding. No real
storage or model effects were used. A hosted request lasting more than120seconds
still needs to prove its terminal envelope through the actual Vercel/Caddy path.

The lead independently verified the result identities, successful exits,
nonrunning/non-OOM container states and each retained log's SHA256. These checks
qualify the built artifact; they do not admit production configuration.

## Disposable PostgreSQL qualification

Four sequential validators passed using retained native PostgreSQL17.11 tooling
and a separate fixture-only image: manual-service, manual-intake,
connected-manual, and defect-memory (which also invokes defect-analysis).
They passed49 substantive groups:15 service,10 intake,8 connected and16
memory/analysis groups.
Each applied all95 public and40 staff fixture migrations and both second-deploy
no-op replays. The validators exercised their complete effective-role/catalog
checks as well as actual repository, authorization and recovery behavior.
Connected-manual exercised the actual CPU with synthetic storage/provider inputs.
Every owned cluster reported verified stop and removal of its temporary data.
No production connection or real staff identity entered these fixtures.

Final cleanup at18:48:11UTC removed exactly22 exited task-owned containers and
stopped only the owned builder, preserving images and its cache. All21 other
container identities, running states and start times were unchanged;14 remained
running. Available memory was6,103,982,080 bytes and free disk58,675,601,408 bytes.
The builder's2,543,529,984-byte memory peak had no OOM/max events. Its exit1 followed
the explicit stop, with SIGTERM in its retained log. The lead notified the
Inventory task that the coordinated build/test hold was released.

The fixture image adds only test tooling/source to the earlier parser image.
Its production sources match the final image; the sole final-image delta is the
deterministic package concurrency test. The explicit runtime, fixture-extra and
operator-helper manifests record this distinction; its synthetic Git snapshot is
fixture provenance, not the release commit. Initial setup failures from Git
ownership and a PostgreSQL support-file symlink were preserved and corrected
without weakening host Git checks or changing application source. Those failures
did not start a database server.

The existing CI disposable staff validator is a separate passing result with247
scenarios. It does not replace the four new manual/memory/analysis validators.
The production ledger remains a separate read-only observation:97 successful
public and35 staff migrations, including two additional public Inventory/catalog
migrations outside this branch. Release applies only the five reviewed staff
migrations; never run this branch's public chain against production.

## CI and remaining live gates

[CI run35258952830](https://github.com/MarkTenKings/tenkings-backend/actions/runs/35258952830)
passed all14 required jobs for PR378 at application head30dbea77. GitHub's tested
merge revision had the same source tree. The legacy image repair passed all186
tests, exact compiler/runtime validation and invalid-override rejection; see the
[dependency repair evidence](speedster-apt-snapshot-repair.md). No CI check was
removed or weakened. The PR remains a draft and is not merged.

The [sealed storage qualification](storage-qualification-approval.md) remains
unexecuted. Its two new65-byte objects and bounded verified cleanup require the
separate permission requested from the owner; the previous canary permission
was consumed and its failed intent remains intact. Source/offline tests do not
prove Spaces checksum refusal, conditional creation or private read behavior.

Dedicated staff/public provider identities and existing CLI tooling have been
read back without a deployment. The actual cached Vercel59.15.1 staff upload dry
run passed against a clean standalone checkout of30dbea77:2,511 files,
167,899,247 bytes, manifest SHA256
`7163ad729ff958804249d658e372de2f6bbccd361aa44382a37146da5ab1d2ed`.
Every selected file matches its Git blob and mode; actual CLI Git metadata
matches the authentic commit/origin. Three metadata GETs used an existing token
only in child memory; provider writes and environment reads were zero, and
existing credential/configuration files were unchanged. This is source upload
qualification, not a hosted build or deployment. Actual new deployment IDs/configuration hashes,
revision-fenced controls, complete ingress validation and hosted authenticated
checks remain to be bound. The manual release must explicitly keep old operator
consumers inactive, including the legacy bridge created from origin/key presence.
Ordinary manual work and Confirm findings use existing reviewer/card authority;
final report approval separately requires a genuine certification decision.

Fresh phone/Mac sports and Pokémon acceptance, real Astra quality/cost/latency,
and useful reviewed-memory retrieval on a distinct physical card remain NOT RUN
in the [acceptance record](real-card-acceptance-record.md). No replacement
autonomous operator, SAM integration, model improvement, final report approval
or optical acceptance is inferred from these passing synthetic checks.

## Retained evidence

External root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/`.

- `runtime/current-source-20260917/`: reviewed source/build/image manifests,
  `reviewed-20260917-{source,boundary,native,tests,staff}` results/logs,
  `lead-reviewed-source-parity.json`, `lead-reviewed-receipts.json` and
  `lead-database-cleanup-review.json`. The complete `qualification-summary.json`
  SHA256 is `e706257acd741bab996fb210d8ec02dc8c6813ad31e9ba30a465b31594138a9e`.
- `fresh-lead-20260917/`: final CI receipt/Speedster log and independent local
  storage/parser/concurrency results.
- `release-auth-database-20260917/prepared/`: proposed ingress/Compose, unfilled
  live inputs and fresh provider metadata/tooling receipts. The
  `provider-readonly-1820/STAFF_DRY_QUALIFICATION.md` addendum links the exact
  source checkout, CLI manifests, verification and guarded network receipts.
- `storage/qualification-20260917/`: unchanged sealed plan and executor bridge;
  no new execution intent.

Failed predecessors remain retained. None of these receipts authorize production
mutation or replace the applicable owner decisions.
