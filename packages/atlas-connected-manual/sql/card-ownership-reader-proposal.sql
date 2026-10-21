-- LOCAL FUTURE PROPOSAL. Apply after the unchanged ownership proposal only in
-- an owned fixture. Unregistered: no runtime, route or serving grant installs it.
-- A distinct reader role receives only this function, never customer_call,
-- staff_call, private helpers, tables or sequences. Authentication takes share
-- locks through current_account; "read" means no business-row writes, not a
-- PostgreSQL READ ONLY transaction (which forbids those authentication locks).
CREATE FUNCTION atlas_ownership.customer_read(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount";
 result jsonb; cid uuid;
BEGIN
 IF act IS NULL OR act NOT IN ('read_collection','read_card','read_preferences') THEN
  RETURN atlas_customer.problem(403,'OWNERSHIP_READ_ONLY');
 END IF;
 IF NOT atlas_ownership.input_valid(act,d) THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_REQUEST'); END IF;
 IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR NOT binding ?& ARRAY['mode','origin','deploymentId','releaseSha','configHash']
  OR binding-ARRAY['mode','origin','deploymentId','releaseSha','configHash']<>'{}'::jsonb THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED');
 END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED');
 END IF;
 -- Cookie digests are proofs to validate, never an account capability. Reuse
 -- live account/browser/session/access-version/control/expiry validation.
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='read_preferences' THEN
  SELECT jsonb_build_object('accountId',a.id,'preferences',atlas_ownership.preferences(a.id)) INTO result;
 ELSIF act='read_collection' THEN
  -- One statement snapshot supplies both outer and per-card preferences.
  -- card_projection resolves the latest title across ALL owners, checks this
  -- account, and binds the latest published approval in the active mode.
  WITH candidates AS MATERIALIZED (
   SELECT e.card_id cid,atlas_ownership.card_projection(e.card_id,a.id,ctl.mode) value
   FROM (SELECT DISTINCT card_id FROM atlas_ownership.event WHERE owner_account_id=a.id) e
   WHERE (d->>'afterCardId' IS NULL OR e.card_id>(d->>'afterCardId')::uuid)
    AND atlas_ownership.card_projection(e.card_id,a.id,ctl.mode) IS NOT NULL
   ORDER BY e.card_id LIMIT (d->>'limit')::integer+1
  ), page AS (
   SELECT c.cid,c.value FROM candidates c ORDER BY c.cid LIMIT (d->>'limit')::integer
  ) SELECT jsonb_build_object('accountId',a.id,
   'cards',COALESCE((SELECT jsonb_agg(p.value ORDER BY p.cid) FROM page p),'[]'::jsonb),
   'nextCardId',CASE WHEN (SELECT count(*) FROM candidates)>(d->>'limit')::integer
    THEN (SELECT p.cid FROM page p ORDER BY p.cid DESC LIMIT 1) ELSE NULL END,
   'preferences',atlas_ownership.preferences(a.id)) INTO result;
 ELSE
  cid:=(d->>'cardId')::uuid;
  SELECT jsonb_build_object('accountId',a.id,'card',atlas_ownership.card_projection(cid,a.id,ctl.mode)) INTO result;
 END IF;
 -- The first authentication can wait for locks. Refresh time-sensitive checks
 -- after all projection work; an expired session cannot return private data.
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='read_card' AND (result->'card' IS NULL OR result->'card'='null'::jsonb) THEN
  RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND');
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION atlas_ownership.customer_read(text,text,jsonb,text,jsonb) FROM PUBLIC;
