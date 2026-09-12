# ATLAS manual workflow integration

Server composition for the clean manual build, plus an authenticated local
browser fixture. No serving application imports this package yet. The staff
schema proposal remains inactive outside owned disposable tests.

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

## Local verification

The fixture uses actual existing DurableStaffAuth bootstrap/challenge/cookies,
an explicitly synthetic SMS provider, native local PostgreSQL, private immutable
files and the actual CPU engines. It does not fake measurements or authentication.
Its card pixels are generated synthetic fixtures. It is fixed to loopback4318
and accepts only the ownership-checked disposable PostgreSQL helper's binary/
module arguments, never an existing database URL.

Run `node --test test/*.test.mjs` for client/HTTP regressions. Build
`@atlas/grading-core` and `@atlas/manual-workspace` first. For browser verification,
set `ATLAS_FIXTURE_PYTHON` to the qualified absolute CPU environment and
`ATLAS_BROWSER_EVIDENCE` to a task-owned output directory, then run:

```sh
node scripts/preview.mjs --ack-disposable-local-postgres \
  --postgres-bin /absolute/path/to/native/bin \
  --pg-module /absolute/path/to/pg
node scripts/browser-check.mjs
```

The fixture reapplies the existing migration chain and inactive manual proposal
only in its fresh owned database. Stop its exact process with SIGTERM to close
the web server, disconnect clients and verify the owned PostgreSQL shutdown.
Keep its startup, cleanup and browser evidence. Native validation used macOS,
Node25.6.1 and PostgreSQL17.10; it is not deployment-runtime qualification.

Still separate: live photo/provider storage and ordinary app intake, real-card
optical/HDR acceptance, the shared identifier/research application wiring,
detector/SAM/Astra integration, deliberate learning publication, public report
URLs and physical finishing. No report approval publishes a lesson, certificate,
label, inventory/ownership change or physical-work completion here.
