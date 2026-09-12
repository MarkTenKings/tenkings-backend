# Authenticated database investigation — September 11 Pacific / September 12 UTC

**Later evidence:** Mark returned the provider AI reply. The [reply review and controlled logging test](provider-reply-review.md) records its limitations, corrected setup advice, unavailable app-level parameter privileges and a passing real-threshold comparison. Logging-volume amplification is measured; the historical timeout is still not reproduced.

**The sign-in worked. The console reveals real long lock delays and a production logging behavior omitted from the passing tests. Neither identifies the exact initiating statement in the failed card run.** The fresh Astra extra-high investigator reviewed the new configuration and PostgreSQL source; root reviewed its findings. The rebuild plan now includes the resulting correction and acceptance requirements. The serving application has not changed.

## What we found

| Evidence | Simple meaning | What it does not prove |
| --- | --- | --- |
| Advisory-lock statement maxima of **10.36 seconds** and **62.96 seconds**; private-controls lock function maximum **23.01 seconds** | Database requests in the shared coordination paths have taken longer than ATLAS's ten-second transaction deadline. | The console does not give the occurrence time, role, lock key or holding backend. These maxima cannot be assigned to the failed card. |
| Production logs statements taking at least **one second**, with **unlimited parameter values** | A qualifying image-bearing request can generate substantial extra logging work while its transaction remains open. | We have not proved that the incident's image-bearing statement crossed this threshold, or measured its logging cost. |
| The passing local fixture had slow-statement logging disabled | A meaningful production behavior was missing from the earlier reproduction. | Enabling this behavior has not yet reproduced the incident. |
| The retained database deadlock count is **zero** | The observed errors do not establish a database deadlock. Ordinary lock waiting can still occur. | The counter does not rule out transaction deadlines, application pool timeouts or earlier unretained events. |

The database console showed **85 aggregate query-statistic rows** and **100 recent log lines**. The retained recent lines covered September 11 **20:12:30–20:14:29 Pacific**, not the morning incident. Expanding the viewer exposed no historical date or paging controls. Log-forwarding settings listed only options to add new destinations; no existing destination was displayed. No destination was added and no settings, statistics or connections were changed.

**Correction to the earlier access conclusion:** `pg_stat_statements` is absent from the accessible `defaultdb`; that does not mean DigitalOcean has no managed statistics. The authenticated console exposes aggregates. Read-only SQL discovery found a provider `_dodb` database to which the available account has no CONNECT privilege. We did not attempt to bypass that boundary. The aggregates contain neither incident timestamps nor a statistics-reset window. Whitespace variants of the advisory-lock SQL are used by multiple paths; they are not reliable role identifiers.

## Resource history and its limits

The current cluster is a primary-only **1 shared vCPU / 1 GB RAM** instance in NYC3. The console displays a 22-connection limit; PostgreSQL's separately inspected `max_connections` is 25. Neither is the operator's one-connection client pool. The database's 24-hour connection chart ranged from 8 to 20; that is not a record of operator-pool availability.

Approximate one-minute samples were read from the rendered node charts and mapped to their visible axes. At the first timeout, around **08:35 Pacific / 15:35 UTC**, CPU was about **31%** and one-minute load **0.42**. Later in the same failure window, load reached about **6 at 08:37** and **12 at 08:43**. At **11:31 Pacific / 18:31 UTC**, near the latest failure, load was about **2.94**, CPU **39%**, and memory **89%**. These are chart-derived estimates, not raw per-query measurements. The first failure cannot fairly be called proved CPU saturation; high load does not identify CPU versus I/O pressure or a lock holder, and memory utilization alone does not prove OOM.

The SQL probe at **03:21:43 UTC** reported `defaultdb.deadlocks=0`, `stats_reset=null`, and current `pg_postmaster_start_time=2026-09-05T19:19:27Z`. No database crash or restart during these incidents is established. A null reset field does not provide a complete historical coverage guarantee.

## The newly identified logging path

At **03:24:10 UTC**, the read-only configuration probe observed `log_min_duration_statement=1000`, `log_parameter_max_length=-1`, `log_parameter_max_length_on_error=0`, `log_destination=syslog` and `logging_collector=off`. A subsequent role/database-settings probe found no applicable operator, coordinator or staff logging overrides. This establishes expected inheritance from current settings, not a captured historical operator-session configuration.

The non-error parameter setting permits complete values for qualifying slow Bind/Execute logging. The on-error setting of zero does not disable that separate output. PostgreSQL distinguishes syslog's preference for dropping messages from its lossless logging collector, which may block; the observed collector is off. We therefore do **not** claim proved syslog backpressure. [PostgreSQL 17 logging documentation](https://www.postgresql.org/docs/17/runtime-config-logging.html).

Pinned PostgreSQL **17.11 source** shows that the reported statement duration is calculated **before** formatting and emitting its parameter detail. An image-bearing parameter requires conversion/copying; the upstream syslog path splits messages into payloads of at most 900 bytes. A 12.2 MB parameter could therefore entail roughly **13,600 syslog calls per qualifying log event**. That is a source-derived estimate, not a measured DigitalOcean count or elapsed duration. During an explicit transaction this work can extend lock ownership before commit. [Duration and parameter logging](https://github.com/postgres/postgres/blob/REL_17_11/src/backend/tcop/postgres.c#L2330), [parameter formatting](https://github.com/postgres/postgres/blob/REL_17_11/src/backend/nodes/params.c#L335), [syslog output](https://github.com/postgres/postgres/blob/REL_17_11/src/backend/utils/error/elog.c#L2360).

**Plausible sequence, still unproven:** an already slow image-bearing statement crosses the one-second threshold → logging adds work while the global lock remains held → other requests wait longer → transaction/pool deadlines are reached. A slow lock or deferred-check statement has no image parameter itself and does not prove this sequence. The earlier native full-row SELECT tests returned image data but did not bind image bodies, so they did not exercise this path either. The first incident also preceded the final 12.2 MB continuation.

## Resolution added to the rebuild

1. **Keep image bodies out of coordination transactions.** Store originals once and use small immutable references, compact status reads and card/action ownership. This preserves photo quality while removing demonstrated transfer/validation work and potential log amplification.
2. **Bound diagnostic output.** Plan to disable non-error bind-value logging (`log_parameter_max_length=0`) for the relevant runtime scope, or use a deliberately small supported cap. Retain useful normalized query/phase timing and error categories. This is a proposed configuration requirement; no production setting changed.
3. **Test the behavior production actually runs.** A controlled comparison must include the same slow-log threshold, representative runtime resources, transaction wrappers and concurrent readers. Compare bounded versus unlimited parameters while measuring client/backend time, log volume and lock lifetime. Artificially logging every statement can measure cost but cannot prove the historical statement crossed the real threshold.
4. **Keep failure local to its card.** The already confirmed FAILED takeover dead end and one-distinct-card allowance require separate correction. Logging changes alone would not repair those rules.

## Remaining evidence and status

The exact initiating operation/wait remains **OPEN**. The requested historical windows are September 11 **15:34–15:43** and **18:30–18:32 UTC**. We need correlated backend/role/statement and holder/waiter entries, or an instrumented representative failure followed by the corresponding correction. Another passing local run or a longer timeout cannot close this question.

A [DigitalOcean Support draft](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/digitalocean-support-request.md) was prepared. Mark instead relayed a [prepared message to DigitalOcean's AI assistant](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/digitalocean-ai-assistant-message.md) and returned its answer: it reports that old detailed logs are unavailable without previous forwarding. It provided no incident evidence. The [follow-up](provider-reply-review.md) verifies the technical advice and advances controlled testing instead of waiting on this reply. **This task has sent no outside support message or changed production configuration.**

The owner's initiating-cause prerequisite for the replacement operator is unchanged. This investigation does not claim the live ATLAS system is fixed or authorize implementation by treating missing evidence as success.

## Receipts

- [Console statistics and access limits](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/console-evidence.json); [approximate incident chart samples](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/console-incident-metrics.json).
- [Fresh investigator's logging analysis](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/slow-query-parameter-logging.md), [configuration probe](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-parameter-probe.json), [role overrides](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-role-overrides.json).
- [Deadlock/restart counter](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/deadlock-counter-probe.json); [provider statistics discovery](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/provider-stat-discovery.json); [operation/query correlation map](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/log-correlation-map.md).
- [Earlier matched tests and limits](timeout-investigation.md); [updated rebuild plan](../../plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md); [receipt hashes](evidence.md).
