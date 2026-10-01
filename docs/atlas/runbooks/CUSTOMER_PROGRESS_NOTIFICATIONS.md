# Customer card progress notifications

This is connected implementation, qualified in a disposable PostgreSQL fixture. No message provider was called and no production activation is recorded here.

`ProgressPreferences({csrf})` uses authenticated `/account/api/customer/notifications` GET/POST. The current account is resolved by the existing session gateway; the caller supplies neither a destination nor an account ID. Email/SMS start off independently. A save uses an expected revision and an immutable request ID; replay cannot apply a different setting. Ordinary sign-in codes and payment receipts remain separate. Email uses the profile email and SMS uses the verified account number.

`20261001004000_customer_progress_notifications` must follow capacity, phone checkout and dealer handoff migrations. It adds preferences/audit, a notification control initially disabled, and an outbox. The current customer and private gateways are wrapped with their existing grants transferred; no table, arbitrary SQL or notification-provider authority is added to public/customer clients.

The outbox is populated in the same transaction as recorded events:

- Dealer `handoff_receipt` insertion: exact paid card set received by the authenticated shop.
- Dealer `custody_event` insertion: actual collection, ATLAS receipt, return/delivery and recorded delays. Customer self-declarations do not notify physical receipt.
- Dealer `manual_card_link` insertion: the same recorded association that makes existing tracking `IN_GRADING`; this supports “is being graded,” with no timer or inferred worker completion.
- Manual publication changing to `PUBLISHED` in production mode: approved report ready. Pending publication does not notify readiness.

There is no historical backfill. An existing preference must be opted in when the source event commits. Each event/card/channel has one immutable ID. At dispatch, the gateway rechecks account revocation, preference revision/channel, current contact and source validity. Superseded custody/publication and discarded grading cards are suppressed. Human card titles come from the saved paid card identity; absent titles use “Your card in order …”. Templates do not invent grades, delivery dates, tracking, customer names or physical custody.

The private customer runtime runs the worker only when `ATLAS_CUSTOMER_PROGRESS_ENABLED=true`; it also requires the existing enabled commerce provider configuration. Database `ProgressNotificationControl.enabled` is a second independent cold gate. Reused provider settings are the existing `ATLAS_COMMERCE_EMAIL_PROVIDER/API_KEY/FROM` and `ATLAS_COMMERCE_SMS_PROVIDER/ACCOUNT_SID/API_KEY_SID/API_KEY_SECRET/SERVICE_SID` values; Verify credentials are not used. Sender/domain/service qualification and normal opt-out behavior must be verified through the existing provider account before activation. Do not infer this readiness from source or test fixture success. The component truthfully reports that progress delivery is unavailable while its database control is off.

Each claim commits before external I/O. SendGrid acceptance and Twilio status are retained as provider outcomes, not relabeled as delivered. A thrown send or stale dispatched claim becomes `UNKNOWN`. Polling does not send it again. A lost finish acknowledgement is reconciled by preserving the original claim; no new provider request is allowed. Turning a channel off suppresses pending unclaimed messages; an already dispatched request may finish.

Qualification commands:

```sh
node --test packages/atlas-commerce/test/*.test.mjs frontend/atlas-customer/test/progress-notifications.test.mjs
node frontend/atlas-customer/scripts/validate-dealer-postgres.mjs --ack-disposable-local-postgres --postgres-bin /path/to/existing/pg17/bin --pg-module /path/to/existing/pg
```

The 2026-10-01 fresh registered-chain native PG17 run passed 16 groups (95 public / 66 staff migrations) with zero network providers: immutable receipts, membership/session isolation, default-off preferences, exact replay, no history backfill, atomic per-card/channel enqueue, concurrent single claim, unknown quarantine, opt-out/contact suppression actual grading-start linkage, and a synthetic PRODUCTION publication transition under the exact restricted publication writer grants. Only the publication trigger runs as its owner with a pinned search path; the writer still cannot read customer/dealer tables or invoke enqueue directly. Receipt: `/private/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/atlas-staff-db-Y9Bvbj/dealer-result.json`. Root owns operational activation and production delivery qualification.
