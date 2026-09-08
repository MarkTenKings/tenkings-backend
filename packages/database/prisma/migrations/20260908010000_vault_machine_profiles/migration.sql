-- Additive Vault profile/history support. Existing v1 payloads and historical
-- addresses remain unchanged. This source is applied only by the guarded
-- disposable harness until separately authorized deployment.
ALTER TABLE "VaultMachine" ADD COLUMN "draftMachineProfile" JSONB, ADD COLUMN "draftDoorMapping" JSONB;
ALTER TABLE "VaultMachine" DROP CONSTRAINT "VaultMachine_door_counts_check";
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_door_counts_check" CHECK ("availableDoorCount" BETWEEN 0 AND 256 AND "outboxPendingCount" >= 0);
ALTER TABLE "VaultDoor" ADD COLUMN "controllerEndpointId" TEXT NOT NULL DEFAULT 'legacy', ADD COLUMN "doorLabel" TEXT, ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "VaultSaleItem" ADD COLUMN "controllerEndpointIdSnapshot" TEXT NOT NULL DEFAULT 'legacy', ADD COLUMN "doorLabelSnapshot" TEXT,
  ADD COLUMN "initialCommandTerminalAt" TIMESTAMP(3), ADD COLUMN "retryCommandTerminalAt" TIMESTAMP(3);
ALTER TABLE "VaultRestockItem" ADD COLUMN "doorLabelSnapshot" TEXT, ADD COLUMN "mappingSnapshot" JSONB, ADD COLUMN "commandTerminalAt" TIMESTAMP(3);

DROP INDEX "VaultDoor_machineId_controllerChannel_key";
CREATE INDEX "VaultDoor_machineId_controllerEndpointId_controllerChannel_idx" ON "VaultDoor"("machineId", "controllerEndpointId", "controllerChannel");
CREATE UNIQUE INDEX "VaultDoor_active_endpoint_channel_key" ON "VaultDoor"("machineId", "controllerEndpointId", "controllerChannel") WHERE "retiredAt" IS NULL;
ALTER TABLE "VaultDoor" DROP CONSTRAINT "VaultDoor_id_check", DROP CONSTRAINT "VaultDoor_channel_check";
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_id_check" CHECK ("doorId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("doorId") NOT IN ('constructor','prototype','__proto__')),
  ADD CONSTRAINT "VaultDoor_channel_check" CHECK ("controllerChannel" BETWEEN 1 AND 256 AND "controllerEndpointId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
ALTER TABLE "VaultSale" DROP CONSTRAINT "VaultSale_count_check";
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_count_check" CHECK ("itemCount" BETWEEN 1 AND 256 AND "stateVersion" > 0 AND "configVersionNumber" > 0);
ALTER TABLE "VaultSaleItem" DROP CONSTRAINT "VaultSaleItem_door_check", DROP CONSTRAINT "VaultSaleItem_mapping_check";
ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_door_check" CHECK ("doorId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("doorId") NOT IN ('constructor','prototype','__proto__')),
  ADD CONSTRAINT "VaultSaleItem_mapping_check" CHECK ("controllerChannelSnapshot" BETWEEN 1 AND 256 AND "controllerEndpointIdSnapshot" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND "mappingVersionSnapshot" ~ '^[1-9][0-9]*$');
ALTER TABLE "VaultRestockSession" DROP CONSTRAINT "VaultRestockSession_counts_check";
ALTER TABLE "VaultRestockSession" ADD CONSTRAINT "VaultRestockSession_counts_check" CHECK ("expectedDoorCount" BETWEEN 1 AND 256 AND "filledCount" >= 0 AND "leftEmptyCount" >= 0 AND "exceptionCount" >= 0 AND "filledCount" + "leftEmptyCount" + "exceptionCount" <= "expectedDoorCount");
ALTER TABLE "VaultRestockItem" DROP CONSTRAINT "VaultRestockItem_door_check";
ALTER TABLE "VaultRestockItem" ADD CONSTRAINT "VaultRestockItem_door_check" CHECK ("doorId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("doorId") NOT IN ('constructor','prototype','__proto__'));
ALTER TABLE "VaultCertificationEvidence" DROP CONSTRAINT "VaultCertificationEvidence_door_check";
ALTER TABLE "VaultCertificationEvidence" ADD CONSTRAINT "VaultCertificationEvidence_door_check" CHECK ("doorId" IS NULL OR ("doorId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("doorId") NOT IN ('constructor','prototype','__proto__')));

CREATE FUNCTION "vault_v1_protect_door_identity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault door history is retained'; END IF;
  IF ROW(NEW."id",NEW."machineId",NEW."doorId",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."machineId",OLD."doorId",OLD."createdAt") THEN RAISE EXCEPTION 'Vault stable door identity is immutable'; END IF;
  IF ROW(NEW."controllerEndpointId",NEW."controllerChannel",NEW."retiredAt") IS DISTINCT FROM ROW(OLD."controllerEndpointId",OLD."controllerChannel",OLD."retiredAt")
    AND (OLD."state" NOT IN ('EMPTY','DISABLED') OR OLD."activeProductId" IS NOT NULL OR OLD."owningSaleId" IS NOT NULL OR OLD."owningRestockId" IS NOT NULL) THEN RAISE EXCEPTION 'Reconcile stocked or owned doors before physical reconfiguration'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultDoor_protect_identity" BEFORE UPDATE OR DELETE ON "VaultDoor" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_door_identity"();

CREATE OR REPLACE FUNCTION "vault_v1_protect_sale_item"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault sale items are retained'; END IF;
  IF (to_jsonb(NEW) - ARRAY['allocationState','fulfillmentState','initialCommandId','initialCommandState','initialCommandTerminalAt','retryCommandId','retryCommandState','retryCommandTerminalAt','retryUsedAt','supportReason','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['allocationState','fulfillmentState','initialCommandId','initialCommandState','initialCommandTerminalAt','retryCommandId','retryCommandState','retryCommandTerminalAt','retryUsedAt','supportReason','updatedAt'])
     OR (OLD."initialCommandId" IS NOT NULL AND NEW."initialCommandId" IS DISTINCT FROM OLD."initialCommandId")
     OR (OLD."retryCommandId" IS NOT NULL AND NEW."retryCommandId" IS DISTINCT FROM OLD."retryCommandId")
     OR (OLD."retryUsedAt" IS NOT NULL AND NEW."retryUsedAt" IS DISTINCT FROM OLD."retryUsedAt")
     OR (OLD."initialCommandTerminalAt" IS NOT NULL AND ROW(NEW."initialCommandTerminalAt",NEW."initialCommandState") IS DISTINCT FROM ROW(OLD."initialCommandTerminalAt",OLD."initialCommandState"))
     OR (OLD."retryCommandTerminalAt" IS NOT NULL AND ROW(NEW."retryCommandTerminalAt",NEW."retryCommandState") IS DISTINCT FROM ROW(OLD."retryCommandTerminalAt",OLD."retryCommandState")) THEN
    RAISE EXCEPTION 'Vault paid snapshots and command entitlements are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recover finality for existing v1 work only from its immutable completed
-- command observations. SENT_UNKNOWN by itself also describes an in-flight
-- dispatch and is never enough. Conflicting or incomplete facts remain null.
CREATE FUNCTION "vault_v1_legacy_terminal_time"(expected_machine TEXT, expected_mode "VaultMode", expected_sale TEXT, expected_door TEXT, expected_command TEXT, expected_state TEXT)
RETURNS TIMESTAMP(3) AS $$
  SELECT CASE WHEN count(*) > 0 AND bool_and(COALESCE(
    e."schemaVersion" = 1 AND e."correlationId" IS NOT DISTINCT FROM expected_sale
    AND CASE WHEN e."type" = 'CONTROLLER_EFFECT_REMAINS_UNKNOWN' THEN
      expected_state = 'SENT_UNKNOWN' AND jsonb_typeof(e."payload"->'errorClass') = 'string'
    ELSE
      e."payload"->>'expectedDoorId' = expected_door
      AND e."payload"->>'outcome' = expected_state
      AND expected_state IN ('ACCEPTED','SENT_UNKNOWN','REJECTED','TIMEOUT')
      AND (e."payload"->>'controllerSequence') ~ '^[1-9][0-9]*$'
    END, false
  )) THEN min(e."occurredAt") ELSE NULL END
  FROM "VaultMachineEvent" e
  WHERE e."machineId" = expected_machine AND e."mode" = expected_mode
    AND e."payload"->>'commandId' = expected_command
    AND e."type" IN ('CONTROLLER_COMMAND_TERMINAL','CRITICAL_WRONG_DOOR_OBSERVED','CONTROLLER_EFFECT_REMAINS_UNKNOWN');
$$ LANGUAGE sql STABLE;

UPDATE "VaultSaleItem" saved SET "initialCommandTerminalAt" = proof."terminalAt"
FROM (
  SELECT saved."id", "vault_v1_legacy_terminal_time"(sale."machineId",sale."mode",sale."id",saved."doorId",saved."initialCommandId",saved."initialCommandState"::TEXT) AS "terminalAt"
  FROM "VaultSaleItem" saved JOIN "VaultSale" sale ON sale."id" = saved."saleId"
  WHERE saved."initialCommandId" IS NOT NULL AND saved."initialCommandTerminalAt" IS NULL
) proof WHERE saved."id" = proof."id" AND proof."terminalAt" IS NOT NULL;
UPDATE "VaultSaleItem" saved SET "retryCommandTerminalAt" = proof."terminalAt"
FROM (
  SELECT saved."id", "vault_v1_legacy_terminal_time"(sale."machineId",sale."mode",sale."id",saved."doorId",saved."retryCommandId",saved."retryCommandState"::TEXT) AS "terminalAt"
  FROM "VaultSaleItem" saved JOIN "VaultSale" sale ON sale."id" = saved."saleId"
  WHERE saved."retryCommandId" IS NOT NULL AND saved."retryCommandTerminalAt" IS NULL
) proof WHERE saved."id" = proof."id" AND proof."terminalAt" IS NOT NULL;
UPDATE "VaultRestockItem" saved SET "commandTerminalAt" = proof."terminalAt"
FROM (
  SELECT saved."id", "vault_v1_legacy_terminal_time"(session."machineId",session."mode",NULL,saved."doorId",saved."commandId",saved."commandState"::TEXT) AS "terminalAt"
  FROM "VaultRestockItem" saved JOIN "VaultRestockSession" session ON session."id" = saved."restockSessionId"
  WHERE saved."commandId" IS NOT NULL AND saved."commandTerminalAt" IS NULL
) proof WHERE saved."id" = proof."id" AND proof."terminalAt" IS NOT NULL;
DROP FUNCTION "vault_v1_legacy_terminal_time"(TEXT,"VaultMode",TEXT,TEXT,TEXT,TEXT);

CREATE FUNCTION "vault_v1_protect_restock_snapshot"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault restock history is retained'; END IF;
  IF (to_jsonb(NEW) - ARRAY['state','actorUserId','actorRole','actorGrantVersion','filledCount','leftEmptyCount','exceptionCount','shortageSummary','physicalCloseConfirmedAt','finalizedAt','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','actorUserId','actorRole','actorGrantVersion','filledCount','leftEmptyCount','exceptionCount','shortageSummary','physicalCloseConfirmedAt','finalizedAt','updatedAt']) THEN RAISE EXCEPTION 'Vault restock configuration and membership snapshots are immutable'; END IF;
  IF OLD."state" <> 'ACTIVE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Final Vault restock is immutable'; END IF;
  IF NEW."state" = 'FINALIZED' AND (NEW."physicalCloseConfirmedAt" IS NULL OR NEW."finalizedAt" IS NULL
    OR (SELECT count(*) FROM "VaultRestockItem" i WHERE i."restockSessionId"=NEW."id") <> NEW."expectedDoorCount"
    OR EXISTS (SELECT 1 FROM "VaultRestockItem" i WHERE i."restockSessionId"=NEW."id" AND (i."state"='UNREVIEWED' OR i."commandTerminalAt" IS NULL))
    OR (SELECT count(*) FROM "VaultRestockItem" i WHERE i."restockSessionId"=NEW."id" AND i."state"='FILLED') <> NEW."filledCount"
    OR (SELECT count(*) FROM "VaultRestockItem" i WHERE i."restockSessionId"=NEW."id" AND i."state"='LEFT_EMPTY') <> NEW."leftEmptyCount"
    OR (SELECT count(*) FROM "VaultRestockItem" i WHERE i."restockSessionId"=NEW."id" AND i."state"='EXCEPTION') <> NEW."exceptionCount") THEN RAISE EXCEPTION 'Vault restock finalization requires exact persisted terminal observations'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultRestockSession_protect_snapshot" BEFORE UPDATE OR DELETE ON "VaultRestockSession" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_restock_snapshot"();

CREATE FUNCTION "vault_v1_protect_restock_item"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault restock observations are retained'; END IF;
  IF (to_jsonb(NEW) - ARRAY['state','commandId','commandState','commandTerminalAt','evidence','reviewedAt','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','commandId','commandState','commandTerminalAt','evidence','reviewedAt','updatedAt'])
     OR (OLD."commandId" IS NOT NULL AND NEW."commandId" IS DISTINCT FROM OLD."commandId")
     OR (OLD."commandTerminalAt" IS NOT NULL AND ROW(NEW."commandTerminalAt",NEW."commandState") IS DISTINCT FROM ROW(OLD."commandTerminalAt",OLD."commandState"))
     OR (OLD."state" <> 'UNREVIEWED' AND (to_jsonb(NEW) - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt')) THEN RAISE EXCEPTION 'Vault restock snapshots and completed observations are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultRestockItem_protect_snapshot" BEFORE UPDATE OR DELETE ON "VaultRestockItem" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_restock_item"();

CREATE FUNCTION "vault_v1_check_item_scope"() RETURNS trigger AS $$
DECLARE owner_machine TEXT; pinned_config JSONB; mapping JSONB; expected_label TEXT;
BEGIN
  IF TG_TABLE_NAME = 'VaultSaleItem' THEN
    SELECT s."machineId", c."canonicalPayload" INTO owner_machine, pinned_config FROM "VaultSale" s JOIN "VaultConfigVersion" c ON c."id" = s."configVersionId" WHERE s."id" = NEW."saleId";
  ELSE
    SELECT s."machineId", c."canonicalPayload" INTO owner_machine, pinned_config FROM "VaultRestockSession" s JOIN "VaultConfigVersion" c ON c."id" = s."configVersionId" WHERE s."id" = NEW."restockSessionId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "VaultDoor" d WHERE d."id" = NEW."doorRecordId" AND d."doorId" = NEW."doorId" AND d."machineId" = owner_machine) THEN RAISE EXCEPTION 'Vault snapshot door must belong to the exact business machine'; END IF;
  IF pinned_config->>'schemaVersion' = '2' THEN
    SELECT value INTO mapping FROM jsonb_array_elements(pinned_config->'doorMapping') WHERE value->>'doorId' = NEW."doorId";
    SELECT value->>'label' INTO expected_label FROM jsonb_array_elements(pinned_config->'machineProfile'->'doors') WHERE value->>'doorId' = NEW."doorId";
    IF mapping IS NULL OR expected_label IS NULL OR NEW."doorLabelSnapshot" IS DISTINCT FROM expected_label THEN RAISE EXCEPTION 'Vault snapshot must pin a member and label of its signed profile'; END IF;
    IF TG_TABLE_NAME = 'VaultSaleItem' THEN
      IF NEW."controllerEndpointIdSnapshot" IS DISTINCT FROM mapping->>'controllerEndpointId' OR NEW."controllerChannelSnapshot" IS DISTINCT FROM (mapping->>'controllerChannel')::integer THEN RAISE EXCEPTION 'Vault sale address must match its pinned profile'; END IF;
    ELSE
      IF NEW."mappingSnapshot" IS DISTINCT FROM mapping THEN RAISE EXCEPTION 'Vault restock address must match its pinned profile'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultSaleItem_validate_scope" BEFORE INSERT OR UPDATE ON "VaultSaleItem" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_item_scope"();
CREATE TRIGGER "VaultRestockItem_validate_scope" BEFORE INSERT OR UPDATE ON "VaultRestockItem" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_item_scope"();

CREATE FUNCTION "vault_v1_check_certification_scope"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "VaultConfigVersion" c WHERE c."id" = NEW."configVersionId" AND c."machineId" = NEW."machineId") THEN RAISE EXCEPTION 'Vault certification config must belong to its machine'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultCertificationSession_check_scope" BEFORE INSERT OR UPDATE ON "VaultCertificationSession" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_certification_scope"();

CREATE FUNCTION "vault_v1_check_certification_member"() RETURNS trigger AS $$
DECLARE pinned_config JSONB; parent_status "VaultCertificationStatus";
BEGIN
  SELECT c."canonicalPayload", s."status" INTO pinned_config,parent_status FROM "VaultCertificationSession" s JOIN "VaultConfigVersion" c ON c."id"=s."configVersionId" WHERE s."id"=NEW."certificationId";
  IF parent_status <> 'ACTIVE' THEN RAISE EXCEPTION 'New Vault observations require an active certification'; END IF;
  IF pinned_config->>'schemaVersion'='2' AND NEW."doorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pinned_config->'machineProfile'->'doors') d WHERE d->>'doorId'=NEW."doorId") THEN RAISE EXCEPTION 'Vault certification observation must belong to its pinned profile'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultCertificationEvidence_check_member" BEFORE INSERT ON "VaultCertificationEvidence" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_certification_member"();
