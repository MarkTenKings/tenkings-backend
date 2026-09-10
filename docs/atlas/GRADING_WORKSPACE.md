# ATLAS complete grading workspace

Owner direction: September 9, 2026 Pacific. This implements the clarification in the [canonical blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md). It describes required work; it is not a claim of deployment or successful real-card grading.

Mark must be able to add a card and work through its entire grading process inside ATLAS. He can grade manually or watch Astra operate, inspect its evidence and correct its mistakes. The first acceptance cohort uses ten cards with newly supplied Front/Back photographs. The earlier selection of historical Speedster captures is superseded.

Mark explicitly requires two queues: humans load new physical-card photographs into a queue waiting for grading; Astra or a human takes a card through grading; the resulting draft enters a separate final human review queue. Humans supply the photographs and approve the final report. Operating the middle grading stages manually is optional.

## Current evidence

- The live staff app opens `/admin/grading`, an assigned human review queue. The owner's screenshot shows zero cards. Source: `frontend/atlas-app/pages/grading.jsx` and `components/Shell.jsx`.
- There is no Add card/photo-upload route in the staff app. Operations intake accepts an existing source ID and owner ID and verifies an already captured source; it is not a new-photo intake screen. Its live controls remain inactive.
- Earlier Speedster code contains photo upload, card geometry, map registration, centering and review screens. `frontend/nextjs-app/components/ai-grader-v2/CaptureWorkspace.tsx` remains coupled to legacy admin authentication, API routes and capture storage. It cannot be mounted in ATLAS with that authority.
- ATLAS already contains assigned evidence inspection, human trace/finding corrections, proposal decisions, report approval and finishing components. These do not establish a complete manual path from new photographs.
- The operator runtime currently exposes five tools: report reading, crop inspection, identity proposals, finding proposals and submission for human review. Source: `packages/atlas-operator/src/runtime.mjs`. This is not a complete capture-to-report operator.
- Operator steps and immutable proposal/correction revisions exist in the data model. An authenticated activity projection, pause/step controls and safe human takeover are not implemented as a complete user workflow.
- Image preparation's approved release is currently null in `frontend/nextjs-app/lib/server/speedsterPreparationRelease.ts`. Storage, preparation/detection, grading bridge and Astra runner need actual resource/release acceptance before live grading. Do not bypass preparation authority to make the new screen appear operational.

## Required experience

1. **Add cards and queue:** upload new Front and Back photographs for one or several cards, confirm the pair belonging to each physical card, and save recoverable drafts. Capture available card details and retain the existing identity/map authority requirements when confirming identity during grading. Show which photos were verified and which still need work. Never lose the draft because preparation is unavailable. Explicitly add ready cards to the shared queue waiting for grading.
2. **Prepare images:** inspect originals, confirm card boundaries, orientation and centering, and request replacement evidence when necessary. Reuse the established geometry, map and preparation logic through scoped ATLAS ports.
3. **Inspect and grade:** expose centering, corners, edges and surface findings with the original pixel/trace and deterministic grading tools. The human must be able to complete this stage without an Astra run.
4. **Watch Astra:** display actual recorded stage changes, image/region inspections, proposals and confirmed effects. Distinguish proposed changes, applied changes, waiting states and errors. A spinner or elapsed time must not imply work completed.
5. **Correct and compare:** retain the original machine proposal and exact evidence along with the human correction and recalculated report. Preserve attribution and prior revisions. A suggested improvement must not silently change the model or trusted-learning bank.
6. **Review and approve:** the trained human approves the exact saved report. Existing approval and publication protections remain in force.
7. **Finish:** track the approved report's label, NFC and physical finishing separately under the already selected Mac workflow. Software progress cannot establish physical completion.

One shared card workspace should expose all stages. The staff navigation must distinguish **Waiting to grade**, **In progress**, **Needs attention**, **Human review** and **Approved**. Offer **Add cards** prominently at the start. The existing review queue serves the final human review stage; it must not be presented as the entire grading workspace. These are projections of recorded work, not unrelated copies of each card.

## Intake queue and taking work

- Each item represents one physical card, with explicit Front/Back pairing, original image hashes, saved capture revision, upload readiness and known card details. A batch of loose photos must not silently become guessed pairs. The human can correct pairing before committing it.
- Incomplete or unverified uploads remain recoverable drafts. They cannot be claimed as ready for grading. Retrying a saved upload/queue request must recover its exact card rather than create a duplicate.
- Humans can fill the queue with all ten pilot cards before grading starts. Uploading images or viewing a queue does not itself dispatch a paid model request. Starting the admitted Astra batch permits sequential work within the existing cohort, time window and cost limits.
- A ready card offers human **Grade this card** or selection for **Start Astra**. Both claim the same underlying card and evidence revision atomically. Show whether the card is waiting, assigned to Astra or assigned to a named human. Two operators cannot both start the same card.
- The human can watch an active card without taking over or blocking Astra. Pause/step-through/takeover preserve the recorded action boundary and unresolved in-flight requests. A timeout or expired claim does not prove a paid call stopped and must not cause duplicate dispatch.
- Missing or inadequate evidence moves the card to **Needs attention**, with an actionable request for a human to supply or replace the photos. A blocked card must not be labeled graded. Continuing another ready card follows the admitted batch controls and preserves the blocked card's history.
- Completion of the grading draft moves the same card to **Human review**. This applies whether Astra or a human operated the earlier stages. Final approval is a separate explicit human action and never occurs merely because the batch is finished.
- Queue progress and counts come from durable records. Closing the browser must not lose saved cards or invent worker continuation; the UI must accurately reflect whether a configured runner is active or work is still waiting.

Reuse the existing scoped ATLAS assignments, revisions, initialization/operator ledgers and budget controls. This is a card workflow requirement, not authorization to introduce a general job scheduler. New database policy or adapter work must preserve those boundaries and the original authoritative media/grading records.

The implementation should offer manual operation, continuous Astra operation with optional observation, and supervised step-through. Step-through is an implementation choice supporting Mark's observation/correction requirement. At a pause or human takeover, stop new machine dispatches, settle or visibly retain any in-flight result, and refresh the exact evidence/revision before human edits. Do not let a late machine result overwrite human work or erase a cost reservation.

The activity view uses a restricted projection of assigned-card records. Never send private model continuation, raw provider payloads, signed media URLs, credentials, arbitrary source-owner selectors or raw operational authorization fields to the browser. Preserve separate staff, machine, approval and learning authority.

## Acceptance order

First make one new card complete the real path: new photos → verified saved draft → waiting to grade → exclusive human claim → preparation → manual grading → final human review → approved report. Exercise refresh/recovery and confirm no dependency on an Astra proposal for human completion.

Then operate a fresh card with Astra while the human watches. Verify that the displayed inspections and proposals correspond to persisted steps; pause between confirmed actions, take over, correct a finding and compare the resulting report without losing the prior result. Complete exact human approval. Test any interrupted or uncertain request by reading its retained result, not by creating another paid run.

Allow Mark to load all ten cards into the intake queue in advance; prove the first-card processing path before running the remaining batch. Verify incomplete upload exclusion, correct Front/Back pairing, duplicate request recovery, competing human/Astra claims, visible operator ownership, blocked-card handling and movement into final human review without automatic approval. All ten use fresh photos. Preserve the existing $100 total SMS/image/Astra authorization and its current partitions, reservations and expiry; the new screen does not reset them. Record real grading accuracy, missed findings, false positives, human corrections, time and measured cost before claiming pilot completion.
