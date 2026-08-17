# Ten Kings Vault Machine

This package is the sole Windows-local writer and immediate authority for Vault V1. This build intentionally includes only the deterministic Nayax mock and controller simulator; it cannot make a live charge or address physical hardware while evidence gates G-01 and G-02 remain open.

The runtime requires Node 20, `better-sqlite3`, a unique machine UUID, a pinned Ed25519 configuration public key, a random supervised-adapter callback token, a local database path, the exact assigned-access loopback origin, and build-stamped `VAULT_APP_VERSION` plus `VAULT_SOURCE_COMMIT` values. Certification fails closed unless that trusted service provenance is present. The service rejects non-loopback binds and clients.

Core invariants are enforced in SQLite transactions: immutable checkout snapshots, reservations, authorization-to-fulfillment commit, deterministic command intents, pessimistic unknown dispatch boundary, all-original-paid-door group retry, per-door restock outcomes, append-only events, and ordered outbox delivery.

Windows files under `windows/` are digest-verifiable service/install/update/rollback/support artifacts. They are source artifacts only; this implementation did not install, restart, or update a Windows service.
