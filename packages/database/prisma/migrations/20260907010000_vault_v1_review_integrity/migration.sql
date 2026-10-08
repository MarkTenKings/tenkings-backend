-- Vault review corrections: source-only; execution belongs to the disposable
-- migration harness until deployment receives separate owner authorization.
ALTER TABLE "VaultMachineEvent" ADD COLUMN "actor" TEXT;
ALTER TABLE "VaultRestockSession" ADD COLUMN "mode" "VaultMode" NOT NULL DEFAULT 'PRODUCTION';
ALTER TABLE "VaultSale" ADD COLUMN "certificationSessionId" TEXT;
ALTER TABLE "VaultRestockSession" ADD COLUMN "certificationSessionId" TEXT;

CREATE FUNCTION "vault_v1_protect_published_config"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('PUBLISHED', 'SUPERSEDED', 'REVOKED') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Published Vault configs are immutable'; END IF;
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
       OR NEW."status" NOT IN ('PUBLISHED', 'SUPERSEDED', 'REVOKED')
       OR (OLD."status" <> 'PUBLISHED' AND NEW."status" = 'PUBLISHED')
       OR (OLD."status" = 'REVOKED' AND NEW."status" <> 'REVOKED') THEN
      RAISE EXCEPTION 'Published Vault configs are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultConfigVersion_protect_published" BEFORE UPDATE OR DELETE ON "VaultConfigVersion" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_published_config"();

CREATE FUNCTION "vault_v1_protect_sale_snapshot"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault sales are retained'; END IF;
  IF ROW(NEW."machineId", NEW."localTransactionId", NEW."mode", NEW."configVersionId", NEW."configVersionNumber", NEW."configDigest", NEW."machineTimezone", NEW."taxCity", NEW."taxState", NEW."taxRateBasisPoints", NEW."taxCalculationVersion", NEW."subtotalCents", NEW."taxCents", NEW."totalCents", NEW."currency", NEW."itemCount") IS DISTINCT FROM
     ROW(OLD."machineId", OLD."localTransactionId", OLD."mode", OLD."configVersionId", OLD."configVersionNumber", OLD."configDigest", OLD."machineTimezone", OLD."taxCity", OLD."taxState", OLD."taxRateBasisPoints", OLD."taxCalculationVersion", OLD."subtotalCents", OLD."taxCents", OLD."totalCents", OLD."currency", OLD."itemCount")
     OR NEW."certificationSessionId" IS DISTINCT FROM OLD."certificationSessionId"
     OR NEW."supportReference" IS DISTINCT FROM OLD."supportReference"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Vault sale snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultSale_protect_snapshot" BEFORE UPDATE OR DELETE ON "VaultSale" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_sale_snapshot"();

CREATE FUNCTION "vault_v1_protect_certificate"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault certificates are retained'; END IF;
  IF ROW(NEW."certificatePayload", NEW."digest", NEW."detachedSignature", NEW."certificationId", NEW."issuedAt", NEW."approvedByUserId", NEW."approvedByRole", NEW."signingKeyId", NEW."signingAlgorithm") IS DISTINCT FROM
     ROW(OLD."certificatePayload", OLD."digest", OLD."detachedSignature", OLD."certificationId", OLD."issuedAt", OLD."approvedByUserId", OLD."approvedByRole", OLD."signingKeyId", OLD."signingAlgorithm") THEN
    RAISE EXCEPTION 'Vault certificates are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultCertificate_protect_signed" BEFORE UPDATE OR DELETE ON "VaultCertificate" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_certificate"();

CREATE FUNCTION "vault_v1_check_business_scope"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "VaultConfigVersion" c WHERE c."id" = NEW."configVersionId" AND c."machineId" = NEW."machineId") THEN
    RAISE EXCEPTION 'Vault config belongs to a different machine';
  END IF;
  IF NEW."certificationSessionId" IS NOT NULL AND
     (NEW."mode" <> 'CERTIFICATION' OR NOT EXISTS (SELECT 1 FROM "VaultCertificationSession" c WHERE c."id" = NEW."certificationSessionId" AND c."machineId" = NEW."machineId" AND c."configVersionId" = NEW."configVersionId")) THEN
    RAISE EXCEPTION 'Vault certification linkage must match test mode, machine and config';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultSale_check_scope" BEFORE INSERT OR UPDATE ON "VaultSale" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_business_scope"();
CREATE TRIGGER "VaultRestockSession_check_scope" BEFORE INSERT OR UPDATE ON "VaultRestockSession" FOR EACH ROW EXECUTE FUNCTION "vault_v1_check_business_scope"();

CREATE FUNCTION "vault_v1_protect_sale_item"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault sale items are retained'; END IF;
  IF (to_jsonb(NEW) - ARRAY['allocationState','fulfillmentState','initialCommandId','initialCommandState','retryCommandId','retryCommandState','retryUsedAt','supportReason','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['allocationState','fulfillmentState','initialCommandId','initialCommandState','retryCommandId','retryCommandState','retryUsedAt','supportReason','updatedAt'])
     OR (OLD."initialCommandId" IS NOT NULL AND NEW."initialCommandId" IS DISTINCT FROM OLD."initialCommandId")
     OR (OLD."retryCommandId" IS NOT NULL AND NEW."retryCommandId" IS DISTINCT FROM OLD."retryCommandId")
     OR (OLD."retryUsedAt" IS NOT NULL AND NEW."retryUsedAt" IS DISTINCT FROM OLD."retryUsedAt") THEN
    RAISE EXCEPTION 'Vault paid snapshots and command entitlements are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultSaleItem_protect_snapshot" BEFORE UPDATE OR DELETE ON "VaultSaleItem" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_sale_item"();

CREATE FUNCTION "vault_v1_protect_certification_session"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault certification sessions are retained'; END IF;
  IF ROW(NEW."machineId", NEW."localSessionId", NEW."configVersionId", NEW."appBuild", NEW."sourceCommit", NEW."localSchemaVersion", NEW."contractVersion", NEW."nayaxAdapterVersion", NEW."nayaxSdkVersion", NEW."nayaxFlowConfig", NEW."controllerIdentity", NEW."startedByUserId", NEW."startedAt", NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."machineId", OLD."localSessionId", OLD."configVersionId", OLD."appBuild", OLD."sourceCommit", OLD."localSchemaVersion", OLD."contractVersion", OLD."nayaxAdapterVersion", OLD."nayaxSdkVersion", OLD."nayaxFlowConfig", OLD."controllerIdentity", OLD."startedByUserId", OLD."startedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Vault certification build identity is immutable';
  END IF;
  IF OLD."status" IN ('PASSED', 'INVALIDATED', 'CRITICAL_STOP') AND
     ((to_jsonb(NEW) - ARRAY['status','invalidatedAt','invalidationReason','retainUntil','updatedAt']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['status','invalidatedAt','invalidationReason','retainUntil','updatedAt'])
      OR NEW."status" NOT IN (OLD."status", 'INVALIDATED')) THEN
    RAISE EXCEPTION 'Final Vault certification evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultCertificationSession_protect_identity" BEFORE UPDATE OR DELETE ON "VaultCertificationSession" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_certification_session"();

CREATE FUNCTION "vault_v1_protect_certification_evidence"() RETURNS trigger AS $$
DECLARE parent_status "VaultCertificationStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vault certification evidence is retained'; END IF;
  IF (to_jsonb(NEW) - ARRAY['artifactStorageKey','metadata','retainUntil']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['artifactStorageKey','metadata','retainUntil'])
     OR (COALESCE(NEW."metadata", '{}'::jsonb) - ARRAY['verifiedArtifactDigest','verifiedArtifactStorageKey','artifactVerifiedAt','manifestVersion','manifestAttachedAt','manifestAttachedBy']) IS DISTINCT FROM
        (COALESCE(OLD."metadata", '{}'::jsonb) - ARRAY['verifiedArtifactDigest','verifiedArtifactStorageKey','artifactVerifiedAt','manifestVersion','manifestAttachedAt','manifestAttachedBy']) THEN
    RAISE EXCEPTION 'Vault machine certification observations are immutable';
  END IF;
  SELECT "status" INTO parent_status FROM "VaultCertificationSession" WHERE "id" = OLD."certificationId";
  IF parent_status IN ('PASSED', 'INVALIDATED', 'CRITICAL_STOP') AND
     ROW(NEW."metadata", NEW."artifactStorageKey") IS DISTINCT FROM ROW(OLD."metadata", OLD."artifactStorageKey") THEN
    RAISE EXCEPTION 'Final Vault certification artifacts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VaultCertificationEvidence_protect_observation" BEFORE UPDATE OR DELETE ON "VaultCertificationEvidence" FOR EACH ROW EXECUTE FUNCTION "vault_v1_protect_certification_evidence"();
