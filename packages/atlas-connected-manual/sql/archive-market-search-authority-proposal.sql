-- INERT / UNREGISTERED. Qualify against an owned baseline-through-011 database
-- and the intended restricted role before any reviewed registration/activation.
-- No existing job, request, approval, report or receipt is rewritten.
ALTER TABLE atlas_manual_connected.market_job
  ADD COLUMN archive_authority text,
  ADD COLUMN archive_authority_hash text;

ALTER TABLE atlas_manual_connected.market_job DROP CONSTRAINT market_job_origin_check;
ALTER TABLE atlas_manual_connected.market_job ADD CONSTRAINT market_job_origin_check
  CHECK (origin IN ('APPROVAL','REFRESH','BACKFILL','ARCHIVE_SEARCH_V1'));
ALTER TABLE atlas_manual_connected.market_job ADD CONSTRAINT market_job_archive_authority_check CHECK (
  CASE WHEN origin='ARCHIVE_SEARCH_V1' THEN
    archive_authority IS NOT NULL AND archive_authority_hash IS NOT NULL
    AND octet_length(archive_authority)<=4096 AND jsonb_typeof(archive_authority::jsonb)='object'
    AND archive_authority_hash=encode(sha256(convert_to(archive_authority,'UTF8')),'hex')
  ELSE archive_authority IS NULL AND archive_authority_hash IS NULL END);

-- The existing market_job_guard stays byte-identical. Its immutable-column
-- comparison already includes both new columns; its original state/response/
-- dispatch/audit rules continue to govern every origin.
CREATE FUNCTION atlas_manual_connected.market_archive_search_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
DECLARE expected jsonb;
BEGIN
 IF NEW.origin<>'ARCHIVE_SEARCH_V1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.archive_authority IS DISTINCT FROM OLD.archive_authority
    OR NEW.archive_authority_hash IS DISTINCT FROM OLD.archive_authority_hash
    OR NEW.public_hash IS NOT NULL AND NEW.public_hash IS DISTINCT FROM (NEW.archive_authority::jsonb->>'publicHash')
  THEN RAISE EXCEPTION 'Archive market authority is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT jsonb_build_object('version','atlas-market-archive-search-authority-v1',
   'requestId',NEW.request_id::text,'cardId',NEW.card_id::text,'approvalActionId',NEW.approval_action_id::text,
   'actorId',NEW.actor_id::text,'accessVersion',NEW.access_version,'mode',NEW.mode,'sourceRevision',a.source_revision,
   'sourceHash',a.source_hash,'reportHash',a.report_hash,'publicToken',r.public_token,'publicVersion',p.version,
   'publicHash',p.public_hash,'manifestHash',p.manifest_hash,'requestHash',m.request_hash)
 INTO expected FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
 JOIN atlas_manual.public_report_identity r USING(card_id) JOIN atlas_manual.card c ON c.id=p.card_id
 JOIN atlas_manual_intake.card i ON i.id=c.id
 JOIN atlas_manual.presentation_market m ON m.card_id=p.card_id AND m.request_id=NEW.request_id
 WHERE p.card_id=NEW.card_id AND p.action_id=NEW.approval_action_id AND p.mode=NEW.mode AND p.state='PUBLISHED'
   AND a.source_hash=NEW.source_hash AND a.report_hash=NEW.report_hash
   AND m.approval_action_id=p.action_id AND m.actor_id=NEW.actor_id AND m.state='STARTED'
   AND m.request_hash=encode(sha256(convert_to(m.request,'UTF8')),'hex')
   AND m.request::jsonb->>'requestId'=NEW.request_id::text AND m.request::jsonb->>'approvalActionId'=NEW.approval_action_id::text
   AND atlas_manual_connected.display_owner_current(NEW.actor_id,NEW.access_version)
   AND (c.owner_id=NEW.actor_id OR NEW.actor_id=ANY(c.approvers) OR NEW.actor_id=ANY(c.editors) OR NEW.actor_id=ANY(c.readers))
   AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
   AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=i.id OR (d.owner_id=i.owner_id AND d.create_request_id=i.create_request_id));
 IF expected IS NULL OR NEW.archive_authority::jsonb IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Archive search requires exact current published authority';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.market_archive_search_guard() FROM PUBLIC;
CREATE TRIGGER market_archive_search_guard BEFORE INSERT OR UPDATE ON atlas_manual_connected.market_job
FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.market_archive_search_guard();

-- Existing table-level SELECT/INSERT and column-scoped job progress grants are
-- sufficient; neither authority column receives UPDATE. No new write privilege
-- to approval, publication, presentation or staff identity is granted here.
