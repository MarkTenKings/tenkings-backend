# Rapid Photos camera background control — September 28, 2026

## Requested behavior

Staff Rapid Photos starts every new Front and Back photo on **Black**. The camera footer exposes **Photo background: Black / White**, letting the operator choose White before pressing the shutter. After successful durable local storage, the next photo returns to Black. Failed storage keeps the selection for retry. The shared customer camera does not expose this staff-specific setting.

## Implementation

The shutter snapshots side and background before asynchronous acquisition. `saveSide(side, file, acquisition, matColor)` durably stores `photoSettings[side].matColor` alongside the exact original, separately from image acquisition provenance. A completed pair freezes both settings; legacy partial sides without metadata inherit Black. Existing completed journals without capture settings retain their previous recovery behavior.

Before either original is uploaded, the importer reads the newly created card, journals an exact idempotent details command for `frontMatColor` and `backMatColor`, verifies the saved response and current settings, then permits uploads. Network failures retry the same command on the existing bounded cadence. Conflicts and malformed responses retain originals and surface an explanation; they never invent a new action or replace a different original. No database migration, native geometry/image-policy change, or model call is required.

## Qualification before release

- Staff: 744 tests pass, zero skips; production build and browser/server boundary checks pass.
- Customer: 51 tests pass, zero skips.
- Importer: 45 tests cover all four background combinations, later-card independence, legacy reload, pending exact-byte upload recovery, source conflicts, duplicate shutters, failed local writes, lost settings replies and the eight-attempt network retry cap.
- Camera tests verify the background snapshot while acquisition is delayed, disabled controls, delayed durable acknowledgement, success-only reset, failure retry, and opt-in shared UI. The staff adapter test verifies both side arguments remain separate from acquisition metadata.
- Actual Chrome UI with synthetic camera and blocked network: White Front retained through IndexedDB reload; its Back defaults Black; next card stores Black/White independently. Both original PNG blobs remain present. Controls remain visible at measured CSS viewports 320×567 and 844×390; Black/White targets are 44 CSS px tall.

The browser fixture uses actual BatchImport, shared camera, IndexedDB and Web Locks. It does not prove physical-camera quality, live authenticated upload or geometry accuracy. Existing lossless/canonical image policy is unchanged.

Private evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-capture-background-20260928` (build/test logs, `browser/browser-proof.json`, and camera screenshots). Local fixture: `frontend/atlas-app/scripts/capture-background-fixture.mjs`.

## Production release and observed result

Web source `68c99d88e851082d995b92ad12b3fff7b4b85a3b` is live, verified 2026-09-28T08:54:58 UTC. Staff is `dpl_AX43y9FoUqskqyTVhk8THtPkZuZF` / `atlas-grading-staff-af3zmgiki-ten-kings.vercel.app`; public is `dpl_HoukkQFCBxuTwqKef6ccHcZu2P3o` / `atlas-grading-public-6stf4pv5c-ten-kings.vercel.app`. All four public aliases were read back on the candidate. Customer remains its existing d4a deployment. The public build only updates the staff routing target; homepage and report presentation are preserved.

The exact private source 65b/image 21326f is retained. Container `c2dd462d5ed2a10db02b957fedc2d1e53bf9dd66051bf2036875ca64365cf4a6` started 08:51:27.868549054Z, with zero automatic restarts/no OOM. Protected config `/opt/atlas/capture-background-release-20260928/candidate.docker.env` has SHA256 `3a2e373f9eeb1cb53e33cfd0a31a3c667aa178bfd35036c5ea5572e62a15f25a`. Only the two staff web-binding values changed. Source manifest, native artifacts, geometry engine identity, capacities, resource/isolation/network settings and 125-second replay fence are unchanged. Predecessorbc5265 is retained stopped/exit 0/restart disabled/network detached.

Fresh independent postflight verifies all 1,007 source files and 16 native artifacts, exact expected controls 46/44/26, and byte-equivalent counts/fingerprints for all 23 grading-history tables and all 62 existing jobs. Staff/public ledgers 59/112 and customer controls 15/13 remain unchanged. Zero active/unsettled work was present. Three signed read-only TLS requests passed; the serving processor confirms `atlas-prepared-lossless-webp-v1` with lossless=true. The 33 canonical route/assets checks pass, including the new background-control/persistence code, original homepage, nine exact approved voice files and existing approved Abomasnow report. No grade, finding, original photo or approval was rewritten; no paid model request was initiated.

Additional public qualification: 38/38 tests and production build/boundary pass. Total 833 staff/customer/public tests pass, zero skips. Authenticated physical-iPhone capture acceptance remains with Mark; local synthetic-camera and durable-storage evidence is not represented as a live real-card test. The existing unsaved user geometry tab was never reloaded, navigated, saved or closed.

Release receipts are in the private evidence directory’s `release/`: `preparation-summary.json`, `runtime-prepared.json`, `database-cutover-result.json`, `signed-probes.json`, `promotion.result.json`, `canonical.result.json`, and `final-result.json`. All mutation intents are consumed; do not replay them.
