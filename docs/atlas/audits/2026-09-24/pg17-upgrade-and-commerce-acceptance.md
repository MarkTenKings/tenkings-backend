# PostgreSQL17 upgrade, commerce and dealer acceptance

Completed2026-09-24UTC on the already-present Linux/amd64 PostgreSQL17.11 image `sha256:a2ea0e68c465e0acf4c3672471b22b6b62972bb341e6f31544c855d85ba43745`, using local Node20.20.1 and the existing Prisma/pg dependencies. The complete receipt is [validation/atlas-upgrade-pg17-20260924/acceptance.json](../../../../validation/atlas-upgrade-pg17-20260924/acceptance.json).

This is synthetic qualification of the95-public source chain and staff48→52 upgrade, followed by commerce/dealer runtime checks on fresh95/52 databases. It does not replicate production's112 historical public ledger entries or establish production/provider/customer/human/physical acceptance. No production database or credential was read, changed or migrated.

## Results

| Fixture | Groups | Retained evidence |
|---|---:|---|
| Original schema48→52 upgrade |9 PASS|`/private/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/atlas-staff-db-KjZcbQ`|
| Updated private commerce |11 PASS|`/private/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/atlas-staff-db-gEQmkO`|
| Dealer, custody and customer privacy |9 PASS|`/private/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/atlas-staff-db-LstbLV`|

Each fixture applies the complete95/52 source chain, verifies every successful ledger checksum and performs both second-deploy no-ops. All three final inventories still match source. The first95 public/48 staff migration files independently remain byte-identical to HEAD.

The upgrade validator is byte-identical to the earlier PG15 validator (`797bcad05874c17a4604108dad88200d640b67473cba4444e3a33267d69b79dc`). Its original customer/staff sessions and all serving roles are created before48 is snapshotted; no serving regrant follows49. All238 old tables, including18 populated tables, retain content and xmin/ctid hashes. Original ledgers, table/column/schema ACLs, role memberships, gateway OID/body/owner/security/settings and transferred customer EXECUTE privileges survive. The original sessions, no-email profile and saved submissions/cards/request reads, exact submit and staff-event retries pass; foreign/changed requests and direct/internal/private access are denied. New controls stay absent/false; the separately provisioned private login has only its exact one-function boundary. A new legacy-format submission and retry also work without altering the old immutable events.

Private commerce verifies the shipping correction against actual SQL: exact measured card count, original weight, ship date and sourced measurement are bound; invalid/expired plans are omitted and forged requests/snapshots refused. Restricted roles, ownership, stored money/photo/profile/provider evidence, customer DTO allowlists, UNKNOWN attempt identity, once-only paid order/effects and historical paid recovery with providers disabled all pass. These are synthetic provider stubs; no charge, carrier purchase or notification was issued.

Dealer acceptance verifies actual fixture staff session/reviewer/grant authority, separate dealer login/membership/browser/location scope, exact500 cents per full-price kiosk card with tax excluded and shipping zero, owned history/cursor, first custody transition/NULL handling, exact event ordering/retries, receipt/current-manual-card authority, scoped tracking, and membership/CSRF/logout/grant revocation. Intake create/read/list/card/verify/correct/review and customer checkout/quote/order projections omit device/dealer bindings while the stored location snapshot retains every exact binding.

Canonical50 is frozen at `9c1363b8b02d1188d5e9c2340be6624a58ee8137ebed9e9a9f5d07ff648aa47e`; the manifest binds all49–52 hashes and the harness/validator/commerce source hashes. Earlier PG15 receipts remain historical evidence for their original50 bytes.

## Isolation and cleanup

The explicit `--ack-disposable-remote-pg17` mode is confined to `root@104.131.27.245` and the pinned image above. It creates one fresh nonce-owned container with `--pull=never`, read-only root, owned tmpfs only, fresh loopback publication/SSH tunnel,2GiB memory/swap ceiling,2CPU/256PID,64MiB shared memory, no restart and bounded1MiB logs. No host directory, existing volume, production environment or external provider is used. A local0600 synthetic environment file is streamed over encrypted SSH stdin and removed after create; no remote credential file is written. SSH alone retains the existing authorized agent-socket reference. The application/database subprocess environment remains clean.

The captured immutable ID/image/name/nonce, mounts, network, resources, restart and capability settings are checked before start and again before stop/removal. Only that owned container and the captured SSH child are removed. Eight Node20 guard tests pass, including arbitrary command/existing-ID refusal and literal SSH argument quoting. The first attempt failed at read-only port preflight because SSH_AUTH_SOCK was absent; it created no container and its evidence is retained as `atlas-staff-db-P2xEs2`.

Final09:20:54UTC readback independently confirms all three captured IDs absent and zero running disposable PostgreSQL label containers. Existing serving container `c302eeb7c4036c42049b3ed96f8d88d30afa6f058d7156e69b03fe60ae866b63` remains running on image `857ec5612661921cb235013d81a1b2793615ebb2c2f987b661275efdd646f94a`, with unchanged start03:44:03.657738463Z and restart count0. Host capacity is6,616,346,624 bytes available RAM and51,836,571,648 bytes available root disk. This is read-only container/OS metadata, not a production DB census. No existing service, image, cache, volume or user file was removed.

## Reproduction

Use the existing local Node20/Prisma/pg dependencies and one of the three validator scripts under `frontend/atlas-customer/scripts`, with:

```text
--ack-disposable-local-postgres --ack-disposable-remote-pg17
--docker-image sha256:a2ea0e68c465e0acf4c3672471b22b6b62972bb341e6f31544c855d85ba43745
--pg-module <existing local pg module path>
```

The original local acknowledgement is retained by the common harness; the additional remote acknowledgement explicitly selects this finite SSH fixture. Record a new planned session-log action before creating another container. No additional fixture or production operation is implied by this completed receipt.
