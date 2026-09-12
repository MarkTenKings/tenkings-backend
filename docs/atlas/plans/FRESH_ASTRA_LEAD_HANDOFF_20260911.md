# ATLAS Speedster — fresh Astra Extra High lead handoff

**Owner request:** Mark explicitly requested a new sidebar-visible lead task using `gpt-6-astra` with `xhigh` reasoning and five fresh subagents using the same model/effort. This is a fresh lead, not a fork of the old conversation and not another child of the old lead. Continue the established investigation and rebuild planning without asking Mark to restate it.

## Start here

Source task: `01a0907d-d45c-74c3-b9ef-45237fdd7fc4`, displayed title **ATLAS fresh lead — clear workspace and…**.

Source checkout: `/Users/markthomas/.codex/worktrees/ecd7/ten-kings-mystery-packs-clean`; branch `codex/atlas-fresh-card-start-20260911`. Completed investigation/plan commit before this handoff: **be1716b735d4f2f11168d9f1f0665aaf50f022df**. This document is included in a subsequent handoff-only commit supplied in the new task prompt. The saved project repository at `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean` shares that Git object store. Read these source files even if the new managed worktree initially starts from project main and lacks them. Establish your own clean source branch in your own worktree before edits; do not move the old task's branch or overwrite another task's work.

Read applicable AGENTS instructions and their required context/runbooks, including the complete owner-approved `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`. Runtime/source evidence controls what is deployed. Then read:

1. [Consolidated Speedster rebuild plan](ATLAS_SPEEDSTER_REBUILD_PLAN.md) — current product/architecture recommendation, full journey, selected engine extraction, dependencies and acceptance sequence.
2. [Architecture audit](../audits/2026-09-11/README.md), [operator dissection](../audits/2026-09-11/operator-dissection.md), [architecture/rules](../audits/2026-09-11/architecture-rules.md), [capture comparison](../audits/2026-09-11/capture-comparison.md), [database inventory](../audits/2026-09-11/database-inventory.md).
3. [Engine inspection](../audits/2026-09-11/engine-review.md) and [current Ten Kings shared-engine consultation](SHARED_CARD_ENGINES_DISCUSSION.md).
4. Chronological diagnostic follow-ups: [fresh matched tests](../audits/2026-09-11/timeout-investigation.md), [authenticated console](../audits/2026-09-11/database-console-followup.md), **[latest provider reply and logging test](../audits/2026-09-11/provider-reply-review.md)**. Earlier sign-in/pending-reply statements are superseded.
5. [Evidence index](../audits/2026-09-11/evidence.md), [manual-first discussion](MANUAL_FIRST_GRADING_DISCUSSION.md), [Mac NFC requirements](../MAC_NFC.md), and relevant latest session-log entries through this handoff.

The plan is ready for handoff, **not a claim that the root cause is solved or every stage decision is approved**. Mark requested stage-by-stage discussion before building and establishing the initiating operator failure before implementing its replacement. His latest handoff request does not silently waive those directions. Continue authorized diagnostics now; present only material remaining product decisions. Do not require new confirmation for already authorized read-only/local diagnostic work.

## Mark's decisions to preserve

- Native iPhone camera originals, uploaded once per side; preserve maximum actual source quality. Front left, Back right, tools come to the photographs. Future direct high-end camera uses the intake adapter. Existing HEIC-to-full-size-PNG browser expansion is a major transfer cost; server HEIC decoding is new work, not implemented.
- Build a clean manual grading workspace around selected engine modules. Extract useful functions into a clean dependency graph; do not peel away the old application layer by layer or import all old orchestration. Manual controls must work without the autonomous operator. Add Astra through the same actions later.
- No artificial card-count, allowance or spend barriers. A failed card must not block another card or manual continuation. Hardware/provider capacity is finite; do not promise ten cards complete as quickly as one without measurements.
- Geometry engines propose physical edges and printed borders for both sides. Human/Astra reviews and adjusts the same coordinates. Preserve snapping and transforms. Physical edge → rectification → printed border remains a real calculation dependency even in one screen. Save meaningful actions, not every mouse movement.
- Preserve established deterministic scoring, measurements and final human authority. Current prepared/inspection image resolution differs from original source resolution; read plan before promising native-resolution model/measurement work.
- Keep SAM as precise-mask baseline while comparing Astra-assisted candidate detection/typing against it. Fixed model weights are distinct from retrieved external lessons. Next relevant call must see deliberately published lessons; don't blindly replay card history or convert every guess into truth.
- Historical Memory lessons/maps are optional imports if helpful and easy. Do not spend time rescuing old test cards or reconstructing all history. This is not permission to delete production records or old banks. An explicit no-Memory mode/calibration transition is necessary.
- Reuse the **current** Ten Kings eight-field Google Vision + Astra identifier and separate variation/SoldComps research engine. Share relevant identity/design/variation lessons and evidence; keep company inventories, ownership, financial data and physical-copy defects separate.
- Resume completed stages through small action records where practical. Uncertain provider work must not trap manual editing or unrelated cards; fence late machine edits. No promise that output survives simultaneous failure of every storage location and process.
- Keep explanations short and understandable to a seventh grader with ADHD. Mark wants fast, concrete progress and truthful measurements, not another claim that a passing local test means the live app works.

## Current failure: facts versus hypotheses

Serving release **I = 89c55d916130d914f6a989197538c8bbd31c9594**; deployment succeeded but real-card acceptance **FAILED**. Later commits are investigation/planning documents, not a serving application repair. Recheck actual runtime if needed; do not redeploy I merely because this is a new task.

Incident card `b56f75a9-0483-433e-801f-d139f7716fe9`, run `ef58fb8f-67d8-4996-b53a-dad72fb53907`: FAILED/control RUNNING/card IN_PROGRESS IDENTITY; three APPLIED attempts, no fourth dispatch. Latest reserve fails with P2028 after10,215ms at September11 18:31:29.522 UTC. Earlier failures span reserve/apply/claim/cleanup and pool acquisition, beginning15:35:46 UTC. The first failure precedes the final12.207MB continuation. Preparation, SAM, Memory and maps had not run.

Confirmed separate stuck-card rules: settled FAILED is excluded from manual takeover; failed first card consumes the one-distinct-card pilot allowance, blocking waiting card `9684574e-bd74-4228-8c82-ad40b78aa7e2`. Do not treat these legacy rules as renewed owner requirements for Speedster.

Confirmed costs: repeated large-row transfer/parsing/validation, broad per-operation privilege scans, global staff/operator advisory locking, image-filled continuation. Operator client pool1/pool wait5s/connect8s; ledger transaction10s and runner operation15s are separate boundaries. The app log discards useful error detail.

Passing matched tests: retained12,207,165-byte continuation, current guards and status readers; reserve634–731ms versus23ms small input. Real short-stub runner3.728s. Managed native read-only full-row reads650–1,094ms versus about6ms compact diagnostic projection. These are samples, not production failure reproduction or endpoint benchmarks.

Authenticated DigitalOcean console: standard primary-only NYC3 managed PostgreSQL17.11,1 shared vCPU/1GB RAM; SQL max_connections25 versus UI22. Untimestamped aggregate advisory-lock maxima10.36/62.96s and private-controls function23.01s. These do not identify the incident time, role, lock key or blocker. First-timeout CPU/load moderate; higher load later. Retained deadlocks0, no established PostgreSQL crash. Provider stats exist despite pg_stat_statements absent from accessible defaultdb; provider _dodb is not CONNECT-accessible.

Console exposes only100 recent lines; no incident viewer or existing forwarding destination found. Mark returned provider AI's claim that older detailed logs are unavailable without prior forwarding. It supplied no trace/human Support confirmation, and some setup advice was incorrect. Do not keep waiting for Mark to sign in or relay that reply; both happened. No support ticket was sent. No new log sink/configuration/restart was performed.

Production slow logging threshold1000ms, unlimited non-error bind values, syslog destination, collector off. Initial fixture lacked slow logging. **Latest bounded comparison has now tested the actual1000ms threshold:** both exact-size/current-guard cases pass, zero qualifying image statements and zero natural slow-log output. Reserve588/628ms unlimited/disabled. Separate forced-threshold-zero READ ONLY SELECT produces24.4MB versus478bytes, client56.8/16.7ms. This shows output amplification and about40ms local cost in one sample; it is NOT the ten-second cause. MacPG17.10/owned stderr differs from managedLinuxPG17.11/syslog and full periodic-heartbeat overlap. Reader scheduling/order/cache were not controlled. Current doadmin/operator/staff/coordinator cannot SET or ALTER SYSTEM the relevant logging parameters; Advanced Edition docs do not establish standard-cluster support.

**Unresolved:** exact initiating SQL/wait/holder or runtime mechanism. Do not call payload, polling, logging, low RAM, an OpenAI request or a database crash the proven historical cause. A representative failure plus corresponding correction is the remaining evidence route. Don't repeat identical passing Mac fixtures, force a sleep/low threshold and call it causality, merely raise timeouts, reduce photo quality or disable guards.

## Five fresh Astra Extra High assignments

Use `gpt-6-astra` / `xhigh` for every agent, as Mark requested. Start fresh with bounded prompts and relevant document pointers. If runtime allows only four simultaneous agents including you, run up to three specialists then the remaining two as slots free. Five specialists means five distinct assignments, not five additional sidebar tasks or a promise of six simultaneous executions. Do not change global concurrency settings to bypass tool limits.

| Specialist | Independent bounded deliverable |
| --- | --- |
| 1. Representative runtime failure | Own the remaining timeout reproduction. Establish an isolated Linux/DB/syslog arrangement, real operation/heartbeat sequence and matched data/guards. Capture pool/query/backend/holder/CPU/commit phases, preserve real deadlines. Get a first bounded useful result before expanding. No old-card replay, paid provider calls or speculative production mutations. |
| 2. Manual workspace and intake | Check the plan's native-original/server-HEIC intake, paired workspace, geometry dependencies and manual-only operation against selected engine contracts. Deliver precise extraction boundaries and acceptance fixtures; identify only material owner decisions. |
| 3. Engine accuracy and learning | Verify deterministic parity, SAM/Astra evaluation design, mask/trace transforms, four-pixel fusion tolerance, Memory calibration/freshness, map alignment and lesson publication. Avoid a new speculative full engine rewrite. |
| 4. Shared Ten Kings engines | Use the already completed consultation; validate current eight-field identifier/research extraction and shared/private boundaries. Coordinate with the Ten Kings task only for a genuinely new unresolved interface detail. No inventory writes or wholesale branch merge. |
| 5. Independent simplicity/recovery review | Challenge the assembled plan for unnecessary locking, repeated media transfer, app card/spend gates, stuck FAILED recovery and extra services. Check missing full-bleed/size/review/finishing decisions and evidence required for real manual/Astra acceptance. Review peers' conclusions independently. |

Lead retains integration, document updates, user communication and scope decisions. Allocate nonoverlapping files; initially specialists should return evidence/recommendations rather than all editing the canonical plan. Review results yourself. Do not delegate the entire task and wait idly.

## Immediate next actions

1. Acknowledge the handoff and verify you have the current source snapshot and external receipts. Report that the plan is updated while the initiating cause remains unresolved. Do not ask Mark for the entire history.
2. Start the five assignments within actual runtime capacity. Continue useful integration work alongside them.
3. Obtain a bounded representative-runtime result or a concrete environment limitation. Local Docker/Colima binaries are installed but Docker Desktop daemon was unavailable and Colima stopped at the last check; neither was started. A Mac emulation-induced timeout is not automatically representative of production. Do not buy cloud resources, restart production, install a log service or change provider grants merely because a pasted AI answer suggested it. Prepare any needed consequential action concretely under existing authorization before considering a new permission request.
4. Maintain the root-cause boundary. If it cannot be closed, say exactly what remains; do not quietly rewrite the owner's prerequisite. Independent manual/extraction planning can advance while this investigation continues. Stage-by-stage product discussion remains before implementation of unsettled behaviors.
5. Keep the consolidated plan canonical; append session evidence for meaningful changes. Present Mark a compact next-step update, not all five agents' transcripts.

## External evidence and adjacent task

Artifacts outside Git are on this same Mac and readable by the new lead:

- `/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/` — original failures/schema/profiles/capture evidence.
- `/Users/markthomas/.codex/atlas-handoffs/atlas-engine-review-20260911/` — engine review and `ten-kings-shared-engine-handoff.md`.
- `/Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/` — fresh investigator scripts/results,56-file manifest; `logging-counterfactual/` has a separate14-file manifest, report, source, settings, test and cleanup; `provider-reply-review/` has verified documentation notes and read-only parameter-privilege receipt. Both manifests were checked and the earlier one unchanged.
- Read-only diagnostic scripts show existing authenticated SSH/SQL access through protected helpers. Use those reviewed seams; never print credential-bearing environment files. Earlier bounded SQL access does not imply blanket permission for production writes.
- Ten Kings task **Complete Ten Kings financial app**, ID `01a08798-7b68-7853-a689-93ab03bb3ec3`. Existing owner authorization covers relevant consultation. Current successful engine source established at app commit `bb10f235d5bddd2ca30ba19e5389e80d43cd2fec`, source checkout `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, HEAD at consultation `5f45b8463204fc001dfae8c4d022681ecb135fe8`. It is actively evolving; avoid assuming a later source silently matches that reviewed version. The older17-field CardAsset OCR path is not the current requested engine.

No production code/settings/data were changed by the final investigation follow-ups. All disposable test clusters were stopped. No pending support request, deployment or paid inference continues in the old lead. The old task should remain available for evidence, while the fresh task owns further work.
