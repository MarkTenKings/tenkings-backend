-- FUTURE PROPOSAL ONLY. Not registered, not included in SQL009, not granted by
-- serving startup. Qualify in a harness-owned database before any integration.
-- Existing permanent card identity, accounts, grading and custody remain owners
-- of their data. This journal records reviewed title, never a sale/payment.
CREATE SCHEMA atlas_ownership;
REVOKE ALL ON SCHEMA atlas_ownership FROM PUBLIC;

CREATE TABLE atlas_ownership.reviewer_authority (
 staff_id uuid PRIMARY KEY REFERENCES atlas_staff."StaffIdentity"(id),
 -- Explicitly reviewed identity binding; staff/customer use different phone
 -- hashes, so matching hashes would not establish an independent reviewer.
 customer_account_id uuid NOT NULL UNIQUE REFERENCES atlas_customer."CustomerAccount"(id),
 authorization_reference text NOT NULL CHECK(length(authorization_reference) BETWEEN 1 AND 200),
 authorized_until timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE atlas_ownership.event (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 card_id uuid REFERENCES atlas_manual.public_report_identity(card_id),
 customer_id uuid REFERENCES atlas_customer."CustomerAccount"(id),
 staff_id uuid REFERENCES atlas_staff."StaffIdentity"(id),
 request_id uuid NOT NULL, action text NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=4096),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('CLAIM_SUBMITTED','CLAIM_VERIFIED','CLAIM_REJECTED','TRANSFER_PROPOSED','TRANSFER_ACCEPTED','TRANSFER_CANCELED','CARD_PREFERENCES_SET','COLLECTION_PREFERENCES_SET')),
 subject_id uuid REFERENCES atlas_ownership.event(id),
 owner_account_id uuid REFERENCES atlas_customer."CustomerAccount"(id),
 ownership_revision integer, preference_revision integer, expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((customer_id IS NULL)<>(staff_id IS NULL)),
 CHECK(CASE WHEN kind IN ('CLAIM_VERIFIED','TRANSFER_ACCEPTED') THEN owner_account_id IS NOT NULL AND ownership_revision IS NOT NULL AND ownership_revision>0
       ELSE owner_account_id IS NULL AND ownership_revision IS NULL END),
 CHECK((kind='COLLECTION_PREFERENCES_SET')=(card_id IS NULL)),
 UNIQUE(customer_id,request_id), UNIQUE(staff_id,request_id)
);
CREATE INDEX ownership_card_history ON atlas_ownership.event(card_id,sequence DESC);
CREATE INDEX ownership_current_lookup ON atlas_ownership.event(card_id,sequence DESC) WHERE kind IN ('CLAIM_VERIFIED','TRANSFER_ACCEPTED');
CREATE INDEX ownership_customer_preferences ON atlas_ownership.event(customer_id,sequence DESC) WHERE kind='COLLECTION_PREFERENCES_SET';
CREATE INDEX ownership_subject ON atlas_ownership.event(subject_id,kind);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership.event FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE FUNCTION atlas_ownership.input_valid(act text,d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE names text[]; k text;
BEGIN
 names:=CASE act
 WHEN 'read_card' THEN ARRAY['cardId'] WHEN 'read_collection' THEN ARRAY['afterCardId','limit'] WHEN 'read_preferences' THEN ARRAY[]::text[]
 WHEN 'submit_claim' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','evidence']
 WHEN 'review_claim' THEN ARRAY['requestId','cardId','claimId','expectedOwnershipRevision','decision','evidence']
 WHEN 'propose_transfer' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','recipientAccountId','expiresInMinutes']
 WHEN 'accept_transfer' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','transferId']
 WHEN 'cancel_transfer' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','transferId']
 WHEN 'set_card_preferences' THEN ARRAY['requestId','cardId','expectedOwnershipRevision','expectedPreferenceRevision','visibility','offersDisabled']
 WHEN 'set_collection_preferences' THEN ARRAY['requestId','expectedPreferenceRevision','visibility','offersDisabled'] END;
 IF names IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 OR NOT d ?& names OR d-names<>'{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['requestId','cardId','claimId','transferId','recipientAccountId'] LOOP
  IF d ? k AND (jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR NOT COALESCE(d->>k ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)) THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['expectedOwnershipRevision','expectedPreferenceRevision'] LOOP
  IF d ? k AND (jsonb_typeof(d->k) IS DISTINCT FROM 'number' OR NOT COALESCE(d->>k ~ '^(0|[1-9][0-9]{0,9})$',false) OR (d->>k)::numeric>=2147483647) THEN RETURN false; END IF;
 END LOOP;
 IF d ? 'visibility' AND (COALESCE(d->>'visibility','') NOT IN ('PRIVATE','PUBLIC') OR jsonb_typeof(d->'offersDisabled') IS DISTINCT FROM 'boolean') THEN RETURN false; END IF;
 IF d ? 'decision' AND COALESCE(d->>'decision','') NOT IN ('VERIFY','REJECT') THEN RETURN false; END IF;
 IF d ? 'evidence' AND (jsonb_typeof(d->'evidence') IS DISTINCT FROM 'object' OR NOT (d->'evidence') ?& ARRAY['referenceId','sha256']
  OR (d->'evidence')-ARRAY['referenceId','sha256']<>'{}'::jsonb OR NOT COALESCE(d#>>'{evidence,referenceId}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
  OR jsonb_typeof(d#>'{evidence,sha256}') IS DISTINCT FROM 'string' OR NOT COALESCE(d#>>'{evidence,sha256}' ~ '^[a-f0-9]{64}$',false)) THEN RETURN false; END IF;
 IF d ? 'expiresInMinutes' AND (jsonb_typeof(d->'expiresInMinutes') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'expiresInMinutes' ~ '^[1-9][0-9]{0,4}$',false)
  OR (d->>'expiresInMinutes')::integer>10080) THEN RETURN false; END IF;
 IF act='read_collection' AND (jsonb_typeof(d->'limit') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$',false)
  OR (d->'afterCardId'<>'null'::jsonb AND NOT COALESCE(d->>'afterCardId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false))) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION atlas_ownership.current_title(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('status','VERIFIED','ownerAccountId',e.owner_account_id,'revision',e.ownership_revision)
 FROM atlas_ownership.event e WHERE e.card_id=cid AND e.kind IN ('CLAIM_VERIFIED','TRANSFER_ACCEPTED') ORDER BY e.sequence DESC LIMIT 1),
 jsonb_build_object('status','UNKNOWN','ownerAccountId',NULL,'revision',0))
$$;
CREATE FUNCTION atlas_ownership.preferences(aid uuid,cid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('accountId',aid,'revision',e.preference_revision,'visibility',e.input->'visibility','offersDisabled',e.input->'offersDisabled')
 FROM atlas_ownership.event e WHERE e.customer_id=aid AND e.card_id IS NOT DISTINCT FROM cid
 AND e.kind=CASE WHEN cid IS NULL THEN 'COLLECTION_PREFERENCES_SET' ELSE 'CARD_PREFERENCES_SET' END ORDER BY e.sequence DESC LIMIT 1),
 jsonb_build_object('accountId',aid,'revision',0,'visibility','PRIVATE','offersDisabled',false))
$$;
CREATE FUNCTION atlas_ownership.card_projection(cid uuid,aid uuid,mode_name text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('cardId',i.card_id,'ownership',title.value,'cardVisibility',prefs.value->'visibility',
 'cardPreferenceRevision',prefs.value->'revision','cardOffersDisabled',prefs.value->'offersDisabled','collectionPreferences',atlas_ownership.preferences(aid),
 'approvedCard',jsonb_build_object('approvalActionId',p.action_id,'certificateNumber',i.report_number,'report',jsonb_build_object('publicToken',i.public_token,'version',p.version,'publicHash',p.public_hash)),
 'custody',jsonb_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.custody_event e ON e.id=l.received_event_id AND e.card_id=l.card_id AND e.kind='ATLAS_RECEIVED' WHERE l.manual_card_id=cid) THEN 'RECORDED' ELSE 'UNKNOWN' END))
 FROM atlas_manual.public_report_identity i CROSS JOIN LATERAL(SELECT atlas_ownership.current_title(cid) value)title
 CROSS JOIN LATERAL(SELECT atlas_ownership.preferences(aid,cid) value)prefs
 CROSS JOIN LATERAL(SELECT p.* FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
 WHERE p.card_id=cid AND p.state='PUBLISHED' AND p.mode=mode_name ORDER BY p.version DESC LIMIT 1)p
 JOIN atlas_manual_intake.card intake ON intake.id=i.card_id
 WHERE i.card_id=cid AND title.value->>'ownerAccountId'=aid::text
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.card_id=cid OR (x.owner_id=intake.owner_id AND x.create_request_id=intake.create_request_id))
$$;
CREATE FUNCTION atlas_ownership.receipt(e atlas_ownership.event) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('eventId',e.id,'requestId',e.request_id,'kind',e.kind)
$$;

CREATE FUNCTION atlas_ownership.customer_call(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount"; existing atlas_ownership.event; subject atlas_ownership.event;
 saved atlas_ownership.event; title jsonb; prefs jsonb; cid uuid; ih text; result jsonb; cards jsonb; next_id uuid; event_kind text; new_owner uuid; new_rev integer; pref_rev integer; expiry timestamptz;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='review_claim' OR NOT atlas_ownership.input_valid(act,d) THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_REQUEST'); END IF;
 IF act='read_preferences' THEN RETURN jsonb_build_object('accountId',a.id,'preferences',atlas_ownership.preferences(a.id)); END IF;
 IF act='read_collection' THEN
  SELECT COALESCE(jsonb_agg(q.value ORDER BY q.cid),'[]'::jsonb) INTO cards FROM (
   SELECT e.card_id cid,atlas_ownership.card_projection(e.card_id,a.id,ctl.mode) value FROM (SELECT DISTINCT card_id FROM atlas_ownership.event WHERE owner_account_id=a.id) e
   WHERE (d->>'afterCardId' IS NULL OR e.card_id>(d->>'afterCardId')::uuid) AND atlas_ownership.card_projection(e.card_id,a.id,ctl.mode) IS NOT NULL ORDER BY e.card_id LIMIT (d->>'limit')::integer+1)q;
  IF jsonb_array_length(cards)>(d->>'limit')::integer THEN cards:=cards-(d->>'limit')::integer; next_id:=(cards->(jsonb_array_length(cards)-1)->>'cardId')::uuid; END IF;
  RETURN jsonb_build_object('accountId',a.id,'cards',cards,'nextCardId',next_id,'preferences',atlas_ownership.preferences(a.id));
 END IF;
 cid:=(d->>'cardId')::uuid;
 IF act='read_card' THEN
  result:=atlas_ownership.card_projection(cid,a.id,ctl.mode);
  IF result IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('accountId',a.id,'card',result);
 END IF;

 -- Lock order is account-specific advisory lock then permanent card row. No
 -- mutable grading or physical-custody row is changed. Expiry is rechecked
 -- after waiting; an initially valid session cannot survive a long card wait.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-account:'||a.id::text,0));
 IF cid IS NOT NULL THEN
  PERFORM 1 FROM atlas_manual.card WHERE id=cid FOR SHARE;
  PERFORM 1 FROM atlas_manual.public_report_identity i JOIN atlas_manual_intake.card c ON c.id=i.card_id
  WHERE i.card_id=cid AND EXISTS(SELECT 1 FROM atlas_manual.publication p WHERE p.card_id=cid AND p.state='PUBLISHED' AND p.mode=ctl.mode)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.card_id=cid OR (x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)) FOR UPDATE OF i;
  IF NOT FOUND THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  PERFORM 1 FROM atlas_manual_intake.card WHERE id=cid FOR SHARE;
  IF EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_manual_intake.discarded_card x ON x.card_id=c.id OR (x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id) WHERE c.id=cid)
   THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 END IF;
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 ih:=encode(sha256(convert_to(jsonb_build_object('action',act,'input',d)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM atlas_ownership.event WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid;
 IF existing.id IS NOT NULL THEN
  IF existing.input_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
  RETURN atlas_ownership.receipt(existing);
 END IF;
 title:=atlas_ownership.current_title(cid);
 IF d ? 'expectedOwnershipRevision' AND (d->>'expectedOwnershipRevision')::integer<>(title->>'revision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REVISION_CHANGED'); END IF;
 IF act='submit_claim' THEN
  IF title->>'status'<>'UNKNOWN' THEN RETURN atlas_customer.problem(409,'OWNERSHIP_ALREADY_ESTABLISHED'); END IF;
  IF EXISTS(SELECT 1 FROM atlas_ownership.event e WHERE e.card_id=cid AND e.customer_id=a.id AND e.kind='CLAIM_SUBMITTED'
   AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event r WHERE r.subject_id=e.id AND r.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED'))) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_PENDING'); END IF;
  event_kind:='CLAIM_SUBMITTED';
 ELSIF act='set_collection_preferences' THEN
  prefs:=atlas_ownership.preferences(a.id);
  IF (prefs->>'revision')::integer<>(d->>'expectedPreferenceRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PREFERENCE_CHANGED'); END IF;
  event_kind:='COLLECTION_PREFERENCES_SET'; pref_rev:=(prefs->>'revision')::integer+1;
 ELSIF act='accept_transfer' THEN
  SELECT * INTO subject FROM atlas_ownership.event WHERE id=(d->>'transferId')::uuid AND card_id=cid AND kind='TRANSFER_PROPOSED';
  IF subject.id IS NULL OR subject.input->>'recipientAccountId'<>a.id::text THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  PERFORM 1 FROM atlas_customer."CustomerAccount" WHERE id=subject.customer_id AND "revokedAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN atlas_customer.problem(409,'OWNERSHIP_TRANSFER_UNAVAILABLE'); END IF;
  IF subject.expires_at<=clock_timestamp() OR subject.customer_id::text IS DISTINCT FROM title->>'ownerAccountId'
   OR subject.input->>'expectedOwnershipRevision' IS DISTINCT FROM title->>'revision'
   OR EXISTS(SELECT 1 FROM atlas_ownership.event WHERE subject_id=subject.id AND kind IN ('TRANSFER_ACCEPTED','TRANSFER_CANCELED')) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_TRANSFER_UNAVAILABLE'); END IF;
  event_kind:='TRANSFER_ACCEPTED'; new_owner:=a.id; new_rev:=(title->>'revision')::integer+1;
 ELSE
  IF title->>'ownerAccountId' IS DISTINCT FROM a.id::text THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  IF act='propose_transfer' THEN
   IF (d->>'recipientAccountId')::uuid=a.id OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=(d->>'recipientAccountId')::uuid AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_RECIPIENT_UNAVAILABLE'); END IF;
   event_kind:='TRANSFER_PROPOSED'; expiry:=clock_timestamp()+make_interval(mins=>(d->>'expiresInMinutes')::integer);
  ELSIF act='cancel_transfer' THEN
   SELECT * INTO subject FROM atlas_ownership.event WHERE id=(d->>'transferId')::uuid AND card_id=cid AND customer_id=a.id AND kind='TRANSFER_PROPOSED';
   IF subject.id IS NULL OR EXISTS(SELECT 1 FROM atlas_ownership.event WHERE subject_id=subject.id AND kind IN ('TRANSFER_ACCEPTED','TRANSFER_CANCELED')) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_TRANSFER_UNAVAILABLE'); END IF;
   event_kind:='TRANSFER_CANCELED';
  ELSIF act='set_card_preferences' THEN
   prefs:=atlas_ownership.preferences(a.id,cid);
   IF (prefs->>'revision')::integer<>(d->>'expectedPreferenceRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PREFERENCE_CHANGED'); END IF;
   event_kind:='CARD_PREFERENCES_SET'; pref_rev:=(prefs->>'revision')::integer+1;
  ELSE RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_REQUEST'); END IF;
 END IF;
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 INSERT INTO atlas_ownership.event(card_id,customer_id,request_id,action,input,input_hash,kind,subject_id,owner_account_id,ownership_revision,preference_revision,expires_at)
 VALUES(cid,a.id,(d->>'requestId')::uuid,act,d,ih,event_kind,subject.id,new_owner,new_rev,pref_rev,expiry) RETURNING * INTO saved;
 RETURN atlas_ownership.receipt(saved);
END $$;

CREATE FUNCTION atlas_ownership.staff_call(sh text,bh text,binding jsonb,phones text[],d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; claim atlas_ownership.event; prior atlas_ownership.event; saved atlas_ownership.event; cid uuid; title jsonb; ih text; claimant atlas_customer."CustomerAccount";
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(sh,bh,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 PERFORM 1 FROM atlas_ownership.reviewer_authority WHERE staff_id=actor.id AND revoked_at IS NULL AND authorized_until>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 IF NOT atlas_ownership.input_valid('review_claim',d) THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_REQUEST'); END IF;
 cid:=(d->>'cardId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-reviewer:'||actor.id::text,0));
 PERFORM 1 FROM atlas_manual.card c WHERE c.id=cid AND (c.owner_id=actor.id OR actor.id=ANY(c.readers) OR actor.id=ANY(c.editors) OR actor.id=ANY(c.approvers)) FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 PERFORM 1 FROM atlas_manual.public_report_identity i JOIN atlas_manual.card c ON c.id=i.card_id JOIN atlas_manual_intake.card intake ON intake.id=c.id
 WHERE i.card_id=cid AND (c.owner_id=actor.id OR actor.id=ANY(c.readers) OR actor.id=ANY(c.editors) OR actor.id=ANY(c.approvers))
 AND EXISTS(SELECT 1 FROM atlas_manual.publication p WHERE p.card_id=cid AND p.state='PUBLISHED' AND p.mode=binding->>'mode')
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.card_id=cid OR (x.owner_id=intake.owner_id AND x.create_request_id=intake.create_request_id)) FOR UPDATE OF i;
 IF NOT FOUND THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 PERFORM 1 FROM atlas_manual_intake.card WHERE id=cid FOR SHARE;
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_manual_intake.discarded_card x ON x.card_id=c.id OR (x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id) WHERE c.id=cid)
  THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 SELECT * INTO actor FROM atlas_manual.authenticate(sh,bh,binding,phones);
 IF actor.id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_ownership.reviewer_authority WHERE staff_id=actor.id AND revoked_at IS NULL AND authorized_until>clock_timestamp()) THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 ih:=encode(sha256(convert_to(jsonb_build_object('action','review_claim','input',d)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM atlas_ownership.event WHERE staff_id=actor.id AND request_id=(d->>'requestId')::uuid;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
  RETURN atlas_ownership.receipt(prior);
 END IF;
 SELECT * INTO claim FROM atlas_ownership.event WHERE id=(d->>'claimId')::uuid AND card_id=cid AND kind='CLAIM_SUBMITTED';
 IF claim.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 SELECT * INTO claimant FROM atlas_customer."CustomerAccount" WHERE id=claim.customer_id FOR SHARE;
 IF claimant."revokedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM atlas_ownership.reviewer_authority WHERE staff_id=actor.id AND customer_account_id=claimant.id) THEN RETURN atlas_customer.problem(403,'OWNERSHIP_INDEPENDENT_REVIEW_REQUIRED'); END IF;
 IF EXISTS(SELECT 1 FROM atlas_ownership.event WHERE subject_id=claim.id AND kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED')) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_DECIDED'); END IF;
 title:=atlas_ownership.current_title(cid);
 IF (d->>'expectedOwnershipRevision')::integer<>(title->>'revision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REVISION_CHANGED'); END IF;
 IF d->>'decision'='VERIFY' AND title->>'status'<>'UNKNOWN' THEN RETURN atlas_customer.problem(409,'OWNERSHIP_ALREADY_ESTABLISHED'); END IF;
 SELECT * INTO actor FROM atlas_manual.authenticate(sh,bh,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' OR NOT EXISTS(SELECT 1 FROM atlas_ownership.reviewer_authority WHERE staff_id=actor.id AND revoked_at IS NULL AND authorized_until>clock_timestamp()) THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 INSERT INTO atlas_ownership.event(card_id,staff_id,request_id,action,input,input_hash,kind,subject_id,owner_account_id,ownership_revision)
 VALUES(cid,actor.id,(d->>'requestId')::uuid,'review_claim',d,ih,CASE WHEN d->>'decision'='VERIFY' THEN 'CLAIM_VERIFIED' ELSE 'CLAIM_REJECTED' END,claim.id,
 CASE WHEN d->>'decision'='VERIFY' THEN claim.customer_id END,CASE WHEN d->>'decision'='VERIFY' THEN (title->>'revision')::integer+1 END) RETURNING * INTO saved;
 RETURN atlas_ownership.receipt(saved);
END $$;

-- Only the two authenticated entry points may receive separately reviewed
-- execute grants. Helpers/journal/authority never belong to browser or worker.
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_ownership FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_ownership FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership FROM PUBLIC;
