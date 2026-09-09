# ATLAS website release plan

Updated September 9, 2026 from Mark's customer-site/private-workspace clarification in the [canonical blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md). This is the current release target and implementation sequence. It is not evidence of a deployed `/admin` application.

## Route ownership

| Address | Purpose | Current implementation |
| --- | --- | --- |
| `https://atlasgrading.com/` | Customer website: learn about ATLAS and enter the card-submission experience | Initial public report application exists; the full customer website and customer submission flow are not established by the current grading tests. Preserve the owner's consumer design as a separate input. |
| `https://atlasgrading.com/admin` and descendants | Private staff login, intake, grading, Astra drafts, human review/approval, labels and NFC finishing | Staff application exists locally; routing, authentication and database rules currently target the superseded staff subdomain. `/admin` migration remains implementation work. |
| `https://atlasgrading.com/account` and descendants | Customer phone-code signup/sign-in, own submissions/cards, progress tracker and later shipping profile | New owner-directed implementation scope; not proven by existing staff authentication or report-reader tests. |
| `https://atlasgrading.com/reports/[token]` | Public approved report and exact approved photographs/traces | Implemented and tested locally. Retain report identities and versioned URLs. |

The public and staff builds and serving roles remain separate behind one hostname. A checked path router sends only `/admin` and its descendants, including staff APIs and assets, to the staff application. The `/account` area receives a dedicated customer application/service boundary; root marketing and approved-report routes stay public. `/administrator` and similar prefixes are not staff routes. Unknown routes do not receive a private-app fallback. The browser remains at `/admin`; a redirect to the old staff subdomain does not implement this target.

Mark additionally selected a unified phone-code customer signup/sign-in flow, separate phone-code staff login, customer card tracking and deferred name/address collection at first submission. [CUSTOMER_ACCESS.md](CUSTOMER_ACCESS.md) records the exact experience. The new account area needs a private customer service boundary and narrow account-owned permissions; the existing public approved-report role remains read-only. Initial registration must not require a complete shipping profile.

## Verified starting point

The core staff/public/private workflow passed 495 JavaScript/TypeScript tests, 128 PostgreSQL scenarios, 55 paired-web checks, three builds and 70 inactive-route denial checks. Of the combined package tests, 79 directly cover the Astra operator package. They use simulated model responses. A successful two-step fixture reads the report and submits it to the human queue with persisted receipts; no live model judged a real card. See [local acceptance](LOCAL_ACCEPTANCE.md) and [operator evidence](OPERATOR.md).

The native Mac diagnostic successfully wrote a 56-byte test NDEF and verified it in 0.38 seconds on the existing ACR1552U/F8215 sample. Mark subsequently confirmed phone reading. Permanent locking, production job signing, the connected browser bridge and automatic station progression are still incomplete. This evidence is separate from web release and model-quality acceptance.

## Next build: mount and verify the private workspace

Implement the route change as one coherent candidate. The audit found the old staff host pinned in `frontend/atlas-app/lib/server/access/config.mjs`, operations authority, the boundary manifest, two historical staff migrations and `packages/atlas-finishing/src/nfc.mjs`, with associated tests. Changing a displayed URL or only adding a rewrite cannot update these contracts.

Use the staff application's build-time `/admin` base path, then audit raw fetches, image/media URLs, plain links, redirects, saved navigation, sign-in return paths, label requests and native connection calls. Public report links continue to target public report routes. Next's base path is embedded during the build and applies automatically to framework navigation; raw URL construction still needs explicit review. [Next.js 14 base-path documentation](https://nextjs.org/docs/14/pages/api-reference/next-config-js/basePath).

Keep the HTTP Origin as `https://atlasgrading.com`; `/admin` is a path, not part of an Origin header. Replace the old cross-host policy with explicit staff application/path/deployment binding, current staff authentication, role/assignment validation and CSRF. Scope new staff cookies to `/admin` with suitable Secure/HttpOnly cookie names; a `__Host-` cookie requires `Path=/` and must not be falsely retained with a restricted path. Customer and staff credentials remain separate. Public and staff scripts share a browser origin, so cookie path and separate builds must not be described as an XSS isolation boundary. Public content, dependencies and script policy participate in the same-origin review.

Add a new migration for the changed current policy; preserve every existing migration byte and historical receipt. Update configuration hashes and the new native NFC protocol's origin/application binding together. Do not weaken existing verification into a dual-origin fallback or relabel old Windows receipts. Existing deployed grants/configuration, if any, need an explicit transition and fresh session/station binding.

Verify both actual built applications together behind a local path router before preparing a live cutover. Cover nested `/admin` refreshes, assets, private APIs, login/logout and cookie paths, CSRF/current staff roles, public/customer denial, direct deployment/old-host denial, unchanged public report URLs, Back/Forward and lost-reply recovery. Re-run the affected PostgreSQL migration/policy and app boundary checks. No new `/admin` acceptance is claimed by the old subdomain tests.

## Website pilot and remaining finishing work

Prepare the actual public/staff/private deployments and Astra runner package for their selected hosts. Configure dedicated phone authentication, restricted database roles, exact storage/image-worker evidence, provider credentials and bounded pilot policy. The preparation release is currently null; actual live provider/worker quality, cost and latency have not been measured. The release package must name the exact resources, source and activation state before deployment.

The first website test should let Mark sign in at `/admin`, inspect an admitted card, review a live Astra-assisted draft, correct it, approve an exact version and open its public report. Use the same approved ten-card cohort to measure identity/findings quality, missed or incorrect findings, human corrections, review time, failures, model/worker cost and elapsed time. This is the grading portion of the final pilot, not an extra ten-card cohort or automatic permission to scale.

Finish the Mac bridge with a qualified F8215 lock map, signed exact-card jobs/results, verified hosted acknowledgement, automatic fresh-tag progression, observed removal and restart/recovery behavior. Verify real label size/QR and the complete approved-card-to-label-to-tag association. Complete finishing on the same pilot cards only after hardware acceptance. Preserve human assembly/welding and separate trusted-learning decisions.

A verified launch date is not yet available. The `/admin` migration and actual deployment/worker/operator preparation precede website grading tests; permanent lock and integrated finishing acceptance precede testing the full physical workflow. The customer marketing/submission experience is a distinct deliverable from the staff grading pilot.
