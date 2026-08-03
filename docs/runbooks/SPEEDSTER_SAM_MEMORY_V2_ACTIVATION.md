# Speedster SAM Memory V2 Activation Runbook

Status: implementation only. Do not activate, roll back, deploy, migrate, or
mutate Production without Mark's separate explicit approval.

## One active cache

`AiGraderV2LearningBank/GLOBAL` is the only row read by detection and completion.
The fixed `GLOBAL_PRE_V2_ACTIVATION_BACKUP` row is an inert recovery copy; no
runtime detector or learning path reads it.

## Dry run (zero writes)

Authenticated admins POST to
`/api/admin/ai-grader-v2/learning-bank-activation`. Omitting `operation`, or
setting it to `DRY_RUN`, performs zero writes. Supply:

- the exact current V1 row hash from the locked Articuno audit.

Under the completion advisory lock, the endpoint reruns the authoritative
calibration replay and Articuno audit from current completed sessions, labels,
and `GLOBAL`. It requires the current V1 audit to pass, an exact data-derived
calibration recommendation, nonzero positive and negative evidence, a genuinely
unrelated retained control, and both positive and negative final exemplars. It
then derives the canonical Bank V2 internally; callers cannot supply thresholds,
bank bytes, a bank hash, or an exclusion identity. The poisoned Articuno session
`cmscem6960006accgpc69tgwp` is fingerprint-incompatible and therefore contributes
zero V2 exemplars; that ineligibility is verified explicitly. The dry run returns
the calibration hash, Articuno dry-run hash, derived bank hash, and exact
activation phrase.

## Activation (do not run without approval)

Repeat the identical request with `operation: "ACTIVATE"`, the returned
`calibrationEvidenceHash`, `dryRunStatus`, and `dryRunEvidenceHash`, and this
exact dynamic phrase:

```text
ACTIVATE SPEEDSTER SAM MEMORY V2 <calibrated-bank-hash> FROM CALIBRATION <calibration-hash> AND DRY RUN <dry-run-hash> REPLACING <current-v1-hash>
```

The transaction reacquires the same lock, recomputes all evidence, verifies the
expected current preimage, creates the fixed inert backup row, swaps only
`GLOBAL`, and verifies version, exemplar count, exact deterministic hash, and
tolerant numeric equality before commit. Any mismatch aborts the transaction.

## Rollback (do not run without approval)

POST `operation: "ROLLBACK"`, the exact expected active row hash, and:

```text
ROLL BACK SPEEDSTER SAM MEMORY V2 <active-bank-hash> TO SAVED PREIMAGE <saved-preimage-hash>
```

Rollback reacquires the same lock, verifies the active row and saved copy,
restores only `GLOBAL`, and verifies its readback. It does not change or delete
sessions, cards, grades, labels, reports, images, history, or the backup row.

## Completion behavior after activation

The grade and label commit first under the existing label-slot lock. A second
short, best-effort transaction reacquires that lock and applies every labeled
completion after Bank V2's replay cursor in ascending `certificateSequence`
using the exact Step 3 harvest/increment function. Normally this is one session.
If concurrent completions reorder the second transaction, it catches up the
whole gap without losing a lesson. A learning failure cannot roll back the
durable grade; the next completion or explicit reuse of the same catch-up helper
heals the gap. There is no queue, worker, retry service, or second algorithm.

## Smart-Mark evidence freshness

The browser supplies the current Speedster session ID with each Smart-Mark
measurement. The authenticated image proxy resolves that admin-owned session's
exact persisted Front or Back inspection key and signs a fresh ten-minute read
URL immediately before calling the existing SAM service. Caller-provided storage
keys are never accepted. If ownership, side, key, lookup, or signing fails, the
existing nonblocking Smart-Mark measurement remains authoritative and learning
records the existing hard-failure branch without changing the grade.
