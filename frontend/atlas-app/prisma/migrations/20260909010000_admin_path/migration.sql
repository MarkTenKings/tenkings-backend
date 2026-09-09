BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- Coordinated path cutover only. Never silently rewrite an active deployment,
-- sessions, grants, signed jobs or historical receipts. An existing production
-- control must be explicitly disabled before applying this migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "StaffControl" WHERE mode='PRODUCTION' AND enabled)
    OR EXISTS (SELECT 1 FROM "StaffNfcControl" WHERE mode='PRODUCTION' AND enabled) THEN
    RAISE EXCEPTION 'Disable production staff and NFC controls before the reviewed /admin cutover';
  END IF;
END $$;

ALTER TABLE "StaffControl" DROP CONSTRAINT "StaffControl_shape";
ALTER TABLE "StaffControl" ADD CONSTRAINT "StaffControl_shape" CHECK (
  id='active' AND revision>0 AND "configHash" ~ '^[a-f0-9]{64}$' AND "releaseSha" ~ '^[a-f0-9]{40}$'
  AND ((mode='PRODUCTION' AND origin='https://atlasgrading.com')
    OR (mode='PRODUCTION' AND origin='https://app.atlasgrading.com' AND NOT enabled)
    OR (mode='LOCAL_FIXTURE' AND origin='http://127.0.0.1:4318')));

-- The production Mac protocol is not implemented or qualified yet. Preserve
-- disabled Windows control metadata without granting it new origin authority.
-- Enabling native production finishing requires its own reviewed migration.
ALTER TABLE "StaffNfcControl" DROP CONSTRAINT "StaffNfcControl_shape";
ALTER TABLE "StaffNfcControl" ADD CONSTRAINT "StaffNfcControl_shape" CHECK ((
  id='active' AND revision>0 AND length("deploymentId") BETWEEN 1 AND 200
  AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
  AND "signingKeyHash" ~ '^[a-f0-9]{64}$' AND "trustHash" ~ '^[a-f0-9]{64}$'
  AND ((mode='PRODUCTION' AND NOT enabled
      AND origin IN ('https://atlasgrading.com','https://app.atlasgrading.com'))
    OR (mode='LOCAL_FIXTURE' AND origin='http://127.0.0.1:4318'))
) IS TRUE);

COMMIT;
