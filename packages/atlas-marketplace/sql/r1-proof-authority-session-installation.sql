-- Initial production-session binding only. Inert; no runtime loads this file.
-- Root must produce/review one exact operator copy from the current live owner's
-- WAIT_INSTALL observation and the matching protected NON_PAYMENT configuration.
-- Replace only the JSON block below; remove only the intentional first exception.
-- Never fabricate an observation, generate a replacement session ID or reuse a
-- stopped process. COMMIT permits that same waiting process to open its listeners.
-- Unknown outcome: read the original installation; never retry this transaction.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_SESSION_INSTALLATION_REQUIRES_OPERATOR'; END $$;
SET LOCAL synchronous_commit=on;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database()<>'atlas_grading' OR current_user<>'doadmin' OR session_user<>'doadmin'
  OR current_setting('synchronous_commit')<>'on'
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  OR (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname='atlas_proof_authority') IS DISTINCT FROM 'atlas_proof_authority_owner'
  OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker']))<>4
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
    AND (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin<>(rolname<>'atlas_proof_authority_owner')))
 THEN RAISE EXCEPTION 'EXACT_C0_INITIAL_INSTALLATION_TARGET_REQUIRED'; END IF;
END $$;
DO $membership$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_catalog.pg_auth_members m
 JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE r.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
    OR u.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker']);
 IF n<>4 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
 JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE (r.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
     OR u.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker']))
 AND (r.rolname<>ALL(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
  OR u.rolname<>'doadmin' OR g.rolname<>'postgres' OR g.oid<>10 OR NOT g.rolsuper
  OR NOT m.admin_option OR m.inherit_option OR m.set_option))
 OR has_database_privilege('atlas_proof_authority_owner',current_database(),'CREATE,TEMP')
 THEN RAISE EXCEPTION 'EXACT_C0_OPERATOR_MEMBERSHIPS_REQUIRED'; END IF;
END $membership$;
-- The existing bootstrap ADMIN-only edge cannot perform owner operations.
-- This temporary, installer-granted edge is removed inside this transaction.
GRANT atlas_proof_authority_owner TO doadmin WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY doadmin;
DO $install$
DECLARE
 d jsonb := $input${
  "schema": "atlas-proof-initial-session-install-v1",
  "operatingMode": "NON_PAYMENT",
  "sourceRevision": null,
  "processConfigSha256": null,
  "processObservedAtMs": null,
  "processStatus": null,
  "sessionBinding": null,
  "intakeBinding": null,
  "proofPolicy": null,
  "staffBinding": null,
  "customerBinding": null,
  "staffControlRevision": null,
  "customerControlRevision": null,
  "reviewerIdentityId": null,
  "reviewerAccessVersion": null
}$input$::jsonb;
 p jsonb; b jsonb; i jsonb; policy jsonb; staff jsonb; customer jsonb; report jsonb;
 staff_control atlas_staff."StaffControl"; customer_control atlas_customer."CustomerControl";
 reviewer atlas_staff."StaffIdentity"; ctl atlas_proof_authority.control;
 t timestamptz; observed_ms bigint; expires_ms bigint; k text; tname text; count_rows bigint;
BEGIN
 -- All expected definitions come from independently qualified source pins.
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_proof_authority')<>20
 OR EXISTS(SELECT 1 FROM (VALUES
      ('observe_access_v1(jsonb)','b16c1093a3818156e68817a7d6ef824372b27a5be458282d81512fa86a8d6432'),
      ('claim_stage_v1(jsonb)','7add7f7b7f9fcbcaffa54c5faea7c63efd8eab219b2c1607fd3813143cafb38e'),
      ('apply_mutation_v1(uuid, text)','31b46db4607ce5db20e8917014091501695fb3d58d2d092c2fe13d4da382655f'),
      ('exact_object_v1(jsonb, text[])','d79061b0d839e818bcb2dec76054cccf7f6698028809ad92bedf54e9fad4bb1c'),
      ('record_guard_v1()','d817f918dcb622b173fed1bcb6d07709cdc004e9e8b8880a9fd845c291ea33f6'),
      ('observation_v1(boolean)','2d5d01d6d4162118c79df933c6bacad65dee4220dbe9d74d353e73d725461d2b'),
      ('canonical_v1(jsonb, integer)','e8eb00cb9299a44efad0a7da0fb7f87aee89173452526bec3a3f92ea7e12508d'),
      ('hash_v1(jsonb)','ee0937734ff7281055ede9e149202cd051a57256d275edc441ab19817626ee6f'),
      ('fence_report_v1(atlas_proof_authority.fence)','59fad9b06fef33151b5747c8df819275ff171341604e1c914ebc744aa2a4f2c2'),
      ('lock_canonical_rows_v1(jsonb)','290c4956054fcc63e740de352a4a7ac7a189510478773ee0e2c348bfea5765fd'),
      ('lookup_claim_v1(uuid, text)','4b2055253f1545bcaa7fe501a47250fa0f364a724b36b4db76c5c03ce9f4cbef'),
      ('operator_access_v1(jsonb)','a9c5e512b3abfa61afee45c5c76f39c9e5c7d1744708532ab39d8833a79d3f76'),
      ('reject_unjoined_authority_write()','31059bd765cc2f2d87f7b6c26357ea5d981125b602b31c522556aa72ca88c1fc'),
      ('lookup_stage_v1(uuid, text)','37e0bf56f38a3633e3b3f239a0aaa6915d31b517f10a9e227c64bbe8b5549a31'),
      ('begin_logout_v1(jsonb)','43a18890d16fc01ebb59b081c15cc7ddce64343ca824d48ee17521f3ea801ad5'),
      ('settle_stage_v1(jsonb)','4d25896f01a72893ce55810381ce8e4f66cf0bd94ace280748af83318d062c82'),
      ('settle_drain_v1(jsonb)','059c18afa2583214e90addec8bc80caee925af94588d94f5ce78f960036722f6'),
      ('authorize_mutation_v1(jsonb)','88f562e473006c6551e59bddc15268fd67350971c14f1e5ae86627628427457a'),
      ('begin_mutation_v1(jsonb)','798ef9dbf8998332cada07b1586588ce0bb737ffddd1975ad0aa38390f4582ca'),
      ('read_drain_v1(uuid)','408dbf7aa071404f46b8bdbd8631df469acff2f22b3a093f46d15b1fc7347fa8')
    ) expected(name,definition_hash)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('atlas_proof_authority.'||expected.name)
    WHERE p.oid IS NULL OR pg_catalog.pg_get_userbyid(p.proowner)<>'atlas_proof_authority_owner'
     OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>expected.definition_hash)
 THEN RAISE EXCEPTION 'EXACT_C0_SOURCE_REQUIRED'; END IF;
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','operatingMode','sourceRevision','processConfigSha256','processObservedAtMs','processStatus','sessionBinding','intakeBinding','proofPolicy','staffBinding','customerBinding','staffControlRevision','customerControlRevision','reviewerIdentityId','reviewerAccessVersion']);
 p:=d->'processStatus'; b:=d->'sessionBinding'; i:=d->'intakeBinding'; policy:=d->'proofPolicy'; staff:=d->'staffBinding'; customer:=d->'customerBinding';
 PERFORM atlas_proof_authority.exact_object_v1(p,ARRAY['schema','closed','ledgerId','publisherSessionId','bootId','storageHash','customerPublicationAuthority','phase','sourceRevision','operatingMode','checkoutEnabled','productionReady','saleAuthorityAvailable']);
 PERFORM atlas_proof_authority.exact_object_v1(b,ARRAY['installationId','qualificationSessionId','qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash']);
 PERFORM atlas_proof_authority.exact_object_v1(i,ARRAY['schema','environment','policyHash','storageHash']);
 PERFORM atlas_proof_authority.exact_object_v1(policy,ARRAY['environment','id','version','approvalRef','retentionRef','reviewerAuthorityRef','effectiveAt','expiresAt','retentionMs','maxObjectBytes','maxProofsPerOrder','maxRetainedObjects','uploadTtlMs','validationLeaseMs']);
 PERFORM atlas_proof_authority.exact_object_v1(staff,ARRAY['mode','origin','deploymentId','releaseSha','configHash']);
 PERFORM atlas_proof_authority.exact_object_v1(customer,ARRAY['mode','origin','deploymentId','releaseSha','configHash']);
 IF d->>'schema' IS DISTINCT FROM 'atlas-proof-initial-session-install-v1' OR d->>'operatingMode' IS DISTINCT FROM 'NON_PAYMENT'
  OR d->>'sourceRevision' !~ '^[a-f0-9]{40}$' OR d->>'processConfigSha256' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(d->'sourceRevision') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'processConfigSha256') IS DISTINCT FROM 'string'
  OR p->>'schema' IS DISTINCT FROM 'atlas-marketplace-production-process-status-v1' OR p->>'phase' IS DISTINCT FROM 'WAIT_INSTALL'
  OR p->'sourceRevision' IS DISTINCT FROM d->'sourceRevision' OR p->>'operatingMode' IS DISTINCT FROM 'NON_PAYMENT'
  OR p->'closed' IS DISTINCT FROM 'false'::jsonb OR p->'checkoutEnabled' IS DISTINCT FROM 'false'::jsonb
  OR p->'customerPublicationAuthority' IS DISTINCT FROM 'false'::jsonb OR p->'productionReady' IS DISTINCT FROM 'false'::jsonb OR p->'saleAuthorityAvailable' IS DISTINCT FROM 'false'::jsonb
  OR i->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-intake-v1' OR i->>'environment' IS DISTINCT FROM 'PRODUCTION'
  OR i->>'policyHash' IS DISTINCT FROM '41eb04ac953246e74e9c8ec1232dbbd0562036c60173089cf0f54432013c790f'
  OR i->>'storageHash' IS DISTINCT FROM '36ba4db303b6143148666c91cdebbaf3631748fd15c19dd931b7a254b27b34d8'
  OR p->'storageHash' IS DISTINCT FROM i->'storageHash' OR b->'policyHash' IS DISTINCT FROM i->'policyHash'
  OR b->>'intakeBindingHash' IS DISTINCT FROM atlas_proof_authority.hash_v1(i)
  OR atlas_proof_authority.hash_v1(policy) IS DISTINCT FROM i->>'policyHash'
  OR policy->>'environment' IS DISTINCT FROM 'PRODUCTION' OR policy->'retentionMs' IS DISTINCT FROM '15552000000'::jsonb
  OR staff->>'mode' IS DISTINCT FROM 'PRODUCTION' OR customer->>'mode' IS DISTINCT FROM 'PRODUCTION'
  OR staff->>'origin' IS DISTINCT FROM 'https://atlasgrading.com' OR customer->>'origin' IS DISTINCT FROM 'https://atlasgrading.com'
  OR staff->>'releaseSha' IS DISTINCT FROM 'cf4a5b64dc2d08be175602ff7659af1e68540803'
  OR customer->>'releaseSha' IS DISTINCT FROM 'a537f922c567795b2a568048c78f595ff8853731'
 THEN RAISE EXCEPTION 'EXACT_NONPAYMENT_SESSION_BINDING_REQUIRED'; END IF;
 FOREACH k IN ARRAY ARRAY['installationId','qualificationSessionId'] LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR b->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'EXACT_SESSION_ID_REQUIRED'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['ledgerId','publisherSessionId','bootId'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR p->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'EXACT_SESSION_ID_REQUIRED'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash'] LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR b->>k !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'EXACT_SESSION_HASH_REQUIRED'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['staffControlRevision','customerControlRevision','reviewerAccessVersion','processObservedAtMs'] LOOP
  IF jsonb_typeof(d->k) IS DISTINCT FROM 'number' OR (d->>k)::numeric<1 OR (d->>k)::numeric>9007199254740991 OR trunc((d->>k)::numeric)<>(d->>k)::numeric THEN RAISE EXCEPTION 'EXACT_SESSION_INPUT_REQUIRED'; END IF;
 END LOOP;
 IF jsonb_typeof(d->'reviewerIdentityId') IS DISTINCT FROM 'string' OR d->>'reviewerIdentityId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR d->'reviewerAccessVersion' IS DISTINCT FROM '2'::jsonb THEN RAISE EXCEPTION 'EXACT_REVIEWER_REQUIRED'; END IF;
 -- Same lock order as the serving canonical claim/access functions.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-proof-authority-v1',0));
 LOCK TABLE atlas_proof_authority.control,atlas_proof_authority.installation,atlas_proof_authority.reviewer_grant,
  atlas_proof_authority.fence,atlas_proof_authority.stage,atlas_proof_authority.mutation,atlas_proof_authority.write_permit IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO STRICT ctl FROM atlas_proof_authority.control WHERE id='active' FOR UPDATE;
 IF to_jsonb(ctl) IS DISTINCT FROM '{"id":"active","enabled":false,"integration":"CANONICAL_JOIN_REQUIRED","revision":1,"max_open_stages":1,"max_stages":4096,"max_fences":16384,"max_mutations":4096,"active_installation_id":null}'::jsonb
 THEN RAISE EXCEPTION 'INITIAL_C0_CONTROL_REQUIRED'; END IF;
 FOREACH tname IN ARRAY ARRAY['installation','reviewer_grant','fence','stage','mutation','write_permit'] LOOP
  EXECUTE format('SELECT count(*) FROM atlas_proof_authority.%I',tname) INTO count_rows;
  IF count_rows<>0 THEN RAISE EXCEPTION 'INITIAL_EMPTY_C0_REQUIRED'; END IF;
 END LOOP;
 SELECT * INTO STRICT staff_control FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
 SELECT * INTO STRICT customer_control FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 SELECT * INTO STRICT reviewer FROM atlas_staff."StaffIdentity" WHERE id=(d->>'reviewerIdentityId')::uuid FOR SHARE;
 PERFORM 1 FROM atlas_customer."CustomerServiceControl" WHERE id='active' AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CURRENT_CUSTOMER_SERVICE_REQUIRED'; END IF;
 t:=clock_timestamp(); observed_ms:=(d->>'processObservedAtMs')::bigint;
 -- The installation must end at the earlier of policy expiry and the actual
 -- locked reviewer's UTC certification. Policy lifetime never extends a grant.
 expires_ms:=least((policy->>'expiresAt')::bigint,floor(extract(epoch FROM reviewer."certificationUntil" AT TIME ZONE 'UTC')*1000)::bigint);
 IF observed_ms<floor(extract(epoch FROM t)*1000)::bigint-30000 OR observed_ms>floor(extract(epoch FROM t)*1000)::bigint+2000
  OR (policy->>'effectiveAt')::bigint>floor(extract(epoch FROM t)*1000)::bigint OR expires_ms<=floor(extract(epoch FROM t)*1000)::bigint
  OR staff_control.enabled IS DISTINCT FROM true OR customer_control.enabled IS DISTINCT FROM true
  OR staff_control.revision<>(d->>'staffControlRevision')::bigint OR customer_control.revision<>(d->>'customerControlRevision')::bigint
  OR jsonb_build_object('mode',staff_control.mode,'origin',staff_control.origin,'deploymentId',staff_control."deploymentId",'releaseSha',staff_control."releaseSha",'configHash',staff_control."configHash") IS DISTINCT FROM staff
  OR jsonb_build_object('mode',customer_control.mode,'origin',customer_control.origin,'deploymentId',customer_control."deploymentId",'releaseSha',customer_control."releaseSha",'configHash',customer_control."configHash") IS DISTINCT FROM customer
  OR reviewer.role IS DISTINCT FROM 'REVIEWER' OR reviewer."revokedAt" IS NOT NULL OR reviewer."accessVersion"<>(d->>'reviewerAccessVersion')::integer
  OR reviewer."certificationUntil" IS NULL OR reviewer."certificationUntil"<=(t AT TIME ZONE 'UTC')
  OR expires_ms>floor(extract(epoch FROM reviewer."certificationUntil" AT TIME ZONE 'UTC')*1000)::bigint
 THEN RAISE EXCEPTION 'CURRENT_CANONICAL_SESSION_INSTALLATION_REFUSED'; END IF;
 INSERT INTO atlas_proof_authority.installation(installation_id,publisher_session_id,publisher_ledger_id,session_binding,intake_binding,staff_binding,customer_binding,installed_at,expires_at)
 VALUES((b->>'installationId')::uuid,(p->>'publisherSessionId')::uuid,(p->>'ledgerId')::uuid,b,i,staff,customer,t,to_timestamp(expires_ms/1000)+(expires_ms%1000)*interval '1 millisecond');
 INSERT INTO atlas_proof_authority.reviewer_grant(identity_id,installation_id,access_version,policy_hash,revoked_at)
 VALUES(reviewer.id,(b->>'installationId')::uuid,reviewer."accessVersion",b->>'policyHash',NULL);
 -- Normal first-use trigger path: no fence exists, no permit or bypass is used.
 UPDATE atlas_proof_authority.control SET enabled=true,integration='INSTALLED',active_installation_id=(b->>'installationId')::uuid,revision=2 WHERE id='active';
 report:=atlas_proof_authority.observe_access_v1(jsonb_build_object('schema','atlas-proof-installation-observe-v1','installationId',b->'installationId'));
 IF report->>'schema' IS DISTINCT FROM 'atlas-proof-installation-report-v1' OR report->'publisherSessionId' IS DISTINCT FROM p->'publisherSessionId'
  OR report->'publisherLedgerId' IS DISTINCT FROM p->'ledgerId' OR report->'sessionBinding' IS DISTINCT FROM b OR report->'intakeBinding' IS DISTINCT FROM i
  OR report->'staffBinding' IS DISTINCT FROM staff OR report->'customerBinding' IS DISTINCT FROM customer OR report->'expiresAt' IS DISTINCT FROM to_jsonb(expires_ms)
  OR report->'controlRevision' IS DISTINCT FROM '2'::jsonb OR jsonb_array_length(report->'reviewerGrants')<>1
  OR report->'reviewerGrants'->0 IS DISTINCT FROM jsonb_build_object('identityId',reviewer.id,'accessVersion',reviewer."accessVersion",'policyHash',b->>'policyHash','revokedAt',NULL)
  OR EXISTS(SELECT 1 FROM atlas_proof_authority.write_permit)
 THEN RAISE EXCEPTION 'EXACT_C0_SESSION_POSTCONDITION'; END IF;
END $install$;
REVOKE atlas_proof_authority_owner FROM doadmin GRANTED BY doadmin RESTRICT;
DO $membership$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_catalog.pg_auth_members m
 JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE r.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
    OR u.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker']);
 IF n<>4 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
 JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE (r.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
     OR u.rolname=ANY(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker']))
 AND (r.rolname<>ALL(ARRAY['atlas_proof_authority_owner','atlas_proof_request','atlas_proof_settler','atlas_proof_revoker'])
  OR u.rolname<>'doadmin' OR g.rolname<>'postgres' OR g.oid<>10 OR NOT g.rolsuper
  OR NOT m.admin_option OR m.inherit_option OR m.set_option))
 OR has_database_privilege('atlas_proof_authority_owner',current_database(),'CREATE,TEMP')
 THEN RAISE EXCEPTION 'EXACT_C0_OPERATOR_MEMBERSHIPS_REQUIRED'; END IF;
END $membership$;
COMMIT;
