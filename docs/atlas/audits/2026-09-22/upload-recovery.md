# Native photo compatibility and upload recovery

## Observed failure

Mark's fresh-card test on the intake/performance release failed after the original bytes were saved. Mobile card `3d88c7b2-3e3d-4534-bb90-f6374cf3ad7e` retained both originals without prepared working images. Desktop card `cb7846f9-b81b-4ec8-bc83-e218feaed449` prepared Front, but Back failed on its first upload and on replacement/retry with the same bytes.

Read-only database observations at 01:56–01:57 UTC and four checksum-verified object GETs establish those facts. Chrome retained four desktop preparation responses with status 422. The private service had zero restarts, no OOM and no application error log. No diagnostic retry, paid identification or card mutation was performed. Evidence and the private original photographs are retained outside Git under `atlas-upload-recovery-20260922`.

The exact files reproduce two independent format refusals:

- The mobile files are adaptive HDR JPEGs containing an SDR primary and an Apple gain map. The previous reader rejected their MPF structure as `PHOTO_MULTIFRAME_UNSUPPORTED` before decoding.
- The desktop Back HEIC has a 2808 × 4031 P3 RGB8 SDR primary, Apple gain map and content-light metadata (`clli`, 203/64). The native reader rejected that metadata as `PHOTO_HDR_UNSUPPORTED`, including when processing the photo alone.

At diagnosis, the retained local native image's 16 artifact hashes matched the then-serving runtime. These are repeatable format failures; simultaneous upload is not established as their cause. Earlier synthetic parallel-upload tests did not exercise these actual input formats.

## Qualified correction and live cutover

The correction retains each complete original and derives a full-resolution SDR working image through explicit qualified format handling. JPEG admission verifies the exact two-image MPF boundaries and offsets, forward SDR-base ISO metadata, Apple gain-map XMP identity, the unchanged qualified Apple P3 ICC and the auxiliary entropy stream. It selects only the SDR primary, applies Exif orientation once and records `atlas-jpeg-apple-sdr-base-srgb-v1`. Arbitrary multi-image JPEGs, unqualified color profiles and HDR-base metadata remain refused.

HEIC content-light metadata must be a single four-byte property whose values and presence agree between the primary, every grid tile and the native reader. Admission still requires the explicit Apple SDR-base policy, exact qualified P3 ICC, RGB8 primary and associated Apple gain map. This path records `atlas-heif-apple-sdr-base-clli-v1`; no-CLLI images retain `atlas-heif-apple-sdr-base-v1`. PQ/HLG, mastering-display metadata, malformed properties and unqualified auxiliaries remain refused. The native addon was rebuilt; its dependencies were not changed.

The recovery UI refreshes saved-original state even after preparation fails, provides an exact saved-photo recovery action without another PUT, distinguishes superseded local journals from the selected photo, and exposes useful photo errors. Focused recovery checks and six browser scenarios cover both failed sides, mobile layout, another device/no local journal, stale uploads and failed status refreshes.

Qualification is complete for the immutable image below. The private runtime cutover completed at **02:42:49 UTC on 2026-09-22**. Final runtime/database read-only proof, public alias/production-target readback and the hosted route-and-asset check all passed; the hosted check completed at **02:45:45 UTC**. Neither affected production card was retried or changed by the release verification.

## Exact candidate and qualification

Private receipts remain outside Git at `/Users/markthomas/.codex/atlas-handoffs/atlas-upload-recovery-20260922/release/` (abbreviated `R/` below). The photos remain private and are not part of the source or web artifacts.

| Binding | Exact value |
| --- | --- |
| Source commit | `a00f988568f29cbe01946213005ee50bd5e6b1d9` |
| Source tree | `06da33b609bcd9ca7ba65f102ccfc8f3f45a3009` |
| Native image | `sha256:9fdbd82d3fc9af3acf3ec2c636360347579439f2d1b2cba2389f0c6bb33d00af` |
| Source manifest, 589 files | `fbf03f0878b8828dca9a72effcf252adce36eae269d8ce30c15f68d6e3d2c73e` |
| Native build plan | `cf64526fd1e3503fc421b8cb263ee1dba430ce1f8684ec613f0cb68e04ab4543` |
| Rebuilt `heif.node` | `ee8032262b87b3fbb32cc8dcf24bd3618d63aaa63dcacebda00a0210b6941845` |
| Rebuilt native `build.json` | `13c50172569eec9ee24a178132c888e906933db7deb4c157d279d04e925561d5` |

All 589 source files and all 16 native artifact identities were verified. Exactly the addon and its build receipt changed; all 14 native dependency/library artifact hashes remain equal to the previous serving image. The successful build receipt is `R/native-context-a00f9885/build-evidence/result.json`, SHA-256 `ba03d1e82ebe14de13bcfddbcdf93a6dc478cdca084f5ad9af44ca352a07c582`. The source, boundary, package-test and staff qualification groups all passed against that exact image. Package tests passed **582/582** and staff tests passed **82/82**, with zero failures, cancellations or skips. The focused local native/runtime/core/storage/intake suite also passed 220/220 before exact-image qualification.

[GitHub CI run 35679005009](https://github.com/MarkTenKings/tenkings-backend/actions/runs/35679005009) completed successfully for that exact commit, with all 14 jobs successful. Its retained raw run/jobs receipt is `R/ci-exact-source.json`, SHA-256 `9f58ef668f6e2043def4fdf991069a73aa769b197a9258665cf56dbe3491f4fb`.

Both isolated PostgreSQL qualification groups passed against the candidate. The ACL/storage group checked 14 manual tables and six non-trigger functions with unchanged grant replay. The memory group passed 25 assertion groups, including complete context-layout V2 evidence and both actual-role receipt/confirmation lock orders. Each group applied all 42 staff migrations and the pinned 95-migration public fixture chain, then performed two no-op replays. This disposable public fixture count is distinct from the live ledger. Only owned regenerable database files were removed; evidence and images were retained, and unrelated containers were unchanged. Receipt: `R/pg-context-a00f9885/pg-evidence/result.json`, SHA-256 `941b4c29fe1ef978d8372f0b7b42b2e169f4e891f14a20e9b0ece9d4b01e3fad`.

## Actual-original native qualification

The exact four retained originals passed on the immutable candidate in a separate network-disabled, read-only container capped at one CPU, 3 GiB memory/total swap, 256 PIDs and 1 GiB `/tmp`. The fixture executed the actual intake service, photo processor, immutable photo-storage adapter and current two-job limiter with isolated in-memory repository/S3 effects. Database authorization and locking were covered separately by the PostgreSQL checks above. This fixture used no production database, provider credentials, uploads, paid inference or card edits.

| Original | Bytes | Original SHA-256 | Decoded and working dimensions |
| --- | ---: | --- | --- |
| Desktop Front | 2,175,721 | `f8c13dc84b745ec12e52cdc8b0e1b25894ce38caf5d4d2f2991632dbe2450f27` | 3024 × 4032 |
| Desktop Back | 1,536,155 | `f10c63eb077019f6155e2fd34960a46318fa67672a5b2393a9d011a74c66ab48` | 2808 × 4031 |
| Mobile Front | 3,723,919 | `0a74fece6fd500ffd1cadf4ef043a3f8894204fb6854acd1303018a2c9282113` | 3024 × 4032 |
| Mobile Back | 2,531,010 | `38574a3d835ef17eb4d5160e76bbc3acfbcac9890e9a8f937c0044a7d07bbb7e` | 2808 × 4031 |

All eight summaries (four sequential and four concurrent) agree exactly on original identity, side/version/pair binding, dimensions, source-to-frame transform, treatment, full pixel hashes and decoded/working PNG hashes. Both desktop images match every primary RGB byte produced by an independent standalone libheif decoder using its normal primary presentation. Mobile orientation matches an independent integer permutation, and independent ICC matrix/TRC checks cover 12,230 Front and 11,354 Back pixel samples with a maximum one-code-value error. The mobile decoded and working images also have identical full pixel and PNG hashes.

An injected failure after derived-image persistence but before the source artifact commit left the verified original recoverable. Retrying the same saved upload succeeded; repeated complete/prepare calls reused the durable source without reprocessing. Each pair retained exactly six immutable objects (two originals and four full-size derivatives), with exact readbacks and no extra versions or side reassociation. Both parallel phases reached two active processors. All originals remained byte-identical.

The photo phase completed in 123.408 seconds; the separate oracle compile/verification phase took 1.326 seconds. Photo-container peak memory was **634,335,232 bytes (604.95 MiB)**, below the 3 GiB limit. Both containers exited zero with no OOM or restart, and unrelated container inventory was unchanged. These bounded multi-case qualification timings are not a production upload-latency measurement.

The successful receipt is `R/native-context-a00f9885/photo-qualification-evidence/upload-recovery-a00f9885-1/result.json`, SHA-256 `83d89f86a39357480640aa61761c221cc74a7b68209bb9b9981245971b8ba7d3`. Its `photos/raw-proof.json` SHA-256 is `9b9ee966682ec5f8f44d5273a7ee7339b2656d8283d1d69a0fa2025172ae1724`, byte-identical to the local proof. The independent oracle source hash is `88ea198f6d8ad01d2873a8d55f745ec9d27511a37464fafc56aa3a9ac93f5b46`; its candidate-built executable hash is `074781c1fe9bd627f3c49ade66ad412c8c7d83f33b05343f93459b355066d081`.

Independent reviews passed for the HEIC correction, JPEG parser/worker/core changes, isolated photo wrapper and strict photo evidence gate. The sealer follows the actual input, source/native, raw proof, container inspect and log hash closure; its offline check accepted one complete synthetic closure and refused all 21 mutated cases. The actual runtime and alias readback evidence is recorded below separately from these qualification receipts.

## Observed live runtime and alias proof

The private runtime now runs source `a00f988568f29cbe01946213005ee50bd5e6b1d9` and image `sha256:9fdbd82d3fc9af3acf3ec2c636360347579439f2d1b2cba2389f0c6bb33d00af` in container `146e1d266a42fd67c1a1c04f5c69b5a6066d8cedd302e5475652e3ea6c51f4e5`. The observed cutover time was 02:42:49 UTC. It had zero restarts and zero observed runtime error events at final readback. Staff control revision is **21** and SMS revision **19**, with config hash `7e4302734b1808b6bc2413a27be8429e2e33e08bf0058cfe08afbc522b7cfacb`. The sealed action SHA-256 is `7d719595c4c64311c9eb6a964273ad3f56ac6b3f6fc0c56b342a6540ec5d3918`.

`R/final-readonly-1/summary.json` reports `INDEPENDENT_POST_CUTOVER_UPLOAD_RECOVERY_READONLY_PASS`, SHA-256 `4af2282edc2ff9b4a85ab2d8068a7429e629e0e0685a7be4323bbac0c84cd2ad`. It verifies all 589 source files and all 16 native identities, including the two rebuilt addon artifacts and 14 unchanged dependency/library artifacts. All 14 manual histories, saved cards, uploads, details, approvals and provider history were preserved; the one accepted provider event was unchanged. The complete 42-staff and 98-public-successful-plus-13-historical-rollback ledgers were preserved. The prior `3cfab20a` container was retained stopped and detached, earlier retained runtimes were unchanged, and Caddy bytes/inode were unchanged. The final read-only check performed zero business actions, automatic decisions, provider requests or remote writes.

The staff build is `dpl_GwHjrMd7TFL7pStwdE6eRTmBoce4` at `atlas-grading-staff-4i5on1b7z-ten-kings.vercel.app`. Public deployment `dpl_2HkLRTBRqx8wdMrdWgneqVWF3BN7` at `atlas-grading-public-jkkeq510f-ten-kings.vercel.app` was promoted with one provider POST. Subsequent GET-only readback verified all four expected aliases and the project's production target against that same READY deployment. The `www.atlasgrading.com` alias retains its 308 redirect to `atlasgrading.com`.

Provider evidence: `R/provider-final-1.json`, SHA-256 `a746d8ea634611a58d5db01634992cc9044a1e306498d7e9891e43039ceb7c48`; explicit alias/target readback: `R/promotion-readback-1.json`, SHA-256 `8dd0bd81d13925b1a429278be659764efa7fa9581542f9d3ccc27c09f707d4c9`. The readback itself made zero provider writes and did not claim ordinary human sign-in verification. The bounded final hosted check completed at 02:45:45 UTC: **10 routes, 49 assets, 59 GETs, 2,687,477 bytes and all 33 feature markers passed**. Its receipt is `R/final-web-prepared/hosted-1/result.json`, SHA-256 `394126aff8c69861d15b820a3d6d7e9ebb59fbde9c1de9bade514bab18e12a7f`. The existing customer deployment was unchanged. This check made no provider writes, card actions, model calls, SMS requests or signed-in-session requests. Two anonymous GET session bootstraps may create anonymous-browser and rate-bookkeeping rows; the check does not claim a human signed-in card workflow or optical-accuracy acceptance.

This work does not approve a report, alter grading, discard originals or replace human review. Inventory's separately completed release has advanced the production public migration ledger to 98 successful entries plus 13 historical rollbacks; staff 42 remains unchanged. This release performed no migration or grant change.
