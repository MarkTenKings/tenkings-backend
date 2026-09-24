# Mac finishing setup and hardware acceptance

September 24, 2026: the approved artwork is `atlas-signature-v2` from `f54c7425` (2.73 × 0.83 inches, exact supplied logo, large name, optional variant, plain black reverse). Mark selected **xTool O1 as the printer planning candidate** and accepts xTool Studio UI automation. It is not purchased or physically qualified. Keep `printer:null` and `label:null`; the discovered Epson queue is not a selected or qualified ATLAS printer. The separate hardware research task owns the newer R2 one-conveyor/eight-station concept; see [current qualification and coordination](QUALIFICATION_20260924.md).

The September 8 native ACS ACR1552U/F8215 write/full-readback and Mark's phone scan are standing evidence. Preserve that diagnostic source and evidence. Production writes remain unavailable because the compiled F8215 identity/lock registry is empty. The remaining device work is exact approved-report integration and permanent-lock qualification, not rebuilding basic encoding.

## Read-only Mac prerequisites

Run this local inspection before preparing a production distribution or reconnecting hardware:

```sh
/opt/homebrew/opt/node@20/bin/node packages/atlas-finishing-station/scripts/inspect-mac.mjs
```

It reports the current Mac/Node versions, valid Developer ID Application certificate selectors, local notarization tool availability, local CUPS queue names and ACR1552 USB descriptors. It accepts no options and runs only fixed, bounded local read commands. It does not open PC/SC, read a tag, change reader firmware/settings, print, create/use a private key, access an Apple account or change configuration. Serial numbers and certificate subject names are omitted. A failed or unparseable inspection is `UNKNOWN`, never evidence of zero devices or identities. USB product/version strings do not establish the ACS firmware family; the documented firmware query remains separate. Tool availability does not establish a working notary account.

The September24 05:40UTC inspection observed macOS15.5/Node20.20.1, zero valid signing identities, both Apple tools available, one unqualified `EPSON_ET_2980_Series` queue and no attached ACR1552 in the current USB census. The latest actual reader evidence remains the retained03:30UTC `ACR1552 R FW 1.04.00` receipt; a later disconnected observation does not erase the earlier native encoding evidence. See [the current qualification follow-up](QUALIFICATION_20260924.md). The report always leaves production readiness false because it does not assess the remaining physical, enrollment or distribution gates.

## Software bundle

Build a new review directory from the reviewed checkout using Node 20:

```sh
/opt/homebrew/opt/node@20/bin/node packages/atlas-finishing-station/scripts/build-review-bundle.mjs --output /absolute/new/atlas-station-review
/opt/homebrew/opt/node@20/bin/node packages/atlas-finishing-station/scripts/test-review-bundle.mjs --directory /absolute/new/atlas-station-review
```

The bundle contains the compiled release companion, bundled station JavaScript and dependencies, PDF standard-font metrics, this procedure and exact file/source hashes. Node itself is not bundled: it requires macOS 15 or later, the recorded CPU architecture and an existing Node 20 executable. It includes no keys, credentials, config, journal or installed service. Build and acceptance do not print, perform RF, inspect Keychain or connect to a host. It is an **unsigned review artifact**, not an installed/notarized application. September 24 inspection still found zero valid local codesigning identities; a real Developer ID identity and notarization remain distribution inputs. Do not label an ad-hoc Swift build as a signed production installer.

Use the [production distribution workflow](DISTRIBUTION.md) to sign the exact final native binary with an existing selected Developer ID and hardened runtime, refresh the manifest from the final signed bytes, and create a signed DMG. Its separate submit/finalize commands retain the Apple result, stapled ticket and Gatekeeper assessment, with reconciliation of uncertain uploads. Key access must be tested using that exact installed identity; signing a successor after key qualification is a distinct acceptance step. The review-build commands above still perform no signing or installation.

## Configuration

Follow the exact schemas in [README](README.md) and [native companion](../atlas-mac-nfc/COMPANION.md). Choose an owned private directory (0700) and ordinary files (0600); use canonical absolute paths with no symlink ancestry. Preserve one authoritative state directory across launches/upgrades. Use the bundled native executable's actual SHA-256, the host's actual public P-256 key and key ID, one enrollment UUID/station identity, and the reviewed native profile/protection receipts. Missing qualification hashes must remain missing inputs; zeros or synthetic test hashes are not production receipts.

Keep both printer fields null until the selected hardware/media and physical workflow are qualified. The current implemented printer adapter requires an exact CUPS queue, supported media, explicit sheet dimensions/face placements/rotations, palette, layout version and physically verified qualification hash. `renderProfileHash` comes from the same `createManualLabelPdfRenderer` used for printing. O1 Studio is a different adapter still to be qualified; do not register it as a CUPS queue or substitute an Epson queue. No OS default printer, default paper, duplex setting or scale is adopted implicitly.

For an already prepared configuration, validate files and the actual native parser without device/key/journal effects:

```sh
/absolute/node20 /absolute/atlas-station-review/station.mjs --check-configuration /absolute/private/station.json
```

The result reports configuration validity and whether a printer profile is configured. `hardwareInspected:false`, `keychainInspected:false` and `hostedActivationChecked:false` are explicit. Valid configuration does not establish qualification, key provisioning, host activation or readiness. Ordinary launch is the separate `--configuration` command; that command can query an existing key and start the loopback bridge. It never generates a key. Key creation remains the native explicit `init-key` setup command after exact identity/configuration review.

## Required F8215 qualification input

The [GoToTags supported-device table](https://gototags.com/desktop-app/features/nfc/supported) identifies F8215 as Feiju Type 2 but does not provide native identity, memory-map or permanent-lock commands. The manufacturer site, [Feiju](http://www.nfcic.com), was not retrievable in the September 23 search. No authoritative F8215 lock specification was recovered. An F8216 document, reseller compatibility statement, CC capacity, the number “215”, or NXP NTAG215 datasheet does not establish this F8215 lot's security map.

Obtain a manufacturer-authored exact F8215 revision/lot document or independently reviewed same-lot qualification evidence covering identification, user and security pages, static/dynamic lock coverage and order, reserved bits, irreversible block-lock behavior, ACK/NAK and transport. Preserve document bytes/hash. Review and implement a fixed compiled profile; runtime configuration cannot provide lock commands. A controlled qualification tool must journal the exact approved write/lock attempt, read back security/data state and independently attempt a different payload on each covered data region after removal/re-presentation. A software refusal before transmitting is not physical overwrite-rejection evidence. Prepare that exact one-tag action for review only after the map is known; no ordinary card tag is used to discover undocumented masks.

## Minimal operator acceptance

1. **Printer:** qualify the O1/Studio path with the actual intended precut black stock and tray. Preserve approved artwork and exact scale through export/import, then record actual job identity, observed printer state, output and inspection. A Studio save alone is not a print receipt. Measure both faces as 2.73 × 0.83 inches, inspect bold name/logo/gold/opaque black reverse, margins and orientation, and fit the result with the NFC inlay into the actual slab. Record material and physical measurements. The existing CUPS adapter remains available only for a separately selected/qualified conventional path; its spool completion also does not prove physical output. Save the resulting fixed profile; do not alter a profile while jobs using it require recovery.
2. **Reader qualification:** connect the existing ACR1552U. Run the unchanged read-only `atlas-mac-nfc-probe list` and, with a designated same-lot test tag, `inspect` once. Compare the safe observed profile to the approved exact documentation. No driver restart or new diagnostic write is needed to re-prove the historical native writer. Execute the separately reviewed one-tag full-write/readback/lock/hardware-overwrite-rejection qualification only after the fixed compiled profile and exact action are ready. Record safe result/command class/timing, never raw UID or UID digest.
3. **Station identity and one report:** provision the explicit protected key once with the final installed signed companion; pair ordinary staff access and have deployment pin the actual public fingerprint/protection/profile receipts. Confirm active hosted enrollment. A human approves one real report and explicitly associates that physical card. Launch/connect the station, select **Use for approvals**, and choose **Finish at station** for that report. Place one fresh qualified tag. Confirm exact versioned URL readback, verified permanent lock, hosted WRITE acknowledgement, physical removal and hosted removal acknowledgement. After reader-observed removal and re-presentation, verify the same exact report/version URL natively and compare its report/card image in ATLAS on the Mac. Mark’s September23 direction requires no phone or GoToTags operational step. Inspect the separately recorded physical print result. Assembly/welding remain human actions.
4. **Recovery and batch:** verify a completed intent/reload/restart cannot print or encode again. Use fake hardware for destructive fault injection; separately reviewed real disconnect/sleep/removal tests retain UNKNOWN outcomes without automatic replay. A saved signed receipt may reconcile but never re-authorize writing. Complete the supervised ten-card cohort before measuring/expanding throughput. Stop on an unresolved physical intent; never clear journals, re-pair or extend expiry to force another write.

At this checkpoint steps 1–3 need actual external inputs/physical evidence. Software tests and the approved artwork do not establish those outcomes.
