# ATLAS one-card, ten-card and fifty-card acceptance

Prepared September 23, 2026. **No real-card trial is recorded as complete here.**
Mark's approved label artwork is separate from grading, printing and NFC acceptance.
The release coordinator owns current deployed identities; the previous documented
live baseline was source `79483f13`, staff schema44. Never reuse that baseline as
proof that the new batch candidate is deployed. Do not reuse the September17
record's historical NULL-certification or private-only-publication statements as
current facts.

## Current execution record

| Checkpoint | Result | Evidence needed |
| --- | --- | --- |
| Exact new release / batch activation | NOT RUN in this acceptance record | Coordinator's source, image, staff/public deployment, applied SQL/grants, flags and final qualification receipts |
| Fresh physical cohort and operator access | NOT RUN | Mark's new specimen selection, native Front/Back originals, ordinary staff access and actual current certification at approval |
| First real card through public report | NOT RUN | Native-photo lineage, actual Astra request/result, human review/approval and exact public version |
| First card physical finishing | NOT RUN | Actual printer/media fit, approved-report NFC write/readback/qualified lock/phone scan, separate assembly/welding observations |
| Ten distinct physical cards | NOT RUN | First checkpoint decision, same first specimen plus nine fresh pairs, individual results and measured elapsed times |
| Expansion to fifty | NOT RUN | Ten-card evidence review and explicit recorded owner decision before further admission |

These checkpoint sizes are acceptance sequencing, not product allowances. The
application may queue up to50 cards; actual native/provider capacity determines
overlap. No fixed latency, accuracy percentage or fifty-way concurrency is promised.

## Execute with Mark

1. Coordinator verifies the new software release, enabled batch configuration,
   actual provider access and reviewed migrations/grants. Mark signs in through
   ordinary staff access if needed. Do not seed reviewer certification, reuse a
   fixture identity, fabricate a session or make an approval click on his behalf.
2. Mark selects one standard-size sports or Pokémon specimen, labels it physically
   and supplies new native Camera Front/Back originals. He confirms the same card,
   sides and orientation. Prefer a bordered specimen with visible real wear.
   Unusual shapes/full-bleed rules need their existing separate review.
3. Observe intake, full-resolution working views, early geometry, identification,
   actual Astra preparation and the machine review queue. Mark compares the
   physical card with both displayed sides and checks identity, corners, borders,
   surface defects and proposed grade. Correct actual mistakes; never invent a
   finding to populate a test. Preserve original proposals and every correction.
4. Mark deliberately approves the exact reviewed report through the normal UI.
   Rapid review's **Approve & print next** represents his decision, not an agent
   shortcut. If correction requires the manual workspace, retain both the original
   machine report and the final corrected report. Verify publication and reload
   the exact versioned public URL. An unresolved provider/approval response keeps
   its original identity; inspect/reconcile it instead of dispatching again.
5. The finishing specialist qualifies actual equipment. Save the exact plan and
   separate PRINT, NFC, ASSEMBLY and WELDING observations. CUPS submission or a
   browser dialog is not paper output. A tag write/readback is not qualified lock,
   phone opening, removal, assembly or welding. No diagnostic URL substitutes for
   the exact approved report. Hardware qualification remains its own runbook.
6. Review the first checkpoint, including failures and unresolved work. Record
   Mark's decision before admitting nine more new physical cards. Retain the first
   card and unchanged original/source bindings, giving ten total. Include both
   sports and Pokémon where specimens are available. A second UUID or another
   photo of one physical copy does not count as another specimen.
7. Record actual per-card preparation/approval times and measured review effort.
   Observe independent progress and ordinary interruption recovery when they
   occur. Use existing isolated tests for deliberate outages; do not interrupt
   production or create paid requests to fill a checklist. Mark reviews every
   card individually. Review all ten outcomes before an explicit fifty-card
   expansion decision; retain those ten and admit forty additional specimens.

Use `PASS`, `FAIL`, `BLOCKED` or `NOT_RUN` in human observations. Preserve the
first failure and later retry as separate entries. A partial or failed card is
visible work, never an invented successful specimen. Optical quality, usefulness
of suggestions and practical usability belong in Mark's own words.

Memory delivery remains distinct from detection usefulness. A real reviewed
lesson must be acknowledged before a new relevant request for a different
physical specimen; inspect that request's actual saved lesson IDs/crops/traces.
Empty memory, repeat photos and model citations alone do not establish learning.
Use the detailed lineage fields in the historical
[real-card record](../audits/2026-09-17/real-card-acceptance-record.md), applying the
current publication/batch behavior above. No new paid comparison is required.

## Offline evidence collector

`scripts/atlas/real-card-acceptance.mjs` reads only explicitly supplied local files.
It does not collect from production, authenticate, issue SQL, upload/download,
run providers, change cards, approve, print or access NFC. Retain source evidence
through the existing authorized read-only release/card tools. The collector
checks consistency of that evidence; independent custody review establishes its
origin/completeness. Hashes and a `REAL_CARD` label alone cannot authenticate a
handwritten JSON assertion.

Run from the repository with the qualified Node20 executable:

```sh
/opt/homebrew/opt/node@20/bin/node scripts/atlas/real-card-acceptance.mjs --template
/opt/homebrew/opt/node@20/bin/node scripts/atlas/real-card-acceptance.mjs --check /absolute/private/manifest.json /absolute/private/evidence-root
/opt/homebrew/opt/node@20/bin/node --test scripts/atlas/real-card-acceptance.test.mjs
```

The template deliberately contains no dates, release or specimens. Fill it from
actual observations; use a new manifest/output filename for every snapshot.
The checker emits JSON to stdout and never writes its inputs. If saving output,
use an owner-only private file and avoid overwriting previous results. Exit0 means
the supplied software chain matched,2 means an evidence check failed,3 means the
software chain is incomplete, and1 means invalid invocation/manifest. Exit0 is
never real-card or physical acceptance.

Every reference has `{ "path": "relative/file.json", "sha256": "64 lower-case hex", "byteCount": 123 }`.
Paths stay below the supplied root; symlinks/traversal are refused. Originals are
stream-hashed in place, never copied. Per-file limits are100MiB for originals and
16MiB for JSON; total examined bytes are bounded at2GiB. Choose a common evidence
root when artifacts are already in different retained directories. Do not move
or duplicate grading originals merely for the checker. Keep raw request bytes,
images and private statements outside Git. Output omits paths, names, phone
numbers, note text, image payloads, provider bodies, credentials and public tokens.

Manifest fields: `version: "atlas-real-card-evidence-v1"`, `scope: "REAL_CARD"`
(`FIXTURE` only in isolated qualification), a safe `cohortId`, `target: 1|10|50`,
UTC `startedAt` and `observedThrough`, `release`, `cards`, and optional
`priorOriginalSha256` containing previously used original hashes. The collector
also excludes the four known September22 retained regression originals. Those
files remain useful for native regression checks, never this new cohort.

`release` references a coordinator-authored `atlas-acceptance-release-v1` record:
`scope`, `sourceCommit`, `nativeImageDigest`, `staffDeploymentId`,
`publicDeploymentId`, `observedAt`, `batchEnabled:true`,
`qualificationStatus:"PASS"`, `migrations:[{name,sha256}]`, and `receipts:[ref]`.
Receipts must be actual retained release readbacks, not a copied success summary.
This record is an explicit index over those sources, not a new deployment action.

Each card contains its actual `cardId`, safe physical `specimenId`, and references:

| Field | Exact retained content |
| --- | --- |
| `capture` | `atlas-acceptance-capture-v1`: scope/cardId/specimenId/observerId; true `freshNativeOriginals`, `samePhysicalPair`, `distinctPhysicalSpecimen`; UTC `capturedAt.FRONT/BACK`, `observedAt`; `originalSha256.FRONT/BACK`; nonempty source `receipts` for the genuine human attestation |
| `originals.FRONT/BACK` | Exact native image files, with byte counts and SHA-256; no thumbnails or rendered previews |
| `intake` | `{card,photos:{FRONT:ref,BACK:ref}}`; `card` is the unchanged existing intake read projection, including upload plans/verifications/source refs; `photos` are exact `PHOTO_SOURCE` artifacts, not fields inserted into `upload.source` |
| `job` | Exact selected `atlas_manual_connected.batch_grading` row, retaining text `input`/`evidence`, hashes, source, analysis action, state/stage and timestamps |
| `provider` | `{run,receipts,request:ref,response:ref,result:ref}`; exact `atlas_defect_analysis.run` and relevant receipt rows; reconstructed exact serialized request bytes; exact `DEFECT_RESPONSE` artifact containing retained base64 response; exact `DEFECT_RESULT` artifact. Preserve receipt text. UNKNOWN never becomes READY. |
| `machineReport` | Exact `BATCH_REPORT` artifact, retaining MACHINE_PROPOSAL/null certification, analysis/result/source hashes, original-bound geometry and measurements |
| `human` | `{approval,action,finalReport:ref,decision}`; exact `atlas_manual.approval`, matching immutable `atlas_manual.action`, and exact approved `REPORT` artifact. `decision` uses `atlas-acceptance-human-decision-v1`, scope/actorId/cardId/reportHash/approvalActionId, true `physicalCardInspected`/`bothEvidenceSidesInspected`, UTC `reviewStartedAt`/`observedAt`, and genuine source `receipts`. Do not manufacture human testimony from a fixture/test. |
| `publication` | `{publication,publicResponse,requestedUrl,httpStatus,fetchedAt}`; exact publication row with manifest text/hash; actual returned `{packet,publicHash}`; exact versioned production URL; observed200 and UTC fetch time. Never reserialize stored text before hashing it. |
| `finishing.plan` | Exact existing validated `atlas-manual-finishing-plan-v1`, binding the same approval/public version/hash and report URL |
| `finishing.print/nfc/assembly/welding` | Separate `atlas-acceptance-finishing-observation-v1` records: scope/kind/cardId/approvalActionId/publicHash/planHash/observerId/observedAt/status. PASS requires `physicalObservation:true` and nonempty source `receipts`. These are retained human attestations; the collector does not cryptographically verify a station receipt or prove device effects. |
| `observations` | `atlas-acceptance-observations-v1`, scope/cardId and chronological `entries:[{check,status,observerId,observedAt,note}]`. Preserve failures, uncertainty, corrections and later outcomes; notes stay private. |

The finishing source receipts should include actual CUPS reconciliation and the
human's scale/stock/output check; for NFC, the exact signed host arm, enrolled
station identity, signed write/lock/readback and removal receipts, host committed
acknowledgements, qualification receipt and Mark's phone-scan observation. Reuse
the station verifier and specialist's qualification proof. This reader only
rehashes those supplied records; a self-reported PASS is not a new hardware proof.

For target10/50, supply `previousCheckpoint` referencing `{summary:ref,decision}`.
`summary` is the retained collector output for the same cohort's preceding
target1/10. `decision` contains `kind:"HUMAN_CHECKPOINT_DECISION"`, matching scope,
actual `observerId`, `previousSummarySha256`, `fromTarget`, `toTarget`,
`acceptPreviousCheckpoint:true`, UTC `observedAt`, and source `receipts` of the
explicit human decision. Prior specimens/source/original hashes must remain;
additional cards must be admitted after that decision. The collector checks the
supplied record but never issues the decision or expands a queue. Review the raw
predecessor evidence and any outstanding hardware/optical failures independently.

Output distinguishes `MATCHED` file/binding checks, `FAIL`, `BLOCKED` dependencies
and absent `NOT_RUN` evidence. `softwareEvidenceMatched` describes supplied file
consistency only; it does not erase a failed optical observation or mean hardware
is finished. `realCardAcceptance` always remains `NOT_DETERMINED_BY_COLLECTOR`.
Elapsed intervals include waiting and interruptions; provider usage may be null,
and billing is never inferred. No grade-accuracy, active-work, throughput or
learning-improvement statistic is synthesized.

## Qualification and limits

Local tests use only synthetic files in owned temporary directories. They verify
binding/tampering failures, fixture isolation, missing evidence, preserved failed
observations and bounded file reads. They do not establish real card or device
acceptance. The earlier focused batch inventory passed31 tests with one native
CPU parity test skipped because `ATLAS_MEASUREMENT_PYTHON` was unset; that is
separate evidence, not a waiver of intended-runtime release qualification.
