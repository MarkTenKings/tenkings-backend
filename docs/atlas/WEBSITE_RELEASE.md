# ATLAS website release status

Updated September 9, 2026 from Mark’s approved website and customer-account direction. The three-app candidate is implemented, verified locally and uploaded as three protected staged production builds on Vercel. The custom apex and private application controls are not activated. Live SMS, grading quality and physical finishing remain separate acceptance steps.

## Route ownership

| Address | Purpose | Current source |
| --- | --- | --- |
| `https://atlasgrading.com/` | Public entry and approved reports | Pilot entry page with customer account/submission/tracking and staff links; owner’s separate marketing Site remains unchanged |
| `/admin` and descendants | Private staff login, intake, grading, Astra drafts, review/approval and finishing | Staff Next build mounted at `/admin`; distinct staff cookies/CSRF and current database authority |
| `/account` and descendants | Phone-only customer signup/sign-in, submissions, tracking and later return profile | Dedicated customer Next app, separate session and function-only database credential |
| `/reports/[token]` | Exact human-approved public report, photographs and traces | Existing immutable report identities and restricted public reader preserved |

The gateway selects complete `/admin` and `/account` path segments, including each application’s APIs and assets. Lookalike prefixes and unmounted private APIs do not receive a private fallback. Each private hop requires a short-lived proof bound to the method, target, zone and exact deployment. App sessions, staff roles, customer ownership and write CSRF remain mandatory. Optional separate gateway-only credentials support Vercel deployment protection; caller routing/bypass instructions are stripped. Actual hosted forwarding and protection behavior must still be verified.

All three paths share a browser origin. Cookie paths and separate builds are not an XSS isolation boundary. The candidate upgrades only the three ATLAS apps to Next15.5.25 and keeps the legacy Ten Kings app, grading arithmetic and historical migration bytes unchanged.

## Implemented customer and staff flow

Customers enter a mobile number and the SMS code using one signup/sign-in screen. A first verified phone creates an account; returning phone formats resolve to the same account. Name and return address are required only when submitting cards. Each submission retains its own confirmed address and choice of dealer drop-off or mail-in. The account can reconcile an uncertain submission by its own retained request ID after navigation/reload.

Staff use a separately approved phone roster/session. A fresh operations grant permits the intake queue, explicit card receipt binding, reviewed customer-facing action messages and explicit dispatch. Customer signup grants no staff permission. Each customer list/detail/card/request-ID lookup checks ownership in the database gateway.

The tracker follows actual records for submission, receipt, grading, human review, approval, encapsulation and shipment. Each card has its own state. Current approval and finishing require the matching current report, label, NFC verification and physical chain. Historical approvals and receipts remain immutable; a corrected report or replacement label cannot silently retain a stale ready-to-ship state. Shipment requires explicit human confirmation and current finishing evidence. No timer or model statement creates physical progress.

Actual dealer locations, mailing destinations, prices, postage/payment integration and turnaround commitments are not invented. The earlier public marketing draft’s dealer-only/no-mail and48-hour copy does not override the owner’s both-channel decision.

## Verification and remaining release steps

### Hosted candidate

All three provider deployments report READY with production target and exact source `ce70c574976ff9313a6cd0004c5e16f9acfc413b`. That commit adds upload exclusions and release records to application commit `54412eeb`; application and SQL bytes are unchanged. The projects have separate roots, Node 20.x, no Git connection and no application environment credentials. No branch push, custom-domain change or live migration occurred.

| Area | Protected deployment | Provider deployment ID |
| --- | --- | --- |
| Public entry and gateway | [Public candidate](https://atlas-grading-public-dyfgk5h8e-ten-kings.vercel.app) | `dpl_D6yvokpV6Fuw9bDFeQ1YYgRmXG8a` |
| Staff `/admin` | [Staff candidate](https://atlas-grading-staff-crdazsci6-ten-kings.vercel.app/admin) | `dpl_4aqev1ACV5MAd2XJedSCP9te4gmx` |
| Customer `/account` | [Customer candidate](https://atlas-grading-customer-7c3wieixn-ten-kings.vercel.app/account) | `dpl_9yE9bnqVhQtRey26dnA4e7F1ZKJp` |

These links require Vercel access and are not a working customer/admin login pilot. Six anonymous requests redirected to Vercel sign-in. Sixteen authenticated build-owner GET checks reached the actual applications: public entry 200, disabled private routes 503 with no-store caching, unmounted routes 404, and zero application session cookies. All temporary platform QA credentials were immediately revoked and verified absent. No ATLAS authentication or routing authority was supplied. Actual forwarding at `atlasgrading.com` with signed upstreams, real SMS, database controls and the supervised grading transport still needs verification.

Vercel created generated team aliases even with `--skip-domain`; they are recorded in private provider evidence. The first preliminary upload included unnecessary tracked Docker templates and was removed after inspection; only the replacement candidates above are retained. The corrected dry manifests contain 1,986 committed source files and no environment or generated paths. The owner’s existing marketing Site and apex DNS remain unchanged.

### Local acceptance and activation inputs

The candidate passes147 full-chain PostgreSQL scenarios over93 public and15 ATLAS migrations, source/ledger checks and second no-op migration deploys. This includes15 customer lifecycle/ownership/intake scenarios and two real-service current-approval/finishing/shipping regressions. The combined three-app loopback site passes13 HTTP groups, including separate staff/customer cookies, deferred profile and channel snapshots, explicit intake, cross-account denial, process restart and logout. Chrome verification covers synthetic phone login/code paste, correct submission details, refresh and Back/Forward. All three Next builds pass their route/authority boundaries; exact final build/smoke counts and private evidence paths are recorded in `docs/handoffs/SESSION_LOG.md`.

All of this uses synthetic accounts/cards and a local SMS fixture. No real SMS/model/worker request, live customer acceptance or tag operation is claimed. Source publication audit found this branch would trigger unprotected legacy Ten Kings previews with inherited credentials. Keep those projects unchanged and publish the exact committed ATLAS candidate through the reviewed isolated upload path, without a normal branch push. New ATLAS project configurations disable automatic Git deployment. The [deployment runbook](WEBSITE_DEPLOYMENT.md) specifies roots, environment names, dedicated role grants, inactive controls, exact-source production uploads, signed forwarding checks and nondestructive rollback.

Live setup still needs the approved staff phone and pilot spending ceiling, actual domain and Twilio account access, dedicated customer/staff Verify services and exact database/release bindings. The same owner-selected ten real cards define the supervised grading pilot. The separate prepared-image worker release remains null, and live Astra quality, corrections, cost and latency remain unmeasured. Website hosting alone does not supply or activate the private grading/worker/operator services.

The native Mac diagnostic wrote and read back its fixed56-byte test NDEF in0.38 seconds on the unchanged ACR1552U/F8215 sample; Mark confirmed phone reading. Permanent locking, native signed jobs/results, hosted acknowledgement and automatic station progression remain unfinished. Production NFC is deliberately disabled by the `/admin` migration until that separate qualification and protocol are complete. Human report approval, physical association, assembly and welding remain explicit. See [Mac NFC status](MAC_NFC.md) and [operator evidence](OPERATOR.md).
