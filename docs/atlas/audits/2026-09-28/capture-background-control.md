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

Production release is pending at this code checkpoint.
