# AI Grader OCR Offline Evaluation

The checked-in evaluator consumes an external private manifest plus separate ground-truth and result JSON files. It emits aggregate metrics only. The repository contains synthetic/redacted contract fixtures; it contains no real card image, OCR text, provider response, or private corpus record.

Run from `frontend/nextjs-app`:

```text
pnpm ocr:evaluate -- <private-corpus>/manifest.json
```

The manifest and every referenced file must stay within one private corpus directory. The output reports per-field precision, recall, supported coverage, unknown rate, disagreement rate, plus mean and p95 latency. It does not print case IDs, field values, file names, or source data.

## Private corpus coverage

The production-readiness corpus should contain approved normalized front/back pairs and independent human ground truth across:

- sports from multiple leagues and manufacturers;
- TCG cards from multiple games;
- comics;
- foil and reflective finishes;
- dark cards and low-contrast designs;
- small-print backs;
- serial-numbered cards and visually similar non-numbered controls;
- autograph cards and adversarial facsimile/signature controls;
- memorabilia cards and adversarial patch/relic wording controls;
- inserts, base cards, and multiple parallel families.

Ground truth should use canonical Ten Kings catalog values where a catalog record exists. Ambiguous examples should be labeled for `unknown` or `disagreement`, not forced to a guessed value.

## Acceptance gates

Deterministic gates are:

- every evaluated result satisfies the strict field/state contract;
- every supported catalog field is canonical or a recognized alias resolved to the canonical value;
- unsupported catalog proposals are never counted as supported output;
- provider failures remain visible and do not create synthetic results;
- critical false positives for serial numbering, autograph, and memorabilia are reviewed individually;
- manual Confirm Card remains required for every result.

Quality thresholds must be approved against the private real-card baseline before production sign-off. Synthetic unit fixtures validate the evaluator and contracts only; they do not establish or imply production accuracy.
