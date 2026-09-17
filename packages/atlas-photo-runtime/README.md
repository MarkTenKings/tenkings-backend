# ATLAS photo runtime

Local Node server adapter for `@atlas/photo-core`, using pinned Sharp 0.33.5.
It verifies an owned snapshot of exact bytes and produces a separate, full-size,
oriented PNG in a disposable child process. It imports no old application,
operator, database, storage client or model. No production route uses it yet.

```js
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '@atlas/photo-runtime';

const decoded = await verifyAndDecodePhoto({
  uploadPlan,       // previously allocated photo-core upload plan
  observedObject,   // exact key/version from your trusted object reader
  bytes,            // Uint8Array/Buffer returned by that bounded reader
  limits,           // all five photo-core decode limits are required
  existingOriginal: null, // or the immutable previously accepted receipt
  signal,           // optional AbortSignal
  heicHdrPolicy: 'retain-hdr-use-sdr-base', // explicit approved Apple working-view policy
});

// Persist decoded.png with a separate create-only key through your storage
// adapter, verify that write's actual object identity/bytes, then bind it:
const frame = describeDecodedFrame(decoded, { id: frameId, object: storedObject });

// Retain decoded as the richer primary and create a separate preparation frame.
const working = await deriveSdrWorkingPhoto(decoded, { limits, signal });
// Store working.png create-only, then describeDecodedFrame(working, ...).
```

The decoder does not fetch a URL, authenticate a provider observation, upload
anything or prove immutable storage. Its exact SHA-256 and length check establish
that the supplied bytes match the upload plan. The server storage reader must
bind those bytes to the actual provider object/version; client MIME, filename,
ETag and mutable user metadata do not establish that. The returned original
receipt is eligible for the caller's atomic persistence only after a successful
verification/decode. On failure, the already uploaded original must remain
available for retry or another decoder; this package never deletes that object.

## Supported raster behavior

| Input | Separate decoded frame |
| --- | --- |
| Single-frame 8-bit JPEG, PNG up to 16 bits/sample, single-frame WebP | Full oriented dimensions; separate PNG with actual encoded hash, length, dimensions, channels and bit depth |
| EXIF orientation 1–8, including mirrors | Applied once; exact photo-core pixel-center transform; output has no orientation tag |
| 16-bit PNG | 16-bit RGB/RGBA PNG; no resize or 8-bit reduction |
| Embedded ICC color | Explicit conversion to attached sRGB output profile; source ICC bytes are hashed |
| Alpha | Retained as an alpha channel |

PNG with lower-bit-depth samples expands to RGB/RGBA8. Grayscale expands to RGB.
The output color policy is `atlas-native-raster-srgb-v1`. It is a deliberate sRGB
working raster, not proof of wide-gamut/HDR or fine-defect fidelity. Original
bytes are untouched. Dynamic range remains unknown unless independently known;
an ordinary 8-bit file or ICC profile does not prove SDR. No HDR-preservation or
tone-mapping claim is made. Explicit PNG PQ/HLG flags are refused. JPEG MPO/MPF
(including an auxiliary gain-map container), APNG and animated WebP are refused
instead of silently selecting a first frame. JPEG trailing data/concatenation,
PNG trailing data and inconsistent WebP container lengths are rejected. RAW/DNG,
AVIF and other codecs are outside this adapter.

`original` is immutable, including a previously accepted `metadata: null`
receipt. Later observations go into the decode plan. A provider-version or byte
conflict is `PHOTO_UPLOAD_CONFLICT`/`PHOTO_SOURCE_MISMATCH`, not an unknown request
and not permission to overwrite. Source metadata that conflicts with prior
known observations is rejected. Replacing a side remains the caller's versioned
photo-core workflow.

## Actual bounds and lifecycle

The caller must supply finite positive `maxInputBytes`, `maxPixels`,
`maxRasterBytes`, `maxOutputBytes` and `timeoutMs`. There is no implicit product
allowance, quality reduction, card count or concurrency restriction. Resource
excess is an explicit failure; the adapter never downsamples to fit.

- Input length is checked before copying. The caller must already bound its
  download; this API cannot undo an oversized allocation by its caller.
- Container checks and Sharp's header-only metadata probe run in a child. The
  complete encoded dimensions must fit both pixel and RGBA16 allocation budgets
  before the pixel pipeline starts. The actual pixel pipeline also receives
  Sharp's `limitInputPixels` setting.
- The output stream counts encoded bytes before writing them, and the parent
  checks file length before reading a returned PNG. Native encoder buffers and
  metadata parsing are still codec working memory, described below.
- A wall-clock deadline includes child startup, header inspection, decoding and
  output verification. Timeout/cancellation sends SIGKILL and waits for the
  child's close event before returning and cleaning up. No Promise-only timer
  is offered as native cancellation. Parent input hashing/file I/O and final
  bounded readback/cleanup are outside the decoder deadline.
- Each invocation owns one private temporary directory. It deletes only that
  directory after the child is reaped. Decoding never writes the caller's input
  buffer or source object. Child stdout/stderr are bounded, and native diagnostics
  and application credentials are not propagated through its error protocol.

**`maxRasterBytes` is not a hard ceiling on all native memory.** Libvips caches
are disabled and codec concurrency is one inside each child, but codec working
memory, ICC decompression, encoder buffers, Node and temporary allocations still
need an outer process/container memory and disk policy on the intended server.
No native heap ceiling is claimed on macOS. The deployment must provide and
verify that outer policy before accepting untrusted production uploads. This
package does not create a VM, container, host service or global queue to supply
it. Parallel callers can run separate independent children; finite machine
capacity remains the hosting adapter's responsibility.

Errors distinguish source conflict, malformed raster, unsupported format,
unsupported multi-frame/HDR, allocation/output limit, decoder unavailable,
timeout, cancellation and unexpected worker failure. They never produce an
empty successful frame. A valid final descriptor is not storage authentication.

## Native HEIC subset

Build the pinned Node-API adapter as described in [native/README.md](native/README.md).
It loads libheif 1.23.2 with built-in libde265 1.1.1 **inside the same disposable
Node child**. There is no subprocess codec helper, browser conversion, service,
new npm dependency. Missing/incompatible native binaries
produce `PHOTO_DECODER_UNAVAILABLE`; JPEG/PNG/WebP continue to use Sharp.

The native probe selects the actual primary item by ID, including a primary that
is second in a still-image collection. Direct HEVC images and ordinary HEVC grids
support 8/10/12-bit sources. A grid must have exact canvas/tile coverage, matching
tile dimensions/depth/color, no separate tile transforms/Exif/auxiliaries, and
only direct HEVC tiles. Thumbnails never become the selected primary. Actual
container item types and item-local `ipma` property associations are checked;
`ftyp` branding alone never produces an HEIC receipt.

Native decode ignores transformations and preserves sample depth. A separate
lossless PNG encoder applies the verified integer crop and effective orientation
once, retaining full resulting dimensions with no resampling. 10/12-bit code
values expand injectively to 16 bits via `round(sample * 65535 / (2^depth - 1))`;
this retains every distinct decoded value, not additional source precision.
PNG output has no orientation metadata. Supported direct crop/orientation cases
match independent integer permutations and native default decoding. Even-grid
crop/rotation/mirror cases also match. Every accepted crop has even x/y origins.
Any nonzero rotation or mirror requires even source and effective crop dimensions,
for both direct images and grids. Repeated rotation/mirror properties are refused.
These boundaries follow independent native comparisons that found different
pixels for odd-origin crops and transformations on odd grid dimensions, including
repeated operations whose net orientation is identity.

Color has a deliberately narrow qualified scope. Matched NCLX BT.709 primaries,
sRGB transfer and RGB/BT.709/BT.601 matrix coefficients decode to explicitly tagged
sRGB PNG. Unprofiled sources remain `colorTreatment: unmanaged`, null color space
and unknown dynamic range: no default sRGB or fidelity assertion is invented.
Exact original bytes are always preserved by the caller, independently of PNG.

The `atlas-heif-primary-lossless-v2` policy additionally preserves exact qualified
SDR RGB ICC profiles: Apple's 536-byte Display P3 profile and the CC0 compact v4
Display P3/sRGB profiles. Qualification uses their complete SHA-256 values in
`src/heif-metadata.mjs`; a profile name or near-match never qualifies. These
profiles have independently checked matrix/TRC semantics. ICC bytes are retained
exactly in PNG `iCCP`, RGB samples are unchanged and `colorTreatment` is
`preserved`, with `Display P3` or `sRGB` recorded explicitly. No P3-to-sRGB gamut
conversion or clipping occurs. ICC governs RGB interpretation when both ICC and
qualified NCLX are present; NCLX still supplies codec matrix/range information.
Unknown, empty, duplicate or inconsistent tile profiles refuse. NCLX-only P3
remains unqualified. A grid may use an explicit primary ICC with unprofiled tiles;
without that primary property, every tile must carry the same nonempty ICC before
libheif's first-tile inheritance qualifies. Source ICC is bounded to 4096 bytes
before copying.

Associated primary Exif is now accepted after bounded TIFF structural validation:
IFD0, next/thumbnail IFDs, Exif/GPS/interoperability pointers and SubIFDs are walked;
cycles, duplicates, malformed orientation, unsupported types and out-of-range
values refuse. There is at most one Exif item, 1 MiB, 32 IFDs and 4096 entries.
Private MakerNote content remains bounded opaque data; it is never interpreted.
All Exif orientation values are descriptive under HEIF, including Exif-only or
conflicting values. Only actual HEIF properties determine the frame transform.
No Exif/XMP metadata is copied into PNG, so a consumer cannot apply its orientation
again. The original still contains every unchanged metadata byte. This follows
[HEIF's presentation rule](https://pillow-heif.readthedocs.io/en/stable/reference/HeifImage.html),
with native-decoder and independent pixel-permutation comparisons.

Explicitly unsupported by default: unknown ICC/wider NCLX color; PQ/HLG, mastering/content-light
HDR metadata and auxiliary images including gain maps, depth and HEIF alpha;
associated tile Exif; movie sequences, overlays/identity-derived items, unusual
primary properties, fractional/out-of-bounds/odd-origin/complex crops, separately
transformed tiles, repeated rotation/mirror properties, and nonzero rotation or
mirror on odd source or effective crop dimensions. Originals remain available on
every refusal. The explicit SDR policy below admits only the qualified Apple
gain-map case; this is not general HEIF/HDR or fresh-phone optical acceptance.

## Explicit SDR working images

The owner approved retained HDR originals with SDR working images for the first
standard sports/Pokémon build. `heicHdrPolicy: 'retain-hdr-use-sdr-base'` qualifies
only the unchanged Apple 536-byte Display P3 ICC, an 8-bit primary, and exactly one
associated `urn:com:apple:photo:2020:aux:hdrgainmap`. Native auxiliary identity and
the original `auxC`/`auxl` association must agree. An additional `tmap` rendition
may remain in the original only when its `dimg` inputs are the selected primary
and that same gain map. It is never selected. Depth/alpha/unknown auxiliaries,
HDR PQ/HLG primaries, unknown profiles and all prior geometry/tile guards remain
refused. The default policy remains refusal.

The original/decode plan says `dynamicRange: HDR`. The separately decoded primary
keeps exact P3 samples/profile and records `atlas-heif-apple-sdr-base-v1` with
`hdrTreatment: sdr-base`; it never says HDR was absent or preserved in that PNG.
The gain map and every original metadata byte remain in the unchanged native
file. The primary is Apple's existing SDR base, not a newly tone-mapped HDR image.
An existing original receipt with null metadata remains exactly null; the HDR
observation goes into its decode plan.

`deriveSdrWorkingPhoto(decoded, { limits, signal })` converts the qualified
oriented primary to a separate full-dimension sRGB RGB8 PNG. It performs ICC
conversion using pinned Sharp/libvips's perceptual intent and the exact compact
sRGB profile (`c56e1685…`). There is no resize, crop, second orientation, sharpening,
denoising or gain-map application. sRGB conversion can clip colors outside its
gamut; HDR brightness/detail and full P3 color volume are not retained in the
working PNG. Original and richer primary artifacts remain separately available.
Qualified SDR P3/sRGB decoded frames can use the same converter; alpha, unmanaged
color and other HDR treatments refuse. A 16-bit SDR source remains intact while
the explicit working copy quantizes to RGB8. Repeat working-image derivation from
an already-derived result is refused; use the retained primary.

`describeDecodedFrame` returns schema 2 for a working result, preserving the
original/decode-plan hashes and exact source-to-frame matrix. Its `workingImage`
provenance binds source PNG content/dimensions, source treatment, output ICC hash,
conversion policy and `identity-no-resampling`. `parseDecodedFrame` accepts both
the original schema 1 and this narrow schema 2. Existing preparation's opaque
sRGB RGB8 check can consume it. The storage adapter must create separate keys and
retain the original/richer source; this runtime does not write remote storage.

The converter snapshots inputs before awaits and uses the same kill/reap child,
output stream bound and private-directory cleanup. Limits default to the decode
plan's bounds; `maxInputBytes` must also fit the richer PNG, not merely the much
smaller compressed HEIC. Resource excess never causes automatic downsampling.

Both retained iPhone files now pass this explicit path at 3024×4032. Every primary
RGB sample matches independent native-default decoding, ICC bytes match, and a
spatially distributed independent ICC matrix/TRC comparison of 211,437 channels
per side differs by at most one RGB8 code. Exact-pixel detail crops are retained
for owner review. These observations qualify this technical conversion, not
optical defect accuracy or the owner's fresh-card acceptance. Evidence is under
`atlas-connected-manual-20260912/sdr/` in the local handoff root. Apple's
[HDR effect description](https://developer.apple.com/documentation/appkit/applying-apple-hdr-effect-to-your-photos)
and [gain-map presentation](https://developer.apple.com/videos/play/wwdc2024/10177/)
explain the SDR base plus auxiliary HDR representation.

Native per-image security limits complement the existing parent timer and
full-source RGBA16 budget. They are not a hard bound on total process/codec memory;
the outer server memory/disk policy remains required. Native defaults for other
security limits stay enabled. Decoder threads are one. Tests prove cancellation
kills and reaps a child while it is repeatedly performing actual HEVC decoding.

## Verification and remaining acceptance

Run `node --test packages/atlas-photo-runtime/test/*.test.mjs` from the repository
root after installing workspace dependencies and building the native adapter. Tests use real encoded synthetic
rasters, independent pixel permutations for all orientations, 16-bit detail,
ICC and alpha, source/receipt conflicts, malformed/multi-frame inputs, two
unchanged upstream HEVC stills, second-primary selection, 8/10/12-bit grids,
validated primary Exif, preserved qualified ICC and explicit color/Exif/geometry refusals and real kill/reap checks against a
synchronously blocked child. No paid inference or historical card replay occurs.

The finite local suite runs on Node 25.6.1/macOS arm64 with Sharp 0.33.5/libvips
8.15.3. It is not production Node/Linux or iPhone optical acceptance. Remaining
work includes outer server resource policy, full HDR viewing and unqualified metadata/color
coverage and fresh iPhone JPEG/HEIC color/detail comparison on the Mac. The separate
`@atlas/photo-storage` create-only adapter and `@atlas/preparation-runtime` CPU
adapter now exist, with synthetic browser integration checked by root. Actual
provider/authenticated application integration and the real-phone workflow remain
pending. Preparation currently admits only opaque sRGB RGB8 frames; the explicit
working derivative provides that format without replacing the richer original.
Display P3, unmanaged or 16-bit HEIC output itself remains outside that subset. Retaining native
originals and samples does not establish an accepted original-quality grading path.
