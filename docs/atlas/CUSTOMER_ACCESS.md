# ATLAS customer accounts and progress

Owner direction: September9,2026. This records the experience selected by Mark in the [canonical blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md) and complements the [website release](WEBSITE_RELEASE.md). The customer app and staff intake are implemented and deployed in the current c5ba35fb release. The latest155-scenario PostgreSQL suite includes the retained customer scenarios and SMS-budget checks. Mark confirmed live customer delivery, resend after expiry and sign-in; database readback confirms one account/session and the browser shows the authenticated submission form. The initial SMS policy admits only the approved owner phone; broader customer and real-card acceptance remain pending.

## Customer journey

The public website provides entry points to submit cards and sign in. The customer account area is `/account`; the private grading workspace is `/admin`. The original marketing design is restored at the apex with working account/submission links; its separate Site version21 is also preserved.

1. Enter a mobile phone number.
2. Receive an SMS verification code and enter it.
3. On successful verification, create and sign into a first-time customer's account, or sign into the existing account for a returning customer. The customer sees one continuous flow and does not choose between signup and sign-in.
4. Open the customer dashboard. It shows the customer's submissions and each card's recorded progress; an account with no submissions has an appropriate empty state and a Submit cards action.

Initial account creation requires only verified phone access. Do not add name/address fields, a password form or a separate signup path to this first interaction. Request the customer's name and shipping/return address as part of their first grading submission. Save those details to their profile for future submissions and let them review/edit them before submitting. Later profile edits must not silently alter an already-confirmed shipment's address; the submission retains its confirmed address snapshot.

Mark confirmed during implementation on September 9 that customers can use **dealer drop-off or mail-in**. Capture the chosen intake method on the submission. This supersedes the earlier marketing draft's dealer-only claim. Show only configured dealer/mailing instructions and do not invent a destination, price, carrier label or turnaround guarantee.

The code-entry screen supports mobile one-time-code autofill, clear invalid/expired-code feedback, correcting the phone number and a controlled resend. Mark subsequently requested ordinary10-digit U.S. entry: show U.S. as the default, add+1 automatically, accept common punctuation and preserve explicitly prefixed international numbers. Normalize all accepted aliases to the same canonical number before uniqueness or rate checks. This convenience is deployed in c5ba35fb, including canonical input at the staff/provider handoff; existing pilot admission remains unchanged. Show the same account-entry flow to new and returning customers without revealing account existence before verification.

## Staff journey and authority

Staff use the same short phone → SMS code → signed-in flow through `/admin`. Their number must already have approved staff access. Customer self-registration cannot create an administrator, reviewer assignment, certification permission or trusted-learning permission. A person may be both customer and staff, but those are distinct authenticated sessions and scopes. A customer cookie is never accepted by a staff endpoint, and a staff session is not automatically a customer session.

The existing staff implementation already contains phone-code UI, a purpose-specific Verify transport, durable challenge/session handling, role/assignment checks and revocation. Reuse reviewed presentation and provider primitives where appropriate, while keeping customer account creation, credentials, rate limits, storage grants and authorization independent. Do not turn the staff allowlist into open self-registration or copy customer authority into it.

Both account and admin paths share the root website's browser origin. Review customer/public scripts and dependencies under that reality; cookie paths do not isolate same-origin JavaScript. The public approved-report serving role remains limited to its approved read functions. New private customer services require their own narrow serving permissions and account-owned projections.

## Progress tracker

The customer should see an understandable sequence such as submission created, received, grading, final review, encapsulation and shipping. Exact labels and source-event mappings are implemented together. A submission with multiple cards retains per-card progress and must not show every card finished because one completed a stage. Show a clear action-needed state when customer action is required, without exposing internal errors or private review notes.

Persist the ownership link from customer → submission → physical card before displaying its status. The authenticated customer identity comes from the session, not a caller-supplied account ID. Every list, detail, media and status operation verifies ownership. Changing a URL or card ID must not reveal another customer's private submission.

Record stage transitions from authoritative grading/review events and explicit physical operations. An upload does not prove a shipment arrived; report approval does not prove a slab was assembled; a label/NFC success does not prove shipment. Keep the customer view concise while preserving the underlying event history. Publish only the approved report version and its approved media. Do not invent completion estimates from a fixed timer or a simulated Astra result.

## Concrete implementation and verification

The `/admin` migration and dedicated `frontend/atlas-customer` app implement these separate routes. Customer serving credentials execute only the named `atlas_customer.customer_call` gateway; staff intake uses a separate fresh-operations gateway. The public report reader's permissions remain unchanged. Durable verification creates one account/session for the verified canonical phone under concurrent and repeated/lost replies. No account/session is created before verification. Rate limits, expiry, challenge consumption, cookie/CSRF rules, idempotent logout and revocation cover both the SMS request and session lifecycle; an unknown provider outcome is not treated as a successful login or automatically retried.

The dashboard, profile, submission form and per-card tracker are implemented. Profiles remain nullable until submission, which records the chosen channel and confirmed address snapshot. A tab retains the exact uncertain submission request and can reconcile its own request ID after navigation/reload; it stores no SMS code or session credential. Cross-customer lookup and staff/customer credential substitution are denied. Staff explicitly records physical receipt, customer-facing action messages and shipment; approval and finishing stages require the current corresponding evidence. Payment, postage purchase and actual dealer/mailing destinations remain outside this implementation.

Retain lifecycle checks for new/returning customers, phone normalization/duplicate-account races, wrong/expired/reused codes, resend/lost replies, revoked sessions, customer-versus-staff denial, unapproved admin numbers, deferred profiles and address snapshots. The live owner test proves delivery, a user-requested resend, successful code approval and creation of one customer account/session; it does not repeat every synthetic lifecycle/ownership test or prove the complete real-card workflow. Staff live SMS verification and access to its empty Review queue are also confirmed; broader role/card/operator acceptance remains separate.
