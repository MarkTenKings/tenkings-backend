# ATLAS real-card manual, Astra and reviewed-memory acceptance

Prepared September 17, 2026 from the saved implementation and the
[fresh lead handoff](../../plans/FRESH_ASTRA_ULTRA_LEAD_HANDOFF_20260917.md).
**This is an unexecuted acceptance record, not Mark's approval.** Application
checkpoint: `a2a116476592a629214d30d0240152f81c606829`; record the actual released
successor below. No photo, provider request, production operation or human
approval was performed while preparing this document.

Use `PASS`, `FAIL`, `BLOCKED` or `NOT RUN` for every result. PASS requires the
specified observation and retained evidence; FAIL means an attempted check
contradicted it; BLOCKED names a missing prerequisite; NOT RUN means no attempt.
Keep each first observation, even after a later successful retry. A fixture pass
belongs in a separate qualification record and cannot fill a real-card result.

## Lead: prerequisites before inviting Mark

| Prerequisite | Initial state | Evidence needed to change state |
| --- | --- | --- |
| Original/derived storage integrity, immutable writes and private reads | BLOCKED: qualification under review | New qualification result and exact adapter/artifact identity. Preserve the failed September 12 canary and its sealed execution intent; never rerun it. |
| Matched Linux/native and dedicated staff artifacts | BLOCKED: exact build/qualification outstanding | Source commit/tree or explicit changed-file manifest, source-context hash, Linux image digest, staff deployment/build identity, qualification receipts. A build in progress is not a release. |
| Five staff migrations, restricted grants and coordinated manual route | BLOCKED: not deployed | Current staff ledger with exact five migration checksums, privilege verification, matched web/private bindings and authenticated route receipt under the [release runbook](../../runbooks/CONNECTED_MANUAL_RELEASE.md). |
| Ordinary reviewer access on iPhone and Mac | NOT RUN on new route | Current signed-in REVIEWER and card edit access; real session/CSRF acceptance. No cookie, phone number or secret in this record. |
| Automatic recognition and human-requested Astra | NOT RUN live | Lead verifies intended enabled flags/provider bindings and applicable existing authorization before paid actions. Disabled identification/analysis can qualify manual work only. |
| Exact final report approval | BLOCKED: current reviewer certification is NULL | Current genuine REVIEWER certification plus card owner/approver access, verified at approval time. Do not seed certification or impersonate Mark. |

The supplied fresh authority snapshot has one active REVIEWER with NULL
certification and no current human-operations grant. Ordinary manual editing,
Confirm findings and its memory publication do **not** require certification or
an autonomous-operator operations grant. Final `APPROVE_REPORT` does require
current certification; keep only that portion blocked while other eligible work
proceeds. The lead refreshes the actual authority snapshot before use.

Give Mark [the manual route](https://atlasgrading.com/admin/manual) only after
ordinary authenticated access and backend/storage readiness are proven. The old
private `/health` release does not establish this route's readiness. This manual
service has no generic `/health`; use artifact identity, signed authenticated
intake reads and actual workflow evidence.

## Mark: first two cards, then a distinct relevant card

Start with one standard-size **bordered sports card (S1)** and one **bordered
Pokémon card (P1)**, 63.5 × 88.9 mm. Prefer specimens with real observable wear.
These are test specimens, not a product card allowance. Borderless/full-bleed,
oversized cards, SAM3, autonomous operation and physical finishing are outside
this acceptance. Mark owns physical detail/color and practical usability
judgments; the lead collects technical records without asking Mark to use a
terminal or manufacture outcomes.

1. **Add S1 and P1 from iPhone.** Photograph Front and Back in the native Camera
   app; select untouched originals through **+ Add card → Choose original
   photo**. Confirm each pair is the same physical card, correct side and
   orientation. Save the second while the first exists. On the Mac, open the
   same saved cards with Front left and Back right.
2. **Judge the photographs.** Compare the physical card, native photo and working
   view. Zoom/pan all corners, edges, fine print and visible wear on both sides.
   Record lost detail, clipping, glare and misleading color in Mark's own words.
   Distinguish native HDR retention, full-resolution SDR derivation and the
   prepared inspection grid; equal pixel hashes do not establish optical quality
   or full-HDR rendering. Stop grading an optically unusable side and record FAIL.
3. **Review identity and geometry.** Check actual automatic identity against the
   card, correct errors and Pokémon layout as needed, then save/reload. Explicitly
   cleared optional fields must stay cleared. In **Review geometry**, adjust an
   outline to the real physical edge/printed border, **Save outline**, reload and
   verify the other side survives. Finish with **Confirm both sides**. Record
   automatic identity separately if it was disabled, wrong or unavailable.
4. **Complete manual inspection.** Trace only real damage; inspect type and
   deterministic measurement. Correct/remove/restore only when warranted, save
   and reload. Mark each side inspected after actually inspecting it. Use one
   **Confirm findings** for the corrected list. With memory enabled this also
   publishes reviewed examples; wait for acknowledged saving. A pending/failed
   save is not available memory. Do not invent a defect to obtain an example.
5. **Review the report separately.** Check identity, findings, four subgrades and
   final score. The eligible trained human uses **Approve final report** and
   verifies **Report approved and saved** after reload. If certification remains
   absent, retain the draft and record BLOCKED; do not substitute a fixture user.
   This implementation saves an exact private approval snapshot. It does not
   by itself establish public-report publication, certificate issuance, label
   printing or NFC/physical finishing.
6. **Replace Front on one card.** Photograph a new Front of that same physical
   card. Use **Photos → Replace original photo → Use replaced photo pair**.
   Verify Back photo, geometry, findings, traces, measurements and inspection
   survive; the changed Front needs its own review. Reload. The previous approval
   must remain historical, and the new draft must not appear approved. If step 5
   was blocked, only the approval-history assertion remains BLOCKED. Complete
   the new Front review before using this card's current evidence for Astra.
7. **Review Astra, then test a different physical card.** Once geometry is current
   and traces are saved, select **Find defects with Astra** on S1 or P1 (teacher
   A). Inspect both sides independently, compare every proposal with the card,
   accept correct proposals, correct wrong types/outlines, reject false positives,
   and add actual misses. Preserve Astra's original proposals. Reinspect affected
   sides and **Confirm findings**; the lead records the new publication before
   starting the next relevant request. Then photograph a distinct relevant
   physical card B with fresh Front/Back originals, complete identity/geometry,
   and request Astra once. Judge B's defects and correction effort independently.
   The lead proves which examples reached B; Mark does not need to inspect API
   payloads. A helpful B result alone does not prove memory delivery or improvement.

If an action is interrupted, reopen the same card and let its saved command
reconcile. Do not create a duplicate card or click a new paid analysis to resolve
an unknown dispatch. Manual review remains available; the lead owns diagnosis.

## Lead: establish relevant, distinct specimens and publication ordering

Record S1/P1/A/B physical labels and card IDs privately. A may be S1 or P1 after
any Front replacement is fully reviewed. B must be a **different physical copy**;
a new UUID or another photo of A does not qualify. Record Mark's physical-copy
attestation, distinct card IDs, both original hashes and native pair source hashes.
Byte-hash inequality is necessary evidence, not proof of a different physical card.

Choose B using the actual conservative design context: same normalized category,
year, productSet and parallel; also manufacturer/insert for sports or layoutType
for Pokémon. To test a rejected printed-design lesson, use a different physical
copy of the **same known cardNumber**. A sports lesson is not expected to appear
on P1. Do not change correct identity merely to force retrieval.

Before B's request, identify at least one actual new A lesson expected to be
relevant, its disposition and the selection rule. Current selection takes at most
12 lessons, prioritizes exact card number, then newer publications. If no genuine
relevant lesson/specimen is available, mark memory delivery BLOCKED; an empty
reviewed bank is not a positive next-card test. Retain intervening relevant
requests, if any, so B is not incorrectly called the next request.

Publication PASS requires the committed HUMAN `CONFIRM_FINDINGS` action and
matching immutable publication row with the original authorized confirmer. The
latest acknowledgment must precede preparation/retrieval of B's **new** request.
Replaying a previously prepared request preserves its old snapshot and cannot
prove freshness. A pending relevant publication must prevent silent fallback to
older memory. UI `SAVED` is useful feedback; the publication and actual request
artifacts supply the evidence.

Memory-delivery PASS requires B's `knowledge.lessonIds` and actual serialized
request to contain the expected current A lesson, its reviewed crop and exact
trace overlay. Verify the lineage hashes and that target-card/identical-photo
lessons are absent. Record relevant eligible lessons omitted by ranking/limits;
do not claim all published examples were sent. A model's returned `lessonIds`
are advisory citations and are not proof of input delivery or causal benefit.

Report the **delivery result** separately from **detection usefulness**. This
small run can document real misses, false positives, type errors, outline edits,
review time and latency. It cannot establish a general accuracy percentage,
causal improvement or model-weight training. An improvement claim needs its own
predeclared held-out comparison; this checklist does not authorize extra paid
comparison requests or require fake flaws to populate all outcome categories.

## Exact evidence fields the lead retains

Keep originals, images, request/response bytes and sensitive metadata in the
existing private evidence root; commit only safe references/hashes and redacted
results. No signed URLs, tokens, phone numbers, secrets or image/base64 payloads
in this document. Preserve exact raw bytes privately before redaction.

| Record | Exact source fields/checks |
| --- | --- |
| Run header | UTC start/end; released source identity and changed-file manifest if applicable; Linux image digest; staff build/deployment identity; route; iPhone/iOS/browser and Mac/macOS/browser versions; operator and authority evidence reference; specimen labels/card IDs; result-record author. |
| Native/working lineage | Intake request/upload IDs and side versions; `original.object`, `original.content.{sha256,byteCount,mime}`; `decodePlan`, `decodedFrame.raster.{content,dimensions}`, `decodedFrame.treatment`; `workingFrame.raster`, `.treatment`, `.workingImage.sourceRaster`, `.sourceTreatment`. Verify original readback bytes and full-resolution working dimensions against descriptors, not an identification thumbnail. |
| Manual before/after | `cardId`, `revision`, `contentHash`; `draft.source.sourceHash` and `uploads.FRONT/BACK`; identity and `identityRevision`; hydrated geometry/defects per-side frame, outlines, traces, finding/review revisions, inspection and measurements; immutable action IDs/request hashes/results. For Front replacement compare Back's exact side payloads rather than expecting the whole card hash to remain unchanged. |
| Approval | `atlas_manual.approval`: `card_id`, `action_id`, `actor_id`, `source_revision`, `source_hash`, `report_hash`, exact `report`, `approved_at`; verify SHA-256 of stored report bytes and equality with the human-reviewed report hash. Its `source_hash` binds manual card content, not only the native-photo pair. After replacement, current content hash differs and prior row remains unchanged. |
| Publication | `atlas_manual.action` exact HUMAN `CONFIRM_FINDINGS` request/result and original actor; `atlas_manual.defect_memory_publication`: `revision`, `card_id`, `action_id`, `actor_id`, `result_revision`, `content_hash`, `source_hash`, `design_key`, `document_hash`, `published_at`; privately retain `document.lessons`. Per lesson: `id`, `findingId`, `side`, `disposition`, `defectType`, `previousDefectType`, `design`, `source`, `exemplar`, `proposalReview`. |
| Request/selection | `atlas_defect_analysis.run`: `id`, `card_id`, `action_id`, `actor_id`, `base_hash`, `binding`, `binding_hash`, `request_hash`, `request_ref`, `request_evidence`, `evidence_hash`, `state`, `created_at`, `expires_at`, `dispatched_at`. `request_evidence` includes `sourceBindingSha256`, `model`, `reasoningEffort`, `promptSha256`, `schemaSha256`, `limits`, `providerBindingHash`, `images`, `totalImageBytes`, `knowledge.{revision,generation,sha256,status,lessonIds,lessonImages}`. Verify `request_ref` parts reconstruct exact `requestText` and SHA-256 `request_hash`; full supplied lesson documents are embedded as `HUMAN_REVIEWED_EXAMPLE` in those bytes. The manifest evidence excludes `providerBindingHash`, so its hash is distinct from the database evidence hash. |
| Image/request contents | `binding` carries native `sourceHash`, manual/content/identity/geometry/defect revisions and each side's frame/finding/review revisions. Each frame binds `imageVersion`, `originalSha256`, `preparationVersion`, `frameId`, `inspectionImageSha256`, `rectifiedImageSha256`. `images` binds each actual current PNG encoding hash separately from its WebP source hash, crop/coordinate space and `noResampling`. `knowledge.lessonImages` binds each crop and `traceOverlay.traceSha256`. Verify serialized request uses `gpt-6-astra`, `reasoning.effort=xhigh`, both sides, selected examples and strict structured output. |
| Raw reply/accounting | `atlas_defect_analysis.receipt`: `analysis_id`, `kind`, `request_hash`, `recorded_at`, `evidence.{state,responseRef,resultRef,responseHash,providerRequestId,responseId,httpStatus,usage,code}`. `DEFECT_RESPONSE` artifact retains `startedAt`, `receivedAt`, HTTP/content type, exact response bytes and hash. Normalized usage: `input_tokens`, `output_tokens`, `total_tokens`, `cached_input_tokens`, `reasoning_output_tokens`; raw malformed/missing usage remains retained. Missing usage/cost is unknown, never zero. Record measured elapsed time and any cost with actual billing evidence or explicitly dated price source/calculation, not an invented invoice. |
| Human comparison | Per proposal/finding: side, original proposal ID/type/outline, physical-card observation, accepted/corrected/rejected/added disposition, final type/trace hash, human review action/time and deterministic measurement. Record counts with their inspected-card/side denominator and uncertain visibility separately; no invented truth labels. Keep optical acceptance and model usefulness in Mark's own words. |

The retrieval contract contains `pendingPublications`, but the run's compact
`knowledge` record does not. If no separate retrieval snapshot was captured,
reconstruct and validate supplied lessons with the existing saved-request reader
and `restorePreparedRequest`; distinguish that reconstruction from an observed
retrieval response. Never invent a stored field or use a later database snapshot
as proof of what an earlier paid request contained.

## Lead-owned resilience and concurrency evidence

Use the qualified exact artifact in a controlled environment for fault injection;
label it as fixture evidence. Do not interrupt shared production services or create
new paid requests just to fill this table. Live observations and controlled tests
receive separate rows/references. If a required hosted scenario is not exercised,
leave it NOT RUN. Mark's card work does not require him to simulate outages.

| Check | Required observation | Initial result |
| --- | --- | --- |
| Interrupted upload / expired session | Same retained upload/command reconciles after normal sign-in; no unintended duplicate card/side, no lost opposite-side work. | NOT RUN |
| Lost committed manual/approval/publication reply | Reload reads the original action and exact result; one approval/publication per original action; publication recovery retains original confirmer. | NOT RUN |
| Two requests for the same analysis | Same `analysisId`/`actionId`/`requestHash` has one durable dispatch claim and at most one outbound POST; repeated UI/HTTP request reads its outcome. Application rows alone do not prove provider billing. | NOT RUN |
| Timeout, late reply, process restart | PREPARED can resume the exact stored request or retire only before dispatch. DISPATCHED/UNKNOWN never causes automatic redispatch; retain raw late response/usage when available, and stale results cannot alter current findings/report. Uncertain liability stays unknown. | NOT RUN |
| Source/identity/physical-frame change | Previously prepared/advisory result is refused or stale as applicable; never adopted against replaced Front or edited identity. Valid Back/manual work survives. | NOT RUN |
| Same-card edit race | Stale human command fails visibly; no silent overwrite of newer edit or approval. Capture both action/base hashes and authoritative readback. | NOT RUN |
| Distinct cards / graders | S1 and P1 are admitted; unrelated cards and independent manual work continue while another analysis fails/is unknown. Record actual overlap, actors, action/analysis IDs and outcomes; do not describe one-card timing as throughput proof. | NOT RUN |
| Memory pending/supersession | No dispatch with relevant publication pending; latest acknowledged confirmation supplies current lessons, superseded lessons are excluded from new retrieval while history remains. | NOT RUN |

## Fill after execution

Use separate result/evidence rows for S1, P1 and B. For the single Front replacement,
mark the unused specimen NOT RUN and identify the exercised specimen. Every FAIL
or BLOCKED row names the observed cause, next owner and evidence reference.

| Outcome | S1 | P1 | B / evidence reference |
| --- | --- | --- | --- |
| Fresh intake, correct pairing, second card admitted | NOT RUN | NOT RUN | NOT RUN |
| Mark's physical detail/color acceptance | NOT RUN | NOT RUN | NOT RUN |
| Actual automatic identity / correction persistence | NOT RUN | NOT RUN | NOT RUN |
| Geometry and real manual trace save/reload | NOT RUN | NOT RUN | NOT RUN |
| Both inspections, Confirm findings, acknowledged publication | NOT RUN | NOT RUN | NOT RUN |
| Deterministic draft report checked | NOT RUN | NOT RUN | NOT RUN |
| Exact trained-human approval | BLOCKED: certification | BLOCKED: certification | BLOCKED: certification |
| Front replacement preserves Back | NOT RUN | NOT RUN | NOT RUN |
| Prior approval historical / new draft unapproved | BLOCKED: prior approval | BLOCKED: prior approval | NOT RUN |
| Real Astra request, raw reply and usage retained | NOT RUN | NOT RUN | NOT RUN |
| Next DISTINCT card receives expected new lessons | NOT RUN | NOT RUN | NOT RUN |
| Mark's Astra usefulness assessment | NOT RUN | NOT RUN | NOT RUN |

Released URL/source/artifacts: **NOT RECORDED**. Physical-copy attestation:
**NOT GIVEN**. Mark's optical decision and own words/date: **NOT GIVEN**.
Publication A / expected lesson IDs / B request: **NONE**. Final approval receipts:
**NONE**. Manual acceptance: **NOT RUN**. Memory delivery: **NOT RUN**.
Model usefulness: **NOT RUN**. Overall live acceptance: **BLOCKED by release**.

Lead signs the evidence result; Mark supplies only his actual optical/workflow
decision and any eligible final-report approval. Report remaining failed/blocked
checks explicitly. Local qualification, successful routing, a saved review, a
model response and public/physical finishing are separate milestones.

## Implementation references

- [Native-photo contract](../../../../packages/atlas-manual-intake/src/contract.mjs),
  [manual workflow](../../../../packages/atlas-manual-workflow/src/workflow.mjs),
  [approval/ACL repository](../../../../packages/atlas-manual-service/src/repository.mjs)
  and [current certification boundary](../../../../packages/atlas-manual-service/src/staff-auth.mjs).
- [Actual UI controls](../../../../frontend/atlas-app/components/ManualCards.jsx),
  [Astra/findings workspace](../../../../packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx)
  and [UI memory status mapping](../../../../packages/atlas-connected-manual/src/defect-assistance.mjs).
- [Publication/retrieval fields](../../../../packages/atlas-defect-memory/src/contract.mjs),
  [matching/selection and authorization](../../../../packages/atlas-defect-memory/src/repository.mjs),
  [immutable publication schema](../../../../packages/atlas-defect-memory/sql/proposal.sql).
- [Exact request/response contract](../../../../packages/atlas-defect-analysis/src/index.mjs),
  [single-dispatch provider](../../../../packages/atlas-defect-analysis/src/provider.mjs),
  [raw receipt/recovery executor](../../../../packages/atlas-defect-analysis/src/executor.mjs)
  and [run/receipt/refusal schema](../../../../packages/atlas-defect-analysis/sql/proposal.sql).
