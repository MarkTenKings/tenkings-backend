# ATLAS native photo contracts

Small Node ESM contracts for the clean intake adapter. No application, database,
storage, provider or old operator imports. Run `node --test
packages/atlas-photo-core/test/*.test.mjs` from the repository root.

This package validates descriptors and computes transforms. It does **not**
inspect image bytes, verify a storage object, decode HEIC, enforce a subprocess
timeout, upload a file or persist a receipt. Passing a validator is not proof
that an image exists or is correctly decoded. Tests use synthetic descriptors,
not real iPhone optical evidence. No production format admission changes.

## Three different assets

| Contract | Meaning |
| --- | --- |
| `original` | The immutable selected native file, with upload identity, card/pair/side/version, controlled storage key/provider version and observed MIME, byte count and SHA-256. Metadata may be `null` until inspected. |
| `decoded-frame` | A separately stored, fully oriented raster with its own actual JPEG/PNG/WebP MIME, bytes/hash and dimensions. It binds the complete original descriptor, observed metadata, decode limits/policy and exact source-to-frame matrix. |
| `derivative` | Preview, identification, snap, rectified, inspection, reveal or detail raster. It binds that exact decoded frame and original, its own bytes/hash/dimensions, encoder/settings identity and the complete frame-to-derivative matrix. |

The original describes acquisition; a raster describes the bytes an engine or
browser actually receives. An HEIC original must not be passed as the PNG/JPEG
frame. Smaller previews do not replace native evidence. `descriptorSha256`
canonically hashes validated JSON descriptors, including lineage; it is neither
an object-byte checksum nor independent authentication. All returned descriptors
are deeply frozen detached copies.

The photo path does not admit a grading category or physical size. Standard-size
Sports/Pokémon is the initial grading scope, enforced by the grading adapter.
This package has no card-count, spending, concurrency or grading-quality limits.

## Upload and completion

1. Allocate and persist one `parseUploadPlan` per side before issuing its direct
   create-only PUT. The plan binds a stable upload ID, side version, storage key,
   expected byte count and SHA-256. Each side can start independently.
2. The storage adapter verifies the exact planned object. Require a trustworthy
   provider-native SHA-256 or a bounded stream/hash of that same object; also
   compare actual length and inspect actual media format. Client filename/MIME,
   ETag, mutable user metadata and a caller URL are not evidence. No image bodies
   enter the descriptor or database action record.
3. Call `completeUpload(plan, observedOriginal, existingReceipt)` with that
   server observation. Commit the first receipt atomically under the unique
   upload identity. The same completion returns the same receipt; changed bytes,
   provider version, binding or metadata produce `PHOTO_UPLOAD_CONFLICT`.
4. Reconcile lost replies, expired upload URLs and create-only `412` responses
   by looking up the **same upload**. `nextUploadStep` returns `LOOKUP` for
   unknown, `VERIFY_EXISTING` for present, and `DONE` for an accepted receipt.
   Only a fresh trusted exact-object `ABSENT` observation permits another
   create-only upload to the same key. A known conflict is an error, never an
   unknown outcome or permission to overwrite.

An accepted receipt with `metadata: null` **stays immutable**. A later header
observation belongs to `planDecode`; it must not rewrite the completion receipt.
Repeated completion uses the original stored receipt. If metadata was known at
completion, a decode plan must preserve every known value. Its unknown color,
bit-depth or dynamic-range fields may gain observations in the decode plan;
the original receipt is still unchanged.

Storage immutability, authorization, unique upload/side-version constraints and
atomic compare-and-set are adapter obligations. These pure functions cannot
provide concurrency control or exactly-once delivery. Normal successful intake
sends each native file once; transfer interruption may require retransmission.
Do not copy staging images into a second accepted-original location just to
restate their identity.

## Decoder seam and supported interpretation

`planDecode(original, observedMetadata, limits)` binds a server header observation
and finite `maxInputBytes`, `maxPixels`, `maxRasterBytes`, `maxOutputBytes` and
`timeoutMs`. It rejects excess source bytes/pixels and budgets the full encoded
image at up to RGBA16 (eight bytes per pixel), even when the selected crop is
small. These are resource bounds, not a new product upload allowance. No defaults
are silently imposed. The actual decoder must additionally bound temporary
codec memory and enforce cancellation/termination and output limits.

The future adapter must probe headers under those bounds **before** allocating
pixels, then pass actual decoded observations to `parseDecodedFrame`. Its worker
or process must be killable; a JavaScript timer alone does not stop a native
decode. A timeout/unavailable decoder is distinct from a proven invalid file.
Both preserve the accepted original and must not fabricate a successful empty
frame. This package supplies neither a worker nor a decoder implementation.

The original contract describes JPEG, PNG, WebP and HEVC **primary still HEIC**.
The HEIC descriptor uses canonical `image/heic` only after actual codec/container
inspection. A client `image/heif` declaration or `.heif` name is not sufficient;
HEIF is a container family with other codecs. `selection.itemId` identifies the
primary still image; embedded thumbnails/auxiliary images are not chosen as the
grading source. Image sequences, arbitrary HEIF codecs, RAW and DNG are outside
this version. Raster decoding requires a single frame.

The decoder must resolve actual HEIF item rotation/mirroring, crop and any EXIF
metadata once into an effective orientation `1..8`, recording its source as
`heif-properties`, `exif` or observed identity. The contract does not parse that
metadata. It supports an explicit **integer** source crop followed by effective
orientation. Fractional clean apertures or more complex container transforms
need a deliberately implemented adapter extension. This limit still needs
comparison against actual iPhone HEIC files; it proves no blanket HEIF support.

Unknown input bit depth, ICC hash, color space and dynamic range remain `null`.
The decoded frame records the actual decoder/version, policy version, output
channels/bit depth, color treatment and HDR treatment. Color conversion must name
its output space. Unknown/HDR source metadata cannot become `not-present` HDR.
Keeping native bytes does not prove that a conversion preserved fine defects,
ICC interpretation, HDR detail or bit depth; those need real-file review.

Current repository evidence: `preparation_evidence.py` only decodes JPEG/PNG/WebP;
current upload wrappers likewise admit those three raster types. Browser HEIC
import currently produces PNG. This checkout's Node resolution finds no callable
Sharp or libheif-js package. No dependency was installed or declared here. Even
Sharp's prebuilt HEIF support is not proof of HEIC/HEVC capability; its
[official requirements](https://sharp.pixelplumbing.com/api-output/#heif) describe
additional native dependencies. The [libheif project](https://github.com/strukturag/libheif)
documents primary-image selection, multiple images, transforms and color handling.
A pinned, bounded native decoder and actual iPhone JPEG/HEIC fixtures are the next
integration step, not completed work in this package.

## Coordinates and source validity

`orientationTransform` and `transformPoint` use **pixel centers**: zero through
width-minus-one and height-minus-one. They are not the older physical-quad
normalized-width/height convention. Preserve the existing grading engine's
conversion explicitly at that adapter boundary.

All eight effective orientations, including mirrors, have independent expected
corner fixtures. An optional crop is applied before orientation. Frame dimensions
must equal that transformation; decoded output must not apply orientation again.
Derivative matrices map oriented decoded pixels directly into the output and
must be finite, invertible and have no projective horizon across the source.
Cropped-away source points may correctly fall outside the derivative. These
checks establish a valid declared transform, not pixel/transform agreement.

The exact decoded descriptor hash includes decoder/color treatment. A changed
decoder output, orientation, side, pair or original version invalidates its
derivatives. The derivative encoder settings hash must resolve to the retained
actual encoding/settings record in the adapter. Purpose is descriptive: naming
an arbitrary image `inspection` does not prove the established 1350×1858 grid,
40-pixel crop or grading parity. Preparation owns those engine-specific checks.

`replaceOriginal(pair, original)` returns a new pair and a small invalidation
description: the changed side's image work, pair identity/research and draft
report. It preserves the other side's exact descriptor. New intake starts at
side version 1; replacement advances that side once and requires a different
upload identity/key. Identical replay is a no-op; competing same-version content
conflicts. Persist adoption and the real dependent-record changes atomically.
Retain previous original bytes and approved snapshots as history. This function
does not maintain a stage graph or invalidate independent Back work itself.

## Remaining acceptance

The contract suite covers orientation/crop corners, metadata unknowns, stale
lineage, per-side replacement, immutable receipts, lost replies versus conflicts,
MIME separation, object-key overwrite rejection and decode allocation bounds.
It does not establish real storage idempotency, decoder runtime termination,
HEIC optical/color quality, browser compatibility, upload latency, human pair
confirmation or a complete manual grading workflow. Those require the actual
adapters, files, phone and Mac browser.
