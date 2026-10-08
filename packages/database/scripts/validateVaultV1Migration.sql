\set ON_ERROR_STOP on
-- Executed only by the explicitly acknowledged disposable localhost harness.
-- No durable fixture survives: all DDL helpers and data below are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.vault_expect_rejection(statement text, expected text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Unexpected rejection: %, expected %', SQLERRM, expected;
  END;
  RAISE EXCEPTION 'Vault invariant failed: statement was accepted: %', statement;
END;
$$ LANGUAGE plpgsql;

INSERT INTO "VaultMachine" ("id","slug","serialNumber","displayName","timezone","city","state","taxRateBasisPoints","updatedAt") VALUES
 ('vault-fixture-machine','vault-fixture-machine','vault-fixture-serial','Disposable Vault','America/Los_Angeles','Test','CA',825,now()),
 ('vault-fixture-other','vault-fixture-other','vault-fixture-other-serial','Other disposable Vault','America/Los_Angeles','Test','CA',825,now());
INSERT INTO "VaultConfigVersion" ("id","machineId","version","canonicalPayload","digest","minimumAppVersion","createdByAdminId","expiresAt") VALUES
 ('vault-fixture-config','vault-fixture-machine',1,'{}',repeat('a',64),'0.1.0','disposable-actor',now()+interval '1 day'),
 ('vault-fixture-other-config','vault-fixture-other',1,'{}',repeat('b',64),'0.1.0','disposable-actor',now()+interval '1 day');
UPDATE "VaultConfigVersion" SET "status"='VALIDATED' WHERE "id"='vault-fixture-config';
UPDATE "VaultConfigVersion" SET "status"='PUBLISHED',"signingKeyId"='disposable-key',"signingAlgorithm"='Ed25519',"detachedSignature"='disposable-only',"publishedAt"=now() WHERE "id"='vault-fixture-config';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultConfigVersion" SET "canonicalPayload"='{"changed":true}' WHERE "id"='vault-fixture-config'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultConfigVersion" SET "status"='VALIDATED' WHERE "id"='vault-fixture-config'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultConfigVersion" WHERE "id"='vault-fixture-config'$q$, 'immutable');
UPDATE "VaultConfigVersion" SET "status"='SUPERSEDED' WHERE "id"='vault-fixture-config';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultConfigVersion" SET "status"='PUBLISHED' WHERE "id"='vault-fixture-config'$q$, 'immutable');
UPDATE "VaultConfigVersion" SET "status"='REVOKED' WHERE "id"='vault-fixture-config';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultConfigVersion" SET "status"='SUPERSEDED' WHERE "id"='vault-fixture-config'$q$, 'immutable');

INSERT INTO "VaultDoor" ("id","machineId","doorId","controllerChannel","updatedAt")
 SELECT 'vault-fixture-door-'||c.n||'-'||r.n,'vault-fixture-machine',c.letter||'-'||lpad(r.n::text,2,'0'),(c.n-1)*25+r.n,now()
 FROM (VALUES (1,'X'),(2,'K'),(3,'I'),(4,'N'),(5,'G'),(6,'S')) c(n,letter) CROSS JOIN generate_series(1,25) r(n);
DO $$ BEGIN
 IF (SELECT count(*) FROM "VaultDoor" WHERE "machineId"='vault-fixture-machine') <> 150 THEN RAISE EXCEPTION 'Canonical door fixture is incomplete'; END IF;
END $$;
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultDoor" ("id","machineId","doorId","controllerChannel","updatedAt") VALUES ('invalid-door','vault-fixture-other','bad/door',1,now())$q$, 'VaultDoor_id_check');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultDoor" SET "controllerChannel"=257 WHERE "id"='vault-fixture-door-1-1'$q$, 'VaultDoor_channel_check');

INSERT INTO "VaultCertificationSession" ("id","machineId","localSessionId","status","configVersionId","appBuild","sourceCommit","localSchemaVersion","contractVersion","updatedAt") VALUES
 ('vault-fixture-certification','vault-fixture-machine','vault-fixture-local-cert','ACTIVE','vault-fixture-config','0.1.0',repeat('c',40),2,1,now());
INSERT INTO "VaultSale" ("id","machineId","localTransactionId","supportReference","mode","state","paymentState","configVersionId","configVersionNumber","configDigest","machineTimezone","taxCity","taxState","taxRateBasisPoints","taxCalculationVersion","subtotalCents","taxCents","totalCents","itemCount","updatedAt") VALUES
 ('vault-fixture-sale','vault-fixture-machine','vault-fixture-local-sale','TEST0001','PRODUCTION','RESERVED','NOT_REQUESTED','vault-fixture-config',1,repeat('a',64),'America/Los_Angeles','Test','CA',825,'half-up-subtotal-bps-v1',2500,206,2706,1,now());
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSale" SET "totalCents"=2707 WHERE "id"='vault-fixture-sale'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSale" SET "mode"='CERTIFICATION' WHERE "id"='vault-fixture-sale'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSale" SET "machineTimezone"='UTC' WHERE "id"='vault-fixture-sale'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultSale" WHERE "id"='vault-fixture-sale'$q$, 'retained');
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultSale" SELECT (jsonb_populate_record(NULL::"VaultSale",to_jsonb(s)||'{"id":"bad-scope-sale","localTransactionId":"bad-scope-sale","supportReference":"TEST0002","configVersionId":"vault-fixture-other-config"}'::jsonb)).* FROM "VaultSale" s WHERE "id"='vault-fixture-sale'$q$, 'different machine');
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultSale" SELECT (jsonb_populate_record(NULL::"VaultSale",to_jsonb(s)||'{"id":"bad-mode-sale","localTransactionId":"bad-mode-sale","supportReference":"TEST0003","certificationSessionId":"vault-fixture-certification"}'::jsonb)).* FROM "VaultSale" s WHERE "id"='vault-fixture-sale'$q$, 'certification linkage');
INSERT INTO "VaultSale" SELECT (jsonb_populate_record(NULL::"VaultSale",to_jsonb(s)||'{"id":"vault-fixture-test-sale","localTransactionId":"vault-fixture-test-sale","supportReference":"TEST0004","mode":"CERTIFICATION","certificationSessionId":"vault-fixture-certification"}'::jsonb)).* FROM "VaultSale" s WHERE "id"='vault-fixture-sale';
UPDATE "VaultSale" SET "state"='PAYMENT_AUTHORIZED',"paymentState"='AUTHORIZED',"authorizationObservedAt"=now() WHERE "id"='vault-fixture-sale';

INSERT INTO "VaultSaleItem" ("id","saleId","lineId","doorRecordId","doorId","productIdSnapshot","productNameSnapshot","photoUrlSnapshot","descriptionSnapshot","categorySnapshot","priceCentsSnapshot","taxClassSnapshot","controllerChannelSnapshot","mappingVersionSnapshot","taxRateBasisPoints","taxCentsSnapshot","allocationState","fulfillmentState","updatedAt") VALUES
 ('vault-fixture-item','vault-fixture-sale','vault-fixture-line','vault-fixture-door-1-1','X-01','vault-fixture-product','Test pack','https://example.test/pack.png','Disposable fixture','SPORTS',2500,'GENERAL',1,'1',825,206,'RESERVED','NOT_COMMITTED',now());
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSaleItem" SET "doorId"='X-02' WHERE "id"='vault-fixture-item'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSaleItem" SET "priceCentsSnapshot"=5000 WHERE "id"='vault-fixture-item'$q$, 'immutable');
UPDATE "VaultSaleItem" SET "initialCommandId"='vault-fixture-command-1',"initialCommandState"='COMMAND_INTENT_RECORDED',"allocationState"='COMMITTED_SOLD' WHERE "id"='vault-fixture-item';
UPDATE "VaultSaleItem" SET "initialCommandState"='ACCEPTED',"retryCommandId"='vault-fixture-command-2',"retryCommandState"='COMMAND_INTENT_RECORDED',"retryUsedAt"=now() WHERE "id"='vault-fixture-item';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSaleItem" SET "retryCommandId"='vault-fixture-command-3' WHERE "id"='vault-fixture-item'$q$, 'immutable');

INSERT INTO "VaultMachineEvent" ("id","machineId","eventId","sequence","schemaVersion","type","mode","actor","occurredAt","payload","payloadDigest") VALUES
 ('vault-fixture-event','vault-fixture-machine','vault-fixture-local-event',1,1,'DISPOSABLE_VALIDATION','CERTIFICATION','disposable-human',now(),'{}',repeat('d',64));
DO $$ BEGIN
 IF (SELECT "actor" FROM "VaultMachineEvent" WHERE "id"='vault-fixture-event') <> 'disposable-human' THEN RAISE EXCEPTION 'Actor was not preserved'; END IF;
END $$;
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultMachineEvent" SET "actor"='replacement' WHERE "id"='vault-fixture-event'$q$, 'append-only');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultMachineEvent" WHERE "id"='vault-fixture-event'$q$, 'append-only');
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultMachineEvent" SELECT (jsonb_populate_record(NULL::"VaultMachineEvent",to_jsonb(e)||'{"id":"duplicate-event-row","eventId":"another-event"}'::jsonb)).* FROM "VaultMachineEvent" e WHERE "id"='vault-fixture-event'$q$, 'machineId_sequence_key');

INSERT INTO "VaultCertificationEvidence" ("id","certificationId","evidenceId","doorId","evidenceClass","outcome","expectedDoorIds","observedDoorIds","notes","artifactDigest","metadata","observedAt") VALUES
 ('vault-fixture-evidence','vault-fixture-certification','vault-fixture-local-evidence','X-01','AUTOMATED','PASS','["X-01"]','["X-01"]','Disposable observation only',repeat('e',64),'{"cycleType":"DIAGNOSTIC","commandId":"vault-fixture-command"}',now());
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificationEvidence" SET "outcome"='FAIL' WHERE "id"='vault-fixture-evidence'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificationEvidence" SET "metadata"='{"cycleType":"PURCHASE"}' WHERE "id"='vault-fixture-evidence'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultCertificationEvidence" WHERE "id"='vault-fixture-evidence'$q$, 'retained');
UPDATE "VaultCertificationEvidence" SET "artifactStorageKey"='vault-certification/disposable/evidence.json',"metadata"="metadata"||jsonb_build_object('verifiedArtifactDigest',repeat('e',64),'verifiedArtifactStorageKey','vault-certification/disposable/evidence.json') WHERE "id"='vault-fixture-evidence';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificationSession" SET "sourceCommit"=repeat('f',40) WHERE "id"='vault-fixture-certification'$q$, 'immutable');
-- Application approval has its own full threshold predicate. This fixture tests
-- database post-approval integrity only; it is not a passing physical certificate.
UPDATE "VaultCertificationSession" SET "status"='PASSED' WHERE "id"='vault-fixture-certification';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificationSession" SET "status"='ACTIVE' WHERE "id"='vault-fixture-certification'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificationEvidence" SET "artifactStorageKey"='vault-certification/disposable/replacement.json' WHERE "id"='vault-fixture-evidence'$q$, 'immutable');
INSERT INTO "VaultCertificate" ("id","certificationId","schemaVersion","certificatePayload","digest","signingKeyId","signingAlgorithm","detachedSignature","approvedByUserId","approvedByRole","issuedAt") VALUES
 ('vault-fixture-certificate','vault-fixture-certification',1,'{"disposableOnly":true}',repeat('f',64),'disposable-key','Ed25519','not-a-real-signature','disposable-human','TECHNICIAN',now());
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultCertificate" SET "certificatePayload"='{}' WHERE "id"='vault-fixture-certificate'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultCertificate" WHERE "id"='vault-fixture-certificate'$q$, 'retained');
UPDATE "VaultCertificate" SET "invalidatedAt"=now(),"invalidationReason"='Disposable invalidation',"retainUntil"=now()+interval '3 years' WHERE "id"='vault-fixture-certificate';
UPDATE "VaultCertificationSession" SET "status"='INVALIDATED',"invalidatedAt"=now(),"invalidationReason"='Disposable invalidation',"retainUntil"=now()+interval '3 years' WHERE "id"='vault-fixture-certification';
UPDATE "VaultCertificationEvidence" SET "retainUntil"=now()+interval '3 years' WHERE "id"='vault-fixture-evidence';

-- Configurable address tuples and retained retirement history.
INSERT INTO "VaultDoor" ("id","machineId","doorId","doorLabel","controllerEndpointId","controllerChannel","updatedAt") VALUES
 ('vault-profile-a','vault-fixture-other','compact_A','Upper large','left-board',1,now()),
 ('vault-profile-b','vault-fixture-other','compact_B','Lower small','right-board',1,now());
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultDoor" ("id","machineId","doorId","controllerEndpointId","controllerChannel","updatedAt") VALUES ('address-collision','vault-fixture-other','compact_C','left-board',1,now())$q$, 'VaultDoor_active_endpoint_channel_key');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultDoor" WHERE "id"='vault-profile-a'$q$, 'retained');
UPDATE "VaultDoor" SET "retiredAt"=now() WHERE "id"='vault-profile-a';
INSERT INTO "VaultDoor" ("id","machineId","doorId","controllerEndpointId","controllerChannel","updatedAt") VALUES ('vault-profile-c','vault-fixture-other','compact_C','left-board',1,now());
UPDATE "VaultDoor" SET "state"='AVAILABLE' WHERE "id"='vault-profile-c';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultDoor" SET "controllerChannel"=2 WHERE "id"='vault-profile-c'$q$, 'Reconcile stocked');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultSaleItem" SET "controllerEndpointIdSnapshot"='different' WHERE "id"='vault-fixture-item'$q$, 'immutable');

INSERT INTO "VaultConfigVersion" ("id","machineId","version","schemaVersion","canonicalPayload","digest","minimumAppVersion","createdByAdminId","expiresAt") VALUES
 ('vault-profile-config','vault-fixture-other',2,2,'{"schemaVersion":2,"machineProfile":{"doors":[{"doorId":"compact_B","label":"Lower small"}]},"doorMapping":[{"doorId":"compact_B","controllerEndpointId":"right-board","controllerChannel":1}]}',repeat('9',64),'0.1.0','disposable-actor',now()+interval '1 day');
INSERT INTO "VaultSale" SELECT (jsonb_populate_record(NULL::"VaultSale",to_jsonb(s)||'{"id":"vault-profile-sale","machineId":"vault-fixture-other","localTransactionId":"vault-profile-local-sale","supportReference":"PROFILE1","configVersionId":"vault-profile-config","configVersionNumber":2,"configDigest":"9999999999999999999999999999999999999999999999999999999999999999"}'::jsonb)).* FROM "VaultSale" s WHERE "id"='vault-fixture-sale';
INSERT INTO "VaultSaleItem" SELECT (jsonb_populate_record(NULL::"VaultSaleItem",to_jsonb(i)||'{"id":"vault-profile-item","saleId":"vault-profile-sale","lineId":"vault-profile-line","doorRecordId":"vault-profile-b","doorId":"compact_B","controllerEndpointIdSnapshot":"right-board","doorLabelSnapshot":"Lower small","mappingVersionSnapshot":"2","initialCommandId":null,"retryCommandId":null,"retryUsedAt":null}'::jsonb)).* FROM "VaultSaleItem" i WHERE "id"='vault-fixture-item';
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultSaleItem" SELECT (jsonb_populate_record(NULL::"VaultSaleItem",to_jsonb(i)||'{"id":"bad-profile-item","lineId":"bad-profile-line","doorId":"compact_C","doorRecordId":"vault-profile-c"}'::jsonb)).* FROM "VaultSaleItem" i WHERE "id"='vault-profile-item'$q$, 'pin a member');
SELECT pg_temp.vault_expect_rejection($q$INSERT INTO "VaultSaleItem" SELECT (jsonb_populate_record(NULL::"VaultSaleItem",to_jsonb(i)||'{"id":"bad-profile-machine","lineId":"bad-profile-machine-line","saleId":"vault-fixture-sale"}'::jsonb)).* FROM "VaultSaleItem" i WHERE "id"='vault-profile-item'$q$, 'exact business machine');

INSERT INTO "VaultRestockSession" ("id","machineId","localSessionId","configVersionId","mode","expectedDoorCount","updatedAt") VALUES
 ('vault-profile-restock','vault-fixture-other','vault-profile-local-restock','vault-profile-config','PRODUCTION',1,now());
INSERT INTO "VaultRestockItem" ("id","restockSessionId","doorRecordId","doorId","doorLabelSnapshot","mappingSnapshot","updatedAt") VALUES
 ('vault-profile-restock-item','vault-profile-restock','vault-profile-b','compact_B','Lower small','{"doorId":"compact_B","controllerEndpointId":"right-board","controllerChannel":1}',now());
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultRestockSession" SET "state"='FINALIZED',"finalizedAt"=now(),"physicalCloseConfirmedAt"=now(),"filledCount"=1 WHERE "id"='vault-profile-restock'$q$, 'exact persisted');
UPDATE "VaultRestockItem" SET "commandId"='vault-profile-restock-command',"commandState"='ACCEPTED',"commandTerminalAt"=now(),"state"='LEFT_EMPTY',"reviewedAt"=now() WHERE "id"='vault-profile-restock-item';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultRestockItem" SET "commandId"='replacement' WHERE "id"='vault-profile-restock-item'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultRestockItem" SET "doorLabelSnapshot"='Other' WHERE "id"='vault-profile-restock-item'$q$, 'immutable');
UPDATE "VaultRestockSession" SET "state"='FINALIZED',"finalizedAt"=now(),"physicalCloseConfirmedAt"=now(),"leftEmptyCount"=1 WHERE "id"='vault-profile-restock';
SELECT pg_temp.vault_expect_rejection($q$UPDATE "VaultRestockSession" SET "mode"='CERTIFICATION' WHERE "id"='vault-profile-restock'$q$, 'immutable');
SELECT pg_temp.vault_expect_rejection($q$DELETE FROM "VaultRestockItem" WHERE "id"='vault-profile-restock-item'$q$, 'retained');
ROLLBACK;
SELECT 'VAULT_V1_MIGRATION_VALIDATION_PASS' AS validation_result;
