\set ON_ERROR_STOP on
-- The guarded disposable harness runs this before the profile migration.
-- These structural legacy fixtures intentionally have no executable signed config.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='VaultSaleItem' AND column_name='initialCommandTerminalAt') THEN RAISE EXCEPTION 'Legacy upgrade fixture must precede the profile migration'; END IF;
END $$;
INSERT INTO "VaultMachine" ("id","slug","serialNumber","displayName","timezone","city","state","taxRateBasisPoints","updatedAt") VALUES
 ('vault-upgrade-machine','vault-upgrade-machine','vault-upgrade-serial','Disposable legacy Vault','America/Los_Angeles','Test','CA',825,now()),
 ('vault-upgrade-other','vault-upgrade-other','vault-upgrade-other-serial','Other disposable legacy Vault','America/Los_Angeles','Test','CA',825,now());
INSERT INTO "VaultConfigVersion" ("id","machineId","version","canonicalPayload","digest","minimumAppVersion","createdByAdminId","expiresAt") VALUES
 ('vault-upgrade-config','vault-upgrade-machine',1,'{}',repeat('a',64),'0.1.0','disposable-actor','2027-09-07T00:00:00Z');
INSERT INTO "VaultDoor" ("id","machineId","doorId","controllerChannel","updatedAt")
 SELECT 'vault-upgrade-door-'||n,'vault-upgrade-machine','X-'||lpad(n::TEXT,2,'0'),n,now() FROM generate_series(1,3) n;
INSERT INTO "VaultSale" ("id","machineId","localTransactionId","supportReference","mode","state","paymentState","fulfillmentState","configVersionId","configVersionNumber","configDigest","machineTimezone","taxCity","taxState","taxRateBasisPoints","taxCalculationVersion","subtotalCents","taxCents","totalCents","itemCount","authorizationObservedAt","updatedAt")
 SELECT 'vault-upgrade-sale-'||n,'vault-upgrade-machine','vault-upgrade-sale-'||n,'UPG'||lpad(n::TEXT,5,'0'),'PRODUCTION','OPEN_COMMAND_PENDING','AUTHORIZED','COMMANDS_PENDING','vault-upgrade-config',1,repeat('a',64),'America/Los_Angeles','Test','CA',825,'half-up-subtotal-bps-v1',2500,206,2706,1,'2026-09-07T00:00:00Z',now() FROM generate_series(1,10) n;
INSERT INTO "VaultSaleItem" ("id","saleId","lineId","doorRecordId","doorId","productIdSnapshot","productNameSnapshot","photoUrlSnapshot","descriptionSnapshot","categorySnapshot","priceCentsSnapshot","taxClassSnapshot","controllerChannelSnapshot","mappingVersionSnapshot","taxRateBasisPoints","taxCentsSnapshot","allocationState","fulfillmentState","initialCommandId","initialCommandState","retryCommandId","retryCommandState","retryUsedAt","updatedAt")
 SELECT 'vault-upgrade-paid-'||n,'vault-upgrade-sale-'||n,'vault-upgrade-line-'||n,'vault-upgrade-door-1','X-01','vault-upgrade-product','Legacy pack','https://example.test/pack.png','Disposable fixture','SPORTS',2500,'GENERAL',1,'1',825,206,'COMMITTED_SOLD','COMMANDS_PENDING','vault-upgrade-command-'||n,
   CASE WHEN n IN (2,3) THEN 'SENT_UNKNOWN' ELSE 'ACCEPTED' END::"VaultCommandState",
   CASE WHEN n=9 THEN 'vault-upgrade-retry-9' ELSE NULL END,
   CASE WHEN n=9 THEN 'ACCEPTED' ELSE 'NOT_COMMITTED' END::"VaultCommandState",
   CASE WHEN n=9 THEN TIMESTAMP '2026-09-07 00:01:00' ELSE NULL END,now()
 FROM generate_series(1,10) n;
INSERT INTO "VaultRestockSession" ("id","machineId","localSessionId","configVersionId","mode","expectedDoorCount","updatedAt") VALUES
 ('vault-upgrade-restock','vault-upgrade-machine','vault-upgrade-restock','vault-upgrade-config','PRODUCTION',3,now());
INSERT INTO "VaultRestockItem" ("id","restockSessionId","doorRecordId","doorId","plannedProductId","state","commandId","commandState","reviewedAt","updatedAt")
 SELECT 'vault-upgrade-restock-door-'||n,'vault-upgrade-restock','vault-upgrade-door-'||n,'X-'||lpad(n::TEXT,2,'0'),NULL,
   CASE WHEN n=1 THEN 'LEFT_EMPTY' ELSE 'UNREVIEWED' END::"VaultRestockItemState",'vault-upgrade-restock-command-'||n,
   CASE WHEN n=1 THEN 'ACCEPTED' ELSE 'SENT_UNKNOWN' END::"VaultCommandState",
   CASE WHEN n=1 THEN TIMESTAMP '2026-09-07 00:03:00' ELSE NULL END,now()
 FROM generate_series(1,3) n;

-- Valid receipts, terminal unknown, in-flight dispatch, and deliberately
-- mismatched machine/mode/sale/door/state/malformed evidence all coexist.
INSERT INTO "VaultMachineEvent" ("id","machineId","eventId","sequence","schemaVersion","type","mode","correlationId","occurredAt","payload","payloadDigest")
SELECT 'vault-upgrade-event-'||n,machine,'vault-upgrade-event-'||n,n,1,event_type,event_mode::"VaultMode",sale,
 TIMESTAMP '2026-09-07 00:02:00' + n * INTERVAL '1 second',
 CASE WHEN event_type='CONTROLLER_EFFECT_REMAINS_UNKNOWN' THEN jsonb_build_object('commandId',command,'errorClass','SERVICE_RESTART')
      WHEN event_type='CONTROLLER_DISPATCH_BOUNDARY_ENTERED' THEN jsonb_build_object('commandId',command,'doorId',door,'attempt',1,'authority','RESTOCK')
      ELSE jsonb_build_object('commandId',command,'expectedDoorId',door,'observedDoorId',door,'outcome',outcome,'controllerSequence',CASE WHEN n=20 THEN NULL ELSE n END,'evidenceCode',NULL) END,
 repeat('b',64)
FROM (VALUES
 (1,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-1','vault-upgrade-command-1','X-01','ACCEPTED'),
 (2,'vault-upgrade-machine','CONTROLLER_EFFECT_REMAINS_UNKNOWN','PRODUCTION','vault-upgrade-sale-2','vault-upgrade-command-2','X-01','SENT_UNKNOWN'),
 (3,'vault-upgrade-machine','CONTROLLER_DISPATCH_BOUNDARY_ENTERED','PRODUCTION','vault-upgrade-sale-3','vault-upgrade-command-3','X-01','SENT_UNKNOWN'),
 (4,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','CERTIFICATION','vault-upgrade-sale-4','vault-upgrade-command-4','X-01','ACCEPTED'),
 (5,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-1','vault-upgrade-command-5','X-01','ACCEPTED'),
 (6,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-6','vault-upgrade-command-6','X-01','ACCEPTED'),
 (7,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-7','vault-upgrade-command-7','X-02','ACCEPTED'),
 (8,'vault-upgrade-other','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-8','vault-upgrade-command-8','X-01','ACCEPTED'),
 (9,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-9','vault-upgrade-command-9','X-01','ACCEPTED'),
 (10,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-10','vault-upgrade-command-10','X-01','ACCEPTED'),
 (11,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION',NULL,'vault-upgrade-restock-command-1','X-01','ACCEPTED'),
 (12,'vault-upgrade-machine','CONTROLLER_EFFECT_REMAINS_UNKNOWN','PRODUCTION',NULL,'vault-upgrade-restock-command-2','X-02','SENT_UNKNOWN'),
 (13,'vault-upgrade-machine','CONTROLLER_DISPATCH_BOUNDARY_ENTERED','PRODUCTION',NULL,'vault-upgrade-restock-command-3','X-03','SENT_UNKNOWN'),
 (16,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-6','vault-upgrade-command-6','X-01','REJECTED'),
 (19,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-9','vault-upgrade-retry-9','X-01','ACCEPTED'),
 (20,'vault-upgrade-machine','CONTROLLER_COMMAND_TERMINAL','PRODUCTION','vault-upgrade-sale-10','vault-upgrade-command-10','X-01','ACCEPTED')
) proof(n,machine,event_type,event_mode,sale,command,door,outcome);
COMMIT;
SELECT 'VAULT_LEGACY_PROFILE_UPGRADE_SEED_PASS';
