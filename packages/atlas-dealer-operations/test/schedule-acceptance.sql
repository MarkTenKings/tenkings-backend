-- Run only in the owned disposable full migration database. Rolls back.
BEGIN;
DO $$
DECLARE s jsonb:='{"timeZone":"America/Los_Angeles","pickups":[{"weekday":3,"time":"10:00","cutoff":"09:00"}],"returns":[{"weekday":3,"time":"10:00"}],"exceptions":[]}'; p jsonb; t timestamptz;
BEGIN
 IF NOT atlas_dealer.valid_schedule(s) THEN RAISE EXCEPTION 'valid schedule rejected'; END IF;
 p:=atlas_dealer.projection(s,'2026-09-28T18:00:00Z');
 IF (p->>'nextCollection')::timestamptz<>'2026-09-30T17:00:00Z' OR (p->>'projectedReturn')::timestamptz<>'2026-10-07T17:00:00Z' THEN RAISE EXCEPTION 'Monday deposit must project Wednesday pickup and following Wednesday return: %',p; END IF;
 IF atlas_dealer.next_slot(s,'pickups','2026-09-30T16:00:00Z',true)<>'2026-10-07T17:00:00Z' THEN RAISE EXCEPTION 'exact cutoff did not roll forward'; END IF;
 IF atlas_dealer.next_cutoff(s,'2026-09-28T18:00:00Z')<>'2026-09-30T16:00:00Z' THEN RAISE EXCEPTION 'wrong local cutoff'; END IF;
 s:=jsonb_set(s,'{exceptions}','[{"date":"2026-09-30","kind":"pickups","cancelled":true,"reason":"Fixture closure"}]');
 IF atlas_dealer.next_slot(s,'pickups','2026-09-28T18:00:00Z',true)<>'2026-10-07T17:00:00Z' THEN RAISE EXCEPTION 'closed route was used'; END IF;
 s:=jsonb_set(s,'{exceptions}','[{"date":"2026-09-29","kind":"pickups","cancelled":false,"time":"15:00","cutoff":"14:00","reason":"Fixture extra route"}]');
 IF atlas_dealer.next_slot(s,'pickups','2026-09-28T18:00:00Z',true)<>'2026-09-29T22:00:00Z' THEN RAISE EXCEPTION 'exception did not add actual extra route'; END IF;
 s:='{"timeZone":"America/Los_Angeles","pickups":[{"weekday":0,"time":"02:30","cutoff":"01:00"}],"returns":[{"weekday":0,"time":"10:00"}],"exceptions":[]}';
 IF atlas_dealer.next_slot(s,'pickups','2026-03-08T08:00:00Z',true)<>'2026-03-15T09:30:00Z' THEN RAISE EXCEPTION 'nonexistent DST time was not skipped'; END IF;
 s:=jsonb_set(s,'{pickups,0,time}','"01:30"');
 IF atlas_dealer.next_slot(s,'pickups','2026-11-01T07:00:00Z',true)<>'2026-11-01T09:30:00Z' THEN RAISE EXCEPTION 'ambiguous DST time must use standard-time occurrence'; END IF;
 IF atlas_dealer.valid_schedule(jsonb_set(s,'{timeZone}','"Invented/Zone"')) THEN RAISE EXCEPTION 'invented timezone accepted'; END IF;
 IF atlas_dealer.valid_schedule(jsonb_set(s,'{pickups,0,cutoff}','"23:00"')) THEN RAISE EXCEPTION 'cutoff after collection accepted'; END IF;
 IF atlas_dealer.valid_schedule(jsonb_set(s,'{pickups}','[{"weekday":0,"time":"01:30","cutoff":"01:00"},{"weekday":0,"time":"02:00","cutoff":"01:00"}]')) THEN RAISE EXCEPTION 'ambiguous duplicate weekday accepted'; END IF;
 IF atlas_dealer.directory(clock_timestamp())->'locations'<>'[]'::jsonb THEN RAISE EXCEPTION 'synthetic directory test requires empty owned DB'; END IF;
END $$;
ROLLBACK;
