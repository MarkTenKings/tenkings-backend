# Offline copied-reference validation

This directory is standalone. Its runtime imports only Node built-ins and its own contract. It has no package dependency, application route, CLI, camera, decoder, matcher, provider, environment loader, database, queue, or grading runtime. Importing either module performs no I/O. No production reference is acquired or shipped here.

The first increment validates a manually supplied offline package. It proves consistency of supplied bytes and declared bindings, **not issuer authority, authenticity, ownership, grade correctness, image decodability, or physical-card similarity**. The only decision returned is `UNAVAILABLE / NO_MATCHER_IMPLEMENTED`.

## Input

Supply an operator-controlled, quiescent, canonical absolute directory with exactly four regular files: `manifest.json`, `packet.json`, `front.webp`, `back.webp`. Nested directories, symbolic links, hard links, executable files, extra files, and alternate filenames are refused. No source file is written or moved. Filesystem reads may cause normal OS access-time accounting. Concurrent hostile ancestor-directory replacement requires OS isolation; the Node descriptor/stat checks are not a substitute for it.

`manifest.json` is a strict `atlas-fingerprint-offline-reference-v1` object:

- `copy`: `kind: OFFLINE_COPY`, `humanSupplied: true`, a short human-supplied `copyReference`, UTC `copiedAt`, and `sourceClass: DECLARED_APPROVED_COPY` or `SYNTHETIC_FIXTURE`. These are declarations, not verified identity/signature facts.
- `approval`: exact `publicToken`, `reportNumber`, `version`, `approvedAt`, `publicHash`, `reportHash`, and `identitySha256` from the supplied reference. `publicHash` hashes the exact packet file bytes. `identitySha256` hashes deterministic sorted-key JSON of packet report identity. `reportHash` remains the copied approved-record identifier; the separate original private report serialization is not present, so its digest is not independently re-proven.
- `packet`: fixed `path: packet.json`, exact `sha256` (equal to `publicHash`), and `byteCount`.
- `images`: exactly `FRONT` and `BACK`, each with fixed lowercase filename, `role: APPROVED_INSPECTION_DERIVATIVE`, SHA-256, byte count, `contentType: image/webp`, width1350 and height1858. Generated/clean/presentation roles and alternate media are refused. Relabeling untrusted content cannot be detected cryptographically; origin trust remains unverified.
- `geometrySha256`: hash of deterministic sorted-key JSON of the copied packet's complete geometry.
- `traces`: exact finding index `{findingId, side, sha256}`, including `sha256: null` for an accepted legacy finding without a complete saved mask. The parser validates nonempty RLE bounds and the documented frozen trace hash preimage independently, with no grading imports. Missing traces remain missing; none are fabricated.

The packet is the copied `atlas-public-manual-report-v2` JSON file, with its exact public fields. No reserialization is used to establish its public hash. Synthetic packages require `mode: LOCAL_FIXTURE`; declared approved copies require `PRODUCTION`. The inspected public contract supplies those mode values and the numeric final-grade shape (0–10 in half steps; whole-point policy requires integers1–10). Human approval mode is a copied assertion, not a live system check. Unknown envelope, finding, or manifest fields refuse. Grade/measurement contents otherwise remain opaque copied data; no grading formulas are imported or run and grade correctness is not asserted. Dates and text remain inert data, never URLs to follow or code to execute.

Limits are fixed:64KiB manifest,8MiB packet,50MiB per image,109MiB total package,400 findings, JSON depth32 and at most1,000,000 parsed JSON values. Duplicate JSON keys, unsafe object keys, malformed UTF-8 and nonfinite numeric values refuse. A package beyond these limits must not be truncated or silently downsampled.

WebP checks validate static container framing and declared bitstream/canvas dimensions, not compressed pixel decoding. Even the accepted synthetic test image headers are deliberately **not decodable photographs**. A future viewer/comparison prototype must first qualify its own isolated decoder and input/resource limits. No approved derivative becomes a raw master or calibrated slab reference.

## Explicit call

```js
import { importReference } from './import-reference.mjs';

// Values come from the operator's separately reviewed offline copy, never a
// grading API, environment credential, public-report fetch or automatic sync.
const result = await importReference({
  directory: '/absolute/canonical/path/to/offline-copy',
  expectedManifestSha256: '<independently pinned 64 lowercase hex characters>',
  acknowledgeHumanSuppliedCopy: true,
});
```

The caller must pin the expected manifest hash independently before validation. A matching hash only establishes consistency with that pin. Failure returns a fixed error code, not private source paths or content. Success returns frozen copied metadata, artifact hashes, trace availability and explicit unqualified capabilities. No image bytes, upload/access capability, authentication percentage, retake judgment or match verdict is produced.

## Local qualification

Use Node22, from this directory:

```sh
node --test test/*.test.mjs
```

Tests create synthetic four-file packages only in fresh temporary directories and remove their own fixtures. They do not read production references or use repository grading modules. These self-created fixtures qualify the proposed contract and refusal behavior; they do not qualify compatibility with a real/current copied reference. The import-isolation test links the standalone module graph in a VM with only explicitly stubbed built-ins; filesystem/hash calls, environment/global access, network, timers, dynamic imports and additional modules fail during import. This qualifies inert import and the source closure, not a production OS sandbox or load-isolation guarantee. The input directory must reside on a local filesystem; remote mounts are outside this qualification.

Next steps are an independently reviewed manifest/export procedure and authorized representative physical-card datasets, then isolated decoding/alignment feasibility. No real source acquisition is authorized by these tests. Held-out same-card/different-copy, phone/slab/glare and replay evaluation is required before implementing or presenting any comparison conclusion. Grading and saved reports must remain fully independent and operational when this tool is absent.
