-- LOCAL UNREGISTERED PROPOSAL. Install after the unchanged ownership proposal
-- only in an explicitly owned qualification database. No role/grant/runtime.
-- A distinct serving role may execute this gateway only. The original combined
-- claim/transfer writer and all tables/helpers/sequences stay inaccessible.
CREATE SCHEMA atlas_ownership_preferences;
REVOKE ALL ON SCHEMA atlas_ownership_preferences FROM PUBLIC;

CREATE FUNCTION atlas_ownership_preferences.customer_call(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctl atlas_customer."CustomerControl"; actor atlas_customer."CustomerAccount"; fresh atlas_customer."CustomerAccount";
 saved atlas_ownership.event; result jsonb; card_value jsonb; current_value jsonb; names text[]; cid uuid; ih text;
 writing boolean; kind_name text;
BEGIN
 IF act IS NULL OR act NOT IN ('read_access','read_preferences','read_card','set_collection_preferences','set_card_preferences','recover_request') THEN
  RETURN atlas_customer.problem(403,'OWNERSHIP_PREFERENCES_ONLY');
 END IF;
 names:=CASE act WHEN 'read_access' THEN ARRAY[]::text[] WHEN 'read_preferences' THEN ARRAY[]::text[]
  WHEN 'read_card' THEN ARRAY['cardId'] WHEN 'recover_request' THEN ARRAY['requestId']
  WHEN 'set_collection_preferences' THEN ARRAY['requestId','expectedPreferenceRevision','visibility','offersDisabled']
  WHEN 'set_card_preferences' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','expectedPreferenceRevision','visibility','offersDisabled'] END;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 OR NOT d ?& names OR d-names<>'{}'::jsonb
  OR (act IN ('read_card','set_collection_preferences','set_card_preferences','read_preferences') AND atlas_ownership.input_valid(act,d) IS DISTINCT FROM true)
  OR (act='recover_request' AND (jsonb_typeof(d->'requestId') IS DISTINCT FROM 'string'
   OR NOT COALESCE(d->>'requestId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false))) THEN
  RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_PREFERENCES');
 END IF;
 IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR NOT binding ?& ARRAY['mode','origin','deploymentId','releaseSha','configHash']
  OR binding-ARRAY['mode','origin','deploymentId','releaseSha','configHash']<>'{}'::jsonb THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 SELECT * INTO actor FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF actor.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 writing:=act IN ('set_collection_preferences','set_card_preferences');
 IF writing OR act='recover_request' THEN
  -- Same serialization key as the immutable original writer. ABSENT is only a
  -- read observation, never proof that a delayed request cannot arrive later.
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-account:'||actor.id::text,0));
  SELECT * INTO fresh FROM atlas_customer.current_account(sh,bh,ctl.revision);
  IF fresh.id IS NULL OR fresh.id<>actor.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  SELECT * INTO saved FROM atlas_ownership.event WHERE customer_id=actor.id AND request_id=(d->>'requestId')::uuid;
  IF saved.id IS NOT NULL AND (saved.action NOT IN ('set_collection_preferences','set_card_preferences')
    OR saved.kind IS DISTINCT FROM (CASE saved.action WHEN 'set_collection_preferences' THEN 'COLLECTION_PREFERENCES_SET' ELSE 'CARD_PREFERENCES_SET' END)) THEN
   -- No claim, evidence, transfer or competing identity crosses this gateway.
   IF writing THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
   saved:=NULL;
  END IF;
  IF saved.id IS NOT NULL AND (atlas_ownership.input_valid(saved.action,saved.input) IS DISTINCT FROM true
   OR saved.request_id::text IS DISTINCT FROM saved.input->>'requestId'
   OR saved.card_id::text IS DISTINCT FROM saved.input->>'cardId'
   OR saved.preference_revision IS DISTINCT FROM (saved.input->>'expectedPreferenceRevision')::integer+1
   OR saved.input_hash IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('action',saved.action,'input',saved.input)::text,'UTF8')),'hex')) THEN
   RAISE EXCEPTION 'OWNERSHIP_PREFERENCES_RESPONSE_INVALID' USING ERRCODE='23514';
  END IF;
  IF writing THEN
   ih:=encode(sha256(convert_to(jsonb_build_object('action',act,'input',d)::text,'UTF8')),'hex');
   IF saved.id IS NOT NULL AND (saved.action<>act OR saved.input IS DISTINCT FROM d OR saved.input_hash<>ih) THEN
    RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT');
   END IF;
   IF saved.id IS NULL THEN
    -- SECURITY DEFINER preserves the explicit cookie proofs and release binding;
    -- the original function still performs live auth, title/discard/revision
    -- checks and its final expiry refresh. No caller account is accepted.
    result:=atlas_ownership.customer_call(sh,bh,binding,act,d);
    IF result ? 'error' THEN RETURN result; END IF;
    SELECT * INTO saved FROM atlas_ownership.event WHERE customer_id=actor.id AND request_id=(d->>'requestId')::uuid;
    kind_name:=CASE act WHEN 'set_collection_preferences' THEN 'COLLECTION_PREFERENCES_SET' ELSE 'CARD_PREFERENCES_SET' END;
    IF saved.id IS NULL OR saved.action<>act OR saved.kind<>kind_name OR saved.input IS DISTINCT FROM d OR saved.input_hash<>ih
     OR saved.preference_revision IS DISTINCT FROM (d->>'expectedPreferenceRevision')::integer+1 OR result->>'eventId' IS DISTINCT FROM saved.id::text THEN
     RAISE EXCEPTION 'OWNERSHIP_PREFERENCES_RESPONSE_INVALID' USING ERRCODE='23514';
    END IF;
   END IF;
  END IF;
  result:=jsonb_build_object('accountId',actor.id,'requestId',d->>'requestId','receipt',CASE WHEN saved.id IS NULL THEN NULL ELSE
   jsonb_build_object('eventId',saved.id,'requestId',saved.request_id,'action',saved.action,'kind',saved.kind,'cardId',saved.card_id,
    'input',saved.input,'preferenceRevision',saved.preference_revision,'recordedAt',to_char(saved.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END);
 ELSIF act='read_access' THEN
  result:=jsonb_build_object('accountId',actor.id);
 ELSIF act='read_preferences' THEN
  result:=jsonb_build_object('accountId',actor.id,'collectionPreferences',atlas_ownership.preferences(actor.id),'cardPreferences',NULL);
 ELSE
  cid:=(d->>'cardId')::uuid;
  -- Match original lock order. These locks fence title transfers and discard
  -- while the current-owner projection is built; preferences share one snapshot.
  PERFORM 1 FROM atlas_manual.card WHERE id=cid FOR SHARE;
  PERFORM 1 FROM atlas_manual.public_report_identity WHERE card_id=cid FOR SHARE;
  IF NOT FOUND THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  PERFORM 1 FROM atlas_manual_intake.card WHERE id=cid FOR SHARE;
  SELECT atlas_ownership.card_projection(cid,actor.id,ctl.mode) INTO card_value;
  IF card_value IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  current_value:=jsonb_build_object('cardId',cid,'ownershipRevision',card_value#>'{ownership,revision}',
   'revision',card_value->'cardPreferenceRevision','visibility',card_value->'cardVisibility','offersDisabled',card_value->'cardOffersDisabled');
  result:=jsonb_build_object('accountId',actor.id,'collectionPreferences',card_value->'collectionPreferences','cardPreferences',current_value);
 END IF;
 SELECT * INTO fresh FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF fresh.id IS NULL OR fresh.id<>actor.id THEN
  -- A nested write may already have appended an event. RAISE aborts this entire
  -- statement/transaction; returning an ordinary error JSON would commit it.
  RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='28000';
 END IF;
 RETURN result||jsonb_build_object('observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_preferences FROM PUBLIC;
