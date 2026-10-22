-- UNREGISTERED proposal: requires unchanged ownership, evidence and workflow readers.
-- No storage I/O, role grants, deletion, runtime wiring or enabled policy.
CREATE SCHEMA atlas_ownership_proof;
REVOKE ALL ON SCHEMA atlas_ownership_proof FROM PUBLIC;
CREATE TABLE atlas_ownership_proof.policy (
 id text PRIMARY KEY CHECK(id='active'), enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), accepted_formats text[] NOT NULL DEFAULT '{}',
 validators jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(validators)='array'),
 policy_reference text, deletion_reference text, delete_after_seconds integer, valid_until timestamptz,
 CHECK(accepted_formats <@ ARRAY['image/jpeg','image/png','image/heic']),
 CHECK(NOT enabled OR (revision>0 AND cardinality(accepted_formats)>0 AND jsonb_array_length(validators)>0
 AND policy_reference IS NOT NULL AND deletion_reference IS NOT NULL AND delete_after_seconds IS NOT NULL
 AND length(policy_reference) BETWEEN 1 AND 200 AND length(deletion_reference) BETWEEN 1 AND 200
 AND delete_after_seconds BETWEEN 60 AND 31536000 AND valid_until IS NOT NULL))
);
INSERT INTO atlas_ownership_proof.policy(id) VALUES('active');
CREATE TRIGGER revision BEFORE UPDATE OR DELETE ON atlas_ownership_proof.policy FOR EACH ROW EXECUTE FUNCTION atlas_ownership_evidence.policy_revision();
CREATE TABLE atlas_ownership_proof.bundle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 card_id uuid NOT NULL REFERENCES atlas_manual.public_report_identity(card_id), request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), binding jsonb NOT NULL,
 proof_kind text NOT NULL, policy_revision integer NOT NULL, upload_policy_revision integer NOT NULL,
 policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'), policy_snapshot jsonb NOT NULL,
 expires_at timestamptz NOT NULL, usable_until timestamptz NOT NULL, delete_after timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(customer_id,request_id),
 CHECK(expires_at>created_at AND usable_until>=expires_at AND delete_after>=usable_until)
);
CREATE TABLE atlas_ownership_proof.object (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bundle_id uuid NOT NULL REFERENCES atlas_ownership_proof.bundle(id),
 client_file_id uuid NOT NULL, byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 20971520),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), declared_type text NOT NULL CHECK(declared_type IN ('image/jpeg','image/png','image/heic')),
 UNIQUE(bundle_id,client_file_id)
);
-- One unresolved upload slot per account, serialized by the account advisory
-- lock. Expiry releases admission only; this table does not claim object deletion.
CREATE TABLE atlas_ownership_proof.upload_lease (
 object_id uuid PRIMARY KEY REFERENCES atlas_ownership_proof.object(id),
 customer_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_proof.upload_lease FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TABLE atlas_ownership_proof.retained (
 object_id uuid PRIMARY KEY REFERENCES atlas_ownership_proof.object(id), observation jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Consumed bundles remain immutable; replacement creates a different bundle.
CREATE TABLE atlas_ownership_proof.consumption (
 bundle_id uuid PRIMARY KEY REFERENCES atlas_ownership_proof.bundle(id), claim_id uuid NOT NULL REFERENCES atlas_ownership.event(id),
 claim_revision integer NOT NULL CHECK(claim_revision>0), manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_proof.bundle FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_proof.object FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_proof.retained FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_proof.consumption FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

-- Closed ASCII-key metadata uses this same canonical encoding in Node.
CREATE FUNCTION atlas_ownership_proof.canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s text;
BEGIN
 IF jsonb_typeof(v)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||atlas_ownership_proof.canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO s FROM jsonb_each(v);
 ELSIF jsonb_typeof(v)='array' THEN SELECT '['||COALESCE(string_agg(atlas_ownership_proof.canonical(value),',' ORDER BY ord),'')||']' INTO s FROM jsonb_array_elements(v) WITH ORDINALITY t(value,ord);
 ELSE s:=v::text; END IF; RETURN s;
END $$;
CREATE FUNCTION atlas_ownership_proof.digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(atlas_ownership_proof.canonical(v),'UTF8')),'hex')
$$;
CREATE FUNCTION atlas_ownership_proof.uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
$$;
CREATE FUNCTION atlas_ownership_proof.policy_snapshot() RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('evidence',to_jsonb(e),'upload',to_jsonb(p)) FROM atlas_ownership_evidence.policy e,atlas_ownership_proof.policy p WHERE e.id='active' AND p.id='active'
$$;
CREATE FUNCTION atlas_ownership_proof.live_policy() RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e atlas_ownership_evidence.policy; p atlas_ownership_proof.policy;
BEGIN
 SELECT * INTO e FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 SELECT * INTO p FROM atlas_ownership_proof.policy WHERE id='active' FOR SHARE;
 RETURN COALESCE(e.enabled AND p.enabled AND e.valid_until>clock_timestamp() AND p.valid_until>clock_timestamp()
 AND e.retention_seconds>=300 AND p.delete_after_seconds>=e.retention_seconds,false);
END $$;
CREATE FUNCTION atlas_ownership_proof.bundle_valid(b atlas_ownership_proof.bundle,mode_name text,uploading boolean) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(b.id IS NOT NULL AND b.policy_snapshot=atlas_ownership_proof.policy_snapshot()
 AND b.policy_hash=atlas_ownership_proof.digest(b.policy_snapshot)
 AND b.binding=atlas_ownership_workflow.card_binding(b.card_id,mode_name)
 AND b.usable_until>clock_timestamp() AND b.delete_after>clock_timestamp()
 AND (NOT uploading OR b.expires_at>clock_timestamp()),false)
$$;
CREATE FUNCTION atlas_ownership_proof.object_plan(oid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o atlas_ownership_proof.object; b atlas_ownership_proof.bundle; v jsonb;
BEGIN
 SELECT * INTO o FROM atlas_ownership_proof.object WHERE id=oid;
 SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=o.bundle_id; IF b.id IS NULL THEN RETURN NULL; END IF;
 v:=jsonb_build_object('schema','atlas-ownership-proof-object-plan-v2','bundleId',b.id,'objectId',o.id,'accountId',b.customer_id,
 'cardId',b.card_id,'approvalActionId',b.binding->'approvalActionId','approvalReportHash',b.binding->'approvalReportHash',
 'policyHash',b.policy_hash,'policyRevision',b.policy_revision,'uploadPolicyRevision',b.upload_policy_revision,
 'bundleRevision',1,'objectRevision',1,'declaredType',o.declared_type,'byteCount',o.byte_count,'sha256',o.sha256,
 'key','atlas-ownership-proof/v2/'||b.id::text||'/'||o.id::text,
 'expiresAt',to_char(b.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN v||jsonb_build_object('planHash',atlas_ownership_proof.digest(v));
END $$;
CREATE FUNCTION atlas_ownership_proof.observation_valid(v jsonb,p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE x jsonb; obj jsonb; decoder text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['schema','planHash','object','sha256','byteCount','contentType','validation']
 OR v-ARRAY['schema','planHash','object','sha256','byteCount','contentType','validation']<>'{}'::jsonb THEN RETURN false; END IF;
 x:=v->'validation'; obj:=v->'object';
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ?& ARRAY['recipe','decoderVersion','mime','width','height','pixels','originalSha256','originalByteCount']
 OR x-ARRAY['recipe','decoderVersion','mime','width','height','pixels','originalSha256','originalByteCount']<>'{}'::jsonb
 OR jsonb_typeof(obj) IS DISTINCT FROM 'object' OR NOT obj ?& ARRAY['key','versionId','etag'] OR obj-ARRAY['key','versionId','etag']<>'{}'::jsonb THEN RETURN false; END IF;
 IF NOT COALESCE(x->>'width' ~ '^[1-9][0-9]{0,7}$' AND x->>'height' ~ '^[1-9][0-9]{0,7}$' AND x->>'pixels' ~ '^[1-9][0-9]{0,7}$',false)
 OR jsonb_typeof(x->'width')<>'number' OR jsonb_typeof(x->'height')<>'number' OR jsonb_typeof(x->'pixels')<>'number' THEN RETURN false; END IF;
 decoder:=CASE p->>'declaredType' WHEN 'image/heic' THEN 'libheif-1.23.2/libde265-1.1.1' ELSE 'sharp-0.33.5/libvips-8.15.3' END;
 RETURN COALESCE(v->>'schema'='atlas-ownership-proof-object-observation-v2' AND v->'planHash'=p->'planHash'
 AND obj->'key'=p->'key' AND (obj->'versionId'='null'::jsonb OR (jsonb_typeof(obj->'versionId')='string' AND length(obj->>'versionId') BETWEEN 1 AND 512 AND obj->>'versionId' ~ '^[ -~]+$' AND btrim(obj->>'versionId')=obj->>'versionId'))
 AND jsonb_typeof(obj->'etag')='string' AND length(obj->>'etag') BETWEEN 1 AND 512 AND obj->>'etag' ~ '^[ -~]+$' AND btrim(obj->>'etag')=obj->>'etag'
 AND v->'sha256'=p->'sha256' AND v->'byteCount'=p->'byteCount' AND v->>'contentType'='application/octet-stream'
 AND x->>'recipe'='atlas-ownership-original-photo-v1' AND x->>'decoderVersion'=decoder AND x->'mime'=p->'declaredType'
 AND (x->>'width')::bigint>=2 AND (x->>'height')::bigint>=2 AND (x->>'pixels')::bigint=(x->>'width')::bigint*(x->>'height')::bigint
 AND (x->>'pixels')::bigint<=52000000 AND x->'originalSha256'=p->'sha256' AND x->'originalByteCount'=p->'byteCount',false);
END $$;
CREATE FUNCTION atlas_ownership_proof.bundle_ready(b atlas_ownership_proof.bundle,mode_name text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT atlas_ownership_proof.bundle_valid(b,mode_name,false)
 AND (SELECT count(*) BETWEEN 1 AND 6 AND sum(o.byte_count)<=62914560 FROM atlas_ownership_proof.object o WHERE o.bundle_id=b.id)
 AND NOT EXISTS(SELECT 1 FROM atlas_ownership_proof.object o LEFT JOIN atlas_ownership_proof.retained r ON r.object_id=o.id
 WHERE o.bundle_id=b.id AND (r.object_id IS NULL OR NOT atlas_ownership_proof.observation_valid(r.observation,atlas_ownership_proof.object_plan(o.id))))
$$;
-- Durable integrity manifest. Excludes mutable presentation/consumption state;
-- each constituent row is immutable, including exact retained object identity.
CREATE FUNCTION atlas_ownership_proof.manifest(bid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schema','atlas-ownership-proof-manifest-v2','bundleId',b.id,'accountId',b.customer_id,'card',b.binding,
 'requestId',b.request_id,'requestHash',b.request_hash,'proofKind',b.proof_kind,'policyRevision',b.policy_revision,'uploadPolicyRevision',b.upload_policy_revision,
 'policySnapshot',b.policy_snapshot,'policyHash',b.policy_hash,'expiresAt',b.expires_at,'usableUntil',b.usable_until,'deleteAfter',b.delete_after,'createdAt',b.created_at,
 'objects',(SELECT jsonb_agg(jsonb_build_object('clientFileId',o.client_file_id,'plan',atlas_ownership_proof.object_plan(o.id),'observation',r.observation,'retainedAt',r.observed_at) ORDER BY o.id)
 FROM atlas_ownership_proof.object o JOIN atlas_ownership_proof.retained r ON r.object_id=o.id WHERE o.bundle_id=b.id)) FROM atlas_ownership_proof.bundle b WHERE b.id=bid
$$;
CREATE FUNCTION atlas_ownership_proof.bind_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 NEW.manifest_hash:=CASE WHEN NEW.bundle_id IS NOT NULL THEN atlas_ownership_proof.digest(atlas_ownership_proof.manifest(NEW.bundle_id)) END;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_manifest BEFORE INSERT ON atlas_ownership_proof.consumption FOR EACH ROW EXECUTE FUNCTION atlas_ownership_proof.bind_manifest();
CREATE FUNCTION atlas_ownership_proof.bundle_projection(bid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('bundleId',b.id,'requestId',b.request_id,'card',b.binding,'proofKind',b.proof_kind,'policyRevision',b.policy_revision,'uploadPolicyRevision',b.upload_policy_revision,
 'expiresAt',b.expires_at,'usableUntil',b.usable_until,'deleteAfter',b.delete_after,
 'consumed',EXISTS(SELECT 1 FROM atlas_ownership_proof.consumption c WHERE c.bundle_id=b.id),
 'files',(SELECT jsonb_agg(jsonb_build_object('objectId',o.id,'clientFileId',o.client_file_id,'sha256',o.sha256,'byteCount',o.byte_count,'declaredType',o.declared_type,
 'state',CASE WHEN r.object_id IS NULL THEN 'RESERVED' ELSE 'RETAINED' END) ORDER BY o.id) FROM atlas_ownership_proof.object o LEFT JOIN atlas_ownership_proof.retained r ON r.object_id=o.id WHERE o.bundle_id=b.id))
 FROM atlas_ownership_proof.bundle b WHERE b.id=bid
$$;

-- Separate trusted ingestor capability. Never grant this routine to the browser
-- lifecycle client. A retained observation is a server readback, not proof of title.
CREATE FUNCTION atlas_ownership_proof.object_gateway(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a atlas_customer."CustomerAccount"; fresh atlas_customer."CustomerAccount"; b atlas_ownership_proof.bundle; o atlas_ownership_proof.object;
 p jsonb; old atlas_ownership_proof.retained; names text[]; pol atlas_ownership_proof.policy;
BEGIN
 names:=CASE act WHEN 'read_plan' THEN ARRAY['bundleId','objectId'] WHEN 'retain_object' THEN ARRAY['bundleId','objectId','observation'] END;
 IF names IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>8192 OR NOT d ?& names OR d-names<>'{}'::jsonb
 OR NOT atlas_ownership_proof.uuid(d->'bundleId') OR NOT atlas_ownership_proof.uuid(d->'objectId') THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_PROOF'); END IF;
 IF NOT atlas_ownership_workflow.binding_valid(binding) OR NOT atlas_ownership_proof.live_policy() THEN RETURN atlas_customer.problem(503,'OWNERSHIP_PROOF_DISABLED'); END IF;
 SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-account:'||a.id::text,0));
 SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=(d->>'bundleId')::uuid AND customer_id=a.id;
 SELECT * INTO o FROM atlas_ownership_proof.object WHERE id=(d->>'objectId')::uuid AND bundle_id=b.id;
 IF o.id IS NULL OR NOT atlas_ownership_evidence.lock_card(b.card_id,NULL,binding->>'mode',true) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_PROOF_NOT_FOUND'); END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF NOT atlas_ownership_proof.live_policy() OR NOT atlas_ownership_proof.bundle_valid(b,binding->>'mode',true)
 OR EXISTS(SELECT 1 FROM atlas_ownership_proof.consumption WHERE bundle_id=b.id) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_UNAVAILABLE'); END IF;
 p:=atlas_ownership_proof.object_plan(o.id);
 IF act='read_plan' THEN
  IF NOT EXISTS(SELECT 1 FROM atlas_ownership_proof.upload_lease WHERE object_id=o.id) THEN
   IF EXISTS(SELECT 1 FROM atlas_ownership_proof.upload_lease l WHERE l.customer_id=a.id AND l.expires_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM atlas_ownership_proof.retained r WHERE r.object_id=l.object_id)) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_UPLOAD_BUSY'); END IF;
   INSERT INTO atlas_ownership_proof.upload_lease(object_id,customer_id,expires_at) VALUES(o.id,a.id,b.expires_at);
  END IF;
  RETURN p;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_ownership_proof.upload_lease WHERE object_id=o.id AND customer_id=a.id AND expires_at=b.expires_at AND expires_at>clock_timestamp())
 THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_UPLOAD_LEASE_REQUIRED'); END IF;
 SELECT * INTO pol FROM atlas_ownership_proof.policy WHERE id='active';
 IF NOT atlas_ownership_proof.observation_valid(d->'observation',p) OR NOT pol.validators @> jsonb_build_array(jsonb_build_object(
 'recipe',d#>>'{observation,validation,recipe}','decoderVersion',d#>>'{observation,validation,decoderVersion}','mime',o.declared_type))
 THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_PROOF_OBSERVATION'); END IF;
 SELECT * INTO old FROM atlas_ownership_proof.retained WHERE object_id=o.id;
 IF old.object_id IS NOT NULL THEN
  IF old.observation IS DISTINCT FROM d->'observation' THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_OBJECT_CONFLICT'); END IF;
  RETURN old.observation;
 END IF;
 INSERT INTO atlas_ownership_proof.retained(object_id,observation) VALUES(o.id,d->'observation'); RETURN d->'observation';
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_ownership_proof FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_ownership_proof FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_proof FROM PUBLIC;
