-- INACTIVE reviewed proposal. Deliberately outside prisma/migrations.
-- Apply only after explicit release approval and disposable full-chain proof.
BEGIN;

CREATE TABLE "CardInventoryEventV2" (
  "sequence" bigint PRIMARY KEY CHECK ("sequence" BETWEEN 1 AND 9007199254740991),
  "id" text NOT NULL UNIQUE,
  "cardId" text NOT NULL REFERENCES "CollectibleCardV2"("id") ON DELETE RESTRICT,
  "recordedAt" timestamptz(3) NOT NULL,
  "content" text NOT NULL CHECK (octet_length("content") <= 131072),
  "contentHash" text NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  CHECK ("contentHash" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CHECK (("content"::jsonb -> 'event' ->> 'source_sequence')::bigint = "sequence"),
  CHECK ("content"::jsonb -> 'event' ->> 'source_event_id' = "id"),
  CHECK ("content"::jsonb -> 'command' ->> 'card_id' = "cardId"),
  CHECK (("content"::jsonb -> 'event' ->> 'recorded_at')::timestamptz = "recordedAt"),
  CHECK (("content"::jsonb -> 'event' ->> 'effective_at')::timestamptz <= "recordedAt")
);
CREATE INDEX "CardInventoryEventV2_card_sequence" ON "CardInventoryEventV2" ("cardId", "sequence");
CREATE INDEX "CardInventoryEventV2_product" ON "CardInventoryEventV2" (("content"::jsonb -> 'event' ->> 'external_product_id'));
CREATE UNIQUE INDEX "CardInventoryEventV2_request" ON "CardInventoryEventV2" (("content"::jsonb -> 'command' ->> 'request_id'));
CREATE UNIQUE INDEX "CardInventoryEventV2_fulfilment" ON "CardInventoryEventV2" (("content"::jsonb -> 'event' ->> 'external_sale_id'))
  WHERE "content"::jsonb -> 'event' ->> 'event_kind' IN ('sale', 'refund');
CREATE UNIQUE INDEX "CardInventoryEventV2_pack_identity" ON "CardInventoryEventV2" (("content"::jsonb -> 'event' ->> 'unit_or_pack_id'))
  WHERE "content"::jsonb -> 'event' ->> 'event_kind' = 'pack';

CREATE FUNCTION "cardInventoryEventV2Immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CardInventoryEventV2 is append-only'; END;
$$;
CREATE TRIGGER "CardInventoryEventV2_no_update_delete" BEFORE UPDATE OR DELETE ON "CardInventoryEventV2"
  FOR EACH ROW EXECUTE FUNCTION "cardInventoryEventV2Immutable"();
CREATE TRIGGER "CardInventoryEventV2_no_truncate" BEFORE TRUNCATE ON "CardInventoryEventV2"
  FOR EACH STATEMENT EXECUTE FUNCTION "cardInventoryEventV2Immutable"();

CREATE FUNCTION "cardInventoryEventV2Sequence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(20260907, 4201);
  SELECT COALESCE(MAX("sequence"), 0) + 1 INTO expected FROM "CardInventoryEventV2";
  IF NEW."sequence" <> expected THEN RAISE EXCEPTION 'Inventory source sequence must be contiguous'; END IF;
  IF NEW."recordedAt" > clock_timestamp() THEN RAISE EXCEPTION 'Inventory recording time cannot be future dated'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CardInventoryEventV2_sequence" BEFORE INSERT ON "CardInventoryEventV2"
  FOR EACH ROW EXECUTE FUNCTION "cardInventoryEventV2Sequence"();

CREATE FUNCTION "cardInventoryEventV2Projection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE card_id text; expected jsonb; observed jsonb;
BEGIN
  IF TG_TABLE_NAME = 'CollectibleCardV2' THEN card_id := NEW."id"; ELSE card_id := NEW."cardId"; END IF;
  SELECT "content"::jsonb -> 'card_after' INTO expected FROM "CardInventoryEventV2"
    WHERE "cardId" = card_id ORDER BY "sequence" DESC LIMIT 1;
  IF expected IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'CollectibleCardV2' THEN
    observed := jsonb_build_object('currentOwnerType', NEW."currentOwnerType", 'currentOwnerId', NEW."currentOwnerId",
      'lifecycleState', NEW."lifecycleState", 'locationId', NEW."locationId", 'saleMode', NEW."saleMode");
  ELSE
    SELECT jsonb_build_object('currentOwnerType', "currentOwnerType", 'currentOwnerId', "currentOwnerId",
      'lifecycleState', "lifecycleState", 'locationId', "locationId", 'saleMode', "saleMode") INTO observed
      FROM "CollectibleCardV2" WHERE "id" = card_id;
  END IF;
  IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Card lifecycle must match its immutable physical inventory evidence'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CollectibleCardV2_inventory_projection" BEFORE UPDATE OF "currentOwnerType", "currentOwnerId", "lifecycleState", "locationId", "saleMode"
  ON "CollectibleCardV2" FOR EACH ROW EXECUTE FUNCTION "cardInventoryEventV2Projection"();
CREATE CONSTRAINT TRIGGER "CardInventoryEventV2_projection_at_commit" AFTER INSERT ON "CardInventoryEventV2"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cardInventoryEventV2Projection"();

COMMIT;
