# Legacy Speedster apt snapshot repair — 2026-09-17

The required [Speedster OCI job](https://github.com/MarkTenKings/tenkings-backend/actions/runs/35210227877/job/105168656444) failed while installing `libc6-dev=2.41-12+deb13u3` from mutable Debian trixie mirrors. Debian's [current trixie package](https://packages.debian.org/trixie/libc6-dev) is `2.41-12+deb13u4`; [gcc-14](https://packages.debian.org/trixie/gcc-14) remains `14.2.0-19`. At inspection, main was `89c55d916130d914f6a989197538c8bbd31c9594`. Its Dockerfile, requirements, entrypoint, compiler tests and CI workflow were byte-identical to the failing branch's versions. Therefore an uncached main build using those mirrors would encounter the same missing version; this is an inference from the identical recipe and observed failure, not a separate main build result.

The only runtime source change is `backend/ai-grader-speedster-service/Dockerfile`: replace its inherited Debian source selection with the `20260820T000000Z` snapshots for trixie, trixie-updates and trixie-security. The Python image digest, compiler/libc pins, SAM settings, entrypoint, tests and CI workflow remain unchanged. This repairs the legacy required check without introducing SAM into the ATLAS manual workflow.

Both HTTPS source stanzas explicitly require `/usr/share/keyrings/debian-archive-keyring.gpg`. Only `Check-Valid-Until` is disabled, as documented for historic archives by [Debian snapshot](https://snapshot.debian.org/) and [apt sources.list](https://manpages.debian.org/trixie/apt/sources.list.5.en.html). Signature authentication and TLS remain enabled. Snapshot uses the latest import at or before the specified timestamp.

## Read-only primary evidence

The following compressed amd64 indexes were fetched into memory from the exact selected URLs on 2026-09-17. Hashes are SHA-256 of the compressed response bytes, not a substitute for apt's signature verification during the build.

| Index | Bytes | SHA-256 |
| --- | ---: | --- |
| [trixie main](https://snapshot.debian.org/archive/debian/20260820T000000Z/dists/trixie/main/binary-amd64/Packages.xz) | 9,672,648 | `3ab4e811cf4f3e5a335d382c58cc19d85f1abe7a4ef4689160ca1f637fa0e9b3` |
| [trixie-updates main](https://snapshot.debian.org/archive/debian/20260820T000000Z/dists/trixie-updates/main/binary-amd64/Packages.xz) | 4,412 | `10012cb384dc2613586d7b3d391d92a5637c9faa36017239739f2a6109a0d45f` |
| [trixie-security main](https://snapshot.debian.org/archive/debian-security/20260820T000000Z/dists/trixie-security/main/binary-amd64/Packages.xz) | 244,764 | `5fc131dcee1723b589c7cc6c619606e5bd9249b73284358fe356198f91ab465e` |

The trixie index contains `gcc-14=14.2.0-19` and `libc6`, `libc-dev-bin`, and `libc6-dev` all at `2.41-12+deb13u3`, including the exact-version dependencies required by libc6-dev. Neither other index contains competing entries for these packages. The index records these package payload hashes:

| Package | SHA-256 |
| --- | --- |
| gcc-14 | `21500408b5019d8d29f70ce58488e2eea469a1adb4b5fd7db45e819b5efcac4e` |
| libc6-dev | `53a9b789bb02415d758f652ef5ac913d89fed29782610e9fe0fd2488e4f2e465` |
| libc-dev-bin | `2eb5db4cb16a42850ed9d3ca8b2b1aeda91dd00d248f6068f49d641321748308` |
| libc6 | `8ffd13165b9ee3f067e2ee670df718e48c1bdaa18676ac93d1de761dbbb3913c` |

The official Docker Python registry's metadata for the existing pinned image was also read without pulling its filesystem layers:

- Pinned index: `sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a`.
- Associated linux/amd64 manifest: `sha256:876416ecde9aca2bcc90e1fb0c7a9500bbf749f5788b70f82d4c5a5c2357f8b4` (1,746 bytes; content digest verified).
- Associated SPDX attestation layer: `sha256:2a2bc32a2d362a06c3cd8466429870f205c7b78bb68c1e7aa3477f930609600b` (2,146,233 bytes; content digest and subject association verified). This is OCI content verification, not an independent attestation-signature verification.
- The attestation identifies Python `3.12.14-slim-trixie` and records `libc6`/`libc-bin=2.41-12+deb13u3`, `gcc-14-base=14.2.0-19`, and `debian-archive-keyring=2025.1`. Thus the selected libc development package matches the pinned base's recorded libc version.
- The manifest identifies [official Python source revision f2c5d1b8](https://github.com/docker-library/python/tree/f2c5d1b8a6adecb5b00b3c9331d4f863beade6b3/3.12/slim-trixie).

## Validation boundary

Offline validation checks Dockerfile shell syntax and whitespace, and confirms the existing pins and non-apt Dockerfile content are unchanged. No host apt operation, service mutation, image pull, or live storage action was performed. Index availability and base metadata do not establish that apt has successfully resolved or installed the full dependency closure.

The corrected source must pass the existing exact-image CI build against the pinned Python base, including apt signature verification and installation, exact dpkg versions, entrypoint compiler probe, complete unittest suite with the Triton shared-object compiler test, validate-only checks, and invalid compiler/CuBLAS rejection. Those checks are retained without weakening or skipping. Build success and the resulting image digest must be recorded separately after CI finishes.
