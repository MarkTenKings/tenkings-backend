# Repeatable Vault installation — proposed delivery plan

## Owner request and status

On September 17 Mark asked for future Vault machines to be easy to install and connect, without repeating the current prototype's manual terminal commands and troubleshooting. This document records a proposed implementation plan within Vault's existing appliance scope. On September 28 Mark selected Stripe Terminal/UX700, replacing the earlier Nayax plan. It does not alter the owner-approved V2 card-platform blueprint or claim that an installer wizard, factory image, remote deployment service, or live payment integration has shipped.

Mac-to-SER SSH setup and immutable package transfer already succeeded. A separate native working copy passed 363 tests and ran the Portrait B mock preview. See `SER_NATIVE_ACCEPTANCE_2026-09-17.md`. The copied SSH setup prompt predates those results; continuation should preserve working access instead of restarting setup. No remote changes were made while preparing this plan.

## Operator experience to deliver

1. Connect the standardized, labeled screen, touch, network, controller and Stripe UX700 harnesses using the approved illustrated connection sheet. Factory assembly handles internal wiring and electrical qualification.
2. Boot a prepared SER or use the Vault installation/recovery USB. For a prepared unit, the first screen is **Set up this Vault**. Any disk replacement/erase path explicitly identifies the target and requires confirmation; it is never inferred from attaching USB media.
3. Claim the unit with a one-use enrollment code from Ten Kings admin, select its location and qualified cabinet profile, and associate its Stripe UX700 reader and unattended off-premise Terminal Location. The guided interface stores machine credentials without terminal commands or editing JSON files.
4. Follow displayed checks for screen/touch, network, exact adapters, controller identity and the terminal. Read-only discovery comes first. Supervised physical door checks require the technician to confirm the actual labeled door; software cannot infer successful physical release from a relay response. Test payments use Stripe Test mode and a physical test card during commissioning.
5. Review the completed acceptance record and activate service. The machine then starts into Vault on subsequent approved boot/login paths. Failed checks show a specific connection or configuration step and retain progress; they never silently substitute mock payments or a synthetic cabinet map.

The normal operator path needs no source checkout, compiler, Node/pnpm installation, SSH-key copying, MacBook, or ongoing Codex session. These remain development/support tools. Installation convenience does not remove terminal activation, network setup, or physical acceptance for each unit.

For the fleet, the target should be one signed, versioned Vault application release and a prepared Omarchy/SER base. A technician follows a repeatable connection sheet, runs the verified installer or boots a prepared unit, enters a one-use Ten Kings enrollment code, selects the exact cabinet/site/reader, and completes guided touch, reader, payment and supervised door acceptance. The same app release is copied to every unit; **operational SQLite history, machine identity, SSH host keys, Stripe credentials and controller journals are never cloned**. The current `appliance.py` is a guarded foundation, not yet that complete guided one-command flow.

The simplest scalable credential target is a Ten Kings cloud payment service holding the Vault Stripe secret and enforcing a unique enrolled machine/reader/Location binding. Each SER would use its own machine credential, avoiding manual Stripe-key entry on every unit. That cloud service and its machine-verifiable capture evidence are design work, not current behavior: today's test adapter calls Stripe directly with a protected test key, and local independent capture verification must not be weakened during migration. Until a central service is built and accepted, use separately managed restricted per-unit credentials and protected systemd delivery for pilot units; Stripe resource permissions alone do not isolate one reader from another.

## Build once and distribute a tested appliance

Use a qualified Linux/Omarchy base and a small set of supported hardware profiles. Standardize the SER architecture, screen/touch device, exact controller/adapter models, labeled connectors and wiring revisions. Hardware changes get their own acceptance record instead of being assumed equivalent.

A Linux builder produces a reviewed, versioned, signed application release containing the pinned Node runtime, compiled SQLite dependency, machine/contracts code and kiosk assets. The server-driven Stripe Terminal integration uses authenticated HTTPS API calls; it does not require a Nayax Marshall host. The present builder is a useful foundation, not proof that the live Stripe/UX700/physical-controller combination is qualified today. Field machines install verified artifacts; they do not compile dependencies or build from a developer's dirty checkout.

Provide two delivery paths using the same application release and setup flow:

- **Normal deployment:** a prepared mini-PC/base image with the installer and first-run setup ready.
- **Recovery/replacement:** clearly labeled USB media that can prepare a replacement unit through an explicit guided process.

The reusable base must contain no operational database, sales/payment/controller journal, staff session, machine enrollment credential, SSH host identity, or copied disk-encryption secret. Each unit receives fresh identities and appropriate encryption provisioning. The application's public verification key may be shared; its release signing private key remains off machines. A used machine's disk is not the factory template.

## Existing code to reuse and work still needed

| Area | Evidence in current source | Remaining delivery work |
| --- | --- | --- |
| Build/sign/verify | `deploy/vault-linux/build-release.py` and `appliance.py` package native code, verify exact signed members and reject dirty release source | Establish the reviewed Linux release pipeline, SDK/native-host closure and qualified base image |
| Installation | `appliance.py install` creates protected installation state and registers a stopped/disabled service | Guided first-run wrapper, narrow privileged setup boundary, resumable installation and final activation |
| Enrollment | Admin enrollment handler issues expiring approved tokens; `machines/enroll/complete.ts` exchanges them for unique machine credentials | Usable activation-code/QR workflow and protected local credential installation; actual deployed backend readiness remains to be verified |
| Hardware bindings | `bind-serial` binds an observed adapter identity; `display-plan.py` proposes exact display/touch settings | Guided detection/selection, labels, per-unit acceptance and tested application of display configuration |
| Startup | systemd service and kiosk-session/autostart templates exist | Installed service, restricted public kiosk session, touch, actual encrypted boot and power-return acceptance |
| Updates | Signed staging, maintenance barrier, same-schema checks and consistent SQLite snapshots exist | Operator/admin update controls, release distribution, staged fleet rollout and actual installed acceptance |
| Support | Allowlisted diagnostic collection and machine heartbeat code exist | A clear fleet status/support view and approved device-scoped remote maintenance workflow |

Relevant enrollment files are `frontend/nextjs-app/pages/api/vault/v1/admin/[...path].ts` and `frontend/nextjs-app/pages/api/vault/v1/machines/enroll/complete.ts`. Their presence establishes implementation, not deployed Production availability or a completed enrollment ceremony.

## Per-unit configuration and support

Record each Vault's unique machine identity, location, accepted release, cabinet/profile version, controller identity/channel mapping, terminal association, and acceptance results. Share reviewed cabinet templates while verifying every physical unit's actual map. Never reuse another machine's credential or operational history.

Stripe Terminal integration development should be reusable for the qualified UX700 model and transaction flow. Each physical reader still needs Stripe account registration, an unattended off-premise Location for its actual site, explicit machine/reader/Location binding, and per-unit payment verification. A copied configuration or shared API key cannot substitute for terminal onboarding or per-unit acceptance.

Once enrolled, routine fleet visibility should report machine connectivity, app version, device/payment readiness and actionable faults through Ten Kings admin. The operational installation must not depend on a developer's Mac being awake or on local home-network IP addresses. Remote maintenance is authenticated per machine and stays within the existing maintenance authority.

Updates wait until the machine is safe to service. Preserve financial history and uncertain payment/door outcomes. Stage and validate the new signed release before selecting it; do not implement automatic database rollback or replay a payment/lock command to repair startup. OS updates use qualified maintenance windows rather than uncontrolled changes between machines.

## Delivery order and acceptance

1. **Qualify the reference machine.** Complete actual touch/display, controller, Stripe UX700, installed service, enrollment, reboot/power-return and payment/door behavior. The current simulator is not the factory baseline.
2. **Ship the repeatable application installer.** Reuse the existing packaging/install code, add the first-run workflow, and deliver one signed release with a short connection sheet and recovery instructions.
3. **Prove a second fresh machine.** A technician follows only the installation guide, without development commands or a Mac/Codex conversation. Verify distinct identities/credentials, no cloned state, correct physical door mapping, terminal setup, startup and support visibility. Record hands-on time and every unexpected intervention.
4. **Distribute prepared units.** Freeze the accepted hardware/base/release combination, retain per-unit acceptance records, and introduce managed updates after the installed update path is proven.

No fixed installation-time promise is made before the second-unit test. The release criterion is a repeatable technician procedure with specific recovery steps, not a successful demonstration on the first development machine.
