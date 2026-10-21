# Exact report return across Next bootstrap

The ordinary signed-in production browser exposed a gap in ca3a848d: detail → exact report → Card Detail worked, but a full report reload removed the return link. Next15.5.25 replaces history state before React renders. Earlier fixture tests retained that state and therefore did not exercise the production bootstrap lifecycle.

The local correction captures an already-valid history entry when the report module loads, before Next constructs its router. The effect consumes that document-local context once and restores it beside Next's own state. Exact origin, report token/version, allowlisted card path and age are checked at capture and use. The two-minute initial handoff and 30-minute history limit remain. No report-to-card storage map, URL parameter, referrer or saved-report field is added. Fresh direct/new-tab/NFC entries still have no private return.

## Qualification

- Fifteen focused checks pass, including the installed Next Router constructor reproducing the old loss and successful restoration. Independent review confirmed actual Next entrypoint/router/render ordering and the single-use boundary.
- Public production build/boundary passes:14browser chunks,14server traces,682traced files, no staff/write routes or database engines. Public tests pass81/81 with no skips. The first test run overlapped the build's generated dependency rewrite and failed one module import; the sequential rerun after build completion passed. This was a qualification scheduling error, not a production result.
- An isolated local proxy served the actual click helper and actual public Next production build. The report deliberately had no backend and truthfully rendered unavailable. Its contextual return survived a full reload, returned to the exact synthetic navigation fixture, and disappeared on a fresh direct report entry. No browser state was injected, no real session was manufactured and no production records were used by this fixture.
- Initial real-card evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/browser-acceptance/acceptance-initial.json`, SHA256 `8384ff8092c8e8976c56d296f4caa016038dc7be340415f840f2e64de83f2403`. Four real Front/Back details and labels loaded, archive search/filter/table passed, optional3D controls and original report versions were observed. Chrome's requested320px viewport resolved to355px;355/1625both had no horizontal overflow. Unchanged local320px evidence remains separate.

## Release state

Locally qualified, not yet deployed. A fresh public-only successor is being prepared from ca3a848d plus the two serving changes. The later ownership/collection source is excluded. Only PublicReaderControl and the public deployment will advance after qualification; native/staff/customer, SQL009, both gateways and all other controls remain retained. Existing consumed release packets are evidence and will not be replayed.

The owner separately queued the original-upload staff workspace gallery redesign. It remains planned after this active correction; all30 marketplace requirements remain tracked. Owner3D appearance, physical media/calibration, new Sports optical performance and completeR1 remain unaccepted.
