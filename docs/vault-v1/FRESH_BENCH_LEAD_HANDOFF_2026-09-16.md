# Ten Kings Vault — fresh Astra bench lead handoff

Prepared September 16, 2026, America/Los_Angeles, after Mark returned with the wired keyboard. This is the current continuation record. It supersedes the earlier September 16 integration-lead transfer from 3c63, outdated hardware-disconnected statements, Windows-preferred guidance, and earlier statements that real adapter preparation is wholly absent. Code and observed runtime/physical evidence remain authoritative.

## Owner objective and immediate conversation

Mark requests a **fresh gpt-6-astra lead at ultra reasoning**, with **3–5 gpt-6-astra subagents at xhigh reasoning**, to work with him until the Vault software, SER mini PC, touchscreen, controller/lock and Nayax payment integration are working and tested. The current capacity is four agents including the lead, so use **three workers**. Spawn them within the new task using collaboration tools, with `model: gpt-6-astra`, `reasoning_effort: xhigh`, and `fork_turns: none` or a bounded history; a full-history fork disallows overrides. Do not create three additional user-owned tasks. The owner explicitly requested these models/efforts.

Latest user message: “ok, I got the wired keyboard. Before we get started, it Looks like your context is long period, so this might be a good time to package everything up, the details, plan, etc. that we're going to do, and hand it off to a new, fresh Astra Ultra lead agent, who should also have three to five of its own Astra extra high sub-agents. This new lead agent and I will work together to finish this work. Understand?”

Begin with short, practical guidance: plug the new keyboard into a USB port on the **SER**, confirm it types in Windows, then connect the SER to the internet. Give a few novice-friendly steps at a time. Mark's physical SER is a different computer from the Mac hosting Codex; local shell/browser access here is not access to its screen, disks or hardware. Ask for the next missing observation rather than assuming remote access.

Persist on the original integration objective. Preserve accepted Portrait B styling and checkout; stop discretionary design iteration. Mark prioritizes simple, economical, durable hardware, one lock energized at a time, control/customization, and making progress without repeated permission questions. Do not ask him again to choose Windows versus Linux, buy a keyboard, call Nayax, or confirm equipment ownership. Do not promise Omarchy is universally faster or blocker-free, or promise full integration finished today without the required observations.

## Physical and vendor state — confirmed versus open

| Item | Last known state | Next observation needed |
| --- | --- | --- |
| SER5 | Owner-reported Ryzen 5 5500U, 16 GB RAM, 480 GB storage; powered; preinstalled setup completed; owner believes Windows | Actual OS edition/version, exact internal disk/partitions/data/encryption |
| OS choice | Mark repeatedly chose **Omarchy**, spelling it Omachi/Omatchy; wants to replace Windows | Exact installer and disk selection; OS preference is settled |
| Wired keyboard | **Purchased and in hand**, exact model not confirmed; K120 had been recommended | Plug into SER and confirm typing/boot input |
| Existing keyboard | Logitech **Pebble Keys 2 K380s**, still not confirmed paired | Optional later convenience; no longer blocks install |
| Mouse | Wireless mouse now works through a USB receiver on SER | Receiver brand/protocol unknown; do not assume Logi Bolt |
| Network | Last explicit report: SER **not connected to internet** | Ethernet or Wi-Fi connection now; owner types password locally |
| USB installer drive | Owner has **32 GB SanDisk** | Exact device identity, current contents, and concrete erase confirmation |
| Acer screen | Powered, displays SER setup/desktop; touch did not work | Exact model label, actual USB data path, touch detection/rotation |
| Controller | All ordered equipment owner-reported received; **one Waveshare 32CH**, not three | Actual board/address/firmware, adapter path and electrical setup |
| Nayax | Owner called technical support; expects “API access later today” | Actual delivered package/access type; nothing received/verified by Codex |
| Cabinet | Accepted UI has 68 visible doors, 4×17 | Measured complete cabinet profile and physical controller mapping; not established by UI |

No actual SER disk/USB was erased, no Omarchy installed, no serial port opened, no lock pulsed, no real payment made, and no production service deployed/restarted by this task. Software work is an uncommitted integration candidate. No signed release exists. The first real selected-door payment/test-authorized unlock remains undone.

## Exact source and safe intake

Frozen continuation source:

- Worktree: `/Users/markthomas/.codex/worktrees/9bb0/ten-kings-mystery-packs-clean`
- Branch: `codex/vault-integration-20260916-5601c0`
- Base HEAD: `c4f04006d9302445e2a68b01dcc316def3b4eb73`
- New complete transfer: `/Users/markthomas/tenkings/vault-handoffs/2026-09-16-fresh-bench-lead/`
- Package contains `START_HERE.md`, `tracked.patch`, `untracked.tar`, `manifest.json`, `intake.py`, plus preserved `adjacent-24e6` references and their manifest. The manifest supplies exact counts, hashes and source identity. Later app/intake receipts live outside the frozen source.

**Checking out the branch/HEAD alone loses uncommitted code, artwork, tests and documents.** The saved main project checkout is not this continuation source. Create/use a fresh isolated task worktree and import the full package:

```sh
python3 /Users/markthomas/tenkings/vault-handoffs/2026-09-16-fresh-bench-lead/intake.py /absolute/path/to/your/new/task/worktree
```

The importer validates package hashes, refuses dirty/protected destinations, creates a fresh `codex/` branch at the exact base, checks/applies the binary patch, extracts only verified regular untracked files, and verifies file bytes/modes and the resulting diff. Preserve any unexpected work instead of resetting it. The old source freezes once packaged. All further changes and subagent work belong in the imported destination. Do not edit preserved 9bb0, 3c63, 2dbc, 24e6 or the saved main checkout.

Read the mandatory AGENTS documents before work: `docs/context/MASTER_PRODUCT_CONTEXT.md`, the **entire** `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, and relevant/current `docs/handoffs/SESSION_LOG.md`. Approved V2 is architectural/isolation context; do not expand Vault into the card platform, ATLAS, Speedster or unrelated cloud/database work. Append the session log after commit-worthy changes and before/after deploy/restart/migration, with observed evidence.

The original intake from 3c63 had 15 tracked and 55 untracked files, tracked patch SHA-256 `af083601e1c4eb72491f212af4121d1308a14752a06db54e1b6324cbdc922d7c`. That is historical provenance, **not** the new source digest. The new package manifest is authoritative.

## Current implementation and evidence

Read `INTEGRATION_STATUS_2026-09-16.md` and the three fresh worker receipts:

- `APPLIANCE_FRESH_LEAD_RECEIPT_2026-09-16.md`
- `CONTROLLER_FRESH_LEAD_RECEIPT_2026-09-16.md`
- `PAYMENT_FRESH_LEAD_RECEIPT_2026-09-16.md`

| Area | Implemented candidate | Still required |
| --- | --- | --- |
| Runtime composition | Explicit MOCK/MARSHALL and SIMULATOR/WAVESHARE selections; no silent fallback; mock payment cannot compose physical output | Protected real enrollment/configuration |
| Controller | Linux Python helper reusing preserved bench transport; strict protocol, durable journal, fixed nominal 100 ms board-timed pulse, one queue, all-32-output OFF readback, helper-health readiness and uncertainty halt | Actual serial/board identity, measured electrical behavior and signed qualification |
| Payment | Marshall process contract, durable intent/callback journal, supervised IPC and unavailable adapter | Official SDK native binding, normalized callbacks/reconciliation and callback pump; real test configuration |
| Machine | Exact original sale/item/door/profile/address and transaction binding; per-effect readiness/OFF checks; missing/uncertain receipt stops following commands; no replay of unfinished physical dispatch | Real profile/config/evidence; LIVE remains blocked |
| UI | Accepted Portrait B; exact qualified 68-door 4×17 geometry path; durable paid collection during reconciliation; production copy no longer promises no charge | Actual touchscreen/performance and cabinet profile acceptance |
| Linux appliance | Pinned Linux Node22/native SQLite release recipe, signed artifact checks, protected config/systemd credentials, exact serial access, maintenance draining/lock/snapshots and modern Hyprland configuration | Native Linux build/probe, actual installation, kiosk permissions, restart/power-return acceptance |
| Source transfer | Unsigned source-only exporter/verifier; Git-free simulator provenance | Actual SER transfer/build; clean reviewed committed source required for signed release |

Final broad local checks before the last source-transfer addition: contracts **11/11**, machine **170/170**, kiosk **106/106**, contracts/machine TypeScript and kiosk TypeScript/Vite builds passed. Preserved controller Python **36/36**, appliance Python **20/20**. Maintenance six tests are included in machine 170. Later source-bundle **8** and simulator-source **3** focused tests passed; do not claim a subsequently rerun full machine 173 suite.

Stocked 72-door disposable HTTP smoke passed: exact selected door, one initial command and one requested retry, max one in flight, 453 events. All effects simulated. Portrait browser passed four viewports plus no-WebGL/idle recovery; subsequent copy/payment-state corrections passed component regressions. Isolation passed 1,862 paths at its recorded snapshot, before later files; no new full cloud/Next/PostgreSQL run was claimed for unchanged components. Logs are in `outputs/vault-integration-2026-09-16/`; earlier browser screenshots/logs remain in the other `outputs/vault-*` directories. Read successes **and their provenance**, not just old totals.

Docker did **not** execute any Linux test container. Image extraction failed with I/O, a second public pull failed with token-service EOF, and disk pressure/socket loss stopped attempts. One earlier session-log line saying a container launched has an explicit later correction. Mac Node20 native SQLite relocation tested dependency closure only. Native Linux x86_64 Node22/systemd/serial/touch are untested. The Mac once had 152 MiB free; a later check had 7.1 GiB. Recheck current free space before large downloads; no unrelated data cleanup authorized. Prefer ISO download on the SER once online.

The previous owner preview `127.0.0.1:55497` is **stopped**. Disposable test fixtures did not restore it. The Mac's loopback address is not the SER's address.

## Work sequence with Mark

1. **Input and internet.** Confirm wired keyboard works on SER. Connect Ethernet if available, or guide Windows Wi-Fi with the new keyboard. Ask only for connection outcome; no passwords in chat. Do not get diverted into Bluetooth pairing now.
2. **Identify storage and prepare installer.** Use the read-only Windows queries in `SER_BRINGUP_2026-09-16.md`. Identify the exact SanDisk and SER internal disk, and whether anything must be saved. Omarchy replacement is approved in principle; no exact erase target/content review has happened. Make the destructive impact concrete and obtain target-specific confirmation before USB flashing or internal disk erasure. This is necessary because the actual devices/data have not been identified, not a repeated OS-choice approval.
3. **Install Omarchy.** Verify current official ISO/checksum/signature and download on SER; prepare media with official balenaEtcher, boot it, choose the observed internal disk and complete installation. Guide one screen at a time. Test keyboard at early boot and encrypted unlock. Do not clear TPM or reset firmware broadly. Inspect actual Secure Boot/BitLocker state only if needed. Keep any passwords/recovery keys local.
4. **Native software and screen.** Follow the source transfer/build/probe/simulator commands in `SER_BRINGUP_2026-09-16.md`; use exact Linux Node22.23.2, pnpm9.12.0 and native better-sqlite3. Confirm touch input and portrait mapping on the actual monitor/Hyprland version. Preserve Omarchy desktop customization while providing restricted kiosk behavior. Test startup, persistence, sleep, restart and power return; encrypted startup requires a tested unlock arrangement.
5. **Controller bench without Nayax.** Use `BENCH_PROGRESS_2026-09-16.md` and preserved electrical references. First read-only exact adapter/address/firmware/all-OFF inspection with loads disconnected; then the reviewed single unloaded pulse, then one accessible lock under the scoped supervised procedure. Preserve measurements/qualification. Software mock payment is not a route to energize the normal physical service. Do not infer current/contact/door behavior from a relay ACK.
6. **Nayax as access arrives.** Inspect actual package type/version/headers/sample/test setup. Implement missing SDK bridge/callback handling against real evidence; verify no-money official testing before any paid flow. Do independent non-Nayax work while waiting.
7. **Integrated acceptance.** Build a clean reviewed source release, protected real config, signed qualified hardware profile/mapping and supported vend policy. Demonstrate one selected physical door after authorized test/payment flow with transaction and controller evidence, retention and restart/reconciliation behavior. Expand to full cabinet and LIVE only when their distinct requirements are met. Do not label the whole system “100%” based on simulator tests or a single relay click.

## Installation facts already researched

These were verified from official sources on September 16; recheck availability/version before downloading, without re-opening the owner's settled OS preference.

- [Omarchy](https://omarchy.org/) advertised **4.0.4**. [Installation manual](https://omarchy.org/manual/getting-started/). [ISO](https://iso.omarchy.org/omarchy-4.0.4.iso) size **6,185,304,064 bytes**. No ISO was downloaded by this task.
- [SHA-256 file](https://iso.omarchy.org/omarchy-4.0.4.iso.sha256): `ddeded2758c48318d201dfdac905ecb28f570441883f0c052ea3cd5d05acf92d`. [Signature](https://iso.omarchy.org/omarchy-4.0.4.iso.sig). [Signing key reference](https://omarchy.org/manual/security/#signing-keys), fingerprint `40DFB630FF42BCFFB047046CF0134EE680CAC571`.
- [balenaEtcher](https://etcher.balena.io/) path: select ISO, exact USB, Flash, validation. Whole selected USB is overwritten; no preliminary formatting needed. A 32 GB device is sufficient by reported capacity, not yet positively identified.
- Default Omarchy encrypted boot needs wired or suitable USB-receiver input; Windows Bluetooth pairing alone does not work as BIOS/Linux pairing. The new wired keyboard is the intended solution.
- Beelink support documented repeated **Delete** on power-on for SER5 5500U: <https://bbs.bee-link.com/d/8464-ser5-5500u-issues>. **F7 was not verified for this exact unit**; don't assert it based on another SER variant.
- OS/download/USB/basic setup estimate given to Mark was **45–90 minutes once input/network prerequisites are ready**, not a guarantee or estimate for the full Vault/Nayax/lock milestone.
- Logitech K380s supports Bluetooth and optional **Logi Bolt**, not Unifying or an arbitrary mouse receiver. Existing mouse receiver identity unknown. Pairing can be revisited after install if wanted: hold a chosen Easy-Switch key 3 seconds, then pair through OS Bluetooth; enter any displayed code on physical keyboard and press Enter.

## Acer touch and electrical provenance

The discussed screen is **Acer PM161QT bmiuuux / UM.ZP1AA.004**, but actual owner label has not been verified. HDMI carries the picture; touch requires a separate USB **data** connection to the SER. USB power from a wall supply does not provide that return path. Keep proven HDMI and matched power while identifying the correct host-facing USB port/data-capable cable.

The PM161QT manual distinguishes a right-side USB-C **OTG/downstream** port; don't blindly choose that as the touch upstream. Generic Acer USB-B instructions for VT/UT models are not PM161QT-specific. Official [PM161QT manual](https://global-download.acer.com/GDFiles/Document/User%20Manual/User%20Manual_Acer_1.0_A_A.pdf?BC=ACER&LC=en&OS=ALL&SC=PA_6&Step3=PM161QT&acerid=638802941973198702), pages 14/17, and [PM1 setup](https://community.acer.com/en/kb/articles/17695-how-to-setup-acer-pm1-portable-monitors). Actual SER USB-C video/power capability was not proven; do not discard working HDMI on assumption.

The preserved September 11 bench record from 24e6 is later/more specific than September 9 shopping assumptions. Its copied references live under the transfer's `adjacent-24e6/`, with paths for `docs/vault-v1/BENCH_SETUP_2026-09-11.md`, `outputs/vault-bench-2026-09-11/controller/CONTROLLER_HANDOFF.md`, electrical `sources+unknowns.md` and `connection-data.json` revision `2026-09-11-electrical-r2`, Nayax review, connection PDF/package and Installation Studio R8 references. These are guidance/candidates, not evidence that any physical bench operation occurred. Verify the copied adjacent manifest before using its artifacts. Reuse the already imported byte-identical bench script/tests, not a new serial implementation.

The intended KWANGIL 50 ft 24 AWG 3-pair 120-ohm shielded RS485 cable was historically $115.99; exact ASIN/purchase/arrival not independently checked. Old 3–5 ft per-machine allowance was withdrawn, not a measured route. No new blanket shopping list or purchase authority follows.

## Nayax boundaries and source-only candidate

VPOS Touch discussed part **R144GUSY01S10**, COM2 Marshall hardware/harness and official test configuration remain unverified. Mark has already called support; don't ask for another vendor round trip until the received access makes a concrete gap evident. Nayax's onboarding engineer is its contact, **not a stated requirement to hire an outside integration engineer**. Codex has no authorization to email/call the vendor itself.

Backend [Lynx API security](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/security) differs from [Marshall onboarding](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process) and its Linux C SDK. Inspect what arrives; do not treat an API token as an SDK ABI. `MARSHALL_INTEGRATION_2026-09-16.md` and payment receipt identify native binding and `pendingEvents` to `VaultProviderCallback` pump still missing. No-sensor vend policy remains simulator-only; do not silently redefine payment authorization as successful dispense.

A separate existing SER source-only candidate is preserved at `/Users/markthomas/tenkings/vault-handoffs/2026-09-16-ser-candidate-r1`: **185 files, 35,014,959 bytes**, `candidate-source.json` SHA-256 **16501f644168fea4a73f6269517e9473f71da2553bf02f0285ebbcfc6863f6c7**. Its copied verifier passed; the exact source's simulated smoke passed with Git absent from PATH. It is an **unsigned, uncommitted snapshot**, not a signed release or physical certification identity. It predates later documentation edits, so do not mutate it in place or claim it contains this new handoff. If a newer candidate is needed, export create-only to a new directory and record new counts/hash. This complete lead-transfer package is separate from that sparse SER candidate.

## New lead and worker ownership

Lead owns intake, Mark's conversation, shared contracts/runtime/UI integration, source/release identity, cross-review and final evidence. Start three independent useful lanes after intake:

1. **Appliance/input:** inspect receipt and prepare the exact next SER/USB/Omarchy steps; then native build, touchscreen and installation acceptance. Avoid redoing completed Mac fixture tests just to occupy time.
2. **Controller/bench:** inspect electrical provenance and bench progression; prepare the next observation checklist and validation of current guard/qualification behavior. Hardware actions wait for the actual supervised setup.
3. **Nayax/payment:** inspect final receipt and integration entry points; prepare intake of the expected vendor package and remaining callback/reconciliation work. Keep missing ABI/test facts explicit.

Assign files to avoid collisions; all three use the new imported checkout and read the full approved V2 blueprint. Reassign workers to concrete cross-review/validation as work proceeds. This handoff task should finish with verified source intake and the new lead's three workers started; the user should not have to paste the old conversation again.
