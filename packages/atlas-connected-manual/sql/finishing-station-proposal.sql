-- INACTIVE additive proposal: no production grants, station enrollment, key,
-- profile qualification, hardware action or serving configuration is created.
BEGIN;
CREATE TABLE atlas_manual_connected.station_challenge (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 request_id uuid NOT NULL, station_id text NOT NULL CHECK(station_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 content text NOT NULL CHECK(octet_length(content)<=4096 AND jsonb_typeof(content::jsonb)='object'),
 content_hash text NOT NULL CHECK(content_hash=encode(sha256(convert_to(content,'UTF8')),'hex')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,request_id), CHECK(expires_at>created_at AND expires_at<=created_at+interval '2 minutes')
);
CREATE TABLE atlas_manual_connected.station_enrollment (
 id uuid PRIMARY KEY, challenge_id uuid NOT NULL UNIQUE REFERENCES atlas_manual_connected.station_challenge(id),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id), station_id text NOT NULL, key_id text NOT NULL,
 public_key_spki text NOT NULL CHECK(octet_length(public_key_spki)<=256),
 key_fingerprint text NOT NULL CHECK(key_fingerprint ~ '^[a-f0-9]{64}$'),
 protection_evidence_hash text NOT NULL CHECK(protection_evidence_hash ~ '^[a-f0-9]{64}$'),
 proof text NOT NULL CHECK(octet_length(proof)<=4096 AND jsonb_typeof(proof::jsonb)='object'),
 proof_hash text NOT NULL CHECK(proof_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')),
 signature text NOT NULL CHECK(octet_length(signature)<=256), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_manual_connected.station_arm (
 intent_id text PRIMARY KEY CHECK(intent_id ~ '^afnfc_[a-f0-9]{64}$'),
 station_id text NOT NULL, enrollment_id uuid NOT NULL REFERENCES atlas_manual_connected.station_enrollment(id),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id), request_id uuid NOT NULL,
 card_id uuid NOT NULL, approval_action_id uuid NOT NULL,
 request text NOT NULL CHECK(octet_length(request)<=4096 AND jsonb_typeof(request::jsonb)='object'),
 request_hash text NOT NULL CHECK(request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
 claims text NOT NULL CHECK(octet_length(claims)<=8192 AND jsonb_typeof(claims::jsonb)='object'),
 authorization_hash text NOT NULL CHECK(authorization_hash=encode(sha256(convert_to(claims,'UTF8')),'hex')),
 authorization_envelope text NOT NULL CHECK(octet_length(authorization_envelope)<=12288 AND jsonb_typeof(authorization_envelope::jsonb)='object'),
 authorization_envelope_hash text NOT NULL CHECK(authorization_envelope_hash=encode(sha256(convert_to(authorization_envelope,'UTF8')),'hex')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,request_id), UNIQUE(card_id,approval_action_id),
 FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
-- Each challenge is consumed by exactly one signed proof, including safe
-- re-pairing to an existing protected identity after a browser restart.
CREATE TABLE atlas_manual_connected.station_pairing (
 challenge_id uuid PRIMARY KEY REFERENCES atlas_manual_connected.station_challenge(id),
 enrollment_id uuid NOT NULL REFERENCES atlas_manual_connected.station_enrollment(id),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 proof text NOT NULL CHECK(octet_length(proof)<=4096 AND jsonb_typeof(proof::jsonb)='object'),
 proof_hash text NOT NULL CHECK(proof_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')),
 signature text NOT NULL CHECK(octet_length(signature)<=256), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_manual_connected.station_receipt (
 intent_id text NOT NULL REFERENCES atlas_manual_connected.station_arm(intent_id),
 kind text NOT NULL CHECK(kind IN ('WRITE','REMOVAL')),
 receipt text NOT NULL CHECK(octet_length(receipt)<=4096 AND jsonb_typeof(receipt::jsonb)='object'),
 receipt_hash text NOT NULL CHECK(receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),
 signature text NOT NULL CHECK(octet_length(signature)<=256),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(intent_id,kind)
);
-- A separate guard row serializes one physical station without overwriting its
-- append-only arm/result history. Expiry alone never releases an unknown tag.
CREATE TABLE atlas_manual_connected.station_active (
 station_id text PRIMARY KEY, intent_id text NOT NULL UNIQUE REFERENCES atlas_manual_connected.station_arm(intent_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.station_challenge FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.station_enrollment FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.station_arm FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.station_pairing FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.station_receipt FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual_connected.station_challenge,atlas_manual_connected.station_enrollment,atlas_manual_connected.station_arm,
 atlas_manual_connected.station_receipt,atlas_manual_connected.station_active,atlas_manual_connected.station_pairing FROM PUBLIC;
COMMIT;
