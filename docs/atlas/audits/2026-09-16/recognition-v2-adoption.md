# Recognition V2 adoption

September 16, 2026. Local ATLAS implementation on base
`f16bbb7e49ebf46c09e32d30a9a441a947e75df3`; no provider call, production write,
migration or deployment. Three `gpt-6-astra` / `xhigh` specialists cover adapter
tests, independent review and the actual manual-page clear/recovery regression.

## Received source

Inventory delivered commit `b89cb020bde7e538142b26e69198fb992c526f36`, based on
`60572cec895ad63d4ab826cd366f6475b04e725a`. Only the exact reviewed
`packages/card-identification-core` tree and its recognition handoff document
were copied. No catalog implementation, Inventory adapter or release lineage
was merged.

The handoff manifest SHA256 is
`aefea0aa160b37bf645219b31ce21fd17b99201ee0c6db98c504bc4fd9973f58`;
the 19-file result ledger is
`d067ee4b62a3fd1b4c84f79eeda4082b3c1089bd5372be67f87303995a2e8ee4`.
All ten receiver baseline hashes and all committed delivery bytes were checked.
The eight V1 implementation/type/fixture/generator/source-manifest members remain
unchanged. The delivered manifest/document's pending-commit wording describes
the package-freeze checkpoint; this verified delivery commit supersedes that
status without rewriting the frozen evidence.

## ATLAS changes

New identification rows retain `{engineVersion:'card-identification-v2',input}`
in the existing immutable input text before any effect dispatch. Historical bare
inputs remain strictly V1. Result parsing follows the saved attempt version,
including restored completed results; an unknown/mismatched version fails.
Existing attempts never trigger paid reprocessing. The current SQL guard already
freezes input, so no schema, migration, shared catalog or grant change is needed.

The OCR transport posts only the V2 envelope body and sends its exact response
field mask as Google's query parameter. It preserves key headers, redirect refusal,
bounded streaming, aborts and raw status/usage receipts. Immutable external request
artifacts now explicitly retain `requestJson` and its verified hash, rather than
requiring reconstruction from an object. Historical artifact bytes stay intact.
Abort checks precede artifact creation and dispatch admission; a committed dispatch
claim retains conservative uncertainty and cannot authorize a second request.

The package itself derives the Pokémon PNG from the verified Front interpretation
JPEG, preserving parent/region/output hashes. The ATLAS original/working-frame/JPEG
chain and grading images are unchanged. Human field edits and explicit clears stay
authoritative; Pokémon publisher remains descriptive and is excluded from the
Pokémon grading identity's manufacturer field.

The existing lockfile importer already resolves the same workspace link and exact
Sharp 0.33.5/Zod 4.1.11 versions. No dependency upgrade or lockfile edit is required.

## Qualification and limits

The final combined Node20.20.1 suite passes **79/79**, with no failures or skips:
26 shared-package cases, 19 adapter cases, 13 manual-page/workspace cases, and 21
connected-construction/transport/frontend-boundary cases. The adapter uses actual
identification/details/artifact stores and native Sharp over synthetic SQL,
authorization, storage transport and provider responses. It covers old V1 recovery,
strict V2 selection, exact receipts/crop lineage, concurrent starts, retakes, edits,
clears, bounded responses and provider failures. Mock timers exercise the real
25-second core model deadline: late artifact completion cannot dispatch; a late
already-dispatched reply retains exact usage/bytes while staying UNKNOWN with no
adoption or retry. The three actual compiled-page clear/refresh regressions failed
before the UI fix and pass afterward.

Package manifest verification, strict NodeNext consumer types and independent
Astra source/test review pass. The final review has no outstanding findings.
The real container-context packager collected **554** files; each copied byte/hash
matches current source and includes both V2 modules, the adapter and manual page.
Its manifest is `de90e0cf4ec7ab54acf129cfddcac53e9e3ab56ceb67e3e6702b624c3acf95e7`.
This proves source inclusion, not a built Linux image, deployed Sharp runtime or
staff release. No dependency installation was needed; owned temporary dependency
links are removed after validation, preserving their original targets.

Logs, source-context verification and final source receipt are retained in the
private `release-readiness/recognition-v2-20260916` evidence directory. No real
provider quality, phone latency or real-card improvement is established here.

This is local recognition adoption, not the shared catalog/research adapter or a
live accuracy claim. The Inventory lead owns the shared publication schema and
narrow service facade; ATLAS will not create a duplicate migration or use human
SetOps admin cookies as service authorization. The catalog/research contract and
first real grading acceptance remain prerequisites to cross-app activation.

Release still requires storage integrity/conditional-write/private-read resolution,
a fresh exact-source Linux/staff artifact, coordinated deployment and real-card
acceptance. The prior manual-only image and native tests did not exercise this V2
adapter. Do not claim that their receipts qualify the changed provider path.
