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

- the exact current V1 row hash from the locked Articuno audit;
- the exact canonical calibrated Bank V2 payload and its deterministic hash;
- target exclusion `cmscem6960006accgpc69tgwp`.

Under the completion advisory lock, the endpoint reruns the authoritative
Articuno audit from current completed sessions, labels, and `GLOBAL`. It requires
the current V1 audit to pass, exactly one frozen target exclusion, status
`SAFE_TO_REQUEST_APPROVAL`, and the excluded rebuild hash to equal the proposed
Bank V2 hash. It returns the canonical evidence hash and exact activation phrase.

## Activation (do not run without approval)

Repeat the identical request with `operation: "ACTIVATE"`, the returned
`dryRunStatus` and `dryRunEvidenceHash`, and this exact dynamic phrase:

```text
ACTIVATE SPEEDSTER SAM MEMORY V2 <calibrated-bank-hash> FROM DRY RUN <evidence-hash> EXCLUDING cmscem6960006accgpc69tgwp
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
