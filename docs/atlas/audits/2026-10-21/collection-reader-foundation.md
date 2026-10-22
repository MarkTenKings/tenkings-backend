# My Collection reader — local foundation

This increment is locally implemented and qualified. It is not deployed or operationally accepted. At this reader qualification checkpoint, production was ca3a848d and signed-in detail acceptance was pending. Detail and later c1815115 gallery acceptance subsequently passed; see their dated audits. The separate Workspace review-entry correction is in progress.

## Behavior

The local customer app adds `/account/collection` through its existing account shell and a GET-only collection route. An injected, separately restricted ownership reader returns only the authenticated account's current verified ownership records, recorded preferences, exact certificates and published report bindings. It never infers ownership from a submission, staff ACL, custody or NFC.

The client loads bounded pages of 25 cards, replaces each page, labels search as applying to the current page, and distinguishes an empty collection from an unavailable service. Account replacement, sign-out start, access denial, pagehide and unmount clear or cancel private state; late replies cannot restore it. The read view exposes no settings writer, claims, transfers, offer delivery or commerce actions. Open to offers remains the default preference, independent of privacy and delivery eligibility.

Titles, grades, photographs and labels are deliberately not joined yet: a separately authorized exact-approval media reader is still required. Staff actor-bound label URLs cannot be repurposed for customers. Existing display-only privacy and pricing previews remain available to local tests without pretending to save settings.

## Security and activation boundary

`card-ownership-reader-proposal.sql` is unregistered. Its `atlas_ownership.customer_read` exposes only collection/card/preference reads and independently validates current CustomerControl, account, browser and session, including a final expiry check. A separate role must receive only this function. The service rejects table, sequence, private-helper or mutator access and broader roles. Existing `CustomerDatabase` and the combined ownership writer are not granted new capabilities.

Authentication retains shared row locks; “reader” means no business-row writes, not a PostgreSQL READ ONLY transaction. The local HTTP route reuses existing ingress/CustomerAuth checks, accepts only canonical bounded GET queries, returns private/no-store responses and never falls back to the combined writer.

No runtime reader client, environment binding, production grant, registry entry or customer deployment is configured. Therefore the local route returns unavailable when a reader is absent; it does not return a fabricated empty collection. The original ownership writer proposal, service and contract remain unchanged.

## Qualification

- Reader service: 9 Node22 unit checks.
- Customer handler/client/workspace and retained collection contract/UI: 41 focused Node22 checks, including stale responses and immediate access teardown.
- Root integrated routing/current-boundary/security: 11 checks. Normal Next-parsed empty GET bodies are accepted, while real request payloads, mutations and cross-site reads are refused.
- Customer production build and boundary check passed, including explicit `/collection` route allowlisting, packaged database engine and no ownership/database authority in browser chunks. Existing unrelated lint warnings remain; the new workspace dependency warning was corrected with stable callbacks and tested again.
- Actual-component browser: 1280px and 320px without horizontal overflow; first 25/next 1 cards, page-scoped search, empty/unavailable/denied states, pending-response access removal and late-response refusal. Synthetic fixture only, with network disabled. Current photographs or real ownership are not asserted.
- Owned PostgreSQL17 PG03: four substantive groups covering authentication/three reads/current owner/keyset/exact published approval, raw helper/mutator/table/sequence denial, unsafe-grant refusal, 17-table read/refusal preservation and revoked/lock-expired sessions. Exact task-owned cluster cleanup is verified stopped. Two earlier attempts stopped during synthetic seeding constraints and were retained; neither established a reader failure. Three SQL column references were qualified to avoid a PL/pgSQL variable ambiguity; final SQL was reviewed and qualified.

The 17-table census compares reads/refusals before deliberate synthetic session-revocation/expiry edits. It covers ownership event; manual card/action/approval/publication/public-report identity; manual-intake card/discard request/discarded card; customer account/session/browser/control/commerce order/payment; dealer custody event/manual-card link. It is not a production database preservation claim.

Evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/`.

| Evidence | SHA256 |
|---|---|
| Reader SQL | `696d8e4c152222dca60042e14904fc9cc89b2d09540f320de76f18cbbb74921b` |
| Reader service | `e8b97ac43eb23f5e0df836d75594123e1f78b6c97d7e9d5770f171e014650f76` |
| PG03 result | `cc8c3fedf890a69f76cd1209aba4e6c6fccc612c5df9954f7343969c64102aa2` |
| Exact cluster cleanup | `02a8aa070313546d40726de50d42b2b170591cc83624a3386185df1bf84b665c` |
| Browser result | `6c1fc9f8c96c10a5409a2985c9c22385c1c8318c455560f05881201a572d3a4e` |

Browser screenshots/build logs are under `collection-reader-preview/`; PostgreSQL result/cleanup/log under `qualification/ownership-reader-pg-03/`. The root's first build compiled successfully but the old exact route allowlist rejected `/collection`; that reviewed allowlist correction and final successful build are separately recorded.

## Remaining work

Detail acceptance subsequently passed. Integrate retained ownership-evidence binding, genuine independent reviewer provisioning, claim status/review queue, participating transfer inbox and recipient resolution. Define supported disputes/corrections and reholder continuity. Qualify and register a fresh ownership release with separate serving roles; connect the customer reader and exact authorized media. Persistence of privacy/offer preferences and optional comp curation/pricing is still unfinished. Customer provenance and full collection search/history/social remain unfinished.

No new production schema, ownership, approval, paid search, message, balance, sale, print or NFC operation occurred. All 30 master-plan requirements remain in scope; this local reader is not completion of R1.
