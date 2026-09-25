-- Server work retains the authorizing owner's access version, without retaining
-- or extending a browser session. This function grants no certification.
BEGIN;
CREATE FUNCTION atlas_manual.authenticate_machine(owner_id uuid, admitted_version integer, expected jsonb, phones text[])
RETURNS TABLE (id uuid, name text, role text, access_version integer, now_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, atlas_staff, atlas_manual AS $$
DECLARE c atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
BEGIN
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE "StaffControl".id='active' FOR SHARE;
  IF (c.enabled AND c.mode=expected->>'mode' AND c.origin=expected->>'origin'
    AND c."deploymentId"=expected->>'deploymentId' AND c."releaseSha"=expected->>'releaseSha'
    AND c."configHash"=expected->>'configHash') IS NOT TRUE THEN RETURN; END IF;
  -- Private queue discovery checks deployment authorization before inspecting
  -- persisted jobs. It has no owner principal and cannot pass owner ACL checks.
  IF owner_id IS NULL AND admitted_version IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'ATLAS queue'::text, 'WORKER'::text, NULL::integer, clock_timestamp();
    RETURN;
  END IF;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE "StaffIdentity".id=owner_id FOR SHARE;
  IF (i."revokedAt" IS NULL AND i."accessVersion"=admitted_version
    AND i."phoneHash"=ANY(phones) AND i.role='REVIEWER') IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY SELECT i.id, i.name::text, i.role::text, i."accessVersion", clock_timestamp();
END; $$;
REVOKE ALL ON FUNCTION atlas_manual.authenticate_machine(uuid,integer,jsonb,text[]) FROM PUBLIC;
COMMIT;
