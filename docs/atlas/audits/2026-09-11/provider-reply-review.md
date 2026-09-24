# Provider AI reply and controlled logging investigation

**September 11 Pacific / September 12 UTC, 2026.** Mark returned the DigitalOcean AI assistant's answer. It reports that old detailed log entries cannot be retrieved without prior forwarding. It supplied no incident records, backend identities or cluster-specific support investigation. Treat it as a provider-assistant statement, not proof of the cause or independent verification of permanent deletion.

The checked console exposed only recent lines, with no existing forwarding destination displayed. We have no retrievable trace of the September 11 failures through the paths examined. Further historical searching is not the active dependency: the next evidence is a controlled reproduction. An actual historical trace, if later supplied, can still be incorporated.

## Corrections to the suggested setup

The pasted instructions are external advice, not Mark's authorization to modify infrastructure. No suggested command or configuration change was executed.

| Pasted claim | Verified interpretation |
| --- | --- |
| Forwarded logs are retained seven days | There is no established universal seven-day guarantee. The official forwarding guide exposes configurable maximum storage days for OpenSearch/Elasticsearch. Retention depends on the selected destination/configuration. |
| Turn on `logging_collector` to forward logs | PostgreSQL's collector redirects stderr to files and is a server-start setting. It is not required for the currently observed syslog route. The official forwarding procedure does not require this change. |
| PATCH the database cluster endpoint to change configuration | The documented standard configuration endpoint ends in `/config`. Its public schema does not list every PostgreSQL setting. Do not send an unsupported payload. |
| A new sink resolves the investigation | A sink captures future output. Adding one does not provide the missing incident trace or fix grading transactions. The bounded local test needs no new hosted logging service. |

Sources: [DigitalOcean forwarding procedure and configurable retention](https://docs.digitalocean.com/products/databases/postgresql/how-to/forward-logs/), [configuration endpoint](https://docs.digitalocean.com/reference/pydo/reference/databases/patch_config/), [PostgreSQL collector behavior](https://www.postgresql.org/docs/17/runtime-config-logging.html).

## Logging controls are not an available application-level fix

A bounded read-only privilege probe at **03:48:36 UTC** found that `doadmin` and the current staff, coordinator and operator roles are all nonsuperusers and have neither `SET` nor `ALTER SYSTEM` privilege on `log_parameter_max_length`, `log_min_duration_statement` or `logging_collector`. No settings were attempted. [Projected receipt](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/provider-reply-review/parameter-permission-probe.json).

The standard provider configuration documentation does not list the parameter-length setting. The separate [Advanced Edition configuration resource](https://docs.digitalocean.com/reference/terraform/reference/resources/database_advanced_postgresql_config/) does list it, but that does not establish support on this existing standard cluster. The rebuild must verify a supported provider configuration before claiming this control is available. An upgrade or new grant has not been selected.

The application can independently prevent image-sized SQL parameters by storing immutable media separately and retaining small references. Therefore an unavailable logging setting must not become a reason to retain the old image-filled coordination design or introduce a logging-service dependency.

## Controlled investigation scope

The existing fresh Astra extra-high investigator was assigned a bounded comparison using owned disposable databases, the current guards, matched synthetic images, the existing **1,000 ms** logging threshold and the original deadlines. Compare unlimited non-error parameters with zero, record actual threshold crossings and transaction/lock timing, and retain useful log-volume measurements. No production data or paid model request is involved.

Mac system logging must not receive the synthetic image bodies. If using an owned local file destination instead of production syslog, explicitly retain that difference in the conclusion. A separate forced-logging microbenchmark can establish logging volume/cost; it cannot establish a natural threshold crossing or historical causality. Missing evidence must not be replaced by `pg_sleep`, a lowered threshold or extended transaction deadlines and called a reproduction.

The initiating-cause prerequisite remains open until evidence identifies the failing operation/wait and demonstrates its correction under representative conditions. Historical record unavailability does not waive it.

## Measured result

Both matched **12,207,165-byte**, current-guard cases passed at the unchanged **1,000 ms** slow-log threshold and **10-second** transaction deadline. Each included one concurrent staff activity reader and ended with four attempts, four receipts and four applied steps. Effective connection settings were captured, rather than inferred from fixture defaults.

| Measurement | Unlimited parameters | Parameters disabled |
| --- | ---: | ---: |
| Reservation transaction | 587.924 ms | 627.845 ms |
| Apply transaction | 693.998 ms | 847.688 ms |
| Naturally qualifying image-bearing slow statements | 0 | 0 |
| Natural slow-log output | 0 bytes | 0 bytes |
| Ten-second timeout reproduced | No | No |

Some multi-statement application phases exceeded one second; the database's threshold applies to individual protocol messages, not the entire application phase. No speedup from disabling parameter logging is established by these natural cases, because neither activated that path.

A **separate forced-logging cost test**, using threshold zero only in an owned read-only test transaction, supplied the same 12.2 MB text parameter to a simple SELECT. Unlimited parameters produced **24,414,938 bytes** of local log output, including two parameter-detail records for Bind and Execute; disabling parameters produced **478 bytes**. Client times were **56.755 ms versus 16.659 ms**, about a **40 ms** difference in this single ordered sample. The control demonstrates logging-volume amplification. It does not establish the cost of a naturally slow image INSERT or a ten-second production failure.

These tests used local Mac PostgreSQL 17.10 and an owned stderr file; production uses managed Linux PostgreSQL 17.11 and syslog. They did not exercise DigitalOcean's syslog destination, historical contention or the full long-running provider/periodic-heartbeat sequence. Reader scheduling differed between samples. Test order/cache effects are not isolated, and these are not statistical latency percentiles. Both disposable cases were removed and their cluster stopped. No synthetic image body was sent to host system logging.

**Decision:** retain small image-reference records and bounded diagnostic output as sound design requirements. Do not label logging the established cause, change production configuration based on this microbenchmark, or repeat the same passing Mac test indefinitely. The remaining useful reproduction must exercise representative Linux/runtime resources and the real overlapping operation sequence, capturing the actual slow statement and lock holder alongside pool/client/CPU/commit timing. Use a stub provider and isolated records; a new hosted logging service is not a prerequisite. Whether the parameter limit can be configured on the current managed service is separate from removing image bodies from SQL.

## Evidence

- [Provider-reply verification receipt](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/provider-reply-review/verification.json).
- [Privilege probe script](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/provider-reply-review/parameter-permission-probe.mjs).
- [Controlled test results](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-counterfactual/test.json); [test construction](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-counterfactual/build-test.py).
- [Investigator report](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-counterfactual/REPORT.md); [new experiment manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/logging-counterfactual/manifest.json).
- [Authenticated console findings](database-console-followup.md); [rebuild plan](../../plans/ATLAS_SPEEDSTER_REBUILD_PLAN.md).
