# Replay fixtures

`synthetic-manifest.json` is a redacted, deterministic specification. The replay CLI generates every safe image in memory; no card image, device identifier, local path, or camera metadata is committed.

Put an authorized real corpus under `private/` (gitignored) and use a separate manifest conforming to `manifest.schema.json`. A private entry must use a root-relative `privateFile` and exact `permittedSha256`; traversal outside the supplied `--private-fixtures` root and hash mismatches fail closed. Reports contain case IDs and aggregate metrics, never fixture paths.

`sharp-comparator-manifest.schema.json` is the separate offline contract for running the existing TypeScript/Sharp `cardGeometry` detector against encoded, full-resolution safe/private fixtures. Its files also stay under an explicitly supplied gitignored root. Each row binds the relative file, SHA-256, oriented dimensions, expected decision, and ordered raw-source corner truth. `sharp-comparator-missing-corpus.json` deliberately has no cases and reports the absent real corpus instead of manufacturing accuracy evidence.

The committed report is synthetic engineering-regression evidence only. It does not establish production accuracy or Dell timing.
