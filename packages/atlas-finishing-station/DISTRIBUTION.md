# Signed Mac distribution

`scripts/distribution.mjs` packages the existing reviewed station as a signed, notarized DMG. It does not install a service, generate a station key, enroll, print or access NFC. The existing companion's unqualified F8215 state stays unqualified after signing. Node 20 remains a separately installed prerequisite; the distribution contains bundled JavaScript dependencies, not the Node executable.

Use a clean committed source and first build/test the review directory described in [SETUP](SETUP.md). Review the source commit and complete input manifest. The production packaging command rejects dirty source, omitted or extra payload files, changed bytes and symlinks. Select an existing **Developer ID Application** identity by its exact 40-character certificate SHA1 and ten-character Apple team ID. It does not create/import certificates or accept an ad-hoc/Apple Development identity.

The following example arguments are descriptions to replace with the actual paths/identity. Do not enter secrets in command arguments or chat. `plan` verifies local bytes only and creates nothing; it does not query Keychain or Apple.

```sh
/absolute/node20 packages/atlas-finishing-station/scripts/distribution.mjs plan --directory /absolute/review --identity CERTIFICATE_SHA1 --team-id APPLE_TEAM_ID --output /absolute/new/distribution
/absolute/node20 packages/atlas-finishing-station/scripts/distribution.mjs build --directory /absolute/review --identity CERTIFICATE_SHA1 --team-id APPLE_TEAM_ID --output /absolute/new/distribution
```

`build` queries available signing identities, copies into a new private output directory, signs the native executable with a stable identifier and hardened runtime, verifies actual Developer ID/team/timestamp, and preserves the old review directory. It replaces the copied manifest's native hash with the **signed bytes**, verifies every payload member, creates the DMG and signs it. `build.json` records both code-signature observations, native/manifest/archive hashes and the original review binding. It neither submits to Apple nor claims installed/provisioned/physical readiness. The output directory is exclusive; a failed build is retained for inspection.

Check the signed payload with the same hardware-free bundle acceptance:

```sh
/absolute/node20 packages/atlas-finishing-station/scripts/test-review-bundle.mjs --directory '/absolute/new/distribution/ATLAS Finishing Station'
```

After that check, upload using an **existing** named `notarytool` Keychain profile for the corresponding Apple account/team:

```sh
/absolute/node20 packages/atlas-finishing-station/scripts/distribution.mjs submit --directory /absolute/new/distribution --profile EXISTING_NOTARY_PROFILE
/absolute/node20 packages/atlas-finishing-station/scripts/distribution.mjs finalize --directory /absolute/new/distribution --profile EXISTING_NOTARY_PROFILE
```

Submission is once per output directory. Its intent is flushed before Apple upload; its full bounded process response is retained. A lost reply or timeout does not authorize a second upload. `finalize` queries that submission and reports pending/rejected status without claiming readiness. On acceptance it requires Apple's log to identify the exact submitted SHA-256, checks unchanged payload/native bytes and original archive code-directory hash, staples the ticket, validates it and runs disk-image integrity plus Gatekeeper assessment. The final `distribution.json` binds the actual post-stapling DMG hash. A retry can verify a previously stapled image without re-signing or uploading it.

If the submission reply was lost, recover its actual UUID from Apple's submission history using the same account, then supply `finalize --submission-id UUID` with the other options. The matching accepted Apple log and original archive digest are still required. A supplied UUID may not replace a different ID already recorded locally. Preserve uncertain submissions and all output files. A missing/partial or changed DMG is not repaired by this command.

Only distribute `ATLAS-Finishing-Station.dmg` after `distributionReady:true`. That means signing/notarization/assessment passed; check the retained `capabilities` separately. Open the verified DMG and copy its payload files together into a new owned private version directory. Keep configuration and the authoritative state directory outside the distribution. Run bundle acceptance and `--check-configuration` against the installed bytes, update the exact native executable hash/path, and qualify protected-key access using that installed identity before hosted enrollment. Never replace an installation or change the profile while an existing physical operation requires recovery. The launcher is `node20 /absolute/installed/station.mjs --configuration /absolute/private/station.json`; no automatic launch agent or hidden startup is installed.

The one-card qualification still requires an exact admitted F8215 map and real permanent-lock evidence, selected printer/media fit, actual station provisioning and a human-approved report. Signing cannot supply those facts.

Primary references: [Apple packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow), [Developer ID](https://developer.apple.com/developer-id/). CLI options are also checked against this Mac's `notarytool` and `stapler` help; standalone command-line executables receive their stapled ticket through the supported DMG container.
