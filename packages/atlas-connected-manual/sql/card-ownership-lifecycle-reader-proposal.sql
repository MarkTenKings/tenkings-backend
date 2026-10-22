-- UNREGISTERED read-only customer proposal. Requires the v2 lifecycle/proof
-- proposals; it never delegates to the legacy workflow reader or a writer.
-- No roles, grants, policy changes or business writes. Row locks require a
-- normal transaction, not SET TRANSACTION READ ONLY. Installation is separate.
CREATE SCHEMA atlas_ownership_lifecycle_reader;
REVOKE ALL ON SCHEMA atlas_ownership_lifecycle_reader FROM PUBLIC;

CREATE FUNCTION atlas_ownership_lifecycle_reader.input_valid(act text,d jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE names text[]; k text;
BEGIN
 names:=CASE WHEN act IN ('read_access','configuration') THEN ARRAY[]::text[]
 WHEN act='resolve_certificate' THEN ARRAY['certificateNumber']
 WHEN act='read_claim' THEN ARRAY['claimId']
 WHEN act='list_claims' THEN ARRAY['afterClaimId','limit']
 WHEN act='list_history' THEN ARRAY['claimId','afterRevision','limit'] END;
 IF names IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>1024
 OR NOT d ?& names OR d-names<>'{}'::jsonb THEN RETURN false; END IF;
 IF d ? 'claimId' AND NOT atlas_ownership_proof.uuid(d->'claimId') THEN RETURN false; END IF;
 IF act='resolve_certificate' THEN RETURN COALESCE(jsonb_typeof(d->'certificateNumber')='string'
  AND d->>'certificateNumber' ~ '^ATLAS-[A-F0-9]{12}$',false); END IF;
 IF d ? 'limit' AND (jsonb_typeof(d->'limit') IS DISTINCT FROM 'number'
  OR NOT COALESCE(d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$',false)) THEN RETURN false; END IF;
 IF act='list_claims' THEN RETURN d->'afterClaimId'='null'::jsonb OR atlas_ownership_proof.uuid(d->'afterClaimId'); END IF;
 IF act='list_history' THEN
  IF jsonb_typeof(d->'afterRevision') IS DISTINCT FROM 'number'
  OR NOT COALESCE(d->>'afterRevision' ~ '^(0|[1-9][0-9]{0,9})$',false) THEN RETURN false; END IF;
  RETURN (d->>'afterRevision')::numeric<2147483647;
 END IF;
 RETURN true;
END $$;

-- Server-only policy facts. No notice, proof labels, retention or operational
-- storage readiness are invented here. The adapter supplies explicit UI config.
CREATE FUNCTION atlas_ownership_lifecycle_reader.configuration() RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p atlas_ownership_evidence.policy; u atlas_ownership_proof.policy; present boolean;
BEGIN
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 SELECT * INTO u FROM atlas_ownership_proof.policy WHERE id='active' FOR SHARE;
 present:=p.id IS NOT NULL AND u.id IS NOT NULL;
 RETURN jsonb_build_object('policiesPresent',present,'live',atlas_ownership_proof.live_policy(),
  'policyHash',CASE WHEN present THEN atlas_ownership_proof.digest(atlas_ownership_proof.policy_snapshot()) ELSE NULL END,
  'acceptedClaimKinds',COALESCE(to_jsonb(p.accepted_claim_kinds),'[]'::jsonb),
  'acceptedFormats',COALESCE(to_jsonb(u.accepted_formats),'[]'::jsonb));
END $$;

CREATE FUNCTION atlas_ownership_lifecycle_reader.customer_read(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor atlas_customer."CustomerAccount"; fresh atlas_customer."CustomerAccount";
 claim_row atlas_ownership.event; cid uuid; ids uuid[]; next_id uuid; lim integer;
 revisions integer[]; next_revision integer; result jsonb; value jsonb; can_submit boolean;
BEGIN
 IF act IS NULL OR act NOT IN ('read_access','configuration','resolve_certificate','list_claims','read_claim','list_history')
 THEN RETURN atlas_customer.problem(403,'OWNERSHIP_LIFECYCLE_READ_ONLY'); END IF;
 IF atlas_ownership_lifecycle_reader.input_valid(act,d) IS DISTINCT FROM true
 THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_LIFECYCLE_READ'); END IF;
 IF atlas_ownership_workflow.binding_valid(binding) IS DISTINCT FROM true
 THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 -- Same policy/account/card lock order as the v2 writer. Disabled or missing
 -- policies do not erase a customer's own historical claim.
 PERFORM 1 FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 PERFORM 1 FROM atlas_ownership_proof.policy WHERE id='active' FOR SHARE;
 SELECT * INTO actor FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF actor.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='resolve_certificate' THEN
  SELECT i.card_id INTO cid FROM atlas_manual.public_report_identity i WHERE i.report_number=d->>'certificateNumber';
  IF cid IS NULL OR NOT atlas_ownership_lifecycle.lock_card(cid,NULL,binding->>'mode',false)
  THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 ELSIF act IN ('list_claims','read_claim','list_history') THEN
  IF act='list_claims' THEN
   lim:=(d->>'limit')::integer;
   SELECT array_agg(q.id ORDER BY q.id) INTO ids FROM (
    SELECT e.id FROM atlas_ownership.event e WHERE e.customer_id=actor.id AND e.kind='CLAIM_SUBMITTED'
     AND (d->>'afterClaimId' IS NULL OR e.id>(d->>'afterClaimId')::uuid) ORDER BY e.id LIMIT lim+1)q;
   IF cardinality(ids)>lim THEN ids:=ids[1:lim]; next_id:=ids[lim]; END IF;
  ELSE
   SELECT * INTO claim_row FROM atlas_ownership.event e
    WHERE e.customer_id=actor.id AND e.kind='CLAIM_SUBMITTED' AND e.id=(d->>'claimId')::uuid;
   IF claim_row.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
   ids:=ARRAY[claim_row.id];
  END IF;
  FOR cid IN SELECT DISTINCT e.card_id FROM atlas_ownership.event e
   WHERE e.id=ANY(COALESCE(ids,'{}'::uuid[])) AND e.customer_id=actor.id ORDER BY e.card_id LOOP
   -- Keep historical receipts when discarded/unavailable. The projection marks
   -- CARD_UNAVAILABLE instead of returning a private or stale published source.
   IF NOT atlas_ownership_lifecycle.lock_card(cid,NULL,binding->>'mode',true)
   THEN RETURN atlas_customer.problem(503,'OWNERSHIP_LIFECYCLE_READ_UNAVAILABLE'); END IF;
  END LOOP;
 END IF;
 -- Lock acquisition can wait past session or browser expiry.
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF fresh.id IS NULL OR fresh.id<>actor.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='read_access' THEN result:='{}'::jsonb;
 ELSIF act='configuration' THEN result:=jsonb_build_object('configuration',atlas_ownership_lifecycle_reader.configuration());
 ELSIF act='resolve_certificate' THEN
  value:=atlas_ownership_workflow.card_binding(cid,binding->>'mode');
  IF value IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  can_submit:=atlas_ownership_proof.live_policy() AND atlas_ownership.current_title(cid)->>'status'='UNKNOWN'
   AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event e WHERE e.card_id=cid AND e.customer_id=actor.id
    AND e.kind='CLAIM_SUBMITTED' AND atlas_ownership_lifecycle.state(e.id)->>'state'='PENDING');
  can_submit:=COALESCE(can_submit,false);
  result:=jsonb_build_object('card',value,'canSubmit',can_submit,'expectedOwnershipRevision',CASE WHEN can_submit THEN 0 ELSE NULL END);
 ELSIF act='list_claims' THEN
  SELECT jsonb_build_object('claims',COALESCE(jsonb_agg(atlas_ownership_lifecycle.claim_projection(e.id,actor.id,false,binding->>'mode') ORDER BY e.id),'[]'::jsonb),
   'nextClaimId',next_id) INTO result FROM atlas_ownership.event e
   WHERE e.id=ANY(COALESCE(ids,'{}'::uuid[])) AND e.customer_id=actor.id AND e.kind='CLAIM_SUBMITTED';
 ELSE
  value:=atlas_ownership_lifecycle.claim_projection(claim_row.id,actor.id,false,binding->>'mode');
  IF value IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
  result:=jsonb_build_object('claim',value);
  IF act='list_history' THEN
   lim:=(d->>'limit')::integer;
   SELECT array_agg(q.revision ORDER BY q.revision) INTO revisions FROM (
    SELECT t.revision FROM atlas_ownership_lifecycle.transition t
     WHERE t.claim_id=claim_row.id AND t.revision>(d->>'afterRevision')::integer ORDER BY t.revision LIMIT lim+1)q;
   IF cardinality(revisions)>lim THEN revisions:=revisions[1:lim]; next_revision:=revisions[lim]; END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('claimRevision',t.revision,'action',t.action,'state',t.state,
    'bundleId',t.bundle_id,'occurredAt',t.created_at) ORDER BY t.revision),'[]'::jsonb) INTO value
    FROM atlas_ownership_lifecycle.transition t WHERE t.claim_id=claim_row.id AND t.revision=ANY(COALESCE(revisions,'{}'::integer[]));
   -- Actual v2 transitions only. Legacy origin is explicit; no invented v2
   -- submit event or fallback to the legacy workflow status/receipt projector.
   result:=result||jsonb_build_object('submittedAt',claim_row.created_at,
    'origin',CASE WHEN claim_row.input->>'schema'='atlas-ownership-proof-claim-v2' THEN 'PROOF_V2' ELSE 'LEGACY_V1' END,
    'transitions',value,'nextRevision',next_revision);
  END IF;
 END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF fresh.id IS NULL OR fresh.id<>actor.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 -- Refresh time-sensitive capability hints after projection too. They never
 -- authorize a mutation; v2 gateways always check again on the actual request.
 IF act='configuration' THEN result:=jsonb_build_object('configuration',atlas_ownership_lifecycle_reader.configuration()); END IF;
 IF act='resolve_certificate' AND NOT atlas_ownership_proof.live_policy() THEN
  result:=result||jsonb_build_object('canSubmit',false,'expectedOwnershipRevision',NULL);
 END IF;
 RETURN result||jsonb_build_object('actorId',actor.id,'observedAt',clock_timestamp());
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_lifecycle_reader FROM PUBLIC;
