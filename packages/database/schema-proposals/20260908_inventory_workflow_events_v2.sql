-- INACTIVE candidate: promote only into a reviewed migration release or disposable validation tree.
BEGIN;
CREATE TABLE "InventoryWorkflowEventV2" (
  "sequence" bigint PRIMARY KEY CHECK ("sequence" BETWEEN 1 AND 9007199254740991),
  "id" text NOT NULL UNIQUE,
  "recordedAt" timestamptz(3) NOT NULL,
  "content" text NOT NULL CHECK (octet_length("content") <= 2097152),
  "contentHash" text NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  CHECK ("contentHash" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CHECK (("content"::jsonb -> 'event' ->> 'schema_version')::int = 2),
  CHECK (("content"::jsonb -> 'event' ->> 'source_sequence')::bigint = "sequence"),
  CHECK ("content"::jsonb -> 'event' ->> 'source_event_id' = "id"),
  CHECK (("content"::jsonb -> 'event' ->> 'recorded_at')::timestamptz = "recordedAt"),
  CHECK (("content"::jsonb -> 'event' ->> 'effective_at')::timestamptz <= "recordedAt"),
  CHECK ((jsonb_typeof("content"::jsonb -> 'command') = 'object' AND jsonb_typeof("content"::jsonb -> 'event') = 'object' AND "content"::jsonb -> 'event' ?& ARRAY['schema_version','source_sequence','source_event_id','recorded_at','effective_at','recorded_by','event_kind','data','currency','evidence_ref'] AND "content"::jsonb -> 'command' ?& ARRAY['request_id','event_kind','data','effective_at','evidence_ref']) IS TRUE)
);
CREATE UNIQUE INDEX "InventoryWorkflowEventV2_request" ON "InventoryWorkflowEventV2" (("content"::jsonb -> 'command' ->> 'request_id'));
CREATE INDEX "InventoryWorkflowEventV2_kind" ON "InventoryWorkflowEventV2" (("content"::jsonb -> 'event' ->> 'event_kind'));
CREATE FUNCTION "inventoryWorkflowV2Immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'InventoryWorkflowEventV2 is append-only'; END;
$$;
CREATE TRIGGER "InventoryWorkflowEventV2_no_update_delete" BEFORE UPDATE OR DELETE ON "InventoryWorkflowEventV2" FOR EACH ROW EXECUTE FUNCTION "inventoryWorkflowV2Immutable"();
CREATE TRIGGER "InventoryWorkflowEventV2_no_truncate" BEFORE TRUNCATE ON "InventoryWorkflowEventV2" FOR EACH STATEMENT EXECUTE FUNCTION "inventoryWorkflowV2Immutable"();
CREATE FUNCTION "inventoryWorkflowV2Sequence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(20260907, 4201);
  PERFORM pg_advisory_xact_lock(20260908, 4201);
  SELECT COALESCE(MAX("sequence"), 0) + 1 INTO expected FROM "InventoryWorkflowEventV2";
  IF NEW."sequence" <> expected THEN RAISE EXCEPTION 'Workflow sequence must be contiguous'; END IF;
  IF NEW."recordedAt" > clock_timestamp() THEN RAISE EXCEPTION 'Workflow recording time cannot be future dated'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "InventoryWorkflowEventV2_sequence" BEFORE INSERT ON "InventoryWorkflowEventV2" FOR EACH ROW EXECUTE FUNCTION "inventoryWorkflowV2Sequence"();
-- Linked permanent cards are reference identities inside this physical workflow.
-- No other inventory/commerce transition may make them available or claim an exact sale.
CREATE FUNCTION "collectibleCardV2WorkflowCustody"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD."currentOwnerType", OLD."currentOwnerId", OLD."lifecycleState", OLD."locationId", OLD."saleMode")
    IS NOT DISTINCT FROM ROW(NEW."currentOwnerType", NEW."currentOwnerId", NEW."lifecycleState", NEW."locationId", NEW."saleMode") THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "InventoryWorkflowEventV2" w,
    jsonb_array_elements(COALESCE(w."content"::jsonb -> 'event' -> 'data' -> 'permanent_card_links', '[]'::jsonb)) AS link
    WHERE link ->> 'card_id' = OLD."id") THEN
    RAISE EXCEPTION 'Permanent card is held by purchased-lot workflow; separate lifecycle, commerce and ownership transitions are prohibited';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CollectibleCardV2_workflow_custody" BEFORE UPDATE OF "currentOwnerType", "currentOwnerId", "lifecycleState", "locationId", "saleMode" OR DELETE
  ON "CollectibleCardV2" FOR EACH ROW EXECUTE FUNCTION "collectibleCardV2WorkflowCustody"();
COMMIT;
