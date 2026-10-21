# ATLAS ownership contracts — local foundation

October 21, 2026. This is a tested, unregistered proposal in the isolated `codex/atlas-marketplace-foundation` checkout. It is not a production ownership service, legal-title determination, deployed collection or marketplace. It changes no existing migration, runtime composition, route, package export, provider request, grading record, saved photograph or Ten Kings data. The detail/identity/history release and SQL009 remain independent.

## Scope and source

The lane owns only these new files:

- `packages/atlas-connected-manual/src/card-ownership-contract.mjs`
- `packages/atlas-connected-manual/src/card-ownership-service.mjs`
- `packages/atlas-connected-manual/sql/card-ownership-proposal.sql`
- `packages/atlas-connected-manual/test/card-ownership.test.mjs`
- `packages/atlas-connected-manual/scripts/validate-card-ownership-postgres.mjs`
- This audit.

Root owns integration, the shared session log, commits and every production action. No production database connection, notification, paid search, payment, print or tag operation was performed. The original dirty/conflicted checkout was not modified.

The contract uses the existing independent ATLAS `public_report_identity.card_id`, certificate and report token. A new approval does not create another physical-card identity or change an existing owner's preferences. Staff workspace `owner_id`, submission account, grading approval, public report knowledge, custody and NFC remain distinct from reviewed current title. Unknown title remains `UNKNOWN`; a pending or rejected claim does not create ownership.

## Write and authorization boundary

The future SQL creates a private `atlas_ownership` schema containing an append-only event journal and a separately provisioned reviewer-authority table. Current ownership and settings are derived from events, without a competing mutable owner column or copied grading/media record. Every mutation retains a request UUID and hash; exact authenticated replay returns its minimal recorded receipt and changed input under the same UUID conflicts.

Customer operations accept the existing CustomerAuth cookies and CSRF. The Node adapter requires a separate database role with no table privileges and exactly the one authenticated ownership gateway. SQL rechecks the current customer account, browser, session, access version, release/control binding and expiry under the existing account/session locks. A client-supplied owner ID or capability object is never authority. Customer JSON may identify a transfer's proposed recipient; it cannot name the acting owner.

Initial claims retain a bounded private evidence reference UUID and SHA256. An ordinary submission or a scan never creates a claim automatically. Verification requires all of:

1. A real current `REVIEWER` staff session and the existing card ACL.
2. A current, separately provisioned ownership-review grant.
3. An explicit reviewed staff-to-customer identity binding in that grant, so the reviewer cannot verify their own customer claim. Staff and customer phone hashes use different namespaces and must not be compared as if they were the same identity key.
4. The exact pending claim, a separate reviewer evidence reference, unchanged current ownership revision and no established owner.

The evidence references describe what the authorized reviewer attested to reviewing. This increment does not upload, retain or inspect underlying documents, automatically validate title, or establish an approved legal/consignment policy. Before operational use, root must connect an authorized private evidence-retention/review workflow and provision genuine reviewer identity bindings with reviewed authorization. There is no serving route or grant-provisioning endpoint in this proposal.

Off-platform transfer requires the authenticated current owner's proposal and the exact recipient's authenticated acceptance. The proposal is bound to current ownership revision and a bounded expiry of one minute to seven days. The sender may cancel. Acceptance rechecks the sender account, recipient, unexpired proposal, title revision and prior disposition. Competing acceptance commits only one ownership event. A revoked sender cannot complete a pending transfer. Replaying a recorded receipt never re-executes a transfer.

Transfers record the participants' authenticated instruction, not a payment, sale, delivery or current physical-possession claim. Initial claim conflicts, disputes, corrections/revocations of established title, estates/representatives, commercial transfer timing and reholder association are outside this bounded implementation. They require explicit later contracts; this writer cannot silently replace an established owner through a new claim.

## Locking and preservation

Mutations serialize their actor's request identity and lock the existing manual card, permanent identity and intake card in that order. Staff ACL rows are locked before the identity wait. After acquiring intake protection, the writer rereads discard evidence using a fresh statement snapshot. This matches the existing discard writer's intentional intake-only locks and prevents an old pre-wait result from authorizing a discarded card. Final customer or staff session/authority refresh occurs before append, including after a reviewer waits for the claimant account row.

The journal rejects UPDATE/DELETE through the existing immutable trigger; serving roles cannot read/write its tables, reviewer grants, helpers or sequences directly. Original grading/action/approval/publication, receipt/custody and commerce rows were compared before and after the normal synthetic ownership journey and remained equal. Later controlled-race tests intentionally changed only their synthetic ACL/tombstone/auth fixtures; they are not included in that preservation assertion.

Custody is reused through the existing recorded `ATLAS_RECEIVED` link. The owner projection reports only `RECORDED` or `UNKNOWN` and always `currentPhysicalHolder: UNKNOWN`. This lane adds no second custody writer and does not label ownership as custody. A future current-holder service or additional physical event requires actual sourced custody evidence and its own authorization.

## Owner collection projection

`projectOwnerCollectionCard(record, viewerAccountId)` returns only explicitly verified current ownership for that exact account. Unknown or other-account records return null. The SQL customer read refuses the same cases. Collection pages contain at most 50 cards, use a card-ID continuation and recheck current title for every request; they are current views, not a historical snapshot or total collection count. Empty collections still expose their account's settings. Historic ownership, wanted and for-sale views remain later work.

The coordinated frontend shape is `atlas-owner-collection-card-v1`: permanent card ID, verified account and title revision, independent card preference revision, card/effective visibility, raw card/collection offer opt-outs, conservative custody and the exact published approval/certificate/token/version/publicHash. It does not duplicate title text, grade, media, private evidence references or staff/customer contact fields. Root must join additional card detail through its appropriate authorized immutable source. Per-card embedded collection settings must agree with the outer collection preference snapshot.

All cards default to the `OPEN_TO_OFFERS` preference. Owners can disable per card or for their collection; either opt-out disables the effective preference. Card and collection visibility are separate. This local proposal defaults both private; effective visibility becomes public only when both are public. An original owner's explicit per-card opt-out is retained if they later reacquire the card, and a new owner's settings do not inherit another person's preference decisions.

An open preference never creates an offer recipient or delivery service. Every projection currently returns `canReceiveOffers: false`, `OFFER_DELIVERY_UNAVAILABLE` and `notificationDelivery: NOT_REQUESTED`, with independent private/opt-out reasons. No Make Offer, purchase, notification, seller eligibility, balance or public provenance authority can be inferred from these DTOs. There is no public ownership endpoint or consenting-handle publication in this increment.

## Qualification

Node 22.16.0 focused unit tests: **9/9 passed**. The tests exercise strict request shapes, fake actor/owner/NFC rejection, immutable redaction, unknown/non-owner exclusion, independent visibility/preferences, empty collections, CSRF, copied staff-capability rejection and narrow grant generation.

Final owned PostgreSQL17 evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-pg-05/postgres-result.json`; execution log: `/tmp/atlas-ownership-contracts-20261021/pg-05.log`. **Seven substantive groups passed**, with `stoppedVerified: true` and zero production queries, external provider calls, notifications or financial effects:

1. Ordinary real database-backed customer/staff sessions; unknown ownership; claim replay/conflict; separate reviewer grant, existing card ACL and self-review denial.
2. Owner-only card/collection settings with revision checks; private/open defaults; retained opt-out; no offer delivery.
3. Directed authenticated transfer, wrong-recipient/cancel denial, concurrent acceptance, owner access change and opt-out retention on reacquisition.
4. Competing initial claim reviews, rejected claim remaining unknown, bounded current-owner collection paging.
5. Controlled lock waits with ACL revocation and card discard; refused operations write no ownership event.
6. Reviewer grant expiry while blocked on the claimant account; the final refresh rejects verification and ownership remains unknown.
7. Private-table/helper denial, append-only enforcement, counterfeit release/browser/account input and revoked session/reviewer/sender rejection, plus normal-flow protected-row preservation.

SQL proposal SHA256 at final qualification: `00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2`. `git diff --check` passed. The proposal was applied only inside the owned fixture; the standalone migration registry and SQL009 were not edited by this lane.

Independent detail/media review identified the initial pre-wait ACL/discard race; collection/pricing review identified the claimant-row-wait expiry edge and requested matching collection preference snapshots. Those are fixed and covered above. Initial runs exposed a nonexistent plaintext staff-phone assumption and a fixture ACL update missing the existing manual revision increment; both were corrected, failed-run receipts retained and owned clusters stopped. Passing PG02/PG04 receipts are intermediate checkpoints, not the final source qualification.

Reproduction from this worktree, with installed dependencies only:

```sh
PATH=/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin:$PATH \
ATLAS_CARD_OWNERSHIP_EVIDENCE=/tmp/atlas-ownership-contracts-20261021/pg-05 \
node packages/atlas-connected-manual/scripts/validate-card-ownership-postgres.mjs \
  --ack-disposable-local-postgres \
  --postgres-bin /opt/homebrew/opt/postgresql@17/bin \
  --pg-module /Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg
```

Use a new evidence directory for a new run. The script creates/stops only its own local cluster and does not accept an ambient production URL.

## Root integration limits

No existing package export, HTTP route, customer gateway, startup check, worker composition or migration registry references this code. A fresh detail/SQL009 release may proceed independently. Future ownership integration requires a separately reviewed migration/role grant and evidence retention, real authorized claim/transfer UI, CSRF/private-route transport, account-scoped loading/error teardown, and operational policy acceptance. Do not label the complete R1 My Collection/provenance/custody or R2/R3 marketplace requirements finished based on these local contracts.

Read-only release cross-review confirmed the current native variant worker excludes `cardProvenance` and its readiness query, while the serving runtime requires SQL009 and the narrow manual EXECUTE grant. Root's same-approval label/presentation binding fix preserves actor-restricted label access and snapshot dates. This is source review, not a claim of a production release or complete artifact packaging qualification.
