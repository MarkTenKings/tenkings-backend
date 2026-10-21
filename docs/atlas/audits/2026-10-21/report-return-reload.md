# Exact report return across Next bootstrap

The ordinary signed-in production browser exposed a gap in ca3a848d: detail → exact report → Card Detail worked, but a full report reload removed the return link. Next15.5.25 replaces history state before React renders. Earlier fixture tests retained that state and therefore did not exercise the production bootstrap lifecycle.

The local correction captures an already-valid history entry when the report module loads, before Next constructs its router. The effect consumes that document-local context once and restores it beside Next's own state. Exact origin, report token/version, allowlisted card path and age are checked at capture and use. The two-minute initial handoff and 30-minute history limit remain. No report-to-card storage map, URL parameter, referrer or saved-report field is added. Fresh direct/new-tab/NFC entries still have no private return.

## Qualification

- Fifteen focused checks pass, including the installed Next Router constructor reproducing the old loss and successful restoration. Independent review confirmed actual Next entrypoint/router/render ordering and the single-use boundary.
- Public production build/boundary passes:14browser chunks,14server traces,682traced files, no staff/write routes or database engines. Public tests pass81/81 with no skips. The first test run overlapped the build's generated dependency rewrite and failed one module import; the sequential rerun after build completion passed. This was a qualification scheduling error, not a production result.
- An isolated local proxy served the actual click helper and actual public Next production build. The report deliberately had no backend and truthfully rendered unavailable. Its contextual return survived a full reload, returned to the exact synthetic navigation fixture, and disappeared on a fresh direct report entry. No browser state was injected, no real session was manufactured and no production records were used by this fixture.
- Initial real-card evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/browser-acceptance/acceptance-initial.json`, SHA256 `8384ff8092c8e8976c56d296f4caa016038dc7be340415f840f2e64de83f2403`. Four real Front/Back details and labels loaded, archive search/filter/table passed, optional3D controls and original report versions were observed. Chrome's requested320px viewport resolved to355px;355/1625both had no horizontal overflow. Unchanged local320px evidence remains separate.

## Production release and actual browser acceptance

Public source `105270bcf29db376d5bf756edd91b29516420a98` is deployed as `dpl_QrEgUVB8qLb8hkru4ojhD8xqq4BZ` / `atlas-grading-public-6wppxvez9-ten-kings.vercel.app`. This isolated ca3-based commit changes only the two report-return serving files. PublicReaderControl is revision99, with unchanged configuration hash. Native/staff stay on ca3a848d, customer stays on c68e9ea7, SQL009 and both gateways remain retained. Later local ownership/collection and the staff gallery are excluded.

Exactly two source uploads, one staged production build, one public control CAS and one same-build promotion were performed. CAS acknowledgement was `2026-10-21T23:26:06.559Z`; promotion was accepted at `2026-10-21T23:26:32.904Z`. The two services do not provide an atomic cutover, so no zero-interruption claim is made. No native process restart, migration, project environment change, business-row write, paid search, notification, printing or tag write occurred.

The first read-only activation preparation stopped before a plan or effect because observation timestamp casing violated its filename allowlist. Its evidence remains intact; a fresh successor changed only timestamp casing and added a regression. Promotion then returned an empty successful HTTP201, which was retained without parsing or replay. Strict finalization caught Vercel's public cron bookkeeping update: its definitions remain empty, enable/disable fields are identical, and only deploymentId/updatedAt advanced. A separate filesystem-only finalizer validated the exact complete before/after objects, then reran all original control, target, alias, configuration and environment checks against a fresh read-only observation. No consumed helper or plan was changed.

Fresh canonical checks passed27 route/asset/auth-boundary checks, four exact reports and eight original photograph hashes. This is43 recorded responses plus8 streamed photo reads. Native read-only health passed with zero restarts and retained gateways; this was not a new frozen census of actively changing business records.

In the owner's ordinary signed-in Chrome session, the exact Jalen Hurts version2 report kept **Card Detail** after a full reload and returned to the correct card/certificate. A fresh direct visit and direct reload had no private return link. The new report chunk and Front-default detail were observed;1625px had no horizontal overflow. The earlier four-card gallery/media/history acceptance remains evidence. A first test selector included an aria-hidden arrow; DOM inspection corrected the accessible name to Card Detail without an application change.

Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-report-return-reload-20261021`. Original consumed packets remain evidence, not rerunnable scripts.

| Evidence | SHA256 |
|---|---|
| Candidate qualification | `211c4516f87e4427523184e6ba9abdb540107cb59b155975aec046757a3183f0` |
| Activation plan | `abe18200ac72ecb57d71e7e6722e8be69512051c0a366d1c2d670db1a8f51969` |
| Control CAS | `c03de696e97b3d448fad985bf7a79fbfcde54484e282ba0b4f5e3af6f9559338` |
| Exact read-only promotion finalization | `08996a3c0bb959a1cf79cc3728382a41fb35510a7c55f92772c1fc12352e2df5` |
| Canonical checks | `084b76397842dbb0ab527962c084daaa8eed4257422c23d7800ceefd5ec93bdb` |
| Actual browser acceptance | `757701cd7116785b6f3fab75e256b4f8b6db22131c894baf8b3491ab51fce8b0` |
| Native retained health | `cd8d5eec1e5b8b2878105a0dc240cc3ee9ecec9eb75da2d95a4b5ebc82255c14` |

The owner separately queued the original-upload staff workspace gallery redesign; implementation now proceeds after closing this correction. All30 marketplace requirements remain tracked. Owner3D appearance, physical media/calibration, new Sports optical performance and completeR1 remain unaccepted.
