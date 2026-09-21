# ATLAS report review and grading audit — September 21, 2026

Status: implementation and qualification in progress. The serving inspection release remains `406466a089bdd2d34022bc8c06283a0649978b15`; no production card, finding, approval, or analysis was changed by this audit.

Mark reviewed Astra's suggestions for Charmander, added one Back mark, checked both inspection boxes, confirmed findings, and opened a report showing all 10s and one included finding. He requested an arithmetic audit and a full interactive report draft with exact defects and calculation details before final approval.

## Observed cause

Read-only PostgreSQL evidence at 20:05 UTC identifies card `522610ad-3b06-4657-bf66-90f510fc9435`, revision9, content hash `7a28c4ac08fa5a3fd5173d00a29fb47e0b992a1375244ab2b3b010ce6924019f`, and zero report approvals. The journal contains the Back trace save and CPU measurement, Front and Back inspection, then `CONFIRM_FINDINGS`. It contains no `ASTRA_PROPOSAL_REVIEW` action. The compact draft has no assistance-review artifact.

The saved READY analysis `d14f94ed-2921-44ef-b3ec-0fcdb8bf2e44` contains seven proposals, three Front and four Back. Its immutable result was read and verified against the retained provider response using the serving parser. These suggestions were displayed but were never adopted into measured findings. Next/report preview did not erase accepted findings. The old confirmation implementation only confirmed findings already in the measured workspace and did not adopt the remaining displayed Astra suggestions.

This conflicts with the existing owner-approved blueprint direction: one **Confirm findings** action accepts the corrected displayed list, including remaining findings, after both sides are inspected. It is an implementation omission, not a new product decision. The subsequent final-grade policy change below is a separate explicit owner amendment.

Independent in-memory reproduction confirmed all three cases: seven unresolved suggestions plus one manual mark produce one included finding; seven accepted and measured suggestions plus that mark produce eight; seven rejected suggestions plus the mark produce one. “Removed” counts removed measured findings, not rejected suggestions.

## Exact current calculation

The current single measured finding is Back `LIGHT_SCRATCH_SCUFF`, ID `bfcd701c-e23e-47ba-8522-284487fc1f55`, exact trace SHA `1b3d1efe7a7d036a21594b14c17a207c674aca184329f199524935fac8d4e629`. It owns42 pixels at0.0025mm² each:0.105mm². Its0.4×0.5mm extent is a bounding size, not its damaged area. The type multiplier is1. The eligible surface area is5015.55mm²:

`100 × (0.105 × 1) / 5015.55 = 0.002093489248…%`

The unchanged rule assigns a side/category score of10 at weighted damage≤0.2%. This surface group permits10.0311weightedmm² within that band. The current mark is below that threshold and has zero marginal score effect. A score of10 does not mean zero measured defects under this policy.

Front centering's worst balance is52.380952380952%; Back's is54.347826086956%. Both are within the≤55% centering band for10. With no other measured findings, all side/category scores and the raw overall grade are exactly10. Display rounding did not cause this result. The seven omitted proposals must be deliberately confirmed and measured before interpreting a complete grade; this audit does not assert that those proposals are optically correct.

Each category combines Front70% and Back30%. The four categories contribute equally to the overall grade. The existing calculation detail displays to the nearest0.1; the newly approved final award rounds the raw overall directly to the nearest0.5. Defect type multipliers and threshold bands remain unchanged. Per-finding effects are marginal changes with that finding omitted, not additive deductions; several individually zero effects can jointly cross a threshold.

An explicitly hypothetical local replay adopted all seven saved proposals unchanged through the existing trace conversion and seven source-checked CPU workers, retaining the manual Back mark. It produced eight included findings. The Front corner whitening owns145pixels:0.3625mm² over91.29mm², or0.397086208785% weighted corner damage, yielding a Front corner score of9. The combined corner subgrade is9.3; all other categories remain10. Raw overall is9.825 and displayed grade is9.8. This replay is calculation evidence, not a live human confirmation or an assertion that every suggested mark is a real defect. Its retained file explicitly labels it pending real human confirmation: `charmander-hypothetical-8findings.local.json`, SHA `0c58c145360c02e956aef46a57f0a7ebd83339f7dd95fc1eb9e2657ee537dd9d`; hypothetical report JSON SHA `9ffbfcd98b615db39a8b4d954cf4c6d6140cbb44c3388e77d2fb31068db0914d`.

## Requested correction

- Apply the owner's September21 clarification to newly built reports: nearest0.5 awarded grade, raw and one-decimal calculated detail retained, exact quarter-point ties upward. Full report `atlas-manual-draft-report-v2` and compact snapshot `atlas-manual-report-snapshot-v2` persist `finalGrade` and `finalGradePolicy: atlas-final-half-point-v1`. Historical V1 bytes/policy remain unchanged. Approval binds the new persisted final grade and policy.
- Restore explicit collective confirmation of the displayed saved proposal set, preserve individual corrections/rejections and manual findings, measure with the trusted CPU, and commit the complete result atomically. Bind the command to current card revisions and the exact compatible saved analysis. A failed or stale confirmation must not partially adopt findings.
- Prevent a previously confirmed draft with unresolved compatible suggestions from bypassing the corrected review step. Do not rewrite the owner's existing history or automatically confirm findings on deployment.
- Return the verified full report and an authoritative calculation explanation beside the existing compact report snapshot. Preserve the compact report hash and separate final approval behavior.
- Render verified Front/Back images, selectable exact traces, measurements, type multipliers, category damage totals and thresholds, side weights, raw grade and display rounding. Provide a clear return-to-corrections path and rebuild the exact current draft before approval.

The separate V2 hypothetical replay preserves exactly the earlier physical measurements and computed grade: raw9.825, detail9.8, awarded10. File `charmander-hypothetical-8findings-v2.local.json` SHA `fc839a1c7f4073d60ba25a39de4c32cea810ba3a4856b6d1883c1e0ba9fdb3a1`, report SHA `c453b7052a6dd9a9337a6bf398c2e10a899601297d610693b26ca255e41fd4e3`. The original V1 evidence above remains unchanged. Neither projection is a real human confirmation or production card change.

## Evidence custody

Private local root: `/Users/markthomas/.codex/atlas-handoffs/atlas-report-review-20260921/`. Evidence reads used TLS, bounded GET-only artifact access and read-only database transactions. Existing credentials remained in the serving process and were not printed. No paid model request occurred.

| Evidence | SHA-256 |
| --- | --- |
| Original card and action journal, `charmander-before.json` | `d55227de27442b7224280d1bc318a0e6bbbf2b772cef9c906225ca0b9803c946` |
| Verified geometry and defects, `charmander-artifacts.json` | `484e7796b6c3976f139ad0f5b22f5c2f259534325a52a2e676ba4c2510686ea9` |
| Saved analysis metadata, `charmander-analysis.json` | `6ccae6d9e2b085163d7235761bca9f875583ab2af227116c8e3c0d29080a3e83` |
| Verified analysis and prepared-image manifests, `charmander-analysis-artifacts.json` | `96a9667272cb3494f7d92ff4d192c6290709b5b4fa9ae1443ca0925405e4b70b` |
| Current report recalculated from saved inputs, JSON bytes | `8d9ad298c39cc1e51164d95ef098a938388b1a2382bcdec2d2eb3e20e8903910` |

The two saved inspection images were downloaded once for local visual qualification, with exact complete-byte verification against the immutable manifests. Front SHA is `b110b04a993e6f8d141e93ff96233951e82c6e1f583c801a7972bb9c158b368a` (792426bytes); Back SHA is `3c993001dd7a75a166d42e4946f2d71bb9ff78ece9c26ce0e05e06c3e8dd3fe5` (520874bytes). They remain unchanged.

## Source qualification checkpoint

The source implements collective adoption/measurement as one authenticated confirmation and one final card CAS. The command binds the exact saved analysis result and unresolved proposal roster, preserves prior decisions/manual findings, and does not commit partial adoption on worker failure, deadline, or concurrent edits. Confirmation/report/approval reject unresolved compatible READY suggestions. The final card transaction serializes against late response receipts and provider acceptance events using the existing run lock and a fresh metadata read; real restricted-role PostgreSQL qualification is still required. Saved-result verification remains available when new inference is disabled.

The full draft viewer exposes both verified inspection photographs, exact selectable traces, zoom/pan/magnifier/expansion, region measurements and marginal effects, each category's thresholds/weights, and raw/detail/awarded grades. Returning to corrections rebuilds the draft; approval requires verified current images and exact displayed source. Local Node20 backend180/180 and root staff-parent13/13 passed; core24/24 passed including adjacent half-point boundaries and unchanged legacy module hashes. Browser9/9 and root CUA inspection passed on saved/hypothetical evidence with no live actions. Hosted qualification/deployment is not established by these local results.
