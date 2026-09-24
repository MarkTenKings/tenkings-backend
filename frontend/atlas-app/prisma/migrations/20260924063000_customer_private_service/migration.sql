BEGIN;
-- Installation is cold. Only an exact customer deployment binding can enable
-- the separate service, and paid identification has its own explicit switch.
CREATE TABLE atlas_customer."CustomerServiceControl" (
 id text PRIMARY KEY DEFAULT 'active' CHECK (id='active'), enabled boolean NOT NULL DEFAULT false,
 binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object'),
 "identificationEnabled" boolean NOT NULL DEFAULT false,
 "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON atlas_customer."CustomerServiceControl" FROM PUBLIC;

CREATE FUNCTION atlas_customer.customer_private_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl"; auth jsonb; name text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 name:=d->>'name';
 -- A revoked admission may still retain an already received bounded provider
 -- receipt against its original live lease. This cannot start another effect.
 IF action='intake' AND name IN ('response','fail') THEN
  RETURN atlas_customer.intake_worker_call(name,d->'input');
 END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
  OR jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF action='directory' THEN
  RETURN atlas_customer.customer_call('dealer_locations',b,d->'input');
 ELSIF action='customer' THEN
  IF COALESCE(name,'') NOT IN ('intake_upload','commerce_checkout') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  auth:=d->'authority';
  IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.customer_call(name,b,(d->'input')||jsonb_build_object('sessionHash',auth->>'sessionHash','browserHash',auth->>'browserHash'));
 ELSIF action='intake' THEN
  IF COALESCE(name,'') NOT IN ('verify','claim','prepared','dispatch','finish') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name<>'verify' AND NOT svc."identificationEnabled" THEN RETURN atlas_customer.problem(503,'IDENTIFICATION_NOT_CONFIGURED'); END IF;
  IF name='verify' AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.intake_worker_call(name,d->'input');
 ELSIF action='commerce' THEN
  IF COALESCE(name,'') NOT IN ('commerce_checkout','commerce_save_quote','commerce_reserve_payment','commerce_record_payment','commerce_payment','commerce_confirm_paid',
   'commerce_order','commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name NOT IN ('commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm')
   AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.commerce_provider_call(name,d->'providerBinding',d->'input');
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
