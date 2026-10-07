BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- An unspecified capture shape stays null in its immutable manifest. Only the
-- deterministic MACHINE selection uses the existing SAVE_IDENTITY preparation
-- default, with explicit PREPARATION_DEFAULT provenance. All original source,
-- receipt recovery, lease, evidence, identity, geometry and worker checks remain.
-- This replaces the current 20260910090000 function with only that null-shape
-- gate and expected-result calculation changed. No existing rows are rewritten.

CREATE OR REPLACE FUNCTION atlas_staff.assert_capture_operator_commit(run_id uuid,event_table text,event_id uuid,is_admission boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE;
  b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; sc atlas_staff."StaffControl"%ROWTYPE;
  step atlas_staff."StaffOperatorStep"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE;
  outbox atlas_staff."StaffOperatorOutbox"%ROWTYPE; receipt jsonb; p jsonb; m jsonb; selected jsonb; ref jsonb; proposed atlas_staff."StaffOperatorStep"%ROWTYPE;
  request_json jsonb; field_json jsonb; evidence_refs jsonb:='[]'::jsonb; asset_ref jsonb;
  expected_identity jsonb; expected_boundaries jsonb:='[]'::jsonb; identity_ref jsonb:='null'::jsonb;
  proposed_request jsonb; expected_ref jsonb; expected_result jsonb; selected_boundary jsonb;
  xs numeric[]; ys numeric[]; point_json jsonb; idx integer; next_idx integer; after_idx integer; double_area numeric;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  p:=c."policyCanonical"::jsonb; m:=r."manifestCanonical"::jsonb;
  IF (c.enabled AND b.enabled AND sc.enabled AND c.mode=b.mode AND c.mode=sc.mode
    AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND p->>'pilotId'=r."pilotId"::text AND b."policyCanonical"::jsonb->>'pilotId'=r."pilotId"::text
    AND b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
    AND b."policyCanonical"::jsonb->'workspaceCardIds' ? r."workspaceCardId"::text
    AND jsonb_typeof(p->'captureTools')='array' AND jsonb_array_length(p->'captureTools')>0
    AND jsonb_array_length(p->'captureTools')<=5
    AND (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'captureTools'))=jsonb_array_length(p->'captureTools')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'captureTools') t WHERE t NOT IN
      ('read_original_photos','inspect_region','propose_capture_identity','propose_physical_boundary','submit_capture_preparation'))
    AND (p->>'expiresAt')::timestamptz>clock_timestamp() AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND r."deadlineAt">clock_timestamp() AT TIME ZONE 'UTC' AND atlas_staff.operator_workspace_count(r."pilotId")=jsonb_array_length(b."policyCanonical"::jsonb->'workspaceCardIds')
    AND atlas_staff.operator_capture_current(r.id)) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS capture operator requires current fresh-photo authority'; END IF;
  IF is_admission THEN
    IF r.state<>'QUEUED' OR r.revision<>1 OR r."expectedAnalysisRevision"<>0 OR r."expectedReviewRevision"<>0 THEN
      RAISE EXCEPTION 'ATLAS capture operator starts without a report'; END IF;
    RETURN;
  END IF;
  IF event_table='StaffOperatorStep' THEN SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE id=event_id;
  ELSIF event_table='StaffOperatorAttempt' THEN SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=event_id;
  ELSE SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND revision=r.revision; END IF;
  SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=step."attemptId";
  SELECT canonical::jsonb INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=a."resultReceiptId";
  IF (step.id IS NOT NULL AND a.state='APPLIED' AND a."runId"=r.id AND a."runRevision"+1=step.revision AND r.revision=step.revision
    AND step."nextInputHash"=r."inputHash" AND atlas_staff.operator_attempt_fence_matches(r.id,a.id,r."leaseFence") AND r."leaseMode"='WORK'
    AND r."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND a."usageCeilingMicroUsd" IS NOT NULL AND NOT a."usageEnvelopeExceeded"
    AND receipt->>'state'='RECEIVED' AND receipt->>'httpStatus'='200' AND receipt->'body'->>'status'='completed'
    AND receipt->'body'->>'model'='gpt-6-astra' AND receipt->'body'->>'service_tier'='default'
    AND p->'captureTools' ? step."toolName"
    AND step."toolName" IN ('read_original_photos','inspect_region','propose_capture_identity','propose_physical_boundary','submit_capture_preparation')
    AND (SELECT count(*) FROM jsonb_array_elements(receipt->'body'->'output') call WHERE call->>'type'='function_call')=1
    AND step."requestCanonical"::jsonb->>'runId'=r.id::text AND step."requestCanonical"::jsonb->>'manifestHash'=r."manifestHash"
    AND step."requestCanonical"::jsonb->>'evidenceHash'=r."evidenceHash"
    AND (step."requestCanonical"::jsonb->>'expectedRevision')::integer=a."runRevision"
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'body'->'output') call
      WHERE call->>'type'='function_call' AND call->>'call_id'=step."callId" AND call->>'name'=step."toolName"
        AND (call->>'arguments')::jsonb=step."requestCanonical"::jsonb)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS capture tool and its original provider receipt must commit atomically'; END IF;
  request_json:=step."requestCanonical"::jsonb;
  selected:=step."resultCanonical"::jsonb->'result';
  IF (step."resultCanonical"::jsonb->'binding'=jsonb_build_object('runId',r.id,'evidenceHash',r."evidenceHash",
    'manifestHash',r."manifestHash",'expectedRevision',step.revision)
    AND step."resultCanonical"::jsonb-ARRAY['binding','result']='{}'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS capture result binding changed'; END IF;
  IF step."toolName"='read_original_photos' THEN
    IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision']='{}'::jsonb
      AND selected=jsonb_build_object('actor','MACHINE','phase','CAPTURE_REVIEW','identity',m->'identity',
        'cornerShape',m->'cornerShape','assets',m->'assets','status','ORIGINAL_PHOTOS_DELIVERED','preparation','NOT_STARTED')
      AND (SELECT count(*) FROM atlas_staff."StaffOperatorImage" WHERE "stepId"=step.id AND "runId"=r.id)=2
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE NOT EXISTS
        (SELECT 1 FROM atlas_staff."StaffOperatorImage" i WHERE i."stepId"=step.id AND i."runId"=r.id
          AND i.canonical::jsonb->'asset'=asset AND i.canonical::jsonb->'request'->>'purpose'='OVERVIEW'))) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture original read requires both actual recorded images'; END IF;
  ELSIF step."toolName"='inspect_region' THEN
    IF NOT atlas_staff.operator_outside_crop_matches(r.id,step.id) AND (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','assetId','sourceSha256','side','rect']='{}'::jsonb
      AND selected=jsonb_build_object('assetId',request_json->'assetId','rect',request_json->'rect')
      AND (SELECT count(*) FROM atlas_staff."StaffOperatorImage" WHERE "stepId"=step.id AND "runId"=r.id)=1
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImage" i WHERE i."stepId"=step.id AND i."runId"=r.id
        AND i.canonical::jsonb->'request'=request_json||jsonb_build_object('purpose','CROP'))) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture region inspection requires its actual recorded crop'; END IF;
  ELSIF step."toolName" IN ('propose_capture_identity','propose_physical_boundary') THEN
    IF (selected=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION',
        'proposal',jsonb_build_object('stepId',step.id,'requestHash',step."requestHash"))
      AND jsonb_typeof(request_json->'summary')='string' AND length(request_json->>'summary') BETWEEN 1 AND 500) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture proposal provenance changed'; END IF;
    IF step."toolName"='propose_capture_identity' THEN
      IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','fields','summary']='{}'::jsonb
        AND jsonb_typeof(request_json->'fields')='array' AND jsonb_array_length(request_json->'fields') BETWEEN 1 AND 9
        AND (SELECT count(DISTINCT f->>'field') FROM jsonb_array_elements(request_json->'fields') f)=jsonb_array_length(request_json->'fields')) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture identity proposal fields changed'; END IF;
      FOR field_json IN SELECT value FROM jsonb_array_elements(request_json->'fields') LOOP
        IF (field_json-ARRAY['field','value','evidence']='{}'::jsonb AND field_json ? 'value'
          AND (field_json->'value'='null'::jsonb OR jsonb_typeof(field_json->'value')='string' AND length(field_json->>'value') BETWEEN 1 AND 160)
          AND (m->'identity'->>'category'='SPORTS' AND field_json->>'field' IN ('playerName','year','manufacturer','productSet','parallel','insert','cardNumber')
            OR m->'identity'->>'category'='POKEMON' AND field_json->>'field' IN ('cardName','year','productSet','parallel','cardNumber','layoutType'))
          AND (field_json->>'field'<>'layoutType' OR field_json->'value'='null'::jsonb OR field_json->>'value' IN ('POKEMON','TRAINER','ENERGY'))
          AND jsonb_typeof(field_json->'evidence')='array' AND jsonb_array_length(field_json->'evidence') BETWEEN 1 AND 12) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture identity category or evidence changed'; END IF;
        evidence_refs:=evidence_refs||(field_json->'evidence');
      END LOOP;
    ELSE
      IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','side','corners','matColor','evidence','summary']='{}'::jsonb
        AND request_json->>'side' IN ('FRONT','BACK') AND request_json->>'matColor' IN ('BLACK','WHITE','MAGENTA')
        AND jsonb_typeof(request_json->'corners')='array' AND jsonb_array_length(request_json->'corners')=4
        AND jsonb_typeof(request_json->'evidence')='array' AND jsonb_array_length(request_json->'evidence') BETWEEN 1 AND 12) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal shape changed'; END IF;
      xs:='{}';ys:='{}';double_area:=0;
      FOR point_json IN SELECT value FROM jsonb_array_elements(request_json->'corners') LOOP
        IF (point_json-ARRAY['x','y']='{}'::jsonb AND jsonb_typeof(point_json->'x')='number' AND jsonb_typeof(point_json->'y')='number'
          AND (point_json->>'x')::numeric BETWEEN 0 AND 1 AND (point_json->>'y')::numeric BETWEEN 0 AND 1) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture physical proposal point invalid'; END IF;
        xs:=array_append(xs,(point_json->>'x')::numeric);ys:=array_append(ys,(point_json->>'y')::numeric);
      END LOOP;
      FOR idx IN 1..4 LOOP
        next_idx:=idx%4+1;after_idx:=next_idx%4+1;
        double_area:=double_area+xs[idx]*ys[next_idx]-ys[idx]*xs[next_idx];
        IF (xs[next_idx]-xs[idx])*(ys[after_idx]-ys[next_idx])-(ys[next_idx]-ys[idx])*(xs[after_idx]-xs[next_idx])<=0 THEN
          RAISE EXCEPTION 'ATLAS capture physical proposal must be convex'; END IF;
      END LOOP;
      IF NOT (ys[1]<ys[4] AND ys[2]<ys[3] AND xs[1]<xs[2] AND xs[4]<xs[3] AND double_area>0.02) THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal corner order invalid'; END IF;
      evidence_refs:=request_json->'evidence';
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(evidence_refs) e WHERE e->>'side' IS DISTINCT FROM request_json->>'side') THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal side changed'; END IF;
    END IF;
    FOR asset_ref IN SELECT value FROM jsonb_array_elements(evidence_refs) LOOP
      IF (asset_ref-ARRAY['assetId','sha256','side']='{}'::jsonb
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE asset->>'assetId'=asset_ref->>'assetId'
          AND asset->>'sha256'=asset_ref->>'sha256' AND asset->>'side'=asset_ref->>'side')
        AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImageDelivery" d JOIN atlas_staff."StaffOperatorImage" i ON i."imageId"=d."imageId"
          WHERE d."attemptId"=a.id AND d."requestHash"=a."requestHash" AND d."lineageHash"=i.hash AND i."runId"=r.id
            AND i.canonical::jsonb->'asset'->>'assetId'=asset_ref->>'assetId'
            AND i.canonical::jsonb->'asset'->>'sha256'=asset_ref->>'sha256' AND i.canonical::jsonb->'asset'->>'side'=asset_ref->>'side')) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture proposal requires its actual delivered original evidence'; END IF;
    END LOOP;
  END IF;
  IF r.state IN ('PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT') THEN
    SELECT * INTO outbox FROM atlas_staff."StaffOperatorOutbox" WHERE "runId"=r.id AND revision=r.revision;
    IF (step."toolName"='submit_capture_preparation' AND outbox.id IS NOT NULL
      AND outbox.type=CASE r.state WHEN 'PREPARATION_READY' THEN 'CAPTURE_PREPARATION_READY' ELSE 'OPERATOR_ATTENTION_REQUIRED' END
      AND outbox.payload::jsonb->>'version'='atlas-operator-capture-handoff-v1' AND outbox.payload::jsonb->>'actor'='MACHINE'
      AND outbox.payload::jsonb->>'runId'=r.id::text AND outbox.payload::jsonb->>'workspaceCardId'=r."workspaceCardId"::text
      AND outbox.payload::jsonb->>'captureHash'=r."evidenceHash" AND outbox.payload::jsonb->>'claimFence'=m->>'claimFence'
      AND outbox.payload::jsonb->>'captureRevision'=m->>'captureRevision' AND (outbox.payload::jsonb->>'revision')::integer=r.revision
      AND outbox.payload::jsonb->>'selectionStepId'=step.id::text AND outbox.payload::jsonb->>'selectionResultHash'=step."resultHash"
      AND outbox.payload::jsonb->>'disposition'=r.state AND outbox.payload::jsonb->>'summary'=r.summary
      AND request_json->>'summary'=r.summary
      AND r.state=CASE request_json->>'disposition' WHEN 'READY_FOR_PREPARATION' THEN 'PREPARATION_READY'
        WHEN 'NEEDS_RECAPTURE' THEN 'NEEDS_RECAPTURE' WHEN 'NEEDS_EXPERT' THEN 'NEEDS_EXPERT' END
      AND request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','disposition','identityProposal','boundaries','summary']='{}'::jsonb
      AND jsonb_typeof(request_json->'summary')='string' AND length(request_json->>'summary') BETWEEN 1 AND 500) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture handoff must bind its exact machine selection'; END IF;
    IF r.state='PREPARATION_READY' THEN
      IF (jsonb_typeof(request_json->'boundaries')='array' AND jsonb_array_length(request_json->'boundaries')=2
        AND (SELECT count(DISTINCT boundary->>'side') FROM jsonb_array_elements(request_json->'boundaries') boundary)=2
        AND request_json ? 'identityProposal' AND m ? 'cornerShape'
        AND (m->'cornerShape'='null'::jsonb OR m->>'cornerShape' IN ('SQUARE','ROUNDED_3_18_MM'))
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE NOT EXISTS
          (SELECT 1 FROM atlas_staff."StaffOperatorImageDelivery" d JOIN atlas_staff."StaffOperatorImage" i ON i."imageId"=d."imageId"
            WHERE d."attemptId"=a.id AND d."requestHash"=a."requestHash" AND d."lineageHash"=i.hash
              AND i."runId"=r.id AND i.canonical::jsonb->'asset'=asset))) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture selection needs both boundaries and delivered originals'; END IF;
      expected_identity:=m->'identity';
      IF request_json->'identityProposal'<>'null'::jsonb THEN
        ref:=request_json->'identityProposal';
        SELECT * INTO proposed FROM atlas_staff."StaffOperatorStep" WHERE id::text=ref->>'stepId' AND "runId"=r.id
          AND "toolName"='propose_capture_identity' AND revision<step.revision AND "requestHash"=ref->>'requestHash';
        IF (proposed.id IS NOT NULL AND ref=jsonb_build_object('stepId',proposed.id,'requestHash',proposed."requestHash")
          AND proposed."resultCanonical"::jsonb->'result'=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION','proposal',ref)) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture selection identity proposal changed'; END IF;
        FOR field_json IN SELECT value FROM jsonb_array_elements(proposed."requestCanonical"::jsonb->'fields') LOOP
          expected_identity:=jsonb_set(expected_identity,ARRAY[field_json->>'field'],field_json->'value',true);
        END LOOP;
        identity_ref:=ref||jsonb_build_object('resultHash',proposed."resultHash");
      END IF;
      FOR selected_boundary IN SELECT value FROM jsonb_array_elements(request_json->'boundaries') LOOP
        ref:=selected_boundary->'proposal';
        SELECT * INTO proposed FROM atlas_staff."StaffOperatorStep" WHERE id::text=ref->>'stepId' AND "runId"=r.id
          AND "toolName"='propose_physical_boundary' AND revision<step.revision AND "requestHash"=ref->>'requestHash';
        proposed_request:=proposed."requestCanonical"::jsonb;
        IF (selected_boundary-ARRAY['side','proposal']='{}'::jsonb AND selected_boundary->>'side' IN ('FRONT','BACK')
          AND proposed.id IS NOT NULL AND ref=jsonb_build_object('stepId',proposed.id,'requestHash',proposed."requestHash")
          AND proposed_request->>'side'=selected_boundary->>'side'
          AND proposed."resultCanonical"::jsonb->'result'=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION','proposal',ref)) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture selection physical proposal changed'; END IF;
        expected_boundaries:=expected_boundaries||jsonb_build_array(jsonb_build_object('side',selected_boundary->'side',
          'corners',proposed_request->'corners','matColor',proposed_request->'matColor',
          'proposal',ref||jsonb_build_object('resultHash',proposed."resultHash")));
      END LOOP;
      expected_result:=jsonb_build_object('version','atlas-machine-capture-selection-v1','actor','MACHINE','runId',r.id,
        'workspaceCardId',r."workspaceCardId",'captureHash',r."evidenceHash",'captureRevision',m->'captureRevision',
        'claimId',m->'claimId','claimFence',m->'claimFence','workflowRevision',m->'workflowRevision',
        'manifestHash',r."manifestHash",'identity',expected_identity,'identityProposal',identity_ref,'cornerShape',coalesce(m->>'cornerShape','ROUNDED_3_18_MM'),
        'boundaries',expected_boundaries,'printedFrameSelection','REQUIRE_VALIDATED_WORKER_PROPOSAL','status','PENDING_ORIGINAL_PREPARATION')
        ||CASE WHEN m->'cornerShape'='null'::jsonb THEN jsonb_build_object('cornerShapeBasis','PREPARATION_DEFAULT') ELSE '{}'::jsonb END;
      IF selected IS DISTINCT FROM expected_result THEN RAISE EXCEPTION 'ATLAS capture selection must equal its exact recorded machine proposals'; END IF;
    ELSIF selected IS DISTINCT FROM jsonb_build_object('actor','MACHINE','status','PREPARATION_ATTENTION_REQUIRED','disposition',request_json->'disposition') THEN
      RAISE EXCEPTION 'ATLAS capture attention cannot claim successful preparation';
    END IF;
  END IF;
  IF event_table='StaffOperatorOutbox' AND outbox.id IS DISTINCT FROM event_id THEN
    RAISE EXCEPTION 'ATLAS capture outbox cannot invent a handoff'; END IF;
END $$;

REVOKE ALL ON FUNCTION atlas_staff.assert_capture_operator_commit(uuid,text,uuid,boolean) FROM PUBLIC;
COMMIT;
