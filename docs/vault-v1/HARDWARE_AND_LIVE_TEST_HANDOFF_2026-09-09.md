# Vault electronics and live testing — fresh lead handoff

> September 16 continuation: [fresh integration lead handoff](INTEGRATION_LEAD_HANDOFF_2026-09-16.md) is now current. Mark accepted the UI and requested an Astra Ultra lead with three Astra xhigh workers. It supersedes old team/source/UI-priority instructions. The September 16 check found the old local preview stopped; earlier running-process claims below are dated history.

Prepared September 9, 2026, America/Los_Angeles. This is the current continuation record. It supersedes older purchasing recommendations and older task-transfer instructions where they conflict. It does not approve fabrication, certify hardware or claim production readiness.

## Owner's request and immediate next action

**Latest September 9 request supersedes the earlier wait-to-rebuild shopping sequence:** Mark asked to finalize the current parts list, see and try the UI immediately, test the existing software and implement Nayax/one-door hardware integration. The stocked local preview is running; current electronics XLSX and a three-page connection PDF are complete with unresolved items explicit. See [preview, test results and Nayax dependency](PREVIEW_AND_NAYAX_INTEGRATION_2026-09-09.md). Prioritize owner UI feedback and obtaining the official SDK/test configuration. Do not return to an endless one-item purchasing sequence or describe simulated unlocking as a physical test.

Mark wants a fresh independent lead task with a concise saved handoff. Continue the Vault project directly with him; do not create a team of subagents. Finish choosing electronics, rebuild the master parts list and connection guide, complete real integrations, and progress to physical lock and payment testing.

The fresh lead's intake is complete (receipt and evidence in the session log). Mark confirmed buying **one CHANZON 12 V / 5 A supply** after its recommendation. **Hardware direction: one lock energized at a time across the machine; streamlined, cost-effective and durable.** The proposed two inline fuse holders are now deferred, not a required buy. Choose the simplest shared 12 V wire/connector/protection arrangement together; a single main DC fuse is a candidate only if it adequately protects all downstream wiring. Retain needed coil suppression and bounded energization. Research reliable, inexpensive, readily stocked online items with actual purchase links and delivery estimates to **95762** (El Dorado Hills); Sacramento office ZIP **95827** is an alternative. For any new necessary purchase, discuss the item clearly and avoid replacing owned equipment. The latest owner instruction above now authorizes the consolidated list and software review.

Mark answered the inventory question during handoff: **one 32-channel board for the first test**. This is now confirmed ordered, not received/tested; do not repeat that question or assume the remaining cabinet boards were ordered. The preceding "done, ordered!" confirmed the FTDI backup specifically.

Exclude steel, cabinet fabrication and CAD components from the electronics list. Mark handles CAD separately. Current machine has **70–72 doors, one lock per door**. Preserve software support for configurable profiles and historical data; do not change physical mappings from assumptions about door labels or position.

## Source files and safe ownership transfer

Authoritative saved source worktree:

`/Users/markthomas/.codex/worktrees/2dbc/ten-kings-mystery-packs-clean`

Branch: `codex/vault-v1-software-20260907`

HEAD verified September 9: `c4f04006d9302445e2a68b01dcc316def3b4eb73`.

The source has uncommitted purchasing/handoff changes. A new task's default project checkout is not sufficient: the saved project directory `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean` is on an unrelated branch and is not the source of this Vault work. Preserve the source without reset, cleanup, stash removal or overwriting it.

The new lead should work in its own isolated worktree. Before implementation, safely base that pristine worktree on the verified Vault source commit and import the source's tracked diff and all non-ignored untracked files. Use its own `codex/` branch; do not force the already checked-out source branch into another worktree. Verify HEAD/base, tracked diff equivalence and per-file hashes for untracked files before declaring the transfer complete. Do not copy ignored dependencies, caches, environment files or credentials. If the destination already has changes, preserve and reconcile them instead of resetting it. The source task will stop editing after transfer.

A durable transfer snapshot is being saved outside managed worktrees at `/Users/markthomas/tenkings/vault-handoffs/2026-09-09-hardware-live-tests/`. It contains `tracked.patch`, `untracked.tar`, a manifest with source HEAD and file hashes, and a readable copy of this handoff. Use this snapshot for intake so later workspace cleanup cannot silently lose the purchasing work. Inspect its manifest and archive paths before applying; verify the imported content against the manifest. This transfers no ignored files or credentials.

Current handoff files to preserve:

- `docs/handoffs/SESSION_LOG.md` — modified tracked file, append-only history.
- `docs/vault-v1/EXTERNAL_EVIDENCE_PACKETS.md` — modified tracked file, September 9 photo/direction update.
- `docs/vault-v1/HARDWARE_PURCHASING_PLAN_2026-09-08.md` — untracked, current source/price/decision log with a superseding September 9 section.
- This handoff — untracked.
- `outputs/01a07f31-162f-7e52-97bb-414e47a68aaa/Ten_Kings_Vault_Master_Parts_List.xlsx` — untracked historical artifact.
- `output/pdf/Ten_Kings_Vault_Hardware_and_Connection_Guide.pdf` — untracked historical artifact.

Read AGENTS.md and its mandatory files before task actions: `docs/context/MASTER_PRODUCT_CONTEXT.md`, the full `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`, both `docs/runbooks/DEPLOY_RUNBOOK.md` and `SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, and `docs/handoffs/SESSION_LOG.md`. The approved V2 card blueprint is context/isolation authority; do not add unrelated card-platform or ATLAS work to Vault.

Then read this handoff, the purchasing plan, `PRODUCT_BASELINE.md`, `MACHINE_PROFILES.md`, `GATE_LEDGER.md`, `TEST_AND_CERTIFICATION_MATRIX.md`, `EXTERNAL_EVIDENCE_PACKETS.md`, and package READMEs. Code/runtime evidence governs implementation claims. The September 7 `FRESH_TASK_HANDOFF_2026-09-07.md` is historical; its old source path, pre-review test state, model/team instructions and larger procurement scope are superseded here.

## Inventory: owned, ordered, unresolved

| Part | Current status and evidence | Next check |
| --- | --- | --- |
| SER5 mini PC | Owned; photos confirm Ryzen 5 5500U, 16 GB RAM, **480 GB** storage, 2.5 GbE. SKU `SER5-5500U-16480EJ0W64PRO-DP/XB`. Input **19 V DC / 3.42 A**. Keep this computer. | Not set up. Check matched PSU, OS/BIOS, network and Linux operation. `W64PRO` does not prove Windows version/activation. |
| Touchscreen | Owner reports purchasing after the **Acer PM161QT bmiuuux / UM.ZP1AA.004**, Best Buy SKU6643109, **$129.99** discussion. Exact bought model has not been photographed. | Confirm label and box contents once; check video cable, USB touch data cable and screen PSU. |
| Keyboard, mouse, USB drive | Owner reports purchased; keyboard supports Linux/Windows/macOS. Exact models differ from examples. | Use for setup. Do not buy duplicates. |
| Nayax VPOS Touch | Owned; photos confirm PN **R144GUSY01S10**, rear 40-pin connector and small LAN connector; SIM physically installed. | Kit compatibility, firmware, account/test configuration and live function unverified. Do not disclose serial/SIM IDs in docs or searches. |
| Nayax antenna and PSU | Owner confirms both owned. | Check actual PSU label/output and harness fit. Original approved kit uses 24 V; do not repurpose the SER's 19 V or lock's 12 V supply. |
| Original Nayax USB2COM C310004 | Owner says 90% sure owned. | Find/identify when convenient; keep status probable. |
| **FTDI CHIPI-X10 backup** | **Owner confirmed ordered September 9**, expected September 10. [Amazon B00HKJVRDS](https://www.amazon.com/dp/B00HKJVRDS), observed **$42.79**, quantity one recommended. | Not received/tested. Listing manufacturer FTDI and part CHIPI-X10-FTDI; sold by VirtuGlowe/shipped Amazon. Brand field Best Price Square was disclosed. Confirm actual received identity. |
| Nayax Marshall harness | **Unconfirmed; may be missing.** Nayax lists regular VPOS Touch/Onyx harness **C130011**. Booklet showing MDB cable is not ownership evidence for Marshall. | Confirm correct kit/revision with Nayax before ordering. No current US price/fast purchase link verified. |
| **INNOMAKER isolated USB-RS485** | **Owner confirmed ordered**, expected September 10. [Amazon B0B2QSW67D](https://www.amazon.com/dp/B0B2QSW67D), **$24.99**, sold by InnoMaker USA/shipped Amazon. | **One per machine**, shared by all relay boards. Check breakout/pinout, termination, received identity and Linux enumeration. |
| Waveshare controller | **Owner confirmed ordering one 32CH board for the first test.** Amazon B0CC5P8NC2, observed $84.99. Not received/tested. | Use this for the bench. Buy remaining cabinet boards after qualification and the final configuration choice. |
| ATOPLEE B01IBEVV0Y lock | Owner selected and owns at least one lock. Supplied specification **73 × 58 × 13 mm; 12 V DC / 2 A**. | Verify label, polarity, pulse/duty limits, suppression and measured load. Do not use old 0.43 A assumption. |
| CHANZON lock/controller bench PSU | **Owner confirmed ordered September 9**, one 12 V / 5 A / 60 W enclosed supply, [Amazon B073QTNF9F](https://www.amazon.com/dp/B073QTNF9F). Observed $19.99 ($18.99 optional coupon) and September 10 delivery before purchase; invoice and order arrival unconfirmed. | Not received/tested. Check actual label, polarity, included DC connector and measured bench operation. Separate cabinet sizing still required. |
| Fuse holders/fuses | **Earlier two-holder proposal deferred; not ordered.** Historical candidate: Littelfuse 0FHA0030XP, [Amazon B000COA2ZW](https://www.amazon.com/dp/B000COA2ZW), observed $6.99 each. | Evaluate one main DC fuse with the actual shared wiring and supply fault response before buying protection parts. No final count/rating established. **Do not use the candidate's included 30 A fuse.** |
| Bench wire | **Owner confirmed purchased September 9:** one BNTECHGO 18 AWG stranded tinned-copper silicone wire kit, [Amazon B01AQOI36M](https://www.amazon.com/dp/B01AQOI36M), **10 ft red + 10 ft black**, observed **$9.48**, sold BNTECHGO-US/shipped Amazon. Prior listing showed September 10 delivery to 95762; final invoice/arrival unconfirmed. | Not received/tested. Short 12 V connections for one lock/one board. Recommended variant "18 gauge silicone wire 10ft and 10ft". Confirm suitable terminations and complete protection before wiring. Full cabinet harness type/quantity remains route-dependent. |
| Bench splice connectors | **Already owned:** Mark reports plenty of WAGO connectors. **Remove the proposed kit from the buy list.** Exact models/port counts unknown. | Use owned connectors suited to 18 AWG fine-stranded copper; identify series before wiring. The former $12.45 Amazon B0CJ5QF4Z2 proposal is historical only. All ports in a 221 splice are common; positive and negative stay separate. |
| Digital multimeter | **Owner confirmed ordered September 9 ("done and bought"):** one [AstroAI M4K0R, Amazon B08DHHJPS1](https://www.amazon.com/dp/B08DHHJPS1), recommended **Auto-Ranging** style. Earlier observed **$19.99 Prime price**, sold AstroAI Direct/shipped Amazon, September 10 delivery to 95762 for quantity one; invoice, order variant and arrival unverified. Listing includes test leads and two AAA batteries. | Not received/tested. One shared setup/service tool for all Vaults, for basic DC voltage/polarity and unpowered continuity checks. Approximately 3 readings/second is insufficient evidence for capturing 100–200 ms current peaks or switching transients; do not extend lock pulses to read it. |
| Distribution, suppression, remaining terminations | Not yet selected/confirmed purchased. | Choose the simplest shared-feed connection arrangement and necessary protection together. Size bench and cabinet separately against enforced simultaneous load. |
| Router/network | Not yet selected. SER has Ethernet and needs its own network connection. | Existing internet/Ethernet may be enough for bench testing. Determine site Wi-Fi/Ethernet/cellular requirement before buying router or service. |

All prices are observed listing references, before tax, not final invoices. Delivery is an estimate to the existing ZIP, not a guarantee. Mark performed purchases; the agent made no cart, checkout or vendor-message actions.

Mark asked what the fuse holders do and how many one complete Vault needs, then challenged unnecessary complexity because only one lock operates at a time. The original two-holder proposal covered the one-lock bench and is now deferred. A centralized fuse block is not a default requirement either. Chanzon advertises overload/short protection; Waveshare lists onboard protection but also calls for a fuse/breaker in its switched load circuit. Determine minimum effective protection against the weakest downstream wire/connector and actual fault behavior. Normal short pulses do not prove fault protection unnecessary. See the purchasing note's latest owner-clarification section for evidence and the shared-feed candidate.

Mark next said "no additional protection part" and asked what to buy next. Clarified that the purchase was deferred, not that zero extra protection has been qualified. He subsequently confirmed buying the one-pack bench wire and the AstroAI M4K0R multimeter, and reports owning plenty of WAGO connectors. No connector purchase needed. His latest request is an overview of what remains. **Next check is whether he owns the Nayax Marshall harness**, before recommending another purchase. Other unresolved accessories, wiring design, software integration and full-machine expansion are itemized in the purchasing note's remaining-work review. Continue preparation without re-recommending owned or purchased parts.

## Controller count, current cost comparison, electrical constraints

One channel controls one independently addressable lock. All boards share one RS485 bus with distinct board addresses and appropriate termination. The lock bus's **RS485** adapter is separate from Nayax's **RS232** adapter.

| Proposed complete-machine configuration | Capacity | Current observed subtotal including the ordered $24.99 INNOMAKER |
| --- | --- | ---: |
| Three Waveshare 32CH boards | 96 outputs; 24–26 spare | **$279.96** = 3 × $84.99 + $24.99 |
| Two 32CH plus one 8CH(B) | 72 outputs; 0–2 spare | **$237.96** = 2 × $84.99 + $42.99 + $24.99 |

Mixed option saves $42 but needs qualification/support of two controller models. Neither total includes supplies, wiring, protection, locks or tax. Older purchasing tables used a $25.99 Waveshare adapter and are $1 higher; use the ordered INNOMAKER in the next workbook.

- **32CH:** Waveshare SKU25140, [Amazon B0CC5P8NC2](https://www.amazon.com/dp/B0CC5P8NC2) $84.99; direct $62.99 before shipping. 7–36 V input, **12 V recommended, PSU excluded**; enclosure 300 × 110 × 60 mm. [Manufacturer wiki](https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH).
- **8CH(B):** SKU25739, [Amazon B0CLV4KNKX](https://www.amazon.com/dp/B0CLV4KNKX) $42.99; direct $29.99. 7–36 V, 12 V recommended, PSU excluded. Do not accidentally substitute the latching 8CH(C).
- Both Amazon listings showed September 10 for a single unit on September 9; do not extend that observation to a multi-unit checkout. No 36/40-channel Waveshare RTU model was verified.
- The earlier 16CH SKU24921 is historical; it uses 5 V and **includes** its 5 V/2 A supply. Do not carry its power assumptions into the 32CH plan.
- Relay contacts are dry switches; board power does not automatically supply the lock. Power the 32CH through only one of its power inputs.
- Board-timed flash-on is documented in **100 ms increments**. `MACHINE_PROFILES.md` reports the CAD task's seller-stated **0.2 second maximum single unlock signal** for this lock. That is not a qualified pulse, duty cycle or cutoff. Never use a vendor example's longer pulse or an all-relays-on demo with the locks attached.
- Bound energization through the actual controller behavior; qualify startup/reset OFF, host loss, repeated/retriggered commands and inductive switching. Onboard relay-driver diodes do not establish suppression of the external lock coil. Coil-state readback is not door-open confirmation.
- A regulated enclosed **12 V / 5 A** supply is a research starting point for one-lock bench power, not an approved full-cabinet design. Account for controller consumption and measured lock current; decide concurrency before cabinet supply sizing. Adafruit352 at an older $24.95 reference is only a historical bench candidate, not a verified next-day Amazon item.
- Select matched DC connectors, wire gauge, branch fusing/distribution and appropriate coil suppression with the supply. Do not instruct Mark to wire exposed mains casually; prefer a suitable enclosed approved external supply for the bench.

## Display, Linux and wiring direction

Mark wants the operating system bundled with Vault, no Windows purchase/dependency, always-on kiosk control and recovery after power loss. **Linux is the owner direction, not completed installed support.** Keep the SER; no Pi/tablet replacement needed.

The discussed Acer is a monitor, not a standalone tablet: 15.6-inch 1920 × 1080, 10-point touch, 13.94 × 8.24 × 0.50 inches landscape, 75 × 75 VESA, mini-HDMI plus USB-C. Its manual describes separate 5 V/3 A or supported USB PD power and says adapter excluded. Confirm the actually purchased model and contents before choosing its cables/PSU. No continuous-duty rating or real touch/restart qualification was established.

SER ports: front two USB-A, USB-C, audio; rear full-size HDMI, DisplayPort, two USB-A, RJ45 Ethernet and DC barrel. No native DB9. USB-C video/power capability was not verified. Planned display path is HDMI video plus USB data for touch and the monitor's matched power.

Omarchy was already investigated: official [omarchy.org](https://omarchy.org/) and [GitHub](https://github.com/omacom/omarchy), DHH, Arch Linux, free/MIT project code, AI tools available with potentially paid external services. Do not repeat basic discovery. It is an evaluation option, not an adopted/installed kiosk OS. Updates, boot encryption/unattended restart, kiosk containment, service restart, credential storage and rollback need a concrete appliance design. Do not wipe/install the SER as part of shopping research.

Nayax documented connection: **SER USB-A → Chipi-X USB-RS232 → Marshall harness COM 2 → VPOS Touch 40-pin**, with the approved Nayax PSU into the appropriate harness. The new backup does not include the Marshall harness. VPOS Touch **does not support Marshall control over Ethernet**; its LAN connection is for Nayax servers. DEX is not LAN. Optional Nayax C140001 is the documented terminal Ethernet adapter, not a generic phone adapter. Installed SIM does not establish active service or internet sharing to the SER.

The proposed diagram after selections should show three separate paths: video/touch; Nayax control and its power/network; lock RS485 bus and fused 12 V power branches. Label provisional interfaces explicitly and keep serial control separate from internet connectivity.

## What software actually exists

Re-read current `packages/vault-machine/README.md` and the adapter implementations at the source HEAD. The app includes deterministic **Nayax mocks and a controller simulator**. It currently rejects real payment/controller dispatch and cannot charge or unlock hardware. The core checkout, inventory, durable recovery, staff and simulation software exists, but the remaining work is **implementation plus physical testing**, not just three final tests.

- G-01: exact Nayax Marshall kit, firmware/SDK/runtime/test configuration, multi-vend flow/limits, callbacks/reconciliation, no-sensor vend-result rule and certification; implement the official adapter.
- G-02: controller protocol/firmware, qualified safe pulse/electrical behavior, actual address/channel map, real adapter and physical lock tests.
- Installed appliance: current source targets Windows; even Windows protected credentials, native packaging/service activation/update/rollback have remaining implementation. Linux service/serial permissions, native SQLite packaging, kiosk startup, protected credentials, signed updates and safe recovery must be implemented/validated for the owner direction.
- Tax/support configuration, deployment and certification/pilot gates also remain. Do not quietly relabel the old G-04 Windows/ViewSonic baseline as a completed Linux/Acer system; distinguish dated owner direction from qualified architecture.

Historical September 7 evidence: 262 software tests (11 contracts, 106 machine, 91 kiosk, 9 database, 45 cloud), 17 browser cases, full Next build and 13 routes, full disposable database migration validation, and historical green PR #339 checks. These are dated software results, not tests repeated on hardware or a current PR-status assertion. No code changed during September 8–9 shopping; no new hardware test passes exist.

Original per-door and session certification requirements remain in the authoritative test matrix (including applicable 5 purchase + 2 restock cycles per door and 500 real observed sessions). A successful single unlock does not satisfy cabinet or payment certification.

## Practical sequence from here

1. Controller order count is confirmed as one 32CH board and the CHANZON 12 V / 5 A bench supply is ordered. Design the simplest shared wiring/connectors and minimum effective protection together for one energized lock at a time. Defer the earlier two-holder purchase. Select appropriate coil suppression. Complete Nayax harness and display accessory inventory so the master list avoids duplicate purchases.
2. Establish the SER's network and choose a router only if needed. Finish the electronics-only workbook with item names, functions, qty per bench and machine, owned/ordered/to-buy status, prices/subtotals, purchase links, source dates and unknown values explicit. Produce the revised simple connection PDF. Apply spreadsheet/PDF skills and inspect rendered output when generating those files.
3. Prepare the Linux installation/kiosk plan and actual controller implementation; collect official Nayax integration prerequisites in parallel as authorized. The purchasing plan already contains a short **unsent** vendor request. Mark needs account/test/integration access; dashboard access alone and an unspecified generic API key are insufficient. Do not ask for secrets in ordinary chat.
4. Bench test progressively: matched supplies and wiring verified, SER/display/touch setup, RS485 enumeration/address/readback, controller safe behavior, then a bounded single-lock cycle when ready. Record observed current, pulse, release and failure/restart behavior. Start with the lock physically unloaded/accessible; do not test by locking away the only access to the machine.
5. Test Nayax through its approved test/certification setup; combine payment-to-selected-lock and recovery/error cases. Scale the verified channel map to all doors, complete required installed/cabinet tests and then plan the separately scoped pilot/deployment.

This request authorizes continuing preparation, research, documentation and the already scoped local development. It does not itself supply missing physical access, firmware facts, credentials or a reviewed actuation setup. Do the authorized preparation before asking for any genuinely required final operational authorization. No vendor messages, actual purchases by the agent, live charges, OS wipes, production deployments/migrations, physical actuation or CAD changes occurred in this shopping session. Preserve existing applicable operational gates without treating every reversible step as requiring new permission.

## Existing artifacts and source references

Current September 9 outputs: `outputs/01a089a3-541f-74c2-9e87-915095421fbd/Ten_Kings_Vault_Electronics_Parts_List.xlsx` and `output/pdf/Ten_Kings_Vault_Current_Parts_and_Connections_2026-09-09.pdf`. They supersede the historical purchasing artifacts below, with incomplete inventory/electrical choices explicit. Spreadsheet formulas/recalculation and every rendered sheet/PDF page were checked. Current tests and visible-preview details are in the linked preview record.

The September 8 XLSX and PDF above are **historical**, with earlier Windows/Elo/StarTech/16CH and mixed CAD planning. Do not call them the updated final list. Preserve them and create a clearly revised electronics-only version after decisions.

Photo originals already inspected: `/Users/markthomas/Downloads/IMG_0077.HEIC`–`IMG_0083.HEIC` and `IMG_0085.HEIC`–`IMG_0098.HEIC`. Do not ask Mark to resend the SER/Nayax model photos. Temporary JPEGs were in `/tmp/vault-hardware-photos-20260909/` and `/tmp/vault-hardware-ports-20260909/`; originals were unchanged.

The purchasing note holds the detailed price history, manufacturer links, source workbook provenance and the unsent Nayax request. Key primary references:

- [Nayax sales kit](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/sales-kit), [installation](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps), [Linux C SDK](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration), [integration process](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process).
- [FTDI Chipi-X datasheet](https://ftdichip.com/wp-content/uploads/2023/07/DS_Chipi-X.pdf): CHIPI-X10, FT231X, USB-A, DB9 male, 10 cm. Generic FTDI/OIKWAN and Sabrent CB-DB9P screenshot items were not confirmed Nayax substitutes.
- [INNOMAKER isolated cable](https://www.inno-maker.com/product/usb2rs485-cable/), [manual](https://www.inno-maker.com/wp-content/uploads/2022/06/USB2RS485-C-UserManual-v1.0-EN.pdf): FT230X, power/signal isolation, Linux, selectable 120-ohm termination and multidrop.
- [Waveshare 32CH](https://www.waveshare.com/Modbus-RTU-Relay-32CH.htm), [8CH(B)](https://www.waveshare.com/product/modules/others/power-relays/modbus-rtu-relay-b.htm).
- [Acer PM161QT exact discussed SKU](https://www.acer.com/us-en/monitors/essential/pm1/pdp/UM.ZP1AA.004).

The fresh lead already confirmed intake/preserved source and Mark bought the recommended supply. Continue with the streamlined shared-power design and only justified remaining bench items; the earlier two-holder recommendation is deferred. Keep technical detail understandable to Mark. Do not spend the next conversation retelling this history.
