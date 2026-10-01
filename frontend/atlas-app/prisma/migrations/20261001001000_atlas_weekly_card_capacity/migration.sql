-- Additive proposal only: NOT applied to any production database.
-- Apply after the existing commerce migration in an owned fixture first.
-- Quotas are owner-configured CARDS, not customers/orders. No example default.
CREATE TABLE atlas_customer."WeeklyCapacityConfig" (
 channel text PRIMARY KEY CHECK (channel IN ('MAIL_IN','DEALER_DROP_OFF')),
 "quotaCards" integer CHECK ("quotaCards">=0),
 "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO atlas_customer."WeeklyCapacityConfig"(channel) VALUES ('MAIL_IN'),('DEALER_DROP_OFF');
CREATE TABLE atlas_customer."WeeklyCapacityWeek" (
 channel text NOT NULL REFERENCES atlas_customer."WeeklyCapacityConfig"(channel),
 "weekStartsAt" timestamptz NOT NULL,
 "resetsAt" timestamptz NOT NULL CHECK ("resetsAt">"weekStartsAt"),
 "quotaCards" integer NOT NULL CHECK ("quotaCards">=0),
 PRIMARY KEY(channel,"weekStartsAt")
);
CREATE TABLE atlas_customer."WeeklyCapacityReservation" (
 "paymentId" uuid PRIMARY KEY REFERENCES atlas_customer."CommercePayment"(id),
 channel text NOT NULL,
 "weekStartsAt" timestamptz NOT NULL,
 "cardCount" integer NOT NULL CHECK ("cardCount">0),
 state text NOT NULL DEFAULT 'HELD' CHECK (state IN ('HELD','CONSUMED','RELEASED')),
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(channel,"weekStartsAt") REFERENCES atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt")
);
CREATE INDEX "WeeklyCapacityReservation_active" ON atlas_customer."WeeklyCapacityReservation"(channel,"weekStartsAt") WHERE state<>'RELEASED';
CREATE TRIGGER "WeeklyCapacityWeek_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."WeeklyCapacityWeek"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE FUNCTION atlas_customer.weekly_capacity_week(instant timestamptz) RETURNS TABLE("weekStartsAt" timestamptz,"resetsAt" timestamptz)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT start_local AT TIME ZONE 'America/Los_Angeles', (start_local+interval '7 days') AT TIME ZONE 'America/Los_Angeles'
 FROM (SELECT date_trunc('week',(instant AT TIME ZONE 'America/Los_Angeles')-interval '1 minute')+interval '1 minute' start_local) s
$$;
CREATE FUNCTION atlas_customer.weekly_capacity_reservation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."paymentId"<>OLD."paymentId" OR NEW.channel<>OLD.channel OR NEW."weekStartsAt"<>OLD."weekStartsAt"
 OR NEW."cardCount"<>OLD."cardCount" OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD.state IN ('CONSUMED','RELEASED') AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'Weekly capacity evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WeeklyCapacityReservation_guard" BEFORE UPDATE OR DELETE ON atlas_customer."WeeklyCapacityReservation"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_reservation_guard();
CREATE FUNCTION atlas_customer.weekly_capacity_payment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE q atlas_customer."CommerceQuote"; channel_name text; starts timestamptz; ends timestamptz; quota integer; used bigint; count_cards integer; r atlas_customer."WeeklyCapacityReservation";
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId";
  channel_name:=CASE q.snapshot->>'channel' WHEN 'MAIL_IN' THEN 'MAIL_IN' WHEN 'KIOSK' THEN 'DEALER_DROP_OFF' WHEN 'DEALER_DROP_OFF' THEN 'DEALER_DROP_OFF' ELSE NULL END;
  count_cards:=jsonb_array_length(q.snapshot->'cards');
  IF channel_name IS NULL OR count_cards IS NULL OR count_cards<1 THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_INVALID_QUOTE' USING ERRCODE='PWC03'; END IF;
  SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(statement_timestamp()) w;
  -- The config lock establishes a global lock order before the week lock.
  SELECT c."quotaCards" INTO quota FROM atlas_customer."WeeklyCapacityConfig" c WHERE c.channel=channel_name FOR SHARE;
  IF quota IS NOT NULL THEN
   INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards") VALUES(channel_name,starts,ends,quota) ON CONFLICT DO NOTHING;
  END IF;
  SELECT w."quotaCards" INTO quota FROM atlas_customer."WeeklyCapacityWeek" w WHERE w.channel=channel_name AND w."weekStartsAt"=starts FOR UPDATE;
  IF quota IS NULL THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_NOT_CONFIGURED' USING ERRCODE='PWC01'; END IF;
  SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
   WHERE channel=channel_name AND "weekStartsAt"=starts AND state<>'RELEASED';
  IF used+count_cards>quota THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_FULL' USING ERRCODE='PWC02'; END IF;
  INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount") VALUES(NEW.id,channel_name,starts,count_cards);
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('PAID','CANCELED') THEN
  SELECT * INTO r FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=NEW.id;
  -- Historical attempts created before this additive feature remain readable.
  IF r."paymentId" IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM atlas_customer."WeeklyCapacityWeek" WHERE channel=r.channel AND "weekStartsAt"=r."weekStartsAt" FOR UPDATE;
  UPDATE atlas_customer."WeeklyCapacityReservation" SET state=CASE WHEN NEW.state='PAID' THEN 'CONSUMED' ELSE 'RELEASED' END,"updatedAt"=clock_timestamp() WHERE "paymentId"=NEW.id AND state='HELD';
 END IF;
 RETURN NEW;
END $$;
-- All provider dispatch paths/callbacks already use these exact payment rows.
-- The trigger and existing payment/order writes share the SAME transaction.
CREATE TRIGGER "CommercePayment_weekly_capacity" AFTER INSERT OR UPDATE OF state ON atlas_customer."CommercePayment"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_payment();
CREATE FUNCTION atlas_customer.weekly_capacity_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_customer AS $$
DECLARE instant timestamptz:=statement_timestamp(); starts timestamptz; ends timestamptz; pools jsonb;
BEGIN
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(instant) w;
 SELECT jsonb_agg(jsonb_build_object('channel',c.channel,'state',CASE WHEN COALESCE(w."quotaCards",c."quotaCards") IS NULL THEN 'NOT_CONFIGURED'
  WHEN COALESCE(w."quotaCards",c."quotaCards")-COALESCE(a.held,0)-COALESCE(a.accepted,0)>0 THEN 'AVAILABLE' ELSE 'FULL' END,
  'quotaCards',COALESCE(w."quotaCards",c."quotaCards"),'heldCards',CASE WHEN COALESCE(w."quotaCards",c."quotaCards") IS NULL THEN NULL ELSE COALESCE(a.held,0) END,
  'acceptedCards',CASE WHEN COALESCE(w."quotaCards",c."quotaCards") IS NULL THEN NULL ELSE COALESCE(a.accepted,0) END,
  'remainingCards',CASE WHEN COALESCE(w."quotaCards",c."quotaCards") IS NULL THEN NULL ELSE COALESCE(w."quotaCards",c."quotaCards")-COALESCE(a.held,0)-COALESCE(a.accepted,0) END)
  ORDER BY CASE c.channel WHEN 'MAIL_IN' THEN 0 ELSE 1 END) INTO pools
 FROM atlas_customer."WeeklyCapacityConfig" c LEFT JOIN atlas_customer."WeeklyCapacityWeek" w ON w.channel=c.channel AND w."weekStartsAt"=starts
 LEFT JOIN LATERAL (SELECT sum("cardCount") FILTER(WHERE state='HELD') held,sum("cardCount") FILTER(WHERE state='CONSUMED') accepted
  FROM atlas_customer."WeeklyCapacityReservation" WHERE channel=c.channel AND "weekStartsAt"=starts) a ON true;
 RETURN jsonb_build_object('version','atlas-weekly-capacity-v1','unit','CARDS','timeZone','America/Los_Angeles','resetLocalTime','00:01',
  'asOf',to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'weekStartsAt',to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'resetsAt',to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'pools',pools);
END $$;
REVOKE ALL ON atlas_customer."WeeklyCapacityConfig",atlas_customer."WeeklyCapacityWeek",atlas_customer."WeeklyCapacityReservation" FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.weekly_capacity_week(timestamptz),atlas_customer.weekly_capacity_reservation_guard(),atlas_customer.weekly_capacity_payment(),atlas_customer.weekly_capacity_snapshot() FROM PUBLIC;
-- No customer table grants, no generic public SQL capability. The release must
-- expose ONLY weekly_capacity_snapshot() through a bounded service read route.

-- Replace the existing narrow gateway without broadening any mutation action.
-- Its exception block rolls back the payment insert and capacity trigger on
-- capacity refusal, then returns an actionable DTO before provider dispatch.
CREATE OR REPLACE FUNCTION atlas_customer.customer_private_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl"; auth jsonb; name text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 name:=d->>'name';
 IF action='intake' AND name IN ('response','fail') THEN RETURN atlas_customer.intake_worker_call(name,d->'input'); END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
  OR jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF action='capacity' THEN
  IF d IS DISTINCT FROM '{"input":{}}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.weekly_capacity_snapshot();
 ELSIF action='directory' THEN RETURN atlas_customer.customer_call('dealer_locations',b,d->'input');
 ELSIF action='customer' THEN
  IF COALESCE(name,'') NOT IN ('intake_upload','commerce_checkout') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  auth:=d->'authority'; IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
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
EXCEPTION
 WHEN SQLSTATE 'PWC01' THEN RETURN atlas_customer.problem(503,'WEEKLY_CAPACITY_NOT_CONFIGURED');
 WHEN SQLSTATE 'PWC02' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_FULL');
 WHEN SQLSTATE 'PWC03' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_INVALID_QUOTE');
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) FROM PUBLIC;
