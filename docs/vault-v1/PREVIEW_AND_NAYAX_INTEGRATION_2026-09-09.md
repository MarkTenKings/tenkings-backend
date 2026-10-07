# Vault preview and Nayax integration

> September 16 continuation: [fresh integration lead handoff](INTEGRATION_LEAD_HANDOFF_2026-09-16.md) is now current. Mark accepted the UI and requested an Astra Ultra lead with three Astra xhigh workers. It supersedes old team/source/UI-priority instructions. The September 16 check found the old local preview stopped; earlier running-process claims below are dated history.

## Owner request and current result

Mark requested immediate access to the existing UI, software tests, a working first-door path, the Nayax integration and a current electronics list. The local customer/staff UI is running and usable with simulated inventory, payments, controller responses and cloud synchronization. **No real Nayax adapter or physical controller transport is implemented or connected.** This record does not close G-01/G-02 or qualify the installed Linux appliance.

Run from this worktree with Node 20:

```sh
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm vault:preview
```

Open the printed loopback URL. The preview supplies 72 synthetic doors and eight sample Sports/Pokémon price tiers. Choose a product, select a gold door or Pick for me, then Checkout. The mock authorizes automatically, so the preview can move through payment quickly. Review the paid-door screen, the single OPEN DOORS retry and Done. The sold door becomes unavailable. Sample catalog, tax, imagery, geometry and addresses must not become production configuration.

Tap the top-right service corner ten times for staff mode. Disposable test user: `simulator-tech`; PIN: `123456`. Overview, Restock, Health and Certification screens are available. Safe exit requires the displayed confirmation. These credentials are only for the disposable preview.

The server must remain running while the owner reviews. Stopping it removes its temporary database; rerunning starts with fresh stock. The preview is local to this computer, not a deployed public website or an installation on the SER. The original owner session at `http://127.0.0.1:65353` was left running; its random port is not a permanent product endpoint. It predates the cookie-name fix below, but remains usable alone. Subsequent launches include the fix.

## Verification performed September 9

- `pnpm vault:build`: contracts, generated database client, database, machine and kiosk builds passed.
- `pnpm vault:test`: 262 tests passed: 11 contracts, 106 machine, 91 kiosk, 9 database and 45 cloud tests. No production database or real provider used.
- After the session-cookie correction, the complete machine suite passed with **107 tests**, making **263 passing tests across the checked suites**. The unchanged suites did not need repetition.
- `pnpm --filter @tenkings/vault-kiosk test:browser`: all 17 existing browser scenarios passed across legacy, 72/125-door and mixed/long-label fixtures. These tests use mocked HTTP responses.
- The stocked 72-door public-HTTP smoke passed 453 synchronized events and verified exactly one initial command for the selected door, exactly one requested retry for the same door, and maximum one command in flight. No serial bytes or charge occurred.
- The same stocked smoke also passed for 125 doors (503 synchronized events), preserving the configurable machine family.
- Hands-on browser check against a separate running machine service: D1 selected on the first attempt after the cookie fix, $27.06 sample total, simulated paid result naming D1, one retry, Done, empty cart and D1 unavailable. Staff login opened Overview, Restock, Health and Certification controls.

The machine queue already serializes awaited adapter calls globally. This proves one command in flight in simulation; it does **not** prove one energized physical coil. The real adapter must wait for the qualified pulse/off behavior before releasing the queue, including uncertain responses and recovery.

## Correction found during browser testing

Cookies are shared between ports on the same host. Two disposable previews used the same cookie name and caused repeated session renewal. `VaultHttpService` now derives a separate cookie name from its configured origin, while retaining random tokens, HttpOnly/SameSite attributes and origin/session checks. The new regression starts two servers with one shared cookie jar, verifies both sessions work and verifies a foreign cookie cannot authorize the other server. Existing WebSocket authentication tests also pass.

## Nayax integration: concrete next dependency

The owned VPOS Touch uses the official **Marshall SDK over RS232**, not a generic cloud API call to unlock a door. Nayax handles the payment; Vault must durably bind authorization to the selected door and dispatch through its separate controller connection. The [Marshall overview](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-sdk) describes the supported terminal protocol and SDK languages.

The [official integration process](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process) assigns an integration engineer, configures the terminal/backend for the chosen flow, and supplies the SDK and development resources. A targeted project/Downloads check found no Marshall SDK package. Mark has been asked whether he received the integration welcome email or has an assigned engineer. No vendor email was sent.

For Linux x86_64, use the supplied [Marshall C SDK Linux implementation](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration). Pin the actual SDK archive/version/hash, compile its supported platform sample and verify link readiness before implementing the supervised native bridge to the existing TypeScript `NayaxAdapter` boundary. The public examples are reference material, not installed headers or evidence that a particular runtime/firmware combination works.

Implementation sequence once the SDK and terminal test configuration are available:

1. Implement the serial/native SDK bridge with link-ready/communication-error reporting, bounded messages and redacted diagnostics. Keep payment data out of browser state and logs. SDK function signatures and callbacks must come from the supplied package.
2. Bind an immutable Vault sale/request digest to the provider session and transaction identity. Validate currency, decimal places, amount and actual provider limits before starting a session. Do not copy the mock's generous limits into the terminal integration.
3. Map authorization/decline/cancel/unknown/settlement into the existing durable machine lifecycle. Implement the SDK-supported recovery/reconciliation behavior before enabling dispatch. Do not interpret an empty open-session response as proof that an uncertain charge never happened.
4. Agree the one-door initial flow and the later multi-door/multi-vend behavior with Nayax, including taxes and the no-door-sensor vend-result rule. Current `reportVendResult` policy is explicitly `SIMULATOR_ONLY`; it must not silently become a real completion assertion.
5. Verify payment-to-selected-door using the configured official test terminal and qualified controller, including duplicate callbacks, interruption, timeout and no automatic re-charge/re-unlock. Complete Nayax certification before production activation.

Prepared request for Mark to provide to his Nayax contact (unsent):

> We are integrating our owned VPOS Touch PN R144GUSY01S10 with a Linux x86_64 mini PC for Ten Kings Vault lockers. Please assign a Marshall integration engineer and provide the supported C SDK package with Linux sample/build instructions, required firmware and terminal test configuration, and test/certification resources. Our first test is one purchase authorizing one selected door, followed by a multi-item cart flow. Please confirm supported amounts/limits, currency decimal configuration, cancellation/reconciliation and the vend-result policy for locks without door sensors. Please also confirm the correct Marshall harness for this terminal. We already own its antenna and power adapter and have ordered an FTDI CHIPI-X10 backup.

No invented HTTP endpoint, guessed native ABI, mock adapter relabeled as official, vendor message, real charge or physical actuation was introduced.

## Current hardware artifacts

- `outputs/01a089a3-541f-74c2-9e87-915095421fbd/Ten_Kings_Vault_Electronics_Parts_List.xlsx`: 26 current electronics/accessory rows, bench vs machine quantities, owned/ordered/check/design status, historical prices and sources, plus test sequence.
- `output/pdf/Ten_Kings_Vault_Current_Parts_and_Connections_2026-09-09.pdf`: three pages of current components and connection overview.

The known-price ordered subtotal is $332.22 before tax, excluding unpriced orders, owned devices, remaining cabinet parts and service fees. It is not the total machine cost or an invoice total. Unknown harness/display accessory inventory, exact protection/suppression and full-cabinet wiring remain explicit. The September 8 workbook/PDF are preserved as historical and superseded for current purchasing.

## 2026-09-10 customer design update

The new cinematic playable slice is documented in [CINEMATIC_PREVIEW_2026-09-10.md](CINEMATIC_PREVIEW_2026-09-10.md). Use its current loopback link or `pnpm vault:cinematic`; the original 65353 preview remains a separate older process. The visual rebuild does not close Nayax, real lock or SER5/touchscreen qualification work.
