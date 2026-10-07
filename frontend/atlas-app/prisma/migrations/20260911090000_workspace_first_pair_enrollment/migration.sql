BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- A fresh cohort's first verified human queue receipt supplies its exact
-- one-card pilot roster. This capability performs no migration-time backfill.
-- Freeze the selected roster: adding another waiting pair must not change the
-- bridgePolicyHash bound into an in-flight initialization or grading request.
-- The existing one-distinct-card cap, dispatch readiness and accounting remain
-- authoritative; expanding that scope is a separate control decision.
CREATE FUNCTION atlas_staff.enroll_workspace_first_pair() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE;c atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  staff atlas_staff."StaffControl"%ROWTYPE;b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  source atlas_staff."StaffWorkspaceSourceControl"%ROWTYPE;ident atlas_staff."StaffWorkspaceIdentificationControl"%ROWTYPE;
  op atlas_staff."StaffOperatorControl"%ROWTYPE;actor atlas_staff."StaffIdentity"%ROWTYPE;
  plan atlas_staff."StaffWorkspaceOperation"%ROWTYPE;verified atlas_staff."StaffWorkspaceOperation"%ROWTYPE;
  n jsonb;q jsonb:=NEW.canonical::jsonb;budget jsonb;u jsonb;v jsonb;sides jsonb:='{}'::jsonb;
  side text;next_policy text;at_time timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF NEW.action<>'queue' OR q->'result' ? 'queueResult' THEN RETURN NEW; END IF;
  PERFORM atlas_staff.lock_workspace_private_controls();
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active';
  SELECT * INTO staff FROM atlas_staff."StaffControl" WHERE id='active';
  SELECT * INTO source FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active';
  SELECT * INTO ident FROM atlas_staff."StaffWorkspaceIdentificationControl" WHERE id='active' FOR SHARE;
  SELECT * INTO op FROM atlas_staff."StaffOperatorControl" WHERE id='active';
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR UPDATE;
  budget:=b."policyCanonical"::jsonb;
  IF (staff.enabled AND c.enabled AND c."intakeEnabled" AND c."processingLimit"=1 AND c."maxCards"=10
    AND b.enabled AND source.enabled AND ident.enabled
    AND staff.mode=c.mode AND b.mode=c.mode AND source.mode=c.mode AND ident.mode=c.mode AND op.mode=c.mode
    AND staff."releaseSha"=c."releaseSha" AND source."releaseSha"=c."releaseSha" AND ident."releaseSha"=c."releaseSha"
    AND staff."gradingPolicyHash"=b."gradingPolicyHash"
    AND source."cohortId"=c."cohortId" AND ident."cohortId"=c."cohortId"
    AND budget->>'version'='atlas-workspace-bridge-policy-v1' AND atlas_staff.workspace_pilot_ids_valid(budget->'workspaceCardIds')
    AND source."pilotId"::text=budget->>'pilotId' AND ident."pilotId"=source."pilotId"
    AND op."policyCanonical"::jsonb->>'pilotId'=budget->>'pilotId'
    AND c."expiresAt">at_time AND source."expiresAt">at_time AND ident."expiresAt">at_time
    AND (budget->>'expiresAt')::timestamptz>clock_timestamp()
    AND (op."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()) IS NOT TRUE THEN RETURN NEW; END IF;
  -- Never repair an unknown UUID, replace an active selection, or reuse a
  -- cohort whose one-card allowance has already been consumed. Only a roster
  -- consisting entirely of retained, retired-cohort cards is replaceable.
  IF (SELECT count(*) FROM atlas_staff."StaffWorkspaceCard" retired
      WHERE budget->'workspaceCardIds' ? retired.id::text AND retired."cohortId"<>c."cohortId")
      <>jsonb_array_length(budget->'workspaceCardIds')
    OR EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceCard" active WHERE active."cohortId"=c."cohortId"
      AND active.canonical::jsonb->>'startedAt' IS NOT NULL)
    OR EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" a WHERE a.event='WORKSPACE_FIRST_PAIR_ADMITTED'
      AND a.details::jsonb->>'cohortId'=c."cohortId"::text) THEN RETURN NEW; END IF;

  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."cardId" FOR UPDATE;
  SELECT * INTO actor FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  n:=w.canonical::jsonb;
  IF (w."cohortId"=c."cohortId" AND w.state='WAITING' AND w.stage='PHOTOS' AND w."specimenId" IS NULL
    AND (c.mode='LOCAL_FIXTURE' OR n#>>'{source,sourceType}'='SPEEDSTER')
    AND n->'claim'='null'::jsonb AND n->>'startedAt' IS NULL AND (n->>'captureRevision')::integer>0
    AND n->>'pairConfirmedAt'=q->>'createdAt' AND n->>'admittedAt' IS NOT NULL
    AND w."updatedAt"=NEW."createdAt" AND NEW."createdAt">=w."createdAt" AND NEW."createdAt"<=at_time
    AND (SELECT count(*) FROM atlas_staff."StaffWorkspaceCard" WHERE "cohortId"=c."cohortId")<=c."maxCards"
    AND actor.role='REVIEWER' AND actor."revokedAt" IS NULL
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffSession" s JOIN atlas_staff."StaffBrowser" browser ON browser."tokenHash"=s."browserHash"
      WHERE s."identityId"=actor.id AND s."revokedAt" IS NULL AND s."accessVersion"=actor."accessVersion"
        AND s."controlRevision"=staff.revision AND s."createdAt"<=NEW."createdAt" AND s."expiresAt">at_time
        AND browser."controlRevision"=staff.revision AND browser."createdAt"<=s."createdAt" AND browser."expiresAt">at_time)
    AND atlas_staff.workspace_manifest_canonical(n)=w.canonical AND atlas_staff.workspace_manifest_canonical(q)=NEW.canonical
    AND q->'result'=jsonb_build_object('cardId',w.id::text,'revision',w.revision,
      'captureRevision',(n->>'captureRevision')::integer,'captureHash',n->>'captureHash')
    AND NEW."inputHash"=encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(jsonb_build_object(
      'action','queue','cardId',w.id::text,'input',jsonb_build_object('operationId',NEW."operationId",
        'expectedRevision',w.revision-1,'pairConfirmed',true))),'UTF8')),'hex')
    AND atlas_staff.workspace_photos_verified(w.id) AND atlas_staff.workspace_identification_pair(w.id) IS NOT NULL)
    IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS first pair enrollment requires the exact verified human queue receipt'; END IF;
  -- Identity may still await an ordinary human correction. Admission preserves
  -- that pair; workspace_identity_ready continues to hold paid dispatch.
  FOREACH side IN ARRAY ARRAY['FRONT','BACK'] LOOP
    SELECT * INTO plan FROM atlas_staff."StaffWorkspaceOperation" WHERE id::text=n#>>ARRAY['sides',side,'uploadId'];
    SELECT * INTO verified FROM atlas_staff."StaffWorkspaceOperation" WHERE id::text=n#>>ARRAY['sides',side,'verificationId'];
    u:=plan.canonical::jsonb#>'{result,upload}';v:=verified.canonical::jsonb#>'{result,verification}';
    IF (plan."cardId"=w.id AND plan.action='upload-plan' AND verified."cardId"=w.id AND verified.action='upload-complete'
      AND atlas_staff.workspace_manifest_canonical(plan.canonical::jsonb)=plan.canonical
      AND atlas_staff.workspace_manifest_canonical(verified.canonical::jsonb)=verified.canonical
      AND u->>'id'=plan.id::text AND u->>'cardId'=w.id::text AND u->>'side'=side
      AND u->>'sourceId'=n#>>'{source,sourceId}' AND u->>'sourceOwnerId'=n#>>'{source,sourceOwnerId}'
      AND u->>'objectRef'='ai-grader-v2/'||(n#>>'{source,sourceOwnerId}')||'/'||(n#>>'{source,sourceId}')
        ||'/original/recapture-'||plan.id::text||'/'||lower(side)||'.'||CASE u->>'contentType'
          WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END
      AND verified.canonical::jsonb#>>'{result,uploadId}'=plan.id::text
      AND v->>'objectRef'=u->>'objectRef' AND v->>'sha256'=u->>'sha256' AND v->>'sha256' ~ '^[a-f0-9]{64}$'
      AND v->'byteCount'=u->'byteCount' AND (v->>'byteCount')::bigint BETWEEN 1 AND 52428800
      AND v->'contentType'=u->'contentType' AND (v->>'width')::integer BETWEEN 2 AND 16384
      AND (v->>'height')::integer BETWEEN 2 AND 16384 AND (v->>'width')::bigint*(v->>'height')::bigint<=67108864
      AND plan."createdAt"<=verified."createdAt" AND verified."createdAt"<=NEW."createdAt") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS first pair enrollment requires exact original upload provenance'; END IF;
    sides:=sides||jsonb_build_object(side,v||jsonb_build_object('uploadId',plan.id::text));
  END LOOP;
  IF n->>'captureHash' IS DISTINCT FROM encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(jsonb_build_object(
    'source',n->'source','captureRevision',(n->>'captureRevision')::integer,'sides',sides)),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'ATLAS first pair enrollment capture hash changed'; END IF;

  next_policy:=atlas_staff.workspace_manifest_canonical(budget||jsonb_build_object('workspaceCardIds',jsonb_build_array(w.id::text)));
  UPDATE atlas_staff."StaffGradingBridgeControl" SET "policyCanonical"=next_policy,
    "policyHash"=encode(sha256(convert_to(next_policy,'UTF8')),'hex'),revision=b.revision+1,"updatedAt"=at_time WHERE id='active';
  INSERT INTO atlas_staff."StaffAudit"(id,event,"subjectId","actorId",details,"createdAt") VALUES
    (gen_random_uuid(),'WORKSPACE_FIRST_PAIR_ADMITTED',w.id::text,NEW."actorId",
      atlas_staff.workspace_manifest_canonical(jsonb_build_object('version','atlas-workspace-first-pair-enrollment-v1',
        'cohortId',c."cohortId"::text,'pilotId',source."pilotId"::text,'cardId',w.id::text,
        'queueOperationId',NEW.id::text,'queueOperationHash',NEW."contentHash",'captureHash',n->>'captureHash',
        'workspaceControlRevision',c.revision,'sourceControlRevision',source.revision,'identificationControlRevision',ident.revision,
        'priorBridgeRevision',b.revision,'bridgeRevision',b.revision+1,'priorPolicyHash',b."policyHash",
        'policyHash',encode(sha256(convert_to(next_policy,'UTF8')),'hex'),'priorWorkspaceCardIds',budget->'workspaceCardIds',
        'workspaceCardIds',jsonb_build_array(w.id::text),'preservedPolicyHash',encode(sha256(convert_to(
          atlas_staff.workspace_manifest_canonical(budget-'workspaceCardIds'),'UTF8')),'hex'))),at_time);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.enroll_workspace_first_pair() FROM PUBLIC;
CREATE TRIGGER "StaffWorkspaceOperation_first_pair_enrollment" AFTER INSERT ON atlas_staff."StaffWorkspaceOperation"
  FOR EACH ROW WHEN (NEW.action='queue') EXECUTE FUNCTION atlas_staff.enroll_workspace_first_pair();

COMMIT;
