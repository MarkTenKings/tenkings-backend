# LeRoy Butler Back geometry recovery — October 23, 2026

## Cause and repair

Card `89df8525-e4ef-4e98-acc5-edb6d2af2cd7` saved its human Back physical-corner correction at `2026-10-23T22:18:15.545Z`, revision 3→4. Preparation failed before its next commit. The exact retained photograph reproduces `ATLAS_GEOMETRY_MATERIAL_INVALID` in the serving predecessor `6fe0e4620050d3e144f206d1cec8817394550ae1`.

The inward corner adjustment projected three of the 48 retained material-outline points outside both canonical boundaries. Independently clamping each coordinate collapsed those points to `(0,1)`, violating the existing polygon validator. This differs from the earlier Nick Kurtz frame-comparison repair (`7452f266`), which retained a previously omitted material contour. That earlier fix remains present. Astra's absent printed-border proposal is a legitimate separate review condition.

Application source `dbcd3c387c15da5a31010b9207fce957e3ab32ae` intersects projected outline segments with the canonical rectangle, preserves actual intersections and removes only adjacent/closing numerical duplicates within 1e-12. Wholly contained contours keep their exact coordinates. Existing topology validation remains authoritative, including disconnected or degenerate results. Finite, same-sign projective denominators are required. Source physical outlines, photo pixels, Front work, measurements/scoring policy and human confirmations remain authoritative.

Only two runtime files differ from the serving predecessor: `packages/atlas-preparation-runtime/src/index.mjs` and new `material-contour.mjs`. Preparation engine identity inputs and initial automatic Astra acquisition/cache paths remain unchanged; this repair does not schedule a model rerun.

## Verification

- Local preparation suite 26/26 and related geometry/workflow regressions 57/57 passed, zero skips, using Node 22.23.2 and OpenCV 4.10.
- Independent polygon review sampled 1,167,000 interior memberships across 1,167 accepted seeded polygons with zero changes; 33 invalid shapes remained refused.
- Native Linux qualification02 passed 65/65 tests, exact source verification of 2524 files before and after tests, and the private exact-photo replay. The old module fails; the new module produces 43 valid points from 48 source points and completes preparation, existing defect reprojection and native measurement. Source Back physical geometry and all Front geometry/findings remain unchanged; photo derivative bytes match the no-contour control exactly. No human outline/grade approval is fabricated.
- Qualified image: `sha256:53c46ea621ecb650b51d0cf51ab1c04665de99f691549e0dbd7cb8bb372814a6`. Qualification result: `6e7a9c750ba2c09fcac9e3d46f5eeceb29c1cc81087c8ac43f5201a8a9ec45f1`; test log: `4a0c17bd15735f45a043ac935f0d26be86a5476a3b16bfde7387210ad24c821f`.

Earlier isolated qualification attempts exposed test-harness fixture inventory and temporary pnpm dependency-path problems. Their failed receipts remain immutable; they were not activated or relabelled as passing. The production image/source did not change between those attempts.

## Release state

Two staged-only main-release attempts remain retained. Neither stopped, restarted or replaced production. Release 01 exposed a read-only query timeout and was explicitly aborted; absence proof `5b849f9217716c168c530c8bd0636d64c28fe7b6a3203132803b0c07e7ae65bc`. Release 02 passed preflight and staging, then correctly refused new intake/geometry work before any quiesce intent. Its holder was explicitly aborted; absence proof `be97a6e55ab84e04b4ffdd4427623f7fadb38c113193ca038752bd96fe9d6a41`. Both report successfulRelease:false.

The two historical geometry requests with unknown paid outcomes remained byte-identical. New intake records and model dispatches appeared after the repeatable-read baseline began. These were actual background work, not evidence that anyone was actively grading. The owner reported no one was grading. No request was cancelled, reset, replayed or reclassified as a historical unknown. Latest idle evidence must precede cutover.

Reviewed release-helper corrections preserve all database queries, source pins, row commitments, freshness checks and admission reserves. Capture has 60-second server and 75-second client query budgets; the caller waits 240 seconds. Admission verification/heartbeat retain 8/20 seconds. The transport select argument correction was caught before effects. Capture-local `jit=off` avoids expensive catalog query compilation; exact 4,985 normalized dependency rows match the earlier result (proof `01414501f743e5c34262798a134af094684712a7664e39d11301b5ddf60bd789`). Eight helper regressions pass, including rejection of new pending geometry requests.

The owner-authorized Edges lead completed a single combined release of source `6f3c6d1495a61f1b61058f0ac4044ee03e993726`, retaining the exact dbcd preparation bytes. After the owner paused uploads, actual idle was confirmed at 23:30:32 UTC. Both old roles exited cleanly without SIGKILL; the exact three control changes committed with business/customer/schema preservation. START passed at 23:41:30 UTC and SEAL passed at 23:42:42 UTC. This chat performed no competing release effects. Local release 03 contains only inert frozen helpers, without an admission plan, baseline or effects.

Production identities:

- Combined image: `sha256:d6e94d46e1993c9b8c585a490fb2c9bfc64e9190913e3144cc1eae91c19ab0de`; combined native qualification passed 162 tests, result `95e9e846d8204e2b1b9b1a9d4b068aa1e94c98e2ec0d7219c83aaf1859ae5d90`.
- Main: `97f040f8a7e249d382520090a043d1dc807a5e8bc0d0f03b2273abeadc956fc5`; worker: `8f5cbf0de4235364747c4ebce2fb4edcf5a3b7fed0379917682f19720980e4c8`.
- Staff: `dpl_C3HUcvJXcw4AxRHVXuwcqbgEbvQd` / `atlas-grading-staff-2gbgobkue-ten-kings.vercel.app`.
- Public: `dpl_2KgjhxNUSo5Xi2fyDTpvr6pVxNf2` / `atlas-grading-public-c2rfpcygi-ten-kings.vercel.app`.
- Customer retained: `dpl_6RFr24d3KbnvTu8bhMubXBhkpY7n`, source `a537f922c567795b2a568048c78f595ff8853731`.

Independent read-only verification at 23:41:52 UTC confirmed that the running main is healthy with zero restarts and contains the exact qualified preparation files: `index.mjs` SHA256 `41ac5173ef4dc24f0ccb752997090549f3ec5afd26506152738772027b8332eb` and `material-contour.mjs` SHA256 `c3badbfd4ca45f4ed1630c651f529587add351270c2b4e703c822174cbbbb736`. Serving proof: `57c338f4f6b6591859a8d91ff24b739d41db2b66f6125a6449e8856afe3d8742`. Separate original-card proof `2533b2b4b4f964a4fcda344327d7488c895258634bf963305f9a78b0f8c2bd29` confirms revision 4 and content hash `5f2503c38b995eb904b72a6083a6802840f384cc450d9b446d47148474910e0f` remain unchanged.

Canonical postpromotion checks passed for `/`, `/admin`, `/account`, deployment/build identities and all public aliases; customer remains unchanged. Final full preservation passed at 23:44:52 UTC. Explicit successful admission release and fresh absence proof at 23:45:16 UTC confirm the holder transaction, original locks and replacement holder are all absent. Grading may resume. Technical deployment is complete; authenticated human advancement of LeRoy's review remains unobserved and requires the reviewer to approve the outlines.

Combined release receipts under `~/.codex/atlas-handoffs/atlas-edges-quarter-20261023/`:

| Receipt | SHA256 |
| --- | --- |
| `release-01/runtime/seal-result.private.json` | `827814177443d93f3c802fc714decc56d1645df8a27dee7b35c6fdd5d36d7194` |
| `web-prep/postpromotion-01.json` | `65664a3b3d5c5220dda239c670e5593f1f709d74860ab6b33c61f30ac0ad1f72` |
| `release-01/gates/technical-release-ready.json` | `24e4910d96da764c219d642c2909f133a4f85df2119f3ec3d7a4bf4f6059412d` |
| `release-01/admission/release-absence.json` | `27c610398edf00356fcdaf39343f27e25da6f88513eedb8838196fd85e11ff0c` |

Private runtime receipts contain environment values. Inspect only allowlisted metadata; never print or commit their raw contents.

## Operator recovery

Technical release is confirmed. Sign in again in a new tab at `https://atlasgrading.com/admin?reauthenticate=1`, then open the original card at `/admin/manual/89df8525-e4ef-4e98-acc5-edb6d2af2cd7`. A later intake created a different LeRoy card (`69026f09-0816-4a11-8ae5-35b814f90f71`); that is not this incident's saved review.

The combined release changes StaffControl revision, invalidating earlier sessions. The old editor retains its original CSRF value and has no refresh-access path. Keep the old tab as a visual reference: unsaved printed-outline edits exist only in its React draft and would be lost on reload/remount. The fresh signed-in editor resumes from the preserved saved geometry; the reviewer can re-enter any unsaved outline edits and explicitly approve Back. Do not automatically approve geometry, findings or grade, and do not re-upload the card to recover this preparation failure.

## Evidence and coordination

Private evidence root: `~/.codex/atlas-handoffs/atlas-leroy-back-review-20261023/`. Native qualification is in `native-requalification-02/observed`; staged-only release receipts are in `native-hotfix-release-01` and `native-hotfix-release-02`. Consumed effect intents are evidence, not rerunnable release scripts. Recovery requires fresh reconciled state; never restart a retired generation.

The user authorized coordination with “Investigate Atlas grading scores” (`01a16ae2-f88a-7452-b423-da40f27cd76b`). Its lead initially held shared-host effects for the geometry release. After both staged-only attempts were explicitly aborted and absence proved, the leads coordinated a single combined release retaining dbcd geometry. Independent code/source/photo qualification remains specific evidence for this repair.
