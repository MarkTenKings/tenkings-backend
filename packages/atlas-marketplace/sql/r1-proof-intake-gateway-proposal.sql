-- INERT isolated SYNTHETIC_LOCAL storage candidate. No migration registers it.
-- This does not authenticate a request, actor, decoder, policy or stage fence.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_INTAKE_GATEWAY_NOT_APPROVED'; END $$;
DO $$ BEGIN
 IF current_database()<>'atlas_marketplace_review_candidate'
  OR to_regprocedure('atlas_marketplace.commit_state_internal_v1(bigint,text,jsonb,text,bigint)') IS NULL
  OR to_regclass('atlas_marketplace.proof_retention_binding_v1') IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='atlas_proof_intake_writer')
 THEN RAISE EXCEPTION 'DEDICATED_INTAKE_INSTALLATION_REQUIRED'; END IF;
END $$;
CREATE TABLE atlas_marketplace.proof_intake_binding_v1 (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object')
);
CREATE TABLE atlas_marketplace.proof_intake_operations_v1 (
 operation_id text PRIMARY KEY, operation_hash text NOT NULL, dispatch_key text UNIQUE NOT NULL, document jsonb NOT NULL CHECK(jsonb_typeof(document)='object')
);
ALTER TABLE atlas_marketplace.proof_intake_binding_v1 OWNER TO atlas_marketplace_owner;
ALTER TABLE atlas_marketplace.proof_intake_operations_v1 OWNER TO atlas_marketplace_owner;
REVOKE ALL ON TABLE atlas_marketplace.proof_intake_binding_v1,atlas_marketplace.proof_intake_operations_v1 FROM PUBLIC,atlas_marketplace_writer,atlas_proof_retention_writer;
CREATE TRIGGER proof_intake_binding_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.proof_intake_binding_v1 FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER proof_intake_binding_no_truncate BEFORE TRUNCATE ON atlas_marketplace.proof_intake_binding_v1 FOR EACH STATEMENT EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER proof_intake_operations_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.proof_intake_operations_v1 FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER proof_intake_operations_no_truncate BEFORE TRUNCATE ON atlas_marketplace.proof_intake_operations_v1 FOR EACH STATEMENT EXECUTE FUNCTION atlas_marketplace.reject_change();

CREATE FUNCTION atlas_marketplace.check_intake_configuration_v1(c jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b jsonb:=c->'binding'; p jsonb:=c->'policy'; s jsonb:=c->'storage'; k text; n numeric; installed jsonb;
BEGIN
 PERFORM atlas_marketplace.proof_canonical_v1(c);
 PERFORM atlas_marketplace.proof_exact_object_v1(c,ARRAY['schema','binding','policy','storage','maxOperations']);
 PERFORM atlas_marketplace.proof_exact_object_v1(b,ARRAY['schema','environment','policyHash','storageHash']);
 PERFORM atlas_marketplace.proof_exact_object_v1(p,ARRAY['environment','id','version','approvalRef','retentionRef','reviewerAuthorityRef','effectiveAt','expiresAt','retentionMs','maxObjectBytes','maxProofsPerOrder','maxRetainedObjects','uploadTtlMs','validationLeaseMs']);
 PERFORM atlas_marketplace.proof_exact_object_v1(s,ARRAY['schema','storageId','environment','retentionRef','keyId','maxObjectBytes']);
 SELECT binding INTO STRICT installed FROM atlas_marketplace.proof_retention_binding_v1 WHERE id;
 IF c->>'schema' IS DISTINCT FROM 'atlas-proof-intake-installed-v1' OR b IS DISTINCT FROM installed
  OR b->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-intake-v1' OR b->>'environment' IS DISTINCT FROM 'SYNTHETIC_LOCAL'
  OR p->'environment' IS DISTINCT FROM b->'environment' OR s->'environment' IS DISTINCT FROM b->'environment'
  OR b->>'policyHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(p) OR b->>'storageHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(s)
 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_INSTALLATION'; END IF;
 FOREACH k IN ARRAY ARRAY['id','version','approvalRef','retentionRef','reviewerAuthorityRef'] LOOP
  IF NOT atlas_marketplace.proof_text_v1(p->k) THEN RAISE EXCEPTION 'INTAKE_PROTECTED_INSTALLATION'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['effectiveAt','expiresAt','retentionMs','maxObjectBytes','maxProofsPerOrder','maxRetainedObjects','uploadTtlMs','validationLeaseMs'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'number' OR (p->>k)::numeric<0 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_INSTALLATION'; END IF;
 END LOOP;
 IF (p->>'expiresAt')::bigint<=(p->>'effectiveAt')::bigint OR (p->>'retentionMs')::bigint<1
  OR (p->>'maxObjectBytes')::bigint NOT BETWEEN 1 AND 10485760 OR (p->>'maxProofsPerOrder')::bigint NOT BETWEEN 1 AND 50
  OR (p->>'maxRetainedObjects')::bigint NOT BETWEEN 1 AND 100000 OR (p->>'uploadTtlMs')::bigint NOT BETWEEN 1 AND 900000 OR (p->>'validationLeaseMs')::bigint NOT BETWEEN 15000 AND 120000
  OR s->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-encrypted-v1' OR NOT atlas_marketplace.proof_text_v1(s->'storageId')
  OR s->'retentionRef' IS DISTINCT FROM p->'retentionRef' OR jsonb_typeof(s->'keyId') IS DISTINCT FROM 'string' OR s->>'keyId' !~ '^[A-Za-z0-9_-]{1,100}$'
  OR jsonb_typeof(s->'maxObjectBytes') IS DISTINCT FROM 'number' OR (s->>'maxObjectBytes')::bigint NOT BETWEEN (p->>'maxObjectBytes')::bigint AND 10485760
  OR jsonb_typeof(c->'maxOperations') IS DISTINCT FROM 'number' OR (c->>'maxOperations')::bigint NOT BETWEEN 2 AND 4096
 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_INSTALLATION'; END IF;
END $$;

-- Exact new-row projection. No existing legacy row is adopted or recovered.
CREATE FUNCTION atlas_marketplace.project_intake_operation_v1(old_document jsonb, o jsonb, c jsonb, original_create jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb:=c->'policy'; b jsonb:=c->'binding'; s jsonb:=c->'storage'; a jsonb; r jsonb; v jsonb; u jsonb; prior jsonb; ob jsonb; ord jsonb; payment jsonb; f jsonb; event jsonb; next_document jsonb;
 uploads jsonb:=coalesce(old_document->'marketplaceProofUploads','{}'::jsonb); k text; upload_id text; proof_id text; at_ms bigint; expires bigint; retain_until bigint;
 uuid_pattern constant text:='^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
BEGIN
 PERFORM atlas_marketplace.check_intake_configuration_v1(c);PERFORM atlas_marketplace.proof_canonical_v1(o);
 IF o->>'kind'='CREATE' THEN
  PERFORM atlas_marketplace.proof_exact_object_v1(o,ARRAY['schema','operationId','kind','atMs','bindingHash','actor','request']);
 ELSE
  PERFORM atlas_marketplace.proof_exact_object_v1(o,ARRAY['schema','operationId','kind','atMs','bindingHash','createOperationId','createOperationHash','expectedUploadHash','validationAttemptId','decoderRequestId','validation']);
  IF o->>'kind' IS DISTINCT FROM 'VALIDATE' THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
 END IF;
 IF o->>'schema' IS DISTINCT FROM 'atlas-proof-intake-operation-v1' OR jsonb_typeof(o->'operationId') IS DISTINCT FROM 'string' OR o->>'operationId' !~ uuid_pattern
  OR o->>'bindingHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(b) OR jsonb_typeof(o->'atMs') IS DISTINCT FROM 'number'
  OR jsonb_typeof(uploads) IS DISTINCT FROM 'object' OR jsonb_typeof(old_document->'events') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
 at_ms:=(o->>'atMs')::bigint;
 IF at_ms<(p->>'effectiveAt')::bigint OR at_ms>=(p->>'expiresAt')::bigint THEN RAISE EXCEPTION 'INTAKE_PROTECTED_EXPIRED'; END IF;
 IF o->>'kind'='CREATE' THEN
  a:=o->'actor';r:=o->'request';PERFORM atlas_marketplace.proof_exact_object_v1(a,ARRAY['id','role']);
  PERFORM atlas_marketplace.proof_exact_object_v1(r,ARRAY['requestId','orderId','purpose','declaredType','byteCount','sha256']);
  FOREACH k IN ARRAY ARRAY['requestId','orderId'] LOOP
   IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR r->>k !~ '^demo_[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
  END LOOP;
  IF jsonb_typeof(a->'id') IS DISTINCT FROM 'string' OR a->>'id' !~ '^demo_[a-zA-Z0-9_-]{1,100}$' OR jsonb_typeof(a->'role') IS DISTINCT FROM 'string' OR a->>'role' NOT IN ('BUYER','STAFF')
   OR jsonb_typeof(r->'purpose') IS DISTINCT FROM 'string' OR r->>'purpose' NOT IN ('RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW')
   OR jsonb_typeof(r->'declaredType') IS DISTINCT FROM 'string' OR r->>'declaredType' NOT IN ('image/png','image/jpeg')
   OR jsonb_typeof(r->'sha256') IS DISTINCT FROM 'string' OR r->>'sha256' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(r->'byteCount') IS DISTINCT FROM 'number' OR (r->>'byteCount')::bigint NOT BETWEEN 1 AND (p->>'maxObjectBytes')::bigint
  THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
  upload_id:='demo_upload_'||left(atlas_marketplace.proof_hash_v1(jsonb_build_object('actorId',a->'id','role',a->'role','requestId',r->'requestId')),32);
  proof_id:='demo_proof_'||left(atlas_marketplace.proof_hash_v1(to_jsonb(upload_id)),32);
  IF uploads ? upload_id THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
  IF (SELECT count(*) FROM jsonb_each(uploads))>=(p->>'maxRetainedObjects')::integer OR (SELECT count(*) FROM jsonb_each(uploads) WHERE value->'orderId'=r->'orderId')>=(p->>'maxProofsPerOrder')::integer THEN RAISE EXCEPTION 'INTAKE_PROTECTED_QUOTA'; END IF;
 ELSE
  FOREACH k IN ARRAY ARRAY['createOperationId','validationAttemptId','decoderRequestId'] LOOP
   IF jsonb_typeof(o->k) IS DISTINCT FROM 'string' OR o->>k !~ uuid_pattern THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
  END LOOP;
  IF jsonb_typeof(o->'createOperationHash') IS DISTINCT FROM 'string' OR o->>'createOperationHash' !~ '^[a-f0-9]{64}$' OR original_create->'operationHash' IS DISTINCT FROM o->'createOperationHash'
   OR jsonb_typeof(o->'expectedUploadHash') IS DISTINCT FROM 'string' OR o->>'expectedUploadHash' !~ '^[a-f0-9]{64}$'
   OR original_create->>'schema' IS DISTINCT FROM 'atlas-proof-intake-record-v1' OR original_create->'operation'->>'kind' IS DISTINCT FROM 'CREATE'
   OR original_create->'operation'->'operationId' IS DISTINCT FROM o->'createOperationId' OR original_create->>'operationHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(original_create->'operation')
   OR original_create->>'uploadHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(original_create->'upload')
  THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
  prior:=original_create->'upload';upload_id:=prior->>'uploadId';proof_id:=prior->>'proofId';
  IF uploads->upload_id IS DISTINCT FROM prior OR prior->>'status' IS DISTINCT FROM 'PREPARED' OR prior->'attempts' IS DISTINCT FROM '0'::jsonb
   OR atlas_marketplace.proof_hash_v1(prior)<>o->>'expectedUploadHash' OR at_ms<(prior->>'createdAt')::bigint OR at_ms>=(prior->>'expiresAt')::bigint
  THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
  a:=jsonb_build_object('id',prior->'actorId','role',prior->'actorRole');r:=jsonb_build_object('orderId',prior->'orderId','purpose',prior->'purpose');v:=o->'validation';
  PERFORM atlas_marketplace.proof_exact_object_v1(v,ARRAY['schema','decoder','contentType','byteCount','sha256','width','height']);
  IF v->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-image-v1' OR v->>'decoder' IS DISTINCT FROM 'sharp-0.33.5/libvips-8.15.3'
   OR v->'contentType' IS DISTINCT FROM prior->'plan'->'declaredType' OR v->'byteCount' IS DISTINCT FROM prior->'plan'->'byteCount' OR v->'sha256' IS DISTINCT FROM prior->'plan'->'sha256'
  THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
  FOREACH k IN ARRAY ARRAY['width','height'] LOOP
   IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::bigint NOT BETWEEN 1 AND 16000000 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
  END LOOP;
  IF (v->>'width')::bigint*(v->>'height')::bigint>16000000 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
 END IF;
 ord:=old_document->'orders'->(r->>'orderId');payment:=old_document->'intents'->(ord->>'paymentIntentId');
 ob:=jsonb_build_object('orderId',ord->'orderId','cardId',ord->'cardId','buyerId',ord->'buyerId','sellerId',ord->'sellerId','bindingHash',ord->'bindingHash','policyVersion',ord->'policyVersion');
 FOREACH k IN ARRAY ARRAY['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion'] LOOP
  IF NOT atlas_marketplace.proof_text_v1(ob->k) THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORDER_HOLD'; END IF;
 END LOOP;
 IF ob->'orderId' IS DISTINCT FROM r->'orderId' OR payment->>'kind' IS DISTINCT FROM 'PAYMENT' OR payment->>'status' IS DISTINCT FROM 'SUCCEEDED' OR payment->'confirmed' IS DISTINCT FROM 'true'::jsonb OR payment->'orderId' IS DISTINCT FROM r->'orderId' OR payment->'bindingHash' IS DISTINCT FROM ob->'bindingHash'
  OR (CASE WHEN a->>'role'='BUYER' THEN ob->'buyerId' IS DISTINCT FROM a->'id' OR r->>'purpose'<>'RETURN_REQUEST' ELSE r->>'purpose'='RETURN_REQUEST' END)
 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORDER_HOLD'; END IF;
 IF a->>'role'='BUYER' THEN
  f:=old_document->'fulfillment'->(r->>'orderId');
  IF jsonb_typeof(f->'deliveredAt') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'releaseNotBefore') IS DISTINCT FROM 'number'
   OR (f->>'deliveredAt')::numeric<>trunc((f->>'deliveredAt')::numeric) OR (f->>'deliveredAt')::numeric<0
   OR (f->>'releaseNotBefore')::numeric<>(f->>'deliveredAt')::numeric+86400000 OR at_ms<(f->>'deliveredAt')::numeric OR at_ms>=(f->>'releaseNotBefore')::numeric
  THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORDER_HOLD'; END IF;
 END IF;
 IF o->>'kind'='CREATE' THEN
  expires:=least(at_ms+(p->>'uploadTtlMs')::bigint,(p->>'expiresAt')::bigint);retain_until:=at_ms+(p->>'retentionMs')::bigint;
  IF expires<=at_ms OR retain_until<=at_ms OR retain_until>9007199254740991 THEN RAISE EXCEPTION 'INTAKE_PROTECTED_EXPIRED'; END IF;
  u:=jsonb_build_object('uploadId',upload_id,'proofId',proof_id,'objectKey',atlas_marketplace.proof_hash_v1(jsonb_build_object('binding',b,'uploadId',upload_id)),'requestHash',atlas_marketplace.proof_hash_v1(r),'actorId',a->'id','actorRole',a->'role','orderId',r->'orderId','orderBinding',ob,'orderHash',atlas_marketplace.proof_hash_v1(ob),'purpose',r->'purpose','plan',jsonb_build_object('declaredType',r->'declaredType','byteCount',r->'byteCount','sha256',r->'sha256'),'status','PREPARED','createdAt',at_ms,'expiresAt',expires,'retainUntil',retain_until,'attempts',0,'policyHash',b->'policyHash');
  event:=jsonb_build_object('type','MARKETPLACE_PROOF_PREPARED','payload',jsonb_build_object('uploadId',upload_id,'orderId',r->'orderId','purpose',r->'purpose','actorId',a->'id'));
 ELSE
  IF ob IS DISTINCT FROM prior->'orderBinding' THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORDER_HOLD'; END IF;
  u:=prior||jsonb_build_object('status','VALIDATED','manifest',jsonb_build_object('schema','atlas-marketplace-retained-proof-v1','proofId',proof_id,'uploadId',upload_id,'environment',b->'environment','storageId',s->'storageId','retentionRef',p->'retentionRef','retainUntil',prior->'retainUntil','createdAt',prior->'createdAt','validatedAt',at_ms,'policyHash',prior->'policyHash','orderBinding',ob,'actorId',a->'id','actorRole',a->'role','purpose',r->'purpose','byteCount',v->'byteCount','sha256',v->'sha256','validation',v));
  event:=jsonb_build_object('type','MARKETPLACE_PROOF_VALIDATED','payload',jsonb_build_object('uploadId',upload_id,'operationId',o->'operationId','validationAttemptId',o->'validationAttemptId','decoderRequestId',o->'decoderRequestId'));
 END IF;
 IF old_document->'marketplaceProofObjects' ? proof_id OR old_document->'marketplaceProofReviews' ? proof_id THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
 next_document:=old_document||jsonb_build_object('marketplaceProofUploads',uploads||jsonb_build_object(upload_id,u),'events',(old_document->'events')||jsonb_build_array(event||jsonb_build_object('sequence',jsonb_array_length(old_document->'events')+1,'at',at_ms,'environment',b->'environment')));
 RETURN jsonb_build_object('document',next_document,'upload',u,'dispatchKey',atlas_marketplace.proof_hash_v1(jsonb_build_object('kind',o->'kind','uploadId',upload_id)));
END $$;

CREATE FUNCTION atlas_marketplace.read_intake_configuration_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;
BEGIN
 SELECT configuration INTO STRICT c FROM atlas_marketplace.proof_intake_binding_v1 WHERE id;
 PERFORM atlas_marketplace.check_intake_configuration_v1(c);RETURN c;
END $$;
CREATE FUNCTION atlas_marketplace.read_intake_state_v1() RETURNS SETOF atlas_marketplace.state LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM atlas_marketplace.state WHERE id $$;
CREATE FUNCTION atlas_marketplace.lookup_intake_operation_v1(operation_id uuid, operation_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_marketplace.proof_intake_operations_v1%ROWTYPE;
BEGIN
 IF operation_id IS NULL OR operation_hash IS NULL OR operation_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INTAKE_PROTECTED_OPERATION'; END IF;
 SELECT t.* INTO r FROM atlas_marketplace.proof_intake_operations_v1 t WHERE t.operation_id=lookup_intake_operation_v1.operation_id::text;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.operation_hash<>operation_hash THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
 RETURN r.document;
END $$;
-- Exact durable counts only. Each outstanding new CREATE reserves one future
-- VALIDATE entry. No status/expiry/legacy-row inference releases that capacity.
CREATE FUNCTION atlas_marketplace.read_intake_capacity_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; operations bigint; creates bigint; validations bigint;
BEGIN
 SELECT configuration INTO STRICT c FROM atlas_marketplace.proof_intake_binding_v1 WHERE id;
 PERFORM atlas_marketplace.check_intake_configuration_v1(c);
 SELECT count(*),count(*) FILTER(WHERE document->'operation'->>'kind'='CREATE'),count(*) FILTER(WHERE document->'operation'->>'kind'='VALIDATE') INTO operations,creates,validations FROM atlas_marketplace.proof_intake_operations_v1;
 IF operations<>creates+validations OR validations>creates OR operations+creates-validations>(c->>'maxOperations')::bigint THEN RAISE EXCEPTION 'INTAKE_PROTECTED_CAPACITY_HOLD'; END IF;
 RETURN jsonb_build_object('schema','atlas-proof-intake-capacity-v1','operations',operations,'creates',creates,'validations',validations,'reservedValidations',creates-validations);
END $$;
CREATE FUNCTION atlas_marketplace.commit_intake_operation_v1(expected_revision bigint, expected_hash text, operation jsonb, next_document jsonb, next_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old atlas_marketplace.state%ROWTYPE; c jsonb; original_create jsonb; projected jsonb; r jsonb; operation_hash text; at_ms bigint; actual_now bigint; capacity jsonb;
BEGIN
 SELECT * INTO STRICT old FROM atlas_marketplace.state WHERE id FOR UPDATE;
 SELECT configuration INTO STRICT c FROM atlas_marketplace.proof_intake_binding_v1 WHERE id;
 PERFORM atlas_marketplace.check_intake_configuration_v1(c);PERFORM atlas_marketplace.proof_canonical_v1(operation);
 operation_hash:=atlas_marketplace.proof_hash_v1(operation);
 SELECT t.document INTO r FROM atlas_marketplace.proof_intake_operations_v1 t WHERE t.operation_id=operation->>'operationId';
 IF FOUND THEN
  IF r->'operation' IS DISTINCT FROM operation OR r->>'operationHash' IS DISTINCT FROM operation_hash THEN RAISE EXCEPTION 'INTAKE_PROTECTED_ORIGINAL_HOLD'; END IF;
  RETURN r;
 END IF;
 IF old.environment IS DISTINCT FROM 'SYNTHETIC_LOCAL' OR old.revision IS DISTINCT FROM expected_revision OR old.state_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'STALE_MARKETPLACE_STATE' USING ERRCODE='40001'; END IF;
 capacity:=atlas_marketplace.read_intake_capacity_v1();
 IF (CASE WHEN operation->>'kind'='CREATE' THEN (capacity->>'operations')::bigint+(capacity->>'reservedValidations')::bigint+2>(c->>'maxOperations')::bigint ELSE (capacity->>'reservedValidations')::bigint<1 OR (capacity->>'operations')::bigint>=(c->>'maxOperations')::bigint END) THEN RAISE EXCEPTION 'INTAKE_PROTECTED_CAPACITY'; END IF;
 IF operation->>'kind'='VALIDATE' THEN SELECT t.document INTO STRICT original_create FROM atlas_marketplace.proof_intake_operations_v1 t WHERE t.operation_id=operation->>'createOperationId'; END IF;
 projected:=atlas_marketplace.project_intake_operation_v1(old.document,operation,c,original_create);
 at_ms:=(operation->>'atMs')::bigint;actual_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF at_ms<actual_now-15000 OR at_ms>actual_now+1000 OR actual_now>=(c->'policy'->>'expiresAt')::bigint OR actual_now>=(projected->'upload'->>'expiresAt')::bigint THEN RAISE EXCEPTION 'INTAKE_PROTECTED_EXPIRED'; END IF;
 IF next_document IS DISTINCT FROM projected->'document' THEN RAISE EXCEPTION 'INTAKE_PROTECTED_UNRELATED_CHANGE'; END IF;
 PERFORM atlas_marketplace.commit_state_internal_v1(expected_revision,expected_hash,next_document,next_hash,at_ms);
 r:=jsonb_build_object('schema','atlas-proof-intake-record-v1','operation',operation,'operationHash',operation_hash,'dispatchKey',projected->'dispatchKey','upload',projected->'upload','uploadHash',atlas_marketplace.proof_hash_v1(projected->'upload'),'revision',old.revision+1);
 INSERT INTO atlas_marketplace.proof_intake_operations_v1 VALUES(operation->>'operationId',operation_hash,projected->>'dispatchKey',r);
 RETURN r;
END $$;
CREATE ROLE atlas_proof_intake_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE atlas_marketplace_review_candidate TO atlas_proof_intake_writer;
GRANT USAGE ON SCHEMA atlas_marketplace TO atlas_proof_intake_writer;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_marketplace' AND p.proname IN ('check_intake_configuration_v1','project_intake_operation_v1','read_intake_configuration_v1','read_intake_state_v1','lookup_intake_operation_v1','read_intake_capacity_v1','commit_intake_operation_v1') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO atlas_marketplace_owner',f.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,atlas_marketplace_writer,atlas_proof_retention_writer,atlas_proof_intake_writer',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION atlas_marketplace.read_intake_configuration_v1(),atlas_marketplace.read_intake_state_v1(),atlas_marketplace.read_intake_capacity_v1(),atlas_marketplace.lookup_intake_operation_v1(uuid,text),atlas_marketplace.commit_intake_operation_v1(bigint,text,jsonb,jsonb,text) TO atlas_proof_intake_writer;
-- Explicit readonly composition surface; retention gets no intake writes/lookups.
GRANT EXECUTE ON FUNCTION atlas_marketplace.read_intake_configuration_v1() TO atlas_proof_retention_writer;
-- No common-CAS, helper, table, owner membership or role escalation grant.
COMMIT;
