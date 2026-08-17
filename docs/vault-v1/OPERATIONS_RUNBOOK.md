# Vault V1 Local Operations Runbook

This runbook covers simulator-backed development and future appliance procedures. Commands that apply a cloud migration, deploy/restart a serving environment, charge a payment, or actuate hardware are intentionally absent and require separate authorization plus pre/post session-log entries.

## Development validation

```bash
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm install
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm vault:validate-isolation
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm vault:build
env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm vault:test
```

Use only temporary local SQLite files and the deterministic mock adapters. Never point simulator tests at a provider, serial port, or production cloud.

The service process must receive immutable `VAULT_APP_VERSION` and `VAULT_SOURCE_COMMIT` values from the verified installer/service wrapper. Browser input cannot supply or replace build provenance, and certification fails closed when the source commit is absent or `UNVERIFIED`.

## Safe startup sequence

1. Bind loopback only; refuse wildcard/non-loopback address.
2. Acquire the single-writer lock.
3. Open SQLite and set foreign keys, WAL, `synchronous=FULL`, and busy timeout.
4. Apply only bundled local SQLite migrations; never cloud Prisma migrations.
5. Run integrity, disk-pressure, clock, active-config, adapter-mode, and service-lock checks.
6. Recover nonterminal sales/restocks from durable facts; query only the configured mock or separately qualified provider adapter.
7. Never repeat an unknown payment or door command automatically.
8. Start static UI/WebSocket only after state can be rendered safely. New checkout remains blocked until cloud freshness, config/tax, controller, payment adapter, storage, and clock policy are ready.
9. Display the trusted build identity in service/certification state. Restock and certification may expose only one unobserved command at a time; require a terminal controller receipt and then a separate human observation before advancing.

## Backup and restore

- Backups use SQLite's consistent backup facility, are encrypted by the machine protected-storage boundary, named with machine/schema/app/config versions, and kept outside the live database directory.
- Validate each backup with `integrity_check`, digest it, enforce a bounded retention/quota, and audit creation/pruning. Sync acknowledgement never deletes source business facts.
- Restore only in service lock with Technician/Admin operational authority. Preserve the failed database and logs, restore to a new path, verify digest/integrity/schema/config, then restart into locked recovery. Credential recovery is Admin-only.

## Update and rollback

- Accept only signed/digest-verified installers from the approved channel. Record prior/new commit, app, contract, local schema, and UI asset digests.
- Stop accepting new checkout, finish/reconcile active work, enter service lock, take verified backup, install, cold-start checks, then require explicit safe exit.
- On failure, restore the prior signed application and compatible database backup. Never downgrade config trust roots or silently reverse a local schema.

## Support bundle

Export redacted health, versions, readiness reasons, config/event digests, short support references, command outcomes, outbox status, integrity result, and bounded logs. Exclude PAN/CVV/track/PIN input, bearer/machine credentials, private keys, raw provider transfer data, personal contact data, and unredacted vendor payloads.

## Critical stop

Any observed wrong-door or unpaid-door command, test/live crossover, duplicated live payment evidence, database integrity failure, invalid signature acceptance, or physical unsafe state requires service lock, cessation of affected external automation, evidence preservation, and independent root-cause review. Do not mark the machine certified or public-ready.
