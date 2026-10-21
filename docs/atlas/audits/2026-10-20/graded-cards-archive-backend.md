# Staff graded-card archive — backend qualification

This change was built on released source `fbb2f2d2` in the isolated `codex/atlas-marketplace-foundation` worktree. It is source and owned local PostgreSQL evidence. No production database, customer record, provider, payment, deployment or physical-finishing operation was accessed or changed.

## Implemented contract and authority

`GET /api/staff/manual-connected/graded-cards` is available through the existing signed native-service transport and the staff same-origin `/admin/api/staff/manual-connected/graded-cards` proxy. It accepts a literal trimmed `q` of up to 120 characters, `category=SPORTS|POKEMON`, inclusive UTC approval dates `from` and `to`, an opaque cursor, and `limit=1..50` (default 24). Unknown or duplicate query parameters, malformed dates, filter-swapped cursors and mutation methods are rejected. Responses are `private, no-store`.

Each page contains at most the requested number of cards and `nextCursor`; no total count or unbounded download is introduced. Identity and grade come from the immutable `atlas_manual.approval.report`, and the certificate and token come from the existing one-per-card `atlas_manual.public_report_identity`. Pending publication remains a real approved row with no public report or media URL. Published links always include the selected approval version. The archive does not create a second card registry or an ownership assertion.

The list searches approved card identity, certificate, approval date, approver and human review staff names, paid submission reference/customer name, channel and dealer location name. A singular grader is not inferred from arbitrary staff activity. `reviewers[]` contains distinct recorded preapproval human action actors; `approver` is separate. Customer attribution is explicitly submission provenance. Neither a staff workspace owner nor a submission customer is presented as the current physical-card owner.

The only cross-schema private projection is the narrow SECURITY DEFINER function `atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)`, with fixed `pg_catalog` search path and PUBLIC execution revoked. It independently verifies the bound staff session/browser, exact release configuration, current phone roster and REVIEWER role. The manual runtime receives only EXECUTE on this function, not SELECT on customer orders or staff identities. Current card ACL and discard state are checked on every page.

Pagination carries a fixed microsecond snapshot and `(approved_at,card_id)` keyset. Each physical card uses its latest approval at that snapshot. Later approvals and newly approved cards cannot move rows between existing pages; current ACL revocation still removes a row immediately. Optional image/label evidence is projected through `archiveApprovedMedia` and never exposes object keys, signed storage grants, customer email/address, payment identifiers or internal source hashes. See [the media audit](approved-card-media.md) for exact media provenance and composition limits.

## Registered migration and readiness

The additive migration is `atlas-standalone-008-graded-cards-archive`, SQL SHA256 `734094259335780542e0b53ae5b4d663a057283d670d700119f4cbc4cf05f063`. It adds one approval-order index and the read-only function, with no table creation, row backfill, data rewrite or new commerce/ownership state.

A future authorized release must apply the registered migration and grant the serving role EXECUTE using `gradedCardsGrantSQL(role)` or the current standalone runtime grant generator. The runtime grant generator conditionally includes the archive grant when the function exists, preserving historical-prefix qualification. Native startup requires both the installed function and its EXECUTE grant; missing requirements fail with `GRADED_CARDS_SCHEMA_REQUIRED` or `GRADED_CARDS_GRANTS_REQUIRED` before the native host listens. An existing frontend proxy being enabled does not prove remote health. The archive UI renders an explicit unavailable/error state on a failed read and does not convert failure to an empty successful archive.

The serving container source collector includes new connected-manual source modules automatically. Standalone migration SQL remains in the separate owner-executed migration path and is intentionally excluded from the serving artifact. The site's `/admin` route classification is generic; any external private ingress allowlist must still be checked during release preparation for the exact new GET path. No ingress configuration was changed live.

## Owned PostgreSQL result

Command (explicit existing binaries/module; no install or ambient database URL):

```sh
PATH=/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin:$PATH \
ATLAS_GRADED_CARDS_EVIDENCE=/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/archive-qualification \
node packages/atlas-connected-manual/scripts/validate-graded-cards-postgres.mjs \
  --ack-disposable-local-postgres \
  --postgres-bin /opt/homebrew/opt/postgresql@17/bin \
  --pg-module /Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg
```

Result: `GRADED_CARDS_POSTGRES_PASS`, six groups passed, zero production queries/provider calls, owned-cluster cleanup `stoppedVerified=true`. The retained receipt is `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/archive-qualification/postgres-result.json`; these results are also recorded here so the evidence does not depend on that local file alone.

1. Actual least-privilege staff service reads immutable approved identity, saved half-point grade, certificate/version, named review actors and a real synthetic paid dealer-order/customer/manual-card link. Mutable draft identity, inaccessible cards, discarded cards and unapproved cards are excluded. Pending publication has no public/media URLs.
2. Literal percent/underscore and SQL-like search, certificate/name/reviewer/approver/submission/dealer/channel search, category filters and inclusive UTC microsecond date boundaries pass. Protected card, approval, report identity, publication, order, payment, effect, link and custody rows compare exactly before and after reads.
3. A new approval and a newly approved card are inserted between keyset pages. The original page walk retains the historical approval and returns each physical card once without skips or duplicates; a new page walk sees the new state. Revoked reader access is respected on the next page.
4. Actual SQL independently rejects forged session/browser/release/roster, observer and malformed inputs. The customer role cannot execute the archive function. The manual role cannot directly SELECT customer orders or staff identities.
5. The actual connected HTTP handler reaches authenticated PostgreSQL and returns the private DTO/cache policy. Revoking the session makes the next list read fail.
6. A separately owned fresh database installs baseline and registered 002–007, retains synthetic staff/card/action/approval/identity/publication rows, then applies only 008. All protected rows and prior ledger checksums/timestamps remain unchanged. A repeated release is a no-op. The full current baseline plus 002–008 also qualifies.

The first actual pagination run found a JSON-operator precedence error in cursor validation. The final SQL parenthesizes the extracted page object, and the complete qualifier passed after the fix. This is why the database qualification is separate from mocked unit tests.

## Regression evidence and baseline fixture correction

The focused API/query/media/migration group passed 17/17 with zero skips. It includes a real local signed proxy/private HTTP server round trip, strict auth/query behavior, privacy allowlisting, media bindings and startup readiness checks. The standalone migration checksum/ledger tests pass.

The first complete connected-manual suite produced 854 passes, one failure and two existing skips (857 tests). The failure was the unchanged baseline `finishing.test.mjs:61`: the unknown-metadata fixture expected `Stephen Curry 135`, while the already released shared market query returned `Topps Stephen Curry #135 graded 9.5`. The isolated original test reproduced the same failure. Before editing, `git diff --exit-code fbb2f2d2 --` the test, publication fixture, finishing/publication/publication-repository/presentation-market/research-market-query source and the finishing/report/workspace/grading dependency trees was empty. Baseline test blob: `8bf64f49082c46780be7a7ce8db6ca8f16f1c3e1`; baseline presentation-market blob: `a8b812c7b26a0b6388aa6402f6c27f06d1609aa6`.

Only the three explicit fixture query expectations were corrected to the released behavior, including the recorded 9.5 grade; no query implementation changed. All eight finishing tests then passed. The assertions still reject invented unknown metadata and verify immutable approval/publication/label identity and grade preservation. After the narrow proxy-contract packaging split, the complete connected-manual suite passed: 857 tests, 855 passes, zero failures and two existing environment-gated skips. The skips are native measurement-process tests requiring `ATLAS_MEASUREMENT_PYTHON`; no geometry/measurement code changed. The complete standalone-database suite passed 7/7 with zero skips. The actual PostgreSQL qualifier was repeated against the final split and again passed all six groups with verified cleanup. `git diff --check` passed. The staff production build and boundary qualification independently passed with only the transport and pure archive contract in the connected-manual proxy closure; archive service/handler/media stay on the native side.

## Limits

These tests prove source behavior with synthetic data and owned local PostgreSQL. They do not establish live migration state, production image delivery, card ownership, marketplace listing eligibility, payment settlement, measured production search capacity or physical slab/NFC completion. Search currently derives approved summaries on read; the page is bounded, but broad search still scans authorized approval summaries. Optional presentation JSON is bounded by its existing contract yet may be substantial across 50 rows. Measure representative production query plans and response work under separate read authorization before claiming large-catalog capacity.
