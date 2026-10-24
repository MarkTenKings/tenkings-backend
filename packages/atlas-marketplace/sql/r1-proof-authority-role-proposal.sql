-- INERT exact-role candidate. No credentials, migration registration or grants
-- to existing staff/customer/marketplace roles. Owner installs only into an
-- explicitly reviewed isolated canonical-schema fixture; no live DB assumed.
-- Review order: schema candidate, owner/roles/ACL candidate, source/hash audit.
-- Genuine canonical writer integration remains REQUIRED before admission.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_AUTHORITY_ROLE_PROPOSAL_NOT_APPROVED'; END $$;
DO $$ BEGIN
  IF current_database()<>'atlas_proof_authority_review_candidate'
    OR to_regnamespace('atlas_proof_authority') IS NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN
      ('atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'))
  THEN RAISE EXCEPTION 'ISOLATED_PROOF_AUTHORITY_ROLE_REVIEW_REQUIRED'; END IF;
END $$;
CREATE ROLE atlas_proof_authority_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE atlas_proof_request LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE atlas_proof_settler LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE atlas_proof_revoker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE,TEMPORARY ON DATABASE atlas_proof_authority_review_candidate FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE atlas_proof_authority_review_candidate TO atlas_proof_request,atlas_proof_settler,atlas_proof_revoker;
ALTER SCHEMA atlas_proof_authority OWNER TO atlas_proof_authority_owner;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='atlas_proof_authority' AND c.relkind='r'
  LOOP EXECUTE format('ALTER TABLE %s OWNER TO atlas_proof_authority_owner',item.oid::regclass); END LOOP;
  FOR item IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='atlas_proof_authority'
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO atlas_proof_authority_owner',item.oid::regprocedure); END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_proof_authority FROM PUBLIC,atlas_proof_request,atlas_proof_settler,atlas_proof_revoker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_proof_authority FROM PUBLIC,atlas_proof_request,atlas_proof_settler,atlas_proof_revoker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_proof_authority FROM PUBLIC,atlas_proof_request,atlas_proof_settler,atlas_proof_revoker;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_proof_authority_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA atlas_proof_authority TO atlas_proof_request,atlas_proof_settler,atlas_proof_revoker;
GRANT EXECUTE ON FUNCTION atlas_proof_authority.claim_stage_v1(jsonb),atlas_proof_authority.lookup_stage_v1(uuid,text),
  atlas_proof_authority.lookup_claim_v1(uuid,text),atlas_proof_authority.begin_logout_v1(jsonb) TO atlas_proof_request;
GRANT EXECUTE ON FUNCTION atlas_proof_authority.settle_stage_v1(jsonb),atlas_proof_authority.lookup_stage_v1(uuid,text),
  atlas_proof_authority.lookup_claim_v1(uuid,text),atlas_proof_authority.read_drain_v1(uuid),atlas_proof_authority.settle_drain_v1(jsonb) TO atlas_proof_settler;
GRANT EXECUTE ON FUNCTION atlas_proof_authority.authorize_mutation_v1(jsonb),atlas_proof_authority.begin_mutation_v1(jsonb),atlas_proof_authority.apply_mutation_v1(uuid,text),
  atlas_proof_authority.read_drain_v1(uuid) TO atlas_proof_revoker;

-- Minimum rights for actual canonical READ + FOR SHARE. UPDATE of one column
-- is needed by row locking; the NOLOGIN owner exposes no canonical UPDATE body.
-- Only the fixed frozen logout/operator apply bodies receive canonical writes.
GRANT USAGE ON SCHEMA atlas_staff,atlas_customer TO atlas_proof_authority_owner;
GRANT SELECT ON atlas_staff."StaffControl",atlas_staff."StaffIdentity",atlas_staff."StaffSession",atlas_staff."StaffBrowser",
  atlas_customer."CustomerControl",atlas_customer."CustomerAccount",atlas_customer."CustomerSession",atlas_customer."CustomerBrowser",atlas_customer."CustomerServiceControl" TO atlas_proof_authority_owner;
GRANT UPDATE(revision) ON atlas_staff."StaffControl",atlas_customer."CustomerControl" TO atlas_proof_authority_owner;
GRANT UPDATE("accessVersion") ON atlas_staff."StaffIdentity",atlas_customer."CustomerAccount" TO atlas_proof_authority_owner;
GRANT UPDATE("expiresAt") ON atlas_staff."StaffSession",atlas_staff."StaffBrowser",atlas_customer."CustomerSession",atlas_customer."CustomerBrowser" TO atlas_proof_authority_owner;
GRANT UPDATE("updatedAt") ON atlas_customer."CustomerServiceControl" TO atlas_proof_authority_owner;
GRANT UPDATE("revokedAt") ON atlas_staff."StaffSession",atlas_customer."CustomerSession" TO atlas_proof_authority_owner;
GRANT SELECT ON atlas_staff."StaffOperationsGrant",atlas_staff."StaffAudit" TO atlas_proof_authority_owner;
GRANT UPDATE("expiresAt") ON atlas_staff."StaffOperationsGrant" TO atlas_proof_authority_owner;
GRANT UPDATE(enabled,mode,origin,"deploymentId","releaseSha","configHash",revision,"gradingPolicyHash","updatedAt") ON atlas_staff."StaffControl" TO atlas_proof_authority_owner;
GRANT UPDATE(role,"accessVersion","revokedAt","certificationUntil","trustedLearningUntil") ON atlas_staff."StaffIdentity" TO atlas_proof_authority_owner;
GRANT UPDATE(enabled,mode,origin,"deploymentId","releaseSha","configHash",revision,"updatedAt") ON atlas_customer."CustomerControl" TO atlas_proof_authority_owner;
GRANT UPDATE("accessVersion","revokedAt") ON atlas_customer."CustomerAccount" TO atlas_proof_authority_owner;
GRANT UPDATE(enabled,"identificationEnabled","updatedAt") ON atlas_customer."CustomerServiceControl" TO atlas_proof_authority_owner;
GRANT INSERT ON atlas_staff."StaffAudit" TO atlas_proof_authority_owner;
-- No serving table grant, owner membership, PUBLIC function exception, or
-- generic mutation callback. Any extra effective right fails the adapter audit.
-- The actual isolated installer supplies externally reviewed pg_get_functiondef
-- pins; the serving adapter never learns its expected hashes from the database.
COMMIT;
