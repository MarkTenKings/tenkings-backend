-- Additive, immutable reviewed catalog authority. No legacy data is promoted.
ALTER TABLE "SetDraft" ADD COLUMN "currentCatalogPublicationId" TEXT;
CREATE UNIQUE INDEX "SetDraftVersion_id_draftId_key" ON "SetDraftVersion"("id", "draftId");
CREATE UNIQUE INDEX "SetApproval_id_draftId_draftVersionId_key" ON "SetApproval"("id", "draftId", "draftVersionId");

CREATE TABLE "SetCatalogEvidencePublication" (
  "id" TEXT PRIMARY KEY,
  "draftId" TEXT NOT NULL,
  "draftVersionId" TEXT NOT NULL,
  "setApprovalId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL CHECK ("schemaVersion" = 'setops-catalog-evidence/v1'),
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "manifestJson" JSONB NOT NULL CHECK (jsonb_typeof("manifestJson") = 'object' AND octet_length("manifestJson"::text) <= 5000000),
  "manifestSha256" TEXT NOT NULL CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$'),
  "verificationJson" JSONB NOT NULL CHECK (jsonb_typeof("verificationJson") = 'object' AND octet_length("verificationJson"::text) <= 1000000),
  "verificationSha256" TEXT NOT NULL CHECK ("verificationSha256" ~ '^[a-f0-9]{64}$'),
  "supersedesPublicationId" TEXT,
  "reviewedById" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SetCatalogEvidencePublication_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SetCatalogEvidencePublication_version_fkey" FOREIGN KEY ("draftVersionId", "draftId") REFERENCES "SetDraftVersion"("id", "draftId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SetCatalogEvidencePublication_approval_fkey" FOREIGN KEY ("setApprovalId", "draftId", "draftVersionId") REFERENCES "SetApproval"("id", "draftId", "draftVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SetCatalogEvidencePublication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "SetCatalogEvidencePublication_setApprovalId_key" ON "SetCatalogEvidencePublication"("setApprovalId");
CREATE UNIQUE INDEX "SetCatalogEvidencePublication_supersedesPublicationId_key" ON "SetCatalogEvidencePublication"("supersedesPublicationId");
CREATE UNIQUE INDEX "SetCatalogEvidencePublication_id_draftId_key" ON "SetCatalogEvidencePublication"("id", "draftId");
CREATE UNIQUE INDEX "SetCatalogEvidencePublication_draftId_revision_key" ON "SetCatalogEvidencePublication"("draftId", "revision");
ALTER TABLE "SetCatalogEvidencePublication" ADD CONSTRAINT "SetCatalogEvidencePublication_predecessor_fkey" FOREIGN KEY ("supersedesPublicationId", "draftId") REFERENCES "SetCatalogEvidencePublication"("id", "draftId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SetDraft" ADD CONSTRAINT "SetDraft_catalog_current_fkey" FOREIGN KEY ("currentCatalogPublicationId", "id") REFERENCES "SetCatalogEvidencePublication"("id", "draftId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "SetCatalogObservationProposal" (
  "id" TEXT PRIMARY KEY,
  "producer" TEXT NOT NULL CHECK ("producer" IN ('inventory','atlas')),
  "observationId" TEXT NOT NULL CHECK (length("observationId") BETWEEN 1 AND 256),
  "inputRevision" TEXT NOT NULL CHECK (length("inputRevision") BETWEEN 1 AND 256),
  "physicalCardRef" TEXT NOT NULL CHECK (length("physicalCardRef") BETWEEN 1 AND 256),
  "proposalJson" JSONB NOT NULL CHECK (jsonb_typeof("proposalJson") = 'object' AND octet_length("proposalJson"::text) <= 5000000),
  "proposalSha256" TEXT NOT NULL CHECK ("proposalSha256" ~ '^[a-f0-9]{64}$'),
  "actorKind" TEXT NOT NULL CHECK ("actorKind" IN ('human','service')),
  "actorRef" TEXT NOT NULL CHECK (length("actorRef") BETWEEN 1 AND 256),
  "bindingJson" JSONB NOT NULL CHECK (jsonb_typeof("bindingJson") = 'object'),
  "bindingSha256" TEXT NOT NULL CHECK ("bindingSha256" ~ '^[a-f0-9]{64}$'),
  "submittedById" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("actorKind" = 'human' AND "submittedById" IS NOT NULL) OR ("actorKind" = 'service' AND "submittedById" IS NULL)),
  CONSTRAINT "SetCatalogObservationProposal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "SetCatalogObservationProposal_producer_observationId_inputRevision_key" ON "SetCatalogObservationProposal"("producer", "observationId", "inputRevision");

CREATE FUNCTION tk_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Catalog evidence history is append-only'; END;
$$;
CREATE TRIGGER "SetCatalogPublication_immutable" BEFORE UPDATE OR DELETE ON "SetCatalogEvidencePublication" FOR EACH ROW EXECUTE FUNCTION tk_catalog_immutable();
CREATE TRIGGER "SetCatalogProposal_immutable" BEFORE UPDATE OR DELETE ON "SetCatalogObservationProposal" FOR EACH ROW EXECUTE FUNCTION tk_catalog_immutable();

CREATE FUNCTION tk_catalog_review_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_TABLE_NAME = 'SetApproval' AND EXISTS (SELECT 1 FROM "SetCatalogEvidencePublication" WHERE "setApprovalId" = OLD.id))
    OR (TG_TABLE_NAME = 'SetDraftVersion' AND EXISTS (SELECT 1 FROM "SetCatalogEvidencePublication" WHERE "draftVersionId" = OLD.id)) THEN
    RAISE EXCEPTION 'Reviewed catalog binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SetApproval_catalog_immutable" BEFORE UPDATE ON "SetApproval" FOR EACH ROW EXECUTE FUNCTION tk_catalog_review_binding_immutable();
CREATE TRIGGER "SetDraftVersion_catalog_immutable" BEFORE UPDATE ON "SetDraftVersion" FOR EACH ROW EXECUTE FUNCTION tk_catalog_review_binding_immutable();

CREATE FUNCTION tk_catalog_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action LIKE 'set_ops.catalog.%' OR (TG_OP = 'UPDATE' AND NEW.action LIKE 'set_ops.catalog.%') THEN
    RAISE EXCEPTION 'Catalog audit history is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SetAuditEvent_catalog_immutable" BEFORE UPDATE OR DELETE ON "SetAuditEvent" FOR EACH ROW EXECUTE FUNCTION tk_catalog_audit_immutable();
CREATE UNIQUE INDEX "SetAuditEvent_catalog_transition_key" ON "SetAuditEvent"("draftId", "action", ("metadataJson"->>'publicationId'))
  WHERE action IN ('set_ops.catalog.publish', 'set_ops.catalog.revoke') AND status = 'SUCCESS';

CREATE FUNCTION tk_catalog_publication_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "SetDraft"; prior "SetCatalogEvidencePublication"; a "SetApproval"; v "SetDraftVersion";
BEGIN
  SELECT * INTO d FROM "SetDraft" WHERE id = NEW."draftId" FOR UPDATE;
  IF d.id IS NULL OR d."archivedAt" IS NOT NULL OR d.status <> 'APPROVED' THEN RAISE EXCEPTION 'Catalog draft is unavailable'; END IF;
  SELECT * INTO prior FROM "SetCatalogEvidencePublication" WHERE "draftId" = d.id ORDER BY revision DESC LIMIT 1;
  IF NEW.revision <> COALESCE(prior.revision, 0) + 1 OR NEW."supersedesPublicationId" IS DISTINCT FROM prior.id THEN
    RAISE EXCEPTION 'Catalog history pin is stale';
  END IF;
  SELECT * INTO a FROM "SetApproval" WHERE id = NEW."setApprovalId";
  SELECT * INTO v FROM "SetDraftVersion" WHERE id = NEW."draftVersionId";
  IF a.decision <> 'APPROVED' OR a."approvedById" IS DISTINCT FROM NEW."reviewedById" OR a."versionHash" IS DISTINCT FROM v."versionHash"
    OR v."blockingErrorCount" <> 0 OR v.version <> (SELECT max(version) FROM "SetDraftVersion" WHERE "draftId" = d.id)
    OR NEW."manifestJson"->>'schemaVersion' IS DISTINCT FROM NEW."schemaVersion"
    OR NEW."manifestJson"#>>'{set,setId}' IS DISTINCT FROM d."setId"
    OR NEW."manifestJson"#>>'{setOps,draftId}' IS DISTINCT FROM d.id
    OR NEW."manifestJson"#>>'{setOps,draftVersionId}' IS DISTINCT FROM v.id
    OR NEW."manifestJson"#>>'{setOps,legacyVersionHash}' IS DISTINCT FROM v."versionHash"
    OR NEW."manifestJson"->>'revision' IS DISTINCT FROM NEW.revision::text THEN
    RAISE EXCEPTION 'Catalog review binding mismatch';
  END IF;
  IF (prior.id IS NULL AND NEW."manifestJson"->'supersedes' <> 'null'::jsonb)
    OR (prior.id IS NOT NULL AND (NEW."manifestJson"#>>'{supersedes,publicationId}' IS DISTINCT FROM prior.id
      OR NEW."manifestJson"#>>'{supersedes,manifestSha256}' IS DISTINCT FROM prior."manifestSha256"
      OR NEW."manifestJson"#>>'{supersedes,revision}' IS DISTINCT FROM prior.revision::text
      OR NEW."manifestJson"#>>'{supersedes,setId}' IS DISTINCT FROM d."setId")) THEN RAISE EXCEPTION 'Catalog predecessor mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SetCatalogPublication_insert_binding" BEFORE INSERT ON "SetCatalogEvidencePublication" FOR EACH ROW EXECUTE FUNCTION tk_catalog_publication_insert();

CREATE FUNCTION tk_catalog_pointer_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "SetCatalogEvidencePublication"; transition TEXT;
BEGIN
  IF OLD."setId" IS DISTINCT FROM NEW."setId" AND EXISTS (SELECT 1 FROM "SetCatalogEvidencePublication" WHERE "draftId" = OLD.id) THEN
    RAISE EXCEPTION 'Published catalog set identity is immutable';
  END IF;
  IF NEW."currentCatalogPublicationId" IS NOT DISTINCT FROM OLD."currentCatalogPublicationId" THEN RETURN NEW; END IF;
  IF NEW."currentCatalogPublicationId" IS NULL THEN
    SELECT * INTO p FROM "SetCatalogEvidencePublication" WHERE id = OLD."currentCatalogPublicationId";
    transition := 'set_ops.catalog.revoke';
  ELSE
    SELECT * INTO p FROM "SetCatalogEvidencePublication" WHERE id = NEW."currentCatalogPublicationId";
    IF p."draftId" IS DISTINCT FROM OLD.id OR NEW."archivedAt" IS NOT NULL OR NEW.status <> 'APPROVED'
      OR p.id IS DISTINCT FROM (SELECT id FROM "SetCatalogEvidencePublication" WHERE "draftId" = OLD.id ORDER BY revision DESC LIMIT 1)
      OR NOT EXISTS (SELECT 1 FROM "SetCatalogEvidencePublication" WHERE id = p.id AND xmin::text::bigint = txid_current()) THEN
      RAISE EXCEPTION 'Catalog pointer may only install a new reviewed publication';
    END IF;
    transition := 'set_ops.catalog.publish';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "SetAuditEvent" WHERE "draftId" = OLD.id AND action = transition AND status = 'SUCCESS'
    AND "metadataJson"->>'publicationId' = p.id AND "metadataJson"->>'manifestSha256' = p."manifestSha256"
    AND "actorId" IS NOT NULL AND xmin::text::bigint = txid_current()) THEN
    RAISE EXCEPTION 'Catalog transition requires atomic audit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SetDraft_catalog_pointer" BEFORE UPDATE ON "SetDraft" FOR EACH ROW EXECUTE FUNCTION tk_catalog_pointer_transition();

CREATE FUNCTION tk_catalog_publication_committed_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SetDraft" WHERE id = NEW."draftId" AND "currentCatalogPublicationId" = NEW.id) THEN
    RAISE EXCEPTION 'Catalog publication must commit with its current pointer';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "SetCatalogPublication_atomic_current" AFTER INSERT ON "SetCatalogEvidencePublication"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tk_catalog_publication_committed_current();
