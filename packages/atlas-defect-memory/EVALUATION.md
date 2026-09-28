# Learning lifecycle and independent evaluation

This package separates human feedback saved, examples prepared, and examples active in an immutable serving release. It does not train model weights. Test fixtures prove software behavior and must never be submitted as optical benchmark truth.

## Safe rollout and recovery

1. Apply the additive `20260928120000_learning_publication_outbox` migration through the approved release process. It copies legacy publications into the separate append-only `learning_publication` table and freezes exactly the currently eligible set as `baseline-20260928`, without altering old publications. New candidates are written only to the new table, so an older binary cannot accidentally retrieve them. The migration manifest records publication hashes; this is a reproducibility baseline, not independent quality approval.
2. Apply `learningGrantSQL` to the existing narrow manual-serving role, alongside its existing memory and machine grants. No serving process receives activation, release-writing, withdrawal, staff-table-reading or deletion privileges.
3. Enable `ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED=true` only after migrations, grants and owned database checks pass. `ATLAS_MANUAL_DEFECT_MEMORY_ENABLED` and machine authority are prerequisites. The durable worker starts and stops with the private runtime. Confirmation returns after saving the human action; it does not wait for image preparation. A repeated UI publication request merely wakes the worker.
4. Monitor `learning_publication_job` states and `code`, attempts, failures, created/updated timestamps. Expired claims are recovered automatically. Transient storage failures retry with bounded backoff. Explicit reviewer access-version changes hold unfinished work; an expired browser does not. Reconfirm with authorized human review to create a new authority snapshot rather than changing the old job's identity. Historical pending reviews that predate captured authority are held for explicit reconfirmation.
5. New prepared publications do not automatically join the active release. A newer confirmation excludes its superseded source examples while other eligible examples remain available. Request evidence records the active release, selection policy and unavailable-source count. Actual workspace deletion (`discarded_card`) and explicit lesson withdrawal exclude examples; there is currently no separate archive operation that preserves deleted-source eligibility.

The baseline still uses the existing family/exact-negative policy. The optional `balanced-defect-v1` candidate caps twelve examples, two per source, four per disposition and 96 candidate records, with stable ranking and retained inclusion/exclusion reasons. It can become active only through a reviewed evaluated release. Clean and geometry consumers are implemented behind separate validated scopes; the baseline has neither scope. A CLEAN scope can supply up to four inspected source-bound PNG references to the actual ASTRA request, within the combined twelve-lesson and 32 MiB budget. Current-card and defect evidence takes priority; optional invalid/unavailable/oversized clean references are omitted with retained reasons, without resizing any evidence. No learning consumer writes deterministic scores.

## Reference reviewers

Choose at least two independently adjudicating qualified reviewers, record their identities, and exclude the card's original reviewer from that pair. If staffing cannot establish this independence, capture labels with their honest status and leave activation blocked. Show reviewers the unmarked, correctly framed source images before predictions and historic decisions. Use physical inspection when the photo cannot resolve damage, foil/reflection, an edge, or a border. Mark insufficient evidence instead of guessing. Resolve disagreements before sealing truth.

For each specimen record a stable physical `specimenId` (including all retakes), card/design `familyId`, card/source/upload IDs, both original hashes, preparation/frame/transforms and source-binding hash, capture format/background/lighting and acquisition time. Do not assume different files are different specimens. Record per-side full inspection, clean status, each visible defect's exact canonical RLE trace and taxonomy, independently judged severity, physical and printed geometry or an explicit absent/uncertain border, and reasons/disagreements. Capture deterministic grade/reference measurement only when independently supported by the fixed scoring policy.

Separate `TRAIN`, `VALIDATION`, `SPECIMEN_HOLDOUT`, `DESIGN_HOLDOUT`, and `PROSPECTIVE`. Specimens and original hashes cannot cross partitions. Design-holdout families cannot occur in another partition. Declare every retrieved lesson's specimen, original hash and family in the training inventory. All snapshots, truth and raw outputs remain private. Never provide truth labels to the model or use the held-out set to tune thresholds repeatedly.

The corpus must cover clean cards, small defects, rare severe damage, printed borders, legitimate borderless/uncertain cases, all supported background combinations and formats, supported iPhone variants, foil and glare. Accepted historical outcomes are useful tagged baseline records; they are not independent truth. The private September 28 review pack lists retained source IDs with all new truth labels left blank.

## Offline tools

Use Node 20. Every command takes an input JSON path and a new output JSON path, refuses to overwrite files, and writes mode 0600. Commands import no provider, deployment or database client and never issue a paid request.

```sh
node packages/atlas-defect-memory/scripts/evaluate.mjs baseline runtime-evidence.json baseline-facts.json
node packages/atlas-defect-memory/scripts/evaluate.mjs shadow comparison-input.json shadow-plan.json
node packages/atlas-defect-memory/scripts/evaluate.mjs compare comparison-input.json comparison-report.json
node packages/atlas-defect-memory/scripts/evaluate.mjs release-plan release-input.json activation-plan.json
node packages/atlas-defect-memory/scripts/evaluate.mjs rollback-plan rollback-input.json rollback-plan.json
node packages/atlas-defect-memory/scripts/evaluate.mjs compare-clean clean-input.json clean-report.json
node packages/atlas-defect-memory/scripts/evaluate.mjs compare-geometry geometry-input.json geometry-report.json
node packages/atlas-defect-memory/scripts/evaluate.mjs policy policy-input.json validated-policy.json
node packages/atlas-defect-memory/scripts/evaluate.mjs promote-plan promotion-input.json promotion-plan.json
```

`baseline` records local commit/source hashes and exact model alias, effort, prompt/schema hashes, request/crop policy and limits. Supply independently captured deployed runtime and active-release evidence in its input; local facts alone do not establish production configuration. The provider alias may change; retain actual response model and request hashes on every evaluation.

`shadow` validates corpus partition/label structure but exports only case ID, arm, source hashes and idempotency key. It never exports truth and does not dispatch. The authorized coordinator must collect paired baseline/candidate requests using the existing immutable receipt executor, fixed instructions, same images, model, geometry and scoring policy, with an explicit budget. Do not retry ambiguous paid submissions automatically. Include errors, refusals and all preregistered cases rather than dropping hard cases.

`compare` consumes `protocol`, `corpus`, `runs`, and `artifacts:[{path,sha256}]`. Canonical JSON hashes seal protocol, truth and normalized results; request/response hashes refer to exact retained bytes. Private files are verified before gating. See `test/evaluation.test.mjs` for a **synthetic schema example only**. Missing expert truth is an error, not an empty benchmark. Missing raw artifacts or insufficient prospective/rare/clean coverage block release. Actual authority and expert honesty cannot be verified by a checksum and require the independent audit.

Preregister `iouThreshold`, minimum cases/severe/clean/prospective/per-stratum/grade coverage, distinct physical-specimen minimums (`minimumSpecimens`, `minimumSevereSpecimens`, `minimumCleanSpecimens`, `minimumProspectiveSpecimens`, `minimumPerStratumSpecimens`), required strata, F1/severe-recall/clean-false-positive changes, per-stratum non-regression, downstream deterministic grade calibration, error rate, latency and cost tolerances, maximum paired-run time gap, baseline-release hash, candidate-publication corpus hash, and fixed model/prompt-policy hash before collecting results. Retakes cannot satisfy the distinct-specimen minimums. The publication corpus hash is over canonical revision/hash pairs sorted by revision. Thresholds are owner-approved baseline-dependent values, not invented universal accuracy targets. Paired arm order is reproducibly shuffled to limit order bias.

The comparison retains precision/recall/F1, matched-mask overlap and type accuracy, severe recall, clean false positives, error/refusal/insufficient-evidence counts, supported grade error, per-stratum metrics, p95 latency and actual cost. Mask matching uses a fixed greedy overlap policy. Wilson intervals and deterministic paired specimen bootstrap intervals make uncertainty visible; they are not a promise of future improvement. A passing report is only `ELIGIBLE_FOR_OWNER_REVIEW`.

`release-plan` accepts only DEFECT evaluation reports, retains runtime model/prompt/image/scoring bindings and selection-policy hashes, and creates defect-only membership. A runtime binding change produces explicit baseline fallback. It additionally requires the exact evaluated publication set and `ownerApproval` containing report hash, approver/time and independent-truth-audit hash. It produces reviewable SQL only. A privileged, approved release executes it separately; serving never self-activates. Membership hashes, immutable manifests and compare-and-swap control guard against changed state. `rollback-plan` points control back to an existing immutable release, requires a reason, and records activation history. Rollback does not erase feedback, publications or evidence. Unproven candidates stay inactive.

Prefer a release-pointer rollback for learning regressions. A full rollback to a pre-lifecycle binary is emergency recovery with new learning preparation and activation stopped. It cannot see the separate candidate table; it may safely refuse old family requests while newer confirmations appear unpublished to that binary. Its explicit publication behavior remains unchanged, and confirmations still atomically enqueue jobs. Before roll-forward, inventory legacy publications created during rollback and reconcile each missing/divergent record without automatically activating it. Never copy new candidate documents into the legacy table. The new runtime refuses a legacy-mode flag against an installed lifecycle schema.

The release operator can inventory rollback additions read-only:

```sql
SELECT p.card_id,p.action_id,p.revision AS legacy_revision,p.document_hash AS legacy_hash,
       n.revision AS learning_revision,n.document_hash AS learning_hash
FROM atlas_manual.defect_memory_publication p
LEFT JOIN atlas_manual.learning_publication n ON n.card_id=p.card_id AND n.action_id=p.action_id
WHERE n.document_hash IS DISTINCT FROM p.document_hash
ORDER BY p.revision;
```

These are reconciliation candidates, not automatically approved release members. Original confirmation jobs retain their captured authority; historical label validity and current reviewer access remain separate.

## Domain qualification and bounded promotion

The identity registry records independently audited normalized family/design identities, physical specimen IDs, both original hashes, and all retakes. Unknown target/source identities fall back; specimen/original overlap excludes self-memory. Names alone never establish specimen identity. Reviewer quality is independently audited per domain using correct/total counts, a Wilson lower bound, a minimum sample requirement and an expiry. A paused/revoked reviewer cannot authorize unfinished preparation; historical finalized label quality is separately audited rather than rewritten with current access status.

A release scope contains a hash-sealed registry, reviewer-quality snapshot and validated policy. The serving reader validates exact current model/prompt, image and scoring bindings, policy validity, quality age, side, family and exact-design restrictions for negative examples. Bad individual feedback is excluded with evidence; authentication failures still fail closed. The implementation bounds the registry at 10,000 cards, each matching source query at 512 IDs, feedback at 256 publications, and final examples at twelve with a physical-specimen quota. This is a bounded initial registry, not a claim of million-card capacity; larger deployments need partitioned/indexed registries and fresh load qualification.

The native geometry path actually invokes the GEOMETRY consumer after computing supported proposals. It compares physical edge proportions within the working-photo frame and printed border insets within their own rectified-card frame. It ranks existing native proposals and records a source-bound advisory; it does not generate a new outline, automatically replace native geometry, or improve deployed auto geometry by itself. Native engine plus consumer implementation fingerprints bind qualification. The editor displays advice only while release, policy, current source hashes, eligible selection, working frame and actual displayed outlines still match. Expired policies, withdrawn source lessons, release changes, a new photo or edits hide stale advice. The reviewer still inspects and confirms geometry.

`compare-clean` applies the complete defect benchmark, including severe recall and grade calibration, so fewer false positives cannot hide missed damage. `compare-geometry` independently checks normalized physical corner/edge error, printed corner/edge error where printed truth exists, borderless false positives, unsupported centering, abstention, capture insufficiency, error, latency and cost. Borderless strata do not require invented printed coordinates; global printed coverage and distinct borderless/prospective/per-stratum physical-specimen minimums remain required. Geometry point estimates are not an uncertainty guarantee; the approved protocol and independent audit must judge remaining uncertainty.

`policy` requires a passing hash-sealed domain report whose exact settings, bindings, registry and quality hashes match, plus owner approval and an independent-truth-audit hash. `promote-plan` automates bounded admission under that existing approved policy: allowed families/labels, fresh passing monitoring, independent publication audits excluding the original reviewer, batch/active-set caps, deterministic sampling, and current serving eligibility. Supply private `artifacts:[{path,sha256}]` for monitoring/audit receipts; the CLI verifies their actual bytes. The output is an immutable release and compare-and-swap SQL for the privileged release lane, never a serving-process write or a claim that an autonomous promotion service is running. No new policy, scheduler or activation has been installed by this work.

Each release has separate DEFECT/CLEAN/GEOMETRY membership even when one confirmation contains all three kinds. Promoting one domain cannot activate sibling examples; the original baseline defect set stays intact. Changed policy or model behavior requires a fresh qualified policy. Routine admissions under a validated policy retain audit and sampling obligations, and monitoring can block promotion or cause release-pointer rollback. Hashes establish consistent bytes, not expert truth, audit independence or honest adjudication.

## Current prerequisites and honest limits

The software scaffolding does not supply independent physical expertise, specimen grouping, capture labels, real paired shadow outputs or a paid evaluation budget. A real benchmark, independent truth audit, baseline-dependent acceptance thresholds and owner approval are still required. Clean/geometry policies remain inactive until their separate real benchmarks pass and the owner approves. The qualified-policy and promotion tools are executable software paths, but no expert registry, reviewer-quality audit, real monitoring receipts or approved activation policy has been fabricated. Changing the deterministic scoring rule is outside these learning consumers and needs its own review and validation. Optical information missing from the source cannot be recovered by adding more examples or agents.
