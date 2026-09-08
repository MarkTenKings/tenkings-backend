\set ON_ERROR_STOP on
-- Post-upgrade checks and simulated DB continuation remain rollback-only.
BEGIN;
CREATE FUNCTION pg_temp.vault_upgrade_reject(statement TEXT) RETURNS void AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected legacy upgrade safety rejection';
END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF (SELECT "initialCommandTerminalAt" FROM "VaultSaleItem" WHERE "id"='vault-upgrade-paid-1') IS DISTINCT FROM TIMESTAMP '2026-09-07 00:02:01' THEN RAISE EXCEPTION 'Accepted legacy receipt was not recovered exactly'; END IF;
  IF (SELECT "initialCommandTerminalAt" FROM "VaultSaleItem" WHERE "id"='vault-upgrade-paid-2') IS DISTINCT FROM TIMESTAMP '2026-09-07 00:02:02' THEN RAISE EXCEPTION 'Completed legacy unknown receipt was not recovered exactly'; END IF;
  IF (SELECT "retryCommandTerminalAt" FROM "VaultSaleItem" WHERE "id"='vault-upgrade-paid-9') IS DISTINCT FROM TIMESTAMP '2026-09-07 00:02:19' THEN RAISE EXCEPTION 'Historical retry receipt was not recovered exactly'; END IF;
  IF EXISTS (SELECT 1 FROM "VaultSaleItem" WHERE "id" IN ('vault-upgrade-paid-3','vault-upgrade-paid-4','vault-upgrade-paid-5','vault-upgrade-paid-6','vault-upgrade-paid-7','vault-upgrade-paid-8','vault-upgrade-paid-10') AND "initialCommandTerminalAt" IS NOT NULL) THEN RAISE EXCEPTION 'In-flight, malformed or mismatched legacy evidence gained terminal authority'; END IF;
  IF (SELECT "commandTerminalAt" FROM "VaultRestockItem" WHERE "id"='vault-upgrade-restock-door-1') IS DISTINCT FROM TIMESTAMP '2026-09-07 00:02:11' THEN RAISE EXCEPTION 'Previously reviewed restock receipt was not recovered'; END IF;
  IF (SELECT "commandTerminalAt" FROM "VaultRestockItem" WHERE "id"='vault-upgrade-restock-door-2') IS DISTINCT FROM TIMESTAMP '2026-09-07 00:02:12' THEN RAISE EXCEPTION 'Completed unknown restock receipt was not recovered'; END IF;
  IF (SELECT "commandTerminalAt" FROM "VaultRestockItem" WHERE "id"='vault-upgrade-restock-door-3') IS NOT NULL THEN RAISE EXCEPTION 'In-flight restock was falsely completed'; END IF;
  IF (SELECT "canonicalPayload"::TEXT FROM "VaultConfigVersion" WHERE "id"='vault-upgrade-config') <> '{}' OR EXISTS (SELECT 1 FROM "VaultSaleItem" WHERE "id" LIKE 'vault-upgrade-paid-%' AND ("mappingVersionSnapshot" <> '1' OR "controllerEndpointIdSnapshot" <> 'legacy' OR "doorLabelSnapshot" IS NOT NULL)) THEN RAISE EXCEPTION 'Legacy profile or snapshot bytes were rewritten'; END IF;
END $$;

-- An already-active paid sale can consume its one retry and finish using
-- new exact terminal evidence while the original command remains immutable.
UPDATE "VaultSaleItem" SET "retryCommandId"='vault-upgrade-continuation-retry',"retryCommandState"='COMMAND_INTENT_RECORDED',"retryUsedAt"='2026-09-08T00:00:00Z' WHERE "id"='vault-upgrade-paid-1' AND "initialCommandTerminalAt" IS NOT NULL AND "retryCommandId" IS NULL;
INSERT INTO "VaultMachineEvent" ("id","machineId","eventId","sequence","schemaVersion","type","mode","correlationId","occurredAt","payload","payloadDigest") VALUES
 ('vault-upgrade-continuation-event','vault-upgrade-machine','vault-upgrade-continuation-event',200,1,'CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-1','2026-09-08T00:00:01Z','{"commandId":"vault-upgrade-continuation-retry","expectedDoorId":"X-01","observedDoorId":"X-01","outcome":"ACCEPTED","controllerSequence":200,"evidenceCode":null}',repeat('c',64));
UPDATE "VaultSaleItem" SET "retryCommandState"='ACCEPTED',"retryCommandTerminalAt"='2026-09-08T00:00:01Z',"fulfillmentState"='COMMANDS_TERMINAL' WHERE "id"='vault-upgrade-paid-1' AND "retryCommandId"='vault-upgrade-continuation-retry';
SELECT pg_temp.vault_upgrade_reject($q$UPDATE "VaultSaleItem" SET "initialCommandTerminalAt"=now() WHERE "id"='vault-upgrade-paid-1'$q$);
SELECT pg_temp.vault_upgrade_reject($q$UPDATE "VaultSaleItem" SET "retryCommandId"='second-retry' WHERE "id"='vault-upgrade-paid-1'$q$);

-- The active restock remains incomplete until the previously in-flight third
-- command receives a new terminal receipt and every saved door is reviewed.
SELECT pg_temp.vault_upgrade_reject($q$UPDATE "VaultRestockSession" SET "state"='FINALIZED',"leftEmptyCount"=3,"physicalCloseConfirmedAt"=now(),"finalizedAt"=now() WHERE "id"='vault-upgrade-restock'$q$);
INSERT INTO "VaultMachineEvent" ("id","machineId","eventId","sequence","schemaVersion","type","mode","occurredAt","payload","payloadDigest") VALUES
 ('vault-upgrade-restock-continuation-event','vault-upgrade-machine','vault-upgrade-restock-continuation-event',201,1,'CONTROLLER_COMMAND_TERMINAL','PRODUCTION','2026-09-08T00:00:02Z','{"commandId":"vault-upgrade-restock-command-3","expectedDoorId":"X-03","observedDoorId":"X-03","outcome":"ACCEPTED","controllerSequence":201,"evidenceCode":null}',repeat('d',64));
UPDATE "VaultRestockItem" SET "commandState"='ACCEPTED',"commandTerminalAt"='2026-09-08T00:00:02Z' WHERE "id"='vault-upgrade-restock-door-3' AND "commandTerminalAt" IS NULL;
UPDATE "VaultRestockItem" SET "state"='LEFT_EMPTY',"reviewedAt"='2026-09-08T00:00:03Z',"evidence"='{"notes":"Disposable continuation observation"}' WHERE "restockSessionId"='vault-upgrade-restock' AND "state"='UNREVIEWED' AND "commandTerminalAt" IS NOT NULL;
UPDATE "VaultRestockSession" SET "state"='FINALIZED',"leftEmptyCount"=3,"physicalCloseConfirmedAt"='2026-09-08T00:00:04Z',"finalizedAt"='2026-09-08T00:00:04Z' WHERE "id"='vault-upgrade-restock';
DO $$ BEGIN
  IF (SELECT "fulfillmentState" FROM "VaultSaleItem" WHERE "id"='vault-upgrade-paid-1') <> 'COMMANDS_TERMINAL' THEN RAISE EXCEPTION 'Active legacy sale could not complete its retry'; END IF;
  IF (SELECT "state" FROM "VaultRestockSession" WHERE "id"='vault-upgrade-restock') <> 'FINALIZED' THEN RAISE EXCEPTION 'Active legacy restock could not finalize'; END IF;
END $$;
ROLLBACK;
SELECT 'VAULT_LEGACY_PROFILE_UPGRADE_VALIDATION_PASS';
