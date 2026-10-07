# Single-run operator entry point

`scripts/run.mjs` composes the real operator ledger, evidence client, concrete adapters and fixed Astra Responses transport. It accepts either one exact already-enqueued run or one exact already-admitted machine initialization. The initialization path calls the private execution-only endpoint once, then processes only the durable operator run returned for that successful job. It does not admit jobs, activate controls, schedule another run, retry uncertainty, deliver notifications, reconcile invoice cost, approve reports or configure a provider.

This code is inactive unless `ATLAS_OPERATOR_ENABLED=true`, `NODE_ENV=production`, a verified release manifest and all dedicated settings are supplied. The current database role, deployment controls, admitted run, policy, budget and leases must also pass the existing ledger authority. No deploy or activation has been performed by adding this entry point.

## Release artifact producer

`scripts/package-release.mjs` is an explicit offline command. It uses installed esbuild 0.27.7 and Zod 4.1.11; it never installs dependencies, rebuilds shared grading-core output, creates a database client, or activates controls. Supply a canonical bindings file containing only `databaseBindingHash`, `providerBindingHash`, `imageBridge: {origin, keyHash}`, and `machineInitialization`, plus its independent SHA-256 and the exact reviewed release SHA. Use `machineInitialization: null` for a run-only release, or `{origin, admissionKeyHash, executionKeyHash}` for initialization support. Origins are exact HTTPS origins; key hashes are SHA-256 of the decoded 32-byte keys. Admission, execution and image keys must be distinct. No credential belongs in this file.

```text
<reviewed-node> packages/atlas-operator/scripts/package-release.mjs \
  --source-root <absolute-canonical-checkout-root> \
  --output <absolute-new-artifact-directory> \
  --bindings <absolute-canonical-bindings-JSON> \
  --bindings-sha256 <independently-retained-bindings-SHA256> \
  --release-sha <exact-reviewed-commit-SHA> \
  --manifest-out <absolute-new-manifest-path-outside-artifact>
```

The producer bundles the actual operator, five required service-bridge modules, including the execution-only initialization transport, existing grading-core report output, and Zod into one runtime. Its fixed esbuild loader reads and hashes each input; an input that changes before inventory finalization fails. The bundle metadata must contain every required dependency and only Node builtins as external imports. The artifact also contains the minimal bootstrap/verifier, exact generated Prisma client/runtime/schema and one native engine, and the exact Node executable. Generated Prisma must be version 5.22.0 with its dedicated environment-only datasource, matching inline schema and no dotenv lookup paths.

`artifact.json` is canonical UTF-8 JSON without timestamps or absolute source paths. Its sorted inventory covers every file's SHA-256, byte count and fixed read-only mode. The build hash is SHA-256 of these inventory bytes; the inventory does not contain its own hash or any deployment manifest. `closure.json` records exact bundled input hashes and builtin imports. A separate canonical release manifest binds that build hash to the existing runtime configuration hash, reviewed release SHA, exact Node version, fixed `gpt-6-astra`, dedicated credential hashes, evidence origin/key hash and tool roster. The `atlas-operator-release-v2` manifest requires `machineInitialization: null` or `{origin, runtimeHash, admissionKeyHash, executionKeyHash}`. The producer fills this runtime hash from the actual operator configuration hash; the caller cannot choose another initialization runtime. These optional execution bindings are protected by the independent manifest SHA without changing the existing operator configuration hash formula. The manifest SHA is printed for independent retention. It is not written inside the closed artifact.

Each release pins one exact Node executable hash. Darwin retains the reviewed `v20.20.1` / `v22.23.2` thin little-endian Mach-O 64 arm64/x64 policy and permits protected macOS system libraries. It rejects Homebrew, vendor and `@rpath` dependencies. The installed Homebrew Node 20 fails; the retained official Darwin arm64 Node 22.23.2 passes.

The only Linux target is official Node `v20.20.1` ELF64 little-endian x86-64 on Debian Bookworm with OpenSSL 3, and the single Prisma 5.22 engine must be named `libquery_engine-debian-openssl-3.0.x.so.node`. The checker parses the bytes directly. It requires the exact executable interpreter `/lib64/ld-linux-x86-64.so.2`, an interpreter-free shared engine, bounded and unambiguous program/dynamic/string tables, and file-backed mappings. It rejects extended table numbering, overlapping load pages, executable stacks, writable executable segments, malformed strings, duplicate singleton tags/dependencies, all RPATH/RUNPATH, and unreviewed dynamic tags including alternate audit/filter/configuration loaders. Node 22 on Linux, Linux arm64, musl, OpenSSL 1 engines, Windows and universal binaries remain unsupported.

Both Linux binaries may depend only on `libc.so.6`, `libdl.so.2`, `libgcc_s.so.1`, `libm.so.6`, `libpthread.so.0` and `ld-linux-x86-64.so.2`. Node additionally permits `libstdc++.so.6`; the Prisma engine additionally permits `libssl.so.3`, `libcrypto.so.3` and `librt.so.1`. The checker does not bundle these libraries or establish their provenance from their names. The release owner must independently pin the immutable container image and prohibit replacement library/loader/configuration mounts. The verified local baseline is the official amd64 image `docker.io/library/node:20.20.1-bookworm@sha256:abc255963bb4311b1f81bf45f2382df39a4041d2a975b1807d05809f1bc21bbe`, containing libc6 `2.36-9+deb12u13`, libssl3 `3.0.18-1~deb12u2` and libstdc++6 `12.2.0-14+deb12u1`. The slim image lacks libssl3 and is not a complete baseline. No mutable OS package installation is part of this artifact proof.

The bootstrap imports only Node builtins and the minimal verifier until the whole artifact passes. It checks every file and directory, rejects writable paths, symlinks, hardlinks, path traversal, unexpected files, incorrect Node/architecture and changed native code, and verifies the executing Node binary against the included binary. Both execution methods verify again before constructing any client or making a private call. The initialization path defers even the Prisma module import until its successful reply identifies an operator run. Prisma's pinned 5.22 engine constructor path is supplied from the verified artifact; ambient engine overrides cannot substitute a library.

The release owner must preserve the independent manifest SHA and trusted bootstrap/Node provenance, launch without code preloads or native-loader overrides, and deploy the directory read-only under ownership unavailable to the runner. Self-verification cannot establish trust in an already-modified verifier, undo a preload or OpenSSL configuration that executed before JavaScript, or prevent a privileged owner from replacing files after verification. Protected OS libraries remain the platform trust base. The script rejects unsafe launch settings when it starts, including every `OPENSSL_*` variable and the ambient CA paths `SSL_CERT_FILE` / `SSL_CERT_DIR`, even if empty. Node documents loading `OPENSSL_CONF` at startup; rejecting it in JavaScript prevents this runner from proceeding but cannot reverse earlier native initialization. CA-path rejection prevents a launch environment from silently selecting additional trust files; the fixed Node/OS trust base still requires separate deployment review. OS deployment ownership is a separate release requirement.

## Dedicated settings

- `ATLAS_OPERATOR_ENABLED`
- `NODE_ENV`
- `ATLAS_OPERATOR_RELEASE_SHA`, `ATLAS_OPERATOR_BUILD_HASH`, `ATLAS_OPERATOR_RUNTIME_HASH`
- `ATLAS_OPERATOR_DATABASE_URL` for the restricted operator role and `atlas_staff` schema
- `ATLAS_OPERATOR_OPENAI_PROJECT_ID`, `ATLAS_OPERATOR_OPENAI_API_KEY`
- `ATLAS_OPERATOR_EVIDENCE_ORIGIN`, `ATLAS_OPERATOR_EVIDENCE_KEY`

Release/runtime fields must equal the manifest. The dedicated credential hashes and evidence origin must reproduce its bindings. Local fixture flags are rejected. Generic `DATABASE_URL`, `OPENAI_API_KEY` and legacy bridge credentials are never used as fallbacks.

Once separately released and authorized, the command shape is:

```text
<artifact>/bin/node <artifact>/packages/atlas-operator/scripts/run.mjs \
  --run-id <exact-admitted-run-UUID> \
  --manifest <absolute-release-manifest-path> \
  --manifest-sha256 <independently-retained-manifest-SHA256>
```

For an initialization-capable release, also supply:

- `ATLAS_MACHINE_INITIALIZATION_ORIGIN`, matching the manifest origin
- `ATLAS_MACHINE_EXECUTION_KEY`, the dedicated encoded 32-byte execution key
- `ATLAS_MACHINE_ADMISSION_KEY_HASH`, the manifest admission peer-key hash
- `ATLAS_MACHINE_INITIALIZATION_ENABLED=true` when selecting initialization

The runner rejects any `ATLAS_MACHINE_ADMISSION_KEY` property, including an empty value. It cannot sign admission requests. A run-only manifest requires the execution key, peer hash and initialization origin to be absent. An initialization-capable release validates all execution bindings even when invoking its alternative `--run-id` path.

```text
<artifact>/bin/node <artifact>/packages/atlas-operator/scripts/run.mjs \
  --initialization-id <exact-already-admitted-job-UUID> \
  --manifest <absolute-release-manifest-path> \
  --manifest-sha256 <independently-retained-manifest-SHA256>
```

Exactly one selector is required. Initialization uses the fixed `/api/internal/atlas/machine-initialize/execute` path, one execution-purpose HMAC request with a 30-second authorization window, and a 220-second bounded wait. No admission secret, caller URL, redirects, cookies or automatic retries are available. Unknown, failed, aborted or malformed initialization replies cannot construct an operator provider. A successful reply must match the exact job and runtime and provide a durable operator run ID; before constructing adapters or a provider, the ledger also checks that run's `initializationId` and runtime match.

A lost reply or a successful initialization without a confirmed operator run ID preserves the initialization ID for explicit same-job recovery. The private service owns durable replay; the runner never chooses a different job or infers a successful run. Uncertainty does not imply that worker or provider work was uncharged or rolled back.

## Shutdown and output

SIGINT/SIGTERM abort the current runner work. Receipt settlement continues despite that signal, with a 30-second drain before database disconnect. Disconnect has a 15-second bound. Late callbacks are denied after closure so they cannot reopen Prisma. A timeout never claims that a provider request, lease claim, transaction or disconnect rolled back. The CLI flushes one projected JSON result and exits after cleanup, including when a transport or driver leaves an unresolved handle.

The result contains only run ID, state, safe error code, applied-step count, receipt counts, disconnect status and exit code. Initialization adds separate `initializationId` and `initializationState` fields, preserving successful initialization independently of the subsequent operator outcome. No raw exception message, credential, provider body, image data or private reasoning is printed.

Exit codes: `0` for `READY_FOR_HUMAN` with all receipts persisted and disconnect confirmed; `2` for a known failure, stop or human attention disposition; `3` for reconciliation or uncertain receipt/disconnect; `64` for invalid configuration/arguments; `78` for inactive operation. `READY_FOR_HUMAN` is not publication or certification.

Local acceptance includes 33 runtime tests, 23 artifact tests covering Darwin and Linux, and source packaging with the retained official Darwin Node 22.23.2 and the pinned Linux Node 20.20.1 image. The Linux artifact contains 25 files and 100 bundled source inputs. Its runtime and Prisma modules import, and its actual native engine loads, in an offline read-only container without constructing a database client or provider. The verified Linux Node SHA-256 is `a03953a7b16bff002b94d6fb58ada900b68241cbcaee6efc400b20dadd36dddc`; the Prisma engine SHA-256 is `35860a5c0fb2f79e7b38c40747c4d212318d97e1910ca528b133c802716de0b8`. The complete current operator suite passes 176 tests. The current candidate includes the optional expected-control-revision guard inside the original locked claim; earlier artifacts without it are historical only. Real database/provider acceptance, deployment ownership and the supervised pilot remain lead-owned gates.

The existing backend deployment runbook describes a DigitalOcean Docker host. The scoped Linux closure checker supplies the native artifact prerequisite; an actual release still needs the independently retained image/manifest hashes, dedicated settings and deployment review. Build Linux in a separate context with only explicit operator/bridge/core source inputs and its separately generated Prisma client. Install pinned dependencies there with a frozen lock and `--package-import-method=copy`; the closed-input check rejects pnpm store hardlinks. Keep the existing manifest v2 and single-run bootstrap unchanged. New queue/coordinator credentials are not authorized by its sole operator database binding. Official Node Docker images include `NODE_VERSION`; the existing launch policy rejects that ambient variable. Construct a clean launch environment with only the intended settings rather than inheriting image metadata or weakening the process check.
