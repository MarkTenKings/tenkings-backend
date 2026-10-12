-- One image-edit queue, admitted with the verified upload rather than publication.
CREATE TABLE atlas_manual_connected.card_image_intent (
 upload_id uuid PRIMARY KEY,
 card_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN('LOCAL_FIXTURE','PRODUCTION')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,upload_id) REFERENCES atlas_manual_intake.upload(card_id,id)
);
CREATE TABLE atlas_manual_connected.card_image_binding (
 upload_id uuid PRIMARY KEY REFERENCES atlas_manual_connected.card_image_intent(upload_id),
 card_id uuid NOT NULL,
 side text NOT NULL CHECK(side IN('FRONT','BACK')),
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 job_key text NOT NULL REFERENCES atlas_manual_connected.report_image_job(key),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,upload_id) REFERENCES atlas_manual_intake.upload(card_id,id)
);
CREATE INDEX card_image_binding_job ON atlas_manual_connected.card_image_binding(job_key);
ALTER TABLE atlas_manual_connected.report_image_binding
 ADD COLUMN report_source_hash text CHECK(report_source_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN original_sha256 text CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT report_image_generation_binding CHECK((report_source_hash IS NULL)=(original_sha256 IS NULL));
REVOKE ALL ON atlas_manual_connected.card_image_intent,atlas_manual_connected.card_image_binding FROM PUBLIC;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.card_image_intent
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.card_image_intent
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.card_image_binding
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.card_image_binding
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
