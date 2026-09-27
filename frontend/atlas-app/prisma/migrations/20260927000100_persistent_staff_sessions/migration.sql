-- Existing sessions and browser rows keep their original expiration. Only a
-- newly issued, verified staff sign-in receives the non-expiring marker.
-- Keep the timestamp contract used by all existing SQL authorization checks;
-- logout, identity/access-version revocation and release binding are unchanged.
BEGIN;
ALTER TABLE atlas_staff."StaffBrowser" DROP CONSTRAINT "StaffBrowser_shape";
ALTER TABLE atlas_staff."StaffBrowser" ADD CONSTRAINT "StaffBrowser_shape" CHECK (
  "tokenHash" ~ '^[a-f0-9]{64}$' AND "controlRevision" > 0 AND "expiresAt" > "createdAt"
  AND ("expiresAt" <= "createdAt" + interval '1 hour'
    OR "expiresAt" = timestamp '9999-12-31 23:59:59.999'));

ALTER TABLE atlas_staff."StaffSession" DROP CONSTRAINT "StaffSession_shape";
ALTER TABLE atlas_staff."StaffSession" ADD CONSTRAINT "StaffSession_shape" CHECK (
  "tokenHash" ~ '^[a-f0-9]{64}$' AND "accessVersion" > 0 AND "controlRevision" > 0
  AND "expiresAt" > "createdAt"
  AND ("expiresAt" <= "createdAt" + interval '30 minutes'
    OR "expiresAt" = timestamp '9999-12-31 23:59:59.999'));
COMMIT;
