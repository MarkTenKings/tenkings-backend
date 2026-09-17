# Scoped Astra defect proposals

This server package prepares one human-requested `gpt-6-astra` Responses API analysis, preserves its exact evidence and returns unreviewed defect proposals. It has no SAM dependency, operator loop, grading formula, automatic adoption, final report approval or model-training capability. It uses the existing human-reviewed memory package and unchanged defect taxonomy. Human actions in the connected manual workflow own accepting, correcting, rejecting and adding findings before deterministic measurement.

Official OpenAI documentation fetched for this implementation:

- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra): exact model supports image inputs, Responses, structured outputs and `xhigh` reasoning.
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision): requests use PNG data URLs and `detail: original`. Images remain below Astra's documented dimension and patch limits. Vision can mislocalize small details; native-source image preservation does not certify model outline accuracy.
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): `text.format` specifies strict JSON Schema. Application validation independently rejects malformed, incomplete, refusal, unexpected-tool and wrong-model results.

The available tool catalog was searched for the OpenAI API-key capability; none was available. This build uses injected synthetic transports only and neither collects credentials nor makes live requests.

## Request and source contract

`buildAstraDefectRequest(input)` returns deeply frozen `{request, requestText, requestHash, evidence, evidenceHash}`. `requestText` is the exact serialized body sent once, with model `gpt-6-astra`, reasoning effort `xhigh`, `store: false`, no tools and a bounded strict response schema.

```js
{
  analysisId, cardId,                       // server-bound UUID v4 identities
  profile: 'SPORTS' | 'POKEMON',
  cornerShapes: { FRONT: 'SQUARE' | 'ROUNDED_3_18_MM', BACK: /* same enum */ },
  binding: {
    sourceHash, manualRevision, manualContentHash,
    identityRevision, geometryRevision, defectRevision,
    sides: {
      FRONT: { frame, findingRevision, reviewRevision },
      BACK:  { frame, findingRevision, reviewRevision }
    }
  },
  images: [{
    side: 'FRONT',                         // exactly FRONT and BACK
    whole: { mime: 'image/png', sha256, sourceSha256, width: 1350, height: 1858, bytes },
    crops: [{ id, x, y, width, height, mime: 'image/png', sha256, bytes }]
  }, /* BACK */],
  knowledge,                              // exact validateRetrieval() result
  lessonImages: [{
    lessonId, mime: 'image/png', sha256, width, height, bytes,
    traceOverlay: { mime: 'image/png', sha256, width, height, bytes, traceSha256 }
  }]
}
```

`frame` is the existing six-field defect frame: `imageVersion`, `originalSha256`, `preparationVersion`, `frameId`, `inspectionImageSha256`, `rectifiedImageSha256`. The whole PNG is a lossless encoding of the verified prepared inspection pixels; its `sourceSha256` is the exact original prepared WebP hash, while its `sha256` describes the PNG actually sent. Image conversion and complete decoder validation belong to the host's checked image effect. This package independently verifies each PNG's signature/IHDR dimensions, declared bounds and complete byte hash.

The physical card occupies `{x:40,y:40,width:1270,height:1778}` inside the 1350×1858 inspection frame. `planDefectCrops(side)` returns four overlapping 699×953 crops at `(40,40)`, `(611,40)`, `(40,865)` and `(611,865)`. The host extracts these exact pixels without resampling. Whole-card images and all four crops per side are included; none is silently dropped to fit a budget.

Retrieve reviewed memory freshly for every new analysis. `PUBLICATION_PENDING` refuses dispatch; an empty reviewed bank is explicitly recorded. The host hydrates each verified immutable crop and its exact reviewed trace. Send both the ordinary crop and a cyan trace overlay, including the trace SHA; the prompt labels annotations separately from visible physical damage and distinguishes accepted, corrected, rejected and human-added lessons. Source card/photo matches are excluded. The adapter records all supplied lesson IDs, the exact retrieval revision/hash and actual image hashes. Publication does not change model weights or demonstrate improvement.

Bounds are fixed at 10 MiB per image, 32 MiB combined image bytes, 46 MiB request body, 12 lessons, 120 seconds of provider work, 32,768 output tokens, 1 MiB raw reply, 256 KiB proposal JSON, 32 findings and 64 vertices per finding. These are finite request/resource limits, not a card-count or dollar allowance. Oversize or incomplete work fails visibly.

## Proposal contract

`parseAstraResponse(bytes, evidence)` returns `{state:'READY'|'REFUSED', responseId, model, usage, responseHash, result, code}`. A ready result contains `analysisId`, `sourceBindingSha256`, `knowledgeRevision`, `proposals` and `limitations`. Every proposal has:

```js
{
  id, side, defectType, canonicalContour: [{ x, y }],
  observation, uncertainty: 'LOW' | 'MEDIUM' | 'HIGH',
  reviewStatus: 'UNREVIEWED',
  provenance: { version, analysisId, sourceBindingSha256, frame, imageId,
    imageSha256, localContour, crop, knowledgeRevision, lessonIds }
}
```

Local contours use pixel centers in the named supplied image. Canonical points are `((local.x+crop.x-40)/1269, (local.y+crop.y-40)/1777)` and must lie in `[0,1]²`. Nonfinite, out-of-frame/card, degenerate, duplicate-vertex and self-intersecting shapes are rejected. The polygon nondegeneracy check is not a physical-area measurement. No area, millimeters, grade, score or human authority is inferred. An empty proposal list is not a pristine-card finding or completed human inspection.

Source checks at dispatch use the captured entire manual binding. At human review, the host separately checks current source/profile/frame/physical geometry/corner material, and submits each deliberate acceptance or correction using the current exact defect action base. Accepting one proposal must not invalidate the other proposals merely because the finding revision advanced. Late provider replies never overwrite human changes.

## Durable execution and recovery

`createAnalysisRepository({boundary, authorize, assertCurrent, receiptClient})` uses the existing ordinary staff transaction boundary. `authorize({tx,principal,cardId,edit})` checks card access. `assertCurrent({tx,principal,cardId,binding})` must lock and verify the captured full source/manual/identity/geometry/finding binding; comparing the exact manual content hash and revision binds embedded geometry/finding state without loading image artifacts in SQL. The repository refreshes ordinary authentication after acquiring these locks.

- `prepare(staff,{analysisId,cardId,actionId,baseHash,binding,requestHash,requestRef,requestEvidence,expiresAt})` creates/reconciles an exact immutable action. `baseHash` hashes the original `{actionId,base}` browser command. `expiresAt` is a UTC ISO date no more than five minutes ahead.
- `claim(staff,{cardId,analysisId,requestHash})` grants `{claimed:true,run}` once through `PREPARED → DISPATCHED`; other callers get `claimed:false`.
- `find(staff,{cardId,analysisId})`, `find(staff,{cardId,actionId})`, `status(staff,{cardId,analysisId})` and `latest(staff,{cardId})` authenticate ordinary read access. Latest is shared with authorized card collaborators.
- `recordReply({analysisId,requestHash,kind:'OUTCOME'|'RESPONSE',evidence})` uses the narrow receipt client. It retries only identical receipt bytes, never provider work. An exact dispatched request is required in SQL; immutable conflicts fail.
- `retireUndispatched(staff,{cardId,actionId,baseHash,code})` durably settles a deterministic stale/expired/not-ready refusal while the command is absent or `PREPARED`. All prepare, claim and retirement operations take the same card row lock first. An immutable `request_refusal` record prevents the same command from gaining dispatch later, including after restart; the original prepared evidence stays intact. `DISPATCHED` work cannot be retired this way. Root calls this only after its deterministic pre-dispatch refusal and ordinary card authorization.

The run stores immutable hashes/references and only the prepared/dispatched transition. Projected status uses the immutable receipt: `READY`, `REFUSED` or `UNKNOWN`. An expired unanswered `DISPATCHED` run projects `UNKNOWN`; a later actual response may append beside the unknown outcome without deleting it. Expired `PREPARED` remains `PREPARED` so exact resume can establish expiry and retire the undispatched command. A pre-dispatch refusal projects `{analysisId,actionId,cardId,actorId,state:'REFUSED',retired:true,dispatched:false,baseHash,code,createdAt,receipts:[]}`; it has no provider result, usage or synthetic source binding. Hosts handle `retired` before reading a run's ordinary request evidence. Manual editing is independent of analysis status. `analysisGrantSQL(role)` grants only serving reads/preparation/claim/refusal permissions; `analysisReceiptGrantSQL(role)` grants only the receipt function. Neither grants card approval, direct receipt-table writes, schema creation or ownership. The additive proposal is published byte-identically as staff migration `20260912200100_defect_analysis`; production activation remains separate.

`createAstraDefectProvider({apiKey,projectId?,fetchImpl?,timeoutMs?})` is an injected fixed-endpoint raw-fetch transport with no retry or ambient credentials. Call it only after a durable claim. Timeouts after possible dispatch return `UNKNOWN`, never proven cancellation. Complete raw HTTP errors are retained too.

`createAnalysisExecutor({repository,provider,artifacts})` supplies:

- `prepareAndRun(staff,{cardId,actionId,prepared,expiresAt,signal?,baseHash?})` stores exact request artifacts, prepares, claims, dispatches once, saves the raw reply before interpretation and appends its receipt. `analysisActionHash(evidence,actionId)` reconstructs and hashes the original action/base; an explicit `baseHash` must agree.
- `resume(staff,{cardId,analysisId,signal?})` reconstructs an exact stored `PREPARED` request and checks the same provider binding. It retrieves no new images or memory; a dispatched/unknown request is only read back. A new published lesson belongs to the next new request.
- `readResult(staff,{cardId,analysisId})` returns `{run,result}` after verifying the immutable raw response and saved result match, then rechecking ordinary read access. It does not adopt findings.

The exact API request is stored in at most eight ≤6 MiB byte chunks plus a hash manifest, within the existing 16 MiB per-artifact limit. Raw replies, parsed results and request parts stay out of PostgreSQL. Provider/storage work never runs inside a database transaction. If result storage fails after a raw reply was saved, the unknown receipt retains that raw reference and normalized usage. A later read may require sign-in even though the receipt was successfully preserved after expiry.

## Verification and limits

Run `node --test packages/atlas-defect-analysis/test/*.test.mjs` from the repository root. The 30 scoped Node20.20.1 offline tests cover image/lesson identity, crop transforms, malformed/bounded output, exact model and usage, review-only results, prompt/receipt replay, single dispatch, timeout/stream limits, source fencing, retired-command recovery, expired prepared/dispatched distinction and revoked-read behavior. PNG fixtures and transports are synthetic; no actual card quality or detector performance is asserted.

`scripts/fixture-checks.mjs` exports `runAnalysisFixtureChecks` for the existing owned loopback PostgreSQL harness. The final shared native fixture passed five analysis groups: exact/stale/auth/concurrent claim behavior; unknown and late response replay without manual card mutation; immutable history and separate serving/receipt privileges; absent/PREPARED refusal across restart; and races between preparation, claim and retirement. Its complete chain passed 95 public and 40 staff migrations plus both no-op replays, then stopped and removed the owned database files. The combined memory/analysis receipt reports 16 assertion groups. The root integration work owns retained fixture receipts, package registration, actual source/image effects, request routes, deployment and fresh physical-card acceptance.

Held-out-card detection/outline accuracy, human correction effort, latency/cost and next-card improvement still require actual reviewed-card evidence and separately authorized live calls. The initiating-cause prerequisite for a replacement autonomous grading operator remains open.
