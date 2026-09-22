# Fresh Astra investigation of the reservation timeout

**Follow-up:** September 11 Pacific / September 12 UTC, 2026. Mark requested a fresh `gpt-6-astra` subagent at `xhigh` reasoning, independent review, and an update to the rebuild plan. This investigation examined the currently deployed I implementation. It made no production application-data changes or model requests.

**Subsequent authenticated evidence:** the [database console follow-up](database-console-followup.md) adds historical aggregate lock delays and an unlimited slow-query parameter-logging configuration omitted by the passing local fixture. Sign-in is now complete. The console's recent logs do not contain the incident; Mark will relay a prepared inquiry to DigitalOcean's AI assistant. The exact initiating cause remains open.

## Conclusion in plain language

We confirmed unnecessary work and a shared waiting line in ATLAS's coordination code. We did **not** reproduce or establish the exact cause of the historical ten-second transaction failure. The fresh tests passed even with the retained image size and competing status readers. Calling the image payload or ordinary polling *the proven initiating cause* would overstate the evidence.

The rebuild remedies for the measured overhead and known stuck-card behavior are specified below. The historical initiating-cause question remains open; it has not silently passed the owner's prerequisite for replacement-operator implementation. No serving application is fixed by this report.

| Question | Finding |
| --- | --- |
| Did Astra's fourth model request time out? | No fourth request was dispatched. The observed reservation failed in ATLAS's database coordination before that request. |
| Did PostgreSQL crash? | No crash is established. An application transaction error is not evidence of a database server crash. |
| Is carrying image-filled history expensive? | Yes. The matched isolated reservation took 634–731 ms versus 23 ms for a small continuation. Live transfer/validation also has measurable cost. |
| Does this alone explain 10,215 ms? | No. Every matched test stayed below the existing transaction deadline. |
| Can checking progress make other work wait? | Yes. Backend samples show status readers waiting on the operator's global advisory lock. Ordinary tested polling did not cause the historical error to recur. |
| Why did failure leave everything stuck? | Separate confirmed rules make FAILED terminal for manual takeover and count the failed card against a one-distinct-card pilot allowance. These are application behavior, not a requirement of Astra or PostgreSQL. |

## Historical event and an important chronology correction

Run `ef58fb8f-67d8-4996-b53a-dad72fb53907`, card `b56f75a9-0483-433e-801f-d139f7716fe9`, remains the incident under examination. The latest retained error is `reserve`, Prisma `P2028`, at `2026-09-11T18:31:29.522Z`, elapsed **10,215 ms**. The retained state has three APPLIED attempts and no fourth attempt. Preparation, SAM, Memory and maps were not reached.

The first observed reserve timeout was earlier, at **15:35:46 UTC**, before successful attempt 3 was created at approximately **15:36:25 UTC** with a **9,005,493-byte request**. The later **12,207,165-byte continuation** therefore must not be assumed to have initiated the first failure. Failures span reserve, apply, claim, stop and disconnect; there is no single captured statement accounting for them all. See the [original timeline](evidence.md#failure-timeline).

The application's error projection retains operation/code/duration but deliberately omits error message and metadata. `P2028` identifies a transaction API error; its code and near-deadline elapsed time do not name the failing statement or distinguish all possible waits.

## What the fresh tests actually covered

The disposable fixture used current ledger/privilege/staff-auth wrappers, current database guards, the actual one-connection operator pool, unchanged 10-second transaction deadline, and synthetic PNGs matching the four retained image byte counts and dimensions. Both retained detail crops are Front crops. The retained continuation length was matched exactly; private image content and model reasoning were not copied into the fixture.

The test varied payload size and zero, one or four staff activity readers using the real four-second polling delay. Each variant applied four synthetic requests, receipts and steps correctly. An independent backend sampler recorded wait events and blocking PIDs. No artificial provider delay or forced timeout was used to manufacture a reproduction.

| Measurement | Result | What it establishes |
| --- | ---: | --- |
| Isolated small continuation, 94,781 bytes | Reserve **23.36 ms** | Small-payload comparison, not proposed photo-quality reduction |
| Isolated retained length, idle | Reserve **634.48 ms** | Large payload adds work; no timeout |
| Same length, one activity reader | Reserve **723.12 ms** | Tested contention still passes |
| Same length, four activity readers | Reserve **730.88 ms** | Tested contention still passes |
| Activity-reader advisory-lock call times | About **709–740 ms** | Separate backend samples corroborate lock waits; these call times are not exact sampled wait durations |
| Operator's own observed lock acquisition | At most **17.14 ms** | No ten-second operator lock wait in this matrix |
| Real `runOperator` loop, retained length and activity reader | **3.728 s** total; reserve **611.7 ms** | Real claim/snapshot/renew/dispatch/receipt/apply sequencing passed with one stub NEEDS_EXPERT response |
| Read-only run fetch on actual I Linux container and managed DB | **650 / 1,094 ms** | Actual retained-row transport cost in two samples |
| Compact diagnostic run projection on same connection | **6.2 / 6.1 ms** | Small SELECT comparison; not the production status endpoint |
| Whole native read-only transaction, including acquisition and commit | **1.35 / 1.49 s** | Includes privileges, fetch and JavaScript validation; first acquisition was 203 ms; excludes real reservation writes |
| Read-only image JSON/base64/SHA work inside managed PostgreSQL | **1,088.38 ms** | Four hashes match; validates 9,140,283 raw image bytes, but is not the full deferred trigger |

These are small diagnostic samples, not p95/p99 capacity measurements or an end-to-end speed guarantee. Disposable PostgreSQL was **17.10 on the Mac**; production is **17.11 on managed infrastructure**, with the I application in its actual Linux container. The fixture staff pool has four connections; the operator pool matches the live single connection. The short stub response exercises immediate renewals, not a long inference with periodic renewals. Synthetic PNG ancillary bytes preserve transport size and valid format; they do not reproduce photographic content, production CPU contention, historical network conditions or every table's historical size. The live expression profile performs related read-only work, not an INSERT or full trigger invocation. The passing local loop does not prove production readiness.

## Configuration and source findings

- Operator URL: `connection_limit=1`, `pool_timeout=5`, `connect_timeout=8`. Coordinator/source pools are 2/3 connections respectively. A database role's six-connection limit is a separate setting, not the operator's actual pool size.
- `OperatorLedger.transaction` uses `maxWait=5000`, `timeout=10000`, five privilege queries, the global staff advisory lock, full run checks and deferred-constraint validation. `StaffDatabase` shares that advisory key. A single busy connection can make later operations wait, but the configuration alone does not prove why the first operation became slow.
- The 15-second outer runner timeout is another boundary. Failure cleanup itself needs database access. This can amplify an unsettled slow operation; the historical causal chain still needs timing evidence.
- Normal `reserve` happens **before** the external-call heartbeat wrapper begins. A reproduction that simply overlaps its own heartbeat with reserve would invent concurrency absent from that normal sequence. The actual runner sequence was therefore tested separately.
- The database's default `statement_timeout` is **0**, not 15 seconds. Fifteen seconds was a bound set by individual diagnostic reads; application transaction/operation deadlines still apply.
- Database settings are `log_min_duration_statement=1000`, `log_lock_waits=on`, `deadlock_timeout=1000`, `log_destination=syslog`, `logging_collector=off`. Server-side slow-statement/lock logging is enabled even though the application discards useful exception detail.
- The available database account cannot execute `pg_ls_logdir` or `pg_read_file`. Existing extension inventory shows no `pg_stat_statements` in accessible `defaultdb`; the authenticated follow-up nevertheless obtained provider-managed aggregate query timings in the console. No logging configuration or extension was changed.

Relevant implementation: [ledger transaction](../../../../packages/atlas-operator/src/ledger.mjs:321), [reservation](../../../../packages/atlas-operator/src/ledger.mjs:448), [runner error projection](../../../../packages/atlas-operator/src/runner.mjs:34), [external-call renewal](../../../../packages/atlas-operator/src/runner.mjs:153), [staff transaction wrapper](../../../../frontend/atlas-app/lib/server/access/database.mjs:7), [activity access](../../../../frontend/atlas-app/lib/server/access/workspace-operator.mjs:268).

## Resolution added to the rebuild plan

These changes address verified costs and behavior. They are proposed implementation requirements for the rebuild, not a claim to have proved the historical initiating cause:

| Current problem | Rebuild treatment | Acceptance evidence |
| --- | --- | --- |
| Coordination repeatedly transfers/parses image-filled history | Immutable images/results in object storage; small references and action state in database transactions | Status/lease operations do not read image bodies; same full-quality originals; compare typical and slow latency |
| Status and unrelated cards share a global transaction lock | Compact authorized status reads; atomic card/action ownership with narrow locking | Card B and status remain responsive while card A's action is slow |
| Broad privilege inventory repeated per operation | Validate deployment/role structure at startup or configuration change; retain small actor/card authorization per command | Authorization still holds without catalog scans in every heartbeat |
| A database error becomes an unrecoverable FAILED card | Reconcile the same action/receipt and permit fenced human takeover when appropriate | Failed/uncertain action does not discard completed stages or block manual continuation |
| One failed card consumes another card's allowance | Independent jobs, consistent with the owner's removal of artificial card/spend allowances | A second card completes while the first repeatedly fails or awaits input |
| Generic error conceals the failing phase | Bounded operation timings and redacted error categories, recorded outside the grading transaction | One error identifies pool acquisition, lock/query, local processing, commit or provider phase without retaining credentials/image bodies |

Increasing a timeout, increasing the pool alone, lowering photo quality or disabling database guards does not resolve this investigation. Aggregate connection capacity must be measured before adding workers. Error/recovery injection is useful acceptance testing, but cannot establish the initiating historical cause.

## What is still needed to close the initiating-cause question

First retrieve the existing managed PostgreSQL logs around **September 11, 15:34–15:43 and 18:30–18:32 UTC**, if still retained. Look for statement duration, lock wait/acquisition, backend PID, application/role, transaction cancellation/disconnection and server/resource events. Correlate with the operation timeline. A slow statement without matching time/backend context is a lead, not proof.

At the initial investigation, the DigitalOcean console reached sign-in in both browsers and no configured `doctl` or task-scoped API credential was found. Mark subsequently signed in; see the [authenticated follow-up](database-console-followup.md) for statistics, current settings and the remaining historical-record limitation. DigitalOcean documents database logs/queries and monitoring in its [PostgreSQL monitoring guide](https://docs.digitalocean.com/products/databases/postgresql/how-to/monitor-databases/). Enabling a new log sink would not reconstruct missing historical logs and was not attempted.

If logs do not isolate the cause, the next evidence step is a bounded instrumented reproduction on representative runtime/network conditions: record pool acquisition, backend PID, each query label and elapsed time, lock waits/blockers, full-row bytes, JavaScript CPU/event-loop delay, and transaction completion/rollback. Preserve useful redacted driver detail. Use a stub provider and disposable test records; do not regrade the historical cards. Introducing production diagnostic code or writes requires its own concrete scoped action, not an assertion that this document has done it.

**Closure criterion:** correlate the failure with an identified operation/wait, demonstrate the corresponding correction under the same conditions, and exercise independent-card/manual recovery. If the original event cannot be reconstructed, state that explicitly; a passing unrelated benchmark must not be substituted for the owner's prerequisite.

## Reproduction artifacts and review

Scripts, projected receipts and reports are retained in `/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/`. The [evidence index](evidence.md) records hashes for the final artifacts. Root independently reviewed the fixture, original profile, runner/ledger/staff source, live-read results and conclusion boundaries. Production grading state, provider calls, grants, migrations, deployments and application source were unchanged.
