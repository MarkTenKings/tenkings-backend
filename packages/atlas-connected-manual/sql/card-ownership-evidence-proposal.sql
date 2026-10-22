-- UNREGISTERED LOCAL PROPOSAL. Requires the unchanged ownership proposal.
-- No role creation/grants, HTTP route, runtime wiring, backfill or provider call.
-- Exact retained bytes establish integrity only, never authenticity/legal title.
CREATE SCHEMA atlas_ownership_evidence;
REVOKE ALL ON SCHEMA atlas_ownership_evidence FROM PUBLIC;
CREATE TABLE atlas_ownership_evidence.policy (
 id text PRIMARY KEY CHECK(id='active'), enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 accepted_claim_kinds text[] NOT NULL DEFAULT '{}', accepted_review_kinds text[] NOT NULL DEFAULT '{}',
 policy_reference text, retention_reference text, retention_seconds integer,
 valid_until timestamptz,
 CHECK(NOT enabled OR (revision>0 AND cardinality(accepted_claim_kinds)>0 AND cardinality(accepted_review_kinds)>0
  AND policy_reference IS NOT NULL AND retention_reference IS NOT NULL AND retention_seconds IS NOT NULL
  AND length(policy_reference) BETWEEN 1 AND 200 AND length(retention_reference) BETWEEN 1 AND 200
  AND retention_seconds BETWEEN 60 AND 31536000 AND valid_until IS NOT NULL))
);
INSERT INTO atlas_ownership_evidence.policy(id) VALUES('active');
CREATE FUNCTION atlas_ownership_evidence.policy_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_POLICY_REVISION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER policy_revision BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.policy FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.policy_revision();
-- Operator-only named identity provisioning. No default reviewer exists. The
-- reference is an operator decision, not proof automatically inferred by code.
CREATE TABLE atlas_ownership_evidence.reviewer_grant (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 staff_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 customer_account_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 staff_access_version integer NOT NULL CHECK(staff_access_version>0),
 customer_access_version integer NOT NULL CHECK(customer_access_version>0),
 policy_revision integer NOT NULL CHECK(policy_revision>0),
 identity_reference text NOT NULL CHECK(length(identity_reference) BETWEEN 1 AND 200),
 authorized_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_ownership_evidence.reviewer_revocation (
 grant_id uuid PRIMARY KEY REFERENCES atlas_ownership_evidence.reviewer_grant(id),
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION atlas_ownership_evidence.grant_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM atlas_staff."StaffIdentity" WHERE id=NEW.staff_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER grant_lock BEFORE INSERT ON atlas_ownership_evidence.reviewer_grant FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.grant_lock();
CREATE FUNCTION atlas_ownership_evidence.revoke_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM atlas_ownership_evidence.reviewer_grant WHERE id=NEW.grant_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER revoke_lock BEFORE INSERT ON atlas_ownership_evidence.reviewer_revocation FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.revoke_lock();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.reviewer_grant FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.reviewer_revocation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE INDEX reviewer_latest ON atlas_ownership_evidence.reviewer_grant(staff_id,sequence DESC);

-- A bounded private DB object, not an assertion that a remote URL exists.
-- There is no deletion job. retention_until is the configured usable retention
-- window; actual disposition/legal holds remain an owner decision before enable.
CREATE TABLE atlas_ownership_evidence.object (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 body bytea NOT NULL CHECK(octet_length(body) BETWEEN 1 AND 65536),
 byte_count integer GENERATED ALWAYS AS (octet_length(body)) STORED,
 sha256 text GENERATED ALWAYS AS (encode(sha256(body),'hex')) STORED,
 media_type text NOT NULL CHECK(media_type IN ('image/png','image/jpeg')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_ownership_evidence.manifest (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_id uuid NOT NULL UNIQUE REFERENCES atlas_ownership_evidence.object(id),
 card_id uuid NOT NULL REFERENCES atlas_manual.public_report_identity(card_id),
 customer_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 staff_id uuid REFERENCES atlas_staff."StaffIdentity"(id),
 request_id uuid NOT NULL, phase text NOT NULL CHECK(phase IN ('CLAIM','REVIEW')),
 claim_id uuid REFERENCES atlas_ownership.event(id), grant_id uuid REFERENCES atlas_ownership_evidence.reviewer_grant(id),
 policy_revision integer NOT NULL, proof_kind text NOT NULL CHECK(proof_kind ~ '^[A-Z][A-Z0-9_]{0,39}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 content jsonb NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 retention_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((phase='CLAIM' AND staff_id IS NULL AND claim_id IS NULL AND grant_id IS NULL)
  OR (phase='REVIEW' AND staff_id IS NOT NULL AND claim_id IS NOT NULL AND grant_id IS NOT NULL)),
 UNIQUE(customer_id,request_id,phase), UNIQUE(staff_id,request_id)
);
CREATE TABLE atlas_ownership_evidence.event_link (
 manifest_id uuid PRIMARY KEY REFERENCES atlas_ownership_evidence.manifest(id),
 event_id uuid NOT NULL UNIQUE REFERENCES atlas_ownership.event(id)
);
-- convert_to is STABLE in PostgreSQL17, so it cannot be a generated-column
-- expression. Compute the hash unconditionally on INSERT, then keep the entire
-- manifest immutable. No caller-provided digest is accepted as authoritative.
CREATE FUNCTION atlas_ownership_evidence.manifest_hash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 NEW.sha256:=encode(sha256(convert_to(NEW.content::text,'UTF8')),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER manifest_hash BEFORE INSERT ON atlas_ownership_evidence.manifest FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.manifest_hash();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.object FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.manifest FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_evidence.event_link FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
-- Private one-transaction authorization; no caller-settable GUC/capability.
CREATE TABLE atlas_ownership_evidence.event_guard (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, manifest_id uuid PRIMARY KEY REFERENCES atlas_ownership_evidence.manifest(id),
 session_hash text NOT NULL,browser_hash text NOT NULL,binding jsonb NOT NULL,phones text[],
 expected_input jsonb NOT NULL
);

CREATE FUNCTION atlas_ownership_evidence.live_policy() RETURNS atlas_ownership_evidence.policy LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p atlas_ownership_evidence.policy;
BEGIN
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 IF p.enabled IS DISTINCT FROM true OR p.valid_until IS NULL OR p.valid_until<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN p;
END $$;
CREATE FUNCTION atlas_ownership_evidence.customer_actor(sh text,bh text,binding jsonb) RETURNS atlas_customer."CustomerAccount" LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount";
BEGIN
 SELECT * INTO c FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF c.enabled IS DISTINCT FROM true OR (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash') IS DISTINCT FROM
 (c.mode,c.origin,c."deploymentId",c."releaseSha",c."configHash") THEN RETURN NULL; END IF;
 SELECT * INTO a FROM atlas_customer.current_account(sh,bh,c.revision); RETURN a;
END $$;
CREATE FUNCTION atlas_ownership_evidence.reviewer_actor(sh text,bh text,binding jsonb,phones text[]) RETURNS atlas_ownership_evidence.reviewer_grant LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a record; g atlas_ownership_evidence.reviewer_grant; old atlas_ownership.reviewer_authority; account atlas_customer."CustomerAccount"; p atlas_ownership_evidence.policy;
BEGIN
 SELECT * INTO p FROM atlas_ownership_evidence.live_policy(); IF p.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM atlas_manual.authenticate(sh,bh,binding,phones);
 IF a.id IS NULL OR a.role<>'REVIEWER' THEN RETURN NULL; END IF;
 SELECT * INTO old FROM atlas_ownership.reviewer_authority WHERE staff_id=a.id FOR SHARE;
 SELECT * INTO g FROM atlas_ownership_evidence.reviewer_grant WHERE staff_id=a.id ORDER BY sequence DESC LIMIT 1 FOR SHARE;
 IF g.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO account FROM atlas_customer."CustomerAccount" WHERE id=g.customer_account_id FOR SHARE;
 -- Reauthenticate after the final potentially waiting account lock.
 SELECT * INTO a FROM atlas_manual.authenticate(sh,bh,binding,phones);
 IF a.id IS NULL OR a.role<>'REVIEWER' OR a.id<>g.staff_id OR a.access_version<>g.staff_access_version
  OR account.id IS NULL OR account."revokedAt" IS NOT NULL OR account."accessVersion"<>g.customer_access_version
  OR old.staff_id IS NULL OR old.customer_account_id<>g.customer_account_id OR old.authorization_reference<>g.identity_reference
  OR old.authorized_until<>g.authorized_until OR old.revoked_at IS NOT NULL
  OR g.created_at>clock_timestamp() OR g.authorized_until<=clock_timestamp() OR p.valid_until<=clock_timestamp() OR g.policy_revision<>p.revision
  OR EXISTS(SELECT 1 FROM atlas_ownership_evidence.reviewer_revocation WHERE grant_id=g.id) THEN RETURN NULL; END IF;
 RETURN g;
END $$;
CREATE FUNCTION atlas_ownership_evidence.media_type(body bytea) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN octet_length(body) BETWEEN 24 AND 65536 AND substring(body FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex')
  AND substring(body FROM octet_length(body)-11 FOR 12)=decode('0000000049454e44ae426082','hex') THEN 'image/png'
 WHEN octet_length(body) BETWEEN 4 AND 65536 AND substring(body FROM 1 FOR 3)=decode('ffd8ff','hex') AND substring(body FROM octet_length(body)-1 FOR 2)=decode('ffd9','hex') THEN 'image/jpeg' END
$$;
-- Magic validation rejects unsupported media; it is not a decoder/authenticity
-- claim. Every read is an opaque attachment with no inline active rendering.
CREATE FUNCTION atlas_ownership_evidence.manifest_valid(m atlas_ownership_evidence.manifest,p atlas_ownership_evidence.policy) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(m.id IS NOT NULL AND m.sha256=encode(sha256(convert_to(m.content::text,'UTF8')),'hex') AND m.policy_revision=p.revision AND m.retention_until>clock_timestamp()
 AND m.proof_kind=ANY(CASE WHEN m.phase='CLAIM' THEN p.accepted_claim_kinds ELSE p.accepted_review_kinds END)
 AND EXISTS(SELECT 1 FROM atlas_ownership_evidence.object o WHERE o.id=m.object_id AND o.media_type=atlas_ownership_evidence.media_type(o.body)
 AND m.content=jsonb_build_object('schema','atlas-private-ownership-evidence-v1','objectId',o.id,'byteCount',o.byte_count,'byteSha256',o.sha256,'mediaType',o.media_type,
 'cardId',m.card_id,'customerId',m.customer_id,'staffId',m.staff_id,'requestId',m.request_id,'phase',m.phase,'claimId',m.claim_id,'grantId',m.grant_id,
 'policyRevision',m.policy_revision,'proofKind',m.proof_kind,'requestHash',m.request_hash,'retentionUntil',m.retention_until)),false)
$$;
CREATE FUNCTION atlas_ownership_evidence.enforce_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE guard atlas_ownership_evidence.event_guard; m atlas_ownership_evidence.manifest; p atlas_ownership_evidence.policy; a atlas_customer."CustomerAccount"; g atlas_ownership_evidence.reviewer_grant; claim atlas_ownership.event; original atlas_ownership_evidence.manifest;
BEGIN
 IF NEW.kind NOT IN ('CLAIM_SUBMITTED','CLAIM_VERIFIED','CLAIM_REJECTED') THEN RETURN NEW; END IF;
 DELETE FROM atlas_ownership_evidence.event_guard WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()
 AND manifest_id::text=NEW.input#>>'{evidence,referenceId}' RETURNING * INTO guard;
 IF guard.manifest_id IS NULL OR guard.expected_input IS DISTINCT FROM NEW.input THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_GATEWAY_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM atlas_ownership_evidence.manifest WHERE id=guard.manifest_id;
 SELECT * INTO p FROM atlas_ownership_evidence.live_policy();
 IF p.id IS NULL OR NOT atlas_ownership_evidence.manifest_valid(m,p) OR m.card_id<>NEW.card_id OR m.request_id<>NEW.request_id
 OR m.sha256 IS DISTINCT FROM NEW.input#>>'{evidence,sha256}' THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF NEW.kind='CLAIM_SUBMITTED' THEN
  SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(guard.session_hash,guard.browser_hash,guard.binding);
  IF a.id IS NULL OR m.phase<>'CLAIM' OR a.id<>m.customer_id OR a.id IS DISTINCT FROM NEW.customer_id OR NEW.staff_id IS NOT NULL OR NEW.action<>'submit_claim'
   THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSE
  SELECT * INTO g FROM atlas_ownership_evidence.reviewer_actor(guard.session_hash,guard.browser_hash,guard.binding,guard.phones);
  SELECT * INTO claim FROM atlas_ownership.event WHERE id=NEW.subject_id AND card_id=m.card_id AND kind='CLAIM_SUBMITTED';
  SELECT em.* INTO original FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id WHERE l.event_id=claim.id;
  IF g.id IS NULL OR g.id IS DISTINCT FROM m.grant_id OR m.phase<>'REVIEW' OR m.claim_id IS DISTINCT FROM claim.id OR claim.customer_id IS DISTINCT FROM m.customer_id
   OR g.customer_account_id=m.customer_id OR NEW.staff_id IS DISTINCT FROM g.staff_id OR m.staff_id IS DISTINCT FROM g.staff_id OR NEW.action<>'review_claim'
   OR NOT atlas_ownership_evidence.manifest_valid(original,p) OR original.id::text IS DISTINCT FROM claim.input#>>'{evidence,referenceId}'
   OR original.sha256 IS DISTINCT FROM claim.input#>>'{evidence,sha256}' THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 -- Authentication may have waited. Recheck temporal policy/object bounds at
 -- the final insertion point, after all original writer and reviewer waits.
 IF p.valid_until<=clock_timestamp() OR NOT atlas_ownership_evidence.manifest_valid(m,p)
 OR (NEW.kind<>'CLAIM_SUBMITTED' AND NOT atlas_ownership_evidence.manifest_valid(original,p))
 THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_EXPIRED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_gateway BEFORE INSERT ON atlas_ownership.event FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.enforce_event();

CREATE FUNCTION atlas_ownership_evidence.retain(cid uuid,aid uuid,sid uuid,rid uuid,phase_name text,claim uuid,gid uuid,p atlas_ownership_evidence.policy,kind text,request_digest text,body bytea)
 RETURNS atlas_ownership_evidence.manifest LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o atlas_ownership_evidence.object; m atlas_ownership_evidence.manifest; until_at timestamptz;
BEGIN
 INSERT INTO atlas_ownership_evidence.object(body,media_type) VALUES(body,atlas_ownership_evidence.media_type(body)) RETURNING * INTO o;
 until_at:=clock_timestamp()+make_interval(secs=>p.retention_seconds);
 INSERT INTO atlas_ownership_evidence.manifest(object_id,card_id,customer_id,staff_id,request_id,phase,claim_id,grant_id,policy_revision,proof_kind,request_hash,retention_until,content)
 VALUES(o.id,cid,aid,sid,rid,phase_name,claim,gid,p.revision,kind,request_digest,until_at,
 jsonb_build_object('schema','atlas-private-ownership-evidence-v1','objectId',o.id,'byteCount',o.byte_count,'byteSha256',o.sha256,'mediaType',o.media_type,
 'cardId',cid,'customerId',aid,'staffId',sid,'requestId',rid,'phase',phase_name,'claimId',claim,'grantId',gid,'policyRevision',p.revision,'proofKind',kind,'requestHash',request_digest,'retentionUntil',until_at)) RETURNING * INTO m;
 RETURN m;
END $$;
CREATE FUNCTION atlas_ownership_evidence.input_valid(act text,d jsonb,body bytea) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE base jsonb; k text;
BEGIN
 IF act='read_evidence' THEN RETURN jsonb_typeof(d)='object' AND d ?& ARRAY['claimId','evidenceId'] AND d-ARRAY['claimId','evidenceId']='{}'::jsonb
 AND jsonb_typeof(d->'claimId')='string' AND d->>'claimId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 AND jsonb_typeof(d->'evidenceId')='string' AND d->>'evidenceId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' AND body IS NULL; END IF;
 IF act NOT IN ('submit_claim','review_claim') OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT d ? 'proofKind'
 OR jsonb_typeof(d->'proofKind') IS DISTINCT FROM 'string' OR NOT COALESCE(d->>'proofKind' ~ '^[A-Z][A-Z0-9_]{0,39}$',false)
 OR atlas_ownership_evidence.media_type(body) IS NULL THEN RETURN false; END IF;
 base:=(d-'proofKind')||jsonb_build_object('evidence',jsonb_build_object('referenceId','00000000-0000-4000-8000-000000000000','sha256',repeat('0',64)));
 RETURN NOT d ? 'evidence' AND atlas_ownership.input_valid(act,base);
END $$;
CREATE FUNCTION atlas_ownership_evidence.receipt(m atlas_ownership_evidence.manifest,eid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT atlas_ownership.receipt(e)||jsonb_build_object('evidence',jsonb_build_object('referenceId',m.id,'sha256',m.sha256)) FROM atlas_ownership.event e WHERE e.id=eid
$$;
CREATE FUNCTION atlas_ownership_evidence.attachment(m atlas_ownership_evidence.manifest) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('evidenceId',m.id,'sha256',o.sha256,'byteCount',o.byte_count,'bodyBase64',replace(encode(o.body,'base64'),E'\n','')) FROM atlas_ownership_evidence.object o WHERE o.id=m.object_id
$$;
CREATE FUNCTION atlas_ownership_evidence.lock_card(cid uuid,sid uuid,mode_name text,writing boolean) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM atlas_manual.card c WHERE c.id=cid AND (sid IS NULL OR c.owner_id=sid OR sid=ANY(c.readers) OR sid=ANY(c.editors) OR sid=ANY(c.approvers)) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF writing THEN PERFORM 1 FROM atlas_manual.public_report_identity WHERE card_id=cid FOR UPDATE;
 ELSE PERFORM 1 FROM atlas_manual.public_report_identity WHERE card_id=cid FOR SHARE; END IF;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM atlas_manual_intake.card WHERE id=cid FOR SHARE;
 RETURN FOUND AND EXISTS(SELECT 1 FROM atlas_manual.publication WHERE card_id=cid AND state='PUBLISHED' AND mode=mode_name)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_manual_intake.discarded_card x ON x.card_id=c.id OR (x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id) WHERE c.id=cid);
END $$;
CREATE FUNCTION atlas_ownership_evidence.customer_gateway(sh text,bh text,binding jsonb,act text,d jsonb,body bytea) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p atlas_ownership_evidence.policy; a atlas_customer."CustomerAccount"; m atlas_ownership_evidence.manifest; claim atlas_ownership.event; cid uuid; rid uuid; ih text; old_input jsonb; result jsonb; eid uuid;
BEGIN
 IF act NOT IN ('submit_claim','read_evidence') OR atlas_ownership_evidence.input_valid(act,d,body) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_EVIDENCE'); END IF;
 SELECT * INTO p FROM atlas_ownership_evidence.live_policy(); IF p.id IS NULL THEN RETURN atlas_customer.problem(503,'OWNERSHIP_EVIDENCE_DISABLED'); END IF;
 SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='read_evidence' THEN
  SELECT * INTO claim FROM atlas_ownership.event WHERE id=(d->>'claimId')::uuid AND kind='CLAIM_SUBMITTED' AND customer_id=a.id;
  SELECT em.* INTO m FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id
   WHERE em.id=(d->>'evidenceId')::uuid AND em.phase='CLAIM' AND em.customer_id=a.id AND l.event_id=claim.id AND em.card_id=claim.card_id;
  IF claim.id IS NULL OR m.id IS NULL OR NOT atlas_ownership_evidence.lock_card(m.card_id,NULL,binding->>'mode',false) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_EVIDENCE_NOT_FOUND'); END IF;
  SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
  IF a.id IS NULL OR a.id<>m.customer_id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  IF p.valid_until<=clock_timestamp() OR NOT atlas_ownership_evidence.manifest_valid(m,p) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_EVIDENCE_UNAVAILABLE'); END IF;
  RETURN atlas_ownership_evidence.attachment(m);
 END IF;
 IF NOT d->>'proofKind'=ANY(p.accepted_claim_kinds) THEN RETURN atlas_customer.problem(400,'OWNERSHIP_PROOF_KIND_NOT_ACCEPTED'); END IF;
 cid:=(d->>'cardId')::uuid; rid:=(d->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-account:'||a.id::text,0));
 IF NOT atlas_ownership_evidence.lock_card(cid,NULL,binding->>'mode',true) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 ih:=encode(sha256(convert_to(d::text||':'||encode(sha256(body),'hex'),'UTF8')),'hex');
 SELECT * INTO m FROM atlas_ownership_evidence.manifest WHERE customer_id=a.id AND request_id=rid AND phase='CLAIM';
 IF m.id IS NOT NULL THEN
  IF m.request_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
  IF p.valid_until<=clock_timestamp() OR NOT atlas_ownership_evidence.manifest_valid(m,p) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_EVIDENCE_UNAVAILABLE'); END IF;
  SELECT event_id INTO eid FROM atlas_ownership_evidence.event_link WHERE manifest_id=m.id;
  RETURN atlas_ownership_evidence.receipt(m,eid);
 END IF;
 BEGIN
  SELECT * INTO m FROM atlas_ownership_evidence.retain(cid,a.id,NULL,rid,'CLAIM',NULL,NULL,p,d->>'proofKind',ih,body);
  old_input:=(d-'proofKind')||jsonb_build_object('evidence',jsonb_build_object('referenceId',m.id,'sha256',m.sha256));
  INSERT INTO atlas_ownership_evidence.event_guard VALUES(txid_current(),pg_backend_pid(),m.id,sh,bh,binding,NULL,old_input);
  result:=atlas_ownership.customer_call(sh,bh,binding,'submit_claim',old_input);
  IF result ? 'error' THEN RAISE EXCEPTION 'ROLLBACK_EVIDENCE_ONLY' USING ERRCODE='P0410'; END IF;
  IF EXISTS(SELECT 1 FROM atlas_ownership_evidence.event_guard WHERE manifest_id=m.id) THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_NOT_CONSUMED' USING ERRCODE='42501'; END IF;
  eid:=(result->>'eventId')::uuid;
  INSERT INTO atlas_ownership_evidence.event_link VALUES(m.id,eid);
  RETURN atlas_ownership_evidence.receipt(m,eid);
 EXCEPTION WHEN SQLSTATE 'P0410' THEN RETURN result;
 END;
END $$;
CREATE FUNCTION atlas_ownership_evidence.reviewer_gateway(sh text,bh text,binding jsonb,phones text[],act text,d jsonb,body bytea) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p atlas_ownership_evidence.policy; g atlas_ownership_evidence.reviewer_grant; after_grant atlas_ownership_evidence.reviewer_grant;
 m atlas_ownership_evidence.manifest; original atlas_ownership_evidence.manifest; claim atlas_ownership.event; claimant atlas_customer."CustomerAccount";
 cid uuid; rid uuid; ih text; old_input jsonb; result jsonb; eid uuid;
BEGIN
 IF act NOT IN ('review_claim','read_evidence') OR atlas_ownership_evidence.input_valid(act,d,body) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_EVIDENCE'); END IF;
 SELECT * INTO p FROM atlas_ownership_evidence.live_policy(); IF p.id IS NULL THEN RETURN atlas_customer.problem(503,'OWNERSHIP_EVIDENCE_DISABLED'); END IF;
 SELECT * INTO g FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones); IF g.id IS NULL THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 SELECT * INTO claim FROM atlas_ownership.event WHERE id=(d->>'claimId')::uuid AND kind='CLAIM_SUBMITTED';
 IF claim.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 cid:=claim.card_id;
 IF act='review_claim' AND cid::text IS DISTINCT FROM d->>'cardId' THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-reviewer:'||g.staff_id::text,0));
 IF NOT atlas_ownership_evidence.lock_card(cid,g.staff_id,binding->>'mode',act='review_claim') THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 SELECT * INTO claimant FROM atlas_customer."CustomerAccount" WHERE id=claim.customer_id FOR SHARE;
 IF claimant.id IS NULL OR claimant."revokedAt" IS NOT NULL OR claimant.id=g.customer_account_id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_INDEPENDENT_REVIEW_REQUIRED'); END IF;
 SELECT * INTO after_grant FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones);
 IF after_grant.id IS NULL OR after_grant.id<>g.id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 SELECT em.* INTO original FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id WHERE l.event_id=claim.id;
 IF p.valid_until<=clock_timestamp() OR NOT atlas_ownership_evidence.manifest_valid(original,p) OR original.id::text IS DISTINCT FROM claim.input#>>'{evidence,referenceId}'
  OR original.sha256 IS DISTINCT FROM claim.input#>>'{evidence,sha256}' THEN RETURN atlas_customer.problem(409,'OWNERSHIP_EVIDENCE_UNAVAILABLE'); END IF;
 IF act='read_evidence' THEN
  SELECT em.* INTO m FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id JOIN atlas_ownership.event e ON e.id=l.event_id
  WHERE em.id=(d->>'evidenceId')::uuid AND em.card_id=cid AND em.customer_id=claim.customer_id AND (e.id=claim.id OR e.subject_id=claim.id);
  IF m.id IS NULL OR NOT atlas_ownership_evidence.manifest_valid(m,p) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_EVIDENCE_NOT_FOUND'); END IF;
  RETURN atlas_ownership_evidence.attachment(m);
 END IF;
 IF NOT d->>'proofKind'=ANY(p.accepted_review_kinds) THEN RETURN atlas_customer.problem(400,'OWNERSHIP_PROOF_KIND_NOT_ACCEPTED'); END IF;
 rid:=(d->>'requestId')::uuid; ih:=encode(sha256(convert_to(d::text||':'||encode(sha256(body),'hex'),'UTF8')),'hex');
 SELECT * INTO m FROM atlas_ownership_evidence.manifest WHERE staff_id=g.staff_id AND request_id=rid;
 IF m.id IS NOT NULL THEN
  IF m.request_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
  IF NOT atlas_ownership_evidence.manifest_valid(m,p) OR m.grant_id<>g.id THEN RETURN atlas_customer.problem(409,'OWNERSHIP_EVIDENCE_UNAVAILABLE'); END IF;
  SELECT event_id INTO eid FROM atlas_ownership_evidence.event_link WHERE manifest_id=m.id;
  RETURN atlas_ownership_evidence.receipt(m,eid);
 END IF;
 BEGIN
  SELECT * INTO m FROM atlas_ownership_evidence.retain(cid,claim.customer_id,g.staff_id,rid,'REVIEW',claim.id,g.id,p,d->>'proofKind',ih,body);
  old_input:=(d-'proofKind')||jsonb_build_object('evidence',jsonb_build_object('referenceId',m.id,'sha256',m.sha256));
  INSERT INTO atlas_ownership_evidence.event_guard VALUES(txid_current(),pg_backend_pid(),m.id,sh,bh,binding,phones,old_input);
  result:=atlas_ownership.staff_call(sh,bh,binding,phones,old_input);
  IF result ? 'error' THEN RAISE EXCEPTION 'ROLLBACK_EVIDENCE_ONLY' USING ERRCODE='P0410'; END IF;
  IF EXISTS(SELECT 1 FROM atlas_ownership_evidence.event_guard WHERE manifest_id=m.id) THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_NOT_CONSUMED' USING ERRCODE='42501'; END IF;
  eid:=(result->>'eventId')::uuid;
  INSERT INTO atlas_ownership_evidence.event_link VALUES(m.id,eid);
  RETURN atlas_ownership_evidence.receipt(m,eid);
 EXCEPTION WHEN SQLSTATE 'P0410' THEN RETURN result;
 END;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_ownership_evidence FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_ownership_evidence FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_evidence FROM PUBLIC;
