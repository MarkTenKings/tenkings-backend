# Ten Kings Vault Machine

This package is the sole Windows-local writer and immediate authority for Vault V1. This build intentionally includes only the deterministic Nayax mock and controller simulator; it cannot make a live charge or address physical hardware while evidence gates G-01 and G-02 remain open.

The runtime requires Node 20, `better-sqlite3`, a unique machine UUID, a pinned Ed25519 configuration public key, a random supervised-adapter callback token, a local database path, the exact assigned-access loopback origin, and build-stamped `VAULT_APP_VERSION` plus `VAULT_SOURCE_COMMIT` values. Certification fails closed unless that trusted service provenance is present. The service rejects non-loopback binds and clients.

Core invariants are enforced in SQLite transactions: immutable checkout snapshots, reservations, authorization-to-fulfillment commit, deterministic command intents, pessimistic unknown dispatch boundary, all-original-paid-door group retry, per-door restock outcomes, append-only events, and ordered outbox delivery.

Signed configuration schema 2 uses explicit versioned machine profiles with stable door IDs, separate printed labels and geometry, and controller endpoint/channel mappings. Public ordering follows the profile, while every sale and command pins the original label/address/profile digest. Historical schema 1 remains readable with its original 150-door identities, mappings and signed bytes. Local SQLite schema 3 retains retired doors and immutable sale, command, restock and certification history.

Topology changes require the local Technician or Admin to review the exact pending configuration and confirm every compartment is empty and serviced doors are closed. Activation rejects stock, active carts, transactions, unfinished payments/commands, restocks or certification. It ends the staff session while preserving service lock; authentication and safe exit are required before public operation. Retired stable IDs cannot be rebound to different compartments or addresses. A `FILLED` outcome under a schema 2 profile requires explicit confirmation that the actual packaged product fits the compartment. Synthetic dimensions and mappings are software fixtures and never qualify a physical cabinet.

Use the disposable mock demo from the repository root:

```sh
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm vault:demo -- --doors 72
```

The demo also supports `--doors 125` and an automated `--smoke` run. It prints its loopback URL and temporary test staff credentials, uses generated local keys and mock cloud/payment/controller boundaries, and removes the disposable session on exit. These fixtures do not describe physical wiring. The standalone machine CLI's optional `VAULT_SIMULATOR_MAPPING_PATH` supplies a reviewed JSON simulator address array for a schema 2 profile; absent that input it supports only the historical schema 1 mapping. No address is derived from a door label or screen position.

Encrypted backup/restore is bounded to 256 MiB per SQLite snapshot and verifies database and foreign-key integrity. Support exports use a fresh directory, include only redacted metadata and bounded log tails, and exclude database and credential files. Windows-protected credential storage, pinned Windows Node/native SQLite packaging, service installation, state-aware activation/update/rollback and installed hardware validation remain unimplemented production work. The application rejects live payment/controller dispatch; official adapters require their own reviewed implementation and authorization.

Windows files under `windows/` are digest-verifiable service/install/update/rollback/support artifacts. They are source artifacts only; this implementation did not install, restart, or update a Windows service.
