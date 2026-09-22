# Native photo compatibility and upload recovery

## Observed failure

Mark's fresh-card test on the intake/performance release failed after the original bytes were saved. Mobile card `3d88c7b2-3e3d-4534-bb90-f6374cf3ad7e` retained both originals without prepared working images. Desktop card `cb7846f9-b81b-4ec8-bc83-e218feaed449` prepared Front, but Back failed on its first upload and on replacement/retry with the same bytes.

Read-only database observations at 01:56–01:57 UTC and four checksum-verified object GETs establish those facts. Chrome retained four desktop preparation responses with status 422. The private service had zero restarts, no OOM and no application error log. No diagnostic retry, paid identification or card mutation was performed. Evidence and the private original photographs are retained outside Git under `atlas-upload-recovery-20260922`.

The exact files reproduce two independent format refusals:

- The mobile files are adaptive HDR JPEGs containing an SDR primary and an Apple gain map. The previous reader rejected their MPF structure as `PHOTO_MULTIFRAME_UNSUPPORTED` before decoding.
- The desktop Back HEIC has a 2808 × 4031 P3 RGB8 SDR primary, Apple gain map and content-light metadata (`clli`, 203/64). The native reader rejected that metadata as `PHOTO_HDR_UNSUPPORTED`, including when processing the photo alone.

The retained local native image's 16 artifact hashes match the serving runtime. These are repeatable format failures; simultaneous upload is not established as their cause. Earlier synthetic parallel-upload tests did not exercise these actual input formats.

## Correction and verification in progress

The compatibility correction retains each complete original and derives a full-resolution SDR working image through explicit qualified format handling. JPEG admission must verify primary/auxiliary boundaries, MPF offsets and lengths, SDR-base metadata, gain-map identity and color profile. HEIC content-light metadata must agree between the original properties and native reader under the existing SDR-base policy. Arbitrary multi-image files and unqualified HDR-primary treatments remain refused. The native addon must be rebuilt and its pixels independently checked; unchanged native-library hashes alone do not qualify the modified reader.

The recovery UI refreshes saved-original state even after preparation fails, provides an exact saved-photo recovery action without another PUT, distinguishes superseded local journals from the selected photo, and exposes useful photo errors. Focused recovery checks and six browser scenarios cover both failed sides, mobile layout, another device/no local journal, stale uploads and failed status refreshes. Final exact-source qualification and live release evidence will be recorded before claiming the fix is deployed.

This work does not approve a report, alter grading, discard originals or replace human review. Inventory's separately completed release has advanced the production public migration ledger to 98 successful entries plus 13 historical rollbacks; staff 42 remains unchanged. This fix plans no migration or grant change.
