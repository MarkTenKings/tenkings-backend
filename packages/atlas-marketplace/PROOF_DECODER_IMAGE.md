# Proof decoder OCI assembly

`package-proof-decoder-oci.py` is an offline packaging tool. Its output is
**UNQUALIFIED**. It never downloads, installs, extracts an archive to disk,
executes an input binary, calls a daemon, or authenticates native observations.
It changes no worker, PDW1 protocol, validation DTO, intake, storage or factory.

The fixed [closure specification](images/proof-decoder/closure-spec.json) binds
five unchanged source files and the existing `pnpm-lock.yaml` from source
`16351962d0b57316a8618e0263182f06f4e37435`. The worker is copied byte-for-byte to
`/opt/atlas-proof-decoder/worker.mjs`; its four relative module dependencies stay
beside it. There is no bundling or rewritten module. Node is exactly 22.16.0
Linux x64; sharp is 0.33.5 with its pinned libvips package 1.0.4. The existing
worker still requires the actual runtime libvips version to be 8.15.3.

The Node archive checksum comes from the
[official 22.16.0 checksum list](https://nodejs.org/download/release/v22.16.0/SHASUMS256.txt).
All eleven npm archives use the existing lock's exact SHA512 integrity values.
The assembler checks archive integrity before reading members and checks every
selected member against the staged file. Package version strings alone cannot
substitute for those checks. It does not independently authenticate the publisher
or a package repository signature.

Every member of the checksum-verified Node archive still receives structural
path, link, type and size checks. Its unselected public npm configuration and
tools are omitted. Credential/config exclusions apply to selected Node member
names and destinations, all npm package members, inventory and staged rootfs.

## Inputs and invocation

Use Python 3.9 or later on POSIX, with standard-library gzip and lzma support.
Supply real canonical absolute directories: no symlink ancestors. Rootfs,
archives and inventory must stay quiescent for the operation. Input reads,
filesystem traversal and output creation use directory descriptors and
`O_NOFOLLOW`; regular hardlinks, special files and setid/sticky files refuse.

```text
python3 -B packages/atlas-marketplace/scripts/package-proof-decoder-oci.py \
  --rootfs /absolute/staged-rootfs \
  --inventory /absolute/inventory.json \
  --archives /absolute/verified-archives \
  --output /absolute/new-oci-directory
```

The output directory must not exist, and cannot contain or be contained in either
input directory. The tool refuses overwrite. A failure may leave its new partial
output directory; it never cleans up or reuses it. No completion receipt means no
completed assembly. Outputs are local artifacts, not a durable publication or
fsync/backup guarantee.

The archives directory contains **exactly** the twelve filenames in the closure
specification: the official Node `.tar.xz` and eleven npm `.tgz` files. Acquisition,
upstream verification and staging are separate reviewed operations owned by the
target operator. This tool supplies no fetch/extract command or archive installer.

Stage only these files, without modifying their bytes:

- The five source files at the specification's exact destination paths.
- Node archive `bin/node` at `/opt/atlas-proof-decoder/bin/node`, and its `LICENSE`
  at `/opt/atlas-proof-decoder/licenses/node-LICENSE`. Exclude npm/corepack, shell,
  headers and the rest of the Node distribution.
- Every regular member of each pinned npm archive, preserving its path beneath
  `package/`, in the flat `/opt/atlas-proof-decoder/node_modules/<package>/` tree.
  Scoped packages retain their `@img/` directory. No `.bin` links are synthesized.
  Package files and licenses remain byte-identical, including upstream JavaScript
  installation helpers; none are run. No shell or package-manager binary is added.
- The actual observed Linux x64 ELF interpreter and transitive system DSO files,
  sourced from the target's independently verified Ubuntu packages. Only regular
  ELF files under `lib64/`, `lib/x86_64-linux-gnu/` or
  `usr/lib/x86_64-linux-gnu/` with the restricted library names are admitted.
  Required file aliases may be relative symlinks directly to a declared regular
  native file. Directory aliases, link chains and escaping/dangling links refuse.

Normalize staged modes to `0755` for Node and system ELF files; `0644` for all
source, notices and npm files, including npm native addons. Directories are
`0755`. Keep actual library search paths and package-relative RPATH layout;
flattening pnpm links into the prescribed package locations is not flattening
native library paths. Empty `dev`, `proc`, `sys` and `tmp` mountpoint directories
are included deterministically. Other unexpected files or directories refuse.

## Closed inventory

Inventory paths are portable, root-relative ASCII names, without a leading `/`,
empty, `.` or `..` component, whitespace, backslash or credential/config paths.
Arrays below are sorted by `path`; duplicates and unknown fields refuse.

```text
{
  schema: "atlas-proof-decoder-rootfs-inventory-v1",
  platform: "linux/amd64",
  nativeObservationSha256: <digest of the operator's actual observation record>,
  native: [
    {path, package, version, archiveSha256}
  ],
  files: [
    {path, sha256, size, mode}
  ],
  symlinks: [
    {path, target}
  ]
}
```

`files` lists every regular staged file. `mode` is an integer (`420` for `0644`,
`493` for `0755`). `native` lists only the additional system ELF files and their
actual package/version/archive references. These references and observation digest
are caller claims; this tool checks neither a signature nor complete dynamic
library resolution. Native files must match their file hashes and have ELF64,
little-endian x86-64 headers of the expected kind. Node and npm native bytes must
also match the fixed archives. A JavaScript/source destination cannot accept ELF.

Limits are fixed: 2 MiB inventory/spec JSON, 128 MiB per file, 512 MiB total
rootfs regular bytes, 4,096 files, 64 native files and 64 file aliases. Each input
archive is at most 64 MiB compressed, 512 MiB expanded, and 20,000 members.
Paths are at most 512 characters, 20 components and 128 characters per component.
Tar members reject duplicate names, traversal, hardlinks, unsupported types and
unsafe links. The emitted layer has a separate finite overhead bound. A fixed
source/lock/archive mismatch requires review; there is no pin-override CLI.

## Output and remaining target gates

Output is a single-layer OCI image layout with content-addressed config,
manifest and uncompressed layer blobs, `index.json`, `oci-layout`, and a separate
`assembly-receipt.json`. Tar order, uid/gid zero, file modes and timestamps zero
are deterministic. The receipt includes every file hash, input archive hashes and
image digests; it declares native closure incomplete and runtime versions
unobserved. It contains no environment dump or raw process report.

The image config is exactly an empty environment and empty volume map, with no
image shell, entrypoint, command, port, user or healthcheck defaults. The existing
launcher supplies the exact numeric user, executable, worker argument and five
runtime environment variables. A conventional Dockerfile frontend is deliberately
avoided because [BuildKit adds a default PATH](https://github.com/moby/buildkit/blob/master/frontend/dockerfile/dockerfile2llb/convert.go).
OCI permits these explicit empty fields; see the
[OCI configuration specification](https://github.com/opencontainers/image-spec/blob/v1.1.1/config.md).

A local manifest digest is **not** an observed Engine `RepoDigest`. Root must
select and qualify a transport, observe the exact `repository@sha256:...` in
Engine image inspection, and match the config and filesystem closure. A possible
loopback-only registry is not implemented or asserted by this tool.

Root must observe actual Node/sharp/libvips versions; recursively resolve the
ELF interpreter, DT_NEEDED/RPATH and dynamically loaded libraries; hash their
actual bytes and package provenance; and run PNG/JPEG PDW1/DTO parity and required
adversarial tests under the real launch profile. Static inventory does not prove
runtime closure, host containment, whole-job cleanup, authenticated IPC,
watchdog independence or admission. Those gates and all marketplace activation
remain separate. Synthetic archive tests do not replace them.
