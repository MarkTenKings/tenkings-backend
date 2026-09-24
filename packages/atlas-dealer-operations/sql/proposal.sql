-- Additive proposal after customer intake and commerce. No roster or schedule
-- is seeded. Root publishes reviewed migration/grants; never run from the UI.
CREATE SCHEMA atlas_dealer;
REVOKE ALL ON SCHEMA atlas_dealer FROM PUBLIC;
CREATE TABLE atlas_dealer.location (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), enabled boolean NOT NULL DEFAULT false,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 address jsonb NOT NULL CHECK(jsonb_typeof(address)='object'),
 latitude numeric NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude numeric NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 schedule jsonb NOT NULL CHECK(jsonb_typeof(schedule)='object'),
 terminal_id text NOT NULL, terminal_location_id text NOT NULL, package_printer_id text NOT NULL,
 entry_token text NOT NULL UNIQUE CHECK(entry_token ~ '^[A-Za-z0-9_-]{32,96}$'),
 authorized_until timestamptz NOT NULL, configured_by uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_dealer.location_revision (
 location_id uuid NOT NULL REFERENCES atlas_dealer.location(id), revision integer NOT NULL,
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(location_id,revision)
);
CREATE TABLE atlas_dealer.membership (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 location_id uuid NOT NULL REFERENCES atlas_dealer.location(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 revoked_at timestamptz, granted_by uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id), UNIQUE(account_id,location_id)
);
CREATE TABLE atlas_dealer.session (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'),
 membership_id uuid NOT NULL REFERENCES atlas_dealer.membership(id), membership_version integer NOT NULL,
 account_version integer NOT NULL, control_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '8 hours')
);
CREATE TABLE atlas_dealer.order_card (
 card_id uuid PRIMARY KEY REFERENCES atlas_customer."CustomerIntakeCard"(id), order_id uuid NOT NULL REFERENCES atlas_customer."CommerceOrder"(id),
 location_id uuid REFERENCES atlas_dealer.location(id), dealer_id uuid,
 channel text NOT NULL CHECK(channel IN ('MAIL_IN','KIOSK')), paid_line jsonb NOT NULL,
 location_snapshot jsonb, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((channel='KIOSK')=(location_id IS NOT NULL)), CHECK((location_id IS NULL)=(dealer_id IS NULL))
);
CREATE INDEX order_card_order ON atlas_dealer.order_card(order_id);
CREATE INDEX order_card_location ON atlas_dealer.order_card(location_id);
CREATE TABLE atlas_dealer.custody_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL REFERENCES atlas_dealer.order_card(card_id),
 sequence integer NOT NULL CHECK(sequence>0), request_id uuid NOT NULL, input_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('DEPOSIT_DECLARED','COLLECTED','ATLAS_RECEIVED','RETURN_DISPATCHED','RETURNED_TO_KIOSK','CUSTOMER_COLLECTED','MAIL_DISPATCHED','CUSTOMER_DELIVERED','DELAY_REPORTED','DELAY_RESOLVED')),
 actor_id uuid REFERENCES atlas_staff."StaffIdentity"(id), customer_id uuid REFERENCES atlas_customer."CustomerAccount"(id),
 occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 CHECK((kind='DEPOSIT_DECLARED')=(customer_id IS NOT NULL)), CHECK((actor_id IS NULL)=(customer_id IS NOT NULL)),
 UNIQUE(card_id,sequence), UNIQUE(card_id,request_id)
);
CREATE TABLE atlas_dealer.manual_card_link (
 card_id uuid PRIMARY KEY REFERENCES atlas_dealer.order_card(card_id), manual_card_id uuid NOT NULL UNIQUE REFERENCES atlas_manual.card(id),
 received_event_id uuid NOT NULL REFERENCES atlas_dealer.custody_event(id), actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300), linked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_dealer.commission_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL REFERENCES atlas_dealer.order_card(card_id),
 kind text NOT NULL CHECK(kind IN ('ACCRUED','REVERSED')), amount_cents integer NOT NULL,
 source_ref text NOT NULL, source jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='ACCRUED' AND amount_cents=500) OR (kind='REVERSED' AND amount_cents BETWEEN -500 AND -1)), UNIQUE(card_id,source_ref)
);
CREATE UNIQUE INDEX commission_once ON atlas_dealer.commission_event(card_id) WHERE kind='ACCRUED';
CREATE FUNCTION atlas_dealer.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN RAISE EXCEPTION 'ATLAS dealer evidence is immutable'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.location_revision FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.order_card FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.custody_event FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.manual_card_link FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.commission_event FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

-- Weekly slot timezone is IANA. An exception overrides exactly its kind/date;
-- canceled:true closes it; otherwise time/cutoff replace the weekly slot.
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.location_revision FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.order_card FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.custody_event FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.manual_card_link FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.commission_event FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE FUNCTION atlas_dealer.valid_schedule(s jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p jsonb; k text;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT s ?& ARRAY['timeZone','pickups','returns','exceptions']
 OR s-ARRAY['timeZone','pickups','returns','exceptions']<>'{}'::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=s->>'timeZone') THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['pickups','returns','exceptions'] LOOP
  IF jsonb_typeof(s->k) IS DISTINCT FROM 'array' OR jsonb_array_length(s->k)>100 THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(s->'pickups')=0 OR jsonb_array_length(s->'returns')=0 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['pickups','returns'] LOOP
  FOR p IN SELECT value FROM jsonb_array_elements(s->k) LOOP
   IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR COALESCE(p->>'weekday','') !~ '^[0-6]$'
    OR COALESCE(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR p-ARRAY['weekday','time','cutoff']<>'{}'::jsonb THEN RETURN false; END IF;
   IF k='pickups' AND (COALESCE(p->>'cutoff','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p->>'cutoff'>p->>'time') THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value->>'weekday') FROM jsonb_array_elements(s->k)) THEN RETURN false; END IF;
 END LOOP;
 FOR p IN SELECT value FROM jsonb_array_elements(s->'exceptions') LOOP
  IF COALESCE(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR (p->>'date')::date::text<>p->>'date'
   OR COALESCE(p->>'kind','') NOT IN ('pickups','returns') OR jsonb_typeof(p->'cancelled') IS DISTINCT FROM 'boolean'
   OR p-ARRAY['date','kind','cancelled','time','cutoff','reason']<>'{}'::jsonb OR length(COALESCE(p->>'reason','')) NOT BETWEEN 1 AND 240 THEN RETURN false; END IF;
  IF NOT (p->>'cancelled')::boolean AND (COALESCE(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR p->>'kind'='pickups' AND (COALESCE(p->>'cutoff','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p->>'cutoff'>p->>'time')) THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT (SELECT count(*)<>count(DISTINCT (value->>'date',value->>'kind')) FROM jsonb_array_elements(s->'exceptions'));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE atlas_dealer.location ADD CONSTRAINT valid_schedule CHECK(atlas_dealer.valid_schedule(schedule));
CREATE FUNCTION atlas_dealer.next_slot(s jsonb, kind text, after_time timestamptz, use_cutoff boolean DEFAULT false) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE day date; p jsonb; local_time timestamp; at_time timestamptz; cutoff timestamptz; i integer;
BEGIN
 IF kind NOT IN ('pickups','returns') OR NOT atlas_dealer.valid_schedule(s) THEN RETURN NULL; END IF;
 FOR i IN 0..63 LOOP
  day:=(after_time AT TIME ZONE (s->>'timeZone'))::date+i;
  SELECT value INTO p FROM jsonb_array_elements(s->'exceptions') WHERE value->>'date'=day::text AND value->>'kind'=kind;
  IF p IS NULL THEN SELECT value INTO p FROM jsonb_array_elements(s->kind) WHERE (value->>'weekday')::integer=extract(dow FROM day); END IF;
  IF p IS NULL OR COALESCE((p->>'cancelled')::boolean,false) THEN CONTINUE; END IF;
  local_time:=day+(p->>'time')::time; at_time:=local_time AT TIME ZONE (s->>'timeZone');
  -- A nonexistent DST wall time is not silently shifted into a fabricated slot.
  IF at_time AT TIME ZONE (s->>'timeZone')<>local_time THEN CONTINUE; END IF;
  cutoff:=(day+COALESCE(p->>'cutoff',p->>'time')::time) AT TIME ZONE (s->>'timeZone');
  IF at_time>=after_time AND (NOT use_cutoff OR cutoff>after_time) THEN RETURN at_time; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION atlas_dealer.projection(s jsonb, at_time timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE next_collection timestamptz; target timestamptz;
BEGIN
 next_collection:=atlas_dealer.next_slot(s,'pickups',at_time,true);
 target:=((next_collection AT TIME ZONE (s->>'timeZone'))+interval '7 days') AT TIME ZONE (s->>'timeZone');
 RETURN jsonb_build_object('nextCollection',next_collection,'projectedReturn',atlas_dealer.next_slot(s,'returns',target,false),'turnaroundTarget',target);
END $$;
CREATE FUNCTION atlas_dealer.next_cutoff(s jsonb, at_time timestamptz) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE next_collection timestamptz; day date; p jsonb;
BEGIN
 next_collection:=atlas_dealer.next_slot(s,'pickups',at_time,true);
 IF next_collection IS NULL THEN RETURN NULL; END IF;
 day:=(next_collection AT TIME ZONE (s->>'timeZone'))::date;
 SELECT value INTO p FROM jsonb_array_elements(s->'exceptions') WHERE value->>'date'=day::text AND value->>'kind'='pickups';
 IF p IS NULL THEN SELECT value INTO p FROM jsonb_array_elements(s->'pickups') WHERE (value->>'weekday')::integer=extract(dow FROM day); END IF;
 RETURN (day+(p->>'cutoff')::time) AT TIME ZONE (s->>'timeZone');
END $$;
CREATE FUNCTION atlas_dealer.location_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Location history is retained'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.dealer_id<>OLD.dealer_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Location revision conflict'; END IF;
 IF NOT NEW.address ?& ARRAY['line1','city','region','postalCode','country'] OR NEW.address-ARRAY['line1','city','region','postalCode','country']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(NEW.address) e WHERE jsonb_typeof(e.value)<>'string' OR length(NEW.address->>e.key) NOT BETWEEN 1 AND 180 OR NEW.address->>e.key ~ '[[:cntrl:]]')
 OR length(NEW.terminal_id) NOT BETWEEN 1 AND 160 OR length(NEW.terminal_location_id) NOT BETWEEN 1 AND 160 OR length(NEW.package_printer_id) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Incomplete kiosk configuration'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER location_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_dealer.location FOR EACH ROW EXECUTE FUNCTION atlas_dealer.location_guard();
CREATE FUNCTION atlas_dealer.save_location_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN INSERT INTO atlas_dealer.location_revision(location_id,revision,snapshot,actor_id) VALUES(NEW.id,NEW.revision,to_jsonb(NEW),NEW.configured_by); RETURN NEW; END $$;
CREATE TRIGGER save_revision AFTER INSERT OR UPDATE ON atlas_dealer.location FOR EACH ROW EXECUTE FUNCTION atlas_dealer.save_location_revision();
CREATE OR REPLACE FUNCTION atlas_customer.intake_location(kid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',id,'dealerId',dealer_id,'revision',revision,'name',name,'address',address,
 'terminalId',terminal_id,'terminalLocationId',terminal_location_id,'packagePrinterId',package_printer_id,
 'schedule',schedule||jsonb_build_object('nextCollectionAt',atlas_dealer.projection(schedule,clock_timestamp())->'nextCollection','projectedReturnAt',atlas_dealer.projection(schedule,clock_timestamp())->'projectedReturn','cutoffAt',atlas_dealer.next_cutoff(schedule,clock_timestamp())), 'timeZone',schedule->>'timeZone','position',jsonb_build_object('lat',latitude,'lng',longitude))
 FROM atlas_dealer.location WHERE id=kid AND enabled AND authorized_until>clock_timestamp() AND atlas_dealer.projection(schedule,clock_timestamp())->>'projectedReturn' IS NOT NULL
$$;
CREATE FUNCTION atlas_dealer.directory(at_time timestamptz, entry text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('locations',COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'revision',revision,
 'position',jsonb_build_object('lat',latitude,'lng',longitude),'timeZone',schedule->>'timeZone','schedule',schedule,
 'priceCents',5000,'shippingCents',0,'turnaroundDays',7,'clockStart','ATLAS_COLLECTION','entryUrl','/account/submit?kiosk='||entry_token,'directionsUrl','https://www.google.com/maps/dir/?api=1&destination='||latitude||','||longitude,'mapEmbedUrl','https://maps.google.com/maps?q='||latitude||','||longitude||'&z=14&output=embed')
 ||atlas_dealer.projection(schedule,at_time) ORDER BY name,id),'[]'::jsonb),
 'resolvedLocationId',max(CASE WHEN entry_token=entry THEN id::text END))
 FROM atlas_dealer.location WHERE enabled AND authorized_until>at_time AND atlas_dealer.projection(schedule,at_time)->>'projectedReturn' IS NOT NULL
$$;
-- Every exact paid card is materialized once, including mail-in for custody.
-- No customer request can choose the commission amount or accrue before paid.
CREATE FUNCTION atlas_dealer.order_paid() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE line jsonb; loc jsonb; ch text; paid atlas_customer."CommercePayment"; q atlas_customer."CommerceQuote";
BEGIN
 SELECT * INTO paid FROM atlas_customer."CommercePayment" WHERE id=NEW."paymentId";
 SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId";
 IF paid.state<>'PAID' OR paid."providerId" IS NULL OR paid."accountId"<>NEW."accountId" THEN RAISE EXCEPTION 'Confirmed payment required'; END IF;
 ch:=q.snapshot->>'channel'; loc:=q.snapshot->'location';
 FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'cards') LOOP
  IF NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerIntakeCard" c JOIN atlas_customer."CustomerIntakeDraft" d ON d.id=c."draftId"
    WHERE c.id=(line->>'cardId')::uuid AND d.id=NEW."draftId" AND d."accountId"=NEW."accountId") THEN RAISE EXCEPTION 'Paid card ownership mismatch'; END IF;
  INSERT INTO atlas_dealer.order_card(card_id,order_id,location_id,dealer_id,channel,paid_line,location_snapshot)
   VALUES((line->>'cardId')::uuid,NEW.id,(loc->>'id')::uuid,(loc->>'dealerId')::uuid,ch,line,loc);
  IF ch='KIOSK' AND (line->>'unitCents')::integer=5000 AND (line->>'commissionCents')::integer=500 THEN
   INSERT INTO atlas_dealer.commission_event(card_id,kind,amount_cents,source_ref,source) VALUES((line->>'cardId')::uuid,'ACCRUED',500,'paid:'||NEW."paymentId",
    jsonb_build_object('paymentId',NEW."paymentId",'orderId',NEW.id,'quoteId',q.id,'quoteHash',q."contentHash",'unitCents',5000,'policy','FULL_PRICE_KIOSK_500_CENTS','location',loc));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER dealer_order_paid AFTER INSERT ON atlas_customer."CommerceOrder" FOR EACH ROW EXECUTE FUNCTION atlas_dealer.order_paid();
-- Same-transaction customer ownership guard. Declaration is explicitly not a
-- claim that staff collected/received the package or that a kiosk scan proves presence.
CREATE FUNCTION atlas_dealer.declare_deposit(account_id uuid,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE oc atlas_dealer.order_card; prior atlas_dealer.custody_event; ih text; seq integer;
BEGIN
 SELECT c.* INTO oc FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 WHERE c.card_id=(d->>'cardId')::uuid AND o.id=(d->>'orderId')::uuid AND o."accountId"=account_id AND c.channel='KIOSK' FOR UPDATE OF c;
 IF oc.card_id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 ih:=atlas_customer.commerce_hash(d-ARRAY['sessionHash','browserHash']);
 SELECT * INTO prior FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND request_id=(d->>'requestId')::uuid;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash<>ih OR prior.customer_id<>account_id THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 IF EXISTS(SELECT 1 FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind IN ('DEPOSIT_DECLARED','COLLECTED','ATLAS_RECEIVED')) THEN RETURN atlas_customer.problem(409,'DEPOSIT_ALREADY_RECORDED'); END IF;
 INSERT INTO atlas_dealer.custody_event(card_id,sequence,request_id,input_hash,kind,customer_id,occurred_at,evidence)
 VALUES(oc.card_id,(SELECT COALESCE(max(sequence),0)+1 FROM atlas_dealer.custody_event WHERE card_id=oc.card_id),(d->>'requestId')::uuid,ih,'DEPOSIT_DECLARED',account_id,clock_timestamp(),jsonb_build_object('meaning','CUSTOMER_DECLARATION_ONLY')) RETURNING * INTO prior;
 RETURN jsonb_build_object('eventId',prior.id);
END $$;
CREATE FUNCTION atlas_dealer.staff_call(action text,session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; oc atlas_dealer.order_card; prior atlas_dealer.custody_event; latest atlas_dealer.custody_event; ev atlas_dealer.custody_event;
 ctl atlas_staff."StaffControl"; staff_session atlas_staff."StaffSession"; grant_count integer; authority_time timestamptz;
 loc atlas_dealer.location; ih text; k text; at_time timestamptz; lid uuid; m atlas_dealer.manual_card_link; saved uuid;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>16384 THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 IF action IN ('location_configure','membership_configure') THEN
  SELECT * INTO ctl FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO staff_session FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash AND "browserHash"=browser_hash FOR SHARE;
  authority_time:=clock_timestamp();
  IF staff_session."createdAt" AT TIME ZONE 'UTC'>authority_time OR (staff_session."createdAt" AT TIME ZONE 'UTC')+interval '5 minutes'<=authority_time THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
  SELECT count(*) INTO grant_count FROM (SELECT g.id FROM atlas_staff."StaffOperationsGrant" g WHERE g."identityId"=actor.id
   AND g."accessVersion"=actor.access_version AND g."controlRevision"=ctl.revision AND g."revokedAt" IS NULL
   AND (g.mode,g.origin,g."deploymentId",g."releaseSha",g."configHash")=(ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash")
   AND g."createdAt" AT TIME ZONE 'UTC'<=authority_time AND g."expiresAt" AT TIME ZONE 'UTC'>authority_time FOR SHARE) grants;
  IF grant_count<>1 THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
 END IF;
 IF action='read' THEN
  RETURN jsonb_build_object('locations',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.name,l.id) FROM (SELECT * FROM atlas_dealer.location ORDER BY name,id LIMIT 1000) l),'[]'::jsonb),
   'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'version',version,'revokedAt',revoked_at) ORDER BY location_id,account_id) FROM atlas_dealer.membership),'[]'::jsonb),
   'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'cards',
    (SELECT jsonb_agg(atlas_dealer.card_tracking(c.card_id)||jsonb_build_object('orderId',c.order_id,'locationId',c.location_id,'manualCardId',l.manual_card_id,'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
     FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id)) ORDER BY o."paidAt" DESC)
    FROM(SELECT id,reference,"paidAt" FROM atlas_customer."CommerceOrder" ORDER BY "paidAt" DESC,id LIMIT 100)o),'[]'::jsonb),
   'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) ORDER BY m.updated_at DESC)
    FROM(SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor.id OR actor.id=ANY(editors))
      AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC LIMIT 100)m),'[]'::jsonb));
 ELSIF action='location_configure' THEN
  lid:=(d->>'id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-location:'||lid,0));
  SELECT * INTO loc FROM atlas_dealer.location WHERE id=lid FOR UPDATE;
  IF loc.id IS NOT NULL AND loc.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'LOCATION_REVISION_CHANGED'); END IF;
  IF NOT atlas_dealer.valid_schedule(d->'schedule') THEN RETURN atlas_customer.problem(400,'INVALID_SCHEDULE'); END IF;
  IF loc.id IS NULL THEN
   INSERT INTO atlas_dealer.location(id,dealer_id,name,address,latitude,longitude,schedule,terminal_id,terminal_location_id,package_printer_id,entry_token,authorized_until,configured_by,enabled)
   VALUES(lid,(d->>'dealerId')::uuid,d->>'name',d->'address',(d->'position'->>'lat')::numeric,(d->'position'->>'lng')::numeric,d->'schedule',d->>'terminalId',d->>'terminalLocationId',d->>'packagePrinterId',d->>'entryToken',(d->>'authorizedUntil')::timestamptz,actor.id,(d->>'enabled')::boolean);
  ELSE
   IF loc.dealer_id<>(d->>'dealerId')::uuid THEN RETURN atlas_customer.problem(409,'DEALER_BINDING_IMMUTABLE'); END IF;
   UPDATE atlas_dealer.location SET revision=revision+1,name=d->>'name',address=d->'address',latitude=(d->'position'->>'lat')::numeric,longitude=(d->'position'->>'lng')::numeric,
    schedule=d->'schedule',terminal_id=d->>'terminalId',terminal_location_id=d->>'terminalLocationId',package_printer_id=d->>'packagePrinterId',entry_token=d->>'entryToken',authorized_until=(d->>'authorizedUntil')::timestamptz,configured_by=actor.id,enabled=(d->>'enabled')::boolean WHERE id=lid;
  END IF;
  RETURN jsonb_build_object('location',atlas_customer.intake_location(lid));
 ELSIF action='membership_configure' THEN
  INSERT INTO atlas_dealer.membership(account_id,location_id,granted_by,revoked_at)
   VALUES((d->>'accountId')::uuid,(d->>'locationId')::uuid,actor.id,CASE WHEN (d->>'enabled')::boolean THEN NULL ELSE clock_timestamp() END)
   ON CONFLICT(account_id,location_id) DO UPDATE SET version=atlas_dealer.membership.version+1,granted_by=actor.id,revoked_at=EXCLUDED.revoked_at RETURNING id INTO saved;
  RETURN jsonb_build_object('membershipId',saved);
 END IF;
 SELECT * INTO oc FROM atlas_dealer.order_card WHERE card_id=(d->>'cardId')::uuid FOR UPDATE;
 IF oc.card_id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='bind_manual' THEN
  SELECT * INTO m FROM atlas_dealer.manual_card_link WHERE card_id=oc.card_id;
  IF m.card_id IS NOT NULL THEN
   IF m.manual_card_id IS DISTINCT FROM (d->>'manualCardId')::uuid THEN RETURN atlas_customer.problem(409,'MANUAL_CARD_ALREADY_BOUND'); END IF;
   RETURN jsonb_build_object('cardId',m.card_id,'manualCardId',m.manual_card_id);
  END IF;
  SELECT * INTO ev FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind='ATLAS_RECEIVED';
  IF ev.id IS NULL OR length(COALESCE(d->>'evidenceRef','')) NOT BETWEEN 1 AND 300
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card WHERE id=(d->>'manualCardId')::uuid AND (owner_id=actor.id OR actor.id=ANY(editors))) THEN RETURN atlas_customer.problem(409,'PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED'); END IF;
  INSERT INTO atlas_dealer.manual_card_link(card_id,manual_card_id,received_event_id,actor_id,evidence_ref)
   VALUES(oc.card_id,(d->>'manualCardId')::uuid,ev.id,actor.id,d->>'evidenceRef');
  RETURN jsonb_build_object('cardId',oc.card_id,'manualCardId',d->>'manualCardId');
 ELSIF action<>'custody_record' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 ih:=atlas_customer.commerce_hash(d); k:=d->>'kind';
 SELECT * INTO prior FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND request_id=(d->>'requestId')::uuid;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash IS DISTINCT FROM ih OR prior.actor_id IS DISTINCT FROM actor.id THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 at_time:=(d->>'occurredAt')::timestamptz;
 IF at_time IS NULL OR at_time>clock_timestamp() OR at_time<(SELECT "paidAt" FROM atlas_customer."CommerceOrder" WHERE id=oc.order_id)
  OR jsonb_typeof(d->'evidence') IS DISTINCT FROM 'object' OR length(COALESCE(d->'evidence'->>'reference','')) NOT BETWEEN 1 AND 300
  OR (d->'evidence')-ARRAY['reference','note','expectedReturnAt']<>'{}'::jsonb OR length(COALESCE(d->'evidence'->>'note',''))>500 THEN RETURN atlas_customer.problem(400,'ACTUAL_CUSTODY_EVIDENCE_REQUIRED'); END IF;
 SELECT * INTO latest FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1;
 IF latest.id IS NOT NULL AND at_time<latest.occurred_at THEN RETURN atlas_customer.problem(409,'CUSTODY_EVENT_ORDER'); END IF;
 IF ((k='COLLECTED' AND oc.channel='KIOSK' AND latest.id IS NULL)
  OR (k='ATLAS_RECEIVED' AND (oc.channel='MAIL_IN' AND latest.id IS NULL OR latest.kind='COLLECTED'))
  OR (k IN ('RETURN_DISPATCHED','MAIL_DISPATCHED') AND latest.kind='ATLAS_RECEIVED' AND (k='RETURN_DISPATCHED')=(oc.channel='KIOSK')
   AND EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id WHERE l.card_id=oc.card_id))
  OR (k='RETURNED_TO_KIOSK' AND latest.kind='RETURN_DISPATCHED') OR (k='CUSTOMER_COLLECTED' AND latest.kind='RETURNED_TO_KIOSK')
  OR (k='CUSTOMER_DELIVERED' AND latest.kind='MAIL_DISPATCHED') OR k IN ('DELAY_REPORTED','DELAY_RESOLVED')) IS NOT TRUE THEN RETURN atlas_customer.problem(409,'CUSTODY_TRANSITION_INVALID'); END IF;
 INSERT INTO atlas_dealer.custody_event(card_id,sequence,request_id,input_hash,kind,actor_id,occurred_at,evidence)
 VALUES(oc.card_id,(SELECT COALESCE(max(sequence),0)+1 FROM atlas_dealer.custody_event WHERE card_id=oc.card_id),(d->>'requestId')::uuid,ih,k,actor.id,at_time,d->'evidence') RETURNING * INTO ev;
 RETURN jsonb_build_object('eventId',ev.id);
END $$;

-- Explicit customer-safe status. No manual draft, raw grade, private notes,
-- staff roster, addresses or payment credential enters this projection.
CREATE FUNCTION atlas_dealer.card_tracking(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity','channel',c.channel,
 'originalSchedule',c.location_snapshot->'schedule','originalLocation',c.location_snapshot->>'name',
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,
   'note',CASE WHEN e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') THEN e.evidence->>'note' END,
   'expectedReturnAt',CASE WHEN e.kind='DELAY_REPORTED' THEN e.evidence->>'expectedReturnAt' END) ORDER BY e.sequence)
   FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb),
 'grading',CASE WHEN a.approved_at IS NOT NULL THEN 'HUMAN_APPROVED' WHEN l.manual_card_id IS NOT NULL THEN 'IN_GRADING' ELSE 'NOT_STARTED' END,
 'approvedAt',a.approved_at,'reportUrl',(SELECT '/reports/'||i.public_token||'?v='||p.version FROM atlas_manual.public_report_identity i JOIN atlas_manual.publication p ON p.card_id=i.card_id WHERE i.card_id=l.manual_card_id AND p.action_id=a.action_id AND p.state='PUBLISHED' LIMIT 1),
 'collectedAt',col.occurred_at,
 'turnaroundTarget',CASE WHEN col.occurred_at IS NOT NULL THEN ((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone') END,
 'currentSchedule',CASE WHEN c.channel='KIOSK' THEN loc.schedule END,
 'currentProjection',CASE WHEN c.channel='KIOSK' AND col.occurred_at IS NULL THEN atlas_dealer.projection(loc.schedule,clock_timestamp())
 WHEN c.channel='KIOSK' THEN jsonb_build_object('nextCollection',NULL,'projectedReturn',atlas_dealer.next_slot(loc.schedule,'returns',((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'),false)) END,
 'scheduleChanged',CASE WHEN c.channel='KIOSK' THEN loc.revision<>(c.location_snapshot->>'revision')::integer ELSE false END)
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.location loc ON loc.id=c.location_id
 LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN LATERAL(SELECT approved_at,action_id FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT occurred_at FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind='COLLECTED' ORDER BY sequence LIMIT 1) col ON true
 WHERE c.card_id=cid
$$;
CREATE FUNCTION atlas_dealer.customer_tracking(account_id uuid,oid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking(c.card_id) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id),'[]'::jsonb)) FROM atlas_customer."CommerceOrder" o WHERE o.id=oid AND o."accountId"=account_id
$$;
-- Called only inside customer_call after its usual control binding validation.
-- dealer_enter uses ordinary SMS proof; dealer_read does NOT accept a customer
-- session as dealer authority. It requires the separately issued dealer token.
CREATE FUNCTION atlas_dealer.customer_call(action text,account_id uuid,control_revision integer,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m atlas_dealer.membership; s atlas_dealer.session; av integer; latest jsonb; order_row record; cursor_row record; orders jsonb:='[]'::jsonb; next_cursor uuid; row_count integer:=0;
BEGIN
 IF action='dealer_locations' THEN RETURN atlas_dealer.directory(clock_timestamp(),d->>'entry'); END IF;
 IF action='dealer_orders' THEN
  IF account_id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  IF d->>'cursor' IS NOT NULL THEN
   SELECT id,"paidAt" INTO cursor_row FROM atlas_customer."CommerceOrder" WHERE id=(d->>'cursor')::uuid AND "accountId"=account_id;
   IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  ELSE SELECT NULL::uuid id,NULL::timestamptz AS "paidAt" INTO cursor_row; END IF;
  FOR order_row IN SELECT o.id,o.reference,o."paidAt",count(c.card_id) AS card_count,min(c.channel) AS channel
   FROM atlas_customer."CommerceOrder" o JOIN atlas_dealer.order_card c ON c.order_id=o.id WHERE o."accountId"=account_id
   AND (cursor_row.id IS NULL OR (o."paidAt",o.id)<(cursor_row."paidAt",cursor_row.id)) GROUP BY o.id ORDER BY o."paidAt" DESC,o.id DESC LIMIT 21 LOOP
   row_count:=row_count+1; IF row_count=21 THEN EXIT; END IF;
   orders:=orders||jsonb_build_array(jsonb_build_object('id',order_row.id,'reference',order_row.reference,'paidAt',order_row."paidAt",'cardCount',order_row.card_count,'channel',order_row.channel)); next_cursor:=order_row.id;
  END LOOP;
  RETURN jsonb_build_object('orders',orders,'nextCursor',CASE WHEN row_count=21 THEN next_cursor ELSE NULL END);
 END IF;
 IF action='dealer_tracking' THEN
  latest:=atlas_dealer.customer_tracking(account_id,(d->>'orderId')::uuid);
  RETURN COALESCE(latest,atlas_customer.problem(404,'NOT_FOUND'));
 END IF;
 IF action='dealer_deposit' THEN RETURN atlas_dealer.declare_deposit(account_id,d); END IF;
 IF action='dealer_memberships' THEN
  IF account_id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN jsonb_build_object('memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('locationId',l.id,'name',l.name) ORDER BY l.name,l.id)
   FROM atlas_dealer.membership member_row JOIN atlas_dealer.location l ON l.id=member_row.location_id WHERE member_row.account_id=customer_call.account_id AND member_row.revoked_at IS NULL),'[]'::jsonb));
 END IF;
 IF action='dealer_enter' THEN
  SELECT * INTO m FROM atlas_dealer.membership WHERE membership.account_id=customer_call.account_id AND location_id=(d->>'locationId')::uuid AND revoked_at IS NULL FOR SHARE;
  SELECT "accessVersion" INTO av FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL FOR SHARE;
  IF m.id IS NULL OR av IS NULL THEN RETURN atlas_customer.problem(403,'DEALER_MEMBERSHIP_REQUIRED'); END IF;
  INSERT INTO atlas_dealer.session(token_hash,browser_hash,membership_id,membership_version,account_version,control_revision,expires_at)
   VALUES(d->>'dealerSessionHash',d->>'browserHash',m.id,m.version,av,control_revision,clock_timestamp()+interval '8 hours');
 ELSE
  SELECT * INTO s FROM atlas_dealer.session WHERE token_hash=d->>'dealerSessionHash' AND browser_hash=d->>'browserHash'
   AND revoked_at IS NULL AND expires_at>clock_timestamp() AND session.control_revision=customer_call.control_revision FOR SHARE;
  SELECT * INTO m FROM atlas_dealer.membership WHERE id=s.membership_id AND version=s.membership_version AND revoked_at IS NULL FOR SHARE;
  IF m.id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=m.account_id AND "accessVersion"=s.account_version AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
  IF action='dealer_logout' THEN UPDATE atlas_dealer.session SET revoked_at=clock_timestamp() WHERE token_hash=s.token_hash; RETURN '{"signedOut":true}'::jsonb; END IF;
  IF action<>'dealer_read' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 END IF;
 RETURN jsonb_build_object('location',(SELECT jsonb_build_object('id',id,'name',name,'enabled',enabled,'schedule',schedule) FROM atlas_dealer.location WHERE id=m.location_id),
  'customerCount',(SELECT count(DISTINCT o."accountId") FROM atlas_customer."CommerceOrder" o JOIN atlas_dealer.order_card c ON c.order_id=o.id WHERE c.location_id=m.location_id),
  'orderCount',(SELECT count(DISTINCT order_id) FROM atlas_dealer.order_card WHERE location_id=m.location_id),
  'cardCount',(SELECT count(*) FROM atlas_dealer.order_card WHERE location_id=m.location_id),
  'commission',jsonb_build_object('currency','USD','accruedCents',(SELECT COALESCE(sum(e.amount_cents),0) FROM atlas_dealer.commission_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id WHERE c.location_id=m.location_id AND e.kind='ACCRUED'),
   'reversedCents',(SELECT -COALESCE(sum(e.amount_cents),0) FROM atlas_dealer.commission_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id WHERE c.location_id=m.location_id AND e.kind='REVERSED'),
   'transferStatus','NO_TRANSFER_RECORDED'),
  'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('reference',q.reference,'paidAt',q."paidAt",'cardCount',q.n,'cards',q.cards) ORDER BY q."paidAt" DESC)
   FROM(SELECT o.reference,o."paidAt",count(*) n,jsonb_agg(jsonb_build_object('cardId',c.card_id,'grading',CASE WHEN a.approved THEN 'HUMAN_APPROVED' WHEN l.manual_card_id IS NOT NULL THEN 'IN_GRADING' ELSE 'NOT_STARTED' END,
    'custody',e.kind,'occurredAt',e.occurred_at) ORDER BY c.card_id) cards
    FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
    LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
    LEFT JOIN LATERAL(SELECT true approved FROM atlas_manual.approval WHERE card_id=l.manual_card_id LIMIT 1) a ON true
    LEFT JOIN LATERAL(SELECT kind,occurred_at FROM atlas_dealer.custody_event WHERE card_id=c.card_id ORDER BY sequence DESC LIMIT 1) e ON true
    WHERE c.location_id=m.location_id GROUP BY o.id ORDER BY o."paidAt" DESC LIMIT 100)q),'[]'::jsonb));
END $$;
-- Internal commerce evidence entry only. The caller verifies actual refund
-- provider evidence before dispatch. Amount/policy is explicit; no invented
-- discount/refund policy, prorating, payout date or money transfer.
CREATE FUNCTION atlas_dealer.reverse_commission(card uuid,refund jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE oc atlas_dealer.order_card; paid atlas_customer."CommercePayment"; prior atlas_dealer.commission_event; amount integer; source_ref text; ih text;
BEGIN
 SELECT * INTO oc FROM atlas_dealer.order_card WHERE card_id=card FOR UPDATE;
 SELECT p.* INTO paid FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId" WHERE o.id=oc.order_id;
 amount:=(refund->>'commissionCents')::integer; source_ref:='refund:'||(refund->>'providerEventId');
 IF oc.card_id IS NULL OR paid.state<>'PAID' OR paid."providerId" IS DISTINCT FROM refund->>'paymentProviderId'
 OR COALESCE(refund->>'state','')<>'SUCCEEDED' OR length(COALESCE(refund->>'providerEventId','')) NOT BETWEEN 1 AND 180
 OR length(COALESCE(refund->>'policyReference','')) NOT BETWEEN 1 AND 300 OR COALESCE(refund->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
 OR amount IS NULL OR refund->>'gradingRefundCents' IS NULL OR amount NOT BETWEEN 1 AND 500 OR (refund->>'gradingRefundCents')::integer NOT BETWEEN 1 AND 5000 THEN RETURN atlas_customer.problem(400,'VERIFIED_REFUND_EVIDENCE_REQUIRED'); END IF;
 SELECT * INTO prior FROM atlas_dealer.commission_event WHERE card_id=card AND commission_event.source_ref=reverse_commission.source_ref;
 IF prior.id IS NOT NULL THEN
  IF prior.source<>refund THEN RETURN atlas_customer.problem(409,'REFUND_EVIDENCE_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 IF COALESCE((SELECT sum(amount_cents) FROM atlas_dealer.commission_event WHERE card_id=card),0)<amount THEN RETURN atlas_customer.problem(409,'COMMISSION_REVERSAL_EXCEEDS_ACCRUAL'); END IF;
 INSERT INTO atlas_dealer.commission_event(card_id,kind,amount_cents,source_ref,source) VALUES(card,'REVERSED',-amount,source_ref,refund) RETURNING * INTO prior;
 RETURN jsonb_build_object('eventId',prior.id);
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_dealer FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_dealer FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.intake_location(uuid) FROM PUBLIC;
