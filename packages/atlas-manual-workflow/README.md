# ATLAS manual workflow integration

Server composition for the staff manual review, including authenticated
actions, durable recovery, and exact measured report approval.

`createManualWorkflow({repository, artifacts, pythonExecutable,
measurementLimits, prepare})` composes the existing pure geometry/defect actions,
checked CPU measurement and manual-service authentication/CAS. `prepare` is a
trusted server adapter that prepares the saved outline, durably verifies its
images and returns the adopted geometry. Long work occurs outside transactions.

The compact draft contains geometry/defect artifact references, canonical
identity and its revision. Each full artifact is bound to its card, kind and
content/source hash. Browser bytes and declared actor labels grant no authority.
New sports/Pokémon identity uses the existing new-session validator; Pokémon
requires its human-authoritative layout type. All scoring and physical sizes
remain the existing standard-card rules.

## Actions and recovery

- `GEOMETRY_EDIT` saves an exact current-base physical/printed outline.
- `PREPARE_SIDE` runs the host's actual CPU preparation and replaces that side's
  defect frame. A physical edit first saves `prepared:null`, so CPU failure
  cannot lose the outline. Defect/report actions require confirmed geometry;
  old defect artifacts remain history while preparation is unavailable.
- `CONFIRM_GEOMETRY` records both current human geometry reviews.
- `TRACE_SAVE` or `DEFECT_EDIT` saves the pending correction **before** CPU
  measurement. `MEASURE_SIDE` subsequently adopts checked CPU output. The client
  sequences these actions automatically, and a reload can retry the saved
  candidate. `DISCARD_PENDING` is a versioned return to the prior findings.
- `INSPECT_SIDE` binds the human inspection to the exact image/finding version.
  `CONFIRM_FINDINGS` accepts the corrected list after both current inspections.
- `IDENTITY_EDIT` updates the canonical identity without erasing valid defect
  inspections. Printed-border edits likewise preserve defect inspection.
- `APPROVE_REPORT` belongs to manual-service and remains a separate trained
  human action against an exact server preview hash. Full report content lives
  in a REPORT artifact; the database snapshot stores its exact reference and
  compact grade/identity/counts. Compare approval source hash with current draft
  hash before showing it as current. Later edits preserve the old approval.

`createWorkflowHandler` adds authenticated `/view` and `/trace` endpoints to the
ordinary manual-service handler. The host must bound JSON **before parsing**:
64KiB ordinary actions and 1MiB trace staging in the fixture. Full 376344-character
bitmap wires enter immutable EDIT storage; only the compact returned action
enters PostgreSQL. The host supplies its real request assertion and verified
image descriptors. The fixture's private image route authenticates and hashes
the exact current bytes before returning them.

`createManualClient` stores a pending compact command under a staff/card key.
It reconciles or retries the identical action ID/payload after a missing reply,
and reloads the current server view instead of displaying an old receipt as
current. A saved candidate remains visible while its measurement fails. Definite
validation/staleness and precommit CPU refusals are returned as definite errors;
unknown transport/commit outcomes retain the pending command. A browser draft
that has never been saved is not durable; the fixture blocks stage navigation
and warns on unload while an outline or trace is being edited.

Finding saves can opt in to a complete action response using
`x-atlas-workspace: all` (or `inspection`). Only `DEFECT_EDIT`, `TRACE_SAVE`,
`MEASURE_SIDE`, `INSPECT_SIDE` and `CONFIRM_FINDINGS` are enriched. The existing
committed card and receipt are unchanged; optional `workspace` contains
`version: atlas-manual-action-workspace-v1`, `imageScope`, and `view`, assembled
through the same full view builder, including all metadata and verified image
descriptors. Hydration reads the committed artifact references; a final
authorization/photo/revision check excludes stale snapshots. The optional work
gets at most five seconds, shortened by time already spent within a 200-second
response budget; this does not change the action's existing execution deadline. The
combined JSON must fit the existing 2 MiB private transport limit. Failure,
expiry, concurrent change or oversized output returns the original receipt so
the client can perform a full read. Timed-out hydration may finish later but
cannot replace the returned receipt. No expiring grants enter the durable journal.

The browser accepts the snapshot only with a matching committed receipt,
revision, hash, complete state and metadata. It never replaces a full workspace
with the geometry-only state endpoint. Unknown outcomes still reconcile the
same command; a proven commit followed by a failed read clears only that exact
journal, retains a revision/hash floor, and reports **Saved; refreshing**.
Further mutations stay blocked until read recovery succeeds. Late reads cannot
replace a newer saved view. Full report publication and post-confirmation work
retain their existing execution order.

The private transport signs this optional scope only when present, preserving
legacy signatures without it. Release the compatible native verifier before
the new web proxy forwards the header. For rollback to a native verifier that
does not support it, restore the older web proxy first. No schema change is
needed for this feature.

## Local verification

Run `node --test test/*.test.mjs` for client, HTTP, workflow, and recovery
regressions. Build `@atlas/grading-core` and `@atlas/manual-workspace` first.
The current review fixture is
`../atlas-manual-workspace/scripts/unified-review-fixture.mjs`; the obsolete
paired-editor development app and its browser driver are removed.

Owned PostgreSQL checks use the existing manual-service fixture with an
explicit disposable local database acknowledgement. The human variant
confirmation qualification is
`../atlas-connected-manual/scripts/validate-human-variant-confirmation-postgres.mjs`.
It validates the registered migration chain, ordinary authenticated staff
confirmation, immutable actions, and historical row preservation without
provider calls. It is metadata qualification, not optical grading acceptance.
