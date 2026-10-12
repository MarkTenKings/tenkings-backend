-- Additive geometry request/receipt journal. Human drafts and approvals are not modified.
BEGIN;
CREATE TABLE atlas_manual_connected.geometry_model_action (
 job_key text NOT NULL REFERENCES atlas_manual_connected.early_geometry(key),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3), PRIMARY KEY(job_key,attempt),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 request text NOT NULL CHECK(octet_length(request)<=32768 AND jsonb_typeof(request::jsonb)='object'),
 response text CHECK(response IS NULL OR (octet_length(response)<=32768 AND jsonb_typeof(response::jsonb)='object')),
 dispatched_at timestamptz NOT NULL DEFAULT clock_timestamp(), received_at timestamptz, retry_authorized_at timestamptz,
 CHECK((response IS NULL)=(received_at IS NULL)), CHECK(retry_authorized_at IS NULL OR response IS NOT NULL)
);
REVOKE ALL ON atlas_manual_connected.geometry_model_action FROM PUBLIC;
CREATE FUNCTION atlas_manual_connected.read_geometry_model(job text)
RETURNS SETOF atlas_manual_connected.geometry_model_action LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
 SELECT * FROM atlas_manual_connected.geometry_model_action WHERE job_key=job ORDER BY attempt DESC LIMIT 1;
$$;
CREATE FUNCTION atlas_manual_connected.retry_geometry_model(job text, actor uuid, access_ver integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE changed integer;
BEGIN
 -- Only an explicit authenticated Retry can authorize a successor. A lost or
 -- unknown response has no definite rejection and can never pass this branch.
 PERFORM 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=actor AND j.actor_id=actor
 JOIN atlas_staff."StaffIdentity" a ON a.id=actor AND a."accessVersion"=access_ver AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=job AND j.state IN ('FAILED','NEEDS_REVIEW')
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 FOR UPDATE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE atlas_manual_connected.geometry_model_action SET retry_authorized_at=clock_timestamp()
 WHERE job_key=job AND attempt=(SELECT max(attempt) FROM atlas_manual_connected.geometry_model_action WHERE job_key=job)
 AND attempt<3 AND response IS NOT NULL AND retry_authorized_at IS NULL
 AND (response::jsonb->>'httpStatus')::integer IN (429,500,502,503,504);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $$;
CREATE FUNCTION atlas_manual_connected.dispatch_geometry_model(job text, claim uuid, request_sha text, evidence text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE previous atlas_manual_connected.geometry_model_action%ROWTYPE; next_attempt integer:=1; changed integer;
BEGIN
 IF request_sha !~ '^[a-f0-9]{64}$' OR octet_length(evidence)>32768 THEN RAISE EXCEPTION 'Invalid geometry request'; END IF;
 PERFORM 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=job AND j.claim_id=claim AND j.state='RUNNING' AND j.lease_until>clock_timestamp()
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 FOR UPDATE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO previous FROM atlas_manual_connected.geometry_model_action WHERE job_key=job ORDER BY attempt DESC LIMIT 1;
 IF FOUND THEN
  IF previous.attempt>=3 OR previous.retry_authorized_at IS NULL OR previous.request_hash<>request_sha
    OR previous.response IS NULL OR COALESCE((previous.response::jsonb->>'httpStatus')::integer,0) NOT IN (429,500,502,503,504) THEN RETURN false; END IF;
  next_attempt:=previous.attempt+1;
 END IF;
 INSERT INTO atlas_manual_connected.geometry_model_action(job_key,attempt,request_hash,request) VALUES(job,next_attempt,request_sha,evidence) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $$;
CREATE FUNCTION atlas_manual_connected.receive_geometry_model(job text, request_sha text, evidence text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE changed integer;
BEGIN
 IF octet_length(evidence)>32768 THEN RAISE EXCEPTION 'Invalid geometry receipt'; END IF;
 -- A late actual response survives lease expiry. It grants no card mutation.
 UPDATE atlas_manual_connected.geometry_model_action SET response=evidence,received_at=clock_timestamp()
 WHERE job_key=job AND request_hash=request_sha AND response IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1 OR EXISTS(SELECT 1 FROM atlas_manual_connected.geometry_model_action WHERE job_key=job AND request_hash=request_sha AND response=evidence);
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.read_geometry_model(text),atlas_manual_connected.retry_geometry_model(text,uuid,integer),atlas_manual_connected.dispatch_geometry_model(text,uuid,text,text),atlas_manual_connected.receive_geometry_model(text,text,text) FROM PUBLIC;
COMMIT;
