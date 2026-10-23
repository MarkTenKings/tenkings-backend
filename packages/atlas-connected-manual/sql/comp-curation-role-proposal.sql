-- UNREGISTERED, NOT AN INSTALLER. Explicit psql identifier parameter required.
-- Operator must first review the additive comp-curation schema installation,
-- exact schema pin, NEW non-owner native-only role, connection/secret lifecycle,
-- and inherited PUBLIC privileges. Never use the existing staff/manual role.
-- No CREATE ROLE/password, database-wide REVOKE, migration ledger, controls,
-- grading, provider, customer, publication or report mutation occurs here.
-- Required preconditions include no memberships/ownership/CREATE/TEMPORARY,
-- no other effective grants; a grant cannot subtract inherited PUBLIC rights.
-- The caller must fail closed if these preconditions are not already satisfied.
-- UPDATE(id) is solely for PostgreSQL row-lock admission. Its exact immutable
-- id/revision trigger bodies + enabled trigger graph are runtime-pinned, and
-- actual writes (including id=id) must fail. No content/revision update grant.
BEGIN;
GRANT USAGE ON SCHEMA atlas_manual,atlas_manual_intake TO :"curation_role";
GRANT EXECUTE ON FUNCTION atlas_manual.authenticate(text,text,jsonb,text[]) TO :"curation_role";
GRANT SELECT ON atlas_manual.card,atlas_manual.action,atlas_manual.approval,
 atlas_manual.publication,atlas_manual.public_report_identity,atlas_manual.presentation_market,
 atlas_manual.comp_curation,atlas_manual_intake.card,atlas_manual_intake.discarded_card TO :"curation_role";
GRANT INSERT ON atlas_manual.comp_curation TO :"curation_role";
GRANT UPDATE(id) ON atlas_manual.card,atlas_manual_intake.card TO :"curation_role";
COMMIT;
