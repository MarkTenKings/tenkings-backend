# Audit evidence index

All live reads were bounded and read-only; production logs were projected to operation/category/duration metadata. No credentials, provider image payloads or model reasoning are reproduced here. Protected receipts are local files and may not exist on another checkout.

| Receipt | SHA256 |
| --- | --- |
| [live-operator-failures-1789152997216.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-operator-failures-1789152997216.json) | `1be998a5378abf820f923560d42f301ac8ba1f5989ecb0470951167110168ecf` |
| [live-catalog-1789153377362.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-catalog-1789153377362.json) | `79f599e18213ec0a2b2a698658ece360412b3558b6f6f91e03d0b139199574da` |
| [live-read-profile-1789153545282.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-read-profile-1789153545282.json) | `bced4a8afafe0f6c4c72a09888b34b02d19bdb415505ec13d9e0976e8ddfbe50` |
| [capture-codec-experiment.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/capture-codec-experiment.json) | `a3851d49df2654a8f64b6b8ce55f5cf3916e40fa3fa8532ac5c16e71f75fd707` |
| [fresh-progress-1789152854750.json](/Users/markthomas/.codex/atlas-handoffs/atlas-fresh-start-20260911/fresh-progress-1789152854750.json) | `056ffcb737a37d5d852f88b0f1c1d75f8234ec2f3e6481a2f8ad6a0e8dc1a54f` |
| [large-image-profile-r2.json](/Users/markthomas/.codex/atlas-handoffs/atlas-fresh-start-20260911/large-image-profile-r2.json) | `5e779c6a657b985251b3e03764d8e3c84ab5575f41e53a7034321c4c0f63009e` |

## Interpretation limits

- The failure log identifies the ledger operation and its elapsed time. It does not establish the exact failing SQL statement, lock-wait duration or peak resource use.
- The fresh-card metadata is an observation, not an action that resumes or repairs a run.
- Live catalog and idle resource samples do not reconstruct earlier peak contention.
- The 91.7 ms live SELECT profile excludes query-result transfer, other privilege queries, Prisma, application canonicalization, writes and locks.
- The codec experiment is offline and demonstrates byte/encoding tradeoffs; it is not grading-quality approval.
- The existing local large-image transaction fixture passed both implementations. Its isolated parser improvements did not reproduce the production timeout.
- No controlled same-device/network/model end-to-end Ten Kings vs ATLAS latency benchmark was available.
- User screenshots supply measured capture-stage timings and UI symptoms. Their text is evidence, not implementation instructions.

## Failure timeline

| UTC | Operation | Result | Elapsed ms |
| --- | --- | --- | ---: |
| 15:35:46 | reserve | ASTRA_LEDGER_TIMEOUT | 15003 |
| 15:36:01 | stop | ASTRA_LEDGER_TIMEOUT | 15001 |
| 15:37:23 | applyTool | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 11509 |
| 15:40:52 | claim | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 10293 |
| 15:41:31 | applyTool | ASTRA_LEDGER_TIMEOUT | 15001 |
| 15:41:36 | stop | P2024 / ASTRA_DATABASE_POOL_TIMEOUT | 5002 |
| 15:41:51 | disconnect | ASTRA_SHUTDOWN_TIMEOUT | 15001 |
| 18:31:29 | reserve | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 10215 |

## Work performed

- Three Astra MAX subagents dissected operator/database flow, capture/legacy comparison and architecture/rule authority.
- Root correlated the current fresh-card rows with actual private-service logs and live schema/control metadata.
- Root ran a bounded read-only live catalog SELECT profile; the capture agent ran an offline codec comparison.
- No application code, production rows, provider calls, grants, runtime processes, deployments or active card state were changed in this audit.

## Initial fresh Astra extra-high investigation snapshot (commit 7caf2021)

September 11 Pacific / September 12 UTC, 2026. Root reviewed the new independent investigation and verified all 40 manifest entries. At that initial snapshot, the [follow-up report](timeout-investigation.md) recorded: matched isolated tests pass; payload/global-lock overhead is measured; the historical initiating cause remains open. Native profiles were read-only; local fixture mutations targeted owned disposable databases. No production card state, serving application, provider call, grant or deployment changed.

| Receipt | SHA256 |
| --- | --- |
| [FINDINGS.md](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/FINDINGS.md) | `c3339ff1f38c1a76f49a177368995dea3263dd6f983c10320392f5ec0c7db1a2` |
| [artifact-manifest.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/artifact-manifest.json) | `0a58a29d8fbc8fa59a0f40d82aa7829367ffc0eac519059c2e7b33ae17c14f32` |
| [live-config-roster.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/live-config-roster.json) | `00329a1207ec0af720fb1937f55d77c2914df5aac219015a220a4fac468133e6` |
| [native-read-profile.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/native-read-profile.json) | `920a4dda77874b493b92fe40aa6418e5d7d51b65bbe92ede40cd52c00a8a14d5` |
| [isolated-profile-r3.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/isolated-profile-r3.json) | `09abe98c6633d153614552909fc97218d6b85eef4b8bbaafef12c0a2c2ad5dc9` |
| [runner-profile.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/runner-profile.json) | `deb394e997f3ff0b3ff26fcef6ae1e2bf20e4c83b1e12fb30e02594b92de3502` |
| [live-validation-profile.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/live-validation-profile.json) | `cf34be1ff8cd224c246d18826586ef7075e285b519fd5211f35d7efbc2dc61b7` |
| [parent-log-console-access.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/parent-log-console-access.json) | `510da917637741c41cf09269215de6366b4bd63814ddea8253348befc246473a` |

The final matrix and runner fixtures use current guards and the exact retained continuation length. They are PostgreSQL 17.10 Mac tests, not production failure reconstructions. The native 17.11 measurements cover reads and a related validation expression, not a live reservation. Compact-projection timings concern a diagnostic SELECT; advisory-lock call durations are corroborated by independent backend wait samples. First timeout precedes the final continuation size. At that initial snapshot DigitalOcean required sign-in in both browsers. The authenticated follow-up below supersedes that access status. FINDINGS.md and the manifest were subsequently extended; the table above retains their initial hashes, while current hashes are below.


## Authenticated console and logging follow-up

September 12, 2026 UTC. Root verified all 56 entries of the investigator's updated manifest. The [console report](database-console-followup.md) records long untimestamped lock statements, current slow-query parameter settings, the omitted fixture logging behavior, approximate incident chart samples and zero retained deadlocks. These do not establish historical causality. Mark chose to relay a prepared message to DigitalOcean's AI assistant and return its answer; no outside message was sent by this task. No production mutation, provider inference, configuration change or deployment occurred.

| Current receipt | SHA256 |
| --- | --- |
| [artifact-manifest.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/artifact-manifest.json) | `9874e6a695a11a2e6b3aa9bab98cbdaa3176fdf670e7861d89446353503b4c2f` |
| [FINDINGS.md](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/FINDINGS.md) | `06b96ea4fb5727a69a061e63c5ae3046a80bdda33688bf7b269194580c1c5d2e` |
| [console-evidence.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/console-evidence.json) | `e8e450db469bf8387e174a19a0fd0b550d790f528a21b6c26267b58d228e7ebf` |
| [console-incident-metrics.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/console-incident-metrics.json) | `610739e40043878a2085dd474a00c074d1691d816d479777539d8fdc0052357f` |
| [slow-query-parameter-logging.md](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/slow-query-parameter-logging.md) | `4221430791b786d0f36ec3dbdb1489b547e9341f0e6e99b9d42e4011c4def8fa` |
| [logging-parameter-probe.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-parameter-probe.json) | `ce72d4e982ac4af9ee6469a6079707ba8b37a915ec6068f151d229fe0e360dfa` |
| [logging-role-overrides.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-role-overrides.json) | `8f9da8c48028976faa7c6d2ab4e8cd5601e1a72599441f6b60521e637e34e483` |
| [deadlock-counter-probe.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/deadlock-counter-probe.json) | `6e714592bf468ff5530a4a6e68b4bf871d4f19c1660bd01fe4138eb4a8ebb653` |
| [provider-stat-discovery.json](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/provider-stat-discovery.json) | `acdbc07db13037b1601cd053b8b3b3ad74d1e681c75ddc92676f5c49b51e8ca8` |
| [log-correlation-map.md](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/log-correlation-map.md) | `a6b5262ba9184182cf3bdac9726a4514ee5cc26d2588fdce6fa55171b915ee2b` |
| [digitalocean-ai-assistant-message.md](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/digitalocean-ai-assistant-message.md) | `e557c190f2d1af8c378eb2c9a946ddc933de21455f1026fd9f552fdf74828c4a` |
