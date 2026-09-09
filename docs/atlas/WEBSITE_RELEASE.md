# ATLAS website release status

Updated September 9, 2026 after domain cutover and the first disabled-host acceptance. DNS and managed SSL are configured, and the exact D10 public build is assigned to the apex. Twilio services/keys, additive database migrations and disabled login controls are installed. The hosted customer API failed because its native Prisma engine was omitted from the deployment; a three-app tracing repair is being validated. Signup/sign-in and live SMS remain disabled and unaccepted. Grading quality and physical finishing remain separate acceptance steps.

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

### Configured hosted release

The selected releases report READY, production target, CLI source and automatic Git metadata for `d10ba8f22505352c214ddd0d28d137c3cd31b1c6`. Uploads came from a clean detached checkout; each of the 1,988 selected files matched the committed bytes, with no environment, generated or untracked paths. The projects have separate roots, Node 20.x build settings, no Git connection and production-only environment payloads: 18 staff settings, 10 customer settings and six public routing settings. No branch push occurred. Earlier unconfigured CE70 builds and dirty/manual-metadata D10 preparation builds are not the selected release.

| Area | Protected deployment | Provider deployment ID |
| --- | --- | --- |
| Public entry and gateway | [Configured public build](https://atlas-grading-public-dpwgt1bks-ten-kings.vercel.app) | `dpl_7xE9ZpnMiDqMqzvUeeawiu59gwLS` |
| Staff `/admin` | [Configured staff build](https://atlas-grading-staff-jtr95virh-ten-kings.vercel.app/admin) | `dpl_7nyTXWY65z2X1vM8iSSUFTL9wPxT` |
| Customer `/account` | [Configured customer build](https://atlas-grading-customer-n2ap071zz-ten-kings.vercel.app/account) | `dpl_9k5esUULdxMBhAiAiHNa5Up8Cm14` |

These immutable deployment URLs retain Vercel protection. Provider metadata/build/environment checks passed. Disabled-host acceptance stopped after 14 GETs: routing-proof denials passed, but the customer authorized probe returned TEMPORARILY_UNAVAILABLE instead of CUSTOMER_ACCESS_NOT_ENABLED. Provider logs identify a missing rhel-openssl-3.0.x Prisma native engine. D10 is not an accepted runtime release. The earlier CE70 release's six anonymous and sixteen authenticated GET observations remain historical evidence only. The two current private projects each retain one distinct server-only gateway bypass; no bypass is exposed to the browser.

Namecheap now serves apex A `76.76.21.21` and www CNAME `cname.vercel-dns.com.`, with the old parking redirect removed and Google verification, DKIM and MX preserved. Both authoritative nameservers and Vercel report correct DNS. Vercel issued auto-renewing managed certificate `cert_9W8RGIPVjhVxlfm9BA8xWBMs` for apex/www, and promoted the exact D10 public deployment above; alias readback and ordinary TLS verification passed. The www project-domain record retains its 308 apex redirect. Replace the failed D10 runtime with the repaired exact-source release and repeat the retained 39-GET disabled-host acceptance with fresh controls. The separate marketing Site remains unchanged.

The reviewed managed database now contains all 16 ATLAS migrations; migration replay reports no pending changes and the legacy public ledger is preserved. Separate staff/customer serving logins pass their source-defined privilege checks. Only the rotated credentials were installed in hosting. StaffControl and CustomerControl are disabled at revision 1, bound to the immutable hosts above and source D10. Their configuration hashes are respectively `a27e0f8928d3a70ef8d1e973e1d4fc1474cbf01428e6f7e86786bc23d82f90f8` and `a16194cda97d081b2b878bb59343f68ba30e6e56085dfdaa064c32f7e6ea1563`.

ATLAS Staff and ATLAS Customer have separate Verify services and Restricted US1 runtime keys in the dedicated ATLAS subaccount. Both use six-digit default codes, one-segment default templates, SMS as their enabled channel, Fraud Guard, and no carrier lookup. The United States SMS geographic setting is saved as Monitor all traffic for blocking fraud. Twilio may deliver an SMS request through RCS; its documented API response and SMS billing remain compatible. The upgraded parent account has an approved Ten Kings, LLC primary profile and an observed $20.23 shared balance, but the subaccount still shows a generic compliance banner. Actual delivered/approved verification remains necessary evidence. No verification code is currently awaiting entry.

### Local acceptance and activation inputs

The latest disposable PostgreSQL run passes all 155 scenarios, including eight SMS-budget groups over the retained 147 scenarios, with 93 public and 16 ATLAS migrations and no-op replay. This run includes the PostgreSQL 17 restricted-sequence privilege fix. Earlier accepted customer lifecycle/ownership/intake and current-approval/finishing/shipping regressions remain covered. The combined three-app loopback site previously passed 13 HTTP groups, including separate staff/customer cookies, deferred profile and channel snapshots, explicit intake, cross-account denial, process restart and logout. Chrome verification covers synthetic phone login/code paste, correct submission details, refresh and Back/Forward. All three configured Next builds pass their route/authority boundaries; exact commands, source manifests and evidence paths are recorded in `docs/handoffs/SESSION_LOG.md`.

All of this uses synthetic accounts/cards and a local SMS fixture. No real SMS/model/worker request, live customer acceptance or tag operation is claimed. Source publication audit found this branch would trigger unprotected legacy Ten Kings previews with inherited credentials. Keep those projects unchanged and publish the exact committed ATLAS candidate through the reviewed isolated upload path, without a normal branch push. New ATLAS project configurations disable automatic Git deployment. The [deployment runbook](WEBSITE_DEPLOYMENT.md) specifies roots, environment names, dedicated role grants, inactive controls, exact-source production uploads, signed forwarding checks and nondestructive rollback.

Mark has supplied the approved US staff phone and provider access and authorized $100 total for the SMS/image/Astra pilot. Do not ask for these again. Namecheap authentication and the authorized DNS cutover are complete. The initial SMS pilot reserves at most $10: ten committed claims per application at $0.50 each, restricted to the approved owner phone, with a seven-day immutable window after first activation. Both SMS controls remain disabled at revision 1, with no activation timestamps, reservations or challenges at the 19:43 UTC readback. Broader customer-phone admission is not enabled by this initial owner test.

Remaining login work is the native database engine packaging repair and exact-source redeployment, actual disabled-host acceptance, exact login/SMS-control activation, then the owner entering a fresh code on the ATLAS page. The same owner-selected ten real cards define the later supervised grading pilot; their actual specimen/capture/worker admission is still required. The prepared-image worker release remains null, and live Astra quality, corrections, cost and latency remain unmeasured. Worker/Astra may use at most the remaining $90 only after their separate resource admission. Website hosting alone does not supply or activate the private grading/worker/operator services.

The native Mac diagnostic wrote and read back its fixed56-byte test NDEF in0.38 seconds on the unchanged ACR1552U/F8215 sample; Mark confirmed phone reading. Permanent locking, native signed jobs/results, hosted acknowledgement and automatic station progression remain unfinished. Production NFC is deliberately disabled by the `/admin` migration until that separate qualification and protocol are complete. Human report approval, physical association, assembly and welding remain explicit. See [Mac NFC status](MAC_NFC.md) and [operator evidence](OPERATOR.md).
