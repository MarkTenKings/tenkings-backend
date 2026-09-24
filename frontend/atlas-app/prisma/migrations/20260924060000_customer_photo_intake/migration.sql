BEGIN;
SET LOCAL search_path=pg_catalog,atlas_customer;
-- Existing histories/migration bytes remain intact. Complete new profiles add
-- email; legacy snapshots remain valid and are never backfilled with fiction.
CREATE FUNCTION atlas_customer.valid_profile_legacy(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(p)='object' AND
    p ?& ARRAY['name','address1','address2','city','region','postalCode','country'] AND
    (p-ARRAY['name','address1','address2','city','region','postalCode','country'])='{}'::jsonb AND
    NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value)<>'string'
      OR length(p->>e.key)>CASE e.key WHEN 'name' THEN 120 WHEN 'address1' THEN 200 WHEN 'address2' THEN 200 WHEN 'postalCode' THEN 30 WHEN 'country' THEN 2 ELSE 100 END OR (p->>e.key) ~ '[[:cntrl:]]'
      OR (p->>e.key)<>btrim(p->>e.key)
      OR (e.key NOT IN ('address2','region') AND length(p->>e.key)=0)) AND
    (p->>'country') ~ '^[A-Z]{2}$', false)
$$;
CREATE OR REPLACE FUNCTION atlas_customer.valid_profile(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT atlas_customer.valid_profile_legacy(p-'email') AND (NOT p ? 'email' OR
  (jsonb_typeof(p->'email')='string' AND length(p->>'email') BETWEEN 3 AND 254
   AND (p->>'email')=btrim(p->>'email') AND (p->>'email') !~ '[[:cntrl:][:space:]]'
   AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$'))
$$;
REVOKE ALL ON FUNCTION atlas_customer.valid_profile_legacy(jsonb) FROM PUBLIC;
-- Additive proposal. Root integrates into one reviewed migration. No grants to
-- customer/public roles: only the existing customer_call gateway is callable.
CREATE TABLE atlas_customer."CustomerIntakeDraft" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 "requestId" uuid NOT NULL, "inputHash" text NOT NULL, "intakeMethod" text NOT NULL CHECK ("intakeMethod" IN ('MAIL_IN','DEALER_DROP_OFF')),
 "kioskId" uuid, "locationSnapshot" jsonb, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','REVIEW','ORDERED')), "profileSnapshot" jsonb,
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("accountId","requestId"), CHECK (("intakeMethod"='MAIL_IN')=("kioskId" IS NULL))
);
CREATE TABLE atlas_customer."CustomerIntakeCard" (
 id uuid PRIMARY KEY, "draftId" uuid NOT NULL REFERENCES atlas_customer."CustomerIntakeDraft"(id), "requestId" uuid NOT NULL,
 "pairId" uuid NOT NULL UNIQUE, "inputHash" text NOT NULL, revision integer NOT NULL DEFAULT 1,
 identity jsonb, "identityState" text NOT NULL DEFAULT 'UPLOADING' CHECK ("identityState" IN ('UPLOADING','QUEUED','PROCESSING','READY','ATTENTION','UNKNOWN')),
 "identitySource" text CHECK ("identitySource" IN ('MACHINE_PROPOSAL','CUSTOMER_CORRECTION')), "identityResult" jsonb,
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE ("draftId","requestId")
);
CREATE TABLE atlas_customer."CustomerIntakeUpload" (
 id uuid PRIMARY KEY, "cardId" uuid NOT NULL REFERENCES atlas_customer."CustomerIntakeCard"(id), side text NOT NULL CHECK (side IN ('FRONT','BACK')),
 plan jsonb NOT NULL, "fileName" text NOT NULL, verification jsonb, prepared jsonb, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE ("cardId",side)
);
CREATE TABLE atlas_customer."CustomerIntakeIdentification" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "cardId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CustomerIntakeCard"(id),
 "sourceHash" text NOT NULL, state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','READY','ATTENTION','UNKNOWN')),
 "leaseId" uuid, "leaseUntil" timestamptz, result jsonb, code text, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CustomerIntakeEffect" (
 "attemptId" uuid NOT NULL REFERENCES atlas_customer."CustomerIntakeIdentification"(id), stage text NOT NULL CHECK (stage IN ('OCR_FRONT','OCR_BACK','MODEL')),
 "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'), "dispatchedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 response text, "responseHash" text, "respondedAt" timestamptz, PRIMARY KEY ("attemptId",stage)
);
CREATE INDEX "CustomerIntakeDraft_account" ON atlas_customer."CustomerIntakeDraft"("accountId","createdAt");
CREATE INDEX "CustomerIntakeCard_draft" ON atlas_customer."CustomerIntakeCard"("draftId");

CREATE FUNCTION atlas_customer.intake_identity_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='object' AND v ?& ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert']
 AND (v-ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])='{}'::jsonb
 AND v->>'category' IN ('SPORTS','POKEMON') AND length(v->>'title') BETWEEN 1 AND 180
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(v) e WHERE jsonb_typeof(e.value)<>'string' OR length(v->>e.key)>180
 OR v->>e.key<>btrim(v->>e.key) OR (v->>e.key) ~ '[[:cntrl:]]'),false)
$$;
ALTER TABLE atlas_customer."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntake_identity" CHECK (identity IS NULL OR atlas_customer.intake_identity_valid(identity));

-- Public draft responses keep server-only kiosk and device binding in stored snapshots.
CREATE FUNCTION atlas_customer.intake_public_fields(v jsonb, keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$$;
CREATE FUNCTION atlas_customer.intake_public_rows(v jsonb, keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(atlas_customer.intake_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$$;
CREATE FUNCTION atlas_customer.intake_public_location(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.intake_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.intake_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.intake_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.intake_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.intake_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.intake_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$$;
REVOKE ALL ON FUNCTION atlas_customer.intake_public_fields(jsonb,text[]),atlas_customer.intake_public_rows(jsonb,text[]),atlas_customer.intake_public_location(jsonb) FROM PUBLIC;

CREATE FUNCTION atlas_customer.intake_draft_projection(did uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'intakeMethod',d."intakeMethod",'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,
 'kioskId',d."kioskId",'locationSnapshot',atlas_customer.intake_public_location(d."locationSnapshot"),'state',d.state,'profileSnapshot',d."profileSnapshot",'createdAt',d."createdAt",'cards',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',c.id,'pairId',c."pairId",'revision',c.revision,'identityState',c."identityState",'identity',c.identity,'identitySource',c."identitySource",
 'warnings',COALESCE(c."identityResult"->'warnings','[]'::jsonb),'uploads',(SELECT jsonb_object_agg(u.side,jsonb_build_object('id',u.id,'state',CASE WHEN u.verification IS NULL THEN 'PENDING' ELSE 'VERIFIED' END)) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id)) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb)) FROM atlas_customer."CustomerIntakeDraft" d WHERE d.id=did
$$;
CREATE FUNCTION atlas_customer.intake_upload_projection(uid uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('accountId',d."accountId",'draftId',d.id,'cardId',c.id,'pairId',c."pairId",'side',u.side,'plan',u.plan,'verification',u.verification,'prepared',u.prepared)
 FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" c ON c.id=u."cardId" JOIN atlas_customer."CustomerIntakeDraft" d ON d.id=c."draftId" WHERE u.id=uid
$$;
-- Fail closed until the dealer registry provides actual enabled location data.
CREATE FUNCTION atlas_customer.intake_location(kid uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT NULL::jsonb $$;
-- Commerce replaces this before enabling checkout; without commerce there is no payment.
CREATE FUNCTION atlas_customer.intake_editable(did uuid) RETURNS boolean LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT true $$;

CREATE FUNCTION atlas_customer.intake_call(action text, account_id uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE draft atlas_customer."CustomerIntakeDraft"; c atlas_customer."CustomerIntakeCard"; payload jsonb; p jsonb; side_name text; ih text; location jsonb; uid uuid; did uuid; cards integer;
BEGIN
 IF account_id IS NULL OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
 -- Serialize this customer's cart mutations; no global intake lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||account_id::text,0));
 IF action='intake_list' THEN
   RETURN jsonb_build_object('drafts',COALESCE((SELECT jsonb_agg(atlas_customer.intake_draft_projection(q.id) ORDER BY q."createdAt" DESC) FROM (SELECT id,"createdAt" FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND state<>'ORDERED' ORDER BY "createdAt" DESC LIMIT 20) q),'[]'::jsonb));
 ELSIF action='intake_create' THEN
   IF COALESCE(d->>'intakeMethod','') NOT IN ('MAIL_IN','DEALER_DROP_OFF') OR (d->>'requestId') IS NULL
     OR ((d->>'intakeMethod'='MAIL_IN') IS DISTINCT FROM (d->>'kioskId' IS NULL)) THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   ih:=encode(sha256(convert_to((d-ARRAY['sessionHash','browserHash'])::text,'UTF8')),'hex');
   SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND "requestId"=(d->>'requestId')::uuid;
   IF draft.id IS NOT NULL THEN
     IF draft."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
   END IF;
   IF d->>'intakeMethod'='DEALER_DROP_OFF' THEN
     location:=atlas_customer.intake_location((d->>'kioskId')::uuid);
     IF location IS NULL THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
   END IF;
   IF NOT atlas_customer.take_rate('intake-create:'||account_id,20) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   INSERT INTO atlas_customer."CustomerIntakeDraft"("accountId","requestId","inputHash","intakeMethod","kioskId","locationSnapshot") VALUES
    (account_id,(d->>'requestId')::uuid,ih,d->>'intakeMethod',(d->>'kioskId')::uuid,location) RETURNING * INTO draft;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
 END IF;
 did:=(d->>'id')::uuid;
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=account_id FOR UPDATE;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='intake_read' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
 IF action='intake_upload' THEN
   SELECT u.id INTO uid FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=u."cardId"
    WHERE cc."draftId"=did AND cc.id=(d->>'cardId')::uuid AND u.id=(d->>'uploadId')::uuid;
   IF uid IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('upload',atlas_customer.intake_upload_projection(uid));
 END IF;
 IF draft.state='ORDERED' OR NOT atlas_customer.intake_editable(did) THEN RETURN atlas_customer.problem(409,'INTAKE_ALREADY_ORDERED'); END IF;
 IF action='intake_card' THEN
   payload:=d->'card'; ih:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
   IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (payload-ARRAY['requestId','cardId','pairId','front','back'])<>'{}'::jsonb
     OR NOT payload ?& ARRAY['requestId','cardId','pairId','front','back'] THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did AND "requestId"=(payload->>'requestId')::uuid;
   IF c.id IS NOT NULL THEN
     IF c."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
   END IF;
   SELECT count(*) INTO cards FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did;
   IF cards>=100 THEN RETURN atlas_customer.problem(409,'INTAKE_CARD_LIMIT'); END IF;
   IF payload->'front'->>'sha256'=payload->'back'->>'sha256' OR payload->'front'->>'uploadId'=payload->'back'->>'uploadId' THEN RETURN atlas_customer.problem(400,'DISTINCT_CARD_SIDES_REQUIRED'); END IF;
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name;
     IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['uploadId','sha256','byteCount','fileName'] OR (p-ARRAY['uploadId','sha256','byteCount','fileName'])<>'{}'::jsonb
       OR COALESCE(p->>'sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'byteCount') IS DISTINCT FROM 'number' OR (p->>'byteCount')::numeric<>trunc((p->>'byteCount')::numeric)
       OR (p->>'byteCount')::numeric NOT BETWEEN 1 AND 67108864 OR jsonb_typeof(p->'fileName') IS DISTINCT FROM 'string' OR length(p->>'fileName')>240 OR (p->>'fileName') ~ '[[:cntrl:]]' THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   END LOOP;
   INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash") VALUES ((payload->>'cardId')::uuid,did,(payload->>'requestId')::uuid,(payload->>'pairId')::uuid,ih);
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name; uid:=(p->>'uploadId')::uuid;
     INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,"fileName",plan) VALUES (uid,(payload->>'cardId')::uuid,upper(side_name),p->>'fileName',
      jsonb_build_object('schemaVersion',1,'uploadId',uid,'binding',jsonb_build_object('cardId',payload->>'cardId','pairId',payload->>'pairId','side',upper(side_name),'version',1),
       'object',jsonb_build_object('key','atlas-customer/originals/'||account_id::text||'/'||(payload->>'cardId')||'/'||uid::text,'versionId',NULL),
       'expected',jsonb_build_object('sha256',p->>'sha256','byteCount',(p->>'byteCount')::integer)));
   END LOOP;
 ELSIF action='intake_correct' THEN
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=(d->>'cardId')::uuid AND "draftId"=did FOR UPDATE;
   IF c.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   IF NOT atlas_customer.intake_identity_valid(d->'identity') THEN RETURN atlas_customer.problem(400,'INVALID_CARD_DETAILS'); END IF;
   IF c.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN
     IF c.identity=d->'identity' AND c."identitySource"='CUSTOMER_CORRECTION' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
     RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED');
   END IF;
   UPDATE atlas_customer."CustomerIntakeCard" SET identity=d->'identity',"identitySource"='CUSTOMER_CORRECTION',revision=revision+1 WHERE id=c.id;
 ELSIF action='intake_review' THEN
   IF draft.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED'); END IF;
   IF NOT atlas_customer.valid_profile(d->'profile') OR NOT (d->'profile') ? 'email' THEN RETURN atlas_customer.problem(400,'RETURN_DETAILS_REQUIRED'); END IF;
   IF NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did) OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" cc WHERE cc."draftId"=did AND (cc.identity IS NULL OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cc.id AND u.verification IS NULL))) THEN RETURN atlas_customer.problem(409,'INTAKE_REVIEW_NOT_READY'); END IF;
   IF draft.state='REVIEW' AND draft."profileSnapshot"=d->'profile' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
   UPDATE atlas_customer."CustomerIntakeDraft" SET state='REVIEW',"profileSnapshot"=d->'profile',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND');
 END IF;
 UPDATE atlas_customer."CustomerIntakeDraft" SET state='DRAFT',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
 RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR unique_violation OR not_null_violation THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE');
END $$;

-- This function is for a distinct private media/identifier role only. Root
-- reviews exact grant; ordinary customers cannot assert verification or results.
CREATE FUNCTION atlas_customer.intake_worker_call(action text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE job atlas_customer."CustomerIntakeIdentification"; u atlas_customer."CustomerIntakeUpload"; c atlas_customer."CustomerIntakeCard"; draft atlas_customer."CustomerIntakeDraft";
 e atlas_customer."CustomerIntakeEffect"; auth jsonb; verified jsonb; pair_hash text; jid uuid; current_upload jsonb; candidate record;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>1048576 THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
 IF action='verify' THEN
   auth:=d->'authority';
   current_upload:=atlas_customer.customer_call('intake_upload',auth->'binding',(auth- 'binding')||jsonb_build_object('id',d->>'id','cardId',d->>'cardId','uploadId',d->>'uploadId'));
   IF current_upload ? 'error' THEN RETURN current_upload; END IF;
   SELECT * INTO u FROM atlas_customer."CustomerIntakeUpload" WHERE id=(d->>'uploadId')::uuid FOR UPDATE;
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=u."cardId" FOR UPDATE;
   verified:=d->'verification';
   IF jsonb_typeof(verified) IS DISTINCT FROM 'object' OR (verified->'object'->>'key') IS DISTINCT FROM (u.plan->'object'->>'key')
     OR verified->>'sha256' IS DISTINCT FROM u.plan->'expected'->>'sha256' OR verified->'byteCount' IS DISTINCT FROM u.plan->'expected'->'byteCount'
     OR verified->>'contentType' IS DISTINCT FROM 'application/octet-stream' THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   IF u.verification IS NOT NULL AND u.verification<>verified THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeUpload" SET verification=verified WHERE id=u.id AND verification IS NULL;
   IF NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id AND verification IS NULL) THEN
     SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object('plan',plan,'verification',verification) ORDER BY side)::text,'UTF8')),'hex') INTO pair_hash FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id;
     INSERT INTO atlas_customer."CustomerIntakeIdentification"("cardId","sourceHash") VALUES (c.id,pair_hash) ON CONFLICT ("cardId") DO NOTHING;
     UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='QUEUED' WHERE id=c.id AND "identityState"='UPLOADING';
   END IF;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(c."draftId"));
 ELSIF action='claim' THEN
   -- All worker transitions lock draft, card, then job, matching customer
   -- verification/checkout. SKIP LOCKED prevents one busy draft blocking others.
   FOR candidate IN SELECT j.id AS job_id,cc.id AS card_id,dd.id AS draft_id FROM atlas_customer."CustomerIntakeIdentification" j
    JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=j."cardId" JOIN atlas_customer."CustomerIntakeDraft" dd ON dd.id=cc."draftId"
    WHERE j.state='RUNNING' AND j."leaseUntil"<clock_timestamp() AND EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL) LIMIT 100 LOOP
     PERFORM 1 FROM atlas_customer."CustomerIntakeDraft" WHERE id=candidate.draft_id FOR UPDATE SKIP LOCKED;
     IF NOT FOUND THEN CONTINUE; END IF;
     PERFORM 1 FROM atlas_customer."CustomerIntakeCard" WHERE id=candidate.card_id FOR UPDATE;
     SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=candidate.job_id FOR UPDATE;
     IF job.state='RUNNING' AND job."leaseUntil"<clock_timestamp() AND EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=job.id AND ef.response IS NULL) THEN
       UPDATE atlas_customer."CustomerIntakeIdentification" SET state='UNKNOWN',code='IDENTIFICATION_OUTCOME_UNKNOWN' WHERE id=job.id;
       UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='UNKNOWN' WHERE id=candidate.card_id;
     END IF;
   END LOOP;
   job:=NULL;
   SELECT dd.* INTO draft FROM atlas_customer."CustomerIntakeIdentification" j JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=j."cardId"
     JOIN atlas_customer."CustomerIntakeDraft" dd ON dd.id=cc."draftId" JOIN atlas_customer."CustomerAccount" a ON a.id=dd."accountId"
    WHERE a."revokedAt" IS NULL AND dd.state<>'ORDERED' AND (j.state='QUEUED' OR (j.state='RUNNING' AND j."leaseUntil"<clock_timestamp()
     AND NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL))) ORDER BY j."createdAt" FOR UPDATE OF dd SKIP LOCKED LIMIT 1;
   IF draft.id IS NULL THEN RETURN jsonb_build_object('job',NULL); END IF;
   SELECT cc.* INTO c FROM atlas_customer."CustomerIntakeCard" cc JOIN atlas_customer."CustomerIntakeIdentification" j ON j."cardId"=cc.id
    WHERE cc."draftId"=draft.id AND (j.state='QUEUED' OR (j.state='RUNNING' AND j."leaseUntil"<clock_timestamp()
     AND NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL))) ORDER BY j."createdAt" FOR UPDATE OF cc LIMIT 1;
   SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE "cardId"=c.id FOR UPDATE;
   IF job.id IS NULL THEN RETURN jsonb_build_object('job',NULL); END IF;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state='RUNNING',"leaseId"=gen_random_uuid(),"leaseUntil"=clock_timestamp()+interval '10 minutes' WHERE id=job.id RETURNING * INTO job;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='PROCESSING' WHERE id=job."cardId" RETURNING * INTO c;
   SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=c."draftId";
   RETURN jsonb_build_object('job',jsonb_build_object('attemptId',job.id,'leaseId',job."leaseId",'accountId',draft."accountId",'cardId',c.id,'sourceHash',job."sourceHash",
    'uploads',(SELECT jsonb_object_agg(side,atlas_customer.intake_upload_projection(id)) FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id)));
 END IF;
 SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=(d->>'attemptId')::uuid;
 SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=job."cardId";
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=c."draftId" FOR UPDATE;
 SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=job."cardId" FOR UPDATE;
 SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=(d->>'attemptId')::uuid FOR UPDATE;
 IF job.id IS NULL OR job.state<>'RUNNING' OR job."leaseId" IS DISTINCT FROM (d->>'leaseId')::uuid OR job."leaseUntil"<=clock_timestamp() THEN RETURN atlas_customer.problem(409,'INTAKE_LEASE_EXPIRED'); END IF;
 IF action='prepared' THEN
   SELECT * INTO u FROM atlas_customer."CustomerIntakeUpload" WHERE id=(d->>'uploadId')::uuid AND "cardId"=c.id FOR UPDATE;
   IF u.id IS NULL OR u.verification IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   IF u.prepared IS NOT NULL AND u.prepared<>d->'photo' THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeUpload" SET prepared=d->'photo' WHERE id=u.id AND prepared IS NULL;
 ELSIF action IN ('dispatch','response') THEN
   IF COALESCE(d->>'stage','') NOT IN ('OCR_FRONT','OCR_BACK','MODEL') OR COALESCE(d->>'requestHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   SELECT * INTO e FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND stage=d->>'stage' FOR UPDATE;
   IF action='dispatch' THEN
     IF e."attemptId" IS NOT NULL THEN
       IF e."requestHash"<>d->>'requestHash' THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
       RETURN jsonb_build_object('dispatch',false,'response',e.response);
     END IF;
     IF NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" a WHERE a.id=draft."accountId" AND a."revokedAt" IS NULL)
       OR draft.state<>'DRAFT' OR NOT atlas_customer.intake_editable(draft.id) THEN RETURN atlas_customer.problem(409,'INTAKE_IDENTIFICATION_NO_LONGER_REQUIRED'); END IF;
     INSERT INTO atlas_customer."CustomerIntakeEffect"("attemptId",stage,"requestHash") VALUES (job.id,d->>'stage',d->>'requestHash');
     RETURN jsonb_build_object('dispatch',true);
   END IF;
   IF e."attemptId" IS NULL OR e."requestHash" IS DISTINCT FROM d->>'requestHash' OR length(d->>'response') NOT BETWEEN 1 AND 349528
     OR encode(sha256(decode(d->>'response','base64')),'hex') IS DISTINCT FROM d->>'responseHash' OR (e.response IS NOT NULL AND e.response IS DISTINCT FROM d->>'response') THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeEffect" SET response=d->>'response',"responseHash"=d->>'responseHash',"respondedAt"=clock_timestamp() WHERE "attemptId"=job.id AND stage=d->>'stage' AND response IS NULL;
 ELSIF action='finish' THEN
   IF jsonb_typeof(d->'result') IS DISTINCT FROM 'object' OR NOT (d->'result') ?& ARRAY['identity','suggestions','warnings','provenance']
     OR d->'result'->'provenance'->'subject'->>'id' IS DISTINCT FROM c.id::text OR d->'result'->'provenance'->'subject'->>'revision' IS DISTINCT FROM job."sourceHash"
     OR d->'result'->'provenance'->>'engine_version' IS DISTINCT FROM 'card-identification-v2' OR jsonb_typeof(d->'result'->'warnings') IS DISTINCT FROM 'array'
     OR jsonb_typeof(d->'result'->'suggestions') IS DISTINCT FROM 'object' THEN RETURN atlas_customer.problem(409,'IDENTIFICATION_SOURCE_CHANGED'); END IF;
   IF EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND response IS NULL) OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND stage='MODEL' AND response IS NOT NULL) THEN RETURN atlas_customer.problem(409,'IDENTIFICATION_OUTCOME_UNKNOWN'); END IF;
   IF d->'result'->'identity'<>'null'::jsonb AND NOT atlas_customer.intake_identity_valid(d->'result'->'identity') THEN RETURN atlas_customer.problem(400,'INVALID_CARD_DETAILS'); END IF;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state='READY',result=d->'result',"leaseUntil"=NULL WHERE id=job.id;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"=CASE WHEN COALESCE(identity,d->'result'->'identity') IS NULL OR COALESCE(identity,d->'result'->'identity')='null'::jsonb THEN 'ATTENTION' ELSE 'READY' END,
    identity=CASE WHEN "identitySource"='CUSTOMER_CORRECTION' THEN identity ELSE NULLIF(d->'result'->'identity','null'::jsonb) END,
    "identitySource"=CASE WHEN "identitySource"='CUSTOMER_CORRECTION' THEN "identitySource" ELSE 'MACHINE_PROPOSAL' END,"identityResult"=d->'result',revision=revision+1 WHERE id=c.id AND draft.state='DRAFT' AND atlas_customer.intake_editable(draft.id);
   -- An already reviewed cart contains customer-confirmed details; never change
   -- its financial snapshot from a late machine proposal.
   IF draft.state='DRAFT' AND atlas_customer.intake_editable(draft.id) THEN UPDATE atlas_customer."CustomerIntakeDraft" SET revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=draft.id; END IF;
 ELSIF action='fail' THEN
   pair_hash:=CASE WHEN EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND response IS NULL) THEN 'UNKNOWN' ELSE 'ATTENTION' END;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state=pair_hash,code=left(d->>'code',90),"leaseUntil"=NULL WHERE id=job.id;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"=pair_hash WHERE id=c.id;
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE');
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_customer FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.intake_call(text,uuid,jsonb), atlas_customer.intake_worker_call(text,jsonb), atlas_customer.intake_draft_projection(uuid), atlas_customer.intake_upload_projection(uuid), atlas_customer.intake_identity_valid(jsonb), atlas_customer.intake_location(uuid), atlas_customer.intake_editable(uuid) FROM PUBLIC;

-- Retain original authentication/SMS/submission implementation with its exact
-- authority checks. Only the new wrapper is granted to the serving role.
ALTER FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) RENAME TO customer_call_v1;
CREATE FUNCTION atlas_customer.customer_call(action text,binding jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; account atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('intake_list','intake_create','intake_read','intake_card','intake_correct','intake_review','intake_upload') THEN
  RETURN atlas_customer.customer_call_v1(action,binding,d);
 END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR
  (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
  IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO account FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF account.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 RETURN atlas_customer.intake_call(action,account.id,d-ARRAY['sessionHash','browserHash']);
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 JOIN pg_roles r ON r.oid=acl.grantee
 WHERE n.nspname='atlas_customer' AND p.proname='customer_call_v1' AND acl.privilege_type='EXECUTE' AND acl.grantee<>p.proowner LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) TO %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.customer_call_v1(text,jsonb,jsonb) FROM %I',role_name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call_v1(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
