-- Durable owner-configured shared weekly policy. No allowance is seeded here.
-- Concrete weeks, paid orders and unresolved holds retain their original facts.
BEGIN;
CREATE TABLE atlas_customer."WeeklyCapacitySharedPolicy" (
 "effectiveWeekStartsAt" timestamptz PRIMARY KEY,
 "quotaCards" integer CHECK ("quotaCards">=0),
 "authorizationReference" text NOT NULL CHECK (length(btrim("authorizationReference")) BETWEEN 1 AND 240 AND "authorizationReference" !~ '[[:cntrl:]]'),
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION atlas_customer.weekly_capacity_shared_policy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE starts timestamptz; current_starts timestamptz; used bigint;
BEGIN
 SELECT w."weekStartsAt" INTO starts FROM atlas_customer.weekly_capacity_week(NEW."effectiveWeekStartsAt") w;
 SELECT w."weekStartsAt" INTO current_starts FROM atlas_customer.weekly_capacity_week(statement_timestamp()) w;
 IF starts IS DISTINCT FROM NEW."effectiveWeekStartsAt" OR starts<current_starts THEN
  RAISE EXCEPTION 'INVALID_RECURRING_CAPACITY_START';
 END IF;
 IF NEW."quotaCards" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=starts) THEN
  SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
   WHERE "weekStartsAt"=starts AND state<>'RELEASED';
  IF used>NEW."quotaCards" THEN RAISE EXCEPTION 'SHARED_CAPACITY_BELOW_EXISTING_RESERVATIONS'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WeeklyCapacitySharedPolicy_valid" BEFORE INSERT ON atlas_customer."WeeklyCapacitySharedPolicy"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_shared_policy_guard();
CREATE TRIGGER "WeeklyCapacitySharedPolicy_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."WeeklyCapacitySharedPolicy"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "WeeklyCapacitySharedPolicy_no_truncate" BEFORE TRUNCATE ON atlas_customer."WeeklyCapacitySharedPolicy"
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE FUNCTION atlas_customer.weekly_capacity_shared_quota(starts timestamptz) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,atlas_customer AS $$
DECLARE quota integer;
BEGIN
 -- An explicit or already materialized week always wins, including a zero quota.
 SELECT "quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=starts;
 IF FOUND THEN RETURN quota; END IF;
 -- The newest effective policy continues indefinitely. A NULL successor means
 -- unconfigured; it must not fall through to an older non-NULL policy.
 SELECT "quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedPolicy"
 WHERE "effectiveWeekStartsAt"<=starts ORDER BY "effectiveWeekStartsAt" DESC LIMIT 1;
 RETURN quota;
END $$;
CREATE FUNCTION atlas_customer.weekly_capacity_materialize_shared_week(instant timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE starts timestamptz; ends timestamptz; quota integer;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'WEEKLY_CAPACITY_UNSUPPORTED_ISOLATION' USING ERRCODE='25000';
 END IF;
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(instant) w;
 quota:=atlas_customer.weekly_capacity_shared_quota(starts);
 IF quota IS NOT NULL THEN
  INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards")
   VALUES(starts,ends,quota) ON CONFLICT DO NOTHING;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE q atlas_customer."CommerceQuote"; channel_name text; starts timestamptz; ends timestamptz; quota integer; used bigint; count_cards integer; r atlas_customer."WeeklyCapacityReservation";
BEGIN
 IF TG_OP='INSERT' THEN
  -- A row lock serializes writers, but an older REPEATABLE READ snapshot could
  -- still miss a committed reservation. Admission requires fresh statements.
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'WEEKLY_CAPACITY_UNSUPPORTED_ISOLATION' USING ERRCODE='25000';
  END IF;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId";
  channel_name:=CASE q.snapshot->>'channel' WHEN 'MAIL_IN' THEN 'MAIL_IN' WHEN 'KIOSK' THEN 'DEALER_DROP_OFF' WHEN 'DEALER_DROP_OFF' THEN 'DEALER_DROP_OFF' ELSE NULL END;
  count_cards:=jsonb_array_length(q.snapshot->'cards');
  IF channel_name IS NULL OR count_cards IS NULL OR count_cards<1 THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_INVALID_QUOTE' USING ERRCODE='PWC03'; END IF;
  SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(statement_timestamp()) w;
  -- First admission materializes the authorized recurring allowance, if any.
  -- The concrete week then remains the immutable shared admission authority.
  PERFORM atlas_customer.weekly_capacity_materialize_shared_week(statement_timestamp());
  -- BOTH routes take this same row lock BEFORE inspecting or changing capacity.
  SELECT w."quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedWeek" w WHERE w."weekStartsAt"=starts FOR UPDATE;
  IF quota IS NULL THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_NOT_CONFIGURED' USING ERRCODE='PWC01'; END IF;
  SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
   WHERE "weekStartsAt"=starts AND state<>'RELEASED';
  IF used+count_cards>quota THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_FULL' USING ERRCODE='PWC02'; END IF;
  -- Retain the original per-route foreign key/history, without using it as a second allowance.
  INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards")
   VALUES(channel_name,starts,ends,quota) ON CONFLICT DO NOTHING;
  INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount")
   VALUES(NEW.id,channel_name,starts,count_cards);
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('PAID','CANCELED') THEN
  SELECT * INTO r FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=NEW.id;
  IF r."paymentId" IS NULL THEN RETURN NEW; END IF;
  -- Historical rows without a shared week remain resolvable. Always keep lock order.
  PERFORM 1 FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=r."weekStartsAt" FOR UPDATE;
  PERFORM 1 FROM atlas_customer."WeeklyCapacityWeek" WHERE channel=r.channel AND "weekStartsAt"=r."weekStartsAt" FOR UPDATE;
  UPDATE atlas_customer."WeeklyCapacityReservation" SET state=CASE WHEN NEW.state='PAID' THEN 'CONSUMED' ELSE 'RELEASED' END,"updatedAt"=clock_timestamp()
   WHERE "paymentId"=NEW.id AND state='HELD';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE instant timestamptz:=statement_timestamp(); starts timestamptz; ends timestamptz; quota integer; held bigint; accepted bigint; pools jsonb;
BEGIN
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(instant) w;
 -- Anonymous/public reads remain read-only, including before first admission.
 quota:=atlas_customer.weekly_capacity_shared_quota(starts);
 -- One SQL statement supplies both total and route breakdown at the same snapshot.
 SELECT COALESCE(sum(a.held),0),COALESCE(sum(a.accepted),0),jsonb_agg(jsonb_build_object('channel',c.channel,
  'heldCards',CASE WHEN quota IS NULL THEN NULL ELSE COALESCE(a.held,0) END,
  'acceptedCards',CASE WHEN quota IS NULL THEN NULL ELSE COALESCE(a.accepted,0) END) ORDER BY c.channel) INTO held,accepted,pools
 FROM (VALUES('MAIL_IN'),('DEALER_DROP_OFF')) c(channel)
 LEFT JOIN LATERAL (SELECT sum("cardCount") FILTER(WHERE state='HELD') held,sum("cardCount") FILTER(WHERE state='CONSUMED') accepted
  FROM atlas_customer."WeeklyCapacityReservation" r WHERE r.channel=c.channel AND r."weekStartsAt"=starts) a ON true;
 RETURN jsonb_build_object('version','atlas-weekly-capacity-v2','scope','SHARED','unit','CARDS','timeZone','America/Los_Angeles','resetLocalTime','00:01',
  'asOf',to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'weekStartsAt',to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'resetsAt',to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'total',jsonb_build_object('state',CASE WHEN quota IS NULL THEN 'NOT_CONFIGURED' WHEN quota-held-accepted>0 THEN 'AVAILABLE' ELSE 'FULL' END,
   'quotaCards',quota,'heldCards',CASE WHEN quota IS NULL THEN NULL ELSE held END,
   'acceptedCards',CASE WHEN quota IS NULL THEN NULL ELSE accepted END,
   'remainingCards',CASE WHEN quota IS NULL THEN NULL ELSE quota-held-accepted END),'pools',pools);
END $$;

REVOKE ALL ON atlas_customer."WeeklyCapacitySharedPolicy" FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.weekly_capacity_shared_policy_guard(),
 atlas_customer.weekly_capacity_shared_quota(timestamptz),
 atlas_customer.weekly_capacity_materialize_shared_week(timestamptz) FROM PUBLIC;
-- Existing snapshot/payment grants survive replacement. No serving role receives
-- policy mutation or direct table/helper access. Activation is a separate action.
COMMIT;
