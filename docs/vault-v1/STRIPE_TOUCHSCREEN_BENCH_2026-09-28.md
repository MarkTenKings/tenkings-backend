# Stripe Test mode touchscreen bench on the Omarchy SER

## Purpose and boundary

Run one real touchscreen checkout through the local Vault HTTP service, SQLite sale record, Stripe Terminal test adapter, Ten Kings Stripe Test mode, and a simulated WisePOS E reader. The machine controller, products, doors, cloud responses, and machine enrollment are disposable simulations. The SER's physical Waveshare controller is not opened. This is a development acceptance run, not a production installation or UX700 qualification.

The September 28 API-only success/decline/cancel checks established the Stripe adapter and restricted key, but did not touch the screen. This bench closes that specific gap. Its test card is presented automatically by the bench harness only after Stripe shows the exact reader processing the exact PaymentIntent recorded for the local sale. An ambiguous card-presentment response is not retried automatically.

## Preparation

1. Use the current Mac Vault checkout to export a **new** allowlisted source candidate with `deploy/vault-linux/candidate-bundle.py`; the September 17 r3 candidate has no Stripe implementation. Verify the candidate locally, then transfer it to a new create-only directory on the SER over the existing authenticated SSH connection. Verify the exact manifest again on the SER before copying it into a fresh native working directory. Preserve the old r3 transfer and preview.
2. In that fresh SER working directory, use the previously verified Linux Node 22.23.2 / pnpm 9.12.0 toolchain. Install from the frozen lockfile, rebuild native `better-sqlite3` on Linux, build contracts/machine/kiosk, and run contracts/machine/kiosk tests plus SQLite probe. Record command, source-manifest hash, version and test output. Do not copy Mac `node_modules` or `dist`.
3. Confirm port `127.0.0.1:55498` is free. The old mock preview, if still running on `55497`, is independent and must not be killed as a shortcut. Confirm the real controller is idle, and do not attach `STRIPE_TEST` to it.

## Run

From the verified, built SER candidate root, with the pinned Node 22 executable first in `PATH`:

```bash
bash scripts/vault-stripe-tenkings-touchscreen-bench.sh
```

Enter the restricted **test** key at the hidden prompt on the SER or through an authenticated SSH terminal from the Mac. Do not put it in chat, a shell command, source, or a file. The script binds the already tested simulated reader `tmr_Grfd3goSmo63gj` and test Location `tml_GrfdkgIYV0Y3Qv`, starts a disposable signed synthetic configuration, stocks synthetic doors, and serves only loopback. It refuses a non-test key, a non-simulated or mismatched reader, and a busy reader. Its printed purpose must be `DISPOSABLE_STRIPE_TEST_TOUCHSCREEN_BENCH`.

On the SER's Chromium touchscreen open:

```text
http://127.0.0.1:55498/?experience=portrait
```

Select one stocked product/door and tap Checkout. The same bench process watches the exact pending Stripe reader action and presents the Stripe test card. Wait for the kiosk to show the paid flow; verify the selected simulated door was the only door commanded. Press Ctrl+C in the bench terminal after observing the UI. The script prints safe sale/PaymentIntent/payment-state/simulated-door-command evidence, then deletes only its own disposable SQLite working directory. Preserve the terminal output separately as the acceptance receipt.

## Pass criteria and limits

- The kiosk UI visibly reaches the paid flow from a touchscreen checkout.
- The Stripe test reader preflight shows `simulated_wisepos_e`, the expected `tmr_`/`tml_` pair, and `unattended=false` for this protocol test Location.
- One test PaymentIntent binds the same machine, sale, reader, Location, amount and currency; the local machine records `SETTLED` only after Stripe reports capture.
- The terminal summary reports the sale and exactly the selected simulated door command accepted. No real relay is energized.
- No duplicate PaymentIntent or door command appears after the customer interaction. An unknown result is held for review rather than repeated payment.

The run does **not** prove a real UX700, unattended off-premise configuration, receipt/refund delivery, cloud webhook or production enrollment, installed systemd service, reboot persistence, physical lock control, or real money. Those remain separate gates.
