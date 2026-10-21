# Dedicated card detail — local integration, October 21, 2026

> Historical initial integration record. Later owner-approved cleanup removed detail Inspect/zoom, reused the enlarged gallery slab and added the portrait Grade Report link. The optional 3D tab and contextual report return supersede the older preview/navigation description below; see `optional-3d-report-return.md` and `docs/handoffs/ATLAS_MARKETPLACE_LEAD_HANDOFF_20261021.md` for current source, preview and remaining work.

The owner authorized three new Astra Ultra specialists for the next increment: card-detail interface, dependable Front/Back media, and reviewed identity/history records. The lead integrated and qualified their work in `codex/atlas-marketplace-foundation`, starting at `5721a4b7`. This increment is not deployed. Current production remains the completed archive release described in the Deploy Runbook.

## Result

- Archive image/title/Open card links now open `/admin/graded-cards/:cardId`. The grading workspace remains a secondary link on detail. The approved gallery geometry is retained.
- The dedicated pure-white page presents the authentic approved photograph beside identity, certificate, exact final award and report action. Overview, Grade report, Sold comps and History are accessible keyboard/touch tabs. Category tiles use up to two decimals; expanded details retain exact saved scores and policy. Final grades are never recalculated.
- Shared media binds token, version and publicHash before verifying bytes. Two concurrent loads, bounded transient retries, independent side recovery and manual retry replace permanent failed-image state. Inspection includes Front/Back, zoom, full-size approved-photo access, native dialog focus and Escape behavior. Missing media never replaces or suppresses a saved grade.
- Detail projects only hashed immutable approval facts and saved same-approval selected sales. Submitted customer and staff display names remain behind current staff/card access. No private contact information, mutable draft, new market request, automatic valuation or ownership claim is exposed.
- Source-only SQL009 retains live session/role/card-ACL/discard checks and a fixed microsecond snapshot. Cross-review fixed private detail retention after a pagination 404, and the gallery now hides old account data before effects run. Access loss aborts requests and removes owned image URLs.

## Qualification

| Check | Observed result |
|---|---|
| Complete staff suite, Node 22 | 811 passed, zero failures/skips |
| Final focused UI/media/client suite | 48 passed after the final hook dependency correction |
| Complete connected-manual suite, Node 22 | 902 passed, zero failures, two existing environment-gated native measurement skips |
| Owned PostgreSQL 17 | Eight groups passed, including ACL/session revocation, snapshot-bound selected sales, exact 008→009 upgrade/no-op; cleanup `stoppedVerified:true` |
| Final production build | Passed; 32 browser chunks, 15 server traces, 2,016 traced files, `/admin` and database-engine boundaries verified |
| Actual-component browser | Desktop, 390px and 320px; no horizontal overflow; archive certificate search → detail; Front/Back/zoom; grade-group filtering; unknown accepted-offer amounts; keyboard tabs; history; missing-side retry; transient503 recovery; changed photo bytes rejected; access loss clears details/Blob links |
| Final visual/focus check | Exact-trigger return focus and Escape work. Global hover tint was corrected; photo button and stage are `rgb(255,255,255)`, including observed hover. Gallery geometry unchanged. |
| Existing public report path | Fixture source-report redirect reached the exact already-public Black Diamond Jordan version1/grade8; browser Back recovered the local detail page |

The initial complete staff suite preceded the final dependency-only media correction and CSS hover correction. The final focused suite covers the dependency correction; the final build and actual browser cover the hover correction. Unrelated existing build warnings remain. No new changed-component hook warning remains.

Evidence is retained under `~/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/detail-preview-20261021/`, including copied check logs and screenshots. Original check logs: `/tmp/atlas-card-detail-root-checks/` and `/tmp/atlas-detail-records-20261021/`. SQL009 checksum: `9e9361a6cfe6b057a306a347741d88911d4d9f654f3c01b71aefcbd95f74bc2f`.

## Preview and limits

The actual-component fixture is loopback-only, with synthetic staff/card IDs, certificate identifiers, submission/history records and two explicitly synthetic sale references. Eight exact already-public approved WebP photographs were copied read-only and verified against retained report hashes and byte counts. No signed URL is persisted. A fixture-only adapter maps only its synthetic fixed-origin photo grants to loopback; the real parser and byte verifier remain unchanged. This is neither a normal authenticated production session nor inventory imported into a database. Report navigation deliberately opens the already-public source report; unrelated grading/order destinations are outside the fixture.

The review URL for this running fixture is `http://127.0.0.1:58608/admin/graded-cards/38fd99a1-277b-46b0-b3fa-cf004c572d46`. The full desktop review image is `screenshots/detail-desktop-final.png` in the evidence directory. Fixture IDs regenerate on restart; start the fixture with `ATLAS_ARCHIVE_APPROVED_REFERENCES` pointing at its external `approved-references` directory.

The viewer displays exact 1350×1858 approved grading photos, not full-resolution raw intake masters. Automatic paired high-resolution slab masters, calibrated physical geometry, fresh real numbered/autograph/relic acceptance, ownership/My Collection, optional 1–5 comp curation/pricing and commerce remain separate work. Production integration still requires a fresh native/web release, unapplied SQL009/grant, both gateway paths and ordinary signed-in detail acceptance. No production migration, deployment/restart, paid provider request, approval, label/NFC write, customer notification or financial transaction occurred in this increment.


## October 21 successor media correction

The earlier SQL009 checksum above is historical. Final unreleased SQL009 now hashes to `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`. Actual backend review found that detail omitted the saved label and slab presentation although the gallery supplied them; the prior enriched preview fixture masked that difference. SQL009 now selects the same original-actor/owner-or-approver READY label and the service passes exact same-approval label/presentation evidence. Label creation and READY-update times must precede the cursor snapshot; inaccessible historical artwork after a newer approval is omitted. Approved Front/Back photographs remain independent. Released SQL008 is unchanged.

Node22 focused checks passed24/24; owned PostgreSQL17 passed all10 groups, including actual008/009 media parity, label permissions, later revisions/READY transitions, upgrade preservation and HTTP session revocation. The owned cluster stopped and removed only its regenerable files. Staff production build/boundary passed35chunks/15traces/2030files. Evidence: `~/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/provenance-pg-01/postgres-result.json` and `preflight/`. SQL009 remains unapplied; production is still the archive release. See [media readiness](../2026-10-21/media-source-readiness.md).
