# ATLAS graded-card archive — integrated source acceptance

October 20, 2026, local Pacific time. Source baseline `fbb2f2d2`, isolated branch `codex/atlas-marketplace-foundation`. Three `gpt-6-astra` agents at `ultra` effort delivered the archive backend, staff UI and approved-media contract, with lead integration and browser review. The original dirty/conflicted checkout was not modified.

## Delivered increment

- Reviewer-only **Graded cards** navigation/page, pure-white visual gallery and practical table. Query searches the complete authorized approved archive rather than only the currently loaded page. Includes category, inclusive UTC approval dates and bounded pagination.
- Immutable approved identity/grade/certification, named approver and recorded human review staff, exact report revision and minimal paid-submission/customer/dealer context. Original saved fractional grades are retained.
- Card links open the existing detailed workflow and reports. Exact submission links open the existing order desk by a validated UUID, including orders outside its first queue page. Page authorization precedes interpreting the query. Duplicate/invalid hints are ignored. Navigation performs reads only.
- Real approved photos, optional retained label and optional actual slab photo use the source-binding rules in the media audit. The digital holder remains illustrative and is labeled accordingly. No synthetic inventory is shipped in the application.
- Order desk read requests now share an access-loss generation. A late queue/detail response cannot repopulate private data after either read loses access. Dispatched acknowledgment writes and uncertain/accepted recovery journals remain intact.
- The signed staff proxy imports only the new pure archive query contract. Private service, HTTP handler and media implementation remain outside the staff serving artifact. Missing migration/grant causes private native startup to fail before listening.

## Verification

| Surface | Final result |
|---|---|
| Complete staff-app suite | 765 passed, zero failed/skipped |
| Complete connected-manual suite | 855 passed, zero failed; two existing native-measurement tests skipped because `ATLAS_MEASUREMENT_PYTHON` is absent |
| Complete standalone-database suite | 7 passed, zero failed/skipped |
| Owned PostgreSQL qualification | Six groups passed against real PostgreSQL 17; migration 007→008 preserves protected rows and prior ledger; repeated migration is a no-op; owned cluster stopped and verified |
| Staff production build | Node 22 build passed; 28 browser chunks, 14 server traces, 1,881 traced files; `/admin` mount and database-engine boundary checks passed |
| Browser | Actual compiled React archive and shared styles, GET-only synthetic loopback fixture; search, paging, dates, table, failures, access loss and phone layouts qualified |

The connected suite initially exposed one stale baseline finishing-test expectation. The backend audit records reproduction against the unchanged released source and the three test-only expectation corrections; actual search behavior was not altered. Existing unrelated hook warnings remain in the build; new archive scoped lint is clean.

Browser evidence:

- Initial 24 records → Load more → 26; searching **Second page specimen** returns the record beyond page one. Pokémon filter returns 13.
- `2026-10-02` through `2026-10-02` persists in both controls and returns the exact matching record. Submission uses rendered named form values, covering native date/autofill changes.
- No-match search displays a useful empty state. Injected 503 displays an error, and Try again recovers. Held Kobe search superseded by Charizard displays only the latter results. Access-ended while a read is held leaves no private card results after release.
- Injected image failures display **Photo unavailable** while preserving the saved grade and card/report links. Restoring the fixture and reloading returns images. Final browser error/warning logs were empty.
- At 1280px, all four slab hard left edges, metadata and primary actions align within 0.002 CSS pixels; actions match the visible slab width. Media and archive surfaces are `rgb(255,255,255)`.
- At 390px and 320px, document width equals viewport width. Date inputs measure 174.4px and 142.2px respectively after the mobile filter fix. The wide table scrolls inside its own container, without widening the page. Temporary viewport overrides were reset.

Evidence directory: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/integration/` contains `staff-tests-final.tap`, `staff-build-boundary-fixed.log`, `archive-desktop-controls.png`, `archive-desktop.png` and `archive-mobile.png`. Backend evidence and its repeat qualification receipt are described in [the backend audit](graded-cards-archive-backend.md). Approved-source and original-resolution distinctions are in [the media audit](approved-card-media.md).

The browser uses synthetic records and approved-design sample media; it does not demonstrate live customer inventory or real authentication/storage delivery. Actual auth/HTTP/SQL authority is qualified separately against the disposable database. Existing detail/report destination behavior is retained, with exact link and actual-component order navigation tests; the synthetic browser server does not emulate those destination pages. No production migrations, deployments, grading, paid comp calls, label printing, tag writing, notifications, marketplace sales or money movement were performed.

## Release requirements and next work

Before a later production release, record the planned action in SESSION_LOG, apply registered migration `atlas-standalone-008-graded-cards-archive` and narrow execute grant, qualify both outer gateway GET paths, release the compatible native service and staff artifact, then verify a real authorized approved card and linked order. Preserve prior immutable approvals and follow the current deployment runbook. Do not advertise large-catalog performance before representative query-plan measurements.

This is the archive increment of Release 1, not completion of Release 1 or the marketplace. The [complete 30-item master plan](../../plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md) remains authoritative for remaining numbered/autograph/relic review, provenance and separate ownership/custody, My Collection/privacy, optional 1–5 comp curation, price guidance, and later listings/checkout/fulfillment/protection/balances/social expansion. Final original-resolution paired slab masters still require physical geometry and immutable output-pair qualification.

## Subsequent live-baseline correction

Fresh release preparation found that live native source `3256af83` was not an ancestor of the initial `fbb2f2d2`/archive branch. The source-local results above are historical evidence, not proof that all live behavior had been retained. Merge `c4b7cc85` explicitly joins archive `4a7a2fba` and live `3256af83`, retaining all five live shared-query modules byte-for-byte and public-photo source `eafcec14`. Finishing-test expectations were corrected to the actual live full-set/`psa9.5` behavior without changing that search behavior. Requalification passed staff 765/765, connected 873 passes plus two existing measurement skips, standalone 7/7, actual PostgreSQL six groups, and isolated candidate-image Linux 229/229. Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/release-02/`. This correction and qualification do not themselves establish production activation.
