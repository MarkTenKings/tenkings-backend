# Replay fixtures

`synthetic-manifest.json` is a redacted, deterministic specification. The replay CLI generates every safe image in memory; no card image, device identifier, local path, or camera metadata is committed.

Put an authorized real corpus under `private/` (gitignored) and use a separate manifest conforming to `manifest.schema.json`. A private entry must use a root-relative `privateFile` and exact `permittedSha256`; traversal outside the supplied `--private-fixtures` root and hash mismatches fail closed. Reports contain case IDs and aggregate metrics, never fixture paths.

The committed report is synthetic engineering-regression evidence only. It does not establish production accuracy or Dell timing.
