# Pokémon unreviewed draft: ingestion and editor qualification

2026-09-17; audited source `6d10fc3e60badbc4b1467d323924bbca94810f57` plus the worksheet editor preservation change described below. No live import, database query, approval, publication, provider request or deployment occurred in this audit.

## Ready action and remaining conditions

The existing authenticated API can accept all **138 printed rows** as an **unreviewed** new-set draft. Missing reuse grants, physical-printing evidence and human approval do not prevent this draft stage. They remain requirements for later shared catalog publication. The exact proposed key is `Black & White-Legendary Treasures`; the binding rationale and prior managed metadata audit are in [the mapping decision](pokemon-mapping-decision.unreviewed.md).

After the coordinating agent reviews/integrates the editor fix and verifies the target runtime contains the pinned-checklist adapter:

1. Recheck that exact key for existing drafts, jobs, taxonomy and aliases. The previous audit found none; this audit made no new database observation. The API is an upsert, **not an atomic create-only or idempotent import**. Stop for reconciliation if the key now exists; do not replay a successful queue request.
2. Submit **only `requestDraft`** from [the complete import wrapper](pokemon-complete-import.unreviewed.json) once to `POST /api/admin/set-ops/ingestion`, with the existing authenticated reviewer/operator capability. Preserve its provider, query, fetch metadata and raw payload. The generic file/manual upload UI rebuilds provider/fetch metadata and is unsuitable for submitting this prepared envelope unchanged.
3. Select the returned job in `/admin/set-ops-review` and choose **Build Draft From Selected Job** (or call the existing build endpoint once for that job). Inspect the persisted job summary: `taxonomyIngest.applied=true`, adapter `pinned-pilot-checklist-v1`, one program, 138 cards, and zero variations/parallels/scopes/odds/conflicts/ambiguities/bridges. An HTTP 200 alone is insufficient: the existing build handler catches taxonomy failures and can still save a review draft. Taxonomy ingestion must be enabled for those source rows to be created.
4. Keep job and draft `REVIEW_REQUIRED`, verify 138 rows and no latest approved version, and retain the returned job/version IDs and version hash. The existing `reviewedAt` job timestamp is populated by draft building; it is not proof of human review.

These are a bounded operational sequence under the existing execution authorization, not a new approval request. This audit did not qualify a deployed runtime or execute that sequence.

## What the reviewer should see and do

Use [the complete 138-row review roster](pokemon-complete-checklist-review.md), its linked pinned source PDF, [the exact transcription JSON](pokemon-complete-checklist.unreviewed.json), and the loaded draft revision together. The roster exposes literal checklist/rarity markers that the ordinary worksheet table does not display. Check `1–113` and `RC1–RC25`, repeated names as separate numbered identities, RC11's literal rare marker, one parent program, and the recorded unknown physical finish/denominator/edition/format/channel values. Do not infer additional printings from the worksheet.

The table supports corrections and **Save New Draft Version**. Original printed observations stay in metadata alongside edited visible values. Saving a revision does not update the original ingestion payload, taxonomy source or cards, or grant review authority. The existing **Approve** action starts the legacy approval/seed workflow; it is not a review-only acknowledgment and is outside this draft action. Shared catalog publication separately requires its full manifest/review-evidence packet, actual taxonomy IDs, applicable evidence/grants and authenticated human review. The compiler's selected four-card publication pilot remains `6`, `7`, `RC1`, `RC2`.

## Fixed implementation defect and evidence

Previously worksheet save emitted only visible fields, dropping raw provenance and converting unknown rookie values to false. `lib/setOpsDraftEditor.ts`, used only by the worksheet save branch, now carries raw fields forward and overlays edits. Untouched missing/null/blank/unrecognized rookie values stay null; known values and explicit control edits remain boolean. No ingestion, approval, publication or source validation logic changed. Parallel-database saves are unchanged.

The offline integration test runs the actual ingestion, draft build, central adapter, review GET and version-save handlers against in-memory Prisma delegates. Unplanned Prisma/network calls fail closed. It proves all 138 original identities and metadata reach source/card rows; an edit to one visible name preserves all 138 raw metadata records and null rookie values in a new revision; the original revision, source/card rows and an unrelated existing sports draft remain unchanged. The matcher emits the existing approved-source filter. A forged final-row source hash is rejected before writes. This is API/query-contract evidence, not PostgreSQL execution or browser proof.

**13/13 focused tests passed**, including the existing original-input/source/projection guards; scoped ESLint passed; scoped semantic diagnostics for the helper, page and new test returned zero errors without emitting files. No build or installation ran. Raw logs: `/private/tmp/tenkings-pokemon-draft-audit-20260917-01/{tests-final,lint-final,types-final}.log`. Initial logs are retained separately.

Legacy `versionHash` intentionally excludes raw metadata. It identifies the existing canonical worksheet projection; it must not be presented as provenance approval or complete raw-payload integrity. The pinned original-input checks and later shared-publication hashes retain their separate authority.

## Qualification pins

| Artifact | SHA-256 |
| --- | --- |
| Unchanged complete request wrapper | `a36171566277e391764aae473df273a3c5fe26e54d4faa53d7802c2843d65a21` |
| `pages/admin/set-ops-review.tsx` | `81508f09f3db1d2733613ebeef11745e95c012735d1cb1777abff14b651e3eb3` |
| `lib/setOpsDraftEditor.ts` | `30c3f0dd9da6865f348b9945d881f7dc8ebaef0f7188856baae8206f374b189e` |
| `tests/pokemonPilotDraftWorkflow.test.ts` | `08178eaf3a097d024fe501c497dc7979bd2226fcdd70b1cbab983b70aa608b2c` |

Paths in this table are relative to `frontend/nextjs-app` except the request wrapper in this directory. The coordinating agent owns integration, deployment qualification and the session-log entry; no commit was made by this lane.
