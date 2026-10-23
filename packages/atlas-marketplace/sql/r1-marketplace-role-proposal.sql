-- INERT REVIEW CANDIDATE. Never registered, sourced by runtime, or applied.
-- R1 must replace the review-only database/role identifiers in a separately
-- approved provisioning migration after comparing the actual database ACLs.
-- This candidate does not change any staff/customer role or cookie policy.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED'; END $$;

-- Exact, dedicated database required. No cluster-wide REASSIGN OWNED, role
-- memberships, shared database changes, credentials or broad table grants.
DO $$ BEGIN
  IF current_database()<>'atlas_marketplace_review_candidate'
    OR to_regnamespace('atlas_marketplace') IS NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('atlas_marketplace_owner','atlas_marketplace_writer'))
  THEN RAISE EXCEPTION 'DEDICATED_MARKETPLACE_PROVISIONING_REVIEW_REQUIRED'; END IF;
END $$;

CREATE ROLE atlas_marketplace_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE atlas_marketplace_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Password/certificate delivery belongs to separately approved provisioning.
-- The writer must not own this database or belong to any role, including owner.
REVOKE CREATE,TEMPORARY ON DATABASE atlas_marketplace_review_candidate FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE atlas_marketplace_review_candidate TO atlas_marketplace_writer;
ALTER SCHEMA atlas_marketplace OWNER TO atlas_marketplace_owner;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['state','commits','journal','events','active_cards','active_reservations'] LOOP
    EXECUTE format('ALTER TABLE atlas_marketplace.%I OWNER TO atlas_marketplace_owner',name);
  END LOOP;
END $$;
ALTER FUNCTION atlas_marketplace.reject_change() OWNER TO atlas_marketplace_owner;
ALTER FUNCTION atlas_marketplace.read_state() OWNER TO atlas_marketplace_owner;
ALTER FUNCTION atlas_marketplace.lock_state() OWNER TO atlas_marketplace_owner;
ALTER FUNCTION atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) OWNER TO atlas_marketplace_owner;
REVOKE ALL ON SCHEMA atlas_marketplace FROM PUBLIC,atlas_marketplace_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_marketplace FROM PUBLIC,atlas_marketplace_writer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_marketplace FROM PUBLIC,atlas_marketplace_writer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_marketplace FROM PUBLIC,atlas_marketplace_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_marketplace_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA atlas_marketplace TO atlas_marketplace_writer;
GRANT EXECUTE ON FUNCTION atlas_marketplace.read_state(),atlas_marketplace.lock_state(),atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) TO atlas_marketplace_writer;

-- Deliberately no empty-row seed: the approved initialization must bind its
-- exact environment, canonical empty JSON and SHA256 before host startup.
-- Runtime then checks effective privileges on every connection, including
-- unrelated schemas, PUBLIC/column grants, sequence rights, function owner,
-- SECURITY DEFINER and the sole search_path=pg_catalog setting. Any additional
-- executable non-system function (even a trigger helper) refuses startup/read.
COMMIT;
