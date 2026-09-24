# ATLAS Stage1 release — September 24, 2026

The staff/public/private software release is live. At 10:00:59 UTC, the canonical site passed all eight anonymous page and routing checks. Staff grading is ready for Mark's real-card testing. The new paid customer intake, dealer operations and physical finishing station remain disabled; this release does not claim their operational acceptance or completion of the entire future V2 blueprint.

## What is live

| Component | Observed release |
| --- | --- |
| Application source | `7b42f51c418b815f838bb910cf7599a0dcd5313c` |
| Staff | `dpl_B51MAjXCRr9nLZPgs1asgpPJWe5q` / `atlas-grading-staff-rkq7cs1uk-ten-kings.vercel.app` |
| Public | `dpl_3BK1tjhMAF7LgW6J2wNw386hR1xi` / `atlas-grading-public-qlt8myz6c-ten-kings.vercel.app` |
| Private image | `sha256:fefc50f83e2e15ce1685c138f0ca69a618931e3972e9e8924a4b219b625b340e` |
| Private container | `a30c6930bbb91680bc52529d65b3e078a8bad0a1edad40639f2424be4a8e7557`, started `2026-09-24T09:51:15.030172909Z` |
| Release controls | Staff27, STAFF SMS25, PublicReader5 |
| Database | Staff48; public112 ledger rows (99 successful, 13 historical rolled back) |
| Retained customer | `dpl_7GzDxKz2MP36vESc8YkZq87Xht44`, source `79483f13000c23dfed62c0c03f1239beb8f74dfb`, Customer7 / CUSTOMER SMS5 |

All four public aliases select the new public deployment; `www.atlasgrading.com` retains its 308 redirect. The public router selects the new staff deployment and retains the existing customer deployment. Batch, presentation, market, research and catalog remain enabled. The physical station and new customer service/intake/identification/commerce/dealer operations are disabled; the new public customer funnel and staff customer-operations display remain off.

This deploy carries the batch recovery and native companion protocol corrections while preserving existing staff grading, review, report, market and catalog functionality. New customer/dealer code is packaged and tested but its migrations49–52 remain dormant. No production migration or grant was applied.

The previous `c302eeb7…` service exited gracefully and is retained, detached from both networks, as `atlas-manual-connected-20260917-retained-e29567c2-stage1`. Its configuration, Caddy, other containers, all 30 tracked histories, existing authority and research records were preserved. Existing catalog and SoldComps credentials were reused. Exactly three release-control rows changed. No payment, shipping-label purchase, receipt message, card edit or human approval was performed by this release.

## Completed software and qualification

- Customer software: repeated original Front/Back capture, upload recovery, identification, new/returning profiles, review, immutable quotes, durable payment reconciliation, saved receipts/labels and ownership-scoped tracking.
- Dealer/staff software: location-scoped membership and custody, actual collection tracking, commission records, staff customer operations and operation recovery.
- Commerce: Stripe/FedEx/receipt adapters, measured package and ship-date admission, conditional webhook processing and recovery of uncertain provider results. Configuration templates and a no-network readiness checker are in [the configuration guide](../../../../packages/atlas-commerce/CONFIGURATION.md).
- Native software: stricter companion message validation, recoverable station workflow, native interoperability and a clean-source unsigned distribution bundle. Signing, enrollment and physical acceptance remain separate.

Customer, public and staff production builds passed. The exact production image passed 1,220 Linux package tests and 604 staff tests, with zero failures. Six declared Darwin-only skips are covered by the actual 10-test Mac suite; eight full-source cross-app guard tests also passed. The strict Linux skip receipt is retained alongside the combined qualification. All 16 existing native artifacts were preserved.

The [PostgreSQL17 rehearsal](pg17-upgrade-and-commerce-acceptance.md) passed nine upgrade-preservation groups, 11 updated commerce groups and nine dealer/privacy groups. It preserved all 238 predecessor tables on a genuine disposable PostgreSQL17.11 instance. That source95-public/48→52 rehearsal is distinct from the actual production112/48 readback; production remained at48.

The [customer browser tests](customer-ui-completion.md) passed mobile and desktop kiosk, interrupted/uncertain payment, receipt, dealer and returning mail-in flows with explicit local provider/auth fixtures. These establish UI behavior, not real payment, delivery, physical custody or SMS acceptance. The unsigned native bundle verifies 23 payload files and 163 inputs, including both label layouts; it is not a signed or hardware-qualified installer.

Actual release checks passed:

- Exact-image configuration constructors with network disabled, no database/provider clients and cold customer settings.
- Fresh production48 checksums,112 public ledger rows,30 history fingerprints, unchanged permissions/authority, and an idle cutover. While stopped, manual database connections were zero.
- New private listener health, eight signed/unsigned TLS transport checks, and independent readback of only the three intended control changes.
- One public promotion and exact alias/target readback, preserving staff/customer provider state and deployment protection.
- Eight canonical GET checks: home, dealers, staff phone sign-in, protected manual/batch/customer-operations redirects, and retained customer account/submission shells.

Generated preview URLs returned Vercel SSO challenges. They were recorded as protected and unverified, without bypassing protection or claiming application-page acceptance. Canonical page checks succeeded after promotion. Two release-helper metadata/shape mismatches and a cold-test fixture mistake were corrected with original failed evidence retained; none required changing the qualified application source or replaying an external write.

Source checks and actual builds are recorded; no new GitHub Actions run or Git push is claimed for this source-CLI release. The final documentation commit does not change deployed application source7b42f51c.

## What to test now

Open [staff intake](https://atlasgrading.com/admin/batch?tab=INTAKE) and sign in normally. Start with one fresh real Front/Back pair, inspect preparation and identification, review/correct the result, and approve only when appropriate. Confirm save/reload/recovery and the approved report. Then test ten distinct cards, including interruption/recovery and observed quality/time. Human sign-in, grading approval and real-card acceptance were not simulated on Mark's behalf.

The [public site](https://atlasgrading.com) and retained [customer account](https://atlasgrading.com/account) are available. The newly built $40/$50 checkout and dealer customer-operations flow are not activated there yet.

## Remaining activation and physical work

1. Supply real Stripe merchant/tax/webhook settings, FedEx account and ATLAS addresses/measured package plans, approved email/SMS receipt sender configuration, and real kiosk/dealer locations, schedules and device bindings in protected configuration. Existing verification SMS and provider adapter tests do not qualify these services.
2. Resolve the two outstanding mail policies: which event starts the two-week clock and which shipping legs checkout charges. Confirmed kiosk terms remain $50/card, included collection/return, seven days from actual ATLAS collection, and $5 dealer commission per full-price card excluding tax/shipping. Mail remains $40/card plus actual FedEx charges.
3. Qualify real provider/storage flows, then perform the separately recorded production49–52 upgrade, narrow private-service authority/control binding, new customer deployment and controlled activation. Credentials alone do not activate checkout.
4. Complete legitimate Developer ID signing/notarization, station enrollment, qualified printer/media and reader/tag profiles, and the real print/write/readback/lock/removal workflow. The selected xTool O1 automation integration and physical qualification remain part of the separate hardware work. Finish one-card and ten-card physical acceptance before opening the station.

Configuration files now have templates; credential values, actual business facts, hardware and owner decisions have not been invented.

## Evidence and action custody

The committed [release manifest](../../../../validation/atlas-stage1-release-20260924/manifest.json) binds the copied nonsecret receipts and explicitly derived database summaries. Full database catalog/privilege payloads remain in the original external readbacks. Complete local/remote evidence remains under `/Users/markthomas/.codex/atlas-handoffs/atlas-stage1-20260924` and `/opt/atlas/manual-stage1-7b42f51c418b` respectively. Private configuration is root-owned0600 in the latter directory and must not be copied into the repository.

Key receipts: native start `2a831f74…`; three controls `b5d0766e…`; renewed TLS `9fe1c84a…`; public promotion `1db6e76a…`; canonical hosted routing `35cc6ada…`. All stop, start, three-control and public-promotion intents are consumed. Preserve them and reconcile read-only on uncertainty; never replay them. The [session log](../../../handoffs/SESSION_LOG.md) contains planned actions and observed outcomes.
