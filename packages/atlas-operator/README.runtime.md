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

Reviewed exact Node versions are `v20.20.1` and `v22.23.2`, and each release pins one exact executable hash. The native checker currently supports thin little-endian macOS Mach-O 64 only and permits protected macOS system libraries. It rejects Homebrew, vendor and `@rpath` dependencies; Linux, Windows and universal binaries fail until a separate native dependency checker is reviewed. The installed Homebrew Node 20 fails this check; the previously retained official Darwin arm64 Node 22.23.2 passes. This is local artifact validation, not a production platform/deployment claim.

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

Local acceptance includes 31 runtime tests, 15 artifact tests, and source packaging with the retained official Node 22.23.2. The verified packaged runtime and Prisma modules import without constructing a client or provider. Real database/provider acceptance, deployment ownership and the supervised pilot remain lead-owned gates.

The existing backend deployment runbook describes a DigitalOcean Docker host, but no dedicated supervised operator host is selected here. Deployment on Linux requires a Linux-native artifact: a reviewed exact Linux Node executable, matching generated Prisma 5.22 engine, selected architecture/libc/OpenSSL baseline, and a reviewed ELF interpreter/dependency/RPATH closure checker. The current Darwin artifact cannot serve that deployment. No Linux runtime was downloaded or native dependency rewritten.
