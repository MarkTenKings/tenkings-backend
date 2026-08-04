# Speedster SAM Memory V2 Activation Runbook

Status: Production active and fixed-policy corrected since 2026-08-03. `GLOBAL`
is Bank V2 at durable hash
`fc9a3cec4a065c3e18e05650c51d6ec6b2ffacb7bf8d4afbf4e8077713031780`,
with `tau=0.80`, `margin=0.10`, 136 exemplars, and replay cursor sequence
`229`;
the inert backup preserves V1 preimage hash
`6352e0aec6d54c81dc6d00f13f4987a8137cf2bab7a900c3938c1a2c155bce06`.
Do not attempt activation again or run rollback without Mark's separate explicit
approval.

Read-only Production forensics on 2026-08-03 found that authoritative Speedster
history advanced to certificate sequence `229` after the active row's sequence
`228` replay cursor. The completed fixed-policy correction proved that the live
row was the exact canonical sequence-228 prefix after changing only its policy,
then rebuilt through the current authoritative tip under the same lock. It did
not force the earlier sequence-228 target hash or exemplar count.

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

## Activation record (completed; do not rerun)

Repeat the identical request with `operation: "ACTIVATE"`, the returned
`calibrationEvidenceHash`, `dryRunStatus`, and `dryRunEvidenceHash`, and this
exact dynamic phrase:

```text
ACTIVATE SPEEDSTER SAM MEMORY V2 <calibrated-bank-hash> FROM CALIBRATION <calibration-hash> AND DRY RUN <dry-run-hash> REPLACING <current-v1-hash>
```

The transaction reacquires the same lock, recomputes all evidence, verifies the
expected current preimage, creates the fixed inert backup row, swaps only
`GLOBAL`, and verifies version, exemplar count, and tolerant numeric equality on
the first persisted readback. It captures that readback's exact deterministic
`activeRowHash`, binds the backup to it, then rereads both `GLOBAL` and the backup
and requires the exact active hash plus a valid hash-bound backup before commit.
The response returns `activeRowHash` (the durable rollback identity) separately
from `calibratedBankHash` (the pre-write approval/evidence identity). Any mismatch
aborts the transaction.

## Rollback (do not run without approval)

POST `operation: "ROLLBACK"`, the exact expected active row hash, and:

```text
ROLL BACK SPEEDSTER SAM MEMORY V2 <active-bank-hash> TO SAVED PREIMAGE <saved-preimage-hash>
```

Rollback reacquires the same lock, verifies the active row and saved copy,
restores only `GLOBAL`, and verifies its readback. It does not change or delete
sessions, cards, grades, labels, reports, images, history, or the backup row.

## Fixed-policy correction (completed; do not rerun)

The live Cubone repeat proved the data-selected first-activation thresholds were
not decisive. The corrected V2 policy is fixed at `tau=0.80`, `margin=0.10`;
the parser accepts only the safety ranges `tau=[0.70, 0.95]` and
`margin=[0.03, 0.20]`. Untouched automatic accepts may contribute to the
existing bounded gentle nudge but cannot protect a candidate from an explicit
human-removal lesson. Smart-Marks and relabel positives remain full positive
protection.

`operation: "POLICY_DRY_RUN"` is authenticated and zero-write. Supply only the
exact current active-row hash. Under the existing completion advisory lock it:

- rebuilds the bank and evidence from authoritative completed history;
- excludes only the already-approved poisoned Articuno session;
- requires the fixed policy plus PASS for Articuno removal, explicit-positive
  retention, unrelated-control suppression, and final-bank self-conflict proof;
- requires the current active bank to equal the canonical rebuild after changing
  only its policy; and
- returns the exact corrected-bank hash, evidence hash, and typed confirmation.

The completed mutating operation was `operation: "CORRECT_POLICY"`. It carried
the same expected active hash, returned evidence hash, and this dynamic phrase:

```text
CORRECT SPEEDSTER SAM MEMORY V2 POLICY <corrected-bank-hash> FROM EVIDENCE <calibration-evidence-hash> REPLACING <active-bank-hash>
```

The locked transaction writes only `AiGraderV2LearningBank/GLOBAL`, verifies the
durable readback, and verifies the inert V1 backup is byte/hash unchanged. It
does not accept caller-supplied thresholds or bank bytes. Any history, hash,
proof, confirmation, readback, or backup mismatch aborts the transaction.

## Completion behavior after activation

The grade and label commit first under the existing label-slot lock. A second
short, best-effort transaction reacquires that lock and applies every labeled
completion after Bank V2's replay cursor in ascending `certificateSequence`
using the exact Step 3 harvest/increment function. Normally this is one session.
If concurrent completions reorder the second transaction, it catches up the
whole gap without losing a lesson. A learning failure cannot roll back the
durable grade. The completion response reports the label completion order and
the observed V2 cursor/readiness. Every detect request also acquires the same
lock, heals any gap, and reads the post-catch-up `GLOBAL` row before release, so
the newest successful human lesson is available to the next card. If that
advisory catch-up fails, detection logs the failure and uses the current
validated bank rather than blocking grading; a later completion or detect heals
the gap. There is no queue, worker, retry service, or completion gate.

## Explicit Smart-Mark proposal generation

Only completed `SMART_MARK_POSITIVE` exemplars may originate learned proposals.
Detection compares them with the already-computed SAM FPN fingerprint space,
requires similarity `>=0.90`, deduplicates registered canonical regions, and
selects at most the best three matches per defect type per card side before the
existing SAM box prompt. The unchanged material/mask/area gates, negative-memory
veto, fusion, measurement, grading, and review flow remain authoritative.

Learned results carry `MEMORY` origin and exact lesson/session diagnostics and
show the compact `memory` label in the existing review panel. An untouched
accepted memory result is never harvested as a positive. Explicit removal or
relabel retains the ordinary negative or negative-old/positive-new semantics,
but only human Smart Marks are proposal sources. No new model, retraining,
schema, queue, worker, screen, confirmation, or reviewer gate is involved.

## Smart-Mark evidence freshness

The browser supplies the current Speedster session ID with each Smart-Mark
measurement. The authenticated image proxy resolves that admin-owned session's
exact persisted Front or Back inspection key and signs a fresh ten-minute read
URL immediately before calling the existing SAM service. Caller-provided storage
keys are never accepted. If ownership, side, key, lookup, or signing fails, the
existing nonblocking Smart-Mark measurement remains authoritative and learning
records the existing hard-failure branch without changing the grade.
