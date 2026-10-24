-- INERT R2 REVIEW CANDIDATE. No runtime or migration manifest loads this file.
-- Install only through a separately reviewed exact-source/ACL composition.
-- This closes the ordinary whole-document writer's proof-map bypass. It does
-- not authenticate a canonical request, publication, qualification or fence.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_RETENTION_GATEWAY_NOT_APPROVED'; END $$;

DO $$ BEGIN
  IF current_database()<>'atlas_marketplace_review_candidate'
    OR to_regprocedure('atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint)') IS NULL
    OR to_regprocedure('atlas_marketplace.commit_state_internal_v1(bigint,text,jsonb,text,bigint)') IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='atlas_marketplace_owner' AND NOT rolcanlogin AND NOT rolsuper)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='atlas_marketplace_writer' AND NOT rolsuper)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='atlas_proof_retention_writer')
  THEN RAISE EXCEPTION 'DEDICATED_RETENTION_INSTALLATION_REQUIRED'; END IF;
END $$;

-- Separately provisioned exact intake tuple. Empty by default; no role exposed
-- below can install or change it. Its existence is an installation binding,
-- never proof of genuine request/decoder/publication authority.
CREATE TABLE atlas_marketplace.proof_retention_binding_v1 (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
  max_operations integer NOT NULL CHECK(max_operations BETWEEN 1 AND 4096)
);
ALTER TABLE atlas_marketplace.proof_retention_binding_v1 OWNER TO atlas_marketplace_owner;
REVOKE ALL ON TABLE atlas_marketplace.proof_retention_binding_v1 FROM PUBLIC,atlas_marketplace_writer;
CREATE TRIGGER proof_retention_binding_immutable BEFORE UPDATE OR DELETE ON atlas_marketplace.proof_retention_binding_v1
  FOR EACH ROW EXECUTE FUNCTION atlas_marketplace.reject_change();
CREATE TRIGGER proof_retention_binding_no_truncate BEFORE TRUNCATE ON atlas_marketplace.proof_retention_binding_v1
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_marketplace.reject_change();

-- Preserve the exact existing CAS/journal/event implementation. Its body and
-- dependency closure must be pinned by the installer BEFORE this rename.
ALTER FUNCTION atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) RENAME TO commit_state_internal_v1;
REVOKE ALL ON FUNCTION atlas_marketplace.commit_state_internal_v1(bigint,text,jsonb,text,bigint) FROM PUBLIC,atlas_marketplace_writer;

CREATE FUNCTION atlas_marketplace.proof_exact_object_v1(v jsonb, keys text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),'{}'::text[]) FROM jsonb_object_keys(v) k)
       IS DISTINCT FROM (SELECT array_agg(k ORDER BY k COLLATE "C") FROM unnest(keys) k)
  THEN RAISE EXCEPTION 'PROOF_RETENTION_SHAPE_REFUSED'; END IF;
END $$;

-- Canonical encoding for the bounded proof tuples, not arbitrary documents.
-- Their numbers are safe integers and their field names are ASCII. JSON string
-- encoding is PostgreSQL UTF8 JSON; no key-order, whitespace or decimal-text
-- equivalence is trusted. The fixture compares these bytes with canonicalJSON.
CREATE FUNCTION atlas_marketplace.proof_canonical_v1(v jsonb, depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE kind text; result text; number numeric;
BEGIN
  IF v IS NULL OR depth<0 OR depth>16 OR octet_length(v::text)>65536 THEN RAISE EXCEPTION 'PROOF_RETENTION_ENCODING_REFUSED'; END IF;
  kind:=jsonb_typeof(v);
  IF kind='object' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k !~ '^[A-Za-z0-9_]+$') THEN RAISE EXCEPTION 'PROOF_RETENTION_ENCODING_REFUSED'; END IF;
    SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||atlas_marketplace.proof_canonical_v1(value,depth+1),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
  ELSIF kind='array' THEN
    SELECT '['||coalesce(string_agg(atlas_marketplace.proof_canonical_v1(value,depth+1),',' ORDER BY n),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,n);
  ELSIF kind='number' THEN
    number:=(v#>>'{}')::numeric;
    IF trunc(number)<>number OR abs(number)>9007199254740991 THEN RAISE EXCEPTION 'PROOF_RETENTION_ENCODING_REFUSED'; END IF;
    result:=number::bigint::text;
  ELSIF kind IN ('string','boolean','null') THEN result:=v::text;
  ELSE RAISE EXCEPTION 'PROOF_RETENTION_ENCODING_REFUSED'; END IF;
  IF octet_length(result)>32768 THEN RAISE EXCEPTION 'PROOF_RETENTION_ENCODING_REFUSED'; END IF;
  RETURN result;
END $$;
CREATE FUNCTION atlas_marketplace.proof_hash_v1(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to(atlas_marketplace.proof_canonical_v1(v),'UTF8')),'hex')
$$;

-- Match C1's nonempty <=500 UTF-16-unit string and ECMAScript trim rules.
-- PostgreSQL UTF8 strings count supplementary characters as one code point;
-- JavaScript counts them as two units. No locale whitespace class is used.
CREATE FUNCTION atlas_marketplace.proof_text_v1(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s text; units integer;
  trim_chars constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s:=v#>>'{}';
  IF length(s) NOT BETWEEN 1 AND 500 OR btrim(s,trim_chars)<>s THEN RETURN false; END IF;
  SELECT sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END) INTO units FROM regexp_split_to_table(s,'') ch;
  RETURN units BETWEEN 1 AND 500;
END $$;

-- Revalidate every original C1 record and both exact indexes before admitting
-- any additional operation. Equal map counts alone cannot protect tombstones.
CREATE FUNCTION atlas_marketplace.check_retention_history_v1(operations jsonb, uploads jsonb, publications jsonb, binding jsonb, max_ops integer)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE item record; r jsonb; o jsonb; key text; number numeric; pub_key text;
  environment text:=binding->>'environment';
  uuid_pattern constant text:='^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
BEGIN
  IF jsonb_typeof(operations) IS DISTINCT FROM 'object' OR jsonb_typeof(uploads) IS DISTINCT FROM 'object' OR jsonb_typeof(publications) IS DISTINCT FROM 'object'
    OR max_ops IS NULL OR max_ops NOT BETWEEN 1 AND 4096
    OR (SELECT count(*) FROM jsonb_object_keys(operations))>max_ops
    OR (SELECT count(*) FROM jsonb_object_keys(operations))<>(SELECT count(*) FROM jsonb_object_keys(uploads))
    OR (SELECT count(*) FROM jsonb_object_keys(operations))<>(SELECT count(*) FROM jsonb_object_keys(publications))
  THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
  FOR item IN SELECT * FROM jsonb_each(operations) LOOP
    r:=item.value; PERFORM atlas_marketplace.proof_canonical_v1(r);
    PERFORM atlas_marketplace.proof_exact_object_v1(r,ARRAY['schema','operation','operationHash','phase','recordedAt','result','retainedUploadHash','proofObjectHash','barrier']);
    o:=r->'operation';
    PERFORM atlas_marketplace.proof_exact_object_v1(o,ARRAY['schema','operationId','uploadId','proofId','orderId','orderHash','actorId','actorRole','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','originalByteCount','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','retentionFenceRevision','expectedUploadHash']);
    IF o->>'schema' IS DISTINCT FROM 'atlas-proof-retention-operation-v1' OR o->>'operationId' IS DISTINCT FROM item.key
      OR r->>'schema' IS DISTINCT FROM 'atlas-proof-retention-record-v1' OR r->>'operationHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(o)
      OR o->>'intakeBindingHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(binding) OR o->'policyHash' IS DISTINCT FROM binding->'policyHash'
      OR o->>'objectKey' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(jsonb_build_object('binding',binding,'uploadId',o->'uploadId'))
      OR jsonb_typeof(r->'recordedAt') IS DISTINCT FROM 'number' OR (r->>'recordedAt')::numeric NOT BETWEEN 0 AND 9007199254740991 OR (r->>'recordedAt')::numeric<>trunc((r->>'recordedAt')::numeric)
    THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    FOREACH key IN ARRAY ARRAY['orderHash','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','publicationEvidenceHash','expectedUploadHash'] LOOP
      IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR o->>key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['operationId','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','qualificationSessionId'] LOOP
      IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR o->>key !~ uuid_pattern THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['uploadId','proofId','orderId','actorId'] LOOP
      IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR
        (CASE WHEN environment='SYNTHETIC_LOCAL' THEN o->>key !~ '^demo_[a-zA-Z0-9_-]{1,100}$'
          WHEN key='actorId' THEN o->>key !~ uuid_pattern
          ELSE o->>key !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR left(o->>key,5)='demo_' OR o->>key IN ('constructor','prototype') END)
      THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['publicationRevision','retentionFenceRevision','originalByteCount'] LOOP
      IF jsonb_typeof(o->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
      number:=(o->>key)::numeric;
      IF number<1 OR number<>trunc(number) OR number>(CASE WHEN key='originalByteCount' THEN 10485760 ELSE 9007199254740991 END) THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    END LOOP;
    pub_key:=atlas_marketplace.proof_hash_v1(jsonb_build_object('ledgerId',o->'publicationLedgerId','sessionId',o->'publicationSessionId','operationId',o->'publicationOperationId'));
    IF jsonb_typeof(o->'actorRole') IS DISTINCT FROM 'string' OR o->>'actorRole' NOT IN ('BUYER','STAFF')
      OR uploads->(o->>'uploadId') IS DISTINCT FROM to_jsonb(item.key) OR publications->pub_key IS DISTINCT FROM to_jsonb(item.key)
    THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    IF r->>'phase'='COMMITTED' THEN
      IF r->'barrier' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(r->'retainedUploadHash') IS DISTINCT FROM 'string' OR r->>'retainedUploadHash' !~ '^[a-f0-9]{64}$'
        OR jsonb_typeof(r->'proofObjectHash') IS DISTINCT FROM 'string' OR r->>'proofObjectHash' !~ '^[a-f0-9]{64}$'
      THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
      PERFORM atlas_marketplace.proof_exact_object_v1(r->'result',ARRAY['uploadId','proofId','orderId','purpose','status','declaredType','byteCount','sha256','expiresAt','createdAt','reviewStatus']);
      IF r->'result'->>'reviewStatus' IS DISTINCT FROM 'NOT_REVIEWED' THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    ELSE
      IF r->>'phase' IS DISTINCT FROM 'CANCELLED_BEFORE_COMMIT' OR r->'result' IS DISTINCT FROM 'null'::jsonb OR r->'retainedUploadHash' IS DISTINCT FROM 'null'::jsonb OR r->'proofObjectHash' IS DISTINCT FROM 'null'::jsonb
      THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
      PERFORM atlas_marketplace.proof_exact_object_v1(r->'barrier',ARRAY['barrierId','barrierRevision']);
      IF jsonb_typeof(r->'barrier'->'barrierId') IS DISTINCT FROM 'string' OR r->'barrier'->>'barrierId' !~ uuid_pattern
        OR jsonb_typeof(r->'barrier'->'barrierRevision') IS DISTINCT FROM 'number' OR (r->'barrier'->>'barrierRevision')::numeric<>trunc((r->'barrier'->>'barrierRevision')::numeric)
        OR (r->'barrier'->>'barrierRevision')::numeric>(9007199254740991)::numeric OR (r->'barrier'->>'barrierRevision')::numeric<=(o->>'retentionFenceRevision')::numeric
      THEN RAISE EXCEPTION 'PROOF_RETENTION_HISTORY_REFUSED'; END IF;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION atlas_marketplace.commit_state(expected_revision bigint, expected_hash text, next_document jsonb, next_hash text, at_ms bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old atlas_marketplace.state%ROWTYPE; key text;
BEGIN
  SELECT * INTO STRICT old FROM atlas_marketplace.state WHERE id FOR UPDATE;
  -- No flag/GUC/role membership/owner field in a document can bypass this gate.
  -- Legacy retained originals and reviews remain readable. The separately
  -- authorized review map is unchanged; new intake needs its concrete gateway.
  FOREACH key IN ARRAY ARRAY['marketplaceProofUploads','marketplaceProofObjects','marketplaceProofRetentionJournal','marketplaceProofRetentionOperations','marketplaceProofRetentionUploadIndex','marketplaceProofRetentionPublicationIndex'] LOOP
    IF old.document->key IS DISTINCT FROM next_document->key THEN RAISE EXCEPTION 'PROOF_RETENTION_GATEWAY_REQUIRED'; END IF;
  END LOOP;
  RETURN atlas_marketplace.commit_state_internal_v1(expected_revision,expected_hash,next_document,next_hash,at_ms);
END $$;

-- Exact C1 transition, with one new immutable operation and one event. This
-- never creates/validates an upload, changes another order, backfills legacy
-- provenance, rewrites a prior tombstone, or accepts an arbitrary state patch.
CREATE FUNCTION atlas_marketplace.check_retention_transition_v1(old_document jsonb, next_document jsonb, operation_id uuid, operation_hash text, at_ms bigint, environment text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o jsonb; r jsonb; u jsonb; m jsonb; order_row jsonb; payment jsonb; installed atlas_marketplace.proof_retention_binding_v1%ROWTYPE;
  old_ops jsonb; old_upload_index jsonb; old_publication_index jsonb; meta jsonb;
  expected jsonb; expected_upload jsonb; expected_object jsonb; expected_result jsonb; expected_event jsonb;
  pub_key text; id text; key text; number numeric; max_ops integer; cancelling boolean; event_count integer;
  uuid_pattern constant text:='^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
BEGIN
  IF jsonb_typeof(old_document) IS DISTINCT FROM 'object' OR jsonb_typeof(next_document) IS DISTINCT FROM 'object'
    OR operation_id IS NULL OR operation_hash IS NULL OR operation_hash !~ '^[a-f0-9]{64}$'
    OR at_ms IS NULL OR at_ms<0 OR at_ms>9007199254740991
    OR environment IS NULL OR environment NOT IN ('SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION')
  THEN RAISE EXCEPTION 'PROOF_RETENTION_TRANSITION_REFUSED'; END IF;
  id:=operation_id::text; r:=next_document->'marketplaceProofRetentionOperations'->id;
  PERFORM atlas_marketplace.proof_exact_object_v1(r,ARRAY['schema','operation','operationHash','phase','recordedAt','result','retainedUploadHash','proofObjectHash','barrier']);
  o:=r->'operation';
  PERFORM atlas_marketplace.proof_exact_object_v1(o,ARRAY['schema','operationId','uploadId','proofId','orderId','orderHash','actorId','actorRole','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','originalByteCount','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','retentionFenceRevision','expectedUploadHash']);
  IF o->>'schema' IS DISTINCT FROM 'atlas-proof-retention-operation-v1' OR o->>'operationId' IS DISTINCT FROM id
    OR atlas_marketplace.proof_hash_v1(o)<>operation_hash OR r->>'operationHash' IS DISTINCT FROM operation_hash
    OR r->>'schema' IS DISTINCT FROM 'atlas-proof-retention-record-v1' OR r->'recordedAt' IS DISTINCT FROM to_jsonb(at_ms)
    OR jsonb_typeof(r->'phase') IS DISTINCT FROM 'string' OR r->>'phase' NOT IN ('COMMITTED','CANCELLED_BEFORE_COMMIT')
  THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['orderHash','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','publicationEvidenceHash','expectedUploadHash'] LOOP
    IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR o->>key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['operationId','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','qualificationSessionId'] LOOP
    IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR o->>key !~ uuid_pattern THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['uploadId','proofId','orderId','actorId'] LOOP
    IF jsonb_typeof(o->key) IS DISTINCT FROM 'string' OR
      (CASE WHEN environment='SYNTHETIC_LOCAL' THEN o->>key !~ '^demo_[a-zA-Z0-9_-]{1,100}$'
        WHEN key='actorId' THEN o->>key !~ uuid_pattern
        ELSE o->>key !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR left(o->>key,5)='demo_' OR o->>key IN ('constructor','prototype') END)
    THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['publicationRevision','retentionFenceRevision','originalByteCount'] LOOP
    IF jsonb_typeof(o->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
    number:=(o->>key)::numeric;
    IF number<1 OR number<>trunc(number) OR number>(CASE WHEN key='originalByteCount' THEN 10485760 ELSE 9007199254740991 END) THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  END LOOP;
  IF jsonb_typeof(o->'actorRole') IS DISTINCT FROM 'string' OR o->>'actorRole' NOT IN ('BUYER','STAFF') THEN RAISE EXCEPTION 'PROOF_RETENTION_IDENTITY_REFUSED'; END IF;
  SELECT b.* INTO STRICT installed FROM atlas_marketplace.proof_retention_binding_v1 b WHERE b.id;
  PERFORM atlas_marketplace.proof_exact_object_v1(installed.binding,ARRAY['schema','environment','policyHash','storageHash']);
  IF installed.binding->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-intake-v1' OR installed.binding->>'environment' IS DISTINCT FROM environment
    OR installed.binding->'policyHash' IS DISTINCT FROM o->'policyHash' OR installed.binding->>'storageHash' IS NULL OR installed.binding->>'storageHash' !~ '^[a-f0-9]{64}$'
    OR atlas_marketplace.proof_hash_v1(installed.binding)<>o->>'intakeBindingHash'
    OR atlas_marketplace.proof_hash_v1(jsonb_build_object('binding',installed.binding,'uploadId',o->'uploadId'))<>o->>'objectKey'
  THEN RAISE EXCEPTION 'PROOF_RETENTION_INSTALLATION_BINDING_REFUSED'; END IF;
  cancelling:=r->>'phase'='CANCELLED_BEFORE_COMMIT';
  old_ops:=coalesce(old_document->'marketplaceProofRetentionOperations','{}'::jsonb);
  old_upload_index:=coalesce(old_document->'marketplaceProofRetentionUploadIndex','{}'::jsonb);
  old_publication_index:=coalesce(old_document->'marketplaceProofRetentionPublicationIndex','{}'::jsonb);
  meta:=next_document->'marketplaceProofRetentionJournal';
  PERFORM atlas_marketplace.proof_exact_object_v1(meta,ARRAY['schema','bindingHash','maxOperations']);
  IF meta->>'schema' IS DISTINCT FROM 'atlas-proof-retention-journal-v1' OR meta->>'bindingHash' IS DISTINCT FROM o->>'intakeBindingHash'
    OR jsonb_typeof(meta->'maxOperations') IS DISTINCT FROM 'number' OR (meta->>'maxOperations')::numeric<>trunc((meta->>'maxOperations')::numeric)
    OR (meta->>'maxOperations')::numeric NOT BETWEEN 1 AND 4096 THEN RAISE EXCEPTION 'PROOF_RETENTION_METADATA_REFUSED'; END IF;
  max_ops:=(meta->>'maxOperations')::integer;
  IF max_ops<>installed.max_operations THEN RAISE EXCEPTION 'PROOF_RETENTION_METADATA_REFUSED'; END IF;
  IF old_document ? 'marketplaceProofRetentionJournal' THEN
    IF old_document->'marketplaceProofRetentionJournal' IS DISTINCT FROM meta OR NOT old_document ?& ARRAY['marketplaceProofRetentionOperations','marketplaceProofRetentionUploadIndex','marketplaceProofRetentionPublicationIndex'] THEN RAISE EXCEPTION 'PROOF_RETENTION_METADATA_REFUSED'; END IF;
  ELSIF old_document ?| ARRAY['marketplaceProofRetentionOperations','marketplaceProofRetentionUploadIndex','marketplaceProofRetentionPublicationIndex'] THEN RAISE EXCEPTION 'PROOF_RETENTION_METADATA_REFUSED'; END IF;
  IF jsonb_typeof(old_ops) IS DISTINCT FROM 'object' OR jsonb_typeof(old_upload_index) IS DISTINCT FROM 'object' OR jsonb_typeof(old_publication_index) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(old_ops))>=max_ops
    OR (SELECT count(*) FROM jsonb_object_keys(old_ops))<>(SELECT count(*) FROM jsonb_object_keys(old_upload_index))
    OR (SELECT count(*) FROM jsonb_object_keys(old_ops))<>(SELECT count(*) FROM jsonb_object_keys(old_publication_index))
  THEN RAISE EXCEPTION 'PROOF_RETENTION_CAPACITY_OR_HISTORY_REFUSED'; END IF;
  PERFORM atlas_marketplace.check_retention_history_v1(old_ops,old_upload_index,old_publication_index,installed.binding,max_ops);
  pub_key:=atlas_marketplace.proof_hash_v1(jsonb_build_object('ledgerId',o->'publicationLedgerId','sessionId',o->'publicationSessionId','operationId',o->'publicationOperationId'));
  IF old_ops ? id OR old_upload_index ? (o->>'uploadId') OR old_publication_index ? pub_key THEN RAISE EXCEPTION 'PROOF_RETENTION_ORIGINAL_ALREADY_RECORDED'; END IF;
  u:=old_document->'marketplaceProofUploads'->(o->>'uploadId'); m:=u->'manifest';
  IF jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'status' IS DISTINCT FROM 'VALIDATED' OR atlas_marketplace.proof_hash_v1(u)<>o->>'expectedUploadHash'
    OR old_document->'marketplaceProofObjects' ? (o->>'proofId') OR old_document->'marketplaceProofReviews' ? (o->>'proofId')
  THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['uploadId','proofId','orderId','actorId','actorRole','objectKey','orderHash','policyHash'] LOOP
    IF u->key IS DISTINCT FROM o->key THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  END LOOP;
  IF u->'requestHash' IS DISTINCT FROM o->'originalRequestHash' OR jsonb_typeof(u->'purpose') IS DISTINCT FROM 'string' OR u->>'purpose' NOT IN ('RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW') THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['createdAt','expiresAt','retainUntil','attempts'] LOOP
    IF jsonb_typeof(u->key) IS DISTINCT FROM 'number' OR (u->>key)::numeric<0 OR (u->>key)::numeric>9007199254740991 OR (u->>key)::numeric<>trunc((u->>key)::numeric) THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  END LOOP;
  IF (u->>'expiresAt')::bigint<=(u->>'createdAt')::bigint OR (u->>'retainUntil')::bigint<=(u->>'createdAt')::bigint THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  PERFORM atlas_marketplace.proof_exact_object_v1(u->'plan',ARRAY['declaredType','byteCount','sha256']);
  IF u->'plan'->'byteCount' IS DISTINCT FROM o->'originalByteCount' OR u->'plan'->'sha256' IS DISTINCT FROM o->'originalSha256' OR jsonb_typeof(u->'plan'->'declaredType') IS DISTINCT FROM 'string' OR u->'plan'->>'declaredType' NOT IN ('image/png','image/jpeg') THEN RAISE EXCEPTION 'PROOF_RETENTION_UPLOAD_REFUSED'; END IF;
  PERFORM atlas_marketplace.proof_exact_object_v1(m,ARRAY['schema','proofId','uploadId','environment','storageId','retentionRef','retainUntil','createdAt','validatedAt','policyHash','orderBinding','actorId','actorRole','purpose','byteCount','sha256','validation']);
  IF m->>'schema' IS DISTINCT FROM 'atlas-marketplace-retained-proof-v1' OR m->>'environment' IS DISTINCT FROM environment OR atlas_marketplace.proof_hash_v1(m)<>o->>'manifestHash'
    OR m->'byteCount' IS DISTINCT FROM o->'originalByteCount' OR m->'sha256' IS DISTINCT FROM o->'originalSha256'
    OR jsonb_typeof(m->'validatedAt') IS DISTINCT FROM 'number' OR (m->>'validatedAt')::numeric<>trunc((m->>'validatedAt')::numeric)
    OR (m->>'validatedAt')::numeric<(u->>'createdAt')::bigint OR (m->>'validatedAt')::numeric>at_ms
  THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['proofId','uploadId','retainUntil','createdAt','policyHash','orderBinding','actorId','actorRole','purpose'] LOOP
    IF m->key IS DISTINCT FROM u->key THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['storageId','retentionRef'] LOOP
    IF NOT atlas_marketplace.proof_text_v1(m->key) THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  END LOOP;
  PERFORM atlas_marketplace.proof_exact_object_v1(m->'validation',ARRAY['schema','decoder','contentType','byteCount','sha256','width','height']);
  IF m->'validation'->>'schema' IS DISTINCT FROM 'atlas-marketplace-proof-image-v1' OR m->'validation'->>'decoder' IS DISTINCT FROM 'sharp-0.33.5/libvips-8.15.3'
    OR m->'validation'->'contentType' IS DISTINCT FROM u->'plan'->'declaredType' OR m->'validation'->'byteCount' IS DISTINCT FROM o->'originalByteCount' OR m->'validation'->'sha256' IS DISTINCT FROM o->'originalSha256'
  THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['width','height'] LOOP
    IF jsonb_typeof(m->'validation'->key) IS DISTINCT FROM 'number' OR (m->'validation'->>key)::numeric NOT BETWEEN 1 AND 16000000 OR (m->'validation'->>key)::numeric<>trunc((m->'validation'->>key)::numeric) THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  END LOOP;
  IF (m->'validation'->>'width')::bigint*(m->'validation'->>'height')::bigint>16000000 THEN RAISE EXCEPTION 'PROOF_RETENTION_MANIFEST_REFUSED'; END IF;
  PERFORM atlas_marketplace.proof_exact_object_v1(u->'orderBinding',ARRAY['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion']);
  IF atlas_marketplace.proof_hash_v1(u->'orderBinding')<>o->>'orderHash' OR u->'orderBinding'->'orderId' IS DISTINCT FROM o->'orderId' THEN RAISE EXCEPTION 'PROOF_RETENTION_ORDER_REFUSED'; END IF;
  FOREACH key IN ARRAY ARRAY['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion'] LOOP
    IF NOT atlas_marketplace.proof_text_v1(u->'orderBinding'->key) THEN RAISE EXCEPTION 'PROOF_RETENTION_ORDER_REFUSED'; END IF;
  END LOOP;
  order_row:=old_document->'orders'->(o->>'orderId'); payment:=old_document->'intents'->(order_row->>'paymentIntentId');
  IF payment->>'kind' IS DISTINCT FROM 'PAYMENT' OR payment->>'status' IS DISTINCT FROM 'SUCCEEDED' OR payment->'confirmed' IS DISTINCT FROM 'true'::jsonb OR payment->'orderId' IS DISTINCT FROM o->'orderId' OR payment->'bindingHash' IS DISTINCT FROM order_row->'bindingHash'
    OR u->'orderBinding' IS DISTINCT FROM jsonb_build_object('orderId',order_row->'orderId','cardId',order_row->'cardId','buyerId',order_row->'buyerId','sellerId',order_row->'sellerId','bindingHash',order_row->'bindingHash','policyVersion',order_row->'policyVersion')
    OR (CASE WHEN o->>'actorRole'='BUYER' THEN u->'orderBinding'->'buyerId' IS DISTINCT FROM o->'actorId' OR u->>'purpose' IS DISTINCT FROM 'RETURN_REQUEST' ELSE u->>'purpose'='RETURN_REQUEST' END)
  THEN RAISE EXCEPTION 'PROOF_RETENTION_ORDER_REFUSED'; END IF;

  expected:=old_document||jsonb_build_object('marketplaceProofRetentionJournal',meta,'marketplaceProofRetentionOperations',old_ops||jsonb_build_object(id,r),'marketplaceProofRetentionUploadIndex',old_upload_index||jsonb_build_object(o->>'uploadId',id),'marketplaceProofRetentionPublicationIndex',old_publication_index||jsonb_build_object(pub_key,id));
  IF cancelling THEN
    PERFORM atlas_marketplace.proof_exact_object_v1(r->'barrier',ARRAY['barrierId','barrierRevision']);
    IF jsonb_typeof(r->'barrier'->'barrierId') IS DISTINCT FROM 'string' OR r->'barrier'->>'barrierId' !~ uuid_pattern OR jsonb_typeof(r->'barrier'->'barrierRevision') IS DISTINCT FROM 'number'
      OR (r->'barrier'->>'barrierRevision')::numeric<>trunc((r->'barrier'->>'barrierRevision')::numeric) OR (r->'barrier'->>'barrierRevision')::numeric>(9007199254740991)::numeric OR (r->'barrier'->>'barrierRevision')::numeric<=(o->>'retentionFenceRevision')::numeric
      OR r->'result' IS DISTINCT FROM 'null'::jsonb OR r->'retainedUploadHash' IS DISTINCT FROM 'null'::jsonb OR r->'proofObjectHash' IS DISTINCT FROM 'null'::jsonb
    THEN RAISE EXCEPTION 'PROOF_RETENTION_BARRIER_REFUSED'; END IF;
    expected_event:=jsonb_build_object('type','MARKETPLACE_PROOF_RETENTION_CANCELLED','payload',jsonb_build_object('operationId',id,'uploadId',o->'uploadId','proofId',o->'proofId')||(r->'barrier'));
  ELSE
    IF r->'barrier' IS DISTINCT FROM 'null'::jsonb OR (old_document ? 'marketplaceProofObjects' AND jsonb_typeof(old_document->'marketplaceProofObjects') IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'PROOF_RETENTION_ORIGINAL_REFUSED'; END IF;
    expected_upload:=u||jsonb_build_object('status','RETAINED','completedAt',at_ms);
    expected_object:=jsonb_build_object('proofId',o->'proofId','uploadId',o->'uploadId','objectKey',o->'objectKey','manifest',m,'manifestHash',o->'manifestHash','retainedAt',at_ms);
    expected_result:=jsonb_build_object('uploadId',o->'uploadId','proofId',o->'proofId','orderId',o->'orderId','purpose',u->'purpose','status','RETAINED','declaredType',u->'plan'->'declaredType','byteCount',o->'originalByteCount','sha256',o->'originalSha256','expiresAt',u->'expiresAt','createdAt',u->'createdAt','reviewStatus','NOT_REVIEWED');
    IF r->'result' IS DISTINCT FROM expected_result OR r->>'retainedUploadHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(expected_upload) OR r->>'proofObjectHash' IS DISTINCT FROM atlas_marketplace.proof_hash_v1(expected_object) THEN RAISE EXCEPTION 'PROOF_RETENTION_ORIGINAL_REFUSED'; END IF;
    expected:=expected||jsonb_build_object('marketplaceProofUploads',(old_document->'marketplaceProofUploads')||jsonb_build_object(o->>'uploadId',expected_upload),'marketplaceProofObjects',coalesce(old_document->'marketplaceProofObjects','{}'::jsonb)||jsonb_build_object(o->>'proofId',expected_object));
    expected_event:=jsonb_build_object('type','MARKETPLACE_PROOF_RETAINED','payload',jsonb_build_object('proofId',o->'proofId','orderId',o->'orderId','purpose',u->'purpose','actorId',o->'actorId'));
  END IF;
  IF jsonb_typeof(old_document->'events') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PROOF_RETENTION_EVENTS_REFUSED'; END IF;
  event_count:=jsonb_array_length(old_document->'events');
  expected_event:=expected_event||jsonb_build_object('sequence',event_count+1,'at',at_ms,'environment',environment);
  expected:=expected||jsonb_build_object('events',(old_document->'events')||jsonb_build_array(expected_event));
  IF next_document IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PROOF_RETENTION_UNRELATED_OR_MALFORMED_CHANGE'; END IF;
END $$;

CREATE FUNCTION atlas_marketplace.read_retention_state_v1() RETURNS SETOF atlas_marketplace.state
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM atlas_marketplace.state WHERE id $$;
CREATE FUNCTION atlas_marketplace.lock_retention_state_v1() RETURNS SETOF atlas_marketplace.state
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT * FROM atlas_marketplace.state WHERE id FOR UPDATE $$;
-- Explicit fourth confined read surface: the installed singleton tuple only.
-- No direct table grant, caller-selected lookup, mutation or authority receipt.
CREATE FUNCTION atlas_marketplace.read_retention_binding_v1() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE WHEN octet_length(binding::text)<=4096 THEN
    jsonb_build_object('schema','atlas-proof-retention-installed-binding-v1','binding',binding,'maxOperations',max_operations)
    ELSE NULL END FROM atlas_marketplace.proof_retention_binding_v1 WHERE id
$$;
CREATE FUNCTION atlas_marketplace.commit_retention_state_v1(expected_revision bigint, expected_hash text, next_document jsonb, next_hash text, at_ms bigint, operation_id uuid, operation_hash text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old atlas_marketplace.state%ROWTYPE;
BEGIN
  SELECT * INTO STRICT old FROM atlas_marketplace.state WHERE id FOR UPDATE;
  IF old.revision<>expected_revision OR old.state_hash<>expected_hash THEN RAISE EXCEPTION 'STALE_MARKETPLACE_STATE' USING ERRCODE='40001'; END IF;
  PERFORM atlas_marketplace.check_retention_transition_v1(old.document,next_document,operation_id,operation_hash,at_ms,old.environment);
  RETURN atlas_marketplace.commit_state_internal_v1(expected_revision,expected_hash,next_document,next_hash,at_ms);
END $$;

-- No caller can execute the common CAS or helpers; only definer gateways can.
CREATE ROLE atlas_proof_retention_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE atlas_marketplace_review_candidate TO atlas_proof_retention_writer;
GRANT USAGE ON SCHEMA atlas_marketplace TO atlas_proof_retention_writer;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='atlas_marketplace' AND p.proname IN ('proof_exact_object_v1','proof_canonical_v1','proof_hash_v1','proof_text_v1','check_retention_history_v1','commit_state','check_retention_transition_v1','read_retention_state_v1','lock_retention_state_v1','read_retention_binding_v1','commit_retention_state_v1') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO atlas_marketplace_owner',f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,atlas_marketplace_writer,atlas_proof_retention_writer',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) TO atlas_marketplace_writer;
GRANT EXECUTE ON FUNCTION atlas_marketplace.read_retention_state_v1(),atlas_marketplace.lock_retention_state_v1(),atlas_marketplace.read_retention_binding_v1(),atlas_marketplace.commit_retention_state_v1(bigint,text,jsonb,text,bigint,uuid,text) TO atlas_proof_retention_writer;
COMMIT;
