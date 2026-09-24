# Fresh-source Linux build qualification — 2026-09-24

Customer, public and staff production builds passed their existing boundary audits using the current worktree source. The requested six-package integration suite and final focused compatibility checks also passed. This validation did not deploy or activate any runtime, contact providers, or remove host files.

| Application | Exact command | Result | Duration |
| --- | --- | --- | --- |
| Customer | `pnpm run build` in `frontend/atlas-customer` | Pass; isolated `/account` routes, dedicated database engine, browser credential boundary | 31.16 s |
| Public | `pnpm run build` in `frontend/atlas-public` | `PUBLIC_BUILD_BOUNDARY_PASS`; 13 browser chunks, 10 server traces, 712 traced files, no staff/write routes | 39.20 s |
| Staff | `pnpm run build` in `frontend/atlas-app` | `STAFF_BUILD_BOUNDARY_PASS`; 32 browser chunks, 15 server traces, 3,003 traced files, `/admin/customer-operations` included | 51.14 s |

The build commands regenerated the three isolated Prisma clients. Public/staff rebuilt grading-core and manual-workspace from source; staff rebuilt ebay-sold-comps-v2 with the exact locked TypeScript 5.5.4. Existing nonblocking image, React-hook and CSS compatibility warnings remain visible in the logs. Boundary assertions and application source were not changed for this validation.

## Evidence

- `customer-build.log`, `public-build.log`, `staff-build.log`: complete final successful command output. Corresponding `*-result.json` files include command, exit code and duration.
- `source-manifest.customer-public.json`: 991 files from this worktree; SHA-256 `d91344d1b699eb3677c7247b0e5249dce835c48a0aa77848c76d2dff55730296`.
- `source-manifest.staff.json`: final staff snapshot; SHA-256 `8c8fad8cc2a7341617e226e10eacc137dfcd86ae786453805650b3475451270d`. The only change from the customer/public snapshot was the dealer PostgreSQL validation script, not an application build input; see `customer-public-to-staff-diff.json`.
- `*-artifacts.json`: build IDs, route manifests, source hashes and output hashes. The additional trace inventory covers all `.nft.json` files under `.next`, including Next root traces, and confirms zero paths outside `/build`.
- `dependency-links.json`: 129 links for 29 current workspace packages, validated against the source manifests and exact lockfile resolution, including installed peers. No link points to another checkout.
- `dependency-source-manifest.json`: only the 19 missing, platform-independent registry packages copied read-only from existing local dependencies (976 files, 45,549,797 bytes, zero native binaries). No package was installed or downloaded.
- `native-build.json`: the current HEIF addon was subsequently rebuilt inside the fixture for private runtime tests. Current `heif.cc` differs from the old image source, so the old addon was not reused. Current source SHA-256 is `45a911f825f94d29119689ea9ede28c37557099c040d46a71aaf58aa378dcb78`; new Linux binary SHA-256 is `ee8032262b87b3fbb32cc8dcf24bd3618d63aaa63dcacebda00a0210b6941845`.

## Isolated fixture

The immutable local base was `sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc` (`atlas-connected-manual:release-readiness-20260912`), Linux amd64, Node 20.20.2, pnpm 9.12.0, Next 15.5.25, Prisma 5.22.0. Docker used amd64 emulation on the arm64 host.

The fixture has no network or host mounts, a read-only root filesystem, a 5 GiB memory/swap limit, four CPU limit and 256 PID limit. Only `/build` (3 GiB) and `/tmp` (512 MiB) are writable executable tmpfs mounts. Existing image registry dependencies were copied into `/build`; all workspace source came from the current worktree via a tracked/untracked allowlist, excluding environment files, keys, logs, dependency folders and old build outputs. Installed dependencies and image caches were read only. The image's existing Prisma engine cache was verified against its stored SHA-256 values and copied to tmpfs. The current native addon was compiled with existing image headers/compiler/libheif 1.23.2.

`fixture.json` records exact configuration and captured container ID. `fixture.py remove <full-id>` checks the captured ID, immutable image, name, owner, nonce, no host mounts, no network and read-only root before removing only that fixture. Nonce: `7e8bf109-13ad-4c69-88d5-68b7bca2f931`.

Three initial attempts exposed fixture setup issues, preserved in `*.attempt*.log`: missing access to the image's root-user Prisma cache; Docker's implicit noexec tmpfs default; and one missing locked React peer symlink. These were corrected only inside the owned fixture or its isolated helpers. The first owned container was removed after ID/nonce verification; the replacement captured ID is `f17b52f57293995b36e0e9ac5dc280f67f070692fa03ea878c1caac976f74ebd`.

No Docker pull, prune, volume operation, host dependency mutation, frozen-checkout mutation, real customer message, charge, printer action or production activation occurred.

## Private-runtime compatibility

The requested packages were `atlas-customer-intake`, `atlas-commerce`, `atlas-dealer-operations`, `atlas-service-bridge`, `atlas-connected-manual` and `atlas-batch-grading`. Their 55 `*.test.mjs` files ran with Node test concurrency two. The exact Docker packager's ten Python worker/source files and the read-only database schema fixture needed by the service-bridge privilege tests were added to the source closure. No extra package installation occurred.

- Initial full run: **410 passed, zero failed, one skipped** in 71.44 seconds (`integration-tests.log`, `integration-result.json`). Snapshot `9804abc4802210af6cc4be91bbff9a2f353fa9884161840e443f73fe9482a6d0` is preserved in `source-manifest.integration.initial.json`.
- The single skipped case was `checked native CPU yields exactly the same proposal and approved traces, overlap ownership and score`, which explicitly requires `ATLAS_MEASUREMENT_PYTHON`. It was then run with `/opt/atlas-python/bin/python` and **passed** in 10.25 seconds. Six other tests were intentionally unselected by the name filter (`integration-native-tests.log`, `integration-native-result.json`).
- Commerce made one subsequent compatibility correction to the disabled checkout path. Only the affected commerce suite and customer-runtime lifecycle tests were rerun: **50 passed, zero failed, zero skipped** in 1.76 seconds (`integration-commerce-tests.log`, `integration-commerce-result.json`). The current source also includes the final intake SQL location projection and commerce privacy projections.
- Final 1,005-file snapshot: `543cd85b1499ac7d8051caa9ac9d34bdd5caabc92dcd55c0d6a11f4ec2bc6e01`, in `source-manifest.integration.json`. `integration-final-diff.json` records the changes, and `final-source-diff.json` confirms no changes at final verification. The later changes were private runtime, SQL, tests and documentation; the production application build inputs remained unchanged, so those successful builds were not repeated.
- `native-runtime-identity.json` confirms that the newly compiled addon loads and exports `decode`/`probe`, with Sharp 0.33.5, libvips 8.15.3, OpenCV 4.10.0 and NumPy 1.26.4. Synthetic/injected tests and local loopback transport were used; the fixture had no external network.

## Session-log integration note

Fresh-source Linux production builds for customer, public and staff all passed their existing boundary audits inside an owned, read-only-base/no-network/no-host-mount Docker fixture with tmpfs outputs. Customer/public snapshot `d91344d1…` and staff snapshot `8c8fad8c…` are preserved with per-file hashes, artifact hashes, exact commands and logs in `validation/atlas-build-20260924`. All workspace links resolve inside the copied current source, and the exact lockfile versions were preserved using existing installed dependencies only. Current HEIF source was compiled against the image's pinned libheif 1.23.2. The six requested package suites passed 410 cases with zero failures; the one opt-in native measurement case then passed separately. After the final commerce compatibility correction, 50 commerce/customer-runtime tests passed with zero skips. Final source snapshot `543cd85b…` includes final49 SQL privacy projection and matches the checked worktree. Host cleanup hold remained intact; no deploy or activation occurred. Fixture cleanup receipt is `cleanup.json`.
