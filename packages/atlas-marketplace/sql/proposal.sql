-- INACTIVE R2 PROPOSAL. Apply only to a dedicated approved marketplace database.
-- No existing schema, role, grading table or migration manifest is referenced.
BEGIN;
CREATE SCHEMA atlas_marketplace;
REVOKE ALL ON SCHEMA atlas_marketplace FROM PUBLIC;
CREATE TABLE atlas_marketplace.state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  format text NOT NULL CHECK (format = 'atlas-marketplace-v2'),
  environment text NOT NULL CHECK (environment IN ('SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION')),
  revision bigint NOT NULL CHECK (revision >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE atlas_marketplace.commits (
  revision bigint PRIMARY KEY CHECK (revision>0), previous_hash text NOT NULL,
  state_hash text NOT NULL, document jsonb NOT NULL, recorded_at bigint NOT NULL
);
CREATE TABLE atlas_marketplace.journal (
  ordinal bigint PRIMARY KEY, entry_id text UNIQUE NOT NULL, document jsonb NOT NULL
);
CREATE TABLE atlas_marketplace.events (
  ordinal bigint PRIMARY KEY, environment text NOT NULL, document jsonb NOT NULL
);
CREATE TABLE atlas_marketplace.active_cards (
  card_id text PRIMARY KEY, listing_id text UNIQUE NOT NULL, status text NOT NULL,
  document jsonb NOT NULL CHECK (status IN ('ACTIVE','RESERVED','SOLD'))
);
CREATE TABLE atlas_marketplace.active_reservations (
  card_id text PRIMARY KEY, reservation_id text UNIQUE NOT NULL, listing_id text UNIQUE NOT NULL,
  document jsonb NOT NULL
);
CREATE FUNCTION atlas_marketplace.reject_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_MARKETPLACE_HISTORY' USING ERRCODE='23514'; END $$;
CREATE TRIGGER commits_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.commits FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.journal FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.events FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();

CREATE FUNCTION atlas_marketplace.read_state() RETURNS SETOF atlas_marketplace.state
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM atlas_marketplace.state WHERE id $$;
CREATE FUNCTION atlas_marketplace.lock_state() RETURNS SETOF atlas_marketplace.state
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM atlas_marketplace.state WHERE id FOR UPDATE $$;
CREATE FUNCTION atlas_marketplace.commit_state(expected_revision bigint, expected_hash text, next_document jsonb, next_hash text, at_ms bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old atlas_marketplace.state%ROWTYPE; item record; old_journals bigint; old_events bigint;
BEGIN
  SELECT * INTO STRICT old FROM atlas_marketplace.state WHERE id FOR UPDATE;
  IF old.revision<>expected_revision OR old.state_hash<>expected_hash THEN RAISE EXCEPTION 'STALE_MARKETPLACE_STATE' USING ERRCODE='40001'; END IF;
  IF next_hash IS NULL OR at_ms IS NULL OR next_document IS NULL OR next_hash !~ '^[0-9a-f]{64}$' OR at_ms<0 OR jsonb_typeof(next_document)<>'object' THEN RAISE EXCEPTION 'INVALID_MARKETPLACE_STATE'; END IF;
  IF jsonb_typeof(next_document->'journals') IS DISTINCT FROM 'array' OR jsonb_typeof(next_document->'events') IS DISTINCT FROM 'array'
    OR jsonb_typeof(next_document->'listings') IS DISTINCT FROM 'object' OR jsonb_typeof(next_document->'reservations') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'INVALID_MARKETPLACE_SHAPE'; END IF;
  old_journals:=jsonb_array_length(old.document->'journals'); old_events:=jsonb_array_length(old.document->'events');
  IF jsonb_array_length(next_document->'journals')<old_journals OR jsonb_array_length(next_document->'events')<old_events THEN RAISE EXCEPTION 'HISTORY_TRUNCATION'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(old.document->'journals') WITH ORDINALITY j(value,n) WHERE next_document->'journals'->((j.n-1)::integer) IS DISTINCT FROM j.value)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(old.document->'events') WITH ORDINALITY e(value,n) WHERE next_document->'events'->((e.n-1)::integer) IS DISTINCT FROM e.value)
    THEN RAISE EXCEPTION 'HISTORY_MUTATION'; END IF;
  FOR item IN SELECT value,n FROM jsonb_array_elements(next_document->'journals') WITH ORDINALITY j(value,n) WHERE n>old_journals LOOP
    IF jsonb_typeof(item.value->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_JOURNAL_LINES'; END IF;
    IF jsonb_array_length(item.value->'lines')<2 OR (item.value->>'sequence')::bigint IS DISTINCT FROM item.n OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(item.value->'lines') l WHERE l->>'currency' IS DISTINCT FROM 'USD' OR l->>'book' IS NULL OR l->>'account' IS NULL OR l->>'cents' IS NULL OR (l->>'cents')::numeric=0 OR abs((l->>'cents')::numeric)>9007199254740991 OR trunc((l->>'cents')::numeric)<>(l->>'cents')::numeric
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(item.value->'lines') l GROUP BY l->>'book' HAVING sum((l->>'cents')::numeric)<>0
    ) THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF;
    INSERT INTO atlas_marketplace.journal VALUES(item.n,item.value->>'id',item.value);
  END LOOP;
  FOR item IN SELECT value,n FROM jsonb_array_elements(next_document->'events') WITH ORDINALITY e(value,n) WHERE n>old_events LOOP
    IF item.value->>'environment' IS DISTINCT FROM old.environment OR (item.value->>'sequence')::bigint IS DISTINCT FROM item.n THEN RAISE EXCEPTION 'EVENT_SCOPE_MISMATCH'; END IF;
    INSERT INTO atlas_marketplace.events VALUES(item.n,old.environment,item.value);
  END LOOP;
  -- These are disposable constraint projections, never financial history.
  DELETE FROM atlas_marketplace.active_cards;
  INSERT INTO atlas_marketplace.active_cards SELECT value->>'cardId',key,value->>'status',value FROM jsonb_each(next_document->'listings') WHERE value->>'status' IN ('ACTIVE','RESERVED','SOLD');
  DELETE FROM atlas_marketplace.active_reservations;
  INSERT INTO atlas_marketplace.active_reservations SELECT value->>'cardId',key,value->>'listingId',value FROM jsonb_each(next_document->'reservations') WHERE value->>'status' IN ('HELD','PAYMENT_PENDING');
  INSERT INTO atlas_marketplace.commits VALUES(old.revision+1,old.state_hash,next_hash,next_document,at_ms);
  UPDATE atlas_marketplace.state SET revision=old.revision+1,document=next_document,state_hash=next_hash WHERE id;
  RETURN old.revision+1;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_marketplace FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_marketplace FROM PUBLIC;
-- A separately reviewed provisioning step seeds one empty state row, creates
-- no-superuser/no-create/no-membership roles and grants only schema USAGE plus:
-- reader: EXECUTE read_state(); writer: read_state(), lock_state(), commit_state(...).
-- The runtime never runs this DDL, creates roles, or discovers credentials.
COMMIT;
