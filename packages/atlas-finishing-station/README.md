# ATLAS Mac finishing station

This package is the executable local bridge for the authenticated ATLAS staff workspace. Imports are cold. Only an explicit launcher invocation starts the fixed loopback server; only a verified, short-lived hosted arm for an exact published production approval can dispatch finishing.

Production NFC remains **SETUP_PENDING** while the native compiled F8215 lock qualification registry is empty. The printer must also have an explicitly qualified media/layout/render profile. Configuration alone cannot qualify a tag or supply security-page commands. This implementation has no fixture bypass, generic print/write endpoint, key generation on startup, device discovery, or external HTTP client.

## Launch after operator provisioning

Use [setup and acceptance](SETUP.md) for the reproducible review-bundle build and exact remaining hardware steps. `--check-configuration /absolute/private/station.json` validates the protected files, executable digest, actual native parser and optional render/media profile without Keychain, reader, printer, journal or hosted effects. It cannot claim readiness. The same parser check runs before ordinary startup; malformed native config is not hidden as a missing key. A missing selected printer remains `printer:null,label:null`.

Use Node 20 and a reviewed native `atlas-mac-nfc-companion` build from `packages/atlas-mac-nfc`. Provisioning, existing protected Secure Enclave identity, host trust, activation and physical printer/tag qualification are separate operator steps. Ordinary launch does not create a key.

```sh
pnpm --filter @atlas/finishing-station exec atlas-finishing-station --configuration /absolute/private/station.json
```

The launcher prints a one-use, two-minute `https://atlasgrading.com/admin/station#atlasStationLaunch=v1&atlasStationPair=…` link. The page removes the fragment before making requests. Pairing yields a memory-only token. Browser reload requires the launcher link again; hosted enrollment persists. Restart the launcher for a fresh code; active physical intent journals remain and are never reset by pairing.

The launcher reads this exact configuration shape; values below describe required inputs and are not a usable production profile:

- `version`: `atlas-finishing-station-config-v1`
- `origin`: exactly `https://atlasgrading.com`
- `nativeExecutable`: absolute reviewed native executable path
- `nativeSha256`: reviewed executable digest
- `nativeConfigurationPath`: absolute native protected configuration path
- `stateDirectory`: absolute private state directory
- `printer`: qualified `atlas-cups-printer-v1` configuration, or `null` while pending
- `label`: `{layout, palette}` accepted by `@atlas/finishing/label-pdf`, or `null` while pending

`printer` and `label` must both be present or both be null. `printer.renderProfileHash` must equal the renderer's computed `.profileHash`; actual media dimensions, face positions and feed rotations are explicit, never guessed. The native configuration follows `atlas-mac-companion-config-v1`, including the pre-provisioned enrollment UUID, key identity, protection evidence hash, pinned host SPKI, and expected profile bounds/hashes. Do not substitute placeholder qualification values as authorization.

The runtime selects the PDF generator using `printer.layoutVersion`. `atlas-noir-gold-v1` retains the original PDF bytes, metadata and render profile for existing plans/journals; `atlas-signature-v2` selects the new artwork. Each generator refuses plans for the other layout. Direct callers of `createManualLabelPdfRenderer` default to v2 and must pass `layoutVersion: 'atlas-noir-gold-v1'` explicitly when recovering a v1 job. Do not change an existing station's qualified layout/profile while its saved jobs need recovery.

Configuration files must be owned by the current user, mode 0600, in an owned 0700 parent. Paths must be canonical absolute paths with no symlink ancestry. The reviewed executable and ancestors must be owned by the current user or root and not group/world writable (root-owned sticky ancestors are allowed). Reads use `O_NOFOLLOW` and descriptor metadata. The executable digest is checked before spawning. The native executable independently verifies its configuration and signed host arm.

## Transport and effect boundary

The server binds only `127.0.0.1:47664`. It accepts only the exact Host, exact first-party Origin, a one-use pairing secret or the memory token in `x-atlas-station-token`, bounded JSON, and seven allowlisted routes. Cookies, Authorization, arbitrary URLs, printer/device/file paths, APDUs, lock bytes, query strings, and unknown paths are refused. CORS and private-network permission name the same exact first-party origin. Hosted CSP permits this fixed companion origin only.

The browser relays signed enrollment proof, signed arm, signed WRITE/removal receipts, and signed committed acknowledgements. Hosted trust pins a reviewed existing station identity and qualification; browser capability booleans cannot enroll or arm an untrusted station. The native companion runs newline JSON over stdin/stdout with fixed argv, no shell, and no inherited provider/key environment. Full durability uses native `F_FULLFSYNC` over inherited descriptor 3.

## Operator flow and recovery

On `/admin/station`, connect the launcher, enroll/check activation, and explicitly choose **Use for approvals** when ready. Approval then selects a native dispatch marker in place of a browser print popup. Both ManualCards and BatchGrading supply their current staff/CSRF context. An existing approved report does not dispatch on mount. **Finish at station** is an explicit action. A selected but disconnected/uncertain station never silently falls back to browser printing.

The bridge reserves one exact active plan durably before effects. CUPS and NFC preparation dispatch independently and maintain separate evidence. The NFC core only writes after qualified single-tag presence, verifies NDEF/readback/lock, and retains the signed WRITE result. The browser relays that result to the host and returns its signed acknowledgement. Physical removal and the signed hosted removal acknowledgement are required before releasing the bridge slot. Assembly and welding are not inferred.

Recovery prefers the existing local operation and relays its saved receipts; it fetches the original hosted arm only after an actual local 404 `STATION_INTENT_MISSING`. The same stored request UUID/body is reused. Lost print submissions and interrupted NFC writes are never automatically repeated. A crash after bridge reservation but before NFC reservation can prepare the still-authorized missing NFC intent, but never resubmits printing. A restarted native process restores an existing signed receipt in custody-only mode; no write capability is restored. An expired arm permits only already-signed evidence/host acknowledgement reconciliation: no new RF, signature or deadline. Missing removal proof after expiry remains occupied for operator reconciliation.

Private bridge/NFC/CUPS journals retain exact source binding and receipts. Interrupted mutation locks are not automatically removed. Re-pairing, closing a popup, refreshing a page, changing cards, and restarting the process do not clear a physical operation. A verified final removal acknowledgement resets only the native child session for the next card.

## Verification

```sh
node --test packages/atlas-finishing-station/test/*.test.mjs frontend/atlas-app/test/manual-finishing.test.mjs
```

Tests use ephemeral synthetic cryptographic identities, private temporary files, injected native/process/CUPS implementations, and loopback HTTP. They do not create a real protected key, contact hosted services, query paid providers, print a label or touch an NFC reader. Native lock qualification, actual printer fit, managed installer signing/notarization and browser private-network policy require their separate release evidence.
