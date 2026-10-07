BEGIN;
CREATE SCHEMA atlas_customer;
REVOKE ALL ON SCHEMA atlas_customer FROM PUBLIC;
SET LOCAL search_path = pg_catalog, atlas_customer;

CREATE TABLE atlas_customer."CustomerControl" (
  id text PRIMARY KEY DEFAULT 'active' CHECK (id='active'),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL CHECK (mode IN ('PRODUCTION','LOCAL_FIXTURE')),
  origin text NOT NULL,
  "deploymentId" text NOT NULL,
  "releaseSha" varchar(40) NOT NULL CHECK ("releaseSha" ~ '^[a-f0-9]{40}$'),
  "configHash" varchar(64) NOT NULL CHECK ("configHash" ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((mode='PRODUCTION' AND origin='https://atlasgrading.com') OR
    (mode='LOCAL_FIXTURE' AND origin='http://127.0.0.1:4318'))
);
CREATE TABLE atlas_customer."CustomerAccount" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "phoneHash" varchar(64) NOT NULL UNIQUE CHECK ("phoneHash" ~ '^[a-f0-9]{64}$'),
  phone varchar(16) NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  profile jsonb,
  "accessVersion" integer NOT NULL DEFAULT 1 CHECK ("accessVersion">0),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "lastLoginAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CustomerBrowser" (
  "tokenHash" varchar(64) PRIMARY KEY CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  "controlRevision" integer NOT NULL CHECK ("controlRevision">0),
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" timestamptz NOT NULL,
  CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '7 days')
);
CREATE TABLE atlas_customer."CustomerChallenge" (
  id varchar(43) PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{43}$'),
  "browserHash" varchar(64) NOT NULL REFERENCES atlas_customer."CustomerBrowser"("tokenHash"),
  "requestId" uuid NOT NULL,
  "phoneHash" varchar(64) NOT NULL CHECK ("phoneHash" ~ '^[a-f0-9]{64}$'),
  phone varchar(16) NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  "controlRevision" integer NOT NULL,
  "accountSid" varchar(34) NOT NULL CHECK ("accountSid" ~ '^AC[0-9a-fA-F]{32}$'),
  "serviceSid" varchar(34) NOT NULL CHECK ("serviceSid" ~ '^VA[0-9a-fA-F]{32}$'),
  "verificationSid" varchar(34),
  state text NOT NULL CHECK (state IN ('SENDING','PENDING','CHECKING','UNKNOWN','SUPERSEDED','CONSUMED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "sendClaimId" uuid NOT NULL UNIQUE,
  "checkClaimId" uuid,
  "replayHash" varchar(64),
  "replayUntil" timestamptz,
  "createdAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "quarantineUntil" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  UNIQUE ("browserHash","requestId"),
  CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '5 minutes'),
  CHECK ("quarantineUntil">="expiresAt" AND "quarantineUntil"<="createdAt"+interval '11 minutes'),
  CHECK (state NOT IN ('PENDING','CHECKING','CONSUMED') OR "verificationSid" ~ '^VE[0-9a-fA-F]{32}$'),
  CHECK (state<>'CHECKING' OR "checkClaimId" IS NOT NULL),
  CHECK (state<>'CONSUMED' OR ("consumedAt" IS NOT NULL AND "replayHash" ~ '^[a-f0-9]{64}$' AND "replayUntil" IS NOT NULL))
);
CREATE INDEX "CustomerChallenge_phone_created" ON atlas_customer."CustomerChallenge"(phone,"createdAt");
CREATE TABLE atlas_customer."CustomerSession" (
  "tokenHash" varchar(64) PRIMARY KEY CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
  "browserHash" varchar(64) NOT NULL REFERENCES atlas_customer."CustomerBrowser"("tokenHash"),
  "challengeId" varchar(43) NOT NULL UNIQUE REFERENCES atlas_customer."CustomerChallenge"(id),
  "controlRevision" integer NOT NULL,
  "accessVersion" integer NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '12 hours')
);
CREATE INDEX "CustomerSession_account" ON atlas_customer."CustomerSession"("accountId");
CREATE TABLE atlas_customer."CustomerRateBucket" (
  key varchar(100) PRIMARY KEY,
  count integer NOT NULL CHECK (count>0),
  "expiresAt" timestamptz NOT NULL
);
CREATE TABLE atlas_customer."CustomerSubmission" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference varchar(18) NOT NULL UNIQUE CHECK (reference ~ '^ATLAS-[A-F0-9]{12}$'),
  "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
  "requestId" uuid NOT NULL,
  "inputHash" varchar(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "intakeMethod" text NOT NULL CHECK ("intakeMethod" IN ('DEALER_DROP_OFF','MAIL_IN')),
  "profileSnapshot" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("accountId","requestId")
);
CREATE INDEX "CustomerSubmission_account_created" ON atlas_customer."CustomerSubmission"("accountId","createdAt",id);
CREATE TABLE atlas_customer."CustomerCard" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "submissionId" uuid NOT NULL REFERENCES atlas_customer."CustomerSubmission"(id),
  title varchar(180) NOT NULL CHECK (length(btrim(title))>0),
  category text NOT NULL CHECK (category IN ('SPORTS','POKEMON')),
  "specimenId" uuid UNIQUE REFERENCES atlas_staff."StaffSpecimen"(id),
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "CustomerCard_submission" ON atlas_customer."CustomerCard"("submissionId");
CREATE TABLE atlas_customer."CustomerCardEvent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cardId" uuid NOT NULL REFERENCES atlas_customer."CustomerCard"(id),
  kind text NOT NULL CHECK (kind IN ('RECEIVED','ACTION_NEEDED','ACTION_RESOLVED','SHIPPED')),
  "actorId" uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  "operationId" uuid NOT NULL,
  "inputHash" varchar(64) NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  details jsonb NOT NULL,
  "recordedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("actorId","operationId")
);
CREATE INDEX "CustomerCardEvent_card_time" ON atlas_customer."CustomerCardEvent"("cardId","recordedAt",id);
CREATE UNIQUE INDEX "CustomerCardEvent_one_physical" ON atlas_customer."CustomerCardEvent"("cardId",kind) WHERE kind IN ('RECEIVED','SHIPPED');

CREATE FUNCTION atlas_customer.immutable_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CUSTOMER_RECORD_IMMUTABLE'; END $$;
CREATE FUNCTION atlas_customer.control_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'CUSTOMER_CONTROL_REVISION_REQUIRED'; END IF;
  NEW."updatedAt":=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "CustomerControl_revision" BEFORE UPDATE ON atlas_customer."CustomerControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_customer.control_revision_guard();
CREATE TRIGGER "CustomerControl_no_delete" BEFORE DELETE ON atlas_customer."CustomerControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE TRIGGER "CustomerControl_no_truncate" BEFORE TRUNCATE ON atlas_customer."CustomerControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE TRIGGER "CustomerSubmission_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CustomerSubmission"
  FOR EACH ROW EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE TRIGGER "CustomerCardEvent_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CustomerCardEvent"
  FOR EACH ROW EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE TRIGGER "CustomerSubmission_no_truncate" BEFORE TRUNCATE ON atlas_customer."CustomerSubmission"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE TRIGGER "CustomerCardEvent_no_truncate" BEFORE TRUNCATE ON atlas_customer."CustomerCardEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.immutable_record();
CREATE FUNCTION atlas_customer.card_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP<>'UPDATE' OR OLD."specimenId" IS NOT NULL OR NEW."specimenId" IS NULL
    OR (to_jsonb(NEW)-'specimenId') IS DISTINCT FROM (to_jsonb(OLD)-'specimenId') THEN
    RAISE EXCEPTION 'CUSTOMER_CARD_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CustomerCard_binding_only" BEFORE UPDATE OR DELETE ON atlas_customer."CustomerCard"
  FOR EACH ROW EXECUTE FUNCTION atlas_customer.card_binding_guard();
CREATE TRIGGER "CustomerCard_no_truncate" BEFORE TRUNCATE ON atlas_customer."CustomerCard"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.immutable_record();

CREATE FUNCTION atlas_customer.valid_profile(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(p)='object' AND
    p ?& ARRAY['name','address1','address2','city','region','postalCode','country'] AND
    (p-ARRAY['name','address1','address2','city','region','postalCode','country'])='{}'::jsonb AND
    NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value)<>'string'
      OR length(p->>e.key)>CASE e.key WHEN 'name' THEN 120 WHEN 'address1' THEN 200 WHEN 'address2' THEN 200 WHEN 'postalCode' THEN 30 WHEN 'country' THEN 2 ELSE 100 END OR (p->>e.key) ~ '[[:cntrl:]]'
      OR (p->>e.key)<>btrim(p->>e.key)
      OR (e.key NOT IN ('address2','region') AND length(p->>e.key)=0)) AND
    (p->>'country') ~ '^[A-Z]{2}$', false)
$$;
ALTER TABLE atlas_customer."CustomerAccount" ADD CONSTRAINT "CustomerAccount_profile" CHECK (profile IS NULL OR atlas_customer.valid_profile(profile));
ALTER TABLE atlas_customer."CustomerSubmission" ADD CONSTRAINT "CustomerSubmission_profile" CHECK (atlas_customer.valid_profile("profileSnapshot"));

CREATE FUNCTION atlas_customer.problem(s integer,c text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('error',jsonb_build_object('status',s,'code',c))
$$;
CREATE FUNCTION atlas_customer.take_rate(k text,lim integer) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE n integer; t timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO atlas_customer."CustomerRateBucket"(key,count,"expiresAt") VALUES (k,1,t+interval '15 minutes')
 ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "CustomerRateBucket"."expiresAt"<=t THEN 1 ELSE least("CustomerRateBucket".count+1,lim+1) END,
 "expiresAt"=CASE WHEN "CustomerRateBucket"."expiresAt"<=t THEN t+interval '15 minutes' ELSE "CustomerRateBucket"."expiresAt" END
 RETURNING count INTO n;
 RETURN n<=lim;
END $$;
CREATE FUNCTION atlas_customer.current_account(sh text,bh text,rev integer) RETURNS atlas_customer."CustomerAccount"
LANGUAGE sql SET search_path=pg_catalog,atlas_customer AS $$
 SELECT a.* FROM atlas_customer."CustomerSession" s
 JOIN atlas_customer."CustomerBrowser" b ON b."tokenHash"=s."browserHash"
 JOIN atlas_customer."CustomerAccount" a ON a.id=s."accountId"
 WHERE s."tokenHash"=sh AND s."browserHash"=bh AND s."revokedAt" IS NULL AND a."revokedAt" IS NULL
   AND s."accessVersion"=a."accessVersion" AND s."controlRevision"=rev AND b."controlRevision"=rev
   AND s."createdAt"<=clock_timestamp() AND s."expiresAt">clock_timestamp() AND b."expiresAt">clock_timestamp()
 FOR SHARE OF a,s,b
$$;
CREATE FUNCTION atlas_customer.account_projection(a atlas_customer."CustomerAccount") RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',a.id,'phone',a.phone,'profile',a.profile,'createdAt',a."createdAt") END
$$;

-- No raw staff content, draft media, provider errors, grading arithmetic or
-- customer identity is copied into this projection. Each milestone has evidence.
CREATE FUNCTION atlas_customer.card_projection(cid uuid,staff_view boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE c atlas_customer."CustomerCard"; milestones jsonb; current_stage text; action_record record; shipment_record record; report_record record;
BEGIN
 SELECT * INTO c FROM atlas_customer."CustomerCard" WHERE id=cid;
 IF c.id IS NULL THEN RETURN NULL; END IF;
 WITH evidence(kind,at,rank) AS (
   SELECT 'SUBMITTED',c."createdAt",1
   UNION ALL SELECT 'RECEIVED',e."recordedAt",2 FROM atlas_customer."CustomerCardEvent" e WHERE e."cardId"=c.id AND e.kind='RECEIVED'
   UNION ALL SELECT 'GRADING',g."dispatchedAt" AT TIME ZONE 'UTC',3 FROM atlas_staff."StaffGradingOperation" g WHERE g."specimenId"=c."specimenId" AND g."dispatchedAt" IS NOT NULL
   UNION ALL SELECT 'GRADING',g."dispatchedAt" AT TIME ZONE 'UTC',3 FROM atlas_staff."StaffMachineInitialization" g WHERE g."specimenId"=c."specimenId" AND g."dispatchedAt" IS NOT NULL
   UNION ALL SELECT 'FINAL_REVIEW',o."createdAt" AT TIME ZONE 'UTC',4 FROM atlas_staff."StaffOperatorOutbox" o JOIN atlas_staff."StaffOperatorRun" r ON r.id=o."runId"
     JOIN atlas_staff."StaffSpecimen" sp ON sp.id=r."specimenId" AND sp."analysisRevision"=r."expectedAnalysisRevision" AND sp."draftRevision"=r."expectedReviewRevision" AND sp."evidenceHash"=r."evidenceHash"
     WHERE r."specimenId"=c."specimenId" AND o.type='HUMAN_REVIEW_READY'
   UNION ALL SELECT 'FINAL_REVIEW',r."savedAt" AT TIME ZONE 'UTC',4 FROM atlas_staff."StaffReviewRevision" r
     JOIN atlas_staff."StaffSpecimen" sp ON sp.id=r."specimenId" AND sp."analysisRevision"=r."analysisRevision" AND sp."evidenceHash"=r."evidenceHash"
     WHERE r."specimenId"=c."specimenId" AND r."savedById" IS NOT NULL AND r."analysisRevision">0 AND r.revision>1
   UNION ALL SELECT 'APPROVED',a."approvedAt" AT TIME ZONE 'UTC',5 FROM atlas_staff."StaffReportApproval" a
     JOIN atlas_staff."StaffPublicReport" p ON p."currentApprovalId"=a.id AND p."specimenId"=a."specimenId"
     JOIN atlas_staff."StaffSpecimen" sp ON sp.id=a."specimenId" AND sp."analysisRevision"=a."analysisRevision" AND sp."draftRevision"=a."reviewRevision" AND sp."evidenceHash"=a."evidenceHash"
     WHERE a."specimenId"=c."specimenId"
   UNION ALL SELECT 'ENCAPSULATED',w."physicalConfirmedAt" AT TIME ZONE 'UTC',6 FROM atlas_staff."StaffPhysicalFinish" w JOIN atlas_staff."StaffPhysicalFinish" a ON a.id=w."assemblyId"
     AND a."specimenId"=w."specimenId" AND a."approvalId"=w."approvalId" AND a."labelIssueId"=w."labelIssueId" AND a."verificationId"=w."verificationId"
     JOIN atlas_staff."StaffReportApproval" ap ON ap.id=w."approvalId" AND ap."specimenId"=w."specimenId"
     JOIN atlas_staff."StaffPublicReport" p ON p."currentApprovalId"=ap.id AND p."specimenId"=w."specimenId"
     JOIN atlas_staff."StaffSpecimen" sp ON sp.id=w."specimenId" AND sp."analysisRevision"=ap."analysisRevision" AND sp."draftRevision"=ap."reviewRevision" AND sp."evidenceHash"=ap."evidenceHash"
     WHERE w."specimenId"=c."specimenId" AND w.stage='SONIC_WELDED' AND a.stage='ASSEMBLED'
       AND w."labelIssueId"=(SELECT l.id FROM atlas_staff."StaffLabelIssue" l WHERE l."specimenId"=sp.id AND l."approvalId"=ap.id ORDER BY l."createdAt" DESC,l.id DESC LIMIT 1)
       AND w."verificationId"=(SELECT v.id FROM atlas_staff."StaffNfcVerification" v JOIN atlas_staff."StaffNfcJob" j ON j.id=v."jobId" WHERE v."specimenId"=sp.id AND v."approvalId"=ap.id AND j."labelIssueId"=w."labelIssueId" ORDER BY v."createdAt" DESC,v.id DESC LIMIT 1)
   UNION ALL SELECT 'SHIPPED',e."recordedAt",7 FROM atlas_customer."CustomerCardEvent" e WHERE e."cardId"=c.id AND e.kind='SHIPPED'
 ), firsts AS (SELECT kind,min(at) AS at,rank FROM evidence WHERE at<=clock_timestamp() GROUP BY kind,rank)
 SELECT jsonb_agg(jsonb_build_object('kind',kind,'recordedAt',at) ORDER BY rank), (array_agg(kind ORDER BY rank DESC))[1] INTO milestones,current_stage FROM firsts;
 SELECT kind,details,"recordedAt" INTO action_record FROM atlas_customer."CustomerCardEvent" WHERE "cardId"=c.id AND kind IN ('ACTION_NEEDED','ACTION_RESOLVED') ORDER BY "recordedAt" DESC,id DESC LIMIT 1;
 SELECT details,"recordedAt" INTO shipment_record FROM atlas_customer."CustomerCardEvent" WHERE "cardId"=c.id AND kind='SHIPPED';
 SELECT p."publicToken",a.version INTO report_record FROM atlas_staff."StaffPublicReport" p JOIN atlas_staff."StaffReportApproval" a ON a.id=p."currentApprovalId" AND a."specimenId"=p."specimenId" WHERE p."specimenId"=c."specimenId";
 RETURN jsonb_build_object('id',c.id,'title',c.title,'category',c.category,'stage',current_stage,'events',milestones,
   'actionNeeded',CASE WHEN action_record.kind='ACTION_NEEDED' THEN jsonb_build_object('reason',action_record.details->>'reason','message',action_record.details->>'message','recordedAt',action_record."recordedAt") ELSE NULL END,
   'shipment',CASE WHEN shipment_record."recordedAt" IS NOT NULL THEN jsonb_build_object('carrier',shipment_record.details->>'carrier','trackingNumber',shipment_record.details->>'trackingNumber','recordedAt',shipment_record."recordedAt") ELSE NULL END,
   'reportUrl',CASE WHEN report_record."publicToken" ~ '^ar_[A-Za-z0-9_-]{24}$' AND report_record.version>0 THEN '/reports/'||report_record."publicToken"||'?v='||report_record.version ELSE NULL END)
   || CASE WHEN staff_view THEN jsonb_build_object('specimenId',c."specimenId") ELSE '{}'::jsonb END;
END $$;
CREATE FUNCTION atlas_customer.submission_projection(sid uuid,staff_view boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('id',s.id,'reference',s.reference,'createdAt',s."createdAt",'intakeMethod',s."intakeMethod",'profileSnapshot',s."profileSnapshot",'cards',
   COALESCE((SELECT jsonb_agg(atlas_customer.card_projection(c.id,staff_view) ORDER BY c."createdAt",c.id) FROM atlas_customer."CustomerCard" c WHERE c."submissionId"=s.id),'[]'::jsonb))
 FROM atlas_customer."CustomerSubmission" s WHERE s.id=sid
$$;

-- The customer serving role receives this one function only. A request's account
-- identity always resolves from a valid durable session inside this function.
CREATE FUNCTION atlas_customer.customer_call(action text,binding jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; b atlas_customer."CustomerBrowser"; c atlas_customer."CustomerChallenge";
 prior atlas_customer."CustomerChallenge"; a atlas_customer."CustomerAccount"; sub atlas_customer."CustomerSubmission";
 t timestamptz:=clock_timestamp(); result jsonb; payload jsonb; input_hash text; card jsonb; sid uuid; cursor_row record;
 rows_json jsonb:='[]'::jsonb; next_cursor uuid; row_item record; count_rows integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 t:=clock_timestamp();
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding)<>'object' OR
   (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
   RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='bootstrap' THEN
   SELECT * INTO b FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">t AND "controlRevision"=ctl.revision;
   IF b."tokenHash" IS NULL THEN
     IF NOT atlas_customer.take_rate('browser-global',180) OR NOT atlas_customer.take_rate('browser-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     INSERT INTO atlas_customer."CustomerBrowser"("tokenHash","controlRevision","createdAt","expiresAt") VALUES (d->>'newBrowserHash',ctl.revision,t,t+interval '7 days') RETURNING * INTO b;
   END IF;
   SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
   RETURN jsonb_build_object('browserHash',b."tokenHash",'customer',atlas_customer.account_projection(a));
 END IF;
 SELECT * INTO b FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">t AND "controlRevision"=ctl.revision;
 IF b."tokenHash" IS NULL THEN RETURN atlas_customer.problem(403,'SIGN_IN_SESSION_EXPIRED'); END IF;
 IF action='send_claim' THEN
   IF (d->>'phone') !~ '^\+[1-9][0-9]{7,14}$' OR (d->>'phoneHash') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'USE_INTERNATIONAL_PHONE'); END IF;
   SELECT * INTO c FROM atlas_customer."CustomerChallenge" WHERE "browserHash"=b."tokenHash" AND "requestId"=(d->>'requestId')::uuid;
   IF c.id IS NOT NULL THEN
     IF c.phone IS DISTINCT FROM d->>'phone' THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     IF c.state<>'PENDING' OR c."expiresAt"<=t OR c."controlRevision"<>ctl.revision THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
     RETURN jsonb_build_object('existing',true,'challengeId',c.id,'expiresAt',c."expiresAt");
   END IF;
   IF NOT atlas_customer.take_rate('send-global',60) OR NOT atlas_customer.take_rate('send-client:'||(d->>'clientHash'),12) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   SELECT * INTO prior FROM atlas_customer."CustomerChallenge" WHERE phone=d->>'phone' AND state IN ('SENDING','PENDING','CHECKING','UNKNOWN') ORDER BY "createdAt" DESC,id DESC LIMIT 1;
   IF prior.id IS NOT NULL THEN
     IF prior.state IN ('SENDING','CHECKING','UNKNOWN') AND prior."quarantineUntil">t THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
     IF prior."createdAt"+interval '1 minute'>t THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   END IF;
   IF NOT atlas_customer.take_rate('send-phone:'||(d->>'phoneHash'),4) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   UPDATE atlas_customer."CustomerChallenge" SET state='SUPERSEDED' WHERE phone=d->>'phone' AND state IN ('SENDING','PENDING','CHECKING','UNKNOWN');
   INSERT INTO atlas_customer."CustomerChallenge"(id,"browserHash","requestId","phoneHash",phone,"controlRevision","accountSid","serviceSid",state,"sendClaimId","createdAt","expiresAt","quarantineUntil")
     VALUES (d->>'challengeId',b."tokenHash",(d->>'requestId')::uuid,d->>'phoneHash',d->>'phone',ctl.revision,d->>'accountSid',d->>'serviceSid','SENDING',(d->>'claimId')::uuid,t,t+interval '5 minutes',t+interval '11 minutes') RETURNING * INTO c;
   RETURN jsonb_build_object('existing',false,'challengeId',c.id,'expiresAt',c."expiresAt");
 ELSIF action IN ('send_finish','check_claim','check_finish') THEN
   SELECT * INTO c FROM atlas_customer."CustomerChallenge" WHERE id=d->>'challengeId' AND "browserHash"=b."tokenHash" FOR UPDATE;
   IF c.id IS NULL OR c."controlRevision"<>ctl.revision OR c."expiresAt"<=t THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
   IF action='check_claim' THEN
     IF NOT atlas_customer.take_rate('check-global',180) OR NOT atlas_customer.take_rate('check-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     IF c.state='CONSUMED' THEN
       SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
       IF a.id IS NULL OR c."replayUntil"<=t OR c."replayHash" IS DISTINCT FROM d->>'replayHash'
         OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerSession" s WHERE s."tokenHash"=d->>'sessionHash' AND s."challengeId"=c.id) THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
       RETURN jsonb_build_object('existing',true,'customer',atlas_customer.account_projection(a));
     END IF;
     IF c.state<>'PENDING' OR c.attempts>=5 THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
     IF NOT atlas_customer.take_rate('check-phone:'||c."phoneHash",20) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     UPDATE atlas_customer."CustomerChallenge" SET state='CHECKING',"checkClaimId"=(d->>'claimId')::uuid,attempts=attempts+1 WHERE id=c.id;
     RETURN jsonb_build_object('existing',false,'verificationSid',c."verificationSid");
   END IF;
   IF (action='send_finish' AND (c.state<>'SENDING' OR c."sendClaimId" IS DISTINCT FROM (d->>'claimId')::uuid))
     OR (action='check_finish' AND (c.state<>'CHECKING' OR c."checkClaimId" IS DISTINCT FROM (d->>'claimId')::uuid)) THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
   result:=d->'result';
   IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR (result->>'accountSid',result->>'serviceSid',result->>'phone',result->>'channel') IS DISTINCT FROM (c."accountSid",c."serviceSid",c.phone,'sms')
     OR (result->>'verificationSid') IS NULL OR (result->>'verificationSid') !~ '^VE[0-9a-fA-F]{32}$'
     OR (action='check_finish' AND c."verificationSid" IS DISTINCT FROM result->>'verificationSid')
     OR COALESCE(result->>'status','') NOT IN ('pending','approved') OR (action='send_finish' AND result->>'status'<>'pending') THEN
     UPDATE atlas_customer."CustomerChallenge" SET state='UNKNOWN' WHERE id=c.id;
     RETURN atlas_customer.problem(503,'SIGN_IN_RESTART_REQUIRED');
   END IF;
   IF result->>'status'='pending' THEN
     UPDATE atlas_customer."CustomerChallenge" SET state='PENDING',"verificationSid"=result->>'verificationSid',"checkClaimId"=NULL WHERE id=c.id;
     IF action='check_finish' THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
     RETURN jsonb_build_object('challengeId',c.id,'expiresAt',c."expiresAt");
   END IF;
   SELECT * INTO a FROM atlas_customer."CustomerAccount" WHERE phone=c.phone FOR UPDATE;
   IF a."revokedAt" IS NOT NULL THEN UPDATE atlas_customer."CustomerChallenge" SET state='UNKNOWN' WHERE id=c.id; RETURN atlas_customer.problem(403,'SIGN_IN_NOT_AVAILABLE'); END IF;
   INSERT INTO atlas_customer."CustomerAccount"("phoneHash",phone,"lastLoginAt") VALUES (c."phoneHash",c.phone,t)
     ON CONFLICT (phone) DO UPDATE SET "lastLoginAt"=EXCLUDED."lastLoginAt","phoneHash"=EXCLUDED."phoneHash" RETURNING * INTO a;
   INSERT INTO atlas_customer."CustomerSession"("tokenHash","accountId","browserHash","challengeId","controlRevision","accessVersion","createdAt","expiresAt")
     VALUES (d->>'sessionHash',a.id,b."tokenHash",c.id,ctl.revision,a."accessVersion",t,least(t+interval '12 hours',b."expiresAt"));
   UPDATE atlas_customer."CustomerChallenge" SET state='CONSUMED',"consumedAt"=t,"replayHash"=d->>'replayHash',"replayUntil"=least(c."expiresAt",t+interval '1 minute') WHERE id=c.id;
   RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
 END IF;
 IF action='logout' THEN
   PERFORM 1 FROM atlas_customer."CustomerSession" WHERE "tokenHash"=d->>'sessionHash' AND "browserHash"=b."tokenHash" AND "controlRevision"=ctl.revision;
   IF NOT FOUND THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
   UPDATE atlas_customer."CustomerSession" SET "revokedAt"=t WHERE "tokenHash"=d->>'sessionHash' AND "browserHash"=b."tokenHash" AND "revokedAt" IS NULL;
   RETURN jsonb_build_object('signedOut',true);
 END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF action='profile' THEN
   IF NOT atlas_customer.valid_profile(d->'profile') THEN RETURN atlas_customer.problem(400,'RETURN_DETAILS_REQUIRED'); END IF;
   UPDATE atlas_customer."CustomerAccount" SET profile=d->'profile' WHERE id=a.id RETURNING * INTO a;
   RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
 ELSIF action='submit' THEN
   payload:=d->'submission';
   IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->'confirmed' IS DISTINCT FROM 'true'::jsonb
     OR COALESCE(payload->>'intakeMethod','') NOT IN ('DEALER_DROP_OFF','MAIL_IN')
     OR NOT atlas_customer.valid_profile(payload->'profile') OR jsonb_typeof(payload->'cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(payload->'cards') NOT BETWEEN 1 AND 25 THEN RETURN atlas_customer.problem(400,'INVALID_SUBMISSION'); END IF;
   FOR card IN SELECT value FROM jsonb_array_elements(payload->'cards') LOOP
     IF jsonb_typeof(card) IS DISTINCT FROM 'object' OR (card-ARRAY['title','category'])<>'{}'::jsonb
       OR jsonb_typeof(card->'title') IS DISTINCT FROM 'string' OR length(btrim(card->>'title')) NOT BETWEEN 1 AND 180
       OR card->>'title'<>btrim(card->>'title') OR (card->>'title') ~ '[[:cntrl:]]'
       OR COALESCE(card->>'category','') NOT IN ('SPORTS','POKEMON') THEN RETURN atlas_customer.problem(400,'INVALID_SUBMISSION'); END IF;
   END LOOP;
   input_hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
   SELECT * INTO sub FROM atlas_customer."CustomerSubmission" WHERE "accountId"=a.id AND "requestId"=(payload->>'requestId')::uuid;
   IF sub.id IS NOT NULL THEN
     IF sub."inputHash"<>input_hash THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('submission',atlas_customer.submission_projection(sub.id));
   END IF;
   IF NOT atlas_customer.take_rate('submit-account:'||a.id,10) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   sid:=gen_random_uuid();
   INSERT INTO atlas_customer."CustomerSubmission"(id,reference,"accountId","requestId","inputHash","intakeMethod","profileSnapshot","createdAt")
     VALUES (sid,'ATLAS-'||upper(substr(replace(sid::text,'-',''),1,12)),a.id,(payload->>'requestId')::uuid,input_hash,payload->>'intakeMethod',payload->'profile',t);
   FOR card IN SELECT value FROM jsonb_array_elements(payload->'cards') LOOP
     INSERT INTO atlas_customer."CustomerCard"("submissionId",title,category,"createdAt") VALUES (sid,card->>'title',card->>'category',t);
   END LOOP;
   UPDATE atlas_customer."CustomerAccount" SET profile=payload->'profile' WHERE id=a.id;
   RETURN jsonb_build_object('submission',atlas_customer.submission_projection(sid));
 ELSIF action='submission_request' THEN
   SELECT * INTO sub FROM atlas_customer."CustomerSubmission" WHERE "requestId"=(d->>'id')::uuid AND "accountId"=a.id;
   IF sub.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('submission',atlas_customer.submission_projection(sub.id));
 ELSIF action='submission' THEN
   SELECT * INTO sub FROM atlas_customer."CustomerSubmission" WHERE id=(d->>'id')::uuid AND "accountId"=a.id;
   IF sub.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('submission',atlas_customer.submission_projection(sub.id));
 ELSIF action='card' THEN
   SELECT c2.id INTO sid FROM atlas_customer."CustomerCard" c2 JOIN atlas_customer."CustomerSubmission" s ON s.id=c2."submissionId" WHERE c2.id=(d->>'id')::uuid AND s."accountId"=a.id;
   IF sid IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('card',atlas_customer.card_projection(sid));
 ELSIF action='list' THEN
   IF d->>'cursor' IS NOT NULL THEN
     SELECT id,"createdAt" INTO cursor_row FROM atlas_customer."CustomerSubmission" WHERE id=(d->>'cursor')::uuid AND "accountId"=a.id;
     IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   ELSE SELECT NULL::uuid AS id,NULL::timestamptz AS "createdAt" INTO cursor_row; END IF;
   FOR row_item IN SELECT s.id FROM atlas_customer."CustomerSubmission" s WHERE s."accountId"=a.id
     AND (cursor_row.id IS NULL OR (s."createdAt",s.id)<(cursor_row."createdAt",cursor_row.id)) ORDER BY s."createdAt" DESC,s.id DESC LIMIT 6 LOOP
     count_rows:=count_rows+1;
     IF count_rows=6 THEN EXIT; END IF;
     rows_json:=rows_json||jsonb_build_array(atlas_customer.submission_projection(row_item.id)); next_cursor:=row_item.id;
   END LOOP;
   RETURN jsonb_build_object('submissions',rows_json,'nextCursor',CASE WHEN count_rows=6 THEN next_cursor ELSE NULL END);
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
END $$;

-- Separate operations role only; never granted to the customer or public app.
CREATE FUNCTION atlas_staff.customer_operations(action text,session_hash text,browser_hash text,binding jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer,atlas_staff AS $$
DECLARE ctl atlas_staff."StaffControl"; s atlas_staff."StaffSession"; b atlas_staff."StaffBrowser"; actor atlas_staff."StaffIdentity";
 grant_count integer; grant_id uuid; c atlas_customer."CustomerCard"; prior atlas_customer."CustomerCardEvent"; event_row atlas_customer."CustomerCardEvent";
 t timestamptz:=clock_timestamp(); ih text; event_kind text; detail jsonb; cursor_row record; row_item record;
 rows_json jsonb:='[]'::jsonb; next_cursor uuid; count_rows integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 SELECT * INTO ctl FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'STAFF_ACCESS_NOT_ENABLED'); END IF;
 SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash AND "browserHash"=browser_hash FOR SHARE;
 SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=browser_hash FOR SHARE;
 SELECT * INTO actor FROM atlas_staff."StaffIdentity" WHERE id=s."identityId" FOR SHARE;
 t:=clock_timestamp();
 IF s."tokenHash" IS NULL OR actor.id IS NULL OR s."revokedAt" IS NOT NULL OR actor."revokedAt" IS NOT NULL
   OR actor.role<>'REVIEWER' OR s."accessVersion"<>actor."accessVersion" OR s."controlRevision"<>ctl.revision OR b."controlRevision"<>ctl.revision
   OR s."createdAt" AT TIME ZONE 'UTC'>t OR (s."createdAt" AT TIME ZONE 'UTC')+interval '5 minutes'<=t
   OR s."expiresAt" AT TIME ZONE 'UTC'<=t OR b."expiresAt" AT TIME ZONE 'UTC'<=t THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
 SELECT count(*),(array_agg(id))[1] INTO grant_count,grant_id FROM (SELECT g.id FROM atlas_staff."StaffOperationsGrant" g WHERE g."identityId"=actor.id AND g."accessVersion"=actor."accessVersion" AND g."controlRevision"=ctl.revision AND g."revokedAt" IS NULL
   AND (g.mode,g.origin,g."deploymentId",g."releaseSha",g."configHash")=(ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash")
   AND g."createdAt" AT TIME ZONE 'UTC'<=t AND g."expiresAt" AT TIME ZONE 'UTC'>t FOR SHARE) grants;
 IF grant_count<>1 THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF (action='list' AND (NOT (d ? 'cursor') OR d-'cursor'<>'{}'::jsonb))
   OR (action='bind' AND (NOT (d ?& ARRAY['operationId','cardId','specimenId','physicalReceiptConfirmed']) OR d-ARRAY['operationId','cardId','specimenId','physicalReceiptConfirmed']<>'{}'::jsonb))
   OR (action='action' AND (NOT (d ?& ARRAY['operationId','cardId','reason','message','resolved']) OR d-ARRAY['operationId','cardId','reason','message','resolved']<>'{}'::jsonb))
   OR (action='ship' AND (NOT (d ?& ARRAY['operationId','cardId','carrier','trackingNumber','physicalDispatchConfirmed']) OR d-ARRAY['operationId','cardId','carrier','trackingNumber','physicalDispatchConfirmed']<>'{}'::jsonb)) THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='list' THEN
   IF d->>'cursor' IS NOT NULL THEN
     SELECT id,"createdAt" INTO cursor_row FROM atlas_customer."CustomerSubmission" WHERE id=(d->>'cursor')::uuid;
     IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   ELSE SELECT NULL::uuid AS id,NULL::timestamptz AS "createdAt" INTO cursor_row; END IF;
   FOR row_item IN SELECT sub.id FROM atlas_customer."CustomerSubmission" sub WHERE cursor_row.id IS NULL OR (sub."createdAt",sub.id)<(cursor_row."createdAt",cursor_row.id) ORDER BY sub."createdAt" DESC,sub.id DESC LIMIT 6 LOOP
     count_rows:=count_rows+1; IF count_rows=6 THEN EXIT; END IF;
     rows_json:=rows_json||jsonb_build_array(atlas_customer.submission_projection(row_item.id,true)); next_cursor:=row_item.id;
   END LOOP;
   RETURN jsonb_build_object('submissions',rows_json,'nextCursor',CASE WHEN count_rows=6 THEN next_cursor ELSE NULL END);
 END IF;
 ih:=encode(sha256(convert_to(jsonb_build_object('action',action,'data',d)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM atlas_customer."CustomerCardEvent" WHERE "actorId"=actor.id AND "operationId"=(d->>'operationId')::uuid;
 IF prior.id IS NOT NULL THEN
   IF prior."inputHash"<>ih OR prior."cardId" IS DISTINCT FROM (d->>'cardId')::uuid THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('receipt',jsonb_build_object('id',prior.id,'operationId',prior."operationId",'cardId',prior."cardId",'kind',prior.kind,'recordedAt',prior."recordedAt"));
 END IF;
 SELECT * INTO c FROM atlas_customer."CustomerCard" WHERE id=(d->>'cardId')::uuid FOR UPDATE;
 IF c.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='bind' THEN
   IF d->'physicalReceiptConfirmed' IS DISTINCT FROM 'true'::jsonb OR c."specimenId" IS NOT NULL THEN RETURN atlas_customer.problem(409,'PHYSICAL_RECEIPT_REQUIRED'); END IF;
   PERFORM 1 FROM atlas_staff."StaffAssignment" a WHERE a."specimenId"=(d->>'specimenId')::uuid AND a."identityId"=actor.id
     AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt" AT TIME ZONE 'UTC'>t FOR SHARE;
   IF NOT FOUND THEN RETURN atlas_customer.problem(403,'ASSIGNMENT_REQUIRED'); END IF;
   IF EXISTS (SELECT 1 FROM atlas_customer."CustomerCard" WHERE "specimenId"=(d->>'specimenId')::uuid) THEN RETURN atlas_customer.problem(409,'SPECIMEN_ALREADY_LINKED'); END IF;
   UPDATE atlas_customer."CustomerCard" SET "specimenId"=(d->>'specimenId')::uuid WHERE id=c.id;
   event_kind:='RECEIVED'; detail:=jsonb_build_object('specimenId',d->>'specimenId');
 ELSIF action='action' THEN
   IF EXISTS (SELECT 1 FROM atlas_customer."CustomerCardEvent" WHERE "cardId"=c.id AND kind='SHIPPED') THEN RETURN atlas_customer.problem(409,'ALREADY_SHIPPED'); END IF;
   IF COALESCE(d->>'reason','') NOT IN ('CONTACT_SUPPORT','CONFIRM_RETURN_ADDRESS','CARD_DETAILS_NEEDED') OR jsonb_typeof(d->'resolved') IS DISTINCT FROM 'boolean'
     OR (d->'resolved'='false'::jsonb AND (jsonb_typeof(d->'message') IS DISTINCT FROM 'string' OR length(btrim(d->>'message')) NOT BETWEEN 1 AND 500 OR (d->>'message') ~ '[[:cntrl:]]'))
     OR (d->'resolved'='true'::jsonb AND d->'message' IS DISTINCT FROM 'null'::jsonb) THEN RETURN atlas_customer.problem(400,'INVALID_CUSTOMER_MESSAGE'); END IF;
   event_kind:=CASE WHEN d->'resolved'='true'::jsonb THEN 'ACTION_RESOLVED' ELSE 'ACTION_NEEDED' END;
   detail:=jsonb_build_object('reason',d->>'reason','message',d->'message');
 ELSIF action='ship' THEN
   PERFORM 1 FROM atlas_staff."StaffSpecimen" WHERE id=c."specimenId" FOR SHARE;
   IF EXISTS (SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=c."specimenId" AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
     OR atlas_staff.operator_work_pending(c."specimenId")>0 THEN RETURN atlas_customer.problem(409,'GRADING_WORK_UNRESOLVED'); END IF;
   IF (SELECT kind FROM atlas_customer."CustomerCardEvent" WHERE "cardId"=c.id AND kind IN ('ACTION_NEEDED','ACTION_RESOLVED') ORDER BY "recordedAt" DESC,id DESC LIMIT 1)='ACTION_NEEDED' THEN RETURN atlas_customer.problem(409,'CUSTOMER_ACTION_REQUIRED'); END IF;
   IF d->'physicalDispatchConfirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(d->'carrier') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'trackingNumber') IS DISTINCT FROM 'string'
     OR length(btrim(d->>'carrier')) NOT BETWEEN 2 AND 60 OR length(btrim(d->>'trackingNumber')) NOT BETWEEN 3 AND 100
     OR (d->>'carrier') ~ '[[:cntrl:]]' OR (d->>'trackingNumber') ~ '[[:cntrl:]]' THEN RETURN atlas_customer.problem(400,'PHYSICAL_DISPATCH_REQUIRED'); END IF;
   IF NOT EXISTS (SELECT 1 FROM atlas_staff."StaffPublicReport" p JOIN atlas_staff."StaffReportApproval" ap ON ap.id=p."currentApprovalId" AND ap."specimenId"=p."specimenId"
     JOIN atlas_staff."StaffSpecimen" sp ON sp.id=p."specimenId" AND sp."analysisRevision"=ap."analysisRevision" AND sp."draftRevision"=ap."reviewRevision" AND sp."evidenceHash"=ap."evidenceHash"
     JOIN atlas_staff."StaffPhysicalFinish" w ON w."specimenId"=p."specimenId" AND w."approvalId"=ap.id AND w.stage='SONIC_WELDED'
     JOIN atlas_staff."StaffPhysicalFinish" a ON a.id=w."assemblyId" AND a.stage='ASSEMBLED' AND a."specimenId"=w."specimenId" AND a."approvalId"=w."approvalId" AND a."labelIssueId"=w."labelIssueId" AND a."verificationId"=w."verificationId"
     WHERE p."specimenId"=c."specimenId" AND w."physicalConfirmedAt" AT TIME ZONE 'UTC'<=t
       AND w."labelIssueId"=(SELECT l.id FROM atlas_staff."StaffLabelIssue" l WHERE l."specimenId"=sp.id AND l."approvalId"=ap.id ORDER BY l."createdAt" DESC,l.id DESC LIMIT 1)
       AND w."verificationId"=(SELECT v.id FROM atlas_staff."StaffNfcVerification" v JOIN atlas_staff."StaffNfcJob" j ON j.id=v."jobId" WHERE v."specimenId"=sp.id AND v."approvalId"=ap.id AND j."labelIssueId"=w."labelIssueId" ORDER BY v."createdAt" DESC,v.id DESC LIMIT 1)) THEN RETURN atlas_customer.problem(409,'ENCAPSULATION_REQUIRED'); END IF;
   IF EXISTS (SELECT 1 FROM atlas_customer."CustomerCardEvent" WHERE "cardId"=c.id AND kind='SHIPPED') THEN RETURN atlas_customer.problem(409,'ALREADY_SHIPPED'); END IF;
   event_kind:='SHIPPED'; detail:=jsonb_build_object('carrier',btrim(d->>'carrier'),'trackingNumber',btrim(d->>'trackingNumber'));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 detail:=detail||jsonb_build_object('sessionHash',session_hash,'accessVersion',actor."accessVersion",'controlRevision',ctl.revision,'operationsGrantId',grant_id);
 INSERT INTO atlas_customer."CustomerCardEvent"("cardId",kind,"actorId","operationId","inputHash",details,"recordedAt") VALUES (c.id,event_kind,actor.id,(d->>'operationId')::uuid,ih,detail,t) RETURNING * INTO event_row;
 RETURN jsonb_build_object('receipt',jsonb_build_object('id',event_row.id,'operationId',event_row."operationId",'cardId',c.id,'kind',event_kind,'recordedAt',event_row."recordedAt"));
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA atlas_customer FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_customer FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_staff.customer_operations(text,text,text,jsonb,jsonb) FROM PUBLIC;
-- No login, activation, credentials or production data are created by migration.
-- Provision an independent customer login with USAGE atlas_customer plus EXECUTE
-- customer_call(text,jsonb,jsonb). Do not grant SELECT, membership or table writes.
COMMIT;
