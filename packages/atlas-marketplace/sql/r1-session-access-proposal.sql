-- INERT R1 REVIEW PROPOSAL ONLY. Not part of any migration manifest or runtime.
-- No application should execute this file. R1 must review the exact deployed
-- customer_call chain, schema owner, grants and release binding before adopting
-- it as a separately approved migration. The guard intentionally prevents use.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_SESSION_ACCESS_PROPOSAL_NOT_APPROVED'; END $$;

-- Proposed addition: retain the single CustomerDatabase gateway and its exact
-- EXECUTE-only role. No table grants, new login role, session issuance/extension,
-- bootstrap, profile write, marketplace permission or title evidence is added.
DO $$
DECLARE gateway regprocedure := 'atlas_customer.customer_call(text,jsonb,jsonb)'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=gateway AND prosecdef AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=gateway AND a.grantee=0 AND a.privilege_type='EXECUTE')
     OR to_regprocedure('atlas_customer.customer_call_before_marketplace_session_access(text,jsonb,jsonb)') IS NOT NULL
  THEN RAISE EXCEPTION 'R1_SESSION_GATEWAY_REVIEW_REQUIRED'; END IF;
END $$;

ALTER FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) RENAME TO customer_call_before_marketplace_session_access;
CREATE FUNCTION atlas_customer.customer_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount";
  s atlas_customer."CustomerSession"; browser atlas_customer."CustomerBrowser"; observed timestamptz;
BEGIN
  IF action IS DISTINCT FROM 'marketplace_session_access' THEN
    RETURN atlas_customer.customer_call_before_marketplace_session_access(action,b,d);
  END IF;
  SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
  IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(b) IS DISTINCT FROM 'object'
     OR b-ARRAY['mode','origin','deploymentId','releaseSha','configHash']<>'{}'::jsonb
     OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
       (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash")
  THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>512
     OR d-ARRAY['sessionHash','browserHash']<>'{}'::jsonb
     OR jsonb_typeof(d->'sessionHash') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'browserHash') IS DISTINCT FROM 'string'
     OR COALESCE(d->>'sessionHash','') !~ '^[a-f0-9]{64}$' OR COALESCE(d->>'browserHash','') !~ '^[a-f0-9]{64}$'
  THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
  IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  SELECT * INTO s FROM atlas_customer."CustomerSession" WHERE "tokenHash"=d->>'sessionHash' FOR SHARE;
  SELECT * INTO browser FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' FOR SHARE;
  observed:=clock_timestamp(); -- Evaluate expiry after all authority row locks.
  IF s."accountId" IS DISTINCT FROM a.id OR s."browserHash" IS DISTINCT FROM browser."tokenHash"
     OR s."revokedAt" IS NOT NULL OR a."revokedAt" IS NOT NULL OR s."accessVersion" IS DISTINCT FROM a."accessVersion"
     OR s."controlRevision" IS DISTINCT FROM ctl.revision OR browser."controlRevision" IS DISTINCT FROM ctl.revision
     OR s."createdAt">observed OR browser."createdAt">observed
     OR s."expiresAt" IS NULL OR s."expiresAt"<=observed OR browser."expiresAt" IS NULL OR browser."expiresAt"<=observed
  THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN jsonb_build_object('schema','atlas-marketplace-session-access-v1','accountId',a.id,
    'sessionHash',s."tokenHash",'browserHash',browser."tokenHash",
    'expiresAt',floor(extract(epoch FROM least(s."expiresAt",browser."expiresAt"))*1000)::bigint,
    'observedAt',floor(extract(epoch FROM observed)*1000)::bigint);
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) FROM PUBLIC;
DO $$
DECLARE serving_role record;
BEGIN
  FOR serving_role IN
    SELECT DISTINCT r.rolname,a.is_grantable FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='atlas_customer.customer_call_before_marketplace_session_access(text,jsonb,jsonb)'::regprocedure
      AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner
  LOOP
    IF serving_role.is_grantable THEN RAISE EXCEPTION 'R1_GATEWAY_GRANT_OPTION_REVIEW_REQUIRED'; END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) TO %I',serving_role.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.customer_call_before_marketplace_session_access(text,jsonb,jsonb) FROM %I',serving_role.rolname);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call_before_marketplace_session_access(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
