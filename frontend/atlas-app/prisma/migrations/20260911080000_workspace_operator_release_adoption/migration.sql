BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- Deployment maintenance is database-owner authority, never a staff/model
-- capability, an invented human command, or permission to repeat a request.
CREATE FUNCTION atlas_staff.assert_operator_release_adoption_owner() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='atlas_staff."StaffOperatorRun"'::regclass;
  IF session_user IS DISTINCT FROM owner_name OR current_user IS DISTINCT FROM owner_name THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_OWNER_REQUIRED'; END IF;
END $$;

CREATE FUNCTION atlas_staff.operator_release_adoption_binding(run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r jsonb; w jsonb; controls jsonb; ledger jsonb;
BEGIN
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  SELECT to_jsonb(x)-ARRAY['inputCanonical','manifestCanonical','policyCanonical'] INTO r
    FROM atlas_staff."StaffOperatorRun" x WHERE id=run_id;
  SELECT to_jsonb(x)-'canonical' INTO w FROM atlas_staff."StaffWorkspaceCard" x WHERE id::text=r->>'workspaceCardId';
  SELECT jsonb_build_object(
    'StaffControl',(SELECT to_jsonb(x) FROM atlas_staff."StaffControl" x WHERE id='active'),
    'StaffWorkspaceControl',(SELECT to_jsonb(x) FROM atlas_staff."StaffWorkspaceControl" x WHERE id='active'),
    'StaffWorkspaceSourceControl',(SELECT to_jsonb(x)-'policyCanonical' FROM atlas_staff."StaffWorkspaceSourceControl" x WHERE id='active'),
    'StaffGradingBridgeControl',(SELECT to_jsonb(x)-'policyCanonical' FROM atlas_staff."StaffGradingBridgeControl" x WHERE id='active'),
    'StaffOperatorImageControl',(SELECT to_jsonb(x) FROM atlas_staff."StaffOperatorImageControl" x WHERE id='active'),
    'StaffOperatorControl',(SELECT to_jsonb(x)-'policyCanonical' FROM atlas_staff."StaffOperatorControl" x WHERE id='active'),
    'StaffWorkspaceIdentificationControl',(SELECT to_jsonb(x)-'policyCanonical' FROM atlas_staff."StaffWorkspaceIdentificationControl" x WHERE id='active')) INTO controls;
  SELECT jsonb_build_object(
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'requestCanonical' ORDER BY x.ordinal),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorAttempt" x WHERE "runId"=run_id),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'canonical' ORDER BY x.id),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorReceipt" x JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=x."attemptId" WHERE a."runId"=run_id),
    'steps',(SELECT coalesce(jsonb_agg(to_jsonb(x)-ARRAY['requestCanonical','resultCanonical'] ORDER BY x.revision),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorStep" x WHERE "runId"=run_id),
    'images',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'canonical' ORDER BY x."imageId"),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorImage" x WHERE "runId"=run_id),
    'deliveries',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."attemptId",x."imageId"),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorImageDelivery" x JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=x."attemptId" WHERE a."runId"=run_id)) INTO ledger;
  RETURN jsonb_build_object('version','atlas-operator-release-adoption-binding-v1','run',r,'card',w,'controls',controls,'ledger',ledger,
    'runHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(r),'UTF8')),'hex'),
    'cardHash',w->>'contentHash','controlsHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(controls),'UTF8')),'hex'),
    'ledgerHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(ledger),'UTF8')),'hex'));
END $$;

CREATE FUNCTION atlas_staff.operator_release_adoption_plan(run_id uuid,maintenance_id uuid,reason text,at_time timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE;
  sc atlas_staff."StaffControl"%ROWTYPE; wc atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  op atlas_staff."StaffOperatorControl"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  before_value jsonb; after_value jsonb; new_run jsonb; new_card jsonb; card_value jsonb; card_text text;
  policy jsonb; budget jsonb; outage_start timestamp; new_deadline timestamp; remaining interval; expiry timestamp;
BEGIN
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  PERFORM atlas_staff.lock_workspace_private_controls();
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id FOR UPDATE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId" FOR UPDATE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active';
  SELECT * INTO wc FROM atlas_staff."StaffWorkspaceControl" WHERE id='active';
  SELECT * INTO op FROM atlas_staff."StaffOperatorControl" WHERE id='active';
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active';
  policy:=op."policyCanonical"::jsonb; budget:=b."policyCanonical"::jsonb;
  IF (maintenance_id IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500 AND reason !~ '[\x01-\x1f\x7f]'
    AND at_time<=clock_timestamp() AT TIME ZONE 'UTC' AND at_time>=clock_timestamp() AT TIME ZONE 'UTC'-interval '1 minute'
    AND r.phase='CAPTURE_REVIEW' AND r.state='RUNNING' AND r."controlState"='RUNNING' AND r."executionMode"='CONTINUOUS'
    AND r."stepBudget"=0 AND r.revision>1 AND r."controlRevision"<2147483646 AND w.revision<2147483646
    AND r."specimenId" IS NULL AND r."initializationId" IS NULL AND r."failureCode" IS NULL
    AND r."leaseExpiresAt" IS NOT NULL AND r."leaseExpiresAt"<=at_time AND r."updatedAt"<=at_time
    AND op.enabled AND sc.enabled AND wc.enabled AND b.enabled AND wc."claimsEnabled" AND wc."astraEnabled" AND wc."preparationEnabled"
    AND op.mode=sc.mode AND op.mode=wc.mode AND op.mode=b.mode
    AND op."releaseSha"=sc."releaseSha" AND op."releaseSha"=wc."releaseSha" AND op."releaseSha"=b."releaseSha"
    AND r."runtimeHash"<>op."configHash" AND r."policyHash"=op."policyHash" AND r."policyCanonical"=op."policyCanonical"
    AND r."gradingPolicyHash"=sc."gradingPolicyHash" AND r."gradingPolicyHash"=b."gradingPolicyHash"
    AND r."pilotId"::text=policy->>'pilotId' AND r."pilotId"::text=budget->>'pilotId'
    AND budget->>'version'='atlas-workspace-bridge-policy-v1' AND budget->'workspaceCardIds' ? w.id::text
    AND atlas_staff.operator_workspace_count(r."pilotId")=jsonb_array_length(budget->'workspaceCardIds')
    AND w."cohortId"=wc."cohortId" AND w.state='IN_PROGRESS' AND w."specimenId" IS NULL
    AND coalesce(w.canonical::jsonb#>'{workspace,pending}','null'::jsonb)='null'::jsonb AND w.canonical::jsonb->>'startedAt' IS NOT NULL
    AND w.canonical::jsonb#>>'{claim,kind}'='ASTRA' AND w.canonical::jsonb#>>'{claim,runId}'=r.id::text
    AND (w.canonical::jsonb#>>'{claim,controlRevision}')::integer<sc.revision
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" i WHERE i.id::text=w.canonical::jsonb#>>'{claim,actorId}'
      AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."accessVersion"::text=w.canonical::jsonb#>>'{claim,accessVersion}')
    AND r."inputHash"=encode(sha256(convert_to(r."inputCanonical",'UTF8')),'hex')
    AND r."manifestHash"=encode(sha256(convert_to(r."manifestCanonical",'UTF8')),'hex')
    AND r."policyHash"=encode(sha256(convert_to(r."policyCanonical",'UTF8')),'hex')
    AND atlas_staff.operator_capture_current(r.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" x WHERE x."pilotId"=r."pilotId"
      AND x."leaseOwner" IS NOT NULL AND x."leaseExpiresAt">at_time)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=r.id OR "cardId"=w.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=r.id OR "cardId"=w.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffMachineInitialization" WHERE "specimenId"=w.id)
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id)=r.revision-1
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id)=r.revision-1
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a WHERE a."runId"=r.id AND (
      a.state<>'APPLIED' OR a."providerBindingHash"<>op."providerBindingHash" OR a."dispatchedAt" IS NULL
      OR a."finishedAt" IS NULL OR a."usageCeilingMicroUsd" IS NULL OR a."usageEnvelopeExceeded"
      OR (SELECT count(*) FROM atlas_staff."StaffOperatorReceipt" receipt WHERE receipt."attemptId"=a.id)<>1
      OR NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorReceipt" receipt JOIN atlas_staff."StaffOperatorStep" s
        ON s."attemptId"=a.id AND s."runId"=r.id AND s.revision=a."runRevision"+1
        WHERE receipt.id=a."resultReceiptId" AND receipt."attemptId"=a.id AND receipt.canonical::jsonb->>'state'='RECEIVED'
          AND receipt.canonical::jsonb->>'httpStatus'='200' AND receipt.hash=encode(sha256(convert_to(receipt.canonical,'UTF8')),'hex')
          AND s."requestHash"=encode(sha256(convert_to(s."requestCanonical",'UTF8')),'hex')
          AND s."resultHash"=encode(sha256(convert_to(s."resultCanonical",'UTF8')),'hex'))))
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND revision=r.revision AND "nextInputHash"=r."inputHash")
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" WHERE id=maintenance_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_NOT_AVAILABLE'; END IF;
  outage_start:=greatest(r."updatedAt",r."leaseExpiresAt");
  remaining:=least(r."deadlineAt"-outage_start,(policy->>'maxRunMs')::integer*interval '1 millisecond');
  expiry:=least(wc."expiresAt",(policy->>'expiresAt')::timestamptz AT TIME ZONE 'UTC',
    (budget->>'expiresAt')::timestamptz AT TIME ZONE 'UTC');
  new_deadline:=least(expiry,at_time+remaining);
  IF remaining<=interval '0' OR new_deadline<=at_time THEN RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_TIME_EXHAUSTED'; END IF;
  -- Keep the existing 16 KiB StaffAudit bound. The protected rollout census
  -- contains the complete bindings; this immutable proof retains their hashes.
  before_value:=atlas_staff.operator_release_adoption_binding(r.id)-ARRAY['controls','ledger'];
  new_run:=before_value->'run'||jsonb_build_object('runtimeHash',op."configHash",'controlState','PAUSED',
    'controlRevision',r."controlRevision"+1,'stepBudget',0,'leaseOwner',NULL,'leaseMode',NULL,'leaseExpiresAt',NULL,
    'deadlineAt',new_deadline,'updatedAt',at_time);
  card_value:=w.canonical::jsonb||jsonb_build_object('revision',w.revision+1,
    'claim',w.canonical::jsonb->'claim'||jsonb_build_object('controlRevision',sc.revision),
    'updatedAt',to_char(at_time,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  card_text:=atlas_staff.workspace_manifest_canonical(card_value);
  new_card:=before_value->'card'||jsonb_build_object('revision',w.revision+1,'updatedAt',at_time,
    'contentHash',encode(sha256(convert_to(card_text,'UTF8')),'hex'));
  after_value:=before_value||jsonb_build_object('run',new_run,'card',new_card,
    'runHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(new_run),'UTF8')),'hex'),'cardHash',new_card->>'contentHash');
  RETURN jsonb_build_object('version','atlas-operator-release-adoption-v1','auditId',maintenance_id,'runId',r.id,'workspaceCardId',w.id,
    'reason',reason,'createdAt',at_time,'before',before_value,'after',after_value,
    'timing',jsonb_build_object('outageStart',outage_start,'outageEnd',at_time,'oldDeadlineAt',r."deadlineAt",'newDeadlineAt',new_deadline,
      'remainingActiveMs',floor(extract(epoch FROM remaining)*1000),'excludedOutageMs',floor(extract(epoch FROM (at_time-outage_start))*1000),
      'maxRunMs',(policy->>'maxRunMs')::integer,'expiryCap',expiry));
END $$;

CREATE FUNCTION atlas_staff.operator_release_adoption_audit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE d jsonb:=NEW.details::jsonb; expected jsonb;
BEGIN
  IF NEW.event<>'ATLAS_OPERATOR_RELEASE_ADOPTED' THEN RETURN NEW; END IF;
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  expected:=atlas_staff.operator_release_adoption_plan((d->>'runId')::uuid,NEW.id,d->>'reason',NEW."createdAt");
  IF NEW."actorId" IS NOT NULL OR NEW."subjectId" IS DISTINCT FROM d->>'workspaceCardId'
    OR d IS DISTINCT FROM expected OR NEW.details<>atlas_staff.workspace_manifest_canonical(expected) THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_PROOF_CHANGED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffAudit_operator_release_adoption" BEFORE INSERT ON "StaffAudit"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_release_adoption_audit_guard();

CREATE FUNCTION atlas_staff.operator_release_adoption_run_matches(old_run atlas_staff."StaffOperatorRun",new_run atlas_staff."StaffOperatorRun") RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE d jsonb;
BEGIN
  SELECT details::jsonb INTO d FROM atlas_staff."StaffAudit" WHERE event='ATLAS_OPERATOR_RELEASE_ADOPTED'
    AND details::jsonb->>'runId'=new_run.id::text AND xmin::text=pg_current_xact_id()::text;
  IF d IS NULL THEN RETURN false; END IF;
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  IF (to_jsonb(old_run)-ARRAY['inputCanonical','manifestCanonical','policyCanonical']) IS DISTINCT FROM d#>'{before,run}'
    OR (to_jsonb(new_run)-ARRAY['inputCanonical','manifestCanonical','policyCanonical']) IS DISTINCT FROM d#>'{after,run}'
    OR (new_run."inputCanonical",new_run."manifestCanonical",new_run."policyCanonical")
      IS DISTINCT FROM (old_run."inputCanonical",old_run."manifestCanonical",old_run."policyCanonical") THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_RUN_CHANGED'; END IF;
  RETURN true;
END $$;

CREATE FUNCTION atlas_staff.operator_release_adoption_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE d jsonb:=NEW.details::jsonb; actual jsonb;
BEGIN
  IF NEW.event<>'ATLAS_OPERATOR_RELEASE_ADOPTED' THEN RETURN NULL; END IF;
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  actual:=atlas_staff.operator_release_adoption_binding((d->>'runId')::uuid)-ARRAY['controls','ledger'];
  IF actual IS DISTINCT FROM d->'after' THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_ATOMICITY_REQUIRED'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffAudit_operator_release_adoption_commit" AFTER INSERT ON "StaffAudit"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_release_adoption_commit_guard();

CREATE FUNCTION atlas_staff.adopt_workspace_operator_release(run_id uuid,maintenance_id uuid,expected_run_hash text,
  expected_card_hash text,expected_controls_hash text,reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE plan jsonb; at_time timestamp(3):=date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC'); n jsonb; w jsonb; d jsonb; card_value jsonb; card_text text;
BEGIN
  PERFORM atlas_staff.assert_operator_release_adoption_owner();
  plan:=atlas_staff.operator_release_adoption_plan(run_id,maintenance_id,reason,at_time);
  IF (expected_run_hash=plan#>>'{before,runHash}' AND expected_card_hash=plan#>>'{before,cardHash}'
    AND expected_controls_hash=plan#>>'{before,controlsHash}') IS NOT TRUE THEN
    RAISE EXCEPTION 'ASTRA_RELEASE_ADOPTION_COMPARE_FAILED'; END IF;
  INSERT INTO atlas_staff."StaffAudit"(id,event,"subjectId","actorId",details,"createdAt")
    VALUES(maintenance_id,'ATLAS_OPERATOR_RELEASE_ADOPTED',plan->>'workspaceCardId',NULL,atlas_staff.workspace_manifest_canonical(plan),at_time);
  n:=plan#>'{after,run}'; w:=plan#>'{after,card}'; d:=plan->'timing';
  SELECT canonical::jsonb INTO card_value FROM atlas_staff."StaffWorkspaceCard" WHERE id::text=plan->>'workspaceCardId';
  card_value:=card_value||jsonb_build_object('revision',w->'revision','claim',card_value->'claim'||jsonb_build_object(
    'controlRevision',(SELECT revision FROM atlas_staff."StaffControl" WHERE id='active')),
    'updatedAt',to_char(at_time,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  card_text:=atlas_staff.workspace_manifest_canonical(card_value);
  UPDATE atlas_staff."StaffOperatorRun" SET "runtimeHash"=n->>'runtimeHash',"controlState"='PAUSED',
    "controlRevision"=(n->>'controlRevision')::integer,"stepBudget"=0,"leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,
    "deadlineAt"=(n->>'deadlineAt')::timestamp,"updatedAt"=at_time WHERE id=run_id;
  UPDATE atlas_staff."StaffWorkspaceCard" SET revision=(w->>'revision')::integer,canonical=card_text,
    "contentHash"=w->>'contentHash',"updatedAt"=at_time WHERE id::text=plan->>'workspaceCardId';
  RETURN jsonb_build_object('status','WORKSPACE_OPERATOR_RELEASE_ADOPTED','auditId',maintenance_id,'runId',run_id,
    'workspaceCardId',plan->>'workspaceCardId','state','PAUSED','oldRuntimeHash',plan#>>'{before,run,runtimeHash}',
    'newRuntimeHash',n->>'runtimeHash','oldCardRevision',plan#>'{before,card,revision}','cardRevision',w->'revision',
    'oldControlRevision',plan#>'{before,run,controlRevision}','controlRevision',n->'controlRevision',
    'inputHash',n->>'inputHash','manifestHash',n->>'manifestHash','timing',d,'controlsHash',expected_controls_hash,
    'proofHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(plan),'UTF8')),'hex'));
END $$;

REVOKE ALL ON FUNCTION atlas_staff.assert_operator_release_adoption_owner(),atlas_staff.operator_release_adoption_binding(uuid),
  atlas_staff.operator_release_adoption_plan(uuid,uuid,text,timestamp),atlas_staff.operator_release_adoption_audit_guard(),
  atlas_staff.operator_release_adoption_run_matches(atlas_staff."StaffOperatorRun",atlas_staff."StaffOperatorRun"),
  atlas_staff.operator_release_adoption_commit_guard(),atlas_staff.adopt_workspace_operator_release(uuid,uuid,text,text,text,text) FROM PUBLIC;

-- The existing run guard and timing history are composed below without
-- altering any prior recovery, receipt, lease, authority or budget branch.

CREATE OR REPLACE FUNCTION atlas_staff.operator_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC'; g jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' OR NEW.revision<>1 OR NEW."leaseFence"<>0 OR NEW."leaseOwner" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS operator requires a fresh queue entry'; END IF;
    RETURN NEW;
  END IF;
  IF atlas_staff.operator_release_adoption_run_matches(OLD,NEW) THEN RETURN NEW; END IF;
  -- A late abandoned response remains financial evidence only, even if a
  -- compromised machine caller attempts a run update in the same transaction.
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a WHERE a."runId"=NEW.id AND a.state='ABANDONED'
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttemptAbandonment" proof
      WHERE proof."attemptId"=a.id AND proof.xmin::text=pg_current_xact_id()::text)
    AND (a.xmin::text=pg_current_xact_id()::text OR EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorReceipt" receipt
      WHERE receipt."attemptId"=a.id AND receipt.xmin::text=pg_current_xact_id()::text))) THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'ASTRA_ABANDONED_RECEIPT_NO_RUN_AUTHORITY'; END IF;
  END IF;
  IF OLD.state IN ('UNKNOWN','RUNNING','WAITING_TOOL') AND NEW.state='RUNNING'
    AND NEW."controlRevision"=OLD."controlRevision"+1 THEN
    SELECT canonical::jsonb INTO g FROM atlas_staff."StaffOperatorAttemptAbandonment"
      WHERE "runId"=NEW.id AND "runRevision"=OLD.revision AND "leaseFence"=OLD."leaseFence"
        AND "controlRevision"=NEW."controlRevision" AND xmin::text=pg_current_xact_id()::text;
    IF g IS NOT NULL THEN
      IF ((to_jsonb(NEW)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        = (to_jsonb(OLD)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        AND OLD.phase='CAPTURE_REVIEW' AND (OLD."leaseOwner" IS NULL OR OLD."leaseExpiresAt"<=now_at)
        AND OLD."controlState"<>'TAKEN_OVER' AND NEW."leaseOwner" IS NULL AND NEW."leaseMode" IS NULL AND NEW."leaseExpiresAt" IS NULL
        AND NEW."controlState"='RUNNING' AND NEW."executionMode"='STEP' AND NEW."stepBudget"=1 AND NEW."failureCode" IS NULL
        AND g->>'oldRuntimeHash'=OLD."runtimeHash" AND g->>'newRuntimeHash'=NEW."runtimeHash"
        AND (g->>'oldDeadlineAt')::timestamptz=OLD."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'newDeadlineAt')::timestamptz=NEW."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'oldUpdatedAt')::timestamptz=OLD."updatedAt" AT TIME ZONE 'UTC'
        AND (g->>'createdAt')::timestamptz=NEW."updatedAt" AT TIME ZONE 'UTC'
        AND g#>>'{binding,run,inputHash}'=OLD."inputHash" AND g#>>'{binding,run,evidenceHash}'=OLD."evidenceHash"
        AND g#>>'{binding,run,manifestHash}'=OLD."manifestHash" AND g#>>'{binding,run,policyHash}'=OLD."policyHash"
        AND g#>>'{binding,run,gradingPolicyHash}'=OLD."gradingPolicyHash" AND NEW."deadlineAt">now_at) IS NOT TRUE THEN
        RAISE EXCEPTION 'ASTRA_ABANDONMENT_GENERATION_CHANGED'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  -- Only the scoped RPC can insert this grant. The same-transaction
  -- deferred proof requires its owner command and updated card claim.
  IF OLD.state IN ('UNKNOWN','WAITING_TOOL') AND NEW.state='WAITING_TOOL'
    AND NEW."controlRevision"=OLD."controlRevision"+1 THEN
    SELECT canonical::jsonb INTO g FROM atlas_staff."StaffOperatorRecovery"
      WHERE "runId"=NEW.id AND "runRevision"=OLD.revision AND "leaseFence"=OLD."leaseFence"+1
        AND canonical::jsonb->>'controlRevision'=NEW."controlRevision"::text
        AND xmin::text=pg_current_xact_id()::text;
    IF g IS NOT NULL THEN
      IF ((to_jsonb(NEW)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        = (to_jsonb(OLD)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        AND (OLD."leaseOwner" IS NULL OR OLD."leaseExpiresAt"<=now_at) AND OLD."controlState"<>'TAKEN_OVER'
        AND NEW."leaseOwner" IS NULL AND NEW."leaseMode" IS NULL AND NEW."leaseExpiresAt" IS NULL
        AND NEW."controlState"='RUNNING' AND NEW."executionMode"='CONTINUOUS' AND NEW."stepBudget"=0 AND NEW."failureCode" IS NULL
        AND g->>'oldRuntimeHash'=OLD."runtimeHash" AND g->>'newRuntimeHash'=NEW."runtimeHash"
        AND (g->>'oldDeadlineAt')::timestamptz=OLD."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'newDeadlineAt')::timestamptz=NEW."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'oldUpdatedAt')::timestamptz=OLD."updatedAt" AT TIME ZONE 'UTC'
        AND (g->>'createdAt')::timestamptz=NEW."updatedAt" AT TIME ZONE 'UTC'
        AND g->>'inputHash'=OLD."inputHash" AND g->>'evidenceHash'=OLD."evidenceHash"
        AND g->>'manifestHash'=OLD."manifestHash" AND g->>'policyHash'=OLD."policyHash"
        AND g->>'gradingPolicyHash'=OLD."gradingPolicyHash" AND NEW."deadlineAt">now_at) IS NOT TRUE THEN
        RAISE EXCEPTION 'ASTRA_RECOVERY_GENERATION_CHANGED'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt','controlState','controlRevision','executionMode','stepBudget'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt','controlState','controlRevision','executionMode','stepBudget'])
    OR NEW.revision NOT IN (OLD.revision,OLD.revision+1)
    OR (NEW.revision=OLD.revision AND (NEW."inputCanonical",NEW."inputHash") IS DISTINCT FROM (OLD."inputCanonical",OLD."inputHash"))
    OR OLD.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED') THEN
      RAISE EXCEPTION 'ATLAS operator scope or completed run is immutable'; END IF;
  IF NEW."controlRevision" NOT IN (OLD."controlRevision",OLD."controlRevision"+1)
    OR (NEW."controlRevision"=OLD."controlRevision" AND
      (NEW."controlState",NEW."executionMode",NEW."stepBudget") IS DISTINCT FROM
      (OLD."controlState",OLD."executionMode",OLD."stepBudget")) THEN
    RAISE EXCEPTION 'ATLAS operator control revision required'; END IF;
  IF OLD.state='PREPARATION_READY' THEN
    IF NEW.revision<>OLD.revision OR NEW."leaseFence"<>OLD."leaseFence"
      OR NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner",NEW."leaseMode",NEW."leaseExpiresAt")
        IS DISTINCT FROM (OLD."leaseOwner",OLD."leaseMode",OLD."leaseExpiresAt")
      OR NEW.summary IS DISTINCT FROM OLD.summary THEN
      RAISE EXCEPTION 'ATLAS settled capture cannot execute another model action'; END IF;
    IF NEW.state='PREPARATION_READY' AND NEW."failureCode" IS NOT DISTINCT FROM OLD."failureCode" THEN RETURN NEW; END IF;
    IF NEW.state='FAILED' AND NEW."controlState"='TAKEN_OVER' AND NEW."failureCode"='ASTRA_HUMAN_TAKEOVER'
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=NEW.id
        AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN RETURN NEW; END IF;
    IF NEW.state='UNKNOWN' AND NEW."failureCode"='ASTRA_CONFLICTING_RECEIPT'
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorReceipt" receipt
        JOIN atlas_staff."StaffOperatorAttempt" attempt ON attempt.id=receipt."attemptId"
        WHERE attempt."runId"=NEW.id AND attempt.state='APPLIED' AND receipt.id<>attempt."resultReceiptId"
          AND receipt.xmin::text=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'ATLAS settled capture requires a recorded human control or conflicting receipt';
  END IF;
  -- Sole new exception: same revision/fence/input and an exact current human
  -- resolution, written with its audit in this transaction. Attempts stay held.
  IF OLD.state='UNKNOWN' AND NEW.state='FAILED' THEN
    PERFORM atlas_staff.resolution_for_target('ASTRA',NEW.id);
    IF (to_jsonb(NEW)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      OR NEW."leaseOwner" IS NOT NULL OR NEW."leaseMode" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."failureCode" IS DISTINCT FROM 'HUMAN_ABANDONED_UNAPPLIED'
      OR NEW.summary IS DISTINCT FROM 'Human abandoned unapplied automation; inspection or recapture required.' THEN
      RAISE EXCEPTION 'ATLAS abandoned run must retain its exact unapplied ledger'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' THEN RAISE EXCEPTION 'ATLAS uncertain work requires separate reconciliation'; END IF;
  IF NEW.state='FAILED' AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=NEW.id
    AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN RAISE EXCEPTION 'ATLAS unresolved attempt cannot be discarded'; END IF;
  IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseExpiresAt">now_at+interval '60 seconds'
    OR NEW."leaseExpiresAt">NEW."deadlineAt") THEN RAISE EXCEPTION 'ATLAS operator lease is unbounded'; END IF;
  IF NEW."leaseFence"=OLD."leaseFence"+1 THEN
    IF OLD."leaseExpiresAt">now_at OR NEW."leaseOwner" IS NULL OR NEW."leaseExpiresAt"<=now_at OR NEW.revision<>OLD.revision
      OR (OLD.state='UNKNOWN' AND NEW."leaseMode"<>'RECONCILE_ONLY') THEN RAISE EXCEPTION 'ATLAS operator lease cannot be stolen'; END IF;
  ELSIF NEW."leaseFence"=OLD."leaseFence" THEN
    IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner",NEW."leaseMode") IS DISTINCT FROM (OLD."leaseOwner",OLD."leaseMode") THEN
      RAISE EXCEPTION 'ATLAS operator lease fence required'; END IF;
    IF NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt" AND NEW."leaseExpiresAt" IS NOT NULL AND OLD."leaseExpiresAt"<=now_at THEN
      RAISE EXCEPTION 'ATLAS expired lease cannot be renewed'; END IF;
    IF NEW.revision>OLD.revision AND (OLD."leaseExpiresAt"<=now_at OR OLD."leaseMode"<>'WORK') THEN
      RAISE EXCEPTION 'ATLAS stale lease cannot apply work'; END IF;
  ELSE RAISE EXCEPTION 'ATLAS operator lease fence invalid'; END IF;
  IF NEW.state IN ('READY_FOR_HUMAN','PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT') AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS handoff requires an immutable step'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.workspace_timing_history(workspace_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
WITH runs AS MATERIALIZED (
  SELECT r.* FROM atlas_staff."StaffOperatorRun" r WHERE r."workspaceCardId"=workspace_id
), operations AS MATERIALIZED (
  SELECT o.id,o."createdAt",o.action,o.canonical::jsonb->'result' AS result
  FROM atlas_staff."StaffWorkspaceOperation" o WHERE o."cardId"=workspace_id
), events AS (
  SELECT "createdAt" AS at,0 AS ordering,id::text AS tie,
    jsonb_build_object('kind','STAGE','stage',CASE WHEN result#>>'{claim,kind}'='ASTRA' THEN 'PHOTOS' ELSE 'IDENTITY' END,'active',true) AS body
  FROM operations WHERE action='claim'
  UNION ALL
  SELECT s."createdAt",1,s.id::text,jsonb_build_object('kind','STAGE','stage',
    CASE s."toolName" WHEN 'read_original_photos' THEN 'IDENTITY' WHEN 'propose_capture_identity' THEN 'PREPARATION'
      WHEN 'propose_physical_boundary' THEN 'PREPARATION' WHEN 'submit_capture_preparation' THEN 'PREPARATION'
      WHEN 'read_card_report' THEN 'INSPECTION' WHEN 'inspect_card_geometry' THEN 'CENTERING' WHEN 'measure_centering' THEN 'INSPECTION'
      WHEN 'inspect_finding' THEN 'INSPECTION' WHEN 'propose_finding_change' THEN 'INSPECTION'
      WHEN 'propose_identity' THEN 'IDENTITY' WHEN 'submit_for_human_review' THEN 'REVIEW'
      ELSE CASE WHEN r.phase='CAPTURE_REVIEW' THEN 'IDENTITY' ELSE 'INSPECTION' END END,
    'active',s."toolName"<>'submit_for_human_review',
    'reason',CASE WHEN s."toolName"='submit_for_human_review' THEN
      CASE WHEN s."requestCanonical"::jsonb->>'disposition'='READY_FOR_REVIEW' THEN 'HUMAN_REVIEW' ELSE 'NEEDS_ATTENTION' END ELSE NULL END)
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
  UNION ALL
  SELECT s."createdAt",2,s.id::text||'-step-pause',jsonb_build_object('kind','PAUSE','reason','PAUSED')
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
  WHERE s."toolName" NOT IN ('submit_for_human_review','submit_capture_preparation') AND
    (SELECT CASE WHEN o.action='claim' THEN o.result#>>'{claim,mode}' ELSE o.result#>>'{control,mode}' END
     FROM operations o WHERE o."createdAt"<=s."createdAt" AND
       (o.action='claim' AND o.result#>>'{claim,runId}'=r.id::text OR o.action='OPERATOR_CONTROL'
        AND o.result->>'runId'=r.id::text AND o.result->>'action' IN ('RESUME','STEP','RECOVER','ABANDON_AND_STEP'))
     ORDER BY o."createdAt" DESC,o.id DESC LIMIT 1)='STEP'
  UNION ALL
  -- Attribute the final report request to Report once its outcome is recorded.
  SELECT a."createdAt",0,s.id::text||'-report',jsonb_build_object('kind','STAGE','stage','REPORT','active',true)
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
    JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=s."attemptId"
  WHERE s."toolName"='submit_for_human_review'
  UNION ALL
  SELECT CASE WHEN o.result->>'action'='PAUSE' AND o.result#>>'{control,state}'='PAUSE_REQUESTED'
      THEN settled.at ELSE o."createdAt" END,2,o.id::text,
    jsonb_build_object('kind',CASE WHEN o.result->>'action'='PAUSE' THEN 'PAUSE' ELSE 'RESUME' END,
      'reason',CASE WHEN o.result->>'action'='PAUSE' THEN 'PAUSED' ELSE NULL END)
  FROM operations o LEFT JOIN LATERAL (
    SELECT min(s."createdAt") AS at FROM atlas_staff."StaffOperatorStep" s
    WHERE s."runId"::text=o.result->>'runId' AND s."createdAt">=o."createdAt"
      AND NOT EXISTS(SELECT 1 FROM operations newer WHERE newer.action='OPERATOR_CONTROL'
        AND newer.result->>'runId'=o.result->>'runId' AND newer.result->>'action' IN ('RESUME','STEP','RECOVER','ABANDON_AND_STEP')
        AND newer."createdAt">o."createdAt" AND newer."createdAt"<s."createdAt")
  ) settled ON true
  WHERE o.action='OPERATOR_CONTROL' AND o.result->>'action' IN ('PAUSE','RESUME','STEP','RECOVER','ABANDON_AND_STEP')
    AND (o.result->>'action'<>'PAUSE' OR o.result#>>'{control,state}'<>'PAUSE_REQUESTED' OR settled.at IS NOT NULL)
  UNION ALL
  SELECT "createdAt",2,id::text,jsonb_build_object('kind','STAGE','stage','REVIEW','active',result->>'action'='START',
    'reason',CASE WHEN result->>'action'='START' THEN NULL ELSE 'PAUSED' END)
  FROM operations WHERE action='REVIEW_SESSION' AND result->>'action' IN ('START','PAUSE')
  UNION ALL
  SELECT "createdAt",1,id::text,jsonb_build_object('kind','STAGE','stage',
    CASE WHEN result->>'action' IN ('INITIALIZE_REPORT','RESOLVE_MAP','REGISTER_MAP','CONTINUE_WITHOUT_MAP') THEN 'INSPECTION'
      WHEN result->>'action'='SAVE_CENTERING' THEN 'CENTERING' WHEN result->>'action'='SAVE_IDENTITY' THEN 'IDENTITY'
      ELSE 'PREPARATION' END,'active',true)
  FROM operations WHERE action IN ('MANUAL_ACTION','MACHINE_SOURCE_ACTION')
  UNION ALL
  SELECT "createdAt",1,id::text,jsonb_build_object('kind','STAGE','stage','INSPECTION','active',true)
  FROM operations WHERE action='MACHINE_REPORT_SUCCESSOR'
  UNION ALL
  SELECT r."updatedAt",9,r.id::text,jsonb_build_object('kind','PAUSE','reason',
    CASE WHEN r.state='READY_FOR_HUMAN' THEN 'HUMAN_REVIEW'
      WHEN r.state IN ('UNKNOWN','FAILED','NEEDS_EXPERT','NEEDS_RECAPTURE') THEN 'NEEDS_ATTENTION' ELSE 'PAUSED' END)
  FROM runs r WHERE r.state IN ('UNKNOWN','FAILED','NEEDS_EXPERT','NEEDS_RECAPTURE','READY_FOR_HUMAN') OR r."controlState"='PAUSED'
  UNION ALL
  SELECT a."approvedAt",10,a.id::text,jsonb_build_object('kind','STAGE','stage','FINISHING','active',false,'reason','COMPLETED')
  FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffPublicReport" p ON p."specimenId"=w."specimenId"
    JOIN atlas_staff."StaffReportApproval" a ON a.id=p."currentApprovalId" WHERE w.id=workspace_id
  UNION ALL
  SELECT (a.details::jsonb#>>'{timing,outageStart}')::timestamp,8,a.id::text,
    jsonb_build_object('kind','PAUSE','reason','PAUSED')
  FROM atlas_staff."StaffAudit" a WHERE a.event='ATLAS_OPERATOR_RELEASE_ADOPTED' AND a."subjectId"=workspace_id::text
), bounded AS (
  SELECT * FROM events ORDER BY at,ordering,tie LIMIT 1025
)
SELECT jsonb_build_object('asOf',clock_timestamp(),'events',coalesce(jsonb_agg(body||jsonb_build_object('at',at AT TIME ZONE 'UTC','order',ordering) ORDER BY at,ordering,tie),'[]'::jsonb)) FROM bounded;
$$;


CREATE OR REPLACE FUNCTION atlas_staff.workspace_operator_control_transition_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF atlas_staff.operator_release_adoption_run_matches(OLD,NEW) THEN RETURN NULL; END IF;
  IF (NEW."controlState",NEW."executionMode",NEW."stepBudget",NEW."controlRevision") IS NOT DISTINCT FROM
    (OLD."controlState",OLD."executionMode",OLD."stepBudget",OLD."controlRevision") THEN RETURN NULL; END IF;
  -- The machine may consume one previously authorized step in the same
  -- transaction as the one exact dispatch. It cannot grant itself another.
  IF NEW."controlState"=OLD."controlState" AND NEW."controlState"='RUNNING'
    AND NEW."executionMode"=OLD."executionMode" AND NEW."executionMode"='STEP'
    AND OLD."stepBudget"=1 AND NEW."stepBudget"=0 AND NEW.revision=OLD.revision
    AND NEW."controlRevision"=OLD."controlRevision"+1
    AND EXISTS (SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a WHERE a."runId"=NEW.id
      AND a.state='DISPATCHED' AND a."runRevision"=OLD.revision AND a."leaseFence"=OLD."leaseFence"
      AND a.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  -- A completed action may honor a previously requested pause or stop after
  -- the one step. The existing deferred commit proof still owns application.
  IF OLD."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND NEW."controlState"='PAUSED'
    AND (OLD."controlState"='PAUSE_REQUESTED' OR OLD."executionMode"='STEP' AND OLD."stepBudget"=0)
    AND NEW."executionMode"=OLD."executionMode" AND NEW."stepBudget"=0
    AND NEW.revision=OLD.revision+1 AND NEW."controlRevision"=OLD."controlRevision"+1
    AND EXISTS (SELECT 1 FROM atlas_staff."StaffOperatorStep" s WHERE s."runId"=NEW.id
      AND s.revision=NEW.revision AND s.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  -- One workflow request consumes one permit, including its two bounded
  -- preparation workers. It cannot fund a second request or provider attempt.
  IF OLD.state='PREPARATION_READY' AND NEW.state=OLD.state AND NEW.revision=OLD.revision
    AND NEW."executionMode"=OLD."executionMode" AND NEW."controlRevision"=OLD."controlRevision"+1 THEN
    IF OLD."controlState"='RUNNING' AND NEW."controlState"='RUNNING' AND OLD."executionMode"='STEP'
      AND OLD."stepBudget"=1 AND NEW."stepBudget"=0 AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" p
        WHERE p."runId"=NEW.id AND p."runRevision"=OLD.revision AND p."runControlRevision"=OLD."controlRevision"
          AND p.mode='STEP' AND p.state='ACTIVE' AND p.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
    IF OLD."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND NEW."controlState"='PAUSED'
      AND (OLD."controlState"='PAUSE_REQUESTED' OR OLD."executionMode"='STEP' AND OLD."stepBudget"=0)
      AND NEW."stepBudget"=0 AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" p
        WHERE p."runId"=NEW.id AND p."runRevision"=OLD.revision AND p.state IN ('SUCCEEDED','FAILED')
          AND (p.xmin::text=pg_current_xact_id()::text OR OLD."controlState"='PAUSE_REQUESTED' AND EXISTS(
            SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" result
            JOIN atlas_staff."StaffWorkspaceOperation" intent ON intent.id=p."requestId"
            JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=p."cardId"
            WHERE result."cardId"=w.id AND result."actorId"=intent."actorId" AND result.action='MACHINE_SOURCE_RESULT'
              AND result."operationId"='source-result_'||p."requestId"::text AND result.xmin::text=pg_current_xact_id()::text
              AND result.canonical::jsonb#>>'{result,actor}'='MACHINE' AND result.canonical::jsonb#>>'{result,runId}'=NEW.id::text
              AND result.canonical::jsonb#>>'{result,requestId}'=p."requestId"::text AND result.canonical::jsonb#>>'{result,state}'=p.state
              AND result.canonical::jsonb#>>'{result,action}'=intent.canonical::jsonb#>>'{result,action}'
              AND result.canonical::jsonb#>'{result,side}' IS NOT DISTINCT FROM intent.canonical::jsonb#>'{result,payload,side}'
              AND result.canonical::jsonb#>>'{result,captureHash}'=p."captureHash"
              AND result.canonical::jsonb#>>'{result,claimFence}'=p."claimFence"::text
              AND result.canonical::jsonb#>>'{result,selectionStepId}'=p."selectionStepId"::text
              AND result.canonical::jsonb#>>'{result,selectionResultHash}'=p."selectionResultHash"
              AND result.canonical::jsonb#>>'{result,revision}'=w.revision::text
              AND w.canonical::jsonb#>'{workspace,pending}' IS NULL AND w.canonical::jsonb#>>'{claim,kind}'='ASTRA'
              AND w.canonical::jsonb#>>'{claim,runId}'=NEW.id::text AND w.canonical::jsonb#>>'{claim,actorId}'=intent."actorId"::text
              AND w.canonical::jsonb->>'claimFence'=p."claimFence"::text AND w.canonical::jsonb->>'captureHash'=p."captureHash"
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" other
                WHERE other."runId"=NEW.id AND other.state IN ('ACTIVE','UNKNOWN'))
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" operation
                WHERE operation."runId"=NEW.id AND operation.state IN ('RESERVED','DISPATCHED','UNKNOWN'))
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" attempt
                WHERE attempt."runId"=NEW.id AND attempt.state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))))) THEN RETURN NULL; END IF;
  END IF;
  -- Every other control transition comes from the current human RPC and its
  -- immutable workspace action. A stolen runner credential cannot resume work.
  IF EXISTS (SELECT 1 FROM atlas_staff."StaffAudit" a WHERE a.event='WORKSPACE_OPERATOR_CONTROL'
    AND a.details::jsonb->>'runId'=NEW.id::text
    AND a.details::jsonb->>'previousControlRevision'=OLD."controlRevision"::text
    AND a.details::jsonb->>'controlRevision'=NEW."controlRevision"::text
    AND a.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'ATLAS operator control requires an exact human action or settled step';
END $$;

COMMIT;
