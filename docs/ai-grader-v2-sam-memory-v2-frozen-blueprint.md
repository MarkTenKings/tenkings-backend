# Speedster SAM Memory V2 — Frozen Build Blueprint

Status: approved by Mark, Fable 5, and Codex. Design is frozen. Mark
Production-validated the 2 mm inspection frame on 2026-08-02; implementation is
now proceeding in the build order below.

This is the final combined specification. It supersedes the original Fable 5
attachment wherever they differ.

## Goal and live definition of done

Human corrections must visibly affect the next card without changing
deterministic grading:

1. Grade a card.
2. Remove its printed-text false positives.
3. Finalize it.
4. Grade the same card again.
5. The removed text findings must not reappear.

## Foundation rules

- SAM 3 remains the sole segmentation model.
- OpenCV remains the deterministic proposal and card-geometry technology.
- Learning only decides whether an already-proposed SAM mask survives to
  measurement. Geometry, masks that survive, measurements, zones, multipliers,
  score effects, subgrades, final grade, label, and report math stay unchanged.
- No SAM training/fine-tuning, vector DB, OCR, text exclusion, second model,
  fallback detector, new service, queue, retry worker, review screen, human step,
  or confirmation gate.
- A learning/fingerprint failure never blocks the reviewer or completed grade.
- The separate 2 mm inspection frame ships first so all future fingerprints use
  the stable evidence geometry.

## Why V1 cannot work

Observed raw SAM confidence was approximately `0.61–0.96`, the survival
threshold was `0.50`, and learning was capped at `+/-0.06`. That can suppress
only the narrow `0.50–0.56` band, not a `0.90+` text false positive. Increasing
the linear constant enough to remove a `0.95` false positive would also let
mediocre similarity move unrelated candidates across the threshold.

Signal priority is inverted today: Smart-Marks have no fingerprints and teach
nothing, while untouched automatic accepts can flood the bank (43 lessons from
one Articuno finalize). Centroid averaging also dilutes the precise pattern that
must affect the next similar card.

## One truth, one fast path

Completed-session history is the source of truth. The single PostgreSQL JSON
bank row is a derived cache.

```text
deriveBank(chronologicalHistory, excludedSessionIds) -> BankV2
```

The pure derivation owns harvesting, validation, stable-order deduplication,
admission caps, and capacity pruning.

- Ordinary completion incrementally applies one new session to the cache using
  those exact same functions.
- Migration, audit, correction, exclusion, recovery, and any future session
  removal use a full chronological rebuild.
- A required equivalence test proves sequential incremental application equals
  the full rebuild. The fast path is not a second algorithm.
- Bank writes use a transaction and PostgreSQL advisory lock so concurrent
  completions cannot lose lessons.

Speedster sessions do not carry a durable completion timestamp. The unique,
autoincrementing Human Grade label `certificateSequence`, created in the same
completion transaction, is therefore the authoritative chronological order for
history replay. Label `createdAt` and session ID are diagnostic/tie-break fields,
not competing ordering authorities.

## Bank V2 format

Replace centroids with individually matchable, bounded exemplars in the same
JSON row. Each exemplar contains:

- defect type and positive/negative polarity;
- completed session ID;
- existing 32-float pooled SAM FPN fingerprint, L2-normalized at write;
- explicit feedback provenance;
- source detector view, preferring `ORIGINAL`;
- stable chronological/proposal order.

The row also carries its schema/fingerprint version plus calibrated `tau` and
`margin`. Incompatible feature versions are rejected or explicitly rebuilt,
never silently compared.

TypeScript owns write validation. Python performs only a small read sanity
check. Invalid fingerprints are diagnosed and skipped without blocking work.

Capacity is **50 per `(defect type, polarity)`**. The oldest eligible exemplars
are pruned deterministically. Serialized-size and request-latency budget tests
prevent unnoticed growth. Capacity 200 is rejected for V2 and can be revisited
only with evidence, followed by rebuild and recalibration.

## Exact harvesting rules

Explicit feedback provenance must be saved before completion collapses UI state
into generic acceptance.

- **Remove:** one negative exemplar for the originally detected type.
- **Relabel:** one negative for the original detected type and one positive for
  the final human type, using the same fingerprint.
- **Smart-Mark:** one positive for the final human type when a fingerprint is
  available.
- **Relabeled Smart-Mark:** Smart-Mark provenance is evaluated before generic
  review state. It stays positive teaching for the final human type; no negative
  is invented for a type SAM never proposed.

Explicit remove/relabel/Smart-Mark lessons are uncapped at admission (the final
50-example bank capacity still applies). Human action teaches fully.

Untouched auto-accept is weak evidence:

- admit at most **3 per final defect type per card**;
- choose stable first-proposed order, never top confidence;
- skip near-duplicates already admitted for that type/polarity from the same
  card with one deterministic similarity check.

Inaction teaches a little and cannot flood the bank.

## Smart-Mark hybrid path

Smart-Marks join the same SAM feature space during the existing save request:

1. The human rectangle and selected type remain grading authority.
2. Prompt the same SAM on the same evidence view, preferring `ORIGINAL`.
3. Permit at most one ordinary retry inside that request—never a queue.
4. Accept a trace for visual evidence/fingerprint support only if at least 80%
   of mask pixels are inside the box and mask area is 10–100% of box area.
5. If the trace is invalid, pool the existing SAM feature map over the human
   box. Human geometry stays authoritative.
6. If SAM/fingerprinting still hard-fails, save the Smart-Mark without a
   fingerprint and continue.

The review overlay shown for a Smart-Mark is the human rectangle clipped and
rasterized to physical card material for deterministic measurement; it is not a
SAM trace and is not the shape stored in memory. Edge/corner exemplars store the
normalized SAM feature fingerprint only. Trace support and box-pooling fallback
are restricted to on-card material, so exterior inspection-frame pixels cannot
become defect teaching. Required edge/corner tests must prove valid trace
handling and invalid-trace fallback to the human-box feature pool without
changing the human rectangle, measurement, defect type, grade, or completion.

In veto-only V2 a Smart-Mark immediately:

- creates a positive exemplar;
- protects similar real damage against a wrongful negative veto;
- contributes to the gentle nudge;
- records evidence about whether OpenCV proposed the human-marked region.

It does **not** create a missed detection where OpenCV supplied no proposal.

## Veto-only decision rule

V2 does not lower SAM's pinned internal `0.50` processor threshold, add a
collection floor, or attempt positive promotion. Masks discarded inside SAM
stay discarded.

For each returned candidate, compare only exemplars of its proposed defect type:

```text
positiveMax = maximum cosine similarity to positive exemplars
negativeMax = maximum cosine similarity to negative exemplars

veto when:
  negativeMax >= tau
  and negativeMax - positiveMax >= margin
```

Otherwise retain the existing bounded `+/-0.06` gentle nudge. Positive evidence
can protect and gently support an already-returned mask but cannot resurrect a
discarded mask. Raw SAM confidence is persisted separately and never overwritten.

Maximum exemplar similarity replaces centroid similarity so one precise removal
remains matchable on the next card. The margin is the damage-on-text protection:
comparable positive damage evidence blocks a negative printed-pattern veto.
This must be proven by control/replay evidence, not merely assumed.

## Diagnostics

Emit one compact structured record per decision with session/request trace,
proposed type, source view, raw confidence, positive/negative maxima and matched
exemplar sessions, active `tau`/`margin`, gentle adjustment, final action
(`retained`, `protected`, or `vetoed`), and fingerprint/bank version.

At Smart-Mark save, record whether an OpenCV proposal overlapped the human box
at IoU greater than `0.3`. Completion is too late. If data later proves OpenCV
often never proposes where humans mark, learned proposals may return to design.

## Read-only calibration

Calibration recommends values; it never writes Production.

- Model the real maximum-over-a-50-example-bank decision, not isolated pairwise
  similarity.
- Use chronological leave-one-session-out replay; each simulated bank contains
  only earlier eligible lessons.
- Use explicit human actions as trusted evaluation labels.
- Never treat the poisoned Articuno lazy-finalize accepts as ground truth.
- Preserve view/version compatibility and prefer `ORIGINAL` comparisons.
- Report distributions, counts, false-veto candidates, adjacent-value
  sensitivity, serialized size, and request latency.
- Mark approves `tau` and `margin` before anything writes them.

Required evidence:

- Articuno-class removed text is vetoed once its lessons exist.
- Zero historically human-retained true findings are vetoed.
- An unrelated control card has no material suppression increase.
- Real damage crossing text survives when positive protection is comparable.
- Size and latency budgets pass.

Recalibrate after any SAM/model/processor repin or fingerprint-space change.

## Articuno correction and migration

Exclude incorrect session `cmscem6960006accgpc69tgwp`. Do not use arithmetic
subtraction.

1. Acquire the completion advisory lock.
2. Read authoritative history and the live Production bank.
3. Reconstruct the historical bank required to audit Production.
4. Compare using an explicit numeric tolerance for float serialization. Any
   unexplained mismatch aborts and is reported.
5. Derive V2 once with no exclusions, then again excluding only that session.
6. Print exact counts/deltas by type and polarity, affected sessions, serialized
   size, and proposed parameters.
7. Stop in dry-run mode for Mark's explicit typed approval.
8. Save a recoverable copy of the current Production row.
9. Transactionally swap only the derived cache row.
10. Read back and verify version, counts, and hash/tolerant numeric equality
    before releasing the lock.

No card, grade, label, report, image, or session history is removed or changed.
Rollback restores the backed-up bank row.

## Required tests

Bank/history:

- incompatible V1/version input cannot be silently treated as V2;
- schema, normalized finite fingerprints, provenance, view, and session tags;
- exact 50 capacity and deterministic chronological pruning;
- incremental result equals full chronological rebuild;
- exclusion rebuild removes all and only a session's influence, including
  examples obscured by prior pruning;
- concurrent completion loses no lessons;
- size and latency budgets.

Harvest/Smart-Mark:

- exact remove, relabel, Smart-Mark, and relabeled-Smart-Mark lessons;
- synthetic 43-find lazy finalize admits at most 3 untouched per type;
- deterministic stable-order and same-card dedup;
- valid trace, invalid-trace box pooling, one retry, and hard-failure branches;
- human geometry, measurement, type, grade, and completion remain identical in
  every fingerprint branch;
- overlap instrumentation is saved at Smart-Mark time.

Detection/safety:

- strong negative veto defeats even high raw confidence;
- comparable positive evidence blocks the veto;
- weak evidence stays within `+/-0.06`;
- no promotion resurrects a discarded mask;
- type/view/version boundaries are enforced;
- damage crossing text survives;
- deterministic measurement and grade math remain unchanged for the same masks.

Acceptance:

- chronological replay passes all calibration conditions;
- reconstruct-versus-Production audit passes before mutation;
- the same-card live proof at the top passes.

## Build order

1. Production-validate the isolated 2 mm inspection frame. **Completed
   2026-08-02.** Mark confirmed four-sided context, aligned overlays, full-edge
   Smart-Marks, expanded PhotoRoom/report canvas, and normal completion.
2. Add read-only history inventory and pure V2 bank types/functions. **Built
   locally; Production release pending.** This release also changes only the
   review magnifier presentation from a circle to a square; its size, zoom,
   pointer math, and boundary clamping remain unchanged.
3. Add provenance harvest plus incremental/rebuild equivalence tests.
4. Add Smart-Mark fingerprinting and failure tests.
5. Add Python veto-only decision and diagnostics.
6. Run read-only calibration/replay and review evidence with Mark.
7. Run locked Articuno/V2 dry-run and present exact impact.
8. Only after Mark's typed approval, swap the cache transactionally.
9. Deploy through protected PR checks.
10. Run live same-card proof and monitor diagnostics.

## Explicitly deferred or rejected

Positive promotion, lower SAM collection threshold, learned proposals/feature-map
scanning, OCR/text masks, vector DB, 200 capacity, centroid-plus-exemplar dual
memory, larger linear adjustment, split view/card-profile banks, SAM retraining,
second/fallback models, retry queue, background repair, and new reviewer gates.

The frozen one-sentence contract is:

> Explicit human corrections become bounded, individually matchable SAM feature
> examples. A close negative example may veto a proposed mask only when no
> comparable positive example protects it. Ordinary completion updates the cache
> immediately, while deterministic history rebuild remains the authority for
> audit, migration, removal, and recovery.
